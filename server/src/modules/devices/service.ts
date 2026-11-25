import type { z } from 'zod';
import { ErrorCode, type Device, type zDeviceInput, type zDeviceUpdate } from '@nacta/shared';
import { AppError, notFound, pgCode } from '../../lib/errors';
import * as repo from './repo';

const duplicate = () => new AppError(409, ErrorCode.DUPLICATE_DEVICE, 'A device with this serial number already exists');
const missing = () => notFound('Device');

export const list = repo.list;

export async function get(id: number): Promise<Device> {
  const d = await repo.find(id);
  if (!d) throw missing();
  return d;
}

/** Throws 404 if the device does not exist. */
export async function assertExists(id: number): Promise<void> {
  if (!(await repo.exists(id))) throw missing();
}

export async function create(input: z.output<typeof zDeviceInput>): Promise<Device> {
  try {
    const id = await repo.insert(input);
    return await get(id);
  } catch (err) {
    throw pgCode(err) === '23505' ? duplicate() : err;
  }
}

export async function update(id: number, input: z.output<typeof zDeviceUpdate>): Promise<Device> {
  const patch: Partial<repo.NewDevice> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.serialNumber !== undefined) patch.serialNumber = input.serialNumber;
  if (input.location !== undefined) patch.location = input.location;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (Object.keys(patch).length === 0) return get(id);
  try {
    if (!(await repo.update(id, patch))) throw missing();
  } catch (err) {
    throw pgCode(err) === '23505' ? duplicate() : err;
  }
  return get(id);
}

export async function remove(id: number): Promise<void> {
  if (!(await repo.remove(id))) throw missing();
}
