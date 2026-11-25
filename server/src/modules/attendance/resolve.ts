import type { AttendanceDay } from '@nacta/shared';
import { weekdayOf } from '../../lib/dates';

// Pure helpers that decide WHICH rules apply to an employee on a date. No I/O.

export interface DayHours {
  start: string;
  end: string;
}

/** One version of a profile's rules. */
export interface TimingVersionRules {
  /** YYYY-MM-DD */
  effectiveFrom: string;
  /** Index 0..6 = Sunday..Saturday; null = day off. */
  days: (DayHours | null)[];
  graceLate: number;
  graceEarly: number;
  halfDayBelow: number;
}

export interface ProfileRules {
  id: number;
  name: string;
  isDefault: boolean;
  versions: TimingVersionRules[];
}

export interface AssignmentRule {
  id: number;
  profileId: number;
  scope: 'all' | 'wing' | 'employee';
  scopeId: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface HolidayRule {
  id: number;
  name: string;
  from: string;
  to: string;
  kind: 'holiday' | 'working_day';
  /** Empty = every wing. */
  wingIds: number[];
}

/** The rules in force for one employee on one date. */
export interface ResolvedTiming {
  profileId: number;
  profileName: string;
  days: (DayHours | null)[];
  graceLate: number;
  graceEarly: number;
  halfDayBelow: number;
}

/** Used only if the database somehow has no default profile. */
export const BUILT_IN_TIMING: ResolvedTiming = {
  profileId: 0,
  profileName: 'Standard office hours',
  days: [null, ...Array.from({ length: 5 }, () => ({ start: '09:00', end: '17:00' })), null],
  graceLate: 15,
  graceEarly: 15,
  halfDayBelow: 240,
};

/** The version with the latest effectiveFrom <= date; before the first version, the first one. */
export function versionOn(profile: ProfileRules, date: string): TimingVersionRules | null {
  let best: TimingVersionRules | null = null;
  let earliest: TimingVersionRules | null = null;
  for (const v of profile.versions) {
    if (!earliest || v.effectiveFrom < earliest.effectiveFrom) earliest = v;
    if (v.effectiveFrom <= date && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  }
  return best ?? earliest;
}

const covers = (a: AssignmentRule, date: string): boolean => a.effectiveFrom <= date && (a.effectiveTo === null || date <= a.effectiveTo);

/**
 * Most specific first: employee > wing > organisation-wide > default profile. Within a level a dated assignment
 * (has effectiveTo) beats an open-ended one; ties -> latest effectiveFrom, then highest id.
 */
export function pickAssignment(assignments: AssignmentRule[], emp: { id: number; wingId: number | null }, date: string): AssignmentRule | null {
  const levels: ((a: AssignmentRule) => boolean)[] = [
    (a) => a.scope === 'employee' && a.scopeId === emp.id,
    (a) => a.scope === 'wing' && emp.wingId !== null && a.scopeId === emp.wingId,
    (a) => a.scope === 'all',
  ];
  for (const level of levels) {
    const hits = assignments.filter((a) => level(a) && covers(a, date));
    if (!hits.length) continue;
    hits.sort(
      (a, b) =>
        Number(b.effectiveTo !== null) - Number(a.effectiveTo !== null) ||
        (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0) ||
        b.id - a.id,
    );
    return hits[0] as AssignmentRule;
  }
  return null;
}

export function resolveTiming(
  profiles: ProfileRules[],
  assignments: AssignmentRule[],
  emp: { id: number; wingId: number | null },
  date: string,
): ResolvedTiming {
  const a = pickAssignment(assignments, emp, date);
  const profile = (a ? profiles.find((p) => p.id === a.profileId) : undefined) ?? profiles.find((p) => p.isDefault);
  const v = profile ? versionOn(profile, date) : null;
  if (!profile || !v) return BUILT_IN_TIMING;
  return { profileId: profile.id, profileName: profile.name, days: v.days, graceLate: v.graceLate, graceEarly: v.graceEarly, halfDayBelow: v.halfDayBelow };
}

/** Holidays / special working days covering `date` that apply to the wing. */
export function holidaysFor(holidays: HolidayRule[], wingId: number | null, date: string): HolidayRule[] {
  return holidays.filter((h) => h.from <= date && date <= h.to && (h.wingIds.length === 0 || (wingId !== null && h.wingIds.includes(wingId))));
}

/** Hours worked on a special working day that falls on a day off: the first working weekday of the profile. */
export function fallbackHours(timing: ResolvedTiming): DayHours | null {
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    const h = timing.days[d];
    if (h) return h;
  }
  return null;
}

export type DayKind = { kind: 'holiday'; name: string } | { kind: 'weekend' } | { kind: 'working'; hours: DayHours };

/** Holiday beats everything; a working_day turns a day off into a working day; otherwise the weekday decides. */
export function dayKind(timing: ResolvedTiming, date: string, applicable: Pick<HolidayRule, 'name' | 'kind'>[]): DayKind {
  const hol = applicable.find((h) => h.kind === 'holiday');
  if (hol) return { kind: 'holiday', name: hol.name };
  const own = timing.days[weekdayOf(date)] ?? null;
  if (own) return { kind: 'working', hours: own };
  if (applicable.some((h) => h.kind === 'working_day')) {
    const h = fallbackHours(timing);
    if (h) return { kind: 'working', hours: h };
  }
  return { kind: 'weekend' };
}

/** Working days a leave covers (weekends and holidays excluded; a half day counts 0.5). */
export function workingDaysIn(
  range: { from: string; to: string; part: 'full' | 'first_half' | 'second_half' },
  dates: string[],
  timingOn: (date: string) => ResolvedTiming,
  holidaysOn: (date: string) => Pick<HolidayRule, 'name' | 'kind'>[],
): number {
  let n = 0;
  for (const d of dates) {
    if (d < range.from || d > range.to) continue;
    if (dayKind(timingOn(d), d, holidaysOn(d)).kind === 'working') n += range.part === 'full' ? 1 : 0.5;
  }
  return n;
}

export type EngineOnly = Pick<AttendanceDay, 'status'>;
