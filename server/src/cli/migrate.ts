import { createPool } from '../db.js';
import { migrate } from '../migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = createPool(url);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
} finally {
  await pool.end();
}
