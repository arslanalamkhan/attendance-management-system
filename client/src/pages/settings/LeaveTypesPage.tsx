import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Pencil, Plus, Tags } from 'lucide-react';
import type { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { ErrorCode, zLeaveTypeInput } from '@nacta/shared';
import type { LeaveType, LeaveTypeInput } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { createLeaveType, updateLeaveType } from '../../lib/endpoints/rules';
import { qk } from '../../lib/query-keys';
import { cn } from '../../lib/utils';
import { useLeaveTypes } from '../../hooks/use-rules';
import { usePageMeta } from '../../hooks/use-page-meta';
import { Gate } from '../../components/auth/gate';
import { DataTable } from '../../components/data-table/data-table';
import type { DataTablePagingState } from '../../components/data-table/use-data-table-state';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Switch } from '../../components/ui/switch';
import { EmptyState } from '../../components/ui/empty-state';
import { LeaveDot, LeavePill } from '../../components/rules/pills';

/** Preset colours (picked to stay distinguishable in both themes). The hex box accepts anything else. */
const SWATCHES = ['#2563EB', '#7C3AED', '#DB2777', '#D97706', '#0D9488', '#EA580C', '#64748B', '#16A34A', '#0891B2', '#DC2626', '#9333EA', '#4F46E5'];
type FormOut = z.output<typeof zLeaveTypeInput>;

const NO_PAGING: DataTablePagingState = { page: 1, pageSize: 100, sorting: [], setPage: () => undefined, setPageSize: () => undefined, setSorting: () => undefined, hasFilters: false, resetFilters: () => undefined };

export default function LeaveTypesPage() {
  usePageMeta({ title: 'Leave types', entityType: 'leave_type' });
  const { can } = useAuth();
  const canEdit = can('leave.configure');
  const types = useLeaveTypes();
  const [editing, setEditing] = React.useState<LeaveType | 'new' | null>(null);
  const last = React.useRef<LeaveType | 'new' | null>(null);
  if (editing) last.current = editing;

  const toggle = useApiMutation<LeaveType, LeaveType>({
    mutationFn: (t) => updateLeaveType(t.id, { name: t.name, code: t.code, color: t.color, countsAsPresent: t.countsAsPresent, isActive: !t.isActive }),
    invalidate: [qk.leaveTypes.all],
    successMessage: (t) => `${t.name} is now ${t.isActive ? 'active' : 'inactive'}`,
  });

  const columns = React.useMemo<ColumnDef<LeaveType>[]>(
    () => [
      {
        id: 'color',
        header: () => <span className="sr-only">Colour</span>,
        meta: { label: 'Colour', className: 'w-12' },
        cell: ({ row }) => <span aria-label={`Colour ${row.original.color}`} className="block size-6 rounded-md ring-1 ring-inset ring-black/10" style={{ backgroundColor: row.original.color }} />,
      },
      { id: 'code', header: 'Code', meta: { label: 'Code' }, cell: ({ row }) => <LeavePill code={row.original.code} name={row.original.name} color={row.original.color} short /> },
      { id: 'name', header: 'Name', meta: { label: 'Name', className: 'min-w-[12rem]' }, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      {
        id: 'countsAsPresent',
        header: 'Counts as present',
        meta: { label: 'Counts as present' },
        cell: ({ row }) => (row.original.countsAsPresent ? <Badge tone="success">Yes, duty</Badge> : <span className="text-muted-foreground">No</span>),
      },
      {
        id: 'usageCount',
        header: 'Used',
        meta: { label: 'Usage', align: 'right' },
        cell: ({ row }) => <span className="font-mono text-[13px] tabular-nums">{row.original.usageCount.toLocaleString()}</span>,
      },
      {
        id: 'isActive',
        header: 'Active',
        meta: { label: 'Active' },
        cell: ({ row }) => (
          <Switch
            aria-label={`${row.original.name} is ${row.original.isActive ? 'active' : 'inactive'}`}
            checked={row.original.isActive}
            disabled={!canEdit || (toggle.isPending && toggle.variables?.id === row.original.id)}
            onCheckedChange={() => toggle.mutate(row.original)}
          />
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableHiding: false,
        meta: { label: 'Actions', className: 'w-12' },
        cell: ({ row }) => (canEdit ? <IconButton label={`Edit ${row.original.name}`} icon={<Pencil />} size="icon-sm" onClick={() => setEditing(row.original)} /> : null),
      },
    ],
    [canEdit, toggle],
  );

  const rows = types.data ?? [];
  return (
    <>
      <PageHeader
        title="Leave types"
        description="The kinds of leave people can be marked on. The colour you choose is used everywhere leave appears."
        actions={
          <Gate perm="leave.configure" action="manage leave types">
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              Add leave type
            </Button>
          </Gate>
        }
      />
      <DataTable<LeaveType>
        id="leave-types"
        caption="Leave types"
        columns={columns}
        data={rows}
        total={rows.length}
        state={NO_PAGING}
        getRowId={(r) => String(r.id)}
        loading={types.isPending}
        fetching={types.isFetching}
        error={types.error}
        onRetry={() => void types.refetch()}
        noun={{ singular: 'leave type', plural: 'leave types' }}
        pageSizeOptions={[100]}
        maxHeight="none"
        emptyState={
          <EmptyState bare icon={<Tags />} title="No leave types yet" description="Add types such as Casual, Earned, Medical or Official duty." action={canEdit ? <Button onClick={() => setEditing('new')}>Add leave type</Button> : undefined} />
        }
      />
      <LeaveTypeSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} type={editing === 'new' ? null : (editing ?? (last.current === 'new' ? null : last.current))} />
    </>
  );
}

function LeaveTypeSheet({ open, onOpenChange, type }: { open: boolean; onOpenChange: (o: boolean) => void; type: LeaveType | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-md sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{type ? `Edit ${type.name}` : 'Add leave type'}</SheetTitle>
          <SheetDescription>{type ? 'Changes apply to existing leave of this type too.' : 'Choose a short code and a colour people will recognise.'}</SheetDescription>
        </SheetHeader>
        {open && <LeaveTypeForm key={type?.id ?? 'new'} type={type} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function LeaveTypeForm({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const form = useForm<LeaveTypeInput, unknown, FormOut>({
    resolver: zodResolver(zLeaveTypeInput),
    defaultValues: { name: type?.name ?? '', code: type?.code ?? '', color: type?.color ?? SWATCHES[0], countsAsPresent: type?.countsAsPresent ?? false, isActive: type?.isActive ?? true },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, control, watch } = form;
  const color = watch('color');
  const code = watch('code');
  const name = watch('name');

  const save = useApiMutation<LeaveType, FormOut, LeaveTypeInput>({
    form,
    mutationFn: (v) => (type ? updateLeaveType(type.id, v) : createLeaveType(v)),
    invalidate: [qk.leaveTypes.all, qk.leaves.all, qk.daily.all],
    successMessage: (t) => (type ? `Saved ${t.name}` : `Added ${t.name}`),
    onError: (e) => {
      if (e.code === ErrorCode.DUPLICATE_LEAVE_TYPE) form.setError('code', { type: 'server', message: e.message }, { shouldFocus: true });
    },
    onSuccess: onClose,
  });

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <div className="rounded-lg border bg-muted/30 p-3.5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
          <LeavePill code={code || 'CL'} name={name || 'Casual leave'} color={/^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#64748B'} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <FormField label="Name" required error={formState.errors.name}>
            <Input autoComplete="off" placeholder="Casual leave" {...register('name')} />
          </FormField>
          <FormField label="Code" required error={formState.errors.code}>
            <Input mono autoComplete="off" placeholder="CL" maxLength={6} className="uppercase" {...register('code')} />
          </FormField>
        </div>

        <Controller
          control={control}
          name="color"
          render={({ field }) => (
            <FormField label="Colour" required error={formState.errors.color} hint="Pick a preset or type any hex colour.">
              <div className="space-y-3">
                <div role="radiogroup" aria-label="Preset colours" className="flex flex-wrap gap-2">
                  {SWATCHES.map((s) => {
                    const on = field.value.toLowerCase() === s.toLowerCase();
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={s}
                        onClick={() => field.onChange(s)}
                        style={{ backgroundColor: s }}
                        className={cn('grid size-8 place-content-center rounded-full text-white transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background', on ? 'scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'hover:scale-105')}
                      >
                        {on && <Check className="size-4" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <LeaveDot color={/^#[0-9A-Fa-f]{6}$/.test(field.value) ? field.value : '#94a3b8'} className="size-5" />
                  <Input mono value={field.value} onChange={(e) => field.onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)} maxLength={7} className="w-32 uppercase" aria-label="Hex colour" />
                </div>
              </div>
            </FormField>
          )}
        />

        <div className="space-y-3 rounded-lg border p-3.5">
          <Controller
            control={control}
            name="countsAsPresent"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Counts as present</p>
                  <p className="text-xs text-muted-foreground">For official duty or tours: the person is treated as present in summaries.</p>
                </div>
                <Switch aria-label="Counts as present" checked={field.value ?? false} onCheckedChange={field.onChange} />
              </div>
            )}
          />
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4 border-t pt-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Inactive types cannot be chosen for new leave; existing leave keeps its type.</p>
                </div>
                <Switch aria-label="Active" checked={field.value ?? true} onCheckedChange={field.onChange} />
              </div>
            )}
          />
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {type ? 'Save changes' : 'Add leave type'}
        </Button>
      </SheetFooter>
    </form>
  );
}
