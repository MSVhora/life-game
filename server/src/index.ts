import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { startScheduler } from './scheduler.js';
import { createWebPushSender } from './services/push.js';
import { defaultConfigDir } from './services/settings.js';
import { timeTrackerConfig } from './services/timetracker.js';
import { migrate } from './migrate.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

if (config.MIGRATE_ON_START) {
  const applied = await migrate(pool);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
}

const configDir = defaultConfigDir();
const app = await buildApp({ config, pool, configDir });

const sender = config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
  ? createWebPushSender({ publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT })
  : undefined;
if (!sender) app.log.warn('VAPID keys not set: push reminders are disabled');
const timeTracker = timeTrackerConfig(config);
if (!timeTracker) app.log.info('Time tracker not configured: freelance meter is off');
const scheduler = startScheduler({ pool, configDir, sender, log: app.log, timeTracker });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  scheduler.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
