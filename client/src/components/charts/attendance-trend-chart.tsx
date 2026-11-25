import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';

export interface AttendanceTrendPoint {
  /** Axis label, e.g. "12 Nov". */
  label: string;
  /** Tooltip heading, e.g. "Wednesday, 12 November". */
  fullLabel: string;
  attendanceRate: number;
  punctualityRate: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
}

export interface AttendanceTrendChartProps {
  data: AttendanceTrendPoint[];
  height?: number | string;
  ariaLabel: string;
}

const pct = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

function TrendTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as AttendanceTrendPoint | undefined;
  if (!p) return null;
  return (
    <div className="min-w-[13rem] rounded-lg border bg-popover px-3 py-2.5 text-xs shadow-pop">
      <p className="mb-2 font-medium text-foreground">{p.fullLabel}</p>
      <dl className="space-y-1.5">
        <div className="flex items-center justify-between gap-6">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-full bg-chart-1" aria-hidden="true" />
            Attendance
          </dt>
          <dd className="font-figure font-semibold text-foreground">{pct(p.attendanceRate)}</dd>
        </div>
        <div className="flex items-center justify-between gap-6">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-full bg-chart-3" aria-hidden="true" />
            Punctuality
          </dt>
          <dd className="font-figure font-semibold text-foreground">{pct(p.punctualityRate)}</dd>
        </div>
      </dl>
      <p className="font-figure mt-2 border-t pt-2 text-muted-foreground">
        {p.present.toLocaleString()} present {'·'} {p.late.toLocaleString()} late {'·'} {p.onLeave.toLocaleString()} on leave {'·'} {p.absent.toLocaleString()} absent
      </p>
    </div>
  );
}

/** Attendance and punctuality rate over time on the chart tokens; light/dark aware. Callers pass working days only. */
export function AttendanceTrendChart({ data, height = 260, ariaLabel }: AttendanceTrendChartProps) {
  const id = React.useId().replace(/:/g, '');
  const lowest = data.reduce((m, d) => Math.min(m, d.attendanceRate, d.punctualityRate), 100);
  const floor = Math.max(0, Math.floor((lowest - 6) / 10) * 10);
  const avg = (k: 'attendanceRate' | 'punctualityRate') => (data.length ? data.reduce((s, d) => s + d[k], 0) / data.length : 0);
  const worst = data.reduce<AttendanceTrendPoint | null>((m, d) => (!m || d.attendanceRate < m.attendanceRate ? d : m), null);
  const c1 = 'rgb(var(--chart-1))';
  const c3 = 'rgb(var(--chart-3))';
  return (
    <figure aria-label={ariaLabel} className="m-0 h-full">
      <figcaption className="sr-only">
        {ariaLabel}. {data.length} working days. Average attendance {pct(avg('attendanceRate'))}, average punctuality {pct(avg('punctualityRate'))}.
        {worst ? ` Lowest attendance was ${pct(worst.attendanceRate)} on ${worst.fullLabel}.` : ''}
      </figcaption>
      <div style={{ height }} className="h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id={`att-${id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={c1} stopOpacity={0.26} />
                <stop offset="100%" stopColor={c1} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgb(var(--chart-grid))" strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} tick={{ fill: 'rgb(var(--muted-foreground))', fontSize: 12 }} />
            <YAxis
              domain={[floor, 100]}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: 'rgb(var(--muted-foreground))', fontSize: 12 }}
            />
            <Tooltip cursor={{ stroke: 'rgb(var(--border-strong))', strokeDasharray: '3 3' }} content={(p) => <TrendTooltip {...p} />} />
            <Area
              type="monotone"
              dataKey="attendanceRate"
              name="Attendance rate"
              stroke={c1}
              strokeWidth={2}
              fill={`url(#att-${id})`}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--card))', fill: c1 }}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="punctualityRate"
              name="Punctuality rate"
              stroke={c3}
              strokeWidth={2}
              strokeDasharray="5 3"
              fill="none"
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--card))', fill: c3 }}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
