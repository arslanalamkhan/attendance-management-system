import { Router } from 'express';
import { REPORT_PERMISSIONS, zSectionInput, zWingInput } from '@nacta/shared';
import { asyncHandler, idParam } from '../../lib/http';
import { parseBody } from '../../lib/validate';
import { authOf, requirePermission } from '../../middleware/auth';
import { audit, diff } from '../audit/service';
import * as service from './service';

export const wingsRouter = Router();
export const sectionsRouter = Router();

const WING_FIELDS = ['name', 'code', 'headName'] as const;
const WING_LABELS = { headName: 'head' };

// Several screens need the wing list (filters, role editor), so reading is open to any of these.
wingsRouter.get(
  '/',
  requirePermission('employees.view', 'attendance.view', 'wings.manage', 'roles.manage', ...REPORT_PERMISSIONS),
  asyncHandler(async (req, res) => {
    res.json(await service.list(authOf(req).scope));
  }),
);

wingsRouter.post(
  '/',
  requirePermission('wings.manage'),
  asyncHandler(async (req, res) => {
    const w = await service.create(parseBody(zWingInput, req.body), authOf(req).scope);
    audit(req, {
      action: 'wing.create',
      entityType: 'wing',
      entityId: w.id,
      entityLabel: w.name,
      summary: `Created wing ${w.name}`,
      changes: diff({}, w as unknown as Record<string, unknown>, WING_FIELDS, WING_LABELS),
    });
    res.status(201).json(w);
  }),
);

wingsRouter.put(
  '/:id',
  requirePermission('wings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Wing');
    const scope = authOf(req).scope;
    const input = parseBody(zWingInput, req.body);
    const before = await service.get(id, scope);
    const after = await service.update(id, input, scope);
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, WING_FIELDS, WING_LABELS);
    if (changes.length) {
      audit(req, {
        action: 'wing.update',
        entityType: 'wing',
        entityId: id,
        entityLabel: after.name,
        summary: before.name !== after.name ? `Renamed wing ${before.name} -> ${after.name}` : `Edited wing ${after.name}`,
        changes,
      });
    }
    res.json(after);
  }),
);

wingsRouter.delete(
  '/:id',
  requirePermission('wings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Wing');
    const scope = authOf(req).scope;
    const before = await service.get(id, scope);
    await service.remove(id, scope);
    audit(req, {
      action: 'wing.delete',
      entityType: 'wing',
      entityId: id,
      entityLabel: before.name,
      summary: `Deleted wing ${before.name}`,
      changes: diff(before as unknown as Record<string, unknown>, {}, WING_FIELDS, WING_LABELS),
      metadata: { employeeCount: before.employeeCount, sections: before.sections.map((s) => s.name) },
    });
    res.status(204).end();
  }),
);

wingsRouter.post(
  '/:id/sections',
  requirePermission('wings.manage'),
  asyncHandler(async (req, res) => {
    const wingId = idParam(req.params.id, 'Wing');
    const scope = authOf(req).scope;
    const wing = await service.get(wingId, scope);
    const s = await service.createSection(wingId, parseBody(zSectionInput, req.body), scope);
    audit(req, {
      action: 'section.create',
      entityType: 'section',
      entityId: s.id,
      entityLabel: `${wing.name} / ${s.name}`,
      summary: `Created section ${s.name} in ${wing.name}`,
      changes: [{ field: 'name', before: null, after: s.name }],
      metadata: { wingId, wing: wing.name },
    });
    res.status(201).json(s);
  }),
);

sectionsRouter.put(
  '/:id',
  requirePermission('wings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Section');
    const scope = authOf(req).scope;
    const input = parseBody(zSectionInput, req.body);
    const before = await service.getSection(id, scope);
    const after = await service.updateSection(id, input, scope);
    if (before.name !== after.name) {
      const wing = await service.get(after.wingId, scope);
      audit(req, {
        action: 'section.update',
        entityType: 'section',
        entityId: id,
        entityLabel: `${wing.name} / ${after.name}`,
        summary: `Renamed section ${before.name} -> ${after.name} in ${wing.name}`,
        changes: [{ field: 'name', before: before.name, after: after.name }],
        metadata: { wingId: wing.id, wing: wing.name },
      });
    }
    res.json(after);
  }),
);

sectionsRouter.delete(
  '/:id',
  requirePermission('wings.manage'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'Section');
    const scope = authOf(req).scope;
    const before = await service.getSection(id, scope);
    const wing = await service.get(before.wingId, scope);
    await service.removeSection(id, scope);
    audit(req, {
      action: 'section.delete',
      entityType: 'section',
      entityId: id,
      entityLabel: `${wing.name} / ${before.name}`,
      summary: `Deleted section ${before.name} from ${wing.name}`,
      changes: [{ field: 'name', before: before.name, after: null }],
      metadata: { wingId: wing.id, wing: wing.name, employeeCount: before.employeeCount },
    });
    res.status(204).end();
  }),
);
