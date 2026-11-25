import type { z } from 'zod';
import {
  ErrorCode,
  type Employee,
  type EmployeeDetail,
  type Page,
  type WingScope,
  type zEmployeeInput,
  type zEmployeeListQuery,
  type zEmployeeUpdate,
  type zPushInput,
  type zStatusChangeInput,
} from '@nacta/shared';
import * as commands from '../../adms/commands';
import { pool, withTransaction, type Queryable } from '../../db/pool';
import { isRealDate } from '../../lib/dates';
import { AppError, notFound, outOfScope, pgCode, validationError } from '../../lib/errors';
import { toPage } from '../../lib/pagination';
import { inScope } from '../../lib/scope';
import * as commandSvc from '../commands/service';
import * as devSync from './deviceSync';
import * as repo from './repo';
import { applyStatus, type StatusOutcome } from './status';

const MAX_PUSH_EMPLOYEES = 20000;
const missing = () => notFound('Employee');

/** Who is asking: wing scope plus whether they may see CNICs (employees.manage). */
export interface Caller {
  scope: WingScope;
  canManage: boolean;
}

/** Maps unique / foreign-key / check violations to the API's error codes. */
export function mapPgError(err: unknown): unknown {
  const code = pgCode(err);
  const constraint = typeof err === 'object' && err !== null && 'constraint' in err ? String((err as { constraint: unknown }).constraint) : '';
  if (code === '23505') {
    if (constraint.includes('cnic')) return new AppError(409, ErrorCode.CONFLICT, 'Another employee already has this CNIC', { cnic: 'Already used by another employee' });
    return new AppError(409, ErrorCode.DUPLICATE_EMP_CODE, 'An employee with this code already exists');
  }
  if (code === '23503') {
    return validationError('Invalid employee data', constraint.includes('section') ? { sectionId: 'section does not exist' } : { wingId: 'wing does not exist' });
  }
  if (code === '23514') return validationError('Invalid employee data', { sectionId: 'Section does not belong to the wing' });
  return err;
}

export async function list(q: z.output<typeof zEmployeeListQuery>, caller: Caller): Promise<Page<Employee>> {
  const { items, total } = await repo.list(q, caller.scope, caller.canManage);
  return toPage(items, total, q);
}

/** A miss for a wing-limited caller is audited as access.denied when the row exists outside their scope. */
async function missOrOutOfScope(id: number, scope: WingScope): Promise<AppError> {
  if (scope !== 'all' && (await repo.find(id, 'all', false))) return outOfScope('Employee');
  return missing();
}

export async function getOne(id: number, caller: Caller, db: Queryable = pool): Promise<Employee> {
  const e = await repo.find(id, caller.scope, caller.canManage, db);
  if (!e) throw await missOrOutOfScope(id, caller.scope);
  return e;
}

export async function get(id: number, caller: Caller): Promise<EmployeeDetail> {
  const e = await getOne(id, caller);
  return { ...e, devices: await repo.deviceRefs(e.id, e.empCode) };
}

/** A wing-limited caller may only place employees in their own wings (and may not leave an employee wingless). */
function assertWingAllowed(scope: WingScope, wingId: number | null | undefined): void {
  if (wingId === undefined || scope === 'all') return;
  if (!inScope(scope, wingId)) {
    throw validationError('Invalid request body', { wingId: 'You can only use the wings assigned to your role' });
  }
}

/** zDate only checks the YYYY-MM-DD shape; reject dates that do not exist (2024-13-01) before Postgres does. */
function assertDate(field: string, v: string | null | undefined): void {
  if (v && !isRealDate(v)) throw validationError('Invalid request body', { [field]: 'Not a valid date' });
}

/** The section must exist and belong to the wing. */
async function assertSection(wingId: number | null, sectionId: number | null): Promise<void> {
  if (sectionId === null) return;
  if (wingId === null) throw validationError('Invalid request body', { sectionId: 'Choose a wing first' });
  const { rowCount } = await pool.query('SELECT 1 FROM sections WHERE id = $1 AND wing_id = $2', [sectionId, wingId]);
  if (!rowCount) throw validationError('Invalid request body', { sectionId: 'Section does not belong to the wing' });
}

export async function create(input: z.output<typeof zEmployeeInput>, caller: Caller): Promise<Employee> {
  assertDate('joinDate', input.joinDate);
  assertWingAllowed(caller.scope, input.wingId ?? null);
  await assertSection(input.wingId ?? null, input.sectionId ?? null);
  try {
    return await getOne(await repo.insert(input), caller);
  } catch (err) {
    throw mapPgError(err);
  }
}

export interface UpdateResult {
  employee: Employee;
  /** Device profile re-sent because name / card / password / role changed. */
  sync: { queued: number; devices: { id: number; name: string }[] };
}

const PROFILE_KEYS = ['name', 'cardNo', 'devicePassword', 'privilege'] as const;

export async function update(id: number, input: z.output<typeof zEmployeeUpdate>, caller: Caller): Promise<UpdateResult> {
  assertDate('joinDate', input.joinDate);
  const current = await getOne(id, caller);
  assertWingAllowed(caller.scope, input.wingId);
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as typeof input;
  const none = { queued: 0, devices: [] };
  if (Object.keys(patch).length === 0) return { employee: current, sync: none };

  // Moving to another wing drops the old section unless a new one is given.
  if (patch.wingId !== undefined && patch.wingId !== current.wingId && patch.sectionId === undefined) patch.sectionId = null;
  const wingId = patch.wingId !== undefined ? patch.wingId : current.wingId;
  const sectionId = patch.sectionId !== undefined ? patch.sectionId : current.sectionId;
  await assertSection(wingId, sectionId);

  if (patch.empCode !== undefined && patch.empCode !== current.empCode && (await repo.deviceHoldsPin(current.empCode))) {
    throw new AppError(409, ErrorCode.EMP_CODE_ON_DEVICE, 'The employee code cannot be changed while a device holds this user');
  }
  const profileChanged = PROFILE_KEYS.some((k) => patch[k] !== undefined && patch[k] !== current[k]);

  try {
    const sync = await withTransaction(async (client) => {
      if (!(await repo.update(id, patch, caller.scope, client))) throw await missOrOutOfScope(id, caller.scope);
      if (!profileChanged || current.status !== 'active') return none;
      const [profile] = await devSync.profilesByIds(client, [id]);
      if (!profile) return none;
      const devices = await devSync.holdingDevices(client, profile.emp_code);
      return { queued: await devSync.queueProfileUpdate(client, profile, devices), devices };
    });
    return { employee: await getOne(id, caller), sync };
  } catch (err) {
    throw mapPgError(err);
  }
}

/** Delete; with removeFromDevices queue DATA DELETE USERINFO on every active device. */
export async function remove(id: number, removeFromDevices: boolean, caller: Caller): Promise<void> {
  await withTransaction(async (client) => {
    const code = await repo.deleteReturningCode(client, id, caller.scope);
    if (code === null) throw await missOrOutOfScope(id, caller.scope);
    if (removeFromDevices) {
      const deviceIds = await repo.activeDeviceIds(client);
      await commandSvc.insertMany(
        deviceIds.map((deviceId) => ({ deviceId, command: commands.deleteUserInfo(code) })),
        client,
      );
    }
  });
}

export interface PushResult {
  queued: number;
  /** For the audit log: how many employees were pushed, how many skipped (not active), and to which devices. */
  employees: number;
  skipped: number;
  devices: { id: number; name: string }[];
}

/** Queue DATA UPDATE USERINFO (+ stored templates) for active employees on the chosen devices. */
export async function push(input: z.output<typeof zPushInput>, scope: WingScope): Promise<PushResult> {
  let employeeIds: number[] | null = null; // null = everyone in scope
  if (input.employeeIds !== 'all') {
    employeeIds = [...new Set(input.employeeIds)];
    if (employeeIds.length > MAX_PUSH_EMPLOYEES) {
      throw validationError('Invalid request body', { employeeIds: `At most ${MAX_PUSH_EMPLOYEES} employees per push` });
    }
  }

  let deviceIds: number[];
  if (input.deviceIds) {
    deviceIds = [...new Set(input.deviceIds)];
    const found = await repo.existingDeviceIds(deviceIds);
    if (found.length !== deviceIds.length) {
      throw validationError('Invalid request body', { deviceIds: 'one or more devices do not exist' });
    }
  } else {
    deviceIds = await repo.activeDeviceIds();
  }

  const { emps, skipped } = await repo.pushEmployees(employeeIds, scope);
  const devices = await repo.deviceNames(deviceIds);
  if (!emps.length || !deviceIds.length) return { queued: 0, employees: emps.length, skipped, devices };

  const tpl = await repo.templatesForPins(emps.map((e) => e.emp_code));
  const byPin = new Map<string, string[]>();
  for (const t of tpl) {
    const cmd = commands.updateTemplate({
      pin: t.pin,
      kind: t.kind,
      bioType: t.bio_type,
      idx: t.idx,
      valid: t.valid,
      size: t.size,
      data: t.data,
      raw: t.raw,
    });
    const list = byPin.get(t.pin);
    if (list) list.push(cmd);
    else byPin.set(t.pin, [cmd]);
  }

  const items: { deviceId: number; command: string; employeeId: number }[] = [];
  for (const deviceId of deviceIds) {
    for (const e of emps) {
      items.push({ deviceId, employeeId: e.id, command: devSync.userInfoCommand(e) });
      for (const command of byPin.get(e.emp_code) ?? []) items.push({ deviceId, employeeId: e.id, command });
    }
  }

  const queued = await withTransaction((client) => commandSvc.insertMany(items, client));
  return { queued, employees: emps.length, skipped, devices };
}

export interface StatusResult extends StatusOutcome {
  detail: EmployeeDetail;
  before: Employee;
}

export async function changeStatus(id: number, input: z.output<typeof zStatusChangeInput>, caller: Caller): Promise<StatusResult> {
  assertDate('effectiveDate', input.effectiveDate);
  const before = await getOne(id, caller);
  const outcome = await withTransaction(async (client) => {
    await client.query('SELECT 1 FROM employees WHERE id = $1 FOR UPDATE', [id]);
    const today = await client.query<{ d: string }>(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`);
    const leftDate = input.effectiveDate ?? (today.rows[0] as { d: string }).d;
    return applyStatus(client, { id, empCode: before.empCode, status: before.status }, input.status, {
      reason: input.reason ?? null,
      leftDate,
      force: input.force,
    });
  });
  return { ...outcome, detail: await get(id, caller), before };
}
