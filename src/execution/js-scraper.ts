import type { InPageJsIntel } from './in-page/extract.js';

export interface JsScrapeResult extends InPageJsIntel {
  apiJsonSnippets: string[];
}

export function mergeJsIntel(intel: InPageJsIntel, apiJsonSnippets: string[]): JsScrapeResult {
  return { ...intel, apiJsonSnippets: apiJsonSnippets.slice(0, 20) };
}

export function jsIntelToText(intel: JsScrapeResult): string[] {
  const lines: string[] = [];

  for (const block of intel.jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block) as Record<string, unknown>;
      lines.push(...flattenJsonToStrings(parsed));
    } catch {
      if (block.length > 20) lines.push(block.slice(0, 500));
    }
  }

  for (const payload of intel.embeddedPayloads) {
    try {
      const parsed = JSON.parse(payload.preview) as Record<string, unknown>;
      lines.push(...flattenJsonToStrings(parsed));
    } catch {
      if (payload.preview.length > 30) lines.push(payload.preview.slice(0, 400));
    }
  }

  for (const snippet of intel.apiJsonSnippets) {
    try {
      const parsed = JSON.parse(snippet) as Record<string, unknown>;
      lines.push(...flattenJsonToStrings(parsed));
    } catch {
      if (snippet.length > 30) lines.push(snippet.slice(0, 400));
    }
  }

  return [...new Set(lines)].filter((l) => l.length >= 3).slice(0, 100);
}

function flattenJsonToStrings(obj: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  const out: string[] = [];

  if (typeof obj === 'string' && obj.length >= 3 && obj.length < 500) {
    out.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 30)) out.push(...flattenJsonToStrings(item, depth + 1));
  } else if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>).slice(0, 40)) {
      if (/name|title|description|text|address|email|url|content|headline/i.test(key)) {
        out.push(...flattenJsonToStrings(val, depth + 1));
      }
    }
  }

  return out;
}
