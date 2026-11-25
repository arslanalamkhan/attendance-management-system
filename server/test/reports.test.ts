import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { REPORT_PERMISSIONS, REPORT_TYPE_KEYS, zDashboard, zReportResult, zTodaySummary, type ReportType } from '@nacta/shared';
import { api, closeDb, createDevice, pool, resetDb, userClient, V1, type Client } from './helpers';
import { addDays, todayLocal } from '../src/lib/dates';
import { flushAudit } from '../src/modules/audit/service';
import { buildPdf } from '../src/modules/reports/pdf';
import { buildReport, resolveParams } from '../src/modules/reports';
import { ink, tint } from '../src/modules/reports/common';
import { buildXlsx } from '../src/modules/reports/xlsx';

beforeEach(resetDb);
afterAll(closeDb);

const ago = (n: number) => addDays(todayLocal(), -n);
const D = () => ago(3); // the day most fixtures are about

const mkWing = async (name: string, code?: string) => (await api.post(`${V1}/wings`).send({ name, ...(code ? { code } : {}) })).body as { id: number };
const mkEmp = async (empCode: string, name: string, wingId?: number, extra: Record<string, unknown> = {}) => {
  const res = await api.post(`${V1}/employees`).send({ empCode, name, ...(wingId ? { wingId } : {}), ...extra });
  if (res.status !== 201) throw new Error(`employee: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; empCode: string; name: string };
};
/** Every weekday is a working day, so fixtures do not depend on which weekday "3 days ago" was. */
const allDaysWorking = () =>
  pool.query('UPDATE timing_profile_versions SET days = $1::jsonb', [JSON.stringify(Array.from({ length: 7 }, () => ({ start: '09:00', end: '17:00' })))]);
let deviceId = 0;
const punch = async (pin: string, date: string, time: string, verify = 1) => {
  if (!deviceId) deviceId = (await createDevice('REPDEV1', 'Main gate')).id;
  await pool.query(
    `INSERT INTO attendance_logs (device_id, pin, punch_time, status, verify_type) VALUES ($1, $2, $3::timestamp, 0, $4) ON CONFLICT DO NOTHING`,
    [deviceId, pin, `${date} ${time}`, verify],
  );
};
beforeEach(() => {
  deviceId = 0;
});

interface World {
  ops: number;
  adm: number;
  ali: { id: number };
  bina: { id: number };
  cara: { id: number };
  dan: { id: number };
}

/**
 * Operations: 101 Ali (present on D), 102 Bina (late 50 min on D; her status was corrected).
 * Administration: 201 Cara (casual leave on D+1, absent otherwise; D corrected to present).
 * No wing: 301 Dan (absent).
 */
async function world(): Promise<World> {
  await allDaysWorking();
  const ops = (await mkWing('Operations', 'OPS')).id;
  const adm = (await mkWing('Administration', 'ADM')).id;
  const ali = await mkEmp('101', 'Ali Raza', ops, { designation: 'Analyst' });
  const bina = await mkEmp('102', 'Bina Khan', ops, { designation: 'Officer' });
  const cara = await mkEmp('201', 'Cara Malik', adm, { designation: 'Clerk' });
  const dan = await mkEmp('301', 'Dan Iqbal');
  // join long ago so every day in the fixtures counts
  await pool.query(`UPDATE employees SET join_date = $1`, [ago(60)]);
  await punch('101', D(), '09:05');
  await punch('101', D(), '17:10');
  await punch('102', D(), '09:50');
  await punch('102', D(), '17:00');
  // leave for Cara the day after D (type 1 = CL Casual, #2563EB) and a correction on D
  const leave = await api.post(`${V1}/leaves`).send({ employeeIds: [cara.id], leaveTypeId: 1, from: ago(2), to: ago(2), reason: 'Family matter' });
  if (leave.status !== 201) throw new Error(`leave: ${leave.status} ${JSON.stringify(leave.body)}`);
  const corr = await api.post(`${V1}/attendance/corrections`).send({ employeeId: cara.id, date: D(), type: 'set_status', status: 'present', reason: 'On official duty outside' });
  if (corr.status !== 201) throw new Error(`correction: ${corr.status} ${JSON.stringify(corr.body)}`);
  return { ops, adm, ali, bina, cara, dan };
}

const get = async (c: { get: Client['get'] }, type: string, query = '') => c.get(`${V1}/reports/${type}${query ? `?${query}` : ''}`);
const result = async (c: { get: Client['get'] }, type: string, query = '') => {
  const res = await get(c, type, query);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { res, body: zReportResult.parse(res.body), raw: res.body as Record<string, unknown> & { rows: Record<string, unknown>[]; extraTables?: { id: string; rows: Record<string, unknown>[] }[] } };
};
const codes = (rows: Record<string, unknown>[]) => rows.map((r) => String(r.code));
const statusOf = (rows: Record<string, unknown>[], code: string) => (rows.find((r) => r.code === code)?.status ?? null) as { code: string; label: string; color?: string } | null;

const binary = (res: import('superagent').Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const download = async (c: { get: Client['get'] }, type: string, format: string, query = '') =>
  c.get(`${V1}/reports/${type}/export?format=${format}${query ? `&${query}` : ''}`).buffer(true).parse(binary);

async function sheetOf(buf: Buffer, index = 0): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb.worksheets[index] as ExcelJS.Worksheet;
}
const textOf = (cell: ExcelJS.Cell): string => {
  const v = cell.value;
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('');
  return v === null || v === undefined ? '' : String(v);
};
/** The row whose first cell holds `label` (the table header row). */
function headerRowOf(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = 1; r <= 30; r++) if (textOf(ws.getCell(r, 1)) === label) return r;
  throw new Error(`no header row starting with ${label}`);
}

let viewer: Awaited<ReturnType<typeof userClient>>;
let exporter: Awaited<ReturnType<typeof userClient>>;
let corrector: Awaited<ReturnType<typeof userClient>>;
const mkUsers = async (w: World) => {
  viewer = await userClient({ permissions: ['attendance.view', 'dashboard.view', ...REPORT_PERMISSIONS], wings: [w.ops] });
  exporter = await userClient({ permissions: ['attendance.view', 'attendance.export', ...REPORT_PERMISSIONS], wings: 'all' });
  corrector = await userClient({ permissions: ['attendance.view', 'attendance.correct', 'audit.view', 'attendance.export', ...REPORT_PERMISSIONS], wings: 'all' });
};

// ======================================================================================================================
describe('reports: contract and validation', () => {
  it('lists every report type and returns a valid ReportResult for each', async () => {
    const w = await world();
    for (const type of REPORT_TYPE_KEYS) {
      const q = type === 'time_card' ? `employeeId=${w.ali.id}&from=${ago(5)}&to=${ago(1)}` : `date=${D()}&month=${D().slice(0, 7)}&from=${ago(5)}&to=${ago(1)}`;
      const { body } = await result(api, type, q);
      expect(body.type).toBe(type);
      expect(body.title.length).toBeGreaterThan(3);
      expect(body.columns.length).toBeGreaterThan(5);
      expect(body.page).toBe(1);
      expect(body.total).toBeGreaterThanOrEqual(body.rows.length);
    }
  });

  it('each report needs its own permission; files also need attendance.export; dashboard.view for the dashboard', async () => {
    const w = await world();
    await mkUsers(w);
    const nobody = await userClient({ permissions: [] });
    expect((await get(nobody, 'daily')).status).toBe(403);
    expect((await nobody.get(`${V1}/dashboard`)).status).toBe(403);
    expect((await nobody.get(`${V1}/reports/daily/export?format=xlsx`)).status).toBe(403);
    expect((await viewer.get(`${V1}/reports/daily/export?format=xlsx`)).status).toBe(403); // view is not export
    expect((await exporter.get(`${V1}/dashboard`)).status).toBe(403);
    expect((await exporter.get(`${V1}/reports/daily/export?format=xlsx`)).status).toBe(200);
    expect((await rawGet('/reports/daily')).status).toBe(401);

    // reports are granted one by one: the daily report does not open the absentees report
    const dailyOnly = await userClient({ permissions: ['reports.daily', 'attendance.export'], wings: 'all' });
    expect((await get(dailyOnly, 'daily')).status).toBe(200);
    expect((await dailyOnly.get(`${V1}/reports/daily/export?format=xlsx`)).status).toBe(200);
    const other = await get(dailyOnly, 'absentees');
    expect(other.status).toBe(403);
    expect(other.body.error.message).toContain('Absentees report');
    expect((await dailyOnly.get(`${V1}/reports/absentees/export?format=xlsx`)).status).toBe(403);
    // attendance.view alone no longer opens reports
    const viewOnly = await userClient({ permissions: ['attendance.view'], wings: 'all' });
    expect((await get(viewOnly, 'daily')).status).toBe(403);
  });

  it('400 VALIDATION_ERROR for missing or bad parameters, 404 for an unknown report', async () => {
    const w = await world();
    const bad = async (type: string, q: string, field: string) => {
      const res = await get(api, type, q);
      expect(res.status, `${type}?${q}`).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.error.details ?? {})).toContain(field);
    };
    await bad('time_card', `from=${ago(5)}&to=${ago(1)}`, 'employeeId');
    await bad('daily', 'date=2026-02-30', 'date');
    await bad('daily', `date=${D()}&status=nonsense`, 'status');
    await bad('monthly_register', 'month=2026-13', 'month');
    await bad('late_comers', `from=${ago(1)}&to=${ago(5)}`, 'to');
    await bad('absentees', `from=${addDays(todayLocal(), -400)}&to=${todayLocal()}`, 'to'); // over 366 days
    await bad('punch_log', `from=${addDays(todayLocal(), -100)}&to=${todayLocal()}`, 'to'); // over 92 days
    await bad('leave', 'wingId=99999999999', 'wingId');
    expect((await get(api, 'nonsense')).status).toBe(404);
    expect((await api.get(`${V1}/reports/nonsense/export?format=xlsx`)).status).toBe(404);
    expect((await api.get(`${V1}/reports/daily/export`)).status).toBe(400); // format is required
    expect((await api.get(`${V1}/reports/daily/export?format=docx`)).status).toBe(400);
    expect((await get(api, 'time_card', `employeeId=999999&from=${ago(5)}&to=${ago(1)}`)).status).toBe(404);
    // exactly 366 days and 92 days are fine
    expect((await get(api, 'absentees', `from=${addDays(todayLocal(), -365)}&to=${todayLocal()}`)).status).toBe(200);
    expect((await get(api, 'punch_log', `from=${addDays(todayLocal(), -91)}&to=${todayLocal()}`)).status).toBe(200);
    void w;
  });

  it('defaults: daily = today, monthly register = this month, ranges = this month so far, punch log = today', async () => {
    await world();
    const today = todayLocal();
    expect(resolveParams('daily', {}).date).toBe(today);
    expect(resolveParams('monthly_register', {}).month).toBe(today.slice(0, 7));
    const r = resolveParams('late_comers', {});
    expect([r.from, r.to]).toEqual([`${today.slice(0, 8)}01`, today]);
    const pl = resolveParams('punch_log', {});
    expect([pl.from, pl.to]).toEqual([today, today]);
    const { body } = await result(api, 'daily');
    expect(body.subtitle).toMatch(/\d{2} [A-Z][a-z]{2} \d{4}/);
  });

  it('pages the screen but never the file', async () => {
    const w = await world();
    const p1 = await result(api, 'daily', `date=${D()}&pageSize=3&page=1`);
    const p2 = await result(api, 'daily', `date=${D()}&pageSize=3&page=2`);
    expect(p1.body.total).toBe(4);
    expect(p1.body.rows).toHaveLength(3);
    expect(p2.body.rows).toHaveLength(1);
    expect(p2.body.page).toBe(2);
    const full = await buildReport('daily', resolveParams('daily', { date: D(), pageSize: 1 }), { scope: 'all', isSuperAdmin: true }, false);
    expect(full.rows).toHaveLength(4);
    void w;
  });
});

// ======================================================================================================================
describe('reports: the corrected marker is for the Super Admin only', () => {
  it('daily and time card carry a Corrected column for the Super Admin and for nobody else', async () => {
    const w = await world();
    await mkUsers(w);
    const sa = await result(api, 'daily', `date=${D()}`);
    expect(sa.body.columns.map((c) => c.key)).toContain('corrected');
    expect(sa.raw.rows.find((r) => r.code === '201')?.corrected).toBe('Yes');
    expect(sa.raw.rows.find((r) => r.code === '101')?.corrected).toBe('');
    const tc = await result(api, 'time_card', `employeeId=${w.cara.id}&from=${ago(4)}&to=${ago(1)}`);
    expect(tc.body.columns.map((c) => c.key)).toContain('corrected');

    // a user who can correct, see the audit log and export still must not see it
    for (const [who, c] of [['corrector', corrector], ['exporter', exporter]] as const) {
      for (const [type, q] of [
        ['daily', `date=${D()}`],
        ['time_card', `employeeId=${w.cara.id}&from=${ago(4)}&to=${ago(1)}`],
        ['monthly_register', `month=${D().slice(0, 7)}`],
        ['late_comers', `from=${ago(5)}&to=${ago(1)}`],
        ['absentees', `from=${ago(5)}&to=${ago(1)}`],
        ['wing_summary', `from=${ago(5)}&to=${ago(1)}`],
        ['leave', `from=${ago(5)}&to=${ago(1)}`],
        ['punch_log', `from=${ago(5)}&to=${ago(1)}`],
      ] as const) {
        const { raw, body } = await result(c, type, q);
        expect(JSON.stringify(raw).toLowerCase(), `${who} ${type}`).not.toContain('corrected');
        expect(body.columns.map((x) => x.key)).not.toContain('corrected');
      }
    }
    // ...but the corrected result itself is shown: Cara is Present on D
    const plain = await result(corrector, 'daily', `date=${D()}`);
    expect(statusOf(plain.raw.rows, '201')?.label).toBe('Present');
  });

  it('files follow the same rule', async () => {
    const w = await world();
    await mkUsers(w);
    const xs = await download(api, 'daily', 'xlsx', `date=${D()}`);
    expect(JSON.stringify(await rowsText(xs.body))).toContain('Corrected');
    const xc = await download(corrector, 'daily', 'xlsx', `date=${D()}`);
    expect(JSON.stringify(await rowsText(xc.body)).toLowerCase()).not.toContain('corrected');
    void w;
  });
});

async function rowsText(buf: Buffer): Promise<string[]> {
  const ws = await sheetOf(buf);
  const out: string[] = [];
  ws.eachRow((row) => row.eachCell((cell) => out.push(textOf(cell))));
  return out;
}

// ======================================================================================================================
describe('reports: wing scoping', () => {
  it('a wing-limited user only ever sees their wings in every report', async () => {
    const w = await world();
    await mkUsers(w);
    const q = `date=${D()}&month=${D().slice(0, 7)}&from=${ago(5)}&to=${ago(1)}`;
    const daily = await result(viewer, 'daily', q);
    expect(codes(daily.raw.rows).sort()).toEqual(['101', '102']);
    expect(daily.body.highlights.find((h) => h.label === 'Employees')?.value).toBe('2');
    expect(codes((await result(viewer, 'monthly_register', q)).raw.rows).sort()).toEqual(['101', '102']);
    expect(codes((await result(viewer, 'absentees', q)).raw.rows)).not.toContain('201');
    expect(codes((await result(viewer, 'absentees', q)).raw.rows)).not.toContain('301');
    expect((await result(viewer, 'leave', q)).raw.rows).toHaveLength(0); // Cara's leave is in another wing
    const ws = await result(viewer, 'wing_summary', q);
    expect(ws.raw.rows.map((r) => r.wing)).toEqual(['Operations']);
    expect(codes((await result(viewer, 'late_comers', q)).raw.rows)).toEqual(['102']);
    const pl = await result(viewer, 'punch_log', q);
    expect(new Set(codes(pl.raw.rows))).toEqual(new Set(['101', '102']));
    // asking for another wing returns nothing, never that wing's data
    expect((await result(viewer, 'daily', `date=${D()}&wingId=${w.adm}`)).raw.rows).toHaveLength(0);
    // another wing's employee is a 404 (indistinguishable from a missing one)
    expect((await get(viewer, 'time_card', `employeeId=${w.cara.id}&from=${ago(5)}&to=${ago(1)}`)).status).toBe(404);
    expect((await get(viewer, 'time_card', `employeeId=${w.ali.id}&from=${ago(5)}&to=${ago(1)}`)).status).toBe(200);
    // the subtitle names only their own wing
    expect(daily.body.subtitle).toContain('Operations');
    expect(daily.body.subtitle).not.toContain('Administration');
  });

  it('a punch whose PIN matches nobody is visible to organisation-wide users only', async () => {
    const w = await world();
    await mkUsers(w);
    await punch('9999', D(), '10:00');
    const all = await result(api, 'punch_log', `from=${D()}&to=${D()}`);
    expect(codes(all.raw.rows)).toContain('9999');
    expect(all.raw.rows.find((r) => r.code === '9999')?.name).toBe('Not enrolled');
    expect(codes((await result(viewer, 'punch_log', `from=${D()}&to=${D()}`)).raw.rows)).not.toContain('9999');
  });
});

// ======================================================================================================================
describe('daily', () => {
  it('has the contract columns, statuses, times, minutes and highlights', async () => {
    const w = await world();
    const { body, raw } = await result(api, 'daily', `date=${D()}`);
    expect(body.columns.map((c) => [c.key, c.kind])).toEqual([
      ['code', 'mono'], ['name', 'text'], ['wing', 'text'], ['section', 'text'], ['designation', 'text'], ['status', 'status'],
      ['in', 'time'], ['out', 'time'], ['worked', 'hours'], ['late', 'minutes'], ['early', 'minutes'], ['note', 'text'], ['corrected', 'text'],
    ]);
    expect(raw.rows).toHaveLength(4);
    // ordered by wing then name; "no wing" last
    expect(codes(raw.rows)).toEqual(['201', '101', '102', '301']);
    const ali = raw.rows.find((r) => r.code === '101') as Record<string, unknown>;
    expect(ali).toMatchObject({ name: 'Ali Raza', wing: 'Operations', designation: 'Analyst', in: '09:05', out: '17:10' });
    expect(ali.worked).toBeCloseTo(8.08, 2);
    expect(statusOf(raw.rows, '101')).toMatchObject({ code: 'P', label: 'Present' });
    const bina = raw.rows.find((r) => r.code === '102') as Record<string, unknown>;
    expect(statusOf(raw.rows, '102')).toMatchObject({ code: 'L', label: 'Late' });
    expect(bina.late).toBe(50);
    expect(statusOf(raw.rows, '301')).toMatchObject({ code: 'A', label: 'Absent' });
    const hl = Object.fromEntries(body.highlights.map((h) => [h.label, h.value]));
    expect(hl).toMatchObject({ Employees: '4', Present: '2', Late: '1', 'On leave': '0', Absent: '1' });
    expect(hl['Attendance rate']).toBe('75%');
    expect(body.legend.map((l) => l.code)).toEqual(['P', 'L', 'A']);
    void w;
  });

  it('filters by wing, section and status', async () => {
    const w = await world();
    expect(codes((await result(api, 'daily', `date=${D()}&wingId=${w.ops}`)).raw.rows)).toEqual(['101', '102']);
    expect(codes((await result(api, 'daily', `date=${D()}&status=late`)).raw.rows)).toEqual(['102']);
    expect(codes((await result(api, 'daily', `date=${D()}&status=absent`)).raw.rows)).toEqual(['301']);
    const sec = (await api.post(`${V1}/wings/${w.ops}/sections`).send({ name: 'Records' })).body as { id: number };
    await api.put(`${V1}/employees/${w.ali.id}`).send({ empCode: '101', name: 'Ali Raza', wingId: w.ops, sectionId: sec.id });
    expect(codes((await result(api, 'daily', `date=${D()}&sectionId=${sec.id}`)).raw.rows)).toEqual(['101']);
  });

  it('shows leave with its type, code and colour', async () => {
    const w = await world();
    const { raw, body } = await result(api, 'daily', `date=${ago(2)}`);
    expect(statusOf(raw.rows, '201')).toEqual({ code: 'CL', label: 'On leave · CL Casual', color: '#2563EB' });
    expect(raw.rows.find((r) => r.code === '201')?.note).toBe('Casual (CL)');
    expect(body.legend).toContainEqual({ code: 'CL', label: 'On leave · CL Casual', color: '#2563EB' });
    void w;
  });

  it('shows a holiday and does not count it as absent', async () => {
    await world();
    await api.post(`${V1}/holidays`).send({ name: 'Founders Day', from: ago(4), to: ago(4) });
    const { raw } = await result(api, 'daily', `date=${ago(4)}`);
    expect(statusOf(raw.rows, '301')).toMatchObject({ code: 'HD', label: 'Holiday' });
    expect(raw.rows.find((r) => r.code === '301')?.note).toBe('Founders Day');
  });
});

// ======================================================================================================================
describe('monthly register', () => {
  it('has one row per employee, a column per day with weekday groups, codes, totals and a legend', async () => {
    const w = await world();
    const month = D().slice(0, 7);
    await api.post(`${V1}/holidays`).send({ name: 'Founders Day', from: ago(4), to: ago(4) });
    const { body, raw } = await result(api, 'monthly_register', `month=${month}`);
    const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const dayCols = body.columns.filter((c) => c.kind === 'day_code');
    expect(dayCols).toHaveLength(days);
    expect(dayCols[0]).toMatchObject({ key: 'd01', label: '01' });
    expect(dayCols.every((c) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(c.group ?? ''))).toBe(true);
    expect(body.columns.slice(-7).map((c) => c.label)).toEqual(['P', 'L', 'H/M', 'A', 'Leave', 'Working days', 'Att. %']);
    expect(raw.rows).toHaveLength(4);

    const key = (date: string) => `d${date.slice(8, 10)}`;
    const cell = (code: string, date: string) => raw.rows.find((r) => r.code === code)?.[key(date)] as { code: string; label: string; color?: string } | null;
    expect(cell('101', D())).toMatchObject({ code: 'P' });
    expect(cell('102', D())).toMatchObject({ code: 'L' });
    if (ago(2).slice(0, 7) === month) expect(cell('201', ago(2))).toEqual({ code: 'CL', label: 'On leave · CL Casual', color: '#2563EB' });
    expect(cell('301', D())).toMatchObject({ code: 'A' });
    // holiday: HD; future / pending days are blank
    if (ago(4).slice(0, 7) === month) expect(cell('301', ago(4))).toMatchObject({ code: 'HD' });
    const tomorrow = addDays(todayLocal(), 1);
    if (tomorrow.slice(0, 7) === month) expect(cell('101', tomorrow)).toBeNull();

    const ali = raw.rows.find((r) => r.code === '101') as Record<string, number>;
    expect(ali.tP).toBeGreaterThanOrEqual(1);
    const cara = raw.rows.find((r) => r.code === '201') as Record<string, number>;
    expect(cara.tLeave).toBe(ago(2).slice(0, 7) === month ? 1 : 0);
    expect(raw.totals).not.toBeNull();
    expect((raw.totals as Record<string, number>)[key(D())]).toBe(3); // Ali, Bina, Cara (corrected) attended on D
    expect(body.legend.map((l) => l.code)).toEqual(expect.arrayContaining(['P', 'L', 'A', 'CL']));
    void w;
  });

  it('leaves out people who were never in service that month', async () => {
    await world();
    const emp = await mkEmp('777', 'Later Joiner');
    await pool.query(`UPDATE employees SET join_date = $1 WHERE id = $2`, [addDays(todayLocal(), 400), emp.id]);
    const { raw } = await result(api, 'monthly_register', `month=${D().slice(0, 7)}`);
    expect(codes(raw.rows)).not.toContain('777');
  });
});

// ======================================================================================================================
describe('late comers, absentees, wing summary, time card, leave, punch log', () => {
  it('late comers: each late day, highlights, minimum minutes and a per-employee second table', async () => {
    await world();
    await punch('101', ago(2), '09:45');
    await punch('101', ago(2), '17:00');
    const { body, raw } = await result(api, 'late_comers', `from=${ago(5)}&to=${ago(1)}`);
    expect(body.columns.map((c) => c.key)).toEqual(['date', 'code', 'name', 'wing', 'section', 'start', 'in', 'late']);
    expect(raw.rows.map((r) => [r.date, r.code, r.in, r.late])).toEqual([
      [D(), '102', '09:50', 50],
      [ago(2), '101', '09:45', 45],
    ]);
    const hl = Object.fromEntries(body.highlights.map((h) => [h.label, h.value]));
    expect(hl).toMatchObject({ 'Late days': '2', Employees: '2', 'Average minutes late': '47.5' });
    const summary = raw.extraTables?.find((t) => t.id === 'by_employee');
    expect(summary?.rows).toHaveLength(2);
    expect(summary?.rows[0]).toMatchObject({ lateDays: 1 });
    expect((await result(api, 'late_comers', `from=${ago(5)}&to=${ago(1)}&minLateMinutes=48`)).raw.rows.map((r) => r.code)).toEqual(['102']);
  });

  it('absentees: only unexplained absences, never leave, holiday, weekend, pending or inactive', async () => {
    await world();
    await api.post(`${V1}/holidays`).send({ name: 'Founders Day', from: ago(4), to: ago(4) });
    const { raw } = await result(api, 'absentees', `from=${ago(5)}&to=${ago(1)}`);
    const mine = raw.rows.filter((r) => r.code === '201').map((r) => r.date);
    expect(mine).not.toContain(ago(2)); // leave
    expect(mine).not.toContain(ago(4)); // holiday
    expect(mine).not.toContain(D()); // corrected to present
    expect(mine).toContain(ago(1));
    // a day that is not over yet is pending, not absent
    const today = await result(api, 'absentees', `from=${todayLocal()}&to=${todayLocal()}`);
    expect(today.raw.rows.every((r) => r.date === todayLocal())).toBe(true);
    expect(raw.rows.every((r) => String(r.date) >= ago(5) && String(r.date) <= ago(1))).toBe(true);
    expect(mine).toContain(ago(5));
    expect(raw.rows.every((r) => r.code !== '101' || r.date !== D())).toBe(true);
    const summary = raw.extraTables?.find((t) => t.id === 'by_employee');
    expect(summary?.rows.find((r) => r.code === '201')?.days).toBe(mine.length);
  });

  it('wing summary: a row per wing plus "No wing", rates and a totals row', async () => {
    await world();
    const { body, raw } = await result(api, 'wing_summary', `from=${D()}&to=${D()}`);
    expect(raw.rows.map((r) => r.wing)).toEqual(['Administration', 'Operations', 'No wing']);
    const ops = raw.rows.find((r) => r.wing === 'Operations') as Record<string, unknown>;
    expect(ops).toMatchObject({ headcount: 2, expected: 2, present: 1, late: 1, absent: 0, attendance: 100, punctuality: 50 });
    const adm = raw.rows.find((r) => r.wing === 'Administration') as Record<string, unknown>;
    expect(adm).toMatchObject({ headcount: 1, expected: 1, present: 1 }); // corrected to present
    const noWing = raw.rows.find((r) => r.wing === 'No wing') as Record<string, unknown>;
    expect(noWing).toMatchObject({ headcount: 1, absent: 1, attendance: 0 });
    expect(raw.totals).toMatchObject({ wing: 'Total', headcount: 4, expected: 4, present: 2, late: 1, absent: 1 });
    expect(body.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['headcount', 'expected', 'present', 'late', 'halfDay', 'missing', 'onLeave', 'leaveTypes', 'absent', 'attendance', 'punctuality']));
    // leave by type text
    const lv = await result(api, 'wing_summary', `from=${ago(2)}&to=${ago(2)}`);
    expect((lv.raw.rows.find((r) => r.wing === 'Administration') as Record<string, unknown>).leaveTypes).toBe('CL 1');
  });

  it('time card: every day, totals, subtitle with code, name, wing and designation', async () => {
    const w = await world();
    const { body, raw } = await result(api, 'time_card', `employeeId=${w.bina.id}&from=${ago(4)}&to=${ago(1)}`);
    expect(raw.rows).toHaveLength(4);
    expect(raw.rows.map((r) => r.date)).toEqual([ago(4), ago(3), ago(2), ago(1)]);
    expect(body.subtitle).toContain('102');
    expect(body.subtitle).toContain('Bina Khan');
    expect(body.subtitle).toContain('Operations');
    expect(body.subtitle).toContain('Officer');
    const dRow = raw.rows.find((r) => r.date === D()) as Record<string, unknown>;
    expect(dRow).toMatchObject({ in: '09:50', out: '17:00', late: 50 });
    expect(dRow.status).toMatchObject({ code: 'L', label: 'Late' });
    expect(raw.totals).toMatchObject({ late: 50 });
    expect((raw.totals as Record<string, number>).worked).toBeCloseTo(7.17, 2);
    const hl = Object.fromEntries(body.highlights.map((h) => [h.label, h.value]));
    expect(hl).toMatchObject({ 'Days late': '1', 'Days absent': '3', 'Days on leave': '0' });
    expect(zReportResult.parse(raw).type).toBe('time_card');
  });

  it('leave: leaves overlapping the period, with the type as a coloured status cell', async () => {
    const w = await world();
    await api.post(`${V1}/leaves`).send({ employeeIds: [w.ali.id], leaveTypeId: 3, from: ago(8), to: ago(6), reason: 'Surgery' });
    const { body, raw } = await result(api, 'leave', `from=${ago(7)}&to=${ago(1)}`);
    expect(raw.rows).toHaveLength(2);
    const cara = raw.rows.find((r) => r.code === '201') as Record<string, unknown>;
    expect(cara).toMatchObject({ name: 'Cara Malik', wing: 'Administration', from: ago(2), to: ago(2), part: 'Full day', days: 1, reason: 'Family matter' });
    expect(cara.type).toEqual({ code: 'CL', label: 'CL Casual', color: '#2563EB' });
    // Ali's leave started before the period: working days are counted inside it (7th and 6th = 2 days)
    const ali = raw.rows.find((r) => r.code === '101') as Record<string, unknown>;
    expect(ali).toMatchObject({ from: ago(8), to: ago(6), days: 2 });
    expect(ali.type).toMatchObject({ code: 'ML', color: '#DC2626' });
    expect(raw.totals).toMatchObject({ days: 3 });
    expect(body.highlights.map((h) => h.label)).toEqual(expect.arrayContaining(['Leave records', 'Working days', 'CL Casual', 'ML Medical']));
    expect((await result(api, 'leave', `from=${ago(7)}&to=${ago(1)}&leaveTypeId=1`)).raw.rows).toHaveLength(1);
    expect((await result(api, 'leave', `from=${ago(7)}&to=${ago(1)}&wingId=${w.ops}`)).raw.rows).toHaveLength(1);
  });

  it('punch log: raw punches oldest first with method and device, paged on screen', async () => {
    await world();
    await punch('101', D(), '12:00', 15); // face
    await punch('101', D(), '12:30', 2); // card
    const { body, raw } = await result(api, 'punch_log', `from=${D()}&to=${D()}&pageSize=3`);
    expect(body.total).toBe(6);
    expect(raw.rows).toHaveLength(3);
    expect(raw.rows[0]).toMatchObject({ date: D(), time: '09:05:00', code: '101', name: 'Ali Raza', wing: 'Operations', type: 'Check-in', method: 'Fingerprint', device: 'Main gate' });
    const all = await result(api, 'punch_log', `from=${D()}&to=${D()}&pageSize=100`);
    expect(all.raw.rows.map((r) => r.time)).toEqual([...all.raw.rows.map((r) => String(r.time))].sort());
    expect(all.raw.rows.map((r) => r.method)).toEqual(expect.arrayContaining(['Face', 'Card', 'Fingerprint']));
    expect((await result(api, 'punch_log', `from=${D()}&to=${D()}&employeeId=${(await empId('102'))}`)).body.total).toBe(2);
  });
});
const empId = async (code: string) => (await pool.query<{ id: number }>('SELECT id FROM employees WHERE emp_code = $1', [code])).rows[0]?.id;

// ======================================================================================================================
describe('exports', () => {
  it('xlsx: NACTA header block, green header row, freeze, autofilter, status fills, totals and print setup', async () => {
    const w = await world();
    const res = await download(api, 'wing_summary', 'xlsx', `from=${D()}&to=${D()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="NACTA-Wing-Summary-All-Wings-${D()}_to_${D()}.xlsx"`);
    const ws = await sheetOf(res.body);
    expect(textOf(ws.getCell('B1'))).toBe('National Counter Terrorism Authority');
    expect(textOf(ws.getCell('B2'))).toBe('Wing Summary Report');
    expect(ws.getCell('B2').font?.bold).toBe(true);
    expect(textOf(ws.getCell('B3'))).toContain('· All Wings');
    expect(textOf(ws.getCell('B4'))).toContain('Wing: All Wings');
    expect(textOf(ws.getCell('B5'))).toMatch(/^Generated by Test Admin on \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
    expect(ws.getImages().length).toBe(1);

    const h = headerRowOf(ws, 'Wing');
    expect(h).toBe(8); // header block 5 rows, highlights row, blank row, then the table header
    expect(textOf(ws.getCell(7, 1))).toBe(''); // the blank row
    const head = ws.getCell(h, 1);
    expect(head.fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FF065F46' } });
    expect(head.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: h });
    expect(JSON.stringify(ws.autoFilter)).toContain(String(h));
    expect(ws.pageSetup).toMatchObject({ orientation: 'landscape', paperSize: 9, fitToWidth: 1, fitToHeight: 0 });
    expect(ws.pageSetup.printTitlesRow).toBe(`${h}:${h}`);
    expect(ws.headerFooter.oddFooter).toContain('Page &P of &N | NACTA Attendance | Confidential');

    // body rows and totals row
    expect(textOf(ws.getCell(h + 1, 1))).toBe('Administration');
    const total = ws.getRow(h + 4); // Administration, Operations, No wing, then Total
    expect(textOf(total.getCell(1))).toBe('Total');
    expect(total.getCell(1).font?.bold).toBe(true);
    expect(total.getCell(1).border?.top?.style).toBe('medium');
    expect(total.getCell(2).value).toBe(4);
    // percent cells are real percentages
    expect(ws.getCell(h + 2, 11).value).toBeCloseTo(1, 5);
    expect(ws.getCell(h + 2, 11).numFmt).toBe('0.0%');
    void w;
  });

  it('xlsx daily: coloured status cells, real dates and times, leave with its type colour', async () => {
    const w = await world();
    const res = await download(api, 'daily', 'xlsx', `date=${ago(2)}`);
    const ws = await sheetOf(res.body);
    const h = headerRowOf(ws, 'Code');
    expect([textOf(ws.getCell(h, 6)), textOf(ws.getCell(h, 13))]).toEqual(['Status', 'Corrected']);
    // find Cara (201) on leave: blue tint fill, dark blue text
    let caraRow = 0;
    ws.eachRow((row, n) => {
      if (n > h && textOf(row.getCell(1)) === '201') caraRow = n;
    });
    const st = ws.getCell(caraRow, 6);
    expect(textOf(st)).toBe('On leave · CL Casual');
    expect(st.fill).toMatchObject({ fgColor: { argb: `FF${tint('#2563EB')}` } }); // a light tint of the leave type colour
    expect(st.font?.color?.argb).toBe(`FF${ink('#2563EB')}`);
    expect(st.font?.bold).toBe(true);
    // an absent person: red tint
    let danRow = 0;
    ws.eachRow((row, n) => {
      if (n > h && textOf(row.getCell(1)) === '301') danRow = n;
    });
    const abs = ws.getCell(danRow, 6);
    expect(textOf(abs)).toBe('Absent');
    expect((abs.fill as ExcelJS.FillPattern).fgColor?.argb).not.toBe((st.fill as ExcelJS.FillPattern).fgColor?.argb);
    void w;

    // times are real Excel times, hours are numbers
    const res2 = await download(api, 'daily', 'xlsx', `date=${D()}`);
    const ws2 = await sheetOf(res2.body);
    const h2 = headerRowOf(ws2, 'Code');
    let aliRow = 0;
    ws2.eachRow((row, n) => {
      if (n > h2 && textOf(row.getCell(1)) === '101') aliRow = n;
    });
    const tv = ws2.getCell(aliRow, 7).value as Date; // a real Excel time (read back as a Date on 1899-12-30)
    expect(tv instanceof Date && tv.getUTCHours() * 60 + tv.getUTCMinutes()).toBe(9 * 60 + 5);
    expect(ws2.getCell(aliRow, 7).numFmt).toBe('hh:mm');
    // worked hours are an Excel duration (days) formatted [h]:mm: 8.08 h = 8:05
    const wv = ws2.getCell(aliRow, 9).value as Date | number; // exceljs reads durations back as a Date on 1899-12-30
    const workedDays = wv instanceof Date ? (wv.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000 : Number(wv);
    expect(workedDays * 24).toBeCloseTo(8.08, 2);
    expect(ws2.getCell(aliRow, 9).numFmt).toBe('[h]:mm');
  });

  it('xlsx: dates are real Excel dates (late comers) and the per-employee table is its own sheet', async () => {
    await world();
    const res = await download(api, 'late_comers', 'xlsx', `from=${ago(5)}&to=${ago(1)}`);
    const ws = await sheetOf(res.body);
    const h = headerRowOf(ws, 'Date');
    const v = ws.getCell(h + 1, 1).value;
    expect(v instanceof Date).toBe(true);
    expect((v as Date).toISOString().slice(0, 10)).toBe(D());
    expect(ws.getCell(h + 1, 1).numFmt).toBe('dd mmm yyyy');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Late Comers', 'Summary by employee']);
    expect(textOf(wb.worksheets[1]!.getCell('B2'))).toBe('Late Comers Report – Summary by employee');
  });

  it('xlsx monthly register: weekday row above the day numbers, narrow day columns, shaded weekends, legend', async () => {
    const w = await world();
    // make Saturdays and Sundays weekends again for this test
    await pool.query('UPDATE timing_profile_versions SET days = $1::jsonb', [
      JSON.stringify([null, ...Array.from({ length: 5 }, () => ({ start: '09:00', end: '17:00' })), null]),
    ]);
    const month = D().slice(0, 7);
    const res = await download(api, 'monthly_register', 'xlsx', `month=${month}`);
    const ws = await sheetOf(res.body);
    const h = headerRowOf(ws, 'Code');
    const groupRow = h - 1;
    const dayCol = 4; // code, name, wing, then d01
    expect(textOf(ws.getCell(h, dayCol))).toBe('01');
    expect(textOf(ws.getCell(groupRow, dayCol))).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    expect(ws.getColumn(dayCol).width).toBeLessThan(6);
    expect(ws.views[0]).toMatchObject({ ySplit: h });
    expect(ws.pageSetup.printTitlesRow).toBe(`${groupRow}:${h}`);
    // find a weekend column: its header is slate, not NACTA green
    let weekendCol = 0;
    for (let c = dayCol; c < dayCol + 28; c++) {
      if (/^(Sat|Sun)$/.test(textOf(ws.getCell(groupRow, c)))) {
        weekendCol = c;
        break;
      }
    }
    expect(weekendCol).toBeGreaterThan(0);
    expect((ws.getCell(h, weekendCol).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF475569');
    // legend below the table
    let legendRow = 0;
    ws.eachRow((row, n) => {
      if (textOf(row.getCell(1)) === 'Legend') legendRow = n;
    });
    expect(legendRow).toBeGreaterThan(h + 4);
    const legendTexts: string[] = [];
    for (let r = legendRow + 1; r < legendRow + 8; r++) legendTexts.push(textOf(ws.getCell(r, 2)));
    expect(legendTexts).toContain('Weekend');
    void w;
  });

  it('pdf: a real PDF with a sane size, for every report', async () => {
    const w = await world();
    for (const type of REPORT_TYPE_KEYS as ReportType[]) {
      const q = type === 'time_card' ? `employeeId=${w.ali.id}&from=${ago(5)}&to=${ago(1)}` : `date=${D()}&month=${D().slice(0, 7)}&from=${ago(5)}&to=${ago(1)}`;
      const res = await download(api, type, 'pdf', q);
      expect(res.status, type).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="NACTA-[A-Za-z0-9_-]+\.pdf"$/);
      const buf = res.body as Buffer;
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(5_000);
      expect(buf.length).toBeLessThan(5_000_000);
      expect(buf.subarray(-8).toString('latin1')).toContain('%%EOF');
    }
  });

  it('file names are ASCII-safe and follow NACTA-<report>-<scope>-<period>', async () => {
    const w = await world();
    const month = D().slice(0, 7);
    const res = await download(api, 'monthly_register', 'xlsx', `month=${month}&wingId=${w.ops}`);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="NACTA-Monthly-Register-Operations-${month}.xlsx"`);
    const tc = await download(api, 'time_card', 'pdf', `employeeId=${w.ali.id}&from=${ago(5)}&to=${ago(1)}`);
    expect(tc.headers['content-disposition']).toBe(`attachment; filename="NACTA-Time-Card-101-Ali-Raza-${ago(5)}_to_${ago(1)}.pdf"`);
    await pool.query(`UPDATE wings SET name = $1 WHERE id = $2`, ['Opérations اردو / Wing', w.ops]);
    const odd = await download(api, 'daily', 'xlsx', `date=${D()}&wingId=${w.ops}`);
    expect(odd.headers['content-disposition']).toMatch(/^attachment; filename="NACTA-Daily-Attendance-[\x20-\x7E]+\.xlsx"$/);
    expect(odd.headers['content-disposition']).not.toMatch(/[^\x20-\x7E]/);
  });

  it('every export is audited as attendance.export with type, format, filters, row count and file name', async () => {
    const w = await world();
    const base = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM audit_logs')).rows[0].m);
    const res = await download(api, 'daily', 'xlsx', `date=${D()}&wingId=${w.ops}`);
    expect(res.status).toBe(200);
    await download(api, 'late_comers', 'pdf', `from=${ago(5)}&to=${ago(1)}&minLateMinutes=10`);
    await flushAudit();
    const { rows } = await pool.query<{ summary: string; entity_label: string; entity_type: string; metadata: Record<string, unknown>; outcome: string }>(
      `SELECT summary, entity_label, entity_type, metadata, outcome FROM audit_logs WHERE action = 'attendance.export' AND id > $1 ORDER BY id`,
      [base],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entity_type: 'export', outcome: 'success', entity_label: String(res.headers['content-disposition']).match(/filename="(.+)"/)?.[1] });
    expect(rows[0]!.summary).toContain('Daily Attendance Report');
    expect(rows[0]!.metadata).toEqual({
      type: 'daily',
      format: 'xlsx',
      filters: { date: D(), wingId: w.ops },
      rowCount: 2,
      fileName: `NACTA-Daily-Attendance-Operations-${D()}.xlsx`,
    });
    expect(rows[1]!.metadata).toMatchObject({ type: 'late_comers', format: 'pdf', rowCount: 1, filters: { from: ago(5), to: ago(1), minLateMinutes: 10 } });
  });

  it('no attendance.export: 403 and nothing is exported or audited as an export', async () => {
    const w = await world();
    await mkUsers(w);
    const base = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM audit_logs')).rows[0].m);
    const res = await viewer.get(`${V1}/reports/daily/export?format=pdf`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await flushAudit();
    const n = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'attendance.export' AND id > $1`, [base]);
    expect(n.rowCount).toBe(0);
  });

  it('exports are wing-scoped too', async () => {
    const w = await world();
    const limited = await userClient({ permissions: ['attendance.view', 'attendance.export', ...REPORT_PERMISSIONS], wings: [w.ops] });
    const res = await download(limited, 'daily', 'xlsx', `date=${D()}`);
    const text = (await rowsText(res.body)).join('|');
    expect(text).toContain('Ali Raza');
    expect(text).not.toContain('Cara Malik');
    expect(text).not.toContain('Dan Iqbal');
    expect(text).not.toContain('Administration');
  });
});

const rawGet = async (p: string) => (await import('supertest')).default((await import('../src/app')).createApiApp()).get(`${V1}${p}`);

// ======================================================================================================================
describe('dashboard', () => {
  it('returns the full shape for today, scoped, with a 30 day trend, top late, live feed, devices and leave', async () => {
    const w = await world();
    await mkUsers(w);
    const today = todayLocal();
    // today: Ali on time, Bina late; Cara on leave today
    await punch('101', today, '00:01');
    await punch('102', today, '00:02');
    await punch('9999', today, '00:03');
    await api.post(`${V1}/leaves`).send({ employeeIds: [w.cara.id], leaveTypeId: 5, from: today, to: today });
    await punch('102', ago(1), '09:40');
    await punch('102', ago(1), '17:00');

    const t0 = Date.now();
    const res = await api.get(`${V1}/dashboard`);
    const ms = Date.now() - t0;
    expect(res.status).toBe(200);
    const d = zDashboard.parse(res.body);
    expect(ms).toBeLessThan(2000);
    expect(d.date).toBe(today);
    expect(d.headcount).toBe(4);
    expect(d.today.leave).toBe(1);
    expect(Object.keys(d.today)).toEqual(expect.arrayContaining(['present', 'late', 'absent', 'leave', 'pending', 'holiday', 'weekend', 'inactive']));
    expect(Object.values(d.today).reduce((a, b) => a + b, 0)).toBe(4);
    expect(d.byWing.map((x) => x.wingName)).toEqual(['Administration', 'Operations', 'No wing']);
    const adm = d.byWing.find((x) => x.wingName === 'Administration');
    expect(adm).toMatchObject({ headcount: 1, onLeave: 1 });
    expect(d.byWing.find((x) => x.wingName === 'No wing')?.wingId).toBeNull();

    expect(d.trend).toHaveLength(30);
    expect(d.trend[29]!.date).toBe(today);
    expect(d.trend[0]!.date).toBe(ago(29));
    expect(d.trend.every((x) => x.workingDay)).toBe(true); // every weekday works in the fixtures
    const dDay = d.trend.find((x) => x.date === D())!;
    expect(dDay).toMatchObject({ present: 2, late: 1, absent: 1, onLeave: 0 }); // Cara counted present by her correction... see below
    expect(dDay.attendanceRate).toBeCloseTo(75, 1);
    expect(dDay.punctualityRate).toBeCloseTo(66.7, 1);
    expect(d.trend.find((x) => x.date === ago(29))!.workingDay).toBe(true);

    expect(d.topLate[0]).toMatchObject({ empCode: '102', name: 'Bina Khan', wingName: 'Operations', lateDays: 2, avgLateMinutes: 45 });
    expect(d.topLate.length).toBeLessThanOrEqual(8);

    expect(d.liveFeed.length).toBeLessThanOrEqual(15);
    expect(d.liveFeed.map((x) => x.empCode)).toEqual(['9999', '102', '101']); // newest first
    expect(d.liveFeed[0]).toMatchObject({ employeeId: null, name: null, hasPhoto: false, deviceName: 'Main gate', verifyType: 1 });
    expect(d.liveFeed[1]).toMatchObject({ name: 'Bina Khan', wingName: 'Operations', time: `${today} 00:02:00` });

    expect(d.devices).toEqual([expect.objectContaining({ name: 'Main gate', status: expect.any(String) })]);
    expect(d.onLeaveToday).toEqual([expect.objectContaining({ empCode: '201', typeName: 'Official duty', code: 'OD', color: '#059669' })]);
  });

  it('is wing-scoped: a limited user sees only their wing everywhere, with no unknown punches', async () => {
    const w = await world();
    await mkUsers(w);
    const today = todayLocal();
    await punch('101', today, '00:01');
    await punch('201', today, '00:02');
    await punch('9999', today, '00:03');
    await api.post(`${V1}/leaves`).send({ employeeIds: [w.cara.id], leaveTypeId: 5, from: today, to: today });
    const res = await viewer.get(`${V1}/dashboard`);
    expect(res.status).toBe(200);
    const d = zDashboard.parse(res.body);
    expect(d.headcount).toBe(2);
    expect(d.byWing.map((x) => x.wingName)).toEqual(['Operations']);
    expect(d.liveFeed.map((x) => x.empCode)).toEqual(['101']);
    expect(d.onLeaveToday).toEqual([]);
    expect(d.topLate.every((x) => x.wingName === 'Operations')).toBe(true);
    expect(JSON.stringify(d)).not.toContain('Cara');
    expect(JSON.stringify(d).toLowerCase()).not.toContain('corrected');
    const sa = zDashboard.parse((await api.get(`${V1}/dashboard`)).body);
    expect(sa.headcount).toBe(4);
  });

  it('?wingId= narrows everything inside the caller\'s scope; daily q and punch_log sectionId/q work; helper fields are present', async () => {
    const w = await world();
    await mkUsers(w);
    const today = todayLocal();
    await punch('101', today, '00:01');
    await punch('201', today, '00:02');
    const one = zDashboard.parse((await api.get(`${V1}/dashboard?wingId=${w.adm}`)).body);
    expect(one.headcount).toBe(1);
    expect(one.byWing.map((x) => x.wingName)).toEqual(['Administration']);
    expect(one.liveFeed.map((x) => x.empCode)).toEqual(['201']);
    expect(zDashboard.parse((await viewer.get(`${V1}/dashboard?wingId=${w.adm}`)).body).headcount).toBe(0); // outside the scope
    expect((await api.get(`${V1}/dashboard?wingId=99999999999`)).status).toBe(400);

    const d = await result(api, 'daily', `date=${D()}&q=bina`);
    expect(codes(d.raw.rows)).toEqual(['102']);
    expect(d.raw.rows[0]).toMatchObject({ employeeId: w.bina.id, hasPhoto: false });
    const pl = await result(api, 'punch_log', `from=${D()}&to=${D()}&q=ali`);
    expect(new Set(codes(pl.raw.rows))).toEqual(new Set(['101']));
    expect(pl.raw.rows[0]).toMatchObject({ employeeId: w.ali.id, hasPhoto: false });
    const sec = (await api.post(`${V1}/wings/${w.ops}/sections`).send({ name: 'Records' })).body as { id: number };
    await api.put(`${V1}/employees/${w.ali.id}`).send({ empCode: '101', name: 'Ali Raza', wingId: w.ops, sectionId: sec.id });
    expect(new Set(codes((await result(api, 'punch_log', `from=${D()}&to=${D()}&sectionId=${sec.id}`)).raw.rows))).toEqual(new Set(['101']));
    const lc = await result(api, 'late_comers', `from=${ago(5)}&to=${ago(1)}`);
    expect(lc.body.highlights.some((h) => h.label === 'Bina Khan' && /1 day, avg 50 min/.test(h.value))).toBe(true);
  });

  it('an empty system still answers with a complete dashboard', async () => {
    const res = await api.get(`${V1}/dashboard`);
    expect(res.status).toBe(200);
    const d = zDashboard.parse(res.body);
    expect(d.headcount).toBe(0);
    expect(d.trend).toHaveLength(30);
    expect(d.trend.every((x) => !x.workingDay)).toBe(true);
    expect(d.byWing).toEqual([]);
    expect(d.liveFeed).toEqual([]);
  });

  it('answers quickly once the days are cached (timing sanity on a larger roster)', async () => {
    await allDaysWorking();
    const ops = (await mkWing('Operations')).id;
    await pool.query(
      `INSERT INTO employees (emp_code, name, wing_id, join_date) SELECT 'E' || g, 'Employee ' || g, $1, current_date - 90 FROM generate_series(1, 400) g`,
      [ops],
    );
    await api.get(`${V1}/dashboard`); // computes and caches 30 days x 400 employees
    const t0 = Date.now();
    const res = await api.get(`${V1}/dashboard`);
    const ms = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(zDashboard.parse(res.body).headcount).toBe(400);
    expect(ms).toBeLessThan(800);
  });
});

// ======================================================================================================================
// Not a test of behaviour: with NACTA_SAMPLE_DIR set, writes one sample of every export from the fixtures (the live
// database has no leave records, so the leave sample comes from here).
describe.runIf(process.env.NACTA_SAMPLE_DIR)('sample files', () => {
  it('writes samples', async () => {
    const dir = process.env.NACTA_SAMPLE_DIR as string;
    fs.mkdirSync(dir, { recursive: true });
    const w = await world();
    await api.post(`${V1}/leaves`).send({ employeeIds: [w.ali.id], leaveTypeId: 3, from: ago(8), to: ago(6), reason: 'Surgery and recovery' });
    await api.post(`${V1}/leaves`).send({ employeeIds: [w.bina.id], leaveTypeId: 5, from: ago(1), to: ago(1), reason: 'Training at the Staff College' });
    await api.post(`${V1}/holidays`).send({ name: 'Founders Day', from: ago(4), to: ago(4) });
    await pool.query('UPDATE timing_profile_versions SET days = $1::jsonb', [JSON.stringify([null, ...Array.from({ length: 5 }, () => ({ start: '09:00', end: '17:00' })), null])]);
    const gen = { name: 'Test Admin', at: new Date() };
    const ctx = { scope: 'all' as const, isSuperAdmin: true };
    for (const [type, q] of [
      ['leave', { from: ago(10), to: todayLocal() }],
      ['monthly_register', { month: D().slice(0, 7) }],
    ] as const) {
      const data = await buildReport(type, resolveParams(type, q), ctx, false);
      fs.writeFileSync(path.join(dir, `fixture-${type}.xlsx`), await buildXlsx(data, gen));
      fs.writeFileSync(path.join(dir, `fixture-${type}.pdf`), await buildPdf(data, gen));
    }
  });
});

describe('export attendance report', () => {
  it('first in and last out per employee per day, with corrections, by wing or one person', async () => {
    const w = await world();
    await mkUsers(w);
    // Bina forgot to punch out the day before D: a correction adds it
    await punch('102', ago(4), '09:00');
    const fix = await api.post(`${V1}/attendance/corrections`).send({ employeeId: w.bina.id, date: ago(4), type: 'add_punch', time: '17:30', reason: 'Forgot to punch out' });
    expect(fix.status).toBe(201);

    const { body, raw } = await result(api, 'attendance_export', `from=${ago(4)}&to=${D()}&wingId=${w.ops}`);
    expect(body.columns.map((c) => c.key)).toEqual(['code', 'name', 'designation', 'wing', 'date', 'weekday', 'in', 'out', 'remark', 'corrected']);
    // two people x two days, grouped by person
    expect(raw.rows.map((r) => `${r.code} ${r.date}`)).toEqual([`101 ${ago(4)}`, `101 ${D()}`, `102 ${ago(4)}`, `102 ${D()}`]);
    const row = (code: string, date: string) => raw.rows.find((r) => r.code === code && r.date === date) as Record<string, unknown>;
    expect(row('101', D())).toMatchObject({ in: '09:05', out: '17:10', remark: null });
    expect(row('102', ago(4))).toMatchObject({ in: '09:00', out: '17:30', corrected: 'Yes' }); // the corrected out time
    expect(row('101', ago(4))).toMatchObject({ in: null, out: null, remark: 'Absent' });

    // one person, across wings; the corrected marker is for the Super Admin only
    const one = await result(exporter, 'attendance_export', `from=${ago(4)}&to=${D()}&employeeId=${w.bina.id}`);
    expect(one.raw.rows.map((r) => r.code)).toEqual(['102', '102']);
    expect(one.body.columns.map((c) => c.key)).not.toContain('corrected');
    expect(one.raw.rows[0]).toMatchObject({ out: '17:30' });
    expect(one.raw.rows[0]).not.toHaveProperty('corrected');
    expect(one.body.subtitle).toContain('102 Bina Khan');

    // a wing-limited user cannot pick someone outside their wings
    expect((await get(viewer, 'attendance_export', `from=${ago(4)}&to=${D()}&employeeId=${w.cara.id}`)).status).toBe(404); // not revealed

    const xlsx = await download(exporter, 'attendance_export', 'xlsx', `from=${ago(4)}&to=${D()}&wingId=${w.ops}`);
    expect(xlsx.status).toBe(200);
    expect(String(xlsx.headers['content-disposition'])).toContain('Attendance-Export');
  });
});

describe('simple dashboard', () => {
  it('any signed-in user gets today\'s four numbers for their own wings', async () => {
    const w = await world();
    await punch('101', todayLocal(), '09:01');
    const none = await userClient({ permissions: [], wings: [w.ops] });
    expect((await none.get(`${V1}/dashboard`)).status).toBe(403);
    const res = await none.get(`${V1}/dashboard/today`);
    expect(res.status).toBe(200);
    const s = zTodaySummary.parse(res.body);
    expect(s).toMatchObject({ date: todayLocal(), total: 2, present: 1, onLeave: 0, notRecorded: 1, dayOff: 0 });
    const all = zTodaySummary.parse((await api.get(`${V1}/dashboard/today`)).body);
    expect(all.total).toBe(4);
    expect(all.present + all.onLeave + all.notRecorded + all.dayOff).toBe(all.total);
    expect((await rawGet('/dashboard/today')).status).toBe(401);
  });
});

describe('report-only roles', () => {
  it('can fill in the report filters but never see personal employee data', async () => {
    const w = await world();
    await api.put(`${V1}/employees/${w.ali.id}`).send({ phone: '0300-1234567', address: 'House 1' });
    const u = await userClient({ permissions: ['reports.attendance_export'], wings: 'all' });
    expect((await u.get(`${V1}/wings`)).status).toBe(200);
    const list = await u.get(`${V1}/employees?q=Ali`);
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ empCode: '101', name: 'Ali Raza', designation: 'Analyst', phone: null, address: null, cnic: null, devicePassword: null });
    expect((await u.get(`${V1}/employees/${w.ali.id}`)).status).toBe(403); // the full profile stays employees.view
    const full = await api.get(`${V1}/employees?q=Ali`);
    expect(full.body.items[0]).toMatchObject({ phone: '0300-1234567' });
  });
});

describe('migration 009', () => {
  it('roles that could open the reports keep every report; others get none', async () => {
    const viewerRole = await api.post(`${V1}/roles`).send({ name: 'Viewers', permissions: ['attendance.view'], allWings: true, wingIds: [] });
    const otherRole = await api.post(`${V1}/roles`).send({ name: 'Devices only', permissions: ['devices.view'], allWings: true, wingIds: [] });
    expect([viewerRole.status, otherRole.status]).toEqual([201, 201]);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '009_report_permissions.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql); // idempotent
    const perms = async (id: number) =>
      (await pool.query<{ permission: string }>('SELECT permission FROM role_permissions WHERE role_id = $1 ORDER BY permission', [id])).rows.map((r) => r.permission);
    expect(await perms(viewerRole.body.id)).toEqual(['attendance.view', ...[...REPORT_PERMISSIONS].sort()]);
    expect(await perms(otherRole.body.id)).toEqual(['devices.view']);
  });
});
