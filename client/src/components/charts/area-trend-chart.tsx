import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';

export interface TrendPoint {
  /** Axis label, e.g. "12 Nov". */
  label: string;
  /** Long label for the tooltip, e.g. "Wednesday, 12 November". */
  fullLabel?: string;
  value: number;
}

export interface AreaTrendChartProps {
  data: TrendPoint[];
  /** Name of the series (tooltip + screen readers), e.g. "Present". */
  seriesLabel: string;
  height?: number;
  /** Which chart token to use (1-5). */
  color?: 1 | 2 | 3 | 4 | 5;
  ariaLabel: string;
}

function ChartTooltip({ active, payload, seriesLabel }: TooltipContentProps & { seriesLabel: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as TrendPoint | undefined;
  if (!point) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-medium text-foreground">{point.fullLabel ?? point.label}</p>
      <p className="flex items-center gap-2 text-muted-foreground">
        <span className="size-2 rounded-full bg-chart-1" aria-hidden="true" />
        {seriesLabel}
        <span className="font-figure ml-2 font-semibold text-foreground">{point.value.toLocaleString()}</span>
      </p>
    </div>
  );
}

/** Calm single-series area chart on the design tokens; light/dark aware via CSS variables. */
export function AreaTrendChart({ data, seriesLabel, height = 260, color = 1, ariaLabel }: AreaTrendChartProps) {
  const id = React.useId().replace(/:/g, '');
  const stroke = `rgb(var(--chart-${color}))`;
  const peak = data.reduce((m, d) => (d.value > m.value ? d : m), data[0] ?? { label: '-', value: 0 });
  return (
    <figure aria-label={ariaLabel} className="m-0">
      <figcaption className="sr-only">
        {ariaLabel}. {data.length} data points; highest {peak.value.toLocaleString()} on {peak.fullLabel ?? peak.label}.
      </figcaption>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgb(var(--chart-grid))" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={24}
              tick={{ fill: 'rgb(var(--muted-foreground))', fontSize: 12 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={44}
              tick={{ fill: 'rgb(var(--muted-foreground))', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ stroke: 'rgb(var(--border-strong))', strokeDasharray: '3 3' }}
              content={(p) => <ChartTooltip {...p} seriesLabel={seriesLabel} />}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={seriesLabel}
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#fill-${id})`}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--card))', fill: stroke }}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

