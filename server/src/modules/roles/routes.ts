import { Router } from 'express';
import { PERMISSIONS, zRoleInput, type AuditChange, type Role } from '@nacta/shared';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../audit/service';
import * as repo from './repo';
import * as service from './service';

export const rolesRouter = Router();

const permLabels = (keys: readonly string[]): string[] => keys.map((k) => (k in PERMISSIONS ? PERMISSIONS[k as keyof typeof PERMISSIONS].label : k)).sort();
async function wingScopeText(r: Pick<Role, 'allWings' | 'wingIds'>): Promise<string> {
  if (r.allWings) return 'All wings';
  const names = await repo.wingNames(r.wingIds);
  return names.length ? names.join(', ') : 'No wings';
}

// Listing is also needed by the user editor (to pick roles).
rolesRouter.get(
  '/',
  requirePermission('roles.manage', 'users.manage'),
  asyncHandler(async (_req, res) => {
    res.json(await service.list());
  }),
);

rolesRouter.post(
  '/',
  requirePermission('roles.manage'),
  asyncHandler(async (req, res) => {
    const role = await service.create(parseBody(zRoleInput, req.body));
    const scope = await wingScopeText(role);
    audit(req, { action: 'role.create', entityType: 'role', entityId: role.id, entityLabel: role.name, summary: `Created role ${role.name} (${role.permissions.length} permission${role.permissions.length === 1 ? '' : 's'}; ${scope})`, metadata: { permissions: permLabels(role.permissions), wingScope: scope } });
    res.status(201).json(role);
  }),
);

rolesRouter.put(
  '/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Role');
    const input = parseBody(zRoleInput, req.body);
    const before = await service.get(id);
    const after = await service.update(id, input);
    const changes: AuditChange[] = [];
    if (before.name !== after.name) changes.push({ field: 'name', before: before.name, after: after.name });
    if ((before.description ?? null) !== (after.description ?? null)) changes.push({ field: 'description', before: before.description, after: after.description });
    const was = new Set(before.permissions);
    const now = new Set(after.permissions);
    const added = after.permissions.filter((p) => !was.has(p));
    const removed = before.permissions.filter((p) => !now.has(p));
    if (added.length) changes.push({ field: 'permissions added', before: null, after: permLabels(added) });
    if (removed.length) changes.push({ field: 'permissions removed', before: permLabels(removed), after: null });
    const [scopeBefore, scopeAfter] = [await wingScopeText(before), await wingScopeText(after)];
    if (scopeBefore !== scopeAfter) changes.push({ field: 'wing scope', before: scopeBefore, after: scopeAfter });
    if (changes.length) {
      const parts: string[] = [];
      if (before.name !== after.name) parts.push(`name ${before.name} -> ${after.name}`);
      if (added.length) parts.push(`added ${permLabels(added).join(', ')}`);
      if (removed.length) parts.push(`removed ${permLabels(removed).join(', ')}`);
      if (scopeBefore !== scopeAfter) parts.push(`wings ${scopeBefore} -> ${scopeAfter}`);
      if (changes.some((c) => c.field === 'description')) parts.push('description changed');
      audit(req, { action: 'role.update', entityType: 'role', entityId: id, entityLabel: after.name, summary: `Edited role ${after.name}: ${parts.join('; ')}`, changes });
    }
    res.json(after);
  }),
);

rolesRouter.delete(
  '/:id',
  requirePermission('roles.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Role');
    const before = await service.get(id);
    await service.remove(id);
    audit(req, { action: 'role.delete', entityType: 'role', entityId: id, entityLabel: before.name, summary: `Deleted role ${before.name}`, metadata: { permissions: permLabels(before.permissions) } });
    res.status(204).end();
  }),
);

/** GET /permissions: the permission catalogue, identical to PERMISSIONS in @nacta/shared. */
export const permissionsRouter = Router();
permissionsRouter.get('/', requirePermission('roles.manage', 'users.manage'), (_req, res) => {
  res.json(PERMISSIONS);
});

