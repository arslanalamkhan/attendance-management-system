import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { zEmployeeBiometrics } from '@nacta/shared';
import { adms, api, closeDb, createDevice, pool, resetDb, userClient, V1 } from './helpers';
import { flushAudit } from '../src/modules/audit/service';
import { readJpegInfo } from '../src/lib/jpeg';

beforeEach(resetDb);
afterAll(closeDb);

/** A syntactically valid JPEG skeleton (SOI, JFIF, SOF, SOS, EOI): enough for the magic/SOF checks. */
function jpeg(w = 600, h = 600, opts: { progressive?: boolean; pad?: number } = {}): Buffer {
  const u16 = (n: number) => [(n >> 8) & 255, n & 255];
  const bytes = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, opts.progressive ? 0xc2 : 0xc0, 0x00, 0x11, 0x08, ...u16(h), ...u16(w), 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
  ];
  return Buffer.concat([Buffer.from(bytes), Buffer.alloc(opts.pad ?? 2000, 0x55), Buffer.from([0xff, 0xd9])]);
}

async function mkEmp(over: Record<string, unknown> = {}) {
  const res = await api.post(`${V1}/employees`).send({ empCode: '7', name: 'Ali Khan', ...over });
  if (res.status !== 201) throw new Error(`mkEmp: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; empCode: string };
}
const holdOnDevice = async (sn: string, ...pins: string[]) =>
  adms.post(`/iclock/cdata?SN=${sn}&table=OPERLOG`).send(pins.map((p) => `USER PIN=${p}\tName=Dev ${p}\tPri=0\tPasswd=\tCard=\tGrp=1`).join('\n'));
const cmds = async () =>
  (await pool.query<{ id: number; device_id: number; command: string; employee_id: number | null; status: string }>(`SELECT id, device_id, command, employee_id, status FROM device_commands ORDER BY id`)).rows;
const tmpl = (n = 100) => Buffer.alloc(n, 7).toString('base64');
const bio = (pin: string, no: number, type: number, major: number, minor: number, data = tmpl()) =>
  `BIODATA Pin=${pin}\tNo=${no}\tIndex=0\tValid=1\tDuress=0\tType=${type}\tMajorVer=${major}\tMinorVer=${minor}\tFormat=0\tTmp=${data}`;
const postBio = (sn: string, ...lines: string[]) => adms.post(`/iclock/cdata?SN=${sn}&table=BIODATA`).send(lines.join('\n'));
const auditRows = async (action: string) => {
  await flushAudit();
  return (await pool.query<{ summary: string; metadata: Record<string, unknown> | null; entity_id: string | null }>(
    `SELECT summary, metadata, entity_id FROM audit_logs WHERE action = $1 ORDER BY id DESC`,
    [action],
  )).rows;
};
const put = (c: { put: typeof api.put }, id: number, buf: Buffer, q = '') => c.put(`${V1}/employees/${id}/photo${q}`).attach('photo', buf, 'p.jpg');
const BIOMETRICS = ['employees.view', 'employees.biometrics'] as const;

describe('jpeg reader', () => {
  it('reads dimensions and the progressive flag from the SOF marker', () => {
    expect(readJpegInfo(jpeg(600, 800))).toMatchObject({ width: 600, height: 800, progressive: false });
    expect(readJpegInfo(jpeg(300, 300, { progressive: true }))?.progressive).toBe(true);
    expect(readJpegInfo(Buffer.from('not a jpeg'))).toBeNull();
    expect(readJpegInfo(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe('GET /employees/:id/photo', () => {
  it('404 without a photo, serves JPEG with ETag/304 and cache headers', async () => {
    const e = await mkEmp();
    expect((await api.get(`${V1}/employees/${e.id}/photo`)).status).toBe(404);
    expect((await api.get(`${V1}/employees/999/photo`)).status).toBe(404);
    const jpg = jpeg();
    await pool.query(`INSERT INTO user_photos (pin, file_name, content, version) VALUES ('7', '7.jpg', $1, 3)`, [jpg.toString('base64')]);
    const res = await api.get(`${V1}/employees/${e.id}/photo`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(Buffer.compare(res.body as Buffer, jpg)).toBe(0);
    const etag = res.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{20}"$/);
    const again = await api.get(`${V1}/employees/${e.id}/photo`).set('If-None-Match', etag);
    expect(again.status).toBe(304);
    expect(again.headers.etag).toBe(etag);
    // a new version changes the ETag
    await pool.query(`UPDATE user_photos SET version = 4 WHERE pin = '7'`);
    const changed = await api.get(`${V1}/employees/${e.id}/photo`).set('If-None-Match', etag);
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it('sniffs the content type of a stored non-JPEG', async () => {
    const e = await mkEmp();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
    await pool.query(`INSERT INTO user_photos (pin, file_name, content) VALUES ('7', '7.png', $1)`, [png.toString('base64')]);
    expect((await api.get(`${V1}/employees/${e.id}/photo`)).headers['content-type']).toBe('image/png');
  });

  it('needs employees.view and respects wing scope (404, not 403)', async () => {
    const w1 = (await api.post(`${V1}/wings`).send({ name: 'W1' })).body.id as number;
    const w2 = (await api.post(`${V1}/wings`).send({ name: 'W2' })).body.id as number;
    const e1 = await mkEmp({ empCode: '1', wingId: w1 });
    const e2 = await mkEmp({ empCode: '2', wingId: w2 });
    for (const pin of ['1', '2']) await pool.query(`INSERT INTO user_photos (pin, file_name, content) VALUES ($1, 'x.jpg', $2)`, [pin, jpeg().toString('base64')]);
    const scoped = await userClient({ permissions: ['employees.view'], wings: [w1] });
    expect((await scoped.get(`${V1}/employees/${e1.id}/photo`)).status).toBe(200);
    expect((await scoped.get(`${V1}/employees/${e2.id}/photo`)).status).toBe(404);
    const none = await userClient({ permissions: ['attendance.view'] });
    expect((await none.get(`${V1}/employees/${e1.id}/photo`)).status).toBe(403);
  });
});

describe('PUT /employees/:id/photo', () => {
  it('validates permission, size, magic bytes, progressive and dimensions', async () => {
    const e = await mkEmp();
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await put(viewer, e.id, jpeg())).status).toBe(403);

    const tooBig = await put(api, e.id, jpeg(600, 600, { pad: 257 * 1024 }));
    expect([tooBig.status, tooBig.body.error.code]).toEqual([400, 'INVALID_FILE']);
    expect(tooBig.body.error.message).toMatch(/256 KB/);
    expect((await put(api, e.id, jpeg(600, 600, { pad: 200 * 1024 }))).status).toBe(200);

    const png = await put(api, e.id, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(500)]));
    expect([png.status, png.body.error.code]).toEqual([400, 'INVALID_FILE']);
    const prog = await put(api, e.id, jpeg(600, 600, { progressive: true }));
    expect(prog.status).toBe(400);
    expect(prog.body.error.message).toBe('Progressive JPEG not supported by the terminals; re-save as baseline');
    expect((await put(api, e.id, jpeg(239, 600))).status).toBe(400);
    expect((await put(api, e.id, jpeg(600, 239))).status).toBe(400);
    expect((await put(api, e.id, jpeg(1281, 600))).status).toBe(400);
    expect((await put(api, e.id, jpeg(1280, 1280))).status).toBe(200);
    expect((await put(api, e.id, jpeg(240, 240))).status).toBe(200);
    expect((await api.put(`${V1}/employees/${e.id}/photo`).attach('wrong', jpeg(), 'p.jpg')).status).toBe(400);
    expect((await api.put(`${V1}/employees/${e.id}/photo`).send({})).status).toBe(400);
    expect((await api.put(`${V1}/employees/${e.id}/photo?createFace=maybe`).attach('photo', jpeg(), 'p.jpg')).status).toBe(400);
  });

  it('stores an app photo, bumps the version and returns EmployeeBiometrics', async () => {
    const e = await mkEmp();
    const a = await put(api, e.id, jpeg());
    expect(a.status).toBe(200);
    const bio1 = zEmployeeBiometrics.parse(a.body);
    expect(bio1.photo).toMatchObject({ url: `/api/v1/employees/${e.id}/photo?v=1`, source: 'app', sourceDeviceName: null });
    const b = zEmployeeBiometrics.parse((await put(api, e.id, jpeg(640, 800))).body);
    expect(b.photo?.url).toBe(`/api/v1/employees/${e.id}/photo?v=2`);
    expect(b.photo?.sizeBytes).toBe(jpeg(640, 800).length);
    const row = (await pool.query(`SELECT file_name, source, version, size_bytes FROM user_photos WHERE pin = '7'`)).rows[0];
    expect(row).toMatchObject({ file_name: '7.jpg', source: 'app', version: 2 });
    expect((await api.get(`${V1}/employees`)).body.items[0].hasPhoto).toBe(true);
  });

  it('queues USERPIC and BIOPHOTO only with the options, only for active employees on devices', async () => {
    const d1 = await createDevice('SN1', 'D1');
    const d2 = await createDevice('SN2', 'D2');
    const e = await mkEmp();
    const off = await mkEmp({ empCode: '8', name: 'Off device' });
    await holdOnDevice('SN1', '7', '8');
    await holdOnDevice('SN2', '7');
    const jpg = jpeg();
    const b64 = jpg.toString('base64');

    // not on any device -> nothing, whatever the options
    const lone = await mkEmp({ empCode: '9', name: 'Lone' });
    await put(api, lone.id, jpg, '?syncToDevices=true&createFace=true');
    expect(await cmds()).toHaveLength(0);

    // default: sync (USERPIC) + createFace defaults to true for an employee on devices
    await put(api, e.id, jpg);
    let c = await cmds();
    expect(c).toHaveLength(4);
    const forD1 = c.filter((x) => x.device_id === d1.id).map((x) => x.command);
    expect(forD1[0]).toBe(`DATA UPDATE USERPIC PIN=7\tFileName=7.jpg\tSize=${b64.length}\tContent=${b64}`);
    expect(forD1[1]).toBe(`DATA UPDATE BIOPHOTO PIN=7\tType=9\tSize=${b64.length}\tContent=${b64}\tFormat=0\tUrl=\tPostBackTmpFlag=1`);
    expect(c.filter((x) => x.device_id === d2.id)).toHaveLength(2);
    expect(c.every((x) => x.employee_id === e.id)).toBe(true);

    // explicit createFace=false -> USERPIC only; syncToDevices=false+createFace=false -> nothing
    await pool.query('DELETE FROM device_commands');
    await put(api, e.id, jpg, '?createFace=false');
    expect((await cmds()).map((x) => x.command.split(' PIN')[0])).toEqual(['DATA UPDATE USERPIC', 'DATA UPDATE USERPIC']);
    await pool.query('DELETE FROM device_commands');
    await put(api, e.id, jpg, '?syncToDevices=false&createFace=false');
    expect(await cmds()).toHaveLength(0);
    // multipart fields work too
    await api.put(`${V1}/employees/${e.id}/photo`).field('syncToDevices', 'false').field('createFace', 'true').attach('photo', jpg, 'p.jpg');
    expect((await cmds()).map((x) => x.command.split(' PIN')[0])).toEqual(['DATA UPDATE BIOPHOTO', 'DATA UPDATE BIOPHOTO']);

    // a disabled employee who is still in the device mirror gets nothing; an active one on D1 only gets D1 commands
    await pool.query('DELETE FROM device_commands');
    await pool.query(`UPDATE employees SET status = 'disabled' WHERE id = $1`, [e.id]);
    await put(api, e.id, jpg);
    expect(await cmds()).toHaveLength(0);
    await put(api, off.id, jpg);
    const after = await cmds();
    expect(after.map((x) => x.device_id)).toEqual([d1.id, d1.id]);
    expect(after.every((x) => x.employee_id === off.id)).toBe(true);
  });

  it('audits employee.photo_update without image bytes', async () => {
    await createDevice('SN1');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    const jpg = jpeg(600, 600, { pad: 5000 });
    await put(api, e.id, jpg, '?createFace=true');
    const [row] = await auditRows('employee.photo_update');
    expect(row?.metadata).toMatchObject({ source: 'app', syncToDevices: true, createFace: true, sizeBytes: jpg.length, width: 600, height: 600, commandsQueued: 2 });
    const text = JSON.stringify(row);
    expect(text).not.toContain(jpg.toString('base64').slice(0, 40));
    expect(text.length).toBeLessThan(1500);
    // and the whole audit table: nothing carries the picture
    const all = (await pool.query<{ t: string }>(`SELECT (summary || coalesce(metadata::text, '') || coalesce(changes::text, '')) AS t FROM audit_logs`)).rows;
    expect(all.some((r) => r.t.includes(jpg.toString('base64').slice(100, 160)))).toBe(false);
  });
});

describe('DELETE /employees/:id/photo', () => {
  it('removes only the app copy and audits it', async () => {
    const e = await mkEmp();
    await pool.query(`INSERT INTO user_photos (pin, file_name, content) VALUES ('7', '7.jpg', $1)`, [jpeg().toString('base64')]);
    expect((await api.delete(`${V1}/employees/${e.id}/photo`)).status).toBe(404); // device copy stays
    await put(api, e.id, jpeg());
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await viewer.delete(`${V1}/employees/${e.id}/photo`)).status).toBe(403);
    expect((await api.delete(`${V1}/employees/${e.id}/photo`)).status).toBe(204);
    expect((await api.get(`${V1}/employees/${e.id}/photo`)).status).toBe(404);
    expect((await auditRows('employee.photo_delete'))).toHaveLength(1);
  });
});

describe('GET /employees/:id/biometrics', () => {
  it('classifies real-format BIODATA lines with version, finger index, size and source', async () => {
    const dev = await createDevice('SN1', 'Front gate');
    const e = await mkEmp();
    const other = await mkEmp({ empCode: '8', name: 'Other' });
    await postBio('SN1', bio('7', 3, 1, 13, 0, tmpl(300)), bio('7', 6, 1, 13, 0), bio('7', 0, 9, 40, 1, tmpl(900)), bio('7', 0, 8, 5, 0), bio('8', 1, 1, 13, 0));
    await adms.post(`/iclock/cdata?SN=SN1&table=OPERLOG`).send(`FP PIN=7\tFID=9\tSize=10\tValid=1\tTMP=${tmpl(60)}`);
    await pool.query(`INSERT INTO user_photos (pin, file_name, content, source_device_id) VALUES ('7', '7.jpg', $1, $2)`, [jpeg().toString('base64'), dev.id]);
    const res = await api.get(`${V1}/employees/${e.id}/biometrics`);
    expect(res.status).toBe(200);
    const b = zEmployeeBiometrics.parse(res.body);
    expect(b).toMatchObject({ employeeId: e.id, pin: '7' });
    expect(b.fingers.map((f) => f.fingerIndex).sort()).toEqual([3, 6, 9]);
    const f3 = b.fingers.find((f) => f.fingerIndex === 3);
    expect(f3).toMatchObject({ kind: 'finger', bioType: 1, version: '13.0', sizeBytes: 300, source: 'device', sourceDeviceName: 'Front gate', valid: true });
    expect(b.fingers.find((f) => f.fingerIndex === 9)).toMatchObject({ bioType: null, version: null, sizeBytes: 60 });
    expect(b.faces).toHaveLength(1);
    expect(b.faces[0]).toMatchObject({ kind: 'face', fingerIndex: null, bioType: 9, version: '40.1', sizeBytes: 900 });
    expect(b.other).toHaveLength(1);
    expect(b.other[0]).toMatchObject({ kind: 'other', bioType: 8, fingerIndex: null });
    expect(b.photo).toMatchObject({ url: `/api/v1/employees/${e.id}/photo?v=1`, source: 'device', sourceDeviceName: 'Front gate' });
    // other employee's templates are separate
    expect(zEmployeeBiometrics.parse((await api.get(`${V1}/employees/${other.id}/biometrics`)).body).fingers).toHaveLength(1);
    // a viewer may read, outside scope is a 404
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await viewer.get(`${V1}/employees/${e.id}/biometrics`)).status).toBe(200);
    expect((await userClient({ permissions: ['attendance.view'] }).then((c) => c.get(`${V1}/employees/${e.id}/biometrics`))).status).toBe(403);
    expect((await api.get(`${V1}/employees/999/biometrics`)).status).toBe(404);
  });

  it('a face template that a device posts back after BIOPHOTO is stored as source "device" and listed', async () => {
    await createDevice('SN1', 'Gate');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    await put(api, e.id, jpeg(), '?createFace=true');
    // the terminal builds the template and posts it back
    await postBio('SN1', bio('7', 0, 9, 40, 1, tmpl(1200)));
    const b = zEmployeeBiometrics.parse((await api.get(`${V1}/employees/${e.id}/biometrics`)).body);
    expect(b.faces).toHaveLength(1);
    expect(b.faces[0]).toMatchObject({ source: 'device', sourceDeviceName: 'Gate', version: '40.1' });
  });

  it('activity lists the last 20 biometric commands by name only', async () => {
    const dev = await createDevice('SN1', 'Gate');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    await pool.query(
      `INSERT INTO device_commands (device_id, command, employee_id, status) VALUES
        ($1, 'ENROLL_FP PIN=7' || chr(9) || 'FID=3', $2, 'success'),
        ($1, 'DATA UPDATE BIOPHOTO PIN=7' || chr(9) || 'Content=AAAA', $2, 'sent'),
        ($1, 'DATA UPDATE USERINFO PIN=7' || chr(9) || 'Name=x', $2, 'success'),
        ($1, 'DATA DELETE BIODATA Pin=7' || chr(9) || 'Type=1', $2, 'pending'),
        ($1, 'DATA QUERY BIODATA', $2, 'failed'),
        ($1, 'ENROLL_BIO TYPE=9 PIN=7', $2, 'pending')`,
      [dev.id, e.id],
    );
    for (let i = 0; i < 20; i++) await pool.query(`INSERT INTO device_commands (device_id, command, employee_id) VALUES ($1, 'DATA UPDATE USERPIC PIN=7', $2)`, [dev.id, e.id]);
    const a = zEmployeeBiometrics.parse((await api.get(`${V1}/employees/${e.id}/biometrics`)).body).activity;
    expect(a).toHaveLength(20);
    expect(a.every((x) => x.command === 'DATA UPDATE USERPIC')).toBe(true);
    await pool.query(`DELETE FROM device_commands WHERE command LIKE 'DATA UPDATE USERPIC%'`);
    const b = zEmployeeBiometrics.parse((await api.get(`${V1}/employees/${e.id}/biometrics`)).body).activity;
    expect(b.map((x) => x.command)).toEqual(['ENROLL_BIO', 'DATA QUERY BIODATA', 'DATA DELETE BIODATA', 'DATA UPDATE BIOPHOTO', 'ENROLL_FP']);
    expect(b[0]).toMatchObject({ deviceName: 'Gate', status: 'pending', completedAt: null });
  });
});

describe('POST /employees/:id/enroll', () => {
  it('queues the exact ENROLL commands, linked to the employee, and audits', async () => {
    const dev = await createDevice('SN1', 'Gate');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    const f = await api.post(`${V1}/employees/${e.id}/enroll`).send({ deviceId: dev.id, kind: 'finger', fingerIndex: 6 });
    expect(f.status).toBe(202);
    const g = await api.post(`${V1}/employees/${e.id}/enroll`).send({ deviceId: dev.id, kind: 'face', overwrite: false });
    expect(g.status).toBe(202);
    const c = await cmds();
    expect(c.map((x) => x.command)).toEqual(['ENROLL_FP PIN=7\tFID=6\tRETRY=3\tOVERWRITE=1', 'ENROLL_BIO TYPE=9\tPIN=7\tCNT=1\tRETRY=3\tOVERWRITE=0']);
    expect(c.map((x) => x.id)).toEqual([f.body.commandId, g.body.commandId]);
    expect(c.every((x) => x.employee_id === e.id && x.status === 'pending')).toBe(true);
    const rows = await auditRows('biometric.enroll_requested');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.metadata).toMatchObject({ kind: 'finger', fingerIndex: 6, commandId: f.body.commandId });
  });

  it('validates input and answers 409 NOT_ON_DEVICE', async () => {
    const dev = await createDevice('SN1', 'Gate');
    const e = await mkEmp();
    const url = `${V1}/employees/${e.id}/enroll`;
    expect((await api.post(url).send({ deviceId: dev.id, kind: 'finger' })).status).toBe(400); // fingerIndex required
    expect((await api.post(url).send({ deviceId: dev.id, kind: 'finger', fingerIndex: 10 })).status).toBe(400);
    expect((await api.post(url).send({ deviceId: dev.id, kind: 'palm' })).status).toBe(400);
    const notOn = await api.post(url).send({ deviceId: dev.id, kind: 'face' });
    expect([notOn.status, notOn.body.error.code]).toEqual([409, 'NOT_ON_DEVICE']);
    expect((await api.post(url).send({ deviceId: 999, kind: 'face' })).status).toBe(404);
    await holdOnDevice('SN1', '7');
    await pool.query(`UPDATE employees SET status = 'disabled' WHERE id = $1`, [e.id]);
    expect((await api.post(url).send({ deviceId: dev.id, kind: 'face' })).body.error.code).toBe('NOT_ON_DEVICE');
    await pool.query(`UPDATE employees SET status = 'active' WHERE id = $1`, [e.id]);
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await viewer.post(url).send({ deviceId: dev.id, kind: 'face' })).status).toBe(403);
    expect(await cmds()).toHaveLength(0);
    // no BIODATA refresh is queued either
    expect((await api.post(url).send({ deviceId: dev.id, kind: 'face' })).status).toBe(202);
    expect((await cmds()).map((x) => x.command.split(' ')[0])).toEqual(['ENROLL_BIO']);
  });
});

describe('DELETE /employees/:id/biometrics/:templateId', () => {
  async function setup() {
    const d1 = await createDevice('SN1', 'D1');
    const d2 = await createDevice('SN2', 'D2');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    await holdOnDevice('SN2', '7');
    await postBio('SN1', bio('7', 3, 1, 13, 0), bio('7', 0, 9, 40, 1));
    const rows = (await pool.query<{ id: number; bio_type: number }>(`SELECT id, bio_type FROM biometric_templates ORDER BY bio_type`)).rows;
    return { d1, d2, e, finger: rows[0]!.id, face: rows[1]!.id };
  }

  it('deletes the row, queues DATA DELETE BIODATA on devices holding the PIN and audits', async () => {
    const { d1, d2, e, finger, face } = await setup();
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await viewer.delete(`${V1}/employees/${e.id}/biometrics/${finger}`)).status).toBe(403);
    expect((await api.delete(`${V1}/employees/${e.id}/biometrics/9999`)).status).toBe(404);
    expect((await api.delete(`${V1}/employees/${e.id}/biometrics/${finger}`)).status).toBe(204);
    expect((await pool.query(`SELECT 1 FROM biometric_templates WHERE id = $1`, [finger])).rowCount).toBe(0);
    const c = await cmds();
    expect(c.map((x) => [x.device_id, x.command])).toEqual([
      [d1.id, 'DATA DELETE BIODATA Pin=7\tType=1\tNo=3'],
      [d2.id, 'DATA DELETE BIODATA Pin=7\tType=1\tNo=3'],
    ]);
    expect(c.every((x) => x.employee_id === e.id)).toBe(true);
    const [a] = await auditRows('biometric.delete');
    expect(a?.metadata).toMatchObject({ kind: 'finger', fingerIndex: 3, finger: 'Left index', fromDevices: true, commandsQueued: 2 });
    // face, app only
    await pool.query('DELETE FROM device_commands');
    expect((await api.delete(`${V1}/employees/${e.id}/biometrics/${face}?fromDevices=false`)).status).toBe(204);
    expect(await cmds()).toHaveLength(0);
    expect((await pool.query(`SELECT count(*) AS n FROM biometric_tombstones`)).rows[0].n).toBe('1'); // only the finger
  });

  it('a template of another employee is a 404; legacy fp rows use DELETE FINGERTMP', async () => {
    const { e } = await setup();
    const o = await mkEmp({ empCode: '8', name: 'O' });
    const other = (await pool.query<{ id: number }>(`SELECT id FROM biometric_templates LIMIT 1`)).rows[0]!.id;
    expect((await api.delete(`${V1}/employees/${o.id}/biometrics/${other}`)).status).toBe(404);
    await adms.post(`/iclock/cdata?SN=SN1&table=OPERLOG`).send(`FP PIN=7\tFID=2\tSize=10\tValid=1\tTMP=${tmpl(60)}`);
    const fp = (await pool.query<{ id: number }>(`SELECT id FROM biometric_templates WHERE kind = 'fp'`)).rows[0]!.id;
    await api.delete(`${V1}/employees/${e.id}/biometrics/${fp}`);
    expect((await cmds()).map((x) => x.command)).toEqual(['DATA DELETE FINGERTMP PIN=7\tFID=2', 'DATA DELETE FINGERTMP PIN=7\tFID=2']);
  });

  it('re-ingest protection: a deleted template is not stored again until the device confirms the delete', async () => {
    const { d1, e, finger } = await setup();
    await api.delete(`${V1}/employees/${e.id}/biometrics/${finger}`);
    const count = async (type: number) => Number((await pool.query(`SELECT count(*) AS n FROM biometric_templates WHERE bio_type = $1`, [type])).rows[0].n);
    // the device still holds the finger and answers a full refresh / uploads it by itself: skipped
    await postBio('SN1', bio('7', 3, 1, 13, 0), bio('7', 0, 9, 40, 1));
    expect(await count(1)).toBe(0);
    expect(await count(9)).toBe(1); // other templates still ingest
    // a different finger of the same person is fine
    await postBio('SN1', bio('7', 4, 1, 13, 0));
    expect(await count(1)).toBe(1);
    // the first device confirms, but the second still has its delete pending: still protected
    const [c1, c2] = await cmds();
    await adms.post(`/iclock/devicecmd?SN=SN1`).send(`ID=${c1!.id}&Return=0&CMD=DATA\n`);
    await postBio('SN1', bio('7', 3, 1, 13, 0));
    expect((await pool.query(`SELECT 1 FROM biometric_templates WHERE bio_type = 1 AND idx = 3`)).rowCount).toBe(0);
    await adms.post(`/iclock/devicecmd?SN=SN2`).send(`ID=${c2!.id}&Return=0&CMD=DATA\n`);
    expect((await pool.query(`SELECT count(*) AS n FROM biometric_tombstones`)).rows[0].n).toBe('0');
    await postBio('SN1', bio('7', 3, 1, 13, 0));
    expect((await pool.query(`SELECT 1 FROM biometric_templates WHERE bio_type = 1 AND idx = 3`)).rowCount).toBe(1);
    void d1;
  });

  it('re-ingest protection expires after 10 minutes and is lifted by a new enrolment request', async () => {
    const { d1, e, finger } = await setup();
    await api.delete(`${V1}/employees/${e.id}/biometrics/${finger}`);
    await pool.query(`UPDATE biometric_tombstones SET deleted_at = now() - interval '11 minutes'`);
    await postBio('SN1', bio('7', 3, 1, 13, 0));
    expect((await pool.query(`SELECT 1 FROM biometric_templates WHERE bio_type = 1 AND idx = 3`)).rowCount).toBe(1);
    // delete again, then ask for a new enrolment of that finger: the new template is accepted at once
    const id = (await pool.query<{ id: number }>(`SELECT id FROM biometric_templates WHERE bio_type = 1`)).rows[0]!.id;
    await api.delete(`${V1}/employees/${e.id}/biometrics/${id}`);
    await postBio('SN1', bio('7', 3, 1, 13, 0));
    expect((await pool.query(`SELECT 1 FROM biometric_templates WHERE bio_type = 1`)).rowCount).toBe(0);
    await api.post(`${V1}/employees/${e.id}/enroll`).send({ deviceId: d1.id, kind: 'finger', fingerIndex: 3 });
    await postBio('SN1', bio('7', 3, 1, 13, 0));
    expect((await pool.query(`SELECT 1 FROM biometric_templates WHERE bio_type = 1 AND idx = 3`)).rowCount).toBe(1);
  });
});

describe('POST /employees/:id/fingerprints', () => {
  it('accepts a template whose version matches the devices and stores it as an app template', async () => {
    const d = await createDevice('SN1', 'Gate');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    await postBio('SN1', bio('7', 3, 1, 13, 0));
    const t = tmpl(512);
    const res = await api.post(`${V1}/employees/${e.id}/fingerprints`).send({ fingerIndex: 5, template: t, majorVersion: 13, quality: 80 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'finger', fingerIndex: 5, bioType: 1, version: '13.0', sizeBytes: 512, source: 'app', sourceDeviceName: null, valid: true });
    const row = (await pool.query(`SELECT raw, source, source_device_id FROM biometric_templates WHERE idx = 5`)).rows[0];
    expect(row.raw).toBe(`BIODATA Pin=7\tNo=5\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=13\tMinorVer=0\tFormat=0\tTmp=${t}`);
    expect(row.source).toBe('app');
    const c = await cmds();
    expect(c).toHaveLength(1);
    expect([c[0]!.device_id, c[0]!.command]).toEqual([d.id, `DATA UPDATE BIODATA Pin=7\tNo=5\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=13\tMinorVer=0\tFormat=0\tTmp=${t}`]);
    // listed, and no bytes in the audit
    expect(zEmployeeBiometrics.parse((await api.get(`${V1}/employees/${e.id}/biometrics`)).body).fingers.map((f) => f.fingerIndex).sort()).toEqual([3, 5]);
    const [a] = await auditRows('biometric.captured');
    expect(a?.metadata).toMatchObject({ fingerIndex: 5, finger: 'Right thumb', majorVersion: 13, commandsQueued: 1 });
    expect(JSON.stringify(a)).not.toContain(t.slice(0, 30));
    // syncToDevices=false stores without queueing
    await pool.query('DELETE FROM device_commands');
    expect((await api.post(`${V1}/employees/${e.id}/fingerprints`).send({ fingerIndex: 6, template: t, majorVersion: 13, syncToDevices: false })).status).toBe(201);
    expect(await cmds()).toHaveLength(0);
  });

  it('rejects an incompatible algorithm version with 409 TEMPLATE_INCOMPATIBLE {expected, got}', async () => {
    await createDevice('SN1', 'Gate');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    await postBio('SN1', bio('7', 3, 1, 13, 0));
    const res = await api.post(`${V1}/employees/${e.id}/fingerprints`).send({ fingerIndex: 5, template: tmpl(512), majorVersion: 10 });
    expect([res.status, res.body.error.code, res.body.error.details]).toEqual([409, 'TEMPLATE_INCOMPATIBLE', { expected: 13, got: 10 }]);
    expect((await pool.query(`SELECT 1 FROM biometric_templates WHERE idx = 5`)).rowCount).toBe(0);
    expect(await cmds()).toHaveLength(0);
    // with nothing stored anywhere the SenseFace default (13) applies
    await pool.query('DELETE FROM biometric_templates');
    const r2 = await api.post(`${V1}/employees/${e.id}/fingerprints`).send({ fingerIndex: 5, template: tmpl(512), majorVersion: 10 });
    expect(r2.body.error.details).toEqual({ expected: 13, got: 10 });
  });

  it('validates input and permission', async () => {
    const e = await mkEmp();
    const url = `${V1}/employees/${e.id}/fingerprints`;
    expect((await api.post(url).send({ fingerIndex: 10, template: tmpl(512), majorVersion: 13 })).status).toBe(400);
    expect((await api.post(url).send({ fingerIndex: 1, template: 'short', majorVersion: 13 })).status).toBe(400);
    expect((await api.post(url).send({ fingerIndex: 1, template: '!!!not base64!!!!!!!', majorVersion: 13 })).status).toBe(400);
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await viewer.post(url).send({ fingerIndex: 1, template: tmpl(512), majorVersion: 13 })).status).toBe(403);
    const ok = await userClient({ permissions: [...BIOMETRICS] });
    expect((await ok.post(url).send({ fingerIndex: 1, template: tmpl(512), majorVersion: 13 })).status).toBe(201);
  });
});

describe('device photo ingest', () => {
  it('bumps version and takes over source only when the picture changes', async () => {
    await createDevice('SN1', 'Gate');
    const e = await mkEmp();
    await holdOnDevice('SN1', '7');
    await put(api, e.id, jpeg()); // app, v1
    const appB64 = jpeg().toString('base64');
    // the device echoes the same picture: nothing changes
    await adms.post(`/iclock/cdata?SN=SN1&table=USERPIC`).send(`USERPIC PIN=7\tFileName=7.jpg\tSize=${appB64.length}\tContent=${appB64}`);
    expect((await pool.query(`SELECT source, version FROM user_photos WHERE pin = '7'`)).rows[0]).toEqual({ source: 'app', version: 1 });
    // a different picture from the device replaces it
    const other = jpeg(600, 600, { pad: 3000 }).toString('base64');
    await adms.post(`/iclock/cdata?SN=SN1&table=USERPIC`).send(`USERPIC PIN=7\tFileName=7.jpg\tSize=${other.length}\tContent=${other}`);
    expect((await pool.query(`SELECT source, version, size_bytes FROM user_photos WHERE pin = '7'`)).rows[0]).toEqual({ source: 'device', version: 2, size_bytes: jpeg(600, 600, { pad: 3000 }).length });
  });
});
