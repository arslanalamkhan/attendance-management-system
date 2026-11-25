import type { RequestHandler } from 'express';
import { audit } from './service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Paths (below /api/v1) that never produce an api.write entry. */
const EXCLUDED = new Set(['/audit/views', '/auth/me']);

/**
 * Safety net: any successful write that no explicit audit() call covered is still recorded, with method, path and
 * status only (never bodies or queries). Mounted on the v1 router, so new write routes cannot silently skip the log.
 */
export const apiWriteAudit: RequestHandler = (req, res, next) => {
  if (MUTATING.has(req.method)) {
    res.on('finish', () => {
      try {
        if (res.locals.audited || res.statusCode < 200 || res.statusCode >= 300) return;
        const path = (req.originalUrl.split('?')[0] ?? '').replace(/^\/api\/v1/, '') || '/';
        if (EXCLUDED.has(path)) return;
        audit(req, {
          action: 'api.write',
          summary: `${req.method} ${path} -> ${res.statusCode}`,
          metadata: { method: req.method, path, status: res.statusCode },
        });
      } catch {
        /* never affects the response */
      }
    });
  }
  next();
};
