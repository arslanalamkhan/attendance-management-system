import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, LockKeyholeOpen, LogOut, Trash2, UserCheck, UserX, Info, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import type { AppUser } from '@nacta/shared';
import { zUserStatus } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { ActivityFeed } from '../../../components/audit/activity-feed';
import { updateUser } from '../../../lib/endpoints/users';
import { qk } from '../../../lib/query-keys';
import { useRoles } from '../../../hooks/use-lookups';
import { Avatar } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { MultiCombobox } from '../../../components/ui/multi-combobox';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import { RelativeTime } from '../../devices/parts';
import { UserStatusPill } from './user-parts';
import { statusOf, useSetUserStatus, useUnlockUser, type UserConfirm } from './user-actions';

const zForm = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  roleIds: z.array(z.number().int().positive()).min(1, 'Assign at least one role'),
  status: zUserStatus.optional(),
});
type FormValues = z.input<typeof zForm>;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export interface UserDetailSheetProps {
  user: AppUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The signed-in user (cannot disable or delete themselves). */
  selfId: number;
  onConfirm: (c: NonNullable<UserConfirm>) => void;
}

export function UserDetailSheet({ user, open, onOpenChange, selfId, onConfirm }: UserDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-lg sm:max-w-lg">
        {user ? (
          <Detail key={user.id} user={user} selfId={selfId} onConfirm={onConfirm} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>User</SheetTitle>
              <SheetDescription>Loading user details.</SheetDescription>
            </SheetHeader>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ user, selfId, onConfirm, onClose }: { user: AppUser; selfId: number; onConfirm: UserDetailSheetProps['onConfirm']; onClose: () => void }) {
  const roles = useRoles();
  const canAudit = useAuth().can('audit.view');
  const protectedAccount = user.isSuperAdmin;
  const isSelf = user.id === selfId;
  const status = statusOf(user);
  const setStatus = useSetUserStatus();
  const unlock = useUnlockUser();

  const defaults: FormValues = { name: user.name, roleIds: user.roles.map((r) => r.id) };
  const form = useForm<FormValues>({ resolver: zodResolver(zForm), defaultValues: defaults, mode: 'onTouched' });
  const { register, control, handleSubmit, formState, reset } = form;

  const save = useApiMutation<AppUser, FormValues, FormValues>({
    form,
    mutationFn: (v) => updateUser(user.id, protectedAccount ? { name: v.name } : { name: v.name, roleIds: v.roleIds }),
    invalidate: [qk.users.all, qk.roles.all],
    successMessage: (u) => `Saved changes to ${u.name}`,
    errorMessage: 'Could not save the changes',
    onSuccess: (u) => reset({ name: u.name, roleIds: u.roles.map((r) => r.id) }),
  });

  const options = (roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name, hint: r.isSystem ? 'Reserved' : `${r.permissions.length} permissions`, disabled: r.isSystem }));

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size="md" />
          <div className="min-w-0">
            <SheetTitle className="truncate">{user.name}</SheetTitle>
            <SheetDescription className="truncate">{user.email}</SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <UserStatusPill user={user} />
          {protectedAccount && (
            <Badge tone="primary">
              <ShieldCheck aria-hidden="true" /> Protected
            </Badge>
          )}
          {isSelf && <Badge tone="outline">This is you</Badge>}
          {user.mustChangePassword && <Badge tone="warning">Password change pending</Badge>}
        </div>
      </SheetHeader>

      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-8">
          {protectedAccount && (
            <div className="flex gap-3 rounded-lg border border-primary/25 bg-primary-subtle p-3 text-[13px] text-primary-text">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>The Super Admin account is protected: only the display name can change, and it cannot be disabled, locked out or deleted.</p>
            </div>
          )}

          <section aria-label="Profile" className="space-y-4">
            <h3 className="border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profile</h3>
            <FormField label="Full name" required error={formState.errors.name}>
              <Input autoComplete="off" {...register('name')} />
            </FormField>
            <FormField label="Roles" required error={formState.errors.roleIds as { message?: string } | undefined}>
              {protectedAccount ? (
                <div className="flex flex-wrap gap-1.5">
                  {user.roles.map((r) => (
                    <Badge key={r.id} tone="primary">
                      {r.name}
                    </Badge>
                  ))}
                </div>
              ) : (
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
                    />
                  )}
                />
              )}
            </FormField>
          </section>

          <section aria-label="Account" className="space-y-4">
            <h3 className="border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</h3>
            <dl className="grid grid-cols-2 gap-4">
              <Fact label="Last sign-in">
                {user.lastLoginAt ? (
                  <>
                    <RelativeTime iso={user.lastLoginAt} />
                    {user.lastLoginIp && <span className="block font-mono text-xs text-muted-foreground">{user.lastLoginIp}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </Fact>
              <Fact label="Active sessions">{user.activeSessions}</Fact>
              <Fact label="Created">{new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Fact>
              {status === 'locked' && user.lockedUntil && (
                <Fact label="Locked until">{new Date(user.lockedUntil).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}</Fact>
              )}
            </dl>
          </section>

          {!protectedAccount && (
            <section aria-label="Security actions" className="space-y-3">
              <h3 className="border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Security</h3>
              <div className="flex flex-wrap gap-2">
                {status === 'locked' && (
                  <Button type="button" variant="secondary" size="sm" loading={unlock.isPending} onClick={() => unlock.mutate(user)}>
                    {!unlock.isPending && <LockKeyholeOpen aria-hidden="true" />}
                    Unlock account
                  </Button>
                )}
                <Button type="button" variant="secondary" size="sm" onClick={() => onConfirm({ kind: 'reset', user })}>
                  <KeyRound aria-hidden="true" />
                  Reset password
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={user.activeSessions === 0} onClick={() => onConfirm({ kind: 'revoke', user })}>
                  <LogOut aria-hidden="true" />
                  Sign out everywhere
                </Button>
                {!isSelf &&
                  (user.status === 'active' ? (
                    <Button type="button" variant="secondary" size="sm" loading={setStatus.isPending} onClick={() => setStatus.mutate({ user, status: 'disabled' })}>
                      {!setStatus.isPending && <UserX aria-hidden="true" />}
                      Disable account
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" size="sm" loading={setStatus.isPending} onClick={() => setStatus.mutate({ user, status: 'active' })}>
                      {!setStatus.isPending && <UserCheck aria-hidden="true" />}
                      Enable account
                    </Button>
                  ))}
              </div>
              {isSelf && <p className="text-xs text-muted-foreground">You cannot disable or delete your own account.</p>}
            </section>
          )}

          {!protectedAccount && !isSelf && (
            <section aria-label="Danger zone" className="space-y-3 rounded-lg border border-danger/30 p-4">
              <div>
                <h3 className="text-sm font-medium text-danger-text">Delete user</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Removes the account permanently. Disable it instead if you may need the record.</p>
              </div>
              <Button type="button" variant="destructive-ghost" size="sm" onClick={() => onConfirm({ kind: 'delete', user })}>
                <Trash2 aria-hidden="true" />
                Delete user...
              </Button>
            </section>
          )}
          {canAudit && (
            <>
              <section aria-label="Activity by this user" className="space-y-3">
                <h3 className="border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
                <p className="text-xs text-muted-foreground">What {user.name} has done in the system.</p>
                <ActivityFeed filter={{ userId: user.id }} pageSize={6} hide="user" emptyDescription="This person has not done anything that is recorded yet." />
              </section>
              <section aria-label="Changes to this account" className="space-y-3">
                <h3 className="border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes to this account</h3>
                <p className="text-xs text-muted-foreground">Who created, edited, locked or reset this account.</p>
                <ActivityFeed filter={{ entityType: 'user', entityId: String(user.id) }} pageSize={6} hide="subject" showAuditLink={false} emptyDescription="No changes have been made to this account." />
              </section>
            </>
          )}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
            Close
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!formState.isDirty}>
            Save changes
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}

