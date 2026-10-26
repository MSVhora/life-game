import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin } from './auth/plugin.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { gameRoutes } from './routes/game.js';
import { pushRoutes } from './routes/push.js';
import { createWebPushSender, type PushSender } from './services/push.js';
import { healthRoutes } from './routes/health.js';
import { defaultConfigDir } from './services/settings.js';

export interface AppDeps {
  config: Config;
  pool: Pool;
  /** Directory with config/*.local.yml and *.example.yml. Defaults to ../config. */
  configDir?: string;
  /** Injectable clock, so tests can move time. */
  clock?: () => Date;
  /** Overrides the real web-push sender (tests). */
  pushSender?: PushSender;
}

export const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export async function buildApp({ config, pool, configDir = defaultConfigDir(), clock = () => new Date(), pushSender }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: true, // runs behind nginx; needed for the real client IP
    bodyLimit: 5 * 1024 * 1024,
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
  });

  await app.register(authPlugin, { config, pool });
  await app.register(healthRoutes, { pool });
  await app.register(authRoutes, { config });
  await app.register(deviceRoutes, { pool });
  await app.register(gameRoutes, { pool, configDir, clock });

  const vapid = config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
    ? { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT }
    : undefined;
  const sender = pushSender ?? (vapid ? createWebPushSender(vapid) : undefined);
  await app.register(pushRoutes, { pool, publicKey: config.VAPID_PUBLIC_KEY ?? (pushSender ? 'test-public-key' : undefined), sender });

  await app.register(fastifyStatic, { root: publicDir, index: 'index.html', maxAge: 0 });

  return app;
}
