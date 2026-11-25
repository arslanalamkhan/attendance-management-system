import { PERMISSIONS, PERMISSION_KEYS, PERMISSION_MODULES } from '@nacta/shared';
import type { Permission } from '@nacta/shared';
import { Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { missingDependencies } from '../../../lib/permission-deps';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Switch } from '../../../components/ui/switch';

export const KEYS_BY_MODULE: { module: string; keys: Permission[] }[] = PERMISSION_MODULES.map((module) => ({
  module,
  keys: PERMISSION_KEYS.filter((k) => PERMISSIONS[k].module === module),
}));

export interface PermissionMatrixProps {
  selected: ReadonlySet<Permission>;
  onChange: (next: Permission[]) => void;
  readOnly?: boolean;
}

const ordered = (set: Set<Permission>): Permission[] => PERMISSION_KEYS.filter((k) => set.has(k));

/** Permissions grouped by module: one switch per permission plus a per-module "select all". */
export function PermissionMatrix({ selected, onChange, readOnly }: PermissionMatrixProps) {
  const toggle = (key: Permission, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    onChange(ordered(next));
  };
  const setModule = (keys: Permission[], on: boolean) => {
    const next = new Set(selected);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    onChange(ordered(next));
  };

  return (
    <div className="space-y-5">
      {KEYS_BY_MODULE.map(({ module, keys }) => {
        const count = keys.filter((k) => selected.has(k)).length;
        const all = count === keys.length;
        return (
          <section key={module} aria-labelledby={`perm-${module}`} className="overflow-hidden rounded-lg border bg-card shadow-xs">
            <header className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2.5">
              <Checkbox
                id={`perm-all-${module}`}
                checked={all ? true : count > 0 ? 'indeterminate' : false}
                disabled={readOnly}
                onCheckedChange={(v) => setModule(keys, v === true)}
                aria-label={`Select all ${module} permissions`}
              />
              <h3 id={`perm-${module}`} className="text-sm font-semibold tracking-tight">
                {module}
              </h3>
              <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs font-medium', count > 0 ? 'bg-primary-subtle text-primary-text' : 'bg-muted text-muted-foreground')}>
                {count} of {keys.length}
              </span>
            </header>
            <ul className="divide-y">
              {keys.map((key) => {
                const p = PERMISSIONS[key];
                const on = selected.has(key);
                const missing = on && !readOnly ? missingDependencies(key, selected) : [];
                const id = `perm-${key}`;
                return (
                  <li key={key} className={cn('flex items-start gap-4 px-4 py-3.5 transition-colors', on && 'bg-primary-subtle/40')}>
                    <div className="min-w-0 flex-1 space-y-1">
                      <label htmlFor={id} className={cn('block text-sm font-medium', !readOnly && 'cursor-pointer')}>
                        {p.label}
                      </label>
                      <p id={`${id}-desc`} className="text-[13px] leading-snug text-muted-foreground">
                        {p.description}
                      </p>
                      <code className="inline-block font-mono text-[11px] text-muted-foreground/80">{key}</code>
                      {missing.length > 0 && (
                        <div role="status" className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-warning-subtle px-2.5 py-1.5 text-xs text-warning-text">
                          <span>
                            Usually needs {missing.map((m) => PERMISSIONS[m].label).join(' and ')}.
                          </span>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto text-xs font-semibold text-warning-text"
                            onClick={() => {
                              const next = new Set(selected);
                              for (const m of missing) next.add(m);
                              onChange(ordered(next));
                            }}
                          >
                            <Plus aria-hidden="true" className="!size-3" />
                            {missing.length === 1 && missing[0]?.endsWith('.view') ? 'Add view permission' : `Add ${missing.length === 1 ? 'it' : 'them'}`}
                          </Button>
                        </div>
                      )}
                    </div>
                    <Switch id={id} aria-describedby={`${id}-desc`} checked={on} disabled={readOnly} onCheckedChange={(v) => toggle(key, v)} className="mt-0.5" />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
