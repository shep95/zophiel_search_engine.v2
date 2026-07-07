import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import { GhostChainCrawler } from '../src/crawler.js';

const url = 'https://bisprofiles.com/fl/zorakcorp-l25000235369';

const c = new GhostChainCrawler(loadConfig(), createLogger(loadConfig()));
await c.init();
const b = (c as unknown as { browser: { renderPage: (u: string, ua: string) => Promise<{
  stack: { language: string; frameworks: string[] };
  renderMode: string;
  title: string;
  visibleTextBlocks: Array<{ text: string; selector: string; prominence: number }>;
  jsIntel: { isSpa: boolean; jsonLdBlocks: string[]; apiJsonSnippets: string[] };
}>; pickUserAgent: () => string } }).browser;

const r = await b.renderPage(url, b.pickUserAgent());
console.log('Stack:', r.stack.language, r.stack.frameworks.join(','), r.renderMode);
console.log('Title:', r.title);
console.log('Blocks:', r.visibleTextBlocks.length, 'SPA:', r.jsIntel.isSpa);
console.log('\n--- ALL TEXT BLOCKS ---');
for (const block of r.visibleTextBlocks) {
  console.log(`[${block.prominence.toFixed(2)}] ${block.text.replace(/\s+/g, ' ').slice(0, 200)}`);
}
if (r.jsIntel.jsonLdBlocks.length) console.log('\nJSON-LD:', r.jsIntel.jsonLdBlocks.slice(0, 2));
if (r.jsIntel.apiJsonSnippets.length) console.log('\nAPI JSON:', r.jsIntel.apiJsonSnippets.slice(0, 2));
await c.close();
