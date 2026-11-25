# Attendance server

TypeScript (ESM) + Express 4 + PostgreSQL. ZKTeco **PUSH / ADMS**: the device calls this server over HTTP; the
server never connects to the device. See `../docs/PLAN.md`. The API contract (zod schemas, types, route catalogue)
lives in `../shared` (`@nacta/shared`) and is bundled into the build.

Two listeners in one process:

- JSON API for the web app on `PORT` (default 4000), prefix **`/api/v1`**
- ADMS for devices on `ADMS_PORT` (default 8081), bound to `0.0.0.0`, paths under `/iclock/*`

## Scripts (run from the repo root with `npm --workspace server run <script>`)

| Script | What it does |
|---|---|
| `dev` | `tsx watch src/index.ts`, pretty logs |
| `build` | `tsup` bundles `src/index.ts` (and `@nacta/shared`) into `dist/index.js` |
| `start` | `node dist/index.js` (JSON logs; `NODE_ENV` defaults to production) |
| `typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `test` | Vitest + supertest against the `attendance_test` database |
| `migrate` | applies `db/migrations/*.sql` to `DATABASE_URL` |
| `db:create` | creates the database named in `DATABASE_URL` if missing |
| `admin:reset-password -- <email>` | sets a new temporary password for a user (see "Resetting the Super Admin password") |

## Setup

```powershell
npm install                     # at the repo root (npm workspaces)
cd server
Copy-Item .env.example .env     # set the password in DATABASE_URL
npm run db:create
npm run migrate
npm run dev                     # API http://localhost:4000/api/v1, ADMS 0.0.0.0:8081
```

Check: `GET http://localhost:4000/api/v1/health` -> `{ ok, db, version, uptimeSec, admsPort, serverIps }`.

## Configuration (`.env`, validated with zod at startup)

A bad value stops the process with one line per problem (`PORT: Number must be less than or equal to 65535`).

| Variable | Default | Notes |
|---|---|---|
| `PORT` | 4000 | API port |
| `ADMS_PORT` | 8081 | device port |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/attendance` | |
| `CORS_ORIGIN` | `http://localhost:5173` | comma separated list of allowed origins |
| `DEVICE_ONLINE_WINDOW_MS` | 90000 | a device is "online" if seen within this window |
| `ADMS_TIMEZONE` | 5 | hours east of UTC sent to the device |
| `ADMS_AUTO_REGISTER` | true | `true/false/1/0/yes/no/on/off` |
| `ADMS_LOG_RAW` | true | store request bodies in `adms_requests` |
| `NODE_ENV` | development (production for `node dist/index.js`) | |
| `LOG_LEVEL` | info (silent in tests) | |
| `LOG_PRETTY` | true in development, false in production | |
| `SEED_ADMIN_EMAIL` | `admin@nacta.gov.pk` | email of the Super Admin created at first start |
| `SEED_ADMIN_NAME` | `Super Admin` | display name of that account |
| `SEED_ADMIN_PASSWORD` | (none) | initial password; only read when no Super Admin exists; never logged; must be changed at first sign-in |
| `SESSION_IDLE_MINUTES` | 30 | a session ends after this long without requests |
| `SESSION_MAX_HOURS` | 12 | absolute session lifetime |
| `COOKIE_SECURE` | false | set `true` when the web app is served over HTTPS (adds `Secure` to the cookie) |
| `TRUST_PROXY` | loopback | Express `trust proxy` for the **API app only** (the ADMS port never trusts forwarded headers). With the default, `X-Forwarded-For` is honoured when the hop is 127.0.0.1/::1 (the Vite dev proxy), so `req.ip` is the real LAN client for login rate limiting, sessions, `last_login_ip` and the audit log. Also accepts `true`/`false`, a hop count or a comma list of proxy IPs/CIDRs (Phase H) |
| `AUDIT_RETENTION_DAYS` | (unset = keep forever) | documentation only: the audit log is append-only and nothing is ever deleted. If set, startup logs a warning that archiving is Phase H |

`POLL_INTERVAL_MS` and `PROBE_TIMEOUT_MS` in older `.env` files are simply ignored.

## Layout

```
src/
  index.ts              start both servers, sweeper, graceful shutdown
  app.ts                createApiApp() (helmet, cors, json 1 MB, /api/v1) and createAdmsApp()
  config/               zod-validated environment
  db/                   pool, migrator, migrate / createDb scripts
  adms/                 parse, commands (builders), ingest (user/template/photo upserts), router (device protocol)
  modules/<feature>/    routes.ts (HTTP + zod validation) -> service.ts (rules) -> repo.ts (SQL, typed row mappers)
                        devices, commands, deviceUsers, employees (+ deviceSync, status, excel, import), wings (+ sections), attendance, admsLog, overview, health,
                        auth (sessions, passwords, seed, login rate limit), users, roles (+ /permissions)
  middleware/           pino-http request ids, error handler, auth (requireAuth, csrfProtect, passwordGate, requirePermission)
  scripts/              admin:reset-password
  lib/                  errors, logger, validate, pagination/sort allow-lists, http helpers, dates
test/                   Vitest + supertest (global setup migrates a fresh attendance_test)
```

## API conventions (`/api/v1`, see `shared/src/endpoints.ts`)

- Every body and query is validated with the shared zod schemas. Errors:
  `{ "error": { "code", "message", "details?", "requestId" } }`. Validation failures are
  `400 VALIDATION_ERROR` with `details = { field: firstMessage }` (camelCase field names, `_` for the body itself).
  Unknown errors are `500 INTERNAL`; the stack is logged, never returned.
- Every response carries `X-Request-Id` (a sane incoming one is reused, otherwise a UUID) and it appears in logs
  and error bodies.
- Lists: devices and wings are plain arrays. Employees, attendance, device commands, device users and
  adms-log return `{ items, total, page, pageSize }` and take `page`, `pageSize` (max 500), `sort`, `order`.
  `sort` must be one of the endpoint's allowed keys (anything else is a 400 listing them). Empty query values
  (`?q=&from=`) are treated as absent.

| Endpoint | Sort keys (default) |
|---|---|
| `GET /employees` | `empCode` (numeric, default asc), `name`, `wing`, `bps`, `joinDate`, `createdAt` |
| `GET /attendance` | `punchTime` (default desc), `pin` (numeric), `employeeName`, `wingName`, `sectionName`, `deviceName`, `receivedAt` |
| `GET /devices/:id/commands` | `id` (default desc), `createdAt`, `status` |
| `GET /devices/:id/users` | `pin` (numeric, default asc), `name`, `lastSeenAt` |
| `GET /adms-log` | `id` (default desc), `createdAt`, `serialNumber`, `path` |

- `GET /attendance` filters: `deviceId`, `employeeId`, `wingId`, `sectionId`, `pin` (exact), `q` (pin or employee name,
  contains), `from` / `to` (inclusive calendar dates, device-local time). Rows include `wingName` and `sectionName`.
- `GET /overview`: devices online, employees, today's punches / distinct employees present and the last 14 days.
  "Today" is the database session's `current_date` (server PC and device both run on Pakistan time).
  `present` counts distinct employees (punches whose PIN matches an employee); `punches` counts every row.
- `DELETE` returns 204 (except `DELETE /devices/:id/users/:pin`, which queues a command and returns `{ queued: 1 }`).
- helmet and CORS (`CORS_ORIGIN`) apply to the API only; the JSON body limit is 1 MB.

## Authentication, roles and wing scoping (Phase B)

Everything under `/api/v1` needs a session except `GET /health` and `POST /auth/login`. ADMS (`/iclock/*` on
`ADMS_PORT`) is **not** authenticated: devices do not log in.

- **Accounts.** The only built-in role and account is **Super Admin** (`SEED_ADMIN_*`). It holds every permission and
  all wings, cannot be disabled, deleted, re-roled or unlocked by others, and the role cannot be edited, deleted or
  assigned to anyone else through the API (`PROTECTED_ACCOUNT` / `PROTECTED_ROLE`). Every other role is created from
  scratch by the Super Admin from the catalogue in `shared/src/auth.ts`. There are no approval workflows.
- **Seeding** runs at every server start after config load and is idempotent: ensure the system role, and if nobody
  holds it create the account from `SEED_ADMIN_*` with `must_change_password = true`. The seed password bypasses the
  password policy (the policy applies to every later password) and is never logged. Run `npm run migrate` first.
- **Passwords** are hashed with **argon2id** (`@node-rs/argon2`, 19 MiB / 2 passes / 1 lane). Policy: the shared
  `zNewPassword` rules (12+ chars, upper + lower, digit, symbol) plus: must not contain the email name (the part
  before `@`, case-insensitive, when 3+ characters) and must not be, or trivially vary, one of about 1,000 common
  passwords (`src/modules/auth/common-passwords.ts`; `Password123!` and `P@ssw0rd1234!` are rejected).
- **Sessions** are rows in `sessions`; the cookie `nacta_sid` carries 32 random bytes (base64url) and only its sha256
  is stored. The cookie is `HttpOnly; SameSite=Strict; Path=/` (and `Secure` when `COOKIE_SECURE=true`), a browser
  session cookie. Idle timeout `SESSION_IDLE_MINUTES` (`last_seen_at` is refreshed at most once a minute) and an
  absolute `SESSION_MAX_HOURS`. Expired, revoked or disabled-user sessions answer `401 UNAUTHENTICATED` and clear the
  cookie. `GET /health` never extends a session.
- **CSRF.** Every `POST/PUT/PATCH/DELETE` except `/auth/login` must send `X-CSRF-Token: <csrfToken>` (from
  `/auth/login` or `/auth/me`), otherwise `403 CSRF_INVALID`. Unauthenticated requests are `401` before the CSRF check.
  CORS answers with `credentials: true` for the origins in `CORS_ORIGIN`.
- **Login security.** Unknown email and wrong password are the same `401 INVALID_CREDENTIALS` (a dummy hash is
  verified so timing does not reveal the email). 5 consecutive failures lock the account for 15 minutes: the failing
  5th attempt and later ones answer `423 ACCOUNT_LOCKED` with `details.lockedUntil`, even for the right password.
  Disabled accounts get `403 ACCOUNT_DISABLED` only after a correct password. 20 login attempts per 15 minutes per IP
  (in memory, counted for every attempt) give `429 RATE_LIMITED` with `Retry-After`. Behind a reverse proxy set
  Express `trust proxy` first, otherwise every client shares the proxy's IP. Success rotates `previous_login_*` from
  `last_login_*`.
- **must_change_password.** While set, every route except `GET /auth/me`, `POST /auth/change-password` and
  `POST /auth/logout` answers `403 PASSWORD_CHANGE_REQUIRED`. Changing the password verifies the current one
  (`400` with `details.currentPassword` otherwise), applies the policy, clears the flag, signs out the user's other
  sessions and returns `SessionInfo`. Admin-created users and `reset-password` always set the flag.
- **Authorisation.** `requirePermission(...keys)` (any-of) is on every route; Super Admin has every key. Multi-key
  rules: device-user import needs `devices.users` **and** `employees.manage` (and all-wings scope, because it can
  create/overwrite employees of any wing); `DELETE /employees/:id?removeFromDevices=true` also needs
  `employees.push`. `GET /wings` accepts any of `employees.view`, `attendance.view`, `wings.manage`,
  `roles.manage`; `GET /roles` and `GET /permissions` accept `roles.manage` or `users.manage`.
  See `test/rbac.test.ts` for the full route table.
- **Wing scope** = `all` if any of the user's roles has `all_wings`, otherwise the union of `role_wings` (a role whose
  wings were all deleted sees nothing). It is applied in SQL (`src/lib/scope.ts`): employee list/detail/update/delete/
  push (out of scope: 404, or silently skipped for push), attendance (punches whose PIN has no employee, or an employee
  without a wing, are visible only to `all`), overview employee/punch counts and the wing list. A limited caller may
  only create or move employees into their own wings, cannot create wings, and may rename/delete only their own.
  Device-user listing and devices are not scoped.
- **Admin rules.** Users cannot delete or disable themselves (`403 FORBIDDEN`). `reset-password` and `status=disabled`
  sign the user out everywhere. Only a Super Admin may reset the Super Admin's password or end its sessions.
  A role with users cannot be deleted (`409 CONFLICT`, `details.userCount`). `activeSessions` counts sessions that are
  not revoked, not past their lifetime and not idle-expired. Role ids must exist (`400 roleIds` otherwise).

### Resetting the Super Admin password

If the Super Admin is locked out or forgot the password, run on the server (it talks straight to the database in
`DATABASE_URL`, no running API needed):

```powershell
cd server
npm run admin:reset-password -- admin@nacta.gov.pk          # prompts twice (hidden input)
# or non-interactively:
$env:ADMIN_NEW_PASSWORD = '<temporary password>'; npm run admin:reset-password -- admin@nacta.gov.pk
```

It sets the password (8-128 characters; the policy is not applied to this temporary password, like the seed), sets
`must_change_password`, clears any lock, re-enables the account and signs out all of its sessions. The user must then
choose a policy-compliant password at the next sign-in. Works for any user email, not only the Super Admin.

## Audit log (Phase C)

`audit_logs` (migration `005_audit.sql`) records who did what, when and from where. The action catalogue, categories
and the `AuditEntry` contract live in `shared/src/audit.ts`.

- **Append-only at the database level.** A row trigger rejects every `UPDATE` and `DELETE`, and a statement trigger
  rejects `TRUNCATE`, for all roles including the owner. `user_id` is a plain integer (no foreign key) so deleting a
  user never touches audit rows; `user_email` / `user_name` are snapshotted on every entry. There is no purge job:
  `AUDIT_RETENTION_DAYS` is documentation only (a warning is logged at startup if set; archiving is Phase H).
- **Writing entries.** `audit(req, { action, summary, entityType?, entityId?, entityLabel?, changes?, metadata? })` from
  `src/modules/audit/service.ts` fills user, session, IP, user agent and request id from the request. It never throws and
  does not block the response (background insert, three attempts, failures are logged). `diff(before, after, fields,
  labels?)` builds the `AuditChange[]`. Passwords, temporary/device passwords, CSRF tokens and password hashes are
  replaced by `[redacted]` in `changes` and `metadata`.
- **Instrumented explicitly** in each module's routes (auth, employees, wings, devices, commands, device users, users,
  roles). Summaries use ASCII `->` and role/wing names, never ids.
- **Safety nets.** `access.denied` (missing permission, 403s and wing-scope 404s; at most one per session and route per
  minute) and `api.write` (any successful POST/PUT/PATCH/DELETE under `/api/v1` that no explicit entry covered; method,
  path and status only, never bodies; `/audit/views` and `/auth/me` are excluded). Adding a write route without
  auditing it therefore still leaves a trace, but give it a real `audit()` call.
- **Routes** (`audit.view` unless noted): `GET /audit` (filters `q`, `userId`, `action`, `category`, `outcome`,
  `entityType`, `entityId`, `from`, `to`; newest first; `q` matches summary, entity label, user email and name),
  `GET /audit/:id`, `GET /audit/summary` (default: last 7 days), `GET /audit/export` (same filters, CSV with UTF-8 BOM,
  `nacta-audit-YYYYMMDD-HHmm.csv`, streamed in batches, capped at 100,000 rows, itself logged as `audit.export`),
  `POST /audit/views` (any signed-in user; deduplicated per session + path for 60 s; 204). Dates are Asia/Karachi days.
- **Tests** share one database and cannot clear `audit_logs`, so `test/audit.test.ts` reads only rows written after its
  own baseline id.
## Logging

pino + pino-http. Pretty in development, JSON in production. API requests log at info (warn for 4xx, error for
5xx). ADMS requests log at **debug** only because devices poll constantly; set `LOG_LEVEL=debug` to see them.
The raw device traffic is also stored in `adms_requests` (newest 5000 kept), viewable via `/api/v1/adms-log`.

## Configuring the device

1. On the device: Menu -> Comm. -> Cloud Server Setting.
2. Server Address: the PC's IPv4 (shown in `serverIps` from `/api/v1/health`, e.g. `192.168.1.200`); Port: `8081`.
   Leave HTTPS off.
3. Save. Within about a minute the device appears in the Devices list (auto-registered as `Device <serial>`).
   Rename it in the UI. You can also pre-register a device with its serial number.
4. Punches are uploaded in real time and stored in `attendance_logs`. Use the Device Log page (`/api/v1/adms-log`)
   to see exactly what the device sends.

## Windows firewall

Inbound **TCP 8081** must be allowed on the server PC, otherwise the device cannot reach it (the browser on
the PC itself will still work, which can be misleading). Add the inbound rule yourself, e.g. in an elevated
PowerShell: `New-NetFirewallRule -DisplayName "ADMS 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow`.
Also make sure the Ethernet network profile does not block it.

## ADMS behaviour (unchanged by the TypeScript migration)

All device responses are `text/plain` with HTTP 200 and never a 500 (errors are logged and answered `OK`).
Handshake lines are CRLF separated, command lists (`C:<id>:<cmd>`) LF separated. Every request is recorded in
`adms_requests`. Unknown serial with `ADMS_AUTO_REGISTER=false` gets 404. Inactive devices are touched and logged
but get `OK` and no commands or data processing. No helmet headers and no `X-Request-Id` are added to ADMS responses.

Request bodies of any Content-Type (limit 20 MB), CRLF or LF, and empty bodies are accepted. The serial is read from
the `SN` query parameter (key is case-insensitive); paths are case-insensitive and an `.aspx` suffix is ignored.

- Ingest: `USER`, `FP`, `FACE`, `BIODATA`, `USERPIC`, `BIOPHOTO` lines are upserted (one transaction, batched) from
  `cdata` OPERLOG, `cdata?table=USERINFO|FINGERTMP|FACE|BIODATA|USERPIC|BIOPHOTO` (token optional), `querydata` and
  `devicecmd` bodies. See `src/adms/parse.ts` (`parseUserData`).
- The `Stamp` / `OpStamp` of a successfully stored ATTLOG / OPERLOG upload is kept per device and returned in the
  handshake, so a re-handshake does not re-upload history. A batch that fails to store is answered `ERROR: database`
  so the device retries it.
- Commands (`src/adms/commands.ts`): `DATA UPDATE USERINFO` / `FINGERTMP` / `FACE` / `BIODATA`, `DATA DELETE USERINFO`,
  `DATA QUERY USERINFO|FINGERTMP|BIODATA Type=9`. Device names are cut to 24 characters. Confirmed
  `DATA UPDATE/DELETE USERINFO` commands update `device_users` as soon as the device acknowledges them.

## Wings, employees and device access (Phase D)

**Schema (migration `006_wings_employees.sql`).** `departments` is renamed to `wings` (ids, sequence, foreign keys and
`role_wings.wing_id` are preserved) and gains `code` (unique, case-insensitive, nullable) and `head_name`. `sections`
belong to a wing (unique per wing, case-insensitive; deleting a wing deletes its sections). `employees` gains
`wing_id` (was `department_id`), `section_id`, `father_name`, `cnic` (unique when set, stored as `12345-1234567-1`),
`gender`, `bps` (1-22), `employment_type`, `status` (`active` / `disabled` / `left`, replaces `is_active`: inactive
rows become `disabled`), `status_reason`, `status_changed_at`, `left_date`, emergency contact and `address`. A trigger
makes `section_id` belong to `wing_id`. `role_permissions`: `departments.manage` becomes `wings.manage`, and every role
that held `employees.manage` is also granted `employees.import`. `employee_device_holds(employee_id, device_id,
removed_at, reason)` remembers which devices a disabled / left employee was removed from. `device_commands` gains
`employee_id` (drives `deviceSync`) and `after_command_id` (ordering, below).

**Wings and sections.** `GET /wings` returns wings with their sections and employee counts (wing-scoped). Writes need
`wings.manage` (creating a wing also needs all-wings scope). `DELETE /wings/:id` keeps the employees and clears their
wing and section. `409 DUPLICATE_WING` / `DUPLICATE_SECTION`. Audited as `wing.*` / `section.*` with diffs.
`/departments` no longer exists.

**Employees.** All new fields are in list, detail, create and update. The CNIC is masked as `*****-*******-N` unless the
caller holds `employees.manage`; `q` matches code, name, card and designation, and CNIC digits only for managers.
A CNIC is masked in every audit entry. Filters: `wingId`, `sectionId`, `status`, `employmentType`, `biometrics`
(`has_fingerprint`, `has_face`, `has_photo`, `none`), `deviceSync`. `hasPhoto` comes from `user_photos`. A duplicate CNIC
is `409 CONFLICT` (`details.cnic`). Moving an employee to another wing clears the section unless a matching one is sent.

`deviceSync` is computed from the latest command per device queued for the employee (`device_commands.employee_id`):
any latest command `failed` gives `failed`; any `pending`/`sent` gives `pending`; otherwise an active employee is
`synced` when a device holds them and `not_on_device` when none does, and a disabled / left employee is `synced` when no
device holds them and `pending` while one still does.

**Profile sync on edit.** Saving an *active* employee who is on devices (`device_users`) and changed name, card, device
password or role queues `DATA UPDATE USERINFO` to every holding device (audited as `employee.device_sync`). Disabled and
left employees are never pushed, and `POST /employees/push` skips them.

**Status (`POST /employees/:id/status`, needs `employees.manage` and `employees.push`).** Nothing waits for a device.
- *To disabled / left:* for every device holding the PIN the server queues `DATA QUERY BIODATA PIN=<pin>`,
  `DATA QUERY USERPIC PIN=<pin>` and then `DATA DELETE USERINFO PIN=<pin>`, and records the holds. Commands go out in id
  order, and the delete carries `after_command_id` = the last refresh command: it is not handed to the device until that
  command finished and `DEPENDENCY_GRACE_SECONDS` (20 s) passed so the device could upload the answer (or after 10
  minutes, so a lost command can never block a removal). `disabled <-> left` has no device effect.
- *`409 NO_BIOMETRIC_BACKUP` heuristic.* For each holding device, compare the totals the device reports (`devices.fp_count`
  = FPCount, `options.FaceCount`) with the templates stored for the pins on that device. The employee is blocked when
  they have **no** stored fingerprint (or face) while the device reports more of that kind than we hold in total (for
  example FaceCount 676 vs 612 stored). `details.reasons` explains. `force: true` skips the check (refresh and delete are
  still queued); anyone with at least one stored template of the kind, anyone on no device, and devices that report no
  totals are never blocked. Employees who never enrolled can trip it too; they need `force`.
- *To active:* to each held device (every active device when none is recorded): `DATA UPDATE USERINFO`, every stored
  template (BIODATA rebuilt from the raw line: Type 1 fingerprints, Type 9 faces; legacy FP/FACE rows too), then
  `DATA UPDATE USERPIC PIN=..\tFileName=..\tSize=..\tContent=..`, then the holds are cleared. `Size` is the length of the
  base64 text (as the device itself sends it); `user_photos` does not record USERPIC vs BIOPHOTO, so photos always go as
  USERPIC.
- *Unverified on the real device:* the per-PIN `DATA QUERY BIODATA|USERPIC PIN=` syntax. The device log only shows
  `DATA QUERY USERINFO` being accepted (it answered by uploading all users, photos and BIODATA through OPERLOG). If the
  device ignores the PIN filter, the answer is simply the whole upload, which ingest already handles. The two builders
  are in `src/adms/commands.ts` (`queryBiodataForPin`, `queryUserPicForPin`).
- Sets `status`, `status_reason`, `status_changed_at` and `left_date` (only for `left`), audited as `employee.status`.

**Excel round trip.** `GET /employees/export.xlsx` (needs `employees.import`; same filters as the list) writes
`NACTA-Employees-YYYYMMDD-HHmm.xlsx` with sheets Employees, Lists and Instructions (see `src/modules/employees/excel.ts`).
The CNIC column is left out unless the caller holds `employees.manage`; device passwords are never exported.
`POST /employees/import/preview` (multipart field `file`, `.xlsx`, 10 MB, needs `employees.import` and
`employees.manage`) validates every row with the shared field schemas and writes nothing; it returns the `ImportPreview`
and a token (30 minutes, in memory, single use, bound to the user). `POST /employees/import/commit` applies the plan in
one transaction (a failing row is rolled back to a savepoint and counted as skipped), creating unknown wings / sections
when `createMissing` is true and the caller has all-wings scope, then queues the device commands in the same
transaction: new employees are *not* sent to devices; profile changes re-send USERINFO; status changes use the same
refresh / delete / restore logic as above (always with `force`, risks are shown as row warnings in the preview).
Changing status from a sheet needs `employees.push`. Wing scope applies to both the current and the new wing of each
row. Unknown columns produce a warning (carried on a pseudo-row with `row: 1`); a missing Employee Code column is
`400 INVALID_FILE`; a used or expired token is `410 IMPORT_EXPIRED`.

## Biometrics in the application (Phase E, server half)

**Schema (`007_biometrics.sql`).** `user_photos` gains `source` (`device`/`app`), `size_bytes` (decoded; backfilled
without touching `updated_at`) and `version` (bumped whenever the picture changes: the `?v=` cache buster).
`biometric_templates` gains `source`. New `biometric_tombstones(pin, kind, bio_type, idx, deleted_at)`. Every role that
held `employees.manage` is granted `employees.biometrics`.

**Photo.** `GET /employees/:id/photo` (`employees.view`, wing scope; 404 when out of scope or none) sends the JPEG with
`ETag` (hash of pin + version), `Cache-Control: private, max-age=300` and honours `If-None-Match` (304). A stored picture
that is not a JPEG is still served with a sniffed type. `PUT` (`employees.biometrics`, multipart field `photo`) accepts
only baseline JPEGs: magic `FF D8 FF`, max 256 KB, progressive (SOF2) rejected, 240x240 to 1280x1280 read from the SOF
marker (no native deps; all failures `400 INVALID_FILE`). Stored as `<pin>.jpg`, source `app`, version + 1. For an
active employee on devices (`device_users`) it queues, per device, `syncToDevices` (default true) `DATA UPDATE USERPIC
PIN=<pin>\tFileName=<pin>.jpg\tSize=<base64 length>\tContent=<base64>` and `createFace` (default **true** when the
employee is on at least one device, otherwise false; overridable by query or form field) `DATA UPDATE BIOPHOTO PIN=<pin>\tType=9\tSize=<base64
length>\tContent=<base64>\tFormat=0\tUrl=\tPostBackTmpFlag=1`. The two options are independent. The face template the device
posts back is ingested as any BIODATA (source `device`). A device USERPIC identical to the stored one changes nothing;
a different one replaces it, becomes source `device` and bumps the version. `DELETE` removes the app copy only (404 when
the stored photo came from a device). Audit entries carry size, dimensions and options, never image bytes.

**Listing.** `GET /employees/:id/biometrics` (`employees.view`): Type 1 or legacy `fp` = finger (`fingerIndex` = idx),
Type 9/2 or legacy `face` = face, the rest `other`; `version` is `MajorVer.MinorVer` from the stored line, `sizeBytes`
the decoded length; `activity` = last 20 commands linked to the employee whose command is `ENROLL_*`, `DATA UPDATE
BIOPHOTO|USERPIC|BIODATA`, `DATA DELETE BIODATA|FINGERTMP` or `DATA QUERY BIODATA` (name only).

**Remote enrolment.** `POST /employees/:id/enroll` (`employees.biometrics`) -> 202 `{commandId}`; `409 NOT_ON_DEVICE`
unless the employee is active and in that device's `device_users`. Commands: `ENROLL_FP PIN=<pin>\tFID=<idx>\tRETRY=3\t
OVERWRITE=<1|0>` and `ENROLL_BIO TYPE=9\tPIN=<pin>\tCNT=1\tRETRY=3\tOVERWRITE=<1|0>`. No refresh is queued: the device
uploads the template itself and the OPLOG fallback in `router.ts` covers the rest. Read the device's return code in the
command list (`device_commands.return_code`); these two commands are untested on the real device.

**Deleting a template.** `DELETE /employees/:id/biometrics/:templateId?fromDevices=true` removes the row and queues
`DATA DELETE BIODATA Pin=<pin>\tType=<bioType>\tNo=<idx>` (legacy rows: `DATA DELETE FINGERTMP PIN=<pin>\tFID=<idx>`,
`DATA DELETE FACE PIN=<pin>\tFID=<idx>`) to every device holding the PIN. *Re-ingest protection:* the delete writes a
tombstone; `ingest` drops any template matching a tombstone younger than 10 minutes (`TOMBSTONE_MINUTES`). A device
confirming the delete (`devicecmd` success) removes the tombstone, unless another device still has the same delete
pending. Asking to enrol that finger/face again, or capturing it, also clears it. Without `fromDevices` no tombstone is
written (the devices keep it and may send it again on the next refresh). `DATA DELETE BIODATA` is untested on the device.

**Fingerprint capture (future USB bridge).** `POST /employees/:id/fingerprints` stores a template as source `app` (BIODATA
raw line built with `Type=1`, the given MajorVer/MinorVer) after checking its major version against the Type 1 rows
stored for the devices the employee is on (any device when none; 13 when nothing is stored); otherwise
`409 TEMPLATE_INCOMPATIBLE {expected, got}`. `syncToDevices` pushes `DATA UPDATE BIODATA`.

## Attendance rules (Phase F, server half)

Rules are layered on top of the raw punches (`attendance_logs`, never edited): office timings, holidays, leave,
corrections and the computed daily status. Migration `008_attendance_rules.sql` adds the tables, the seed and an
`attendance_logs (pin, punch_time)` index. All dates are Pakistan time (`Asia/Karachi`); punch times are the device's wall clock.

**Permissions** (none is granted automatically; the Super Admin decides): `attendance.correct`, `leave.manage`,
`leave.configure`, `holidays.manage`, `timings.manage`, plus `attendance.view` for reading. Each route needs exactly the
permission in `shared/src/endpoints.ts`; GET lists accept the any-of sets listed there. Wing scope applies to leave,
corrections, holidays (a limited user sees and edits only holidays whose wings are all theirs; an all-wings holiday needs
all-wings access), timing assignments (the wing / employee must be in scope; an organisation-wide assignment, editing a
profile and changing the default need all wings) and every read.

**Seed.** Leave types CL, EL, ML, SL, OD (counts as present), MAT, LWP; the default profile "Standard office hours"
(Mon-Fri 09:00-17:00, Sat/Sun off, late grace 30, early grace 0, half day below 240 min), effective from the earliest punch
date (2000-01-01 on an empty database) and `confirmed`. No holidays.

**Timings are versioned and apply forwards.** `timing_profile_versions` holds each profile's rules by `effective_from`; the
engine uses the version with the latest `effective_from <= date`. `PUT /timings/:id` takes the profile body plus optional
`effectiveFrom` (default today); a date before today is `400 VALIDATION_ERROR` on `effectiveFrom` ("Timing changes apply from
today onwards") unless the default profile is not yet `confirmed` (initial setup; any save, make-default or create sets it).
Saving on an existing version's date replaces that version. Assignments follow the same rule on create. PATCH /timing-assignments/:id {effectiveTo|null} ends, shortens or extends one (neither the old nor the new end may be before yesterday, outside initial setup); DELETE only works before the assignment starts. `POST /timings/:id/default` makes a profile the default from today; the
previous default is pinned to the past with an organisation-wide assignment labelled "Previous default" so history is kept.
Resolution per employee and date: employee assignment > wing assignment > organisation-wide assignment > default; within a
level a dated assignment beats an open-ended one, then latest `effectiveFrom`, then highest id.
`GET /timings/setup-status` returns `{ configured }` (the default profile has been saved by a user).

**Engine** (`src/modules/attendance/engine.ts`, pure and unit-tested in `engine.test.ts`):
- Inactive before `join_date`, and from the disabled date (`status_changed_at`, Pakistan date) or the day after `left_date`.
- `firstIn` = earliest punch; `lastOut` = latest punch only if at least 60 s after the first (otherwise a single punch).
  Manual `add_punch` corrections are merged in. Times are compared floored to the minute, so exactly start + grace is on time.
- Holiday (a `holiday` for the employee's wing; beats a `working_day`) -> `holiday`; a day off per timings -> `weekend`;
  a `working_day` turns a day off into a working day using the profile's first working weekday's hours. Punches still show.
- Working day: full leave -> `leave` (type attached; official duty is flagged as counting as present). Half-day leave: other
  half covered (stayed to its end and worked at least half of it) -> `present`/`late`, otherwise `half_day` (pending while the day runs).
- With punches: `late` if firstIn > start + graceLate (`lateMinutes` = firstIn - start); `earlyLeave` flag if lastOut <
  end - graceEarly once the office has closed; `half_day` if worked < halfDayBelow once closed; `incomplete` if only one punch
  and the day is over (now > end + 2 h). Without punches: `absent` once over, else `pending`; the future is `pending`.
- `set_status` corrections override the computed status (latest wins) and set `corrected`; inactive days are never overridden.

**Leave overlap.** `409 LEAVE_OVERLAP` details are one entry per clashing existing leave: `{ employeeId, name, dates: [{ from, to }], leaveType: { name, code, color } }` (the dates are the clashing part of the requested range).

**Session idle clock.** Requests carrying `X-Background-Refresh: 1` (the client's permission poll of `/auth/me`) do not refresh `last_seen_at`, but still get 401 once the session is idle-expired.

**Cache and worker.** `attendance_days` caches one row per (employee, date up to today); future days are always computed on
the fly. `attendance_dirty` is the queue. Marked dirty: new ADMS punches (same statement as the insert), leave, holiday,
timing, assignment, correction and leave-type changes, `POST /attendance/recompute`, and (DB trigger) employee status, join
date, wing or code changes. Ranges up to 62 days are queued for every employee-day; longer ones requeue the cached days.
The in-process worker (`worker.ts`, started from `index.ts`) runs every 5 s without overlapping, recomputes batches of 500
with set-based queries and yields between batches. On start, if `attendance_days` is empty it queues every employee for every
day from the earliest punch to today (logged; about 103k rows for 818 employees x 126 days, roughly 15 s to compute). Every 15
minutes today's cached rows are requeued (pending -> absent, early leave and half-day depend on the clock); at 01:00 yesterday
and today are requeued for everyone. Reads never wait for the worker: dirty or stale (today, older than 5 min) rows are
recomputed on the fly, so `/attendance/daily` is always complete and current.

**Read endpoints.** `GET /attendance/daily` (every employee in scope, filters `wingId`, `sectionId`, `status`, `q`, sort keys
name (default), empCode (numeric), wing, status, firstIn, lastOut, workedMinutes, lateMinutes), `GET /attendance/days` (one employee, up to 400
days), `GET /attendance/day-summary` (counts per status over employee-days; `attendanceRate` and `punctualityRate` are
percentages with one decimal: (present + late + half_day + leave that counts as present) / (present + late + half_day +
incomplete + absent + leave), and present / (present + late)). `GET /overview` also carries `todayStatus` (counts per status).
`getDays(scope, filter, range)` in `src/modules/attendance/days.ts` is the service function Phase G exports reuse.
## Dashboard, reports and exports (Phase G, server half)

- `GET /dashboard[?wingId=]` (`dashboard.view`): wing-scoped; `wingId` narrows everything except `devices` (still inside the caller's scope). `headcount` (overall and per wing) counts people whose day is present, late, half day, missing punch, absent, leave or pending; **holiday, weekend and inactive are excluded**. In `byWing`: `present` = present + half day + missing punch, `late` = late, `onLeave` = leave, `absent` = absent, `pending` = pending. `trend`: last 30 days (oldest first), `workingDay` = anyone was expected; rates use the same definition as `/attendance/day-summary`. `topLate`: most `late` days in 30 days (top 8). `liveFeed`: 15 latest punches today (`time` = `YYYY-MM-DD HH:mm:ss`); PINs that match nobody are shown to organisation-wide users only.
- `GET /reports/:type` (`attendance.view`) -> `ReportResult` (paged) plus `extraTables` (second tables of late comers and absentees). Rows about an employee also carry hidden `employeeId` and `hasPhoto`. `GET /reports/:type/export?format=xlsx|pdf` (`attendance.export`, audited as `attendance.export` with `{type, format, filters, rowCount, fileName}`) streams the file with an ASCII `Content-Disposition` name such as `NACTA-Monthly-Register-Operations-2026-11.xlsx`.
- Extra params beyond `REPORT_TYPES`: `q` (daily, punch_log), `sectionId` (punch_log). Defaults: daily = today, monthly register = this month, ranges = first of the month to today (time card likewise), punch log = today. Ranges are capped at 366 days (punch log 92); more than 100,000 rows (PDF: 25,000) is a 400.
- The "Corrected" column exists for the Super Admin only (daily and time card), on screen and in files.
- Excel uses exceljs; PDF uses pdfmake 0.3.13 with the Roboto fonts from `node_modules/pdfmake/fonts` resolved at run time (no copying needed; `npm install` on the server is enough). The logo is `assets/nacta-logo-180.png` and must be deployed next to `dist/` (the `assets` folder).
## Tests

`npm --workspace server run test` creates `attendance_test` on the server named in `.env` (same credentials,
different database; the suite refuses any database whose name does not end in `_test`), drops its schema, applies all
migrations, then runs Vitest: the ported parse selftest (`src/adms/parse.test.ts`), the ADMS device flow
(`test/adms.test.ts`), the API (`test/api.test.ts`), authentication (`test/auth.test.ts`), users and roles
(`test/admin.test.ts`), permissions / wing scoping (`test/rbac.test.ts`) and Phase D: migration 006 on a database holding Phase C data (`test/migration006.test.ts`), wings and sections (`test/wings.test.ts`), employee fields, profile sync and status changes (`test/employeesD.test.ts`) and the Excel export / import round trip (`test/excel.test.ts`), and Phase E photos, biometrics, enrolment, deletion and re-ingest protection (`test/biometrics.test.ts`), and Phase F: the engine (`src/modules/attendance/engine.test.ts`) and the rules API, versions, leave, corrections, worker and backfill (`test/rules.test.ts`). It never touches the `attendance` database.
`resetDb()` in `test/helpers.ts` seeds the Super Admin and signs in; `api` is that signed-in client (cookie + CSRF token
added automatically), `rawApi` is anonymous, and `userClient({ permissions, wings })` returns a signed-in user with a
fresh role.
