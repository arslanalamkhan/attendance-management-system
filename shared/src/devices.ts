import { z } from 'zod';
import { zIsoDateTime, zOptionalText, zPageQuery } from './common';

export const DeviceStatus = ['online', 'offline', 'unknown'] as const;
export const zDeviceStatus = z.enum(DeviceStatus);
export type DeviceStatus = z.infer<typeof zDeviceStatus>;

export const zDevice = z.object({
  id: z.number().int(),
  name: z.string(),
  serialNumber: z.string(),
  location: z.string().nullable(),
  ipAddress: z.string().nullable(),
  isActive: z.boolean(),
  status: zDeviceStatus,
  lastSeenAt: zIsoDateTime.nullable(),
  deviceName: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  platform: z.string().nullable(),
  pushVersion: z.string().nullable(),
  userCount: z.number().int().nullable(),
  fpCount: z.number().int().nullable(),
  faceCount: z.number().int().nullable(),
  attCount: z.number().int().nullable(),
  autoRegistered: z.boolean(),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});
export type Device = z.infer<typeof zDevice>;

/** POST /devices body. PUT /devices/:id accepts the same shape with every field optional. */
export const zDeviceInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'At most 100 characters'),
  serialNumber: z
    .string()
    .trim()
    .min(1, 'Serial number is required')
    .max(64, 'At most 64 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, "-" and "_" only'),
  location: zOptionalText(200),
  isActive: z.boolean().default(true),
});
export type DeviceInput = z.input<typeof zDeviceInput>;
export const zDeviceUpdate = zDeviceInput.partial();
export type DeviceUpdate = z.input<typeof zDeviceUpdate>;

// ---------- Commands ----------
export const CommandType = ['info', 'check', 'reboot', 'syncTime'] as const;
export const zCommandType = z.enum(CommandType);
export type CommandType = z.infer<typeof zCommandType>;

export const CommandStatus = ['pending', 'sent', 'success', 'failed'] as const;
export const zCommandStatus = z.enum(CommandStatus);
export type CommandStatus = z.infer<typeof zCommandStatus>;

export const zDeviceCommand = z.object({
  id: z.number().int(),
  deviceId: z.number().int(),
  command: z.string(),
  status: zCommandStatus,
  returnCode: z.number().int().nullable(),
  result: z.string().nullable(),
  createdAt: zIsoDateTime,
  sentAt: zIsoDateTime.nullable(),
  completedAt: zIsoDateTime.nullable(),
});
export type DeviceCommand = z.infer<typeof zDeviceCommand>;

/** POST /devices/:id/commands */
export const zEnqueueCommandInput = z.object({ type: zCommandType });
export type EnqueueCommandInput = z.infer<typeof zEnqueueCommandInput>;

/** GET /devices/:id/commands -> Page<DeviceCommand>, newest first. */
export const zCommandListQuery = zPageQuery.extend({
  status: zCommandStatus.optional(),
});
export type CommandListQuery = z.input<typeof zCommandListQuery>;

// ---------- Users held on a device ----------
export const zTemplateCounts = z.object({
  fp: z.number().int(),
  face: z.number().int(),
  bio: z.number().int(),
});
export type TemplateCounts = z.infer<typeof zTemplateCounts>;

export const zDeviceUser = z.object({
  deviceId: z.number().int(),
  pin: z.string(),
  name: z.string().nullable(),
  privilege: z.number().int().nullable(),
  cardNo: z.string().nullable(),
  hasPassword: z.boolean(),
  group: z.string().nullable(),
  lastSeenAt: zIsoDateTime.nullable(),
  employeeId: z.number().int().nullable(),
  employeeName: z.string().nullable(),
  templates: zTemplateCounts,
});
export type DeviceUser = z.infer<typeof zDeviceUser>;

/** GET /devices/:id/users -> Page<DeviceUser>. Sort keys: pin (numeric), name, lastSeenAt. */
export const zDeviceUserListQuery = zPageQuery.extend({
  q: z.string().trim().optional(),
  /** true = only users with a matching employee, false = only unmatched. */
  linked: z.enum(['true', 'false']).optional(),
});
export type DeviceUserListQuery = z.input<typeof zDeviceUserListQuery>;

/** POST /devices/:id/users/import */
export const zImportDeviceUsersInput = z.object({
  pins: z.array(z.string()).optional(),
  overwrite: z.boolean().default(false),
});
export type ImportDeviceUsersInput = z.input<typeof zImportDeviceUsersInput>;
export const zImportResult = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});
export type ImportResult = z.infer<typeof zImportResult>;

// ---------- Raw device traffic (diagnostics) ----------
export const zAdmsRequest = z.object({
  id: z.number().int(),
  serialNumber: z.string().nullable(),
  method: z.string(),
  path: z.string(),
  query: z.string().nullable(),
  body: z.string().nullable(),
  response: z.string().nullable(),
  remoteIp: z.string().nullable(),
  createdAt: zIsoDateTime,
});
export type AdmsRequest = z.infer<typeof zAdmsRequest>;

/** GET /adms-log -> Page<AdmsRequest>, newest first. */
export const zAdmsLogQuery = zPageQuery.extend({
  serialNumber: z.string().trim().optional(),
  path: z.string().trim().optional(),
});
export type AdmsLogQuery = z.input<typeof zAdmsLogQuery>;
