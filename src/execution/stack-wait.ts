import type { Page } from 'playwright';
import type { RenderProfile } from './stack-detector.js';

export async function waitForStackHydration(page: Page, profile: RenderProfile): Promise<void> {
  if (profile.mode === 'server_rendered') {
    await page.waitForLoadState('load', { timeout: profile.spaWaitMs }).catch(() => undefined);
    return;
  }

  if (profile.mode === 'hybrid') {
    await page
      .waitForFunction(
        `(() => {
          if (typeof htmx !== 'undefined' && document.querySelector('.htmx-request')) return false;
          if (typeof Turbo !== 'undefined' && document.querySelector('[aria-busy="true"]')) return false;
          const body = (document.body && document.body.innerText) ? document.body.innerText : '';
          return body.replace(/\\s+/g, ' ').trim().length > 60;
        })()`,
        { timeout: profile.spaWaitMs },
      )
      .catch(() => undefined);
    return;
  }

  if (profile.mode === 'api_docs') {
    await page
      .waitForSelector('.swagger-ui, .redoc-wrap, openapi-explorer, [class*="openapi"]', {
        timeout: profile.spaWaitMs,
      })
      .catch(() => undefined);
    return;
  }

  // spa — handled by waitForSpaContent in spa-wait.ts
}
