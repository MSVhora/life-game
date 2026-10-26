import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';
import { hashToken, TOKEN_PREFIX } from './tokens.js';

export const SESSION_COOKIE = 'lg_session';

declare module 'fastify' {
  interface FastifyRequest {
    device?: { id: string; name: string };
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireDevice: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthDeps {
  config: Config;
  pool: Pool;
}

export function isSecureUrl(url: string): boolean {
  return url.startsWith('https://');
}

export const authPlugin = fp(async (app: FastifyInstance, deps: AuthDeps) => {
  const { config, pool } = deps;
  await app.register(cookie, { secret: config.SESSION_SECRET });

  app.decorate('requireUser', async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : undefined;
    const expiresAt = unsigned?.valid ? Number(unsigned.value) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.decorate('requireDevice', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token.startsWith(TOKEN_PREFIX)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const { rows } = await pool.query<{ id: string; name: string }>(
      `UPDATE devices SET last_seen_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING id, name`,
      [hashToken(token)],
    );
    const device = rows[0];
    if (!device) return reply.code(401).send({ error: 'unauthorized' });
    req.device = device;
  });
});
