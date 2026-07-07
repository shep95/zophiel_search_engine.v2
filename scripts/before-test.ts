import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import { GhostChainCrawler } from '../src/crawler.js';
import { parseQuery } from '../src/discovery/query-parser.js';
import { MissionOrchestrator } from '../src/mission/mission-orchestrator.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const QUERY = 'asher shepherd newton who lives in cape coral florida';
const OUT = join(process.cwd(), 'data', 'before-test.json');

async function run() {
  const config = loadConfig({
    scope: { maxDepth: 1, maxPages: 15, respectRobotsTxt: true, excludePatterns: [], includeHiddenContent: false, whitelistedFormActions: [] },
    piiScrubMode: 'sensitive_only',
    concurrency: 2,
    dbPath: './data/before-ghost-chain.db',
  });

  mkdirSync('./data', { recursive: true });
  const logger = createLogger(config);
  const crawler = new GhostChainCrawler(config, logger);
  const orchestrator = new MissionOrchestrator(crawler, config, logger);

  const { mission, report } = await orchestrator.run(QUERY, { maxDiscoveries: 8, maxCrawlPages: 10 });
  const result = {
    query: QUERY,
    phase: mission.phase,
    discovered: mission.discoveredUrls.map((d) => d.url),
    summary: report.summary,
    findings: report.findings.map((f) => ({ category: f.category, claim: f.claim, source: f.sourceUrl, confidence: f.confidence })),
    sources: report.sources,
  };

  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await crawler.close();
}

run().catch(console.error);
