import { Router, type Request } from 'express';
import { ErrorCode, zChangePasswordInput, zLoginInput } from '@nacta/shared';
import { AppError, notFound } from '../../lib/errors';
import { asyncHandler } from '../../lib/http';
import { parseBody } from '../../lib/validate';
import {
  authOf,
  clearSessionCookie,
  csrfProtect,
  passwordGate,
  requireAuth,
  setSessionCookie,
} from '../../middleware/auth';
import { audit, userLabel } from '../audit/service';
import { recordLoginAttempt } from './rateLimit';
import * as service from './service';
import type { LoginTrace } from './service';
import * as sessions from './sessions';

/** Client IP as Express sees it (trust proxy is off), without the IPv4-mapped prefix. */
export const clientIp = (req: Request): string | null => (req.ip ? req.ip.replace(/^::ffff:/i, '') : null);

const LOGIN_FAILURES: string[] = [ErrorCode.INVALID_CREDENTIALS, ErrorCode.ACCOUNT_LOCKED, ErrorCode.ACCOUNT_DISABLED];
const REASON_TEXT = { unknown_email: 'unknown email', bad_password: 'incorrect password', locked: 'account is locked', disabled: 'account is disabled' } as const;

/** login_failed (and auth.locked when this attempt tripped the lock). The attempted email goes in metadata; userId is null for unknown emails. */
function auditLoginFailure(req: Request, email: string, trace: LoginTrace, err: unknown): void {
  if (!(err instanceof AppError) || !LOGIN_FAILURES.includes(err.code)) return;
  const reason = trace.reason ?? 'bad_password';
  const actor = trace.user ? { id: trace.user.id, email: trace.user.email, name: trace.user.name } : null;
  audit(req, {
    action: 'auth.login_failed',
    outcome: 'failure',
    actor,
    sessionId: null,
    ...(trace.user ? { entityType: 'user' as const, entityId: trace.user.id, entityLabel: userLabel(trace.user) } : {}),
    summary: `Failed sign-in for ${email}: ${REASON_TEXT[reason]}`,
    metadata: { email, reason },
  });
  if (trace.justLocked && trace.user) {
    audit(req, {
      action: 'auth.locked',
      outcome: 'failure',
      actor,
      sessionId: null,
      entityType: 'user',
      entityId: trace.user.id,
      entityLabel: userLabel(trace.user),
      summary: `Account ${trace.user.email} locked after repeated failed sign-ins`,
      metadata: { email, lockedUntil: trace.lockedUntil?.toISOString() ?? null },
    });
  }
}

export const authRouter = Router();

// Public: the only endpoint that needs neither a session nor a CSRF token.
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const ip = clientIp(req) ?? 'unknown';
    const retryAfter = recordLoginAttempt(ip);
    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      throw new AppError(429, ErrorCode.RATE_LIMITED, 'Too many sign-in attempts. Try again later', {
        retryAfterSeconds: retryAfter,
      });
    }
    const input = parseBody(zLoginInput, req.body);
    const trace: LoginTrace = {};
    let result: service.LoginResult;
    try {
      result = await service.login(input, clientIp(req), req.get('user-agent') ?? null, trace);
    } catch (err) {
      auditLoginFailure(req, input.email, trace, err);
      throw err;
    }
    const { token, info } = result;
    audit(req, {
      action: 'auth.login',
      actor: { id: info.user.id, email: info.user.email, name: info.user.name },
      sessionId: sessions.hashToken(token),
      entityType: 'user',
      entityId: info.user.id,
      entityLabel: userLabel(info.user),
      summary: `Signed in as ${userLabel(info.user)}`,
      metadata: { mustChangePassword: info.user.mustChangePassword },
    });
    setSessionCookie(res, token);
    res.json(info);
  }),
);

// Everything below needs a session. These three stay reachable while a password change is pending.
authRouter.use(requireAuth, csrfProtect);

authRouter.get('/me', (req, res) => {
  res.json(service.toSessionInfo(authOf(req)));
});

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const ctx = authOf(req);
    audit(req, { action: 'auth.logout', entityType: 'user', entityId: ctx.user.id, entityLabel: userLabel(ctx.user), summary: `Signed out ${userLabel(ctx.user)}` });
    await sessions.revokeSession(ctx.session.id);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    const ctx = authOf(req);
    const info = await service.changePassword(ctx, parseBody(zChangePasswordInput, req.body));
    audit(req, { action: 'auth.password_changed', entityType: 'user', entityId: ctx.user.id, entityLabel: userLabel(ctx.user), summary: `Changed own password (${userLabel(ctx.user)}); other sessions ended`, metadata: { wasForced: ctx.user.mustChangePassword } });
    res.json(info);
  }),
);

authRouter.use(passwordGate);

authRouter.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    res.json(await service.listSessions(authOf(req)));
  }),
);

authRouter.post(
  '/sessions/revoke-others',
  asyncHandler(async (req, res) => {
    const ctx = authOf(req);
    const revoked = await sessions.revokeUserSessions(ctx.user.id, ctx.session.id);
    audit(req, { action: 'auth.session_revoked', entityType: 'user', entityId: ctx.user.id, entityLabel: userLabel(ctx.user), summary: `Ended ${revoked} other session${revoked === 1 ? '' : 's'} of ${userLabel(ctx.user)}`, metadata: { scope: 'others', revoked } });
    res.json({ revoked });
  }),
);

authRouter.delete(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const ctx = authOf(req);
    const id = String(req.params.id ?? '');
    if (!/^[0-9a-f]{64}$/.test(id) || !(await sessions.revokeOwnSession(ctx.user.id, id))) throw notFound('Session');
    audit(req, { action: 'auth.session_revoked', entityType: 'user', entityId: ctx.user.id, entityLabel: userLabel(ctx.user), summary: `Ended ${id === ctx.session.id ? 'the current' : 'another'} session of ${userLabel(ctx.user)}`, metadata: { scope: 'one', current: id === ctx.session.id, sessionRef: id.slice(0, 8) } });
    if (id === ctx.session.id) clearSessionCookie(res);
    res.status(204).end();
  }),
);

