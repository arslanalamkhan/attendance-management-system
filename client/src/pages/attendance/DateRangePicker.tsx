import * as React from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { addDaysYmd, formatDate, isYmd, rangeForPreset, todayYmd, type RangePreset } from '../../lib/dates';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

export interface DateRange {
  from?: string;
  to?: string;
}

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

/** Which preset (if any) the range equals. */
export function presetOf(range: DateRange, today: string = todayYmd()): RangePreset | null {
  if (!range.from || !range.to) return null;
  for (const p of PRESETS) {
    const r = rangeForPreset(p.key, today);
    if (r.from === range.from && r.to === range.to) return p.key;
  }
  return null;
}

/** True when the range reaches today (so live refresh makes sense). */
export function rangeIncludesToday(range: DateRange, today: string = todayYmd()): boolean {
  if (range.from && range.from > today) return false;
  return !range.to || range.to >= today;
}

function labelOf(range: DateRange): string {
  if (!range.from && !range.to) return 'All dates';
  const preset = presetOf(range);
  if (preset) return PRESETS.find((p) => p.key === preset)?.label ?? '';
  if (range.from && range.to) return range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} - ${formatDate(range.to)}`;
  return range.from ? `From ${formatDate(range.from)}` : `Until ${formatDate(range.to)}`;
}

export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = React.useState(false);
  const [customOpen, setCustomOpen] = React.useState(false);
  const presetMatch = presetOf(value);
  const active = customOpen ? null : presetMatch;
  const isCustom = !presetMatch && Boolean(value.from || value.to);
  const showCustom = customOpen || isCustom;
  const hasRange = Boolean(value.from || value.to);

  const apply = (patch: DateRange) => {
    const next = { ...value, ...patch };
    // keep from <= to
    if (next.from && next.to && next.from > next.to) {
      if (patch.from) next.to = next.from;
      else next.from = next.to;
    }
    onChange(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCustomOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Date range: ${labelOf(value)}`}
          className={cn('justify-between gap-2 px-2.5', hasRange && 'border-primary/60 bg-primary-subtle')}
        >
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          <span className="text-muted-foreground">Date:</span>
          <span className="max-w-[16rem] truncate">{labelOf(value)}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div role="group" aria-label="Range presets" className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={active === p.key ? 'subtle' : 'ghost'}
              aria-pressed={active === p.key}
              className={cn('justify-start', active === p.key && 'font-semibold text-primary-text')}
              onClick={() => {
                onChange(rangeForPreset(p.key));
                setCustomOpen(false);
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={showCustom ? 'subtle' : 'ghost'}
            aria-pressed={showCustom}
            className={cn('justify-start', showCustom && 'font-semibold text-primary-text')}
            onClick={() => {
              setCustomOpen(true);
              if (!value.from && !value.to) onChange({ from: addDaysYmd(todayYmd(), -6), to: todayYmd() });
            }}
          >
            Custom
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            disabled={!hasRange}
            onClick={() => {
              onChange({});
              setCustomOpen(false);
              setOpen(false);
            }}
          >
            All dates
          </Button>
        </div>
        {showCustom && (
          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <FormField label="From">
              <Input type="date" value={value.from ?? ''} max={value.to} onChange={(e) => isYmd(e.target.value) && apply({ from: e.target.value })} />
            </FormField>
            <FormField label="To">
              <Input type="date" value={value.to ?? ''} min={value.from} onChange={(e) => isYmd(e.target.value) && apply({ to: e.target.value })} />
            </FormField>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

