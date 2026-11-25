-- Phase B: authentication, roles (RBAC with wing scoping) and server-side sessions.

CREATE TABLE users (
  id                    serial PRIMARY KEY,
  email                 text NOT NULL,
  name                  text NOT NULL,
  password_hash         text NOT NULL,
  status                text NOT NULL DEFAULT 'active',
  must_change_password  boolean NOT NULL DEFAULT true,
  failed_attempts       integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  last_login_ip         text,
  previous_login_at     timestamptz,
  previous_login_ip     text,
  password_changed_at   timestamptz,
  created_by            integer REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_email_lower_check CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE roles (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  all_wings   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX roles_name_key ON roles (lower(name));

CREATE TABLE role_permissions (
  role_id    integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

-- Wings (departments) a role is limited to. Ignored when roles.all_wings is true.
CREATE TABLE role_wings (
  role_id       integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  department_id integer NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, department_id)
);
CREATE INDEX role_wings_department_idx ON role_wings (department_id);

CREATE TABLE user_roles (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id);

-- id is the sha256 (hex) of the cookie token; the token itself is never stored.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roles_set_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
