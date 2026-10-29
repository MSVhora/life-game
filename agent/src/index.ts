#!/usr/bin/env node
import { loadConfig } from './config.js';
import { FatalError, loadState, saveState, syncOnce } from './sync.js';

const once = process.argv.includes('--once');
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}

const state = loadState(cfg.stateDir);
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; });

let failures = 0;
let lastProblems = '';
let lastLogged = 0;
do {
  try {
    const r = await syncOnce(cfg, state);
    saveState(cfg.stateDir, state);
    const problems = r.errors.join(' | ');
    // Log when problems change, and otherwise at most every 15 minutes, so the log stays small.
    if (problems !== lastProblems || Date.now() - lastLogged > 15 * 60_000) {
      log(problems ? `sent ${r.sent}; problems: ${problems}` : `ok: sent ${r.sent} events from ${r.buckets} buckets`);
      lastLogged = Date.now();
    }
    lastProblems = problems;
    failures = r.errors.length ? failures + 1 : 0;
  } catch (e) {
    if (e instanceof FatalError) {
      log(`stopping: ${e.message}`);
      process.exit(3);
    }
    failures++;
    log(`sync failed: ${(e as Error).message}`);
  }
  if (once || stopping) break;
  // Back off while the server or ActivityWatch is down, up to 5 minutes.
  const wait = Math.min(300, cfg.intervalSeconds * 2 ** Math.min(failures, 3));
  await new Promise((r) => setTimeout(r, wait * 1000));
} while (!stopping);
