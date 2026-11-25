import {
  Ban,
  Cpu,
  Download,
  Eye,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  MonitorX,
  Pencil,
  CirclePlus,
  Camera,
  Fingerprint,
  Send,
  ShieldAlert,
  Trash2,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { AUDIT_ACTIONS } from '@nacta/shared';
import type { AuditAction, AuditCategory, AuditEntityType, AuditEntry, AuditOutcome, Permission } from '@nacta/shared';

/**
 * The single source of truth for how audit categories look (colour + icon) and read (label).
 * Every audit surface (table, timeline, feeds, filters, detail sheet, dashboard card) imports from here.
 * Classes are written out in full so Tailwind can see them; each pair works in light and dark themes.
 */
export interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  /** Icon tile background + glyph colour. */
  tile: string;
  /** Small coloured dot (legends, chips). */
  dot: string;
  /** Selected state of a category chip. */
  chipActive: string;
}

export const CATEGORY_META: Record<AuditCategory, CategoryMeta> = {
  auth: {
    label: 'Sign-in',
    icon: LogIn,
    tile: 'bg-info-subtle text-info-text',
    dot: 'bg-info',
    chipActive: 'border-info/50 bg-info-subtle text-info-text',
  },
  view: {
    label: 'Views',
    icon: Eye,
    tile: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
    chipActive: 'border-border-strong bg-muted text-foreground',
  },
  create: {
    label: 'Created',
    icon: CirclePlus,
    tile: 'bg-success-subtle text-success-text',
    dot: 'bg-success',
    chipActive: 'border-success/50 bg-success-subtle text-success-text',
  },
  update: {
    label: 'Changed',
    icon: Pencil,
    tile: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500 dark:bg-violet-400',
    chipActive: 'border-violet-500/50 bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
  delete: {
    label: 'Deleted',
    icon: Trash2,
    tile: 'bg-danger-subtle text-danger-text',
    dot: 'bg-danger',
    chipActive: 'border-danger/50 bg-danger-subtle text-danger-text',
  },
  export: {
    label: 'Exports',
    icon: Download,
    tile: 'bg-warning-subtle text-warning-text',
    dot: 'bg-warning',
    chipActive: 'border-warning/50 bg-warning-subtle text-warning-text',
  },
  device: {
    label: 'Devices',
    icon: Cpu,
    tile: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    dot: 'bg-teal-500 dark:bg-teal-400',
    chipActive: 'border-teal-500/50 bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  },
  security: {
    label: 'Security',
    icon: ShieldAlert,
    tile: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500 dark:bg-fuchsia-400',
    chipActive: 'border-fuchsia-500/50 bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
  },
};

/** Action-specific glyphs where the category icon would be too generic. */
const ACTION_ICONS: Partial<Record<AuditAction, LucideIcon>> = {
  'auth.login': LogIn,
  'auth.login_failed': UserX,
  'auth.locked': Lock,
  'auth.logout': LogOut,
  'auth.password_changed': KeyRound,
  'auth.session_revoked': MonitorX,
  'user.reset_password': KeyRound,
  'user.unlock': Lock,
  'user.revoke_sessions': MonitorX,
  'employee.push': Send,
  'employee.photo_update': Camera,
  'employee.photo_delete': Camera,
  'biometric.enroll_requested': Fingerprint,
  'biometric.captured': Fingerprint,
  'biometric.delete': Fingerprint,
  'access.denied': Ban,
};

export function actionIcon(action: AuditAction, category: AuditCategory): LucideIcon {
  return ACTION_ICONS[action] ?? CATEGORY_META[category].icon;
}

export function actionLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, { label: string }>)[action]?.label ?? action;
}

export const OUTCOME_META: Record<AuditOutcome, { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  success: { label: 'Success', tone: 'success' },
  failure: { label: 'Failed', tone: 'danger' },
  denied: { label: 'Denied', tone: 'warning' },
};

export const ENTITY_LABELS: Record<AuditEntityType, string> = {
  employee: 'Employee',
  wing: 'Wing',
  section: 'Section',
  department: 'Wing (legacy)',
  import: 'Import',
  device: 'Device',
  user: 'User',
  role: 'Role',
  session: 'Session',
  page: 'Page',
  export: 'Export',
  leave: 'Leave',
  leave_type: 'Leave type',
  holiday: 'Holiday',
  timing: 'Office timing',
  correction: 'Correction',
};

/** Where a subject lives in the app, or null when it has no page or the viewer cannot open it. */
export function entityHref(entry: Pick<AuditEntry, 'entityType' | 'entityId' | 'entityLabel'>, can: (p: Permission) => boolean): string | null {
  const { entityType: type, entityId: id, entityLabel: label } = entry;
  if (!type || !id) return null;
  switch (type) {
    case 'employee':
      return can('employees.view') && /^\d+$/.test(id) ? `/employees/${id}` : null;
    case 'device':
      return can('devices.view') && /^\d+$/.test(id) ? `/devices/${id}` : null;
    case 'role':
      return can('roles.manage') && /^\d+$/.test(id) ? `/admin/roles/${id}` : null;
    case 'user':
      return can('users.manage') ? `/admin/users${label ? `?q=${encodeURIComponent(label.split(' Â· ')[0] ?? label)}` : ''}` : null;
    case 'wing':
    case 'department':
      return can('employees.view') && /^\d+$/.test(id) ? `/employees?wingId=${id}` : null;
    case 'page':
      return id.startsWith('/') ? id : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Time formatting (24-hour, en-GB: unambiguous for audit reading)
// ---------------------------------------------------------------------------------------------
const stampFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** "24 Nov 2026, 14:32:07" */
export const formatStamp = (iso: string): string => stampFmt.format(new Date(iso));
/** "14:32:07" */
export const formatClock = (iso: string): string => clockFmt.format(new Date(iso));

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Local calendar day of an ISO timestamp, "YYYY-MM-DD". */
export const dayKeyOf = (iso: string): string => ymd(new Date(iso));

/** "Today", "Yesterday" or "Monday 23 November 2026". */
export function dayHeading(key: string, now: Date = new Date()): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const today = ymd(now);
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return dayFmt.format(date);
}

/** "permissions" -> "Permissions", "allWings" -> "All wings", "device_id" -> "Device id". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const REDACTED = '[redacted]';

