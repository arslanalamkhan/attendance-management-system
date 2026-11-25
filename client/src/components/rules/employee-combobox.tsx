import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { getEmployee, listEmployees } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { controlBase } from '../ui/input';
import { useFieldProps } from '../ui/form-field-context';
import { EmployeeAvatar } from '../ui/employee-avatar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Skeleton } from '../ui/skeleton';

export interface EmployeeComboboxProps {
  /** Employee id, or null for "anyone". */
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  clearable?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/** Searchable single employee picker (server-side search by name or code) with photo avatars. */
export function EmployeeCombobox({ value, onChange, placeholder = 'Choose an employee...', clearable, invalid, id, className, 'aria-label': ariaLabel }: EmployeeComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const field = useFieldProps({ id, invalid });
  const [text, setText] = React.useState('');
  const q = useDebouncedValue(text.trim(), 250);

  const results = useQuery({
    queryKey: qk.employees.list({ q, pageSize: 25, status: 'active', page: 1 }),
    queryFn: ({ signal }) => listEmployees({ q: q || undefined, pageSize: 25, page: 1, status: 'active', sort: 'name', order: 'asc' }, signal),
    enabled: open,
    staleTime: 30_000,
  });
  // The chosen person, even when they are not in the current search results (e.g. opened from a link). The full
  // profile needs employees.view; report-only roles fall back to the row they picked from the list.
  const { can } = useAuth();
  const [picked, setPicked] = React.useState<{ id: number; name: string; empCode: string; hasPhoto: boolean } | null>(null);
  const chosen = useQuery({
    queryKey: qk.employees.detail(value ?? 0),
    queryFn: ({ signal }) => getEmployee(value as number, signal),
    enabled: value !== null && can('employees.view'),
    staleTime: 60_000,
  });
  const selected = value === null ? undefined : (chosen.data ?? (picked?.id === value ? picked : undefined));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setText('');
      }}
    >
      <div className={cn('relative', className)}>
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
            className={cn(controlBase, 'flex h-8 items-center gap-2 px-2.5 text-left text-[13px]', clearable && selected && 'pr-8')}
          >
            {selected ? (
              <>
                <EmployeeAvatar employee={{ id: selected.id, name: selected.name, hasPhoto: selected.hasPhoto }} size={20} />
                <span className="truncate font-medium">{selected.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{selected.empCode}</span>
              </>
            ) : value !== null && chosen.isPending ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
            {!(clearable && selected) && <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </button>
        </PopoverTrigger>
        {clearable && selected && (
          <button
            type="button"
            aria-label="Clear employee"
            onClick={() => onChange(null)}
            className="absolute inset-y-0 right-1.5 my-auto grid size-6 place-content-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <Command shouldFilter={false} loop>
          <CommandInput placeholder="Search by name or code..." value={text} onValueChange={setText} />
          <CommandList className="max-h-72">
            {results.isPending ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : results.isError ? (
              <p className="px-3 py-6 text-center text-[13px] text-danger-text">Could not search employees.</p>
            ) : (
              <>
                <CommandEmpty>No one matches &ldquo;{q}&rdquo;.</CommandEmpty>
                <CommandGroup>
                  {results.data.items.map((e) => (
                    <CommandItem
                      key={e.id}
                      value={String(e.id)}
                      onSelect={() => {
                        setPicked({ id: e.id, name: e.name, empCode: e.empCode, hasPhoto: e.hasPhoto });
                        onChange(e.id === value && clearable ? null : e.id);
                        setOpen(false);
                      }}
                      className="gap-2.5"
                    >
                      <EmployeeAvatar employee={{ id: e.id, name: e.name, hasPhoto: e.hasPhoto }} size="xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{e.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{[e.wingName, e.designation].filter(Boolean).join(' · ') || ' '}</span>
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{e.empCode}</span>
                      <Check className={cn('!text-primary-text', e.id === value ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                    </CommandItem>
                  ))}
                </CommandGroup>
                {results.data.total > results.data.items.length && (
                  <p className="px-3 py-2 text-center text-[11px] text-muted-foreground">Showing the first {results.data.items.length} of {results.data.total.toLocaleString()}: keep typing to narrow down.</p>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

