// Pure parsing helpers for the ZKTeco PUSH/ADMS protocol. No I/O, never throws on odd input.

const toText = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  if (typeof v === 'string') return v;
  return '';
};

/** Split a body into non-empty lines (CRLF, LF or CR), trailing blanks trimmed, BOM removed. */
export function splitLines(body: unknown): string[] {
  const text = toText(body).replace(/^﻿/, '').replace(/\0/g, '');
  return text
    .split(/\r\n|\n|\r/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
}

/** Case-insensitive lookup of a key in an object such as req.query. Returns a string or undefined. */
export function getParam(obj: unknown, name: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  const want = String(name).toLowerCase();
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase() === want) {
      const v = rec[k];
      const s = Array.isArray(v) ? v[0] : v;
      return s === undefined || s === null ? undefined : String(s);
    }
  }
  return undefined;
}

export const intOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isSafeInteger(n) && Math.abs(n) <= 2147483647 ? n : null;
};

const TIME_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})$/;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Validate and normalise a device timestamp to 'YYYY-MM-DD HH:MM:SS' (no timezone). null if invalid. */
export function normalizeTime(s: unknown): string | null {
  const m = TIME_RE.exec(String(s || '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se)}`;
}

export interface AttlogRecord {
  pin: string;
  punchTime: string;
  status: number | null;
  verifyType: number | null;
  workCode: string | null;
  raw: string;
}

/**
 * ATTLOG lines: PIN \t YYYY-MM-DD HH:MM:SS \t status \t verify \t workcode \t ...
 * Returns { records, skipped } where skipped are the unparseable lines.
 */
export function parseAttlog(body: unknown): { records: AttlogRecord[]; skipped: string[] } {
  const records: AttlogRecord[] = [];
  const skipped: string[] = [];
  for (const line of splitLines(body)) {
    let f = line.split('\t').map((s) => s.trim());
    let time = f.length > 1 ? normalizeTime(f[1]) : null;
    if (!time) {
      // Fallback: whitespace separated "PIN date time status verify ..."
      const w = line.trim().split(/\s+/);
      if (w.length >= 3 && normalizeTime(`${w[1]} ${w[2]}`)) {
        f = [w[0] as string, `${w[1]} ${w[2]}`, ...w.slice(3)];
        time = normalizeTime(f[1]);
      }
    }
    if (!f[0] || !time) {
      skipped.push(line);
      continue;
    }
    records.push({
      pin: f[0],
      punchTime: time,
      status: intOrNull(f[2]),
      verifyType: intOrNull(f[3]),
      workCode: f[4] ? f[4] : null,
      raw: line,
    });
  }
  return { records, skipped };
}

/** Parse "k=v" pairs separated by commas, tabs, '&' or newlines. */
export function parseKeyValues(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of toText(text).split(/[\r\n\t,&]+/)) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim().replace(/^~/, '');
    if (!k) continue;
    out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** OPERLOG lines: "USER PIN=1\tName=Ali\tPri=0", "FP PIN=..", "OPLOG 4\t..." */
export function parseOperlog(body: unknown): { type: string; fields: Record<string, string>; raw: string }[] {
  return splitLines(body).map((line) => {
    const m = /^([A-Za-z_]+)\s+(.*)$/.exec(line);
    const type = m ? (m[1] as string).toUpperCase() : 'UNKNOWN';
    const rest = m ? (m[2] as string) : line;
    return { type, fields: parseKeyValues(rest), raw: line };
  });
}

export interface ParsedInfo {
  fwVersion: string | null;
  userCount: number | null;
  fpCount: number | null;
  attCount: number | null;
  ip: string | null;
  faceCount: number | null;
}

/**
 * INFO query value: fwVersion,userCount,fpCount,attCount,ip,fpAlgVer,faceAlgVer,faceCount,...
 * Missing positions come back as null.
 */
export function parseInfo(info: unknown): ParsedInfo | null {
  const s = toText(info).trim();
  if (!s) return null;
  const p = s.split(',').map((x) => x.trim());
  const str = (i: number) => (p[i] !== undefined && p[i] !== '' ? (p[i] as string) : null);
  return {
    fwVersion: str(0),
    userCount: intOrNull(p[1]),
    fpCount: intOrNull(p[2]),
    attCount: intOrNull(p[3]),
    ip: str(4),
    faceCount: intOrNull(p[7]),
  };
}

export interface DeviceCmdResult {
  id: number | null;
  returnCode: number | null;
  cmd: string | null;
  data: Record<string, string>;
}

/**
 * devicecmd bodies. One or more lines "ID=<id>&Return=<code>&CMD=<name>", optionally followed by
 * "k=v" data lines (INFO results). Returns { results: [{id, returnCode, cmd, data}], data }
 * where data is every extra k=v seen (merged).
 */
export function parseDeviceCmd(body: unknown): { results: DeviceCmdResult[]; data: Record<string, string> } {
  const results: DeviceCmdResult[] = [];
  const data: Record<string, string> = {};
  let last: DeviceCmdResult | null = null;
  for (const line of splitLines(body)) {
    const pairs: Record<string, string> = {};
    for (const seg of line.split('&')) {
      const i = seg.indexOf('=');
      if (i > 0) pairs[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
    }
    const lower: Record<string, string> = {};
    for (const k of Object.keys(pairs)) lower[k.toLowerCase()] = k;
    if (lower.id !== undefined && (lower.return !== undefined || lower.cmd !== undefined)) {
      const extra: Record<string, string> = {};
      for (const k of Object.keys(pairs)) {
        if (!['id', 'return', 'cmd'].includes(k.toLowerCase())) extra[k] = pairs[k] as string;
      }
      last = {
        id: intOrNull(pairs[lower.id]),
        returnCode: lower.return !== undefined ? intOrNull(pairs[lower.return]) : null,
        cmd: lower.cmd !== undefined ? (pairs[lower.cmd] as string) : null,
        data: extra,
      };
      Object.assign(data, extra);
      results.push(last);
    } else {
      const kv = parseKeyValues(line);
      Object.assign(data, kv);
      if (last) Object.assign(last.data, kv);
    }
  }
  return { results, data };
}

// ---- user / template lines --------------------------------------------------

export type RecordKind = 'user' | 'fp' | 'face' | 'bio' | 'pic' | 'biophoto';

// Line token (or table name) -> record kind.
export const TOKEN_KIND: Record<string, RecordKind> = {
  USER: 'user',
  USERINFO: 'user',
  FP: 'fp',
  FINGERTMP: 'fp',
  FACE: 'face',
  BIODATA: 'bio',
  USERPIC: 'pic',
  BIOPHOTO: 'biophoto',
};

export const kindForName = (name: unknown): RecordKind | null => {
  const k = String(name || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(TOKEN_KIND, k) ? (TOKEN_KIND[k] as RecordKind) : null;
};

/** Split "k=v<TAB>k=v" (or, without tabs, space-separated pairs) into a lower-cased key map. */
function splitFields(rest: string): Record<string, string> {
  const segs = rest.includes('\t') ? rest.split('\t') : rest.split(/\s+(?=[A-Za-z_]+=)/);
  const f: Record<string, string> = {};
  for (const seg of segs) {
    const i = seg.indexOf('=');
    if (i <= 0) continue;
    const k = seg.slice(0, i).trim().replace(/^~/, '').toLowerCase();
    if (!k || Object.prototype.hasOwnProperty.call(f, k)) continue;
    f[k] = seg.slice(i + 1).trim();
  }
  return f;
}

const nonEmpty = (v: unknown): string | null =>
  v !== undefined && v !== null && String(v).trim() !== '' ? String(v).trim() : null;

const firstDefined = (f: Record<string, string>, ...names: string[]): string | undefined => {
  for (const n of names) if (f[n] !== undefined && f[n] !== '') return f[n];
  return undefined;
};

export interface ParsedUserLine {
  kind: RecordKind;
  /** Lower-cased keys. */
  fields: Record<string, string>;
  raw: string;
}

/**
 * Parse one user/template line, e.g.
 *   "USER PIN=1\tName=Ali\tPri=0\tPasswd=\tCard=\tGrp=1\t..."
 *   "FP PIN=1\tFID=0\tSize=1384\tValid=1\tTMP=..."
 *   "BIODATA Pin=1\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=58\tMinorVer=0\tFormat=0\tTmp=..."
 *   "USERPIC PIN=1\tFileName=1.jpg\tSize=..\tContent=<base64>"
 * The leading token is optional when `hint` (a token/table name such as 'USERINFO') is given.
 * Returns { kind, fields (lower-cased keys), raw } or null when the line is not user data.
 */
export function parseUserLine(line: unknown, hint?: string | null): ParsedUserLine | null {
  const raw = String(line || '').replace(/\s+$/, '');
  if (!raw.trim()) return null;
  let kind: RecordKind | null = null;
  let rest = raw.trim();
  const m = /^([A-Za-z_]+)[ \t]+(.*)$/s.exec(rest);
  if (m) {
    kind = kindForName(m[1]);
    if (!kind) return null; // unknown leading token (OPLOG ...)
    rest = (m[2] as string).trim();
  }
  if (!kind) kind = kindForName(hint);
  if (!kind || !/^[A-Za-z_~]+=/.test(rest)) return null;
  const fields = splitFields(rest);
  return { kind, fields, raw };
}

export interface UserRecord {
  kind: 'user';
  pin: string;
  name: string | null;
  privilege: number | null;
  card: string | null;
  password: string | null;
  grp: string | null;
  raw: string;
}
export interface TemplateRecord {
  kind: 'fp' | 'face';
  pin: string;
  idx: number;
  valid: number | null;
  size: number | null;
  data: string;
  raw: string;
}
export interface BioRecord {
  kind: 'bio';
  pin: string;
  bioType: number | null;
  idx: number;
  valid: number | null;
  size: number | null;
  data: string;
  raw: string;
}
export interface PhotoRecord {
  kind: 'pic' | 'biophoto';
  pin: string;
  fileName: string | null;
  content: string;
  raw: string;
}
export type DeviceRecord = UserRecord | TemplateRecord | BioRecord | PhotoRecord;

/**
 * Normalise a parsed line into a record:
 *  user:     { kind:'user', pin, name, privilege, card, password, grp, raw }
 *  fp/face:  { kind, pin, idx, valid, size, data, raw }
 *  bio:      { kind:'bio', pin, bioType, idx, valid, size, data, raw }
 *  pic/biophoto: { kind, pin, fileName, content, raw }
 * Returns null when the PIN (or the template data) is missing.
 */
export function normalizeUserRecord(p: ParsedUserLine): DeviceRecord | null {
  const f = p.fields;
  const pin = nonEmpty(f.pin);
  if (!pin || pin.length > 64) return null;
  switch (p.kind) {
    case 'user':
      return {
        kind: 'user',
        pin,
        name: nonEmpty(f.name),
        privilege: intOrNull(firstDefined(f, 'pri', 'privilege')),
        card: nonEmpty(f.card),
        password: nonEmpty(firstDefined(f, 'passwd', 'password')),
        grp: nonEmpty(f.grp),
        raw: p.raw,
      };
    case 'fp':
    case 'face': {
      const data = nonEmpty(firstDefined(f, 'tmp', 'template'));
      if (!data) return null;
      return {
        kind: p.kind,
        pin,
        idx: intOrNull(firstDefined(f, 'fid', 'no', 'index')) ?? 0,
        valid: intOrNull(f.valid),
        size: intOrNull(f.size),
        data,
        raw: p.raw,
      };
    }
    case 'bio': {
      const data = nonEmpty(firstDefined(f, 'tmp', 'template'));
      if (!data) return null;
      return {
        kind: 'bio',
        pin,
        bioType: intOrNull(f.type),
        idx: intOrNull(firstDefined(f, 'no', 'fid', 'index')) ?? 0,
        valid: intOrNull(f.valid),
        size: intOrNull(f.size),
        data,
        raw: p.raw,
      };
    }
    case 'pic':
    case 'biophoto': {
      const content = nonEmpty(f.content);
      if (!content) return null;
      return { kind: p.kind, pin, fileName: nonEmpty(firstDefined(f, 'filename', 'file')), content, raw: p.raw };
    }
    default:
      return null;
  }
}

/**
 * Parse every user/template line in a body. `hint` is the cdata table name (USERINFO, FINGERTMP, ...)
 * used when lines carry no leading token. Lines such as "ID=..&Return=..&CMD=.." and OPLOG lines are
 * counted as `other`. Returns { records, other, skipped } (skipped = recognised kind but unusable).
 */
export function parseUserData(
  body: unknown,
  hint?: string | null,
): { records: DeviceRecord[]; other: number; skipped: number } {
  const records: DeviceRecord[] = [];
  let other = 0;
  let skipped = 0;
  for (const line of splitLines(body)) {
    const p = parseUserLine(line, hint);
    if (!p) {
      other++;
      continue;
    }
    const rec = normalizeUserRecord(p);
    if (rec) records.push(rec);
    else skipped++;
  }
  return { records, other, skipped };
}
