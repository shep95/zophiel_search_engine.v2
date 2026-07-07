import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import type { InPageExtraction } from './extract.js';

let cachedBundle: string | null = null;

function loadBundle(): string {
  if (cachedBundle) return cachedBundle;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'in-page', 'extract-bundle.js'),
    join(process.cwd(), 'src', 'execution', 'in-page', 'extract-bundle.js'),
  ];
  for (const path of candidates) {
    try {
      cachedBundle = readFileSync(path, 'utf8').trim();
      return cachedBundle;
    } catch {
      continue;
    }
  }
  throw new Error('extract-bundle.js not found');
}

/** Must use string evaluate — passing TS functions through page.evaluate breaks under tsx. */
export async function runInPageExtract(page: Page, includeHiddenContent: boolean): Promise<InPageExtraction> {
  const bundle = loadBundle();
  const hidden = includeHiddenContent ? 'true' : 'false';
  return page.evaluate(`(${bundle})(${hidden})`) as Promise<InPageExtraction>;
}
