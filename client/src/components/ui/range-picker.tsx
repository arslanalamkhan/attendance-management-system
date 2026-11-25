import * as React from 'react';
import { ArrowRight, CalendarRange } from 'lucide-react';
import { formatDate } from '../../lib/dates';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Calendar, type CalendarRange as Range, type DayMark } from './calendar';
import { controlBase } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { useFieldProps } from './form-field-context';

export interface RangePreset {
  label: string;
  range: () => { from: string; to: string };
}

export interface RangePickerProps {
  value: { from: string | null; to: string | null };
  onChange: (value: { from: string; to: string }) => void;
  presets?: RangePreset[];
  markFor?: (ymd: string) => DayMark;
  isDisabled?: (ymd: string) => boolean;
  invalid?: boolean;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/** From-to picker: two-month calendar, click the first and last day, with optional quick presets. */
export function RangePicker({ value, onChange, presets, markFor, isDisabled, invalid, id, disabled, 'aria-label': ariaLabel }: RangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Range>({ from: null, to: null });
  const field = useFieldProps({ id, invalid });

  const label = value.from && value.to ? (value.from === value.to ? formatDate(value.from) : null) : null;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft({ from: value.from, to: value.to });
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={field.id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={field['aria-invalid']}
          aria-describedby={field['aria-describedby']}
          className={cn(controlBase, 'flex h-9 items-center gap-2 px-3 text-left')}
        >
          <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {value.from && value.to ? (
            label ? (
              <span>{label}</span>
            ) : (
              <span className="flex min-w-0 items-center gap-2 truncate">
                {formatDate(value.from)}
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {formatDate(value.to)}
              </span>
            )
          ) : (
            <span className="text-muted-foreground">Pick from and to dates</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1.5rem)] p-0">
        <div className="flex max-w-full flex-col sm:flex-row">
          {presets && presets.length > 0 && (
            <div role="group" aria-label="Quick ranges" className="flex gap-1 overflow-x-auto border-b p-2 sm:w-40 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
              {presets.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => {
                    onChange(p.range());
                    setOpen(false);
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
          <div className="max-w-full overflow-x-auto p-3">
            <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
              {draft.from && !draft.to ? `From ${formatDate(draft.from)}: now click the last day` : 'Click the first day, then the last day'}
            </p>
            <Calendar
              mode="range"
              months={2}
              value={draft}
              defaultMonth={value.from ?? undefined}
              markFor={markFor}
              isDisabled={isDisabled}
              onChange={(r) => {
                setDraft(r);
                if (r.from && r.to) {
                  onChange({ from: r.from, to: r.to });
                  setOpen(false);
                }
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
