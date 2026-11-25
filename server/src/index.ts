import type { Server } from 'node:http';
import { API_BASE } from '@nacta/shared';
import { createAdmsApp, createApiApp } from './app';
import { config } from './config';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { serverIps } from './lib/sys';
import { seedAuth } from './modules/auth/seed';
import * as attendanceWorker from './modules/attendance/worker';
import * as sweeper from './modules/devices/sweeper';

// The auth tables must exist (run `npm run migrate` first). Creates the Super Admin role/account when missing.
try {
  await seedAuth();
} catch (err) {
  logger.error({ err }, 'Auth seeding failed. Has migration 004_auth been applied? (npm run migrate)');
  process.exit(1);
}

if (config.auditRetentionDays !== undefined) {
  // The audit log is append-only (DB triggers). Nothing is deleted; archiving old entries is planned for Phase H.
  logger.warn(`AUDIT_RETENTION_DAYS=${config.auditRetentionDays} is set, but the audit log is append-only and is never pruned; archiving is not implemented yet (Phase H)`);
}

const onApiListening = () => {
  logger.info(`API listening on http://${config.host || 'localhost'}:${config.port}${API_BASE}`);
};
const apiServer = config.host
  ? createApiApp().listen(config.port, config.host, onApiListening)
  : createApiApp().listen(config.port, onApiListening);
const admsServer = createAdmsApp().listen(config.admsPort, '0.0.0.0', () => {
  logger.info(
    `ADMS listening on 0.0.0.0:${config.admsPort} (point devices at ${serverIps().join(' or ') || 'this PC'}:${config.admsPort})`,
  );
});

for (const [name, s] of [
  ['API', apiServer],
  ['ADMS', admsServer],
] as const) {
  s.on('error', (err: NodeJS.ErrnoException) => {
    logger.error(`${name} server error: ${err.message}`);
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') process.exit(1);
  });
}
sweeper.start();
attendanceWorker.start(); // recompute queue, first-run backfill, nightly refresh

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down...');
  sweeper.stop();
  attendanceWorker.stop();
  const closeServer = (s: Server) => new Promise<void>((resolve) => s.close(() => resolve()));
  // Drop idle keep-alive connections so close() can finish.
  for (const s of [apiServer, admsServer]) s.closeIdleConnections();
  Promise.all([closeServer(apiServer), closeServer(admsServer)])
    .then(() => pool.end())
    .catch(() => {})
    .then(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => logger.error({ err }, '[unhandledRejection]'));

