import type { ParsedQuery } from '../core/taxonomy.js';

/** US states and common abbreviations — stripped from person-name tokenization. */
export const US_STATES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
  'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
  'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota',
  'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming', 'fl', 'ca', 'ny', 'tx',
]);

/** Countries and regions — used to detect non-US lookups and steer discovery. */
export const COUNTRIES_AND_REGIONS = new Set([
  'afghanistan', 'albania', 'algeria', 'argentina', 'armenia', 'australia', 'austria',
  'azerbaijan', 'bangladesh', 'belarus', 'belgium', 'bolivia', 'brazil', 'bulgaria',
  'cambodia', 'cameroon', 'canada', 'chile', 'china', 'colombia', 'costa rica', 'croatia',
  'cuba', 'czech republic', 'czechia', 'denmark', 'ecuador', 'egypt', 'england',
  'estonia', 'ethiopia', 'finland', 'france', 'germany', 'ghana', 'greece', 'guatemala',
  'honduras', 'hong kong', 'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq',
  'ireland', 'israel', 'italy', 'japan', 'jordan', 'kazakhstan', 'kenya', 'korea',
  'south korea', 'north korea', 'kuwait', 'latvia', 'lebanon', 'lithuania', 'luxembourg',
  'malaysia', 'mexico', 'morocco', 'nepal', 'netherlands', 'new zealand', 'nicaragua',
  'nigeria', 'norway', 'pakistan', 'panama', 'paraguay', 'peru', 'philippines', 'poland',
  'portugal', 'romania', 'russia', 'saudi arabia', 'scotland', 'serbia', 'singapore',
  'slovakia', 'slovenia', 'south africa', 'spain', 'sri lanka', 'sweden', 'switzerland',
  'syria', 'taiwan', 'thailand', 'turkey', 'ukraine', 'united kingdom', 'uk', 'uruguay',
  'uzbekistan', 'venezuela', 'vietnam', 'wales', 'zimbabwe',
]);

const US_MARKERS = /\b(usa|u\.s\.a?|united states|america|u\.s\.)\b/i;

/** True when the parsed location looks like a US jurisdiction (Sunbiz, FL directories, etc.). */
export function isUsJurisdiction(parsed: ParsedQuery): boolean {
  const loc = locationHaystack(parsed);
  if (!loc.trim()) return false;

  if (isForeignJurisdiction(parsed)) return false;
  if (US_MARKERS.test(loc)) return true;

  for (const state of US_STATES) {
    if (loc.includes(state)) return true;
  }

  return false;
}

export function isForeignJurisdiction(parsed: ParsedQuery): boolean {
  const loc = locationHaystack(parsed);
  if (!loc.trim()) return false;

  for (const country of COUNTRIES_AND_REGIONS) {
    if (loc.includes(country)) return true;
  }

  return false;
}

/** DuckDuckGo `kl` region code for discovery bias (best-effort). */
export function serpRegionCode(parsed: ParsedQuery): string | undefined {
  const loc = locationHaystack(parsed);
  if (!loc) return undefined;

  const map: Array<[RegExp, string]> = [
    [/\baustralia\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b/, 'au-en'],
    [/\bchina\b|\bbeijing\b|\bshanghai\b/, 'cn-zh'],
    [/\bperu\b|\blima\b/, 'pe-es'],
    [/\bunited kingdom\b|\bengland\b|\bscotland\b|\bwales\b|\blondon\b/, 'uk-en'],
    [/\bcanada\b|\btoronto\b|\bvancouver\b/, 'ca-en'],
    [/\bgermany\b|\bberlin\b/, 'de-de'],
    [/\bfrance\b|\bparis\b/, 'fr-fr'],
    [/\bjapan\b|\btokyo\b/, 'jp-jp'],
    [/\bindia\b|\bmumbai\b|\bdelhi\b/, 'in-en'],
    [/\bbrazil\b|\bsão paulo\b|\bsao paulo\b/, 'br-pt'],
    [/\bmexico\b/, 'mx-es'],
    [/\bflorida\b|\bunited states\b|\busa\b/, 'us-en'],
  ];

  for (const [pattern, code] of map) {
    if (pattern.test(loc)) return code;
  }

  return isUsJurisdiction(parsed) ? 'us-en' : undefined;
}

function locationHaystack(parsed: ParsedQuery): string {
  return `${parsed.locationPhrase} ${parsed.locationTokens.join(' ')}`.toLowerCase();
}

/** Tokens that belong to geography, not a person's name. */
export function isLocationToken(token: string): boolean {
  const lower = token.toLowerCase();
  return US_STATES.has(lower) || COUNTRIES_AND_REGIONS.has(lower);
}
