import * as React from 'react';
import { Link } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, Info, UserPlus } from 'lucide-react';
import type { z } from 'zod';
import { ErrorCode, zUserCreateInput } from '@nacta/shared';
import type { AppUser, UserCreateInput } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { createUser } from '../../../lib/endpoints/users';
import { qk } from '../../../lib/query-keys';
import { generateStrongPassword } from '../../../lib/password';
import { useRoles } from '../../../hooks/use-lookups';
import { GeneratedPasswordField, useCopy } from '../../../components/auth/generated-password';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { MultiCombobox } from '../../../components/ui/multi-combobox';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../../components/ui/sheet';

type FormOut = z.output<typeof zUserCreateInput>;

export function UserCreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [created, setCreated] = React.useState<{ user: AppUser; password: string } | null>(null);
  const [round, setRound] = React.useState(0);
  const handleOpenChange = (o: boolean) => {
    onOpenChange(o);
    if (!o) window.setTimeout(() => setCreated(null), 200);
  };
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="max-w-lg sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{created ? 'User created' : 'Create user'}</SheetTitle>
          <SheetDescription>
            {created ? 'Hand the sign-in details to the user. They must choose their own password at first sign-in.' : 'Add an application user and give them one or more roles.'}
          </SheetDescription>
        </SheetHeader>
        {created ? (
          <CreatedView
            created={created}
            onDone={() => handleOpenChange(false)}
            onAnother={() => {
              setCreated(null);
              setRound((n) => n + 1);
            }}
          />
        ) : (
          <CreateForm key={round} onCreated={(user, password) => setCreated({ user, password })} onCancel={() => handleOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateForm({ onCreated, onCancel }: { onCreated: (u: AppUser, password: string) => void; onCancel: () => void }) {
  const roles = useRoles();
  const form = useForm<UserCreateInput, unknown, FormOut>({
    resolver: zodResolver(zUserCreateInput),
    defaultValues: { name: '', email: '', roleIds: [], temporaryPassword: '' },
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, setValue } = form;

  // Pre-fill a generated password so the admin only has to copy it.
  React.useEffect(() => {
    setValue('temporaryPassword', generateStrongPassword());
  }, [setValue]);

  const save = useApiMutation<AppUser, FormOut, UserCreateInput>({
    form,
    mutationFn: createUser,
    invalidate: [qk.users.all, qk.roles.all],
    successMessage: (u) => `Created ${u.name}`,
    errorMessage: 'Could not create the user',
    onError: (err) => {
      if (err.code === ErrorCode.DUPLICATE_EMAIL) form.setError('email', { type: 'server', message: 'A user with this email already exists' }, { shouldFocus: true });
    },
    onSuccess: (user, vars) => onCreated(user, vars.temporaryPassword),
  });

  const options = (roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name, hint: r.isSystem ? 'Reserved' : `${r.permissions.length} permissions`, disabled: r.isSystem }));

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <FormField label="Full name" required error={formState.errors.name}>
          <Input autoComplete="off" placeholder="Ayesha Khan" autoFocus {...register('name')} />
        </FormField>
        <FormField label="Email address" required error={formState.errors.email} hint="They sign in with this address.">
          <Input type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="name@nacta.gov.pk" {...register('email')} />
        </FormField>
        <FormField
          label="Roles"
          required
          error={formState.errors.roleIds as { message?: string } | undefined}
          hint={
            roles.isSuccess && options.length === 0 ? (
              <span>
                No roles exist yet.{' '}
                <Link to="/admin/roles/new" className="font-medium text-primary-text underline-offset-4 hover:underline">
                  Create a role
                </Link>{' '}
                first.
              </span>
            ) : (
              'Permissions are the union of all assigned roles.'
            )
          }
        >
          <Controller
            control={control}
            name="roleIds"
            render={({ field }) => (
              <MultiCombobox
                options={options}
                value={(field.value ?? []).map(String)}
                onChange={(v) => field.onChange(v.map(Number))}
                placeholder={roles.isPending ? 'Loading roles...' : 'Choose roles'}
                searchPlaceholder="Search roles..."
                emptyText="No matching role."
                disabled={roles.isPending}
              />
            )}
          />
        </FormField>
        <FormField label="Temporary password" required error={formState.errors.temporaryPassword}>
          <Controller
            control={control}
            name="temporaryPassword"
            render={({ field }) => <GeneratedPasswordField ref={field.ref} value={field.value ?? ''} onValueChange={field.onChange} onBlur={field.onBlur} />}
          />
        </FormField>
        <div className="flex gap-3 rounded-lg border border-info/30 bg-info-subtle p-3 text-[13px] text-info-text">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>The user must change this password the first time they sign in. Copy it now: it is not shown again after you leave this screen.</p>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {!save.isPending && <UserPlus aria-hidden="true" />}
          Create user
        </Button>
      </SheetFooter>
    </form>
  );
}

function CreatedView({ created, onDone, onAnother }: { created: { user: AppUser; password: string }; onDone: () => void; onAnother: () => void }) {
  const { copied, copy } = useCopy();
  const text = `Email: ${created.user.email}\nTemporary password: ${created.password}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
              <dd className="break-all font-medium">{created.user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Temporary password</dt>
              <dd className="select-all break-all font-mono text-base font-medium tracking-wide">{created.password}</dd>
            </div>
          </dl>
          <Button variant="secondary" size="sm" onClick={() => void copy(text, 'Sign-in details')}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy sign-in details'}
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">Roles: {created.user.roles.map((r) => r.name).join(', ')}. The password cannot be shown again; use Reset password if it is lost.</p>
      </SheetBody>
      <SheetFooter>
        <Button variant="secondary" onClick={onAnother}>
          Create another
        </Button>
        <Button onClick={onDone}>Done</Button>
      </SheetFooter>
    </div>
  );
}

