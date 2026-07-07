import * as cheerio from 'cheerio';
import type { Logger } from '../core/logger.js';
import type { DiscoveredTarget, ParsedQuery } from '../core/taxonomy.js';
import { serpRegionCode } from './region-hints.js';
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

  async discover(parsed: ParsedQuery, discoveryQuery?: string): Promise<DiscoveredTarget[]> {
    const searchQuery =
      discoveryQuery ??
      [
        parsed.identity.displayName,
        parsed.locationPhrase || parsed.locationTokens.join(' '),
      ]
        .filter(Boolean)
        .join(' ');

    const ddgResults = await this.searchDuckDuckGo(searchQuery, serpRegionCode(parsed));
    const merged = this.mergeAndRank(ddgResults, parsed);
    this.logger.info({ count: merged.length, query: parsed.raw }, 'Discovery complete');
    return merged.slice(0, this.options.maxResults);
  }

  private async searchDuckDuckGo(query: string, regionCode?: string): Promise<DiscoveredTarget[]> {
    const params = new URLSearchParams({ q: query });
    if (regionCode) params.set('kl', regionCode);

    const url = `https://html.duckduckgo.com/html/?${params.toString()}`;
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

    for (const loc of parsed.locationTokens) {
      if (haystack.includes(loc)) score += 0.2;
    }

    if (target.url.includes('linkedin.com')) score += 0.15;

    return Math.min(1, score);
  }
}
