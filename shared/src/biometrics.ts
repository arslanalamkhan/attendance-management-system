import { z } from 'zod';
import { zIsoDateTime } from './common';

// =====================================================================================
// Biometrics (Phase E)
// Device facts (SenseFace 7A, push 2.4.1): templates arrive as BIODATA lines; Type 1 = fingerprint
// (MajorVer 13, "No" = finger index 0-9), Type 9 = visible-light face (MajorVer 40). Photos arrive as USERPIC.
// =====================================================================================

/** ZKTeco finger index convention (No= in BIODATA, FID= in older FP lines). */
export const FINGERS = [
  { index: 0, hand: 'left', name: 'Left little' },
  { index: 1, hand: 'left', name: 'Left ring' },
  { index: 2, hand: 'left', name: 'Left middle' },
  { index: 3, hand: 'left', name: 'Left index' },
  { index: 4, hand: 'left', name: 'Left thumb' },
  { index: 5, hand: 'right', name: 'Right thumb' },
  { index: 6, hand: 'right', name: 'Right index' },
  { index: 7, hand: 'right', name: 'Right middle' },
  { index: 8, hand: 'right', name: 'Right ring' },
  { index: 9, hand: 'right', name: 'Right little' },
] as const;
export const zFingerIndex = z.number().int().min(0).max(9);

export const BIOMETRIC_KINDS = ['finger', 'face', 'palm', 'other'] as const;
export const zBiometricKind = z.enum(BIOMETRIC_KINDS);
export type BiometricKind = z.infer<typeof zBiometricKind>;

/** Where a template or photo came from. */
export const BIOMETRIC_SOURCES = ['device', 'app'] as const;
export const zBiometricSource = z.enum(BIOMETRIC_SOURCES);

export const zBiometricTemplate = z.object({
  id: z.number().int(),
  kind: zBiometricKind,
  /** 0-9 for fingers, null otherwise. */
  fingerIndex: z.number().int().nullable(),
  /** Raw BIODATA Type (1 finger, 9 face ...), null for legacy FP/FACE lines. */
  bioType: z.number().int().nullable(),
  /** Algorithm version, e.g. "13.0" for fingers, "40.1" for faces. */
  version: z.string().nullable(),
  valid: z.boolean(),
  /** Template size in bytes (decoded). */
  sizeBytes: z.number().int().nullable(),
  source: zBiometricSource,
  sourceDeviceName: z.string().nullable(),
  updatedAt: zIsoDateTime,
});
export type BiometricTemplate = z.infer<typeof zBiometricTemplate>;

export const zEmployeePhoto = z.object({
  /** Relative API path to GET the image (JPEG), with a cache-busting version param. */
  url: z.string(),
  source: zBiometricSource,
  sourceDeviceName: z.string().nullable(),
  sizeBytes: z.number().int(),
  updatedAt: zIsoDateTime,
});
export type EmployeePhoto = z.infer<typeof zEmployeePhoto>;

/** GET /employees/:id/biometrics */
export const zEmployeeBiometrics = z.object({
  employeeId: z.number().int(),
  pin: z.string(),
  photo: zEmployeePhoto.nullable(),
  fingers: z.array(zBiometricTemplate),
  faces: z.array(zBiometricTemplate),
  other: z.array(zBiometricTemplate),
  /** Pending/sent enrolment requests and biometric commands for this employee (newest first, max 20). */
  activity: z.array(
    z.object({
      commandId: z.number().int(),
      deviceId: z.number().int(),
      deviceName: z.string(),
      /** Command name only, never the payload, e.g. "ENROLL_FP", "DATA UPDATE BIOPHOTO". */
      command: z.string(),
      status: z.string(),
      createdAt: zIsoDateTime,
      completedAt: zIsoDateTime.nullable(),
    }),
  ),
});
export type EmployeeBiometrics = z.infer<typeof zEmployeeBiometrics>;

/**
 * GET /employees/:id/photo -> image/jpeg (404 when none). Requires employees.view and wing scope.
 * Sends ETag + Cache-Control: private, max-age=300. `?v=` in EmployeePhoto.url busts caches after an update.
 *
 * PUT /employees/:id/photo (multipart, field "photo": BASELINE JPEG, max 256 KB, 240-1280 px per side; the client
 * always sends 600x600 <= 200 KB, the format the SenseFace already holds) -> 200 EmployeeBiometrics.
 * 400 INVALID_FILE for non-JPEG, progressive JPEG, oversize or bad dimensions. Requires employees.biometrics.
 * Query/form fields:
 *   syncToDevices (default true)   - send the photo to every device holding the employee (DATA UPDATE USERPIC).
 *   createFace    (default false)  - also ask those devices to build a visible-light face template from it
 *                                    (DATA UPDATE BIOPHOTO ... Type=9). Experimental: firmware-dependent.
 * DELETE /employees/:id/photo -> 204 (app copy only; devices keep theirs). Requires employees.biometrics.
 */
export const zPhotoUploadOptions = z.object({
  syncToDevices: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default(true),
  /** Omit to let the server decide: true when the employee is on at least one device (the SenseFace supports it). */
  createFace: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1')
    .optional(),
});
export type PhotoUploadOptions = z.input<typeof zPhotoUploadOptions>;

/**
 * POST /employees/:id/enroll -> 202 { commandId }. Requires employees.biometrics.
 * Starts enrolment ON THE DEVICE: the terminal prompts the employee to place the finger / face the camera.
 * The resulting template uploads by itself (device TransFlag) and appears in GET /biometrics.
 * Only for active employees who are on that device (409 otherwise).
 */
export const zRemoteEnrollInput = z.object({
  deviceId: z.number().int().positive(),
  kind: z.enum(['finger', 'face']),
  /** Required for fingers. */
  fingerIndex: zFingerIndex.optional(),
  /** Replace an existing template for that finger. */
  overwrite: z.boolean().default(true),
});
export type RemoteEnrollInput = z.input<typeof zRemoteEnrollInput>;

/**
 * DELETE /employees/:id/biometrics/:templateId?fromDevices=true -> 204. Requires employees.biometrics.
 * Removes the template from the app and (by default) from every device holding the employee.
 */

/**
 * POST /employees/:id/fingerprints -> 201 BiometricTemplate. Requires employees.biometrics.
 * For the local Biometric Bridge (USB reader on the enrolment PC). Body carries the captured template.
 * The server rejects templates whose algorithm version the devices cannot use (409 TEMPLATE_INCOMPATIBLE).
 */
export const zFingerprintCaptureInput = z.object({
  fingerIndex: zFingerIndex,
  /** Base64 template as produced by the reader SDK. */
  template: z.string().min(16).max(20000),
  /** Algorithm major version, e.g. 10 (ZKFinger 10) or 13 (device-native). */
  majorVersion: z.number().int(),
  minorVersion: z.number().int().default(0),
  /** Reader quality score 0-100 if available. */
  quality: z.number().int().min(0).max(100).optional(),
  syncToDevices: z.boolean().default(true),
});
export type FingerprintCaptureInput = z.input<typeof zFingerprintCaptureInput>;
