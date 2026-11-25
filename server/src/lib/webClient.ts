import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { API_BASE } from '@nacta/shared';
import { config } from '../config';

/**
 * Where the built web app (client/dist) lives. `CLIENT_DIST=off` disables serving it (API only, e.g. development
 * where Vite serves the client). Without a setting, the folder next to the server is used if it has an index.html:
 * both src/lib/*.ts and the bundled dist/*.js sit two levels below the repo root's client/ sibling.
 */
export function resolveClientDist(setting = config.clientDist): string | null {
  if (setting && ['off', 'false', 'none', '0'].includes(setting.toLowerCase())) return null;
  if (!setting && config.nodeEnv === 'test') return null; // tests exercise the bare API
  const candidates = setting
    ? [path.resolve(setting)]
    : [
        fileURLToPath(new URL('../../client/dist', import.meta.url)),
        fileURLToPath(new URL('../../../client/dist', import.meta.url)),
      ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? null;
}

/**
 * Serve the single-page app: hashed assets with a long cache, everything else that is not the API falls back to
 * index.html (never cached, so a new release is picked up on the next load).
 */
export function mountWebClient(app: Express, dir: string): void {
  const indexHtml = path.join(dir, 'index.html');
  app.use(
    '/assets',
    express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }),
  );
  app.use(express.static(dir, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path === API_BASE || req.path.startsWith(`${API_BASE}/`) || req.path.startsWith('/api/')) return next();
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
