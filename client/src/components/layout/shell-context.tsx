import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { readStorage, writeStorage } from '../../lib/storage';
import { useIsDesktop, useIsDesktopXl } from '../../hooks/use-media-query';

const KEY = 'nacta-sidebar-collapsed';

interface ShellContextValue {
  /** Icon-only rail (user choice at >=1280px, forced between 1024 and 1279px). */
  collapsed: boolean;
  /** Can the user toggle the rail? (only on wide screens) */
  canToggle: boolean;
  /** Below 1024px the sidebar is a sheet. */
  isSheet: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const isDesktop = useIsDesktop();
  const isXl = useIsDesktopXl();
  const [userCollapsed, setUserCollapsed] = useState(() => readStorage(KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setUserCollapsed((c) => {
      writeStorage(KEY, c ? '0' : '1');
      return !c;
    });
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      collapsed: isDesktop && (!isXl || userCollapsed),
      canToggle: isXl,
      isSheet: !isDesktop,
      toggleCollapsed,
      mobileOpen: mobileOpen && !isDesktop,
      setMobileOpen,
    }),
    [isDesktop, isXl, userCollapsed, mobileOpen, toggleCollapsed],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within ShellProvider');
  return ctx;
}
