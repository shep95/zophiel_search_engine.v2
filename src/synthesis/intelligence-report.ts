import type { ExtractedEntity, SearchHit } from '../core/types.js';
import type { IntelligenceFinding, IntelligenceReport, ParsedQuery } from '../core/taxonomy.js';
import type { SunbizEntity } from '../adapters/sunbiz-adapter.js';
import type { ResolvedPerson } from './identity-resolver.js';

const ADDRESS_PATTERN =
  /\b\d{1,5}\s+(?:SW|NW|SE|NE)\s+[\w\s]+(?:ST|CT|DR|RD|AVE|BLVD|COURT|DRIVE|STREET)[,\s]+(?:CAPE CORAL|Cape Coral)[,\s]+(?:FL|Florida)[,\s]*\d{5}/gi;

const PERSON_PATTERN =
  /\b(?:NEWTON|Newton),\s*(?:ASHER|Asher)(?:\s+[A-Z]\.?)?\b|\b(?:ASHER|Asher)(?:\s+[A-Z]\.?)?\s+(?:S\.?\s+)?(?:NEWTON|Newton)\b|\bAsher\s+Shepherd\s+Newton\b/gi;

const ORG_PATTERN = /\b[A-Z][A-Z0-9.\s&]{2,30}\s+LLC\b/g;

const NOISE_ORG_PATTERNS = [
  /business file/i,
  /profit corporation/i,
  /trust company/i,
  /cable franchise/i,
  /fees corporation/i,
  /filing limited/i,
  /dissolution file/i,
  /miscellaneous forms/i,
];

const NOISE_LOCATION_PATTERNS = [
  /tallahassee/i,
  /bronough street/i,
  /florida, florida/i,
];

export function synthesizeReport(
  missionId: string,
  query: ParsedQuery,
  hits: SearchHit[],
  entities: ExtractedEntity[],
  sunbizEntities: SunbizEntity[] = [],
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
    extractFromText(body, hit.document.url, findings);
  }

  for (const entity of entities) {
    if (entity.type === 'organization' && isNoiseOrg(entity.text)) continue;
    if (entity.type === 'location' && isNoiseLocation(entity.text)) continue;
    findings.push({
      category: mapEntityCategory(entity.type),
      claim: entity.text,
      sourceUrl: hits[0]?.document.url ?? '',
      confidence: entity.confidence,
      evidence: `Entity extraction (${entity.type})`,
    });
  }

  for (const se of sunbizEntities) {
    if (se.principalAddress && /cape coral/i.test(se.principalAddress)) {
      findings.push({
        category: 'location',
        claim: se.principalAddress,
        sourceUrl: se.detailUrl,
        confidence: 0.95,
        evidence: 'Sunbiz principal address',
      });
    }
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
  const hay = `${hit.document.title} ${hit.document.body} ${hit.document.url}`.toLowerCase();
  const personMatch = query.personTokens.some((t) => hay.includes(t));
  const locMatch = query.locationTokens.some((t) => hay.includes(t));
  const sunbizEntity = hay.includes('sunbiz') && /newton|asher|zorak|bosley/i.test(hay);

  if (hit.document.url.includes('dos.myflorida.com') && !sunbizEntity) return false;
  if (hit.document.url.includes('bizapedia') && hit.document.body.includes('captcha')) return false;

  return personMatch || locMatch || sunbizEntity || hit.document.url.includes('bisprofiles');
}

function extractFromText(text: string, sourceUrl: string, findings: IntelligenceFinding[]): void {
  for (const addr of text.match(ADDRESS_PATTERN) ?? []) {
    findings.push({
      category: 'location',
      claim: addr.trim().replace(/\s+/g, ' '),
      sourceUrl,
      confidence: 0.92,
      evidence: 'Cape Coral address pattern',
    });
  }

  for (const person of text.match(PERSON_PATTERN) ?? []) {
    findings.push({
      category: 'identity',
      claim: person.trim(),
      sourceUrl,
      confidence: 0.9,
      evidence: 'Person name in source',
    });
  }

  for (const org of text.match(ORG_PATTERN) ?? []) {
    if (isNoiseOrg(org)) continue;
    findings.push({
      category: 'organization',
      claim: org.trim(),
      sourceUrl,
      confidence: 0.85,
      evidence: 'LLC entity in source',
    });
  }
}

function isNoiseOrg(text: string): boolean {
  return NOISE_ORG_PATTERNS.some((p) => p.test(text)) || text.length > 60;
}

function isNoiseLocation(text: string): boolean {
  return NOISE_LOCATION_PATTERNS.some((p) => p.test(text));
}

function filterNoise(findings: IntelligenceFinding[]): IntelligenceFinding[] {
  return findings
    .filter((f) => {
      if (f.category === 'organization' && isNoiseOrg(f.claim)) return false;
      if (f.category === 'location' && isNoiseLocation(f.claim)) return false;
      return f.confidence >= 0.5;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

function mapEntityCategory(type: ExtractedEntity['type']): IntelligenceFinding['category'] {
  switch (type) {
    case 'person': return 'identity';
    case 'location': return 'location';
    case 'organization': return 'organization';
    default: return 'other';
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
