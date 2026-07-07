/**
 * Google-style search operators for the local FTS index.
 *
 * Supported:
 *   site:example.com     — restrict to a hostname (includes subdomains)
 *   filetype:pdf         — URL path ends with the given extension
 *   intitle:term         — match terms in the page title (FTS column filter)
 *   inurl:term           — match terms in the URL string
 */

export interface SearchOperators {
  site: string[];
  filetype: string[];
  intitle: string[];
  inurl: string[];
}

export interface ParsedSearchQuery {
  raw: string;
  freeText: string;
  operators: SearchOperators;
}

const OPERATOR_RE = /\b(site|filetype|intitle|inurl):(?:"([^"]+)"|(\S+))/gi;

const EMPTY_OPERATORS = (): SearchOperators => ({
  site: [],
  filetype: [],
  intitle: [],
  inurl: [],
});

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const operators = EMPTY_OPERATORS();
  let freeText = raw.trim();

  for (const match of raw.matchAll(OPERATOR_RE)) {
    const kind = match[1].toLowerCase() as keyof SearchOperators;
    const value = (match[2] ?? match[3] ?? '').trim();
    if (value) operators[kind].push(value);
    freeText = freeText.replace(match[0], ' ');
  }

  freeText = freeText.replace(/\s+/g, ' ').trim();

  return { raw: raw.trim(), freeText, operators };
}

export function stripSearchOperators(raw: string): string {
  return parseSearchQuery(raw).freeText;
}

export function hasUrlFilters(operators: SearchOperators): boolean {
  return operators.site.length > 0 || operators.inurl.length > 0 || operators.filetype.length > 0;
}

export function hasSearchConstraints(parsed: ParsedSearchQuery): boolean {
  return Boolean(parsed.freeText) || parsed.operators.intitle.length > 0 || hasUrlFilters(parsed.operators);
}

function escapeFtsTerm(term: string): string {
  return term.replace(/"/g, '""');
}

function buildFreeTextFts(freeText: string, mode: 'and' | 'or'): string | null {
  const trimmed = freeText.trim();
  if (!trimmed) return null;

  const quoted = trimmed.match(/"([^"]+)"/);
  if (quoted?.[1]) {
    return `"${escapeFtsTerm(quoted[1])}"`;
  }

  const terms = trimmed
    .replace(/[^\w\s"-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (terms.length === 0) return null;

  const parts = terms.map((term) => `"${escapeFtsTerm(term)}"*`);
  return mode === 'and' ? parts.join(' AND ') : parts.join(' OR ');
}

function buildIntitleFts(terms: string[]): string | null {
  if (terms.length === 0) return null;

  const parts = terms.map((term) => {
    if (term.includes(' ')) {
      return `title:"${escapeFtsTerm(term)}"`;
    }
    return `title:"${escapeFtsTerm(term)}"*`;
  });

  return parts.length === 1 ? parts[0]! : parts.map((p) => `(${p})`).join(' AND ');
}

export function buildFtsFromParsed(parsed: ParsedSearchQuery, mode: 'and' | 'or'): string | null {
  const parts = [buildIntitleFts(parsed.operators.intitle), buildFreeTextFts(parsed.freeText, mode)].filter(
    Boolean,
  ) as string[];

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return parts.map((p) => `(${p})`).join(' AND ');
}

/** Build an external SERP query from operators + subject text (pass 1 discovery). */
export function buildDiscoveryQuery(operators: SearchOperators, subjectText: string): string {
  const parts: string[] = [];

  for (const site of operators.site) parts.push(`site:${site}`);
  for (const term of operators.intitle) {
    parts.push(term.includes(' ') ? `intitle:"${term}"` : `intitle:${term}`);
  }
  for (const term of operators.inurl) parts.push(`inurl:${term}`);
  for (const ext of operators.filetype) parts.push(`filetype:${ext.replace(/^\./, '')}`);

  const subject = subjectText.trim();
  if (subject) parts.push(subject);

  return parts.join(' ');
}

/** Domains from site: operators for crawl scope restriction. */
export function operatorAllowedDomains(operators: SearchOperators): string[] | undefined {
  if (operators.site.length === 0) return undefined;
  return operators.site.map(normalizeSite);
}

function normalizeSite(site: string): string {
  let normalized = site.toLowerCase().trim();
  if (normalized.startsWith('www.')) normalized = normalized.slice(4);
  const slashIdx = normalized.indexOf('/');
  if (slashIdx >= 0) normalized = normalized.slice(0, slashIdx);
  return normalized;
}

function urlHostname(url: string): string | null {
  try {
    let host = new URL(url).hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host;
  } catch {
    return null;
  }
}

export function matchesUrlOperators(url: string, operators: SearchOperators): boolean {
  const host = urlHostname(url);
  const lowerUrl = url.toLowerCase();

  for (const site of operators.site) {
    const normalized = normalizeSite(site);
    if (!host) return false;
    if (host !== normalized && !host.endsWith(`.${normalized}`)) return false;
  }

  for (const term of operators.inurl) {
    if (!lowerUrl.includes(term.toLowerCase())) return false;
  }

  for (const ext of operators.filetype) {
    const extension = ext.replace(/^\./, '').toLowerCase();
    const escaped = extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\.${escaped}$`, 'i');
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      // keep raw url fallback
    }
    if (!pattern.test(path)) return false;
  }

  return true;
}
