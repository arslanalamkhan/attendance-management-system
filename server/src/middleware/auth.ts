import { timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { ErrorCode, PERMISSIONS, type Permission } from '@nacta/shared';
import { config } from '../config';
import { AppError } from '../lib/errors';
import { auditDenied, routeOf } from '../modules/audit/service';
import { resolveToken, SESSION_COOKIE, touchSession } from '../modules/auth/sessions';
import type { AuthContext } from '../modules/auth/types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth / optionalAuth. */
      auth?: AuthContext;
    }
  }
}

export const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
  secure: config.cookieSecure,
});

export const setSessionCookie = (res: Response, token: string): void => {
  res.cookie(SESSION_COOKIE, token, cookieOptions());
};
export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
};

/** Minimal Cookie header parser (no cookie-parser dependency). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

const unauthenticated = () => new AppError(401, ErrorCode.UNAUTHENTICATED, 'Sign in to continue');

/** Requires a valid session. Sets req.auth, refreshes last_seen_at at most once a minute. */
export const requireAuth: RequestHandler = (req, res, next) => {
  void (async () => {
    const found = await resolveToken(readCookie(req, SESSION_COOKIE));
    if (found.kind === 'none') throw unauthenticated();
    if (found.kind === 'dead') {
      clearSessionCookie(res);
      throw unauthenticated();
    }
    // Background polls (permission refresh) must not keep an abandoned tab's session alive.
    if (found.stale && req.get('x-background-refresh') !== '1') await touchSession(found.ctx.session.id);
    req.auth = found.ctx;
  })().then(() => next(), next);
};

/** Sets req.auth when a valid session exists; never fails and never refreshes the idle timer. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  void (async () => {
    try {
      const found = await resolveToken(readCookie(req, SESSION_COOKIE));
      if (found.kind === 'ok') req.auth = found.ctx;
    } catch {
      /* treated as signed out */
    }
  })().then(() => next());
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Mutating requests must carry X-CSRF-Token equal to the session's token. Runs after requireAuth. */
export const csrfProtect: RequestHandler = (req, _res, next) => {
  if (!MUTATING.has(req.method)) return next();
  const sent = req.get('x-csrf-token');
  const expected = req.auth?.session.csrfToken;
  if (!sent || !expected || !safeEqual(sent, expected)) {
    return next(new AppError(403, ErrorCode.CSRF_INVALID, 'Missing or invalid CSRF token'));
  }
  next();
};

/** While the account must change its password, every route using this guard answers 403 PASSWORD_CHANGE_REQUIRED. */
export const passwordGate: RequestHandler = (req, _res, next) => {
  if (req.auth?.user.mustChangePassword) {
    return next(new AppError(403, ErrorCode.PASSWORD_CHANGE_REQUIRED, 'You must change your password before continuing'));
  }
  next();
};

/** Record a denied attempt (rate limited per session and route). */
function denyAudit(req: Request, keys: Permission[]): void {
  const labels = keys.map((k) => PERMISSIONS[k].label).join(' or ');
  auditDenied(req, `Denied: ${req.method} ${routeOf(req)} needs "${labels}"`, { permission: keys.length === 1 ? keys[0] : keys });
}

/** Any-of permission check. Super Admin holds every key. */
export const requirePermission =
  (...keys: Permission[]): RequestHandler =>
  (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(unauthenticated());
    if (keys.some((k) => auth.permissions.has(k))) return next();
    denyAudit(req, keys);
    next(new AppError(403, ErrorCode.FORBIDDEN, 'You do not have permission to do this'));
  };

/**
 * Actions reserved for the Super Admin account itself, not grantable through any role or permission
 * (e.g. deleting an employee, which also deletes their leave, corrections and computed attendance).
 */
export const requireSuperAdmin =
  (what: string): RequestHandler =>
  (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(unauthenticated());
    if (auth.user.isSuperAdmin) return next();
    auditDenied(req, `Denied: ${req.method} ${routeOf(req)} is reserved for the Super Admin`, { reservedFor: 'super_admin' });
    next(new AppError(403, ErrorCode.FORBIDDEN, `Only the Super Admin can ${what}`));
  };

/** For rules needing several permissions at once (AND). */
export function assertPermission(req: Request, key: Permission): void {
  if (!req.auth) throw unauthenticated();
  if (!req.auth.permissions.has(key)) {
    denyAudit(req, [key]);
    throw new AppError(403, ErrorCode.FORBIDDEN, `You need the "${PERMISSIONS[key].label}" permission to do this`);
  }
}

/** The authenticated context; only call behind requireAuth. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

