import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import { GhostChainCrawler } from '../src/crawler.js';

async function main() {
  const config = loadConfig();
  const crawler = new GhostChainCrawler(config, createLogger(config));
  await crawler.init();

  const browser = (crawler as unknown as { browser: { renderPage: (u: string, ua: string) => Promise<{
    visibleTextBlocks: unknown[];
    cssIntel: { stylesheetUrls: string[]; pseudoTexts: string[]; hiddenRuleCount: number };
    jsIntel: { isSpa: boolean; scriptUrls: string[]; libraries: string[]; jsonLdBlocks: string[] };
  }>; pickUserAgent: () => string } }).browser;

  const r = await browser.renderPage('https://bisprofiles.com/fl/zorakcorp-l25000235369', browser.pickUserAgent());
  console.log('text blocks:', r.visibleTextBlocks.length);
  console.log('css stylesheets:', r.cssIntel.stylesheetUrls.length);
  console.log('css hidden rules:', r.cssIntel.hiddenRuleCount);
  console.log('css pseudo texts:', r.cssIntel.pseudoTexts.length);
  console.log('js spa:', r.jsIntel.isSpa);
  console.log('js scripts:', r.jsIntel.scriptUrls.length);
  console.log('js libraries:', r.jsIntel.libraries.join(', ') || 'none');

  await crawler.close();
}

main().catch(console.error);
