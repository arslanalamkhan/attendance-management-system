import { Link, useLocation } from 'react-router-dom';
import { LogOut, Menu, Moon, Monitor, Palette, Search, Sun, UserRound } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { findNav, modKeyLabel } from '../../lib/nav';
import { useTheme, type Theme } from '../../lib/theme';
import { Avatar } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Breadcrumbs, type Crumb } from '../ui/breadcrumbs';
import { IconButton } from '../ui/icon-button';
import { Kbd } from '../ui/kbd';
import { Tooltip } from '../ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useCommandPalette } from './command-palette';
import { useShell } from './shell-context';
import { ThemeToggle } from './theme-toggle';

function envLabel(): { label: string; dev: boolean } {
  const env = (import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE;
  if (env === 'production') return { label: 'Production', dev: false };
  if (env === 'development') return { label: 'Development', dev: true };
  return { label: env.charAt(0).toUpperCase() + env.slice(1), dev: true };
}

function UserMenu() {
  const { theme, setTheme } = useTheme();
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.name}`}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar name={user.name} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-start gap-3 px-2 py-2">
          <Avatar name={user.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {user.roles.map((r) => (
                <Badge key={r.id} tone={user.isSuperAdmin ? 'primary' : 'neutral'} className="px-1.5 py-0 text-[11px]">
                  {r.name}
                </Badge>
              ))}
              {user.roles.length === 0 && <span className="text-[11px] text-muted-foreground">No role assigned</span>}
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <UserRound aria-hidden="true" /> My account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette aria-hidden="true" /> Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              <DropdownMenuRadioItem value="light">
                <Sun aria-hidden="true" /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon aria-hidden="true" /> Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor aria-hidden="true" /> System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function Topbar() {
  const { pathname } = useLocation();
  const { setOpen } = useCommandPalette();
  const { isSheet, setMobileOpen } = useShell();
  const match = findNav(pathname);
  const env = envLabel();
  const mod = modKeyLabel();

  const crumbs: Crumb[] = match
    ? [{ label: match.group }, { label: match.item.label }]
    : pathname === '/account'
      ? [{ label: 'Account' }, { label: 'My account' }]
      : [{ label: 'Not found' }];

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
      {isSheet && (
        <IconButton label="Open navigation" icon={<Menu />} onClick={() => setMobileOpen(true)} tooltip={false} className="-ml-2" />
      )}
      <Breadcrumbs items={crumbs} className="hidden sm:block" />
      <span className="truncate text-sm font-medium sm:hidden">{crumbs[crumbs.length - 1]?.label}</span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Search and commands (${mod} K)`}
          className="group hidden h-8 w-64 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] text-muted-foreground shadow-xs transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex lg:w-72"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="flex-1 text-left">Search or jump to...</span>
          <span className="flex items-center gap-0.5" aria-hidden="true">
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <IconButton label="Search" icon={<Search />} onClick={() => setOpen(true)} className="md:hidden" shortcut={`${mod} K`} />

        <Tooltip content={`${env.label} environment`} side="bottom">
          <span className="hidden sm:inline-flex">
            <Badge tone={env.dev ? 'warning' : 'neutral'} className="gap-1.5">
              <span className={env.dev ? 'size-1.5 rounded-full bg-warning' : 'size-1.5 rounded-full bg-success'} aria-hidden="true" />
              {env.label}
            </Badge>
          </span>
        </Tooltip>

        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}


