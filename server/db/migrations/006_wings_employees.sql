-- Phase D: wings (renamed departments), sections, rich employee records, status-driven device access.

-- ---- departments -> wings (ids and foreign keys are preserved by RENAME) ----------------------------------
ALTER TABLE departments RENAME TO wings;
ALTER SEQUENCE departments_id_seq RENAME TO wings_id_seq;
ALTER TABLE wings RENAME CONSTRAINT departments_pkey TO wings_pkey;
ALTER TABLE wings RENAME CONSTRAINT departments_name_key TO wings_name_key;
ALTER TRIGGER departments_set_updated_at ON wings RENAME TO wings_set_updated_at;

ALTER TABLE wings
  ADD COLUMN code      text,
  ADD COLUMN head_name text;
CREATE UNIQUE INDEX wings_code_key ON wings (upper(code)) WHERE code IS NOT NULL;
-- Case-insensitive name uniqueness, but only when existing data allows it (never fail a deploy over it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wings GROUP BY lower(name) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX wings_name_lower_key ON wings (lower(name));
  END IF;
END $$;

-- ---- sections ---------------------------------------------------------------------------------------------
CREATE TABLE sections (
  id         serial PRIMARY KEY,
  wing_id    integer NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sections_wing_name_key ON sections (wing_id, lower(name));
CREATE TRIGGER sections_set_updated_at
  BEFORE UPDATE ON sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- employees --------------------------------------------------------------------------------------------
ALTER TABLE employees RENAME COLUMN department_id TO wing_id;
ALTER TABLE employees RENAME CONSTRAINT employees_department_id_fkey TO employees_wing_id_fkey;
ALTER INDEX employees_department_idx RENAME TO employees_wing_idx;

ALTER TABLE employees
  ADD COLUMN section_id               integer REFERENCES sections(id) ON DELETE SET NULL,
  ADD COLUMN father_name              text,
  ADD COLUMN cnic                     text,
  ADD COLUMN gender                   text,
  ADD COLUMN bps                      integer,
  ADD COLUMN employment_type          text,
  ADD COLUMN status                   text NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason            text,
  ADD COLUMN status_changed_at        timestamptz,
  ADD COLUMN left_date                date,
  ADD COLUMN emergency_contact_name   text,
  ADD COLUMN emergency_contact_phone  text,
  ADD COLUMN address                  text,
  ADD CONSTRAINT employees_gender_check CHECK (gender IN ('male', 'female')),
  ADD CONSTRAINT employees_bps_check CHECK (bps BETWEEN 1 AND 22),
  ADD CONSTRAINT employees_employment_type_check CHECK (employment_type IN ('regular', 'contract', 'deputation', 'daily_wages', 'internship')),
  ADD CONSTRAINT employees_status_check CHECK (status IN ('active', 'disabled', 'left'));

UPDATE employees SET status = 'disabled', status_changed_at = now(), status_reason = 'Migrated from inactive' WHERE NOT is_active;
ALTER TABLE employees DROP COLUMN is_active;

CREATE UNIQUE INDEX employees_cnic_key ON employees (cnic) WHERE cnic IS NOT NULL;
CREATE INDEX employees_section_idx ON employees (section_id);
CREATE INDEX employees_status_idx ON employees (status);

-- section_id must belong to wing_id. (A trigger rather than a composite FK, so deleting a section or a wing
-- can still just clear the reference.)
CREATE FUNCTION employees_check_section() RETURNS trigger AS $$
BEGIN
  IF NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sections s WHERE s.id = NEW.section_id AND s.wing_id IS NOT DISTINCT FROM NEW.wing_id
  ) THEN
    RAISE EXCEPTION 'section % does not belong to wing %', NEW.section_id, NEW.wing_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employees_check_section_trg
  BEFORE INSERT OR UPDATE OF section_id, wing_id ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_check_section();

-- ---- roles ------------------------------------------------------------------------------------------------
ALTER TABLE role_wings RENAME COLUMN department_id TO wing_id;
ALTER TABLE role_wings RENAME CONSTRAINT role_wings_department_id_fkey TO role_wings_wing_id_fkey;
ALTER INDEX role_wings_department_idx RENAME TO role_wings_wing_idx;

-- 'departments.manage' becomes 'wings.manage' (a role holding both keeps just one row).
DELETE FROM role_permissions d
 WHERE d.permission = 'departments.manage'
   AND EXISTS (SELECT 1 FROM role_permissions w WHERE w.role_id = d.role_id AND w.permission = 'wings.manage');
UPDATE role_permissions SET permission = 'wings.manage' WHERE permission = 'departments.manage';
-- Roles that could manage employees may also use the Excel round-trip.
INSERT INTO role_permissions (role_id, permission)
SELECT role_id, 'employees.import' FROM role_permissions WHERE permission = 'employees.manage'
ON CONFLICT DO NOTHING;

-- ---- device access bookkeeping ---------------------------------------------------------------------------
-- Which devices an employee was removed from when disabled / left, so re-enabling restores the same devices.
CREATE TABLE employee_device_holds (
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_id   integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  removed_at  timestamptz NOT NULL DEFAULT now(),
  reason      text,
  PRIMARY KEY (employee_id, device_id)
);

-- Commands queued for an employee (drives deviceSync), and an optional ordering dependency: a command with
-- after_command_id is not delivered until that earlier command has finished and the device had time to answer.
ALTER TABLE device_commands
  ADD COLUMN employee_id      integer REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN after_command_id integer;
CREATE INDEX device_commands_employee_idx ON device_commands (employee_id, device_id, id DESC) WHERE employee_id IS NOT NULL;
