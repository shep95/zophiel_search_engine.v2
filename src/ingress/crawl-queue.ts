import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AppConfig } from '../config/index.js';
import type { CrawlJob, CrawlStats, CrawlStatus } from '../core/types.js';
import { extractDomain, hashUrl, normalizeUrl } from '../ingress/url-validator.js';

export interface EnqueueOptions {
  depth?: number;
  priority?: number;
  signalScore?: number;
  correlationId?: string;
  scheduledAt?: Date;
  rootDomain?: string;
}

export class CrawlQueue {
  private readonly insertStmt;
  private readonly claimStmt;
  private readonly completeStmt;
  private readonly failStmt;
  private readonly statsStmt;

  constructor(
    private readonly db: Database.Database,
    private readonly config: AppConfig,
  ) {
    this.insertStmt = db.prepare(`
      INSERT INTO crawl_queue (
        id, url, url_hash, domain, root_domain, depth, priority, status, attempts,
        signal_score, correlation_id, created_at, updated_at, scheduled_at
      ) VALUES (
        @id, @url, @urlHash, @domain, @rootDomain, @depth, @priority, 'pending', 0,
        @signalScore, @correlationId, @createdAt, @updatedAt, @scheduledAt
      )
      ON CONFLICT(url_hash) DO UPDATE SET
        priority = MAX(crawl_queue.priority, excluded.priority),
        signal_score = MAX(crawl_queue.signal_score, excluded.signal_score),
        updated_at = excluded.updated_at
      WHERE crawl_queue.status IN ('pending', 'failed')
    `);

    this.claimStmt = db.prepare(`
      UPDATE crawl_queue
      SET status = 'processing', updated_at = @now, attempts = attempts + 1
      WHERE id = (
        SELECT id FROM crawl_queue
        WHERE status = 'pending' AND scheduled_at <= @now
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT 1
      )
      RETURNING *
    `);

    this.completeStmt = db.prepare(`
      UPDATE crawl_queue SET status = 'completed', updated_at = @now WHERE id = @id
    `);

    this.failStmt = db.prepare(`
      UPDATE crawl_queue
      SET status = @status, updated_at = @now, last_error = @error, scheduled_at = @scheduledAt
      WHERE id = @id
    `);

    this.statsStmt = db.prepare(`
      SELECT status, COUNT(*) as count FROM crawl_queue GROUP BY status
    `);
  }

  enqueue(url: string, options: EnqueueOptions = {}): CrawlJob | null {
    const normalized = normalizeUrl(url);
    const urlHash = hashUrl(normalized);
    const domain = extractDomain(normalized);
    const now = new Date().toISOString();
    const job: CrawlJob = {
      id: randomUUID(),
      url: normalized,
      urlHash,
      domain,
      rootDomain: options.rootDomain ?? domain,
      depth: options.depth ?? 0,
      priority: options.priority ?? 0,
      status: 'pending',
      attempts: 0,
      signalScore: options.signalScore ?? 0,
      correlationId: options.correlationId ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
      scheduledAt: (options.scheduledAt ?? new Date()).toISOString(),
    };

    const result = this.insertStmt.run({
      id: job.id,
      url: job.url,
      urlHash: job.urlHash,
      domain: job.domain,
      rootDomain: job.rootDomain,
      depth: job.depth,
      priority: job.priority,
      signalScore: job.signalScore,
      correlationId: job.correlationId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      scheduledAt: job.scheduledAt,
    });

    if (result.changes === 0) return null;
    return job;
  }

  claimNext(): CrawlJob | null {
    const now = new Date().toISOString();
    const row = this.claimStmt.get({ now }) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  complete(jobId: string): void {
    this.completeStmt.run({ id: jobId, now: new Date().toISOString() });
  }

  fail(jobId: string, error: string, retryable: boolean): void {
    const job = this.db.prepare('SELECT attempts FROM crawl_queue WHERE id = ?').get(jobId) as
      | { attempts: number }
      | undefined;
    const attempts = job?.attempts ?? 1;
    const maxAttempts = this.config.retryMaxAttempts;
    const shouldRetry = retryable && attempts < maxAttempts;
    const backoffMs = this.config.retryBaseDelayMs * 2 ** (attempts - 1);
    const scheduledAt = shouldRetry
      ? new Date(Date.now() + backoffMs).toISOString()
      : new Date().toISOString();

    this.failStmt.run({
      id: jobId,
      status: shouldRetry ? 'pending' : 'failed',
      error,
      scheduledAt,
      now: new Date().toISOString(),
    });
  }

  block(jobId: string, reason: string): void {
    this.failStmt.run({
      id: jobId,
      status: 'blocked',
      error: reason,
      scheduledAt: new Date().toISOString(),
      now: new Date().toISOString(),
    });
  }

  getStats(): CrawlStats {
    const rows = this.statsStmt.all() as Array<{ status: CrawlStatus; count: number }>;
    const stats: CrawlStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
      totalIndexed: 0,
    };

    for (const row of rows) {
      stats[row.status] = row.count;
    }

    const indexed = this.db.prepare('SELECT COUNT(*) as count FROM crawl_results').get() as { count: number };
    stats.totalIndexed = indexed.count;
    return stats;
  }

  countPending(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM crawl_queue WHERE status = 'pending'").get() as {
      count: number;
    };
    return row.count;
  }

  hasReachedMaxPages(maxOverride?: number): boolean {
    const limit = maxOverride ?? this.config.scope.maxPages;
    const row = this.db.prepare("SELECT COUNT(*) as count FROM crawl_queue WHERE status = 'completed'").get() as {
      count: number;
    };
    return row.count >= limit;
  }
}

function mapRow(row: Record<string, unknown>): CrawlJob {
  return {
    id: row.id as string,
    url: row.url as string,
    urlHash: row.url_hash as string,
    domain: row.domain as string,
    rootDomain: (row.root_domain as string) || (row.domain as string),
    depth: row.depth as number,
    priority: row.priority as number,
    status: row.status as CrawlStatus,
    attempts: row.attempts as number,
    signalScore: row.signal_score as number,
    correlationId: row.correlation_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    scheduledAt: row.scheduled_at as string,
    lastError: row.last_error as string | undefined,
  };
}
