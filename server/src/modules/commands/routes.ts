import { Router } from 'express';
import { zCommandListQuery, zEnqueueCommandInput } from '@nacta/shared';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody, parseQuery } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../audit/service';
import * as devices from '../devices/service';
import * as service from './service';

/** Mounted at /devices/:id/commands */
export const commandsRouter = Router({ mergeParams: true });

commandsRouter.get(
  '/',
  requirePermission('devices.view'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Device');
    await devices.assertExists(id);
    res.json(await service.listForDevice(id, parseQuery(zCommandListQuery, req.query)));
  }),
);

commandsRouter.post(
  '/',
  requirePermission('devices.command'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Device');
    const device = await devices.get(id);
    const { type } = parseBody(zEnqueueCommandInput, req.body);
    const cmd = await service.enqueueByType(id, type);
    audit(req, { action: 'device.command', entityType: 'device', entityId: id, entityLabel: device.name, summary: `Sent ${type} command to ${device.name}`, metadata: { commandType: type, commandId: cmd.id, deviceId: id, deviceName: device.name } });
    res.status(201).json(cmd);
  }),
);

