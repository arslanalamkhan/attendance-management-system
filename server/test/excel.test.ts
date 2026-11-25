import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { EMPLOYEE_EXCEL_COLUMNS, zEmployeeImportResult, zImportPreview } from '@nacta/shared';
import { adms, api, closeDb, createDevice, pool, resetDb, userClient, V1, type Client } from './helpers';
import { __expireImportToken } from '../src/modules/employees/import';
import { flushAudit } from '../src/modules/audit/service';

beforeEach(resetDb);
afterAll(closeDb);

type Caller = Pick<Client, 'get' | 'post'>;

const mkWing = async (name: string, code?: string) => (await api.post(`${V1}/wings`).send({ name, code })).body as { id: number };
const mkSection = async (wingId: number, name: string) => (await api.post(`${V1}/wings/${wingId}/sections`).send({ name })).body as { id: number };
async function mkEmp(over: Record<string, unknown>) {
  const res = await api.post(`${V1}/employees`).send({ name: 'X', ...over });
  if (res.status !== 201) throw new Error(`mkEmp: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number };
}
const holdOnDevice = (sn: string, ...pins: string[]) =>
  adms.post(`/iclock/cdata?SN=${sn}&table=OPERLOG`).send(pins.map((p) => `USER PIN=${p}\tName=Dev ${p}\tPri=0\tPasswd=\tCard=\tGrp=1`).join('\n'));

async function download(c: Caller, qs = ''): Promise<{ status: number; buf: Buffer; headers: Record<string, string> }> {
  const res = await c
    .get(`${V1}/employees/export.xlsx${qs}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (d: Buffer) => chunks.push(d));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  return { status: res.status, buf: res.body as Buffer, headers: res.headers as Record<string, string> };
}
const load = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
};
const colOf = (ws: ExcelJS.Worksheet, header: string): number => {
  let found = 0;
  ws.getRow(1).eachCell((cell, n) => {
    if (cell.value === header) found = n;
  });
  if (!found) throw new Error(`no column ${header}`);
  return found;
};
const rowOf = (ws: ExcelJS.Worksheet, code: string): number => {
  const c = colOf(ws, 'Employee Code');
  for (let r = 2; r <= ws.rowCount; r++) if (String(ws.getCell(r, c).value) === code) return r;
  throw new Error(`no row ${code}`);
};
const set = (ws: ExcelJS.Worksheet, code: string, header: string, value: ExcelJS.CellValue) => {
  ws.getCell(rowOf(ws, code), colOf(ws, header)).value = value;
};
const addRow = (ws: ExcelJS.Worksheet, values: Record<string, ExcelJS.CellValue>): number => {
  const r = Math.max(ws.rowCount, 1) + 1;
  for (const [h, v] of Object.entries(values)) ws.getCell(r, colOf(ws, h)).value = v;
  return r;
};
const toBuf = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());
const preview = (c: Caller, buf: Buffer, name = 'employees.xlsx') => c.post(`${V1}/employees/import/preview`).attach('file', buf, name);
const commit = (c: Caller, token: string, createMissing = false) => c.post(`${V1}/employees/import/commit`).send({ token, createMissing });

/** Wings Ops (OPS, section Billing) and Admin; four employees; 1 and 2 are on a device. */
async function seed() {
  const ops = await mkWing('Operations', 'OPS');
  const admin = await mkWing('Admin');
  const billing = await mkSection(ops.id, 'Billing');
  const dev = await createDevice('XL-A', 'Gate');
  const e1 = await mkEmp({ empCode: '1', name: 'Ali', wingId: ops.id, sectionId: billing.id, designation: 'Clerk', bps: 9, joinDate: '2020-05-17', cnic: '3520211111111' });
  const e2 = await mkEmp({ empCode: '2', name: 'Bina', wingId: ops.id, designation: 'Typist' });
  const e3 = await mkEmp({ empCode: '3', name: 'Chand', wingId: admin.id, designation: 'Driver', phone: '0300' });
  const e4 = await mkEmp({ empCode: '0044', name: 'Dara' });
  await holdOnDevice('XL-A', '1', '2');
  return { ops, admin, billing, dev, e1, e2, e3, e4 };
}

describe('Excel export', () => {
  it('builds the formatted workbook: headers, validations, formats, lists, instructions', async () => {
    const { ops } = await seed();
    const out = await download(api);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(out.headers['content-disposition']).toMatch(/^attachment; filename="NACTA-Employees-\d{8}-\d{4}\.xlsx"$/);

    const wb = await load(out.buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Employees', 'Lists', 'Instructions']);
    const ws = wb.getWorksheet('Employees')!;
    const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1);
    expect(headers).toEqual(EMPLOYEE_EXCEL_COLUMNS.map((c) => c.header));
    const h = ws.getCell('A1');
    expect(h.font?.bold).toBe(true);
    expect((h.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF0B5D3B');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getColumn(1).width).toBeGreaterThan(8);

    // values: code and CNIC are text, join date is a real date, device password never exported
    const r1 = rowOf(ws, '1');
    expect(ws.getCell(r1, colOf(ws, 'Employee Code')).value).toBe('1');
    expect(ws.getCell(r1, colOf(ws, 'Employee Code')).numFmt).toBe('@');
    expect(ws.getCell(r1, colOf(ws, 'CNIC')).value).toBe('35202-1111111-1');
    expect(ws.getCell(r1, colOf(ws, 'CNIC')).numFmt).toBe('@');
    const jd = ws.getCell(r1, colOf(ws, 'Join Date')).value as Date;
    expect(jd).toBeInstanceOf(Date);
    expect(jd.toISOString().slice(0, 10)).toBe('2020-05-17');
    expect(ws.getCell(r1, colOf(ws, 'Wing')).value).toBe('Operations');
    expect(ws.getCell(r1, colOf(ws, 'Section')).value).toBe('Billing');
    expect(ws.getCell(r1, colOf(ws, 'Status')).value).toBe('Active');
    expect(ws.getCell(r1, colOf(ws, 'Device Role')).value).toBe('User');
    expect(String(ws.getCell(rowOf(ws, '0044'), 1).value)).toBe('0044'); // leading zeros survive
    expect(JSON.stringify(headers)).not.toMatch(/password/i);

    // dropdowns and BPS rule
    const dv = (header: string) => ws.getCell(2, colOf(ws, header)).dataValidation;
    expect(dv('Gender')).toMatchObject({ type: 'list', formulae: ['"Male,Female"'] });
    expect(dv('Employment Type')).toMatchObject({ type: 'list', formulae: ['"Regular,Contract,Deputation,Daily wages,Internship"'] });
    expect(dv('Status')).toMatchObject({ type: 'list', formulae: ['"Active,Disabled,Left"'] });
    expect(dv('Device Role')).toMatchObject({ type: 'list', formulae: ['"User,Admin"'] });
    expect(dv('Wing')).toMatchObject({ type: 'list', formulae: ['Lists!$A$2:$A$3'] });
    expect(dv('Section')).toMatchObject({ type: 'list', formulae: ['Lists!$G$2:$G$2'] });
    expect(dv('BPS')).toMatchObject({ type: 'whole', operator: 'between', formulae: [1, 22] });
    expect(ws.getCell(1500, colOf(ws, 'Wing')).dataValidation).toBeTruthy(); // room to add rows below

    const lists = wb.getWorksheet('Lists')!;
    expect(lists.getCell('A2').value).toBe('Admin');
    expect([lists.getCell('A3').value, lists.getCell('B3').value]).toEqual(['Operations', 'OPS']);
    expect([lists.getCell('D2').value, lists.getCell('E2').value]).toEqual(['Billing', 'Operations']);
    const text = JSON.stringify(wb.getWorksheet('Instructions')!.getSheetValues());
    expect(text).toMatch(/blank cell clears/i);
    expect(text).toMatch(/do not change Employee Code/i);
    expect(text).toMatch(/Disabled: removed from every device/);

    // the wing filter narrows the export; the export is audited with filters and row count
    const filtered = await load((await download(api, `?wingId=${ops.id}`)).buf);
    expect(filtered.getWorksheet('Employees')!.rowCount).toBe(3);
    await flushAudit();
    const rows = await pool.query(`SELECT summary, metadata FROM audit_logs WHERE action = 'employee.export' ORDER BY id DESC LIMIT 1`);
    expect(rows.rows[0].metadata).toMatchObject({ rows: 2, filters: { wingId: ops.id }, includesCnic: true });
  });

  it('leaves the CNIC column out without employees.manage; needs employees.import', async () => {
    await seed();
    const c = await userClient({ permissions: ['employees.view', 'employees.import'] });
    const out = await download(c);
    expect(out.status).toBe(200);
    const ws = (await load(out.buf)).getWorksheet('Employees')!;
    const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1);
    expect(headers).not.toContain('CNIC');
    expect(headers).toHaveLength(EMPLOYEE_EXCEL_COLUMNS.length - 1);
    expect((await download(await userClient({ permissions: ['employees.view', 'employees.manage'] }))).status).toBe(403);
  });
});

describe('Excel import: preview and commit', () => {
  it('round trip: edit, preview counts and diffs, commit, database and device commands', async () => {
    const { ops, admin, e1, e2, e3 } = await seed();
    const wb = await load((await download(api)).buf);
    const ws = wb.getWorksheet('Employees')!;
    set(ws, '1', 'Name', 'Ali Raza'); // on a device -> update_profile
    set(ws, '1', 'Wing', 'Admin'); // the wing changes...
    set(ws, '1', 'Section', null); // ...so the old section is cleared (a stale one would be flagged as unknown)
    set(ws, '2', 'Status', 'Disabled'); // on a device -> remove
    set(ws, '2', 'Status Reason', 'Absconding');
    set(ws, '3', 'Designation', null); // blank clears
    addRow(ws, { 'Employee Code': '9', Name: 'New Person', Wing: 'ops', Gender: 'Female', BPS: 5, 'Employment Type': 'Contract', 'Join Date': new Date(Date.UTC(2026, 0, 5)), CNIC: '3520299999999' });
    addRow(ws, { 'Employee Code': '4', Name: 'Bad Bps', BPS: 99 });
    addRow(ws, { 'Employee Code': '8', Name: 'Dup A' });
    addRow(ws, { 'Employee Code': '8', Name: 'Dup B' });
    const buf = await toBuf(wb);

    const before = (await pool.query('SELECT count(*) AS n FROM device_commands')).rows[0].n;
    const pv = await preview(api, buf, 'staff.xlsx');
    expect(pv.status).toBe(200);
    const p = zImportPreview.parse(pv.body);
    expect(p.fileName).toBe('staff.xlsx');
    expect(p.summary).toEqual({ rows: 8, create: 1, update: 3, unchanged: 1, error: 3, deviceRemove: 1, deviceRestore: 0, deviceUpdate: 1 });
    // "4" exists as 0044, so code 4 is a new employee whose BPS is bad; plus two duplicate rows
    expect(p.unknownWings).toEqual([]);
    const byCode = (code: string) => p.rows.filter((r) => r.empCode === code);
    const r1 = byCode('1')[0]!;
    expect(r1).toMatchObject({ action: 'update', deviceEffect: 'update_profile' });
    expect(r1.changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ['Name', 'Ali', 'Ali Raza'],
      ['Wing', 'Operations', 'Admin'],
      ['Section', 'Billing', null],
    ]);
    expect(byCode('2')[0]).toMatchObject({ action: 'update', deviceEffect: 'remove' });
    expect(byCode('2')[0]!.changes).toContainEqual({ field: 'status', label: 'Status', before: 'Active', after: 'Disabled' });
    expect(byCode('3')[0]!.changes).toEqual([{ field: 'designation', label: 'Designation', before: 'Driver', after: null }]);
    expect(byCode('9')[0]).toMatchObject({ action: 'create', deviceEffect: 'none', name: 'New Person' });
    expect(byCode('4')[0]!.errors).toEqual([{ field: 'BPS', message: 'BPS must be a whole number from 1 to 22' }]);
    expect(byCode('8')).toHaveLength(2);
    expect(byCode('8').every((r) => r.action === 'error' && /more than once.*rows \d+, \d+/.test(r.errors[0]!.message))).toBe(true);
    expect(p.rows.find((r) => r.empCode === '0044')).toBeUndefined(); // unchanged rows are only counted

    // preview wrote nothing
    expect((await pool.query('SELECT count(*) AS n FROM device_commands')).rows[0].n).toBe(before);
    expect((await pool.query(`SELECT name FROM employees WHERE emp_code = '1'`)).rows[0].name).toBe('Ali');
    expect((await pool.query(`SELECT 1 FROM employees WHERE emp_code = '9'`)).rowCount).toBe(0);

    const base = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM audit_logs')).rows[0].m);
    const done = await commit(api, p.token);
    expect(done.status).toBe(200);
    const result = zEmployeeImportResult.parse(done.body);
    expect(result).toMatchObject({ created: 1, updated: 3, unchanged: 1, skipped: 3, wingsCreated: 0, sectionsCreated: 0 });

    const emps = await pool.query(`SELECT emp_code, name, wing_id, section_id, designation, status, status_reason, bps, gender, employment_type, to_char(join_date, 'YYYY-MM-DD') AS jd, cnic FROM employees ORDER BY emp_code`);
    const m = new Map(emps.rows.map((r) => [r.emp_code, r]));
    expect(m.get('1')).toMatchObject({ name: 'Ali Raza', wing_id: admin.id, section_id: null });
    expect(m.get('2')).toMatchObject({ status: 'disabled', status_reason: 'Absconding' });
    expect(m.get('3')).toMatchObject({ designation: null });
    expect(m.get('9')).toMatchObject({ name: 'New Person', wing_id: ops.id, gender: 'female', bps: 5, employment_type: 'contract', jd: '2026-01-05', cnic: '35202-9999999-9' });
    expect(m.has('4')).toBe(false);
    expect(m.has('8')).toBe(false);

    const cmds = await pool.query(`SELECT employee_id, command FROM device_commands ORDER BY id`);
    const mine = (id: number) => cmds.rows.filter((c) => c.employee_id === id).map((c) => c.command.split('\t')[0]);
    expect(mine(e1.id)).toEqual(['DATA UPDATE USERINFO PIN=1']);
    expect(cmds.rows.find((c) => c.employee_id === e1.id).command).toContain('Name=Ali Raza');
    expect(mine(e2.id)).toEqual(['DATA QUERY BIODATA PIN=2', 'DATA DELETE USERINFO PIN=2']);
    expect(mine(e3.id)).toEqual([]);
    expect(result.deviceCommandsQueued).toBe(3); // profile update + (biometric refresh, delete); no photo re-fetch
    expect((await pool.query('SELECT 1 FROM employee_device_holds WHERE employee_id = $1', [e2.id])).rowCount).toBe(1);

    // audit: summary, a diff per employee, a status entry
    await flushAudit();
    const au = async (action: string) => (await pool.query(`SELECT summary, changes, metadata FROM audit_logs WHERE action = $1 AND id > $2 ORDER BY id`, [action, base])).rows;
    expect((await au('employee.import'))[0]).toMatchObject({ summary: expect.stringContaining('Imported staff.xlsx: 1 added, 3 updated, 1 unchanged, 3 skipped'), metadata: { created: 1, updated: 3, fileName: 'staff.xlsx' } });
    expect((await au('employee.create')).map((r) => r.summary)).toEqual(['Added employee 9 · New Person (Excel import)']);
    const upd = await au('employee.update');
    expect(upd).toHaveLength(2);
    expect(upd[0].changes).toEqual([
      { field: 'Name', before: 'Ali', after: 'Ali Raza' },
      { field: 'Wing', before: 'Operations', after: 'Admin' },
      { field: 'Section', before: 'Billing', after: null },
    ]);
    const st = await au('employee.status');
    expect(st).toHaveLength(1);
    expect(st[0].metadata).toMatchObject({ reason: 'Absconding', deviceEffect: 'remove', commandsQueued: 2, devices: ['Gate'] });
    // CNIC is masked in the audit trail
    expect(JSON.stringify((await au('employee.create'))[0].changes)).toContain('*****-*******-9');
    expect(JSON.stringify((await au('employee.create'))[0].changes)).not.toContain('3520299999999');
  });

  it('the token is single use, expires after 30 minutes and belongs to its user', async () => {
    await seed();
    const wb = await load((await download(api)).buf);
    set(wb.getWorksheet('Employees')!, '3', 'Designation', 'Changed');
    const buf = await toBuf(wb);

    const p1 = (await preview(api, buf)).body;
    expect((await commit(api, p1.token)).status).toBe(200);
    const again = await commit(api, p1.token);
    expect([again.status, again.body.error.code]).toEqual([410, 'IMPORT_EXPIRED']);

    const p2 = (await preview(api, buf)).body;
    __expireImportToken(p2.token);
    expect((await commit(api, p2.token)).status).toBe(410);

    const p3 = (await preview(api, buf)).body;
    const other = await userClient({ permissions: ['employees.view', 'employees.manage', 'employees.import'] });
    expect((await commit(other, p3.token)).status).toBe(410);
    expect((await commit(api, p3.token)).status).toBe(200); // still valid for its owner
    expect((await commit(api, 'nope')).status).toBe(410);
    expect((await api.post(`${V1}/employees/import/commit`).send({})).status).toBe(400);
  });

  it('unknown wings and sections: warned in preview, skipped without createMissing, created with it', async () => {
    const { ops } = await seed();
    const wb = await load((await download(api)).buf);
    const ws = wb.getWorksheet('Employees')!;
    addRow(ws, { 'Employee Code': '70', Name: 'Newbie', Wing: 'Brand New', Section: 'Sec X' });
    addRow(ws, { 'Employee Code': '71', Name: 'Sectioned', Wing: 'Operations', Section: 'Fresh Section' });
    addRow(ws, { 'Employee Code': '72', Name: 'Fine', Wing: 'OPS', Section: 'billing' });
    const buf = await toBuf(wb);

    const p = zImportPreview.parse((await preview(api, buf)).body);
    expect(p.unknownWings).toEqual(['Brand New']);
    expect(p.unknownSections).toEqual([{ wing: 'Brand New', section: 'Sec X' }, { wing: 'Operations', section: 'Fresh Section' }]);
    expect(p.summary).toMatchObject({ create: 3, error: 0 });
    expect(p.rows.find((r) => r.empCode === '70')!.warnings).toEqual(['Wing "Brand New" does not exist yet']);

    const without = zEmployeeImportResult.parse((await commit(api, p.token, false)).body);
    expect(without).toMatchObject({ created: 1, skipped: 2, wingsCreated: 0, sectionsCreated: 0 });
    expect((await pool.query(`SELECT emp_code FROM employees WHERE emp_code IN ('70','71','72') ORDER BY 1`)).rows).toEqual([{ emp_code: '72' }]);
    expect((await pool.query(`SELECT 1 FROM wings WHERE name = 'Brand New'`)).rowCount).toBe(0);

    const p2 = zImportPreview.parse((await preview(api, buf)).body);
    const withMissing = zEmployeeImportResult.parse((await commit(api, p2.token, true)).body);
    expect(withMissing).toMatchObject({ created: 2, unchanged: expect.any(Number), skipped: 0, wingsCreated: 1, sectionsCreated: 2 });
    const placed = await pool.query(`SELECT e.emp_code, w.name AS wing, s.name AS section FROM employees e LEFT JOIN wings w ON w.id = e.wing_id LEFT JOIN sections s ON s.id = e.section_id WHERE e.emp_code IN ('70','71','72') ORDER BY 1`);
    expect(placed.rows).toEqual([
      { emp_code: '70', wing: 'Brand New', section: 'Sec X' },
      { emp_code: '71', wing: 'Operations', section: 'Fresh Section' },
      { emp_code: '72', wing: 'Operations', section: 'Billing' },
    ]);
    expect((await pool.query('SELECT 1 FROM sections WHERE wing_id = $1', [ops.id])).rowCount).toBe(2);
  });

  it('re-enabling by sheet restores to the devices recorded; an untouched export changes nothing', async () => {
    const { e2 } = await seed();
    await api.post(`${V1}/employees/${e2.id}/status`).send({ status: 'disabled', force: true });
    await pool.query('DELETE FROM device_commands');
    const wb = await load((await download(api)).buf);
    const clean = zImportPreview.parse((await preview(api, await toBuf(wb))).body);
    expect(clean.summary).toMatchObject({ create: 0, update: 0, error: 0, unchanged: 4 });
    expect(clean.rows).toEqual([]);

    set(wb.getWorksheet('Employees')!, '2', 'Status', 'Active');
    const p = zImportPreview.parse((await preview(api, await toBuf(wb))).body);
    expect(p.summary).toMatchObject({ update: 1, deviceRestore: 1 });
    expect(p.rows[0]!.deviceEffect).toBe('restore');
    await commit(api, p.token);
    expect((await pool.query('SELECT command FROM device_commands WHERE employee_id = $1 ORDER BY id', [e2.id])).rows.map((r) => r.command.split('\t')[0])).toEqual(['DATA UPDATE USERINFO PIN=2']);
    expect((await pool.query('SELECT status FROM employees WHERE id = $1', [e2.id])).rows[0].status).toBe('active');
  });

  it('header matching is flexible; unknown columns warn; Employee Code is required', async () => {
    await seed();
    const wb = await load((await download(api)).buf);
    const ws = wb.getWorksheet('Employees')!;
    ws.getCell(1, colOf(ws, 'Designation')).value = '  DESIGNATION ';
    ws.getCell(1, colOf(ws, "Father's Name")).value = 'fathers name';
    ws.getCell(1, ws.columnCount + 1).value = 'Mystery';
    set(ws, '3', '  DESIGNATION ', 'Boss');
    const p = zImportPreview.parse((await preview(api, await toBuf(wb))).body);
    expect(p.rows[0]).toMatchObject({ row: 1, warnings: ['Unknown column "Mystery" was ignored'] });
    expect(p.rows.find((r) => r.empCode === '3')!.changes[0]).toMatchObject({ label: 'Designation', after: 'Boss' });

    const noCode = await load((await download(api)).buf);
    const sheet = noCode.getWorksheet('Employees')!;
    sheet.getCell(1, 1).value = 'Code';
    const bad = await preview(api, await toBuf(noCode));
    expect([bad.status, bad.body.error.code]).toEqual([400, 'INVALID_FILE']);
  });

  it('rejects wrong files: extension, content, size, missing file, permissions', async () => {
    await seed();
    const good = (await download(api)).buf;
    const c1 = await preview(api, good, 'staff.xls');
    expect([c1.status, c1.body.error.code]).toEqual([400, 'INVALID_FILE']);
    const c2 = await preview(api, Buffer.from('a,b,c\n1,2,3'), 'staff.xlsx');
    expect([c2.status, c2.body.error.code]).toEqual([400, 'INVALID_FILE']);
    const c3 = await preview(api, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(100)]), 'broken.xlsx');
    expect([c3.status, c3.body.error.code]).toEqual([400, 'INVALID_FILE']);
    const c4 = await preview(api, Buffer.alloc(10 * 1024 * 1024 + 1024, 1), 'huge.xlsx');
    expect([c4.status, c4.body.error.code]).toEqual([400, 'INVALID_FILE']);
    const c5 = await api.post(`${V1}/employees/import/preview`).send({});
    expect([c5.status, c5.body.error.code]).toEqual([400, 'INVALID_FILE']);

    const importOnly = await userClient({ permissions: ['employees.view', 'employees.import'] });
    expect((await preview(importOnly, good)).status).toBe(403); // also needs employees.manage
    const manageOnly = await userClient({ permissions: ['employees.view', 'employees.manage'] });
    expect((await preview(manageOnly, good)).status).toBe(403);
    expect((await commit(manageOnly, 'x')).status).toBe(403);
  });

  it('wing scope: rows outside the caller\'s wings are errors, inside rows apply', async () => {
    const { ops, admin } = await seed();
    const u = await userClient({ permissions: ['employees.view', 'employees.manage', 'employees.import', 'employees.push'], wings: [ops.id] });
    const wb = await load((await download(u)).buf);
    const ws = wb.getWorksheet('Employees')!;
    expect(ws.rowCount).toBe(3); // only Operations employees are exported
    set(ws, '1', 'Designation', 'Senior Clerk'); // fine
    set(ws, '2', 'Wing', 'Admin'); // moving out of scope
    addRow(ws, { 'Employee Code': '3', Name: 'Chand', Wing: 'Operations' }); // exists in Admin: outside scope
    addRow(ws, { 'Employee Code': '60', Name: 'In scope', Wing: 'Operations' });
    addRow(ws, { 'Employee Code': '61', Name: 'Wingless' });
    addRow(ws, { 'Employee Code': '62', Name: 'Elsewhere', Wing: 'Admin' });
    addRow(ws, { 'Employee Code': '63', Name: 'Unknown', Wing: 'Nowhere' });
    const p = zImportPreview.parse((await preview(u, await toBuf(wb))).body);
    const row = (code: string) => p.rows.find((r) => r.empCode === code)!;
    expect(row('1').action).toBe('update');
    expect(row('2')).toMatchObject({ action: 'error', errors: [{ field: 'Wing', message: 'Choose a wing from the ones assigned to your role' }] });
    expect(row('3').action).toBe('error');
    expect(row('3').errors[0]!.message).toBe('This employee is outside your wing scope');
    expect(row('60').action).toBe('create');
    expect(row('61').action).toBe('error');
    expect(row('62').action).toBe('error');
    expect(row('63').errors[0]!.message).toMatch(/cannot create wings/);
    const r = zEmployeeImportResult.parse((await commit(u, p.token, true)).body);
    expect(r).toMatchObject({ created: 1, updated: 1, skipped: 5, wingsCreated: 0 });
    const names = await pool.query(`SELECT emp_code, wing_id, designation FROM employees WHERE emp_code IN ('1','2','3','60') ORDER BY emp_code::int`);
    expect(names.rows).toEqual([
      { emp_code: '1', wing_id: ops.id, designation: 'Senior Clerk' },
      { emp_code: '2', wing_id: ops.id, designation: 'Typist' },
      { emp_code: '3', wing_id: admin.id, designation: 'Driver' },
      { emp_code: '60', wing_id: ops.id, designation: null },
    ]);
  });

  it('changing status from a sheet needs employees.push', async () => {
    const { ops } = await seed();
    const u = await userClient({ permissions: ['employees.view', 'employees.manage', 'employees.import'], wings: [ops.id] });
    const wb = await load((await download(u)).buf);
    set(wb.getWorksheet('Employees')!, '2', 'Status', 'Left');
    const p = zImportPreview.parse((await preview(u, await toBuf(wb))).body);
    expect(p.rows[0]).toMatchObject({ action: 'error', errors: [{ field: 'Status' }] });
  });
});
