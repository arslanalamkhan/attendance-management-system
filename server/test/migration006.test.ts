import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createDatabaseIfMissing } from '../src/db/createDb';
import { MIGRATIONS_DIR, runMigrations } from '../src/db/migrator';
import { testDatabaseUrl } from './testDb';

/** A throwaway database with migrations 001-005 applied, filled with Phase C data, then migrated to 006. */
describe('migration 006: departments become wings', () => {
  it('keeps ids, foreign keys, role wings and permissions; maps is_active to status', async () => {
    const url = new URL(testDatabaseUrl());
    url.pathname = '/attendance_mig_test';
    await createDatabaseIfMissing(url.toString());
    const pool = new pg.Pool({ connectionString: url.toString() });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    try {
      await pool.query('DROP SCHEMA public CASCADE');
      await pool.query('CREATE SCHEMA public');
      for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f < '006')) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tmp, f));
      await runMigrations(pool, () => {}, tmp);

      // Phase C data with deliberately gappy ids.
      await pool.query(`INSERT INTO departments (id, name) VALUES (3, 'Operations'), (8, 'Admin')`);
      await pool.query(`SELECT setval('departments_id_seq', 8)`);
      await pool.query(
        `INSERT INTO employees (emp_code, name, department_id, is_active) VALUES ('1', 'Ali', 3, true), ('2', 'Bina', 8, false), ('3', 'Chand', NULL, true)`,
      );
      const role = await pool.query<{ id: number }>(`INSERT INTO roles (name, all_wings) VALUES ('Clerk', false) RETURNING id`);
      const rid = (role.rows[0] as { id: number }).id;
      await pool.query(`INSERT INTO role_wings (role_id, department_id) VALUES ($1, 8)`, [rid]);
      await pool.query(`INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'departments.manage'), ($1, 'employees.manage'), ($1, 'employees.view')`, [rid]);
      const viewer = await pool.query<{ id: number }>(`INSERT INTO roles (name, all_wings) VALUES ('Viewer', true) RETURNING id`);
      await pool.query(`INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'employees.view')`, [(viewer.rows[0] as { id: number }).id]);

      const applied = await runMigrations(pool, () => {});
      expect(applied).toEqual(['006_wings_employees.sql', '007_biometrics.sql', '008_attendance_rules.sql']);
      // 007: roles that could manage employees now also hold employees.biometrics; others do not
      const bioRoles = await pool.query<{ name: string }>(
        `SELECT r.name FROM role_permissions p JOIN roles r ON r.id = p.role_id WHERE p.permission = 'employees.biometrics' ORDER BY r.name`,
      );
      expect(bioRoles.rows.map((r) => r.name)).toEqual(['Clerk']);

      const wings = await pool.query<{ id: number; name: string; code: string | null; head_name: string | null }>('SELECT * FROM wings ORDER BY id');
      expect(wings.rows.map((w) => [w.id, w.name, w.code, w.head_name])).toEqual([[3, 'Operations', null, null], [8, 'Admin', null, null]]);
      expect((await pool.query(`SELECT to_regclass('departments') AS t`)).rows[0]).toEqual({ t: null });

      const emps = await pool.query<{ emp_code: string; wing_id: number | null; status: string; section_id: number | null }>(
        'SELECT emp_code, wing_id, status, section_id FROM employees ORDER BY emp_code',
      );
      expect(emps.rows).toEqual([
        { emp_code: '1', wing_id: 3, status: 'active', section_id: null },
        { emp_code: '2', wing_id: 8, status: 'disabled', section_id: null },
        { emp_code: '3', wing_id: null, status: 'active', section_id: null },
      ]);
      expect((await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'is_active'`)).rowCount).toBe(0);

      // role wings, permission rename, and employees.import granted to employees.manage holders only
      expect((await pool.query('SELECT wing_id FROM role_wings')).rows).toEqual([{ wing_id: 8 }]);
      const perms = await pool.query<{ name: string; permission: string }>(
        `SELECT r.name, rp.permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id ORDER BY r.name, rp.permission`,
      );
      expect(perms.rows.map((p) => `${p.name}:${p.permission}`)).toEqual(['Clerk:employees.biometrics', 'Clerk:employees.import', 'Clerk:employees.manage', 'Clerk:employees.view', 'Clerk:wings.manage', 'Viewer:employees.view']);

      // the foreign keys and sequence still work, and the section/wing trigger is in place
      const next = await pool.query<{ id: number }>(`INSERT INTO wings (name, code) VALUES ('New', 'NEW') RETURNING id`);
      expect((next.rows[0] as { id: number }).id).toBe(9);
      const sec = await pool.query<{ id: number }>(`INSERT INTO sections (wing_id, name) VALUES (3, 'Billing') RETURNING id`);
      const sid = (sec.rows[0] as { id: number }).id;
      await expect(pool.query(`UPDATE employees SET section_id = $1 WHERE emp_code = '2'`, [sid])).rejects.toThrow(/does not belong/);
      await pool.query(`UPDATE employees SET section_id = $1 WHERE emp_code = '1'`, [sid]);
      await pool.query('DELETE FROM sections WHERE id = $1', [sid]);
      expect((await pool.query(`SELECT section_id FROM employees WHERE emp_code = '1'`)).rows[0]).toEqual({ section_id: null });
      await pool.query('DELETE FROM wings WHERE id = 8');
      expect((await pool.query(`SELECT wing_id FROM employees WHERE emp_code = '2'`)).rows[0]).toEqual({ wing_id: null });
      expect((await pool.query('SELECT count(*) AS n FROM role_wings')).rows[0]).toEqual({ n: '0' });
      await expect(pool.query(`INSERT INTO employees (emp_code, name, bps) VALUES ('9', 'x', 23)`)).rejects.toThrow();
    } finally {
      await pool.end();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
