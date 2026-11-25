import { z } from 'zod';
import { zDate, zIsoDateTime, zPageQuery } from './common';

// =====================================================================================
// Audit catalogue. Every audited action is listed here with a category and a human label.
// The server writes only these action keys; the client renders labels/icons from here.
// =====================================================================================
export const AUDIT_CATEGORIES = ['auth', 'view', 'create', 'update', 'delete', 'export', 'device', 'security'] as const;
export const zAuditCategory = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof zAuditCategory>;

export const AUDIT_ACTIONS = {
  // Sign-in and sessions
  'auth.login': { category: 'auth', label: 'Signed in' },
  'auth.login_failed': { category: 'auth', label: 'Failed sign-in' },
  'auth.locked': { category: 'security', label: 'Account locked after failed sign-ins' },
  'auth.logout': { category: 'auth', label: 'Signed out' },
  'auth.password_changed': { category: 'security', label: 'Changed own password' },
  'auth.session_revoked': { category: 'security', label: 'Ended a session' },

  // Viewing (sent by the client on navigation; deduplicated per session/page/minute)
  'view.page': { category: 'view', label: 'Viewed page' },

  // Employees and wings
  'employee.create': { category: 'create', label: 'Added employee' },
  'employee.update': { category: 'update', label: 'Edited employee' },
  'employee.delete': { category: 'delete', label: 'Deleted employee' },
  'employee.push': { category: 'device', label: 'Sent employees to devices' },
  'employee.status': { category: 'security', label: 'Changed employee status' },
  'employee.device_sync': { category: 'device', label: 'Synced employee with devices' },
  'employee.export': { category: 'export', label: 'Exported employees to Excel' },
  'employee.photo_update': { category: 'update', label: 'Updated employee photo' },
  'employee.photo_delete': { category: 'delete', label: 'Removed employee photo' },
  'biometric.enroll_requested': { category: 'device', label: 'Started enrolment on device' },
  'biometric.captured': { category: 'create', label: 'Captured fingerprint in the app' },
  'biometric.delete': { category: 'delete', label: 'Deleted fingerprint or face' },
  'employee.import': { category: 'update', label: 'Imported employees from Excel' },
  'wing.create': { category: 'create', label: 'Created wing' },
  'wing.update': { category: 'update', label: 'Edited wing' },
  'wing.delete': { category: 'delete', label: 'Deleted wing' },
  'section.create': { category: 'create', label: 'Created section' },
  'section.update': { category: 'update', label: 'Renamed section' },
  'section.delete': { category: 'delete', label: 'Deleted section' },
  // Legacy keys (entries written before Phase D); not written any more.
  'department.create': { category: 'create', label: 'Created wing' },
  'department.update': { category: 'update', label: 'Renamed wing' },
  'department.delete': { category: 'delete', label: 'Deleted wing' },

  // Attendance rules
  'leave.create': { category: 'create', label: 'Marked leave' },
  'leave.update': { category: 'update', label: 'Edited leave' },
  'leave.delete': { category: 'delete', label: 'Cancelled leave' },
  'leave_type.create': { category: 'create', label: 'Created leave type' },
  'leave_type.update': { category: 'update', label: 'Edited leave type' },
  'holiday.create': { category: 'create', label: 'Added holiday' },
  'holiday.update': { category: 'update', label: 'Edited holiday' },
  'holiday.delete': { category: 'delete', label: 'Removed holiday' },
  'timing.create': { category: 'create', label: 'Created office timing' },
  'timing.update': { category: 'update', label: 'Edited office timing' },
  'timing.delete': { category: 'delete', label: 'Deleted office timing' },
  'timing.assign': { category: 'update', label: 'Assigned office timing' },
  'timing.unassign': { category: 'delete', label: 'Removed timing assignment' },
  'attendance.correct': { category: 'update', label: 'Corrected attendance' },
  'attendance.correction_delete': { category: 'delete', label: 'Removed attendance correction' },
  'attendance.recompute': { category: 'update', label: 'Recalculated attendance' },

  // Devices
  'device.create': { category: 'create', label: 'Added device' },
  'device.update': { category: 'update', label: 'Edited device' },
  'device.delete': { category: 'delete', label: 'Deleted device' },
  'device.command': { category: 'device', label: 'Sent device command' },
  'device_users.fetch': { category: 'device', label: 'Requested users from device' },
  'device_users.import': { category: 'create', label: 'Imported device users as employees' },
  'device_users.remove': { category: 'device', label: 'Removed user from device' },

  // Administration
  'user.create': { category: 'create', label: 'Created user' },
  'user.update': { category: 'update', label: 'Edited user' },
  'user.delete': { category: 'delete', label: 'Deleted user' },
  'user.reset_password': { category: 'security', label: 'Reset user password' },
  'user.unlock': { category: 'security', label: 'Unlocked user' },
  'user.revoke_sessions': { category: 'security', label: 'Signed user out everywhere' },
  'role.create': { category: 'create', label: 'Created role' },
  'role.update': { category: 'update', label: 'Edited role' },
  'role.delete': { category: 'delete', label: 'Deleted role' },

  // Exports
  'attendance.export': { category: 'export', label: 'Exported attendance' },
  'audit.export': { category: 'export', label: 'Exported audit log' },

  // Safety nets
  'access.denied': { category: 'security', label: 'Access denied' },
  'api.write': { category: 'update', label: 'Other change' },
} as const satisfies Record<string, { category: AuditCategory; label: string }>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

/**
 * Entries only the Super Admin account may see. They are still written (the trail is complete), but every audit
 * read path (list, entry, summary, CSV export, activity feeds) hides them from everyone else, including holders of
 * audit.view and the user who performed the action. Decided by NACTA, 2026-11-24.
 */
export const SUPER_ADMIN_ONLY_AUDIT_ACTIONS: readonly AuditAction[] = ['attendance.correct', 'attendance.correction_delete'];
export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTIONS) as AuditAction[];
export const zAuditAction = z.enum(AUDIT_ACTION_KEYS as [AuditAction, ...AuditAction[]]);

export const AUDIT_OUTCOMES = ['success', 'failure', 'denied'] as const;
export const zAuditOutcome = z.enum(AUDIT_OUTCOMES);
export type AuditOutcome = z.infer<typeof zAuditOutcome>;

/** Entity types that can be the subject of an entry (used for per-object activity tabs). */
/** 'department' is legacy (pre-Phase D entries); new entries use 'wing' / 'section'. */
export const AUDIT_ENTITY_TYPES = ['employee', 'wing', 'section', 'department', 'device', 'user', 'role', 'session', 'page', 'export', 'import', 'leave', 'leave_type', 'holiday', 'timing', 'correction'] as const;
export const zAuditEntityType = z.enum(AUDIT_ENTITY_TYPES);
export type AuditEntityType = z.infer<typeof zAuditEntityType>;

/** One field-level change. Sensitive fields (passwords, device passwords) are always written as "[redacted]". */
export const zAuditChange = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type AuditChange = z.infer<typeof zAuditChange>;

export const zAuditEntry = z.object({
  id: z.number().int(),
  at: zIsoDateTime,
  /** null for anonymous events (e.g. failed sign-in with an unknown email). */
  userId: z.number().int().nullable(),
  /** Snapshot at the time of the event, so entries stay readable after a user is renamed or deleted. */
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
  action: zAuditAction,
  category: zAuditCategory,
  outcome: zAuditOutcome,
  entityType: zAuditEntityType.nullable(),
  entityId: z.string().nullable(),
  /** Human label of the subject at the time, e.g. "777 · Arslan Alam Khan", "Attendance Basement". */
  entityLabel: z.string().nullable(),
  /** One-line human description, e.g. "Changed wing from Operations to Admin". */
  summary: z.string(),
  changes: z.array(zAuditChange).nullable(),
  /** Free-form context: export filters and row count, page path and query, command name, counts... */
  metadata: z.record(z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof zAuditEntry>;

/**
 * GET /audit -> Page<AuditEntry>, newest first by default. Sort keys: at.
 * `from`/`to` are inclusive calendar dates (server local time, Pakistan).
 */
export const zAuditQuery = zPageQuery.extend({
  q: z.string().trim().optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: zAuditAction.optional(),
  category: zAuditCategory.optional(),
  outcome: zAuditOutcome.optional(),
  entityType: zAuditEntityType.optional(),
  entityId: z.string().trim().optional(),
  from: zDate.optional(),
  to: zDate.optional(),
});
export type AuditQuery = z.input<typeof zAuditQuery>;

/** POST /audit/views -> 204. Sent by the client on each route change (any signed-in user). */
export const zPageViewInput = z.object({
  /** Route path, e.g. "/employees/273". */
  path: z.string().max(300),
  /** Human page title, e.g. "Employee profile". */
  title: z.string().max(120),
  entityType: zAuditEntityType.optional(),
  entityId: z.string().max(64).optional(),
  entityLabel: z.string().max(200).optional(),
  /** Search params that matter for the view (filters, date range). */
  query: z.record(z.string()).optional(),
});
export type PageViewInput = z.input<typeof zPageViewInput>;

/** GET /audit/summary?from&to -> headline numbers for the audit page. */
export const zAuditSummary = z.object({
  total: z.number().int(),
  signIns: z.number().int(),
  failedSignIns: z.number().int(),
  changes: z.number().int(),
  exports: z.number().int(),
  denied: z.number().int(),
  activeUsers: z.number().int(),
});
export type AuditSummary = z.infer<typeof zAuditSummary>;
