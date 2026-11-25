// Builders for command strings queued for devices (sent as "C:<id>:<command>").
import type { CommandType } from '@nacta/shared';
import { parseUserLine } from './parse';

// ZK time encoding: ((y-2000)*12*31 + (m-1)*31 + (d-1)) * 86400 + h*3600 + mi*60 + s
export function encodeZkTime(date: Date = new Date()): number {
  const d = date;
  return (
    ((d.getFullYear() - 2000) * 12 * 31 + d.getMonth() * 31 + (d.getDate() - 1)) * 86400 +
    d.getHours() * 3600 +
    d.getMinutes() * 60 +
    d.getSeconds()
  );
}

const clean = (v: unknown): string => String(v === undefined || v === null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();

export const NAME_MAX = 24;
/** Device display name: no tabs/newlines, at most 24 characters. */
export const cleanName = (v: unknown): string => Array.from(clean(v)).slice(0, NAME_MAX).join('').trim();

export const info = () => 'INFO';
export const check = () => 'CHECK';
export const reboot = () => 'REBOOT';
// Uses the server PC's local clock; assumes the PC and device are in the same timezone.
export const syncTime = (date?: Date) => `SET OPTION DateTime=${encodeZkTime(date)}`;

// ---- users ------------------------------------------------------------------
export interface UserInfoArgs {
  pin: string;
  name?: string;
  privilege?: number | string;
  password?: string;
  card?: string;
}

export function updateUserInfo({ pin, name = '', privilege = 0, password = '', card = '' }: UserInfoArgs): string {
  return (
    `DATA UPDATE USERINFO PIN=${clean(pin)}\tName=${cleanName(name)}\tPri=${clean(privilege)}\tPasswd=${clean(password)}` +
    `\tCard=${clean(card)}\tGrp=1\tTZ=0000000100000000\tVerify=0\tViceCard=`
  );
}
export const deleteUserInfo = (pin: string) => `DATA DELETE USERINFO PIN=${clean(pin)}`;

// ---- fetch (TODO: confirm exact query syntax/response path against the real device) ----
export const queryUserInfo = () => 'DATA QUERY USERINFO';
export const queryFingerTmp = () => 'DATA QUERY FINGERTMP';
export const queryFaceBiodata = () => 'DATA QUERY BIODATA Type=9';

// ---- per-user biometric refresh (used before removing an employee from a device) ----
// The device (push 2.4.1) accepted plain DATA QUERY USERINFO and answered by uploading its data through the
// normal OPERLOG/BIODATA tables, which ingest.ts already stores. The PIN-filtered forms below follow the same
// grammar; they are unverified on the real device (see README), so every caller goes through these two builders.
export const queryBiodataForPin = (pin: string) => `DATA QUERY BIODATA PIN=${clean(pin)}`;
export const queryUserPicForPin = (pin: string) => `DATA QUERY USERPIC PIN=${clean(pin)}`;

/**
 * Photo restore. The device uploads photos as USERPIC PIN=..\tFileName=..\tSize=..\tContent=<base64 jpeg> where
 * Size is the length of the base64 text (verified against user_photos: Size == length(content)). user_photos does
 * not record whether the picture first arrived as USERPIC or BIOPHOTO, so it is always restored as USERPIC.
 */
export function updateUserPic({ pin, fileName, content }: { pin: string; fileName?: string | null; content: string }): string {
  const c = clean(content);
  return `DATA UPDATE USERPIC PIN=${clean(pin)}\tFileName=${clean(fileName || `${clean(pin)}.jpg`)}\tSize=${c.length}\tContent=${c}`;
}

/**
 * Ask the device to build a visible-light face template (Type 9) from a photo and post it back (PostBackTmpFlag=1).
 * Advertised by the SenseFace 7A (BioPhotoFun=1, MultiBioPhotoSupport face type 9). Size = base64 length.
 */
export function updateBioPhoto({ pin, content }: { pin: string; content: string }): string {
  const c = clean(content);
  return `DATA UPDATE BIOPHOTO PIN=${clean(pin)}\tType=9\tSize=${c.length}\tContent=${c}\tFormat=0\tUrl=\tPostBackTmpFlag=1`;
}

// ---- remote enrolment / template deletion (unverified on the real device: record its return code) ----------
export const enrollFinger = (pin: string, fid: number, overwrite: boolean) =>
  `ENROLL_FP PIN=${clean(pin)}\tFID=${fid}\tRETRY=3\tOVERWRITE=${overwrite ? 1 : 0}`;
export const enrollFace = (pin: string, overwrite: boolean) =>
  `ENROLL_BIO TYPE=9\tPIN=${clean(pin)}\tCNT=1\tRETRY=3\tOVERWRITE=${overwrite ? 1 : 0}`;
export const deleteBiodata = (pin: string, type: number, no: number) => `DATA DELETE BIODATA Pin=${clean(pin)}\tType=${type}\tNo=${no}`;
export const deleteFingerTmp = (pin: string, fid: number) => `DATA DELETE FINGERTMP PIN=${clean(pin)}\tFID=${fid}`;
export const deleteFace = (pin: string, fid: number) => `DATA DELETE FACE PIN=${clean(pin)}\tFID=${fid}`;

// ---- templates ----------------------------------------------------------------
export interface TemplateArgs {
  pin: string;
  fid?: number | null;
  size?: number | null;
  valid?: number | null;
  tmp?: string | null;
}

/** Legacy fingerprint template. */
export function updateFingerTmp({ pin, fid = 0, size, valid = 1, tmp }: TemplateArgs): string {
  const t = clean(tmp);
  return `DATA UPDATE FINGERTMP PIN=${clean(pin)}\tFID=${clean(fid)}\tSize=${clean(size ?? t.length)}\tValid=${clean(valid ?? 1)}\tTMP=${t}`;
}

/** Legacy face template (kind 'face'). */
export function updateFace({ pin, fid = 0, size, valid = 1, tmp }: TemplateArgs): string {
  const t = clean(tmp);
  return `DATA UPDATE FACE PIN=${clean(pin)}\tFID=${clean(fid)}\tSIZE=${clean(size ?? t.length)}\tVALID=${clean(valid ?? 1)}\tTMP=${t}`;
}

/** A stored biometric_templates row, camelCased. */
export interface StoredTemplate {
  pin: string;
  kind?: string;
  bioType?: number | null;
  idx?: number | null;
  valid?: number | null;
  size?: number | null;
  data?: string | null;
  raw?: string | null;
}

/**
 * BIODATA update rebuilt from a stored template row { pin, idx, valid, bioType, data, raw }.
 * Fields not stored in columns (Index, Duress, MajorVer, MinorVer, Format) come from the raw line.
 */
export function updateBiodata(row: StoredTemplate): string {
  const parsed = parseUserLine(row.raw || '', 'BIODATA');
  const f: Record<string, string> = parsed ? parsed.fields : {};
  const pick = (name: string, fallback: unknown): unknown => (f[name] !== undefined ? f[name] : fallback);
  const tmp = clean(row.data !== undefined && row.data !== null ? row.data : f.tmp);
  return (
    `DATA UPDATE BIODATA Pin=${clean(row.pin)}\tNo=${clean(row.idx ?? pick('no', 0))}\tIndex=${clean(pick('index', 0))}` +
    `\tValid=${clean(row.valid ?? pick('valid', 1))}\tDuress=${clean(pick('duress', 0))}\tType=${clean(row.bioType ?? pick('type', ''))}` +
    `\tMajorVer=${clean(pick('majorver', ''))}\tMinorVer=${clean(pick('minorver', ''))}\tFormat=${clean(pick('format', ''))}\tTmp=${tmp}`
  );
}

/** Command for a stored biometric_templates row (camelCase: pin, kind, bioType, idx, valid, size, data, raw). */
export function updateTemplate(row: StoredTemplate): string {
  if (row.kind === 'fp') return updateFingerTmp({ pin: row.pin, fid: row.idx, size: row.size, valid: row.valid, tmp: row.data });
  if (row.kind === 'face') return updateFace({ pin: row.pin, fid: row.idx, size: row.size, valid: row.valid, tmp: row.data });
  return updateBiodata(row);
}

export const BY_TYPE: Record<CommandType, () => string> = {
  info,
  check,
  reboot,
  syncTime: () => syncTime(),
};
