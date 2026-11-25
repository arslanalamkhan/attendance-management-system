import * as React from 'react';

interface FormFieldContextValue {
  id: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
  required: boolean;
  hasHint: boolean;
}

export const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

interface FieldInputProps {
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  required?: boolean;
}

/**
 * Lets any control inside a <FormField> pick up its id, `aria-describedby` and invalid state
 * without the caller wiring them by hand. Outside a FormField it only passes props through.
 */
export function useFieldProps(props: FieldInputProps) {
  const field = React.useContext(FormFieldContext);
  const invalid =
    props.invalid ?? (props['aria-invalid'] === true || props['aria-invalid'] === 'true' ? true : field?.invalid ?? false);
  const describedBy =
    [props['aria-describedby'], field?.hasHint ? field.hintId : undefined, field?.invalid ? field.errorId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  return {
    id: props.id ?? field?.id,
    invalid,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    required: props.required ?? (field?.required ? true : undefined),
  };
}
