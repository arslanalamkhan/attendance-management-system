import { Link } from 'react-router-dom';
import { CalendarClock, CalendarOff, CalendarX2, Clock3, UserCheck } from 'lucide-react';
import type { Dashboard } from '@nacta/shared';
import { StatCard, type StatTone } from '../../components/ui/stat-card';
import { dailyHref, sharePct, type SeriesKey, type TodayCounts } from './dashboard-ui';

interface Tile {
  key: SeriesKey;
  label: string;
  icon: React.ReactNode;
  tone: StatTone;
  series?: (t: Dashboard['trend'][number]) => number;
}

const TILES: Tile[] = [
  { key: 'present', label: 'Present', icon: <UserCheck />, tone: 'success', series: (t) => t.present },
  { key: 'late', label: 'Late', icon: <Clock3 />, tone: 'warning', series: (t) => t.late },
  { key: 'leave', label: 'On leave', icon: <CalendarOff />, tone: 'info', series: (t) => t.onLeave },
  { key: 'absent', label: 'Absent', icon: <CalendarX2 />, tone: 'danger', series: (t) => t.absent },
  { key: 'pending', label: 'Not in yet', icon: <CalendarClock />, tone: 'neutral' },
];

/** The five headline numbers for today. Each tile opens Daily attendance filtered to that status. */
export function KpiRow({ counts, trend, wingId, loading }: { counts?: TodayCounts; trend?: Dashboard['trend']; wingId: number | null; loading?: boolean }) {
  const working = (trend ?? []).filter((t) => t.workingDay);
  return (
    <section aria-label="Today's key figures" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
      {TILES.map((t, i) => {
        const n = counts?.[t.key] ?? 0;
        const share = counts ? sharePct(n, counts.headcount) : 0;
        const card = (
          <StatCard
            className="h-full transition-shadow duration-150 group-hover:shadow-md"
            loading={loading || !counts}
            label={t.label}
            icon={t.icon}
            tone={t.tone}
            value={n.toLocaleString()}
            footnote={counts ? `${share}% of ${counts.headcount.toLocaleString()} employees` : undefined}
            sparkline={t.series ? working.map(t.series) : undefined}
          />
        );
        const cls = i === 4 ? 'col-span-2 md:col-span-1' : '';
        if (loading || !counts) return <div key={t.key} className={cls}>{card}</div>;
        return (
          <Link
            key={t.key}
            to={dailyHref(t.key, wingId)}
            aria-label={`${t.label}: ${n.toLocaleString()}, ${share}% of headcount. Open daily attendance filtered to ${t.label.toLowerCase()}.`}
            className={`group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${cls}`}
          >
            {card}
          </Link>
        );
      })}
    </section>
  );
}
