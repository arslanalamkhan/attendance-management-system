import * as React from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import type { z } from 'zod';
import { ErrorCode, zSectionInput, zWingInput } from '@nacta/shared';
import type { Section, Wing, WingInput } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { createSection, createWing, deleteSection, updateSection, updateWing } from '../../lib/endpoints/wings';
import { qk } from '../../lib/query-keys';
import { useWings } from '../../hooks/use-lookups';
import { useAuth } from '../../lib/auth';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

type FormOut = z.output<typeof zWingInput>;
const INVALIDATE = [qk.wings.all, qk.employees.all];
const people = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`;

export interface WingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create. */
  wing: Wing | null;
  /** Called after a create so the caller can reopen the sheet on the new wing (to add sections). */
  onCreated?: (wing: Wing) => void;
}

export function WingSheet({ open, onOpenChange, wing, onCreated }: WingSheetProps) {
  // Keep the last wing while the close animation plays.
  const last = React.useRef<Wing | null>(null);
  if (wing) last.current = wing;
  const shown = wing ?? (open ? null : last.current);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-lg sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{shown ? `Edit ${shown.name}` : 'Add wing'}</SheetTitle>
          <SheetDescription>
            {shown ? 'Rename the wing, set its head and manage its sections.' : 'Create the wing first, then add its sections.'}
          </SheetDescription>
        </SheetHeader>
        <WingForm key={shown?.id ?? 'new'} wing={shown} onClose={() => onOpenChange(false)} onCreated={onCreated} />
      </SheetContent>
    </Sheet>
  );
}

function WingForm({ wing, onClose, onCreated }: { wing: Wing | null; onClose: () => void; onCreated?: (w: Wing) => void }) {
  const { can } = useAuth();
  const canEdit = can('wings.manage');
  const editing = wing !== null;
  const form = useForm<WingInput, unknown, FormOut>({
    resolver: zodResolver(zWingInput),
    defaultValues: { name: wing?.name ?? '', code: wing?.code ?? '', headName: wing?.headName ?? '' },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState } = form;

  const save = useApiMutation<Wing, FormOut, WingInput>({
    form,
    mutationFn: (v) => (wing ? updateWing(wing.id, v) : createWing(v)),
    invalidate: INVALIDATE,
    successMessage: (w) => (editing ? `Saved ${w.name}` : `Added ${w.name}. You can now add its sections.`),
    onError: (err) => {
      if (err.code === ErrorCode.DUPLICATE_WING) {
        const msg = /code/i.test(err.message) ? { field: 'code' as const } : { field: 'name' as const };
        form.setError(msg.field, { type: 'server', message: err.message }, { shouldFocus: true });
      }
    },
    onSuccess: (w) => {
      if (!editing) onCreated?.(w);
      else onClose();
    },
  });

  return (
    <>
      <form id="wing-form" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-8">
          <section aria-label="Details" className="space-y-4">
            <FormField label="Name" required error={formState.errors.name}>
              <Input autoComplete="off" placeholder="Operations Wing" disabled={!canEdit} {...register('name')} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Code" error={formState.errors.code} hint="Short code for reports and Excel, e.g. OPS.">
                <Input mono autoComplete="off" placeholder="OPS" maxLength={12} className="uppercase" disabled={!canEdit} {...register('code')} />
              </FormField>
              <FormField label="Head of wing" error={formState.errors.headName} hint="Free text: the focal person.">
                <Input autoComplete="off" placeholder="Name of the head" disabled={!canEdit} {...register('headName')} />
              </FormField>
            </div>
          </section>

          {wing ? (
            <SectionsEditor wing={wing} canEdit={canEdit} />
          ) : (
            <p className="rounded-lg border border-dashed border-border-strong bg-muted/40 px-3 py-3 text-[13px] text-muted-foreground">
              Sections (for example “Records” or “Field Unit”) can be added as soon as the wing is saved.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
            {editing ? 'Close' : 'Cancel'}
          </Button>
          {canEdit && (
            <Button type="submit" loading={save.isPending}>
              {editing ? 'Save changes' : 'Add wing'}
            </Button>
          )}
        </SheetFooter>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SectionsEditor({ wing, canEdit }: { wing: Wing; canEdit: boolean }) {
  // Read live so adds / renames / deletes show up without reopening the sheet.
  const wings = useWings();
  const live = wings.data?.find((w) => w.id === wing.id) ?? wing;
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<Section | null>(null);
  const lastDeleted = React.useRef<Section | null>(null);
  if (toDelete) lastDeleted.current = toDelete;

  const add = useApiMutation<Section, string>({
    mutationFn: (n) => createSection(wing.id, { name: n }),
    invalidate: INVALIDATE,
    toastErrors: false,
    successMessage: (s) => `Added section ${s.name}`,
    onSuccess: () => setName(''),
    onError: (e) => setError(e.fieldErrors.name ?? e.message),
  });
  const remove = useApiMutation<void, number>({
    mutationFn: (id) => deleteSection(id),
    invalidate: INVALIDATE,
    successMessage: 'Section deleted',
    onSuccess: () => setToDelete(null),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = zSectionInput.safeParse({ name });
    if (!r.success) return setError(r.error.issues[0]?.message ?? 'Enter a name');
    setError(null);
    add.mutate(r.data.name);
  };

  return (
    <section aria-label="Sections" className="space-y-3">
      <div className="flex items-end justify-between border-b pb-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{live.sections.length === 0 ? 'None yet.' : `${live.sections.length} in this wing.`}</p>
        </div>
      </div>

      {canEdit && (
        // Not a nested <form>: the sheet's form wraps this. A div with Enter handling keeps the DOM valid.
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              aria-label="New section name"
              placeholder="New section name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit(e);
              }}
              invalid={Boolean(error)}
              autoComplete="off"
            />
            {error && (
              <p role="alert" className="mt-1.5 text-xs font-medium text-danger-text">
                {error}
              </p>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={submit} loading={add.isPending} disabled={!name.trim()}>
            {!add.isPending && <Plus aria-hidden="true" />}
            Add
          </Button>
        </div>
      )}

      {live.sections.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card">
          {live.sections.map((s) => (
            <SectionRow key={s.id} section={s} canEdit={canEdit} onDelete={() => setToDelete(s)} />
          ))}
        </ul>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && !remove.isPending && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section “{(toDelete ?? lastDeleted.current)?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {(toDelete ?? lastDeleted.current)?.employeeCount
                ? `${people((toDelete ?? lastDeleted.current)!.employeeCount)} will keep their record but lose this section. They stay in ${wing.name}.`
                : 'No one is in this section. Nothing else changes.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending ? 'Deleting...' : 'Delete section'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SectionRow({ section, canEdit, onDelete }: { section: Section; canEdit: boolean; onDelete: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(section.name);
  const [error, setError] = React.useState<string | null>(null);

  const rename = useApiMutation<Section, string>({
    mutationFn: (n) => updateSection(section.id, { name: n }),
    invalidate: INVALIDATE,
    toastErrors: false,
    successMessage: 'Section renamed',
    onSuccess: () => setEditing(false),
    onError: (e) => setError(e.code === ErrorCode.DUPLICATE_SECTION || e.isValidation ? (e.fieldErrors.name ?? e.message) : e.message),
  });

  const commit = () => {
    const r = zSectionInput.safeParse({ name });
    if (!r.success) return setError(r.error.issues[0]?.message ?? 'Enter a name');
    if (r.data.name === section.name) return setEditing(false);
    setError(null);
    rename.mutate(r.data.name);
  };

  if (editing) {
    return (
      <li className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            aria-label={`Rename section ${section.name}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
                setName(section.name);
                setError(null);
              }
            }}
            invalid={Boolean(error)}
            autoComplete="off"
          />
          <IconButton label="Save name" icon={<Check />} size="icon-sm" onClick={commit} disabled={rename.isPending} />
          <IconButton
            label="Cancel rename"
            icon={<X />}
            size="icon-sm"
            onClick={() => {
              setEditing(false);
              setName(section.name);
              setError(null);
            }}
          />
        </div>
        {error && (
          <p role="alert" className="mt-1.5 text-xs font-medium text-danger-text">
            {error}
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{section.name}</span>
      <Link
        to={`/employees?wingId=${section.wingId}&sectionId=${section.id}`}
        className="inline-flex items-center gap-1 rounded-sm text-xs tabular-nums text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="View these employees"
      >
        <Users className="size-3.5" aria-hidden="true" />
        {section.employeeCount.toLocaleString()}
      </Link>
      {canEdit && (
        <>
          <IconButton label={`Rename ${section.name}`} icon={<Pencil />} size="icon-sm" onClick={() => setEditing(true)} />
          <IconButton label={`Delete ${section.name}`} icon={<Trash2 />} size="icon-sm" onClick={onDelete} />
        </>
      )}
    </li>
  );
}
