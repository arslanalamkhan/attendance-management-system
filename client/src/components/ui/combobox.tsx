import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { controlBase } from './input';
import { useFieldProps } from './form-field-context';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary text (e.g. an ID) shown muted at the right. */
  hint?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/** Searchable single-select built on cmdk + Popover. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  clearable = false,
  disabled,
  invalid,
  id,
  className,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const field = useFieldProps({ id, invalid });
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative w-full', className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            id={field.id}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={ariaLabel}
            aria-invalid={field['aria-invalid']}
            aria-describedby={field['aria-describedby']}
            disabled={disabled}
            className={cn(controlBase, 'flex h-9 items-center justify-between gap-2 px-3 text-left', clearable && selected && 'pr-14')}
          >
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {clearable && selected && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onChange(null)}
            className="absolute inset-y-0 right-8 my-auto grid size-6 place-content-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[12rem] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ''} ${o.value}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value === value && clearable ? null : o.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('!text-primary-text', o.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto pl-2 font-mono text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
