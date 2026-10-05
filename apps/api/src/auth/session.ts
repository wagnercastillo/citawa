import { CookieOptions } from 'express';
import { Role } from '../users/role.enum';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
}

export interface AuthUser {
  id: string;
  role: Role;
  clinicId: string | null;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
