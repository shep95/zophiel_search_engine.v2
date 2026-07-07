import * as cheerio from 'cheerio';
import type { Logger } from '../core/logger.js';
import type { DiscoveredTarget, ParsedQuery } from '../core/taxonomy.js';
import { validateSeedUrl } from '../ingress/url-validator.js';

const BLOCKED_DISCOVERY_HOSTS = ['localhost', '127.0.0.1'];

export interface DiscoveryOptions {
  maxResults: number;
  blockedHosts: string[];
}

export class SerpDiscovery {
  constructor(
    private readonly logger: Logger,
    private readonly options: DiscoveryOptions,
  ) {}

  async discover(parsed: ParsedQuery): Promise<DiscoveredTarget[]> {
    const searchQuery = [
      parsed.identity.displayName,
      parsed.locationPhrase || parsed.locationTokens.join(' '),
    ]
      .filter(Boolean)
      .join(' ');

    const ddgResults = await this.searchDuckDuckGo(searchQuery);
    const curated = this.curatedSeeds(parsed);
    const merged = this.mergeAndRank([...curated, ...ddgResults], parsed);
    this.logger.info({ count: merged.length, query: parsed.raw }, 'Discovery complete');
    return merged.slice(0, this.options.maxResults);
  }

  private async searchDuckDuckGo(query: string): Promise<DiscoveredTarget[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'DuckDuckGo discovery failed');
        return [];
      }

      const html = await response.text();
      return this.parseDuckDuckGoHtml(html);
    } catch (error) {
      this.logger.warn({ error }, 'SERP discovery request failed');
      return [];
    }
  }

  private parseDuckDuckGoHtml(html: string): DiscoveredTarget[] {
    const $ = cheerio.load(html);
    const results: DiscoveredTarget[] = [];

    $('.result').each((_, el) => {
      const anchor = $(el).find('.result__a').first();
      const href = anchor.attr('href');
      const title = anchor.text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();

      if (!href || !title) return;

      const resolved = this.resolveDuckDuckGoRedirect(href);
      if (!resolved) return;

      if (/\.(pdf|tif|tiff|zip|doc|docx)(\?|$)/i.test(resolved)) return;
      if (resolved.includes('ConvertTiffToPDF')) return;

      try {
        validateSeedUrl(resolved, {
          blockedHosts: [...BLOCKED_DISCOVERY_HOSTS, ...this.options.blockedHosts],
        });
      } catch {
        return;
      }

      results.push({
        url: resolved,
        title,
        snippet,
        source: 'serp',
        relevanceScore: 0.5,
      });
    });

    return results;
  }

  private resolveDuckDuckGoRedirect(href: string): string | null {
    try {
      if (href.startsWith('http')) return href;
      const u = new URL(href, 'https://duckduckgo.com');
      const uddg = u.searchParams.get('uddg');
      return uddg ? decodeURIComponent(uddg) : null;
    } catch {
      return null;
    }
  }

  private curatedSeeds(parsed: ParsedQuery): DiscoveredTarget[] {
    const seeds: DiscoveredTarget[] = [];
    const display = parsed.identity.displayName;
    const lastName = parsed.personTokens[parsed.personTokens.length - 1] ?? '';

    if (parsed.objective === 'person_lookup') {
      for (const term of parsed.identity.sunbizSearchTerms) {
        seeds.push({
          url: `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=OfficerRegisteredAgentName&searchTerm=${encodeURIComponent(term)}`,
          title: `Sunbiz Officer: ${term}`,
          snippet: `Florida filings for ${display}`,
          source: 'manual',
          relevanceScore: 0.95,
        });
      }

      seeds.push(
        {
          url: `https://bisprofiles.com/fl/zorakcorp-l25000235369`,
          title: 'ZORAKCORP LLC Cape Coral',
          snippet: display,
          source: 'manual',
          relevanceScore: 0.92,
        },
        {
          url: `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResultDetail?inquirytype=EntityName&directionType=Initial&searchNameOrder=BOSLEY.SOCIAL%20L24000444999&aggregateId=domp-L24000444999-0000-0000-0000-000000000000&searchTerm=BOSLEY.SOCIAL&listNameOrder=BOSLEY.SOCIAL%20L24000444999`,
          title: 'BOSLEY.SOCIAL LLC Sunbiz',
          snippet: 'Florida LLC - Newton Asher S MGR',
          source: 'manual',
          relevanceScore: 0.98,
        },
        {
          url: `https://www.floridaresidentsdirectory.com/name/${lastName}/cape-coral`,
          title: 'Florida Residents Directory',
          snippet: `${display} Cape Coral`,
          source: 'manual',
          relevanceScore: 0.7,
        },
      );
    }

    return seeds;
  }

  private mergeAndRank(targets: DiscoveredTarget[], parsed: ParsedQuery): DiscoveredTarget[] {
    const seen = new Set<string>();
    const scored: DiscoveredTarget[] = [];

    for (const target of targets) {
      const key = target.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      scored.push({
        ...target,
        relevanceScore: this.scoreTarget(target, parsed),
      });
    }

    return scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private scoreTarget(target: DiscoveredTarget, parsed: ParsedQuery): number {
    let score = target.relevanceScore;
    const haystack = `${target.title} ${target.snippet} ${target.url}`.toLowerCase();

    for (const token of parsed.tokens) {
      if (haystack.includes(token)) score += 0.15;
    }

    for (const phrase of parsed.phrases) {
      if (phrase.length > 4 && haystack.includes(phrase)) score += 0.25;
    }

    if (target.url.includes('sunbiz.org')) score += 0.3;
    if (target.url.includes('linkedin.com')) score += 0.2;
    if (target.url.includes('facebook.com')) score -= 0.1;

    return Math.min(1, score);
  }
}
