import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppConfig } from '../config/index.js';

export function createDatabase(config: AppConfig): Database.Database {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_queue (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      url_hash TEXT NOT NULL UNIQUE,
      domain TEXT NOT NULL,
      root_domain TEXT NOT NULL DEFAULT '',
      depth INTEGER NOT NULL DEFAULT 0,
      priority REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      signal_score REAL NOT NULL DEFAULT 0,
      correlation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status_scheduled ON crawl_queue(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_queue_domain ON crawl_queue(domain);

    CREATE TABLE IF NOT EXISTS crawl_results (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      canonical_url TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      correlation_id TEXT NOT NULL,
      crawled_at TEXT NOT NULL,
      confidence REAL NOT NULL,
      freshness_score REAL NOT NULL DEFAULT 0,
      keywords_json TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      clusters_json TEXT NOT NULL,
      links_json TEXT NOT NULL,
      fingerprint_json TEXT NOT NULL,
      body TEXT NOT NULL,
      snippet TEXT NOT NULL,
      raw_text_length INTEGER NOT NULL,
      cleaned_text_length INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_results_crawled_at ON crawl_results(crawled_at);

    CREATE TABLE IF NOT EXISTS search_fts (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      keywords TEXT NOT NULL,
      entities TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      url UNINDEXED,
      title,
      body,
      keywords,
      entities,
      tokenize = 'porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS immune_memory (
      domain TEXT PRIMARY KEY,
      fingerprint_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_snapshots (
      url_hash TEXT NOT NULL,
      snapshot_at TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      PRIMARY KEY (url_hash, snapshot_at)
    );

    CREATE TABLE IF NOT EXISTS domain_rate_limits (
      domain TEXT PRIMARY KEY,
      last_crawled_at TEXT NOT NULL,
      avg_response_ms REAL NOT NULL DEFAULT 1000,
      requests_per_second REAL NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS intelligence_missions (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      phase TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      report_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  try {
    db.exec(`ALTER TABLE crawl_queue ADD COLUMN root_domain TEXT NOT NULL DEFAULT ''`);
  } catch {
    // column already exists
  }

  db.exec(`
    UPDATE crawl_queue SET root_domain = domain WHERE root_domain = '' OR root_domain IS NULL
  `);
}
