import * as React from 'react';
import { Ban, Building2, Check, Play, TriangleAlert } from 'lucide-react';
import { ErrorCode } from '@nacta/shared';
import type { Employee, EmployeeStatus } from '@nacta/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../lib/api';
import { changeEmployeeStatus, updateEmployee } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { ORG_UNIT } from '../../lib/terms';
import { useSectionsOf, useWings } from '../../hooks/use-lookups';
import { Button } from '../../components/ui/button';
import { Combobox } from '../../components/ui/combobox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Textarea } from '../../components/ui/textarea';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

interface BatchResult {
  id: number;
  name: string;
  ok: boolean;
  /** NO_BIOMETRIC_BACKUP: can be retried with force. */
  needsForce?: boolean;
  message?: string;
}

/** Runs `fn` over the rows with small concurrency, reporting progress. Per-row failures never abort the batch. */
async function runBatch(rows: Employee[], fn: (e: Employee) => Promise<void>, onProgress: (done: number) => void, concurrency = 3): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < rows.length) {
      const e = rows[next++]!;
      try {
        await fn(e);
        out.push({ id: e.id, name: e.name, ok: true });
      } catch (err) {
        out.push({
          id: e.id,
          name: e.name,
          ok: false,
          needsForce: err instanceof ApiError && err.code === ErrorCode.NO_BIOMETRIC_BACKUP,
          message: errorMessage(err),
        });
      }
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return out;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Progress">
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {done.toLocaleString()} of {total.toLocaleString()}
      </p>
    </div>
  );
}

function Failures({ results }: { results: BatchResult[] }) {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2.5 text-[13px] text-danger-text">
      <p className="font-semibold">{plural(failed.length, 'employee', 'employees')} could not be changed</p>
      <ul className="mt-1 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5">
        {failed.map((f) => (
          <li key={f.id}>
            {f.name}: {f.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk move
// ---------------------------------------------------------------------------

export interface BulkTarget {
  rows: Employee[];
  onDone?: () => void;
}

function useLast<T>(value: T | null): T | null {
  const ref = React.useRef<T | null>(null);
  if (value) ref.current = value;
  return value ?? ref.current;
}

export function MoveDialog({ target, onOpenChange }: { target: BulkTarget | null; onOpenChange: (open: boolean) => void }) {
  const shown = useLast(target);
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">{shown && <MoveBody key={shown.rows.map((r) => r.id).join(',')} target={shown} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function MoveBody({ target, onClose }: { target: BulkTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const wings = useWings();
  const [wingId, setWingId] = React.useState<number | null>(null);
  const [sectionId, setSectionId] = React.useState<number | null>(null);
  const sections = useSectionsOf(wingId);
  const [state, setState] = React.useState<{ done: number; results: BatchResult[] | null; running: boolean }>({ done: 0, results: null, running: false });
  const total = target.rows.length;

  const run = async () => {
    setState({ done: 0, results: null, running: true });
    const results = await runBatch(
      target.rows,
      async (e) => {
        await updateEmployee(e.id, { wingId, sectionId });
      },
      (done) => setState((s) => ({ ...s, done })),
    );
    await Promise.all([qc.invalidateQueries({ queryKey: qk.employees.all }), qc.invalidateQueries({ queryKey: qk.wings.all })]);
    setState({ done: total, results, running: false });
    if (results.every((r) => r.ok)) {
      target.onDone?.();
      onClose();
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move to {ORG_UNIT.lower} or section</DialogTitle>
        <DialogDescription>
          Moves {plural(total, 'employee', 'employees')} in one go. Leave the {ORG_UNIT.lower} empty to clear it. People already on devices get their profile re-sent automatically.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormField label={ORG_UNIT.singular}>
          <Combobox
            options={(wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name, hint: w.code ?? undefined }))}
            value={wingId === null ? null : String(wingId)}
            onChange={(v) => {
              setWingId(v === null ? null : Number(v));
              setSectionId(null);
            }}
            placeholder={wings.isPending ? 'Loading...' : `No ${ORG_UNIT.lower} (clear)`}
            searchPlaceholder={`Search ${ORG_UNIT.lowerPlural}...`}
            clearable
            disabled={state.running}
          />
        </FormField>
        <FormField label="Section" hint={wingId ? undefined : `Choose a ${ORG_UNIT.lower} first.`}>
          <Combobox
            options={sections.map((s) => ({ value: String(s.id), label: s.name }))}
            value={sectionId === null ? null : String(sectionId)}
            onChange={(v) => setSectionId(v === null ? null : Number(v))}
            placeholder="No section"
            searchPlaceholder="Search sections..."
            clearable
            disabled={!wingId || sections.length === 0 || state.running}
          />
        </FormField>
        {state.running && <ProgressBar done={state.done} total={total} />}
        {state.results && <Failures results={state.results} />}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={state.running}>
          {state.results ? 'Close' : 'Cancel'}
        </Button>
        <Button onClick={() => void run()} loading={state.running}>
          {!state.running && <Building2 aria-hidden="true" />}
          {wingId === null ? `Clear ${ORG_UNIT.lower}` : 'Move'} {plural(total, 'employee', 'employees')}
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bulk status
// ---------------------------------------------------------------------------

export interface BulkStatusTarget extends BulkTarget {
  to: Extract<EmployeeStatus, 'active' | 'disabled'>;
}

export function BulkStatusDialog({ target, onOpenChange }: { target: BulkStatusTarget | null; onOpenChange: (open: boolean) => void }) {
  const shown = useLast(target);
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {shown && <BulkStatusBody key={`${shown.to}-${shown.rows.map((r) => r.id).join(',')}`} target={shown} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function BulkStatusBody({ target, onClose }: { target: BulkStatusTarget; onClose: () => void }) {
  const qc = useQueryClient();
  const enabling = target.to === 'active';
  // Only people whose status actually changes are sent.
  const rows = React.useMemo(() => target.rows.filter((r) => r.status !== target.to), [target]);
  const skipped = target.rows.length - rows.length;
  const [reason, setReason] = React.useState('');
  const [state, setState] = React.useState<{ done: number; total: number; results: BatchResult[] | null; running: boolean }>({ done: 0, total: rows.length, results: null, running: false });

  const execute = async (list: Employee[], force: boolean, keep: BatchResult[]) => {
    setState({ done: 0, total: list.length, results: null, running: true });
    const results = await runBatch(
      list,
      async (e) => {
        await changeEmployeeStatus(e.id, { status: target.to, reason: reason.trim() || undefined, force });
      },
      (done) => setState((s) => ({ ...s, done })),
    );
    await qc.invalidateQueries({ queryKey: qk.employees.all });
    const merged = [...keep, ...results];
    setState({ done: list.length, total: list.length, results: merged, running: false });
  };

  const needsForce = state.results?.filter((r) => r.needsForce) ?? [];
  const finished = state.results !== null;
  const allOk = finished && state.results!.every((r) => r.ok);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{enabling ? 'Enable employees' : 'Disable employees'}</DialogTitle>
        <DialogDescription>
          {enabling
            ? `Restores ${plural(rows.length, 'employee', 'employees')} to the devices they were removed from, with their fingerprints, face and photo.`
            : `Removes ${plural(rows.length, 'employee', 'employees')} from every device so they cannot mark attendance. Biometrics stay saved in the app and come back when you enable them.`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {skipped > 0 && (
          <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            {plural(skipped, 'selected person is', 'selected people are')} already {enabling ? 'active' : 'disabled'} and will be skipped.
          </p>
        )}
        {!finished && !state.running && (
          <FormField label="Reason" hint="Optional. Recorded for each person and in the audit log.">
            <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        )}
        {state.running && <ProgressBar done={state.done} total={state.total} />}
        {finished && allOk && (
          <p className="flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2.5 text-[13px] font-medium text-success-text">
            <Check className="size-4" aria-hidden="true" />
            {plural(state.results!.length, 'employee', 'employees')} {enabling ? 'enabled' : 'disabled'}. Device commands are queued.
          </p>
        )}
        {finished && !allOk && (
          <>
            <Failures results={state.results!} />
            {needsForce.length > 0 && (
              <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning-subtle px-3.5 py-3 text-[13px] text-warning-text">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  {plural(needsForce.length, 'person has', 'people have')} biometrics only on a device, with no backup in the app. Disabling anyway removes them for good and they will need to re-enrol.
                </p>
              </div>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => {
            if (finished) target.onDone?.();
            onClose();
          }}
          disabled={state.running}
        >
          {finished ? 'Close' : 'Cancel'}
        </Button>
        {!finished && (
          <Button variant={enabling ? 'primary' : 'destructive'} loading={state.running} disabled={rows.length === 0} onClick={() => void execute(rows, false, [])}>
            {!state.running && (enabling ? <Play aria-hidden="true" /> : <Ban aria-hidden="true" />)}
            {enabling ? 'Enable' : 'Disable'} {plural(rows.length, 'employee', 'employees')}
          </Button>
        )}
        {finished && needsForce.length > 0 && (
          <Button
            variant="destructive"
            onClick={() => void execute(rows.filter((r) => needsForce.some((n) => n.id === r.id)), true, (state.results ?? []).filter((r) => !r.needsForce))}
          >
            Disable anyway — they will need to re-enrol
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
