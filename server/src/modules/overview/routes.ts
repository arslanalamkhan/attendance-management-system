import { Router } from 'express';
import { asyncHandler } from '../../lib/http';
import { authOf, requirePermission } from '../../middleware/auth';
import { getOverview } from './service';

export const overviewRouter = Router();

overviewRouter.get(
  '/',
  requirePermission('dashboard.view'),
  asyncHandler(async (req, res) => {
    res.json(await getOverview(authOf(req).scope));
  }),
);
