import type { InPageCssIntel } from './in-page/extract.js';

export interface CssScrapeResult extends InPageCssIntel {
  fetchedStylesheets: Array<{ url: string; bytes: number; preview: string }>;
}

export async function enrichStylesheets(
  pageUrl: string,
  intel: InPageCssIntel,
  fetchStyles: boolean,
): Promise<CssScrapeResult> {
  const fetchedStylesheets: Array<{ url: string; bytes: number; preview: string }> = [];

  if (fetchStyles) {
    for (const url of intel.stylesheetUrls.slice(0, 8)) {
      try {
        const response = await fetch(url, {
          headers: { Referer: pageUrl },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) continue;
        const text = await response.text();
        fetchedStylesheets.push({
          url,
          bytes: text.length,
          preview: text.slice(0, 2000),
        });
      } catch {
        // CORS or network — computed styles still available from browser
      }
    }
  }

  return { ...intel, fetchedStylesheets };
}

export function cssIntelToText(intel: CssScrapeResult): string[] {
  const lines: string[] = [];
  for (const t of intel.pseudoTexts) lines.push(t);
  for (const sheet of intel.fetchedStylesheets) {
    const contentRules = sheet.preview.match(/content\s*:\s*["'][^"']{2,}["']/gi) ?? [];
    for (const rule of contentRules) {
      const m = rule.match(/["']([^"']+)["']/);
      if (m?.[1] && m[1].length > 2) lines.push(m[1]);
    }
  }
  return lines;
}
