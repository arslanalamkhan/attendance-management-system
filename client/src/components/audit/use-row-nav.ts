import * as React from 'react';

/**
 * Arrow-key navigation between rows inside a container. Rows opt in with `data-audit-row`.
 * Up/Down (or k/j) move, Home/End jump. Enter/Space activate the focused row natively when it is a button.
 */
export function useRowNav() {
  return React.useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'j', 'k'];
    if (!keys.includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [role="combobox"]')) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-audit-row]'));
    if (rows.length === 0) return;
    const current = rows.findIndex((r) => r === document.activeElement || r.contains(document.activeElement));
    let next = current;
    if (e.key === 'ArrowDown' || e.key === 'j') next = Math.min(rows.length - 1, current + 1);
    else if (e.key === 'ArrowUp' || e.key === 'k') next = Math.max(0, current < 0 ? 0 : current - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    if (next === current && current >= 0) return;
    e.preventDefault();
    const row = rows[Math.max(0, next)];
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  }, []);
}
