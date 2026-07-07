import { loadConfig } from './config/index.js';
import { createLogger } from './core/logger.js';
import { GhostChainCrawler } from './crawler.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const crawler = new GhostChainCrawler(config, logger);

  process.on('SIGINT', async () => {
    await crawler.close();
    process.exit(0);
  });

  logger.info({ concurrency: config.concurrency }, 'Ghost Chain worker starting');
  await crawler.runWorkerLoop();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
