import type { ExtractedEntity, KeywordCluster } from '../core/types.js';

const ENTITY_PATTERNS: Array<{ type: ExtractedEntity['type']; regex: RegExp; confidence: number }> = [
  {
    type: 'person',
    regex: /\b(?:NEWTON|Newton),\s*(?:ASHER|Asher)(?:\s+[A-Z]\.?)?\b/g,
    confidence: 0.92,
  },
  {
    type: 'person',
    regex: /\b(?:ASHER|Asher)(?:\s+[A-Z]\.?)?\s+(?:S\.?\s+)?(?:NEWTON|Newton)\b/g,
    confidence: 0.9,
  },
  {
    type: 'person',
    regex: /\bAsher\s+Shepherd\s+Newton\b/gi,
    confidence: 0.95,
  },
  {
    type: 'person',
    regex: /\b[A-Z][a-z]+\s+[A-Z]\.\s+[A-Z][a-z]+\b/g,
    confidence: 0.7,
  },
  {
    type: 'organization',
    regex: /\b[A-Z][A-Za-z0-9&]+(?:\s+[A-Z][A-Za-z0-9&]+){0,4}\s+LLC\b/g,
    confidence: 0.85,
  },
  {
    type: 'organization',
    regex: /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc|Ltd|Corp|Corporation|Company)\b/g,
    confidence: 0.8,
  },
  {
    type: 'location',
    regex:
      /\b\d{1,5}\s+(?:[NSEW]\s+)?[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ct|Court|Blvd|Lane|Ln)\b[^,\n]{0,40}(?:,\s*)?[A-Za-z\s]+,\s*(?:FL|Florida)\s+\d{5}(?:-\d{4})?/gi,
    confidence: 0.88,
  },
  {
    type: 'location',
    regex: /\bCape Coral,\s*FL(?:\s+\d{5})?\b/gi,
    confidence: 0.82,
  },
  {
    type: 'location',
    regex: /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*(?:FL|Florida)\b/g,
    confidence: 0.65,
  },
];

export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, regex, confidence } of ENTITY_PATTERNS) {
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const globalRegex = new RegExp(regex.source, flags);
    const matches = text.match(globalRegex) ?? [];

    for (const match of matches) {
      const normalized = match.trim();
      const key = `${type}:${normalized.toLowerCase()}`;
      if (seen.has(key) || normalized.length < 3) continue;
      seen.add(key);
      entities.push({ text: normalized, type, confidence });
      if (entities.length >= 50) return entities;
    }
  }

  return entities;
}

export function clusterKeywords(keywords: string[], body: string): KeywordCluster[] {
  if (keywords.length === 0) return [];

  const clusters: KeywordCluster[] = [];
  const chunkSize = Math.max(3, Math.ceil(keywords.length / 3));

  for (let i = 0; i < keywords.length; i += chunkSize) {
    const group = keywords.slice(i, i + chunkSize);
    const theme = group[0] ?? 'general';
    const occurrences = group.reduce((sum, kw) => {
      const regex = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'gi');
      return sum + (body.match(regex)?.length ?? 0);
    }, 0);

    clusters.push({
      theme,
      keywords: group,
      score: occurrences / Math.max(group.length, 1),
    });
  }

  return clusters.sort((a, b) => b.score - a.score);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
