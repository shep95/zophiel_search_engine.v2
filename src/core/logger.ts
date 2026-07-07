import pino from 'pino';
import type { AppConfig } from '../config/index.js';

export function createLogger(config: AppConfig) {
  const isDev = process.env.NODE_ENV !== 'production';

  return pino({
    level: config.logLevel,
    base: { service: 'ghost-chain' },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;

export function childLogger(logger: Logger, bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
