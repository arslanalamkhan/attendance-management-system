-- Phase 1 fix: remember the Stamp / OpStamp the device last uploaded, return them in the handshake.
ALTER TABLE devices
  ADD COLUMN attlog_stamp  text,
  ADD COLUMN operlog_stamp text;

-- Phase 2: employees and device users.
CREATE TABLE departments (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employees (
  id              serial PRIMARY KEY,
  emp_code        text NOT NULL UNIQUE,
  name            text NOT NULL,
  department_id   integer REFERENCES departments(id) ON DELETE SET NULL,
  designation     text,
  card_no         text,
  device_password text,
  privilege       integer NOT NULL DEFAULT 0,
  phone           text,
  email           text,
  join_date       date,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_privilege_check CHECK (privilege IN (0, 14))
);
CREATE INDEX employees_department_idx ON employees (department_id);
CREATE INDEX employees_card_idx ON employees (card_no) WHERE card_no IS NOT NULL;

-- Mirror of what each device holds.
CREATE TABLE device_users (
  device_id    integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  pin          text NOT NULL,
  name         text,
  privilege    integer,
  card_no      text,
  password     text,
  grp          text,
  raw          text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, pin)
);
CREATE INDEX device_users_pin_idx ON device_users (pin);

CREATE TABLE biometric_templates (
  id               serial PRIMARY KEY,
  pin              text NOT NULL,
  kind             text NOT NULL,
  bio_type         integer,
  idx              integer NOT NULL DEFAULT 0,
  valid            integer,
  size             integer,
  data             text NOT NULL,
  raw              text NOT NULL,
  source_device_id integer REFERENCES devices(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT biometric_templates_kind_check CHECK (kind IN ('fp', 'face', 'bio'))
);
CREATE UNIQUE INDEX biometric_templates_unique_idx
  ON biometric_templates (pin, kind, (COALESCE(bio_type, -1)), idx);

CREATE TABLE user_photos (
  pin              text PRIMARY KEY,
  file_name        text,
  content          text,
  source_device_id integer REFERENCES devices(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER departments_set_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER employees_set_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER biometric_templates_set_updated_at
  BEFORE UPDATE ON biometric_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER user_photos_set_updated_at
  BEFORE UPDATE ON user_photos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
