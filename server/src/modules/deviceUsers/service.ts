import type { z } from 'zod';
import type { DeviceUser, ImportResult, Page, Queued, zDeviceUserListQuery, zImportDeviceUsersInput } from '@nacta/shared';
import * as commands from '../../adms/commands';
import { withTransaction } from '../../db/pool';
import { validationError } from '../../lib/errors';
import { toPage } from '../../lib/pagination';
import * as commandSvc from '../commands/service';
import * as repo from './repo';

const PIN_OK = /^\d{1,9}$/;
const MAX_PINS = 20000;

export async function list(deviceId: number, q: z.output<typeof zDeviceUserListQuery>): Promise<Page<DeviceUser>> {
  const { items, total } = await repo.list({ deviceId, ...q });
  return toPage(items, total, q);
}

/** Queue the user fetch plus both template fetches. */
export async function fetchFromDevice(deviceId: number): Promise<Queued> {
  const queued = await commandSvc.insertMany(
    [commands.queryUserInfo(), commands.queryFingerTmp(), commands.queryFaceBiodata()].map((command) => ({ deviceId, command })),
  );
  return { queued };
}

/** Create employees from device_users. Pins that are not 1-9 digits are skipped. */
export async function importUsers(deviceId: number, input: z.output<typeof zImportDeviceUsersInput>): Promise<ImportResult> {
  const pins = input.pins ? [...new Set(input.pins)] : null;
  if (pins && pins.length > MAX_PINS) throw validationError('Invalid request body', { pins: `At most ${MAX_PINS} pins` });

  const src = await repo.sourceRows(deviceId, pins);
  let skipped = 0;
  const rows: repo.ImportRow[] = [];
  for (const r of src) {
    if (!PIN_OK.test(r.pin)) {
      skipped++;
      continue;
    }
    rows.push({
      pin: r.pin,
      name: (r.name && r.name.trim() ? r.name.trim() : `User ${r.pin}`).slice(0, 100),
      hasName: !!(r.name && r.name.trim()),
      privilege: r.privilege === 14 ? 14 : 0,
      card: r.card_no || null,
      password: r.password || null,
    });
  }
  if (!rows.length) return { created: 0, updated: 0, skipped };

  return withTransaction(async (client) => {
    const { created, updated } = await repo.importRows(client, rows, input.overwrite);
    return { created, updated, skipped: skipped + (rows.length - created - updated) };
  });
}

/** Queue DATA DELETE USERINFO for one pin. */
export async function removeFromDevice(deviceId: number, pin: string): Promise<Queued> {
  const p = pin.trim();
  if (!p || p.length > 64) throw validationError('Invalid pin', { pin: 'pin is required' });
  await commandSvc.enqueue(deviceId, commands.deleteUserInfo(p));
  return { queued: 1 };
}
