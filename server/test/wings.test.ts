import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { zSection, zWing } from '@nacta/shared';
import { api, closeDb, pool, resetDb, userClient, V1 } from './helpers';
import { flushAudit } from '../src/modules/audit/service';

beforeEach(resetDb);
afterAll(closeDb);

const mkWing = async (name: string, extra: Record<string, unknown> = {}) => (await api.post(`${V1}/wings`).send({ name, ...extra })).body as { id: number; name: string };
const mkSection = async (wingId: number, name: string) => (await api.post(`${V1}/wings/${wingId}/sections`).send({ name })).body as { id: number; name: string; wingId: number };
let baseline = 0;
const auditRows = async (action: string) => {
  await flushAudit();
  return (await pool.query<{ summary: string; changes: { field: string; before: unknown; after: unknown }[] | null; entity_label: string | null }>('SELECT summary, changes, entity_label FROM audit_logs WHERE action = $1 AND id > $2 ORDER BY id', [action, baseline])).rows;
};

describe('wings and sections', () => {
  it('wing CRUD with code, head and duplicate detection', async () => {
    const res = await api.post(`${V1}/wings`).send({ name: ' Operations ', code: ' ops ', headName: 'Mr Khan' });
    expect(res.status).toBe(201);
    expect(zWing.parse(res.body)).toMatchObject({ name: 'Operations', code: 'OPS', headName: 'Mr Khan', employeeCount: 0, sections: [] });

    const dupName = await api.post(`${V1}/wings`).send({ name: 'operations' });
    expect([dupName.status, dupName.body.error.code]).toEqual([409, 'DUPLICATE_WING']);
    const dupCode = await api.post(`${V1}/wings`).send({ name: 'Other', code: 'ops' });
    expect([dupCode.status, dupCode.body.error.code]).toEqual([409, 'DUPLICATE_WING']);
    const badCode = await api.post(`${V1}/wings`).send({ name: 'Other', code: 'a b!' });
    expect(badCode.status).toBe(400);
    expect(badCode.body.error.details).toHaveProperty('code');

    const upd = await api.put(`${V1}/wings/${res.body.id}`).send({ name: 'Operations Wing', code: '', headName: null });
    expect(upd.body).toMatchObject({ name: 'Operations Wing', code: null, headName: null });
    expect((await api.put(`${V1}/wings/999`).send({ name: 'x' })).status).toBe(404);
    const b = await mkWing('Beta', { code: 'B' });
    expect((await api.put(`${V1}/wings/${b.id}`).send({ name: 'Operations Wing' })).status).toBe(409);

    expect((await api.delete(`${V1}/wings/${b.id}`)).status).toBe(204);
    expect((await api.delete(`${V1}/wings/${b.id}`)).status).toBe(404);
  });

  it('lists wings with sections and employee counts, case-insensitively ordered', async () => {
    const a = await mkWing('alpha');
    const z = await mkWing('Zulu');
    const s2 = await mkSection(a.id, 'Billing');
    await mkSection(a.id, 'accounts');
    await api.post(`${V1}/employees`).send({ empCode: '1', name: 'A', wingId: a.id, sectionId: s2.id });
    await api.post(`${V1}/employees`).send({ empCode: '2', name: 'B', wingId: a.id });
    const list = await api.get(`${V1}/wings`);
    expect(list.status).toBe(200);
    const wings = list.body.map((w: unknown) => zWing.parse(w));
    expect(wings.map((w: { name: string }) => w.name)).toEqual(['alpha', 'Zulu']);
    expect(wings[0].employeeCount).toBe(2);
    expect(wings[0].sections.map((s: { name: string; employeeCount: number }) => [s.name, s.employeeCount])).toEqual([['accounts', 0], ['Billing', 1]]);
    expect(wings[1]).toMatchObject({ id: z.id, sections: [] });
  });

  it('section CRUD: unique per wing (case-insensitive), same name allowed in another wing', async () => {
    const a = await mkWing('A');
    const b = await mkWing('B');
    const s = await api.post(`${V1}/wings/${a.id}/sections`).send({ name: ' Billing ' });
    expect(s.status).toBe(201);
    expect(zSection.parse(s.body)).toMatchObject({ wingId: a.id, name: 'Billing', employeeCount: 0 });
    const dup = await api.post(`${V1}/wings/${a.id}/sections`).send({ name: 'billing' });
    expect([dup.status, dup.body.error.code]).toEqual([409, 'DUPLICATE_SECTION']);
    expect((await api.post(`${V1}/wings/${b.id}/sections`).send({ name: 'Billing' })).status).toBe(201);
    expect((await api.post(`${V1}/wings/999/sections`).send({ name: 'x' })).status).toBe(404);
    expect((await api.post(`${V1}/wings/${a.id}/sections`).send({ name: '  ' })).status).toBe(400);

    const other = await mkSection(a.id, 'Stores');
    expect((await api.put(`${V1}/sections/${other.id}`).send({ name: 'BILLING' })).body.error.code).toBe('DUPLICATE_SECTION');
    const ren = await api.put(`${V1}/sections/${other.id}`).send({ name: 'Store Room' });
    expect(ren.body).toMatchObject({ name: 'Store Room', wingId: a.id });
    expect((await api.put(`${V1}/sections/999`).send({ name: 'x' })).status).toBe(404);

    expect((await api.delete(`${V1}/sections/${other.id}`)).status).toBe(204);
    expect((await api.delete(`${V1}/sections/${other.id}`)).status).toBe(404);
  });

  it('deleting a section or a wing keeps employees but clears the reference', async () => {
    const w = await mkWing('W');
    const s = await mkSection(w.id, 'S');
    await api.post(`${V1}/employees`).send({ empCode: '1', name: 'A', wingId: w.id, sectionId: s.id });
    expect((await api.delete(`${V1}/sections/${s.id}`)).status).toBe(204);
    expect((await api.get(`${V1}/employees`)).body.items[0]).toMatchObject({ wingId: w.id, sectionId: null, sectionName: null });

    const s2 = await mkSection(w.id, 'S2');
    await api.put(`${V1}/employees/1`).send({ sectionId: s2.id });
    expect((await api.delete(`${V1}/wings/${w.id}`)).status).toBe(204);
    expect((await api.get(`${V1}/employees`)).body.items[0]).toMatchObject({ wingId: null, wingName: null, sectionId: null });
  });

  it('is audited with diffs', async () => {
    baseline = Number((await pool.query('SELECT COALESCE(max(id), 0) AS m FROM audit_logs')).rows[0].m);
    const w = await mkWing('Ops', { code: 'OPS' });
    await api.put(`${V1}/wings/${w.id}`).send({ name: 'Operations', code: 'OPS', headName: 'Khan' });
    const s = await mkSection(w.id, 'Billing');
    await api.put(`${V1}/sections/${s.id}`).send({ name: 'Bills' });
    await api.delete(`${V1}/sections/${s.id}`);
    await api.delete(`${V1}/wings/${w.id}`);
    expect((await auditRows('wing.create')).map((r) => r.summary)).toEqual(['Created wing Ops']);
    const upd = (await auditRows('wing.update'))[0]!;
    expect(upd.summary).toBe('Renamed wing Ops -> Operations');
    expect(upd.changes).toEqual([{ field: 'name', before: 'Ops', after: 'Operations' }, { field: 'head', before: null, after: 'Khan' }]);
    expect((await auditRows('section.create'))[0]).toMatchObject({ summary: 'Created section Billing in Operations', entity_label: 'Operations / Billing' });
    expect((await auditRows('section.update'))[0]!.changes).toEqual([{ field: 'name', before: 'Billing', after: 'Bills' }]);
    expect((await auditRows('section.delete'))[0]!.summary).toBe('Deleted section Bills from Operations');
    expect((await auditRows('wing.delete'))[0]!.summary).toBe('Deleted wing Operations');
  });

  it('permissions and wing scope; /departments is gone', async () => {
    const a = await mkWing('Wing A');
    const b = await mkWing('Wing B');
    const sb = await mkSection(b.id, 'B-sec');
    const sa = await mkSection(a.id, 'A-sec');

    expect((await api.get(`${V1}/departments`)).status).toBe(404);
    for (const p of ['employees.view', 'attendance.view', 'wings.manage', 'roles.manage'] as const) {
      expect((await (await userClient({ permissions: [p] })).get(`${V1}/wings`)).status, p).toBe(200);
    }
    expect((await (await userClient({ permissions: ['devices.view'] })).get(`${V1}/wings`)).status).toBe(403);
    const viewer = await userClient({ permissions: ['employees.view'] });
    expect((await viewer.post(`${V1}/wings`).send({ name: 'X' })).status).toBe(403);
    expect((await viewer.post(`${V1}/wings/${a.id}/sections`).send({ name: 'X' })).status).toBe(403);
    expect((await viewer.put(`${V1}/sections/${sa.id}`).send({ name: 'X' })).status).toBe(403);

    const u = await userClient({ permissions: ['employees.view', 'wings.manage'], wings: [a.id] });
    const list = await u.get(`${V1}/wings`);
    expect(list.body.map((w: { id: number }) => w.id)).toEqual([a.id]);
    expect((await u.post(`${V1}/wings`).send({ name: 'New' })).status).toBe(403); // needs all wings
    expect((await u.put(`${V1}/wings/${b.id}`).send({ name: 'Mine' })).status).toBe(404);
    expect((await u.delete(`${V1}/wings/${b.id}`)).status).toBe(404);
    expect((await u.post(`${V1}/wings/${b.id}/sections`).send({ name: 'Nope' })).status).toBe(404);
    expect((await u.put(`${V1}/sections/${sb.id}`).send({ name: 'Nope' })).status).toBe(404);
    expect((await u.delete(`${V1}/sections/${sb.id}`)).status).toBe(404);
    expect((await u.post(`${V1}/wings/${a.id}/sections`).send({ name: 'Mine' })).status).toBe(201);
    expect((await u.put(`${V1}/wings/${a.id}`).send({ name: 'Wing A+' })).status).toBe(200);
    expect((await pool.query('SELECT name FROM wings WHERE id = $1', [b.id])).rows[0]).toEqual({ name: 'Wing B' });
  });
});
