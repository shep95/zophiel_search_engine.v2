import type { MissionObjective, ParsedQuery } from '../core/taxonomy.js';
import { COUNTRIES_AND_REGIONS, isLocationToken, US_STATES } from './region-hints.js';
import { stripSearchOperators } from '../search/query-operators.js';

const LOCATION_PHRASES = [
  /who\s+lives\s+in\s+(.+)/i,
  /who\s+is\s+from\s+(.+)/i,
  /from\s+(.+)/i,
  /located\s+in\s+(.+)/i,
  /based\s+in\s+(.+)/i,
  /living\s+in\s+(.+)/i,
  /resident\s+of\s+(.+)/i,
];

const STOP_WORDS = new Set([
  'who', 'lives', 'in', 'the', 'a', 'an', 'from', 'at', 'of', 'and', 'or', 'is', 'was',
  'that', 'this', 'with', 'for', 'on', 'to', 'be', 'are', 'by', 'as', 'it', 'my', 'me',
  'living', 'resident',
]);

export interface CanonicalIdentity {
  displayName: string;
  variants: string[];
  registryNameVariants: string[];
  middleInitial?: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const normalized = stripSearchOperators(raw).trim().replace(/\s+/g, ' ');
  let locationPhrase = '';
  let namePart = normalized;

  for (const pattern of LOCATION_PHRASES) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      locationPhrase = match[1].trim().replace(/[?.!,]+$/, '');
      namePart = normalized.slice(0, match.index).trim();
      break;
    }
  }

  if (!locationPhrase) {
    const trailingIn = normalized.match(/^(.+?)\s+in\s+(.{2,80})$/i);
    if (trailingIn) {
      namePart = trailingIn[1]!.trim();
      locationPhrase = trailingIn[2]!.trim().replace(/[?.!,]+$/, '');
    }
  }

  const locationTokens = tokenizeLocation(locationPhrase || extractEmbeddedLocation(normalized));
  const personTokens = tokenizePerson(namePart || normalized, locationTokens);
  const identity = buildCanonicalIdentity(personTokens);
  const phrases = extractPhrases(normalized, identity);
  const objective = inferObjective(personTokens, locationTokens);

  return {
    raw: normalized,
    tokens: normalized.toLowerCase().split(/\s+/).filter(Boolean),
    phrases,
    objective,
    personTokens,
    locationTokens,
    identity,
    locationPhrase,
  };
}

function tokenizeLocation(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens = lower.split(/\s+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  const result = new Set<string>(tokens);

  for (const country of COUNTRIES_AND_REGIONS) {
    if (lower.includes(country)) {
      for (const part of country.split(/\s+/)) {
        if (part.length > 1) result.add(part);
      }
      if (country.includes(' ')) result.add(country);
    }
  }

  return [...result];
}

function extractEmbeddedLocation(text: string): string {
  const lower = text.toLowerCase();

  for (const country of COUNTRIES_AND_REGIONS) {
    if (lower.includes(country)) return country;
  }

  for (const state of US_STATES) {
    if (lower.includes(state)) return state;
  }

  return '';
}

function tokenizePerson(text: string, locationTokens: string[]): string[] {
  const locSet = new Set(locationTokens);
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(
      (t) =>
        t.length > 1 &&
        !STOP_WORDS.has(t) &&
        !locSet.has(t) &&
        !US_STATES.has(t) &&
        !isLocationToken(t),
    );
}

function buildCanonicalIdentity(personTokens: string[]): CanonicalIdentity {
  if (personTokens.length === 0) {
    return { displayName: '', variants: [], registryNameVariants: [] };
  }

  const first = personTokens[0] ?? '';
  const last = personTokens[personTokens.length - 1] ?? '';
  const middle = personTokens.length > 2 ? personTokens.slice(1, -1) : [];
  const middleInitial = middle[0]?.[0]?.toUpperCase();

  const displayName =
    personTokens.length >= 3
      ? `${capitalize(first)} ${capitalize(middle[0] ?? '')} ${capitalize(last)}`
      : `${capitalize(first)} ${capitalize(last)}`;

  const variants = new Set<string>([
    displayName,
    `${capitalize(first)} ${capitalize(last)}`,
    middleInitial ? `${capitalize(first)} ${middleInitial}. ${capitalize(last)}` : '',
    middleInitial ? `${capitalize(first)} ${middleInitial} ${capitalize(last)}` : '',
    `${last.toUpperCase()}, ${first.toUpperCase()}${middleInitial ? ` ${middleInitial}` : ''}`,
    `${capitalize(last)}, ${capitalize(first)}${middleInitial ? ` ${middleInitial}` : ''}`,
  ].filter(Boolean));

  const registryNameVariants = [
    `${capitalize(last)} ${capitalize(first)}`,
    `${capitalize(first)} ${capitalize(last)}`,
    middleInitial ? `${capitalize(last)} ${capitalize(first)} ${middleInitial}` : '',
    displayName,
  ].filter(Boolean);

  return {
    displayName,
    variants: [...variants],
    registryNameVariants: [...new Set(registryNameVariants)],
    middleInitial,
  };
}

function extractPhrases(text: string, identity: CanonicalIdentity): string[] {
  const phrases = new Set<string>();
  const lower = text.toLowerCase();

  for (const v of identity.variants) {
    if (v.length > 3) phrases.add(v.toLowerCase());
  }

  for (let size = Math.min(4, lower.split(/\s+/).length); size >= 2; size--) {
    const words = lower.split(/\s+/);
    for (let i = 0; i <= words.length - size; i++) {
      phrases.add(words.slice(i, i + size).join(' '));
    }
  }

  return [...phrases];
}

function inferObjective(personTokens: string[], locationTokens: string[]): MissionObjective {
  if (personTokens.length >= 2 && locationTokens.length >= 1) return 'person_lookup';
  if (personTokens.length >= 2) return 'person_lookup';
  return 'general';
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}
