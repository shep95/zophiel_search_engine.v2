import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IntelligenceReport } from '../core/taxonomy.js';
import type { MissionMetrics } from '../observability/metrics.js';

export class DurableOutputQueue {
  constructor(private readonly dataDir: string) {
    mkdirSync(join(dataDir, 'reports'), { recursive: true });
    mkdirSync(join(dataDir, 'queue'), { recursive: true });
  }

  deliver(report: IntelligenceReport, metrics: MissionMetrics): string {
    const envelope = {
      version: '2.0',
      deliveredAt: new Date().toISOString(),
      report,
      metrics,
      guarantee: 'at-least-once',
    };

    const reportPath = join(this.dataDir, 'reports', `${report.missionId}.json`);
    const queuePath = join(this.dataDir, 'queue', 'intelligence.jsonl');

    writeFileSync(reportPath, JSON.stringify(envelope, null, 2), 'utf-8');
    appendFileSync(queuePath, `${JSON.stringify(envelope)}\n`, 'utf-8');

    return reportPath;
  }

  listReports(): string[] {
    const dir = join(this.dataDir, 'reports');
    if (!existsSync(dir)) return [];
    return [];
  }
}
