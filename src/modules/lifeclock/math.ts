// Pure life-clock math. No DOM — unit-testable. All time math is local-TZ.
import { fmt, clamp } from '../../core/dom';
import type { LifeView } from '../../core/types';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export const VIEW_ORDER: LifeView[] = ['day', 'week', 'month', 'year', 'decade', 'life'];

export function deathDate(birthday: Date, years: number): Date {
  return new Date(birthday.getFullYear() + years, birthday.getMonth(), birthday.getDate());
}

// ---------- local boundary helpers ----------
function midnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function startOfWeek(now: Date): Date {
  const m = midnight(now);
  const fromMonday = (m.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(m.getFullYear(), m.getMonth(), m.getDate() - fromMonday);
}
function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function startOfNextMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}
function startOfYear(now: Date): Date {
  return new Date(now.getFullYear(), 0, 1);
}
function startOfNextYear(now: Date): Date {
  return new Date(now.getFullYear() + 1, 0, 1);
}

// Completed years lived (calendar-accurate).
export function ageYears(birthday: Date, now: Date): number {
  let years = now.getFullYear() - birthday.getFullYear();
  const had =
    now.getMonth() > birthday.getMonth() ||
    (now.getMonth() === birthday.getMonth() && now.getDate() >= birthday.getDate());
  if (!had) years--;
  return years;
}

function decadeBounds(birthday: Date, now: Date): { start: Date; end: Date; index: number } {
  const idx = Math.floor(ageYears(birthday, now) / 10);
  const by = birthday.getFullYear();
  const start = new Date(by + idx * 10, birthday.getMonth(), birthday.getDate());
  const end = new Date(by + (idx + 1) * 10, birthday.getMonth(), birthday.getDate());
  return { start, end, index: idx };
}

// ---------- humanizers ----------
function humanDay(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} m left today`;
}
function humanWeek(ms: number): string {
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / 3_600_000);
  if (d <= 0) return `${h} hours remain`;
  return `${d} days, ${h} hours remain`;
}
function humanDays(ms: number): string {
  const d = Math.ceil(ms / DAY);
  return `${fmt(d)} days remain`;
}

export interface Progress {
  pct: number; // 0–100 elapsed of the current period
  name: string; // "June", "This week", "2026", "Decade 3", "Life", "Today"
  label: string; // "June — 3% left"
  sublabel: string; // "9 days, 4 hours remain"
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function progress(
  view: LifeView,
  now: Date,
  birthday: Date | null,
  expectancy: number,
): Progress {
  let start: Date;
  let span: number;
  let name: string;
  let sublabel: string;

  switch (view) {
    case 'day': {
      start = midnight(now);
      span = DAY;
      name = 'Today';
      sublabel = humanDay(span - (now.getTime() - start.getTime()));
      break;
    }
    case 'week': {
      start = startOfWeek(now);
      span = WEEK;
      name = 'This week';
      sublabel = humanWeek(span - (now.getTime() - start.getTime()));
      break;
    }
    case 'month': {
      start = startOfMonth(now);
      span = startOfNextMonth(now).getTime() - start.getTime();
      name = MONTHS[now.getMonth()];
      sublabel = humanDays(span - (now.getTime() - start.getTime()));
      break;
    }
    case 'year': {
      start = startOfYear(now);
      span = startOfNextYear(now).getTime() - start.getTime();
      name = String(now.getFullYear());
      sublabel = humanDays(span - (now.getTime() - start.getTime()));
      break;
    }
    case 'decade': {
      const b = birthday!;
      const { start: ds, end, index } = decadeBounds(b, now);
      start = ds;
      span = end.getTime() - ds.getTime();
      name = `Decade ${index + 1}`;
      const grid = unitsForGrid('decade', now, b, expectancy);
      sublabel = `${grid.total - grid.elapsed} months remain`;
      break;
    }
    case 'life':
    default: {
      const b = birthday!;
      start = b;
      span = deathDate(b, expectancy).getTime() - b.getTime();
      name = 'Life';
      const grid = unitsForGrid('life', now, b, expectancy);
      sublabel = `${fmt(grid.total - grid.elapsed)} weeks remain`;
      break;
    }
  }

  const elapsed = now.getTime() - start.getTime();
  const pct = clamp((elapsed / span) * 100, 0, 100);
  const rem = 100 - pct;
  const remLabel = rem > 0 && rem < 1 ? '<1' : String(Math.round(rem));
  return { pct, name, label: `${name} — ${remLabel}% left`, sublabel };
}

// total / elapsed cell counts for the grid views (elapsed includes the current cell).
export function unitsForGrid(
  view: LifeView,
  now: Date,
  birthday: Date | null,
  expectancy: number,
): { total: number; elapsed: number } {
  if (view === 'year') {
    const s = startOfYear(now);
    const total = Math.round((startOfNextYear(now).getTime() - s.getTime()) / DAY);
    // Math.round (not floor) so a DST hour shift can't drop a day.
    const elapsed = Math.round((midnight(now).getTime() - s.getTime()) / DAY) + 1; // day-of-year
    return { total, elapsed: clamp(elapsed, 1, total) };
  }
  if (view === 'decade') {
    const b = birthday!;
    const { start } = decadeBounds(b, now);
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return { total: 120, elapsed: clamp(months + 1, 1, 120) };
  }
  // life
  const b = birthday!;
  const total = Math.floor((deathDate(b, expectancy).getTime() - b.getTime()) / WEEK);
  const elapsed = Math.floor((now.getTime() - b.getTime()) / WEEK) + 1;
  return { total, elapsed: clamp(elapsed, 1, total) };
}
