import * as React from 'react';
import { CalendarDays, ChevronDown, Rows3, Table2, X } from 'lucide-react';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES } from '@nacta/shared';
import type { AuditCategory } from '@nacta/shared';
import { CATEGORY_META } from '../../../lib/audit-ui';
import { addDaysYmd, isYmd, todayYmd } from '../../../lib/dates';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Combobox, type ComboboxOption } from '../../../components/ui/combobox';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { RANGE_PRESETS, rangeLabel, type ResolvedRange } from './audit-range';

// ---------------------------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------------------------
export interface RangeChange {
  range: string;
  from?: string;
  to?: string;
}

export function AuditRangePicker({ value, onChange }: { value: ResolvedRange; onChange: (r: RangeChange) => void }) {
  const [open, setOpen] = React.useState(false);
  const isCustom = value.key === 'custom';
  const active = isCustom ? 'custom' : value.key;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Date range: ${rangeLabel(value)}`} className={cn('justify-between gap-2 px-2.5', value.key !== '7d' && 'border-primary/60 bg-primary-subtle')}>
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          <span className="text-muted-foreground">Date:</span>
          <span className="max-w-[16rem] truncate">{rangeLabel(value)}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div role="group" aria-label="Range presets" className="grid grid-cols-2 gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={active === p.key ? 'subtle' : 'ghost'}
              aria-pressed={active === p.key}
              className={cn('justify-start', active === p.key && 'font-semibold text-primary-text')}
              onClick={() => {
                onChange({ range: p.key });
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={isCustom ? 'subtle' : 'ghost'}
            aria-pressed={isCustom}
            className={cn('justify-start', isCustom && 'font-semibold text-primary-text')}
            onClick={() => {
              if (!isCustom) onChange({ range: 'custom', from: addDaysYmd(todayYmd(), -6), to: todayYmd() });
            }}
          >
            Custom
          </Button>
        </div>
        {isCustom && (
          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <FormField label="From">
              <Input type="date" value={value.from ?? ''} max={value.to} onChange={(e) => isYmd(e.target.value) && onChange({ range: 'custom', from: e.target.value, to: value.to })} />
            </FormField>
            <FormField label="To">
              <Input type="date" value={value.to ?? ''} min={value.from} max={todayYmd()} onChange={(e) => isYmd(e.target.value) && onChange({ range: 'custom', from: value.from, to: e.target.value })} />
            </FormField>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------------------------
// Category chips
// ---------------------------------------------------------------------------------------------
export function CategoryChips({ value, onChange }: { value: AuditCategory | undefined; onChange: (c: AuditCategory | undefined) => void }) {
  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div role="group" aria-label="Category" className="flex flex-wrap items-center gap-1.5">
      <button type="button" aria-pressed={!value} onClick={() => onChange(undefined)} className={cn(chip, !value ? 'border-foreground/30 bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}>
        All categories
      </button>
      {AUDIT_CATEGORIES.map((c) => {
        const m = CATEGORY_META[c];
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? undefined : c)}
            className={cn(chip, on ? m.chipActive : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground')}
          >
            <span aria-hidden="true" className={cn('size-2 rounded-full', m.dot)} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Action + user comboboxes
// ---------------------------------------------------------------------------------------------
const compact = 'w-52 [&_[role=combobox]]:h-8 [&_[role=combobox]]:text-[13px]';

export function ActionFilter({ value, category, onChange }: { value: string | undefined; category: AuditCategory | undefined; onChange: (v: string | undefined) => void }) {
  const options = React.useMemo<ComboboxOption[]>(
    () =>
      Object.entries(AUDIT_ACTIONS)
        .filter(([, m]) => !category || m.category === category)
        .map(([key, m]) => ({ value: key, label: m.label, hint: key })),
    [category],
  );
  return (
    <div className={cn(compact, 'w-56', value && '[&_[role=combobox]]:border-primary/60 [&_[role=combobox]]:bg-primary-subtle')}>
      <Combobox
        aria-label="Action"
        options={options}
        value={value ?? null}
        onChange={(v) => onChange(v ?? undefined)}
        placeholder="Any action"
        searchPlaceholder="Search actions..."
        emptyText="No matching action."
        clearable
      />
    </div>
  );
}

export function UserFilter({ value, options, onChange, loading }: { value: string | undefined; options: ComboboxOption[]; onChange: (v: string | undefined) => void; loading?: boolean }) {
  const withSelected = React.useMemo(() => (value && !options.some((o) => o.value === value) ? [{ value, label: `User #${value}` }, ...options] : options), [options, value]);
  return (
    <div className={cn(compact, value && '[&_[role=combobox]]:border-primary/60 [&_[role=combobox]]:bg-primary-subtle')}>
      <Combobox
        aria-label="User"
        options={withSelected}
        value={value ?? null}
        onChange={(v) => onChange(v ?? undefined)}
        placeholder={loading ? 'Loading users...' : 'Any user'}
        searchPlaceholder="Search users..."
        emptyText="No matching user."
        clearable
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Table / timeline toggle
// ---------------------------------------------------------------------------------------------
export type AuditView = 'table' | 'timeline';

export function ViewToggle({ value, onChange }: { value: AuditView; onChange: (v: AuditView) => void }) {
  const item = (v: AuditView, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={value === v}
      onClick={() => onChange(v)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5',
        value === v ? 'bg-muted text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="View" className="flex items-center rounded-md border bg-card p-0.5 shadow-xs">
      {item('table', 'Table', <Table2 aria-hidden="true" />)}
      {item('timeline', 'Timeline', <Rows3 aria-hidden="true" />)}
    </div>
  );
}

/** Removable "key: value" chip for filters that have no control of their own (the subject). */
export function FilterChip({ label, value, onClear }: { label: string; value: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-primary/40 bg-primary-subtle pl-2.5 pr-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate font-medium text-primary-text">{value}</span>
      <button type="button" aria-label={`Remove ${label} filter`} onClick={onClear} className="grid size-5 shrink-0 place-content-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}
