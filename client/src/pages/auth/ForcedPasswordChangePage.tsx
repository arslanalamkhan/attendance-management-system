import { LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { BrandBand } from '../../components/auth/brand-panel';
import { ChangePasswordForm } from '../../components/auth/change-password-form';
import { ThemeToggle } from '../../components/layout/theme-toggle';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';

/** Full-screen step shown while `mustChangePassword` is set (first sign-in or after an admin reset). */
export default function ForcedPasswordChangePage() {
  const { user, signOut } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <BrandBand />
      <div className="absolute right-4 top-3 sm:right-6">
        <ThemeToggle />
      </div>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10">
        <div className="rounded-xl border bg-card p-6 shadow-md sm:p-8">
          <div className="mb-6 flex items-start gap-4">
            <div className="grid size-11 shrink-0 place-content-center rounded-xl bg-primary-subtle text-primary-text">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
              <p className="text-sm text-muted-foreground">
                You are signed in with a temporary password. Set a personal one before you continue.
              </p>
            </div>
          </div>
          {user && (
            <div className="mb-6 flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
              <Avatar name={user.name} size="sm" />
              <div className="min-w-0 text-[13px]">
                <p className="truncate font-medium">{user.name}</p>
                <p className="truncate text-muted-foreground">{user.email}</p>
              </div>
            </div>
          )}
          <ChangePasswordForm
            autoFocus
            submitLabel="Update and continue"
            secondaryAction={
              <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            }
          />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Authorised use only. Activity is monitored and logged.</p>
      </main>
    </div>
  );
}
