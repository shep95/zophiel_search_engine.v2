import type { ExtractedEntity, SearchHit } from '../core/types.js';
import type { IntelligenceFinding, IntelligenceReport, ParsedQuery } from '../core/taxonomy.js';
import type { ResolvedPerson } from './identity-resolver.js';
import {
  buildPersonPatterns,
  CITY_REGION_PATTERN,
  INTERNATIONAL_ADDRESS_PATTERN,
  ORGANIZATION_PATTERN,
  textMatchesSubject,
} from './subject-match.js';

const NOISE_ORG_PATTERNS = [
  /business file/i,
  /profit corporation/i,
  /trust company/i,
  /cable franchise/i,
  /fees corporation/i,
  /filing limited/i,
  /dissolution file/i,
  /miscellaneous forms/i,
  /privacy policy/i,
  /terms of service/i,
];

export function synthesizeReport(
  missionId: string,
  query: ParsedQuery,
  hits: SearchHit[],
  entities: ExtractedEntity[],
): IntelligenceReport {
  const findings: IntelligenceFinding[] = [];
  const sources = hits
    .filter((h) => isRelevantSource(h, query))
    .map((h) => ({
      url: h.document.url,
      title: h.document.title,
      confidence: h.document.confidence,
    }));

  for (const hit of hits) {
    if (!isRelevantSource(hit, query)) continue;
    const body = `${hit.document.title}\n${hit.document.body}\n${hit.document.snippet}`;
    extractFromText(body, hit.document.url, query, findings);
  }

  for (const entity of entities) {
    if (entity.type === 'organization' && isNoiseOrg(entity.text)) continue;
    if (!textMatchesSubject(entity.text, query) && entity.type === 'person') continue;
    findings.push({
      category: mapEntityCategory(entity.type),
      claim: entity.text,
      sourceUrl: hits[0]?.document.url ?? '',
      confidence: entity.confidence,
      evidence: `Entity extraction (${entity.type})`,
    });
  }

  const ranked = filterNoise(dedupeFindings(findings));

  return {
    missionId,
    query: query.raw,
    generatedAt: new Date().toISOString(),
    findings: ranked,
    sources,
    searchHits: hits.length,
    summary: '',
  };
}

function isRelevantSource(hit: SearchHit, query: ParsedQuery): boolean {
  const hay = `${hit.document.title} ${hit.document.body} ${hit.document.url}`;
  if (hay.toLowerCase().includes('captcha') && hit.document.body.length < 500) return false;
  return textMatchesSubject(hay, query);
}

function extractFromText(
  text: string,
  sourceUrl: string,
  query: ParsedQuery,
  findings: IntelligenceFinding[],
): void {
  for (const addr of text.match(INTERNATIONAL_ADDRESS_PATTERN) ?? []) {
    findings.push({
      category: 'location',
      claim: addr.trim().replace(/\s+/g, ' '),
      sourceUrl,
      confidence: 0.8,
      evidence: 'Street address pattern in source',
    });
  }

  for (const region of text.match(CITY_REGION_PATTERN) ?? []) {
    if (!query.locationTokens.some((t) => region.toLowerCase().includes(t))) continue;
    findings.push({
      category: 'location',
      claim: region.trim(),
      sourceUrl,
      confidence: 0.72,
      evidence: 'City/region pattern matching query location',
    });
  }

  for (const pattern of buildPersonPatterns(query)) {
    for (const person of text.match(pattern) ?? []) {
      findings.push({
        category: 'identity',
        claim: person.trim(),
        sourceUrl,
        confidence: 0.88,
        evidence: 'Person name matching query identity',
      });
    }
  }

  for (const org of text.match(ORGANIZATION_PATTERN) ?? []) {
    if (isNoiseOrg(org)) continue;
    findings.push({
      category: 'organization',
      claim: org.trim(),
      sourceUrl,
      confidence: 0.82,
      evidence: 'Registered organization in source',
    });
  }
}

function isNoiseOrg(text: string): boolean {
  return NOISE_ORG_PATTERNS.some((p) => p.test(text)) || text.length > 80;
}

function filterNoise(findings: IntelligenceFinding[]): IntelligenceFinding[] {
  return findings
    .filter((f) => {
      if (f.category === 'organization' && isNoiseOrg(f.claim)) return false;
      return f.confidence >= 0.5;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function mapEntityCategory(type: ExtractedEntity['type']): IntelligenceFinding['category'] {
  switch (type) {
    case 'person':
      return 'identity';
    case 'location':
      return 'location';
    case 'organization':
      return 'organization';
    default:
      return 'other';
  }
}

function dedupeFindings(findings: IntelligenceFinding[]): IntelligenceFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.category}:${f.claim.toLowerCase().replace(/\s+/g, ' ')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type { ResolvedPerson };
