import type { ParsedQuery } from '../core/taxonomy.js';

/** Whether crawled text plausibly mentions the query subject (name, location, or alias). */
export function textMatchesSubject(text: string, parsed: ParsedQuery): boolean {
  const hay = text.toLowerCase();
  if (!hay.trim()) return false;

  const personHits = parsed.personTokens.filter((t) => hay.includes(t)).length;
  const personMatch =
    parsed.personTokens.length >= 2
      ? personHits >= Math.min(2, parsed.personTokens.length)
      : personHits >= 1;

  const locMatch = parsed.locationTokens.some((t) => hay.includes(t));
  const variantMatch = parsed.identity.variants.some(
    (v) => v.length > 3 && hay.includes(v.toLowerCase()),
  );

  return personMatch || locMatch || variantMatch;
}

/** Regex patterns derived from the parsed identity (no hardcoded names). */
export function buildPersonPatterns(parsed: ParsedQuery): RegExp[] {
  const patterns: RegExp[] = [];

  for (const variant of parsed.identity.variants) {
    if (variant.length > 3) {
      patterns.push(new RegExp(escapeRegex(variant), 'gi'));
    }
  }

  if (parsed.personTokens.length >= 2) {
    const first = parsed.personTokens[0]!;
    const last = parsed.personTokens[parsed.personTokens.length - 1]!;
    patterns.push(new RegExp(`\\b${escapeRegex(first)}\\s+[A-Z]\\.?\\s+${escapeRegex(last)}\\b`, 'gi'));
    patterns.push(new RegExp(`\\b${escapeRegex(last)}\\s+${escapeRegex(first)}\\b`, 'gi'));
    patterns.push(new RegExp(`\\b${last.toUpperCase()},\\s*${first.toUpperCase()}[A-Z]?\\b`, 'gi'));
  }

  return patterns;
}

export const INTERNATIONAL_ADDRESS_PATTERN =
  /\b\d{1,6}\s+[\w\s.'-]{2,50}(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl)\b[^.\n]{0,80}/gi;

export const CITY_REGION_PATTERN =
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3},\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g;

export const ORGANIZATION_PATTERN =
  /\b[A-Z][A-Za-z0-9&]+(?:\s+[A-Za-z0-9&]+){0,5}\s+(?:LLC|Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation|Company|GmbH|Pty\.?|S\.A\.|PLC|Co\.)\b/g;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
