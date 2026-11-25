import type { z } from 'zod';
import type { CommandType, DeviceCommand, Page, zCommandListQuery } from '@nacta/shared';
import { BY_TYPE } from '../../adms/commands';
import { toPage } from '../../lib/pagination';
import * as repo from './repo';

export { takePending, insertMany, insertOne, complete } from './repo';

/** Enqueue a command by (already validated) type. The caller checks the device exists. */
export function enqueueByType(deviceId: number, type: CommandType): Promise<DeviceCommand> {
  return repo.insert(deviceId, BY_TYPE[type]());
}

/** Enqueue a raw command string. */
export const enqueue = repo.insert;

export async function listForDevice(
  deviceId: number,
  q: z.output<typeof zCommandListQuery>,
): Promise<Page<DeviceCommand>> {
  const { items, total } = await repo.listForDevice({ deviceId, ...q });
  return toPage(items, total, q);
}
