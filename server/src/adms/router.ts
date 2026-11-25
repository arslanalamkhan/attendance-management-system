import express, { Router, type Request } from 'express';
import { config } from '../config';
import { pool } from '../db/pool';
import { logger } from '../lib/logger';
import * as attendance from '../modules/attendance/service';
import * as commandSvc from '../modules/commands/service';
import * as commandRepo from '../modules/commands/repo';
import * as devices from '../modules/devices/repo';
import * as userData from './ingest';
import * as parse from './parse';

const log = logger.child({ component: 'adms' });

export const router = Router();

const HANDSHAKE_EOL = '\r\n';
const COMMAND_EOL = '\n';
const BODY_LOG_MAX = 64 * 1024;

const stripV4Mapped = (a: string | undefined): string | null => (a ? String(a).replace(/^::ffff:/i, '') : null);

/** Always read the body, whatever the Content-Type (devices often send none or odd ones). */
router.use(express.raw({ type: () => true, limit: '20mb' }));

function bodyText(req: Request): string {
  const b: unknown = req.body;
  if (Buffer.isBuffer(b)) return b.toString('utf8').replace(/\0/g, '');
  return typeof b === 'string' ? b.replace(/\0/g, '') : '';
}

interface LogEntry {
  sn: string | null;
  method: string;
  path: string;
  query: string;
  body: string | null;
  response: string | null;
  ip: string | null;
}

async function logRequest(entry: LogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO adms_requests (serial_number, method, path, query, body, response, remote_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.sn,
        entry.method,
        entry.path,
        entry.query,
        config.admsLogRaw && entry.body ? entry.body.slice(0, BODY_LOG_MAX) : null,
        entry.response ? String(entry.response).slice(0, 4096) : null,
        entry.ip,
      ],
    );
  } catch (err) {
    log.error({ err }, 'could not log request');
  }
}

// Map assorted INFO / option key names (case-insensitive) onto device columns.
function infoFromKeyValues(kv: Record<string, string>): devices.DeviceInfo {
  const low: Record<string, string> = {};
  for (const k of Object.keys(kv)) low[k.toLowerCase()] = kv[k] as string;
  const g = (...names: string[]): string | null => {
    for (const n of names) {
      const v = low[n.toLowerCase()];
      if (v !== undefined && v !== '') return v;
    }
    return null;
  };
  return {
    fwVersion: g('FWVersion', 'FirmwareVersion'),
    userCount: parse.intOrNull(g('UserCount')),
    fpCount: parse.intOrNull(g('FPCount')),
    attCount: parse.intOrNull(g('TransactionCount', 'AttLogCount')),
    faceCount: parse.intOrNull(g('FaceCount')),
    deviceName: g('DeviceName'),
    platform: g('Platform'),
  };
}

function sanitizeOptions(kv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(kv)) {
    if (k.length > 64 || n >= 200) continue;
    out[k] = String(v).slice(0, 500);
    n++;
  }
  return out;
}

function handshakeResponse(sn: string, dev: devices.TouchedDevice): string {
  return [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${dev.attlog_stamp || 'None'}`,
    `OPERLOGStamp=${dev.operlog_stamp || 'None'}`,
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    // Push protocol format: "TransData" then TAB-separated table names. Asks the device to upload new users,
    // fingerprints, faces and photos as they are enrolled, not only on a full resync.
    'TransFlag=TransData AttLog\tOpLog\tAttPhoto\tEnrollUser\tChgUser\tEnrollFP\tChgFP\tFPImag\tFACE\tUserPic\tBioPhoto',
    `TimeZone=${config.admsTimezone}`,
    'Realtime=1',
    'Encrypt=None',
  ].join(HANDSHAKE_EOL);
}

/** Parse and upsert user/template/photo lines in a body. Returns the number of records stored. */
async function ingestUserData(deviceId: number, body: string, hint: string | null | undefined): Promise<number> {
  const { records } = parse.parseUserData(body, hint);
  if (records.length) await userData.ingest(deviceId, records);
  return records.length;
}

/**
 * OPLOG operation codes that mean "a fingerprint, face or photo was enrolled or removed" on this firmware
 * (ZAM70 / SenseFace 7A, observed in its logs: 6 = fingerprint enrolled, 10 = fingerprint deleted,
 * 69/70/71/101/103/106/114 = face and photo enrolment/changes).
 */
export const BIOMETRIC_OPLOG_CODES = new Set([6, 10, 69, 70, 71, 101, 103, 106, 114]);

/**
 * The SenseFace announces an enrolment with an OPLOG line but does not upload the new template by itself, and it
 * ignores a PIN filter on DATA QUERY BIODATA (it always answers with its whole biometric set, ~1 minute).
 * So on any biometric OPLOG we queue ONE unfiltered BIODATA query, unless one is already waiting or running.
 */
async function requestBiometricRefreshIfEnrolled(deviceId: number, body: string): Promise<void> {
  // OPLOG <code>\t<admin>\t<time>\t<pin>\t...
  const pins = new Set<string>();
  for (const l of parse.splitLines(body)) {
    const m = /^OPLOG\s+(\d+)\t[^\t]*\t[^\t]*\t([^\t]*)/.exec(l);
    if (m && BIOMETRIC_OPLOG_CODES.has(Number(m[1]))) pins.add((m[2] ?? '').trim());
  }
  if (!pins.size) return;
  // Since the TransFlag fix the device uploads the new template itself, just before the OPLOG line. Only fall back
  // to the (whole-set) refresh when some enrolled PIN has no template stored in the last few minutes.
  const known = [...pins].filter((p) => /^\d+$/.test(p));
  if (known.length === pins.size) {
    const { rows } = await pool.query<{ pin: string }>(
      `SELECT DISTINCT pin FROM biometric_templates WHERE pin = ANY($1::text[]) AND updated_at > now() - interval '3 minutes'`,
      [known],
    );
    if (rows.length === known.length) return;
  }
  await commandRepo.queueBiodataRefresh(deviceId);
}

/** Keep device_users in step with commands the device confirmed (we get no USER echo for those). */
async function mirrorCommand(deviceId: number, command: string | null): Promise<void> {
  try {
    const m = /^DATA (UPDATE|DELETE) (USERINFO .*)$/s.exec(command || '');
    if (!m) return;
    const p = parse.parseUserLine(m[2]);
    const rec = p && parse.normalizeUserRecord(p);
    if (!rec) return;
    if (m[1] === 'DELETE') await userData.removeUser(deviceId, rec.pin);
    else await userData.ingest(deviceId, [rec]);
  } catch (err) {
    log.error({ err }, 'mirror command failed');
  }
}

interface Ctx {
  req: Request;
  method: string;
  path: string;
  sn: string | null;
  ip: string | null;
  body: string;
}

interface Result {
  status: number;
  text: string;
}

/** Returns { status, text } for the request. May throw; the caller catches. */
async function dispatch(ctx: Ctx): Promise<Result> {
  const { req, sn, ip } = ctx;
  const path = ctx.path;
  const q: unknown = req.query;

  if (!path.startsWith('/iclock')) return { status: 404, text: 'Not Found' };
  if (!sn) return { status: 200, text: 'OK' };

  const pushver = parse.getParam(q, 'pushver') || parse.getParam(q, 'PushVersion') || null;
  const dev = await devices.touch(sn, ip, pushver);
  if (!dev) return { status: 404, text: 'Unknown device' };
  const active = dev.is_active !== false;

  const sub = path.slice('/iclock'.length).replace(/^\//, '');

  if (sub === 'cdata') {
    const table = (parse.getParam(q, 'table') || '').trim();
    if (!table) {
      // Handshake / option request.
      return { status: 200, text: active ? handshakeResponse(sn, dev) : 'OK' };
    }
    if (!active) return { status: 200, text: 'OK' };
    const body = ctx.body;
    const t = table.toUpperCase();
    if (t === 'ATTLOG') {
      const { records, skipped } = parse.parseAttlog(body);
      if (skipped.length) log.warn(`${sn}: ${skipped.length} unparseable ATTLOG line(s), e.g. ${JSON.stringify(skipped[0])}`);
      try {
        await attendance.insertBatch(dev.id, records);
      } catch (err) {
        // Do not acknowledge data we failed to store, so the device keeps it and retries.
        log.error({ err }, 'ATTLOG insert failed');
        return { status: 200, text: 'ERROR: database' };
      }
      await devices.setStamp(dev.id, 'attlog_stamp', parse.getParam(q, 'Stamp')).catch((err: unknown) => log.error({ err }, 'stamp'));
      return { status: 200, text: `OK: ${records.length + skipped.length}` };
    }
    if (t === 'OPERLOG') {
      const total = parse.splitLines(body).length;
      try {
        await ingestUserData(dev.id, body, null);
      } catch (err) {
        log.error({ err }, 'OPERLOG user data failed');
        return { status: 200, text: 'ERROR: database' };
      }
      await devices.setStamp(dev.id, 'operlog_stamp', parse.getParam(q, 'OpStamp')).catch((err: unknown) => log.error({ err }, 'stamp'));
      await requestBiometricRefreshIfEnrolled(dev.id, body).catch((err: unknown) => log.error({ err }, 'biometric refresh'));
      return { status: 200, text: `OK: ${total}` };
    }
    if (t === 'OPTIONS') {
      const kv = parse.parseKeyValues(body);
      await devices.updateInfo(dev.id, infoFromKeyValues(kv), sanitizeOptions(kv));
      return { status: 200, text: 'OK' };
    }
    if (parse.kindForName(t)) {
      // USERINFO, FINGERTMP, FACE, BIODATA, USERPIC, BIOPHOTO: same line formats, with or without the token.
      const total = parse.splitLines(body).length;
      try {
        await ingestUserData(dev.id, body, t);
      } catch (err) {
        log.error({ err }, `${t} data failed`);
        return { status: 200, text: 'ERROR: database' };
      }
      return { status: 200, text: `OK: ${total}` };
    }
    // ATTPHOTO, ... : logged only.
    return { status: 200, text: 'OK' };
  }

  if (sub === 'getrequest') {
    const infoParam = parse.getParam(q, 'INFO');
    if (infoParam) {
      const info = parse.parseInfo(infoParam);
      if (info) await devices.updateInfo(dev.id, info, { INFO: infoParam });
    }
    if (!active) return { status: 200, text: 'OK' };
    const batch = await commandSvc.takePending(dev.id, 10);
    if (!batch.length) return { status: 200, text: 'OK' };
    return { status: 200, text: batch.map((c) => `C:${c.id}:${c.command}`).join(COMMAND_EOL) };
  }

  if (sub === 'devicecmd') {
    const { results, data } = parse.parseDeviceCmd(ctx.body);
    const text = ctx.body.trim();
    for (const r of results) {
      if (r.id === null) continue;
      const done = await commandSvc.complete(dev.id, r.id, r.returnCode, text);
      if (done && done.ok) {
        await mirrorCommand(dev.id, done.command);
        await userData.confirmTemplateDelete(done.command).catch((err: unknown) => log.error({ err }, 'tombstone confirm'));
      }
    }
    // Responses to DATA QUERY: user/template lines follow the "ID=..&Return=..&CMD=.." line.
    try {
      await ingestUserData(dev.id, ctx.body, parse.getParam(q, 'table') || parse.getParam(q, 'tablename'));
    } catch (err) {
      log.error({ err }, 'devicecmd user data failed');
    }
    if (Object.keys(data).length && results.some((r) => (r.cmd || '').toUpperCase() === 'INFO')) {
      await devices.updateInfo(dev.id, infoFromKeyValues(data), sanitizeOptions(data));
    }
    return { status: 200, text: 'OK' };
  }

  if (sub === 'querydata') {
    try {
      await ingestUserData(dev.id, ctx.body, parse.getParam(q, 'table') || parse.getParam(q, 'tablename'));
    } catch (err) {
      log.error({ err }, 'querydata failed');
    }
    return { status: 200, text: 'OK' };
  }

  // registry, push, ping, rtdata and anything else: touched + logged above.
  return { status: 200, text: 'OK' };
}

router.all('*', async (req, res) => {
  const ctx: Ctx = {
    req,
    method: req.method,
    path: (req.path || '/').toLowerCase().replace(/\.aspx$/, '').replace(/\/+$/, '') || '/',
    sn: null,
    ip: stripV4Mapped(req.socket && req.socket.remoteAddress),
    body: '',
  };
  const qi = req.originalUrl.indexOf('?');
  const rawQuery = qi >= 0 ? req.originalUrl.slice(qi + 1) : '';
  let result: Result = { status: 200, text: 'OK' };
  try {
    ctx.body = bodyText(req);
    const sn = parse.getParam(req.query, 'SN');
    ctx.sn = sn ? sn.trim().slice(0, 64) || null : null;
    result = await dispatch(ctx);
  } catch (err) {
    log.error({ err }, `handler error on ${req.method} ${req.originalUrl}`);
    result = { status: 200, text: 'OK' };
  }
  try {
    res.status(result.status).type('text/plain').send(result.text);
  } catch (err) {
    log.error({ err }, 'send failed');
  }
  await logRequest({
    sn: ctx.sn,
    method: req.method,
    path: req.path,
    query: rawQuery,
    body: ctx.body,
    response: result.text,
    ip: ctx.ip,
  });
});

// Body-parser failures (oversize, aborted, bad encoding): still answer the device politely and log.
router.use(async (err: unknown, req: Request, res: express.Response, _next: express.NextFunction) => {
  log.error({ err }, 'request error');
  if (!res.headersSent) res.status(200).type('text/plain').send('OK');
  const qi = req.originalUrl ? req.originalUrl.indexOf('?') : -1;
  await logRequest({
    sn: null,
    method: req.method,
    path: req.path,
    query: qi >= 0 ? req.originalUrl.slice(qi + 1) : '',
    body: `[request error: ${err instanceof Error ? err.message : String(err)}]`,
    response: 'OK',
    ip: stripV4Mapped(req.socket && req.socket.remoteAddress),
  });
});
