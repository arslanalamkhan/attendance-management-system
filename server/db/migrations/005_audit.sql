-- Phase C: tamper-resistant audit log.
--
-- The table is append-only. A row trigger rejects every UPDATE and DELETE, and a statement trigger rejects
-- TRUNCATE, for every role (including the table owner). Only superusers/owners can drop the triggers, which is
-- a deliberate, visible act rather than something application code can do by accident or by injection.
--
-- user_id is a plain integer, NOT a foreign key. An ON DELETE SET NULL FK would make Postgres issue an UPDATE on
-- audit rows whenever a user is deleted (so the no-UPDATE trigger would need an exception), and `TRUNCATE users
-- CASCADE` would cascade into this table. user_id values are never reused (identity column) and user_email /
-- user_name are snapshotted on every row, so entries stay readable and attributable after a user is deleted.

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     integer,
  user_email  text,
  user_name   text,
  session_id  text,
  ip          text,
  user_agent  text,
  request_id  text,
  action      text NOT NULL,
  category    text NOT NULL,
  outcome     text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure', 'denied')),
  entity_type text,
  entity_id   text,
  entity_label text,
  summary     text NOT NULL,
  changes     jsonb,
  metadata    jsonb
);

CREATE INDEX audit_logs_at_idx          ON audit_logs (at DESC, id DESC);
CREATE INDEX audit_logs_user_at_idx     ON audit_logs (user_id, at DESC);
CREATE INDEX audit_logs_entity_at_idx   ON audit_logs (entity_type, entity_id, at DESC);
CREATE INDEX audit_logs_action_at_idx   ON audit_logs (action, at DESC);
CREATE INDEX audit_logs_category_at_idx ON audit_logs (category, at DESC);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
