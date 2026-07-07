import { loadConfig } from '../src/config/index.js';
import { GhostChainCrawler } from '../src/crawler.js';
import { createLogger } from '../src/core/logger.js';

async function smokeTest() {
  const config = loadConfig({ scope: { maxDepth: 0, maxPages: 1 } });
  const logger = createLogger(config);
  const crawler = new GhostChainCrawler(config, logger);

  crawler.seed(['https://example.com']);
  await crawler.init();
  await crawler.processOne();

  const hits = crawler.search('example');
  console.log('Search hits:', hits.length);
  if (hits[0]) {
    console.log('Top result:', hits[0].document.title, '-', hits[0].document.url);
  }

  await crawler.close();
}

smokeTest().catch((error) => {
  console.error(error);
  process.exit(1);
});
