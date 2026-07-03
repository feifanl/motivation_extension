import { h, clamp } from '../../core/dom';
import { bus } from '../../core/events';
import type { LifeView, Settings } from '../../core/types';
import { progress, unitsForGrid, decadeStartYear, deathDate, type Progress } from './math';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
const WEEK = 7 * DAY;

// Parse "YYYY-MM-DD" as a LOCAL date (avoids new Date(string) UTC shift).
function parseBirthday(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function hero(p: Progress): HTMLElement {
  // Counts UP: the big number is elapsed (% done), not remaining.
  return h(
    'div',
    { class: 'lc-hero' },
    h('div', { class: 'lc-remaining' }, `${Math.round(p.pct)}%`),
    h('div', { class: 'lc-caption' }, p.name),
    h('div', { class: 'lc-sub' }, p.sublabel),
  );
}

interface Tooltip {
  show(clientX: number, clientY: number, text: string): void;
  hide(): void;
}
function makeTooltip(container: HTMLElement): Tooltip {
  const tip = h('div', { class: 'lc-tip' });
  container.appendChild(tip);
  return {
    show(clientX, clientY, text) {
      const r = container.getBoundingClientRect();
      tip.textContent = text;
      tip.style.left = `${clientX - r.left}px`;
      tip.style.top = `${clientY - r.top}px`;
      tip.classList.add('on');
    },
    hide() {
      tip.classList.remove('on');
    },
  };
}

function bar(p: Progress, tip: Tooltip): HTMLElement {
  const fill = h('div', { class: 'lc-bar-fill' });
  fill.style.width = `${p.pct}%`;
  const wrap = h('div', { class: 'lc-bar', title: p.sublabel }, fill);
  wrap.addEventListener('mousemove', (e) => tip.show(e.clientX, e.clientY, p.sublabel));
  wrap.addEventListener('mouseleave', () => tip.hide());
  return wrap;
}

type Cell = 'past' | 'now' | 'future';
function cellState(i: number, elapsed: number): Cell {
  return i < elapsed - 1 ? 'past' : i === elapsed - 1 ? 'now' : 'future';
}

interface Block {
  label: string;
  cells: Cell[];
  cols: number;
}

// Renders labeled unit-blocks with gaps between them (waitbutwhy-style).
function renderBlocks(view: LifeView, blocks: Block[]): HTMLElement {
  const wrap = h('div', { class: `lc-blocks lc-blocks-${view}` });
  for (const b of blocks) {
    const g = h('div', { class: 'lc-block-grid' });
    g.style.gridTemplateColumns = `repeat(${b.cols}, 1fr)`;
    for (const c of b.cells) g.appendChild(h('div', { class: `lc-chunk ${c}` }));
    wrap.appendChild(h('div', { class: 'lc-block' }, h('div', { class: 'lc-block-label' }, b.label), g));
  }
  return wrap;
}

// Year → one block per month (that month's days).
function yearBlocks(now: Date): Block[] {
  const y = now.getFullYear();
  const tm = now.getMonth();
  const td = now.getDate();
  const blocks: Block[] = [];
  for (let m = 0; m < 12; m++) {
    const dim = new Date(y, m + 1, 0).getDate();
    const cells: Cell[] = [];
    for (let d = 1; d <= dim; d++) {
      cells.push(m < tm || (m === tm && d < td) ? 'past' : m === tm && d === td ? 'now' : 'future');
    }
    blocks.push({ label: MONTH_ABBR[m], cells, cols: 7 });
  }
  return blocks;
}

// Decade → one block per CALENDAR year (that year's 12 months). Cells are
// coloured by comparing each month to `now` directly, so the "now" cell always
// sits under its true calendar-year label (no birthday-month offset drift).
function decadeBlocks(now: Date, birthday: Date): Block[] {
  const startYear = decadeStartYear(birthday, now);
  const nowY = now.getFullYear();
  const nowM = now.getMonth();
  const blocks: Block[] = [];
  for (let yr = 0; yr < 10; yr++) {
    const year = startYear + yr;
    const cells: Cell[] = [];
    for (let mo = 0; mo < 12; mo++) {
      cells.push(calCell(year, mo, nowY, nowM));
    }
    blocks.push({ label: String(year), cells, cols: 4 });
  }
  return blocks;
}

// Life → one block per CALENDAR year (that year's ~52 weeks). Cells are coloured
// by comparing each week to `now`'s calendar year + week-of-year, so the "now"
// week never drifts out from under its year label (fixed 52 wk/yr would drift).
function lifeBlocks(now: Date, birthday: Date, expectancy: number): Block[] {
  const birthYear = birthday.getFullYear();
  const deathYear = deathDate(birthday, expectancy).getFullYear();
  const nowY = now.getFullYear();
  const nowWeek = clamp(Math.floor((now.getTime() - startOfYearLocal(now).getTime()) / WEEK), 0, 51);
  const blocks: Block[] = [];
  for (let year = birthYear; year <= deathYear; year++) {
    const cells: Cell[] = [];
    for (let w = 0; w < 52; w++) {
      cells.push(year < nowY ? 'past' : year > nowY ? 'future' : w < nowWeek ? 'past' : w === nowWeek ? 'now' : 'future');
    }
    blocks.push({ label: String(year), cells, cols: 7 });
  }
  return blocks;
}

function startOfYearLocal(now: Date): Date {
  return new Date(now.getFullYear(), 0, 1);
}

// Month-in-year cell colour by direct calendar comparison to now.
function calCell(year: number, mo: number, nowY: number, nowM: number): Cell {
  if (year < nowY || (year === nowY && mo < nowM)) return 'past';
  if (year === nowY && mo === nowM) return 'now';
  return 'future';
}

// Month stays a weekday-aligned calendar (chunked by day).
function monthCalendar(now: Date, total: number, elapsed: number, tip: Tooltip): HTMLElement {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday-start leading blanks
  const cal = h('div', { class: 'lc-cal' });
  for (const dow of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
    cal.appendChild(h('div', { class: 'lc-cal-dow' }, dow));
  }
  for (let i = 0; i < offset; i++) cal.appendChild(h('div', { class: 'lc-cal-blank' }));
  for (let d = 1; d <= total; d++) {
    cal.appendChild(
      h('div', { class: `lc-cal-day ${cellState(d - 1, elapsed)}`, 'data-idx': d - 1 }, String(d)),
    );
  }
  cal.addEventListener('mousemove', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
    if (!cell) return tip.hide();
    tip.show(e.clientX, e.clientY, `day ${Number(cell.dataset.idx) + 1} of ${total}`);
  });
  cal.addEventListener('mouseleave', () => tip.hide());
  return cal;
}

function noBirthday(): HTMLElement {
  return h(
    'div',
    { class: 'lc-empty' },
    h('p', {}, 'Set your birthday to see this view.'),
    h('button', { class: 'primary', onClick: () => bus.emit('open-settings', 'lifeclock') }, 'Set birthday'),
  );
}

export function renderView(
  view: LifeView,
  container: HTMLElement,
  settings: Settings,
  now: Date,
): void {
  container.replaceChildren();
  const birthday = parseBirthday(settings.lifeclock.birthday);
  const expectancy = settings.lifeclock.lifeExpectancyYears;

  if ((view === 'decade' || view === 'life') && !birthday) {
    container.appendChild(noBirthday());
    return;
  }

  const p = progress(view, now, birthday, expectancy);
  container.appendChild(hero(p));

  const tip = makeTooltip(container);
  if (view === 'day' || view === 'week') {
    container.appendChild(bar(p, tip));
  } else if (view === 'month') {
    const { total, elapsed } = unitsForGrid('month', now, birthday, expectancy);
    container.appendChild(bar(p, tip));
    container.appendChild(monthCalendar(now, total, elapsed, tip));
  } else if (view === 'year') {
    container.appendChild(bar(p, tip));
    container.appendChild(renderBlocks('year', yearBlocks(now)));
  } else if (view === 'decade') {
    container.appendChild(renderBlocks('decade', decadeBlocks(now, birthday!)));
  } else {
    container.appendChild(renderBlocks('life', lifeBlocks(now, birthday!, expectancy)));
  }
}
