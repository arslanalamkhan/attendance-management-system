-- Phase F: attendance rules engine. Office timings, holidays, leave, corrections and the computed daily status.
-- Original punches (attendance_logs) are never touched; everything here is layered on top of them.

-- Punch lookups per employee per day (pin + time range) for the set-based engine queries.
CREATE INDEX attendance_logs_pin_time_idx ON attendance_logs (pin, punch_time);

-- ---- office timings ----------------------------------------------------------------------------------------
CREATE TABLE timing_profiles (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  -- False until a user has saved the profile at least once (drives GET /timings/setup-status).
  confirmed  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX timing_profiles_name_key ON timing_profiles (lower(name));
CREATE UNIQUE INDEX timing_profiles_default_key ON timing_profiles (is_default) WHERE is_default;
CREATE TRIGGER timing_profiles_set_updated_at
  BEFORE UPDATE ON timing_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The rules of a profile are versioned and apply forwards: the version in force on a date is the one with the
-- latest effective_from <= that date, so changing timings never rewrites history.
CREATE TABLE timing_profile_versions (
  id                     serial PRIMARY KEY,
  profile_id             integer NOT NULL REFERENCES timing_profiles(id) ON DELETE CASCADE,
  effective_from         date NOT NULL,
  -- 7 entries, index 0 = Sunday ... 6 = Saturday; each null (day off) or {"start":"HH:mm","end":"HH:mm"}.
  days                   jsonb NOT NULL,
  grace_late_minutes     integer NOT NULL DEFAULT 15,
  grace_early_minutes    integer NOT NULL DEFAULT 15,
  half_day_below_minutes integer NOT NULL DEFAULT 240,
  created_by             integer,
  created_by_name        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timing_profile_versions_days_check CHECK (jsonb_typeof(days) = 'array' AND jsonb_array_length(days) = 7),
  CONSTRAINT timing_profile_versions_unique UNIQUE (profile_id, effective_from)
);
-- scope_id is a wing id or an employee id (polymorphic, so no foreign key); triggers below clean up orphans.
CREATE TABLE timing_assignments (
  id             serial PRIMARY KEY,
  profile_id     integer NOT NULL REFERENCES timing_profiles(id) ON DELETE RESTRICT,
  scope          text NOT NULL,
  scope_id       integer,
  effective_from date NOT NULL,
  effective_to   date,
  label          text,
  created_by     integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timing_assignments_scope_check CHECK (scope IN ('all', 'wing', 'employee')),
  CONSTRAINT timing_assignments_scope_id_check CHECK ((scope = 'all') = (scope_id IS NULL)),
  CONSTRAINT timing_assignments_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX timing_assignments_profile_idx ON timing_assignments (profile_id);
CREATE INDEX timing_assignments_scope_idx ON timing_assignments (scope, scope_id);

CREATE FUNCTION timing_assignments_orphans() RETURNS trigger AS $$
BEGIN
  DELETE FROM timing_assignments WHERE scope = TG_ARGV[0] AND scope_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wings_drop_assignments AFTER DELETE ON wings
  FOR EACH ROW EXECUTE FUNCTION timing_assignments_orphans('wing');
CREATE TRIGGER employees_drop_assignments AFTER DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION timing_assignments_orphans('employee');

-- ---- holidays ----------------------------------------------------------------------------------------------
CREATE TABLE holidays (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  from_date  date NOT NULL,
  to_date    date NOT NULL,
  kind       text NOT NULL DEFAULT 'holiday',
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holidays_kind_check CHECK (kind IN ('holiday', 'working_day')),
  CONSTRAINT holidays_range_check CHECK (to_date >= from_date)
);
CREATE INDEX holidays_range_idx ON holidays (from_date, to_date);
CREATE TRIGGER holidays_set_updated_at
  BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- No rows for a holiday = all wings.
CREATE TABLE holiday_wings (
  holiday_id integer NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
  wing_id    integer NOT NULL REFERENCES wings(id) ON DELETE CASCADE,
  PRIMARY KEY (holiday_id, wing_id)
);
CREATE INDEX holiday_wings_wing_idx ON holiday_wings (wing_id);

-- Deleting a wing must not turn a holiday that only applied to it into an organisation-wide one.
CREATE FUNCTION wings_drop_wing_only_holidays() RETURNS trigger AS $$
BEGIN
  DELETE FROM holidays WHERE id IN (
    SELECT holiday_id FROM holiday_wings GROUP BY holiday_id HAVING bool_and(wing_id = OLD.id)
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wings_drop_holidays BEFORE DELETE ON wings
  FOR EACH ROW EXECUTE FUNCTION wings_drop_wing_only_holidays();

-- ---- leave -------------------------------------------------------------------------------------------------
CREATE TABLE leave_types (
  id                serial PRIMARY KEY,
  name              text NOT NULL,
  code              text NOT NULL,
  color             text NOT NULL,
  counts_as_present boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX leave_types_code_key ON leave_types (upper(code));
CREATE UNIQUE INDEX leave_types_name_key ON leave_types (lower(name));
CREATE TRIGGER leave_types_set_updated_at
  BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE leaves (
  id              serial PRIMARY KEY,
  employee_id     integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   integer NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  part            text NOT NULL DEFAULT 'full',
  reason          text,
  created_by      integer,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leaves_part_check CHECK (part IN ('full', 'first_half', 'second_half')),
  CONSTRAINT leaves_range_check CHECK (to_date >= from_date),
  CONSTRAINT leaves_half_check CHECK (part = 'full' OR from_date = to_date)
);
CREATE INDEX leaves_employee_range_idx ON leaves (employee_id, from_date, to_date);
CREATE INDEX leaves_range_idx ON leaves (from_date, to_date);
CREATE INDEX leaves_type_idx ON leaves (leave_type_id);
CREATE TRIGGER leaves_set_updated_at
  BEFORE UPDATE ON leaves
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- corrections (original punches are never edited) -------------------------------------------------------
CREATE TABLE attendance_corrections (
  id              serial PRIMARY KEY,
  employee_id     integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date            date NOT NULL,
  type            text NOT NULL,
  time            text,
  status          text,
  reason          text NOT NULL,
  created_by      integer,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_corrections_type_check CHECK (type IN ('add_punch', 'set_status')),
  CONSTRAINT attendance_corrections_status_check CHECK (status IS NULL OR status IN ('present', 'absent', 'half_day')),
  CONSTRAINT attendance_corrections_time_check CHECK (time IS NULL OR time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT attendance_corrections_shape_check CHECK ((type = 'add_punch' AND time IS NOT NULL) OR (type = 'set_status' AND status IS NOT NULL))
);
CREATE INDEX attendance_corrections_emp_date_idx ON attendance_corrections (employee_id, date);

-- ---- computed daily status (a cache: always derivable from the tables above) -------------------------------
CREATE TABLE attendance_days (
  employee_id          integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                 date NOT NULL,
  status               text NOT NULL,
  early_leave          boolean NOT NULL DEFAULT false,
  late_minutes         integer NOT NULL DEFAULT 0,
  early_minutes        integer NOT NULL DEFAULT 0,
  first_in             text,
  last_out             text,
  worked_minutes       integer NOT NULL DEFAULT 0,
  punch_count          integer NOT NULL DEFAULT 0,
  leave                jsonb,
  holiday              jsonb,
  timing               jsonb,
  corrected            boolean NOT NULL DEFAULT false,
  -- Official duty and similar: counts as present in summaries.
  leave_counts_present boolean NOT NULL DEFAULT false,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, date)
);
CREATE INDEX attendance_days_date_status_idx ON attendance_days (date, status);

-- (employee, date) pairs whose cached row must be recomputed by the worker.
CREATE TABLE attendance_dirty (
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        date NOT NULL,
  queued_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, date)
);
CREATE INDEX attendance_dirty_queued_idx ON attendance_dirty (queued_at);

-- Employee changes that alter their computed days (status history, join date, wing, punch code): requeue the
-- days already cached. Days not cached yet are computed on first read.
CREATE FUNCTION employees_requeue_days() RETURNS trigger AS $$
BEGIN
  INSERT INTO attendance_dirty (employee_id, date)
  SELECT employee_id, date FROM attendance_days WHERE employee_id = NEW.id
  ON CONFLICT (employee_id, date) DO UPDATE SET queued_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employees_requeue_days_trg
  AFTER UPDATE OF status, status_changed_at, left_date, join_date, wing_id, emp_code ON employees
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
     OR OLD.status_changed_at IS DISTINCT FROM NEW.status_changed_at
     OR OLD.left_date IS DISTINCT FROM NEW.left_date
     OR OLD.join_date IS DISTINCT FROM NEW.join_date
     OR OLD.wing_id IS DISTINCT FROM NEW.wing_id
     OR OLD.emp_code IS DISTINCT FROM NEW.emp_code)
  EXECUTE FUNCTION employees_requeue_days();

-- ---- seed (agreed starting configuration: Mon-Fri 09:00-17:00, grace 30 late / 0 early, effective from the first punch) --
-- SEED-BEGIN
INSERT INTO timing_profiles (name, is_default, confirmed) VALUES ('Standard office hours', true, true);
INSERT INTO timing_profile_versions (profile_id, effective_from, days, grace_late_minutes, grace_early_minutes, half_day_below_minutes)
SELECT id, COALESCE((SELECT min(punch_time)::date FROM attendance_logs), DATE '2000-01-01'),
  '[null,{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},null]'::jsonb,
  30, 0, 240
FROM timing_profiles WHERE is_default;

INSERT INTO leave_types (name, code, color, counts_as_present) VALUES
  ('Casual', 'CL', '#2563EB', false),
  ('Earned', 'EL', '#7C3AED', false),
  ('Medical', 'ML', '#DC2626', false),
  ('Short leave', 'SL', '#D97706', false),
  ('Official duty', 'OD', '#059669', true),
  ('Maternity', 'MAT', '#DB2777', false),
  ('Without pay', 'LWP', '#64748B', false);
-- SEED-END
