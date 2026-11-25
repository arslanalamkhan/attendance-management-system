import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { zChangePasswordInput } from '@nacta/shared';
import type { ChangePasswordInput } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { changePassword } from '../../lib/endpoints/auth';
import { qk } from '../../lib/query-keys';
import { useAuth } from '../../lib/auth';
import { Button } from '../ui/button';
import { FormField } from '../ui/form-field';
import { Input } from '../ui/input';
import { PasswordInput } from './password-input';
import { PasswordStrength } from './password-strength';

export interface ChangePasswordFormProps {
  /** Shown above the submit button row, e.g. a "Sign out" link on the forced screen. */
  secondaryAction?: React.ReactNode;
  submitLabel?: string;
  onDone?: () => void;
  autoFocus?: boolean;
}

/** Shared by the forced first-sign-in screen and My account. */
export function ChangePasswordForm({ secondaryAction, submitLabel = 'Update password', onDone, autoFocus }: ChangePasswordFormProps) {
  const { applySession } = useAuth();
  const [showNew, setShowNew] = React.useState(false);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(zChangePasswordInput),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState, watch, reset, setError } = form;
  const newPassword = watch('newPassword') ?? '';

  const save = useApiMutation<Awaited<ReturnType<typeof changePassword>>, ChangePasswordInput, ChangePasswordInput>({
    form,
    mutationFn: changePassword,
    invalidate: [qk.auth.sessions()],
    successMessage: 'Password updated. Other devices were signed out.',
    errorMessage: 'Could not change the password',
    onError: (err) => {
      if (err.code === 'INVALID_CREDENTIALS')
        setError('currentPassword', { type: 'server', message: 'That is not your current password' }, { shouldFocus: true });
    },
    onSuccess: (info) => {
      reset();
      applySession(info);
      onDone?.();
    },
  });

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-5">
      <FormField label="Current password" required error={formState.errors.currentPassword}>
        <PasswordInput
          noun="current password"
          autoComplete="current-password"
          autoFocus={autoFocus}
          {...register('currentPassword')}
        />
      </FormField>
      <div className="space-y-3">
        <FormField label="New password" required error={formState.errors.newPassword}>
          <PasswordInput
            noun="new password"
            visible={showNew}
            onVisibleChange={setShowNew}
            autoComplete="new-password"
            {...register('newPassword')}
          />
        </FormField>
        <PasswordStrength password={newPassword} />
      </div>
      <FormField
        label="Confirm new password"
        required
        error={formState.errors.confirmPassword}
        hint="Must not contain your email name or be a commonly used password."
      >
        <Input type={showNew ? 'text' : 'password'} autoComplete="new-password" {...register('confirmPassword')} />
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div>{secondaryAction}</div>
        <Button type="submit" loading={save.isPending}>
          {save.isPending ? 'Updating...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

