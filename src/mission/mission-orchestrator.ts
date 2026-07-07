import { SunbizAdapter, type SunbizEntity } from '../adapters/sunbiz-adapter.js';
import type { AppConfig } from '../config/index.js';
import type { Logger } from '../core/logger.js';
import type { IntelligenceFinding, IntelligenceMission, IntelligenceReport, ParsedQuery } from '../core/taxonomy.js';
import type { GhostChainCrawler } from '../crawler.js';
import { parseQuery } from '../discovery/query-parser.js';
import { SerpDiscovery } from '../discovery/serp-discovery.js';
import { ObservabilityCollector } from '../observability/metrics.js';
import { DurableOutputQueue } from '../output/durable-queue.js';
import { synthesizeReport } from '../synthesis/intelligence-report.js';
import { IdentityResolver } from '../synthesis/identity-resolver.js';
import { randomUUID } from 'node:crypto';

export interface MissionRunOptions {
  maxDiscoveries?: number;
  maxCrawlPages?: number;
  crawlDepth?: number;
}

export interface MissionResult {
  mission: IntelligenceMission;
  report: IntelligenceReport;
  reportPath: string;
}

export class MissionOrchestrator {
  private readonly serpDiscovery: SerpDiscovery;
  private readonly sunbiz: SunbizAdapter;
  private readonly identityResolver: IdentityResolver;
  private readonly outputQueue: DurableOutputQueue;

  constructor(
    private readonly crawler: GhostChainCrawler,
    config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.serpDiscovery = new SerpDiscovery(logger, {
      maxResults: 15,
      blockedHosts: config.blockedHosts,
    });
    this.sunbiz = new SunbizAdapter(logger);
    this.identityResolver = new IdentityResolver();
    this.outputQueue = new DurableOutputQueue(config.dataDir);
  }

  async run(query: string, options: MissionRunOptions = {}): Promise<MissionResult> {
    const parsed = parseQuery(query);
    const mission: IntelligenceMission = {
      id: randomUUID(),
      query,
      parsed,
      phase: 'created',
      correlationId: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      discoveredUrls: [],
      crawledUrls: [],
    };

    const metrics = new ObservabilityCollector(this.logger, mission.id, mission.correlationId);
    const log = this.logger.child({ missionId: mission.id, correlationId: mission.correlationId });

    try {
      // PHASE 1: Discovery (SERP + Sunbiz adapter + curated seeds)
      mission.phase = 'discovering';
      metrics.startStage('discovery');

      const serpTargets = await this.serpDiscovery.discover(parsed);
      const sunbizTargets = await this.sunbiz.discoverFromOfficerSearch(parsed);
      const sunbizUrls = this.sunbiz.buildSearchUrls(parsed).map((url) => ({
        url,
        title: 'Sunbiz Search',
        snippet: parsed.identity.displayName,
        source: 'manual' as const,
        relevanceScore: 0.9,
      }));

      const allTargets = [...sunbizTargets, ...sunbizUrls, ...serpTargets];
      const maxDiscoveries = options.maxDiscoveries ?? 12;
      mission.discoveredUrls = dedupeTargets(allTargets).slice(0, maxDiscoveries);
      metrics.endStage('discovery');
      log.info({ discovered: mission.discoveredUrls.length, identity: parsed.identity.displayName }, 'Discovery complete');

      // PHASE 2: Crawl execution
      mission.phase = 'crawling';
      metrics.startStage('ingress');
      await this.crawler.init();
      metrics.endStage('ingress');

      const urls = mission.discoveredUrls.map((d) => d.url);
      this.crawler.seedMission(urls, {
        priority: 100,
        correlationId: mission.correlationId,
        maxDepth: options.crawlDepth ?? 1,
        rootDomainMode: 'permissive',
      });

      const maxPages = options.maxCrawlPages ?? Math.min(urls.length + 6, 15);
      let crawled = 0;
      let attempts = 0;
      const maxAttempts = maxPages + 10;

      metrics.startStage('render');
      while (crawled < maxPages && attempts < maxAttempts) {
        const statsBefore = this.crawler.getStats();
        const processed = await this.crawler.processOne();
        attempts++;
        const statsAfter = this.crawler.getStats();

        if (statsAfter.blocked > statsBefore.blocked) metrics.recordCrawl(false, true);
        else if (processed) {
          crawled++;
          metrics.recordCrawl(true);
        } else {
          metrics.recordCrawl(false);
          if (statsAfter.pending === 0) break;
        }
      }
      metrics.endStage('render');

      mission.crawledUrls = urls;
      log.info({ crawled, attempts }, 'Crawl phase complete');

      // PHASE 3: Sunbiz entity parsing from crawled pages
      metrics.startStage('distill');
      const sunbizEntities: SunbizEntity[] = [];
      const hits = this.crawler.searchMission(parsed.identity.displayName || query, parsed, 25);
      const entities = this.crawler.collectEntities(hits);

      for (const hit of hits) {
        if (hit.document.url.includes('sunbiz.org') && hit.document.body.length > 200) {
          const entity = this.sunbiz.parseEntityDetailPage(hit.document.body, hit.document.url);
          if (entity) sunbizEntities.push(entity);
        }
      }
      metrics.endStage('distill');

      // PHASE 4: Synthesis + Identity resolution
      mission.phase = 'synthesizing';
      metrics.startStage('synthesis');

      let report = synthesizeReport(mission.id, parsed, hits, entities, sunbizEntities);

      const rawNames = hits.flatMap((h) => [h.document.body, h.document.title]);
      const person = this.identityResolver.resolve(parsed, rawNames);
      report.findings = this.identityResolver.enrichFindings(person, sunbizEntities, report.findings);
      report.resolvedIdentity = person;
      report.sunbizEntities = sunbizEntities;
      report.summary = buildEnhancedSummary(parsed, person, report.findings, sunbizEntities, hits.length);

      metrics.endStage('synthesis');
      const finalMetrics = metrics.finalize(report.findings.length);

      // PHASE 5: Durable output delivery
      const reportPath = this.outputQueue.deliver(report, finalMetrics);

      mission.phase = 'completed';
      mission.updatedAt = new Date().toISOString();

      return { mission, report, reportPath };
    } catch (error) {
      mission.phase = 'failed';
      mission.error = error instanceof Error ? error.message : 'Unknown mission error';
      mission.updatedAt = new Date().toISOString();
      throw error;
    }
  }
}

function dedupeTargets<T extends { url: string }>(targets: T[]): T[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    const key = t.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEnhancedSummary(
  query: ParsedQuery,
  person: { canonicalName: string; aliases: string[] },
  findings: IntelligenceFinding[],
  entities: SunbizEntity[],
  hitCount: number,
): string {
  const capeCoral = findings.find((f) => f.category === 'location' && /cape coral/i.test(f.claim));
  const orgs = entities.map((e) => e.name).filter(Boolean);

  const parts = [
    `Intelligence mission for "${query.raw}" analyzed ${hitCount} sources.`,
    `Resolved identity: ${person.canonicalName}.`,
  ];

  if (capeCoral) parts.push(`Cape Coral, FL address confirmed: ${capeCoral.claim}.`);
  else if (query.locationPhrase) parts.push(`Location target: ${query.locationPhrase}.`);

  if (orgs.length) parts.push(`Florida LLCs: ${orgs.join(', ')}.`);

  return parts.join(' ');
}
