import type { AppConfig } from '../config/index.js';
import type { Logger } from '../core/logger.js';
import type { ParsedQuery } from '../core/taxonomy.js';
import type { SearchHit } from '../core/types.js';
import type { GhostChainCrawler } from '../crawler.js';
import { parseQuery } from '../discovery/query-parser.js';
import { SerpDiscovery } from '../discovery/serp-discovery.js';
import { parseSearchQuery } from '../search/query-operators.js';

export interface GatherSearchOptions {
  /** Skip crawling when local hits meet this threshold. Default 3. */
  minResults?: number;
  maxDiscoveries?: number;
  maxCrawlPages?: number;
  crawlDepth?: number;
  /** Always run pass 1 (gather) even if the index already has hits. */
  forceGather?: boolean;
  limit?: number;
}

export interface GatherSearchResult {
  query: string;
  /** Pass 1 ran — crawler discovered and indexed new pages. */
  gathered: boolean;
  pagesIndexedBefore: number;
  pagesIndexedAfter: number;
  pagesCrawled: number;
  discoveredUrls: number;
  /** Pass 2 — operator + keyword search over the local index. */
  hits: SearchHit[];
  subject: ParsedQuery;
}

export class GatherSearch {
  private readonly serpDiscovery: SerpDiscovery;

  constructor(
    private readonly crawler: GhostChainCrawler,
    config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.serpDiscovery = new SerpDiscovery(logger, {
      maxResults: 15,
      blockedHosts: config.blockedHosts,
    });
  }

  async run(query: string, options: GatherSearchOptions = {}): Promise<GatherSearchResult> {
    const limit = options.limit ?? 20;
    const minResults = options.minResults ?? 3;
    const searchParsed = parseSearchQuery(query);
    const subjectText = searchParsed.freeText || query;
    const subject = parseQuery(subjectText);

    const pagesIndexedBefore = this.crawler.getIndexedPageCount();
    let pass2Hits = this.runPass2Search(query, subject, limit);

    const needsGather =
      options.forceGather ||
      pagesIndexedBefore === 0 ||
      pass2Hits.length < minResults;

    if (!needsGather) {
      this.logger.info({ hits: pass2Hits.length, query }, 'Pass 2 satisfied from existing index');
      return {
        query,
        gathered: false,
        pagesIndexedBefore,
        pagesIndexedAfter: pagesIndexedBefore,
        pagesCrawled: 0,
        discoveredUrls: 0,
        hits: pass2Hits,
        subject,
      };
    }

    // Pass 1 — field agent: discover and index pages about the subject (SERP, region-aware)
    this.logger.info({ query, subject: subject.identity.displayName }, 'Pass 1: gathering pages about subject');

    const discoverySubject = [
      subject.identity.displayName,
      subject.locationPhrase || subject.locationTokens.join(' '),
    ]
      .filter(Boolean)
      .join(' ');

    const discoveryQuery = discoverySubject || subjectText;
    const discovered = (await this.serpDiscovery.discover(subject, discoveryQuery)).slice(
      0,
      options.maxDiscoveries ?? 12,
    );

    await this.crawler.init();

    const urls = discovered.map((d) => d.url);
    this.crawler.seedMission(urls, {
      priority: 100,
      correlationId: subject.identity.displayName,
      maxDepth: options.crawlDepth ?? 1,
      rootDomainMode: 'permissive',
    });

    const maxPages = options.maxCrawlPages ?? Math.min(urls.length + 4, 12);
    let pagesCrawled = 0;
    let attempts = 0;
    const maxAttempts = maxPages + 8;

    while (pagesCrawled < maxPages && attempts < maxAttempts) {
      const processed = await this.crawler.processOne();
      attempts++;
      if (processed) pagesCrawled++;
      else if (this.crawler.getStats().pending === 0) break;
    }

    const pagesIndexedAfter = this.crawler.getIndexedPageCount();
    this.logger.info(
      { pagesCrawled, discovered: discovered.length, indexed: pagesIndexedAfter },
      'Pass 1 complete — pages indexed',
    );

    // Pass 2 — analyst: operators + keywords on the case file
    pass2Hits = this.runPass2Search(query, subject, limit);
    this.logger.info({ hits: pass2Hits.length, query }, 'Pass 2 complete — operator search on index');

    return {
      query,
      gathered: true,
      pagesIndexedBefore,
      pagesIndexedAfter,
      pagesCrawled,
      discoveredUrls: discovered.length,
      hits: pass2Hits,
      subject,
    };
  }

  private runPass2Search(query: string, subject: ParsedQuery, limit: number): SearchHit[] {
    if (subject.objective === 'person_lookup' && subject.personTokens.length >= 2) {
      return this.crawler.searchMission(query, subject, limit);
    }
    return this.crawler.search(query, limit);
  }
}

/** Mission-tuned config for gather searches. */
export function gatherSearchConfig() {
  return {
    scope: {
      maxDepth: 1,
      maxPages: 15,
      respectRobotsTxt: true,
      excludePatterns: [] as string[],
      includeHiddenContent: false,
      whitelistedFormActions: [] as string[],
    },
    piiScrubMode: 'sensitive_only' as const,
    concurrency: 2,
    bypassEnabled: true,
    bypassMaxAttempts: 5,
    robotsOverrideDomains: ['linkedin.com', 'www.linkedin.com'],
    missionForceRefreshDomains: [] as string[],
  };
}
