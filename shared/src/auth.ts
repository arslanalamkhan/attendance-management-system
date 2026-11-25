import { z } from 'zod';
import { zIsoDateTime, zPageQuery } from './common';

// =====================================================================================
// Permission catalogue. The ONLY place permission keys are defined. Roles are bundles of
// these keys, created from scratch by the Super Admin. Server routes and client UI both
// check against these keys. Adding a feature = adding a key here.
// =====================================================================================
export const PERMISSIONS = {
  // Overview
  'dashboard.view': { module: 'Overview', label: 'View dashboard', description: 'See headline numbers and trends (limited to the wings of the role).' },

  // People
  'employees.view': { module: 'People', label: 'View employees', description: 'Browse the directory and open employee profiles.' },
  'employees.manage': { module: 'People', label: 'Manage employees', description: 'Add and edit employees. (Deleting an employee is reserved for the Super Admin, because it also erases their attendance history; use "Mark as left" instead.)' },
  'employees.push': { module: 'People', label: 'Send employees to devices', description: 'Upload or remove employees on attendance terminals.' },
  'employees.biometrics': { module: 'People', label: 'Enrol biometrics', description: 'Upload or capture photos, start fingerprint/face enrolment on devices, and delete stored fingerprints and faces.' },
  'employees.import': { module: 'People', label: 'Import and export employees', description: 'Download employees as Excel and import an edited sheet to update many records at once.' },
  'wings.manage': { module: 'People', label: 'Manage wings', description: 'Create, rename and delete wings and their sections.' },

  // Attendance
  'attendance.view': { module: 'Attendance', label: 'View attendance', description: 'See punch records (limited to the wings of the role).' },
  'attendance.correct': { module: 'Attendance', label: 'Correct attendance', description: 'Add missing punches or override a day status, with a reason. Original punches are never changed. Only the Super Admin can see which days were corrected, list or remove corrections, and see them in the audit log.' },

  // Leave and timings (separate so marking leave does not grant changing office rules)
  'leave.manage': { module: 'Leave & timings', label: 'Mark leave', description: 'Record, edit and cancel leave for employees, for a single day or a date range.' },
  'leave.configure': { module: 'Leave & timings', label: 'Manage leave types', description: 'Create and edit leave types (casual, medical, official duty ...).' },
  'holidays.manage': { module: 'Leave & timings', label: 'Manage holidays', description: 'Maintain the holiday calendar and special working days.' },
  'timings.manage': { module: 'Leave & timings', label: 'Manage office timings', description: 'Set office hours, grace periods and Ramadan timings, and assign them to wings or employees.' },

  'attendance.export': { module: 'Attendance', label: 'Export attendance', description: 'Download attendance as Excel or PDF. Every export is logged.' },

  // Devices
  'devices.view': { module: 'Devices', label: 'View devices', description: 'See terminals, their status and the users stored on them.' },
  'devices.manage': { module: 'Devices', label: 'Manage devices', description: 'Add, rename and delete terminals.' },
  'devices.command': { module: 'Devices', label: 'Send device commands', description: 'Refresh info, check for new data and reboot terminals.' },
  'devices.users': { module: 'Devices', label: 'Manage device users', description: 'Fetch users from terminals, import them as employees, remove them from terminals.' },
  'diagnostics.view': { module: 'Devices', label: 'View device log', description: 'Inspect raw traffic between terminals and the server.' },

  // Administration
  'users.manage': { module: 'Administration', label: 'Manage users', description: 'Create application users, assign roles, reset passwords, sign users out.' },
  'roles.manage': { module: 'Administration', label: 'Manage roles', description: 'Create roles and choose their permissions and wings.' },
  'audit.view': { module: 'Administration', label: 'View audit log', description: 'See who signed in, viewed, changed or exported what.' },
  'settings.manage': { module: 'Administration', label: 'Manage settings', description: 'Change system-wide settings.' },
} as const satisfies Record<string, { module: string; label: string; description: string }>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];
export const zPermission = z.enum(PERMISSION_KEYS as [Permission, ...Permission[]]);

/** Module display order for the permission matrix. */
export const PERMISSION_MODULES = ['Overview', 'People', 'Attendance', 'Leave & timings', 'Devices', 'Administration'] as const;

// ---------- Password policy ----------
export const PASSWORD_MIN_LENGTH = 12;
export const zNewPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'At most 128 characters')
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p), 'Use both upper- and lower-case letters')
  .refine((p) => /\d/.test(p), 'Include at least one number')
  .refine((p) => /[^A-Za-z0-9]/.test(p), 'Include at least one symbol');
// The server additionally rejects passwords that contain the user's email name or appear in a common-password list.

export const zEmail = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);

// ---------- Current user ----------
/** "all" = every wing (and employees without a wing); otherwise the list of wing ids. */
export const zWingScope = z.union([z.literal('all'), z.array(z.number().int())]);
export type WingScope = z.infer<typeof zWingScope>;

export const zCurrentUser = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  isSuperAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
  /** Effective permissions (union of all roles; every key for Super Admin). */
  permissions: z.array(zPermission),
  wingScope: zWingScope,
  roles: z.array(z.object({ id: z.number().int(), name: z.string() })),
  /** The sign-in before the current one, shown as "Last signed in ...". */
  previousLoginAt: zIsoDateTime.nullable(),
  previousLoginIp: z.string().nullable(),
});
export type CurrentUser = z.infer<typeof zCurrentUser>;

/** GET /auth/me and POST /auth/login. Mutating requests must send header `X-CSRF-Token: <csrfToken>`. */
export const zSessionInfo = z.object({
  user: zCurrentUser,
  csrfToken: z.string(),
  /** Absolute session expiry. */
  expiresAt: zIsoDateTime,
  /** Minutes of inactivity before the session ends. */
  idleTimeoutMinutes: z.number().int(),
});
export type SessionInfo = z.infer<typeof zSessionInfo>;

// ---------- Auth endpoints ----------
/** POST /auth/login. Errors: 401 INVALID_CREDENTIALS, 423 ACCOUNT_LOCKED (details.lockedUntil), 403 ACCOUNT_DISABLED, 429 RATE_LIMITED. */
export const zLoginInput = z.object({
  email: zEmail,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.input<typeof zLoginInput>;

/** POST /auth/change-password -> SessionInfo. Revokes all other sessions of the user. */
export const zChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: zNewPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });
export type ChangePasswordInput = z.input<typeof zChangePasswordInput>;

export const zSessionSummary = z.object({
  id: z.string(),
  current: z.boolean(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: zIsoDateTime,
  lastSeenAt: zIsoDateTime,
  expiresAt: zIsoDateTime,
});
export type SessionSummary = z.infer<typeof zSessionSummary>;

// ---------- Roles ----------
export const zRole = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  /** The built-in Super Admin role: every permission, all wings, cannot be edited or deleted. */
  isSystem: z.boolean(),
  permissions: z.array(zPermission),
  allWings: z.boolean(),
  wingIds: z.array(z.number().int()),
  userCount: z.number().int(),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});
export type Role = z.infer<typeof zRole>;

/** POST /roles, PUT /roles/:id. 409 DUPLICATE_ROLE; 400 if allWings is false and wingIds is empty. */
export const zRoleInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'At most 60 characters'),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  permissions: z.array(zPermission),
  allWings: z.boolean().default(true),
  wingIds: z.array(z.number().int().positive()).default([]),
});
export type RoleInput = z.input<typeof zRoleInput>;

// ---------- Users ----------
export const UserStatus = ['active', 'disabled'] as const;
export const zUserStatus = z.enum(UserStatus);
export type UserStatus = z.infer<typeof zUserStatus>;

export const zAppUser = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  status: zUserStatus,
  isSuperAdmin: z.boolean(),
  roles: z.array(z.object({ id: z.number().int(), name: z.string() })),
  mustChangePassword: z.boolean(),
  lockedUntil: zIsoDateTime.nullable(),
  lastLoginAt: zIsoDateTime.nullable(),
  lastLoginIp: z.string().nullable(),
  activeSessions: z.number().int(),
  createdAt: zIsoDateTime,
  updatedAt: zIsoDateTime,
});
export type AppUser = z.infer<typeof zAppUser>;

/** POST /users. The temporary password must be changed at first sign-in. 409 DUPLICATE_EMAIL. */
export const zUserCreateInput = z.object({
  email: zEmail,
  name: z.string().trim().min(1, 'Name is required').max(100),
  roleIds: z.array(z.number().int().positive()).min(1, 'Assign at least one role'),
  temporaryPassword: zNewPassword,
});
export type UserCreateInput = z.input<typeof zUserCreateInput>;

/** PUT /users/:id. Super Admin account: only `name` may change. */
export const zUserUpdateInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  roleIds: z.array(z.number().int().positive()).min(1, 'Assign at least one role').optional(),
  status: zUserStatus.optional(),
});
export type UserUpdateInput = z.input<typeof zUserUpdateInput>;

/** POST /users/:id/reset-password -> 204. Sets a temporary password, forces change, signs the user out everywhere. */
export const zResetPasswordInput = z.object({ temporaryPassword: zNewPassword });
export type ResetPasswordInput = z.input<typeof zResetPasswordInput>;

/** GET /users -> Page<AppUser>. Sort keys: name, email, lastLoginAt, createdAt. */
export const zUserListQuery = zPageQuery.extend({
  q: z.string().trim().optional(),
  status: zUserStatus.optional(),
  roleId: z.coerce.number().int().positive().optional(),
});
export type UserListQuery = z.input<typeof zUserListQuery>;
