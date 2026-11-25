/**
 * DEV-ONLY mock of the Phase D endpoints: /wings, /sections, /employees (list, detail, create, update, status,
 * export, import preview + commit) and /attendance. Loaded by auth-mock.ts, which main.tsx imports behind
 * `import.meta.env.DEV`, so none of this reaches a production bundle.
 *
 * Demo hooks:
 *   - "Ali Arslan" (code 1001) is on two devices; disabling shows per-device progress, and the offline third device fails.
 *   - Employees 1003 and 1010 hold biometrics only on a device: disabling them answers 409 NO_BIOMETRIC_BACKUP until forced.
 *   - Employee code 9999 answers 409 EMP_CODE_ON_DEVICE; an existing code answers 409 DUPLICATE_EMP_CODE.
 *   - Any uploaded file is previewed with a realistic set of creates, updates, errors and device effects;
 *     a file whose name contains "bad" answers 400 INVALID_FILE; commit tokens expire after 30 minutes.
 */
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  zEmployeeInput,
  zEmployeeUpdate,
  zSectionInput,
  zStatusChangeInput,
  zWingInput,
  zRemoteEnrollInput,
} from '@nacta/shared';
import type {
  AuditAction,
  DeviceSyncState,
  BiometricTemplate,
  EmployeeBiometrics,
  Employee,
  EmployeeDetail,
  EmployeeImportResult,
  EmployeeStatus,
  ImportPreview,
  ImportRow,
  Permission,
  Section,
  Wing,
} from '@nacta/shared';
import { MOCK_DEVICES } from './audit-mock-data';
import { setPhotoSrcResolver } from '../lib/photo-src';

type Handler = (ctx: { method: string; query: URLSearchParams; body: any; params: string[] }) => Response | Promise<Response>;

export interface EmployeeMockContext {
  can: (p: Permission) => boolean;
  record: (d: { action: AuditAction; entityType?: 'employee' | 'wing' | 'section' | 'import' | 'export'; entityId?: string | null; entityLabel?: string | null; summary: string; metadata?: Record<string, unknown> | null; changes?: { field: string; before: unknown; after: unknown }[] | null }) => void;
}

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'mock-req' } });
const err = (status: number, code: string, message: string, details?: unknown) => json(status, { error: { code, message, details } });
const forbidden = () => err(403, 'FORBIDDEN', 'You do not have permission');
function zodDetails(error: { issues: { path: (string | number)[]; message: string }[] }) {
  const details: Record<string, string> = {};
  for (const i of error.issues) details[String(i.path[0] ?? 'form')] ??= i.message;
  return err(400, 'VALIDATION_ERROR', 'Some values are invalid', details);
}

// ----------------------------------------------------------------------------- wings
interface MWing {
  id: number;
  name: string;
  code: string | null;
  headName: string | null;
  sections: { id: number; name: string }[];
}
let nextWingId = 20;
let nextSectionId = 200;
let wingsData: MWing[] = [
  { id: 1, name: 'Operations Wing', code: 'OPS', headName: 'Brig. (R) Imran Hashmi', sections: [{ id: 11, name: 'Field Operations' }, { id: 12, name: 'Rapid Response' }, { id: 13, name: 'Coordination Cell' }] },
  { id: 2, name: 'Intelligence Wing', code: 'INT', headName: 'Dr. Sadia Khalid', sections: [{ id: 21, name: 'Analysis' }, { id: 22, name: 'Collection' }, { id: 23, name: 'Liaison' }] },
  { id: 3, name: 'Policy & Research Wing', code: 'PRW', headName: 'Mr. Tahir Mehmood', sections: [{ id: 31, name: 'Research' }, { id: 32, name: 'Legal' }, { id: 33, name: 'CVE Programmes' }] },
  { id: 4, name: 'Administration Wing', code: 'ADM', headName: 'Mrs. Rubina Anwar', sections: [{ id: 41, name: 'Establishment' }, { id: 42, name: 'Records' }, { id: 43, name: 'Transport' }, { id: 44, name: 'Protocol' }] },
  { id: 5, name: 'Finance Wing', code: 'FIN', headName: 'Mr. Adeel Zafar', sections: [{ id: 51, name: 'Accounts' }, { id: 52, name: 'Budget' }] },
  { id: 6, name: 'Training Wing', code: 'TRN', headName: null, sections: [] },
];

// ----------------------------------------------------------------------------- employees
interface MEmp {
  id: number;
  empCode: string;
  name: string;
  fatherName: string | null;
  cnic: string | null;
  gender: 'male' | 'female' | null;
  wingId: number | null;
  sectionId: number | null;
  designation: string | null;
  bps: number | null;
  employmentType: Employee['employmentType'];
  status: EmployeeStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  joinDate: string | null;
  leftDate: string | null;
  cardNo: string | null;
  devicePassword: string | null;
  privilege: number;
  phone: string | null;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  address: string | null;
  notes: string | null;
  templates: { fp: number; face: number; bio: number };
  hasPhoto: boolean;
  /** Biometrics exist only on a device (no backup in the app). */
  noBackup: boolean;
  onDevice: number[];
  removedFrom: number[];
  cmds: Record<number, { command: string; at: number; fail?: boolean }>;
  createdAt: string;
  updatedAt: string;
}

let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;

const MALE = ['Ali', 'Hamza', 'Bilal', 'Usman', 'Faisal', 'Kamran', 'Tariq', 'Imran', 'Zeeshan', 'Naveed', 'Adnan', 'Asad', 'Waqas', 'Shahid', 'Rizwan', 'Salman', 'Haris', 'Danish'];
const FEMALE = ['Ayesha', 'Mehwish', 'Nimra', 'Saima', 'Hira', 'Sana', 'Zainab', 'Fatima', 'Maryam', 'Rabia', 'Noor', 'Iqra', 'Amna', 'Sidra'];
const LAST = ['Arslan', 'Khan', 'Siddiqui', 'Mahmood', 'Aslam', 'Yousaf', 'Rehman', 'Qureshi', 'Bukhari', 'Malik', 'Iqbal', 'Raza', 'Farooq', 'Ahmed', 'Butt', 'Chaudhry', 'Hashmi', 'Gillani', 'Awan', 'Zafar'];
const DESIGNATIONS: [string, number | null][] = [
  ['Director', 20], ['Deputy Director', 19], ['Assistant Director', 18], ['Section Officer', 17], ['Analyst', 17], ['Research Officer', 17],
  ['Accounts Officer', 16], ['Private Secretary', 16], ['Assistant', 15], ['Senior Clerk', 14], ['Stenographer', 14], ['Junior Clerk', 11], ['Driver', 6], ['Naib Qasid', 3],
];
const ADDRESSES = ['House 14, Street 8, F-8/3, Islamabad', 'Flat 22, Block C, Gulberg Greens, Islamabad', 'H. No. 301, Sector G-10/2, Islamabad', 'Street 4, Bahria Town Phase 4, Rawalpindi'];

function makeEmployees(): MEmp[] {
  const list: MEmp[] = [];
  const total = 132;
  for (let i = 0; i < total; i++) {
    const female = rnd() < 0.34;
    const first = i === 0 ? 'Ali' : pick(female ? FEMALE : MALE);
    const last = i === 0 ? 'Arslan' : pick(LAST);
    const wing = pick(wingsData);
    const section = wing.sections.length && rnd() < 0.8 ? pick(wing.sections) : null;
    const [designation, bps] = pick(DESIGNATIONS);
    const status: EmployeeStatus = i === 0 ? 'active' : i % 23 === 7 ? 'disabled' : i % 41 === 11 ? 'left' : 'active';
    const fp = rnd() < 0.8 ? 1 + Math.floor(rnd() * 3) : 0;
    const face = rnd() < 0.85 ? 1 : 0;
    const onDevice = status !== 'active' ? [] : i % 17 === 5 ? [] : [1, 2];
    const code = String(1001 + i);
    const digits = String(Math.floor(1e12 + rnd() * 8.9e12)).slice(0, 13);
    const e: MEmp = {
      id: 300 + i,
      empCode: code,
      name: `${first} ${last}`,
      fatherName: `${pick(MALE)} ${last}`,
      cnic: `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`,
      gender: female ? 'female' : 'male',
      wingId: wing.id,
      sectionId: section?.id ?? null,
      designation,
      bps: rnd() < 0.1 ? null : bps,
      employmentType: pick(['regular', 'regular', 'regular', 'contract', 'deputation', 'daily_wages', 'internship'] as const),
      status,
      statusReason: status === 'disabled' ? pick(['Long leave without pay', 'Under inquiry', 'Study leave']) : status === 'left' ? pick(['Retired', 'Transferred to FIA', 'Resigned']) : null,
      statusChangedAt: status === 'active' ? null : iso(1000 + Math.floor(rnd() * 20000)),
      joinDate: `20${String(10 + Math.floor(rnd() * 15)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
      leftDate: status === 'left' ? '2026-10-31' : null,
      cardNo: rnd() < 0.6 ? String(1200000 + Math.floor(rnd() * 800000)).padStart(10, '0') : null,
      devicePassword: null,
      privilege: i % 29 === 3 ? 14 : 0,
      phone: `+92 3${Math.floor(rnd() * 5)}${Math.floor(rnd() * 10)} ${String(Math.floor(1e6 + rnd() * 8.9e6))}`,
      email: rnd() < 0.5 ? `${first}.${last}@nacta.gov.pk`.toLowerCase() : null,
      emergencyContactName: rnd() < 0.5 ? `${pick(MALE)} ${last}` : null,
      emergencyContactPhone: rnd() < 0.5 ? `+92 321 ${String(Math.floor(1e6 + rnd() * 8.9e6))}` : null,
      address: rnd() < 0.5 ? pick(ADDRESSES) : null,
      notes: i === 0 ? 'Focal person for the quarterly review.' : null,
      templates: { fp, face, bio: 0 },
      hasPhoto: rnd() < 0.75,
      noBackup: i === 2 || i === 9,
      onDevice,
      removedFrom: status === 'active' ? [] : [1, 2],
      cmds: {},
      createdAt: iso(40000 - i * 100),
      updatedAt: iso(900 + i * 3),
    };
    list.push(e);
  }
  // pin the demo people
  list[0]!.templates = { fp: 3, face: 1, bio: 0 };
  list[0]!.hasPhoto = true;
  list[2]!.name = 'Kamran Yousaf';
  list[2]!.empCode = '1003';
  list[9]!.empCode = '1010';
  // a few pending / failed commands for the directory
  list[4]!.cmds[1] = { command: 'DATA UPDATE USERINFO', at: Date.now() - 1000 };
  list[6]!.cmds[3] = { command: 'DATA UPDATE USERINFO', at: Date.now() - 600_000, fail: true };
  return list;
}
let emps: MEmp[] = makeEmployees();
let nextEmpId = 5000;

const cmdStatus = (c: { at: number; fail?: boolean }, deviceId: number): 'pending' | 'sent' | 'success' | 'failed' => {
  const age = Date.now() - c.at;
  if (deviceId === 3 || c.fail) return age < 9000 ? (age < 3000 ? 'pending' : 'sent') : 'failed';
  return age < 2500 ? 'pending' : age < 5000 ? 'sent' : 'success';
};

function syncOf(e: MEmp): DeviceSyncState {
  const states = Object.entries(e.cmds).map(([d, c]) => cmdStatus(c, Number(d)));
  if (states.some((s) => s === 'pending' || s === 'sent')) return 'pending';
  if (states.some((s) => s === 'failed')) return 'failed';
  if (e.status === 'active' && e.onDevice.length === 0) return 'not_on_device';
  return 'synced';
}

const wingName = (id: number | null) => wingsData.find((w) => w.id === id)?.name ?? null;
const sectionName = (wid: number | null, sid: number | null) => wingsData.find((w) => w.id === wid)?.sections.find((s) => s.id === sid)?.name ?? null;

function toEmployee(e: MEmp, canSeeCnic: boolean): Employee {
  return {
    id: e.id,
    empCode: e.empCode,
    name: e.name,
    fatherName: e.fatherName,
    cnic: e.cnic ? (canSeeCnic ? e.cnic : `*****-*******-${e.cnic.slice(-1)}`) : null,
    gender: e.gender,
    wingId: e.wingId,
    wingName: wingName(e.wingId),
    sectionId: e.sectionId,
    sectionName: sectionName(e.wingId, e.sectionId),
    designation: e.designation,
    bps: e.bps,
    employmentType: e.employmentType,
    status: e.status,
    statusReason: e.statusReason,
    statusChangedAt: e.statusChangedAt,
    joinDate: e.joinDate,
    leftDate: e.leftDate,
    cardNo: e.cardNo,
    devicePassword: canSeeCnic ? e.devicePassword : null,
    privilege: e.privilege,
    phone: e.phone,
    email: e.email,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    address: e.address,
    notes: e.notes,
    deviceCount: e.onDevice.length,
    deviceSync: syncOf(e),
    templates: e.templates,
    hasPhoto: e.hasPhoto,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function toDetail(e: MEmp, canSee: boolean): EmployeeDetail {
  return {
    ...toEmployee(e, canSee),
    devices: MOCK_DEVICES.map((d) => {
      const c = e.cmds[d.id];
      return {
        deviceId: d.id,
        deviceName: d.name,
        onDevice: e.onDevice.includes(d.id),
        lastCommand: c ? { command: c.command, status: cmdStatus(c, d.id), at: new Date(c.at).toISOString() } : null,
        lastSeenAt: d.status === 'online' ? iso(1) : iso(240),
      };
    }),
  };
}

const wingView = (w: MWing): Wing => ({
  id: w.id,
  name: w.name,
  code: w.code,
  headName: w.headName,
  employeeCount: emps.filter((e) => e.wingId === w.id).length,
  sections: w.sections.map((s): Section => ({ id: s.id, wingId: w.id, name: s.name, employeeCount: emps.filter((e) => e.sectionId === s.id).length })),
  createdAt: iso(9000),
  updatedAt: iso(9000),
});

// ----------------------------------------------------------------------------- import
interface PendingImport {
  at: number;
  rows: ImportRow[];
  newEmps: Partial<MEmp>[];
}
const imports = new Map<string, PendingImport>();

function buildPreview(fileName: string): ImportPreview {
  const active = emps.filter((e) => e.status === 'active');
  const rows: ImportRow[] = [];
  let r = 2;
  const next = () => r++;
  const chg = (field: string, label: string, before: unknown, after: unknown) => ({ field, label, before, after });
  const newEmps: Partial<MEmp>[] = [];

  // creates (two valid, two that need an unknown wing/section)
  const creates = [
    { code: '2101', name: 'Sadaf Naeem', wing: 'Operations Wing', section: 'Rapid Response', des: 'Assistant Director', bps: 18, type: 'Regular' },
    { code: '2102', name: 'Umer Farooq', wing: 'Finance Wing', section: 'Accounts', des: 'Accounts Officer', bps: 16, type: 'Contract' },
    { code: '2103', name: 'Hina Altaf', wing: 'Cyber Wing', section: 'Forensics', des: 'Digital Analyst', bps: 17, type: 'Regular' },
    { code: '2104', name: 'Moiz Ahsan', wing: 'Cyber Wing', section: 'Threat Intel', des: 'Analyst', bps: 17, type: 'Deputation' },
  ];
  for (const c of creates) {
    const unknown = c.wing === 'Cyber Wing';
    rows.push({
      row: next(),
      empCode: c.code,
      name: c.name,
      action: unknown ? 'error' : 'create',
      changes: unknown
        ? []
        : [chg('name', 'Name', null, c.name), chg('wing', 'Wing', null, c.wing), chg('section', 'Section', null, c.section), chg('designation', 'Designation', null, c.des), chg('bps', 'BPS', null, c.bps), chg('employmentType', 'Employment Type', null, c.type)],
      errors: unknown ? [{ field: 'Wing', message: `Wing "${c.wing}" does not exist (create it, or fix the name)` }] : [],
      warnings: c.code === '2102' ? ['Name is longer than 24 characters on devices: it will be cut'] : [],
      deviceEffect: unknown ? 'none' : 'add',
    });
    if (!unknown) newEmps.push({ empCode: c.code, name: c.name, designation: c.des, bps: c.bps, wingId: wingsData.find((w) => w.name === c.wing)?.id ?? null, sectionId: wingsData.find((w) => w.name === c.wing)?.sections.find((s) => s.name === c.section)?.id ?? null });
  }

  // updates
  const updPeople = active.slice(10, 22);
  updPeople.forEach((e, i) => {
    const changes = [] as ImportRow['changes'];
    if (i % 3 === 0) changes.push(chg('designation', 'Designation', e.designation, `Senior ${e.designation ?? 'Officer'}`));
    if (i % 3 === 0 && e.bps) changes.push(chg('bps', 'BPS', e.bps, Math.min(22, e.bps + 1)));
    if (i % 3 === 1) changes.push(chg('phone', 'Phone', e.phone, `+92 300 ${String(7000000 + i * 1111)}`));
    if (i % 3 === 1) changes.push(chg('email', 'Email', e.email, `${e.name.split(' ')[0]?.toLowerCase()}@nacta.gov.pk`));
    if (i % 3 === 2) {
      const w = wingsData[(i + 1) % 4]!;
      changes.push(chg('wing', 'Wing', wingName(e.wingId), w.name), chg('section', 'Section', sectionName(e.wingId, e.sectionId), w.sections[0]?.name ?? null));
    }
    if (i === 4) changes.push(chg('cardNo', 'Card No', e.cardNo, null), chg('address', 'Address', e.address, 'House 9, Street 2, E-11/4, Islamabad'), chg('notes', 'Notes', e.notes, 'Updated via spreadsheet'));
    rows.push({
      row: next(),
      empCode: e.empCode,
      name: e.name,
      action: 'update',
      changes,
      errors: [],
      warnings: [],
      deviceEffect: changes.some((c) => ['cardNo'].includes(c.field)) && e.onDevice.length ? 'update_profile' : 'none',
    });
  });

  // status changes
  const toDisable = active.slice(30, 33);
  toDisable.forEach((e, i) =>
    rows.push({
      row: next(),
      empCode: e.empCode,
      name: e.name,
      action: 'update',
      changes: [chg('status', 'Status', 'Active', i === 2 ? 'Left' : 'Disabled'), chg('statusReason', 'Status Reason', null, i === 2 ? 'Retired' : 'Long leave')],
      errors: [],
      warnings: e.noBackup ? ['Biometrics exist only on a device. Disabling will need a re-enrolment'] : [],
      deviceEffect: e.onDevice.length ? 'remove' : 'none',
    }),
  );
  const disabled = emps.filter((e) => e.status === 'disabled').slice(0, 2);
  disabled.forEach((e) =>
    rows.push({
      row: next(),
      empCode: e.empCode,
      name: e.name,
      action: 'update',
      changes: [chg('status', 'Status', 'Disabled', 'Active'), chg('statusReason', 'Status Reason', e.statusReason, null)],
      errors: [],
      warnings: [],
      deviceEffect: 'restore',
    }),
  );

  // errors
  rows.push({ row: next(), empCode: active[40]!.empCode, name: active[40]!.name, action: 'error', changes: [], errors: [{ field: 'CNIC', message: 'CNIC must be 13 digits' }], warnings: [], deviceEffect: 'none' });
  rows.push({ row: next(), empCode: active[41]!.empCode, name: active[41]!.name, action: 'error', changes: [], errors: [{ field: 'BPS', message: 'BPS is 1-22' }, { field: 'Section', message: 'Section "Records" does not belong to wing "Finance Wing"' }], warnings: [], deviceEffect: 'none' });
  rows.push({ row: next(), empCode: null, name: 'Row without code', action: 'error', changes: [], errors: [{ field: 'Employee Code', message: 'Employee Code is required' }], warnings: [], deviceEffect: 'none' });
  rows.push({ row: next(), empCode: active[42]!.empCode, name: active[42]!.name, action: 'error', changes: [], errors: [{ field: 'Employment Type', message: `Use one of: ${EMPLOYMENT_TYPES.map((t) => EMPLOYMENT_TYPE_LABEL[t]).join(', ')}` }], warnings: ['Phone looks short'], deviceEffect: 'none' });

  // enough extra updates to exercise pagination
  active.slice(50, 90).forEach((e) =>
    rows.push({ row: next(), empCode: e.empCode, name: e.name, action: 'update', changes: [chg('designation', 'Designation', e.designation, `${e.designation ?? 'Officer'} (Acting)`)], errors: [], warnings: [], deviceEffect: 'none' }),
  );

  const count = (a: ImportRow['action']) => rows.filter((x) => x.action === a).length;
  const fx = (k: ImportRow['deviceEffect']) => rows.filter((x) => x.deviceEffect === k).length;
  const unchanged = Math.max(0, emps.length - rows.filter((x) => x.action !== 'create').length);
  const token = `imp_${Math.random().toString(36).slice(2, 12)}`;
  imports.set(token, { at: Date.now(), rows, newEmps });
  return {
    token,
    fileName,
    summary: { rows: rows.length + unchanged, create: count('create'), update: count('update'), unchanged, error: count('error'), deviceRemove: fx('remove'), deviceRestore: fx('restore'), deviceUpdate: fx('update_profile') },
    unknownWings: ['Cyber Wing'],
    unknownSections: [{ wing: 'Cyber Wing', section: 'Forensics' }, { wing: 'Cyber Wing', section: 'Threat Intel' }],
    rows,
  };
}

// ----------------------------------------------------------------------------- attendance
interface MPunch {
  id: number;
  deviceId: number;
  pin: string;
  punchTime: string;
  status: number;
  verifyType: number;
}
let punches: MPunch[] | null = null;
const pad = (n: number) => String(n).padStart(2, '0');
function getPunches(): MPunch[] {
  if (punches) return punches;
  const out: MPunch[] = [];
  let id = 1;
  const now = new Date();
  for (let d = 0; d < 3; d++) {
    const day = new Date(now.getTime() - d * 86_400_000);
    const ymd = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    for (const e of emps.filter((x) => x.status === 'active' && x.onDevice.length > 0).slice(0, 70)) {
      const inH = 8 + Math.floor(rnd() * 2);
      out.push({ id: id++, deviceId: pick(e.onDevice), pin: e.empCode, punchTime: `${ymd} ${pad(inH)}:${pad(Math.floor(rnd() * 59))}:${pad(Math.floor(rnd() * 59))}`, status: 0, verifyType: pick([1, 15, 15, 2]) });
      out.push({ id: id++, deviceId: pick(e.onDevice), pin: e.empCode, punchTime: `${ymd} ${pad(16 + Math.floor(rnd() * 2))}:${pad(Math.floor(rnd() * 59))}:${pad(Math.floor(rnd() * 59))}`, status: 1, verifyType: pick([1, 15]) });
    }
  }
  out.push({ id: id++, deviceId: 2, pin: '4821', punchTime: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 09:12:44`, status: 0, verifyType: 1 });
  punches = out.sort((a, b) => b.punchTime.localeCompare(a.punchTime));
  return punches;
}

// ----------------------------------------------------------------------------- routes
export function createEmployeeRoutes(ctx: EmployeeMockContext): [RegExp, Handler][] {
  const page = <T,>(rows: T[], q: URLSearchParams) => {
    const p = Number(q.get('page')) || 1;
    const ps = Number(q.get('pageSize')) || 50;
    return json(200, { items: rows.slice((p - 1) * ps, p * ps), total: rows.length, page: p, pageSize: ps });
  };

  const filterEmps = (q: URLSearchParams): MEmp[] => {
    const text = q.get('q')?.trim().toLowerCase();
    const wing = Number(q.get('wingId')) || null;
    const section = Number(q.get('sectionId')) || null;
    const status = q.get('status');
    const type = q.get('employmentType');
    const bio = q.get('biometrics');
    const sync = q.get('deviceSync');
    return emps.filter((e) => {
      if (wing && e.wingId !== wing) return false;
      if (section && e.sectionId !== section) return false;
      if (status && e.status !== status) return false;
      if (type && e.employmentType !== type) return false;
      if (sync && syncOf(e) !== sync) return false;
      if (bio === 'has_fingerprint' && e.templates.fp === 0) return false;
      if (bio === 'has_face' && e.templates.face === 0) return false;
      if (bio === 'has_photo' && !e.hasPhoto) return false;
      if (bio === 'none' && (e.templates.fp > 0 || e.templates.face > 0 || e.hasPhoto)) return false;
      if (text && !`${e.name} ${e.empCode} ${e.cnic ?? ''} ${e.cardNo ?? ''}`.toLowerCase().includes(text)) return false;
      return true;
    });
  };

  const sortEmps = (rows: MEmp[], q: URLSearchParams) => {
    const sort = q.get('sort') ?? 'empCode';
    const dir = q.get('order') === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'name': return a.name.localeCompare(b.name) * dir;
        case 'wing': return (wingName(a.wingId) ?? '~').localeCompare(wingName(b.wingId) ?? '~') * dir;
        case 'bps': return ((a.bps ?? 0) - (b.bps ?? 0)) * dir;
        case 'joinDate': return (a.joinDate ?? '').localeCompare(b.joinDate ?? '') * dir;
        case 'createdAt': return a.createdAt.localeCompare(b.createdAt) * dir;
        default: return (Number(a.empCode) - Number(b.empCode)) * dir;
      }
    });
  };

  /** Validates org consistency and returns a 400 when the section is not in the wing. */
  const orgProblem = (wingId: number | null | undefined, sectionId: number | null | undefined) => {
    if (sectionId && !wingId) return err(400, 'VALIDATION_ERROR', 'Some values are invalid', { sectionId: 'Choose a wing first' });
    if (sectionId && !wingsData.find((w) => w.id === wingId)?.sections.some((s) => s.id === sectionId)) return err(400, 'VALIDATION_ERROR', 'Some values are invalid', { sectionId: 'This section does not belong to the chosen wing' });
    return null;
  };

  const codeProblem = (code: string, selfId?: number) => {
    if (code === '9999') return err(409, 'EMP_CODE_ON_DEVICE', 'PIN 9999 is already used on Main Gate Terminal by someone who is not in the directory');
    if (emps.some((e) => e.empCode === code && e.id !== selfId)) return err(409, 'DUPLICATE_EMP_CODE', `Employee code ${code} is already in use`);
    return null;
  };

  const touchProfile = (e: MEmp) => {
    // Editing someone who is on devices re-sends their profile.
    for (const d of e.onDevice) e.cmds[d] = { command: 'DATA UPDATE USERINFO', at: Date.now() };
    e.updatedAt = new Date().toISOString();
  };

  return [
    ...biometricRoutes(ctx),
    // ---- wings & sections
    [/^\/wings$/, ({ method, body }) => {
      if (method === 'GET') return json(200, wingsData.map(wingView));
      if (!ctx.can('wings.manage')) return forbidden();
      const p = zWingInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (wingsData.some((w) => w.name.toLowerCase() === p.data.name.toLowerCase())) return err(409, 'DUPLICATE_WING', 'A wing with this name already exists', { name: 'A wing with this name already exists' });
      if (p.data.code && wingsData.some((w) => w.code === p.data.code)) return err(409, 'DUPLICATE_WING', 'A wing with this code already exists', { code: 'A wing with this code already exists' });
      const w: MWing = { id: nextWingId++, name: p.data.name, code: p.data.code, headName: p.data.headName, sections: [] };
      wingsData = [...wingsData, w];
      ctx.record({ action: 'wing.create', entityType: 'wing', entityId: String(w.id), entityLabel: w.name, summary: `Created wing “${w.name}”` });
      return json(201, wingView(w));
    }],
    [/^\/wings\/(\d+)$/, ({ method, body, params }) => {
      if (!ctx.can('wings.manage')) return forbidden();
      const id = Number(params[0]);
      const w = wingsData.find((x) => x.id === id);
      if (!w) return err(404, 'NOT_FOUND', 'Wing not found');
      if (method === 'DELETE') {
        emps.forEach((e) => {
          if (e.wingId === id) {
            e.wingId = null;
            e.sectionId = null;
          }
        });
        wingsData = wingsData.filter((x) => x.id !== id);
        ctx.record({ action: 'wing.delete', entityType: 'wing', entityId: String(id), entityLabel: w.name, summary: `Deleted wing “${w.name}”` });
        return json(204, undefined);
      }
      const p = zWingInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (wingsData.some((x) => x.id !== id && x.name.toLowerCase() === p.data.name.toLowerCase())) return err(409, 'DUPLICATE_WING', 'A wing with this name already exists', { name: 'A wing with this name already exists' });
      if (p.data.code && wingsData.some((x) => x.id !== id && x.code === p.data.code)) return err(409, 'DUPLICATE_WING', 'A wing with this code already exists', { code: 'A wing with this code already exists' });
      Object.assign(w, { name: p.data.name, code: p.data.code, headName: p.data.headName });
      ctx.record({ action: 'wing.update', entityType: 'wing', entityId: String(id), entityLabel: w.name, summary: `Edited wing “${w.name}”` });
      return json(200, wingView(w));
    }],
    [/^\/wings\/(\d+)\/sections$/, ({ body, params }) => {
      if (!ctx.can('wings.manage')) return forbidden();
      const w = wingsData.find((x) => x.id === Number(params[0]));
      if (!w) return err(404, 'NOT_FOUND', 'Wing not found');
      const p = zSectionInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (w.sections.some((s) => s.name.toLowerCase() === p.data.name.toLowerCase())) return err(409, 'DUPLICATE_SECTION', 'This wing already has a section with that name', { name: 'This wing already has a section with that name' });
      const s = { id: nextSectionId++, name: p.data.name };
      w.sections = [...w.sections, s];
      ctx.record({ action: 'section.create', entityType: 'section', entityId: String(s.id), entityLabel: `${w.name} / ${s.name}`, summary: `Created section “${s.name}” in ${w.name}` });
      return json(201, { id: s.id, wingId: w.id, name: s.name, employeeCount: 0 } satisfies Section);
    }],
    [/^\/sections\/(\d+)$/, ({ method, body, params }) => {
      if (!ctx.can('wings.manage')) return forbidden();
      const id = Number(params[0]);
      const w = wingsData.find((x) => x.sections.some((s) => s.id === id));
      const s = w?.sections.find((x) => x.id === id);
      if (!w || !s) return err(404, 'NOT_FOUND', 'Section not found');
      if (method === 'DELETE') {
        emps.forEach((e) => {
          if (e.sectionId === id) e.sectionId = null;
        });
        w.sections = w.sections.filter((x) => x.id !== id);
        ctx.record({ action: 'section.delete', entityType: 'section', entityId: String(id), entityLabel: `${w.name} / ${s.name}`, summary: `Deleted section “${s.name}” from ${w.name}` });
        return json(204, undefined);
      }
      const p = zSectionInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (w.sections.some((x) => x.id !== id && x.name.toLowerCase() === p.data.name.toLowerCase())) return err(409, 'DUPLICATE_SECTION', 'This wing already has a section with that name', { name: 'This wing already has a section with that name' });
      const before = s.name;
      s.name = p.data.name;
      ctx.record({ action: 'section.update', entityType: 'section', entityId: String(id), entityLabel: `${w.name} / ${s.name}`, summary: `Renamed section “${before}” to “${s.name}”`, changes: [{ field: 'name', before, after: s.name }] });
      return json(200, { id, wingId: w.id, name: s.name, employeeCount: emps.filter((e) => e.sectionId === id).length } satisfies Section);
    }],

    // ---- employees: export / import / push (must precede /employees/:id)
    [/^\/employees\/export\.xlsx$/, ({ query }) => {
      if (!ctx.can('employees.import')) return forbidden();
      const rows = sortEmps(filterEmps(query), query);
      const header = ['Employee Code', 'Name', "Father's Name", 'CNIC', 'Gender', 'Wing', 'Section', 'Designation', 'BPS', 'Employment Type', 'Status'];
      const lines = [header.join('\t'), ...rows.map((e) => [e.empCode, e.name, e.fatherName ?? '', e.cnic ?? '', e.gender ?? '', wingName(e.wingId) ?? '', sectionName(e.wingId, e.sectionId) ?? '', e.designation ?? '', e.bps ?? '', e.employmentType ?? '', e.status].join('\t'))];
      ctx.record({ action: 'employee.export', entityType: 'export', entityLabel: 'Employee export', summary: `Exported ${rows.length} employees to Excel`, metadata: { rows: rows.length, filters: Object.fromEntries(query) } });
      // Not a real workbook: a stand-in so the browser download flow can be exercised against the mock.
      return new Response(lines.join('\r\n'), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="nacta-employees-${new Date().toISOString().slice(0, 10)}.xlsx"` },
      });
    }],
    [/^\/employees\/import\/preview$/, async ({ body }) => {
      if (!ctx.can('employees.import') || !ctx.can('employees.manage')) return forbidden();
      const file = body instanceof FormData ? body.get('file') : null;
      if (!(file instanceof File)) return err(400, 'INVALID_FILE', 'No file was uploaded (expected a field named "file")');
      if (file.size > 10 * 1024 * 1024) return err(400, 'INVALID_FILE', 'The file is larger than 10 MB');
      if (/bad/i.test(file.name)) return err(400, 'INVALID_FILE', 'This is not a valid .xlsx workbook, or it has no "Employees" sheet with an "Employee Code" column.');
      await new Promise((r) => setTimeout(r, 900));
      return json(200, buildPreview(file.name));
    }],
    [/^\/employees\/import\/commit$/, async ({ body }) => {
      if (!ctx.can('employees.import') || !ctx.can('employees.manage')) return forbidden();
      const pending = imports.get(String(body?.token ?? ''));
      if (!pending || Date.now() - pending.at > 30 * 60_000) return err(410, 'IMPORT_EXPIRED', 'This import preview has expired. Upload the file again.');
      imports.delete(String(body?.token));
      await new Promise((r) => setTimeout(r, 700));
      const createMissing = body?.createMissing === true;
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let queued = 0;
      let wingsCreated = 0;
      let sectionsCreated = 0;
      for (const row of pending.rows) {
        const unknownOrg = row.errors.some((er) => /does not exist/.test(er.message));
        if (row.action === 'error' && !(createMissing && unknownOrg)) {
          skipped++;
          continue;
        }
        if (row.action === 'error') {
          // createMissing turns "unknown wing" rows into creates
          let w = wingsData.find((x) => x.name === 'Cyber Wing');
          if (!w) {
            w = { id: nextWingId++, name: 'Cyber Wing', code: null, headName: null, sections: [] };
            wingsData = [...wingsData, w];
            wingsCreated++;
          }
          const secName = row.empCode === '2103' ? 'Forensics' : 'Threat Intel';
          let s = w.sections.find((x) => x.name === secName);
          if (!s) {
            s = { id: nextSectionId++, name: secName };
            w.sections = [...w.sections, s];
            sectionsCreated++;
          }
          emps.push(blankEmp(row.empCode ?? String(nextEmpId), row.name ?? 'New employee', { wingId: w.id, sectionId: s.id, designation: row.empCode === '2103' ? 'Digital Analyst' : 'Analyst', bps: 17 }));
          created++;
          continue;
        }
        if (row.action === 'create') {
          const n = pending.newEmps.find((x) => x.empCode === row.empCode) ?? {};
          const e = blankEmp(row.empCode ?? String(nextEmpId), row.name ?? 'New employee', n);
          e.cmds = Object.fromEntries([1, 2].map((d) => [d, { command: 'DATA UPDATE USERINFO', at: Date.now() }]));
          e.onDevice = [1, 2];
          emps.push(e);
          created++;
          queued += 2;
          continue;
        }
        if (row.action === 'update') {
          const e = emps.find((x) => x.empCode === row.empCode);
          if (!e) continue;
          for (const c of row.changes) {
            if (c.field === 'designation') e.designation = (c.after as string | null) ?? null;
            if (c.field === 'bps') e.bps = (c.after as number | null) ?? null;
            if (c.field === 'phone') e.phone = (c.after as string | null) ?? null;
            if (c.field === 'email') e.email = (c.after as string | null) ?? null;
            if (c.field === 'cardNo') e.cardNo = (c.after as string | null) ?? null;
            if (c.field === 'wing') {
              const w = wingsData.find((x) => x.name === c.after);
              e.wingId = w?.id ?? null;
              e.sectionId = null;
            }
            if (c.field === 'section') e.sectionId = wingsData.find((x) => x.id === e.wingId)?.sections.find((x) => x.name === c.after)?.id ?? null;
            if (c.field === 'status') applyStatus(e, String(c.after).toLowerCase() as EmployeeStatus, row.changes.find((x) => x.field === 'statusReason')?.after as string | null);
          }
          if (row.deviceEffect !== 'none') queued += 2;
          e.updatedAt = new Date().toISOString();
          updated++;
        }
      }
      const result: EmployeeImportResult = { created, updated, unchanged: Math.max(0, emps.length - created - updated), skipped, wingsCreated, sectionsCreated, deviceCommandsQueued: queued };
      ctx.record({ action: 'employee.import', entityType: 'import', entityLabel: 'Employee import', summary: `Imported employees from Excel: ${created} added, ${updated} updated, ${skipped} skipped`, metadata: { ...result } });
      return json(200, result);
    }],
    [/^\/employees\/push$/, ({ body }) => {
      if (!ctx.can('employees.push')) return forbidden();
      const ids: number[] | 'all' = body?.employeeIds;
      const list = ids === 'all' ? emps.filter((e) => e.status === 'active') : emps.filter((e) => Array.isArray(ids) && ids.includes(e.id) && e.status === 'active');
      list.forEach((e) => {
        e.onDevice = [1, 2];
        e.cmds[1] = { command: 'DATA UPDATE USERINFO', at: Date.now() };
        e.cmds[2] = { command: 'DATA UPDATE USERINFO', at: Date.now() };
      });
      ctx.record({ action: 'employee.push', entityType: 'employee', summary: `Sent ${list.length} employees to devices` });
      return json(200, { queued: list.length * 2 });
    }],
    [/^\/employees\/(\d+)\/status$/, ({ body, params }) => {
      if (!ctx.can('employees.manage') || !ctx.can('employees.push')) return forbidden();
      const e = emps.find((x) => x.id === Number(params[0]));
      if (!e) return err(404, 'NOT_FOUND', 'Employee not found');
      const p = zStatusChangeInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (p.data.status !== 'active' && e.status === 'active' && e.noBackup && !p.data.force) {
        return err(409, 'NO_BIOMETRIC_BACKUP', `${e.name}'s fingerprints are only on a device and the app has no copy, so they could not be backed up first.`);
      }
      const before = e.status;
      applyStatus(e, p.data.status, p.data.reason, p.data.effectiveDate);
      if (p.data.force && p.data.status !== 'active') {
        e.templates = { fp: 0, face: 0, bio: 0 };
        e.noBackup = false;
      }
      ctx.record({ action: 'employee.status', entityType: 'employee', entityId: String(e.id), entityLabel: `${e.empCode} · ${e.name}`, summary: `Changed status of ${e.name} from ${before} to ${e.status}`, changes: [{ field: 'status', before, after: e.status }], metadata: { reason: p.data.reason ?? null, force: p.data.force } });
      return json(200, toDetail(e, ctx.can('employees.manage')));
    }],

    // ---- employees: list / create / detail / update / delete
    [/^\/employees$/, ({ method, query, body }) => {
      if (method === 'POST') {
        if (!ctx.can('employees.manage')) return forbidden();
        const p = zEmployeeInput.safeParse(body);
        if (!p.success) return zodDetails(p.error);
        const bad = codeProblem(p.data.empCode) ?? orgProblem(p.data.wingId, p.data.sectionId);
        if (bad) return bad;
        const e = blankEmp(p.data.empCode, p.data.name, { ...p.data });
        emps.push(e);
        ctx.record({ action: 'employee.create', entityType: 'employee', entityId: String(e.id), entityLabel: `${e.empCode} · ${e.name}`, summary: `Added employee ${e.empCode} · ${e.name}` });
        return json(201, toEmployee(e, true));
      }
      const rows = sortEmps(filterEmps(query), query);
      const can = ctx.can('employees.manage');
      const p = Number(query.get('page')) || 1;
      const ps = Number(query.get('pageSize')) || 50;
      return json(200, { items: rows.slice((p - 1) * ps, p * ps).map((e) => toEmployee(e, can)), total: rows.length, page: p, pageSize: ps });
    }],
    [/^\/employees\/(\d+)$/, ({ method, body, params }) => {
      const e = emps.find((x) => x.id === Number(params[0]));
      if (!e) return err(404, 'NOT_FOUND', 'Employee not found');
      if (method === 'GET') return json(200, toDetail(e, ctx.can('employees.manage')));
      if (!ctx.can('employees.manage')) return forbidden();
      if (method === 'DELETE') {
        emps = emps.filter((x) => x.id !== e.id);
        ctx.record({ action: 'employee.delete', entityType: 'employee', entityId: String(e.id), entityLabel: `${e.empCode} · ${e.name}`, summary: `Deleted employee ${e.empCode} · ${e.name}` });
        return json(204, undefined);
      }
      const p = zEmployeeUpdate.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      const d = p.data;
      const wingId = d.wingId !== undefined ? d.wingId : e.wingId;
      const sectionId = d.sectionId !== undefined ? d.sectionId : e.sectionId;
      const bad = (d.empCode !== undefined ? codeProblem(d.empCode, e.id) : null) ?? orgProblem(wingId, sectionId);
      if (bad) return bad;
      const changes: { field: string; before: unknown; after: unknown }[] = [];
      for (const [k, v] of Object.entries(d)) {
        const cur = (e as unknown as Record<string, unknown>)[k];
        if (v !== undefined && JSON.stringify(cur) !== JSON.stringify(v)) {
          changes.push({ field: k, before: cur, after: v });
          (e as unknown as Record<string, unknown>)[k] = v;
        }
      }
      if (changes.length) touchProfile(e);
      ctx.record({ action: 'employee.update', entityType: 'employee', entityId: String(e.id), entityLabel: `${e.empCode} · ${e.name}`, summary: `Edited employee ${e.empCode} · ${e.name}`, changes });
      return json(200, toEmployee(e, true));
    }],

    // ---- attendance (wing + section on every row)
    [/^\/attendance$/, ({ query }) => {
      const text = query.get('q')?.toLowerCase();
      const wing = Number(query.get('wingId')) || null;
      const section = Number(query.get('sectionId')) || null;
      const device = Number(query.get('deviceId')) || null;
      const empId = Number(query.get('employeeId')) || null;
      const from = query.get('from');
      const to = query.get('to');
      const byPin = new Map(emps.map((e) => [e.empCode, e]));
      const rows = getPunches()
        .map((pt) => {
          const e = byPin.get(pt.pin) ?? null;
          const d = MOCK_DEVICES.find((x) => x.id === pt.deviceId)!;
          return {
            id: pt.id,
            deviceId: pt.deviceId,
            deviceName: d.name,
            pin: pt.pin,
            employeeId: e?.id ?? null,
            employeeName: e?.name ?? null,
            wingName: e ? wingName(e.wingId) : null,
            sectionName: e ? sectionName(e.wingId, e.sectionId) : null,
            punchTime: pt.punchTime,
            status: pt.status,
            verifyType: pt.verifyType,
            workCode: null,
            receivedAt: new Date(pt.punchTime.replace(' ', 'T')).toISOString(),
            _wing: e?.wingId ?? null,
            _section: e?.sectionId ?? null,
          };
        })
        .filter((r) => (!wing || r._wing === wing) && (!section || r._section === section) && (!device || r.deviceId === device) && (!empId || r.employeeId === empId) && (!from || r.punchTime.slice(0, 10) >= from) && (!to || r.punchTime.slice(0, 10) <= to) && (!text || `${r.employeeName ?? ''} ${r.pin}`.toLowerCase().includes(text)))
        .sort((a, b) => (query.get('order') === 'asc' ? a.punchTime.localeCompare(b.punchTime) : b.punchTime.localeCompare(a.punchTime)))
        .map(({ _wing: _w, _section: _s, ...r }) => r);
      return page(rows, query);
    }],
  ];
}

function blankEmp(code: string, name: string, rest: Partial<MEmp>): MEmp {
  return {
    id: nextEmpId++,
    empCode: code,
    name,
    fatherName: null,
    cnic: null,
    gender: null,
    wingId: null,
    sectionId: null,
    designation: null,
    bps: null,
    employmentType: null,
    status: 'active',
    statusReason: null,
    statusChangedAt: null,
    joinDate: null,
    leftDate: null,
    cardNo: null,
    devicePassword: null,
    privilege: 0,
    phone: null,
    email: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    address: null,
    notes: null,
    templates: { fp: 0, face: 0, bio: 0 },
    hasPhoto: false,
    noBackup: false,
    onDevice: [],
    removedFrom: [],
    cmds: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...rest,
  };
}

function applyStatus(e: MEmp, to: EmployeeStatus, reason?: string | null, effectiveDate?: string) {
  const now = Date.now();
  if (to === 'active') {
    const target = e.removedFrom.length ? e.removedFrom : [1, 2];
    for (const d of target) e.cmds[d] = { command: 'DATA UPDATE USERINFO (user, fingerprints, face, photo)', at: now };
    e.onDevice = target;
    e.removedFrom = [];
    e.leftDate = null;
  } else if (e.status === 'active') {
    for (const d of e.onDevice) e.cmds[d] = { command: 'DATA DELETE USERINFO', at: now };
    // the offline third terminal still holds them: its removal fails after a while
    if (e.onDevice.length > 0) e.cmds[3] = { command: 'DATA DELETE USERINFO', at: now };
    e.removedFrom = e.onDevice;
    e.onDevice = [];
  }
  e.status = to;
  e.statusReason = reason?.trim() || null;
  e.statusChangedAt = new Date(now).toISOString();
  if (to === 'left') e.leftDate = effectiveDate ?? new Date().toISOString().slice(0, 10);
  e.updatedAt = new Date(now).toISOString();
}


// ----------------------------------------------------------------------------- biometrics (Phase E)
interface MAct {
  commandId: number;
  deviceId: number;
  command: string;
  at: number;
  /** Enrolment only: when the template appears. */
  arrivesAt?: number;
  kind?: 'finger' | 'face';
  fingerIndex?: number;
  processed?: boolean;
}
interface MBio {
  fingers: BiometricTemplate[];
  faces: BiometricTemplate[];
  photo: { source: 'device' | 'app'; deviceName: string | null; sizeBytes: number; updatedAt: string; dataUrl: string | null } | null;
  activity: MAct[];
}
const bioStore = new Map<number, MBio>();
let nextCmdId = 9000;
let nextTplId = 70000;
const FINGER_ORDER = [6, 5, 7, 3, 2, 8, 4, 1, 9, 0];

/** Generated portrait placeholder (SVG data URI): tinted background, head and shoulders. */
export function placeholderPhoto(id: number, name: string): string {
  const hue = (id * 47) % 360;
  const initials = name.split(/\s+/).map((p) => p[0] ?? '').slice(0, 2).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 35% 78%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360} 40% 58%)"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><path d="M80 600c0-130 90-200 220-200s220 70 220 200z" fill="hsl(${(hue + 200) % 360} 30% 30%)"/><rect x="262" y="330" width="76" height="80" rx="30" fill="hsl(28 40% 62%)"/><ellipse cx="300" cy="250" rx="92" ry="112" fill="hsl(28 42% 68%)"/><path d="M205 232c4-80 62-116 110-108 52 8 84 52 80 108-24-34-52-52-92-54-40-2-74 14-98 54z" fill="hsl(${(hue + 20) % 360} 25% 18%)"/><text x="300" y="568" text-anchor="middle" font-family="sans-serif" font-size="30" fill="rgba(255,255,255,.7)">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function bioOf(e: MEmp): MBio {
  let b = bioStore.get(e.id);
  if (b) return b;
  const seedDevice = 'Attendance Basement';
  const fingers: BiometricTemplate[] = FINGER_ORDER.slice(0, e.templates.fp).map((idx, n) => ({
    id: e.id * 100 + idx,
    kind: 'finger',
    fingerIndex: idx,
    bioType: 1,
    version: '13.0',
    valid: true,
    sizeBytes: 1536,
    source: 'device',
    sourceDeviceName: seedDevice,
    updatedAt: iso(14000 + n * 90),
  }));
  const faces: BiometricTemplate[] =
    e.templates.face > 0
      ? [{ id: e.id * 100 + 90, kind: 'face', fingerIndex: null, bioType: 9, version: '40.1', valid: true, sizeBytes: 4096, source: 'device', sourceDeviceName: seedDevice, updatedAt: iso(14100) }]
      : [];
  b = {
    fingers,
    faces,
    photo: e.hasPhoto ? { source: 'device', deviceName: seedDevice, sizeBytes: 54_000, updatedAt: iso(14200), dataUrl: null } : null,
    activity: e.id === 300 ? [{ commandId: 8001, deviceId: 1, command: 'DATA UPDATE USERPIC', at: Date.now() - 86_400_000 }, { commandId: 8000, deviceId: 2, command: 'ENROLL_FP', at: Date.now() - 90_000_000, kind: 'finger', fingerIndex: 3, arrivesAt: 0, processed: true }] : [],
  };
  bioStore.set(e.id, b);
  return b;
}

const actStatus = (a: MAct): 'pending' | 'sent' | 'success' | 'failed' => {
  const age = Date.now() - a.at;
  if (a.deviceId === 3) return age < 3000 ? 'pending' : age < 9000 ? 'sent' : 'failed';
  if (a.arrivesAt !== undefined) return age < 2500 ? 'pending' : Date.now() < a.arrivesAt ? 'sent' : 'success';
  return age < 2500 ? 'pending' : age < 5000 ? 'sent' : 'success';
};

function syncCounts(e: MEmp, b: MBio) {
  e.templates = { fp: b.fingers.length, face: b.faces.length, bio: 0 };
  e.hasPhoto = b.photo !== null;
}

/** Applies enrolments whose template "arrives" from the terminal. */
function settle(e: MEmp, b: MBio) {
  for (const a of b.activity) {
    if (a.processed || a.arrivesAt === undefined || a.deviceId === 3 || Date.now() < a.arrivesAt) continue;
    a.processed = true;
    const dev = MOCK_DEVICES.find((d) => d.id === a.deviceId)?.name ?? null;
    const tpl: BiometricTemplate =
      a.kind === 'face'
        ? { id: nextTplId++, kind: 'face', fingerIndex: null, bioType: 9, version: '40.1', valid: true, sizeBytes: 4096, source: 'device', sourceDeviceName: dev, updatedAt: new Date().toISOString() }
        : { id: nextTplId++, kind: 'finger', fingerIndex: a.fingerIndex ?? 0, bioType: 1, version: '13.0', valid: true, sizeBytes: 1536, source: 'device', sourceDeviceName: dev, updatedAt: new Date().toISOString() };
    if (a.kind === 'face') b.faces = [tpl];
    else b.fingers = [...b.fingers.filter((f) => f.fingerIndex !== a.fingerIndex), tpl];
    syncCounts(e, b);
  }
}

function bioView(e: MEmp): EmployeeBiometrics {
  const b = bioOf(e);
  settle(e, b);
  return {
    employeeId: e.id,
    pin: e.empCode,
    photo: b.photo ? { url: `/employees/${e.id}/photo?v=${Date.parse(b.photo.updatedAt)}`, source: b.photo.source, sourceDeviceName: b.photo.deviceName, sizeBytes: b.photo.sizeBytes, updatedAt: b.photo.updatedAt } : null,
    fingers: b.fingers,
    faces: b.faces,
    other: [],
    activity: [...b.activity]
      .sort((x, y) => y.at - x.at)
      .slice(0, 20)
      .map((a) => {
        const st = actStatus(a);
        return {
          commandId: a.commandId,
          deviceId: a.deviceId,
          deviceName: MOCK_DEVICES.find((d) => d.id === a.deviceId)?.name ?? `Device ${a.deviceId}`,
          command: a.command,
          status: st,
          createdAt: new Date(a.at).toISOString(),
          completedAt: st === 'success' || st === 'failed' ? new Date(a.at + 6000).toISOString() : null,
        };
      }),
  };
}

/** Dev only: <img> requests bypass fetch, so avatars get generated/uploaded image data from here. */
export function installPhotoMock() {
  setPhotoSrcResolver((id) => {
    const e = emps.find((x) => x.id === id);
    if (!e || !e.hasPhoto) return null;
    const b = bioOf(e);
    return b.photo?.dataUrl ?? placeholderPhoto(e.id, e.name);
  });
}

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function biometricRoutes(ctx: EmployeeMockContext): [RegExp, Handler][] {
  const label = (e: MEmp) => `${e.empCode} · ${e.name}`;
  const find = (id: string) => emps.find((x) => x.id === Number(id));
  return [
    [/^\/employees\/(\d+)\/photo$/, async ({ method, body, query, params }) => {
      const e = find(params[0]!);
      if (!e) return err(404, 'NOT_FOUND', 'Employee not found');
      const b = bioOf(e);
      if (method === 'GET') {
        if (!b.photo) return err(404, 'NOT_FOUND', 'No photo');
        const url = b.photo.dataUrl ?? placeholderPhoto(e.id, e.name);
        const raw = decodeURIComponent(url.slice(url.indexOf(',') + 1));
        return new Response(url.startsWith('data:image/svg') ? raw : await (await fetch(url)).blob(), { status: 200, headers: { 'Content-Type': url.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/jpeg' } });
      }
      if (!ctx.can('employees.biometrics')) return forbidden();
      if (method === 'DELETE') {
        b.photo = null;
        syncCounts(e, b);
        ctx.record({ action: 'employee.photo_delete', entityType: 'employee', entityId: String(e.id), entityLabel: label(e), summary: `Removed the photo of ${e.name}` });
        return json(204, undefined);
      }
      if (!(body instanceof FormData)) return err(400, 'VALIDATION_ERROR', 'Send the photo as multipart form data', { photo: 'Required' });
      const file = body.get('photo');
      if (!(file instanceof Blob)) return err(400, 'VALIDATION_ERROR', 'A photo is required', { photo: 'Required' });
      if (file.size > 1_048_576) return err(413, 'PAYLOAD_TOO_LARGE', 'The photo is larger than 1 MB');
      const sync = (body.get('syncToDevices') ?? query.get('syncToDevices') ?? 'true') !== 'false';
      const face = (body.get('createFace') ?? query.get('createFace') ?? 'false') === 'true';
      const now = Date.now();
      b.photo = { source: 'app', deviceName: null, sizeBytes: file.size, updatedAt: new Date(now).toISOString(), dataUrl: await readAsDataUrl(file) };
      if (sync) {
        for (const d of e.onDevice) {
          b.activity.push({ commandId: nextCmdId++, deviceId: d, command: 'DATA UPDATE USERPIC', at: now });
          if (face) b.activity.push({ commandId: nextCmdId++, deviceId: d, command: 'DATA UPDATE BIOPHOTO', at: now, kind: 'face', arrivesAt: now + 9000 });
        }
      }
      syncCounts(e, b);
      ctx.record({ action: 'employee.photo_update', entityType: 'employee', entityId: String(e.id), entityLabel: label(e), summary: `Updated the photo of ${e.name}`, metadata: { syncToDevices: sync, createFace: face, sizeBytes: file.size } });
      return json(200, bioView(e));
    }],
    [/^\/employees\/(\d+)\/biometrics$/, ({ params }) => {
      const e = find(params[0]!);
      if (!e) return err(404, 'NOT_FOUND', 'Employee not found');
      return json(200, bioView(e));
    }],
    [/^\/employees\/(\d+)\/biometrics\/(\d+)$/, ({ query, params }) => {
      if (!ctx.can('employees.biometrics')) return forbidden();
      const e = find(params[0]!);
      if (!e) return err(404, 'NOT_FOUND', 'Employee not found');
      const b = bioOf(e);
      const tid = Number(params[1]);
      const t = [...b.fingers, ...b.faces].find((x) => x.id === tid);
      if (!t) return err(404, 'NOT_FOUND', 'Template not found');
      b.fingers = b.fingers.filter((x) => x.id !== tid);
      b.faces = b.faces.filter((x) => x.id !== tid);
      if (query.get('fromDevices') !== 'false') for (const d of e.onDevice) b.activity.push({ commandId: nextCmdId++, deviceId: d, command: 'DATA DELETE BIODATA', at: Date.now() });
      syncCounts(e, b);
      ctx.record({ action: 'biometric.delete', entityType: 'employee', entityId: String(e.id), entityLabel: label(e), summary: `Deleted ${t.kind === 'face' ? 'face template' : 'fingerprint'} of ${e.name}` });
      return json(204, undefined);
    }],
    [/^\/employees\/(\d+)\/enroll$/, ({ body, params }) => {
      if (!ctx.can('employees.biometrics')) return forbidden();
      const e = find(params[0]!);
      if (!e) return err(404, 'NOT_FOUND', 'Employee not found');
      const p = zRemoteEnrollInput.safeParse(body);
      if (!p.success) return zodDetails(p.error);
      if (p.data.kind === 'finger' && p.data.fingerIndex === undefined) return err(400, 'VALIDATION_ERROR', 'Choose a finger', { fingerIndex: 'Required for fingers' });
      if (e.status !== 'active' || !e.onDevice.includes(p.data.deviceId)) return err(409, 'NOT_ON_DEVICE', 'This employee is not active on that device');
      const b = bioOf(e);
      const now = Date.now();
      const a: MAct = { commandId: nextCmdId++, deviceId: p.data.deviceId, command: p.data.kind === 'face' ? 'ENROLL_BIO' : 'ENROLL_FP', at: now, kind: p.data.kind, fingerIndex: p.data.fingerIndex, arrivesAt: now + 12_000 };
      b.activity.push(a);
      ctx.record({ action: 'biometric.enroll_requested', entityType: 'employee', entityId: String(e.id), entityLabel: label(e), summary: `Started ${p.data.kind} enrolment for ${e.name} on device ${p.data.deviceId}`, metadata: { deviceId: p.data.deviceId, kind: p.data.kind, fingerIndex: p.data.fingerIndex ?? null } });
      return json(202, { commandId: a.commandId });
    }],
  ];
}
/** Read-only roster for the attendance-rules mock (rules-mock.ts). */
export function getMockRoster() {
  return {
    wings: wingsData.map((w) => ({ id: w.id, name: w.name, sections: w.sections.map((s) => ({ ...s })) })),
    employees: emps.map((e) => ({ id: e.id, empCode: e.empCode, name: e.name, wingId: e.wingId, sectionId: e.sectionId, designation: e.designation, hasPhoto: e.hasPhoto, status: e.status, joinDate: e.joinDate })),
  };
}
