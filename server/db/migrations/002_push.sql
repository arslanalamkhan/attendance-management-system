CREATE TABLE device_commands (
  id           serial PRIMARY KEY,
  device_id    integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  command      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  return_code  integer,
  result       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  completed_at timestamptz,
  CONSTRAINT device_commands_status_check CHECK (status IN ('pending', 'sent', 'success', 'failed'))
);
CREATE INDEX device_commands_device_status_idx ON device_commands (device_id, status, id);

CREATE TABLE attendance_logs (
  id          bigserial PRIMARY KEY,
  device_id   integer NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  pin         text NOT NULL,
  punch_time  timestamp NOT NULL,
  status      integer,
  verify_type integer,
  work_code   text,
  raw         text,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_logs_unique UNIQUE (device_id, pin, punch_time)
);
CREATE INDEX attendance_logs_punch_idx ON attendance_logs (punch_time DESC);

CREATE TABLE adms_requests (
  id            bigserial PRIMARY KEY,
  serial_number text,
  method        text,
  path          text,
  query         text,
  body          text,
  response      text,
  remote_ip     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX adms_requests_sn_idx ON adms_requests (serial_number, id DESC);
