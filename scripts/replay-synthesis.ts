import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import { GhostChainCrawler } from '../src/crawler.js';
import { parseQuery } from '../src/discovery/query-parser.js';
import { synthesizeReport } from '../src/synthesis/intelligence-report.js';

const query = 'asher shepherd newton cape coral florida';
const config = loadConfig();
const crawler = new GhostChainCrawler(config, createLogger(config));
const parsed = parseQuery(query);

const hits = crawler.searchMission(query, parsed, 25);
const entities = crawler.collectEntities(hits);
const report = synthesizeReport('replay', parsed, hits, entities);

console.log('--- SUMMARY ---');
console.log(report.summary);
console.log('\n--- FINDINGS ---');
for (const f of report.findings) {
  console.log(`\n[${f.category}] (${(f.confidence * 100).toFixed(0)}%) ${f.claim}`);
  console.log(`  Source: ${f.sourceUrl}`);
}
console.log('\n--- TOP HITS ---');
for (const h of hits.slice(0, 5)) {
  console.log(`\n[${h.score.toFixed(2)}] ${h.document.title}`);
  console.log(`  ${h.document.url}`);
  console.log(`  ${h.document.snippet}`);
}

await crawler.close();
