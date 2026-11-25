import { Router } from 'express';
import { z } from 'zod';
import { zAttendanceQuery, zCorrectionInput, zDailyQuery, zEmployeeDaysQuery, zRecomputeInput } from '@nacta/shared';
import { daysBetween } from '../../lib/dates';
import { MAX_INT, validationError } from '../../lib/errors';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody, parseQuery } from '../../lib/validate';
import type { Request } from 'express';
import type { AttendanceDay } from '@nacta/shared';
import { authOf, requirePermission, requireSuperAdmin } from '../../middleware/auth';
import { audit, employeeLabel } from '../audit/service';
import * as corrections from './corrections';
import { getDaily, getDaySummary, getEmployeeDays, listEmployeeIds, MAX_RANGE_DAYS } from './days';
import { markRange } from './dirty';
import * as service from './service';

export const attendanceRouter = Router();

/**
 * Whether a day was corrected is visible to the Super Admin only (NACTA decision, 2026-11-24): everyone else,
 * including users who can add corrections, sees the resulting status without the marker.
 */
function maskCorrected<T extends Pick<AttendanceDay, 'corrected'>>(req: Request, days: T[]): T[] {
  if (authOf(req).user.isSuperAdmin) return days;
  return days.map((d) => (d.corrected ? { ...d, corrected: false } : d));
}

attendanceRouter.get(
  '/',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    res.json(await service.list(parseQuery(zAttendanceQuery, req.query), authOf(req).scope));
  }),
);

// ---- computed daily status (Phase F) ----
attendanceRouter.get(
  '/daily',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const page = await getDaily(parseQuery(zDailyQuery, req.query), authOf(req).scope);
    res.json({ ...page, items: maskCorrected(req, page.items) });
  }),
);

attendanceRouter.get(
  '/days',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const q = parseQuery(zEmployeeDaysQuery, req.query);
    res.json(maskCorrected(req, await getEmployeeDays(q.employeeId, { from: q.from, to: q.to }, authOf(req).scope)));
  }),
);

const zSummaryQuery = z.object({
  from: zRecomputeInput.shape.from,
  to: zRecomputeInput.shape.to,
  wingId: z.coerce.number().int().positive().optional(),
});

attendanceRouter.get(
  '/day-summary',
  requirePermission('attendance.view'),
  asyncHandler(async (req, res) => {
    const q = parseQuery(zSummaryQuery, req.query);
    if ((q.wingId ?? 0) > MAX_INT) throw validationError('Invalid query', { wingId: 'wingId is out of range' });
    res.json(await getDaySummary(authOf(req).scope, q));
  }),
);

// ---- corrections ----
const zCorrectionsQuery = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  from: zRecomputeInput.shape.from.optional(),
  to: zRecomputeInput.shape.to.optional(),
});

// Existing corrections (who changed which day, and why) are visible to the Super Admin only.
attendanceRouter.get(
  '/corrections',
  requireSuperAdmin('see attendance corrections'),
  asyncHandler(async (req, res) => {
    res.json(await corrections.list(parseQuery(zCorrectionsQuery, req.query), authOf(req).scope));
  }),
);

attendanceRouter.post(
  '/corrections',
  requirePermission('attendance.correct'),
  asyncHandler(async (req, res) => {
    const a = authOf(req);
    const { correction: c, employee } = await corrections.create(parseBody(zCorrectionInput, req.body), a.scope, { id: a.user.id, name: a.user.name });
    const label = employeeLabel(employee);
    audit(req, {
      action: 'attendance.correct',
      entityType: 'correction',
      entityId: c.id,
      entityLabel: label,
      summary:
        c.type === 'add_punch'
          ? `Added a manual punch at ${c.time} on ${c.date} for ${label}: ${c.reason}`
          : `Set status of ${label} on ${c.date} to ${(c.status ?? '').replace('_', ' ')}: ${c.reason}`,
      changes: [
        c.type === 'add_punch'
          ? { field: 'punch', before: null, after: `${c.date} ${c.time}` }
          : { field: 'status', before: 'computed from punches', after: c.status },
        { field: 'reason', before: null, after: c.reason },
      ],
      metadata: { employeeId: c.employeeId, date: c.date, type: c.type },
    });
    res.status(201).json(c);
  }),
);

// Removing a correction needs to see it first, so it is Super Admin only as well.
attendanceRouter.delete(
  '/corrections/:id',
  requireSuperAdmin('remove attendance corrections'),
  asyncHandler(async (req, res) => {
    const { correction: c, employee } = await corrections.remove(idParam(req.params.id, 'Correction'), authOf(req).scope);
    const label = employeeLabel(employee);
    audit(req, {
      action: 'attendance.correction_delete',
      entityType: 'correction',
      entityId: c.id,
      entityLabel: label,
      summary: `Removed ${c.type === 'add_punch' ? `manual punch ${c.time}` : `status override (${c.status})`} on ${c.date} for ${label}`,
      changes: [{ field: c.type === 'add_punch' ? 'punch' : 'status', before: c.type === 'add_punch' ? `${c.date} ${c.time}` : c.status, after: null }],
      metadata: { employeeId: c.employeeId, date: c.date, type: c.type, reason: c.reason },
    });
    res.status(204).end();
  }),
);

// ---- recompute ----
attendanceRouter.post(
  '/recompute',
  requirePermission('timings.manage'),
  asyncHandler(async (req, res) => {
    const { from, to } = parseBody(zRecomputeInput, req.body);
    if (to < from) throw validationError('Invalid request body', { to: 'Must be on or after the start date' });
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) throw validationError('Invalid request body', { to: `At most ${MAX_RANGE_DAYS} days at a time` });
    const scope = authOf(req).scope;
    const queued = await markRange({ from, to, materialize: true, ...(scope === 'all' ? {} : { employeeIds: await listEmployeeIds(scope) }) });
    audit(req, {
      action: 'attendance.recompute',
      summary: `Recalculated attendance from ${from} to ${to} (${queued} employee-days queued)`,
      metadata: { from, to, queuedDays: queued },
    });
    res.status(202).json({ queuedDays: queued });
  }),
);
