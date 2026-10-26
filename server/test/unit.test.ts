import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { generateDeviceToken, hashToken } from '../src/auth/tokens.js';
import { loadConfigFile } from '../src/config-files.js';
import { loadConfig } from '../src/config.js';

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('a long enough password');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash).not.toContain('$');
    expect(await verifyPassword('a long enough password', hash)).toBe(true);
    expect(await verifyPassword('wrong password here', hash)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt:1:2:3:4:5')).toBe(false);
  });
});

describe('device tokens', () => {
  it('generates unique prefixed tokens and stable hashes', () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).toMatch(/^lg_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('config validation', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost/db',
    SESSION_SECRET: 'x'.repeat(40),
    ADMIN_PASSWORD_HASH: 'scrypt:1:2:3:4:5',
  };

  it('accepts a valid environment and applies defaults', () => {
    const c = loadConfig(base);
    expect(c.PORT).toBe(3000);
    expect(c.MIGRATE_ON_START).toBe(true);
  });

  it('rejects placeholder or short secrets', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'change-me' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'change-me-'.repeat(5) })).toThrow(
      /placeholder/,
    );
  });

  it('rejects a password hash in the wrong format', () => {
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD_HASH: 'plain' })).toThrow(/hash-password/);
  });
});

describe('local-over-example config files', () => {
  it('prefers *.local.* and falls back to *.example.*', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lg-cfg-'));
    writeFileSync(path.join(dir, 'player.example.yml'), 'day:\n  ends_at: "23:00"\n');
    const example = loadConfigFile<{ day: { ends_at: string } }>(dir, 'player');
    expect(example.source).toBe('example');
    expect(example.data.day.ends_at).toBe('23:00');

    writeFileSync(path.join(dir, 'player.local.yml'), 'day:\n  ends_at: "22:00"\n');
    const local = loadConfigFile<{ day: { ends_at: string } }>(dir, 'player');
    expect(local.source).toBe('local');
    expect(local.data.day.ends_at).toBe('22:00');
  });

  it('throws when neither file exists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lg-cfg-'));
    expect(() => loadConfigFile(dir, 'nothing')).toThrow(/No nothing/);
  });
});
