import * as React from 'react';
import type { Dashboard } from '@nacta/shared';
import { parseYmd } from '../../lib/dates';
import { AttendanceTrendChart, type AttendanceTrendPoint } from '../../components/charts/attendance-trend-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { cn } from '../../lib/utils';

const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

function Key({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        <span className={cn('size-2 rounded-full', swatch)} aria-hidden="true" />
        {label}
      </p>
      <p className="font-figure text-lg font-semibold leading-tight tracking-tight">{value}</p>
    </div>
  );
}

/** 30-day attendance and punctuality rates. Weekends and holidays are skipped, not drawn as zeros. */
export function TrendCard({ trend, loading, className }: { trend?: Dashboard['trend']; loading?: boolean; className?: string }) {
  const { points, skipped, avgA, avgP } = React.useMemo(() => {
    const working = (trend ?? []).filter((t) => t.workingDay);
    const pts: AttendanceTrendPoint[] = working.map((t) => ({
      label: shortFmt.format(parseYmd(t.date)),
      fullLabel: longFmt.format(parseYmd(t.date)),
      attendanceRate: t.attendanceRate,
      punctualityRate: t.punctualityRate,
      present: t.present,
      late: t.late,
      absent: t.absent,
      onLeave: t.onLeave,
    }));
    const mean = (k: 'attendanceRate' | 'punctualityRate') => (pts.length ? pts.reduce((s, p) => s + p[k], 0) / pts.length : 0);
    return { points: pts, skipped: (trend?.length ?? 0) - working.length, avgA: mean('attendanceRate'), avgP: mean('punctualityRate') };
  }, [trend]);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <div>
          <CardTitle>30-day trend</CardTitle>
          <CardDescription>
            Attendance and punctuality rate per working day{skipped > 0 ? `; ${skipped} weekend and holiday ${skipped === 1 ? 'day is' : 'days are'} skipped` : ''}.
          </CardDescription>
        </div>
        {!loading && points.length > 0 && (
          <div className="flex shrink-0 gap-5">
            <Key swatch="bg-chart-1" label="Attendance" value={`${avgA.toFixed(1)}%`} />
            <Key swatch="bg-chart-3" label="Punctuality" value={`${avgP.toFixed(1)}%`} />
          </div>
        )}
      </CardHeader>
      <CardContent className="flex min-h-[300px] flex-1 flex-col pt-4">
        {loading ? (
          <Skeleton className="w-full flex-1" />
        ) : points.length === 0 ? (
          <p className="grid flex-1 place-content-center text-[13px] text-muted-foreground">No working days in the last 30 days yet.</p>
        ) : (
          <AttendanceTrendChart data={points} height="100%" ariaLabel="Attendance and punctuality rate over the last 30 days" />
        )}
      </CardContent>
    </Card>
  );
}
