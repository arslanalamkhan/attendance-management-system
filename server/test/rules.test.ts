import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  zAttendanceDay,
  zCorrection,
  zDaySummary,
  zHoliday,
  zLeave,
  zLeaveType,
  zPage,
  zTimingAssignment,
  zTimingProfile,
  type Permission,
} from '@nacta/shared';
import { adms, api, closeDb, createDevice, pool, resetDb, userClient, V1 } from './helpers';
import { addDays, setClock, todayLocal } from '../src/lib/dates';
import { flushAudit } from '../src/modules/audit/service';
import * as worker from '../src/modules/attendance/worker';

beforeEach(resetDb);
afterAll(closeDb);

const TODAY = () => todayLocal();
const ago = (n: number) => addDays(TODAY(), -n);

const mkWing = async (name: string) => (await api.post(`${V1}/wings`).send({ name })).body as { id: number };
const mkEmp = async (empCode: string, name: string, wingId?: number, extra: Record<string, unknown> = {}) => {
  const res = await api.post(`${V1}/employees`).send({ empCode, name, ...(wingId ? { wingId } : {}), ...extra });
  if (res.status !== 201) throw new Error(`employee: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; empCode: string; name: string };
};
/** Make every weekday a working day so tests do not depend on which weekday "yesterday" was. */
const allDaysWorking = () =>
  pool.query('UPDATE timing_profile_versions SET days = $1::jsonb', [JSON.stringify(Array.from({ length: 7 }, () => ({ start: '09:00', end: '17:00' })))]);
let deviceId = 0;
const punch = async (pin: string, date: string, time: string) => {
  if (!deviceId) deviceId = (await createDevice('RULESDEV1')).id;
  await pool.query(`INSERT INTO attendance_logs (device_id, pin, punch_time, status) VALUES ($1, $2, $3::timestamp, 0) ON CONFLICT DO NOTHING`, [deviceId, pin, `${date} ${time}`]);
};
beforeEach(() => {
  deviceId = 0;
});

let baseline = 0;
beforeEach(async () => {
  baseline = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM audit_logs')).rows[0].m);
});
const auditRows = async (action: string) => {
  await flushAudit();
  return (
    await pool.query<{ summary: string; entity_label: string | null; changes: { field: string; before: unknown; after: unknown }[] | null; metadata: Record<string, unknown> | null }>(
      'SELECT summary, entity_label, changes, metadata FROM audit_logs WHERE action = $1 AND id > $2 ORDER BY id',
      [action, baseline],
    )
  ).rows;
};

const daily = async (date: string, query = '') => {
  const res = await api.get(`${V1}/attendance/daily?date=${date}&pageSize=500${query}`);
  expect(res.status).toBe(200);
  return zPage(zAttendanceDay).parse(res.body);
};
const statusOf = (page: { items: { empCode: string; status: string }[] }, code: string) => page.items.find((d) => d.empCode === code)?.status;

const CL = 1; // seeded leave types: CL, EL, ML, SL, OD, MAT, LWP

describe('migration 008 seed', () => {
  it('seeds the standard timing, the leave types and no holidays', async () => {
    const t = await api.get(`${V1}/timings`);
    expect(t.status).toBe(200);
    const profiles = t.body.map((p: unknown) => zTimingProfile.parse(p));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ name: 'Standard office hours', isDefault: true, graceLateMinutes: 30, graceEarlyMinutes: 0, halfDayBelowMinutes: 240, assignmentCount: 0 });
    expect(profiles[0].days).toEqual([null, ...Array.from({ length: 5 }, () => ({ start: '09:00', end: '17:00' })), null]);
    expect(profiles[0].versions).toHaveLength(1);
    const types = (await api.get(`${V1}/leave-types`)).body.map((x: unknown) => zLeaveType.parse(x));
    expect(types.map((x: { code: string }) => x.code)).toEqual(['CL', 'EL', 'ML', 'SL', 'OD', 'MAT', 'LWP']);
    expect(types.find((x: { code: string }) => x.code === 'OD')).toMatchObject({ countsAsPresent: true, color: '#059669' });
    expect((await api.get(`${V1}/holidays?year=${new Date().getFullYear()}`)).body).toEqual([]);
    expect((await api.get(`${V1}/timings/setup-status`)).body).toEqual({ configured: true });
  });

  it('grants no new permission to any role automatically', async () => {
    const { rows } = await pool.query(`SELECT 1 FROM role_permissions WHERE permission IN ('attendance.correct','leave.manage','leave.configure','holidays.manage','timings.manage')`);
    expect(rows).toHaveLength(0);
  });
});

describe('permissions are separate', () => {
  it('every route needs exactly its own permission', async () => {
    const PERMS: Permission[] = ['attendance.view', 'attendance.correct', 'leave.manage', 'leave.configure', 'holidays.manage', 'timings.manage'];
    const users = new Map<string, Awaited<ReturnType<typeof userClient>>>();
    for (const p of PERMS) users.set(p, await userClient({ permissions: [p] }));
    users.set('none', await userClient({ permissions: ['employees.view'] }));

    type Route = { m: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string; ok: Permission[] };
    const routes: Route[] = [
      { m: 'get', path: '/attendance/daily?date=2026-01-05', ok: ['attendance.view'] },
      { m: 'get', path: '/attendance/days?employeeId=1&from=2026-01-05&to=2026-01-06', ok: ['attendance.view'] },
      { m: 'get', path: '/attendance/day-summary?from=2026-01-05&to=2026-01-06', ok: ['attendance.view'] },
      // listing and removing corrections is reserved for the Super Admin: no permission opens it
      { m: 'get', path: '/attendance/corrections', ok: [] },
      { m: 'post', path: '/attendance/corrections', ok: ['attendance.correct'] },
      { m: 'delete', path: '/attendance/corrections/1', ok: [] },
      { m: 'post', path: '/attendance/recompute', ok: ['timings.manage'] },
      { m: 'get', path: '/leaves', ok: ['leave.manage', 'attendance.view'] },
      { m: 'post', path: '/leaves', ok: ['leave.manage'] },
      { m: 'put', path: '/leaves/1', ok: ['leave.manage'] },
      { m: 'delete', path: '/leaves/1', ok: ['leave.manage'] },
      { m: 'get', path: '/leave-types', ok: ['attendance.view', 'leave.manage', 'leave.configure'] },
      { m: 'post', path: '/leave-types', ok: ['leave.configure'] },
      { m: 'put', path: '/leave-types/1', ok: ['leave.configure'] },
      { m: 'get', path: '/holidays', ok: ['attendance.view', 'leave.manage', 'holidays.manage'] },
      { m: 'post', path: '/holidays', ok: ['holidays.manage'] },
      { m: 'put', path: '/holidays/1', ok: ['holidays.manage'] },
      { m: 'delete', path: '/holidays/1', ok: ['holidays.manage'] },
      { m: 'get', path: '/timings', ok: ['timings.manage', 'attendance.view'] },
      { m: 'get', path: '/timings/setup-status', ok: ['timings.manage', 'attendance.view'] },
      { m: 'post', path: '/timings', ok: ['timings.manage'] },
      { m: 'put', path: '/timings/1', ok: ['timings.manage'] },
      { m: 'delete', path: '/timings/1', ok: ['timings.manage'] },
      { m: 'post', path: '/timings/1/default', ok: ['timings.manage'] },
      { m: 'get', path: '/timing-assignments', ok: ['timings.manage', 'attendance.view'] },
      { m: 'post', path: '/timing-assignments', ok: ['timings.manage'] },
      { m: 'patch', path: '/timing-assignments/1', ok: ['timings.manage'] },
      { m: 'delete', path: '/timing-assignments/1', ok: ['timings.manage'] },
    ];
    const bad: string[] = [];
    for (const r of routes) {
      for (const [who, client] of users) {
        const res = await client[r.m](`${V1}${r.path}`).send({});
        const allowed = r.ok.includes(who as Permission);
        if (allowed === (res.status === 403)) bad.push(`${who} ${r.m.toUpperCase()} ${r.path} -> ${res.status}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('timings: versions apply forwards', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    name: 'Standard office hours',
    days: Array.from({ length: 7 }, () => ({ start: '09:00', end: '17:00' })),
    graceLateMinutes: 10,
    graceEarlyMinutes: 5,
    halfDayBelowMinutes: 200,
    ...extra,
  });

  it('PUT adds a version from today and keeps the old one; the top level is the version in force today', async () => {
    const res = await api.put(`${V1}/timings/1`).send(body({ days: Array.from({ length: 7 }, () => ({ start: '08:00', end: '16:00' })) }));
    expect(res.status).toBe(200);
    const p = zTimingProfile.parse(res.body);
    expect(p.versions).toHaveLength(2);
    expect(p.versions[0]).toMatchObject({ effectiveFrom: TODAY(), graceLateMinutes: 10, createdBy: 'Test Admin' });
    expect(p.versions[1]).toMatchObject({ graceLateMinutes: 30 });
    expect(p.graceLateMinutes).toBe(10);
    expect(p.days[1]).toEqual({ start: '08:00', end: '16:00' });
    // same date again replaces that version
    const again = zTimingProfile.parse((await api.put(`${V1}/timings/1`).send(body({ graceLateMinutes: 20 }))).body);
    expect(again.versions).toHaveLength(2);
    expect(again.graceLateMinutes).toBe(20);
    // a future version leaves today's rules in force
    const future = zTimingProfile.parse((await api.put(`${V1}/timings/1`).send(body({ graceLateMinutes: 0, effectiveFrom: addDays(TODAY(), 30) }))).body);
    expect(future.versions).toHaveLength(3);
    expect(future.graceLateMinutes).toBe(20);
    const rows = await auditRows('timing.update');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.summary).toContain('Changed office timing Standard office hours from');
    expect(rows[0]?.changes?.map((c) => c.field)).toContain('graceLateMinutes');
  });

  it('rejects a start date in the past once the timings are set up; allows it during initial setup', async () => {
    const past = await api.put(`${V1}/timings/1`).send(body({ effectiveFrom: ago(5) }));
    expect(past.status).toBe(400);
    expect(past.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { effectiveFrom: 'Timing changes apply from today onwards' } });

    await pool.query('UPDATE timing_profiles SET confirmed = false WHERE is_default');
    expect((await api.get(`${V1}/timings/setup-status`)).body).toEqual({ configured: false });
    const ok = await api.put(`${V1}/timings/1`).send(body({ effectiveFrom: ago(30) }));
    expect(ok.status).toBe(200);
    expect(zTimingProfile.parse(ok.body).versions.map((v) => v.effectiveFrom)).toContain(ago(30));
    expect((await api.get(`${V1}/timings/setup-status`)).body).toEqual({ configured: true });
    // setup is over: the past is closed again
    expect((await api.put(`${V1}/timings/1`).send(body({ effectiveFrom: ago(10) }))).status).toBe(400);
  });

  it('a version change mid-range leaves earlier days unchanged and changes later ones', async () => {
    await allDaysWorking();
    await mkEmp('1', 'Ayesha');
    for (const d of [ago(2), ago(1), TODAY()]) {
      await punch('1', d, '09:20:00');
      await punch('1', d, '17:00:00');
    }
    setClock(() => new Date(Date.now())); // real time, but proves the clock hook is harmless
    const before = await Promise.all([ago(2), ago(1)].map(async (d) => statusOf(await daily(d), '1')));
    expect(before).toEqual(['present', 'present']); // late grace is 30 minutes

    const put = await api.put(`${V1}/timings/1`).send(body({ graceLateMinutes: 0, effectiveFrom: TODAY() }));
    expect(put.status).toBe(200);
    await worker.drain({ yieldMs: 0 });
    expect(statusOf(await daily(ago(2)), '1')).toBe('present');
    expect(statusOf(await daily(ago(1)), '1')).toBe('present');
    const t = (await daily(TODAY())).items.find((d) => d.empCode === '1');
    expect(t?.status === 'late' || t?.status === 'pending').toBe(true); // today's clock decides pending vs late
    if (t?.status === 'late') expect(t.lateMinutes).toBe(20);
    const range = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=1&from=${ago(2)}&to=${ago(1)}`)).body);
    expect(range.map((d) => d.status)).toEqual(['present', 'present']);

    // recompute never rewrites history
    expect((await api.post(`${V1}/attendance/recompute`).send({ from: ago(2), to: TODAY() })).status).toBe(202);
    await worker.drain({ yieldMs: 0 });
    expect(statusOf(await daily(ago(2)), '1')).toBe('present');
    setClock(null);
  });

  it('forward-only versions on a pinned clock: the day before the change keeps its old rule, the day after gets the new', async () => {
    await allDaysWorking();
    await mkEmp('1', 'Ayesha');
    const base = TODAY();
    const day = (n: number) => addDays(base, n);
    // new rules start on day(2): a future-dated version, allowed today
    expect((await api.put(`${V1}/timings/1`).send(body({ graceLateMinutes: 15, effectiveFrom: day(2) }))).status).toBe(200);
    for (const d of [day(0), day(1), day(2), day(3)]) {
      await punch('1', d, '09:25:00');
      await punch('1', d, '17:00:00');
    }
    setClock(() => new Date(`${day(3)}T20:00:00+05:00`));
    try {
      const res = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=1&from=${day(0)}&to=${day(3)}`)).body);
      expect(res.map((d) => d.status)).toEqual(['present', 'present', 'late', 'late']);
      expect(res[2]?.lateMinutes).toBe(25);
    } finally {
      setClock(null);
    }
  });

  it('profile CRUD: duplicate name, default cannot be deleted, make default pins the old default to the past', async () => {
    const created = await api.post(`${V1}/timings`).send(body({ name: 'Ramadan' }));
    expect(created.status).toBe(201);
    const ram = zTimingProfile.parse(created.body);
    expect(ram).toMatchObject({ name: 'Ramadan', isDefault: false, assignmentCount: 0 });
    expect((await api.post(`${V1}/timings`).send(body({ name: 'ramadan' }))).status).toBe(409);
    expect((await api.post(`${V1}/timings`).send({ ...body({ name: 'Bad' }), days: [null] })).status).toBe(400);
    // start = end is meaningless; an end before the start is a night shift (allowed, see "night shifts")
    const same = await api.post(`${V1}/timings`).send({ ...body({ name: 'Bad' }), days: [null, { start: '09:00', end: '09:00' }, null, null, null, null, null] });
    expect(same.status).toBe(400);

    const del = await api.delete(`${V1}/timings/1`);
    expect([del.status, del.body.error.code]).toEqual([409, 'CONFLICT']);

    const def = await api.post(`${V1}/timings/${ram.id}/default`);
    expect(def.status).toBe(200);
    expect(zTimingProfile.parse(def.body).isDefault).toBe(true);
    const list = (await api.get(`${V1}/timings`)).body.map((p: unknown) => zTimingProfile.parse(p));
    expect(list.filter((p: { isDefault: boolean }) => p.isDefault)).toHaveLength(1);
    // history keeps the previous default through an organisation-wide assignment that ends yesterday
    const assigns = (await api.get(`${V1}/timing-assignments`)).body.map((a: unknown) => zTimingAssignment.parse(a));
    expect(assigns).toHaveLength(1);
    expect(assigns[0]).toMatchObject({ profileId: 1, scope: 'all', scopeLabel: 'Everyone', label: 'Previous default', effectiveTo: ago(1) });

    const used = await api.delete(`${V1}/timings/1`);
    expect([used.status, used.body.error.code]).toEqual([409, 'PROFILE_IN_USE']);
    expect(used.body.error.details).toMatchObject({ assignmentCount: 1 });
    expect((await api.delete(`${V1}/timings/999`)).status).toBe(404);
  });

  it('deleting an unused, non-default profile works and is audited', async () => {
    const p = zTimingProfile.parse((await api.post(`${V1}/timings`).send(body({ name: 'Temp' }))).body);
    expect((await api.delete(`${V1}/timings/${p.id}`)).status).toBe(204);
    expect((await auditRows('timing.create'))[0]?.summary).toContain('Created office timing Temp');
    expect((await auditRows('timing.delete'))[0]?.summary).toBe('Deleted office timing Temp');
  });
});

describe('night shifts (end earlier than start)', () => {
  const NIGHT = { start: '17:00', end: '09:00' };
  async function setup() {
    await allDaysWorking();
    const created = await api.post(`${V1}/timings`).send({
      name: 'Night duty',
      days: Array.from({ length: 7 }, () => NIGHT),
      graceLateMinutes: 10,
      graceEarlyMinutes: 5,
      halfDayBelowMinutes: 240,
    });
    expect(created.status).toBe(201);
    const night = zTimingProfile.parse(created.body);
    expect(night.days[1]).toEqual(NIGHT);
    const dayWorker = await mkEmp('1', 'Day Worker');
    const guard = await mkEmp('2', 'Night Guard');
    await pool.query(`INSERT INTO timing_assignments (profile_id, scope, scope_id, effective_from) VALUES ($1, 'employee', $2, $3)`, [night.id, guard.id, ago(20)]);
    return { dayWorker, guard };
  }

  it('the morning check-out counts for the night the shift started; late, early and absent across midnight', async () => {
    const { dayWorker, guard } = await setup();
    // night of ago(3): 16:55 in, 09:05 next morning out -> present, 16h10m
    await punch('2', ago(3), '16:55:00');
    await punch('2', ago(2), '09:05:00');
    // night of ago(2): 17:20 in (late 20 > grace 10), 08:30 out (early 30 > grace 5)
    await punch('2', ago(2), '17:20:00');
    await punch('2', ago(1), '08:30:00');
    // night of ago(1): nobody came -> absent once this morning is over
    // the day worker is unaffected: midnight to midnight as before
    await punch('1', ago(2), '09:00:00');
    await punch('1', ago(2), '17:00:00');

    const today = TODAY();
    setClock(() => new Date(`${today}T20:00:00+05:00`));
    try {
      const days = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=${guard.id}&from=${ago(3)}&to=${TODAY()}`)).body);
      const [n3, n2, n1, n0] = days;
      expect(n3).toMatchObject({ status: 'present', firstIn: '16:55', lastOut: '09:05', workedMinutes: 970, punchCount: 2, lateMinutes: 0, earlyLeave: false });
      expect(n3?.timing).toEqual({ profileName: 'Night duty', start: '17:00', end: '09:00' });
      expect(n2).toMatchObject({ status: 'late', firstIn: '17:20', lastOut: '08:30', lateMinutes: 20, earlyLeave: true, earlyMinutes: 30, punchCount: 2 });
      expect(n1).toMatchObject({ status: 'absent', punchCount: 0 });
      expect(n0?.status).toBe('pending'); // tonight's shift runs until tomorrow 09:00: not absent yet
      const dw = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=${dayWorker.id}&from=${ago(2)}&to=${ago(2)}`)).body);
      expect(dw[0]).toMatchObject({ status: 'present', firstIn: '09:00', lastOut: '17:00', workedMinutes: 480 });
    } finally {
      setClock(null);
    }
  });

  it('yesterday\'s night is still running this morning, and becomes a missing punch 2h after its end', async () => {
    const { guard } = await setup();
    await punch('2', ago(1), '17:00:00');
    const today = TODAY();
    const yesterday = ago(1);
    setClock(() => new Date(`${today}T07:00:00+05:00`));
    try {
      const early = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=${guard.id}&from=${yesterday}&to=${yesterday}`)).body);
      expect(early[0]).toMatchObject({ status: 'present', firstIn: '17:00', lastOut: null, earlyLeave: false });
      // after 11:00 with no check-out the shift is over: missing punch. Yesterday is not frozen in the cache.
      setClock(() => new Date(`${today}T11:30:00+05:00`));
      await pool.query('UPDATE attendance_days SET computed_at = now() - interval \'1 hour\'');
      const later = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=${guard.id}&from=${yesterday}&to=${yesterday}`)).body);
      expect(later[0]?.status).toBe('incomplete');
    } finally {
      setClock(null);
    }
  });

  it('a manual punch before the split time is the next morning (missing check-out)', async () => {
    const { guard } = await setup();
    await punch('2', ago(3), '17:00:00');
    const c = await api.post(`${V1}/attendance/corrections`).send({ employeeId: guard.id, date: ago(3), type: 'add_punch', time: '09:00', reason: 'Forgot to punch out' });
    expect(c.status).toBe(201);
    await worker.drain({ yieldMs: 0 });
    const d = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=${guard.id}&from=${ago(3)}&to=${ago(3)}`)).body);
    expect(d[0]).toMatchObject({ status: 'present', firstIn: '17:00', lastOut: '09:00', workedMinutes: 960 });
  });

  it('a punch from the device queues the day before too (it may close a night shift)', async () => {
    const { guard } = await setup();
    if (!deviceId) deviceId = (await createDevice('RULESDEV1')).id;
    await pool.query('DELETE FROM attendance_dirty');
    const res = await adms.post(`/iclock/cdata?SN=RULESDEV1&table=ATTLOG&Stamp=1`).set('Content-Type', 'text/plain').send(`2\t${ago(1)} 08:58:00\t1\t1\t0\t0\t0\n`);
    expect(res.status).toBe(200);
    const q = await pool.query(`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM attendance_dirty WHERE employee_id = $1 ORDER BY date`, [guard.id]);
    expect(q.rows.map((r) => r.d)).toEqual([ago(2), ago(1)]);
  });
});

describe('timing assignments', () => {
  it('wing assignment changes the rules of that wing only; past starts are rejected', async () => {
    await allDaysWorking();
    const ops = await mkWing('Ops');
    const adm = await mkWing('Admin');
    await mkEmp('1', 'In ops', ops.id);
    await mkEmp('2', 'In admin', adm.id);
    const early = zTimingProfile.parse(
      (await api.post(`${V1}/timings`).send({ name: 'Early', days: Array.from({ length: 7 }, () => ({ start: '07:00', end: '15:00' })), graceLateMinutes: 0, graceEarlyMinutes: 0, halfDayBelowMinutes: 240 })).body,
    );
    const past = await api.post(`${V1}/timing-assignments`).send({ profileId: early.id, scope: 'wing', scopeId: ops.id, effectiveFrom: ago(3) });
    expect(past.status).toBe(400);
    expect(past.body.error.details.effectiveFrom).toBe('Timing changes apply from today onwards');

    const ok = await api.post(`${V1}/timing-assignments`).send({ profileId: early.id, scope: 'wing', scopeId: ops.id, effectiveFrom: addDays(TODAY(), 1), label: 'Summer' });
    expect(ok.status).toBe(201);
    expect(zTimingAssignment.parse(ok.body)).toMatchObject({ profileName: 'Early', scope: 'wing', scopeLabel: 'Ops', label: 'Summer', effectiveTo: null });
    expect((await auditRows('timing.assign'))[0]?.summary).toContain('Assigned Early to Ops');

    expect((await api.post(`${V1}/timing-assignments`).send({ profileId: early.id, scope: 'wing', effectiveFrom: TODAY() })).status).toBe(400);
    expect((await api.post(`${V1}/timing-assignments`).send({ profileId: early.id, scope: 'wing', scopeId: 999, effectiveFrom: TODAY() })).status).toBe(404);
    expect((await api.post(`${V1}/timing-assignments`).send({ profileId: 999, scope: 'all', effectiveFrom: TODAY() })).status).toBe(404);

    // future assignment can be removed; the profile is then free to delete
    expect((await api.delete(`${V1}/timing-assignments/${ok.body.id}`)).status).toBe(204);
    expect((await auditRows('timing.unassign'))).toHaveLength(1);
    expect((await api.delete(`${V1}/timings/${early.id}`)).status).toBe(204);
  });

  it('an assignment that has already started cannot be removed (history is fixed) except during initial setup', async () => {
    const p = zTimingProfile.parse((await api.post(`${V1}/timings`).send({ name: 'X', days: Array.from({ length: 7 }, () => ({ start: '07:00', end: '15:00' })) })).body);
    await pool.query('UPDATE timing_profiles SET confirmed = false WHERE is_default');
    const a = await api.post(`${V1}/timing-assignments`).send({ profileId: p.id, scope: 'all', effectiveFrom: ago(2) });
    expect(a.status).toBe(201); // initial setup may reach into the past
    await pool.query('UPDATE timing_profiles SET confirmed = true WHERE is_default');
    expect((await api.delete(`${V1}/timing-assignments/${a.body.id}`)).status).toBe(400);
    await pool.query('UPDATE timing_profiles SET confirmed = false WHERE is_default');
    expect((await api.delete(`${V1}/timing-assignments/${a.body.id}`)).status).toBe(204);
  });
  it('PATCH ends, shortens or extends an assignment from today on; DELETE only before it starts', async () => {
    await allDaysWorking();
    const ops = await mkWing('Ops');
    await mkEmp('1', 'In ops', ops.id);
    const p = zTimingProfile.parse((await api.post(`${V1}/timings`).send({ name: 'Ramadan 27', days: Array.from({ length: 7 }, () => ({ start: '10:00', end: '14:00' })) })).body);
    const patch = (id: number, effectiveTo: string | null) => api.patch(`${V1}/timing-assignments/${id}`).send({ effectiveTo });

    // started in the past (set up during initial setup), open-ended: cannot be deleted any more, but can be ended
    await pool.query('UPDATE timing_profiles SET confirmed = false WHERE is_default');
    const a = (await api.post(`${V1}/timing-assignments`).send({ profileId: p.id, scope: 'wing', scopeId: ops.id, effectiveFrom: ago(3), label: 'Ramadan 2027' })).body;
    await pool.query('UPDATE timing_profiles SET confirmed = true WHERE is_default');
    const del = await api.delete(`${V1}/timing-assignments/${a.id}`);
    expect([del.status, Object.keys(del.body.error.details)]).toEqual([400, ['effectiveFrom']]);
    await daily(TODAY()); // cache today so the change has something to requeue
    await worker.drain({ yieldMs: 0 });

    const ended = await patch(a.id, addDays(TODAY(), 5));
    expect(ended.status).toBe(200);
    expect(zTimingAssignment.parse(ended.body)).toMatchObject({ effectiveTo: addDays(TODAY(), 5), label: 'Ramadan 2027' });
    expect((await patch(a.id, addDays(TODAY(), 2))).body.effectiveTo).toBe(addDays(TODAY(), 2)); // shorten the future part
    expect((await patch(a.id, null)).body.effectiveTo).toBeNull(); // open-ended again
    expect((await patch(a.id, TODAY())).status).toBe(200); // end as of today
    expect((await patch(a.id, ago(1))).status).toBe(200); // end as of yesterday (today no longer covered)
    expect(Number((await pool.query('SELECT count(*) AS n FROM attendance_dirty')).rows[0].n)).toBeGreaterThan(0);
    await worker.drain({ yieldMs: 0 });
    // history stays fixed: the end can never move before yesterday, and an end already in the past cannot be moved
    const past = await patch(a.id, ago(2));
    expect(past.status).toBe(400);
    expect(past.body.error.details).toHaveProperty('effectiveTo');
    expect((await patch(a.id, addDays(ago(1), -30))).status).toBe(400);
    expect((await patch(a.id, addDays(TODAY(), -400))).status).toBe(400); // before the start date as well
    expect((await api.patch(`${V1}/timing-assignments/${a.id}`).send({})).status).toBe(400);
    expect((await api.patch(`${V1}/timing-assignments/999`).send({ effectiveTo: null })).status).toBe(404);
    const rows = await auditRows('timing.update');
    expect(rows.some((r) => r.summary === `Ended Ramadan 2027 assignment for Ops on ${addDays(TODAY(), 5)}`)).toBe(true);
    expect(rows.some((r) => r.summary.includes('open-ended'))).toBe(true);

    // a future assignment can still be deleted
    const f = (await api.post(`${V1}/timing-assignments`).send({ profileId: p.id, scope: 'all', effectiveFrom: addDays(TODAY(), 3) })).body;
    expect((await api.delete(`${V1}/timing-assignments/${f.id}`)).status).toBe(204);

    // PATCH marks the changed days dirty: ending yesterday frees today
    await worker.drain({ yieldMs: 0 });
    expect((await patch(a.id, null)).status).toBe(200); // reopening from yesterday changes today
    expect(Number((await pool.query('SELECT count(*) AS n FROM attendance_dirty')).rows[0].n)).toBeGreaterThan(0);
  });

  it('wing scope: assignments need the wing / employee in scope; org-wide needs all wings', async () => {
    const ops = await mkWing('Ops');
    const adm = await mkWing('Admin');
    const mine = await mkEmp('1', 'Mine', ops.id);
    const other = await mkEmp('2', 'Other', adm.id);
    const u = await userClient({ permissions: ['timings.manage', 'attendance.view'], wings: [ops.id] });
    const prof = zTimingProfile.parse((await api.post(`${V1}/timings`).send({ name: 'P', days: Array.from({ length: 7 }, () => ({ start: '07:00', end: '15:00' })) })).body);
    const from = addDays(TODAY(), 2);
    expect((await u.post(`${V1}/timing-assignments`).send({ profileId: prof.id, scope: 'wing', scopeId: ops.id, effectiveFrom: from })).status).toBe(201);
    expect((await u.post(`${V1}/timing-assignments`).send({ profileId: prof.id, scope: 'wing', scopeId: adm.id, effectiveFrom: from })).status).toBe(404);
    expect((await u.post(`${V1}/timing-assignments`).send({ profileId: prof.id, scope: 'employee', scopeId: mine.id, effectiveFrom: from })).status).toBe(201);
    expect((await u.post(`${V1}/timing-assignments`).send({ profileId: prof.id, scope: 'employee', scopeId: other.id, effectiveFrom: from })).status).toBe(404);
    expect((await u.post(`${V1}/timing-assignments`).send({ profileId: prof.id, scope: 'all', effectiveFrom: from })).status).toBe(403);
    await api.post(`${V1}/timing-assignments`).send({ profileId: prof.id, scope: 'wing', scopeId: adm.id, effectiveFrom: from });
    const seen = (await u.get(`${V1}/timing-assignments`)).body as { scope: string; scopeId: number }[];
    expect(seen.map((a) => `${a.scope}:${a.scopeId}`).sort()).toEqual([`employee:${mine.id}`, `wing:${ops.id}`].sort());
    // editing the shared profile itself needs all wings
    expect((await u.put(`${V1}/timings/${prof.id}`).send({ name: 'P2', days: Array.from({ length: 7 }, () => null) })).status).toBe(403);
  });
});

describe('holidays', () => {
  it('CRUD, year filter, audit, and the effect on the daily status', async () => {
    await allDaysWorking();
    const ops = await mkWing('Ops');
    const adm = await mkWing('Admin');
    await mkEmp('1', 'In ops', ops.id);
    await mkEmp('2', 'In admin', adm.id);
    const day = ago(3);
    const res = await api.post(`${V1}/holidays`).send({ name: 'Ops day', from: day, to: day, wingIds: [ops.id] });
    expect(res.status).toBe(201);
    const h = zHoliday.parse(res.body);
    expect(h).toMatchObject({ name: 'Ops day', kind: 'holiday', wingIds: [ops.id], wingNames: ['Ops'] });
    const page = await daily(day);
    expect(statusOf(page, '1')).toBe('holiday');
    expect(page.items.find((d) => d.empCode === '1')?.holiday).toEqual({ name: 'Ops day' });
    expect(statusOf(page, '2')).toBe('absent'); // holiday for one wing only

    const upd = await api.put(`${V1}/holidays/${h.id}`).send({ name: 'Everyone day', from: day, to: day, wingIds: [] });
    expect(zHoliday.parse(upd.body)).toMatchObject({ name: 'Everyone day', wingIds: [] });
    expect(statusOf(await daily(day), '2')).toBe('holiday');
    const year = Number(day.slice(0, 4));
    expect(((await api.get(`${V1}/holidays?year=${year}`)).body as unknown[]).length).toBe(1);
    expect(((await api.get(`${V1}/holidays?year=${year + 5}`)).body as unknown[]).length).toBe(0);

    expect((await api.post(`${V1}/holidays`).send({ name: 'x', from: day, to: addDays(day, -1) })).status).toBe(400);
    expect((await api.post(`${V1}/holidays`).send({ name: 'x', from: day, to: day, wingIds: [999] })).status).toBe(404);
    expect((await api.delete(`${V1}/holidays/${h.id}`)).status).toBe(204);
    expect(statusOf(await daily(day), '2')).toBe('absent');
    expect((await api.delete(`${V1}/holidays/${h.id}`)).status).toBe(404);
    expect((await auditRows('holiday.create'))[0]?.summary).toContain('Added holiday Ops day');
    expect((await auditRows('holiday.update'))[0]?.changes?.map((c) => c.field)).toEqual(expect.arrayContaining(['name', 'wingNames']));
    expect((await auditRows('holiday.delete'))).toHaveLength(1);
  });

  it('a working_day turns a weekend into a working day', async () => {
    await mkEmp('1', 'A');
    let sat = ago(1);
    while (new Date(`${sat}T00:00:00Z`).getUTCDay() !== 6) sat = addDays(sat, -1);
    expect(statusOf(await daily(sat), '1')).toBe('weekend');
    await api.post(`${V1}/holidays`).send({ name: 'Make-up Saturday', from: sat, to: sat, kind: 'working_day' });
    expect(statusOf(await daily(sat), '1')).toBe('absent');
  });

  it('wing scope: limited users see and manage only holidays of their wings', async () => {
    const ops = await mkWing('Ops');
    const adm = await mkWing('Admin');
    const u = await userClient({ permissions: ['holidays.manage'], wings: [ops.id] });
    const day = addDays(TODAY(), 10);
    expect((await u.post(`${V1}/holidays`).send({ name: 'All wings', from: day, to: day })).status).toBe(403);
    expect((await u.post(`${V1}/holidays`).send({ name: 'Admin only', from: day, to: day, wingIds: [adm.id] })).status).toBe(404);
    const own = await u.post(`${V1}/holidays`).send({ name: 'Ops only', from: day, to: day, wingIds: [ops.id] });
    expect(own.status).toBe(201);
    const org = (await api.post(`${V1}/holidays`).send({ name: 'Org', from: day, to: day })).body;
    const both = (await api.post(`${V1}/holidays`).send({ name: 'Both', from: day, to: day, wingIds: [ops.id, adm.id] })).body;
    const adminOnly = (await api.post(`${V1}/holidays`).send({ name: 'AdminOnly', from: day, to: day, wingIds: [adm.id] })).body;
    const names = ((await u.get(`${V1}/holidays?year=${day.slice(0, 4)}`)).body as { name: string; wingIds: number[] }[]).map((x) => x.name).sort();
    expect(names).toEqual(['Both', 'Ops only', 'Org']);
    const seenBoth = ((await u.get(`${V1}/holidays?year=${day.slice(0, 4)}`)).body as { name: string; wingIds: number[] }[]).find((x) => x.name === 'Both');
    expect(seenBoth?.wingIds).toEqual([ops.id]); // other wings are not revealed
    expect((await u.delete(`${V1}/holidays/${org.id}`)).status).toBe(404);
    expect((await u.delete(`${V1}/holidays/${both.id}`)).status).toBe(404);
    expect((await u.delete(`${V1}/holidays/${adminOnly.id}`)).status).toBe(404);
    expect((await u.delete(`${V1}/holidays/${own.body.id}`)).status).toBe(204);
  });

  it('deleting a wing drops holidays that only applied to it', async () => {
    const ops = await mkWing('Ops');
    const day = addDays(TODAY(), 10);
    await api.post(`${V1}/holidays`).send({ name: 'Ops only', from: day, to: day, wingIds: [ops.id] });
    await api.post(`${V1}/holidays`).send({ name: 'Everyone', from: day, to: day });
    expect((await api.delete(`${V1}/wings/${ops.id}`)).status).toBe(204);
    expect(((await api.get(`${V1}/holidays?year=${day.slice(0, 4)}`)).body as { name: string }[]).map((h) => h.name)).toEqual(['Everyone']);
  });
});

describe('leave types', () => {
  it('create, duplicates, update, usage count, inactive types cannot be used', async () => {
    const res = await api.post(`${V1}/leave-types`).send({ name: 'Study', code: 'stu', color: '#112233' });
    expect(res.status).toBe(201);
    const t = zLeaveType.parse(res.body);
    expect(t).toMatchObject({ name: 'Study', code: 'STU', countsAsPresent: false, isActive: true, usageCount: 0 });
    for (const dup of [{ name: 'Other', code: 'CL' }, { name: 'casual', code: 'ZZ' }]) {
      const r = await api.post(`${V1}/leave-types`).send({ color: '#112233', ...dup });
      expect([r.status, r.body.error.code]).toEqual([409, 'DUPLICATE_LEAVE_TYPE']);
    }
    expect((await api.post(`${V1}/leave-types`).send({ name: 'Bad', code: 'B!', color: 'red' })).status).toBe(400);
    const e = await mkEmp('1', 'A');
    await api.post(`${V1}/leaves`).send({ employeeIds: [e.id], leaveTypeId: t.id, from: addDays(TODAY(), 5), to: addDays(TODAY(), 5) });
    const upd = await api.put(`${V1}/leave-types/${t.id}`).send({ name: 'Study', code: 'STU', color: '#112233', countsAsPresent: true, isActive: false });
    expect(zLeaveType.parse(upd.body)).toMatchObject({ countsAsPresent: true, isActive: false, usageCount: 1 });
    const blocked = await api.post(`${V1}/leaves`).send({ employeeIds: [e.id], leaveTypeId: t.id, from: addDays(TODAY(), 9), to: addDays(TODAY(), 9) });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.details).toHaveProperty('leaveTypeId');
    expect((await api.put(`${V1}/leave-types/${CL}`).send({ name: 'Study', code: 'CL', color: '#112233' })).status).toBe(409);
    expect((await auditRows('leave_type.create'))).toHaveLength(1);
    expect((await auditRows('leave_type.update'))[0]?.changes?.map((c) => c.field)).toEqual(expect.arrayContaining(['countsAsPresent', 'isActive']));
  });
});

describe('leave', () => {
  // 2027-03-01 is a Monday; the default timing is Mon-Fri.
  const MON = '2027-03-01';
  const SUN = '2027-03-07';

  it('one day, a range, working days, and half days', async () => {
    const e = await mkEmp('1', 'Ayesha');
    const range = await api.post(`${V1}/leaves`).send({ employeeIds: [e.id], leaveTypeId: CL, from: MON, to: SUN, reason: ' family ' });
    expect(range.status).toBe(201);
    const [l] = (range.body as unknown[]).map((x) => zLeave.parse(x));
    expect(l).toMatchObject({ employeeId: e.id, empCode: '1', employeeName: 'Ayesha', leaveTypeCode: 'CL', leaveTypeName: 'Casual', from: MON, to: SUN, part: 'full', workingDays: 5, reason: 'family', createdBy: 'Test Admin' });

    // a holiday inside the range reduces the working days (the record keeps the range as entered)
    await api.post(`${V1}/holidays`).send({ name: 'Midweek', from: '2027-03-03', to: '2027-03-03' });
    const got = zPage(zLeave).parse((await api.get(`${V1}/leaves?employeeId=${e.id}`)).body);
    expect(got.items[0]).toMatchObject({ from: MON, to: SUN, workingDays: 4 });

    const half = await api.post(`${V1}/leaves`).send({ employeeIds: [e.id], leaveTypeId: CL, from: '2027-04-05', to: '2027-04-05', part: 'first_half' });
    expect(zLeave.parse(half.body[0])).toMatchObject({ part: 'first_half', workingDays: 0.5 });
    const badHalf = await api.post(`${V1}/leaves`).send({ employeeIds: [e.id], leaveTypeId: CL, from: '2027-04-05', to: '2027-04-06', part: 'first_half' });
    expect(badHalf.status).toBe(400);
    expect((await api.post(`${V1}/leaves`).send({ employeeIds: [], leaveTypeId: CL, from: MON, to: MON })).status).toBe(400);
    expect((await api.post(`${V1}/leaves`).send({ employeeIds: [e.id], leaveTypeId: 999, from: '2027-05-03', to: '2027-05-03' })).status).toBe(400);
    expect((await api.post(`${V1}/leaves`).send({ employeeIds: [9999], leaveTypeId: CL, from: '2027-05-03', to: '2027-05-03' })).status).toBe(404);
  });

  it('bulk: many employees in one transaction, one audit entry each plus a summary', async () => {
    const a = await mkEmp('1', 'A');
    const b = await mkEmp('2', 'B');
    const c = await mkEmp('3', 'C');
    baseline = (await pool.query<{ m: string }>('SELECT COALESCE(max(id), 0) AS m FROM audit_logs')).rows[0]!.m as unknown as number;
    const res = await api.post(`${V1}/leaves`).send({ employeeIds: [c.id, a.id, b.id], leaveTypeId: 5, from: MON, to: '2027-03-02', reason: 'Field visit' });
    expect(res.status).toBe(201);
    const leaves = (res.body as unknown[]).map((x) => zLeave.parse(x));
    expect(leaves.map((l) => l.employeeId)).toEqual([c.id, a.id, b.id]);
    expect(leaves.every((l) => l.leaveTypeCode === 'OD' && l.workingDays === 2)).toBe(true);
    const rows = await auditRows('leave.create');
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.entity_label?.includes('·'))).toHaveLength(3);
    // audit writes are asynchronous, so entries are not ordered; find the summary by its label
    const summary = rows.find((r) => r.entity_label === '3 employees');
    expect(summary?.summary).toBe('Marked Official duty leave for 3 employees, 2027-03-01 to 2027-03-02');
    expect(summary?.metadata).toMatchObject({ employeeCount: 3 });
    expect(rows.filter((r) => r.summary.includes('2 working days')).length).toBe(3);
  });

  it('overlap: 409 LEAVE_OVERLAP lists each employee and the clashing dates and creates nothing', async () => {
    const a = await mkEmp('1', 'Ayesha');
    const b = await mkEmp('2', 'Bilal');
    await api.post(`${V1}/leaves`).send({ employeeIds: [a.id], leaveTypeId: CL, from: '2027-03-03', to: '2027-03-05' });
    const res = await api.post(`${V1}/leaves`).send({ employeeIds: [a.id, b.id], leaveTypeId: CL, from: MON, to: '2027-03-04' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LEAVE_OVERLAP');
    expect(res.body.error.details).toEqual([
      { employeeId: a.id, name: 'Ayesha', dates: [{ from: '2027-03-03', to: '2027-03-04' }], leaveType: { name: 'Casual', code: 'CL', color: '#2563EB' } },
    ]);
    expect((await pool.query('SELECT count(*) AS n FROM leaves')).rows[0].n).toBe('1');
  });

  it('replaceOverlapping trims, splits and removes the existing leave', async () => {
    const a = await mkEmp('1', 'Ayesha');
    const create = (from: string, to: string, extra: Record<string, unknown> = {}) =>
      api.post(`${V1}/leaves`).send({ employeeIds: [a.id], leaveTypeId: CL, from, to, ...extra });
    await create(MON, SUN);
    const split = await create('2027-03-03', '2027-03-04', { leaveTypeId: 3, replaceOverlapping: true });
    expect(split.status).toBe(201);
    const list = zPage(zLeave).parse((await api.get(`${V1}/leaves?employeeId=${a.id}&sort=from&order=asc`)).body);
    expect(list.items.map((l) => [l.leaveTypeCode, l.from, l.to])).toEqual([
      ['CL', MON, '2027-03-02'],
      ['ML', '2027-03-03', '2027-03-04'],
      ['CL', '2027-03-05', SUN],
    ]);
    // a replacement that covers a whole leave removes it
    await create('2027-02-25', '2027-03-02', { replaceOverlapping: true, leaveTypeId: 2 });
    const after = zPage(zLeave).parse((await api.get(`${V1}/leaves?employeeId=${a.id}&sort=from&order=asc`)).body);
    expect(after.items.map((l) => [l.leaveTypeCode, l.from, l.to])).toEqual([
      ['EL', '2027-02-25', '2027-03-02'],
      ['ML', '2027-03-03', '2027-03-04'],
      ['CL', '2027-03-05', SUN],
    ]);
    const rows = await auditRows('leave.update');
    expect(rows.some((r) => r.summary.startsWith('Trimmed existing leave'))).toBe(true);
  });

  it('PUT and DELETE a leave; PUT rejects an overlap with another leave of the same employee', async () => {
    const a = await mkEmp('1', 'Ayesha');
    const l1 = (await api.post(`${V1}/leaves`).send({ employeeIds: [a.id], leaveTypeId: CL, from: MON, to: '2027-03-02' })).body[0];
    const l2 = (await api.post(`${V1}/leaves`).send({ employeeIds: [a.id], leaveTypeId: CL, from: '2027-03-08', to: '2027-03-09' })).body[0];
    const upd = await api.put(`${V1}/leaves/${l1.id}`).send({ leaveTypeId: 3, from: MON, to: '2027-03-04', part: 'full', reason: 'flu' });
    expect(zLeave.parse(upd.body)).toMatchObject({ leaveTypeCode: 'ML', to: '2027-03-04', reason: 'flu', workingDays: 4 });
    const clash = await api.put(`${V1}/leaves/${l1.id}`).send({ leaveTypeId: 3, from: MON, to: '2027-03-08', part: 'full' });
    expect([clash.status, clash.body.error.code]).toEqual([409, 'LEAVE_OVERLAP']);
    expect((await api.delete(`${V1}/leaves/${l2.id}`)).status).toBe(204);
    expect((await api.delete(`${V1}/leaves/${l2.id}`)).status).toBe(404);
    expect((await api.put(`${V1}/leaves/999`).send({ leaveTypeId: 1, from: MON, to: MON, part: 'full' })).status).toBe(404);
    expect((await auditRows('leave.update')).some((r) => r.summary.startsWith('Edited leave of 1 · Ayesha'))).toBe(true);
    expect((await auditRows('leave.delete'))[0]?.summary).toContain('Cancelled Casual leave for 1 · Ayesha');
  });

  it('list filters and sorting', async () => {
    const ops = await mkWing('Ops');
    const a = await mkEmp('1', 'Zed', ops.id);
    const b = await mkEmp('2', 'Amir');
    await api.post(`${V1}/leaves`).send({ employeeIds: [a.id], leaveTypeId: CL, from: '2027-03-01', to: '2027-03-02' });
    await api.post(`${V1}/leaves`).send({ employeeIds: [b.id], leaveTypeId: 3, from: '2027-03-10', to: '2027-03-10' });
    const q = async (s: string) => zPage(zLeave).parse((await api.get(`${V1}/leaves?${s}`)).body);
    expect((await q('')).total).toBe(2);
    expect((await q('wingId=' + ops.id)).items.map((l) => l.employeeName)).toEqual(['Zed']);
    expect((await q('leaveTypeId=3')).items.map((l) => l.employeeName)).toEqual(['Amir']);
    expect((await q('from=2027-03-02&to=2027-03-09')).items.map((l) => l.employeeName)).toEqual(['Zed']);
    expect((await q('q=ami')).total).toBe(1);
    expect((await q('sort=employee&order=asc')).items.map((l) => l.employeeName)).toEqual(['Amir', 'Zed']);
    expect((await q('')).items[0]?.employeeName).toBe('Amir'); // default: newest first
    expect((await api.get(`${V1}/leaves?sort=bogus`)).status).toBe(400);
  });

  it('wing scope: leave only for employees in scope; lists are filtered', async () => {
    const ops = await mkWing('Ops');
    const adm = await mkWing('Admin');
    const mine = await mkEmp('1', 'Mine', ops.id);
    const other = await mkEmp('2', 'Other', adm.id);
    const u = await userClient({ permissions: ['leave.manage'], wings: [ops.id] });
    expect((await u.post(`${V1}/leaves`).send({ employeeIds: [mine.id], leaveTypeId: CL, from: MON, to: MON })).status).toBe(201);
    const bulk = await u.post(`${V1}/leaves`).send({ employeeIds: [mine.id, other.id], leaveTypeId: CL, from: '2027-03-09', to: '2027-03-09' });
    expect(bulk.status).toBe(404);
    expect((await pool.query('SELECT count(*) AS n FROM leaves')).rows[0].n).toBe('1'); // nothing partial
    const theirs = (await api.post(`${V1}/leaves`).send({ employeeIds: [other.id], leaveTypeId: CL, from: MON, to: MON })).body[0];
    const seen = zPage(zLeave).parse((await u.get(`${V1}/leaves`)).body);
    expect(seen.items.map((l) => l.employeeName)).toEqual(['Mine']);
    expect((await u.put(`${V1}/leaves/${theirs.id}`).send({ leaveTypeId: CL, from: MON, to: MON, part: 'full' })).status).toBe(404);
    expect((await u.delete(`${V1}/leaves/${theirs.id}`)).status).toBe(404);
  });
});

describe('daily attendance', () => {
  it('lists every employee in scope, absent ones included, with leave shown by type', async () => {
    await allDaysWorking();
    const day = ago(2);
    const ops = await mkWing('Ops');
    const present = await mkEmp('1', 'Present', ops.id);
    await mkEmp('2', 'Absent', ops.id);
    const onLeave = await mkEmp('3', 'On leave', ops.id);
    await mkEmp('4', 'Late', ops.id);
    await mkEmp('5', 'Elsewhere');
    await punch('1', day, '08:55:00');
    await punch('1', day, '17:10:00');
    await punch('4', day, '10:00:00');
    await punch('4', day, '17:00:00');
    await api.post(`${V1}/leaves`).send({ employeeIds: [onLeave.id], leaveTypeId: 5, from: day, to: day });

    const all = await daily(day);
    expect(all.total).toBe(5);
    expect(Object.fromEntries(all.items.map((d) => [d.empCode, d.status]))).toEqual({ '1': 'present', '2': 'absent', '3': 'leave', '4': 'late', '5': 'absent' });
    const l = all.items.find((d) => d.empCode === '3');
    expect(l?.leave).toMatchObject({ typeName: 'Official duty', code: 'OD', color: '#059669', part: 'full' });
    expect(all.items.find((d) => d.empCode === '1')).toMatchObject({ firstIn: '08:55', lastOut: '17:10', workedMinutes: 495, wingName: 'Ops', timing: { start: '09:00', end: '17:00' } });
    expect(all.items.find((d) => d.empCode === '4')).toMatchObject({ lateMinutes: 60 });

    expect((await daily(day, '&status=absent')).total).toBe(2);
    expect((await daily(day, `&wingId=${ops.id}`)).total).toBe(4);
    expect((await daily(day, '&q=lat')).items.map((d) => d.empCode)).toEqual(['4']);
    expect((await daily(day, '&sort=status&order=desc')).items[0]?.status).toBe('leave');
    // sort keys: name (default), empCode (numeric), wing, status, firstIn, workedMinutes, lateMinutes
    expect((await daily(day)).items.map((d) => d.name)).toEqual(['Absent', 'Elsewhere', 'Late', 'On leave', 'Present']);
    expect((await daily(day, '&sort=empCode&order=desc')).items.map((d) => d.empCode)).toEqual(['5', '4', '3', '2', '1']);
    expect((await daily(day, '&sort=wing')).items.map((d) => d.wingName)).toEqual(['Ops', 'Ops', 'Ops', 'Ops', null]);
    expect((await daily(day, '&sort=firstIn')).items.slice(0, 2).map((d) => d.empCode)).toEqual(['1', '4']);
    expect((await daily(day, '&sort=workedMinutes&order=desc')).items[0]?.empCode).toBe('1');
    expect((await daily(day, '&sort=lateMinutes&order=desc')).items[0]?.empCode).toBe('4');
    // the raw punch list the client uses to find the earliest punch date
    const first = await api.get(`${V1}/attendance?sort=punchTime&order=asc&pageSize=1`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0].punchTime).toBe(`${day} 08:55:00`);
    expect((await api.get(`${V1}/attendance/daily?date=${day}&sort=nope`)).status).toBe(400);
    expect((await api.get(`${V1}/attendance/daily`)).status).toBe(400);
    const paged = zPage(zAttendanceDay).parse((await api.get(`${V1}/attendance/daily?date=${day}&pageSize=2&page=3`)).body);
    expect([paged.total, paged.items.length]).toEqual([5, 1]);

    // /attendance (raw punches) is unchanged
    expect((await api.get(`${V1}/attendance`)).body.total).toBe(4);
    // the days now exist in the cache
    expect(Number((await pool.query('SELECT count(*) AS n FROM attendance_days')).rows[0].n)).toBe(5);
    void present;
  });

  it('shows the future as pending and weekends as weekend', async () => {
    await mkEmp('1', 'A');
    const page = await daily(addDays(TODAY(), 3));
    expect(['pending', 'weekend']).toContain(page.items[0]?.status);
    expect(Number((await pool.query('SELECT count(*) AS n FROM attendance_days')).rows[0].n)).toBe(0); // the future is never cached
  });

  it('inactive: before the join date and while disabled', async () => {
    await allDaysWorking();
    const day = ago(3);
    await mkEmp('1', 'Joins later', undefined, { joinDate: ago(1) });
    await mkEmp('2', 'Disabled');
    await pool.query(`UPDATE employees SET status = 'disabled', status_changed_at = $1::date + time '12:00' WHERE emp_code = '2'`, [ago(5)]);
    const page = await daily(day);
    expect(Object.fromEntries(page.items.map((d) => [d.empCode, d.status]))).toEqual({ '1': 'inactive', '2': 'inactive' });
  });

  it('employee days over a range, scope check, and the 400-day limit', async () => {
    await allDaysWorking();
    const ops = await mkWing('Ops');
    const adm = await mkWing('Admin');
    const a = await mkEmp('1', 'A', ops.id);
    const b = await mkEmp('2', 'B', adm.id);
    await punch('1', ago(2), '09:00:00');
    await punch('1', ago(2), '17:00:00');
    const days = zAttendanceDay.array().parse((await api.get(`${V1}/attendance/days?employeeId=${a.id}&from=${ago(3)}&to=${ago(1)}`)).body);
    expect(days.map((d) => d.date)).toEqual([ago(3), ago(2), ago(1)]);
    expect(days.map((d) => d.status)).toEqual(['absent', 'present', 'absent']);
    expect((await api.get(`${V1}/attendance/days?employeeId=${a.id}&from=${ago(500)}&to=${ago(1)}`)).status).toBe(400);
    expect((await api.get(`${V1}/attendance/days?employeeId=${a.id}&from=${ago(1)}&to=${ago(3)}`)).status).toBe(400);
    expect((await api.get(`${V1}/attendance/days?employeeId=999&from=${ago(3)}&to=${ago(1)}`)).status).toBe(404);
    const u = await userClient({ permissions: ['attendance.view'], wings: [ops.id] });
    expect((await u.get(`${V1}/attendance/days?employeeId=${a.id}&from=${ago(3)}&to=${ago(1)}`)).status).toBe(200);
    expect((await u.get(`${V1}/attendance/days?employeeId=${b.id}&from=${ago(3)}&to=${ago(1)}`)).status).toBe(404);
    expect(zPage(zAttendanceDay).parse((await u.get(`${V1}/attendance/daily?date=${ago(2)}`)).body).items.map((d) => d.empCode)).toEqual(['1']);
  });

  it('day-summary: counts per status and the rates', async () => {
    await allDaysWorking();
    const day = ago(2);
    const ids: number[] = [];
    for (const [i, n] of ['P', 'L', 'A', 'V', 'D'].entries()) ids.push((await mkEmp(String(i + 1), n)).id);
    await punch('1', day, '09:00:00');
    await punch('1', day, '17:00:00');
    await punch('2', day, '10:00:00');
    await punch('2', day, '17:00:00');
    await api.post(`${V1}/leaves`).send({ employeeIds: [ids[3]!], leaveTypeId: CL, from: day, to: day });
    await api.post(`${V1}/leaves`).send({ employeeIds: [ids[4]!], leaveTypeId: 5, from: day, to: day }); // official duty counts as present
    const s = zDaySummary.parse((await api.get(`${V1}/attendance/day-summary?from=${day}&to=${day}`)).body);
    expect(s).toMatchObject({ from: day, to: day, employees: 5, counts: { present: 1, late: 1, absent: 1, leave: 2, half_day: 0, holiday: 0 } });
    // attended = present + late + OD leave = 3 of 5 expected; punctuality = 1 of 2 arrivals
    expect(s.attendanceRate).toBe(60);
    expect(s.punctualityRate).toBe(50);
    expect((await api.get(`${V1}/attendance/day-summary?from=${day}&to=${ago(5)}`)).status).toBe(400);
  });

  it('overview carries today\'s status counts (extra field)', async () => {
    await mkEmp('1', 'A');
    const o = (await api.get(`${V1}/overview`)).body;
    expect(Object.values(o.todayStatus as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('corrections', () => {
  it('add a missing punch, override a status, remove them; audited and scoped', async () => {
    await allDaysWorking();
    const day = ago(2);
    const ops = await mkWing('Ops');
    const adm = await mkWing('Admin');
    const a = await mkEmp('1', 'Ayesha', ops.id);
    const other = await mkEmp('2', 'Other', adm.id);
    await punch('1', day, '09:00:00');
    expect(statusOf(await daily(day), '1')).toBe('incomplete');

    const res = await api.post(`${V1}/attendance/corrections`).send({ employeeId: a.id, date: day, type: 'add_punch', time: '17:05', reason: 'Forgot to punch out' });
    expect(res.status).toBe(201);
    const c = zCorrection.parse(res.body);
    expect(c).toMatchObject({ employeeId: a.id, date: day, type: 'add_punch', time: '17:05', status: null, createdBy: 'Test Admin' });
    const fixed = (await daily(day)).items.find((d) => d.empCode === '1');
    expect(fixed).toMatchObject({ status: 'present', lastOut: '17:05', corrected: true, punchCount: 2 });
    // original punches are untouched
    expect((await pool.query("SELECT count(*) AS n FROM attendance_logs WHERE pin = '1'")).rows[0].n).toBe('1');

    const st = await api.post(`${V1}/attendance/corrections`).send({ employeeId: other.id, date: day, type: 'set_status', status: 'present', reason: 'Official meeting outside' });
    expect(st.status).toBe(201);
    expect(statusOf(await daily(day), '2')).toBe('present');

    const list = (await api.get(`${V1}/attendance/corrections?employeeId=${a.id}&from=${day}&to=${day}`)).body.map((x: unknown) => zCorrection.parse(x));
    expect(list).toHaveLength(1);
    expect((await api.get(`${V1}/attendance/corrections`)).body).toHaveLength(2);

    expect((await api.delete(`${V1}/attendance/corrections/${c.id}`)).status).toBe(204);
    expect(statusOf(await daily(day), '1')).toBe('incomplete');
    expect((await api.delete(`${V1}/attendance/corrections/${c.id}`)).status).toBe(404);

    const added = await auditRows('attendance.correct');
    expect(added).toHaveLength(2);
    expect(added[0]?.summary).toBe(`Added a manual punch at 17:05 on ${day} for 1 · Ayesha: Forgot to punch out`);
    expect(added[0]?.changes?.map((x) => x.field)).toEqual(['punch', 'reason']);
    expect(added[1]?.summary).toContain('Set status of 2 · Other');
    expect((await auditRows('attendance.correction_delete'))[0]?.summary).toContain('Removed manual punch 17:05');

    // scope and validation: a corrector may add (in scope) but may not list or remove corrections
    const u = await userClient({ permissions: ['attendance.correct', 'attendance.view'], wings: [ops.id] });
    expect((await u.post(`${V1}/attendance/corrections`).send({ employeeId: other.id, date: day, type: 'set_status', status: 'absent', reason: 'because' })).status).toBe(404);
    expect((await u.post(`${V1}/attendance/corrections`).send({ employeeId: a.id, date: day, type: 'set_status', status: 'absent', reason: 'because' })).status).toBe(201);
    expect((await u.get(`${V1}/attendance/corrections`)).status).toBe(403);
    const otherCorr = (await api.get(`${V1}/attendance/corrections?employeeId=${other.id}`)).body[0];
    expect((await u.delete(`${V1}/attendance/corrections/${otherCorr.id}`)).status).toBe(403);
    for (const bad of [
      { employeeId: a.id, date: day, type: 'add_punch', time: '17:05', reason: 'x' },
      { employeeId: a.id, date: day, type: 'add_punch', reason: 'long enough' },
      { employeeId: a.id, date: day, type: 'set_status', reason: 'long enough' },
      { employeeId: a.id, date: addDays(TODAY(), 2), type: 'set_status', status: 'present', reason: 'future' },
    ]) {
      expect((await api.post(`${V1}/attendance/corrections`).send(bad)).status).toBe(400);
    }
  });

  it('the corrected marker and the correction audit entries are visible to the Super Admin only', async () => {
    await allDaysWorking();
    const day = ago(2);
    const a = await mkEmp('1', 'Ayesha');
    await punch('1', day, '09:00:00');
    // corrector with every other relevant permission, including audit.view
    const corrector = await userClient({ permissions: ['attendance.correct', 'attendance.view', 'audit.view'] });
    const REASON = 'Visibility check xq7';
    expect((await corrector.post(`${V1}/attendance/corrections`).send({ employeeId: a.id, date: day, type: 'add_punch', time: '17:05', reason: REASON })).status).toBe(201);

    // Super Admin sees the marker; the corrector and a viewer see the corrected status without it
    const viewer = await userClient({ permissions: ['attendance.view', 'audit.view'] });
    const pick = (b: { items: { empCode: string; corrected: boolean; status: string }[] }) => b.items.find((d) => d.empCode === '1')!;
    expect(pick((await api.get(`${V1}/attendance/daily?date=${day}`)).body)).toMatchObject({ status: 'present', corrected: true });
    for (const c of [corrector, viewer]) {
      expect(pick((await c.get(`${V1}/attendance/daily?date=${day}`)).body)).toMatchObject({ status: 'present', corrected: false });
      const days = (await c.get(`${V1}/attendance/days?employeeId=${a.id}&from=${day}&to=${day}`)).body as { corrected: boolean }[];
      expect(days.every((d) => d.corrected === false)).toBe(true);
    }
    const saDays = (await api.get(`${V1}/attendance/days?employeeId=${a.id}&from=${day}&to=${day}`)).body as { corrected: boolean }[];
    expect(saDays[0]?.corrected).toBe(true);

    // the audit entry is written, but only the Super Admin can read it (list, entry, filters, summary, export).
    // (audit_logs is append-only, so earlier tests' rows are still there: filter on this test's unique reason.)
    const saList = (await api.get(`${V1}/audit?action=attendance.correct&q=${encodeURIComponent(REASON)}`)).body;
    expect(saList.total).toBe(1);
    const entryId = saList.items[0].id as number;
    expect((await api.get(`${V1}/audit/${entryId}`)).status).toBe(200);
    for (const c of [corrector, viewer]) {
      expect((await c.get(`${V1}/audit?action=attendance.correct`)).body.total).toBe(0);
      expect((await c.get(`${V1}/audit?q=${encodeURIComponent(REASON)}`)).body.total).toBe(0);
      expect((await c.get(`${V1}/audit/${entryId}`)).status).toBe(404);
      const csv = (await c.get(`${V1}/audit/export?action=attendance.correct`)).text;
      expect(csv).not.toContain(REASON);
    }
    // the corrector's own activity feed does not show it either
    const me = (await corrector.get(`${V1}/auth/me`)).body.user.id as number;
    const mine = (await corrector.get(`${V1}/audit?userId=${me}`)).body.items as { action: string }[];
    expect(mine.some((x) => x.action === 'attendance.correct')).toBe(false);
    // summary counts differ by exactly the hidden entry
    const saSum = (await api.get(`${V1}/audit/summary`)).body;
    const vSum = (await viewer.get(`${V1}/audit/summary`)).body;
    expect(saSum.total - vSum.total).toBeGreaterThanOrEqual(1);
  });
});

describe('recompute queue and worker', () => {
  const dirtyCount = async () => Number((await pool.query('SELECT count(*) AS n FROM attendance_dirty')).rows[0].n);

  it('an ATTLOG post marks the employee-day dirty; the worker recomputes it', async () => {
    await allDaysWorking();
    const day = ago(1);
    const e = await mkEmp('501', 'Ayesha');
    const dev = await createDevice('ATTSN001');
    const post = (time: string) =>
      adms.post(`/iclock/cdata?SN=${dev.serialNumber}&table=ATTLOG&Stamp=1`).set('Content-Type', 'text/plain').send(`501\t${day} ${time}\t0\t1\n`);
    expect((await post('09:00:00')).text).toMatch(/^OK/);
    // the punch's day, and the day before (a morning punch can close a night shift that started the evening before)
    expect((await pool.query('SELECT employee_id, to_char(date, \'YYYY-MM-DD\') AS d FROM attendance_dirty ORDER BY date')).rows).toEqual([
      { employee_id: e.id, d: addDays(day, -1) },
      { employee_id: e.id, d: day },
    ]);

    expect(await worker.drain({ yieldMs: 0 })).toBe(2);
    expect(await dirtyCount()).toBe(0);
    const cached = (await pool.query('SELECT status, first_in, punch_count FROM attendance_days WHERE employee_id = $1 AND date = $2', [e.id, day])).rows;
    expect(cached).toEqual([{ status: 'incomplete', first_in: '09:00', punch_count: 1 }]);

    // a later punch: the read is already correct, and the worker refreshes the cache
    await post('17:00:00');
    expect(await dirtyCount()).toBe(2); // that day and the day before
    expect(statusOf(await daily(day), '501')).toBe('present');
    await worker.drain({ yieldMs: 0 });
    expect((await pool.query('SELECT status, last_out FROM attendance_days WHERE employee_id = $1 AND date = $2', [e.id, day])).rows).toEqual([{ status: 'present', last_out: '17:00' }]);

    // a duplicate punch changes nothing and queues nothing
    await post('17:00:00');
    expect(await dirtyCount()).toBe(0);
    // punches of unknown pins are ignored
    await adms.post(`/iclock/cdata?SN=${dev.serialNumber}&table=ATTLOG&Stamp=2`).set('Content-Type', 'text/plain').send(`999\t${day} 09:00:00\t0\t1\n`);
    expect(await dirtyCount()).toBe(0);
  });

  it('rule and data changes queue the affected cached days', async () => {
    await allDaysWorking();
    const e = await mkEmp('1', 'A');
    await mkEmp('2', 'B');
    const from = ago(4);
    await daily(ago(3));
    await daily(ago(1));
    expect(await dirtyCount()).toBe(0);
    await api.post(`${V1}/holidays`).send({ name: 'H', from, to: ago(3) });
    expect(await dirtyCount()).toBe(4); // 2 employees x 2 days in range
    await worker.drain({ yieldMs: 0 });
    expect(statusOf(await daily(ago(3)), '1')).toBe('holiday');
    await api.post(`${V1}/leaves`).send({ employeeIds: [e.id], leaveTypeId: CL, from: ago(1), to: ago(1) });
    expect(await dirtyCount()).toBe(1);
    await worker.drain({ yieldMs: 0 });
    expect((await pool.query('SELECT status FROM attendance_days WHERE employee_id = $1 AND date = $2', [e.id, ago(1)])).rows[0].status).toBe('leave');
    // employee changes: disabling requeues the cached days
    await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled', reason: 'test', force: true });
    expect(await dirtyCount()).toBeGreaterThan(0);
    await worker.drain({ yieldMs: 0 });
    expect(statusOf(await daily(ago(1)), '1')).toBe('leave'); // history before the change is kept
    expect(statusOf(await daily(TODAY()), '1')).toBe('inactive');
  });

  it('POST /attendance/recompute queues the range for everyone and is audited', async () => {
    await mkEmp('1', 'A');
    await mkEmp('2', 'B');
    const res = await api.post(`${V1}/attendance/recompute`).send({ from: ago(3), to: ago(1) });
    expect([res.status, res.body]).toEqual([202, { queuedDays: 6 }]);
    expect(await dirtyCount()).toBe(6);
    expect((await auditRows('attendance.recompute'))[0]?.summary).toContain(`from ${ago(3)} to ${ago(1)}`);
    expect((await api.post(`${V1}/attendance/recompute`).send({ from: ago(1), to: ago(3) })).status).toBe(400);
  });

  it('backfills when the cache is empty, from the earliest punch to today, then does nothing', async () => {
    await allDaysWorking();
    await mkEmp('1', 'A');
    await mkEmp('2', 'B');
    await mkEmp('3', 'C');
    await punch('1', ago(4), '09:00:00');
    await punch('1', ago(4), '17:00:00');
    await punch('2', ago(2), '09:00:00');
    expect(await worker.backfillIfEmpty()).toBe(3 * 5); // 3 employees x (ago(4)..today)
    expect(await dirtyCount()).toBe(15);
    expect(await worker.drain({ yieldMs: 0 })).toBe(15);
    expect(Number((await pool.query('SELECT count(*) AS n FROM attendance_days')).rows[0].n)).toBe(15);
    expect(statusOf(await daily(ago(4)), '1')).toBe('present');
    expect(statusOf(await daily(ago(2)), '2')).toBe('incomplete');
    expect(await worker.backfillIfEmpty()).toBe(0);
  });

  it('backfill needs punches; nightly and refresh-today requeue what they should', async () => {
    await mkEmp('1', 'A');
    expect(await worker.backfillIfEmpty()).toBe(0);
    await daily(ago(1));
    await daily(TODAY());
    expect(await worker.refreshToday()).toBe(1);
    await worker.drain({ yieldMs: 0 });
    expect(await worker.nightly()).toBe(2); // yesterday and today
  });

  it('processes more than one batch of 500 without overlapping runs', async () => {
    for (let i = 1; i <= 3; i++) await mkEmp(String(i), `E${i}`);
    await pool.query(
      `INSERT INTO attendance_dirty (employee_id, date) SELECT e.id, d::date FROM employees e CROSS JOIN generate_series(current_date - 400, current_date - 1, interval '1 day') d`,
    );
    expect(await dirtyCount()).toBe(1200);
    const [a, b] = await Promise.all([worker.drain({ yieldMs: 0 }), worker.drain({ yieldMs: 0 })]);
    expect(a + b).toBe(1200); // the second call returns 0: runs never overlap
    expect(await dirtyCount()).toBe(0);
  });
});
