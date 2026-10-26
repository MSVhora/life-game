import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateDeviceToken, hashToken } from '../auth/tokens.js';
import type { Pool } from '../db.js';

const createBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['android', 'mac', 'web', 'other']).default('other'),
});
const idParams = z.object({ id: z.string().uuid() });

export async function deviceRoutes(app: FastifyInstance, opts: { pool: Pool }) {
  const { pool } = opts;

  // Create a device token. The token is returned once and never stored in clear text.
  app.post('/api/devices', { preHandler: app.requireUser }, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const token = generateDeviceToken();
    const { rows } = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO devices (name, kind, token_hash) VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [body.data.name, body.data.kind, hashToken(token)],
    );
    return reply.code(201).send({ id: rows[0]!.id, name: body.data.name, kind: body.data.kind, token });
  });

  app.get('/api/devices', { preHandler: app.requireUser }, async () => {
    const { rows } = await pool.query(
      `SELECT id, name, kind, created_at, last_seen_at, revoked_at
         FROM devices ORDER BY created_at`,
    );
    return { devices: rows };
  });

  app.delete('/api/devices/:id', { preHandler: app.requireUser }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const { rowCount } = await pool.query(
      `UPDATE devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [params.data.id],
    );
    if (!rowCount) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  // Used by device apps to confirm their token works.
  app.get('/api/device/ping', { preHandler: app.requireDevice }, async (req) => ({
    ok: true,
    device: req.device!.name,
  }));
}
