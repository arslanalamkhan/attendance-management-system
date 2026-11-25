import * as React from 'react';
import { Lock, Minus, Plus } from 'lucide-react';
import type { AuditChange } from '@nacta/shared';
import { REDACTED, humanizeKey } from '../../lib/audit-ui';
import { cn } from '../../lib/utils';

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const isPrimitiveArray = (v: unknown): v is (string | number | boolean)[] => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object');

/** One value, formatted for reading. Sensitive values are always shown as redacted. */
export function Value({ value, className }: { value: unknown; className?: string }) {
  if (value === REDACTED) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}>
        <Lock className="size-3" aria-hidden="true" />
        Redacted
      </span>
    );
  }
  if (isEmpty(value)) return <span className={cn('italic text-muted-foreground', className)}>empty</span>;
  if (typeof value === 'boolean') return <span className={className}>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'number') return <span className={cn('font-mono tabular-nums', className)}>{value}</span>;
  if (typeof value === 'string') return <span className={cn('break-words', className)}>{value}</span>;
  if (isPrimitiveArray(value)) return <span className={cn('break-words', className)}>{value.map(String).join(', ')}</span>;
  return <code className={cn('block whitespace-pre-wrap break-all font-mono text-xs', className)}>{JSON.stringify(value)}</code>;
}

function Chip({ kind, children }: { kind: 'added' | 'removed'; children: React.ReactNode }) {
  const added = kind === 'added';
  return (
    <li
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11.5px] leading-4',
        added ? 'border-success/30 bg-success-subtle text-success-text' : 'border-danger/30 bg-danger-subtle text-danger-text line-through decoration-danger-text/60',
      )}
    >
      {added ? <Plus className="size-3 shrink-0 no-underline" aria-label="Added" /> : <Minus className="size-3 shrink-0" aria-label="Removed" />}
      {children}
    </li>
  );
}

/** Added / removed chips for list-valued fields such as permissions. */
function ListDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = (Array.isArray(before) ? before : []).map(String);
  const a = (Array.isArray(after) ? after : []).map(String);
  const added = a.filter((x) => !b.includes(x));
  const removed = b.filter((x) => !a.includes(x));
  const unchanged = a.filter((x) => b.includes(x)).length;
  return (
    <div className="space-y-2">
      {removed.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-danger-text">Removed ({removed.length})</p>
          <ul className="flex flex-wrap gap-1">
            {removed.map((x) => (
              <Chip key={x} kind="removed">
                {x}
              </Chip>
            ))}
          </ul>
        </div>
      )}
      {added.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-success-text">Added ({added.length})</p>
          <ul className="flex flex-wrap gap-1">
            {added.map((x) => (
              <Chip key={x} kind="added">
                {x}
              </Chip>
            ))}
          </ul>
        </div>
      )}
      {added.length === 0 && removed.length === 0 && <p className="text-xs text-muted-foreground">No difference in the list.</p>}
      <p className="text-xs text-muted-foreground">
        {unchanged} unchanged · {a.length} now, {b.length} before
      </p>
    </div>
  );
}

/** Field / Before / After. Lists become added and removed chips. */
export function ChangesDiff({ changes }: { changes: AuditChange[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <caption className="sr-only">Field-level changes</caption>
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[35%]" />
          <col className="w-[35%]" />
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-2">
              Field
            </th>
            <th scope="col" className="px-3 py-2">
              Before
            </th>
            <th scope="col" className="px-3 py-2">
              After
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {changes.map((c, i) => {
            const listy = (Array.isArray(c.before) || Array.isArray(c.after)) && isPrimitiveArray(c.before ?? []) && isPrimitiveArray(c.after ?? []);
            return (
              <tr key={`${c.field}-${i}`} className="align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <span className="block">{humanizeKey(c.field)}</span>
                  <span className="block font-mono text-[11px] font-normal text-muted-foreground">{c.field}</span>
                </th>
                {listy ? (
                  <td colSpan={2} className="px-3 py-2">
                    <ListDiff before={c.before} after={c.after} />
                  </td>
                ) : (
                  <>
                    <td className={cn('px-3 py-2', !isEmpty(c.before) && c.before !== REDACTED && 'bg-danger-subtle/50')}>
                      <Value value={c.before} className={cn(!isEmpty(c.before) && c.before !== REDACTED && 'text-danger-text line-through decoration-danger-text/50')} />
                    </td>
                    <td className={cn('px-3 py-2', !isEmpty(c.after) && c.after !== REDACTED && 'bg-success-subtle/50')}>
                      <Value value={c.after} className={cn(!isEmpty(c.after) && c.after !== REDACTED && 'font-medium text-success-text')} />
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
