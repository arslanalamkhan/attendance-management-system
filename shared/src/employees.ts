import { z } from 'zod';
import { zDate, zIsoDateTime, zOptionalText, zPageQuery } from './common';
import { zTemplateCounts } from './devices';

/** Device privilege codes. */
export const Privilege = { USER: 0, ADMIN: 14 } as const;
export const zPrivilege = z.union([z.literal(0), z.literal(14)]);

// =====================================================================================
// Wings and sections (Phase D: "departments" are renamed to wings; ids are preserved)
// =====================================================================================
export const zSection = z.object({
  id: z.number().int(),
  wingId: z.number().int(),
  name: z.string(),
  employeeCount: z.number().int(),
});
export type Section = z.infer<typeof zSection>;

export const zWing = z.object({
  id: z.number().int(),
  name: z.string(),
  /** Short code used in reports and Excel, e.g. "OPS". Unique when set. */
  code: z.string().nullable(),
  /** Free-text name of the wing head / focal person. */
  headName: z.string().nullable(),
  employeeCount: z.number().int(),
  sections: z.array(zSection),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});
export type Wing = z.infer<typeof zWing>;

/** POST /wings, PUT /wings/:id. 409 DUPLICATE_WING on name or code. */
export const zWingInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(12, 'At most 12 characters')
    .regex(/^[A-Z0-9-]*$/, 'Letters, digits and "-" only')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  headName: zOptionalText(100),
});
export type WingInput = z.input<typeof zWingInput>;

/** POST /wings/:id/sections, PUT /sections/:id. 409 DUPLICATE_SECTION (unique per wing). */
export const zSectionInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'),
});
export type SectionInput = z.input<typeof zSectionInput>;

// =====================================================================================
// Employees
// =====================================================================================
/** Employee code doubles as the device PIN. */
export const zEmpCode = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}$/, 'Digits only, 1-9 characters'));

/** Pakistani CNIC, stored as "12345-1234567-1". Input accepts 13 digits with or without dashes. */
export const zCnic = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{13}$/, 'CNIC must be 13 digits'))
  .transform((d) => `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`);

export const GENDERS = ['male', 'female'] as const;
export const zGender = z.enum(GENDERS);
export const GENDER_LABEL: Record<(typeof GENDERS)[number], string> = { male: 'Male', female: 'Female' };

export const EMPLOYMENT_TYPES = ['regular', 'contract', 'deputation', 'daily_wages', 'internship'] as const;
export const zEmploymentType = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = z.infer<typeof zEmploymentType>;
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  regular: 'Regular',
  contract: 'Contract',
  deputation: 'Deputation',
  daily_wages: 'Daily wages',
  internship: 'Internship',
};

/**
 * Employee status drives device access:
 * - active   : on every active device, can mark attendance.
 * - disabled : temporarily blocked. Removed from all devices (biometrics kept in the app); re-enabling restores
 *              the user, fingerprints, face and photo to the same devices automatically.
 * - left     : separated. Removed from all devices; history kept. Re-activating behaves like re-enabling.
 */
export const EMPLOYEE_STATUSES = ['active', 'disabled', 'left'] as const;
export const zEmployeeStatus = z.enum(EMPLOYEE_STATUSES);
export type EmployeeStatus = z.infer<typeof zEmployeeStatus>;
export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = { active: 'Active', disabled: 'Disabled', left: 'Left' };

/** BPS grade 1-22 (null when not applicable, e.g. contract staff). */
export const zBps = z.coerce.number().int().min(1, 'BPS is 1-22').max(22, 'BPS is 1-22');

/**
 * Where an employee stands on the devices, derived from queued/confirmed commands:
 * - synced        : every device that should hold them does (or none should, for disabled/left).
 * - pending       : commands queued, waiting for devices to confirm.
 * - failed        : a device rejected a command (see the profile for details).
 * - not_on_device : active but not on any device (never pushed).
 */
export const DEVICE_SYNC_STATES = ['synced', 'pending', 'failed', 'not_on_device'] as const;
export const zDeviceSyncState = z.enum(DEVICE_SYNC_STATES);
export type DeviceSyncState = z.infer<typeof zDeviceSyncState>;

export const zEmployee = z.object({
  id: z.number().int(),
  empCode: z.string(),
  name: z.string(),
  fatherName: z.string().nullable(),
  /** Full CNIC for holders of employees.manage; otherwise masked as "*****-*******-1". */
  cnic: z.string().nullable(),
  gender: zGender.nullable(),
  wingId: z.number().int().nullable(),
  wingName: z.string().nullable(),
  sectionId: z.number().int().nullable(),
  sectionName: z.string().nullable(),
  designation: z.string().nullable(),
  bps: z.number().int().nullable(),
  employmentType: zEmploymentType.nullable(),
  status: zEmployeeStatus,
  statusReason: z.string().nullable(),
  statusChangedAt: zIsoDateTime.nullable(),
  joinDate: zDate.nullable(),
  leftDate: zDate.nullable(),
  cardNo: z.string().nullable(),
  devicePassword: z.string().nullable(),
  privilege: z.number().int(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  /** Number of devices currently holding this PIN. */
  deviceCount: z.number().int(),
  deviceSync: zDeviceSyncState,
  templates: zTemplateCounts,
  hasPhoto: z.boolean(),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});
export type Employee = z.infer<typeof zEmployee>;

export const zEmployeeDeviceRef = z.object({
  deviceId: z.number().int(),
  deviceName: z.string(),
  onDevice: z.boolean(),
  /** Latest command for this employee on this device, if any. */
  lastCommand: z
    .object({ command: z.string(), status: z.string(), at: zIsoDateTime })
    .nullable(),
  lastSeenAt: zIsoDateTime.nullable(),
});
export type EmployeeDeviceRef = z.infer<typeof zEmployeeDeviceRef>;

/** GET /employees/:id */
export const zEmployeeDetail = zEmployee.extend({ devices: z.array(zEmployeeDeviceRef) });
export type EmployeeDetail = z.infer<typeof zEmployeeDetail>;

const zEmail = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().email('Invalid email').nullable())
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/**
 * POST /employees body. PUT /employees/:id accepts the same shape with every field optional.
 * Status is NOT set here; use POST /employees/:id/status so device sync and reasons are explicit.
 * Saving an employee who is on devices re-sends their device profile (name, card, password, privilege) automatically.
 */
export const zEmployeeInput = z.object({
  empCode: zEmpCode,
  name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'),
  fatherName: zOptionalText(100),
  cnic: zCnic.nullable().optional().transform((v) => v ?? null),
  gender: zGender.nullable().default(null),
  wingId: z.number().int().positive().nullable().default(null),
  /** Must belong to wingId. */
  sectionId: z.number().int().positive().nullable().default(null),
  designation: zOptionalText(100),
  bps: zBps.nullable().default(null),
  employmentType: zEmploymentType.nullable().default(null),
  joinDate: zDate.nullable().default(null),
  cardNo: zOptionalText(32),
  devicePassword: zOptionalText(32),
  privilege: zPrivilege.default(0),
  phone: zOptionalText(32),
  email: zEmail,
  emergencyContactName: zOptionalText(100),
  emergencyContactPhone: zOptionalText(32),
  address: zOptionalText(300),
  notes: zOptionalText(1000),
});
export type EmployeeInput = z.input<typeof zEmployeeInput>;
export const zEmployeeUpdate = zEmployeeInput.partial();
export type EmployeeUpdate = z.input<typeof zEmployeeUpdate>;

/**
 * POST /employees/:id/status -> EmployeeDetail. Requires employees.manage AND employees.push.
 * disable/left: refreshes the biometric backup from devices, then removes the user from every device holding them.
 * active: restores user + fingerprints + face + photo to the devices they were removed from (or all active devices
 * if none recorded). 409 NO_BIOMETRIC_BACKUP when disabling someone whose biometrics are on a device but not
 * stored in the app, unless `force: true` (they will need to re-enrol).
 */
export const zStatusChangeInput = z.object({
  status: zEmployeeStatus,
  reason: zOptionalText(300),
  /** Date the status takes effect (for "left", the separation date). Defaults to today. */
  effectiveDate: zDate.optional(),
  force: z.boolean().default(false),
});
export type StatusChangeInput = z.input<typeof zStatusChangeInput>;

/** GET /employees -> Page<Employee>. Sort keys: empCode (numeric), name, wing, bps, joinDate, createdAt. */
export const zEmployeeListQuery = zPageQuery.extend({
  q: z.string().trim().optional(),
  wingId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
  status: zEmployeeStatus.optional(),
  employmentType: zEmploymentType.optional(),
  /** Filter by biometrics on file. */
  biometrics: z.enum(['has_fingerprint', 'has_face', 'has_photo', 'none']).optional(),
  deviceSync: zDeviceSyncState.optional(),
});
export type EmployeeListQuery = z.input<typeof zEmployeeListQuery>;

/** DELETE /employees/:id?removeFromDevices=true */
export const zEmployeeDeleteQuery = z.object({
  removeFromDevices: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(false),
});

/** POST /employees/push -> Queued. Only active employees are sent; others are skipped. */
export const zPushInput = z.object({
  employeeIds: z.union([z.array(z.number().int().positive()).min(1), z.literal('all')]),
  /** Omit for all active devices. */
  deviceIds: z.array(z.number().int().positive()).min(1).optional(),
});
export type PushInput = z.input<typeof zPushInput>;

// =====================================================================================
// Excel round-trip: export -> edit in Excel -> import (preview, then apply)
// =====================================================================================
/**
 * Columns of the "Employees" sheet, in order. The header row uses `header`; the import matches columns by header
 * text (case/space-insensitive), so users may reorder or delete optional columns. "Employee Code" is the key and is
 * required. A blank cell CLEARS that field (the export always writes current values, so untouched rows are no-ops).
 * Rows are never deleted by import; employees missing from the file are left alone.
 */
export const EMPLOYEE_EXCEL_COLUMNS = [
  { key: 'empCode', header: 'Employee Code', required: true, note: 'Device PIN. Digits only. Existing code = update, new code = add.' },
  { key: 'name', header: 'Name', required: true, note: 'Shown on devices (first 24 characters).' },
  { key: 'fatherName', header: "Father's Name", required: false, note: '' },
  { key: 'cnic', header: 'CNIC', required: false, note: '13 digits, with or without dashes.' },
  { key: 'gender', header: 'Gender', required: false, note: 'Male or Female.' },
  { key: 'wing', header: 'Wing', required: false, note: 'Wing name or code from the Lists sheet.' },
  { key: 'section', header: 'Section', required: false, note: 'Must belong to the wing.' },
  { key: 'designation', header: 'Designation', required: false, note: '' },
  { key: 'bps', header: 'BPS', required: false, note: '1-22.' },
  { key: 'employmentType', header: 'Employment Type', required: false, note: 'Regular, Contract, Deputation, Daily wages or Internship.' },
  { key: 'status', header: 'Status', required: false, note: 'Active, Disabled or Left. Disabled/Left removes the person from devices; Active restores them.' },
  { key: 'statusReason', header: 'Status Reason', required: false, note: 'Recorded when Status changes.' },
  { key: 'joinDate', header: 'Join Date', required: false, note: 'Date, or text YYYY-MM-DD.' },
  { key: 'cardNo', header: 'Card No', required: false, note: '' },
  { key: 'privilege', header: 'Device Role', required: false, note: 'User or Admin (device menu access).' },
  { key: 'phone', header: 'Phone', required: false, note: '' },
  { key: 'email', header: 'Email', required: false, note: '' },
  { key: 'emergencyContactName', header: 'Emergency Contact', required: false, note: '' },
  { key: 'emergencyContactPhone', header: 'Emergency Phone', required: false, note: '' },
  { key: 'address', header: 'Address', required: false, note: '' },
  { key: 'notes', header: 'Notes', required: false, note: '' },
] as const;
export type EmployeeExcelColumnKey = (typeof EMPLOYEE_EXCEL_COLUMNS)[number]['key'];
// Device passwords are never exported or imported.

/**
 * GET /employees/export.xlsx (same filters as GET /employees, no paging) -> xlsx download.
 * Sheets: "Employees" (frozen header, dropdowns for Wing/Section/Gender/Employment Type/Status/Device Role, BPS 1-22),
 * "Lists" (wings with codes and sections), "Instructions". Audited as employee.export with filters and row count.
 * CNIC column is included only for employees.manage holders.
 */

export const IMPORT_ROW_ACTIONS = ['create', 'update', 'unchanged', 'error'] as const;
export const zImportRowAction = z.enum(IMPORT_ROW_ACTIONS);

export const zImportRow = z.object({
  /** Excel row number (header is row 1). */
  row: z.number().int(),
  empCode: z.string().nullable(),
  name: z.string().nullable(),
  action: zImportRowAction,
  changes: z.array(z.object({ field: z.string(), label: z.string(), before: z.unknown(), after: z.unknown() })),
  errors: z.array(z.object({ field: z.string().nullable(), message: z.string() })),
  warnings: z.array(z.string()),
  /** What will happen on devices if applied. */
  deviceEffect: z.enum(['none', 'update_profile', 'remove', 'restore', 'add']),
});
export type ImportRow = z.infer<typeof zImportRow>;

/** POST /employees/import/preview (multipart/form-data, field "file", .xlsx, max 10 MB) -> ImportPreview. Writes nothing. */
export const zImportPreview = z.object({
  /** Opaque token for /commit; valid 30 minutes, single use, bound to the uploading user. */
  token: z.string(),
  fileName: z.string(),
  summary: z.object({
    rows: z.number().int(),
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    error: z.number().int(),
    deviceRemove: z.number().int(),
    deviceRestore: z.number().int(),
    deviceUpdate: z.number().int(),
  }),
  /** Wing/section names in the file that do not exist yet. */
  unknownWings: z.array(z.string()),
  unknownSections: z.array(z.object({ wing: z.string(), section: z.string() })),
  /** Every row that is not "unchanged" (unchanged rows are counted only). */
  rows: z.array(zImportRow),
});
export type ImportPreview = z.infer<typeof zImportPreview>;

/**
 * POST /employees/import/commit -> ImportResult. Applies all valid rows in one transaction (rows with errors are
 * skipped), then queues device commands. `createMissing` creates unknown wings/sections instead of erroring.
 * Audited as employee.import (summary) plus one employee.create/update entry per changed employee.
 */
export const zImportCommitInput = z.object({
  token: z.string(),
  createMissing: z.boolean().default(false),
});
export type ImportCommitInput = z.input<typeof zImportCommitInput>;

export const zEmployeeImportResult = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
  wingsCreated: z.number().int(),
  sectionsCreated: z.number().int(),
  deviceCommandsQueued: z.number().int(),
});
export type EmployeeImportResult = z.infer<typeof zEmployeeImportResult>;
