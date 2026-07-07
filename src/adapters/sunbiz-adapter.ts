import * as cheerio from 'cheerio';
import type { Logger } from '../core/logger.js';
import type { DiscoveredTarget, ParsedQuery } from '../core/taxonomy.js';
import { validateSeedUrl } from '../ingress/url-validator.js';

const SUNBIZ_BASE = 'https://search.sunbiz.org';

export interface SunbizEntity {
  name: string;
  documentNumber: string;
  status: string;
  detailUrl: string;
  officers: string[];
  principalAddress: string;
}

export class SunbizAdapter {
  constructor(private readonly logger: Logger) {}

  buildSearchUrls(parsed: ParsedQuery): string[] {
    const urls: string[] = [];
    for (const term of parsed.identity.registryNameVariants) {
      urls.push(
        `${SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchResults?inquiryType=OfficerRegisteredAgentName&searchTerm=${encodeURIComponent(term)}`,
        `${SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchResults?inquiryType=EntityName&searchTerm=${encodeURIComponent(parsed.personTokens[parsed.personTokens.length - 1] ?? term)}`,
      );
    }
    return [...new Set(urls)];
  }

  async discoverFromOfficerSearch(parsed: ParsedQuery): Promise<DiscoveredTarget[]> {
    const targets: DiscoveredTarget[] = [];
    const searchTerm = parsed.identity.registryNameVariants[0];
    if (!searchTerm) return targets;

    const url = `${SUNBIZ_BASE}/Inquiry/CorporationSearch/SearchResults?inquiryType=OfficerRegisteredAgentName&searchTerm=${encodeURIComponent(searchTerm)}`;

    try {
      const html = await this.fetchHtml(url);
      const $ = cheerio.load(html);
      const pageText = $('body').text();

      $('a[href*="SearchResultDetail"], a[href*="SearchResults"]').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (!href || !text || text.length < 3) return;

        const resolved = new URL(href, SUNBIZ_BASE).toString();
        if (!resolved.includes('SearchResultDetail') && !resolved.includes('entityId')) return;

        const relevance = scoreSunbizLink(text, pageText, parsed);
        if (relevance < 0.3) return;

        try {
          validateSeedUrl(resolved, { blockedHosts: [] });
          targets.push({
            url: resolved,
            title: text,
            snippet: `Sunbiz filing: ${text}`,
            source: 'manual',
            relevanceScore: relevance,
          });
        } catch {
          // skip invalid
        }
      });

      const entities = this.parseEntityRows($, parsed);
      for (const entity of entities) {
        if (entity.detailUrl) {
          targets.push({
            url: entity.detailUrl,
            title: entity.name,
            snippet: `${entity.status} — ${entity.principalAddress}`,
            source: 'manual',
            relevanceScore: 0.95,
          });
        }
      }
    } catch (error) {
      this.logger.warn({ error, searchTerm }, 'Sunbiz officer search failed');
    }

    return dedupeTargets(targets);
  }

  parseEntityDetailPage(html: string, url: string): SunbizEntity | null {
    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    const name =
      $('h2, h3, .corporationName, [class*="entity"]').first().text().trim() ||
      bodyText.match(/Detail by Entity Name\s*([\w\s.]+LLC)/i)?.[1]?.trim() ||
      '';

    const docMatch = bodyText.match(/Document Number\s*([A-Z]?\d+)/i);
    const statusMatch = bodyText.match(/Status\s*(ACTIVE|INACTIVE|INACT)/i);
    const addressMatch = bodyText.match(
      /(?:Principal|Registered|Business)\s+Address\s*([^\n]{10,120})/i,
    );

    const officers: string[] = [];
    const officerMatches = bodyText.matchAll(
      /(?:Title\s*)?(?:MGR|Manager|AMBR|Authorized Person|Director|Officer)[^\n]{0,40}/gi,
    );
    for (const m of officerMatches) {
      const line = m[0]!.trim();
      if (line.length > 8 && line.length < 120) officers.push(line);
    }

    if (!name && !docMatch) return null;

    return {
      name: name || 'Unknown Entity',
      documentNumber: docMatch?.[1] ?? '',
      status: statusMatch?.[1] ?? 'UNKNOWN',
      detailUrl: url,
      officers: [...new Set(officers)],
      principalAddress: addressMatch?.[1]?.trim() || '',
    };
  }

  private parseEntityRows($: cheerio.CheerioAPI, parsed: ParsedQuery): SunbizEntity[] {
    const entities: SunbizEntity[] = [];
    const identityPattern = new RegExp(
      parsed.identity.variants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'i',
    );

    $('table tr, .searchResultDetail, .detailSection').each((_, row) => {
      const text = $(row).text();
      if (!identityPattern.test(text)) return;

      const link = $(row).find('a[href*="SearchResultDetail"]').attr('href');
      const nameMatch = text.match(/([A-Z][A-Z0-9.\s&]+LLC)/);
      if (link && nameMatch) {
        entities.push({
          name: nameMatch[1]!.trim(),
          documentNumber: '',
          status: 'ACTIVE',
          detailUrl: new URL(link, SUNBIZ_BASE).toString(),
          officers: [],
          principalAddress: '',
        });
      }
    });

    return entities;
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
}

function scoreSunbizLink(text: string, pageText: string, parsed: ParsedQuery): number {
  let score = 0.3;
  const hay = `${text} ${pageText}`.toLowerCase();

  for (const token of parsed.personTokens) {
    if (hay.includes(token)) score += 0.2;
  }
  for (const loc of parsed.locationTokens) {
    if (hay.includes(loc)) score += 0.15;
  }
  if (/LLC|INC|Ltd/i.test(text)) score += 0.1;

  return Math.min(1, score);
}

function dedupeTargets(targets: DiscoveredTarget[]): DiscoveredTarget[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
}
