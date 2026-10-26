import { z } from 'zod';

const placeholder = (v: string) => /change-?me|example|generate/i.test(v);

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters')
    .refine((v) => !placeholder(v), 'SESSION_SECRET is still a placeholder'),
  ADMIN_PASSWORD_HASH: z
    .string()
    .startsWith('scrypt:', 'ADMIN_PASSWORD_HASH must come from `npm run hash-password`'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24 * 14),
  MIGRATE_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
