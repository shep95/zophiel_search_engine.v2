import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../core/logger.js';
import { GhostChainCrawler } from '../crawler.js';

const SeedBodySchema = z.object({
  urls: z.array(z.string().url().or(z.string().min(3))).min(1),
  priority: z.number().optional(),
  allowedDomains: z.array(z.string()).optional(),
  maxDepth: z.number().int().min(0).max(10).optional(),
  maxPages: z.number().int().min(1).max(100000).optional(),
});

const SearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function startApiServer(crawler: GhostChainCrawler) {
  const config = loadConfig();
  const logger = createLogger(config);
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok', service: 'ghost-chain' }));

  app.get('/stats', async () => crawler.getStats());

  app.post('/seed', async (request, reply) => {
    const parsed = SeedBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const accepted = crawler.seed(parsed.data.urls, parsed.data.priority ?? 10);
    return { accepted, rejected: parsed.data.urls.length - accepted.length };
  });

  app.get('/search', async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    }

    const hits = crawler.search(parsed.data.q, parsed.data.limit);
    return { query: parsed.data.q, count: hits.length, hits };
  });

  await app.listen({ host: config.api.host, port: config.api.port });
  logger.info({ host: config.api.host, port: config.api.port }, 'Ghost Chain API listening');
  return app;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const config = loadConfig();
  const logger = createLogger(config);
  const crawler = new GhostChainCrawler(config, logger);

  process.on('SIGINT', async () => {
    await crawler.close();
    process.exit(0);
  });

  await crawler.init();
  await startApiServer(crawler);
}
