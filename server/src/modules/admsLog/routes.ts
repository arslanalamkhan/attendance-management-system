import { Router } from 'express';
import { zAdmsLogQuery } from '@nacta/shared';
import { asyncHandler } from '../../lib/http';
import { parseQuery } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';

export const admsLogRouter = Router();

admsLogRouter.get(
  '/',
  requirePermission('diagnostics.view'),
  asyncHandler(async (req, res) => {
    res.json(await service.list(parseQuery(zAdmsLogQuery, req.query)));
  }),
);
