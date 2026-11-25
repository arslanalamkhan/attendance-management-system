# NACTA Attendance — Product Roadmap

> Status: **approved with changes** (no seeded roles besides Super Admin; no approval workflows). Phases 1–2 of `PLAN.md` (device connectivity, employees, device users) are built and
> running against the SenseFace 7A (SN VDE2244500040, 817 users). This roadmap takes the product from a working
> prototype to a production system for NACTA.

---

## 1. Product vision

A secure, auditable attendance platform for NACTA that:

- collects punches from ZKTeco devices in real time (PUSH/ADMS, already working);
- organises people by **Wing** (and optional sections), with a single source of truth for employee records;
- lets authorised staff enrol **photos, faces and fingerprints from the web app**, then distributes them to every device;
- turns raw punches into **attendance decisions** (present, late, absent, leave, holiday…) using office timings,
  holidays and leave;
- gives each role exactly the access it needs, **scoped to wings** where required;
- records **who did and viewed what, and when** — logins, page views, exports, edits, device commands;
- looks and feels like a premium enterprise product: fast, calm, consistent, accessible, light and dark.

### Users and roles
- **Super Admin** (`admin@nacta.gov.pk`) is the only built-in account and role. It has every permission, including
  roles, users, audit log and system settings, and cannot be deleted, disabled or locked out.
- **No other roles are seeded.** Super Admin creates roles from scratch as needed, choosing permissions from the
  catalogue (grouped by module) and, optionally, limiting the role's users to specific wings.

---

## 2. Architecture decisions

| Area | Decision | Why |
|---|---|---|
| Server language | **Migrate server to TypeScript** in Phase A (≈25 files today) | Shared types with the client, safer refactors as the codebase triples. |
| Server framework | Keep **Express 4**; add **zod** for every request schema | Proven, already running; zod gives one validation layer that also generates types. |
| Database | PostgreSQL 18, plain-SQL migrations (existing runner) | Already working; migrations stay reviewable. |
| Shared contract | New `shared/` package: zod schemas + TS types + permission catalogue, imported by server and client | One definition of every payload; agents can't drift apart (we hit this twice). |
| Auth | **Server-side sessions** in Postgres, `httpOnly` + `Secure` + `SameSite=Strict` cookie, **argon2id** password hashes, CSRF token on mutating requests | Revocable instantly (needed for "force logout", disabling users), no tokens in JS, simple to audit. |
| Authorisation | **Permission-based RBAC**: fixed catalogue of permission keys in code; roles = named bundles of keys; users have one or more roles + optional **wing scope** | Super Admin composes roles without code changes; wing scoping enforced in SQL, not in the UI. |
| Audit | Append-only `audit_logs` table (DB role can only INSERT/SELECT), written by middleware + explicit calls | Tamper-resistant trail of access, views, exports, changes. |
| Background work | In-process job runner backed by a `jobs` table (attendance recompute, report generation, cleanup) | No Redis needed; survives restarts; enough for one office. |
| Client UI stack | **Tailwind CSS + Radix UI primitives (shadcn/ui pattern)**, lucide icons, TanStack Query + **TanStack Table**, React Hook Form + zod, Recharts, `cmdk` command palette, Sonner toasts | Accessible primitives, a fully owned design system, best-in-class tables for 800+ rows. Replaces today's hand-written CSS. |
| Excel/PDF | **ExcelJS** (branded, styled workbooks), PDF via server-side HTML → **Playwright/Chromium** print | Exports that look official, not CSV dumps. |
| Fingerprint capture | **Local "Biometric Bridge"** app on the enrolment PC (see Phase E) | Browsers cannot talk to USB fingerprint readers; the app will be hosted on a server. |
| Device link | Keep ADMS on its own port; behind the reverse proxy in production | Devices stay HTTP on the LAN; the web app goes HTTPS. |

---

## 3. Design system ("billion-dollar" UX)

**Principles:** calm and dense-but-breathable; every screen answers one question; zero dead ends (every empty state
has an action); keyboard-first; nothing important more than two clicks away; consistent patterns everywhere.

- **Brand:** NACTA logo + a restrained palette — deep green primary (government, trust), neutral slate greys,
  semantic colours (success, warning, danger, info) used only for status. Inter (UI) + JetBrains Mono (IDs, PINs).
  Design tokens as CSS variables → light and **dark mode**, both WCAG AA contrast.
- **App shell:** collapsible sidebar grouped (Overview · People · Attendance · Devices · Administration), top bar with
  global search, **⌘K command palette** (jump to any employee, page or action), user menu, theme toggle,
  environment badge. Breadcrumbs on detail pages.
- **Login:** split screen — brand panel with NACTA identity and a subtle pattern, focused sign-in card, show/hide
  password, caps-lock warning, lockout messaging, "last signed in" shown after login.
- **Data tables (one component everywhere):** sticky header, column sorting, column visibility, density toggle,
  server pagination, row selection with bulk-action bar, saved filters ("views"), CSV/Excel export from the
  current view, skeleton loading, keyboard row navigation.
- **Detail pages over modals** for rich objects (employee profile, device, role). Modals only for short forms
  and confirmations. Side sheets for quick edits.
- **Employee profile:** header with photo, name, code, wing, status chips; tabs — Overview, Attendance
  (calendar heat-map + timeline), Biometrics (photo, faces, fingers with an interactive hand diagram), Devices,
  Leave, Activity (audit).
- **Feedback:** optimistic updates, toasts with undo where possible, inline validation, progress for long jobs
  (imports, pushes, exports) in a global "activity" tray.
- **Charts:** dashboard KPI cards with sparklines, presence by wing (stacked bar), punctuality trend, live
  punch feed.
- **Motion:** 150–200 ms ease-out transitions, no gratuitous animation; respects `prefers-reduced-motion`.
- **Responsive:** full functionality from 1280 px down to tablet; read-only dashboards usable on phones.
- **Print / export styling:** branded headers, page numbers, generated-by and timestamp on every export.

Deliverable of Phase A: a living `/design` page (component gallery) so every later phase reuses the same parts.

---

## 4. Phases

Each phase ends with: migrations applied, typecheck + build + tests green, verified against the real device where
relevant, and a short demo checklist. Work packages (WP) within a phase are sized for **parallel Sonnet agents**
with non-overlapping file ownership; the contract (shared zod schemas) is written first by Opus.

### Phase A — Foundation & design system
Goal: a professional base every later phase builds on.
- `git init`, `.gitignore`, conventional commits; npm workspaces: `server/`, `client/`, `shared/`.
- Server → TypeScript (tsx for dev, tsc build), zod validation, structured logging (pino), central config
  validation, `/api/v1` prefix, consistent pagination/sort/filter conventions, request IDs.
- Test harness: Vitest (server + client), supertest for API, a test database, the existing ADMS selftest ported.
- Client rebuild of the shell on the new stack: tokens, light/dark, sidebar, top bar, command palette skeleton,
  DataTable, form components, empty/loading/error states, `/design` gallery. Existing pages ported onto it.
- Run as Windows services for now (NSSM) so the server survives reboots.
- **WPs:** A1 server TS migration + tooling · A2 shared package + API conventions · A3 design system + shell ·
  A4 port existing pages to new components.

### Phase B — Authentication, users & roles
- Tables: `users`, `roles`, `permissions` (seeded catalogue), `role_permissions`, `user_roles`,
  `user_wing_scopes`, `sessions`, `password_resets`.
- Seed **Super Admin** `admin@nacta.gov.pk` from `.env` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) —
  password never committed; **forced password change on first login**.
- Login / logout / "log out other sessions", session idle timeout (30 min) + absolute lifetime (12 h),
  lockout after 5 failed attempts (15 min), password policy (12+ chars, not in common list),
  rate limiting on auth routes, CSRF protection, security headers (helmet).
- No roles are seeded besides Super Admin; Super Admin builds every other role from scratch.
- Super Admin UI: Roles (create from scratch; permission matrix grouped by module with descriptions), Users (create, assign roles,
  assign wing scopes, disable, reset password, force logout, see last login), My Account (change password,
  active sessions).
- Every API route declares its permission; wing-scoped routes filter by the caller's wings in SQL.
- Optional later: TOTP two-factor for admins.
- **WPs:** B1 auth backend · B2 RBAC + scoping middleware + admin APIs · B3 login + account UI ·
  B4 roles/users admin UI.

### Phase C — Audit & activity logging
- `audit_logs`: id, at, user_id, session_id, ip, user_agent, action (`auth.login`, `auth.login_failed`,
  `employee.update`, `report.export`, `page.view`, `device.command`, …), entity_type, entity_id, summary,
  `before`/`after` JSON diff for edits, request_id. Append-only DB grants.
- Captured automatically: logins/logouts/failures, every mutating API call, every export (with filters and row
  count), report and sensitive-page views (client sends `page.view` events; server dedupes per session per page per minute),
  device commands, enrolment actions.
- Audit Log UI: timeline with filters (user, action, entity, date range), detail drawer with diff view,
  per-user and per-employee activity tabs, export (itself audited).
- Retention setting (default: keep forever; archive older than N months).
- **WPs:** C1 audit backend + middleware · C2 audit UI + activity tabs.

### Phase D — Organisation & employee records
- Rename `departments` → **Wings** (migration keeps data), optional **Sections** under a wing.
- Employee profile fields: employee code (= device PIN), full name, father's name, **CNIC** (validated, masked in
  lists), **Wing**, Section, Designation, **BPS grade**, employment type (regular / contract / deputation / daily wages),
  joining date, contact, emergency contact, status (active / on leave / suspended / left) with effective dates, photo.
- **Excel round-trip (requested):** download employees as a formatted workbook (dropdowns for wing, section,
  status, etc.), edit it in Excel, re-import the same file: a preview shows every create/update and its device
  effect per row before anything is applied; blank cell = clear; rows are never deleted by import.
- **Status drives device access (requested):** Active / Disabled / Left. Disabling (or Left) refreshes the
  biometric backup from the device, then removes the person from every device so they cannot mark attendance;
  re-enabling restores user + fingerprints + face + photo to the same devices. Editing an employee who is on
  devices re-sends their device profile (name, card, privilege) automatically.
- Bulk move between wings, bulk enable/disable.
- Employee directory with saved views; rich profile page (see design system).
- Leaving an employee removes them from devices (with confirmation) but keeps history.
- **WPs:** D1 schema + APIs + import · D2 directory + profile UI · D3 wings/sections/designations admin UI.

### Phase E — Biometric enrolment from the application
Three paths, so enrolment works today and grows with hardware:
1. **Photo → face (no extra hardware).** Upload or capture a photo with the PC webcam in the browser, crop/align
   with on-screen guides and quality checks (face detected, lighting, size). Push it as `BIOPHOTO` to the
   SenseFace 7A, which builds the visible-light face template itself. *To verify on the device in a spike.*
2. *(Deferred 2026-11-24: no USB reader available. Fingerprints are enrolled on the terminal, started remotely
   from the app. Photos: webcam or upload, always saved as a 600x600 baseline JPEG ≤ 200 KB, the format the
   SenseFace already holds; the device advertises BioPhotoFun=1, so faces can be created from photos.)*
   **USB fingerprint reader via a local Biometric Bridge.** A small Windows tray app on the enrolment PC wraps the
   reader SDK and exposes `https://localhost:<port>` (WebSocket) to the web app only from the configured origin.
   Flow in the UI: pick finger on a hand diagram → place finger 3× → quality score → save template → push to devices.
   **Risk:** template format must match the device (device reports `FPVersion=13`; ZK9500/ZKFinger SDK produces v10).
   A spike confirms compatibility before building the full UI.
3. **Remote enrolment on the device.** From the app, send "enrol finger/face for PIN X" to a chosen device; the
   employee completes it at the terminal and the template syncs back automatically. Works with no PC hardware.
- Template library: every template stored centrally and pushed to all devices the employee belongs to;
  per-device sync status with retry.
- **Show what is already stored** (data has been in the DB since 23 Nov 2026: 613 photos, 421 fingerprint
  templates for 413 employees, 612 face templates — BIODATA Type 1 = finger, Type 9 = visible-light face):
  - permission- and wing-checked photo endpoint (`GET /employees/:id/photo`, cacheable, 404 → initials fallback);
    real photos in every avatar (directory, profile header, attendance, dashboard, device users);
  - Biometrics tab: enrolled fingers on a hand diagram, face template + photo, which devices hold each;
  - directory filter: has fingerprint / has face / has photo / no biometrics (to find who still needs enrolment);
  - device page: show the face count from the device options (`FaceCount`, 676) instead of the INFO field (12).
- **WPs:** E0 spike (BIOPHOTO + remote enrol + reader format) by Opus · E1 webcam capture + photo pipeline ·
  E2 Biometric Bridge app · E3 enrolment UI + template sync service.

### Phase F — Attendance engine
- **Decided 2026-11-24:** timings and grace are set by users in the app (no assumed NACTA hours); every change is a
  new version that applies **forwards** from its "applies from" date — past days keep the rules in force then.
  Only the very first setup may optionally apply to past attendance.
- **Office timings / shifts:** default NACTA timing (e.g. 09:00–17:00 Mon–Fri), grace minutes, half-day thresholds,
  Ramadan timings with date ranges, per-wing or per-employee overrides, rotating rosters for shift staff.
- **Calendar:** gazetted and NACTA-specific holidays, weekends, special working days.
- **Leave (record-only, no approval workflow):** leave types (casual, earned, medical, short leave, official duty, …);
  authorised users enter leave for an employee and date range, and it takes effect immediately in attendance.
  Every entry and change is audited.
- **Daily computation:** first-in / last-out per employee per day → status (present, late, early leave,
  half-day, absent, on leave, holiday, weekend, missing punch), worked hours, late minutes; recomputed by a job
  when punches arrive late, timings change, or leave or corrections are entered.
- **Corrections:** authorised users add manual punches or status overrides with a mandatory reason; applied
  immediately (no approval step), fully audited; original punches never edited.
  **Decided 2026-11-24:** the "corrected" marker, the list of corrections (and removing them) and the correction
  audit entries are visible to the **Super Admin only** — not to audit.view holders, not even to the person who made
  the correction. Phase G exports/reports must apply the same rule (mask `corrected` for non-Super-Admins).
- **WPs:** F1 timings/calendar/leave schema + APIs · F2 computation engine + jobs + tests · F3 timings/calendar/leave UI ·
  F4 corrections UI.

### Phase G — Dashboard, reports & exports
- **Dashboard:** today's present/late/absent/on-leave by wing, live punch feed, devices health, 30-day punctuality
  trend, top late-comers, quick filters by wing.
- **Reports:** Daily attendance, Monthly register (grid of days × employees with status codes), Late comers,
  Absentees, Wing summary, Individual time-card, Leave report, Device punch log. All wing-scoped by role.
- **Exports:** branded Excel (frozen headers, filters, colour-coded statuses, totals, NACTA header, generated-by
  footer) and PDF; every export audited with filters and row count; large exports run as jobs with progress.
- Optional: scheduled email of daily/monthly reports to wing managers.
- **WPs:** G1 reporting queries + export service · G2 dashboard UI · G3 reports UI.

### Phase H — Production readiness & deployment
> **Decided:** the target is a terminal-only Linux VM in the NACTA datacenter, with internet access. The code lives
> in GitHub (`arslanalamkhan/attendance-management-system`) and the VM deploys from a git checkout.
> Delivered so far: `deploy/linux/install.sh` (Node 24, PostgreSQL 18, nginx + HTTPS, systemd service on a
> service account, least-privilege DB role, firewall, nightly backups), the `nacta-attendance` admin command
> (status/logs/backup/restore/update/reset-password), `deploy/windows/export-database.ps1` to move the data from the
> PC, the Node app serving the built web client with a strict CSP, and `docs/DEPLOYMENT.md`.
- Deployment target agreed with NACTA IT (Windows Server or Linux): reverse proxy (IIS/nginx) with HTTPS,
  the app on a service account, ADMS port reachable from device VLAN only.
- Nightly encrypted database backups with restore drill; log rotation; health checks and alerts
  (device offline > N minutes, job failures, disk space).
- Security review: dependency audit, OWASP checklist, headers, session settings, least-privilege DB user,
  penetration-test fixes.
- Admin documentation, user guide, and a short training deck.
- **WPs:** H1 deployment scripts + docs · H2 backup/monitoring · H3 security review (Opus) · H4 user docs.

---

## 5. Suggested order & dependencies
```
A ──► B ──► C ──► D ──┬──► F ──► G ──► H
                      └──► E (spike can start after A)
```
Auth (B) and audit (C) come before new data features so everything built afterwards is permissioned and logged
from day one. The E0 spike can run in parallel with B/C because it only talks to the device.

## 6. Open questions for NACTA
1. **Fingerprint reader model** to be connected to the enrolment PC (e.g. ZKTeco ZK9500 / SLK20R)?
2. **Office timings** (normal, Friday, Ramadan) and whether any wings work shifts.
3. List of **wings** (and sections if used), and an Excel of employee→wing for bulk import.
4. *(Decided: leave is record-only, no approval workflow.)*
5. **Deployment server**: OS, who manages it, internal domain name, HTTPS certificate source.
6. **Branding**: official NACTA logo files and colour guidance.
7. Data retention requirements for attendance and audit logs.
8. Should employees ever log in themselves (self-service view of their own attendance/leave)? Not in scope unless confirmed.

## 7. Security note on the seed account
`admin@nacta.gov.pk` with the seed password from `.env` is used only as the **initial** seed from `.env`; the app forces a change at first
login and the weak password is rejected by policy afterwards. The password is never committed to git.
