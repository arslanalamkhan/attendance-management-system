import type { z } from 'zod';
import {
  ErrorCode,
  type AppUser,
  type Page,
  type zResetPasswordInput,
  type zUserCreateInput,
  type zUserListQuery,
  type zUserUpdateInput,
} from '@nacta/shared';
import { withTransaction } from '../../db/pool';
import { AppError, notFound, pgCode, validationError } from '../../lib/errors';
import { toPage } from '../../lib/pagination';
import { assertPasswordPolicy, hashPassword } from '../auth/password';
import { revokeUserSessions } from '../auth/sessions';
import type { AuthContext } from '../auth/types';
import * as repo from './repo';

const protectedAccount = (what: string) =>
  new AppError(403, ErrorCode.PROTECTED_ACCOUNT, `The Super Admin account cannot be ${what}`);

export async function list(q: z.output<typeof zUserListQuery>): Promise<Page<AppUser>> {
  const { items, total } = await repo.list(q);
  return toPage(items, total, q);
}

export async function get(id: number): Promise<AppUser> {
  const u = await repo.find(id);
  if (!u) throw notFound('User');
  return u;
}

/** Roles must exist, and the built-in Super Admin role is never handed out through the API. */
async function checkRoles(roleIds: number[], allowSystem: boolean): Promise<number[]> {
  const ids = [...new Set(roleIds)];
  const found = await repo.rolesByIds(ids);
  if (found.length !== ids.length) throw validationError('Invalid request body', { roleIds: 'One or more roles do not exist' });
  if (!allowSystem && found.some((r) => r.is_system)) {
    throw new AppError(403, ErrorCode.PROTECTED_ROLE, 'The Super Admin role cannot be assigned to other users');
  }
  return ids;
}

export async function create(actor: AuthContext, input: z.output<typeof zUserCreateInput>): Promise<AppUser> {
  assertPasswordPolicy(input.temporaryPassword, input.email, 'temporaryPassword');
  const roleIds = await checkRoles(input.roleIds, false);
  const passwordHash = await hashPassword(input.temporaryPassword);
  try {
    const id = await withTransaction(async (client) => {
      const newId = await repo.insert(client, { email: input.email, name: input.name, passwordHash, createdBy: actor.user.id });
      await repo.setRoles(client, newId, roleIds);
      return newId;
    });
    return await get(id);
  } catch (err) {
    if (pgCode(err) === '23505') throw new AppError(409, ErrorCode.DUPLICATE_EMAIL, 'A user with this email already exists');
    throw err;
  }
}

export async function update(actor: AuthContext, id: number, input: z.output<typeof zUserUpdateInput>): Promise<AppUser> {
  const target = await get(id);
  const sameRoles = (ids: number[]) =>
    ids.length === target.roles.length && new Set(ids).size === ids.length && ids.every((r) => target.roles.some((t) => t.id === r));

  if (target.isSuperAdmin) {
    if (input.status !== undefined && input.status !== target.status) throw protectedAccount('disabled');
    if (input.roleIds !== undefined && !sameRoles(input.roleIds)) throw protectedAccount('given different roles');
  }
  if (id === actor.user.id && input.status === 'disabled') {
    throw new AppError(403, ErrorCode.FORBIDDEN, 'You cannot disable your own account');
  }
  const roleIds = input.roleIds !== undefined ? await checkRoles(input.roleIds, target.isSuperAdmin) : undefined;

  await withTransaction(async (client) => {
    await repo.updateFields(client, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (roleIds && !target.isSuperAdmin) await repo.setRoles(client, id, roleIds);
    if (input.status === 'disabled') await revokeUserSessions(id, null, client);
  });
  return get(id);
}

export async function remove(actor: AuthContext, id: number): Promise<void> {
  const target = await get(id);
  if (target.isSuperAdmin) throw protectedAccount('deleted');
  if (id === actor.user.id) throw new AppError(403, ErrorCode.FORBIDDEN, 'You cannot delete your own account');
  if (!(await repo.remove(id))) throw notFound('User');
}

/** Only a Super Admin may act on the Super Admin account's credentials or sessions. */
function assertMayTouchCredentials(actor: AuthContext, target: AppUser): void {
  if (target.isSuperAdmin && !actor.user.isSuperAdmin) throw protectedAccount('changed by other users');
}

export async function resetPassword(actor: AuthContext, id: number, input: z.output<typeof zResetPasswordInput>): Promise<void> {
  const target = await get(id);
  assertMayTouchCredentials(actor, target);
  assertPasswordPolicy(input.temporaryPassword, target.email, 'temporaryPassword');
  const passwordHash = await hashPassword(input.temporaryPassword);
  await withTransaction(async (client) => {
    await repo.setPassword(client, id, passwordHash);
    await revokeUserSessions(id, null, client);
  });
}

export async function revokeSessions(actor: AuthContext, id: number): Promise<{ revoked: number }> {
  const target = await get(id);
  assertMayTouchCredentials(actor, target);
  return { revoked: await revokeUserSessions(id, null) };
}

export async function unlock(id: number): Promise<AppUser> {
  const target = await get(id);
  if (target.isSuperAdmin) throw protectedAccount('unlocked by other users');
  await repo.unlock(id);
  return get(id);
}
