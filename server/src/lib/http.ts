import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MAX_INT, notFound } from './errors';

/** Wrap an async handler so rejections reach the error middleware (Express 4 does not do this). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Positive 32-bit integer from a route param; anything else is a 404 for that resource. */
export function idParam(raw: string | undefined, what: string): number {
  if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) > MAX_INT || Number(raw) < 1) throw notFound(what);
  return Number(raw);
}
