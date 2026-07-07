import { z } from 'zod';

export const CrawlScopeSchema = z.object({
  allowedDomains: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(0).default(3),
  maxPages: z.number().int().min(1).default(1000),
  excludePatterns: z.array(z.string()).default([]),
  respectRobotsTxt: z.boolean().default(true),
  includeHiddenContent: z.boolean().default(false),
  whitelistedFormActions: z.array(z.string()).default([]),
});

export const ConfigSchema = z.object({
  dataDir: z.string().default('./data'),
  dbPath: z.string().default('./data/ghost-chain.db'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  concurrency: z.number().int().min(1).max(20).default(3),
  pageLoadTimeoutMs: z.number().int().min(5000).default(30000),
  networkIdleTimeoutMs: z.number().int().min(1000).default(5000),
  retryMaxAttempts: z.number().int().min(1).default(3),
  retryBaseDelayMs: z.number().int().min(100).default(2000),
  defaultRateLimitPerDomain: z.number().min(0.1).default(1),
  userAgents: z.array(z.string()).min(1),
  api: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(3847),
  }).default({}),
  scope: CrawlScopeSchema.default({}),
  piiScrubMode: z.enum(['full', 'sensitive_only']).default('sensitive_only'),
  spaWaitEnabled: z.boolean().default(true),
  fetchExternalStylesheets: z.boolean().default(true),
  domMutationQuietMs: z.number().int().min(500).default(2000),
  blockedHosts: z.array(z.string()).default([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254',
  ]),
  blockedIpRanges: z.array(z.string()).default([
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ]),
});

export type CrawlScope = z.infer<typeof CrawlScopeSchema>;
export type AppConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return ConfigSchema.parse({
    userAgents: DEFAULT_USER_AGENTS,
    ...overrides,
  });
}
