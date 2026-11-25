import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { controlBase } from './input';
import { useFieldProps } from './form-field-context';
import type { ComboboxOption } from './combobox';

export interface MultiComboboxProps {
  options: ComboboxOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/** Searchable multi-select: selected options render as removable chips inside the trigger. */
export function MultiCombobox({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  disabled,
  invalid,
  id,
  className,
  'aria-label': ariaLabel,
}: MultiComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const field = useFieldProps({ id, invalid });
  const selected = value.map((v) => options.find((o) => o.value === v)).filter((o): o is ComboboxOption => Boolean(o));

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('w-full', className)}>
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
            className={cn(controlBase, 'flex min-h-9 items-center justify-between gap-2 px-2 py-1 text-left')}
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {selected.length === 0 && <span className="px-1 text-muted-foreground">{placeholder}</span>}
              {selected.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary-subtle py-0.5 pl-2 pr-1 text-xs font-medium text-primary-text"
                >
                  <span className="truncate">{o.label}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${o.label}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!disabled) toggle(o.value);
                    }}
                    className="grid size-4 place-content-center rounded-sm hover:bg-primary/15"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </span>
                </span>
              ))}
            </span>
            <ChevronsUpDown className="mr-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[14rem] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = value.includes(o.value);
                return (
                  <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ''} ${o.value}`} disabled={o.disabled} onSelect={() => toggle(o.value)}>
                    <Check className={cn('!text-primary-text', on ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto pl-2 text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
