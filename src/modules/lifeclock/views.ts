import { h, fmt } from '../../core/dom';
import { bus } from '../../core/events';
import type { LifeView, Settings } from '../../core/types';
import { progress, unitsForGrid, type Progress } from './math';

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

function cellLabel(view: LifeView, i: number, total: number): string {
  if (view === 'month') return `day ${i + 1} of ${total}`;
  if (view === 'year') return `day ${fmt(i + 1)} of ${fmt(total)}`;
  if (view === 'decade') return `month ${i + 1} of 120`;
  return `week ${fmt(i + 1)} of ${fmt(total)}`;
}

function state(i: number, elapsed: number): 'past' | 'now' | 'future' {
  return i < elapsed - 1 ? 'past' : i === elapsed - 1 ? 'now' : 'future';
}

function grid(view: LifeView, total: number, elapsed: number, tip: Tooltip): HTMLElement {
  const g = h('div', { class: `lc-grid lc-grid-${view}` });
  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i++) {
    const cell = h('div', { class: `lc-cell ${state(i, elapsed)}`, 'data-idx': i });
    frag.appendChild(cell);
  }
  g.appendChild(frag);
  attachTip(g, view, total, tip);
  return g;
}

// Month as a real weekday-aligned calendar, chunked by day.
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
      h('div', { class: `lc-cal-day ${state(d - 1, elapsed)}`, 'data-idx': d - 1 }, String(d)),
    );
  }
  attachTip(cal, 'month', total, tip);
  return cal;
}

function attachTip(el: HTMLElement, view: LifeView, total: number, tip: Tooltip): void {
  el.addEventListener('mousemove', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
    if (!cell) return tip.hide();
    tip.show(e.clientX, e.clientY, cellLabel(view, Number(cell.dataset.idx), total));
  });
  el.addEventListener('mouseleave', () => tip.hide());
}

function noBirthday(): HTMLElement {
  return h(
    'div',
    { class: 'lc-empty' },
    h('p', {}, 'Set your birthday to see this view.'),
    h('button', { class: 'primary', onClick: () => bus.emit('open-settings') }, 'Set birthday'),
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
    const { total, elapsed } = unitsForGrid('year', now, birthday, expectancy);
    container.appendChild(bar(p, tip));
    container.appendChild(grid('year', total, elapsed, tip));
  } else if (view === 'decade') {
    const { total, elapsed } = unitsForGrid('decade', now, birthday, expectancy);
    container.appendChild(grid('decade', total, elapsed, tip));
  } else {
    const { total, elapsed } = unitsForGrid('life', now, birthday, expectancy);
    container.appendChild(grid('life', total, elapsed, tip));
  }
}
