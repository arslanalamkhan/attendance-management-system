import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Employee } from '@nacta/shared';
import { listEmployees } from '../../lib/endpoints/employees';
import { errorMessage } from '../../lib/api';
import { qk } from '../../lib/query-keys';
import { ORG_UNIT } from '../../lib/terms';
import { cn } from '../../lib/utils';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useSectionsOf, useWings } from '../../hooks/use-lookups';
import { Button } from '../ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { DataTableFilterSelect } from '../data-table/toolbar';
import { EmployeeAvatar } from '../ui/employee-avatar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Skeleton } from '../ui/skeleton';

export interface PickedEmployee {
  id: number;
  name: string;
  empCode: string;
  hasPhoto: boolean;
  wingName: string | null;
}
export const pickEmployee = (e: Employee): PickedEmployee => ({ id: e.id, name: e.name, empCode: e.empCode, hasPhoto: e.hasPhoto, wingName: e.wingName });

export interface EmployeePickerProps {
  value: PickedEmployee[];
  onChange: (next: PickedEmployee[]) => void;
  invalid?: boolean;
  /** Pick exactly one person (hides the whole-wing helper). */
  single?: boolean;
}

/** Multi-select over the whole directory: server-side search by name or code, photo chips, and a "whole wing / section" helper. */
export function EmployeePicker({ value, onChange, invalid, single }: EmployeePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const q = useDebouncedValue(text.trim(), 250);
  const ids = React.useMemo(() => new Set(value.map((v) => v.id)), [value]);

  const results = useQuery({
    queryKey: qk.employees.list({ q, pageSize: 25, status: 'active', page: 1 }),
    queryFn: ({ signal }) => listEmployees({ q: q || undefined, pageSize: 25, page: 1, status: 'active', sort: 'name', order: 'asc' }, signal),
    enabled: open,
    staleTime: 30_000,
  });

  const toggle = (e: Employee) => {
    if (single) {
      onChange(ids.has(e.id) ? [] : [pickEmployee(e)]);
      setOpen(false);
      return;
    }
    onChange(ids.has(e.id) ? value.filter((v) => v.id !== e.id) : [...value, pickEmployee(e)]);
  };

  // whole wing / section helper
  const wings = useWings();
  const [wingId, setWingId] = React.useState<string | undefined>();
  const [sectionId, setSectionId] = React.useState<string | undefined>();
  const sections = useSectionsOf(wingId ? Number(wingId) : null);
  const groupQuery = { wingId: Number(wingId), sectionId: sectionId ? Number(sectionId) : undefined, status: 'active' as const, page: 1, pageSize: 500 };
  const groupCount = useQuery({
    queryKey: qk.employees.list({ ...groupQuery, pageSize: 1 }),
    queryFn: ({ signal }) => listEmployees({ ...groupQuery, pageSize: 1 }, signal),
    enabled: Boolean(wingId),
    staleTime: 30_000,
  });
  const [adding, setAdding] = React.useState(false);
  const addGroup = async () => {
    setAdding(true);
    try {
      const page = await listEmployees(groupQuery);
      const fresh = page.items.filter((e) => !ids.has(e.id)).map(pickEmployee);
      onChange([...value, ...fresh]);
      const where = sectionId ? sections.find((s) => String(s.id) === sectionId)?.name : wings.data?.find((w) => String(w.id) === wingId)?.name;
      toast.success(fresh.length ? `Added ${fresh.length} ${fresh.length === 1 ? 'person' : 'people'} from ${where}` : `Everyone in ${where} is already selected`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not load that group'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className={cn('rounded-lg border bg-card', invalid && 'border-danger')}>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-[13px] text-muted-foreground" aria-live="polite">
            {value.length === 0 ? 'No one selected yet' : `${value.length.toLocaleString()} ${value.length === 1 ? 'person' : 'people'} selected`}
          </p>
          <div className="flex items-center gap-1">
            {value.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
                Clear
              </Button>
            )}
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="secondary" size="sm" aria-haspopup="listbox">
                  <Plus aria-hidden="true" />
                  Add people
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[22rem] p-0">
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
                            <CommandItem key={e.id} value={String(e.id)} onSelect={() => toggle(e)} className="gap-2.5">
                              <EmployeeAvatar employee={{ id: e.id, name: e.name, hasPhoto: e.hasPhoto }} size="xs" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px]">{e.name}</span>
                                <span className="block truncate text-[11px] text-muted-foreground">{[e.wingName, e.designation].filter(Boolean).join(' · ') || ' '}</span>
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">{e.empCode}</span>
                              <Check className={cn('!text-primary-text', ids.has(e.id) ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
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
          </div>
        </div>

        {value.length === 0 ? (
          <div className="flex items-center gap-3 px-3 py-5 text-[13px] text-muted-foreground">
            <Users className="size-4" aria-hidden="true" />
            Search for people, or add a whole {ORG_UNIT.lower} below.
          </div>
        ) : (
          <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto p-2.5" aria-label="Selected employees">
            {value.map((p) => (
              <li key={p.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pl-0.5 pr-1.5 text-xs">
                <EmployeeAvatar employee={{ id: p.id, name: p.name, hasPhoto: p.hasPhoto }} size={20} />
                <span className="truncate font-medium">{p.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{p.empCode}</span>
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => onChange(value.filter((v) => v.id !== p.id))}
                  className="grid size-4 place-content-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!single && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border-strong bg-muted/30 p-2.5">
        <span className="text-xs font-medium text-muted-foreground">Whole {ORG_UNIT.lower} or section</span>
        <DataTableFilterSelect
          label={ORG_UNIT.singular}
          value={wingId}
          onChange={(v) => {
            setWingId(v);
            setSectionId(undefined);
          }}
          options={(wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
          allLabel="Choose..."
        />
        {wingId && sections.length > 0 && (
          <DataTableFilterSelect label="Section" value={sectionId} onChange={setSectionId} options={sections.map((s) => ({ value: String(s.id), label: s.name }))} allLabel="All sections" />
        )}
        <Button type="button" size="sm" variant="secondary" disabled={!wingId || groupCount.data?.total === 0} loading={adding} onClick={() => void addGroup()} className="ml-auto">
          {wingId && groupCount.data ? `Add ${groupCount.data.total.toLocaleString()} ${groupCount.data.total === 1 ? 'person' : 'people'}` : 'Add everyone'}
        </Button>
      </div>
      )}
    </div>
  );
}
