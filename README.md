# NACTA Attendance Management System

Attendance system for the National Counter Terrorism Authority, built around ZKTeco SenseFace terminals
(PUSH/ADMS protocol). Employees are organised by wing; the Super Admin creates roles and users; every access and
export is recorded in an append-only audit log.

- **Web app** (React 18, Vite, Tailwind): dashboard, employees and wings, photos and biometric templates, attendance,
  leave, holidays, office timings, corrections, 8 reports with Excel/PDF export, users/roles, audit log.
- **Server** (Node.js, Express, TypeScript): JSON API under `/api/v1`, and the ADMS receiver the terminals push
  punches to on port 8081.
- **Database**: PostgreSQL.

| Folder | |
|---|---|
| `client/` | web app |
| `server/` | API, device receiver, attendance engine, reports ([server/README.md](server/README.md)) |
| `shared/` | API contract shared by both (zod schemas) |
| `deploy/` | Linux installer and admin command, Windows database export |
| `docs/` | [deployment guide](docs/DEPLOYMENT.md), [roadmap](docs/ROADMAP.md), [design plan](docs/PLAN.md) |

## Production

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**: one installer sets up a Linux VM with HTTPS, a systemd service and
nightly backups; `nacta-attendance update` deploys new versions from this repository.

## Development (Windows PC)

```powershell
npm install
Copy-Item server\.env.example server\.env   # set DATABASE_URL and SEED_ADMIN_PASSWORD
npm --workspace server run db:create
npm --workspace server run migrate
npm run dev:server        # API http://localhost:4000, devices on :8081
npm run dev:client        # web app http://localhost:5173
npm test                  # server tests (needs an attendance_test database)
```

Never commit `server/.env`, database dumps or exports: they contain passwords and employee data.
