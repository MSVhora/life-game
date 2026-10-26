import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin } from './auth/plugin.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  config: Config;
  pool: Pool;
}

export async function buildApp({ config, pool }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: true, // runs behind nginx; needed for the real client IP
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(authPlugin, { config, pool });
  await app.register(healthRoutes, { pool });
  await app.register(authRoutes, { config });
  await app.register(deviceRoutes, { pool });

  return app;
}
