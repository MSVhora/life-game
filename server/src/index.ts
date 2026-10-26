import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

if (config.MIGRATE_ON_START) {
  const applied = await migrate(pool);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
}

const app = await buildApp({ config, pool });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
