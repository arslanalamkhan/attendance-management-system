import * as React from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import type { AppUser } from '@nacta/shared';
import { zNewPassword } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { deleteUser, resetUserPassword, revokeUserSessions, unlockUser, updateUser } from '../../../lib/endpoints/users';
import { qk } from '../../../lib/query-keys';
import { generateStrongPassword } from '../../../lib/password';
import { GeneratedPasswordField, useCopy } from '../../../components/auth/generated-password';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/form-field';

/** True while `lockedUntil` is in the future. */
export function isLocked(u: Pick<AppUser, 'lockedUntil'>, now = Date.now()): boolean {
  return u.lockedUntil !== null && new Date(u.lockedUntil).getTime() > now;
}

export type UserStatusKind = 'active' | 'disabled' | 'locked';
export function statusOf(u: AppUser): UserStatusKind {
  if (u.status === 'disabled') return 'disabled';
  return isLocked(u) ? 'locked' : 'active';
}

const invalidateUsers = [qk.users.all, qk.roles.all];

export function useSetUserStatus() {
  return useApiMutation<AppUser, { user: AppUser; status: 'active' | 'disabled' }>({
    mutationFn: ({ user, status }) => updateUser(user.id, { status }),
    invalidate: invalidateUsers,
    successMessage: (_d, { user, status }) => (status === 'active' ? `Enabled ${user.name}` : `Disabled ${user.name}. They were signed out.`),
    errorMessage: 'Could not change the account status',
  });
}

export function useUnlockUser() {
  return useApiMutation<AppUser, AppUser>({
    mutationFn: (u) => unlockUser(u.id),
    invalidate: invalidateUsers,
    successMessage: (_d, u) => `Unlocked ${u.name}`,
    errorMessage: 'Could not unlock the account',
  });
}

export type UserConfirm = { kind: 'reset' | 'revoke' | 'delete'; user: AppUser } | null;

/** Reset-password, sign-out-everywhere and delete, shared by the row menu and the detail sheet. */
export function UserActionDialogs({ target, onClose, onDeleted }: { target: UserConfirm; onClose: () => void; onDeleted?: (u: AppUser) => void }) {
  const user = target?.user;
  const revoke = useApiMutation<{ revoked: number }, AppUser>({
    mutationFn: (u) => revokeUserSessions(u.id),
    invalidate: invalidateUsers,
    successMessage: (r, u) => `Signed ${u.name} out of ${r.revoked} ${r.revoked === 1 ? 'session' : 'sessions'}`,
    errorMessage: 'Could not sign the user out',
  });
  const del = useApiMutation<void, AppUser>({
    mutationFn: (u) => deleteUser(u.id),
    invalidate: invalidateUsers,
    successMessage: (_d, u) => `Deleted ${u.name}`,
    errorMessage: 'Could not delete the user',
  });
  const busy = revoke.isPending || del.isPending;

  return (
    <>
      <AlertDialog open={target?.kind === 'revoke'} onOpenChange={(o) => !o && !busy && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign {user?.name} out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              Every active session ({user?.activeSessions ?? 0}) ends immediately. They can sign in again with their password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (user) revoke.mutate(user, { onSuccess: onClose });
              }}
            >
              {revoke.isPending ? 'Signing out...' : 'Sign out everywhere'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={target?.kind === 'delete'} onOpenChange={(o) => !o && !busy && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {user?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The account ({user?.email}) is removed and all of its sessions end. Their past activity stays in the audit log. This cannot be undone. To keep the
              record but block access, disable the account instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep user</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (user)
                  del.mutate(user, {
                    onSuccess: () => {
                      onClose();
                      onDeleted?.(user);
                    },
                  });
              }}
            >
              {del.isPending ? 'Deleting...' : 'Delete user'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ResetPasswordDialog user={target?.kind === 'reset' ? target.user : null} onClose={onClose} />
    </>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AppUser | null; onClose: () => void }) {
  // Keep the last user while the close animation runs.
  const last = React.useRef<AppUser | null>(null);
  if (user) last.current = user;
  const shown = user ?? last.current;
  const [password, setPassword] = React.useState('');
  const [done, setDone] = React.useState(false);
  const { copied, copy } = useCopy();

  React.useEffect(() => {
    if (user) {
      setPassword(generateStrongPassword());
      setDone(false);
    }
  }, [user]);

  const reset = useApiMutation<void, string>({
    mutationFn: (pw) => resetUserPassword(shown!.id, { temporaryPassword: pw }),
    invalidate: invalidateUsers,
    successMessage: false,
    errorMessage: 'Could not reset the password',
    onSuccess: () => setDone(true),
  });

  const parsed = zNewPassword.safeParse(password);
  const error = password && !parsed.success ? parsed.error.issues[0]?.message : undefined;

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && !reset.isPending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{done ? 'Password reset' : `Reset password for ${shown?.name ?? ''}`}</DialogTitle>
          <DialogDescription>
            {done
              ? 'Give this temporary password to the user. It is shown only now and cannot be recovered later.'
              : 'Sets a temporary password, signs the user out everywhere and makes them choose a new password at their next sign-in.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {done ? (
            <div className="space-y-3 rounded-lg border bg-muted/50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Temporary password for {shown?.email}</p>
              <p className="select-all break-all font-mono text-lg font-medium tracking-wide">{password}</p>
              <Button variant="secondary" size="sm" onClick={() => void copy(password)}>
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy password'}
              </Button>
            </div>
          ) : (
            <FormField label="Temporary password" required error={error} hint="Generated for you. Edit it if you prefer your own; it must meet the password policy.">
              <GeneratedPasswordField value={password} onValueChange={setPassword} invalid={Boolean(error)} />
            </FormField>
          )}
        </DialogBody>
        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={reset.isPending}>
                Cancel
              </Button>
              <Button loading={reset.isPending} disabled={!parsed.success} onClick={() => reset.mutate(password)}>
                {!reset.isPending && <KeyRound aria-hidden="true" />}
                Reset password
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
