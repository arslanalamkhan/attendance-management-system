import { Router } from 'express';
import { z } from 'zod';
import { MAX_INT, validationError } from '../../lib/errors';
import { asyncHandler } from '../../lib/http';
import { parseQuery } from '../../lib/validate';
import { authOf, requirePermission } from '../../middleware/auth';
import { DAY_STATUSES, type TodaySummary } from '@nacta/shared';
import { todayLocal } from '../../lib/dates';
import { todayStatusCounts } from '../attendance/days';
import { getDashboard } from './service';

export const dashboardRouter = Router();

const zDashboardQuery = z.object({ wingId: z.coerce.number().int().positive().optional() });

/**
 * GET /dashboard/today - the simple dashboard: four numbers for today. Open to every signed-in user (the home page of
 * roles without dashboard.view), limited to the wings of their roles.
 */
dashboardRouter.get(
  '/today',
  asyncHandler(async (req, res) => {
    const c = await todayStatusCounts(authOf(req).scope);
    const body: TodaySummary = {
      date: todayLocal(),
      total: DAY_STATUSES.filter((s) => s !== 'inactive').reduce((n, s) => n + c[s], 0),
      present: c.present + c.late + c.half_day + c.incomplete,
      onLeave: c.leave,
      notRecorded: c.pending + c.absent,
      dayOff: c.holiday + c.weekend,
    };
    res.set('Cache-Control', 'no-store');
    res.json(body);
  }),
);

/** GET /dashboard[?wingId=] - everything is limited to the caller's wings, and to one wing when wingId is given. */
dashboardRouter.get(
  '/',
  requirePermission('dashboard.view'),
  asyncHandler(async (req, res) => {
    const q = parseQuery(zDashboardQuery, req.query);
    if ((q.wingId ?? 0) > MAX_INT) throw validationError('Invalid query', { wingId: 'wingId is out of range' });
    res.set('Cache-Control', 'no-store');
    res.json(await getDashboard(authOf(req).scope, q.wingId));
  }),
);
