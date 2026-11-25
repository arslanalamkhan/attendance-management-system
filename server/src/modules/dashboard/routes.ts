import { Router } from 'express';
import { z } from 'zod';
import { MAX_INT, validationError } from '../../lib/errors';
import { asyncHandler } from '../../lib/http';
import { parseQuery } from '../../lib/validate';
import { authOf, requirePermission } from '../../middleware/auth';
import { getDashboard } from './service';

export const dashboardRouter = Router();

const zDashboardQuery = z.object({ wingId: z.coerce.number().int().positive().optional() });

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
