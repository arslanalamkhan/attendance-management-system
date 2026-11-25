import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Card } from './card';
import { Skeleton } from './skeleton';
import { Sparkline } from './sparkline';

export interface StatDelta {
  /** Signed change (e.g. +12 or -3). */
  value: number;
  /** Text after the number, e.g. "vs yesterday". */
  label?: string;
  /** Format the number (default: signed integer). */
  format?: (n: number) => string;
  /** Whether an increase is good news (default true). Flips green/red. */
  upIsGood?: boolean;
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Secondary text beside the value, e.g. "of 8". */
  unit?: React.ReactNode;
  icon?: React.ReactNode;
  delta?: StatDelta;
  sparkline?: number[];
  footnote?: React.ReactNode;
  loading?: boolean;
  className?: string;
  /** Colour of the icon chip and sparkline (default: the brand colour). */
  tone?: StatTone;
  /** Show the footnote even when a delta is present. */
  alwaysFootnote?: boolean;
}

export type StatTone = 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'neutral';
const TONES: Record<StatTone, { chip: string; spark: string }> = {
  primary: { chip: 'bg-primary-subtle text-primary-text', spark: 'text-primary' },
  success: { chip: 'bg-success-subtle text-success-text', spark: 'text-success' },
  warning: { chip: 'bg-warning-subtle text-warning-text', spark: 'text-warning' },
  info: { chip: 'bg-info-subtle text-info-text', spark: 'text-info' },
  danger: { chip: 'bg-danger-subtle text-danger-text', spark: 'text-danger' },
  neutral: { chip: 'bg-muted text-muted-foreground', spark: 'text-muted-foreground' },
};

const signed =(n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;

export function StatCard({ label, value, unit, icon, delta, sparkline, footnote, loading, className, tone = 'primary', alwaysFootnote }: StatCardProps) {
  if (loading) {
    return (
      <Card className={cn('p-5', className)} aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-8 w-20" />
        <Skeleton className="mt-4 h-9 w-full" />
      </Card>
    );
  }

  const direction = delta ? (delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat') : 'flat';
  const good = delta ? (delta.upIsGood ?? true) === (delta.value > 0) : false;
  const DeltaIcon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;

  return (
    <Card className={cn('flex flex-col p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span className={cn('grid size-8 place-content-center rounded-md [&_svg]:size-4', TONES[tone].chip)} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-figure text-3xl font-semibold tracking-tight">{value}</span>
        {unit && <span className="font-figure text-sm text-muted-foreground">{unit}</span>}
      </div>
      {delta && (
        <p
          className={cn(
            'mt-1.5 flex items-center gap-1 text-xs font-medium',
            direction === 'flat' ? 'text-muted-foreground' : good ? 'text-success-text' : 'text-danger-text',
          )}
        >
          <DeltaIcon className="size-3.5" aria-hidden="true" />
          <span className="font-figure">{(delta.format ?? signed)(delta.value)}</span>
          {delta.label && <span className="font-normal text-muted-foreground">{delta.label}</span>}
        </p>
      )}
      {footnote && (!delta || alwaysFootnote) && <p className="mt-1.5 text-xs text-muted-foreground">{footnote}</p>}
      {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} strokeClassName={TONES[tone].spark} className="mt-4" />}
    </Card>
  );
}
