import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  zAdmsRequest,
  zAttendanceRecord,
  zWing,
  zDevice,
  zDeviceCommand,
  zDeviceUser,
  zEmployee,
  zEmployeeDetail,
  zErrorBody,
  zHealth,
  zOverview,
  zPage,
} from '@nacta/shared';
import { adms, api, closeDb, createDevice, dbDate, pool, resetDb, V1 } from './helpers';

beforeEach(resetDb);
afterAll(closeDb);

const emp = (over: Record<string, unknown> = {}) => ({ empCode: '1', name: 'Ali Khan', ...over });
async function mkEmp(over: Record<string, unknown> = {}) {
  const { status, ...rest } = over;
  const res = await api.post(`${V1}/employees`).send(emp(rest));
  if (res.status !== 201) throw new Error(`mkEmp: ${res.status} ${JSON.stringify(res.body)}`);
  if (status && status !== 'active') {
    const s = await api.post(`${V1}/employees/${res.body.id}/status`).send({ status, force: true });
    if (s.status !== 200) throw new Error(`mkEmp status: ${s.status} ${JSON.stringify(s.body)}`);
  }
  return res.body as { id: number; empCode: string };
}
async function punch(deviceId: number, pin: string, time: string) {
  await pool.query(`INSERT INTO attendance_logs (device_id, pin, punch_time, status, verify_type) VALUES ($1, $2, $3::timestamp, 0, 15)`, [deviceId, pin, time]);
}

describe('platform: health, errors, request ids, headers', () => {
  it('GET /health matches zHealth and carries version + uptime', async () => {
    const res = await api.get(`${V1}/health`);
    expect(res.status).toBe(200);
    const h = zHealth.parse(res.body);
    expect(h).toMatchObject({ ok: true, db: true, admsPort: 8081 });
    expect(h.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(h.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('removes the old /api mount', async () => {
    for (const url of ['/api/health', '/api/devices', '/api/employees']) {
      const res = await api.get(url);
      expect(res.status).toBe(404);
      expect(zErrorBody.parse(res.body).error.code).toBe('NOT_FOUND');
    }
  });

  it('echoes X-Request-Id and puts it in the error body', async () => {
    const a = await api.get(`${V1}/nope`).set('X-Request-Id', 'trace-123');
    expect(a.headers['x-request-id']).toBe('trace-123');
    expect(a.status).toBe(404);
    expect(a.body.error).toMatchObject({ code: 'NOT_FOUND', requestId: 'trace-123' });
    const b = await api.get(`${V1}/health`);
    expect(b.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const c = await api.get(`${V1}/health`).set('X-Request-Id', 'bad id with spaces!');
    expect(c.headers['x-request-id']).not.toBe('bad id with spaces!');
  });

  it('applies helmet and CORS on the API', async () => {
    const res = await api.get(`${V1}/health`).set('Origin', 'http://localhost:5173');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
    const other = await api.get(`${V1}/health`).set('Origin', 'http://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects malformed JSON and bodies over 1 MB with the error envelope', async () => {
    const bad = await api.post(`${V1}/wings`).set('Content-Type', 'application/json').send('{"name":');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Malformed JSON body' });
    const big = await api.post(`${V1}/wings`).send({ name: 'x'.repeat(1_100_000) });
    expect(big.status).toBe(413);
    expect(zErrorBody.parse(big.body).error.requestId).toBeTruthy();
  });

  it('maps unexpected errors to 500 INTERNAL without leaking details', async () => {
    const orig = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
    const { vi } = await import('vitest');
    const spy = vi.spyOn(pool, 'query').mockImplementation(((sql: unknown, ...rest: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('FROM wings')) return Promise.reject(new Error('secret table detail'));
      return orig(sql, ...rest);
    }) as never);
    try {
      const res = await api.get(`${V1}/wings`);
      expect(res.status).toBe(500);
      expect(res.body.error).toMatchObject({ code: 'INTERNAL', message: 'Internal server error' });
      expect(JSON.stringify(res.body)).not.toContain('secret');
      expect(JSON.stringify(res.body)).not.toContain('stack');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('devices', () => {
  it('CRUD with a unique serial number (409 DUPLICATE_DEVICE)', async () => {
    const created = await api.post(`${V1}/devices`).send({ name: '  Main gate ', serialNumber: ' SN-001 ', location: '' });
    expect(created.status).toBe(201);
    const dev = zDevice.parse(created.body);
    expect(dev).toMatchObject({ name: 'Main gate', serialNumber: 'SN-001', location: null, isActive: true, status: 'unknown', autoRegistered: false });

    const dup = await api.post(`${V1}/devices`).send({ name: 'Other', serialNumber: 'SN-001' });
    expect(dup.status).toBe(409);
    expect(zErrorBody.parse(dup.body).error.code).toBe('DUPLICATE_DEVICE');

    const list = await api.get(`${V1}/devices`);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body).toHaveLength(1);
    zDevice.parse(list.body[0]);

    const upd = await api.put(`${V1}/devices/${dev.id}`).send({ name: 'Renamed', location: 'Lobby', isActive: false });
    expect(upd.status).toBe(200);
    expect(zDevice.parse(upd.body)).toMatchObject({ name: 'Renamed', location: 'Lobby', isActive: false, serialNumber: 'SN-001' });

    const noop = await api.put(`${V1}/devices/${dev.id}`).send({});
    expect(noop.status).toBe(200);
    expect(noop.body.name).toBe('Renamed');

    expect((await api.get(`${V1}/devices/${dev.id}`)).body.name).toBe('Renamed');

    const other = await createDevice('SN-002');
    const clash = await api.put(`${V1}/devices/${other.id}`).send({ serialNumber: 'SN-001' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('DUPLICATE_DEVICE');

    const del = await api.delete(`${V1}/devices/${dev.id}`);
    expect(del.status).toBe(204);
    expect(del.text).toBe('');
    expect((await api.get(`${V1}/devices/${dev.id}`)).status).toBe(404);
    expect((await api.delete(`${V1}/devices/${dev.id}`)).status).toBe(404);
  });

  it('validates input with field-keyed details', async () => {
    const res = await api.post(`${V1}/devices`).send({ name: '', serialNumber: 'bad serial!', isActive: 'yes' });
    expect(res.status).toBe(400);
    const err = zErrorBody.parse(res.body).error;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({
      name: 'Name is required',
      serialNumber: 'Letters, digits, "-" and "_" only',
      isActive: expect.any(String),
    });
    const missing = await api.post(`${V1}/devices`).send({});
    expect(missing.body.error.details).toHaveProperty('name');
    expect(missing.body.error.details).toHaveProperty('serialNumber');
    const nobody = await api.post(`${V1}/devices`);
    expect(nobody.status).toBe(400);
  });

  it('answers 404 for unknown or malformed ids', async () => {
    for (const id of ['999', 'abc', '0', '99999999999']) {
      const res = await api.get(`${V1}/devices/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('reports online status from last_seen_at and counts', async () => {
    await adms.get('/iclock/cdata?SN=LIVE0001');
    const stale = await createDevice('STALE001');
    await pool.query(`UPDATE devices SET last_seen_at = now() - interval '1 hour' WHERE id = $1`, [stale.id]);
    const list = await api.get(`${V1}/devices`);
    const byName = Object.fromEntries(list.body.map((d: { serialNumber: string; status: string }) => [d.serialNumber, d.status]));
    expect(byName).toEqual({ LIVE0001: 'online', STALE001: 'offline' });
  });

  it('enqueues commands (validated) and lists them as a page with a status filter', async () => {
    const dev = await createDevice();
    const bad = await api.post(`${V1}/devices/${dev.id}/commands`).send({ type: 'format' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details).toHaveProperty('type');
    expect((await api.post(`${V1}/devices/999/commands`).send({ type: 'info' })).status).toBe(404);

    for (const type of ['info', 'check', 'reboot', 'syncTime']) {
      const ok = await api.post(`${V1}/devices/${dev.id}/commands`).send({ type });
      expect(ok.status).toBe(201);
      zDeviceCommand.parse(ok.body);
    }
    const all = await api.get(`${V1}/devices/${dev.id}/commands`);
    const page = zPage(zDeviceCommand).parse(all.body);
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 50 });
    expect(page.items.map((c) => c.command.split(' ')[0])).toEqual(['SET', 'REBOOT', 'CHECK', 'INFO']); // newest first
    expect(page.items[0]?.command).toMatch(/^SET OPTION DateTime=\d+$/);

    const asc = await api.get(`${V1}/devices/${dev.id}/commands?sort=id&order=asc&pageSize=2&page=2`);
    expect(asc.body.items.map((c: { command: string }) => c.command.split(' ')[0])).toEqual(['REBOOT', 'SET']);
    expect(asc.body).toMatchObject({ total: 4, page: 2, pageSize: 2 });

    const pending = await api.get(`${V1}/devices/${dev.id}/commands?status=pending`);
    expect(pending.body.total).toBe(4);
    expect((await api.get(`${V1}/devices/${dev.id}/commands?status=success`)).body.total).toBe(0);
    expect((await api.get(`${V1}/devices/${dev.id}/commands?status=nope`)).status).toBe(400);
    expect((await api.get(`${V1}/devices/${dev.id}/commands?sort=command; DROP TABLE devices`)).status).toBe(400);
  });
});

describe('device users', () => {
  it('lists users held on a device with sort, filters and template counts', async () => {
    const dev = await createDevice('VDE1');
    await adms.post('/iclock/cdata?SN=VDE1&table=OPERLOG').send(
      ['USER PIN=2\tName=Zed\tPri=0', 'USER PIN=10\tName=Amy\tPri=14\tPasswd=1', 'USER PIN=100\tName=Bob\tPri=0',
        'FP PIN=10\tFID=0\tSize=3\tValid=1\tTMP=QUJD', 'BIODATA Pin=10\tNo=0\tIndex=0\tValid=1\tType=9\tTmp=QUJD', 'BIODATA Pin=10\tNo=1\tIndex=0\tValid=1\tType=8\tTmp=QUJD'].join('\n'),
    );
    await mkEmp({ empCode: '10', name: 'Amy Employee' });

    const res = await api.get(`${V1}/devices/${dev.id}/users`);
    const page = zPage(zDeviceUser).parse(res.body);
    expect(page.items.map((u) => u.pin)).toEqual(['2', '10', '100']); // numeric, not lexical
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    const amy = page.items[1]!;
    expect(amy).toMatchObject({ name: 'Amy', privilege: 14, hasPassword: true, employeeName: 'Amy Employee', templates: { fp: 1, face: 1, bio: 1 } });

    const desc = await api.get(`${V1}/devices/${dev.id}/users?sort=pin&order=desc`);
    expect(desc.body.items.map((u: { pin: string }) => u.pin)).toEqual(['100', '10', '2']);
    const byName = await api.get(`${V1}/devices/${dev.id}/users?sort=name`);
    expect(byName.body.items.map((u: { name: string }) => u.name)).toEqual(['Amy', 'Bob', 'Zed']);
    expect((await api.get(`${V1}/devices/${dev.id}/users?linked=true`)).body.items.map((u: { pin: string }) => u.pin)).toEqual(['10']);
    expect((await api.get(`${V1}/devices/${dev.id}/users?linked=false`)).body.total).toBe(2);
    expect((await api.get(`${V1}/devices/${dev.id}/users?q=bo`)).body.items.map((u: { pin: string }) => u.pin)).toEqual(['100']);
    expect((await api.get(`${V1}/devices/${dev.id}/users?q=%25`)).body.total).toBe(0); // % is literal
    const p2 = await api.get(`${V1}/devices/${dev.id}/users?pageSize=2&page=2`);
    expect(p2.body.items.map((u: { pin: string }) => u.pin)).toEqual(['100']);
    expect((await api.get(`${V1}/devices/${dev.id}/users?sort=raw`)).status).toBe(400);
    expect((await api.get(`${V1}/devices/999/users`)).status).toBe(404);
  });

  it('fetch queues three queries; delete queues one; import creates employees', async () => {
    const dev = await createDevice('VDE2');
    const fetch = await api.post(`${V1}/devices/${dev.id}/users/fetch`);
    expect(fetch.body).toEqual({ queued: 3 });
    const cmds = await api.get(`${V1}/devices/${dev.id}/commands?sort=id&order=asc`);
    expect(cmds.body.items.map((c: { command: string }) => c.command)).toEqual(['DATA QUERY USERINFO', 'DATA QUERY FINGERTMP', 'DATA QUERY BIODATA Type=9']);

    const del = await api.delete(`${V1}/devices/${dev.id}/users/${encodeURIComponent('55')}`);
    expect(del.body).toEqual({ queued: 1 });
    expect((await api.get(`${V1}/devices/${dev.id}/commands`)).body.items[0].command).toBe('DATA DELETE USERINFO PIN=55');

    await adms.post('/iclock/cdata?SN=VDE2&table=OPERLOG').send('USER PIN=7\tName=Seven\tPri=14\nUSER PIN=8\tName=\tPri=0\nUSER PIN=abc\tName=Bad\tPri=0\n');
    const imp = await api.post(`${V1}/devices/${dev.id}/users/import`).send({});
    expect(imp.body).toEqual({ created: 2, updated: 0, skipped: 1 });
    const emps = await api.get(`${V1}/employees?sort=empCode`);
    expect(emps.body.items.map((e: { empCode: string; name: string; privilege: number }) => [e.empCode, e.name, e.privilege])).toEqual([
      ['7', 'Seven', 14],
      ['8', 'User 8', 0],
    ]);
    const again = await api.post(`${V1}/devices/${dev.id}/users/import`).send({ overwrite: true, pins: ['7'] });
    expect(again.body).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect((await api.post(`${V1}/devices/${dev.id}/users/import`).send({ pins: 'nope' })).status).toBe(400);
  });
});

describe('wings', () => {
  it('CRUD, case-insensitive ordering, employee counts, 409 DUPLICATE_WING', async () => {
    const b = await api.post(`${V1}/wings`).send({ name: ' beta ' });
    expect(b.status).toBe(201);
    expect(zWing.parse(b.body)).toMatchObject({ name: 'beta', employeeCount: 0 });
    const a = await api.post(`${V1}/wings`).send({ name: 'Alpha' });
    const dup = await api.post(`${V1}/wings`).send({ name: 'Alpha' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_WING');

    await mkEmp({ empCode: '1', wingId: a.body.id });
    const list = await api.get(`${V1}/wings`);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.map((d: { name: string; employeeCount: number }) => [d.name, d.employeeCount])).toEqual([['Alpha', 1], ['beta', 0]]);

    const ren = await api.put(`${V1}/wings/${b.body.id}`).send({ name: 'Gamma' });
    expect(ren.body.name).toBe('Gamma');
    expect((await api.put(`${V1}/wings/${b.body.id}`).send({ name: 'Alpha' })).status).toBe(409);
    expect((await api.put(`${V1}/wings/999`).send({ name: 'X' })).status).toBe(404);
    const invalid = await api.post(`${V1}/wings`).send({ name: '   ' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details).toEqual({ name: 'Name is required' });

    expect((await api.delete(`${V1}/wings/${a.body.id}`)).status).toBe(204);
    expect((await api.delete(`${V1}/wings/${a.body.id}`)).status).toBe(404);
    // employees survive the wing
    const e = await api.get(`${V1}/employees`);
    expect(e.body.items[0]).toMatchObject({ wingId: null, wingName: null });
  });
});

describe('employees', () => {
  it('creates with defaults, returns the full shape and detail with device refs', async () => {
    const dev = await createDevice('VDE3');
    const dep = await api.post(`${V1}/wings`).send({ name: 'Admin' });
    const res = await api.post(`${V1}/employees`).send({ empCode: 7, name: ' Ali ', wingId: dep.body.id, email: 'a@b.pk', joinDate: '2024-02-29', phone: '' });
    expect(res.status).toBe(201);
    const e = zEmployee.parse(res.body);
    expect(e).toMatchObject({
      empCode: '7', name: 'Ali', wingName: 'Admin', privilege: 0, status: 'active', deviceSync: 'not_on_device', hasPhoto: false, phone: null, email: 'a@b.pk',
      joinDate: '2024-02-29', deviceCount: 0, templates: { fp: 0, face: 0, bio: 0 },
    });

    await adms.post('/iclock/cdata?SN=VDE3&table=OPERLOG').send('USER PIN=7\tName=Ali\tPri=0\nFP PIN=7\tFID=0\tSize=3\tValid=1\tTMP=QUJD');
    const detail = zEmployeeDetail.parse((await api.get(`${V1}/employees/${e.id}`)).body);
    expect(detail.deviceCount).toBe(1);
    expect(detail.templates.fp).toBe(1);
    expect(detail.devices).toEqual([{ deviceId: dev.id, deviceName: 'Test device', onDevice: true, lastCommand: null, lastSeenAt: expect.any(String) }]);
  });

  it('validates every field and keys details by camelCase field', async () => {
    const res = await api.post(`${V1}/employees`).send({
      empCode: '12a', name: '', wingId: 'x', privilege: 5, email: 'nope', joinDate: 'yesterday', bps: 99, cnic: '123', designation: 'd'.repeat(101),
    });
    expect(res.status).toBe(400);
    const d = zErrorBody.parse(res.body).error.details as Record<string, string>;
    expect(Object.keys(d).sort()).toEqual(['bps', 'cnic', 'designation', 'email', 'empCode', 'joinDate', 'name', 'privilege', 'wingId']);
    expect(d.name).toBe('Name is required');
    expect(d.email).toBe('Invalid email');
    expect(d.designation).toBe('At most 100 characters');

    // well-formed but impossible dates are rejected too (not a Postgres 500)
    const feb30 = await api.post(`${V1}/employees`).send(emp({ joinDate: '2024-02-30' }));
    expect([feb30.status, feb30.body.error.details]).toEqual([400, { joinDate: 'Not a real date' }]);
    const e = await mkEmp({ empCode: '77' });
    expect((await api.put(`${V1}/employees/${e.id}`).send({ joinDate: '2023-13-01' })).status).toBe(400);

    const missing = await api.post(`${V1}/employees`).send({});
    expect(missing.body.error.details).toHaveProperty('empCode');
    expect(missing.body.error.details).toHaveProperty('name');
    expect((await api.post(`${V1}/employees`).send(emp({ empCode: '1234567890' }))).status).toBe(400);
    const badDep = await api.post(`${V1}/employees`).send(emp({ wingId: 4242 }));
    expect(badDep.status).toBe(400);
    expect(badDep.body.error.details).toEqual({ wingId: 'wing does not exist' });
  });

  it('409 DUPLICATE_EMP_CODE on create and update', async () => {
    await mkEmp({ empCode: '1' });
    const two = await mkEmp({ empCode: '2', name: 'Two' });
    const dup = await api.post(`${V1}/employees`).send(emp({ empCode: '1' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_EMP_CODE');
    const clash = await api.put(`${V1}/employees/${two.id}`).send({ empCode: '1' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('DUPLICATE_EMP_CODE');
  });

  it('PUT is a partial update; null clears; the code is locked while a device holds the user', async () => {
    const dev = await createDevice('VDE4');
    const e = await mkEmp({ empCode: '5', designation: 'Clerk', phone: '123' });
    const upd = await api.put(`${V1}/employees/${e.id}`).send({ name: 'New Name', designation: null, bps: 12 });
    expect(upd.status).toBe(200);
    expect(zEmployee.parse(upd.body)).toMatchObject({ name: 'New Name', designation: null, phone: '123', bps: 12, empCode: '5' });
    expect((await api.put(`${V1}/employees/${e.id}`).send({})).status).toBe(200);
    expect((await api.put(`${V1}/employees/${e.id}`).send({ name: '' })).status).toBe(400);
    expect((await api.put(`${V1}/employees/999`).send({ name: 'x' })).status).toBe(404);

    expect((await api.put(`${V1}/employees/${e.id}`).send({ empCode: '6' })).body.empCode).toBe('6');
    await pool.query(`INSERT INTO device_users (device_id, pin, name) VALUES ($1, '6', 'x')`, [dev.id]);
    const locked = await api.put(`${V1}/employees/${e.id}`).send({ empCode: '7' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('EMP_CODE_ON_DEVICE');
    expect((await api.put(`${V1}/employees/${e.id}`).send({ empCode: '6', name: 'same code ok' })).status).toBe(200);
  });

  it('lists as a Page with search, filters, numeric empCode sort and other sorts', async () => {
    const dep = await api.post(`${V1}/wings`).send({ name: 'Wing A' });
    const codes = ['100', '9', '20', '3'];
    const names = ['Dina', 'Carl', 'Bela', 'Adam'];
    for (let i = 0; i < codes.length; i++) {
      await mkEmp({ empCode: codes[i], name: names[i], wingId: i < 2 ? dep.body.id : null, status: i === 3 ? 'disabled' : 'active' });
    }
    const codesOf = (r: { body: { items: { empCode: string }[] } }) => r.body.items.map((e) => e.empCode);

    const def = await api.get(`${V1}/employees`);
    zPage(zEmployee).parse(def.body);
    expect(def.body).toMatchObject({ total: 4, page: 1, pageSize: 50 });
    expect(codesOf(def)).toEqual(['3', '9', '20', '100']);
    expect(codesOf(await api.get(`${V1}/employees?sort=empCode&order=desc`))).toEqual(['100', '20', '9', '3']);
    expect(codesOf(await api.get(`${V1}/employees?sort=name`))).toEqual(['3', '20', '9', '100']);
    expect(codesOf(await api.get(`${V1}/employees?sort=name&order=desc`))).toEqual(['100', '9', '20', '3']);
    // employees without a wing always sort last; ties fall back to creation order
    expect(codesOf(await api.get(`${V1}/employees?sort=wing&order=asc`))).toEqual(['100', '9', '20', '3']);
    expect(codesOf(await api.get(`${V1}/employees?sort=wing&order=desc`))).toEqual(['9', '100', '3', '20']);
    expect(codesOf(await api.get(`${V1}/employees?sort=createdAt&order=desc`))).toEqual(['3', '20', '9', '100']);

    const p1 = await api.get(`${V1}/employees?pageSize=3&page=1`);
    const p2 = await api.get(`${V1}/employees?pageSize=3&page=2`);
    expect(codesOf(p1)).toEqual(['3', '9', '20']);
    expect(codesOf(p2)).toEqual(['100']);
    expect(p2.body).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect((await api.get(`${V1}/employees?page=99`)).body).toMatchObject({ items: [], total: 4, page: 99 });

    expect(codesOf(await api.get(`${V1}/employees?q=ar`))).toEqual(['9']); // Carl
    expect(codesOf(await api.get(`${V1}/employees?q=20`))).toEqual(['20']);
    expect(codesOf(await api.get(`${V1}/employees?wingId=${dep.body.id}`))).toEqual(['9', '100']);
    expect(codesOf(await api.get(`${V1}/employees?status=disabled`))).toEqual(['3']);
    expect(codesOf(await api.get(`${V1}/employees?status=active&sort=empCode`))).toEqual(['9', '20', '100']);
    expect((await api.get(`${V1}/employees?q=`)).body.total).toBe(4); // empty filter ignored

    for (const bad of ['page=0', 'pageSize=501', 'pageSize=abc', 'order=up', 'sort=password', 'status=maybe', 'wingId=-1']) {
      const r = await api.get(`${V1}/employees?${bad}`);
      expect(r.status, bad).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    const badSort = await api.get(`${V1}/employees?sort=password`);
    expect(badSort.body.error.details.sort).toContain('empCode');
  });

  it('deletes (204) and optionally queues DATA DELETE USERINFO on active devices only', async () => {
    const a = await createDevice('DEL1');
    const off = await api.post(`${V1}/devices`).send({ name: 'Off', serialNumber: 'DEL2', isActive: false });
    const e1 = await mkEmp({ empCode: '11' });
    const e2 = await mkEmp({ empCode: '12' });

    expect((await api.delete(`${V1}/employees/${e1.id}`)).status).toBe(204);
    expect((await api.get(`${V1}/devices/${a.id}/commands`)).body.total).toBe(0);

    const del = await api.delete(`${V1}/employees/${e2.id}?removeFromDevices=true`);
    expect(del.status).toBe(204);
    const cmds = await api.get(`${V1}/devices/${a.id}/commands`);
    expect(cmds.body.items.map((c: { command: string }) => c.command)).toEqual(['DATA DELETE USERINFO PIN=12']);
    expect((await api.get(`${V1}/devices/${off.body.id}/commands`)).body.total).toBe(0);

    expect((await api.delete(`${V1}/employees/${e2.id}`)).status).toBe(404);
    expect((await api.get(`${V1}/employees/${e2.id}`)).status).toBe(404);
    expect((await api.delete(`${V1}/employees/${e2.id}?removeFromDevices=maybe`)).status).toBe(400);
  });

  it('push queues user + stored templates per device and validates the body', async () => {
    const a = await createDevice('P1');
    const b = await createDevice('P2');
    const e = await mkEmp({ empCode: '30', name: 'Pushy', cardNo: '777' });
    await mkEmp({ empCode: '31', name: 'Inactive', status: 'disabled' });
    await adms.post('/iclock/cdata?SN=P1&table=OPERLOG').send('FP PIN=30\tFID=1\tSize=3\tValid=1\tTMP=QUJD\nBIODATA Pin=30\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=58\tMinorVer=0\tFormat=0\tTmp=ZZZ');

    expect((await api.post(`${V1}/employees/push`).send({ employeeIds: [e.id] })).body).toEqual({ queued: 6 }); // 2 devices x (user + fp + bio)
    expect((await api.post(`${V1}/employees/push`).send({ employeeIds: 'all', deviceIds: [a.id] })).body).toEqual({ queued: 3 }); // active only
    expect((await api.post(`${V1}/employees/push`).send({ employeeIds: [e.id], deviceIds: [b.id] })).body).toEqual({ queued: 3 });
    const list = await api.get(`${V1}/devices/${b.id}/commands?sort=id&order=asc`);
    expect(list.body.items.map((c: { command: string }) => c.command.split('\t')[0])).toEqual([
      'DATA UPDATE USERINFO PIN=30', 'DATA UPDATE BIODATA Pin=30', 'DATA UPDATE FINGERTMP PIN=30',
      'DATA UPDATE USERINFO PIN=30', 'DATA UPDATE BIODATA Pin=30', 'DATA UPDATE FINGERTMP PIN=30',
    ]);
    expect(list.body.items[0].command).toContain('Card=777');
    expect(list.body.items[1].command).toContain('\tType=9\tMajorVer=58\tMinorVer=0\tFormat=0\tTmp=ZZZ');

    expect((await api.post(`${V1}/employees/push`).send({})).status).toBe(400);
    expect((await api.post(`${V1}/employees/push`).send({ employeeIds: [] })).status).toBe(400);
    const nodev = await api.post(`${V1}/employees/push`).send({ employeeIds: [e.id], deviceIds: [999] });
    expect(nodev.status).toBe(400);
    expect(nodev.body.error.details).toEqual({ deviceIds: 'one or more devices do not exist' });
  });
});

describe('attendance', () => {
  async function seed() {
    const d1 = await createDevice('A1', 'Gate A');
    const d2 = await createDevice('A2', 'Gate B');
    const dep = await api.post(`${V1}/wings`).send({ name: 'Ops' });
    const ali = await mkEmp({ empCode: '1', name: 'Ali Khan', wingId: dep.body.id });
    const sara = await mkEmp({ empCode: '2', name: 'Sara Malik' });
    await punch(d1.id, '1', '2026-03-10 08:00:00');
    await punch(d1.id, '1', '2026-03-10 23:59:59');
    await punch(d1.id, '2', '2026-03-11 00:00:00');
    await punch(d2.id, '2', '2026-03-11 09:30:00');
    await punch(d2.id, '10', '2026-03-12 12:00:00'); // pin without an employee
    return { d1, d2, dep, ali, sara };
  }
  const pins = (r: { body: { items: { pin: string; punchTime: string }[] } }) => r.body.items.map((x) => `${x.pin}@${x.punchTime}`);

  it('returns Page<AttendanceRecord> with employee and department, newest first', async () => {
    const { d1, dep, ali } = await seed();
    const res = await api.get(`${V1}/attendance`);
    const page = zPage(zAttendanceRecord).parse(res.body);
    expect(page).toMatchObject({ total: 5, page: 1, pageSize: 50 });
    expect(pins(res)).toEqual(['10@2026-03-12 12:00:00', '2@2026-03-11 09:30:00', '2@2026-03-11 00:00:00', '1@2026-03-10 23:59:59', '1@2026-03-10 08:00:00']);
    const first = page.items.find((i) => i.pin === '1')!;
    expect(first).toMatchObject({ deviceId: d1.id, deviceName: 'Gate A', employeeId: ali.id, employeeName: 'Ali Khan', wingName: 'Ops', status: 0, verifyType: 15, workCode: null });
    expect(dep.status).toBe(201);
    expect(page.items[0]).toMatchObject({ employeeId: null, employeeName: null, wingName: null });
  });

  it('"to" is inclusive of the whole day and "from" starts at midnight', async () => {
    await seed();
    expect(pins(await api.get(`${V1}/attendance?from=2026-03-10&to=2026-03-10`))).toEqual(['1@2026-03-10 23:59:59', '1@2026-03-10 08:00:00']);
    expect(pins(await api.get(`${V1}/attendance?to=2026-03-10`))).toEqual(['1@2026-03-10 23:59:59', '1@2026-03-10 08:00:00']);
    expect(pins(await api.get(`${V1}/attendance?from=2026-03-11&to=2026-03-11`))).toEqual(['2@2026-03-11 09:30:00', '2@2026-03-11 00:00:00']);
    expect((await api.get(`${V1}/attendance?from=2026-03-12`)).body.total).toBe(1);
    expect((await api.get(`${V1}/attendance?from=2026-03-13`)).body.total).toBe(0);
    expect((await api.get(`${V1}/attendance?from=2026-03-12&to=2026-03-10`)).body.total).toBe(0);
  });

  it('filters by device, pin, employee, department and q (pin or employee name)', async () => {
    const { d1, d2, dep, ali, sara } = await seed();
    expect((await api.get(`${V1}/attendance?deviceId=${d1.id}`)).body.total).toBe(3);
    expect((await api.get(`${V1}/attendance?deviceId=${d2.id}`)).body.total).toBe(2);
    expect((await api.get(`${V1}/attendance?pin=2`)).body.total).toBe(2);
    expect((await api.get(`${V1}/attendance?pin=1`)).body.total).toBe(2); // exact, not 10
    expect((await api.get(`${V1}/attendance?employeeId=${sara.id}`)).body.total).toBe(2);
    expect((await api.get(`${V1}/attendance?employeeId=${ali.id}&deviceId=${d2.id}`)).body.total).toBe(0);
    expect((await api.get(`${V1}/attendance?wingId=${dep.body.id}`)).body.total).toBe(2);
    expect((await api.get(`${V1}/attendance?q=sara`)).body.total).toBe(2);
    expect((await api.get(`${V1}/attendance?q=10`)).body.total).toBe(1); // pin match, no employee
    expect((await api.get(`${V1}/attendance?q=1`)).body.total).toBe(3); // pins 1 (x2) and 10
    expect((await api.get(`${V1}/attendance?q=%25`)).body.total).toBe(0);
    expect(pins(await api.get(`${V1}/attendance?q=malik&from=2026-03-11&to=2026-03-11&deviceId=${d2.id}`))).toEqual(['2@2026-03-11 09:30:00']);
  });

  it('sorts by allow-listed keys (numeric pin) and paginates', async () => {
    await seed();
    const byPin = await api.get(`${V1}/attendance?sort=pin&order=asc`);
    expect(byPin.body.items.map((x: { pin: string }) => x.pin)).toEqual(['1', '1', '2', '2', '10']);
    const byPinDesc = await api.get(`${V1}/attendance?sort=pin&order=desc`);
    expect(byPinDesc.body.items[0].pin).toBe('10');
    const byName = await api.get(`${V1}/attendance?sort=employeeName&order=asc`);
    expect(byName.body.items.map((x: { employeeName: string | null }) => x.employeeName)).toEqual(['Ali Khan', 'Ali Khan', 'Sara Malik', 'Sara Malik', null]);
    expect(pins(await api.get(`${V1}/attendance?sort=punchTime&order=asc&pageSize=2&page=2`))).toEqual(['2@2026-03-11 00:00:00', '2@2026-03-11 09:30:00']);
    const dev = await api.get(`${V1}/attendance?sort=deviceName&order=asc`);
    expect(dev.body.items[0].deviceName).toBe('Gate A');
  });

  it('rejects invalid filters with field details', async () => {
    const res = await api.get(`${V1}/attendance?from=10-03-2026&to=2026-02-30&deviceId=abc&sort=raw`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['from', 'deviceId']));
    const feb = await api.get(`${V1}/attendance?to=2026-02-30`);
    expect(feb.status).toBe(400);
    expect(feb.body.error.details).toHaveProperty('to');
    expect((await api.get(`${V1}/attendance?sort=raw`)).body.error.details).toHaveProperty('sort');
    expect((await api.get(`${V1}/attendance?employeeId=99999999999`)).status).toBe(400);
  });
});

describe('adms-log', () => {
  it('lists raw device traffic as a Page, newest first, with filters', async () => {
    await adms.get('/iclock/cdata?SN=LOG1&options=all');
    await adms.post('/iclock/cdata?SN=LOG1&table=ATTLOG&Stamp=1').send('1\t2026-01-05 08:00:00\t0\t1\n');
    await adms.get('/iclock/getrequest?SN=LOG2');

    const res = await api.get(`${V1}/adms-log`);
    const page = zPage(zAdmsRequest).parse(res.body);
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 50 });
    expect(page.items.map((r) => r.path)).toEqual(['/iclock/getrequest', '/iclock/cdata', '/iclock/cdata']);
    expect(page.items[1]).toMatchObject({ serialNumber: 'LOG1', method: 'POST', query: 'SN=LOG1&table=ATTLOG&Stamp=1', body: '1\t2026-01-05 08:00:00\t0\t1\n', response: 'OK: 1' });

    expect((await api.get(`${V1}/adms-log?serialNumber=LOG1`)).body.total).toBe(2);
    expect((await api.get(`${V1}/adms-log?path=getreq`)).body.total).toBe(1);
    const asc = await api.get(`${V1}/adms-log?sort=id&order=asc&pageSize=1`);
    expect(asc.body.items[0].path).toBe('/iclock/cdata');
    expect(asc.body).toMatchObject({ total: 3, pageSize: 1 });
    expect((await api.get(`${V1}/adms-log?sort=body`)).status).toBe(400);
  });
});

describe('overview', () => {
  it('counts devices, employees and today\'s punches by the DB session date', async () => {
    const empty = zOverview.parse((await api.get(`${V1}/overview`)).body);
    expect(empty.devices).toEqual({ total: 0, online: 0 });
    expect(empty.employees).toEqual({ total: 0, active: 0 });
    expect(empty.today).toEqual({ date: await dbDate(0), punches: 0, present: 0 });
    expect(empty.dailyPresence).toHaveLength(14);
    expect(empty.dailyPresence.every((d) => d.present === 0)).toBe(true);

    await adms.get('/iclock/cdata?SN=OV1');
    const stale = await createDevice('OV2');
    await pool.query(`UPDATE devices SET last_seen_at = now() - interval '1 day' WHERE id = $1`, [stale.id]);
    const d = (await pool.query<{ id: number }>(`SELECT id FROM devices WHERE serial_number = 'OV1'`)).rows[0]!.id;
    await mkEmp({ empCode: '1', name: 'A' });
    await mkEmp({ empCode: '2', name: 'B' });
    await mkEmp({ empCode: '3', name: 'C', status: 'disabled' });

    const today = await dbDate(0);
    const yesterday = await dbDate(-1);
    const old = await dbDate(-13);
    const tooOld = await dbDate(-14);
    await punch(d, '1', `${today} 00:00:01`);
    await punch(d, '1', `${today} 23:59:59`);
    await punch(d, '2', `${today} 10:00:00`);
    await punch(d, '99', `${today} 10:00:00`); // no employee: a punch, not a person
    await punch(d, '1', `${yesterday} 09:00:00`);
    await punch(d, '3', `${yesterday} 09:00:00`);
    await punch(d, '2', `${old} 09:00:00`);
    await punch(d, '2', `${tooOld} 09:00:00`);

    const res = await api.get(`${V1}/overview`);
    const o = zOverview.parse(res.body);
    expect(o.devices).toEqual({ total: 2, online: 1 });
    expect(o.employees).toEqual({ total: 3, active: 2 });
    expect(o.today).toEqual({ date: today, punches: 4, present: 2 });
    expect(o.dailyPresence).toHaveLength(14);
    expect(o.dailyPresence[0]).toEqual({ date: old, present: 1 });
    expect(o.dailyPresence[12]).toEqual({ date: yesterday, present: 2 });
    expect(o.dailyPresence[13]).toEqual({ date: today, present: 2 });
    const dates = o.dailyPresence.map((x) => x.date);
    expect([...dates].sort()).toEqual(dates); // oldest first
    expect(o.dailyPresence.slice(1, 12).every((x) => x.present === 0)).toBe(true);
  });
});
