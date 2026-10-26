import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_PREFIX = 'lg_';

/** 256-bit random token. Shown to the user once; only its hash is stored. */
export function generateDeviceToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
