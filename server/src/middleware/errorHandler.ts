import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ErrorCode, type ErrorBody } from '@nacta/shared';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { auditDenied, routeOf } from '../modules/audit/service';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, ErrorCode.NOT_FOUND, `Route not found: ${req.method} ${req.originalUrl}`));
};

interface BodyParserError {
  type?: string;
  status?: number;
}

/** Central error mapper. Unknown errors are logged with their stack and answered as 500 INTERNAL, never leaked. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const requestId = String(req.id ?? '');
  let status = 500;
  let body: ErrorBody['error'] = { code: ErrorCode.INTERNAL, message: 'Internal server error', requestId };

  const parserType = typeof err === 'object' && err !== null ? (err as BodyParserError).type : undefined;
  if (err instanceof AppError) {
    status = err.status;
    if ((err.deniedReason || (err.status === 403 && err.code === ErrorCode.FORBIDDEN)) && !res.locals.deniedLogged) {
      auditDenied(req, `Denied: ${req.method} ${routeOf(req)}: ${err.deniedReason ?? err.message}`, { reason: err.deniedReason ?? err.message });
    }
    body = { code: err.code, message: err.message, requestId };
    if (err.details !== undefined) body.details = err.details;
  } else if (parserType === 'entity.parse.failed') {
    status = 400;
    body = { code: ErrorCode.VALIDATION_ERROR, message: 'Malformed JSON body', requestId };
  } else if (parserType === 'entity.too.large') {
    status = 413;
    body = { code: ErrorCode.VALIDATION_ERROR, message: 'Request body too large', requestId };
  } else {
    const log = req.log ?? logger;
    log.error({ err, requestId }, 'unhandled error');
  }

  if (res.headersSent) return;
  res.status(status).json({ error: body });
};

