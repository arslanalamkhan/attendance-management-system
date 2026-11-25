-- Phase E: biometrics in the application (photo upload, template listing/deletion, remote enrolment).

-- ---- photos ------------------------------------------------------------------------------------------------
-- source:     where the stored picture came from ('device' = uploaded by a terminal, 'app' = uploaded in the web app)
-- size_bytes: decoded JPEG size (content holds base64 text)
-- version:    bumped whenever the picture changes (cache buster for GET /employees/:id/photo?v=)
ALTER TABLE user_photos
  ADD COLUMN source     text    NOT NULL DEFAULT 'device',
  ADD COLUMN size_bytes integer NOT NULL DEFAULT 0,
  ADD COLUMN version    integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT user_photos_source_check CHECK (source IN ('device', 'app'));

-- Backfill without touching updated_at (the set_updated_at trigger would stamp every row with "now").
ALTER TABLE user_photos DISABLE TRIGGER user_photos_set_updated_at;
UPDATE user_photos
   SET size_bytes = floor(length(rtrim(content, '=')) * 3 / 4)::int
 WHERE content IS NOT NULL AND content <> '';
ALTER TABLE user_photos ENABLE TRIGGER user_photos_set_updated_at;

-- ---- templates ---------------------------------------------------------------------------------------------
ALTER TABLE biometric_templates
  ADD COLUMN source text NOT NULL DEFAULT 'device',
  ADD CONSTRAINT biometric_templates_source_check CHECK (source IN ('device', 'app'));

-- A template deleted in the app is remembered for a while so that a device which still holds it (and re-uploads it
-- by itself, or answers a full DATA QUERY BIODATA) does not bring it straight back. Ingest skips a template with a
-- tombstone younger than 10 minutes; the tombstone is dropped as soon as the device confirms the delete.
CREATE TABLE biometric_tombstones (
  pin        text        NOT NULL,
  kind       text        NOT NULL,
  bio_type   integer,
  idx        integer     NOT NULL DEFAULT 0,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX biometric_tombstones_unique_idx ON biometric_tombstones (pin, kind, (COALESCE(bio_type, -1)), idx);
CREATE INDEX biometric_tombstones_deleted_idx ON biometric_tombstones (deleted_at);

-- ---- permission --------------------------------------------------------------------------------------------
-- Roles that could manage employees may also enrol biometrics.
INSERT INTO role_permissions (role_id, permission)
SELECT role_id, 'employees.biometrics' FROM role_permissions WHERE permission = 'employees.manage'
ON CONFLICT DO NOTHING;
