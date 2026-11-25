import type { Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ErrorCode, zFingerprintCaptureInput, zPhotoUploadOptions, zRemoteEnrollInput } from '@nacta/shared';
import { AppError, notFound, validationError } from '../../lib/errors';
import { asyncHandler, idParam } from '../../lib/http';
import { isJpeg, readJpegInfo, sniffImageType } from '../../lib/jpeg';
import { parseBody, parseQuery, parseWith } from '../../lib/validate';
import { authOf, requirePermission } from '../../middleware/auth';
import { audit, employeeLabel } from '../audit/service';
import * as svc from './service';

/** Mounted on the employees router: paths here are /employees/:id/photo, /biometrics, /enroll, /fingerprints. */
export const biometricsRouter = Router();

const empOf = (req: Request) => svc.loadEmployee(idParam(req.params.id, 'Employee'), authOf(req).scope);
const label = (e: svc.EmpRef) => employeeLabel({ empCode: e.empCode, name: e.name });

// ---------- photo ----------

biometricsRouter.get(
  '/:id/photo',
  requirePermission('employees.view'),
  asyncHandler(async (req, res) => {
    const emp = await empOf(req);
    const version = await svc.photoVersion(emp.empCode);
    if (version === null) throw notFound('Photo');
    const etag = svc.photoEtag(emp.empCode, version);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=300');
    const inm = req.get('if-none-match');
    if (inm && (inm.trim() === '*' || inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag))) {
      res.status(304).end();
      return;
    }
    const bytes = await svc.photoBytes(emp.empCode);
    if (!bytes) throw notFound('Photo');
    // Device photos should be JPEG; if one is not, still serve it with the type it really has.
    res.type(isJpeg(bytes) ? 'image/jpeg' : sniffImageType(bytes));
    res.setHeader('Content-Length', String(bytes.length));
    res.status(200).end(bytes);
  }),
);

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: svc.PHOTO_MAX_BYTES, files: 1, fields: 6, fieldSize: 64 },
}).single('photo');

function receivePhoto(req: Request, res: Response): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    photoUpload(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          const msg =
            err.code === 'LIMIT_FILE_SIZE'
              ? `The photo is larger than ${svc.PHOTO_MAX_BYTES / 1024} KB`
              : 'Upload one JPEG in the "photo" field';
          return reject(new AppError(400, ErrorCode.INVALID_FILE, msg));
        }
        return reject(err);
      }
      if (!req.file) return reject(new AppError(400, ErrorCode.INVALID_FILE, 'No photo was uploaded (multipart field "photo")'));
      resolve(req.file.buffer);
    });
  });
}

/** Magic bytes, baseline (not progressive) and 240..1280 px, read from the SOF marker. */
export function validateJpeg(buf: Buffer): { width: number; height: number } {
  if (!isJpeg(buf)) throw new AppError(400, ErrorCode.INVALID_FILE, 'The photo must be a JPEG image');
  const info = readJpegInfo(buf);
  if (!info) throw new AppError(400, ErrorCode.INVALID_FILE, 'The photo is not a readable JPEG');
  if (info.progressive) {
    throw new AppError(400, ErrorCode.INVALID_FILE, 'Progressive JPEG not supported by the terminals; re-save as baseline');
  }
  const { width, height } = info;
  if (width < svc.PHOTO_MIN_DIM || height < svc.PHOTO_MIN_DIM) {
    throw new AppError(400, ErrorCode.INVALID_FILE, `The photo is ${width}x${height}; it must be at least ${svc.PHOTO_MIN_DIM}x${svc.PHOTO_MIN_DIM}`);
  }
  if (width > svc.PHOTO_MAX_DIM || height > svc.PHOTO_MAX_DIM) {
    throw new AppError(400, ErrorCode.INVALID_FILE, `The photo is ${width}x${height}; it must be at most ${svc.PHOTO_MAX_DIM}x${svc.PHOTO_MAX_DIM}`);
  }
  return { width, height };
}

biometricsRouter.put(
  '/:id/photo',
  requirePermission('employees.biometrics'),
  asyncHandler(async (req, res) => {
    const emp = await empOf(req);
    const buf = await receivePhoto(req, res);
    const { width, height } = validateJpeg(buf);

    // Options come from the query string or multipart text fields (fields win).
    const raw: Record<string, unknown> = {};
    for (const src of [req.query, req.body]) {
      if (!src || typeof src !== 'object') continue;
      for (const k of ['syncToDevices', 'createFace'] as const) {
        const v = (src as Record<string, unknown>)[k];
        if (v !== undefined && v !== '') raw[k] = v;
      }
    }
    const opts = parseWith(zPhotoUploadOptions, raw, 'options');
    // createFace defaults to true for an employee who is on a device (the SenseFace advertises BioPhotoFun=1).
    const createFace = raw.createFace === undefined ? undefined : opts.createFace;

    const out = await svc.storePhoto(emp, buf, { syncToDevices: opts.syncToDevices, createFace });
    audit(req, {
      action: 'employee.photo_update',
      entityType: 'employee',
      entityId: emp.id,
      entityLabel: label(emp),
      summary: `Updated photo of ${label(emp)} in the app${out.queued ? `; sent to ${out.devices.length} device${out.devices.length === 1 ? '' : 's'}` : ''}`,
      // Never the image itself.
      metadata: {
        source: 'app',
        syncToDevices: opts.syncToDevices,
        createFace: out.createFace,
        sizeBytes: buf.length,
        width,
        height,
        version: out.version,
        devices: out.devices.map((d) => d.name),
        commandsQueued: out.queued,
      },
    });
    res.json(await svc.getBiometrics(emp));
  }),
);

biometricsRouter.delete(
  '/:id/photo',
  requirePermission('employees.biometrics'),
  asyncHandler(async (req, res) => {
    const emp = await empOf(req);
    if (!(await svc.deleteAppPhoto(emp.empCode))) throw notFound('App photo');
    audit(req, {
      action: 'employee.photo_delete',
      entityType: 'employee',
      entityId: emp.id,
      entityLabel: label(emp),
      summary: `Removed the app photo of ${label(emp)} (devices keep theirs)`,
      metadata: { source: 'app' },
    });
    res.status(204).end();
  }),
);

// ---------- listing ----------

biometricsRouter.get(
  '/:id/biometrics',
  requirePermission('employees.view'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getBiometrics(await empOf(req)));
  }),
);

// ---------- remote enrolment ----------

biometricsRouter.post(
  '/:id/enroll',
  requirePermission('employees.biometrics'),
  asyncHandler(async (req, res) => {
    const emp = await empOf(req);
    const input = parseBody(zRemoteEnrollInput, req.body);
    if (input.kind === 'finger' && input.fingerIndex === undefined) throw validationError('Invalid request body', { fingerIndex: 'Required when enrolling a finger' });
    const out = await svc.requestEnrol(emp, input);
    const what = input.kind === 'finger' ? `finger (${svc.fingerName(input.fingerIndex ?? null)})` : 'face';
    audit(req, {
      action: 'biometric.enroll_requested',
      entityType: 'employee',
      entityId: emp.id,
      entityLabel: label(emp),
      summary: `Started ${what} enrolment for ${label(emp)} on ${out.deviceName}`,
      metadata: { deviceId: input.deviceId, device: out.deviceName, kind: input.kind, fingerIndex: input.fingerIndex ?? null, overwrite: input.overwrite, commandId: out.commandId },
    });
    res.status(202).json({ commandId: out.commandId });
  }),
);

// ---------- template deletion ----------

const zDeleteQuery = z.object({
  fromDevices: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(true),
});

biometricsRouter.delete(
  '/:id/biometrics/:templateId',
  requirePermission('employees.biometrics'),
  asyncHandler(async (req, res) => {
    const emp = await empOf(req);
    const templateId = idParam(req.params.templateId, 'Template');
    const { fromDevices } = parseQuery(zDeleteQuery, req.query);
    const out = await svc.deleteTemplate(emp, templateId, fromDevices);
    const t = out.template;
    const what = t.kind === 'finger' ? `fingerprint (${svc.fingerName(t.fingerIndex) ?? 'unknown finger'})` : t.kind === 'face' ? 'face template' : 'biometric template';
    audit(req, {
      action: 'biometric.delete',
      entityType: 'employee',
      entityId: emp.id,
      entityLabel: label(emp),
      summary: `Deleted ${what} of ${label(emp)}${out.queued ? ` and removed it from ${out.devices.length} device${out.devices.length === 1 ? '' : 's'}` : ''}`,
      metadata: {
        templateId,
        kind: t.kind,
        bioType: t.bioType,
        fingerIndex: t.fingerIndex,
        finger: svc.fingerName(t.fingerIndex),
        fromDevices,
        devices: out.devices.map((d) => d.name),
        commandsQueued: out.queued,
      },
    });
    res.status(204).end();
  }),
);

// ---------- fingerprint capture (future USB bridge) ----------

biometricsRouter.post(
  '/:id/fingerprints',
  requirePermission('employees.biometrics'),
  asyncHandler(async (req, res) => {
    const emp = await empOf(req);
    const input = parseBody(zFingerprintCaptureInput, req.body);
    const out = await svc.captureFingerprint(emp, input);
    audit(req, {
      action: 'biometric.captured',
      entityType: 'employee',
      entityId: emp.id,
      entityLabel: label(emp),
      summary: `Captured fingerprint (${svc.fingerName(input.fingerIndex)}) for ${label(emp)} in the app`,
      // Never the template itself.
      metadata: {
        fingerIndex: input.fingerIndex,
        finger: svc.fingerName(input.fingerIndex),
        majorVersion: input.majorVersion,
        minorVersion: input.minorVersion,
        quality: input.quality ?? null,
        syncToDevices: input.syncToDevices,
        devices: out.devices.map((d) => d.name),
        commandsQueued: out.queued,
      },
    });
    res.status(201).json(out.template);
  }),
);
