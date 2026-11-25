/**
 * DEV-ONLY mock of the Phase G endpoints: GET /dashboard, GET /reports/:type and GET /reports/:type/export.
 * Everything is computed from the same deterministic attendance engine as the Daily attendance mock (rules-mock.ts),
 * so a number on the dashboard matches what the Daily page and the reports show. Never part of a production bundle.
 * Demo hook: open with ?mockNoDashboard=1 to see the dashboard's fallback to the basic overview.
 */
import { DAY_STATUS_CODE, DAY_STATUS_LABEL, DAY_STATUSES, REPORT_TYPES, REPORT_TYPE_KEYS, zReportParams } from '@nacta/shared';
import type { AttendanceDay, Dashboard, DayStatus, Permission, ReportColumn, ReportResult, ReportType, StatusCell } from '@nacta/shared';
import { addDaysYmd, endOfMonthYmd, formatDate, parseYmd, todayYmd } from '../lib/dates';
import { MOCK_DEVICES } from './audit-mock-data';
import { getMockEngine } from './rules-mock';

type Handler = (ctx: { method: string; query: URLSearchParams; body: any; params: string[] }) => Response | Promise<Response>;
export interface ReportsMockContext {
  can: (p: Permission) => boolean;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'mock-req' } });
const err = (status: number, code: string, message: string, details?: unknown) => json(status, { error: { code, message, details } });
const forbidden = () => err(403, 'FORBIDDEN', 'You do not have permission');
const pad = (n: number) => String(n).padStart(2, '0');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function hash(a: number, b: number, salt = 0): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (salt * 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}
const dayNum = (ymd: string) => Math.floor(parseYmd(ymd).getTime() / 86_400_000);
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const longRange = (from: string, to: string) => (from === to ? formatDate(from) : `${formatDate(from)} - ${formatDate(to)}`);

function days(from: string, to: string, cap = 100): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < cap; d = addDaysYmd(d, 1)) out.push(d);
  return out;
}

export function createReportsRoutes(ctx: ReportsMockContext): [RegExp, Handler][] {
  const E = getMockEngine();
  const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

  const statusCell = (d: AttendanceDay): StatusCell =>
    d.leave && d.status === 'leave' ? { code: d.leave.code, label: d.leave.typeName, color: d.leave.color } : { code: DAY_STATUS_CODE[d.status], label: DAY_STATUS_LABEL[d.status] };

  const scoped = (q: URLSearchParams) => {
    const wing = Number(q.get('wingId')) || null;
    const section = Number(q.get('sectionId')) || null;
    return E.activeRoster().filter((e) => (!wing || e.wingId === wing) && (!section || e.sectionId === section));
  };
  const scopeLabel = (q: URLSearchParams) => {
    const wing = Number(q.get('wingId')) || null;
    const section = Number(q.get('sectionId')) || null;
    if (!wing) return 'All wings';
    return [E.wingNameOf(wing), section ? E.sectionNameOf(wing, section) : null].filter(Boolean).join(' / ');
  };
  const person = (d: { employeeId: number; name: string; hasPhoto: boolean }) => ({ employeeId: d.employeeId, name: d.name, hasPhoto: d.hasPhoto });
  const hoursOf = (m: number) => Math.round((m / 60) * 100) / 100;

  // legend of every code that appears, in a stable order
  const legendOf = (cells: StatusCell[]): StatusCell[] => {
    const seen = new Map<string, StatusCell>();
    for (const c of cells) if (c.code && !seen.has(`${c.code}|${c.label}`)) seen.set(`${c.code}|${c.label}`, c);
    const order = (c: StatusCell) => {
      const i = DAY_STATUSES.findIndex((s) => DAY_STATUS_CODE[s] === c.code);
      return i === -1 ? 99 : i;
    };
    return [...seen.values()].sort((a, b) => order(a) - order(b) || a.code.localeCompare(b.code));
  };

  // ------------------------------------------------------------------ dashboard
  let liveTick = 0;
  const synthetic: Dashboard['liveFeed'] = [];

  function dashboard(): Dashboard {
    const today = todayYmd();
    const roster = E.activeRoster();
    const todays = roster.map((e) => E.computeDay(e, today));
    const counts: Record<string, number> = {};
    for (const d of todays) counts[d.status] = (counts[d.status] ?? 0) + 1;

    const byWingMap = new Map<number | null, Dashboard['byWing'][number]>();
    todays.forEach((d, i) => {
      const e = roster[i]!;
      let w = byWingMap.get(e.wingId);
      if (!w) {
        w = { wingId: e.wingId, wingName: E.wingNameOf(e.wingId) ?? 'Unassigned', headcount: 0, present: 0, late: 0, onLeave: 0, absent: 0, pending: 0 };
        byWingMap.set(e.wingId, w);
      }
      w.headcount++;
      if (d.status === 'present' || d.status === 'half_day' || d.status === 'incomplete') w.present++;
      else if (d.status === 'late') w.late++;
      else if (d.status === 'leave') w.onLeave++;
      else if (d.status === 'absent') w.absent++;
      else if (d.status === 'pending') w.pending++;
    });
    const byWing = [...byWingMap.values()].sort((a, b) => b.headcount - a.headcount);

    // 30-day trend and late-comers
    const lateBy = new Map<number, { n: number; minutes: number }>();
    const trend: Dashboard['trend'] = days(addDaysYmd(today, -29), today).map((date) => {
      let present = 0, late = 0, absent = 0, onLeave = 0, off = 0, pending = 0;
      for (const e of roster) {
        const d = E.computeDay(e, date);
        if (d.status === 'present' || d.status === 'half_day' || d.status === 'incomplete') present++;
        else if (d.status === 'late') {
          late++;
          const cur = lateBy.get(e.id) ?? { n: 0, minutes: 0 };
          cur.n++;
          cur.minutes += d.lateMinutes;
          lateBy.set(e.id, cur);
        } else if (d.status === 'absent') absent++;
        else if (d.status === 'leave') onLeave++;
        else if (d.status === 'pending') pending++;
        else off++;
      }
      const workingDay = off < roster.length * 0.9;
      const attended = present + late;
      const expected = attended + absent;
      return {
        date,
        workingDay,
        present,
        late,
        absent,
        onLeave,
        attendanceRate: workingDay && expected > 0 ? Math.round((attended / expected) * 1000) / 10 : 0,
        punctualityRate: workingDay && attended > 0 ? Math.round((present / attended) * 1000) / 10 : 0,
      };
    });
    const topLate: Dashboard['topLate'] = [...lateBy.entries()]
      .sort((a, b) => b[1].n - a[1].n || b[1].minutes - a[1].minutes)
      .slice(0, 8)
      .map(([id, v]) => {
        const e = roster.find((x) => x.id === id)!;
        return { employeeId: id, empCode: e.empCode, name: e.name, wingName: E.wingNameOf(e.wingId), hasPhoto: e.hasPhoto, lateDays: v.n, avgLateMinutes: Math.round(v.minutes / v.n) };
      });

    // live feed: today's real punches plus a simulated new one on every refresh so the flash can be seen
    const methods = [1, 15, 15, 1, 4];
    const devices = MOCK_DEVICES.filter((x) => x.status === 'online');
    const punches: Dashboard['liveFeed'] = [];
    todays.forEach((d, i) => {
      const e = roster[i]!;
      const times = [d.firstIn, d.lastOut].filter((t): t is string => Boolean(t));
      times.forEach((t, k) => {
        const sec = Math.floor(hash(e.id, k, 9) * 60);
        punches.push({
          id: e.id * 10 + k,
          employeeId: e.id,
          name: e.name,
          empCode: e.empCode,
          hasPhoto: e.hasPhoto,
          wingName: E.wingNameOf(e.wingId),
          time: `${today} ${t}:${pad(sec)}`,
          verifyType: methods[Math.floor(hash(e.id, k, 4) * methods.length)] ?? 1,
          deviceName: devices[Math.floor(hash(e.id, k, 5) * devices.length)]?.name ?? 'Main Gate Terminal',
        });
      });
    });
    liveTick++;
    if (liveTick > 1) {
      const e = roster[(liveTick * 7) % roster.length]!;
      const n = new Date();
      synthetic.unshift({
        id: 900_000 + liveTick,
        employeeId: e.id,
        name: e.name,
        empCode: e.empCode,
        hasPhoto: e.hasPhoto,
        wingName: E.wingNameOf(e.wingId),
        time: `${today} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`,
        verifyType: liveTick % 2 ? 15 : 1,
        deviceName: devices[liveTick % devices.length]?.name ?? 'Main Gate Terminal',
      });
      synthetic.length = Math.min(synthetic.length, 4);
    }
    const liveFeed = [...synthetic, ...punches.sort((a, b) => b.time.localeCompare(a.time))].slice(0, 15);

    const onLeaveToday: Dashboard['onLeaveToday'] = todays
      .filter((d) => d.status === 'leave' && d.leave)
      .slice(0, 10)
      .map((d) => ({ employeeId: d.employeeId, name: d.name, empCode: d.empCode, hasPhoto: d.hasPhoto, typeName: d.leave!.typeName, code: d.leave!.code, color: d.leave!.color }));

    return {
      date: today,
      today: counts,
      headcount: roster.length,
      byWing,
      trend,
      topLate,
      liveFeed,
      devices: MOCK_DEVICES.map((d) => ({ id: d.id, name: d.name, status: d.status, lastSeenAt: d.status === 'online' ? iso(1 + d.id) : iso(190) })),
      onLeaveToday,
    };
  }

  // ------------------------------------------------------------------ reports
  type Built = Omit<ReportResult, 'type' | 'page' | 'pageSize' | 'generatedAt' | 'total'> & { rowsAll: Record<string, unknown>[] };

  const col = (key: string, label: string, kind: ReportColumn['kind'], extra: Partial<ReportColumn> = {}): ReportColumn => ({ key, label, kind, ...extra });

  function daily(q: URLSearchParams): Built {
    const date = q.get('date') ?? todayYmd();
    const status = q.get('status');
    let list = scoped(q).map((e) => E.computeDay(e, date));
    if (status) list = list.filter((d) => d.status === status);
    list.sort((a, b) => a.name.localeCompare(b.name));
    const all = scoped(q).map((e) => E.computeDay(e, date));
    const n = (s: DayStatus) => all.filter((d) => d.status === s).length;
    const worked = n('present') + n('late') + n('half_day');
    const expected = worked + n('absent') + n('incomplete');
    const rows = list.map((d) => ({
      ...person(d),
      empCode: d.empCode,
      wing: d.wingName,
      status: statusCell(d),
      firstIn: d.firstIn,
      lastOut: d.lastOut,
      worked: d.workedMinutes > 0 ? hoursOf(d.workedMinutes) : null,
      late: d.lateMinutes > 0 ? d.lateMinutes : null,
      early: d.earlyLeave && d.earlyMinutes > 0 ? d.earlyMinutes : null,
      leave: d.leave ? `${d.leave.code} ${d.leave.typeName}` : null,
    }));
    return {
      title: 'Daily attendance',
      subtitle: `${scopeLabel(q)} | ${longRange(date, date)}`,
      columns: [
        col('name', 'Employee', 'text'),
        col('empCode', 'Code', 'mono'),
        col('wing', 'Wing', 'text'),
        col('status', 'Status', 'status'),
        col('firstIn', 'In', 'time'),
        col('lastOut', 'Out', 'time'),
        col('worked', 'Worked', 'hours'),
        col('late', 'Late', 'minutes'),
        col('early', 'Early', 'minutes'),
        col('leave', 'Leave', 'text'),
      ],
      rowsAll: rows,
      rows: [],
      totals: { name: 'Total', worked: hoursOf(list.reduce((s, d) => s + d.workedMinutes, 0)), late: list.reduce((s, d) => s + d.lateMinutes, 0), early: list.reduce((s, d) => s + (d.earlyLeave ? d.earlyMinutes : 0), 0) },
      highlights: [
        { label: 'Employees', value: String(all.length) },
        { label: 'Present', value: String(n('present')) },
        { label: 'Late', value: String(n('late')) },
        { label: 'On leave', value: String(n('leave')) },
        { label: 'Absent', value: String(n('absent')) },
        { label: 'Attendance rate', value: expected ? `${((worked / expected) * 100).toFixed(1)}%` : '-' },
      ],
      legend: legendOf(list.map(statusCell)),
    };
  }

  function register(q: URLSearchParams): Built {
    const month = /^\d{4}-\d{2}$/.test(q.get('month') ?? '') ? (q.get('month') as string) : todayYmd().slice(0, 7);
    const first = `${month}-01`;
    const dates = days(first, endOfMonthYmd(first), 31);
    const roster = scoped(q).sort((a, b) => a.name.localeCompare(b.name));
    const cells: StatusCell[] = [];
    const dayTotals: Record<string, number> = {};
    const sums = { P: 0, L: 0, A: 0, LV: 0, H: 0, M: 0 };
    const rows = roster.map((e) => {
      const row: Record<string, unknown> = { employeeId: e.id, hasPhoto: e.hasPhoto, name: e.name, empCode: e.empCode };
      const t = { P: 0, L: 0, A: 0, LV: 0, H: 0, M: 0, minutes: 0 };
      for (const date of dates) {
        const d = E.computeDay(e, date);
        const c = statusCell(d);
        row[`d${date.slice(8)}`] = c;
        cells.push(c);
        if (d.status === 'present') t.P++;
        else if (d.status === 'late') t.L++;
        else if (d.status === 'absent') t.A++;
        else if (d.status === 'leave') t.LV++;
        else if (d.status === 'half_day') t.H++;
        else if (d.status === 'incomplete') t.M++;
        if (d.status === 'present' || d.status === 'late') dayTotals[`d${date.slice(8)}`] = (dayTotals[`d${date.slice(8)}`] ?? 0) + 1;
        t.minutes += d.workedMinutes;
      }
      row.present = t.P;
      row.late = t.L;
      row.half = t.H;
      row.leave = t.LV;
      row.absent = t.A;
      row.hours = hoursOf(t.minutes);
      for (const k of Object.keys(sums) as (keyof typeof sums)[]) sums[k] += t[k];
      return row;
    });
    const dayCols = dates.map((date) => col(`d${date.slice(8)}`, String(Number(date.slice(8))), 'day_code', { group: WEEKDAY[parseYmd(date).getDay()]!, align: 'center' }));
    const monthName = parseYmd(first).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return {
      title: 'Monthly attendance register',
      subtitle: `${scopeLabel(q)} | ${monthName}`,
      columns: [
        col('name', 'Employee', 'text'),
        col('empCode', 'Code', 'mono'),
        ...dayCols,
        col('present', 'P', 'number'),
        col('late', 'L', 'number'),
        col('half', 'H', 'number'),
        col('leave', 'LV', 'number'),
        col('absent', 'A', 'number'),
        col('hours', 'Hours', 'hours'),
      ],
      rowsAll: rows,
      rows: [],
      totals: { name: 'Present + late', ...dayTotals, present: sums.P, late: sums.L, half: sums.H, leave: sums.LV, absent: sums.A },
      highlights: [
        { label: 'Employees', value: String(roster.length) },
        { label: 'Present days', value: sums.P.toLocaleString() },
        { label: 'Late days', value: sums.L.toLocaleString() },
        { label: 'Leave days', value: sums.LV.toLocaleString() },
        { label: 'Absent days', value: sums.A.toLocaleString() },
      ],
      legend: legendOf(cells),
    };
  }

  function range(q: URLSearchParams) {
    const to = q.get('to') ?? todayYmd();
    const from = q.get('from') ?? `${to.slice(0, 8)}01`;
    return { from, to, dates: days(from, to, 92) };
  }

  function lateComers(q: URLSearchParams): Built {
    const { from, to, dates } = range(q);
    const min = Number(q.get('minLateMinutes')) || 0;
    const roster = scoped(q);
    const rows: Record<string, unknown>[] = [];
    const per = new Map<string, number>();
    let minutes = 0;
    for (const date of dates) {
      for (const e of roster) {
        const d = E.computeDay(e, date);
        if (d.status !== 'late' || d.lateMinutes < min) continue;
        minutes += d.lateMinutes;
        per.set(e.name, (per.get(e.name) ?? 0) + 1);
        rows.push({ ...person(d), empCode: d.empCode, wing: d.wingName, date, start: d.timing?.start ?? null, firstIn: d.firstIn, late: d.lateMinutes, timing: d.timing?.profileName ?? null });
      }
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.late) - Number(a.late));
    const worst = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      title: 'Late comers',
      subtitle: `${scopeLabel(q)} | ${longRange(from, to)}${min ? ` | at least ${min} min late` : ''}`,
      columns: [col('name', 'Employee', 'text'), col('empCode', 'Code', 'mono'), col('wing', 'Wing', 'text'), col('date', 'Date', 'date'), col('start', 'Start', 'time'), col('firstIn', 'Arrived', 'time'), col('late', 'Minutes late', 'minutes'), col('timing', 'Timing', 'text')],
      rowsAll: rows,
      rows: [],
      totals: { name: 'Total', late: minutes },
      highlights: [
        { label: 'Late arrivals', value: rows.length.toLocaleString() },
        { label: 'Employees', value: String(per.size) },
        { label: 'Average minutes', value: rows.length ? `${Math.round(minutes / rows.length)}m` : '-' },
        { label: 'Most often late', value: worst ? `${worst[0]} (${worst[1]})` : '-' },
      ],
      legend: [],
    };
  }

  function absentees(q: URLSearchParams): Built {
    const { from, to, dates } = range(q);
    const roster = scoped(q);
    const rows: Record<string, unknown>[] = [];
    const per = new Map<string, number>();
    for (const date of dates) {
      for (const e of roster) {
        const d = E.computeDay(e, date);
        if (d.status !== 'absent') continue;
        per.set(e.name, (per.get(e.name) ?? 0) + 1);
        rows.push({ ...person(d), empCode: d.empCode, wing: d.wingName, section: d.sectionName, designation: d.designation, date, status: statusCell(d) });
      }
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.name).localeCompare(String(b.name)));
    const worst = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      title: 'Absentees',
      subtitle: `${scopeLabel(q)} | ${longRange(from, to)}`,
      columns: [col('name', 'Employee', 'text'), col('empCode', 'Code', 'mono'), col('wing', 'Wing', 'text'), col('section', 'Section', 'text'), col('designation', 'Designation', 'text'), col('date', 'Date', 'date'), col('status', 'Status', 'status')],
      rowsAll: rows,
      rows: [],
      totals: { name: 'Total absences', status: null, date: null },
      highlights: [
        { label: 'Absences', value: rows.length.toLocaleString() },
        { label: 'Employees', value: String(per.size) },
        { label: 'Most absences', value: worst ? `${worst[0]} (${worst[1]})` : '-' },
      ],
      legend: [{ code: DAY_STATUS_CODE.absent, label: DAY_STATUS_LABEL.absent }],
    };
  }

  function wingSummary(q: URLSearchParams): Built {
    const { from, to, dates } = range(q);
    const roster = E.activeRoster();
    const wings = [...new Set(roster.map((e) => e.wingId))];
    const rows = wings.map((wingId) => {
      const members = roster.filter((e) => e.wingId === wingId);
      let present = 0, late = 0, leave = 0, absent = 0;
      for (const date of dates)
        for (const e of members) {
          const s = E.computeDay(e, date).status;
          if (s === 'present' || s === 'half_day' || s === 'incomplete') present++;
          else if (s === 'late') late++;
          else if (s === 'leave') leave++;
          else if (s === 'absent') absent++;
        }
      const attended = present + late;
      return { wing: E.wingNameOf(wingId) ?? 'Unassigned', headcount: members.length, present, late, leave, absent, attendance: attended + absent ? Math.round((attended / (attended + absent)) * 1000) / 10 : 0, punctuality: attended ? Math.round((present / attended) * 1000) / 10 : 0 };
    });
    rows.sort((a, b) => b.headcount - a.headcount);
    const tot = rows.reduce((s, r) => ({ headcount: s.headcount + r.headcount, present: s.present + r.present, late: s.late + r.late, leave: s.leave + r.leave, absent: s.absent + r.absent }), { headcount: 0, present: 0, late: 0, leave: 0, absent: 0 });
    const att = tot.present + tot.late;
    const attendance = att + tot.absent ? Math.round((att / (att + tot.absent)) * 1000) / 10 : 0;
    const punctuality = att ? Math.round((tot.present / att) * 1000) / 10 : 0;
    return {
      title: 'Wing summary',
      subtitle: `All wings | ${longRange(from, to)}`,
      columns: [col('wing', 'Wing', 'text'), col('headcount', 'Headcount', 'number'), col('present', 'Present', 'number'), col('late', 'Late', 'number'), col('leave', 'On leave', 'number'), col('absent', 'Absent', 'number'), col('attendance', 'Attendance rate', 'percent'), col('punctuality', 'Punctuality', 'percent')],
      rowsAll: rows,
      rows: [],
      totals: { wing: 'All wings', ...tot, attendance, punctuality },
      highlights: [
        { label: 'Attendance rate', value: `${attendance.toFixed(1)}%` },
        { label: 'Punctuality rate', value: `${punctuality.toFixed(1)}%` },
        { label: 'Wings', value: String(rows.length) },
        { label: 'Employees', value: String(tot.headcount) },
      ],
      legend: [],
    };
  }

  function timeCard(q: URLSearchParams): Built {
    const { from, to, dates } = range(q);
    const e = E.activeRoster().find((x) => x.id === Number(q.get('employeeId')));
    if (!e) return { title: 'Individual time card', subtitle: 'Employee not found', columns: [], rowsAll: [], rows: [], totals: null, highlights: [], legend: [] };
    const list = dates.map((date) => E.computeDay(e, date));
    const rows = list.map((d) => ({
      date: d.date,
      weekday: WEEKDAY[parseYmd(d.date).getDay()],
      status: statusCell(d),
      firstIn: d.firstIn,
      lastOut: d.lastOut,
      worked: d.workedMinutes > 0 ? hoursOf(d.workedMinutes) : null,
      late: d.lateMinutes > 0 ? d.lateMinutes : null,
      early: d.earlyLeave && d.earlyMinutes > 0 ? d.earlyMinutes : null,
      leave: d.leave ? `${d.leave.code} ${d.leave.typeName}` : null,
    }));
    const n = (s: DayStatus) => list.filter((d) => d.status === s).length;
    const workedDays = list.filter((d) => d.workedMinutes > 0);
    const total = list.reduce((s, d) => s + d.workedMinutes, 0);
    return {
      title: 'Individual time card',
      subtitle: `${e.name} (${e.empCode}) | ${longRange(from, to)}`,
      columns: [col('date', 'Date', 'date'), col('weekday', 'Day', 'text'), col('status', 'Status', 'status'), col('firstIn', 'In', 'time'), col('lastOut', 'Out', 'time'), col('worked', 'Worked', 'hours'), col('late', 'Late', 'minutes'), col('early', 'Early', 'minutes'), col('leave', 'Leave', 'text')],
      rowsAll: rows,
      rows: [],
      totals: { date: 'Total', worked: hoursOf(total), late: list.reduce((s, d) => s + d.lateMinutes, 0), early: list.reduce((s, d) => s + (d.earlyLeave ? d.earlyMinutes : 0), 0) },
      highlights: [
        { label: 'Present', value: String(n('present') + n('half_day')) },
        { label: 'Late', value: String(n('late')) },
        { label: 'On leave', value: String(n('leave')) },
        { label: 'Absent', value: String(n('absent')) },
        { label: 'Hours worked', value: `${Math.floor(total / 60)}h ${total % 60}m` },
        { label: 'Average day', value: workedDays.length ? `${Math.floor(total / workedDays.length / 60)}h ${Math.round((total / workedDays.length) % 60)}m` : '-' },
      ],
      legend: legendOf(list.map(statusCell)),
    };
  }

  function leaveReport(q: URLSearchParams): Built {
    const { from, to } = range(q);
    const typeId = Number(q.get('leaveTypeId')) || null;
    const ids = new Set(scoped(q).map((e) => e.id));
    const list = E.leaveRows().filter((l) => ids.has(l.employeeId) && l.to >= from && l.from <= to && (!typeId || l.leaveTypeId === typeId));
    const roster = E.activeRoster();
    list.sort((a, b) => b.from.localeCompare(a.from));
    const rows = list.map((l) => ({
      employeeId: l.employeeId,
      hasPhoto: roster.find((e) => e.id === l.employeeId)?.hasPhoto ?? false,
      name: l.employeeName,
      empCode: l.empCode,
      wing: l.wingName,
      type: { code: l.leaveTypeCode, label: l.leaveTypeName, color: l.leaveTypeColor } satisfies StatusCell,
      from: l.from,
      to: l.to,
      days: l.workingDays,
      part: l.part === 'full' ? 'Full day' : l.part === 'first_half' ? 'First half' : 'Second half',
      reason: l.reason,
    }));
    const byType = new Map<string, number>();
    for (const l of list) byType.set(l.leaveTypeCode, (byType.get(l.leaveTypeCode) ?? 0) + l.workingDays);
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      title: 'Leave report',
      subtitle: `${scopeLabel(q)} | ${longRange(from, to)}`,
      columns: [col('name', 'Employee', 'text'), col('empCode', 'Code', 'mono'), col('wing', 'Wing', 'text'), col('type', 'Leave type', 'status'), col('from', 'From', 'date'), col('to', 'To', 'date'), col('days', 'Working days', 'number'), col('part', 'Part', 'text'), col('reason', 'Reason', 'text')],
      rowsAll: rows,
      rows: [],
      totals: { name: 'Total', days: list.reduce((s, l) => s + l.workingDays, 0) },
      highlights: [
        { label: 'Leave entries', value: String(list.length) },
        { label: 'Employees', value: String(new Set(list.map((l) => l.employeeId)).size) },
        { label: 'Working days', value: list.reduce((s, l) => s + l.workingDays, 0).toLocaleString() },
        { label: 'Most used', value: top ? `${top[0]} (${top[1]} d)` : '-' },
      ],
      legend: legendOf(rows.map((r) => r.type)),
    };
  }

  function punchLog(q: URLSearchParams): Built {
    const { from, to, dates } = range(q);
    const methods = [1, 15, 15, 1, 4];
    const label: Record<number, string> = { 1: 'Fingerprint', 15: 'Face', 4: 'Card' };
    const wantDevice = Number(q.get('deviceId')) || null;
    const wantEmp = Number(q.get('employeeId')) || null;
    const devices = MOCK_DEVICES.filter((d) => d.status === 'online');
    const rows: Record<string, unknown>[] = [];
    for (const date of dates.slice(-31)) {
      for (const e of scoped(q)) {
        if (wantEmp && e.id !== wantEmp) continue;
        const d = E.computeDay(e, date);
        [d.firstIn, d.lastOut].forEach((t, k) => {
          if (!t) return;
          const dev = devices[Math.floor(hash(e.id, dayNum(date) + k, 5) * devices.length)]!;
          if (wantDevice && dev.id !== wantDevice) return;
          const m = methods[Math.floor(hash(e.id, dayNum(date) + k, 4) * methods.length)] ?? 1;
          rows.push({ ...person(d), time: `${date} ${t}:${pad(Math.floor(hash(e.id, dayNum(date), k) * 60))}`, empCode: d.empCode, wing: d.wingName, type: k === 0 ? 'Check-in' : 'Check-out', method: label[m] ?? 'Other', device: dev.name });
        });
      }
    }
    rows.sort((a, b) => String(b.time).localeCompare(String(a.time)));
    return {
      title: 'Device punch log',
      subtitle: `${scopeLabel(q)} | ${longRange(from, to)}`,
      columns: [col('time', 'Time', 'mono'), col('name', 'Employee', 'text'), col('empCode', 'Code', 'mono'), col('wing', 'Wing', 'text'), col('type', 'Punch', 'text'), col('method', 'Method', 'text'), col('device', 'Device', 'text')],
      rowsAll: rows,
      rows: [],
      totals: null,
      highlights: [
        { label: 'Punches', value: rows.length.toLocaleString() },
        { label: 'Employees', value: String(new Set(rows.map((r) => r.employeeId)).size) },
        { label: 'Devices', value: String(new Set(rows.map((r) => r.device)).size) },
      ],
      legend: [],
    };
  }

  const BUILDERS: Record<ReportType, (q: URLSearchParams) => Built> = {
    daily,
    monthly_register: register,
    late_comers: lateComers,
    absentees,
    wing_summary: wingSummary,
    time_card: timeCard,
    leave: leaveReport,
    punch_log: punchLog,
  };

  const isType = (t: string): t is ReportType => (REPORT_TYPE_KEYS as string[]).includes(t);

  function validate(type: ReportType, q: URLSearchParams): Response | null {
    const raw: Record<string, string> = {};
    q.forEach((v, k) => (raw[k] = v));
    const p = zReportParams.safeParse(raw);
    if (!p.success) {
      const details: Record<string, string> = {};
      for (const i of p.error.issues) details[String(i.path[0] ?? 'form')] ??= i.message;
      return err(400, 'VALIDATION_ERROR', 'Some values are invalid', details);
    }
    if (type === 'time_card' && !p.data.employeeId) return err(400, 'VALIDATION_ERROR', 'Choose an employee', { employeeId: 'Required for the time card' });
    return null;
  }

  return [
    [/^\/dashboard$/, () => {
      // ?mockNoDashboard=1 behaves like a server that does not have /dashboard yet (the page falls back to /overview).
      if (new URLSearchParams(location.search).get('mockNoDashboard') === '1') return err(404, 'NOT_FOUND', 'Not found');
      return ctx.can('dashboard.view') ? json(200, dashboard()) : forbidden();
    }],

    [/^\/reports\/([a-z_]+)\/export$/, async ({ params, query }) => {
      if (!ctx.can('attendance.export')) return forbidden();
      const type = params[0]!;
      if (!isType(type)) return err(404, 'NOT_FOUND', 'Unknown report');
      const bad = validate(type, query);
      if (bad) return bad;
      const format = query.get('format') === 'pdf' ? 'pdf' : 'xlsx';
      const built = BUILDERS[type](query);
      await sleep(900);
      const period = query.get('month') ?? query.get('date') ?? (query.get('from') && query.get('to') ? `${query.get('from')}_to_${query.get('to')}` : todayYmd());
      const scope = scopeLabel(query).replace(/[^A-Za-z0-9]+/g, '-');
      const name = `NACTA-${REPORT_TYPES[type].label.replace(/[^A-Za-z0-9]+/g, '-')}-${scope}-${period}.${format}`;
      const body = `Mock ${format.toUpperCase()} export of "${built.title}" (${built.rowsAll.length} rows). Generated by the dev mock.\n`;
      return new Response(new Blob([body], { type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), {
        status: 200,
        headers: { 'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"`, 'x-request-id': 'mock-req' },
      });
    }],

    [/^\/reports\/([a-z_]+)$/, ({ params, query }) => {
      if (!ctx.can('attendance.view')) return forbidden();
      const type = params[0]!;
      if (!isType(type)) return err(404, 'NOT_FOUND', 'Unknown report');
      const bad = validate(type, query);
      if (bad) return bad;
      const built = BUILDERS[type](query);
      const page = Math.max(1, Number(query.get('page')) || 1);
      const pageSize = Math.min(500, Math.max(1, Number(query.get('pageSize')) || 100));
      const { rowsAll, ...rest } = built;
      const result: ReportResult = {
        ...rest,
        type,
        rows: rowsAll.slice((page - 1) * pageSize, page * pageSize),
        total: rowsAll.length,
        page,
        pageSize,
        generatedAt: new Date().toISOString(),
      };
      return json(200, result);
    }],
  ];
}
