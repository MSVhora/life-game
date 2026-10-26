import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db.js';

export async function healthRoutes(app: FastifyInstance, opts: { pool: Pool }) {
  app.get('/health', async (_req, reply) => {
    try {
      await opts.pool.query('SELECT 1');
      return { status: 'ok', db: true };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: false });
    }
  });
}
