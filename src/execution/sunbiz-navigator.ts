import type { Page } from 'playwright';

const SUNBIZ_HOME = 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByOfficerOrRegisteredAgent';

export async function warmSunbizSession(page: Page): Promise<void> {
  await page.goto(SUNBIZ_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  const searchInput = page.locator('input[name="SearchTerm"], input[name="searchTerm"], #SearchTerm');
  if (await searchInput.count()) {
    await searchInput.first().fill('Newton Asher S');
    const submit = page.locator('input[type="submit"], button[type="submit"]').first();
    if (await submit.count()) {
      await submit.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(2000);
    }
  }
}

export async function waitForBizapediaChallenge(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const html = await page.content();
    const lower = html.toLowerCase();
    const gated =
      lower.includes('uiabshield') ||
      lower.includes('gate a tech') ||
      lower.includes('turnstile') ||
      lower.includes('cf-turnstile') ||
      (lower.includes('captcha') && html.length < 8000);

    if (!gated) {
      const bodyLen = (await page.evaluate('document.body?.innerText?.length ?? 0')) as number;
      if (bodyLen > 300) return;
    }

    await page.waitForTimeout(1500);
  }
}
