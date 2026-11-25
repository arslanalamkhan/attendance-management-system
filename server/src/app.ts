import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { API_BASE } from '@nacta/shared';
import { router as admsRouter } from './adms/router';
import { config } from './config';
import { mountWebClient, resolveClientDist } from './lib/webClient';
import { csrfProtect, optionalAuth, passwordGate, requireAuth } from './middleware/auth';
import { admsHttpLogger, apiHttpLogger, echoRequestId } from './middleware/httpLogger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { admsLogRouter } from './modules/admsLog/routes';
import { attendanceRouter } from './modules/attendance/routes';
import { authRouter } from './modules/auth/routes';
import { auditRouter } from './modules/audit/routes';
import { apiWriteAudit } from './modules/audit/apiWrite';
import { devicesRouter } from './modules/devices/routes';
import { employeesRouter } from './modules/employees/routes';
import { healthRouter } from './modules/health/routes';
import { overviewRouter } from './modules/overview/routes';
import { dashboardRouter } from './modules/dashboard/routes';
import { reportsRouter } from './modules/reports/routes';
import { permissionsRouter, rolesRouter } from './modules/roles/routes';
import { usersRouter } from './modules/users/routes';
import { sectionsRouter, wingsRouter } from './modules/wings/routes';
import { holidaysRouter, leavesRouter, leaveTypesRouter, timingAssignmentsRouter, timingsRouter } from './modules/rules/routes';

/** JSON API for the web client, under /api/v1. */
export function createApiApp(): Express {
  const api = express();
  // Behind the Vite dev proxy / reverse proxy only the configured hops may set X-Forwarded-For (default: loopback).
  // The ADMS app below deliberately keeps trust proxy off: devices connect directly.
  api.set('trust proxy', config.trustProxy);
  api.disable('x-powered-by');
  api.use(apiHttpLogger);
  api.use(echoRequestId);
  api.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // HSTS is left to the reverse proxy: sent from here it would lock browsers out of a self-signed certificate.
      strictTransportSecurity: false,
      contentSecurityPolicy: {
        directives: {
          // Employee photos and webcam captures are shown as data:/blob: URLs.
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'upgrade-insecure-requests': config.cookieSecure ? [] : null,
        },
      },
    }),
  );
  api.use(cors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['X-Request-Id', 'Content-Disposition'] }));
  api.use(express.json({ limit: '1mb' }));

  const v1 = express.Router();
  v1.use(apiWriteAudit);
  // Public: health (server IPs only for signed-in callers) and the auth router (login is its only open route).
  v1.use('/health', optionalAuth, healthRouter);
  v1.use('/auth', authRouter);

  // Everything else needs a session, a matching CSRF token on mutations and no pending password change.
  // Each router then declares the permission its routes require.
  const guard = [requireAuth, csrfProtect, passwordGate];
  v1.use('/overview', ...guard, overviewRouter);
  v1.use('/dashboard', ...guard, dashboardRouter);
  v1.use('/reports', ...guard, reportsRouter);
  v1.use('/devices', ...guard, devicesRouter);
  v1.use('/wings', ...guard, wingsRouter);
  v1.use('/sections', ...guard, sectionsRouter);
  v1.use('/employees', ...guard, employeesRouter);
  v1.use('/attendance', ...guard, attendanceRouter);
  v1.use('/adms-log', ...guard, admsLogRouter);
  v1.use('/leaves', ...guard, leavesRouter);
  v1.use('/leave-types', ...guard, leaveTypesRouter);
  v1.use('/holidays', ...guard, holidaysRouter);
  v1.use('/timings', ...guard, timingsRouter);
  v1.use('/timing-assignments', ...guard, timingAssignmentsRouter);
  v1.use('/users', ...guard, usersRouter);
  v1.use('/roles', ...guard, rolesRouter);
  v1.use('/permissions', ...guard, permissionsRouter);
  v1.use('/audit', ...guard, auditRouter); // POST /audit/views is open to any signed-in user; the rest needs audit.view
  api.use(API_BASE, v1);

  // In production the same process serves the built web app (nginx in front only terminates HTTPS).
  const clientDist = resolveClientDist();
  if (clientDist) mountWebClient(api, clientDist);

  api.use(notFoundHandler);
  api.use(errorHandler);
  return api;
}

/** ZKTeco PUSH/ADMS endpoints for the devices (/iclock/*). Deliberately no helmet, no auth and no extra headers. */
export function createAdmsApp(): Express {
  const adms = express();
  adms.set('trust proxy', false);
  adms.disable('x-powered-by');
  adms.use(admsHttpLogger);
  adms.use(admsRouter);
  return adms;
}



