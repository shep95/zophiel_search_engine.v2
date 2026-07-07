import type Database from 'better-sqlite3';
import type { AppConfig } from '../config/index.js';
import type { Logger } from '../core/logger.js';

export class DomainRateLimiter {
  private readonly selectStmt;
  private readonly upsertStmt;

  constructor(
    db: Database.Database,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.selectStmt = db.prepare('SELECT * FROM domain_rate_limits WHERE domain = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO domain_rate_limits (domain, last_crawled_at, avg_response_ms, requests_per_second)
      VALUES (@domain, @lastCrawledAt, @avgResponseMs, @requestsPerSecond)
      ON CONFLICT(domain) DO UPDATE SET
        last_crawled_at = excluded.last_crawled_at,
        avg_response_ms = (domain_rate_limits.avg_response_ms * 0.7) + (excluded.avg_response_ms * 0.3),
        requests_per_second = MIN(2, MAX(0.25, 1000.0 / excluded.avg_response_ms))
    `);
  }

  async waitForSlot(domain: string): Promise<void> {
    const row = this.selectStmt.get(domain) as
      | { last_crawled_at: string; requests_per_second: number }
      | undefined;

    const rps = row?.requests_per_second ?? this.config.defaultRateLimitPerDomain;
    const minIntervalMs = 1000 / rps;

    if (row) {
      const elapsed = Date.now() - new Date(row.last_crawled_at).getTime();
      const waitMs = minIntervalMs - elapsed;
      if (waitMs > 0) {
        this.logger.debug({ domain, waitMs }, 'Rate limiting crawl');
        await sleep(waitMs);
      }
    }
  }

  recordCrawl(domain: string, responseMs: number): void {
    this.upsertStmt.run({
      domain,
      lastCrawledAt: new Date().toISOString(),
      avgResponseMs: responseMs,
      requestsPerSecond: Math.min(2, 1000 / Math.max(responseMs, 250)),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
