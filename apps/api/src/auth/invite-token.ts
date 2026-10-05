import { createHash, randomBytes } from 'crypto';

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newInviteToken(now: Date = new Date()): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS) };
}
