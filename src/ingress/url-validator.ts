import { createHash } from 'node:crypto';
import { GhostChainError } from '../core/types.js';

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  url.hash = '';
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function hashUrl(url: string): string {
  return createHash('sha256').update(normalizeUrl(url)).digest('hex');
}

export function extractDomain(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

function isPrivateIp(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}

export interface UrlValidationOptions {
  blockedHosts: string[];
  allowedDomains?: string[];
  excludePatterns?: string[];
}

export function validateSeedUrl(raw: string, options: UrlValidationOptions): string {
  let url: URL;
  try {
    url = new URL(normalizeUrl(raw));
  } catch {
    throw new GhostChainError('Invalid URL format', 'INVALID_URL', false, { raw });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new GhostChainError('Only HTTP/HTTPS URLs are allowed', 'INVALID_SCHEME', false, { raw });
  }

  const hostname = url.hostname.toLowerCase();
  if (options.blockedHosts.includes(hostname) || isPrivateIp(hostname)) {
    throw new GhostChainError('Blocked host (SSRF protection)', 'BLOCKED_HOST', false, { hostname });
  }

  if (url.username || url.password) {
    throw new GhostChainError('URLs with credentials are not allowed', 'CREDENTIALS_IN_URL', false);
  }

  if (options.allowedDomains?.length) {
    const allowed = options.allowedDomains.some(
      (domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`),
    );
    if (!allowed) {
      throw new GhostChainError('URL outside allowed domain scope', 'OUT_OF_SCOPE', false, { hostname });
    }
  }

  for (const pattern of options.excludePatterns ?? []) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(url.toString())) {
      throw new GhostChainError('URL matches exclusion pattern', 'EXCLUDED', false, { pattern });
    }
  }

  return url.toString();
}

export function resolveLink(baseUrl: string, href: string): string | null {
  try {
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return null;
    }
    const resolved = new URL(href, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    return normalizeUrl(resolved.toString());
  } catch {
    return null;
  }
}

export function isInScope(
  url: string,
  rootDomain: string,
  scope: { allowedDomains?: string[]; maxDepth: number; excludePatterns: string[] },
  depth: number,
  mode: 'strict' | 'permissive' = 'strict',
): boolean {
  if (depth > scope.maxDepth) return false;

  const domain = extractDomain(url);

  for (const pattern of scope.excludePatterns) {
    if (new RegExp(pattern, 'i').test(url)) return false;
  }

  if (scope.allowedDomains?.length) {
    return scope.allowedDomains.some(
      (d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`),
    );
  }

  if (mode === 'permissive') return true;

  return domain === rootDomain || domain.endsWith(`.${rootDomain}`);
}
