import ExcelJS from 'exceljs';
import {
  EMPLOYEE_EXCEL_COLUMNS,
  EMPLOYEE_STATUS_LABEL,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPES,
  GENDER_LABEL,
  GENDERS,
  type Employee,
  type EmployeeExcelColumnKey,
} from '@nacta/shared';
import * as wingRepo from '../wings/repo';

export const NACTA_GREEN = 'FF0B5D3B';
/** Dropdowns and formats cover this many data rows (new rows can be typed below the export). */
const VALIDATION_ROWS = 2000;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const WIDTHS: Record<EmployeeExcelColumnKey, number> = {
  empCode: 14,
  name: 28,
  fatherName: 26,
  cnic: 19,
  gender: 10,
  wing: 22,
  section: 22,
  designation: 24,
  bps: 7,
  employmentType: 17,
  status: 11,
  statusReason: 26,
  joinDate: 13,
  cardNo: 13,
  privilege: 12,
  phone: 16,
  email: 28,
  emergencyContactName: 24,
  emergencyContactPhone: 16,
  address: 36,
  notes: 30,
};

const TEXT_COLUMNS = new Set<EmployeeExcelColumnKey>(['empCode', 'cnic', 'cardNo', 'phone', 'emergencyContactPhone']);

/** "2026-11-24" -> a real Excel date (UTC midnight, so the calendar day never shifts). */
function toExcelDate(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function cellValue(e: Employee, key: EmployeeExcelColumnKey): string | number | Date | null {
  switch (key) {
    case 'empCode': return e.empCode;
    case 'name': return e.name;
    case 'fatherName': return e.fatherName;
    case 'cnic': return e.cnic;
    case 'gender': return e.gender ? GENDER_LABEL[e.gender] : null;
    case 'wing': return e.wingName;
    case 'section': return e.sectionName;
    case 'designation': return e.designation;
    case 'bps': return e.bps;
    case 'employmentType': return e.employmentType ? EMPLOYMENT_TYPE_LABEL[e.employmentType] : null;
    case 'status': return EMPLOYEE_STATUS_LABEL[e.status];
    case 'statusReason': return e.statusReason;
    case 'joinDate': return toExcelDate(e.joinDate);
    case 'cardNo': return e.cardNo;
    case 'privilege': return e.privilege === 14 ? 'Admin' : 'User';
    case 'phone': return e.phone;
    case 'email': return e.email;
    case 'emergencyContactName': return e.emergencyContactName;
    case 'emergencyContactPhone': return e.emergencyContactPhone;
    case 'address': return e.address;
    case 'notes': return e.notes;
  }
}

export interface ExportOptions {
  employees: Employee[];
  /** Wings (and sections) the caller may use, for the Lists sheet and dropdowns. */
  wings: Awaited<ReturnType<typeof wingRepo.list>>;
  includeCnic: boolean;
  generatedBy: string;
}

export async function buildWorkbook(opts: ExportOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NACTA Attendance';
  wb.created = new Date();
  const ws = wb.addWorksheet('Employees', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  const lists = wb.addWorksheet('Lists');
  const help = wb.addWorksheet('Instructions');

  // ---- Lists sheet: wings (A:B), sections with their wing (D:E), distinct section names for the dropdown (G)
  lists.getRow(1).values = ['Wing', 'Code', '', 'Section', 'Wing', '', 'Section names'];
  [1, 2, 4, 5, 7].forEach((c) => styleHeader(lists.getCell(1, c)));
  lists.columns = [{ width: 28 }, { width: 10 }, { width: 3 }, { width: 28 }, { width: 28 }, { width: 3 }, { width: 28 }];
  opts.wings.forEach((w, i) => {
    lists.getCell(i + 2, 1).value = w.name;
    lists.getCell(i + 2, 2).value = w.code;
  });
  let sr = 2;
  const distinct = new Map<string, string>();
  for (const w of opts.wings) {
    for (const s of w.sections) {
      lists.getCell(sr, 4).value = s.name;
      lists.getCell(sr, 5).value = w.name;
      sr += 1;
      if (!distinct.has(s.name.toLowerCase())) distinct.set(s.name.toLowerCase(), s.name);
    }
  }
  [...distinct.values()].sort((a, b) => a.localeCompare(b)).forEach((n, i) => {
    lists.getCell(i + 2, 7).value = n;
  });
  const wingCount = opts.wings.length;
  const sectionNameCount = distinct.size;

  // ---- Employees sheet
  const cols = EMPLOYEE_EXCEL_COLUMNS.filter((c) => opts.includeCnic || c.key !== 'cnic');
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: WIDTHS[c.key] }));
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => styleHeader(cell));
  // The header notes become cell comments-free tooltips via the Instructions sheet; keep the header text exact.

  for (const e of opts.employees) {
    const row = ws.addRow(cols.map((c) => cellValue(e, c.key)));
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (TEXT_COLUMNS.has(c.key)) cell.numFmt = '@';
      if (c.key === 'joinDate') cell.numFmt = 'yyyy-mm-dd';
    });
  }
  // Text / date formats for the rows people will add below the data too.
  const validations = (ws as unknown as { dataValidations: { add(address: string, validation: unknown): void } }).dataValidations;
  const last = Math.max(opts.employees.length + 1, VALIDATION_ROWS);
  cols.forEach((c, i) => {
    const colLetter = ws.getColumn(i + 1).letter;
    if (TEXT_COLUMNS.has(c.key)) ws.getColumn(i + 1).numFmt = '@';
    if (c.key === 'joinDate') ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
    const range = `${colLetter}2:${colLetter}${last}`;
    const list = (formula: string) => ({ type: 'list' as const, allowBlank: true, formulae: [formula], showErrorMessage: true, errorTitle: c.header, error: 'Pick a value from the list.' });
    switch (c.key) {
      case 'gender':
        validations.add(range, list(`"${GENDERS.map((g) => GENDER_LABEL[g]).join(',')}"`));
        break;
      case 'employmentType':
        validations.add(range, list(`"${EMPLOYMENT_TYPES.map((t) => EMPLOYMENT_TYPE_LABEL[t]).join(',')}"`));
        break;
      case 'status':
        validations.add(range, list(`"${EMPLOYEE_STATUSES.map((s) => EMPLOYEE_STATUS_LABEL[s]).join(',')}"`));
        break;
      case 'privilege':
        validations.add(range, list('"User,Admin"'));
        break;
      case 'wing':
        if (wingCount) validations.add(range, list(`Lists!$A$2:$A$${wingCount + 1}`));
        break;
      case 'section':
        if (sectionNameCount) validations.add(range, list(`Lists!$G$2:$G$${sectionNameCount + 1}`));
        break;
      case 'bps':
        validations.add(range, {
          type: 'whole',
          operator: 'between',
          allowBlank: true,
          formulae: [1, 22],
          showErrorMessage: true,
          errorTitle: 'BPS',
          error: 'BPS is a whole number from 1 to 22.',
        });
        break;
      default:
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  // ---- Instructions
  help.columns = [{ width: 110 }];
  const lines: [string, boolean][] = [
    ['NACTA Attendance: employee workbook', true],
    [`Exported ${new Date().toLocaleString('en-GB')} by ${opts.generatedBy}. ${opts.employees.length} employee${opts.employees.length === 1 ? '' : 's'}.`, false],
    ['', false],
    ['How to use', true],
    ['1. Edit the "Employees" sheet in Excel, save the file, then upload the same file in the application (Employees > Import). A preview shows every change before anything is applied.', false],
    ['2. Do not change Employee Code. It is the key that matches a row to a person (and is the device PIN). A new code adds a new employee; a changed code looks like a new person.', false],
    ['3. A blank cell clears that field (for example, a blank Section removes the person from their section). Untouched rows are left unchanged.', false],
    ['4. Rows are never deleted by import. Employees missing from the file are left alone. To stop someone using the devices, set Status to Disabled or Left.', false],
    ['5. You may delete or reorder optional columns; columns are matched by their header text. Employee Code and Name must stay.', false],
    ['6. Wing and Section are matched by name (Wing also by its code). Pick from the dropdowns. The Section must belong to the Wing. Unknown names can be created during import if you choose to.', false],
    ['', false],
    ['Status and devices', true],
    ['Active: the person is on the devices and can mark attendance.', false],
    ['Disabled: removed from every device (their fingerprints, face and photo stay in the application). Setting Active again restores them to the same devices.', false],
    ['Left: removed from every device and given a leaving date; history is kept. Setting Active again restores them like Disabled.', false],
    ['Changing a person\'s Name, Card No or Device Role while Active updates their record on the devices automatically. New employees are not sent to devices by import; use "Send to devices".', false],
    ['', false],
    ['Notes', true],
    ['Dates: Join Date is a date cell (or text YYYY-MM-DD). Employee Code, CNIC and phone numbers are text so leading zeros and dashes are kept.', false],
    ['Device passwords are never exported or imported.', false],
    [opts.includeCnic ? 'CNIC: 13 digits, with or without dashes.' : 'The CNIC column is not included because your role cannot manage employees.', false],
    ['', false],
    ['Columns', true],
  ];
  for (const c of cols) lines.push([`${c.header}${c.required ? ' (required)' : ''}: ${c.note || '-'}`, false]);
  lines.forEach(([text, bold], i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (bold) cell.font = { bold: true, size: 12, color: { argb: NACTA_GREEN } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function styleHeader(cell: ExcelJS.Cell): void {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NACTA_GREEN } };
  cell.alignment = { vertical: 'middle', wrapText: true };
}

/** NACTA-Employees-YYYYMMDD-HHmm.xlsx (server local time). */
export function exportFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `NACTA-Employees-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
}
