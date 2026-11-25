import { Router } from 'express';
import { ErrorCode, zDeviceUserListQuery, zImportDeviceUsersInput } from '@nacta/shared';
import { AppError } from '../../lib/errors';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody, parseQuery } from '../../lib/validate';
import { assertPermission, authOf, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/service';
import * as devices from '../devices/service';
import * as service from './service';

/** Mounted at /devices/:id/users. A device feature: not wing-scoped. */
export const deviceUsersRouter = Router({ mergeParams: true });

deviceUsersRouter.get(
  '/',
  requirePermission('devices.view'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Device');
    await devices.assertExists(id);
    res.json(await service.list(id, parseQuery(zDeviceUserListQuery, req.query)));
  }),
);

deviceUsersRouter.post(
  '/fetch',
  requirePermission('devices.users'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Device');
    const device = await devices.get(id);
    const result = await service.fetchFromDevice(id);
    audit(req, { action: 'device_users.fetch', entityType: 'device', entityId: id, entityLabel: device.name, summary: `Requested users and templates from ${device.name}`, metadata: { queued: result.queued } });
    res.json(result);
  }),
);

deviceUsersRouter.post(
  '/import',
  requirePermission('devices.users'),
  asyncHandler(async (req, res) => {
    assertPermission(req, 'employees.manage');
    // Import creates (and with overwrite rewrites) employees whatever their wing, so wing-limited callers may not.
    if (authOf(req).scope !== 'all') {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Importing device users requires access to all wings');
    }
    const id = idParam(req.params.id, 'Device');
    const device = await devices.get(id);
    const input = parseBody(zImportDeviceUsersInput, req.body);
    const result = await service.importUsers(id, input);
    audit(req, { action: 'device_users.import', entityType: 'device', entityId: id, entityLabel: device.name, summary: `Imported device users from ${device.name} as employees: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`, metadata: { created: result.created, updated: result.updated, skipped: result.skipped, overwrite: input.overwrite, pins: input.pins ? input.pins.length : 'all' } });
    res.json(result);
  }),
);

deviceUsersRouter.delete(
  '/:pin',
  requirePermission('devices.users'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Device');
    const device = await devices.get(id);
    const pin = String(req.params.pin ?? '').trim();
    const result = await service.removeFromDevice(id, pin);
    audit(req, { action: 'device_users.remove', entityType: 'device', entityId: id, entityLabel: device.name, summary: `Removed user PIN ${pin} from ${device.name}`, metadata: { pin, queued: result.queued } });
    res.json(result);
  }),
);

