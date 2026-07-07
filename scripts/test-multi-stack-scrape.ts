import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import { GhostChainCrawler } from '../src/crawler.js';
import type { RenderedPage } from '../src/execution/browser-sandbox.js';

const TARGETS = [
  { label: 'Django (Python SSR)', url: 'https://www.djangoproject.com/' },
  { label: 'FastAPI docs (Python API)', url: 'https://fastapi.tiangolo.com/' },
  { label: 'Flask docs (Python SSR)', url: 'https://flask.palletsprojects.com/en/latest/' },
  { label: 'Rails (Ruby hybrid)', url: 'https://rubyonrails.org/' },
  { label: 'HTMX (hybrid)', url: 'https://htmx.org/' },
  { label: 'WordPress (PHP SSR)', url: 'https://wordpress.org/' },
];

async function main() {
  const config = loadConfig();
  const crawler = new GhostChainCrawler(config, createLogger(config));
  await crawler.init();

  const browser = (crawler as unknown as {
    browser: {
      renderPage: (u: string, ua: string) => Promise<RenderedPage>;
      pickUserAgent: () => string;
    };
  }).browser;

  console.log('\n=== Multi-stack scrape test ===\n');

  for (const target of TARGETS) {
    try {
      const r = await browser.renderPage(target.url, browser.pickUserAgent());
      console.log(`--- ${target.label} ---`);
      console.log(`  URL: ${r.finalUrl}`);
      console.log(`  Language: ${r.stack.language} (${Math.round(r.stack.confidence * 100)}% conf)`);
      console.log(`  Frameworks: ${r.stack.frameworks.join(', ') || 'none'}`);
      console.log(`  Render mode: ${r.renderMode}`);
      console.log(`  Signals: ${r.stack.signals.slice(0, 4).join(', ')}`);
      console.log(`  Text blocks: ${r.visibleTextBlocks.length}`);
      console.log(`  Libraries: ${r.jsLibraries.slice(0, 6).join(', ') || 'none'}`);
      console.log(`  Sample text: ${r.visibleTextBlocks[0]?.text.slice(0, 80) ?? 'n/a'}...`);
      console.log('');
    } catch (err) {
      console.log(`--- ${target.label} --- FAILED`);
      console.log(`  ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  await crawler.close();
}

main().catch(console.error);
