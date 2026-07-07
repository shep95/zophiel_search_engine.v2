import type Database from 'better-sqlite3';
import type { CrawlResult, SearchHit } from '../core/types.js';
import type { ParsedQuery } from '../core/taxonomy.js';
import {
  buildFtsFromParsed,
  hasSearchConstraints,
  hasUrlFilters,
  matchesUrlOperators,
  parseSearchQuery,
  type ParsedSearchQuery,
  type SearchOperators,
} from './query-operators.js';

export class SearchIndex {
  private readonly insertResultStmt;
  private readonly insertFtsStmt;
  private readonly deleteFtsStmt;
  private readonly searchStmt;
  private readonly searchAllStmt;

  constructor(private readonly db: Database.Database) {
    this.insertResultStmt = db.prepare(`
      INSERT INTO crawl_results (
        id, job_id, url, canonical_url, title, description, correlation_id,
        crawled_at, confidence, freshness_score, keywords_json, entities_json,
        clusters_json, links_json, fingerprint_json, body, snippet,
        raw_text_length, cleaned_text_length
      ) VALUES (
        @id, @jobId, @url, @canonicalUrl, @title, @description, @correlationId,
        @crawledAt, @confidence, @freshnessScore, @keywordsJson, @entitiesJson,
        @clustersJson, @linksJson, @fingerprintJson, @body, @snippet,
        @rawTextLength, @cleanedTextLength
      )
      ON CONFLICT(url) DO UPDATE SET
        job_id = excluded.job_id,
        canonical_url = excluded.canonical_url,
        title = excluded.title,
        description = excluded.description,
        crawled_at = excluded.crawled_at,
        confidence = excluded.confidence,
        freshness_score = excluded.freshness_score,
        keywords_json = excluded.keywords_json,
        entities_json = excluded.entities_json,
        clusters_json = excluded.clusters_json,
        links_json = excluded.links_json,
        fingerprint_json = excluded.fingerprint_json,
        body = excluded.body,
        snippet = excluded.snippet,
        raw_text_length = excluded.raw_text_length,
        cleaned_text_length = excluded.cleaned_text_length
    `);

    this.insertFtsStmt = db.prepare(`
      INSERT INTO search_index (url, title, body, keywords, entities)
      VALUES (@url, @title, @body, @keywords, @entities)
    `);

    this.deleteFtsStmt = db.prepare(`DELETE FROM search_index WHERE url = ?`);

    this.searchStmt = db.prepare(`
      SELECT
        url,
        title,
        snippet(search_index, 2, '<mark>', '</mark>', '...', 32) as body_snippet,
        snippet(search_index, 4, '<mark>', '</mark>', '...', 16) as keyword_snippet,
        bm25(search_index) as score
      FROM search_index
      WHERE search_index MATCH ?
      ORDER BY score
      LIMIT ?
    `);

    this.searchAllStmt = db.prepare(`
      SELECT
        url,
        title,
        '' as body_snippet,
        '' as keyword_snippet,
        0 as score
      FROM search_index
      LIMIT ?
    `);
  }

  index(result: CrawlResult): void {
    const entities = result.entities.map((e) => e.text);

    this.insertResultStmt.run({
      id: result.jobId,
      jobId: result.jobId,
      url: result.url,
      canonicalUrl: result.canonicalUrl,
      title: result.title,
      description: result.description ?? null,
      correlationId: result.correlationId,
      crawledAt: result.crawledAt,
      confidence: result.confidence,
      freshnessScore: result.freshnessScore,
      keywordsJson: JSON.stringify(result.keywords),
      entitiesJson: JSON.stringify(result.entities),
      clustersJson: JSON.stringify(result.clusters),
      linksJson: JSON.stringify(result.links),
      fingerprintJson: JSON.stringify(result.fingerprint),
      body: result.segments.map((s) => s.text).join('\n'),
      snippet: result.segments.find((s) => !s.isBoilerplate)?.text.slice(0, 280) ?? '',
      rawTextLength: result.rawTextLength,
      cleanedTextLength: result.cleanedTextLength,
    });

    this.deleteFtsStmt.run(result.url);
    this.insertFtsStmt.run({
      url: result.url,
      title: result.title,
      body: result.segments.filter((s) => !s.isBoilerplate).map((s) => s.text).join(' '),
      keywords: result.keywords.join(' '),
      entities: entities.join(' '),
    });
  }

  search(query: string, limit = 20): SearchHit[] {
    const parsed = parseSearchQuery(query);
    if (!hasSearchConstraints(parsed)) return [];

    const ftsQuery = buildFtsFromParsed(parsed, 'or');
    return this.executeSearch(ftsQuery, limit, parsed);
  }

  searchMission(query: string, parsed: ParsedQuery, limit = 20): SearchHit[] {
    const searchParsed = parseSearchQuery(query);
    const operators = searchParsed.operators;
    const strategies: string[] = [];

    if (parsed.personTokens.length >= 2) {
      strategies.push(buildMissionFts(parsed.personTokens.join(' '), operators, 'and') ?? '');
    }

    const mainText = searchParsed.freeText || stripOperatorFreeText(query);
    strategies.push(buildMissionFts(mainText, operators, 'or') ?? '');
    strategies.push(buildMissionFts(parsed.personTokens.join(' '), operators, 'or') ?? '');

    if (parsed.locationTokens.length) {
      strategies.push(buildMissionFts(parsed.locationTokens.join(' '), operators, 'or') ?? '');
    }

    let hits: SearchHit[] = [];
    for (const ftsQuery of strategies.filter(Boolean)) {
      hits = mergeHits(hits, this.executeSearch(ftsQuery, limit, searchParsed));
    }

    return hits
      .map((hit) => ({
        ...hit,
        score: hit.score + missionRelevanceBoost(hit, parsed),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM search_index').get() as { c: number };
    return row.c;
  }

  private executeSearch(ftsQuery: string | null, limit: number, parsed: ParsedSearchQuery): SearchHit[] {
    const fetchLimit = hasUrlFilters(parsed.operators) ? limit * 10 : limit * 2;
    const snippetQuery = parsed.freeText || parsed.raw;

    const rows = ftsQuery
      ? (this.searchStmt.all(ftsQuery, fetchLimit) as SearchRow[])
      : (this.searchAllStmt.all(fetchLimit) as SearchRow[]);

    return rows
      .filter((row) => matchesUrlOperators(row.url, parsed.operators))
      .map((row) => this.rowToHit(row, snippetQuery))
      .slice(0, limit);
  }

  private rowToHit(
    row: { url: string; title: string; body_snippet: string; keyword_snippet: string; score: number },
    rawQuery: string,
  ): SearchHit {
    const meta = this.db.prepare('SELECT * FROM crawl_results WHERE url = ?').get(row.url) as
      | Record<string, unknown>
      | undefined;

    const keywords = meta ? (JSON.parse(meta.keywords_json as string) as string[]) : [];
    const entities = meta ? (JSON.parse(meta.entities_json as string) as Array<{ text: string }>) : [];
    const body = (meta?.body as string) ?? '';

    const snippet =
      extractRelevantSnippet(body, rawQuery) ||
      stripMarks(row.body_snippet || (meta?.snippet as string) || '');

    return {
      document: {
        id: (meta?.id as string) ?? row.url,
        url: row.url,
        title: row.title,
        snippet,
        keywords,
        entities: entities.map((e) => e.text),
        crawledAt: (meta?.crawled_at as string) ?? new Date().toISOString(),
        confidence: (meta?.confidence as number) ?? 0,
        freshnessScore: (meta?.freshness_score as number) ?? 0,
        body,
      },
      score: Math.abs(row.score),
      highlights: [row.body_snippet, row.keyword_snippet].filter(Boolean).map(stripMarks),
    };
  }
}

type SearchRow = {
  url: string;
  title: string;
  body_snippet: string;
  keyword_snippet: string;
  score: number;
};

function buildMissionFts(freeText: string, operators: SearchOperators, mode: 'and' | 'or'): string | null {
  return buildFtsFromParsed({ raw: freeText, freeText: freeText.trim(), operators }, mode);
}

function stripOperatorFreeText(query: string): string {
  return parseSearchQuery(query).freeText;
}

function missionRelevanceBoost(hit: SearchHit, parsed: ParsedQuery): number {
  let boost = 0;
  const haystack = `${hit.document.title} ${hit.document.body}`.toLowerCase();

  for (const token of parsed.personTokens) {
    if (haystack.includes(token)) boost += 2;
  }

  for (const token of parsed.locationTokens) {
    if (haystack.includes(token)) boost += 1.5;
  }

  if (parsed.phrases.some((p) => p.length > 5 && haystack.includes(p))) boost += 3;

  if (parsed.locationTokens.some((t) => hit.document.url.toLowerCase().includes(t))) boost += 1;

  return boost;
}

function mergeHits(primary: SearchHit[], secondary: SearchHit[]): SearchHit[] {
  const map = new Map<string, SearchHit>();
  for (const hit of [...primary, ...secondary]) {
    const existing = map.get(hit.document.url);
    if (!existing || hit.score > existing.score) map.set(hit.document.url, hit);
  }
  return Array.from(map.values());
}

function extractRelevantSnippet(body: string, query: string): string {
  const lower = body.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const bestToken = tokens.find((t) => lower.includes(t));
  if (!bestToken) return '';

  const idx = lower.indexOf(bestToken);
  const start = Math.max(0, idx - 120);
  const end = Math.min(body.length, idx + 180);
  return body.slice(start, end).replace(/\s+/g, ' ').trim();
}

function stripMarks(value: string): string {
  return value.replace(/<\/?mark>/g, '');
}
