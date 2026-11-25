import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, Clock, LockKeyhole, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorCode, zLoginInput } from '@nacta/shared';
import type { LoginInput, SessionInfo } from '@nacta/shared';
import { ApiError, useApiMutation } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { BrandBand, BrandPanel } from '../../components/auth/brand-panel';
import { PasswordInput } from '../../components/auth/password-input';
import { ThemeToggle } from '../../components/layout/theme-toggle';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';

/** Only same-app absolute paths are honoured, never another origin or the login page itself. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return '/';
  return raw;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

interface Problem {
  tone: 'danger' | 'warning';
  title: string;
  body: string;
}

function problemFor(e: ApiError): Problem {
  switch (e.code) {
    case ErrorCode.INVALID_CREDENTIALS:
      return { tone: 'danger', title: 'Incorrect email or password', body: 'Check your details and try again. Repeated failures lock the account for a while.' };
    case ErrorCode.ACCOUNT_LOCKED: {
      const until = (e.details as { lockedUntil?: string } | undefined)?.lockedUntil;
      const t = until ? new Date(until) : null;
      const mins = t ? Math.max(1, Math.ceil((t.getTime() - Date.now()) / 60_000)) : null;
      return {
        tone: 'warning',
        title: 'This account is temporarily locked',
        body: t
          ? `Too many failed attempts. You can try again at ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })} (in about ${mins} ${mins === 1 ? 'minute' : 'minutes'}), or ask an administrator to unlock it.`
          : 'Too many failed attempts. Try again later, or ask an administrator to unlock it.',
      };
    }
    case ErrorCode.ACCOUNT_DISABLED:
      return { tone: 'danger', title: 'This account is disabled', body: 'Contact your system administrator if you believe this is a mistake.' };
    case ErrorCode.RATE_LIMITED:
      return { tone: 'warning', title: 'Too many attempts', body: 'Please wait a minute before trying again.' };
    default:
      return { tone: 'danger', title: e.isNetwork ? 'Server unreachable' : 'Could not sign in', body: e.message };
  }
}

export default function LoginPage() {
  const { signIn, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const expired = notice === 'expired' || params.get('reason') === 'expired';
  const [problem, setProblem] = React.useState<Problem | null>(null);
  const [caps, setCaps] = React.useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(zLoginInput),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });
  const { register, handleSubmit, formState } = form;

  const submit = useApiMutation<SessionInfo, LoginInput, LoginInput>({
    form,
    toastErrors: false,
    mutationFn: signIn,
    onError: (e) => setProblem(e.isValidation ? null : problemFor(e)),
    onSuccess: (info) => {
      clearNotice();
      const { previousLoginAt, previousLoginIp } = info.user;
      if (previousLoginAt) toast.message(`Last signed in ${formatWhen(previousLoginAt)}${previousLoginIp ? ` from ${previousLoginIp}` : ''}`);
      navigate(info.user.mustChangePassword ? '/' : next, { replace: true });
    },
  });

  const emailField = register('email');
  const passwordField = register('password');

  return (
    <div className="grid min-h-dvh bg-background min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel className="hidden min-[900px]:flex" />
      <div className="min-[900px]:hidden">
        <BrandBand />
      </div>

      <main className="relative flex flex-col px-5 py-8 sm:px-10">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-5">
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-8">
          <div className="mb-8 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">Use the account issued to you by your administrator.</p>
          </div>

          {expired && !problem && (
            <div role="status" className="mb-5 flex gap-3 rounded-lg border border-info/30 bg-info-subtle p-3.5 text-info-text">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="text-[13px]">
                <p className="font-medium">Your session expired</p>
                <p className="opacity-90">For your security you were signed out. Sign in again to continue.</p>
              </div>
            </div>
          )}

          {problem && (
            <div
              role="alert"
              className={
                problem.tone === 'danger'
                  ? 'mb-5 flex gap-3 rounded-lg border border-danger/30 bg-danger-subtle p-3.5 text-danger-text'
                  : 'mb-5 flex gap-3 rounded-lg border border-warning/30 bg-warning-subtle p-3.5 text-warning-text'
              }
            >
              {problem.tone === 'danger' ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <div className="text-[13px]">
                <p className="font-medium">{problem.title}</p>
                <p className="opacity-90">{problem.body}</p>
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit((v) => {
              setProblem(null);
              submit.mutate(v);
            })}
            noValidate
            className="space-y-5"
          >
            <FormField label="Email address" required error={formState.errors.email}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="username"
                autoFocus
                autoCapitalize="none"
                spellCheck={false}
                placeholder="name@nacta.gov.pk"
                {...emailField}
              />
            </FormField>
            <FormField label="Password" required error={formState.errors.password}>
              <PasswordInput
                autoComplete="current-password"
                onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))}
                {...passwordField}
                onBlur={(e) => {
                  setCaps(false);
                  void passwordField.onBlur(e);
                }}
              />
              {caps && (
                <p role="status" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-warning-text">
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  Caps Lock is on
                </p>
              )}
            </FormField>
            <Button type="submit" size="lg" className="w-full" loading={submit.isPending}>
              {submit.isPending ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Forgotten your password? Ask a Super Admin to reset it for you.
          </p>
        </div>
        <p className="text-center text-[11px] text-muted-foreground min-[900px]:hidden">Authorised use only. Activity is monitored and logged.</p>
      </main>
    </div>
  );
}
