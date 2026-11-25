import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '../ui/input';

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'trailing'> {
  /** Controlled visibility; omit to let the field manage it. */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  /** Noun used in the toggle's accessible name ("Show password"). */
  noun?: string;
}

/** Password field with a show/hide toggle. Works with react-hook-form's `register`. */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ visible, onVisibleChange, noun = 'password', ...props }, ref) => {
    const [own, setOwn] = React.useState(false);
    const shown = visible ?? own;
    const toggle = () => {
      setOwn(!shown);
      onVisibleChange?.(!shown);
    };
    return (
      <Input
        ref={ref}
        {...props}
        type={shown ? 'text' : 'password'}
        trailing={
          <button
            type="button"
            onClick={toggle}
            aria-label={shown ? `Hide ${noun}` : `Show ${noun}`}
            aria-pressed={shown}
            className="grid size-7 place-content-center rounded-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        }
      />
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
