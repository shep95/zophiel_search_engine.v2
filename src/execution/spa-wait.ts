import type { Page, Response } from 'playwright';

const SPA_ROOT_SELECTORS = [
  '#root',
  '#app',
  '#__next',
  '#__nuxt',
  '[data-reactroot]',
  'main',
  '[role="main"]',
];

export async function waitForSpaContent(page: Page, timeoutMs: number, quietMs = 2000): Promise<void> {
  await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);

  for (const selector of SPA_ROOT_SELECTORS) {
    await page.waitForSelector(selector, { timeout: Math.min(8000, timeoutMs) }).catch(() => undefined);
  }

  await page
    .waitForFunction(
      `(() => {
        const bodyText = (document.body && document.body.innerText ? document.body.innerText : '').replace(/\\s+/g, ' ').trim();
        return bodyText.length > 80;
      })()`,
      { timeout: Math.min(10000, timeoutMs) },
    )
    .catch(() => undefined);

  await waitForDomStability(page, quietMs);
}

async function waitForDomStability(page: Page, quietMs: number): Promise<void> {
  await page.evaluate(
    `(ms) => new Promise((resolve) => {
      let timer = null;
      const observer = new MutationObserver(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { observer.disconnect(); resolve(); }, ms);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      timer = setTimeout(() => { observer.disconnect(); resolve(); }, ms);
    })`,
    quietMs,
  );
}

export function attachJsonResponseCapture(page: Page): { getCaptured: () => string[]; detach: () => void } {
  const captured: string[] = [];

  const handler = async (response: Response) => {
    try {
      const type = response.headers()['content-type'] ?? '';
      if (!type.includes('json') && !type.includes('javascript')) return;
      const url = response.url();
      if (!/api|graphql|data|search|json/i.test(url)) return;
      const body = await response.text();
      if (body.length > 30 && body.length < 500_000) {
        captured.push(body.slice(0, 8000));
      }
    } catch {
      // response may be aborted
    }
  };

  page.on('response', handler);

  return {
    getCaptured: () => [...captured],
    detach: () => page.off('response', handler),
  };
}
