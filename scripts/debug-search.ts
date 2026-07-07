import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import { GhostChainCrawler } from '../src/crawler.js';
import { parseQuery } from '../src/discovery/query-parser.js';
import Database from 'better-sqlite3';

const config = loadConfig();
const c = new GhostChainCrawler(config, createLogger(config));
const q = parseQuery('asher shepherd newton cape coral florida');

console.log('mission hits:', c.searchMission('asher shepherd newton cape coral florida', q).length);
console.log('newton:', c.search('newton').length);
console.log('asher:', c.search('asher').length);
console.log('zorakcorp:', c.search('zorakcorp').length);

const db = new Database(config.dbPath);
const rows = db.prepare('SELECT url, title, substr(body,1,300) as body FROM crawl_results').all();
console.log('\nIndexed pages:', rows.length);
for (const row of rows as Array<{ url: string; title: string; body: string }>) {
  if (/newton|asher|zorak|bosley/i.test(row.body + row.title)) {
    console.log('\n---', row.title);
    console.log(row.url);
    console.log(row.body.slice(0, 400));
  }
}

const hits = c.search('zorakcorp');
for (const h of hits) {
  console.log('\nHIT:', h.document.title);
  console.log(h.document.snippet);
  console.log(h.document.entities);
}

await c.close();
db.close();
