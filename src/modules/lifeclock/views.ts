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
  return h(
    'div',
    { class: 'lc-hero' },
    h('div', { class: 'lc-remaining' }, `${Math.round(100 - p.pct)}%`),
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
  if (view === 'year') return `day ${fmt(i + 1)} of ${fmt(total)}`;
  if (view === 'decade') return `month ${i + 1} of 120`;
  return `week ${fmt(i + 1)} of ${fmt(total)}`;
}

function grid(view: LifeView, total: number, elapsed: number, tip: Tooltip): HTMLElement {
  const g = h('div', { class: `lc-grid lc-grid-${view}` });
  const frag = document.createDocumentFragment();
  for (let i = 0; i < total; i++) {
    const state = i < elapsed - 1 ? 'past' : i === elapsed - 1 ? 'now' : 'future';
    const cell = h('div', { class: `lc-cell ${state}`, 'data-idx': i });
    frag.appendChild(cell);
  }
  g.appendChild(frag);
  g.addEventListener('mousemove', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-idx]');
    if (!cell) return tip.hide();
    tip.show(e.clientX, e.clientY, cellLabel(view, Number(cell.dataset.idx), total));
  });
  g.addEventListener('mouseleave', () => tip.hide());
  return g;
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
  if (view === 'day' || view === 'week' || view === 'month') {
    container.appendChild(bar(p, tip));
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
