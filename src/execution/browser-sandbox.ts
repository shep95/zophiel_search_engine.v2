import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AppConfig } from '../config/index.js';
import { GhostChainError } from '../core/types.js';
import { cssIntelToText, enrichStylesheets, type CssScrapeResult } from './css-scraper.js';
import { runInPageExtract } from './in-page/run-extract.js';
import { jsIntelToText, mergeJsIntel, type JsScrapeResult } from './js-scraper.js';
import { attachJsonResponseCapture, waitForSpaContent } from './spa-wait.js';
import {
  buildRenderProfile,
  detectStack,
  normalizeHeaders,
  type DetectedStack,
  type RenderMode,
} from './stack-detector.js';
import { parseStaticHtml } from './static-html-scraper.js';
import { waitForStackHydration } from './stack-wait.js';
import { detectBlock, isMissionUsefulContent } from './block-detector.js';
import { buildBypassLadder, STEALTH_INIT_SCRIPT, type BypassAttempt } from './bypass-registry.js';
import { warmSunbizSession, waitForBizapediaChallenge } from './sunbiz-navigator.js';

export interface TextBlock {
  text: string;
  selector: string;
  visible: boolean;
  prominence: number;
  source: 'dom' | 'css-pseudo' | 'shadow-dom' | 'js-embedded' | 'meta';
}

export interface RenderedPage {
  html: string;
  title: string;
  finalUrl: string;
  links: string[];
  jsLibraries: string[];
  antiBotSignatures: string[];
  domPatterns: string[];
  cssClasses: string[];
  screenshotPath?: string;
  visibleTextBlocks: TextBlock[];
  cssIntel: CssScrapeResult;
  jsIntel: JsScrapeResult;
  stack: DetectedStack;
  renderMode: RenderMode;
  responseMs: number;
  bypassStrategy?: string;
  blockSignals?: string[];
}

const INTERACTION_SELECTORS = [
  'button:has-text("Load more")',
  'button:has-text("Show more")',
  'button:has-text("Show all")',
  '[aria-expanded="false"]',
  'details:not([open]) summary',
  '.accordion-header',
  '.tab:not(.active)',
  '[data-testid*="load"]',
];

const ANTI_BOT_SIGNATURES = [
  'cf-browser-verification',
  'challenge-platform',
  'captcha',
  'datadome',
  'perimeterx',
  'akamai',
  'recaptcha',
  'hcaptcha',
];

export class BrowserSandbox {
  private browser: Browser | null = null;

  constructor(private readonly config: AppConfig) {
    mkdirSync(join(config.dataDir, 'screenshots'), { recursive: true });
  }

  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  pickUserAgent(): string {
    const agents = this.config.userAgents;
    return agents[Math.floor(Math.random() * agents.length)]!;
  }

  async renderPage(url: string, userAgent: string, interactionHints: string[] = []): Promise<RenderedPage> {
    if (!this.config.bypassEnabled) {
      return this.renderPageOnce(url, userAgent, interactionHints);
    }

    const ladder = buildBypassLadder(url, this.config.bypassMaxAttempts);
    let lastError: Error | null = null;
    const blockSignals: string[] = [];

    for (const attempt of ladder) {
      try {
        const rendered = await this.renderPageOnce(
          attempt.url,
          userAgent,
          interactionHints,
          attempt,
        );

        const bodyText = rendered.visibleTextBlocks.map((b) => b.text).join('\n');
        const block = detectBlock({
          status: 200,
          html: rendered.html,
          title: rendered.title,
          url: rendered.finalUrl,
          antiBotSignatures: rendered.antiBotSignatures,
          textBlockCount: rendered.visibleTextBlocks.length,
          bodyTextLength: bodyText.length,
        });

        if (block.kind !== 'none') blockSignals.push(`${attempt.strategyId}:${block.signature}`);

        const useful = isMissionUsefulContent(bodyText, rendered.title, rendered.finalUrl);
        if (useful && block.kind !== 'captcha_gate' && block.kind !== 'shell_redirect') {
          return { ...rendered, bypassStrategy: attempt.strategyId, blockSignals };
        }

        if (block.kind === 'shell_redirect' || block.kind === 'empty_shell' || block.kind === 'captcha_gate') {
          continue;
        }

        if (rendered.visibleTextBlocks.length >= 5 && bodyText.length > 500) {
          return { ...rendered, bypassStrategy: attempt.strategyId, blockSignals };
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (error instanceof GhostChainError && error.code === 'HTTP_ERROR') {
          const status = error.details?.status as number | undefined;
          if (status === 403 || status === 429) continue;
        }
      }
    }

    if (lastError) throw lastError;
    return this.renderPageOnce(url, userAgent, interactionHints);
  }

  private async renderPageOnce(
    url: string,
    userAgent: string,
    interactionHints: string[] = [],
    bypass?: BypassAttempt,
  ): Promise<RenderedPage> {
    if (!this.browser) await this.init();
    const start = Date.now();
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await this.browser!.newContext({
        userAgent,
        viewport: bypass?.contextOptions?.viewport ?? { width: 1440, height: 900 },
        locale: bypass?.contextOptions?.locale ?? 'en-US',
        timezoneId: bypass?.contextOptions?.timezoneId ?? 'America/New_York',
        javaScriptEnabled: true,
        ignoreHTTPSErrors: false,
        isMobile: bypass?.contextOptions?.isMobile,
        hasTouch: bypass?.contextOptions?.hasTouch,
        extraHTTPHeaders: bypass?.extraHeaders,
      });

      await context.addInitScript(STEALTH_INIT_SCRIPT);

      page = await context.newPage();
      page.setDefaultTimeout(this.config.pageLoadTimeoutMs);

      const jsonCapture = attachJsonResponseCapture(page);

      if (bypass?.preNavigation === 'sunbiz_warm') {
        await warmSunbizSession(page);
      } else if (bypass?.preNavigation === 'delay') {
        await page.waitForTimeout(800 + Math.random() * 1200);
      }

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.pageLoadTimeoutMs,
      });

      if (!response) {
        throw new GhostChainError('No response from page', 'NO_RESPONSE', true);
      }

      if (response.status() >= 400) {
        throw new GhostChainError(`HTTP ${response.status()}`, 'HTTP_ERROR', response.status() >= 500, {
          status: response.status(),
        });
      }

      if (bypass?.strategyId === 'bizapedia_challenge_wait') {
        await waitForBizapediaChallenge(page, bypass.postLoadWaitMs || 12000);
      } else if (bypass?.postLoadWaitMs) {
        await page.waitForTimeout(bypass.postLoadWaitMs);
      }

      if (bypass?.waitForSelector) {
        await page.waitForSelector(bypass.waitForSelector, { timeout: 8000 }).catch(() => undefined);
      }

      const responseHeaders = normalizeHeaders(response.headers());
      const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
      let earlyHtml = await page.content();

      let stack = detectStack({
        headers: responseHeaders,
        html: earlyHtml,
        cookies,
        url: page.url(),
      });

      const profile = buildRenderProfile(stack, {
        spaWaitEnabled: this.config.spaWaitEnabled,
        networkIdleTimeoutMs: this.config.networkIdleTimeoutMs,
        domMutationQuietMs: this.config.domMutationQuietMs,
      });

      await waitForStackHydration(page, profile);

      if (profile.spaWait && profile.mode === 'spa') {
        await waitForSpaContent(page, profile.spaWaitMs, profile.mutationQuietMs);
      } else if (profile.spaWait) {
        await page.waitForLoadState('networkidle', { timeout: profile.spaWaitMs }).catch(() => undefined);
      }

      await this.simulateHumanBehavior(page, profile.scrollSteps);
      await this.revealHiddenContent(page, [...interactionHints, ...profile.interactionSelectors]);

      if (profile.mode === 'hybrid' || profile.mode === 'spa') {
        await waitForStackHydration(page, profile);
      }

      earlyHtml = await page.content();
      stack = detectStack({ headers: responseHeaders, html: earlyHtml, cookies, url: page.url() });

      const staticParse = profile.preferStaticParse ? parseStaticHtml(earlyHtml, page.url()) : null;

      const inPage = await runInPageExtract(page, this.config.scope.includeHiddenContent);
      const apiSnippets = jsonCapture.getCaptured();
      jsonCapture.detach();

      const cssIntel = await enrichStylesheets(
        page.url(),
        inPage.css,
        this.config.fetchExternalStylesheets,
      );
      const jsIntel = mergeJsIntel(inPage.js, apiSnippets);

      const supplementalTexts = [...cssIntelToText(cssIntel), ...jsIntelToText(jsIntel)];
      let textBlocks: TextBlock[] = [...inPage.textBlocks];

      if (staticParse) {
        textBlocks = mergeTextBlocks(staticParse.textBlocks, textBlocks);
      }

      for (const text of supplementalTexts) {
        if (text.length < 3) continue;
        textBlocks.push({
          text,
          selector: 'css-js-supplemental',
          visible: true,
          prominence: 0.55,
          source: 'js-embedded',
        });
      }

      const html = await page.content();
      const title = staticParse?.title || (await page.title()) || url;
      const finalUrl = page.url();
      const links = [...new Set([...(staticParse?.links ?? []), ...inPage.links, ...await this.extractShadowLinks(page)])];
      const antiBotSignatures = this.detectAntiBot(html, jsIntel);
      const domPatterns = this.patternsFromBlocks(textBlocks);
      const cssClasses = inPage.css.hiddenSelectors
        .flatMap((s) => s.match(/\.([a-z0-9_-]+)/gi) ?? [])
        .map((c) => c.replace('.', ''))
        .slice(0, 30);

      const screenshotPath = join(
        this.config.dataDir,
        'screenshots',
        `${Buffer.from(finalUrl).toString('base64url').slice(0, 64)}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });

      return {
        html,
        title,
        finalUrl,
        links,
        jsLibraries: [...new Set([...jsIntel.libraries, ...stack.frameworks])],
        antiBotSignatures,
        domPatterns,
        cssClasses,
        screenshotPath,
        visibleTextBlocks: textBlocks,
        cssIntel,
        jsIntel,
        stack,
        renderMode: stack.renderMode,
        responseMs: Date.now() - start,
      };
    } catch (error) {
      if (error instanceof GhostChainError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown render error';
      throw new GhostChainError(message, 'RENDER_FAILED', true);
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
    }
  }

  private async simulateHumanBehavior(page: Page, scrollSteps = 5): Promise<void> {
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 };

    for (let i = 1; i <= scrollSteps; i++) {
      await page.mouse.wheel(0, (viewport.height * i) / scrollSteps);
      await page.waitForTimeout(250 + Math.random() * 350);
    }

    await page.evaluate('window.scrollTo(0, 0)');
    await page.waitForTimeout(200);
  }

  private async revealHiddenContent(page: Page, hints: string[]): Promise<void> {
    const selectors = [...new Set([...hints, ...INTERACTION_SELECTORS])];

    for (const selector of selectors) {
      try {
        const elements = page.locator(selector);
        const count = await elements.count();
        const limit = Math.min(count, 3);

        for (let i = 0; i < limit; i++) {
          const el = elements.nth(i);
          if (await el.isVisible()) {
            await el.click({ timeout: 2000 });
            await page.waitForTimeout(400);
          }
        }
      } catch {
        // best-effort
      }
    }
  }

  private async extractShadowLinks(page: Page): Promise<string[]> {
    return page.evaluate(
      `(() => {
        const links = [];
        const walk = (root) => {
          for (const a of Array.from(root.querySelectorAll('a[href]'))) links.push(a.href);
          for (const el of Array.from(root.querySelectorAll('*'))) {
            if (el.shadowRoot) walk(el.shadowRoot);
          }
        };
        walk(document);
        return links;
      })()`,
    ) as Promise<string[]>;
  }

  private detectAntiBot(html: string, jsIntel: JsScrapeResult): string[] {
    const lower = html.toLowerCase();
    const sigs = ANTI_BOT_SIGNATURES.filter((sig) => lower.includes(sig));
    if (jsIntel.libraries.length === 0 && jsIntel.scriptUrls.length > 10 && html.length < 5000) {
      sigs.push('possible-js-shell');
    }
    return sigs;
  }

  private patternsFromBlocks(blocks: TextBlock[]): string[] {
    return blocks
      .map((b) => b.selector)
      .filter((s) => s.startsWith('#') || s.startsWith('.') || s.startsWith('['))
      .slice(0, 40);
  }
}

function mergeTextBlocks(primary: TextBlock[], secondary: TextBlock[]): TextBlock[] {
  const seen = new Set<string>();
  const merged: TextBlock[] = [];
  for (const block of [...primary, ...secondary]) {
    const key = block.text.slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(block);
  }
  return merged.slice(0, 350);
}
