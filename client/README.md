# Attendance - Client

Vite + React + TypeScript frontend (Phase 1: device management).

## Requirements
- Node.js 18+ (20 recommended)
- The API server running on http://localhost:4000 (see `../server`)

## Run
```powershell
cd D:\Attendence\client
npm install
npm run dev
```
Open http://localhost:5173. The dev server proxies `/api` to `http://localhost:4000`.

## Other scripts
- `npm run build` - type-check and build to `dist/`
- `npm run typecheck` - TypeScript only
- `npm run preview` - serve the production build

## Structure
- `src/api/` - fetch wrapper (`ApiError`) and typed device endpoints
- `src/pages/DevicesPage.tsx` - summary cards + device table (polls every 10s)
- `src/components/` - layout shell, status badge, modals, toasts
- `src/styles.css` - all styles (CSS variables)
