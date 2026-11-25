import * as React from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { generateStrongPassword } from '../../lib/password';
import { copyText } from '../../pages/devices/parts';

export function useCopy() {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number>();
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = React.useCallback(async (text: string, what = 'Password') => {
    const ok = await copyText(text);
    if (!ok) {
      toast.error('Could not copy. Select the text and copy it manually.');
      return;
    }
    toast.success(`${what} copied to clipboard`);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }, []);
  return { copied, copy };
}

export interface GeneratedPasswordFieldProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: string;
  onValueChange: (value: string) => void;
}

/** Visible temporary-password input with Generate and Copy. Temporary passwords are meant to be read out / pasted to the user. */
export const GeneratedPasswordField = React.forwardRef<HTMLInputElement, GeneratedPasswordFieldProps>(
  ({ value, onValueChange, ...props }, ref) => {
    const { copied, copy } = useCopy();
    return (
      <div className="flex gap-2">
        <Input
          ref={ref}
          mono
          autoComplete="off"
          spellCheck={false}
          placeholder="Generate or type a password"
          {...props}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        />
        <Button type="button" variant="secondary" onClick={() => onValueChange(generateStrongPassword())} className="shrink-0">
          <RefreshCw aria-hidden="true" />
          Generate
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Copy password"
          disabled={!value}
          onClick={() => void copy(value)}
          className="shrink-0"
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
    );
  },
);
GeneratedPasswordField.displayName = 'GeneratedPasswordField';
