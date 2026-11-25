import * as React from 'react';
import { cn } from '../../lib/utils';
import { controlBase } from './input';
import { useFieldProps } from './form-field-context';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => {
    const field = useFieldProps({ ...props, invalid });
    return (
      <textarea
        ref={ref}
        rows={3}
        {...props}
        id={field.id}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        required={field.required}
        className={cn(controlBase, 'min-h-[72px] resize-y px-3 py-2 leading-relaxed', className)}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
