// Excel round-trip: parse an uploaded workbook into a plan (preview, writes nothing), then apply the plan (commit).
// The same `evaluate` runs for both, so the preview is exactly what commit will do (against fresh database state).
import { randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  EMPLOYEE_EXCEL_COLUMNS,
  EMPLOYEE_STATUS_LABEL,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPES,
  ErrorCode,
  GENDER_LABEL,
  GENDERS,
  zEmployeeInput,
  zEmpCode,
  type AuditChange,
  type Employee,
  type EmployeeExcelColumnKey,
  type EmployeeImportResult,
  type EmployeeStatus,
  type ImportPreview,
  type ImportRow,
  type WingScope,
} from '@nacta/shared';
import { pool, withTransaction, type Queryable } from '../../db/pool';
import { isRealDate } from '../../lib/dates';
import { AppError } from '../../lib/errors';
import { inScope } from '../../lib/scope';
import * as wingRepo from '../wings/repo';
import * as devSync from './deviceSync';
import * as repo from './repo';
import { mapPgError } from './service';
import { applyStatus } from './status';

type Key = EmployeeExcelColumnKey;
const MAX_ROWS = 20000;
export const IMPORT_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------
// Parsing the workbook
// ---------------------------------------------------------------------------------------------------------
export interface ParsedRow {
  /** Excel row number (header = 1). */
  row: number;
  /** Trimmed text of every column present in the file ('' = blank cell). */
  raw: Partial<Record<Key, string>>;
}

export interface ParsedWorkbook {
  columns: Key[];
  rows: ParsedRow[];
  warnings: string[];
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_KEYS = new Map<string, Key>();
for (const c of EMPLOYEE_EXCEL_COLUMNS) {
  HEADER_KEYS.set(norm(c.header), c.key);
  HEADER_KEYS.set(norm(c.key), c.key);
}

const ymd = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** Excel serial day number -> YYYY-MM-DD. */
const serialToDate = (n: number): string => ymd(new Date(Math.round((n - 25569) * 86400 * 1000)));

function cellText(v: ExcelJS.CellValue, key: Key): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return ymd(v);
  if (typeof v === 'number') return key === 'joinDate' && v > 1000 && v < 100000 ? serialToDate(v) : Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue, key);
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('error' in v) return '';
  }
  return '';
}

const invalidFile = (message: string) => new AppError(400, ErrorCode.INVALID_FILE, message);

export async function parseWorkbook(buf: Buffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw invalidFile('The file is not a valid .xlsx workbook');
  }
  const ws = wb.getWorksheet('Employees') ?? wb.worksheets[0];
  if (!ws) throw invalidFile('The workbook has no sheets');

  const warnings: string[] = [];
  const colOf = new Map<number, Key>();
  const seen = new Set<Key>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellText(cell.value, 'name');
    if (!text) return;
    const key = HEADER_KEYS.get(norm(text));
    if (!key) {
      warnings.push(`Unknown column "${text}" was ignored`);
    } else if (seen.has(key)) {
      warnings.push(`Column "${text}" appears more than once; only the first is used`);
    } else {
      seen.add(key);
      colOf.set(colNumber, key);
    }
  });
  if (!seen.has('empCode')) throw invalidFile('The "Employee Code" column was not found in the first row of the Employees sheet');

  const rows: ParsedRow[] = [];
  const lastRow = ws.rowCount;
  if (lastRow - 1 > MAX_ROWS + 5000) throw invalidFile(`Too many rows (the limit is ${MAX_ROWS})`);
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const raw: Partial<Record<Key, string>> = {};
    let any = false;
    for (const [col, key] of colOf) {
      const t = cellText(row.getCell(col).value, key);
      raw[key] = t;
      if (t !== '') any = true;
    }
    if (!any) continue;
    rows.push({ row: r, raw });
  }
  if (rows.length > MAX_ROWS) throw invalidFile(`Too many rows (the limit is ${MAX_ROWS})`);
  return { columns: [...seen], rows, warnings };
}

// ---------------------------------------------------------------------------------------------------------
// Evaluating rows against the database
// ---------------------------------------------------------------------------------------------------------
interface WingInfo {
  id: number;
  name: string;
  code: string | null;
  sections: { id: number; name: string }[];
}

class Lookups {
  private byName = new Map<string, WingInfo>();
  private byCode = new Map<string, WingInfo>();
  constructor(public wings: WingInfo[]) {
    for (const w of wings) {
      this.byName.set(w.name.toLowerCase(), w);
      if (w.code) this.byCode.set(w.code.toLowerCase(), w);
    }
  }
  wing(text: string): WingInfo | undefined {
    const k = text.trim().toLowerCase();
    return this.byName.get(k) ?? this.byCode.get(k);
  }
  section(w: WingInfo, text: string): { id: number; name: string } | undefined {
    const k = text.trim().toLowerCase();
    return w.sections.find((s) => s.name.toLowerCase() === k);
  }
}

type Fields = repo.EmployeeFields;
type FieldKey = keyof Fields;

/** Excel column -> employee field (wing / section / status handled separately). */
const FIELD_OF: Partial<Record<Key, FieldKey>> = {
  name: 'name',
  fatherName: 'fatherName',
  cnic: 'cnic',
  gender: 'gender',
  designation: 'designation',
  bps: 'bps',
  employmentType: 'employmentType',
  joinDate: 'joinDate',
  cardNo: 'cardNo',
  privilege: 'privilege',
  phone: 'phone',
  email: 'email',
  emergencyContactName: 'emergencyContactName',
  emergencyContactPhone: 'emergencyContactPhone',
  address: 'address',
  notes: 'notes',
};
const HEADER_OF = Object.fromEntries(EMPLOYEE_EXCEL_COLUMNS.map((c) => [c.key, c.header])) as Record<Key, string>;
const PROFILE_FIELDS: FieldKey[] = ['name', 'cardNo', 'privilege'];

const shape = zEmployeeInput.shape;

const pickLabel = <T extends string>(text: string, values: readonly T[], labels: Record<T, string>): T | undefined => {
  const t = text.toLowerCase().replace(/[_\s]+/g, ' ');
  return values.find((v) => labels[v].toLowerCase() === t || v.replace(/_/g, ' ') === t);
};

export interface EvalRow {
  row: number;
  empCode: string | null;
  name: string | null;
  action: ImportRow['action'];
  errors: { field: string | null; message: string }[];
  warnings: string[];
  changes: ImportRow['changes'];
  deviceEffect: ImportRow['deviceEffect'];
  existing: Employee | null;
  /** Values to write (only changed fields for an update, everything given for a create). */
  fields: Partial<Fields>;
  /** Wing / section as resolved ids; unknown ones are named in unknownWing / unknownSection. */
  wingId?: number | null;
  sectionId?: number | null;
  unknownWing?: string;
  unknownSection?: { wing: string; section: string };
  statusTo?: { status: EmployeeStatus; reason: string | null };
  backupWarnings: string[];
}

export interface EvalContext {
  rows: ParsedRow[];
  columns: Key[];
  lookups: Lookups;
  existing: Map<string, Employee>;
  /** CNIC -> employee code that owns it (to catch collisions before the database does). */
  cnicOwners: Map<string, string>;
  scope: WingScope;
  canPush: boolean;
  checkBackupRisk: boolean;
  db: Queryable;
}

const dispVal = (key: Key, v: unknown): unknown => v ?? null;

/** Compare and describe one field. */
function sameVal(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

export async function evaluate(ctx: EvalContext): Promise<EvalRow[]> {
  const cols = new Set(ctx.columns);
  const has = (k: Key) => cols.has(k);

  // Duplicate codes within the file.
  const codeRows = new Map<string, number[]>();
  for (const pr of ctx.rows) {
    const p = zEmpCode.safeParse(pr.raw.empCode ?? '');
    if (p.success) codeRows.set(p.data, [...(codeRows.get(p.data) ?? []), pr.row]);
  }
  // Duplicate CNICs within the file.
  const cnicRows = new Map<string, number[]>();
  if (has('cnic')) {
    for (const pr of ctx.rows) {
      const c = pr.raw.cnic ? shape.cnic.safeParse(pr.raw.cnic) : null;
      if (c?.success && c.data) cnicRows.set(c.data, [...(cnicRows.get(c.data) ?? []), pr.row]);
    }
  }

  const out: EvalRow[] = [];
  for (const pr of ctx.rows) {
    const errors: EvalRow['errors'] = [];
    const warnings: string[] = [];
    const err = (field: Key | null, message: string) => errors.push({ field: field ? HEADER_OF[field] : null, message });
    const fields: Partial<Fields> = {};
    const raw = pr.raw;

    // ---- employee code
    const codeParsed = zEmpCode.safeParse(raw.empCode ?? '');
    let code: string | null = null;
    if (!(raw.empCode ?? '')) err('empCode', 'Employee Code is required');
    else if (!codeParsed.success) err('empCode', codeParsed.error.issues[0]?.message ?? 'Invalid employee code');
    else {
      code = codeParsed.data;
      const dups = codeRows.get(code) ?? [];
      if (dups.length > 1) err('empCode', `Employee Code appears more than once in the file (rows ${dups.join(', ')})`);
    }
    const existing = code ? (ctx.existing.get(code) ?? null) : null;

    // ---- simple fields
    const values: Partial<Record<Key, unknown>> = {};
    for (const key of ctx.columns) {
      const text = raw[key] ?? '';
      const blank = text === '';
      switch (key) {
        case 'empCode':
        case 'wing':
        case 'section':
        case 'status':
        case 'statusReason':
          break;
        case 'name': {
          const p = shape.name.safeParse(text);
          if (!p.success) err(key, p.error.issues[0]?.message ?? 'Invalid name');
          else values.name = p.data;
          break;
        }
        case 'cnic': {
          if (blank) values.cnic = null;
          else {
            const p = shape.cnic.safeParse(text);
            if (!p.success) err(key, p.error.issues[0]?.message ?? 'Invalid CNIC');
            else {
              values.cnic = p.data;
              const owner = p.data ? ctx.cnicOwners.get(p.data) : undefined;
              if (p.data && owner && owner !== code) err(key, `This CNIC already belongs to employee ${owner}`);
              if (p.data && (cnicRows.get(p.data)?.length ?? 0) > 1) err(key, `This CNIC appears more than once in the file (rows ${cnicRows.get(p.data)?.join(', ')})`);
            }
          }
          break;
        }
        case 'gender': {
          if (blank) values.gender = null;
          else {
            const g = pickLabel(text, GENDERS, GENDER_LABEL);
            if (!g) err(key, 'Gender must be Male or Female');
            else values.gender = g;
          }
          break;
        }
        case 'employmentType': {
          if (blank) values.employmentType = null;
          else {
            const t = pickLabel(text, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL);
            if (!t) err(key, 'Employment Type must be Regular, Contract, Deputation, Daily wages or Internship');
            else values.employmentType = t;
          }
          break;
        }
        case 'bps': {
          if (blank) values.bps = null;
          else {
            const p = shape.bps.safeParse(Number(text));
            if (!p.success || !Number.isFinite(Number(text))) err(key, 'BPS must be a whole number from 1 to 22');
            else values.bps = p.data;
          }
          break;
        }
        case 'privilege': {
          const t = text.toLowerCase();
          if (blank || t === 'user' || t === '0') values.privilege = 0;
          else if (t === 'admin' || t === '14') values.privilege = 14;
          else err(key, 'Device Role must be User or Admin');
          break;
        }
        case 'joinDate': {
          if (blank) values.joinDate = null;
          else {
            const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
            if (!iso || !isRealDate(iso)) err(key, 'Join Date must be a date (YYYY-MM-DD)');
            else values.joinDate = iso;
          }
          break;
        }
        default: {
          const p = shape[key as keyof typeof shape].safeParse(blank ? null : text);
          if (!p.success) err(key, p.error.issues[0]?.message ?? 'Invalid value');
          else values[key] = p.data;
        }
      }
    }
    if (!existing && has('name') === false && code) err('name', 'Name is required for a new employee');
    if (!existing && has('name') && !raw.name) err('name', 'Name is required');

    // ---- wing / section
    let wingId: number | null | undefined; // undefined = leave as is
    let sectionId: number | null | undefined;
    let unknownWing: string | undefined;
    let unknownSection: { wing: string; section: string } | undefined;
    let effWing: WingInfo | null = existing?.wingId != null ? (ctx.lookups.wings.find((w) => w.id === existing.wingId) ?? null) : null;
    let wingUnknown = false;
    if (has('wing')) {
      const t = raw.wing ?? '';
      if (t === '') {
        wingId = null;
        effWing = null;
      } else {
        const w = ctx.lookups.wing(t);
        if (w) {
          wingId = w.id;
          effWing = w;
        } else {
          unknownWing = t;
          wingUnknown = true;
          wingId = undefined;
          effWing = null;
          if (ctx.scope !== 'all') err('wing', `Wing "${t}" does not exist and your role cannot create wings`);
        }
      }
    }
    if (has('section')) {
      const t = raw.section ?? '';
      if (t === '') sectionId = null;
      else if (wingUnknown) unknownSection = { wing: unknownWing as string, section: t };
      else if (!effWing) err('section', 'Section needs a Wing');
      else {
        const s = ctx.lookups.section(effWing, t);
        if (s) sectionId = s.id;
        else if (ctx.scope !== 'all') err('section', `Section "${t}" does not exist in ${effWing.name} and your role cannot create sections`);
        else unknownSection = { wing: effWing.name, section: t };
      }
    } else if (existing && has('wing') && wingId !== undefined && wingId !== existing.wingId && existing.sectionId !== null) {
      sectionId = null;
      warnings.push('Wing changed, so the Section was cleared');
    }
    if (wingId !== undefined) fields.wingId = wingId;
    if (sectionId !== undefined) fields.sectionId = sectionId;

    // ---- scope: current and new wing must both be inside the caller's wings
    if (ctx.scope !== 'all') {
      if (existing && !inScope(ctx.scope, existing.wingId)) err(null, 'This employee is outside your wing scope');
      const newWing = has('wing') ? (wingId === undefined ? null : wingId) : (existing?.wingId ?? null);
      if (!unknownWing && !inScope(ctx.scope, newWing)) err('wing', 'Choose a wing from the ones assigned to your role');
    }

    // ---- status
    let statusTo: EvalRow['statusTo'];
    if (has('status') && (raw.status ?? '') !== '') {
      const s = pickLabel(raw.status ?? '', EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABEL);
      if (!s) err('status', 'Status must be Active, Disabled or Left');
      else if (s !== (existing?.status ?? 'active')) {
        statusTo = { status: s, reason: has('statusReason') && raw.statusReason ? raw.statusReason.slice(0, 300) : null };
        if (!ctx.canPush) err('status', 'Changing status moves people on and off the devices and needs the "Send employees to devices" permission');
      }
    }

    // ---- changes
    const changes: ImportRow['changes'] = [];
    const patch: Partial<Fields> = {};
    const addChange = (key: Key, before: unknown, after: unknown) =>
      changes.push({ field: key, label: HEADER_OF[key], before: dispVal(key, before), after: dispVal(key, after) });
    const shown = (key: Key, v: unknown): unknown => {
      if (key === 'gender') return v ? GENDER_LABEL[v as 'male' | 'female'] : null;
      if (key === 'employmentType') return v ? EMPLOYMENT_TYPE_LABEL[v as keyof typeof EMPLOYMENT_TYPE_LABEL] : null;
      if (key === 'privilege') return v === 14 ? 'Admin' : 'User';
      return v ?? null;
    };

    if (!existing) {
      // A create carries every value given; blanks stay unset.
      for (const [key, field] of Object.entries(FIELD_OF) as [Key, FieldKey][]) {
        if (!(key in values)) continue;
        const v = values[key];
        (fields as Record<string, unknown>)[field] = v;
        if (v !== null && v !== undefined && !(key === 'privilege' && v === 0)) addChange(key, null, shown(key, v));
      }
      if (unknownWing) addChange('wing', null, unknownWing);
      else if (wingId) addChange('wing', null, ctx.lookups.wings.find((w) => w.id === wingId)?.name ?? null);
      if (unknownSection) addChange('section', null, unknownSection.section);
      else if (sectionId) addChange('section', null, raw.section ?? null);
      if (statusTo) addChange('status', 'Active', EMPLOYEE_STATUS_LABEL[statusTo.status]);
    } else {
      for (const [key, field] of Object.entries(FIELD_OF) as [Key, FieldKey][]) {
        if (!(key in values)) continue;
        const v = values[key];
        const before = existing[field as keyof Employee];
        if (!sameVal(before, v)) {
          (patch as Record<string, unknown>)[field] = v;
          addChange(key, shown(key, before), shown(key, v));
        }
      }
      if (unknownWing) addChange('wing', existing.wingName, unknownWing);
      else if (wingId !== undefined && wingId !== existing.wingId) {
        patch.wingId = wingId;
        addChange('wing', existing.wingName, wingId ? (ctx.lookups.wings.find((w) => w.id === wingId)?.name ?? null) : null);
      }
      if (unknownSection) addChange('section', existing.sectionName, unknownSection.section);
      else if (sectionId !== undefined && sectionId !== existing.sectionId) {
        patch.sectionId = sectionId;
        const wname = (wingId !== undefined ? ctx.lookups.wings.find((w) => w.id === wingId) : effWing)?.sections.find((s) => s.id === sectionId)?.name ?? null;
        addChange('section', existing.sectionName, wname);
      }
      if (statusTo) addChange('status', EMPLOYEE_STATUS_LABEL[existing.status], EMPLOYEE_STATUS_LABEL[statusTo.status]);
    }
    if (unknownWing) warnings.push(`Wing "${unknownWing}" does not exist yet`);
    if (unknownSection && !unknownWing) warnings.push(`Section "${unknownSection.section}" does not exist yet in ${unknownSection.wing}`);

    // ---- device effect
    let deviceEffect: ImportRow['deviceEffect'] = 'none';
    let backupWarnings: string[] = [];
    if (existing && statusTo) {
      if (existing.status === 'active' && statusTo.status !== 'active') {
        if (existing.deviceCount > 0) {
          deviceEffect = 'remove';
          if (ctx.checkBackupRisk) {
            backupWarnings = (await devSync.backupRisk(ctx.db, existing.empCode)).reasons;
            for (const r of backupWarnings) warnings.push(`Biometrics may be missing from the backup: ${r}. The server will fetch them from the device before removing the person.`);
          }
        }
      } else if (existing.status !== 'active' && statusTo.status === 'active') deviceEffect = 'restore';
    } else if (existing && existing.status === 'active' && existing.deviceCount > 0 && PROFILE_FIELDS.some((f) => f in patch)) {
      deviceEffect = 'update_profile';
    }

    const ownFields = existing ? patch : fields;
    let action: EvalRow['action'];
    if (errors.length) action = 'error';
    else if (!existing) action = 'create';
    else action = changes.length ? 'update' : 'unchanged';

    const resolvedFields: Partial<Fields> = existing ? { ...patch } : { ...fields };
    void ownFields;
    out.push({
      row: pr.row,
      empCode: code ?? (raw.empCode || null),
      name: (values.name as string | undefined) ?? raw.name ?? existing?.name ?? null,
      action,
      errors,
      warnings,
      changes,
      deviceEffect: action === 'error' ? 'none' : deviceEffect,
      existing,
      fields: resolvedFields,
      ...(wingId !== undefined ? { wingId } : {}),
      ...(sectionId !== undefined ? { sectionId } : {}),
      ...(unknownWing ? { unknownWing } : {}),
      ...(unknownSection ? { unknownSection } : {}),
      ...(statusTo ? { statusTo } : {}),
      backupWarnings,
    });
  }
  return out;
}

async function loadContext(db: Queryable, parsed: Pick<ParsedWorkbook, 'rows' | 'columns'>, scope: WingScope, canPush: boolean, checkBackupRisk: boolean): Promise<EvalContext> {
  const codes: string[] = [];
  const cnics: string[] = [];
  for (const r of parsed.rows) {
    const p = zEmpCode.safeParse(r.raw.empCode ?? '');
    if (p.success) codes.push(p.data);
    const c = r.raw.cnic ? shape.cnic.safeParse(r.raw.cnic) : null;
    if (c?.success && c.data) cnics.push(c.data);
  }
  const existing = new Map((await repo.findByCodes([...new Set(codes)], db)).map((e) => [e.empCode, e] as const));
  const cnicOwners = new Map<string, string>();
  if (cnics.length) {
    const { rows } = await db.query<{ cnic: string; emp_code: string }>('SELECT cnic, emp_code FROM employees WHERE cnic = ANY($1::text[])', [cnics]);
    for (const r of rows) cnicOwners.set(r.cnic, r.emp_code);
  }
  return { rows: parsed.rows, columns: parsed.columns, lookups: new Lookups(await wingRepo.allWithSections(db)), existing, cnicOwners, scope, canPush, checkBackupRisk, db };
}

// ---------------------------------------------------------------------------------------------------------
// Plans (preview -> commit)
// ---------------------------------------------------------------------------------------------------------
interface StoredPlan {
  userId: number;
  fileName: string;
  parsed: ParsedWorkbook;
  expiresAt: number;
}
const plans = new Map<string, StoredPlan>();
const MAX_PLANS_PER_USER = 10;

function sweep(now = Date.now()): void {
  for (const [t, p] of plans) if (p.expiresAt <= now) plans.delete(t);
}

function storePlan(userId: number, fileName: string, parsed: ParsedWorkbook): string {
  sweep();
  const mine = [...plans.entries()].filter(([, p]) => p.userId === userId);
  if (mine.length >= MAX_PLANS_PER_USER) for (const [t] of mine.slice(0, mine.length - MAX_PLANS_PER_USER + 1)) plans.delete(t);
  const token = randomBytes(24).toString('hex');
  plans.set(token, { userId, fileName, parsed, expiresAt: Date.now() + IMPORT_TTL_MS });
  return token;
}

const expired = () => new AppError(410, ErrorCode.IMPORT_EXPIRED, 'This import preview has expired or was already applied. Upload the file again.');

/** Single use and bound to the uploading user: the token is consumed here. */
function takePlan(token: string, userId: number): StoredPlan {
  sweep();
  const p = plans.get(token);
  if (!p || p.userId !== userId) throw expired();
  plans.delete(token);
  return p;
}

/** Test hook: age a token past its expiry. */
export function __expireImportToken(token: string): void {
  const p = plans.get(token);
  if (p) p.expiresAt = Date.now() - 1;
}

export interface ImportCaller {
  userId: number;
  scope: WingScope;
  canPush: boolean;
}

function toImportRow(r: EvalRow): ImportRow {
  return {
    row: r.row,
    empCode: r.empCode,
    name: r.name,
    action: r.action,
    changes: r.changes,
    errors: r.errors,
    warnings: r.warnings,
    deviceEffect: r.deviceEffect,
  };
}

export async function preview(buf: Buffer, fileName: string, caller: ImportCaller): Promise<ImportPreview> {
  const parsed = await parseWorkbook(buf);
  const ctx = await loadContext(pool, parsed, caller.scope, caller.canPush, true);
  const rows = await evaluate(ctx);

  const unknownWings = new Map<string, string>();
  const unknownSections = new Map<string, { wing: string; section: string }>();
  for (const r of rows) {
    if (r.unknownWing) unknownWings.set(r.unknownWing.toLowerCase(), r.unknownWing);
    if (r.unknownSection) unknownSections.set(`${r.unknownSection.wing.toLowerCase()}|${r.unknownSection.section.toLowerCase()}`, r.unknownSection);
  }
  const live = rows.filter((r) => r.action !== 'error');
  const summary = {
    rows: rows.length,
    create: rows.filter((r) => r.action === 'create').length,
    update: rows.filter((r) => r.action === 'update').length,
    unchanged: rows.filter((r) => r.action === 'unchanged').length,
    error: rows.filter((r) => r.action === 'error').length,
    deviceRemove: live.filter((r) => r.deviceEffect === 'remove').length,
    deviceRestore: live.filter((r) => r.deviceEffect === 'restore').length,
    deviceUpdate: live.filter((r) => r.deviceEffect === 'update_profile').length,
  };
  const shownRows = rows.filter((r) => r.action !== 'unchanged').map(toImportRow);
  // The contract has no top-level warnings list, so file-level warnings ride on a header pseudo-row (row 1).
  if (parsed.warnings.length) {
    shownRows.unshift({ row: 1, empCode: null, name: null, action: 'unchanged', changes: [], errors: [], warnings: parsed.warnings, deviceEffect: 'none' });
  }
  return {
    token: storePlan(caller.userId, fileName, parsed),
    fileName,
    summary,
    unknownWings: [...unknownWings.values()],
    unknownSections: [...unknownSections.values()],
    rows: shownRows,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------------------------------------
export interface AppliedRow {
  kind: 'create' | 'update';
  employeeId: number;
  empCode: string;
  name: string;
  changes: AuditChange[];
  /** Non-status changes only (status has its own audit entry). */
  fieldChanges: AuditChange[];
  status?: { from: EmployeeStatus; to: EmployeeStatus; reason: string | null; device: 'remove' | 'restore' | 'none'; queued: number; devices: string[]; backupWarnings: string[] };
  profileQueued: number;
  wing: string | null;
}

export interface CommitOutcome {
  fileName: string;
  result: EmployeeImportResult;
  applied: AppliedRow[];
  failed: { row: number; empCode: string | null; message: string }[];
  createdWings: string[];
  createdSections: string[];
}

export async function commit(token: string, createMissing: boolean, caller: ImportCaller): Promise<CommitOutcome> {
  const plan = takePlan(token, caller.userId);
  return withTransaction(async (client) => {
    let ctx = await loadContext(client, plan.parsed, caller.scope, caller.canPush, false);
    let rows = await evaluate(ctx);
    const createdWings: string[] = [];
    const createdSections: string[] = [];

    if (createMissing && caller.scope === 'all') {
      const needWings = new Map<string, string>();
      const needSections = new Map<string, { wing: string; section: string }>();
      for (const r of rows) {
        if (r.action === 'error') continue;
        if (r.unknownWing) needWings.set(r.unknownWing.toLowerCase(), r.unknownWing);
        if (r.unknownSection) needSections.set(`${r.unknownSection.wing.toLowerCase()}|${r.unknownSection.section.toLowerCase()}`, r.unknownSection);
      }
      for (const name of needWings.values()) {
        await wingRepo.insert({ name, code: null, headName: null }, client);
        createdWings.push(name);
      }
      if (needWings.size) ctx = { ...ctx, lookups: new Lookups(await wingRepo.allWithSections(client)) };
      for (const s of needSections.values()) {
        const w = ctx.lookups.wing(s.wing);
        if (!w || ctx.lookups.section(w, s.section)) continue;
        await wingRepo.insertSection(w.id, s.section, client);
        createdSections.push(`${w.name} / ${s.section}`);
      }
      if (needSections.size) ctx = { ...ctx, lookups: new Lookups(await wingRepo.allWithSections(client)) };
      rows = await evaluate(ctx);
    }

    const applied: AppliedRow[] = [];
    const failed: CommitOutcome['failed'] = [];
    let unchanged = 0;
    let skipped = 0;
    let queued = 0;
    const today = (await client.query<{ d: string }>(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0]?.d ?? null;

    for (const r of rows) {
      if (r.action === 'unchanged') {
        unchanged += 1;
        continue;
      }
      if (r.action === 'error') {
        skipped += 1;
        failed.push({ row: r.row, empCode: r.empCode, message: r.errors[0]?.message ?? 'Invalid row' });
        continue;
      }
      if (r.unknownWing || r.unknownSection) {
        skipped += 1;
        failed.push({ row: r.row, empCode: r.empCode, message: r.unknownWing ? `Wing "${r.unknownWing}" does not exist` : `Section "${r.unknownSection?.section}" does not exist` });
        continue;
      }
      await client.query('SAVEPOINT import_row');
      try {
        const a = await applyRow(client, r, today);
        await client.query('RELEASE SAVEPOINT import_row');
        applied.push(a);
        queued += a.profileQueued + (a.status?.queued ?? 0);
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT import_row');
        const mapped = mapPgError(e);
        skipped += 1;
        failed.push({ row: r.row, empCode: r.empCode, message: mapped instanceof AppError ? mapped.message : e instanceof Error ? e.message : 'Could not apply this row' });
      }
    }

    return {
      fileName: plan.fileName,
      result: {
        created: applied.filter((a) => a.kind === 'create').length,
        updated: applied.filter((a) => a.kind === 'update').length,
        unchanged,
        skipped,
        wingsCreated: createdWings.length,
        sectionsCreated: createdSections.length,
        deviceCommandsQueued: queued,
      },
      applied,
      failed,
      createdWings,
      createdSections,
    };
  });
}

async function applyRow(client: Queryable, r: EvalRow, today: string | null): Promise<AppliedRow> {
  const auditChanges: AuditChange[] = r.changes.map((c) => ({ field: c.label, before: c.before, after: c.after }));
  const fieldChanges = auditChanges.filter((c) => c.field !== HEADER_OF.status);
  const empCode = r.empCode as string;
  let employeeId: number;
  let name: string;
  let kind: AppliedRow['kind'];
  let profileQueued = 0;

  if (!r.existing) {
    kind = 'create';
    const fields = { ...r.fields, empCode, name: (r.fields.name as string | undefined) ?? (r.name as string) };
    employeeId = await repo.insert(fields as Partial<Fields> & { empCode: string; name: string }, client);
    name = fields.name;
  } else {
    kind = 'update';
    employeeId = r.existing.id;
    name = (r.fields.name as string | undefined) ?? r.existing.name;
    if (Object.keys(r.fields).length) await repo.update(employeeId, r.fields, 'all', client);
    const profileChanged = PROFILE_FIELDS.some((f) => f in r.fields);
    const finalStatus = r.statusTo?.status ?? r.existing.status;
    if (profileChanged && r.existing.status === 'active' && finalStatus === 'active') {
      const [profile] = await devSync.profilesByIds(client, [employeeId]);
      if (profile) profileQueued = await devSync.queueProfileUpdate(client, profile, await devSync.holdingDevices(client, profile.emp_code));
    }
  }

  let status: AppliedRow['status'];
  if (r.statusTo) {
    const from: EmployeeStatus = r.existing?.status ?? 'active';
    const o = await applyStatus(client, { id: employeeId, empCode, status: from }, r.statusTo.status, { reason: r.statusTo.reason, leftDate: today, force: true });
    status = { from, to: r.statusTo.status, reason: r.statusTo.reason, device: o.device, queued: o.queued, devices: o.devices.map((d) => d.name), backupWarnings: o.backupWarnings };
  }
  return {
    kind,
    employeeId,
    empCode,
    name,
    changes: auditChanges,
    fieldChanges,
    ...(status ? { status } : {}),
    profileQueued,
    wing: (r.existing?.wingName ?? null),
  };
}
