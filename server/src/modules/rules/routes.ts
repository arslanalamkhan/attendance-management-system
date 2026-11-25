import { Router } from 'express';
import { z } from 'zod';
import {
  LEAVE_PART_LABEL,
  zDate,
  zHolidayInput,
  zLeaveInput,
  zLeaveQuery,
  zLeaveTypeInput,
  zLeaveUpdate,
  zTimingAssignmentInput,
  zTimingProfileInput,
  zTimingProfileUpdate,
  type Leave,
} from '@nacta/shared';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody, parseQuery } from '../../lib/validate';
import { authOf, requirePermission } from '../../middleware/auth';
import { audit, changeSummary, diff, employeeLabel } from '../audit/service';
import * as holidays from './holidays';
import * as leave from './leave';
import * as timings from './timings';

const by = (req: Parameters<typeof authOf>[0]) => ({ id: authOf(req).user.id, name: authOf(req).user.name });

// ====================================================================================== timings
export const timingsRouter = Router();

timingsRouter.get(
  '/',
  requirePermission('timings.manage', 'attendance.view'),
  asyncHandler(async (_req, res) => {
    res.json(await timings.listProfiles());
  }),
);

// Declared before /:id.
timingsRouter.get(
  '/setup-status',
  requirePermission('timings.manage', 'attendance.view'),
  asyncHandler(async (_req, res) => {
    res.json(await timings.setupStatus());
  }),
);

const hoursText = (days: ({ start: string; end: string } | null)[]) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `${d} ${days[i] ? `${days[i]!.start}-${days[i]!.end}` : 'off'}`).join(', ');

timingsRouter.post(
  '/',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const input = parseBody(zTimingProfileInput, req.body);
    const p = await timings.createProfile(input, by(req));
    audit(req, {
      action: 'timing.create',
      entityType: 'timing',
      entityId: p.id,
      entityLabel: p.name,
      summary: `Created office timing ${p.name} (${hoursText(p.days)}; late grace ${p.graceLateMinutes} min, early grace ${p.graceEarlyMinutes} min, half day below ${p.halfDayBelowMinutes} min)`,
      changes: [
        { field: 'name', before: null, after: p.name },
        { field: 'hours', before: null, after: hoursText(p.days) },
        { field: 'graceLateMinutes', before: null, after: p.graceLateMinutes },
        { field: 'graceEarlyMinutes', before: null, after: p.graceEarlyMinutes },
        { field: 'halfDayBelowMinutes', before: null, after: p.halfDayBelowMinutes },
      ],
    });
    res.status(201).json(p);
  }),
);

timingsRouter.put(
  '/:id',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Timing profile');
    timings.requireAllWings(authOf(req).scope, 'Changing office timings');
    const body = parseBody(zTimingProfileUpdate, req.body);
    const { effectiveFrom, ...input } = body;
    const out = await timings.updateProfile(id, input as ReturnType<typeof zTimingProfileInput.parse>, effectiveFrom, by(req));
    const { before, after } = out;
    const flat = (p: typeof before) => ({ name: p.name, hours: hoursText(p.days), graceLateMinutes: p.graceLateMinutes, graceEarlyMinutes: p.graceEarlyMinutes, halfDayBelowMinutes: p.halfDayBelowMinutes });
    // Compare the version in force on the effective date with what the new version replaces.
    const changes = diff(flat(before), flat(after), ['name', 'hours', 'graceLateMinutes', 'graceEarlyMinutes', 'halfDayBelowMinutes']);
    changes.push({ field: 'effectiveFrom', before: null, after: out.effectiveFrom });
    audit(req, {
      action: 'timing.update',
      entityType: 'timing',
      entityId: id,
      entityLabel: after.name,
      summary: `Changed office timing ${after.name} from ${out.effectiveFrom}${out.initialSetup ? ' (initial setup)' : ''}: ${changeSummary(changes.filter((c) => c.field !== 'effectiveFrom')) || 'no field changes'}`,
      changes,
      metadata: { effectiveFrom: out.effectiveFrom, initialSetup: out.initialSetup, replacedVersion: out.replacedVersion },
    });
    res.json(after);
  }),
);

timingsRouter.delete(
  '/:id',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Timing profile');
    timings.requireAllWings(authOf(req).scope, 'Deleting office timings');
    const p = await timings.deleteProfile(id);
    audit(req, {
      action: 'timing.delete',
      entityType: 'timing',
      entityId: id,
      entityLabel: p.name,
      summary: `Deleted office timing ${p.name}`,
      changes: [{ field: 'name', before: p.name, after: null }],
    });
    res.status(204).end();
  }),
);

timingsRouter.post(
  '/:id/default',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Timing profile');
    timings.requireAllWings(authOf(req).scope, 'Changing the default office timing');
    const { after, previous } = await timings.setDefault(id);
    audit(req, {
      action: 'timing.update',
      entityType: 'timing',
      entityId: id,
      entityLabel: after.name,
      summary: previous ? `Made ${after.name} the default office timing (was ${previous.name}); earlier days keep ${previous.name}` : `Confirmed ${after.name} as the default office timing`,
      changes: [{ field: 'default', before: previous?.name ?? null, after: after.name }],
    });
    res.json(after);
  }),
);

// ====================================================================================== assignments
export const timingAssignmentsRouter = Router();

timingAssignmentsRouter.get(
  '/',
  requirePermission('timings.manage', 'attendance.view'),
  asyncHandler(async (req, res) => {
    res.json(await timings.listAssignments(authOf(req).scope));
  }),
);

timingAssignmentsRouter.post(
  '/',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const a = await timings.createAssignment(parseBody(zTimingAssignmentInput, req.body), authOf(req).scope);
    audit(req, {
      action: 'timing.assign',
      entityType: 'timing',
      entityId: a.profileId,
      entityLabel: a.profileName,
      summary: `Assigned ${a.profileName} to ${a.scopeLabel} from ${a.effectiveFrom}${a.effectiveTo ? ` to ${a.effectiveTo}` : ''}${a.label ? ` (${a.label})` : ''}`,
      changes: [
        { field: 'timing', before: null, after: a.profileName },
        { field: 'applies to', before: null, after: a.scopeLabel },
        { field: 'from', before: null, after: a.effectiveFrom },
        { field: 'to', before: null, after: a.effectiveTo },
      ],
      metadata: { assignmentId: a.id, scope: a.scope, scopeId: a.scopeId },
    });
    res.status(201).json(a);
  }),
);

const zAssignmentEnd = z.object({ effectiveTo: zDate.nullable() });

timingAssignmentsRouter.patch(
  '/:id',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Timing assignment');
    const { effectiveTo } = parseBody(zAssignmentEnd, req.body);
    const { before, after } = await timings.setAssignmentEnd(id, effectiveTo, authOf(req).scope);
    const name = after.label ?? after.profileName;
    audit(req, {
      action: 'timing.update',
      entityType: 'timing',
      entityId: after.profileId,
      entityLabel: after.profileName,
      summary: effectiveTo
        ? `Ended ${name} assignment for ${after.scopeLabel} on ${effectiveTo}`
        : `Made ${name} assignment for ${after.scopeLabel} open-ended`,
      changes: [{ field: 'effectiveTo', before: before.effectiveTo, after: after.effectiveTo }],
      metadata: { assignmentId: id, scope: after.scope, scopeId: after.scopeId },
    });
    res.json(after);
  }),
);
timingAssignmentsRouter.delete(
  '/:id',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const a = await timings.deleteAssignment(idParam(req.params.id, 'Timing assignment'), authOf(req).scope);
    audit(req, {
      action: 'timing.unassign',
      entityType: 'timing',
      entityId: a.profileId,
      entityLabel: a.profileName,
      summary: `Removed ${a.profileName} assignment for ${a.scopeLabel} (${a.effectiveFrom}${a.effectiveTo ? ` to ${a.effectiveTo}` : ' onwards'})`,
      changes: [{ field: 'applies to', before: a.scopeLabel, after: null }],
      metadata: { assignmentId: a.id, scope: a.scope, scopeId: a.scopeId },
    });
    res.status(204).end();
  }),
);

// ====================================================================================== holidays
export const holidaysRouter = Router();
const zYearQuery = z.object({ year: z.coerce.number().int().min(1970).max(2200).optional() });

holidaysRouter.get(
  '/',
  requirePermission('attendance.view', 'leave.manage', 'holidays.manage'),
  asyncHandler(async (req, res) => {
    res.json(await holidays.list(parseQuery(zYearQuery, req.query).year, authOf(req).scope));
  }),
);

const HOLIDAY_FIELDS = ['name', 'from', 'to', 'kind', 'wingNames'] as const;
const holidayText = (h: { name: string; from: string; to: string; kind: string; wingNames: string[] }) =>
  `${h.kind === 'holiday' ? 'holiday' : 'working day'} ${h.name} (${h.from === h.to ? h.from : `${h.from} to ${h.to}`}, ${h.wingNames.length ? h.wingNames.join(', ') : 'all wings'})`;

holidaysRouter.post(
  '/',
  requirePermission('holidays.manage'),
  asyncHandler(async (req, res) => {
    const h = await holidays.create(parseBody(zHolidayInput, req.body), authOf(req).scope, by(req));
    audit(req, {
      action: 'holiday.create',
      entityType: 'holiday',
      entityId: h.id,
      entityLabel: h.name,
      summary: `Added ${holidayText(h)}`,
      changes: diff({}, h as unknown as Record<string, unknown>, HOLIDAY_FIELDS),
    });
    res.status(201).json(h);
  }),
);

holidaysRouter.put(
  '/:id',
  requirePermission('holidays.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Holiday');
    const { before, after } = await holidays.update(id, parseBody(zHolidayInput, req.body), authOf(req).scope);
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, HOLIDAY_FIELDS);
    if (changes.length) {
      audit(req, {
        action: 'holiday.update',
        entityType: 'holiday',
        entityId: id,
        entityLabel: after.name,
        summary: `Edited ${holidayText(after)}: ${changeSummary(changes)}`,
        changes,
      });
    }
    res.json(after);
  }),
);

holidaysRouter.delete(
  '/:id',
  requirePermission('holidays.manage'),
  asyncHandler(async (req, res) => {
    const h = await holidays.remove(idParam(req.params.id, 'Holiday'), authOf(req).scope);
    audit(req, {
      action: 'holiday.delete',
      entityType: 'holiday',
      entityId: h.id,
      entityLabel: h.name,
      summary: `Removed ${holidayText(h)}`,
      changes: diff(h as unknown as Record<string, unknown>, {}, HOLIDAY_FIELDS),
    });
    res.status(204).end();
  }),
);

// ====================================================================================== leave types
export const leaveTypesRouter = Router();
const TYPE_FIELDS = ['name', 'code', 'color', 'countsAsPresent', 'isActive'] as const;

leaveTypesRouter.get(
  '/',
  requirePermission('attendance.view', 'leave.manage', 'leave.configure', 'reports.leave'),
  asyncHandler(async (_req, res) => {
    res.json(await leave.listTypes());
  }),
);

leaveTypesRouter.post(
  '/',
  requirePermission('leave.configure'),
  asyncHandler(async (req, res) => {
    const t = await leave.createType(parseBody(zLeaveTypeInput, req.body));
    audit(req, {
      action: 'leave_type.create',
      entityType: 'leave_type',
      entityId: t.id,
      entityLabel: `${t.name} (${t.code})`,
      summary: `Created leave type ${t.name} (${t.code})${t.countsAsPresent ? ', counts as present' : ''}`,
      changes: diff({}, t as unknown as Record<string, unknown>, TYPE_FIELDS),
    });
    res.status(201).json(t);
  }),
);

leaveTypesRouter.put(
  '/:id',
  requirePermission('leave.configure'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Leave type');
    const { before, after } = await leave.updateType(id, parseBody(zLeaveTypeInput, req.body));
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, TYPE_FIELDS);
    if (changes.length) {
      audit(req, {
        action: 'leave_type.update',
        entityType: 'leave_type',
        entityId: id,
        entityLabel: `${after.name} (${after.code})`,
        summary: `Edited leave type ${after.name}: ${changeSummary(changes)}`,
        changes,
      });
    }
    res.json(after);
  }),
);

// ====================================================================================== leaves
export const leavesRouter = Router();
const LEAVE_FIELDS = ['leaveTypeName', 'from', 'to', 'part', 'workingDays', 'reason'] as const;
const LEAVE_LABELS = { leaveTypeName: 'type' };
const span = (l: { from: string; to: string }) => (l.from === l.to ? l.from : `${l.from} to ${l.to}`);
const leaveText = (l: Leave) =>
  `${l.leaveTypeName} leave for ${employeeLabel({ empCode: l.empCode, name: l.employeeName })}, ${span(l)}${l.part === 'full' ? '' : ` (${LEAVE_PART_LABEL[l.part].toLowerCase()})`}, ${l.workingDays} working day${l.workingDays === 1 ? '' : 's'}`;

leavesRouter.get(
  '/',
  requirePermission('leave.manage', 'attendance.view'),
  asyncHandler(async (req, res) => {
    res.json(await leave.listLeaves(parseQuery(zLeaveQuery, req.query), authOf(req).scope));
  }),
);

leavesRouter.post(
  '/',
  requirePermission('leave.manage'),
  asyncHandler(async (req, res) => {
    const input = parseBody(zLeaveInput, req.body);
    const { leaves, replaced } = await leave.createLeaves(input, authOf(req).scope, by(req));
    for (const l of leaves) {
      audit(req, {
        action: 'leave.create',
        entityType: 'leave',
        entityId: l.id,
        entityLabel: employeeLabel({ empCode: l.empCode, name: l.employeeName }),
        summary: `Marked ${leaveText(l)}${l.reason ? ` - ${l.reason}` : ''}`,
        changes: diff({}, l as unknown as Record<string, unknown>, LEAVE_FIELDS, LEAVE_LABELS),
        metadata: { employeeId: l.employeeId, batch: leaves.length > 1 },
      });
    }
    for (const r of replaced) {
      const who = leaves.find((l) => l.employeeId === r.employeeId);
      const label = who ? employeeLabel({ empCode: who.empCode, name: who.employeeName }) : `employee ${r.employeeId}`;
      const afterText = r.after.map(span).join(' and ');
      audit(req, {
        action: r.action === 'deleted' ? 'leave.delete' : 'leave.update',
        entityType: 'leave',
        entityId: r.leaveId,
        entityLabel: label,
        summary:
          r.action === 'deleted'
            ? `Replaced existing leave ${span(r.before)} for ${label} with new leave`
            : `Trimmed existing leave ${span(r.before)} for ${label} to ${afterText} (replaced by new leave)`,
        changes: [{ field: 'dates', before: span(r.before), after: afterText || null }],
        metadata: { employeeId: r.employeeId, replacedBy: who?.id ?? null },
      });
    }
    if (leaves.length > 1) {
      const first = leaves[0] as Leave;
      audit(req, {
        action: 'leave.create',
        entityType: 'leave',
        entityLabel: `${leaves.length} employees`,
        summary: `Marked ${first.leaveTypeName} leave for ${leaves.length} employees, ${span(first)}${first.part === 'full' ? '' : ` (${LEAVE_PART_LABEL[first.part].toLowerCase()})`}`,
        metadata: { employeeCount: leaves.length, leaveIds: leaves.map((l) => l.id), employeeIds: leaves.map((l) => l.employeeId), replacedOverlapping: replaced.length },
      });
    }
    res.status(201).json(leaves);
  }),
);

leavesRouter.put(
  '/:id',
  requirePermission('leave.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Leave');
    const { before, after } = await leave.updateLeave(id, parseBody(zLeaveUpdate, req.body), authOf(req).scope);
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, LEAVE_FIELDS, LEAVE_LABELS);
    if (changes.length) {
      audit(req, {
        action: 'leave.update',
        entityType: 'leave',
        entityId: id,
        entityLabel: employeeLabel({ empCode: after.empCode, name: after.employeeName }),
        summary: `Edited leave of ${employeeLabel({ empCode: after.empCode, name: after.employeeName })}: ${changeSummary(changes)}`,
        changes,
        metadata: { employeeId: after.employeeId },
      });
    }
    res.json(after);
  }),
);

leavesRouter.delete(
  '/:id',
  requirePermission('leave.manage'),
  asyncHandler(async (req, res) => {
    const l = await leave.deleteLeave(idParam(req.params.id, 'Leave'), authOf(req).scope);
    audit(req, {
      action: 'leave.delete',
      entityType: 'leave',
      entityId: l.id,
      entityLabel: employeeLabel({ empCode: l.empCode, name: l.employeeName }),
      summary: `Cancelled ${leaveText(l)}`,
      changes: diff(l as unknown as Record<string, unknown>, {}, LEAVE_FIELDS, LEAVE_LABELS),
      metadata: { employeeId: l.employeeId },
    });
    res.status(204).end();
  }),
);
