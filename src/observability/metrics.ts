import type { Logger } from '../core/logger.js';
import type { StageTimings } from '../core/taxonomy.js';

export interface MissionMetrics {
  correlationId: string;
  missionId: string;
  stages: StageTimings & { discovery: number; synthesis: number };
  pagesCrawled: number;
  pagesFailed: number;
  pagesBlocked: number;
  findingsCount: number;
  antiBotDetections: number;
  startedAt: string;
  completedAt?: string;
}

export class ObservabilityCollector {
  private metrics: Partial<MissionMetrics> = {};
  private stageStarts = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    missionId: string,
    correlationId: string,
  ) {
    this.metrics = {
      missionId,
      correlationId,
      stages: { discovery: 0, ingress: 0, render: 0, distill: 0, learn: 0, index: 0, synthesis: 0 },
      pagesCrawled: 0,
      pagesFailed: 0,
      pagesBlocked: 0,
      findingsCount: 0,
      antiBotDetections: 0,
      startedAt: new Date().toISOString(),
    };
  }

  startStage(stage: string): void {
    this.stageStarts.set(stage, Date.now());
  }

  endStage(stage: keyof MissionMetrics['stages']): void {
    const start = this.stageStarts.get(stage);
    if (start && this.metrics.stages) {
      this.metrics.stages[stage] = Date.now() - start;
    }
  }

  recordCrawl(success: boolean, blocked = false): void {
    if (blocked) this.metrics.pagesBlocked = (this.metrics.pagesBlocked ?? 0) + 1;
    else if (success) this.metrics.pagesCrawled = (this.metrics.pagesCrawled ?? 0) + 1;
    else this.metrics.pagesFailed = (this.metrics.pagesFailed ?? 0) + 1;
  }

  recordAntiBot(): void {
    this.metrics.antiBotDetections = (this.metrics.antiBotDetections ?? 0) + 1;
  }

  finalize(findingsCount: number): MissionMetrics {
    this.metrics.findingsCount = findingsCount;
    this.metrics.completedAt = new Date().toISOString();
    const m = this.metrics as MissionMetrics;
    this.logger.info({ metrics: m }, 'Mission metrics');
    return m;
  }
}
