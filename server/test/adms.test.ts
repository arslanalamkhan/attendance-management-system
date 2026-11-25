import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adms, api, closeDb, config, CRLF, pool, resetDb, V1 } from './helpers';

const SN = 'VDE0000001';

const HANDSHAKE = (sn: string, attStamp = 'None', opStamp = 'None') =>
  [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${attStamp}`,
    `OPERLOGStamp=${opStamp}`,
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog\tOpLog\tAttPhoto\tEnrollUser\tChgUser\tEnrollFP\tChgFP\tFPImag\tFACE\tUserPic\tBioPhoto',
    'TimeZone=5',
    'Realtime=1',
    'Encrypt=None',
  ].join(CRLF);

const q = <T>(sql: string, params: unknown[] = []) => pool.query(sql, params).then((r) => r.rows as T[]);

beforeEach(resetDb);
afterAll(closeDb);

describe('ADMS handshake', () => {
  it('auto-registers an unknown serial and answers the option block with CRLF line endings', async () => {
    const res = await adms.get(`/iclock/cdata?SN=${SN}&options=all&pushver=2.4.1&language=69`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.text).toBe(HANDSHAKE(SN));
    expect(res.text).not.toMatch(/(?<!\r)\n/);

    const devices = await q<{ name: string; auto_registered: boolean; status: string; push_version: string }>(
      'SELECT name, auto_registered, status, push_version FROM devices',
    );
    expect(devices).toEqual([{ name: `Device ${SN}`, auto_registered: true, status: 'online', push_version: '2.4.1' }]);
  });

  it('accepts the .aspx suffix, upper-case paths and a lower-case sn key', async () => {
    const res = await adms.get(`/ICLOCK/cdata.aspx?sn=${SN}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe(HANDSHAKE(SN));
  });

  it('answers OK without a serial number and 404 outside /iclock', async () => {
    const a = await adms.get('/iclock/cdata');
    expect([a.status, a.text]).toEqual([200, 'OK']);
    const b = await adms.get(`/something/else?SN=${SN}`);
    expect([b.status, b.text]).toEqual([404, 'Not Found']);
  });

  it('returns 404 "Unknown device" for an unknown serial when auto-register is off', async () => {
    config.admsAutoRegister = false;
    try {
      const res = await adms.get(`/iclock/cdata?SN=UNKNOWN1`);
      expect([res.status, res.text]).toEqual([404, 'Unknown device']);
      expect(await q('SELECT 1 FROM devices')).toHaveLength(0);
    } finally {
      config.admsAutoRegister = true;
    }
  });

  it('gives an inactive device plain OK and no commands or data processing', async () => {
    const dev = await api.post(`${V1}/devices`).send({ name: 'Off', serialNumber: SN, isActive: false });
    expect(dev.status).toBe(201);
    await api.post(`${V1}/devices/${dev.body.id}/commands`).send({ type: 'info' });
    expect((await adms.get(`/iclock/cdata?SN=${SN}`)).text).toBe('OK');
    expect((await adms.get(`/iclock/getrequest?SN=${SN}`)).text).toBe('OK');
    const punch = await adms
      .post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=1`)
      .set('Content-Type', 'text/plain')
      .send('1\t2026-01-05 08:00:00\t0\t1\n');
    expect(punch.text).toBe('OK');
    expect(await q('SELECT 1 FROM attendance_logs')).toHaveLength(0);
    // the heartbeat still counts
    expect((await q<{ last_seen_at: Date | null }>('SELECT last_seen_at FROM devices'))[0]?.last_seen_at).not.toBeNull();
  });

  it('logs every request in adms_requests', async () => {
    await adms.get(`/iclock/cdata?SN=${SN}&options=all`);
    const rows = await q<{ serial_number: string; method: string; path: string; query: string; response: string }>(
      'SELECT serial_number, method, path, query, response FROM adms_requests',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serial_number: SN, method: 'GET', path: '/iclock/cdata', query: `SN=${SN}&options=all` });
    expect(rows[0]?.response).toContain('GET OPTION FROM');
  });

  it('adds no helmet headers and no request id to device responses', async () => {
    const res = await adms.get(`/iclock/cdata?SN=${SN}`);
    expect(res.headers['x-request-id']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('ADMS ATTLOG', () => {
  const body = '1\t2026-01-05 08:01:02\t0\t15\t0\t0\t0\n12\t2026-01-05 17:30:00\t1\t1\t\t\n';

  it('inserts punches, answers "OK: <n>" and stores the stamp for the next handshake', async () => {
    const res = await adms.post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`).set('Content-Type', 'text/plain').send(body);
    expect([res.status, res.text]).toEqual([200, 'OK: 2']);

    const rows = await q<{ pin: string; punch_time: string; status: number; verify_type: number; work_code: string | null }>(
      `SELECT pin, to_char(punch_time, 'YYYY-MM-DD HH24:MI:SS') AS punch_time, status, verify_type, work_code
       FROM attendance_logs ORDER BY pin::int`,
    );
    expect(rows).toEqual([
      { pin: '1', punch_time: '2026-01-05 08:01:02', status: 0, verify_type: 15, work_code: '0' },
      { pin: '12', punch_time: '2026-01-05 17:30:00', status: 1, verify_type: 1, work_code: null },
    ]);

    const hs = await adms.get(`/iclock/cdata?SN=${SN}`);
    expect(hs.text).toBe(HANDSHAKE(SN, '9999'));
  });

  it('dedupes re-sent punches but still acknowledges them', async () => {
    const url = `/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=1`;
    await adms.post(url).set('Content-Type', 'text/plain').send(body);
    const again = await adms.post(url).set('Content-Type', 'text/plain').send(body + '7\t2026-01-05 09:00:00\t0\t1\n');
    expect(again.text).toBe('OK: 3');
    expect(await q('SELECT 1 FROM attendance_logs')).toHaveLength(3);
  });

  it('counts unparseable lines in the acknowledgement and accepts CRLF, no content type, empty bodies', async () => {
    const res = await adms
      .post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=2`)
      .send('5\t2026-01-05 09:00:00\t0\t1\r\ngarbage\r\n');
    expect(res.text).toBe('OK: 2');
    expect(await q('SELECT 1 FROM attendance_logs')).toHaveLength(1);
    const empty = await adms.post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=3`);
    expect(empty.text).toBe('OK: 0');
  });

  it('does not acknowledge a batch it failed to store (device keeps and retries it)', async () => {
    const orig = pool.query.bind(pool) as (...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(pool, 'query').mockImplementation(((sql: unknown, ...rest: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO attendance_logs')) return Promise.reject(new Error('boom'));
      return orig(sql, ...rest);
    }) as never);
    try {
      const res = await adms.post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=5`).send(body);
      expect([res.status, res.text]).toEqual([200, 'ERROR: database']);
    } finally {
      spy.mockRestore();
    }
    // stamp must not have advanced
    expect((await adms.get(`/iclock/cdata?SN=${SN}`)).text).toBe(HANDSHAKE(SN));
  });
});

describe('ADMS user / template / photo ingest', () => {
  const USERS =
    'USER PIN=776\tName=Mukhtiyar Ahmed \tPri=14\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=-1\tViceCard=\n' +
    'USER PIN=777\tName=Arslan Alam Khan\tPri=0\tPasswd=1234\tCard=[99]\tGrp=1\n';
  const BIO = 'BIODATA Pin=776\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=58\tMinorVer=0\tFormat=0\tTmp=AAAAbWFnaWM+';
  const FP = 'FP PIN=776\tFID=6\tSize=1340\tValid=1\tTMP=SUZTUzIx==';

  it('OPERLOG stores USER lines and OPLOG noise, answering OK: <lines> and storing OpStamp', async () => {
    const res = await adms
      .post(`/iclock/cdata?SN=${SN}&table=OPERLOG&OpStamp=777`)
      .send(USERS + 'OPLOG 4\t0\t2026-01-05 08:00:00\t0\t0\t0\t0\n');
    expect(res.text).toBe('OK: 3');
    const users = await q<{ pin: string; name: string; privilege: number; password: string | null; card_no: string | null }>(
      'SELECT pin, name, privilege, password, card_no FROM device_users ORDER BY pin',
    );
    expect(users).toEqual([
      { pin: '776', name: 'Mukhtiyar Ahmed', privilege: 14, password: null, card_no: null },
      { pin: '777', name: 'Arslan Alam Khan', privilege: 0, password: '1234', card_no: '[99]' },
    ]);
    expect((await adms.get(`/iclock/cdata?SN=${SN}`)).text).toBe(HANDSHAKE(SN, 'None', '777'));
  });

  it('a fingerprint/face enrolment OPLOG queues ONE unfiltered biometric refresh; menu/other OPLOGs do not', async () => {
    const cmds = () => q<{ command: string; status: string }>(`SELECT command, status FROM device_commands ORDER BY id`);
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG`).send('OPLOG 4\t777\t2026-11-24 11:12:09\t777\t0\t0\t0\n');
    expect(await cmds()).toEqual([]);
    // real line from the SenseFace: code 6 = fingerprint enrolled for PIN 5489
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG`).send('OPLOG 6\t0\t2026-11-24 11:12:46\t5489\t0\t0\t0\n');
    // a second enrolment while the first refresh still waits does not queue another
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG`).send('OPLOG 69\t0\t2026-11-24 11:13:10\t5489\t0\t0\t0\n');
    expect(await cmds()).toEqual([{ command: 'DATA QUERY BIODATA', status: 'pending' }]);
    // once answered, the next enrolment queues a new one
    const poll = await adms.get(`/iclock/getrequest?SN=${SN}`);
    const id = /^C:(\d+):/.exec(poll.text)![1];
    await adms.post(`/iclock/devicecmd?SN=${SN}`).send(`ID=${id}&Return=0&CMD=DATA\n`);
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG`).send('OPLOG 6\t0\t2026-11-24 11:20:00\t5490\t0\t0\t0\n');
    expect((await cmds()).map((c) => c.status)).toEqual(['success', 'pending']);
  });

  it('no refresh when the device already uploaded the new template itself (real sequence: BIODATA, then OPLOG 6)', async () => {
    await adms.post(`/iclock/cdata?SN=${SN}&table=BIODATA&OpStamp=9999`)
      .send('BIODATA Pin=5489\tNo=7\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=13\tMinorVer=0\tFormat=0\tTmp=QUJD\n');
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG&OpStamp=9999`).send('OPLOG 6\t0\t2026-11-24 11:26:50\t5489\t0\t0\t0\n');
    expect(await q('SELECT 1 FROM device_commands')).toHaveLength(0);
  });

  it('upserts users on repeat and keeps the latest name', async () => {
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG`).send(USERS);
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG`).send('USER PIN=777\tName=Renamed\tPri=0\n');
    const rows = await q<{ name: string }>(`SELECT name FROM device_users WHERE pin = '777'`);
    expect(rows).toEqual([{ name: 'Renamed' }]);
    expect(await q('SELECT 1 FROM device_users')).toHaveLength(2);
  });

  it('table=USERINFO accepts lines without the leading token', async () => {
    const res = await adms.post(`/iclock/cdata?SN=${SN}&table=USERINFO`).send('PIN=5\tName=Sara\tPri=0\tCard=[1]\r\n');
    expect(res.text).toBe('OK: 1');
    expect(await q(`SELECT 1 FROM device_users WHERE pin = '5'`)).toHaveLength(1);
  });

  it('BIODATA and FINGERTMP/FP templates are upserted without duplicating', async () => {
    const r1 = await adms.post(`/iclock/cdata?SN=${SN}&table=BIODATA`).send(BIO + '\n');
    expect(r1.text).toBe('OK: 1');
    await adms.post(`/iclock/cdata?SN=${SN}&table=BIODATA`).send(BIO.replace('AAAAbWFnaWM+', 'CHANGED') + '\n');
    await adms.post(`/iclock/cdata?SN=${SN}&table=OPERLOG`).send(FP + '\n');
    const rows = await q<{ kind: string; bio_type: number | null; idx: number; data: string; size: number | null }>(
      'SELECT kind, bio_type, idx, data, size FROM biometric_templates ORDER BY kind',
    );
    expect(rows).toEqual([
      { kind: 'bio', bio_type: 9, idx: 0, data: 'CHANGED', size: null },
      { kind: 'fp', bio_type: null, idx: 6, data: 'SUZTUzIx==', size: 1340 },
    ]);
  });

  it('USERPIC always wins, BIOPHOTO only fills a missing photo', async () => {
    await adms.post(`/iclock/cdata?SN=${SN}&table=BIOPHOTO`).send('BIOPHOTO PIN=7\tFileName=a.jpg\tType=9\tContent=QUFB\n');
    await adms.post(`/iclock/cdata?SN=${SN}&table=BIOPHOTO`).send('BIOPHOTO PIN=7\tFileName=b.jpg\tType=9\tContent=QkJC\n');
    expect(await q(`SELECT file_name, content FROM user_photos WHERE pin = '7'`)).toEqual([{ file_name: 'a.jpg', content: 'QUFB' }]);
    const res = await adms.post(`/iclock/cdata?SN=${SN}&table=USERPIC`).send('USERPIC PIN=7\tFileName=c.jpg\tSize=3\tContent=Q0ND\n');
    expect(res.text).toBe('OK: 1');
    expect(await q(`SELECT file_name, content FROM user_photos WHERE pin = '7'`)).toEqual([{ file_name: 'c.jpg', content: 'Q0ND' }]);
    await adms.post(`/iclock/cdata?SN=${SN}&table=BIOPHOTO`).send('BIOPHOTO PIN=7\tFileName=d.jpg\tType=9\tContent=REREREQ=\n');
    expect(await q(`SELECT file_name FROM user_photos WHERE pin = '7'`)).toEqual([{ file_name: 'c.jpg' }]);
  });

  it('ingests user data posted to querydata and devicecmd bodies', async () => {
    await adms.post(`/iclock/querydata?SN=${SN}&table=USERINFO&type=tabledata`).send('PIN=31\tName=Q\tPri=0\n');
    expect(await q(`SELECT 1 FROM device_users WHERE pin = '31'`)).toHaveLength(1);
    const res = await adms.post(`/iclock/devicecmd?SN=${SN}`).send('ID=99&Return=0&CMD=DATA QUERY\nUSER PIN=32\tName=D\tPri=0\n');
    expect(res.text).toBe('OK');
    expect(await q(`SELECT 1 FROM device_users WHERE pin = '32'`)).toHaveLength(1);
  });

  it('OPTIONS fills device info columns', async () => {
    const res = await adms
      .post(`/iclock/cdata?SN=${SN}&table=options`)
      .send('~DeviceName=SenseFace 7A,FWVersion=Ver 3.0.5,UserCount=817,FPCount=2,FaceCount=800,~Platform=ZAM70');
    expect(res.text).toBe('OK');
    const [d] = await q<{ device_name: string; firmware_version: string; user_count: number; fp_count: number; face_count: number; platform: string }>(
      'SELECT device_name, firmware_version, user_count, fp_count, face_count, platform FROM devices',
    );
    expect(d).toEqual({ device_name: 'SenseFace 7A', firmware_version: 'Ver 3.0.5', user_count: 817, fp_count: 2, face_count: 800, platform: 'ZAM70' });
  });
});

describe('ADMS command cycle', () => {
  async function deviceId(): Promise<number> {
    await adms.get(`/iclock/cdata?SN=${SN}`);
    return (await q<{ id: number }>('SELECT id FROM devices'))[0]!.id;
  }

  it('getrequest hands out pending commands once as C:<id>:<cmd> lines (LF), then OK', async () => {
    const id = await deviceId();
    const a = await api.post(`${V1}/devices/${id}/commands`).send({ type: 'info' });
    const b = await api.post(`${V1}/devices/${id}/commands`).send({ type: 'check' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ deviceId: id, command: 'INFO', status: 'pending' });

    const res = await adms.get(`/iclock/getrequest?SN=${SN}`);
    expect(res.text).toBe(`C:${a.body.id}:INFO\nC:${b.body.id}:CHECK`);
    const sent = await q<{ status: string; sent_at: Date | null }>('SELECT status, sent_at FROM device_commands ORDER BY id');
    expect(sent.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(sent[0]?.sent_at).not.toBeNull();

    expect((await adms.get(`/iclock/getrequest?SN=${SN}`)).text).toBe('OK');
  });

  it('hands out at most 10 commands per poll, oldest first', async () => {
    const id = await deviceId();
    for (let i = 0; i < 12; i++) await api.post(`${V1}/devices/${id}/commands`).send({ type: 'check' });
    const first = (await adms.get(`/iclock/getrequest?SN=${SN}`)).text.split('\n');
    expect(first).toHaveLength(10);
    const second = (await adms.get(`/iclock/getrequest?SN=${SN}`)).text.split('\n');
    expect(second).toHaveLength(2);
  });

  it('devicecmd marks commands success / failed with the return code and raw reply', async () => {
    const id = await deviceId();
    const a = await api.post(`${V1}/devices/${id}/commands`).send({ type: 'reboot' });
    const b = await api.post(`${V1}/devices/${id}/commands`).send({ type: 'check' });
    await adms.get(`/iclock/getrequest?SN=${SN}`);
    const res = await adms.post(`/iclock/devicecmd?SN=${SN}`).send(`ID=${a.body.id}&Return=0&CMD=REBOOT\r\nID=${b.body.id}&Return=-1002&CMD=CHECK\r\n`);
    expect(res.text).toBe('OK');
    const rows = await q<{ id: number; status: string; return_code: number; result: string; completed_at: Date }>(
      'SELECT id, status, return_code, result, completed_at FROM device_commands ORDER BY id',
    );
    expect(rows.map((r) => [r.status, r.return_code])).toEqual([
      ['success', 0],
      ['failed', -1002],
    ]);
    expect(rows[0]?.completed_at).not.toBeNull();
    expect(rows[0]?.result).toContain('CMD=REBOOT');

    const list = await api.get(`${V1}/devices/${id}/commands`);
    expect(list.body.items.map((c: { status: string }) => c.status)).toEqual(['failed', 'success']);
  });

  it('INFO reply updates the device info columns; a command of another device is untouched', async () => {
    const id = await deviceId();
    const other = await api.post(`${V1}/devices`).send({ name: 'Other', serialNumber: 'OTHER001' });
    const foreign = await api.post(`${V1}/devices/${other.body.id}/commands`).send({ type: 'info' });
    const cmd = await api.post(`${V1}/devices/${id}/commands`).send({ type: 'info' });
    await adms.get(`/iclock/getrequest?SN=${SN}`);
    await adms
      .post(`/iclock/devicecmd?SN=${SN}`)
      .send(`ID=${cmd.body.id}&Return=0&CMD=INFO\nFWVersion=Ver 9.9\nUserCount=5\n~DeviceName=Face 7`);
    await adms.post(`/iclock/devicecmd?SN=${SN}`).send(`ID=${foreign.body.id}&Return=0&CMD=INFO`);
    const dev = await api.get(`${V1}/devices/${id}`);
    expect(dev.body).toMatchObject({ firmwareVersion: 'Ver 9.9', userCount: 5, deviceName: 'Face 7' });
    const f = await q<{ status: string }>('SELECT status FROM device_commands WHERE id = $1', [foreign.body.id]);
    expect(f[0]?.status).toBe('pending');
  });

  it('getrequest?INFO=... refreshes device info', async () => {
    const id = await deviceId();
    await adms.get(`/iclock/getrequest?SN=${SN}&INFO=${encodeURIComponent('Ver 8.0,12,3,456,192.168.1.201,10,7,5,0')}`);
    const dev = await api.get(`${V1}/devices/${id}`);
    expect(dev.body).toMatchObject({ firmwareVersion: 'Ver 8.0', userCount: 12, fpCount: 3, attCount: 456, faceCount: 5 });
  });

  it('confirmed DATA UPDATE / DELETE USERINFO commands are mirrored into device_users', async () => {
    const id = await deviceId();
    const emp = await api.post(`${V1}/employees`).send({ empCode: '42', name: 'Ali Raza', privilege: 14 });
    expect(emp.status).toBe(201);
    const push = await api.post(`${V1}/employees/push`).send({ employeeIds: [emp.body.id], deviceIds: [id] });
    expect(push.body).toEqual({ queued: 1 });

    const polled = (await adms.get(`/iclock/getrequest?SN=${SN}`)).text;
    expect(polled).toMatch(/^C:\d+:DATA UPDATE USERINFO PIN=42\tName=Ali Raza\tPri=14\t/);
    const cmdId = Number(/^C:(\d+):/.exec(polled)![1]);
    expect(await q(`SELECT 1 FROM device_users WHERE pin = '42'`)).toHaveLength(0);
    await adms.post(`/iclock/devicecmd?SN=${SN}`).send(`ID=${cmdId}&Return=0&CMD=DATA UPDATE USERINFO`);
    expect(await q<{ name: string }>(`SELECT name FROM device_users WHERE pin = '42'`)).toEqual([{ name: 'Ali Raza' }]);

    const del = await api.delete(`${V1}/devices/${id}/users/42`);
    expect(del.body).toEqual({ queued: 1 });
    const polled2 = (await adms.get(`/iclock/getrequest?SN=${SN}`)).text;
    expect(polled2).toMatch(/^C:\d+:DATA DELETE USERINFO PIN=42$/);
    const delId = Number(/^C:(\d+):/.exec(polled2)![1]);
    await adms.post(`/iclock/devicecmd?SN=${SN}`).send(`ID=${delId}&Return=0&CMD=DATA DELETE USERINFO`);
    expect(await q(`SELECT 1 FROM device_users WHERE pin = '42'`)).toHaveLength(0);
  });

  it('a failed command is not mirrored', async () => {
    const id = await deviceId();
    const emp = await api.post(`${V1}/employees`).send({ empCode: '43', name: 'Bad' });
    await api.post(`${V1}/employees/push`).send({ employeeIds: [emp.body.id], deviceIds: [id] });
    const polled = (await adms.get(`/iclock/getrequest?SN=${SN}`)).text;
    const cmdId = Number(/^C:(\d+):/.exec(polled)![1]);
    await adms.post(`/iclock/devicecmd?SN=${SN}`).send(`ID=${cmdId}&Return=-1&CMD=DATA UPDATE USERINFO`);
    expect(await q(`SELECT 1 FROM device_users WHERE pin = '43'`)).toHaveLength(0);
  });
});

describe('ADMS never answers 500 to the device', () => {
  it('answers OK when the handler throws (database down)', async () => {
    const spy = vi.spyOn(pool, 'query').mockRejectedValue(new Error('database unavailable'));
    try {
      const res = await adms.get(`/iclock/getrequest?SN=${SN}`);
      expect([res.status, res.text]).toEqual([200, 'OK']);
      const post = await adms.post(`/iclock/cdata?SN=${SN}&table=ATTLOG`).send('1\t2026-01-05 08:00:00\t0\t1\n');
      expect([post.status, post.text]).toEqual([200, 'OK']);
    } finally {
      spy.mockRestore();
    }
  });

  it('answers OK for oversize / odd bodies and unknown sub-paths', async () => {
    const big = await adms.post(`/iclock/cdata?SN=${SN}&table=ATTPHOTO`).send('x'.repeat(2_000_000));
    expect([big.status, big.text]).toEqual([200, 'OK']);
    for (const p of ['registry', 'push', 'ping', 'rtdata', 'whatever']) {
      const r = await adms.post(`/iclock/${p}?SN=${SN}`).send('anything');
      expect([r.status, r.text]).toEqual([200, 'OK']);
    }
  });
});

describe('ADMS through nginx (port 80)', () => {
  it('records the terminal address nginx passes in X-Real-IP (only believed from the VM itself)', async () => {
    // supertest connects from loopback, exactly like nginx on the VM does
    const res = await adms.get(`/iclock/cdata?SN=${SN}&options=all`).set('X-Real-IP', '172.20.35.250');
    expect(res.status).toBe(200);
    const [dev] = await q<{ ip_address: string | null }>('SELECT ip_address FROM devices WHERE serial_number = $1', [SN]);
    expect(dev?.ip_address).toBe('172.20.35.250');
    const [log] = await q<{ remote_ip: string | null }>('SELECT remote_ip FROM adms_requests WHERE serial_number = $1 ORDER BY id DESC LIMIT 1', [SN]);
    expect(log?.remote_ip).toBe('172.20.35.250');
    // a malformed header is ignored
    await adms.get(`/iclock/getrequest?SN=${SN}`).set('X-Real-IP', 'not an address<script>');
    const [dev2] = await q<{ ip_address: string | null }>('SELECT ip_address FROM devices WHERE serial_number = $1', [SN]);
    expect(dev2?.ip_address).toMatch(/^(127\.0\.0\.1|::1)$/);
  });
});
