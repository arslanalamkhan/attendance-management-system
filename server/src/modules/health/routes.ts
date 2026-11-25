import { Router } from 'express';
import type { Health } from '@nacta/shared';
import { config } from '../../config';
import { pool } from '../../db/pool';
import { asyncHandler } from '../../lib/http';
import { appVersion, serverIps } from '../../lib/sys';

export const healthRouter = Router();

/** Public. The server's IP addresses are only included for signed-in callers (mounted behind optionalAuth). */
healthRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    let db = false;
    try {
      await pool.query('SELECT 1');
      db = true;
    } catch {
      /* db stays false */
    }
    const body: Health = {
      ok: true,
      db,
      version: appVersion,
      uptimeSec: Math.floor(process.uptime()),
      admsPort: config.admsPort,
      serverIps: req.auth ? serverIps() : [],
    };
    res.json(body);
  }),
);
