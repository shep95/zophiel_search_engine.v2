import type { ExtractedEntity, KeywordCluster } from '../core/types.js';

const ENTITY_PATTERNS: Array<{ type: ExtractedEntity['type']; regex: RegExp; confidence: number }> = [
  {
    type: 'person',
    regex: /\b[A-Z][a-z]+(?:\s+[A-Z]\.?\s+)?[A-Z][a-z]+\b/g,
    confidence: 0.65,
  },
  {
    type: 'person',
    regex: /\b[A-Z]{2,},\s*[A-Z][A-Z\s]{1,30}\b/g,
    confidence: 0.7,
  },
  {
    type: 'organization',
    regex:
      /\b[A-Z][A-Za-z0-9&]+(?:\s+[A-Za-z0-9&]+){0,5}\s+(?:LLC|Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation|Company|GmbH|Pty\.?|S\.A\.|PLC|Co\.)\b/g,
    confidence: 0.82,
  },
  {
    type: 'location',
    regex:
      /\b\d{1,6}\s+[\w\s.'-]{2,50}(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way)\b[^,\n]{0,60}(?:,\s*[\w\s.'-]+){0,3}/gi,
    confidence: 0.75,
  },
  {
    type: 'location',
    regex: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3},\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g,
    confidence: 0.6,
  },
  {
    type: 'location',
    regex: /\b\d{4,6}(?:-\d{2,4})?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g,
    confidence: 0.55,
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
