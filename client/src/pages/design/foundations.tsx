import * as React from 'react';
import { useTheme } from '../../lib/theme';
import { Section, Specimen } from './section';

function toHex(rgb: string): string {
  const parts = rgb.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return '';
  return `#${parts
    .slice(0, 3)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function Swatch({ token, className, label }: { token: string; className: string; label?: string }) {
  const { resolvedTheme } = useTheme();
  const [hex, setHex] = React.useState('');
  React.useEffect(() => {
    // wait one tick: the theme class is applied by ThemeProvider's effect, which runs after ours
    const id = window.setTimeout(() => setHex(toHex(getComputedStyle(document.documentElement).getPropertyValue(`--${token}`))), 0);
    return () => window.clearTimeout(id);
  }, [token, resolvedTheme]);
  return (
    <div className="min-w-0">
      <div className={`h-14 rounded-md border ${className}`} />
      <p className="mt-1.5 truncate text-xs font-medium">{label ?? token}</p>
      <p className="font-mono text-[11px] text-muted-foreground">{hex || '...'}</p>
    </div>
  );
}

const SHADOWS = [
  ['xs', 'shadow-xs'],
  ['sm', 'shadow-sm'],
  ['md', 'shadow-md'],
  ['lg', 'shadow-lg'],
  ['pop', 'shadow-pop'],
] as const;

const GROUPS: { title: string; items: { token: string; cls: string; label?: string }[] }[] = [
  {
    title: 'Surface',
    items: [
      { token: 'background', cls: 'bg-background' },
      { token: 'card', cls: 'bg-card' },
      { token: 'muted', cls: 'bg-muted' },
      { token: 'accent', cls: 'bg-accent' },
      { token: 'border', cls: 'bg-border' },
      { token: 'input', cls: 'bg-input', label: 'input border' },
    ],
  },
  {
    title: 'Text',
    items: [
      { token: 'foreground', cls: 'bg-foreground' },
      { token: 'muted-foreground', cls: 'bg-muted-foreground' },
    ],
  },
  {
    title: 'Primary (brand green)',
    items: [
      { token: 'primary', cls: 'bg-primary' },
      { token: 'primary-hover', cls: 'bg-primary-hover' },
      { token: 'primary-subtle', cls: 'bg-primary-subtle' },
      { token: 'primary-foreground', cls: 'bg-primary-foreground' },
      { token: 'ring', cls: 'bg-ring', label: 'focus ring' },
    ],
  },
  {
    title: 'Status only',
    items: [
      { token: 'success', cls: 'bg-success' },
      { token: 'warning', cls: 'bg-warning' },
      { token: 'info', cls: 'bg-info' },
      { token: 'danger', cls: 'bg-danger' },
      { token: 'success-subtle', cls: 'bg-success-subtle' },
      { token: 'warning-subtle', cls: 'bg-warning-subtle' },
      { token: 'info-subtle', cls: 'bg-info-subtle' },
      { token: 'danger-subtle', cls: 'bg-danger-subtle' },
    ],
  },
  {
    title: 'Charts',
    items: [
      { token: 'chart-1', cls: 'bg-chart-1' },
      { token: 'chart-2', cls: 'bg-chart-2' },
      { token: 'chart-3', cls: 'bg-chart-3' },
      { token: 'chart-4', cls: 'bg-chart-4' },
      { token: 'chart-5', cls: 'bg-chart-5' },
    ],
  },
];

export function FoundationsSection() {
  return (
    <Section id="foundations" title="Foundations" description="Tokens are CSS variables, so every component follows light and dark automatically. Semantic colours are reserved for status.">
      <div className="space-y-8">
        <div className="grid gap-6 rounded-lg border bg-card p-5 shadow-xs">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{g.title}</p>
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {g.items.map((s) => (
                  <Swatch key={s.token} token={s.token} className={s.cls} label={s.label} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Specimen label="Typography · Inter" className="block space-y-3">
            <p className="text-2xl font-semibold tracking-tight">Page title — 24 / semibold</p>
            <p className="text-lg font-semibold tracking-tight">Section title — 18 / semibold</p>
            <p className="text-sm">Body text — 14 / regular. Calm, dense but breathable, legible at a glance.</p>
            <p className="text-[13px] text-muted-foreground">Secondary text — 13 / muted foreground</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Overline — 12 / uppercase</p>
          </Specimen>
          <Specimen label="Figures and identifiers" className="block space-y-3">
            <p className="font-figure text-3xl font-semibold tracking-tight">1,284 · 98.6%</p>
            <p className="text-[13px] text-muted-foreground">Tabular numbers keep columns of figures aligned.</p>
            <p className="font-mono text-[13px]">
              PIN <span className="rounded bg-muted px-1.5 py-0.5">000817</span> · SN <span className="rounded bg-muted px-1.5 py-0.5">VDE2244500040</span>
            </p>
            <p className="text-[13px] text-muted-foreground">JetBrains Mono for IDs, PINs and serial numbers.</p>
          </Specimen>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          <Specimen label="Radius · 10px" className="justify-center gap-4">
            <div className="size-14 rounded-sm border bg-muted" title="6px" />
            <div className="size-14 rounded-md border bg-muted" title="8px" />
            <div className="size-14 rounded-lg border bg-muted" title="10px" />
            <div className="size-14 rounded-xl border bg-muted" title="14px" />
          </Specimen>
          <Specimen label="Elevation" className="justify-center gap-4 bg-background">
            {SHADOWS.map(([name, cls]) => (
              <div key={name} className={`grid size-14 place-content-center rounded-lg border bg-card text-xs text-muted-foreground ${cls}`}>
                {name}
              </div>
            ))}
          </Specimen>
          <Specimen label="Motion · 150–200 ms ease-out" className="block text-[13px] text-muted-foreground">
            Hover states use 150 ms, overlays and drawers 200 ms, all on a decelerating curve. Every animation collapses to
            nothing under <code className="font-mono text-xs">prefers-reduced-motion</code>.
          </Specimen>
        </div>
      </div>
    </Section>
  );
}

