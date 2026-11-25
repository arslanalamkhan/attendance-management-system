import { ErrorCode, type Section, type Wing, type WingScope, type zSectionInput, type zWingInput } from '@nacta/shared';
import type { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { AppError, notFound, outOfScope, pgCode } from '../../lib/errors';
import * as repo from './repo';

const dupWing = () => new AppError(409, ErrorCode.DUPLICATE_WING, 'A wing with this name or code already exists');
const dupSection = () => new AppError(409, ErrorCode.DUPLICATE_SECTION, 'This wing already has a section with this name');

export const list = repo.list;

async function wingMiss(id: number, scope: WingScope): Promise<AppError> {
  if (scope !== 'all' && (await repo.find(id, 'all'))) return outOfScope('Wing');
  return notFound('Wing');
}

export async function get(id: number, scope: WingScope): Promise<Wing> {
  const w = await repo.find(id, scope);
  if (!w) throw await wingMiss(id, scope);
  return w;
}

export async function create(input: z.output<typeof zWingInput>, scope: WingScope): Promise<Wing> {
  // A new wing is outside any limited scope, so only all-wings callers may create one.
  if (scope !== 'all') throw new AppError(403, ErrorCode.FORBIDDEN, 'Creating a wing requires access to all wings');
  try {
    return await get(await repo.insert(input), scope);
  } catch (err) {
    throw pgCode(err) === '23505' ? dupWing() : err;
  }
}

export async function update(id: number, input: z.output<typeof zWingInput>, scope: WingScope): Promise<Wing> {
  try {
    if (!(await repo.update(id, input, scope))) throw await wingMiss(id, scope);
  } catch (err) {
    throw pgCode(err) === '23505' ? dupWing() : err;
  }
  return get(id, scope);
}

export async function remove(id: number, scope: WingScope): Promise<void> {
  const ok = await withTransaction((client) => repo.remove(client, id, scope));
  if (!ok) throw await wingMiss(id, scope);
}

// ---------- sections ----------
async function sectionMiss(id: number, scope: WingScope): Promise<AppError> {
  if (scope !== 'all' && (await repo.findSection(id, 'all'))) return outOfScope('Section');
  return notFound('Section');
}

export async function getSection(id: number, scope: WingScope): Promise<Section> {
  const s = await repo.findSection(id, scope);
  if (!s) throw await sectionMiss(id, scope);
  return s;
}

export async function createSection(wingId: number, input: z.output<typeof zSectionInput>, scope: WingScope): Promise<Section> {
  await get(wingId, scope); // 404 when missing / out of scope
  try {
    return await getSection(await repo.insertSection(wingId, input.name), scope);
  } catch (err) {
    throw pgCode(err) === '23505' ? dupSection() : err;
  }
}

export async function updateSection(id: number, input: z.output<typeof zSectionInput>, scope: WingScope): Promise<Section> {
  await getSection(id, scope);
  try {
    await repo.renameSection(id, input.name);
  } catch (err) {
    throw pgCode(err) === '23505' ? dupSection() : err;
  }
  return getSection(id, scope);
}

export async function removeSection(id: number, scope: WingScope): Promise<void> {
  await getSection(id, scope);
  await repo.removeSection(id);
}
