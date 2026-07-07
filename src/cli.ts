#!/usr/bin/env node
import { loadConfig } from './config/index.js';
import { GhostChainCrawler } from './crawler.js';
import { createLogger } from './core/logger.js';
import { startApiServer } from './api/server.js';
import { MissionOrchestrator } from './mission/mission-orchestrator.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';
  const config = loadConfig();
  const logger = createLogger(config);
  const crawler = new GhostChainCrawler(config, logger);

  const shutdown = async () => {
    logger.info('Shutting down...');
    await crawler.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  switch (command) {
    case 'seed': {
      const urls = args.slice(1);
      if (urls.length === 0) {
        console.error('Usage: npm run seed -- <url1> [url2...]');
        process.exit(1);
      }
      const accepted = crawler.seed(urls);
      console.log(`Enqueued ${accepted.length} seed URL(s):`);
      accepted.forEach((u) => console.log(`  - ${u}`));
      await crawler.close();
      break;
    }

    case 'crawl': {
      const urls = args.slice(1);
      if (urls.length > 0) crawler.seed(urls);
      logger.info('Starting Ghost Chain crawler workers...');
      await crawler.runWorkerLoop();
      break;
    }

    case 'search': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.error('Usage: npm run search -- <query>');
        process.exit(1);
      }
      const hits = crawler.search(query);
      if (hits.length === 0) {
        console.log('No results found.');
      } else {
        for (const hit of hits) {
          console.log(`\n[${hit.score.toFixed(2)}] ${hit.document.title}`);
          console.log(`  ${hit.document.url}`);
          console.log(`  ${hit.document.snippet}`);
        }
      }
      await crawler.close();
      break;
    }

    case 'investigate': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.error('Usage: npm run investigate -- <query>');
        process.exit(1);
      }

      const missionConfig = loadConfig({
        scope: {
          maxDepth: 1,
          maxPages: 15,
          respectRobotsTxt: true,
          excludePatterns: [],
          includeHiddenContent: false,
          whitelistedFormActions: [],
        },
        piiScrubMode: 'sensitive_only',
        concurrency: 2,
        bypassEnabled: true,
        bypassMaxAttempts: 5,
        robotsOverrideDomains: ['linkedin.com', 'www.linkedin.com'],
        missionForceRefreshDomains: ['bisprofiles.com', 'www.bisprofiles.com', 'search.sunbiz.org'],
      });
      const missionLogger = createLogger(missionConfig);
      const missionCrawler = new GhostChainCrawler(missionConfig, missionLogger);
      const orchestrator = new MissionOrchestrator(missionCrawler, missionConfig, missionLogger);

      console.log(`\nGhost Chain Intelligence Mission`);
      console.log(`Query: "${query}"\n`);

      try {
        const { mission, report, reportPath } = await orchestrator.run(query, {
          maxDiscoveries: 15,
          maxCrawlPages: 15,
          crawlDepth: 1,
        });

        console.log(`Phase: ${mission.phase}`);
        console.log(`Discovered: ${mission.discoveredUrls.length} targets`);
        if (report.resolvedIdentity) {
          console.log(`Resolved Identity: ${report.resolvedIdentity.canonicalName}`);
          console.log(`Aliases: ${report.resolvedIdentity.aliases.slice(0, 5).join(', ')}`);
        }
        console.log(`\n--- SUMMARY ---\n${report.summary}\n`);

        if (report.findings.length > 0) {
          console.log('--- FINDINGS ---');
          for (const finding of report.findings.slice(0, 20)) {
            console.log(`\n[${finding.category}] (${(finding.confidence * 100).toFixed(0)}%) ${finding.claim}`);
            console.log(`  Source: ${finding.sourceUrl}`);
            console.log(`  Evidence: ${finding.evidence}`);
          }
        } else {
          console.log('No structured findings extracted.');
        }

        if (report.sources.length > 0) {
          console.log('\n--- SOURCES ---');
          for (const src of report.sources) {
            console.log(`  - ${src.title}: ${src.url}`);
          }
        }
        console.log(`\nReport saved: ${reportPath}`);
      } finally {
        await missionCrawler.close();
      }
      break;
    }

    case 'serve': {
      await crawler.init();
      await startApiServer(crawler);
      await crawler.runWorkerLoop();
      break;
    }

    default:
      console.log(`
Ghost Chain Search Engine

Commands:
  seed <urls...>     Enqueue seed URLs into the crawl queue
  crawl [urls...]    Run crawler workers (optionally seed first)
  search <query>     Search indexed content
  investigate <query>  Run full discovery → crawl → intelligence report
  serve              Start API server + crawler workers

Examples:
  npm run seed -- https://example.com
  npm run crawl
  npm run search -- "machine learning"
  npm run dev -- serve
`);
      await crawler.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
