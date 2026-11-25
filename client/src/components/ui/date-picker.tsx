import * as React from 'react';
import { CalendarDays } from 'lucide-react';
import { formatDate } from '../../lib/dates';
import { cn } from '../../lib/utils';
import { Calendar, type DayMark } from './calendar';
import { controlBase } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { useFieldProps } from './form-field-context';

export interface DatePickerProps {
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  markFor?: (ymd: string) => DayMark;
  isDisabled?: (ymd: string) => boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/** Single-date popover picker that matches the other form controls. */
export function DatePicker({ value, onChange, placeholder = 'Pick a date', markFor, isDisabled, disabled, invalid, id, className, 'aria-label': ariaLabel }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const field = useFieldProps({ id, invalid });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={field.id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={field['aria-invalid']}
          aria-describedby={field['aria-describedby']}
          className={cn(controlBase, 'flex h-9 items-center gap-2 px-3 text-left', className)}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value ? formatDate(value) : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <Calendar
          mode="single"
          value={value}
          markFor={markFor}
          isDisabled={isDisabled}
          onChange={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
