import { Router } from 'express';
import { type AppUser, zResetPasswordInput, zUserCreateInput, zUserListQuery, zUserUpdateInput } from '@nacta/shared';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody, parseQuery } from '../../lib/validate';
import { authOf, requirePermission } from '../../middleware/auth';
import { audit, changeSummary, diff, userLabel } from '../audit/service';
import * as service from './service';

/** Role names (never ids) in audit entries. */
const roleNames = (u: { roles: { name: string }[] }): string => u.roles.map((r) => r.name).join(', ') || 'none';
const flat = (u: AppUser): Record<string, unknown> => ({ name: u.name, status: u.status, roles: u.roles.map((r) => r.name).sort() });

export const usersRouter = Router();
usersRouter.use(requirePermission('users.manage'));

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await service.list(parseQuery(zUserListQuery, req.query)));
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const created = await service.create(authOf(req), parseBody(zUserCreateInput, req.body));
    audit(req, { action: 'user.create', entityType: 'user', entityId: created.id, entityLabel: userLabel(created), summary: `Created user ${userLabel(created)} with role ${roleNames(created)}; password must be changed at first sign-in`, metadata: { roles: created.roles.map((r) => r.name) } });
    res.status(201).json(created);
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.get(idParam(req.params.id, 'User')));
  }),
);

usersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'User');
    const input = parseBody(zUserUpdateInput, req.body);
    const before = await service.get(id);
    const after = await service.update(authOf(req), id, input);
    const changes = diff(flat(before), flat(after), ['name', 'status', 'roles']);
    if (changes.length) {
      audit(req, { action: 'user.update', entityType: 'user', entityId: id, entityLabel: userLabel(after), summary: `Edited user ${userLabel(after)}: ${changeSummary(changes)}`, changes });
    }
    res.json(after);
  }),
);

usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'User');
    const before = await service.get(id);
    await service.remove(authOf(req), id);
    audit(req, { action: 'user.delete', entityType: 'user', entityId: id, entityLabel: userLabel(before), summary: `Deleted user ${userLabel(before)}`, metadata: { roles: before.roles.map((r) => r.name) } });
    res.status(204).end();
  }),
);

usersRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'User');
    const input = parseBody(zResetPasswordInput, req.body);
    const target = await service.get(id);
    await service.resetPassword(authOf(req), id, input);
    audit(req, { action: 'user.reset_password', entityType: 'user', entityId: id, entityLabel: userLabel(target), summary: `Reset password for ${userLabel(target)}; all their sessions ended and a new password is required at next sign-in`, metadata: { mustChangePassword: true } });
    res.status(204).end();
  }),
);

usersRouter.post(
  '/:id/revoke-sessions',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'User');
    const target = await service.get(id);
    const result = await service.revokeSessions(authOf(req), id);
    audit(req, { action: 'user.revoke_sessions', entityType: 'user', entityId: id, entityLabel: userLabel(target), summary: `Signed ${userLabel(target)} out everywhere (${result.revoked} session${result.revoked === 1 ? '' : 's'} ended)`, metadata: { revoked: result.revoked } });
    res.json(result);
  }),
);

usersRouter.post(
  '/:id/unlock',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'User');
    const result = await service.unlock(id);
    audit(req, { action: 'user.unlock', entityType: 'user', entityId: id, entityLabel: userLabel(result), summary: `Unlocked ${userLabel(result)}` });
    res.json(result);
  }),
);

