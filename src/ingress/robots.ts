import { createRequire } from 'node:module';
import type { Logger } from '../core/logger.js';
import { GhostChainError } from '../core/types.js';

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (url: string, robotstxt: string) => {
  isAllowed(url: string, ua?: string): boolean | undefined;
};

const ROBOTS_CACHE = new Map<string, ReturnType<typeof robotsParser>>();

export async function checkRobotsAllowed(
  url: string,
  userAgent: string,
  respectRobotsTxt: boolean,
  logger: Logger,
): Promise<void> {
  if (!respectRobotsTxt) return;

  const parsed = new URL(url);
  const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  let robots = ROBOTS_CACHE.get(robotsUrl);

  if (!robots) {
    try {
      const response = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': userAgent },
      });
      const body = response.ok ? await response.text() : '';
      robots = robotsParser(robotsUrl, body);
      ROBOTS_CACHE.set(robotsUrl, robots);
    } catch (error) {
      logger.warn({ robotsUrl, error }, 'Failed to fetch robots.txt; allowing crawl');
      return;
    }
  }

  if (!robots.isAllowed(url, userAgent)) {
    throw new GhostChainError('Blocked by robots.txt', 'ROBOTS_BLOCKED', false, { url });
  }
}
