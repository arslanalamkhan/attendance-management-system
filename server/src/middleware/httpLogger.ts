import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuse a sane incoming X-Request-Id, otherwise mint a UUID. */
const genReqId = (req: { headers: Record<string, string | string[] | undefined> }): string => {
  const h = req.headers[REQUEST_ID_HEADER];
  const incoming = Array.isArray(h) ? h[0] : h;
  return incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
};

/** API: request id on every request, echoed as X-Request-Id, one log line per request. */
export const apiHttpLogger: RequestHandler = pinoHttp({
  logger,
  genReqId,
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
}) as RequestHandler;

/** Sets the response header after pino-http assigned req.id. */
export const echoRequestId: RequestHandler = (req, res, next) => {
  res.setHeader('X-Request-Id', String(req.id));
  next();
};

/**
 * ADMS: devices poll every few seconds, so each request is logged at debug only. No request-id header is
 * added to responses (the device protocol output stays exactly as before).
 */
export const admsHttpLogger: RequestHandler = pinoHttp({
  logger: logger.child({ component: 'adms-http' }),
  customLogLevel: () => 'debug',
  serializers: {
    req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
}) as RequestHandler;
