import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { StructuralFingerprint, InteractionHint } from '../core/types.js';
import type { RenderedPage } from '../execution/browser-sandbox.js';

export class ImmuneMemory {
  private readonly selectStmt;
  private readonly upsertStmt;

  constructor(db: Database.Database) {
    this.selectStmt = db.prepare('SELECT fingerprint_json, version FROM immune_memory WHERE domain = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO immune_memory (domain, fingerprint_json, version, updated_at)
      VALUES (@domain, @fingerprintJson, @version, @updatedAt)
      ON CONFLICT(domain) DO UPDATE SET
        fingerprint_json = excluded.fingerprint_json,
        version = immune_memory.version + 1,
        updated_at = excluded.updated_at
    `);
  }

  get(domain: string): StructuralFingerprint | null {
    const row = this.selectStmt.get(domain) as { fingerprint_json: string } | undefined;
    return row ? (JSON.parse(row.fingerprint_json) as StructuralFingerprint) : null;
  }

  getInteractionHints(domain: string): string[] {
    const fingerprint = this.get(domain);
    if (!fingerprint) return [];
    return fingerprint.interactionHints
      .filter((h) => h.successRate > 0.3)
      .sort((a, b) => b.successRate - a.successRate)
      .map((h) => h.selector);
  }

  update(domain: string, rendered: RenderedPage, previous: StructuralFingerprint | null): StructuralFingerprint {
    const interactionHints = this.mergeInteractionHints(previous?.interactionHints ?? [], rendered.domPatterns);
    const fingerprint: StructuralFingerprint = {
      domain,
      version: (previous?.version ?? 0) + 1,
      domPatterns: rendered.domPatterns,
      cssClasses: rendered.cssClasses,
      jsLibraries: rendered.jsLibraries,
      backendStacks: rendered.stack.frameworks,
      primaryLanguage: rendered.stack.language,
      renderMode: rendered.renderMode,
      antiBotSignatures: rendered.antiBotSignatures,
      interactionHints,
      updatedAt: new Date().toISOString(),
    };

    this.upsertStmt.run({
      domain,
      fingerprintJson: JSON.stringify(fingerprint),
      version: fingerprint.version,
      updatedAt: fingerprint.updatedAt,
    });

    return fingerprint;
  }

  private mergeInteractionHints(existing: InteractionHint[], domPatterns: string[]): InteractionHint[] {
    const map = new Map(existing.map((h) => [h.selector, h]));

    for (const pattern of domPatterns) {
      if (!pattern.startsWith('.') && !pattern.startsWith('[')) continue;
      const current = map.get(pattern);
      map.set(pattern, {
        selector: pattern,
        action: 'click',
        successRate: current ? Math.min(1, current.successRate + 0.1) : 0.5,
      });
    }

    return Array.from(map.values()).slice(0, 20);
  }
}

export class FreshnessTracker {
  private readonly insertStmt;
  private readonly latestStmt;

  constructor(db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO content_snapshots (url_hash, snapshot_at, content_hash)
      VALUES (@urlHash, @snapshotAt, @contentHash)
    `);
    this.latestStmt = db.prepare(`
      SELECT content_hash FROM content_snapshots
      WHERE url_hash = ?
      ORDER BY snapshot_at DESC
      LIMIT 2
    `);
  }

  record(urlHash: string, content: string): number {
    const contentHash = createHash('sha256').update(content).digest('hex');
    this.insertStmt.run({
      urlHash,
      snapshotAt: new Date().toISOString(),
      contentHash,
    });

    const rows = this.latestStmt.all(urlHash) as Array<{ content_hash: string }>;
    if (rows.length < 2) return 0.5;
    return rows[0]!.content_hash !== rows[1]!.content_hash ? 1 : 0.2;
  }
}
