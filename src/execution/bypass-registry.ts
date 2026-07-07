import type { BrowserContextOptions } from 'playwright';

export type BypassStrategyId =
  | 'default'
  | 'stealth_full'
  | 'google_referrer'
  | 'sunbiz_warm_session'
  | 'sunbiz_direct_entity'
  | 'bizapedia_challenge_wait'
  | 'facebook_mbasic'
  | 'facebook_mobile'
  | 'slow_human'
  | 'alternate_www';

export interface BypassAttempt {
  strategyId: BypassStrategyId;
  url: string;
  contextOptions: Partial<BrowserContextOptions>;
  extraHeaders: Record<string, string>;
  preNavigation?: 'sunbiz_warm' | 'delay';
  postLoadWaitMs: number;
  waitForSelector?: string;
}

export interface DomainBypassProfile {
  domain: string;
  strategies: BypassStrategyId[];
  alternateUrls?: (url: string) => string[];
}

const DOMAIN_PROFILES: DomainBypassProfile[] = [
  {
    domain: 'search.sunbiz.org',
    strategies: ['sunbiz_warm_session', 'sunbiz_direct_entity', 'stealth_full', 'google_referrer'],
    alternateUrls: (url) => rewriteSunbizUrl(url),
  },
  {
    domain: 'bisprofiles.com',
    strategies: ['google_referrer', 'stealth_full', 'slow_human'],
  },
  {
    domain: 'bizapedia.com',
    strategies: ['bizapedia_challenge_wait', 'google_referrer', 'stealth_full', 'slow_human'],
  },
  {
    domain: 'floridaresidentsdirectory.com',
    strategies: ['google_referrer', 'stealth_full', 'slow_human'],
  },
  {
    domain: 'facebook.com',
    strategies: ['facebook_mbasic', 'facebook_mobile', 'google_referrer'],
    alternateUrls: (url) => rewriteFacebookUrl(url),
  },
  {
    domain: 'www.facebook.com',
    strategies: ['facebook_mbasic', 'facebook_mobile', 'google_referrer'],
    alternateUrls: (url) => rewriteFacebookUrl(url),
  },
  {
    domain: 'linkedin.com',
    strategies: ['stealth_full', 'google_referrer', 'slow_human'],
  },
];

const STEALTH_HEADERS: Record<string, string> = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

export function getDomainProfile(hostname: string): DomainBypassProfile | null {
  const host = hostname.toLowerCase();
  return (
    DOMAIN_PROFILES.find((p) => {
      const pd = p.domain.toLowerCase();
      return host === pd || host.endsWith(`.${pd.replace(/^www\./, '')}`) || host.includes(pd.replace(/^www\./, ''));
    }) ?? null
  );
}

export function buildBypassLadder(url: string, maxAttempts: number): BypassAttempt[] {
  const parsed = new URL(url);
  const profile = getDomainProfile(parsed.hostname);
  const strategies = profile?.strategies ?? ['stealth_full', 'google_referrer', 'slow_human'];

  const urls = [url, ...(profile?.alternateUrls?.(url) ?? [])];
  const attempts: BypassAttempt[] = [];

  for (const targetUrl of urls) {
    for (const strategyId of strategies) {
      attempts.push(buildAttempt(strategyId, targetUrl));
      if (attempts.length >= maxAttempts) return attempts;
    }
  }

  return attempts.slice(0, maxAttempts);
}

function buildAttempt(strategyId: BypassStrategyId, url: string): BypassAttempt {
  const base: BypassAttempt = {
    strategyId,
    url,
    contextOptions: {},
    extraHeaders: { ...STEALTH_HEADERS },
    postLoadWaitMs: 0,
  };

  switch (strategyId) {
    case 'stealth_full':
      return {
        ...base,
        contextOptions: { viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' },
        postLoadWaitMs: 1500,
      };

    case 'google_referrer':
      return {
        ...base,
        extraHeaders: {
          ...STEALTH_HEADERS,
          Referer: 'https://www.google.com/',
          'Sec-Fetch-Site': 'cross-site',
        },
        postLoadWaitMs: 2000,
      };

    case 'sunbiz_warm_session':
      return {
        ...base,
        preNavigation: 'sunbiz_warm',
        extraHeaders: { ...STEALTH_HEADERS, Referer: 'https://search.sunbiz.org/' },
        postLoadWaitMs: 2500,
        waitForSelector: 'table, .searchResultDetail, .detailSection, h2',
      };

    case 'sunbiz_direct_entity':
      return {
        ...base,
        url: rewriteSunbizUrl(url)[0] ?? url,
        extraHeaders: { ...STEALTH_HEADERS, Referer: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByOfficerOrRegisteredAgent' },
        postLoadWaitMs: 3000,
        waitForSelector: 'table, .detailSection, h2',
      };

    case 'bizapedia_challenge_wait':
      return {
        ...base,
        extraHeaders: { ...STEALTH_HEADERS, Referer: 'https://www.google.com/' },
        postLoadWaitMs: 12000,
        waitForSelector: 'body:not(:has(.cf-turnstile))',
      };

    case 'facebook_mbasic':
      return {
        ...base,
        url: url.replace(/https:\/\/(www\.)?facebook\.com/i, 'https://mbasic.facebook.com'),
        extraHeaders: { ...STEALTH_HEADERS, Referer: 'https://www.google.com/' },
        postLoadWaitMs: 3000,
      };

    case 'facebook_mobile':
      return {
        ...base,
        url: url.replace(/https:\/\/(www\.)?facebook\.com/i, 'https://m.facebook.com'),
        contextOptions: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
        extraHeaders: { ...STEALTH_HEADERS, Referer: 'https://www.google.com/' },
        postLoadWaitMs: 3000,
      };

    case 'slow_human':
      return {
        ...base,
        preNavigation: 'delay',
        extraHeaders: { ...STEALTH_HEADERS, Referer: 'https://www.google.com/' },
        postLoadWaitMs: 4000,
      };

    case 'alternate_www':
      return {
        ...base,
        url: url.includes('://www.') ? url.replace('://www.', '://') : url.replace('://', '://www.'),
        postLoadWaitMs: 2000,
      };

    default:
      return base;
  }
}

function rewriteSunbizUrl(_url: string): string[] {
  return [];
}

function rewriteFacebookUrl(url: string): string[] {
  return [
    url.replace(/https:\/\/(www\.)?facebook\.com/i, 'https://mbasic.facebook.com'),
    url.replace(/https:\/\/(www\.)?facebook\.com/i, 'https://m.facebook.com'),
  ];
}

export const STEALTH_INIT_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
window.chrome = { runtime: {} };
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters);
`;
