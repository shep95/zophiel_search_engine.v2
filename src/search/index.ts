import type Database from 'better-sqlite3';
import type { CrawlResult, SearchHit } from '../core/types.js';
import type { ParsedQuery } from '../core/taxonomy.js';

export class SearchIndex {
  private readonly insertResultStmt;
  private readonly insertFtsStmt;
  private readonly deleteFtsStmt;
  private readonly searchStmt;

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
    const ftsQuery = buildFtsQuery(query, 'or');
    if (!ftsQuery) return [];
    return this.executeSearch(ftsQuery, limit, query);
  }

  searchMission(query: string, parsed: ParsedQuery, limit = 20): SearchHit[] {
    const strategies: string[] = [];

    if (parsed.personTokens.length >= 2) {
      strategies.push(buildFtsQuery(parsed.personTokens.join(' '), 'and') ?? '');
    }

    strategies.push(buildFtsQuery(query, 'or') ?? '');
    strategies.push(buildFtsQuery(parsed.personTokens.join(' '), 'or') ?? '');

    if (parsed.locationTokens.length) {
      strategies.push(buildFtsQuery(parsed.locationTokens.join(' '), 'or') ?? '');
    }

    let hits: SearchHit[] = [];
    for (const ftsQuery of strategies.filter(Boolean)) {
      hits = mergeHits(hits, this.executeSearch(ftsQuery, limit, query));
    }

    return hits
      .map((hit) => ({
        ...hit,
        score: hit.score + missionRelevanceBoost(hit, parsed),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private executeSearch(ftsQuery: string, limit: number, rawQuery: string): SearchHit[] {
    const rows = this.searchStmt.all(ftsQuery, limit * 2) as Array<{
      url: string;
      title: string;
      body_snippet: string;
      keyword_snippet: string;
      score: number;
    }>;

    return rows.map((row) => this.rowToHit(row, rawQuery)).slice(0, limit);
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

function buildFtsQuery(query: string, mode: 'and' | 'or'): string | null {
  const terms = query
    .trim()
    .replace(/[^\w\s"-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (terms.length === 0) return null;

  const quoted = query.match(/"([^"]+)"/);
  if (quoted?.[1]) {
    return `"${quoted[1].replace(/"/g, '')}"`;
  }

  const parts = terms.map((term) => `"${term}"*`);
  return mode === 'and' ? parts.join(' AND ') : parts.join(' OR ');
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

  if (hit.document.url.includes('sunbiz.org')) boost += 4;
  if (hit.document.url.includes('linkedin.com')) boost += 2;

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
