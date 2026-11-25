import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Label } from './label';
import { FormFieldContext } from './form-field-context';

export interface FormFieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** String or react-hook-form FieldError. */
  error?: string | { message?: string } | null;
  required?: boolean;
  /** Show label inline to the right of the control (checkboxes, switches). */
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + control + hint + error with correct ARIA wiring. Controls from components/ui
 * (Input, Textarea, SelectTrigger, Combobox, Checkbox, Switch) inherit the id and
 * aria-describedby automatically.
 */
export function FormField({ label, hint, error, required, inline, className, children }: FormFieldProps) {
  const id = React.useId();
  const message = typeof error === 'string' ? error : error?.message;
  const invalid = Boolean(message);
  const ctx = React.useMemo(
    () => ({ id, hintId: `${id}-hint`, errorId: `${id}-error`, invalid, required: Boolean(required), hasHint: Boolean(hint) }),
    [id, invalid, required, hint],
  );

  const labelNode = label ? (
    <Label htmlFor={id} className={cn(inline && 'cursor-pointer leading-snug')}>
      {label}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-danger-text">
          *
        </span>
      )}
    </Label>
  ) : null;

  return (
    <FormFieldContext.Provider value={ctx}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {inline ? (
          <div className="flex items-start gap-3">
            {children}
            <div className="flex flex-col gap-0.5">{labelNode}</div>
          </div>
        ) : (
          <>
            {labelNode}
            {children}
          </>
        )}
        {hint && !invalid && (
          <p id={ctx.hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {invalid && (
          <p id={ctx.errorId} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger-text">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {message}
          </p>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}
