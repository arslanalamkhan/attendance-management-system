# ZKTeco Attendance System — Plan

## Why PUSH (ADMS)
The office device is a **ZKTeco SenseFace 7A, firmware ZAM70-NF70VA-Ver3.0.5**. It does not speak the
classic "pull" SDK on TCP 4370 (it answers with non-standard reply codes 6001/2032). It is a **PUSH / ADMS**
device: the device calls *our* server over HTTP (`/iclock/*`), uploads attendance in real time, and polls
for queued commands. So the server never connects to the device; the device connects to the server.

Network: PC `192.168.1.200` (Ethernet), device `192.168.1.201`.
Device setting: Menu → Comm. → Cloud Server Setting → server `192.168.1.200`, port `8081`.

## Stack
- **server/**: Node (v26 installed) + Express 4, `pg`. Plain-SQL migrations with a tiny runner.
  Two HTTP listeners in one process: **API** on `PORT` (4000) for the React app, **ADMS** on `ADMS_PORT` (8081) for devices.
- **client/**: Vite + React 18 + TypeScript, React Router, TanStack Query.
- **db**: PostgreSQL 18, database `attendance`.

## Server layout
```
server/
  src/index.js                 starts API app + ADMS app, status sweeper, graceful shutdown
  src/config.js                PORT, ADMS_PORT, DATABASE_URL, CORS_ORIGIN, DEVICE_ONLINE_WINDOW_MS (90000),
                               ADMS_TIMEZONE (5), ADMS_AUTO_REGISTER (true), ADMS_LOG_RAW (true)
  src/errors.js                AppError, errorHandler, notFound, asyncHandler (keep)
  src/db/{pool,migrate,createDb}.js  (keep)
  src/adms/router.js           /iclock/* handlers (text/plain), mounted on the ADMS app
  src/adms/parse.js            pure functions: parse query/INFO, ATTLOG lines, OPERLOG lines, devicecmd bodies, k=v\t pairs
  src/adms/commands.js         builders for command strings (INFO, CHECK, REBOOT, DATA UPDATE USERINFO, DATA DELETE USERINFO, ...)
  src/services/deviceService.js     CRUD, findOrRegisterBySerial, touch(heartbeat), updateInfo
  src/services/commandService.js    enqueue, nextBatchForDevice (marks sent), complete(id, returnCode, body)
  src/services/attendanceService.js insertBatch (ON CONFLICT DO NOTHING), list
  src/services/statusSweeper.js     every 15s: status='offline' where last_seen_at older than window
  src/routes/{devices,attendance,admsLog}.js
  db/migrations/001_devices.sql, 002_push.sql
```
Delete the pull code: `src/zk/*`, `src/services/statusPoller.js`, the `zkteco-js` dependency.

## Database
`devices` (rewrite 001 — no DB has been migrated yet):
id serial pk · name text not null · serial_number text not null **unique** · location text ·
ip_address text (last IP the device called from; display only) · is_active bool default true ·
status text default 'unknown' check in (online, offline, unknown) · last_seen_at, last_checked_at timestamptz ·
device_name, firmware_version, platform, push_version text · user_count, fp_count, face_count, att_count int ·
options jsonb (last raw INFO/options) · auto_registered bool default false · created_at, updated_at (trigger).

`002_push.sql`:
- `device_commands`: id serial pk · device_id fk cascade · command text not null · status text check in
  (pending, sent, success, failed) default pending · return_code int · result text · created_at · sent_at · completed_at.
  Index (device_id, status, id).
- `attendance_logs`: id bigserial pk · device_id fk cascade · pin text not null · punch_time timestamp (device local, no tz) ·
  status int · verify_type int · work_code text · raw text · received_at timestamptz default now() ·
  **unique (device_id, pin, punch_time)**.
- `adms_requests` (debug log): id bigserial · serial_number text · method · path · query text · body text (truncate 64 KB) ·
  response text · remote_ip · created_at. Keep last ~5000 rows (prune in sweeper).

## ADMS endpoints (device-facing, port 8081, all responses `text/plain`)
Parse bodies with `express.text({ type: '*/*', limit: '20mb' })`. Every request: look up SN (`?SN=`), auto-register
if unknown (name `Device <SN>`), update `last_seen_at=now()`, `status='online'`, `ip_address=req.ip` (strip `::ffff:`),
log to `adms_requests`. Unknown SN with auto-register off → `404`. Inactive device → still log/touch but respond `OK` and send no commands.

| request | response |
|---|---|
| `GET /iclock/cdata?SN=..&options=all&pushver=..` | handshake options, lines joined with `\r\n` (or `\n`): `GET OPTION FROM: <SN>`, `ATTLOGStamp=None`, `OPERLOGStamp=9999`, `ATTPHOTOStamp=None`, `ErrorDelay=30`, `Delay=10`, `TransTimes=00:00;14:05`, `TransInterval=1`, `TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic`, `TimeZone=<ADMS_TIMEZONE>`, `Realtime=1`, `Encrypt=None`. Save `pushver` → push_version. |
| `POST /iclock/cdata?SN=..&table=ATTLOG` | body lines `PIN\tYYYY-MM-DD HH:MM:SS\tstatus\tverify\tworkcode\t...`; insert all; reply `OK: <lines received>` |
| `POST /iclock/cdata?SN=..&table=OPERLOG` | lines like `USER PIN=1\tName=Ali\tPri=0\t...`, `FP PIN=..`, `OPLOG ...`; for now just count (store nothing beyond raw log); reply `OK: <n>` |
| `POST /iclock/cdata?SN=..&table=options` (or any other table, e.g. ATTPHOTO, BIODATA) | parse `k=v` pairs separated by `,` or newlines into `options`; reply `OK` |
| `GET /iclock/getrequest?SN=..[&INFO=...]` | if `INFO` present: comma list `fwVersion,userCount,fpCount,attCount,ip,fpAlgVer,faceAlgVer,faceCount,...` (positions 0,1,2,3,4 and 7 if present) → update device. Then reply queued commands, one per line `C:<id>:<command>` (max 10, mark `sent`), or `OK` if none |
| `POST /iclock/devicecmd?SN=..` | body one or more lines `ID=<id>&Return=<code>&CMD=<name>`; mark each command success (`Return>=0`) or failed; if CMD=INFO, body may contain `k=v` lines → merge into options/device info; reply `OK` |
| `GET\|POST /iclock/registry`, `/iclock/push`, `/iclock/ping`, `/iclock/rtdata`, `/iclock/querydata`, anything else under `/iclock` | log + touch, reply `OK` (these belong to the newer protocol; we will see in the log if the device uses them and extend). `/iclock/ping` → `OK`. |

## API (React-facing, port 4000, JSON camelCase, prefix `/api`)
Errors `{ error: { code, message, details? } }` (400 VALIDATION_ERROR with details keyed by field, 404 NOT_FOUND, 409 DUPLICATE_DEVICE).
| method | path | purpose |
|---|---|---|
| GET | /health | `{ok, db, admsPort, serverIps: [IPv4 addresses of this PC]}` |
| GET | /devices | list (status computed from last_seen_at vs window) |
| GET | /devices/:id | one |
| POST | /devices | pre-register `{name, serialNumber, location?, isActive?}` → 201 |
| PUT | /devices/:id | `{name?, serialNumber?, location?, isActive?}` |
| DELETE | /devices/:id | 204 |
| POST | /devices/:id/commands | `{type: 'info'|'check'|'reboot'|'syncTime'}` → 201 command row. (`syncTime` = `SET OPTION DateTime=<seconds-encoded ZK time>`; if unsure, implement INFO/CHECK/REBOOT only and leave a TODO.) |
| GET | /devices/:id/commands?limit=20 | recent commands |
| GET | /attendance?deviceId=&pin=&from=&to=&limit=100 | recent punches, newest first, with device name |
| GET | /adms-log?limit=100&serialNumber= | raw device requests (debug page) |

Device JSON: `{id, name, serialNumber, location, ipAddress, isActive, status, lastSeenAt, deviceName, firmwareVersion,
platform, pushVersion, userCount, fpCount, faceCount, attCount, autoRegistered, createdAt, updatedAt}`.
Command JSON: `{id, deviceId, command, status, returnCode, result, createdAt, sentAt, completedAt}`.
Attendance JSON: `{id, deviceId, deviceName, pin, punchTime ("YYYY-MM-DD HH:mm:ss" string, device local), status, verifyType, workCode, receivedAt}`.

## Frontend (Phase 1 revised)
- Devices page: summary cards; table with status badge, name, serial, last IP, location, users/faces/logs counts, last seen.
  Actions: Details, Edit, Delete. Auto-registered devices show a "new" tag.
- Setup panel (collapsible, shown expanded when there are no devices): "On the device go to Menu → Comm. → Cloud Server Setting,
  set Server Address to one of `serverIps` and port `admsPort`." Devices appear automatically once they call in.
- Add/Edit form: name, serial number, location, active. No IP/port/comm key.
- Device details modal/drawer: info fields, buttons Refresh info (INFO), Check for new data (CHECK), Reboot (confirm);
  recent commands table (auto-refresh 5s); last 20 punches from this device.
- Attendance page (enable the sidebar link): table of recent punches with device and date filters, refetch 10s.
- Device Log page (under a small "Diagnostics" sidebar link): /adms-log table, refetch 5s, body in a `<pre>`.

## Phase 2 — Employees & device users
Real device facts (VDE2244500040): 817 users, 421 fingerprints, 12 faces, push 2.4.1, `DeviceType=att`.
It sends ATTLOG with `Stamp=9999` and OPERLOG with `OpStamp=9999`; queued commands go out on `getrequest`.

### Fix carried over from Phase 1
Handshake always returned `ATTLOGStamp=None`, so any re-handshake (after CHECK/reboot) re-uploads the full 92k history.
Add `devices.attlog_stamp`, `devices.operlog_stamp` (text, null). On a successful ATTLOG/OPERLOG POST store the
`Stamp`/`OpStamp` query value. Handshake returns the stored values (`None` only when null). `CHECK` stays available.

### Database (003_employees.sql)
- `departments`: id serial pk · name text unique not null · created_at, updated_at.
- `employees`: id serial pk · emp_code text unique not null (= device PIN, digits only, ≤ 9 chars by default) · name text not null ·
  department_id fk → departments on delete set null · designation · card_no · device_password · privilege int default 0
  (0 normal user, 14 admin) · phone · email · join_date date · is_active bool default true · notes · created_at, updated_at.
- `device_users` (mirror of what each device holds): device_id fk cascade · pin text · name · privilege int · card_no ·
  password · grp text · raw text · last_seen_at timestamptz default now() · primary key (device_id, pin).
- `biometric_templates`: id serial · pin text not null · kind text not null (`fp`, `face`, `bio`) · bio_type int (BIODATA Type, null for fp/face) ·
  idx int not null default 0 (finger index / No) · valid int · size int · data text not null · raw text not null ·
  source_device_id fk on delete set null · updated_at · unique (pin, kind, coalesce(bio_type,-1), idx) (use a unique index on the expression).
- `user_photos`: pin text pk · file_name · content text (base64) · source_device_id · updated_at.

### Device data the server must ingest
User/template data can arrive in several shapes depending on firmware. Handle ALL of these, matching on the first token, and
upsert into `device_users` / `biometric_templates` / `user_photos` for the calling device:
- `POST /iclock/cdata?table=OPERLOG` lines starting `USER `, `FP `, `FACE `, `BIODATA `, `USERPIC `, `BIOPHOTO ` (OPLOG lines: count only).
- `POST /iclock/cdata?table=USERINFO|FINGERTMP|FACE|BIODATA|USERPIC` — same line formats, with or without the leading token.
- `POST /iclock/querydata?...` and `POST /iclock/devicecmd` bodies that contain such lines after the `ID=..&Return=..&CMD=..` line.
Line format: `TOKEN k=v\tk=v...`; keys are case-insensitive (`PIN`/`Pin`, `TMP`/`Tmp`, `Valid`/`VALID`, `FID`/`No`).
Reply `OK: <n>` to cdata posts. Log every raw request as today.

### Commands (adms/commands.js)
- Fetch users: `DATA QUERY USERINFO`; fetch templates: `DATA QUERY FINGERTMP`, `DATA QUERY BIODATA Type=9` (face) — exact response
  path to be confirmed against the device; the ingest above covers all known paths.
- Push user: `DATA UPDATE USERINFO PIN=..\tName=..\tPri=..\tPasswd=..\tCard=..\tGrp=1\tTZ=0000000100000000\tVerify=0\tViceCard=`
  then, for each stored template of that pin: `DATA UPDATE FINGERTMP PIN=..\tFID=..\tSize=..\tValid=..\tTMP=..` (fp) or
  `DATA UPDATE BIODATA Pin=..\tNo=..\tIndex=..\tValid=..\tDuress=0\tType=..\tMajorVer=..\tMinorVer=..\tFormat=..\tTmp=..` (bio,
  rebuilt from the stored raw line's fields).
- Delete user: `DATA DELETE USERINFO PIN=..`.
- Names: strip tabs/newlines; truncate to 24 chars.

### API (JSON camelCase)
| method | path | purpose |
|---|---|---|
| GET/POST | /departments | list (with employeeCount) / create `{name}` |
| PUT/DELETE | /departments/:id | rename / delete (employees keep, dept set null) |
| GET | /employees?q=&departmentId=&isActive=&page=1&pageSize=50 | `{items, total}`; q matches code/name/card |
| GET | /employees/:id | employee + `devices: [{deviceId, deviceName, onDevice, lastSeenAt}]` + `templates: {fp, face, bio}` counts |
| POST | /employees | create; 409 DUPLICATE_EMP_CODE |
| PUT | /employees/:id | update (emp_code change allowed only if no device holds it; else 409 EMP_CODE_ON_DEVICE) |
| DELETE | /employees/:id?removeFromDevices=true | delete; optionally queue `DATA DELETE USERINFO` on every active device |
| POST | /employees/push | `{employeeIds: number[] \| 'all', deviceIds?: number[]}` (default all active devices) → `{queued}` |
| GET | /devices/:id/users?q= | device_users rows + `employeeId` if an employee with that code exists |
| POST | /devices/:id/users/fetch | queue fetch-user and fetch-template commands → `{queued}` |
| POST | /devices/:id/users/import | `{pins?: string[], overwrite?: bool}` → create employees for missing codes (name/card/privilege/password from device); update existing only when overwrite → `{created, updated, skipped}` |
| DELETE | /devices/:id/users/:pin | queue delete on that device |
Attendance JSON gains `employeeId`, `employeeName` (left join employees on emp_code = pin).

### Frontend
- Employees page (`/employees`, enable sidebar): search, department filter, active filter, pagination; table code, name,
  department, card, privilege, devices-present count, template icons; Add/Edit modal; row actions Push to devices, Delete
  (confirm with "also remove from devices" checkbox); bulk select → Push selected; "Departments" button opens a manage modal.
- Device details modal: new "Users on device" tab — Fetch from device, search, table pin/name/card/privilege/linked employee,
  Import all / Import selected (with overwrite toggle), Remove from device.
- Attendance page: show employee name next to PIN.

## Later phases
3. Attendance processing: shifts, late/early, daily/monthly reports, CSV/XLSX export.
5. Auth for the web app, device time sync, holidays.
