import type { Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import {
  EMPLOYEE_STATUS_LABEL,
  ErrorCode,
  zEmployeeDeleteQuery,
  zEmployeeInput,
  zEmployeeListQuery,
  zEmployeeUpdate,
  zImportCommitInput,
  zPushInput,
  zStatusChangeInput,
  type AuditChange,
  type Employee,
} from '@nacta/shared';
import { AppError } from '../../lib/errors';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody, parseQuery } from '../../lib/validate';
import { assertPermission, authOf, requirePermission, requireSuperAdmin } from '../../middleware/auth';
import { audit, changeSummary, diff, employeeLabel } from '../audit/service';
import { biometricsRouter } from '../biometrics/routes';
import * as wingSvc from '../wings/service';
import { buildWorkbook, exportFileName, XLSX_MIME } from './excel';
import * as importer from './import';
import * as empRepo from './repo';
import * as service from './service';

export const employeesRouter = Router();
// /employees/:id/photo, /biometrics, /enroll, /fingerprints (Phase E)
employeesRouter.use(biometricsRouter);

/** Fields shown in the audit diff, with display labels. */
const EMP_FIELDS = [
  'empCode',
  'name',
  'fatherName',
  'cnic',
  'gender',
  'wingName',
  'sectionName',
  'designation',
  'bps',
  'employmentType',
  'joinDate',
  'cardNo',
  'devicePassword',
  'privilege',
  'phone',
  'email',
  'emergencyContactName',
  'emergencyContactPhone',
  'address',
  'notes',
] as const;
const EMP_LABELS = {
  wingName: 'wing',
  sectionName: 'section',
  empCode: 'code',
  fatherName: "father's name",
  cardNo: 'card',
  devicePassword: 'device password',
  joinDate: 'join date',
  employmentType: 'employment type',
  emergencyContactName: 'emergency contact',
  emergencyContactPhone: 'emergency phone',
};

/** The audit log is readable by people who cannot manage employees: never write a full CNIC there. */
const maskedChanges = (changes: AuditChange[]): AuditChange[] =>
  changes.map((c) => (c.field.toLowerCase() === 'cnic' ? { ...c, before: typeof c.before === 'string' ? empRepo.maskCnic(c.before) : c.before, after: typeof c.after === 'string' ? empRepo.maskCnic(c.after) : c.after } : c));

/** An employee row reduced to what the report filters' picker shows; every personal field is blanked. */
function pickerOnly(e: Employee): Employee {
  return {
    ...e,
    fatherName: null,
    cnic: null,
    gender: null,
    bps: null,
    employmentType: null,
    statusReason: null,
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
    deviceCount: 0,
    templates: { fp: 0, face: 0, bio: 0 },
  };
}

const callerOf = (req: Request): service.Caller => {
  const a = authOf(req);
  return { scope: a.scope, canManage: a.permissions.has('employees.manage') };
};

// The list is also the employee picker of the report filters (code, name, wing), so the reports that filter by
// person may read it. The full profile (GET /:id) stays employees.view.
employeesRouter.get(
  '/',
  requirePermission('employees.view', 'reports.time_card', 'reports.punch_log', 'reports.attendance_export'),
  asyncHandler(async (req, res) => {
    const page = await service.list(parseQuery(zEmployeeListQuery, req.query), callerOf(req));
    // Report-only callers get what a picker needs (code, name, wing, designation, photo) and nothing personal.
    if (!authOf(req).permissions.has('employees.view')) page.items = page.items.map(pickerOnly);
    res.json(page);
  }),
);

employeesRouter.post(
  '/',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const created = await service.create(parseBody(zEmployeeInput, req.body), callerOf(req));
    audit(req, {
      action: 'employee.create',
      entityType: 'employee',
      entityId: created.id,
      entityLabel: employeeLabel(created),
      summary: `Added employee ${employeeLabel(created)}${created.wingName ? ` to ${created.wingName}` : ''}`,
      changes: maskedChanges(diff({}, created as unknown as Record<string, unknown>, EMP_FIELDS, EMP_LABELS)),
    });
    res.status(201).json(created);
  }),
);

// ---------- Excel round-trip (registered before '/:id' so these paths are never read as ids) ----------
employeesRouter.get(
  '/export.xlsx',
  requirePermission('employees.import'),
  asyncHandler(async (req, res) => {
    const caller = callerOf(req);
    const q = parseQuery(zEmployeeListQuery, req.query);
    const employees = await empRepo.listAll(q, caller.scope, caller.canManage);
    const wings = await wingSvc.list(caller.scope);
    const buf = await buildWorkbook({ employees, wings, includeCnic: caller.canManage, generatedBy: authOf(req).user.name });
    const fileName = exportFileName();
    const filters = Object.fromEntries(
      Object.entries({ q: q.q, wingId: q.wingId, sectionId: q.sectionId, status: q.status, employmentType: q.employmentType, biometrics: q.biometrics, deviceSync: q.deviceSync }).filter(([, v]) => v !== undefined),
    );
    audit(req, {
      action: 'employee.export',
      entityType: 'export',
      entityLabel: fileName,
      summary: `Exported ${employees.length} employee${employees.length === 1 ? '' : 's'} to Excel`,
      metadata: { fileName, rows: employees.length, filters, includesCnic: caller.canManage },
    });
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }),
);

const MAX_UPLOAD = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    if (/\.xlsx$/i.test(file.originalname)) cb(null, true);
    else cb(new AppError(400, ErrorCode.INVALID_FILE, 'Only .xlsx files are accepted'));
  },
}).single('file');

function receiveFile(req: Request, res: Response): Promise<{ buffer: Buffer; name: string }> {
  return new Promise((resolve, reject) => {
    upload(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          reject(new AppError(400, ErrorCode.INVALID_FILE, err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than 10 MB' : 'Upload one .xlsx file in the "file" field'));
        } else reject(err);
        return;
      }
      const f = req.file;
      if (!f) return reject(new AppError(400, ErrorCode.INVALID_FILE, 'No file was uploaded (field "file")'));
      // .xlsx is a zip archive
      if (f.buffer.length < 4 || f.buffer[0] !== 0x50 || f.buffer[1] !== 0x4b) return reject(new AppError(400, ErrorCode.INVALID_FILE, 'The file is not a valid .xlsx workbook'));
      resolve({ buffer: f.buffer, name: f.originalname.slice(0, 200) });
    });
  });
}

employeesRouter.post(
  '/import/preview',
  requirePermission('employees.import'),
  asyncHandler(async (req, res) => {
    assertPermission(req, 'employees.manage');
    const a = authOf(req);
    const file = await receiveFile(req, res);
    const result = await importer.preview(file.buffer, file.name, { userId: a.user.id, scope: a.scope, canPush: a.permissions.has('employees.push') });
    res.json(result);
  }),
);

employeesRouter.post(
  '/import/commit',
  requirePermission('employees.import'),
  asyncHandler(async (req, res) => {
    assertPermission(req, 'employees.manage');
    const a = authOf(req);
    const input = parseBody(zImportCommitInput, req.body);
    const out = await importer.commit(input.token, input.createMissing, { userId: a.user.id, scope: a.scope, canPush: a.permissions.has('employees.push') });
    const r = out.result;
    audit(req, {
      action: 'employee.import',
      entityType: 'import',
      entityLabel: out.fileName,
      summary: `Imported ${out.fileName}: ${r.created} added, ${r.updated} updated, ${r.unchanged} unchanged, ${r.skipped} skipped, ${r.deviceCommandsQueued} device commands queued`,
      metadata: { ...r, fileName: out.fileName, createMissing: input.createMissing, createdWings: out.createdWings, createdSections: out.createdSections, skippedRows: out.failed.slice(0, 100) },
    });
    for (const name of out.createdWings) audit(req, { action: 'wing.create', entityType: 'wing', entityLabel: name, summary: `Created wing ${name} (Excel import)`, metadata: { source: out.fileName } });
    for (const label of out.createdSections) audit(req, { action: 'section.create', entityType: 'section', entityLabel: label, summary: `Created section ${label} (Excel import)`, metadata: { source: out.fileName } });
    for (const e of out.applied) {
      const label = `${e.empCode} · ${e.name}`;
      if (e.kind === 'create') {
        audit(req, { action: 'employee.create', entityType: 'employee', entityId: e.employeeId, entityLabel: label, summary: `Added employee ${label} (Excel import)`, changes: maskedChanges(e.fieldChanges), metadata: { source: out.fileName } });
      } else if (e.fieldChanges.length) {
        audit(req, { action: 'employee.update', entityType: 'employee', entityId: e.employeeId, entityLabel: label, summary: `Edited employee ${label} (Excel import): ${changeSummary(maskedChanges(e.fieldChanges))}`, changes: maskedChanges(e.fieldChanges), metadata: { source: out.fileName } });
      }
      if (e.profileQueued) {
        audit(req, { action: 'employee.device_sync', entityType: 'employee', entityId: e.employeeId, entityLabel: label, summary: `Re-sent ${label} to devices after the import (${e.profileQueued} command${e.profileQueued === 1 ? '' : 's'})`, metadata: { queued: e.profileQueued, source: out.fileName } });
      }
      if (e.status) {
        audit(req, {
          action: 'employee.status',
          entityType: 'employee',
          entityId: e.employeeId,
          entityLabel: label,
          summary: `${label}: status ${EMPLOYEE_STATUS_LABEL[e.status.from]} -> ${EMPLOYEE_STATUS_LABEL[e.status.to]} (Excel import)`,
          changes: [{ field: 'status', before: EMPLOYEE_STATUS_LABEL[e.status.from], after: EMPLOYEE_STATUS_LABEL[e.status.to] }],
          metadata: { reason: e.status.reason, devices: e.status.devices, deviceEffect: e.status.device, commandsQueued: e.status.queued, backupWarnings: e.status.backupWarnings, source: out.fileName },
        });
      }
    }
    res.json(r);
  }),
);

// Registered before the '/:id' routes so "push" is never read as an id.
employeesRouter.post(
  '/push',
  requirePermission('employees.push'),
  asyncHandler(async (req, res) => {
    const input = parseBody(zPushInput, req.body);
    const result = await service.push(input, authOf(req).scope);
    const names = result.devices.map((d) => d.name);
    audit(req, {
      action: 'employee.push',
      summary: `Sent ${result.employees} employee${result.employees === 1 ? '' : 's'} to ${names.length} device${names.length === 1 ? '' : 's'}${names.length ? ` (${names.join(', ')})` : ''}: ${result.queued} command${result.queued === 1 ? '' : 's'} queued${result.skipped ? `; ${result.skipped} not active, skipped` : ''}`,
      metadata: {
        employees: result.employees,
        skippedNotActive: result.skipped,
        selection: input.employeeIds === 'all' ? 'all active employees' : 'selected employees',
        devices: result.devices,
        queued: result.queued,
      },
    });
    res.json({ queued: result.queued });
  }),
);

employeesRouter.get(
  '/:id',
  requirePermission('employees.view'),
  asyncHandler(async (req, res) => {
    res.json(await service.get(idParam(req.params.id, 'Employee'), callerOf(req)));
  }),
);

employeesRouter.put(
  '/:id',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Employee');
    const caller = callerOf(req);
    const input = parseBody(zEmployeeUpdate, req.body);
    const before = await service.getOne(id, caller);
    const { employee: after, sync } = await service.update(id, input, caller);
    const changes = maskedChanges(
      diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, EMP_FIELDS, EMP_LABELS),
    );
    // No real change: nothing to record explicitly (the api.write net notes the call).
    if (changes.length) {
      audit(req, {
        action: 'employee.update',
        entityType: 'employee',
        entityId: id,
        entityLabel: employeeLabel(after),
        summary: `Edited employee ${employeeLabel(after)}: ${changeSummary(changes)}`,
        changes,
      });
    }
    if (sync.queued) {
      audit(req, {
        action: 'employee.device_sync',
        entityType: 'employee',
        entityId: id,
        entityLabel: employeeLabel(after),
        summary: `Re-sent ${employeeLabel(after)} to ${sync.devices.length} device${sync.devices.length === 1 ? '' : 's'} (${sync.devices.map((d) => d.name).join(', ')})`,
        metadata: { devices: sync.devices, queued: sync.queued },
      });
    }
    res.json(after);
  }),
);

employeesRouter.post(
  '/:id/status',
  requirePermission('employees.manage'),
  asyncHandler(async (req, res) => {
    assertPermission(req, 'employees.push');
    const id = idParam(req.params.id, 'Employee');
    const input = parseBody(zStatusChangeInput, req.body);
    const out = await service.changeStatus(id, input, callerOf(req));
    if (out.changed) {
      const label = employeeLabel(out.detail);
      audit(req, {
        action: 'employee.status',
        entityType: 'employee',
        entityId: id,
        entityLabel: label,
        summary: `${label}: status ${EMPLOYEE_STATUS_LABEL[out.from]} -> ${EMPLOYEE_STATUS_LABEL[out.to]}${input.reason ? ` (${input.reason})` : ''}${
          out.device === 'remove' ? `; removing from ${out.devices.length} device${out.devices.length === 1 ? '' : 's'}` : out.device === 'restore' ? `; restoring to ${out.devices.length} device${out.devices.length === 1 ? '' : 's'}` : ''
        }`,
        changes: [
          { field: 'status', before: EMPLOYEE_STATUS_LABEL[out.from], after: EMPLOYEE_STATUS_LABEL[out.to] },
          ...(out.to === 'left' ? [{ field: 'left date', before: out.before.leftDate, after: out.detail.leftDate }] : []),
        ],
        metadata: {
          reason: input.reason ?? null,
          deviceEffect: out.device,
          devices: out.devices.map((d) => d.name),
          commandsQueued: out.queued,
          force: input.force,
          backupWarnings: out.backupWarnings,
        },
      });
    }
    res.json(out.detail);
  }),
);

// Deleting an employee also deletes their leave, corrections and computed attendance (FK cascades), and their
// punches become "unknown PIN". Reserved for the Super Admin; everyone else marks the employee as Left instead.
employeesRouter.delete(
  '/:id',
  requireSuperAdmin('delete employees. Mark the employee as Left instead: that removes them from the devices and keeps their attendance history.'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Employee');
    const { removeFromDevices } = parseQuery(zEmployeeDeleteQuery, req.query);
    if (removeFromDevices) assertPermission(req, 'employees.push');
    const caller = callerOf(req);
    const before = await service.getOne(id, caller);
    await service.remove(id, removeFromDevices, caller);
    audit(req, {
      action: 'employee.delete',
      entityType: 'employee',
      entityId: id,
      entityLabel: employeeLabel(before),
      summary: `Deleted employee ${employeeLabel(before)}${before.wingName ? ` (${before.wingName})` : ''}${removeFromDevices ? ' and queued removal from devices' : ''}`,
      metadata: { removeFromDevices, wing: before.wingName },
    });
    res.status(204).end();
  }),
);
