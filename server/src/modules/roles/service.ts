import type { z } from 'zod';
import { ErrorCode, type Role, type zRoleInput } from '@nacta/shared';
import { withTransaction } from '../../db/pool';
import { AppError, notFound, pgCode, validationError } from '../../lib/errors';
import * as repo from './repo';

const duplicate = () => new AppError(409, ErrorCode.DUPLICATE_ROLE, 'A role with this name already exists');
const protectedRole = (what: string) => new AppError(403, ErrorCode.PROTECTED_ROLE, `The Super Admin role cannot be ${what}`);

export const list = repo.list;

export async function get(id: number): Promise<Role> {
  const r = await repo.find(id);
  if (!r) throw notFound('Role');
  return r;
}

async function normalise(input: z.output<typeof zRoleInput>): Promise<repo.RoleFields> {
  if (!input.allWings && input.wingIds.length === 0) {
    throw validationError('Invalid request body', { wingIds: 'Choose at least one wing, or allow all wings' });
  }
  const wingIds = input.allWings ? [] : [...new Set(input.wingIds)];
  if (wingIds.length && (await repo.existingWingIds(wingIds)).length !== wingIds.length) {
    throw validationError('Invalid request body', { wingIds: 'One or more wings do not exist' });
  }
  return {
    name: input.name,
    description: input.description,
    permissions: [...new Set(input.permissions)],
    allWings: input.allWings,
    wingIds,
  };
}

export async function create(input: z.output<typeof zRoleInput>): Promise<Role> {
  const fields = await normalise(input);
  try {
    const id = await withTransaction((client) => repo.insert(client, fields));
    return await get(id);
  } catch (err) {
    throw pgCode(err) === '23505' ? duplicate() : err;
  }
}

export async function update(id: number, input: z.output<typeof zRoleInput>): Promise<Role> {
  const current = await get(id);
  if (current.isSystem) throw protectedRole('edited');
  const fields = await normalise(input);
  try {
    await withTransaction((client) => repo.update(client, id, fields));
  } catch (err) {
    throw pgCode(err) === '23505' ? duplicate() : err;
  }
  return get(id);
}

export async function remove(id: number): Promise<void> {
  const current = await get(id);
  if (current.isSystem) throw protectedRole('deleted');
  if (current.userCount > 0) {
    throw new AppError(
      409,
      ErrorCode.CONFLICT,
      `This role is assigned to ${current.userCount} user${current.userCount === 1 ? '' : 's'}. Remove it from them first`,
      { userCount: current.userCount },
    );
  }
  try {
    if (!(await repo.remove(id))) throw notFound('Role');
  } catch (err) {
    // A user was given the role between the check and the delete (user_roles.role_id is ON DELETE RESTRICT).
    if (pgCode(err) === '23503') throw new AppError(409, ErrorCode.CONFLICT, 'This role is assigned to users');
    throw err;
  }
}
