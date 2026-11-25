import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useDebouncedValue } from '../../hooks/use-debounced-value';

export interface DataTableSearchProps {
  /** Current committed value (from the URL state). */
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  debounceMs?: number;
}

/** Debounced search box that stays in sync with the URL value (e.g. after "Clear filters"). */
export function DataTableSearch({
  value,
  onChange,
  placeholder = 'Search...',
  label = 'Search',
  className,
  debounceMs = 300,
}: DataTableSearchProps) {
  const [text, setText] = React.useState(value ?? '');
  const debounced = useDebouncedValue(text, debounceMs);
  const committed = value ?? '';
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  // push local typing -> URL
  React.useEffect(() => {
    if (debounced !== committed) onChangeRef.current(debounced.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // pull URL -> local when it changes from elsewhere
  React.useEffect(() => {
    setText((t) => (t.trim() === committed ? t : committed));
  }, [committed]);

  return (
    <Input
      type="search"
      role="searchbox"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={placeholder}
      leading={<Search />}
      trailing={
        text ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setText('')}
            className="grid size-6 place-content-center rounded-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
          </button>
        ) : null
      }
      className={cn('h-8 text-[13px] [&::-webkit-search-cancel-button]:hidden', className)}
      wrapperClassName="w-full max-w-xs"
    />
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface DataTableFilterSelectProps {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: FilterOption[];
  /** Label for the "no filter" choice. */
  allLabel?: string;
  className?: string;
}

const ALL = '__all__';

/** "All / option 1 / option 2" select for table filters. */
export function DataTableFilterSelect({ label, value, onChange, options, allLabel = 'All', className }: DataTableFilterSelectProps) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger aria-label={label} className={cn('h-8 w-auto min-w-[8.5rem] gap-2 px-2.5 text-[13px]', value && 'border-primary/60 bg-primary-subtle', className)}>
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
