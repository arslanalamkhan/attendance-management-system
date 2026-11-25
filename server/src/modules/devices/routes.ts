import { Router } from 'express';
import { zDeviceInput, zDeviceUpdate } from '@nacta/shared';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import { audit, changeSummary, diff } from '../audit/service';
import { commandsRouter } from '../commands/routes';
import { deviceUsersRouter } from '../deviceUsers/routes';
import * as service from './service';

export const devicesRouter = Router();

// The device list (names, status, counts) is also needed as a lookup by the attendance device filter and the
// "send to devices" dialog, so it is readable with any of these. Detail, commands and device users stay devices.view.
devicesRouter.get(
  '/',
  requirePermission('devices.view', 'attendance.view', 'employees.push'),
  asyncHandler(async (_req, res) => {
    res.json(await service.list());
  }),
);

devicesRouter.post(
  '/',
  requirePermission('devices.manage'),
  asyncHandler(async (req, res) => {
    const d = await service.create(parseBody(zDeviceInput, req.body));
    audit(req, { action: 'device.create', entityType: 'device', entityId: d.id, entityLabel: d.name, summary: `Added device ${d.name} (serial ${d.serialNumber})`, metadata: { serialNumber: d.serialNumber, location: d.location } });
    res.status(201).json(d);
  }),
);

devicesRouter.get(
  '/:id',
  requirePermission('devices.view'),
  asyncHandler(async (req, res) => {
    res.json(await service.get(idParam(req.params.id, 'Device')));
  }),
);

devicesRouter.put(
  '/:id',
  requirePermission('devices.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Device');
    const input = parseBody(zDeviceUpdate, req.body);
    const before = await service.get(id);
    const after = await service.update(id, input);
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ['name', 'serialNumber', 'location', 'isActive'], { serialNumber: 'serial number', isActive: 'active' });
    if (changes.length) {
      audit(req, { action: 'device.update', entityType: 'device', entityId: id, entityLabel: after.name, summary: `Edited device ${after.name}: ${changeSummary(changes)}`, changes });
    }
    res.json(after);
  }),
);

devicesRouter.delete(
  '/:id',
  requirePermission('devices.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Device');
    const before = await service.get(id);
    await service.remove(id);
    audit(req, { action: 'device.delete', entityType: 'device', entityId: id, entityLabel: before.name, summary: `Deleted device ${before.name} (serial ${before.serialNumber})`, metadata: { serialNumber: before.serialNumber } });
    res.status(204).end();
  }),
);

// Each sub-router declares its own permissions.
devicesRouter.use('/:id/commands', commandsRouter);
devicesRouter.use('/:id/users', deviceUsersRouter);

