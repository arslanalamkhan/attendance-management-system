import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CircleHelp,
  Moon,
  Monitor,
  PanelLeft,
  RefreshCw,
  Sun,
  UserPlus,
  Plus,
  LogOut,
  UserRound,
  UserCog,
  ShieldCheck,
  FileUp,
  FileDown,
  Building2,
  CalendarPlus,
  CalendarDays,
  CalendarHeart,
  Clock3,
} from 'lucide-react';
import { toast } from 'sonner';
import { REPORT_TYPES, REPORT_TYPE_KEYS, reportPermission } from '@nacta/shared';
import { REPORT_ICON } from '../../pages/reports/report-meta';
import { DESIGN_ITEM, modKeyLabel, visibleNav } from '../../lib/nav';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '../ui/command';
import { Kbd } from '../ui/kbd';
import { Badge } from '../ui/badge';
import { useShell } from './shell-context';

interface PaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const PaletteContext = React.createContext<PaletteContextValue | null>(null);

export function useCommandPalette(): PaletteContextValue {
  const ctx = React.useContext(PaletteContext);
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider');
  return ctx;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const toggle = React.useCallback(() => setOpen((o) => !o), []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const value = React.useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette />
    </PaletteContext.Provider>
  );
}

function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { theme, setTheme, toggleTheme, resolvedTheme } = useTheme();
  const { canToggle, toggleCollapsed } = useShell();
  const mod = modKeyLabel();
  const { can, signOut } = useAuth();

  const run = (fn: () => void) => () => {
    setOpen(false);
    // let the dialog close before navigating / opening something else
    window.setTimeout(fn, 0);
  };

  const pages = [
    ...visibleNav(can).flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))),
    { label: 'My account', to: '/account', icon: UserRound, keywords: ['profile', 'password', 'sessions', 'security'], group: 'Account' },
    { ...DESIGN_ITEM, group: 'Developer' },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose size="md" className="top-[18%] max-w-xl translate-y-0 overflow-hidden p-0 data-[state=open]:slide-in-from-top-2">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search for a page or run an action. Use the arrow keys to move and Enter to select.</DialogDescription>
        <Command loop>
          <CommandInput placeholder="Search pages and actions..." aria-label="Search pages and actions" />
          <CommandList className="max-h-[min(24rem,60dvh)]">
            <CommandEmpty>No results. Try “employees”, “theme” or “devices”.</CommandEmpty>

            <CommandGroup heading="Go to">
              {pages.map((p) => {
                const Icon = p.icon;
                const here = location.pathname === p.to;
                return (
                  <CommandItem
                    key={p.to}
                    value={`${p.label} ${p.group}`}
                    keywords={[p.group, ...(p.keywords ?? [])]}
                    disabled={p.soon}
                    onSelect={run(() => navigate(p.to))}
                  >
                    <Icon aria-hidden="true" />
                    <span>{p.label}</span>
                    <span className="text-xs text-muted-foreground">{p.group}</span>
                    {p.soon ? (
                      <Badge tone="outline" className="ml-auto px-1.5 py-0 text-[10px] uppercase">
                        Soon
                      </Badge>
                    ) : here ? (
                      <CommandShortcut>Current</CommandShortcut>
                    ) : (
                      <ArrowRight className="ml-auto opacity-0 group-data-[selected=true]:opacity-100" aria-hidden="true" />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {REPORT_TYPE_KEYS.some((key) => can(reportPermission(key))) && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Reports">
                  {REPORT_TYPE_KEYS.filter((key) => can(reportPermission(key))).map((key) => {
                    const Icon = REPORT_ICON[key];
                    const to = `/reports/${key}`;
                    return (
                      <CommandItem key={key} value={`Report ${REPORT_TYPES[key].label}`} keywords={['report', 'export', 'excel', 'pdf', REPORT_TYPES[key].description]} onSelect={run(() => navigate(to))}>
                        <Icon aria-hidden="true" />
                        <span>{REPORT_TYPES[key].label}</span>
                        <span className="text-xs text-muted-foreground">Report</span>
                        {location.pathname === to ? <CommandShortcut>Current</CommandShortcut> : <ArrowRight className="ml-auto opacity-0 group-data-[selected=true]:opacity-100" aria-hidden="true" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />

            <CommandGroup heading="Actions">
              {can('leave.manage') && (
                <CommandItem value="Mark leave" keywords={['leave', 'casual', 'medical', 'absence', 'off', 'vacation']} onSelect={run(() => navigate('/attendance/leave?mark=1'))}>
                  <CalendarPlus aria-hidden="true" />
                  Mark leave
                </CommandItem>
              )}
              {can('attendance.view') && (
                <CommandItem value="Today's attendance" keywords={['daily', 'present', 'absent', 'late', 'who is in']} onSelect={run(() => navigate('/attendance/daily'))}>
                  <CalendarDays aria-hidden="true" />
                  Today&apos;s attendance
                </CommandItem>
              )}
              {(can('holidays.manage') || can('attendance.view')) && (
                <CommandItem value="Holidays" keywords={['calendar', 'eid', 'public holiday', 'gazetted']} onSelect={run(() => navigate('/settings/holidays'))}>
                  <CalendarHeart aria-hidden="true" />
                  Holidays
                </CommandItem>
              )}
              {can('timings.manage') && (
                <CommandItem value="Office timings" keywords={['hours', 'ramadan', 'grace', 'shift', 'schedule']} onSelect={run(() => navigate('/settings/timings'))}>
                  <Clock3 aria-hidden="true" />
                  Office timings
                </CommandItem>
              )}
              {can('employees.manage') && (
                <CommandItem value="Add employee" keywords={['new', 'create', 'person', 'staff']} onSelect={run(() => navigate('/employees?new=1'))}>
                  <UserPlus aria-hidden="true" />
                  Add employee
                </CommandItem>
              )}
              {can('employees.import') && can('employees.manage') && (
                <CommandItem value="Import employees from Excel" keywords={['upload', 'xlsx', 'spreadsheet', 'bulk', 'update']} onSelect={run(() => navigate('/employees/import'))}>
                  <FileUp aria-hidden="true" />
                  Import employees from Excel
                </CommandItem>
              )}
              {can('employees.import') && (
                <CommandItem value="Export employees" keywords={['download', 'xlsx', 'spreadsheet', 'excel']} onSelect={run(() => navigate('/employees?export=1'))}>
                  <FileDown aria-hidden="true" />
                  Export employees
                </CommandItem>
              )}
              {can('wings.manage') && (
                <CommandItem value="Manage wings" keywords={['sections', 'departments', 'organisation', 'units']} onSelect={run(() => navigate('/wings'))}>
                  <Building2 aria-hidden="true" />
                  Manage wings
                </CommandItem>
              )}
              {can('devices.manage') && (
                <CommandItem value="Add device" keywords={['new', 'create', 'terminal', 'register']} onSelect={run(() => navigate('/devices?new=1'))}>
                  <Plus aria-hidden="true" />
                  Add device
                </CommandItem>
              )}
              {can('users.manage') && (
                <CommandItem value="Create user" keywords={['new', 'add', 'account', 'invite']} onSelect={run(() => navigate('/admin/users?new=1'))}>
                  <UserCog aria-hidden="true" />
                  Create user
                </CommandItem>
              )}
              {can('roles.manage') && (
                <CommandItem value="Create role" keywords={['new', 'add', 'permissions', 'access']} onSelect={run(() => navigate('/admin/roles/new'))}>
                  <ShieldCheck aria-hidden="true" />
                  Create role
                </CommandItem>
              )}
              <CommandItem
                value="Toggle theme"
                keywords={['dark', 'light', 'appearance', 'mode']}
                onSelect={run(toggleTheme)}
              >
                {resolvedTheme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
                Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} theme
              </CommandItem>
              {theme !== 'system' && (
                <CommandItem value="Use system theme" keywords={['appearance', 'auto']} onSelect={run(() => setTheme('system'))}>
                  <Monitor aria-hidden="true" />
                  Use system theme
                </CommandItem>
              )}
              {canToggle && (
                <CommandItem value="Toggle sidebar" keywords={['collapse', 'expand', 'navigation']} onSelect={run(toggleCollapsed)}>
                  <PanelLeft aria-hidden="true" />
                  Toggle sidebar
                </CommandItem>
              )}
              <CommandItem
                value="Refresh data"
                keywords={['reload', 'refetch']}
                onSelect={run(() => {
                  void qc.invalidateQueries();
                  toast.success('Refreshing data');
                })}
              >
                <RefreshCw aria-hidden="true" />
                Refresh data
              </CommandItem>
              <CommandItem value="Sign out" keywords={['log out', 'logout', 'exit']} onSelect={run(() => void signOut())}>
                <LogOut aria-hidden="true" />
                Sign out
              </CommandItem>
              <CommandItem value="Keyboard shortcuts" keywords={['help', 'keys']} onSelect={run(() => toast.info(`${mod} K opens this palette · Esc closes dialogs · ↑ ↓ moves through table rows`))}>
                <CircleHelp aria-hidden="true" />
                Keyboard shortcuts
              </CommandItem>
            </CommandGroup>
          </CommandList>

          <div className="flex items-center gap-4 border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> select
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>esc</Kbd> close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

