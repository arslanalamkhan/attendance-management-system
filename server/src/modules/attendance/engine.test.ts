import { describe, expect, it } from 'vitest';
import { computeDay, type EngineEmployee, type EngineInput, type EngineLeave } from './engine';
import {
  dayKind,
  holidaysFor,
  pickAssignment,
  resolveTiming,
  versionOn,
  workingDaysIn,
  type AssignmentRule,
  type HolidayRule,
  type ProfileRules,
  type ResolvedTiming,
} from './resolve';

const WEEK = (h: { start: string; end: string }) => [null, h, h, h, h, h, null];
const STD: ResolvedTiming = {
  profileId: 1,
  profileName: 'Standard',
  days: WEEK({ start: '09:00', end: '17:00' }),
  graceLate: 15,
  graceEarly: 15,
  halfDayBelow: 240,
};
const EMP: EngineEmployee = {
  id: 1,
  empCode: '101',
  name: 'Test Person',
  wingName: 'Ops',
  sectionName: null,
  designation: null,
  hasPhoto: false,
  joinDate: null,
  status: 'active',
  statusChangedDate: null,
  leftDate: null,
};
// 2026-11-18 is a Wednesday; 21 = Saturday, 22 = Sunday. "now" is a later day so these days are over.
const WED = '2026-11-18';
const SAT = '2026-11-21';
const LATER = { date: '2026-11-25', minutes: 600 };

const run = (o: Partial<EngineInput> = {}) =>
  computeDay({ date: WED, now: LATER, employee: EMP, timing: STD, holidays: [], leave: null, corrections: [], punches: [], ...o });

const leave = (part: EngineLeave['part'], extra: Partial<EngineLeave> = {}): EngineLeave => ({
  leaveId: 7,
  typeName: 'Casual',
  code: 'CL',
  color: '#2563EB',
  part,
  countsAsPresent: false,
  ...extra,
});

describe('engine: punches on a working day', () => {
  it('on time and stayed -> present with first in / last out / worked', () => {
    const d = run({ punches: ['08:55:10', '12:30:00', '17:05:00'] });
    expect(d).toMatchObject({ status: 'present', firstIn: '08:55', lastOut: '17:05', workedMinutes: 489, punchCount: 3, lateMinutes: 0, earlyLeave: false, corrected: false });
    expect(d.timing).toEqual({ profileName: 'Standard', start: '09:00', end: '17:00' });
    expect(d.leave).toBeNull();
  });

  it('exactly at the late grace is on time; one minute later is late', () => {
    expect(run({ punches: ['09:15:00', '17:00:00'] })).toMatchObject({ status: 'present', lateMinutes: 0 });
    expect(run({ punches: ['09:15:59', '17:00:00'] }).status).toBe('present'); // shown as 09:15
    const late = run({ punches: ['09:16:00', '17:00:00'] });
    expect(late).toMatchObject({ status: 'late', lateMinutes: 16, firstIn: '09:16' });
  });

  it('exactly at the early grace is not an early leave; one minute earlier is', () => {
    expect(run({ punches: ['09:00', '16:45'] })).toMatchObject({ status: 'present', earlyLeave: false, earlyMinutes: 0 });
    const early = run({ punches: ['09:00', '16:44'] });
    expect(early).toMatchObject({ status: 'present', earlyLeave: true, earlyMinutes: 16 });
  });

  it('late and early can both apply; status stays late', () => {
    expect(run({ punches: ['09:30', '16:00'] })).toMatchObject({ status: 'late', lateMinutes: 30, earlyLeave: true, earlyMinutes: 60 });
  });

  it('worked below the half-day threshold -> half_day; exactly at the threshold is fine', () => {
    expect(run({ punches: ['09:00', '12:59'] })).toMatchObject({ status: 'half_day', workedMinutes: 239 });
    expect(run({ punches: ['09:00', '13:00'] })).toMatchObject({ status: 'present', workedMinutes: 240, earlyLeave: true });
  });

  it('a single punch on a finished day -> incomplete', () => {
    expect(run({ punches: ['09:05'] })).toMatchObject({ status: 'incomplete', firstIn: '09:05', lastOut: null, punchCount: 1, workedMinutes: 0 });
  });

  it('two punches less than a minute apart are one punch', () => {
    const d = run({ punches: ['09:05:00', '09:05:40'] });
    expect(d).toMatchObject({ status: 'incomplete', lastOut: null, punchCount: 2 });
    expect(run({ punches: ['09:05:00', '09:06:00'] }).lastOut).toBe('09:06');
  });

  it('today: a single punch is not incomplete until the day is over (end + 2h)', () => {
    expect(run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 12 * 60 }, punches: ['09:00'] }).status).toBe('present');
    expect(run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 19 * 60 }, punches: ['09:00'] }).status).toBe('present');
    expect(run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 19 * 60 + 1 }, punches: ['09:00'] }).status).toBe('incomplete');
  });

  it('today, mid-day: working so far is present, not half_day / early leave', () => {
    const d = run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 11 * 60 }, punches: ['09:00', '10:30'] });
    expect(d).toMatchObject({ status: 'present', earlyLeave: false });
  });

  it('today, after closing time: judged on what was worked', () => {
    const d = run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 17 * 60 + 30 }, punches: ['09:00', '11:00'] });
    expect(d).toMatchObject({ status: 'half_day', earlyLeave: true });
  });

  it('punches from several devices are merged by time', () => {
    expect(run({ punches: ['17:02', '09:01', '13:00'] })).toMatchObject({ firstIn: '09:01', lastOut: '17:02', punchCount: 3 });
  });
});

describe('engine: no punches', () => {
  it('absent once the day is over', () => {
    expect(run().status).toBe('absent');
    expect(run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 19 * 60 + 1 } }).status).toBe('absent');
  });
  it('pending until end + 2 hours, and for the future', () => {
    expect(run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 19 * 60 } }).status).toBe('pending');
    expect(run({ date: '2026-11-25', now: { date: '2026-11-25', minutes: 8 * 60 } }).status).toBe('pending');
    expect(run({ date: '2026-11-26', now: { date: '2026-11-25', minutes: 23 * 60 } }).status).toBe('pending');
  });
});

describe('engine: holidays, weekends, special working days', () => {
  it('holiday: status holiday with its name, still shows punches', () => {
    const d = run({ holidays: [{ name: 'Iqbal Day', kind: 'holiday' }], punches: ['10:00', '14:00'] });
    expect(d).toMatchObject({ status: 'holiday', holiday: { name: 'Iqbal Day' }, firstIn: '10:00', lastOut: '14:00', workedMinutes: 240, punchCount: 2 });
  });
  it('weekend: status weekend, punches shown, no timing', () => {
    const d = run({ date: SAT, punches: ['09:00', '12:00'] });
    expect(d).toMatchObject({ status: 'weekend', firstIn: '09:00', lastOut: '12:00', timing: null });
    expect(run({ date: SAT }).status).toBe('weekend');
  });
  it('a working_day on a weekend is a normal working day (hours from the first working weekday)', () => {
    expect(run({ date: SAT, holidays: [{ name: 'Make-up day', kind: 'working_day' }] }).status).toBe('absent');
    const d = run({ date: SAT, holidays: [{ name: 'Make-up day', kind: 'working_day' }], punches: ['09:20', '17:00'] });
    expect(d).toMatchObject({ status: 'late', lateMinutes: 20, timing: { start: '09:00', end: '17:00' } });
  });
  it('a working_day on a normal weekday changes nothing; a holiday beats a working_day', () => {
    expect(run({ holidays: [{ name: 'x', kind: 'working_day' }], punches: ['09:00', '17:00'] }).status).toBe('present');
    expect(run({ holidays: [{ name: 'x', kind: 'working_day' }, { name: 'Eid', kind: 'holiday' }] }).status).toBe('holiday');
  });
  it('leave on a holiday or weekend is ignored (the day is not a working day)', () => {
    const d = run({ holidays: [{ name: 'Eid', kind: 'holiday' }], leave: leave('full') });
    expect(d).toMatchObject({ status: 'holiday', leave: null });
    expect(run({ date: SAT, leave: leave('full') })).toMatchObject({ status: 'weekend', leave: null });
  });
});

describe('engine: leave', () => {
  it('full-day leave -> leave with the type attached, regardless of punches', () => {
    const d = run({ leave: leave('full') });
    expect(d).toMatchObject({ status: 'leave', leave: { leaveId: 7, typeName: 'Casual', code: 'CL', color: '#2563EB', part: 'full' }, leaveCountsPresent: false });
    expect(run({ leave: leave('full'), punches: ['09:00', '17:00'] }).status).toBe('leave');
  });
  it('official duty carries the counts-as-present flag', () => {
    expect(run({ leave: leave('full', { code: 'OD', countsAsPresent: true }) }).leaveCountsPresent).toBe(true);
  });
  it('first-half leave: present when the afternoon is worked', () => {
    const d = run({ leave: leave('first_half'), punches: ['12:50', '17:00'] });
    expect(d).toMatchObject({ status: 'present', leave: { part: 'first_half' }, lateMinutes: 0 });
  });
  it('first-half leave: late relative to the start of the afternoon', () => {
    expect(run({ leave: leave('first_half'), punches: ['13:30', '17:00'] })).toMatchObject({ status: 'late', lateMinutes: 30 });
  });
  it('second-half leave: present when the morning is worked', () => {
    const d = run({ leave: leave('second_half'), punches: ['09:05', '13:00'] });
    expect(d).toMatchObject({ status: 'present', leave: { part: 'second_half' }, earlyLeave: false });
  });
  it('half-day leave without the other half worked -> half_day', () => {
    expect(run({ leave: leave('first_half') })).toMatchObject({ status: 'half_day', leave: { part: 'first_half' } });
    expect(run({ leave: leave('second_half'), punches: ['09:00', '10:00'] }).status).toBe('half_day');
    expect(run({ leave: leave('first_half'), punches: ['09:00', '11:00'] }).status).toBe('half_day');
  });
  it('half-day leave today, before the day is over: not yet half_day', () => {
    const now = { date: '2026-11-25', minutes: 10 * 60 };
    expect(run({ date: '2026-11-25', now, leave: leave('first_half') }).status).toBe('pending');
    expect(run({ date: '2026-11-25', now, leave: leave('second_half'), punches: ['09:00'] }).status).toBe('present');
  });
});

describe('engine: inactive employees', () => {
  it('before the join date', () => {
    const e = { ...EMP, joinDate: '2026-11-20' };
    expect(run({ employee: e, punches: ['09:00'] })).toMatchObject({ status: 'inactive', punchCount: 0 });
    expect(run({ employee: e, date: '2026-11-20', punches: ['09:00', '17:00'] }).status).toBe('present');
  });
  it('disabled from the day the status changed', () => {
    const e: EngineEmployee = { ...EMP, status: 'disabled', statusChangedDate: '2026-11-18' };
    expect(run({ employee: e, date: '2026-11-17', punches: ['09:00', '17:00'] }).status).toBe('present');
    expect(run({ employee: e, date: '2026-11-18', punches: ['09:00', '17:00'] }).status).toBe('inactive');
    expect(run({ employee: e, date: '2026-11-19' }).status).toBe('inactive');
  });
  it('left: working through the left date, inactive after', () => {
    const e: EngineEmployee = { ...EMP, status: 'left', statusChangedDate: '2026-11-19', leftDate: '2026-11-18' };
    expect(run({ employee: e, date: '2026-11-18', punches: ['09:00', '17:00'] }).status).toBe('present');
    expect(run({ employee: e, date: '2026-11-19' }).status).toBe('inactive');
  });
  it('inactive wins over holidays and leave', () => {
    const e: EngineEmployee = { ...EMP, status: 'left', statusChangedDate: '2026-11-10', leftDate: '2026-11-09' };
    expect(run({ employee: e, leave: leave('full'), holidays: [{ name: 'x', kind: 'holiday' }] }).status).toBe('inactive');
  });
});

describe('engine: corrections', () => {
  it('a manual punch completes a missing punch-out and marks the day corrected', () => {
    const d = run({ punches: ['09:05'], corrections: [{ id: 1, type: 'add_punch', time: '17:00', status: null }] });
    expect(d).toMatchObject({ status: 'present', lastOut: '17:00', punchCount: 2, corrected: true });
  });
  it('a manual punch on an otherwise empty day', () => {
    const d = run({ corrections: [{ id: 1, type: 'add_punch', time: '09:00', status: null }, { id: 2, type: 'add_punch', time: '17:00', status: null }] });
    expect(d).toMatchObject({ status: 'present', corrected: true });
  });
  it('set_status overrides the computed status; the latest override wins', () => {
    expect(run({ corrections: [{ id: 1, type: 'set_status', time: null, status: 'present' }] })).toMatchObject({ status: 'present', corrected: true });
    const d = run({
      punches: ['09:00', '17:00'],
      corrections: [{ id: 1, type: 'set_status', time: null, status: 'absent' }, { id: 2, type: 'set_status', time: null, status: 'half_day' }],
    });
    expect(d.status).toBe('half_day');
  });
  it('set_status also overrides a holiday, but never an inactive day', () => {
    expect(run({ holidays: [{ name: 'x', kind: 'holiday' }], corrections: [{ id: 1, type: 'set_status', time: null, status: 'present' }] }).status).toBe('present');
    const e: EngineEmployee = { ...EMP, joinDate: '2026-12-01' };
    expect(run({ employee: e, corrections: [{ id: 1, type: 'set_status', time: null, status: 'present' }] }).status).toBe('inactive');
  });
});

describe('resolve: which rules apply', () => {
  const profile = (id: number, name: string, isDefault: boolean, versions: ProfileRules['versions']): ProfileRules => ({ id, name, isDefault, versions });
  const v = (effectiveFrom: string, start: string, graceLate = 15) => ({ effectiveFrom, days: WEEK({ start, end: '17:00' }), graceLate, graceEarly: 15, halfDayBelow: 240 });
  const profiles = [
    profile(1, 'Standard', true, [v('2000-01-01', '09:00')]),
    profile(2, 'Ops wing', false, [v('2000-01-01', '08:00')]),
    profile(3, 'Ramadan', false, [v('2000-01-01', '10:00')]),
    profile(4, 'Personal', false, [v('2000-01-01', '07:00')]),
  ];
  const A = (id: number, profileId: number, scope: AssignmentRule['scope'], scopeId: number | null, from: string, to: string | null): AssignmentRule => ({
    id,
    profileId,
    scope,
    scopeId,
    effectiveFrom: from,
    effectiveTo: to,
  });
  const emp: { id: number; wingId: number | null } = { id: 5, wingId: 10 };
  const startOn = (assignments: AssignmentRule[], date: string, e = emp) => resolveTiming(profiles, assignments, e, date).days[3]?.start;

  it('falls back to the default profile', () => {
    expect(startOn([], WED)).toBe('09:00');
  });
  it('wing assignment beats the default; an org-wide one sits between', () => {
    const all = A(1, 3, 'all', null, '2026-01-01', null);
    const wing = A(2, 2, 'wing', 10, '2026-01-01', null);
    expect(startOn([all], WED)).toBe('10:00');
    expect(startOn([all, wing], WED)).toBe('08:00');
    expect(startOn([wing], WED, { id: 5, wingId: 11 })).toBe('09:00');
    expect(startOn([wing], WED, { id: 5, wingId: null })).toBe('09:00');
  });
  it('Ramadan (dated, org-wide) overrides open-ended org-wide, but a wing assignment still wins over it', () => {
    const openAll = A(1, 1, 'all', null, '2026-01-01', null);
    const ramadan = A(2, 3, 'all', null, '2027-02-10', '2027-03-11');
    expect(startOn([openAll, ramadan], '2027-02-17')).toBe('10:00');
    expect(startOn([openAll, ramadan], '2027-03-12')).toBe('09:00');
    expect(startOn([openAll, ramadan], '2027-02-09')).toBe('09:00');
    const wing = A(3, 2, 'wing', 10, '2026-01-01', null);
    expect(startOn([openAll, ramadan, wing], '2027-02-17')).toBe('08:00');
  });
  it('a dated wing assignment beats an open-ended wing one; an employee assignment beats the wing', () => {
    const wingOpen = A(1, 2, 'wing', 10, '2026-01-01', null);
    const wingRamadan = A(2, 3, 'wing', 10, '2027-02-10', '2027-03-11');
    const person = A(3, 4, 'employee', 5, '2027-02-15', '2027-02-20');
    expect(startOn([wingOpen, wingRamadan], '2027-02-12')).toBe('10:00');
    expect(startOn([wingOpen, wingRamadan, person], '2027-02-17')).toBe('07:00');
    expect(startOn([wingOpen, wingRamadan, person], '2027-02-21')).toBe('10:00');
    expect(startOn([wingOpen, wingRamadan, person], '2027-02-17', { id: 6, wingId: 10 })).toBe('10:00');
  });
  it('ties go to the latest effectiveFrom, then the highest id', () => {
    const a = A(1, 2, 'wing', 10, '2026-01-01', '2026-12-31');
    const b = A(2, 3, 'wing', 10, '2026-06-01', '2026-12-31');
    expect(pickAssignment([a, b], emp, '2026-07-01')?.id).toBe(2);
    expect(pickAssignment([b, a], emp, '2026-07-01')?.id).toBe(2);
    const c = A(3, 4, 'wing', 10, '2026-06-01', '2026-12-31');
    expect(pickAssignment([b, c], emp, '2026-07-01')?.id).toBe(3);
  });
  it('rules are versioned: the version in force on the date applies, history is untouched', () => {
    const versioned = [profile(1, 'Standard', true, [v('2000-01-01', '09:00', 15), v('2026-12-01', '08:00', 0)])];
    const on = (d: string) => resolveTiming(versioned, [], emp, d);
    expect(on('2026-11-30').days[3]?.start).toBe('09:00');
    expect(on('2026-12-01')).toMatchObject({ graceLate: 0 });
    expect(on('2026-12-01').days[3]?.start).toBe('08:00');
    expect(versionOn(versioned[0] as ProfileRules, '1999-01-01')?.effectiveFrom).toBe('2000-01-01'); // before the first version
  });
  it('the engine applies the version of each date', () => {
    const early: ResolvedTiming = { ...STD, days: WEEK({ start: '08:00', end: '16:00' }), graceLate: 0 };
    expect(run({ punches: ['08:30', '16:00'], timing: STD }).status).toBe('present');
    expect(run({ punches: ['08:30', '16:00'], timing: early })).toMatchObject({ status: 'late', lateMinutes: 30 });
  });
});

describe('resolve: holidays and working days', () => {
  const hs: HolidayRule[] = [
    { id: 1, name: 'Eid', from: '2026-11-18', to: '2026-11-19', kind: 'holiday', wingIds: [] },
    { id: 2, name: 'Ops day', from: '2026-11-20', to: '2026-11-20', kind: 'holiday', wingIds: [10] },
  ];
  it('a holiday for one wing only affects that wing', () => {
    expect(holidaysFor(hs, 10, '2026-11-20').map((h) => h.name)).toEqual(['Ops day']);
    expect(holidaysFor(hs, 11, '2026-11-20')).toEqual([]);
    expect(holidaysFor(hs, null, '2026-11-20')).toEqual([]);
    expect(holidaysFor(hs, null, '2026-11-18').map((h) => h.name)).toEqual(['Eid']);
    expect(run({ holidays: holidaysFor(hs, 10, '2026-11-20'), date: '2026-11-20' }).status).toBe('holiday');
    expect(run({ holidays: holidaysFor(hs, 11, '2026-11-20'), date: '2026-11-20' }).status).toBe('absent');
  });
  it('dayKind', () => {
    expect(dayKind(STD, SAT, [])).toEqual({ kind: 'weekend' });
    expect(dayKind(STD, WED, [])).toMatchObject({ kind: 'working' });
  });
  it('working days of a leave skip weekends and holidays; half days count 0.5', () => {
    const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];
    const timingOn = () => STD;
    const holOn = (d: string) => holidaysFor(hs, 11, d);
    // Mon 16 .. Mon 23: 16,17 work; 18,19 Eid; 20 work; 21,22 weekend; 23 work = 4
    expect(workingDaysIn({ from: '2026-11-16', to: '2026-11-23', part: 'full' }, dates, timingOn, holOn)).toBe(4);
    expect(workingDaysIn({ from: '2026-11-17', to: '2026-11-17', part: 'first_half' }, dates, timingOn, holOn)).toBe(0.5);
    expect(workingDaysIn({ from: '2026-11-21', to: '2026-11-21', part: 'second_half' }, dates, timingOn, holOn)).toBe(0);
  });
});
