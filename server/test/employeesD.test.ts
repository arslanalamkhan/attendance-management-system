import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { zEmployee, zEmployeeDetail } from '@nacta/shared';
import { adms, api, closeDb, createDevice, pool, resetDb, userClient, V1 } from './helpers';
import { flushAudit } from '../src/modules/audit/service';

beforeEach(resetDb);
afterAll(closeDb);

const mkWing = async (name: string) => (await api.post(`${V1}/wings`).send({ name })).body as { id: number };
const mkSection = async (wingId: number, name: string) => (await api.post(`${V1}/wings/${wingId}/sections`).send({ name })).body as { id: number };
async function mkEmp(over: Record<string, unknown> = {}) {
  const res = await api.post(`${V1}/employees`).send({ empCode: '1', name: 'Ali Khan', ...over });
  if (res.status !== 201) throw new Error(`mkEmp: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; empCode: string };
}
/** Makes the device mirror hold these pins (what a real device reports through OPERLOG). */
async function holdOnDevice(sn: string, ...pins: string[]) {
  await adms.post(`/iclock/cdata?SN=${sn}&table=OPERLOG`).send(pins.map((p) => `USER PIN=${p}\tName=Dev ${p}\tPri=0\tPasswd=\tCard=\tGrp=1`).join('\n'));
}
const cmds = async (deviceId?: number) =>
  (await pool.query<{ id: number; device_id: number; command: string; status: string; employee_id: number | null; after_command_id: number | null }>(
    `SELECT id, device_id, command, status, employee_id, after_command_id FROM device_commands ${deviceId ? `WHERE device_id = ${deviceId}` : ''} ORDER BY id`,
  )).rows;
const head = (c: string) => c.split('\t')[0];

describe('employee fields', () => {
  it('stores every new field, normalises and masks the CNIC', async () => {
    const w = await mkWing('Ops');
    const s = await mkSection(w.id, 'Billing');
    const res = await api.post(`${V1}/employees`).send({
      empCode: '0042', name: 'Ali Khan', fatherName: ' Gul Khan ', cnic: '35202-1234567-1', gender: 'male', wingId: w.id, sectionId: s.id,
      designation: 'Clerk', bps: 11, employmentType: 'daily_wages', joinDate: '2024-02-29', cardNo: '99', phone: '0300', email: 'a@b.pk',
      emergencyContactName: 'Bro', emergencyContactPhone: '0321', address: 'House 1', notes: 'n',
    });
    expect(res.status).toBe(201);
    const e = zEmployee.parse(res.body);
    expect(e).toMatchObject({
      empCode: '0042', fatherName: 'Gul Khan', cnic: '35202-1234567-1', gender: 'male', wingName: 'Ops', sectionName: 'Billing', bps: 11,
      employmentType: 'daily_wages', status: 'active', statusReason: null, statusChangedAt: null, leftDate: null, emergencyContactName: 'Bro',
      emergencyContactPhone: '0321', address: 'House 1', hasPhoto: false, deviceSync: 'not_on_device',
    });
    // digits only is normalised too
    const b = await api.post(`${V1}/employees`).send({ empCode: '2', name: 'B', cnic: ' 3520212345672 ' });
    expect(b.body.cnic).toBe('35202-1234567-2');

    // masked unless employees.manage
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await viewer.get(`${V1}/employees/${e.id}`)).body.cnic).toBe('*****-*******-1');
    expect((await viewer.get(`${V1}/employees`)).body.items.map((x: { cnic: string | null }) => x.cnic)).toEqual(['*****-*******-2', '*****-*******-1']);
    expect((await api.get(`${V1}/employees/${e.id}`)).body.cnic).toBe('35202-1234567-1');
    // PUT can clear and change
    expect((await api.put(`${V1}/employees/${e.id}`).send({ cnic: null, fatherName: null, bps: null })).body).toMatchObject({ cnic: null, fatherName: null, bps: null });
  });

  it('validates the new fields', async () => {
    const w = await mkWing('Ops');
    const other = await mkWing('Other');
    const so = await mkSection(other.id, 'Elsewhere');
    const res = await api.post(`${V1}/employees`).send({ empCode: '1', name: 'A', cnic: '123', gender: 'x', bps: 23, employmentType: 'slave', email: 'no', joinDate: '2024-02-30' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details).sort()).toEqual(['bps', 'cnic', 'email', 'employmentType', 'gender', 'joinDate']);
    expect(res.body.error.details.cnic).toBe('CNIC must be 13 digits');
    expect((await api.post(`${V1}/employees`).send({ empCode: '1', name: 'A', bps: 0 })).status).toBe(400);

    // section must belong to the wing
    const wrong = await api.post(`${V1}/employees`).send({ empCode: '1', name: 'A', wingId: w.id, sectionId: so.id });
    expect([wrong.status, wrong.body.error.details]).toEqual([400, { sectionId: 'Section does not belong to the wing' }]);
    const noWing = await api.post(`${V1}/employees`).send({ empCode: '1', name: 'A', sectionId: so.id });
    expect(noWing.body.error.details).toEqual({ sectionId: 'Choose a wing first' });

    // duplicate CNIC
    await mkEmp({ empCode: '5', cnic: '3520211111111' });
    const dup = await api.post(`${V1}/employees`).send({ empCode: '6', name: 'D', cnic: '35202-1111111-1' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'CONFLICT']);
  });

  it('moving to another wing drops the section; a new section must match', async () => {
    const a = await mkWing('A');
    const b = await mkWing('B');
    const sa = await mkSection(a.id, 'SA');
    const sb = await mkSection(b.id, 'SB');
    const e = await mkEmp({ wingId: a.id, sectionId: sa.id });
    const moved = await api.put(`${V1}/employees/${e.id}`).send({ wingId: b.id });
    expect(moved.body).toMatchObject({ wingId: b.id, sectionId: null, sectionName: null });
    expect((await api.put(`${V1}/employees/${e.id}`).send({ sectionId: sa.id })).status).toBe(400);
    expect((await api.put(`${V1}/employees/${e.id}`).send({ wingId: a.id, sectionId: sa.id })).body).toMatchObject({ wingId: a.id, sectionId: sa.id });
    expect((await api.put(`${V1}/employees/${e.id}`).send({ wingId: b.id, sectionId: sb.id })).body.sectionName).toBe('SB');
  });

  it('search, filters and sorts (cnic digits only for managers; hasPhoto from user_photos; biometrics)', async () => {
    const a = await mkWing('Alpha');
    const b = await mkWing('Beta');
    const sa = await mkSection(a.id, 'S1');
    await mkEmp({ empCode: '1', name: 'Ali', designation: 'Accountant', cardNo: '777', cnic: '3520211111111', wingId: a.id, sectionId: sa.id, bps: 14, employmentType: 'regular', joinDate: '2020-01-01' });
    await mkEmp({ empCode: '2', name: 'Bina', designation: 'Clerk', wingId: b.id, bps: 5, employmentType: 'contract', joinDate: '2019-01-01' });
    await mkEmp({ empCode: '3', name: 'Chand', employmentType: 'regular' });
    await pool.query(`INSERT INTO user_photos (pin, file_name, content) VALUES ('1', '1.jpg', 'QUJD')`);
    await pool.query(`INSERT INTO biometric_templates (pin, kind, bio_type, idx, data, raw) VALUES ('2', 'bio', 1, 5, 'x', 'BIODATA Pin=2'), ('3', 'bio', 9, 0, 'y', 'BIODATA Pin=3')`);
    const codes = (r: { body: { items: { empCode: string }[] } }) => r.body.items.map((e) => e.empCode);
    const g = (qs: string) => api.get(`${V1}/employees?${qs}`);

    expect(codes(await g('q=account'))).toEqual(['1']); // designation
    expect(codes(await g('q=777'))).toEqual(['1']); // card
    expect(codes(await g('q=35202-1111'))).toEqual(['1']); // CNIC digits (manager)
    expect(codes(await g('q=3520211111'))).toEqual(['1']);
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect(codes(await viewer.get(`${V1}/employees?q=3520211111`))).toEqual([]); // never searchable for others
    expect(codes(await g(`wingId=${a.id}`))).toEqual(['1']);
    expect(codes(await g(`sectionId=${sa.id}`))).toEqual(['1']);
    expect(codes(await g('employmentType=regular'))).toEqual(['1', '3']);
    expect(codes(await g('status=active'))).toEqual(['1', '2', '3']);
    expect(codes(await g('biometrics=has_photo'))).toEqual(['1']);
    expect(codes(await g('biometrics=has_fingerprint'))).toEqual(['2']);
    expect(codes(await g('biometrics=has_face'))).toEqual(['3']);
    expect(codes(await g('biometrics=none'))).toEqual([]);
    expect((await api.get(`${V1}/employees/${(await g('q=Ali')).body.items[0].id}`)).body.hasPhoto).toBe(true);
    expect(codes(await g('deviceSync=not_on_device'))).toEqual(['1', '2', '3']);
    expect(codes(await g('deviceSync=synced'))).toEqual([]);
    expect((await g('deviceSync=nope')).status).toBe(400);

    expect(codes(await g('sort=bps&order=asc'))).toEqual(['2', '1', '3']); // nulls last
    expect(codes(await g('sort=bps&order=desc'))).toEqual(['1', '2', '3']);
    expect(codes(await g('sort=joinDate&order=asc'))).toEqual(['2', '1', '3']);
    expect(codes(await g('sort=wing&order=asc'))).toEqual(['1', '2', '3']);
    expect(codes(await g('sort=createdAt&order=desc'))).toEqual(['3', '2', '1']);
  });
});

describe('device profile sync on edit', () => {
  it('re-sends USERINFO to every holding device when name, card, password or role change', async () => {
    const a = await createDevice('SYNC1', 'A');
    const b = await createDevice('SYNC2', 'B');
    await createDevice('SYNC3', 'C');
    const e = await mkEmp({ empCode: '7', name: 'Old Name' });
    await holdOnDevice('SYNC1', '7');
    await holdOnDevice('SYNC2', '7');

    const r = await api.put(`${V1}/employees/${e.id}`).send({ name: 'New Name', cardNo: '555' });
    expect(r.status).toBe(200);
    const all = await cmds();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.device_id).sort()).toEqual([a.id, b.id]);
    expect(all[0]!.command).toBe('DATA UPDATE USERINFO PIN=7\tName=New Name\tPri=0\tPasswd=\tCard=555\tGrp=1\tTZ=0000000100000000\tVerify=0\tViceCard=');
    expect(all.every((c) => c.employee_id === e.id)).toBe(true);

    // unrelated fields, or no change, queue nothing
    await api.put(`${V1}/employees/${e.id}`).send({ phone: '123', designation: 'x' });
    await api.put(`${V1}/employees/${e.id}`).send({ name: 'New Name' });
    expect(await cmds()).toHaveLength(2);
    await api.put(`${V1}/employees/${e.id}`).send({ devicePassword: '1234' });
    await api.put(`${V1}/employees/${e.id}`).send({ privilege: 14 });
    expect(await cmds()).toHaveLength(6);
    expect((await cmds())[5]!.command).toContain('Pri=14');

    // audited as a device sync
    await flushAudit();
    const rows = await pool.query(`SELECT summary FROM audit_logs WHERE action = 'employee.device_sync' AND summary LIKE '%New Name%' ORDER BY id DESC LIMIT 1`);
    expect(rows.rows[0].summary).toContain('A, B');
  });

  it('never pushes disabled or left employees, and an employee on no device queues nothing', async () => {
    await createDevice('SYNC4');
    const x = await mkEmp({ empCode: '8', name: 'X' });
    await api.put(`${V1}/employees/${x.id}`).send({ name: 'Y' });
    expect(await cmds()).toHaveLength(0);

    await holdOnDevice('SYNC4', '8');
    await api.post(`${V1}/employees/${x.id}/status`).send({ status: 'disabled', force: true });
    const before = (await cmds()).length;
    await api.put(`${V1}/employees/${x.id}`).send({ name: 'Z' });
    expect(await cmds()).toHaveLength(before);
  });

  it('POST /employees/push skips non-active employees', async () => {
    const a = await createDevice('SYNC5');
    const e1 = await mkEmp({ empCode: '1' });
    const e2 = await mkEmp({ empCode: '2' });
    await api.post(`${V1}/employees/${e2.id}/status`).send({ status: 'disabled' });
    expect((await api.post(`${V1}/employees/push`).send({ employeeIds: [e1.id, e2.id] })).body).toEqual({ queued: 1 });
    expect((await api.post(`${V1}/employees/push`).send({ employeeIds: 'all' })).body).toEqual({ queued: 1 });
    expect((await cmds(a.id)).every((c) => c.command.includes('PIN=1\t'))).toBe(true);
  });
});

describe('status changes drive device access', () => {
  async function setup() {
    const a = await createDevice('ST-A', 'Gate A');
    const b = await createDevice('ST-B', 'Gate B');
    const e = await mkEmp({ empCode: '10', name: 'Ten' });
    await holdOnDevice('ST-A', '10');
    await holdOnDevice('ST-B', '10');
    await adms.post('/iclock/cdata?SN=ST-A&table=OPERLOG').send(
      'FP PIN=10\tFID=1\tSize=3\tValid=1\tTMP=QUJD\nBIODATA Pin=10\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=ZZZ\nUSERPIC PIN=10\tFileName=10.jpg\tSize=4\tContent=QUJDRA==',
    );
    return { a, b, e };
  }

  it('disable: fetch biometrics, then delete, on each holding device; holds recorded', async () => {
    const { a, b, e } = await setup();
    const res = await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled', reason: 'Suspended' });
    expect(res.status).toBe(200);
    expect(zEmployeeDetail.parse(res.body)).toMatchObject({ status: 'disabled', statusReason: 'Suspended', deviceSync: 'pending', leftDate: null });
    expect(res.body.statusChangedAt).toEqual(expect.any(String));

    for (const dev of [a, b]) {
      const list = await cmds(dev.id);
      expect(list.map((c) => c.command)).toEqual(['DATA QUERY BIODATA PIN=10', 'DATA DELETE USERINFO PIN=10']);
      expect(list[1]!.after_command_id).toBe(list[0]!.id); // delete waits for the refresh
      expect(list.every((c) => c.employee_id === e.id && c.status === 'pending')).toBe(true);
    }
    const holds = await pool.query('SELECT device_id, reason FROM employee_device_holds WHERE employee_id = $1 ORDER BY device_id', [e.id]);
    expect(holds.rows).toEqual([{ device_id: a.id, reason: 'Suspended' }, { device_id: b.id, reason: 'Suspended' }]);

    // wait-free: the HTTP call returned without the device; the delete is held back until the refresh finished
    const poll1 = await adms.get('/iclock/getrequest?SN=ST-A');
    expect(poll1.text.split('\n').map((l) => l.replace(/^C:\d+:/, ''))).toEqual(['DATA QUERY BIODATA PIN=10']);
    const [q1] = (await cmds(a.id)).slice(0, 1);
    await adms.post('/iclock/devicecmd?SN=ST-A').send(`ID=${q1!.id}&Return=0&CMD=DATA\n`);
    expect((await adms.get('/iclock/getrequest?SN=ST-A')).text).toBe('OK'); // still inside the upload grace period
    await pool.query(`UPDATE device_commands SET completed_at = now() - interval '1 minute' WHERE id = $1`, [q1!.id]);

    // the device is still streaming its biometric set (it ignores the PIN filter): the delete keeps waiting
    await adms.post('/iclock/cdata?SN=ST-A&table=BIODATA').send('BIODATA Pin=10\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=Z');
    expect((await adms.get('/iclock/getrequest?SN=ST-A')).text).toBe('OK');
    await pool.query(`UPDATE adms_requests SET created_at = now() - interval '1 minute' WHERE serial_number = 'ST-A'`).catch(() => undefined);
    const quiet = await pool.query(`SELECT count(*)::int n FROM adms_requests WHERE serial_number = 'ST-A' AND created_at > now() - interval '30 seconds' AND query ILIKE '%table=BIODATA%'`);
    if (quiet.rows[0].n === 0) {
      const poll3 = await adms.get('/iclock/getrequest?SN=ST-A');
      expect(poll3.text).toMatch(/^C:\d+:DATA DELETE USERINFO PIN=10$/);
    } else {
      // audit_logs-style append-only protection on adms_requests would stop us ageing rows; fall back to the timeout
      await pool.query(`UPDATE device_commands SET created_at = now() - interval '1 hour', sent_at = now() - interval '1 hour' WHERE id = $1`, [q1!.id]);
      expect((await adms.get('/iclock/getrequest?SN=ST-A')).text).toMatch(/^C:\d+:DATA DELETE USERINFO PIN=10$/);
    }

    // the device confirms the delete: it leaves the mirror and everything is in sync
    const del = (await cmds(a.id))[1]!;
    await adms.post('/iclock/devicecmd?SN=ST-A').send(`ID=${del.id}&Return=0&CMD=DATA\n`);
    const d = (await api.get(`${V1}/employees/${e.id}`)).body;
    expect(d.devices.find((x: { deviceId: number }) => x.deviceId === a.id)).toMatchObject({ onDevice: false, lastCommand: { command: 'DATA DELETE USERINFO', status: 'success' } });
    expect(d.deviceCount).toBe(1); // device B has not confirmed yet
    expect(d.deviceSync).toBe('pending');
  });

  it('bulk removal shares one biometric query per device; a sent query is not reused', async () => {
    const dev = await createDevice('BULK-A', 'Gate');
    const emps = [];
    for (const code of ['41', '42', '43']) emps.push(await mkEmp({ empCode: code, name: `E${code}` }));
    await holdOnDevice('BULK-A', '41', '42', '43', '44');
    for (const e of emps) {
      const r = await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'left', force: true });
      expect(r.status).toBe(200);
    }
    const list = await cmds(dev.id);
    expect(list.map((c) => head(c.command))).toEqual([
      'DATA QUERY BIODATA PIN=41',
      'DATA DELETE USERINFO PIN=41',
      'DATA DELETE USERINFO PIN=42',
      'DATA DELETE USERINFO PIN=43',
    ]);
    expect(list.slice(1).every((c) => c.after_command_id === list[0]!.id)).toBe(true);

    // the query goes out; a removal after that gets its own query (the device may already be past its upload)
    const poll = await adms.get('/iclock/getrequest?SN=BULK-A');
    expect(poll.text.split('\n').map((l) => l.replace(/^C:\d+:/, ''))).toEqual(['DATA QUERY BIODATA PIN=41']);
    const e44 = await mkEmp({ empCode: '44', name: 'E44' });
    expect((await api.post(`${V1}/employees/${e44.id}/status`).send({ status: 'left', force: true })).status).toBe(200);
    const after = (await cmds(dev.id)).slice(4);
    expect(after.map((c) => head(c.command))).toEqual(['DATA QUERY BIODATA PIN=44', 'DATA DELETE USERINFO PIN=44']);
    expect(after[1]!.after_command_id).toBe(after[0]!.id);
  });

  it('a delete never goes out with its unsent query, however old the query is (device offline for hours)', async () => {
    const dev = await createDevice('OFF-A', 'Gate');
    const e = await mkEmp({ empCode: '51', name: 'E51' });
    await holdOnDevice('OFF-A', '51');
    expect((await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'left', force: true })).status).toBe(200);
    await pool.query(`UPDATE device_commands SET created_at = now() - interval '5 hours' WHERE device_id = $1`, [dev.id]);
    const poll = await adms.get('/iclock/getrequest?SN=OFF-A');
    expect(poll.text.split('\n').map((l) => l.replace(/^C:\d+:/, ''))).toEqual(['DATA QUERY BIODATA PIN=51']);
    // sent but never answered: released once the timeout runs from the moment it was sent
    expect((await adms.get('/iclock/getrequest?SN=OFF-A')).text).toBe('OK');
    await pool.query(`UPDATE device_commands SET sent_at = now() - interval '1 hour' WHERE device_id = $1 AND status = 'sent'`, [dev.id]);
    expect((await adms.get('/iclock/getrequest?SN=OFF-A')).text).toMatch(/^C:\d+:DATA DELETE USERINFO PIN=51$/);
  });

  it('409 NO_BIOMETRIC_BACKUP when a device reports more fingerprints than are stored; force overrides; face totals are ignored', async () => {
    const dev = await createDevice('NB-A', 'Gate');
    await mkEmp({ empCode: '20', name: 'Twenty' });
    const e2 = await mkEmp({ empCode: '21', name: 'TwentyOne' });
    await holdOnDevice('NB-A', '20', '21');
    await pool.query('UPDATE devices SET fp_count = 5, options = $2::jsonb WHERE id = $1', [dev.id, JSON.stringify({ FaceCount: '3' })]);
    await adms.post('/iclock/cdata?SN=NB-A&table=OPERLOG').send('FP PIN=21\tFID=0\tSize=3\tValid=1\tTMP=QUJD\nBIODATA Pin=21\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=Z');

    const emp20 = (await api.get(`${V1}/employees?q=20`)).body.items[0];
    const res = await api.post(`${V1}/employees/${emp20.id}/status`).send({ status: 'disabled' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_BIOMETRIC_BACKUP');
    // only the fingerprint shortfall counts: the device FaceCount overcounts on the SenseFace 7A
    expect(res.body.error.details.reasons).toHaveLength(1);
    expect(res.body.error.details.reasons[0]).toMatch(/fingerprints/);
    expect((await api.get(`${V1}/employees/${emp20.id}`)).body.status).toBe('active');
    expect(await cmds()).toHaveLength(0);

    // someone with stored biometrics is not blocked, even though the totals do not add up
    expect((await api.post(`${V1}/employees/${e2.id}/status`).send({ status: 'disabled' })).status).toBe(200);
    // force goes ahead: the delete waits for the biometric query already queued for 21 (one upload covers both)
    const forced = await api.post(`${V1}/employees/${emp20.id}/status`).send({ status: 'disabled', force: true });
    expect(forced.status).toBe(200);
    const all = await cmds(dev.id);
    expect(all.map((c) => head(c.command))).toEqual(['DATA QUERY BIODATA PIN=21', 'DATA DELETE USERINFO PIN=21', 'DATA DELETE USERINFO PIN=20']);
    expect(all[2]!.after_command_id).toBe(all[0]!.id);
  });

  it('no check or commands when the employee is on no device or the device reports no totals', async () => {
    await createDevice('NB-B');
    const e = await mkEmp({ empCode: '30' });
    expect((await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled' })).status).toBe(200);
    expect(await cmds()).toHaveLength(0);
    const e2 = await mkEmp({ empCode: '31' });
    await holdOnDevice('NB-B', '31');
    expect((await api.post(`${V1}/employees/${e2.id}/status`).send({ status: 'left' })).status).toBe(200);
    expect(await cmds()).toHaveLength(2);
  });

  it('enable: USERINFO, templates, then the photo, to the devices they were removed from; holds cleared', async () => {
    const { a, b, e } = await setup();
    await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled' });
    const before = (await cmds()).length;
    const res = await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'active', reason: 'Back' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', statusReason: 'Back' });
    const fresh = (await cmds()).slice(before);
    for (const dev of [a, b]) {
      const mine = fresh.filter((c) => c.device_id === dev.id);
      expect(mine.map((c) => head(c.command))).toEqual([
        'DATA UPDATE USERINFO PIN=10',
        'DATA UPDATE BIODATA Pin=10', // face, Type=9
        'DATA UPDATE FINGERTMP PIN=10',
        'DATA UPDATE USERPIC PIN=10',
      ]);
      expect(mine[1]!.command).toContain('\tType=9\t');
      expect(mine[3]!.command).toBe('DATA UPDATE USERPIC PIN=10\tFileName=10.jpg\tSize=8\tContent=QUJDRA==');
      expect(mine.every((c) => c.after_command_id === null)).toBe(true);
    }
    expect((await pool.query('SELECT 1 FROM employee_device_holds WHERE employee_id = $1', [e.id])).rowCount).toBe(0);
  });

  it('enabling an employee with no recorded holds restores to all active devices', async () => {
    const a = await createDevice('EN-A');
    await api.post(`${V1}/devices`).send({ name: 'Off', serialNumber: 'EN-B', isActive: false });
    const e = await mkEmp({ empCode: '40' });
    await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled' });
    await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'active' });
    expect((await cmds()).map((c) => [c.device_id, head(c.command)])).toEqual([[a.id, 'DATA UPDATE USERINFO PIN=40']]);
  });

  it('left records the date; same status is a no-op; permissions and audit', async () => {
    await flushAudit();
    const base = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM audit_logs')).rows[0].m);
    const e = await mkEmp({ empCode: '50', name: 'Leaver' });
    const left = await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'left', effectiveDate: '2026-10-31', reason: 'Retired' });
    expect(left.body).toMatchObject({ status: 'left', leftDate: '2026-10-31', statusReason: 'Retired' });
    expect((await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'left', effectiveDate: '2026-13-31' })).status).toBe(400);
    expect((await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'bogus' })).status).toBe(400);
    expect((await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled' })).body.leftDate).toBeNull();
    const again = await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled', reason: 'ignored' });
    expect(again.body.statusReason).toBeNull();
    expect((await api.post(`${V1}/employees/${e.id}/status`).send({ status: 'active' })).body.leftDate).toBeNull();
    expect((await api.post(`${V1}/employees/999/status`).send({ status: 'active' })).status).toBe(404);

    const manageOnly = await userClient({ permissions: ['employees.view', 'employees.manage'] });
    expect((await manageOnly.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled' })).status).toBe(403);
    const pushOnly = await userClient({ permissions: ['employees.view', 'employees.push'] });
    expect((await pushOnly.post(`${V1}/employees/${e.id}/status`).send({ status: 'disabled' })).status).toBe(403);

    await flushAudit();
    const rows = await pool.query(`SELECT summary, changes, metadata FROM audit_logs WHERE action = 'employee.status' AND entity_id = $1 AND id > $2 ORDER BY id`, [String(e.id), base]);
    expect(rows.rows.map((r) => r.summary)).toHaveLength(3);
    expect(rows.rows[0].summary).toContain('Active -> Left (Retired)');
    expect(rows.rows[0].metadata).toMatchObject({ reason: 'Retired', commandsQueued: 0, devices: [] });
  });

  it('deviceSync: pending after a push, failed after a rejected command, synced when done', async () => {
    const dev = await createDevice('DS-A');
    const e = await mkEmp({ empCode: '60' });
    await holdOnDevice('DS-A', '60');
    expect((await api.get(`${V1}/employees/${e.id}`)).body.deviceSync).toBe('synced');
    await api.post(`${V1}/employees/push`).send({ employeeIds: [e.id] });
    expect((await api.get(`${V1}/employees/${e.id}`)).body.deviceSync).toBe('pending');
    const [c] = await cmds(dev.id);
    await adms.get('/iclock/getrequest?SN=DS-A');
    await adms.post('/iclock/devicecmd?SN=DS-A').send(`ID=${c!.id}&Return=-1&CMD=DATA\n`);
    expect((await api.get(`${V1}/employees?deviceSync=failed`)).body.items.map((x: { empCode: string }) => x.empCode)).toEqual(['60']);
    await api.post(`${V1}/employees/push`).send({ employeeIds: [e.id] });
    await adms.get('/iclock/getrequest?SN=DS-A');
    const second = (await cmds(dev.id))[1]!;
    await adms.post('/iclock/devicecmd?SN=DS-A').send(`ID=${second.id}&Return=0&CMD=DATA\n`);
    expect((await api.get(`${V1}/employees/${e.id}`)).body.deviceSync).toBe('synced');
  });
});
