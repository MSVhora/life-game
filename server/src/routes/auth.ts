import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, isSecureUrl } from '../auth/plugin.js';
import { verifyPassword } from '../auth/password.js';
import type { Config } from '../config.js';

const loginBody = z.object({ password: z.string().min(1).max(512) });

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

/** Small in-memory limiter: enough for a single-user service behind nginx. */
function createLimiter() {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= MAX_ATTEMPTS;
  };
}

export async function authRoutes(app: FastifyInstance, opts: { config: Config }) {
  const { config } = opts;
  const allow = createLimiter();

  app.post('/api/auth/login', async (req, reply) => {
    if (!allow(req.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

    const ok = await verifyPassword(body.data.password, config.ADMIN_PASSWORD_HASH);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });

    const ttlMs = config.SESSION_TTL_HOURS * 3_600_000;
    reply.setCookie(SESSION_COOKIE, String(Date.now() + ttlMs), {
      signed: true,
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecureUrl(config.PUBLIC_URL),
      path: '/',
      maxAge: Math.floor(ttlMs / 1000),
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.requireUser }, async () => ({ ok: true }));
}
