import * as React from 'react';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { DAY_STATUSES, DAY_STATUS_LABEL } from '@nacta/shared';
import type { ReportParams, ReportType } from '@nacta/shared';
import { formatDate, isYmd, todayYmd } from '../../lib/dates';
import { ORG_UNIT } from '../../lib/terms';
import { isRequiredParam, missingParams, monthOf, paramsOf, periodForPreset, PERIOD_PRESETS, presetOfPeriod, type ReportParamKey } from '../../lib/report-ui';
import { cn } from '../../lib/utils';
import { useSectionsOf, useDevices, useWings } from '../../hooks/use-lookups';
import { useLeaveTypes } from '../../hooks/use-rules';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { EmployeeCombobox } from '../../components/rules/employee-combobox';
import { Button } from '../../components/ui/button';
import { DatePicker } from '../../components/ui/date-picker';
import { FormField } from '../../components/ui/form-field';
import { useFieldProps } from '../../components/ui/form-field-context';
import { Input, controlBase } from '../../components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';

export type ParamPatch = Partial<Record<ReportParamKey, string | number | null>>;

const ALL = '__all__';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// ---------------------------------------------------------------------------------------------
function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const field = useFieldProps({});
  const [year, setYear] = React.useState(Number(value.slice(0, 4)));
  const step = (n: number) => {
    const d = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1 + n, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const thisMonth = monthOf(todayYmd());
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" size="icon-sm" aria-label="Previous month" onClick={() => step(-1)}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setYear(Number(value.slice(0, 4)));
        }}
      >
        <PopoverTrigger asChild>
          <button type="button" id={field.id} aria-describedby={field['aria-describedby']} className={cn(controlBase, 'flex h-8 w-auto min-w-[10.5rem] items-center gap-2 px-2.5 text-left text-[13px]')}>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {monthLabel(value)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="mb-2 flex items-center justify-between">
            <Button variant="ghost" size="icon-sm" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="font-figure text-sm font-semibold">{year}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div role="group" aria-label={`Months of ${year}`} className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((m, i) => {
              const v = `${year}-${String(i + 1).padStart(2, '0')}`;
              const on = v === value;
              return (
                <Button
                  key={m}
                  size="sm"
                  variant={on ? 'primary' : 'ghost'}
                  aria-pressed={on}
                  className={cn(!on && v === thisMonth && 'text-primary-text')}
                  onClick={() => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  {m}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="secondary" size="icon-sm" aria-label="Next month" onClick={() => step(1)}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (p: { from: string; to: string }) => void }) {
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState(false);
  const field = useFieldProps({});
  const preset = presetOfPeriod({ from, to });
  const showCustom = custom || preset === 'custom';
  const label = preset === 'custom' ? 'Custom' : (PERIOD_PRESETS.find((p) => p.key === preset)?.label ?? '');
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCustom(false);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" id={field.id} aria-describedby={field['aria-describedby']} className={cn(controlBase, 'flex h-8 w-auto min-w-[15rem] items-center gap-2 px-2.5 text-left text-[13px]')}>
          <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{label}</span>
          <span className="truncate text-muted-foreground">
            {formatDate(from)} - {formatDate(to)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div role="group" aria-label="Period presets" className="grid grid-cols-2 gap-1.5">
          {PERIOD_PRESETS.map((p) => {
            const on = !showCustom && preset === p.key;
            return (
              <Button
                key={p.key}
                size="sm"
                variant={on ? 'subtle' : 'ghost'}
                aria-pressed={on}
                className={cn('justify-start', on && 'font-semibold text-primary-text')}
                onClick={() => {
                  onChange(periodForPreset(p.key));
                  setCustom(false);
                  setOpen(false);
                }}
              >
                {p.label}
              </Button>
            );
          })}
          <Button size="sm" variant={showCustom ? 'subtle' : 'ghost'} aria-pressed={showCustom} className={cn('justify-start', showCustom && 'font-semibold text-primary-text')} onClick={() => setCustom(true)}>
            Custom
          </Button>
        </div>
        {showCustom && (
          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <FormField label="From">
              <Input type="date" value={from} max={to} onChange={(e) => isYmd(e.target.value) && onChange({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} />
            </FormField>
            <FormField label="To">
              <Input type="date" value={to} min={from} onChange={(e) => isYmd(e.target.value) && onChange({ from: e.target.value < from ? e.target.value : from, to: e.target.value })} />
            </FormField>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------------------------
function BarSelect({ label, value, onChange, options, allLabel, disabled, className }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; options: { value: string; label: string }[]; allLabel: string; disabled?: boolean; className?: string }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn('h-8 w-auto min-w-[11rem] px-2.5 text-[13px]', className)}>
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

function MinLate({ value, onChange }: { value: number | undefined; onChange: (n: number | null) => void }) {
  const [text, setText] = React.useState(value ? String(value) : '');
  const debounced = useDebouncedValue(text, 350);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  React.useEffect(() => {
    const n = Number.parseInt(debounced, 10);
    const next = Number.isFinite(n) && n > 0 ? Math.min(600, n) : null;
    if ((next ?? 0) !== (value ?? 0)) onChangeRef.current(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  React.useEffect(() => setText((t) => ((Number.parseInt(t, 10) || 0) === (value ?? 0) ? t : value ? String(value) : '')), [value]);
  return (
    <Input type="number" inputMode="numeric" min={0} max={600} value={text} onChange={(e) => setText(e.target.value)} placeholder="Any" className="h-8 text-[13px]" trailing={<span className="text-xs">min</span>} wrapperClassName="w-28" />
  );
}

// ---------------------------------------------------------------------------------------------
/** The inputs a report needs, built from REPORT_TYPES[type].params. */
export function ParamBar({ type, params, onChange }: { type: ReportType; params: ReportParams; onChange: (patch: ParamPatch) => void }) {
  const keys = paramsOf(type);
  const wings = useWings();
  const sections = useSectionsOf(params.wingId ?? null);
  const devices = useDevices();
  const leaveTypes = useLeaveTypes();
  const missing = missingParams(type, params);
  const err = (k: ReportParamKey) => missing.find((m) => m.key === k)?.message;
  const req = (k: ReportParamKey) => isRequiredParam(type, k);
  const has = (k: ReportParamKey) => keys.includes(k);
  const period = has('from') && has('to');

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      aria-label="Report parameters"
      className="mb-5 flex flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border bg-card p-3.5 shadow-xs"
    >
      {has('date') && (
        <FormField label="Date">
          <DatePicker value={params.date ?? todayYmd()} onChange={(d) => onChange({ date: d })} className="h-8 w-auto min-w-[10.5rem] text-[13px]" />
        </FormField>
      )}
      {has('month') && (
        <FormField label="Month">
          <MonthPicker value={params.month ?? monthOf(todayYmd())} onChange={(m) => onChange({ month: m })} />
        </FormField>
      )}
      {period && (
        <FormField label="Period">
          <PeriodPicker from={params.from ?? todayYmd()} to={params.to ?? todayYmd()} onChange={(p) => onChange({ from: p.from, to: p.to })} />
        </FormField>
      )}
      {has('employeeId') && (
        <FormField label="Employee" required={req('employeeId')} error={err('employeeId')} hint={req('employeeId') ? undefined : 'Anyone if empty'}>
          <EmployeeCombobox value={params.employeeId ?? null} onChange={(id) => onChange({ employeeId: id })} clearable={!req('employeeId')} placeholder={req('employeeId') ? 'Search by name or code...' : 'Everyone'} className="w-[16rem]" />
        </FormField>
      )}
      {has('wingId') && (
        <FormField label={ORG_UNIT.singular}>
          <BarSelect label={ORG_UNIT.singular} value={params.wingId ? String(params.wingId) : undefined} onChange={(v) => onChange({ wingId: v ?? null, sectionId: null })} options={(wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))} allLabel={`All ${ORG_UNIT.lowerPlural}`} />
        </FormField>
      )}
      {has('sectionId') && (
        <FormField label="Section">
          <BarSelect
            label="Section"
            value={params.sectionId ? String(params.sectionId) : undefined}
            onChange={(v) => onChange({ sectionId: v ?? null })}
            options={sections.map((s) => ({ value: String(s.id), label: s.name }))}
            allLabel={params.wingId ? 'All sections' : `Choose a ${ORG_UNIT.lower} first`}
            disabled={!params.wingId || sections.length === 0}
          />
        </FormField>
      )}
      {has('status') && (
        <FormField label="Status">
          <BarSelect label="Status" value={params.status} onChange={(v) => onChange({ status: v ?? null })} options={DAY_STATUSES.filter((s) => s !== 'inactive').map((s) => ({ value: s, label: DAY_STATUS_LABEL[s] }))} allLabel="All statuses" />
        </FormField>
      )}
      {has('deviceId') && (
        <FormField label="Device">
          <BarSelect label="Device" value={params.deviceId ? String(params.deviceId) : undefined} onChange={(v) => onChange({ deviceId: v ?? null })} options={(devices.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))} allLabel="All devices" />
        </FormField>
      )}
      {has('leaveTypeId') && (
        <FormField label="Leave type">
          <BarSelect label="Leave type" value={params.leaveTypeId ? String(params.leaveTypeId) : undefined} onChange={(v) => onChange({ leaveTypeId: v ?? null })} options={(leaveTypes.data ?? []).filter((t) => t.isActive).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }))} allLabel="All types" />
        </FormField>
      )}
      {has('minLateMinutes') && (
        <FormField label="Minimum late">
          <MinLate value={params.minLateMinutes} onChange={(n) => onChange({ minLateMinutes: n })} />
        </FormField>
      )}
    </form>
  );
}
