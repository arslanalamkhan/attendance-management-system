import { NavLink, useMatch } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DESIGN_ITEM, visibleNav, type NavItem } from '../../lib/nav';
import { useAuth } from '../../lib/auth';
import { Tooltip } from '../ui/tooltip';
import { IconButton } from '../ui/icon-button';
import { Badge } from '../ui/badge';
import { BrandLockup } from './brand';
import { useShell } from './shell-context';

const itemBase =
  'group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function SidebarLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const active = Boolean(useMatch({ path: item.to, end: item.end ?? false }));

  if (item.soon) {
    const node = (
      <div
        role="link"
        aria-disabled="true"
        tabIndex={0}
        className={cn(itemBase, 'cursor-not-allowed text-muted-foreground/80 hover:bg-transparent', collapsed && 'justify-center px-0')}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="truncate">{item.label}</span>
            <Badge tone="outline" className="ml-auto px-1.5 py-0 text-[10px] uppercase tracking-wide">
              Soon
            </Badge>
          </>
        )}
        {collapsed && <span className="sr-only">{item.label} (coming soon)</span>}
      </div>
    );
    return (
      <Tooltip side="right" content={`${item.label} — coming soon${item.phase ? ` (${item.phase})` : ''}`}>
        {node}
      </Tooltip>
    );
  }

  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={cn(itemBase, collapsed && 'justify-center px-0', active ? 'bg-primary-subtle text-primary-text' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
    >
      <>
          {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
        </>
    </NavLink>
  );
  return collapsed ? (
    <Tooltip side="right" content={item.label}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function SidebarContent({ collapsed, onNavigate, className }: { collapsed: boolean; onNavigate?: () => void; className?: string }) {
  const { canToggle, toggleCollapsed, isSheet } = useShell();
  const { can } = useAuth();
  const groups = visibleNav(can);
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className={cn('flex h-14 shrink-0 items-center border-b border-sidebar-border px-3.5', collapsed && 'justify-center px-0')}>
        <BrandLockup collapsed={collapsed} />
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 py-4">
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            {collapsed ? (
              <div className="mx-2 mb-2 h-px bg-sidebar-border" aria-hidden="true" />
            ) : (
              <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <SidebarLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-sidebar-border p-3">
        <SidebarLink item={DESIGN_ITEM} collapsed={collapsed} onNavigate={onNavigate} />
        {!isSheet && canToggle && (
          <div className={cn('flex items-center pt-1', collapsed ? 'justify-center' : 'justify-between pl-2.5')}>
            {!collapsed && <span className="text-[11px] text-muted-foreground">v0.1 · Phase C</span>}
            <IconButton
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              size="icon-sm"
              tooltipSide="right"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Desktop rail. Rendered only at >=1024px; below that the same content opens as a sheet. */
export function Sidebar() {
  const { collapsed } = useShell();
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'hidden shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out lg:block',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}




