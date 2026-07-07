import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config/index.js';
import type { Logger } from './core/logger.js';
import type { ParsedQuery } from './core/taxonomy.js';
import { GhostChainError, type CrawlJob, type CrawlResult, type ExtractedEntity, type SearchHit } from './core/types.js';
import { clusterKeywords, extractEntities } from './distillation/entity-extractor.js';
import { buildSegments, distillSignal } from './distillation/keyword-extractor.js';
import { BrowserSandbox } from './execution/browser-sandbox.js';
import { CrawlQueue } from './ingress/crawl-queue.js';
import { DomainRateLimiter } from './ingress/rate-limiter.js';
import { checkRobotsAllowed } from './ingress/robots.js';
import { isInScope, resolveLink, validateSeedUrl } from './ingress/url-validator.js';
import { FreshnessTracker, ImmuneMemory } from './learning/immune-memory.js';
import { SearchIndex } from './search/index.js';
import { createDatabase } from './storage/database.js';

export interface MissionSeedOptions {
  priority?: number;
  correlationId?: string;
  maxDepth?: number;
  rootDomainMode?: 'strict' | 'permissive';
}

export class GhostChainCrawler {
  private readonly db;
  private readonly queue: CrawlQueue;
  private readonly rateLimiter: DomainRateLimiter;
  private readonly browser: BrowserSandbox;
  private readonly immuneMemory: ImmuneMemory;
  private readonly freshness: FreshnessTracker;
  private readonly searchIndex: SearchIndex;
  private missionMode: 'strict' | 'permissive' = 'strict';
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.db = createDatabase(config);
    this.queue = new CrawlQueue(this.db, config);
    this.rateLimiter = new DomainRateLimiter(this.db, config, logger);
    this.browser = new BrowserSandbox(config);
    this.immuneMemory = new ImmuneMemory(this.db);
    this.freshness = new FreshnessTracker(this.db);
    this.searchIndex = new SearchIndex(this.db);
  }

  async init(): Promise<void> {
    await this.browser.init();
  }

  async close(): Promise<void> {
    this.running = false;
    await this.browser.close();
    this.db.close();
  }

  seed(urls: string[], priority = 10): string[] {
    const accepted: string[] = [];

    for (const raw of urls) {
      try {
        const url = validateSeedUrl(raw, {
          blockedHosts: this.config.blockedHosts,
          allowedDomains: this.config.scope.allowedDomains,
          excludePatterns: this.config.scope.excludePatterns,
        });

        const rootDomain = new URL(url).hostname.toLowerCase();
        const job = this.queue.enqueue(url, {
          depth: 0,
          priority,
          correlationId: randomUUID(),
          rootDomain,
        });

        if (job) {
          accepted.push(url);
          this.logger.info({ url, jobId: job.id }, 'Seed URL enqueued');
        }
      } catch (error) {
        this.logger.warn({ raw, error }, 'Rejected seed URL');
      }
    }

    return accepted;
  }

  seedMission(urls: string[], options: MissionSeedOptions = {}): string[] {
    this.missionMode = options.rootDomainMode ?? 'permissive';
    const accepted: string[] = [];
    const correlationId = options.correlationId ?? randomUUID();

    for (const raw of urls) {
      try {
        const url = validateSeedUrl(raw, {
          blockedHosts: this.config.blockedHosts,
          allowedDomains: this.config.scope.allowedDomains,
          excludePatterns: this.config.scope.excludePatterns,
        });

        const job = this.queue.enqueue(url, {
          depth: 0,
          priority: options.priority ?? 100,
          correlationId,
          rootDomain: new URL(url).hostname.toLowerCase(),
        });

        if (job) {
          accepted.push(url);
          this.logger.info({ url, jobId: job.id, mission: true }, 'Mission target enqueued');
        }
      } catch (error) {
        this.logger.warn({ raw, error }, 'Rejected mission URL');
      }
    }

    return accepted;
  }

  async runWorkerLoop(): Promise<void> {
    this.running = true;
    await this.init();

    const workers = Array.from({ length: this.config.concurrency }, (_, i) => this.workerLoop(i));
    await Promise.all(workers);
  }

  private async workerLoop(workerId: number): Promise<void> {
    this.logger.info({ workerId }, 'Worker started');

    while (this.running) {
      if (this.queue.hasReachedMaxPages()) {
        await sleep(1000);
        continue;
      }

      const job = this.queue.claimNext();
      if (!job) {
        await sleep(500);
        continue;
      }

      try {
        await this.processJob(job);
        this.queue.complete(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const retryable = error instanceof GhostChainError ? error.retryable : false;
        const code = error instanceof GhostChainError ? error.code : 'UNKNOWN';

        if (code === 'ROBOTS_BLOCKED') {
          this.queue.block(job.id, message);
        } else {
          this.queue.fail(job.id, message, retryable);
        }

        this.logger.error({ jobId: job.id, url: job.url, code, error: message }, 'Crawl failed');
      }
    }
  }

  private async processJob(job: CrawlJob): Promise<void> {
    const log = this.logger.child({ correlationId: job.correlationId, jobId: job.id, url: job.url });
    const userAgent = this.browser.pickUserAgent();

    await this.rateLimiter.waitForSlot(job.domain);
    await checkRobotsAllowed(job.url, userAgent, this.config.scope.respectRobotsTxt, log);

    const hints = this.immuneMemory.getInteractionHints(job.domain);
    const rendered = await this.browser.renderPage(job.url, userAgent, hints);
    this.rateLimiter.recordCrawl(job.domain, rendered.responseMs);

    if (rendered.antiBotSignatures.length > 0) {
      log.warn({ signatures: rendered.antiBotSignatures }, 'Anti-bot signatures detected');
    }

    const segments = buildSegments(rendered.visibleTextBlocks, this.config.piiScrubMode);
    const distilled = distillSignal(segments);
    const entities = extractEntities(distilled.body);
    const clusters = clusterKeywords(distilled.keywords, distilled.body);
    const previousFingerprint = this.immuneMemory.get(job.domain);
    const fingerprint = this.immuneMemory.update(job.domain, rendered, previousFingerprint);
    const freshnessScore = this.freshness.record(job.urlHash, distilled.body);
    const confidence = computeConfidence(segments, rendered.antiBotSignatures.length, distilled.body.length);

    const result: CrawlResult = {
      jobId: job.id,
      url: job.url,
      canonicalUrl: rendered.finalUrl,
      title: rendered.title,
      description: distilled.snippet,
      correlationId: job.correlationId,
      crawledAt: new Date().toISOString(),
      confidence,
      freshnessScore,
      segments,
      keywords: distilled.keywords,
      entities,
      clusters,
      links: rendered.links,
      fingerprint,
      screenshotPath: rendered.screenshotPath,
      rawTextLength: segments.reduce((sum: number, s) => sum + s.text.length, 0),
      cleanedTextLength: distilled.body.length,
    };

    this.searchIndex.index(result);
    this.discoverLinks(job, rendered.links, rendered.finalUrl);

    log.info(
      {
        title: result.title,
        keywords: result.keywords.slice(0, 5),
        entities: entities.slice(0, 3).map((e) => e.text),
        linksFound: result.links.length,
        confidence,
        spa: rendered.jsIntel.isSpa,
        stack: rendered.stack.language,
        frameworks: rendered.stack.frameworks.slice(0, 5),
        renderMode: rendered.renderMode,
        cssSheets: rendered.cssIntel.stylesheetUrls.length,
        jsScripts: rendered.jsIntel.scriptUrls.length,
        pseudoTexts: rendered.cssIntel.pseudoTexts.length,
        jsonLd: rendered.jsIntel.jsonLdBlocks.length,
      },
      'Page indexed',
    );
  }

  private discoverLinks(job: CrawlJob, links: string[], baseUrl: string): void {
    for (const href of links) {
      const resolved = resolveLink(baseUrl, href);
      if (!resolved) continue;

      try {
        validateSeedUrl(resolved, {
          blockedHosts: this.config.blockedHosts,
          allowedDomains: this.config.scope.allowedDomains,
          excludePatterns: this.config.scope.excludePatterns,
        });
      } catch {
        continue;
      }

      if (!isInScope(resolved, job.rootDomain, this.config.scope, job.depth + 1, this.missionMode)) continue;

      this.queue.enqueue(resolved, {
        depth: job.depth + 1,
        priority: job.priority - 1,
        signalScore: job.signalScore,
        correlationId: job.correlationId,
        rootDomain: job.rootDomain,
      });
    }
  }

  search(query: string, limit = 20): SearchHit[] {
    return this.searchIndex.search(query, limit);
  }

  searchMission(query: string, parsed: ParsedQuery, limit = 20): SearchHit[] {
    return this.searchIndex.searchMission(query, parsed, limit);
  }

  collectEntities(hits: SearchHit[]): ExtractedEntity[] {
    const all: ExtractedEntity[] = [];
    const seen = new Set<string>();

    for (const hit of hits) {
      const fromBody = extractEntities(hit.document.body);
      for (const entity of fromBody) {
        const key = `${entity.type}:${entity.text.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(entity);
      }
    }

    return all;
  }

  getStats() {
    return this.queue.getStats();
  }

  async processOne(): Promise<boolean> {
    const job = this.queue.claimNext();
    if (!job) return false;

    try {
      await this.processJob(job);
      this.queue.complete(job.id);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const retryable = error instanceof GhostChainError ? error.retryable : false;
      const code = error instanceof GhostChainError ? error.code : 'UNKNOWN';

      if (code === 'ROBOTS_BLOCKED') {
        this.queue.block(job.id, message);
      } else {
        this.queue.fail(job.id, message, retryable);
      }

      this.logger.warn({ jobId: job.id, url: job.url, code, error: message }, 'Crawl job failed');
      return false;
    }
  }
}

function computeConfidence(
  segments: { isBoilerplate: boolean; entropy: number }[],
  antiBotCount: number,
  bodyLength: number,
): number {
  const signalSegments = segments.filter((s) => !s.isBoilerplate);
  const avgEntropy = signalSegments.reduce((sum, s) => sum + s.entropy, 0) / Math.max(signalSegments.length, 1);
  let score = Math.min(1, avgEntropy / 5) * 0.4 + Math.min(1, bodyLength / 5000) * 0.4 + 0.2;
  score -= antiBotCount * 0.1;
  return Math.max(0.1, Math.min(1, score));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
