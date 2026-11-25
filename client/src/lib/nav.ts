import type { Permission } from '@nacta/shared';
import {
  Building2,
  Cpu,
  FileBarChart,
  FileClock,
  LayoutDashboard,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  CalendarDays,
  CalendarHeart,
  CalendarOff,
  Clock3,
  Fingerprint,
  Tags,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Not built yet: shown disabled with a "Soon" tag. */
  soon?: boolean;
  /** Which roadmap phase delivers it (tooltip text for "Soon" items). */
  phase?: string;
  /** Match the path exactly (Dashboard). */
  end?: boolean;
  keywords?: string[];
  /** The user needs ANY of these permissions to see (and open) the page. */
  perm?: Permission[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true, perm: ['dashboard.view'], keywords: ['home', 'overview', 'stats'] }],
  },
  {
    label: 'People',
    items: [
      { label: 'Employees', to: '/employees', icon: Users, perm: ['employees.view'], keywords: ['staff', 'people', 'pin', 'import', 'export', 'excel'] },
      { label: 'Wings', to: '/wings', icon: Building2, perm: ['employees.view'], keywords: ['sections', 'departments', 'units', 'organisation'] },
    ],
  },
  {
    label: 'Attendance',
    items: [
      { label: 'Daily attendance', to: '/attendance/daily', icon: CalendarDays, perm: ['attendance.view'], keywords: ['today', 'present', 'absent', 'late', 'status', 'daily', 'register'] },
      { label: 'Punch records', to: '/attendance', icon: Fingerprint, end: true, perm: ['attendance.view'], keywords: ['punches', 'raw', 'attendance', 'time', 'records'] },
      { label: 'Leave', to: '/attendance/leave', icon: CalendarOff, perm: ['leave.manage', 'attendance.view'], keywords: ['mark leave', 'casual', 'medical', 'vacation', 'off', 'absence'] },
    ],
  },
  {
    label: 'Reports',
    items: [{ label: 'All reports', to: '/reports', icon: FileBarChart, perm: ['attendance.view'], keywords: ['report', 'export', 'excel', 'pdf', 'register', 'monthly', 'late comers', 'absentees', 'time card', 'summary', 'download'] }],
  },
  {
    label: 'Leave & timings',
    items: [
      { label: 'Leave types', to: '/settings/leave-types', icon: Tags, perm: ['leave.configure'], keywords: ['casual', 'earned', 'medical', 'colour', 'codes'] },
      { label: 'Holidays', to: '/settings/holidays', icon: CalendarHeart, perm: ['holidays.manage', 'attendance.view'], keywords: ['calendar', 'eid', 'public holiday', 'gazetted', 'working day'] },
      { label: 'Office timings', to: '/settings/timings', icon: Clock3, perm: ['timings.manage'], keywords: ['hours', 'shift', 'ramadan', 'grace', 'late', 'schedule'] },
    ],
  },
  {
    label: 'Devices',
    items: [
      { label: 'Devices', to: '/devices', icon: Cpu, perm: ['devices.view'], keywords: ['terminal', 'zkteco', 'sensface'] },
      { label: 'Device log', to: '/diagnostics', icon: ScrollText, perm: ['diagnostics.view'], keywords: ['adms', 'diagnostics', 'traffic'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', to: '/admin/users', icon: UserCog, perm: ['users.manage'], keywords: ['accounts', 'people', 'passwords', 'sign out'] },
      { label: 'Roles', to: '/admin/roles', icon: ShieldCheck, perm: ['roles.manage'], keywords: ['rbac', 'permissions', 'access', 'wings'] },
      { label: 'Audit log', to: '/admin/audit', icon: FileClock, perm: ['audit.view'], keywords: ['activity', 'history', 'security', 'sign-ins', 'export', 'log'] },
      { label: 'Settings', to: '/settings', icon: Settings, soon: true, phase: 'Phase B', perm: ['settings.manage'], keywords: ['preferences', 'system'] },
    ],
  },
];

/** Keep only what the user may open; empty groups disappear. */
export function visibleNav(can: (p: Permission) => boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || i.perm.some(can)) })).filter((g) => g.items.length > 0);
}

/** Landing page for a user who cannot see the dashboard. */
export function firstAccessiblePath(can: (p: Permission) => boolean): string | null {
  for (const g of NAV)
    for (const i of g.items) if (!i.soon && (!i.perm || i.perm.some(can))) return i.to;
  return null;
}
export const DESIGN_ITEM: NavItem = { label: 'Design system', to: '/design', icon: Palette, keywords: ['components', 'gallery', 'ui'] };

export interface NavMatch {
  group: string;
  item: NavItem;
}

export function findNav(pathname: string): NavMatch | null {
  for (const g of NAV) {
    for (const item of g.items) {
      if (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)) {
        return { group: g.label, item };
      }
    }
  }
  if (pathname === DESIGN_ITEM.to || pathname.startsWith(`${DESIGN_ITEM.to}/`)) return { group: 'Developer', item: DESIGN_ITEM };
  return null;
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere. */
export function modKeyLabel(): string {
  const nav = typeof navigator === 'undefined' ? '' : `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad/i.test(nav) ? '⌘' : 'Ctrl';
}

