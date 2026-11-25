import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { usePageViews } from '../../hooks/use-page-views';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet';
import { TooltipProvider } from '../ui/tooltip';
import { CommandPaletteProvider } from './command-palette';
import { ShellProvider, useShell } from './shell-context';
import { Sidebar, SidebarContent } from './sidebar';
import { Topbar } from './topbar';

function MobileNav() {
  const { mobileOpen, setMobileOpen } = useShell();
  return (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" hideClose className="bg-sidebar p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Main navigation</SheetDescription>
        <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function ShellLayout() {
  const { setMobileOpen } = useShell();
  const { pathname } = useLocation();
  usePageViews();
  const mainRef = React.useRef<HTMLElement>(null);

  // close the sheet and reset scroll on navigation
  React.useEffect(() => {
    setMobileOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname, setMobileOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only z-[100] rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Sidebar />
      <MobileNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Providers + chrome. Pages render through <Outlet />. */
export function AppShell() {
  return (
    <TooltipProvider>
      <ShellProvider>
        <CommandPaletteProvider>
          <ShellLayout />
        </CommandPaletteProvider>
      </ShellProvider>
    </TooltipProvider>
  );
}

