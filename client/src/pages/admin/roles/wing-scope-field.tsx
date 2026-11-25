import { Building2, Globe2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ORG_UNIT } from '../../../lib/terms';
import { useWings } from '../../../hooks/use-lookups';
import { FormField } from '../../../components/ui/form-field';
import { MultiCombobox } from '../../../components/ui/multi-combobox';

export interface WingScopeFieldProps {
  allWings: boolean;
  wingIds: number[];
  onChange: (v: { allWings: boolean; wingIds: number[] }) => void;
  error?: string;
  disabled?: boolean;
}

function Choice({ checked, onSelect, disabled, icon, title, description }: { checked: boolean; onSelect: () => void; disabled?: boolean; icon: React.ReactNode; title: string; description: string }) {
  return (
    <label
      className={cn(
        'relative flex gap-3 rounded-lg border bg-card p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-border-strong',
        checked && 'border-primary bg-primary-subtle/50',
      )}
    >
      <input type="radio" name="wing-scope" className="peer sr-only" checked={checked} disabled={disabled} onChange={onSelect} />
      <span className={cn('mt-0.5 grid size-4 shrink-0 place-content-center rounded-full border', checked ? 'border-primary' : 'border-input')} aria-hidden="true">
        {checked && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 space-y-1">
        <span className="flex items-center gap-2 text-sm font-medium [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </span>
        <span className="block text-[13px] leading-snug text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

/** "All wings" vs "Selected wings" with a multi-select of wings. */
export function WingScopeField({ allWings, wingIds, onChange, error, disabled }: WingScopeFieldProps) {
  const wings = useWings();
  const options = (wings.data ?? []).map((d) => ({ value: String(d.id), label: d.name, hint: `${d.employeeCount.toLocaleString()} people` }));
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">{ORG_UNIT.singular} scope</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice
          checked={allWings}
          disabled={disabled}
          onSelect={() => onChange({ allWings: true, wingIds })}
          icon={<Globe2 aria-hidden="true" />}
          title={`All ${ORG_UNIT.lowerPlural}`}
          description={`People in every ${ORG_UNIT.lower}, including those not assigned to one.`}
        />
        <Choice
          checked={!allWings}
          disabled={disabled}
          onSelect={() => onChange({ allWings: false, wingIds })}
          icon={<Building2 aria-hidden="true" />}
          title={`Selected ${ORG_UNIT.lowerPlural}`}
          description={`Only people, attendance and dashboard figures from the ${ORG_UNIT.lowerPlural} you choose.`}
        />
      </div>
      {!allWings && (
        <FormField label={ORG_UNIT.plural} required error={error} hint={`Choose the ${ORG_UNIT.lowerPlural} this role may see.`}>
          <MultiCombobox
            options={options}
            value={wingIds.map(String)}
            onChange={(v) => onChange({ allWings: false, wingIds: v.map(Number) })}
            placeholder={wings.isPending ? `Loading ${ORG_UNIT.lowerPlural}...` : `Choose ${ORG_UNIT.lowerPlural}`}
            searchPlaceholder={`Search ${ORG_UNIT.lowerPlural}...`}
            emptyText={`No matching ${ORG_UNIT.lower}.`}
            disabled={disabled || wings.isPending}
          />
        </FormField>
      )}
    </fieldset>
  );
}
