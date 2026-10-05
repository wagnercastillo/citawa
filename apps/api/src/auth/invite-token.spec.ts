import { hashInviteToken, INVITE_TTL_MS, newInviteToken } from './invite-token';

describe('invite-token', () => {
  it('genera token aleatorio, su hash sha256 y vence en 72 h', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const a = newInviteToken(now);
    const b = newInviteToken(now);
    expect(a.token).not.toEqual(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toEqual(hashInviteToken(a.token));
    expect(a.expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    expect(INVITE_TTL_MS).toBe(72 * 60 * 60 * 1000);
  });
});
