import Database from 'better-sqlite3';
import { loadConfig } from '../src/config/index.js';

const db = new Database(loadConfig().dbPath);
const rows = db.prepare('SELECT url, title, body, entities_json FROM crawl_results').all() as Array<{
  url: string;
  title: string;
  body: string;
  entities_json: string;
}>;

for (const row of rows) {
  if (/newton|asher|zorak|bosley|cape/i.test(row.body + row.title + row.url)) {
    console.log('\n===', row.title, '===');
    console.log(row.url);
    console.log('BODY:', row.body.slice(0, 1200));
    console.log('ENTITIES:', row.entities_json);
  }
}
db.close();
