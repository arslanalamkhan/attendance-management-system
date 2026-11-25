CREATE TABLE devices (
  id               serial PRIMARY KEY,
  name             text NOT NULL,
  serial_number    text NOT NULL UNIQUE,
  location         text,
  ip_address       text,
  is_active        boolean NOT NULL DEFAULT true,
  status           text NOT NULL DEFAULT 'unknown',
  last_seen_at     timestamptz,
  last_checked_at  timestamptz,
  device_name      text,
  firmware_version text,
  platform         text,
  push_version     text,
  user_count       integer,
  fp_count         integer,
  face_count       integer,
  att_count        integer,
  options          jsonb,
  auto_registered  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_status_check CHECK (status IN ('online', 'offline', 'unknown'))
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER devices_set_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
