import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from '../db.js';
import { sendToAll, type PushSender } from '../services/push.js';

const subscribeBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export async function pushRoutes(
  app: FastifyInstance,
  opts: { pool: Pool; publicKey: string | undefined; sender: PushSender | undefined },
) {
  const { pool, publicKey, sender } = opts;
  const guard = { preHandler: app.requireUser };

  app.get('/api/push/key', guard, async (_req, reply) => {
    if (!publicKey) return reply.code(503).send({ error: 'push_not_configured' });
    return { publicKey };
  });

  app.post('/api/push/subscribe', guard, async (req, reply) => {
    const body = subscribeBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [body.data.endpoint, body.data.keys.p256dh, body.data.keys.auth],
    );
    return reply.code(204).send();
  });

  app.post('/api/push/unsubscribe', guard, async (req, reply) => {
    const body = z.object({ endpoint: z.string().url() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [body.data.endpoint]);
    return reply.code(204).send();
  });

  app.post('/api/push/test', guard, async (_req, reply) => {
    if (!sender) return reply.code(503).send({ error: 'push_not_configured' });
    const sent = await sendToAll(pool, sender, { title: 'Life Game', body: 'Notifications are working.' });
    return { sent };
  });
}
