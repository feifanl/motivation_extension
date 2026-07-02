// Shared DOM/date utilities. Nothing module-specific.

type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, unknown>;

// Hyperscript: h('div', { class: 'card', onClick: fn }, child, child)
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') {
        el.className = String(v);
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v as Record<string, string>);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'value' || k === 'checked') {
        // set as property so form controls reflect it
        (el as unknown as Record<string, unknown>)[k] = v;
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) {
      appendChildren(el, c);
    } else if (c == null || c === false) {
      continue;
    } else if (c instanceof Node) {
      el.appendChild(c);
    } else {
      el.appendChild(document.createTextNode(String(c)));
    }
  }
}

// Number → locale string with fixed fraction digits (thousands grouped).
export function fmt(n: number, digits = 0): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Local (not UTC) YYYY-MM-DD.
export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Play a brief collapse animation on `el`, then run `done` (which swaps the DOM
// to the collapsed form). Honors prefers-reduced-motion by skipping straight to
// `done`. A timeout guards against a missed transitionend.
export function animateOut(el: HTMLElement, done: () => void): void {
  if (reducedMotion) {
    done();
    return;
  }
  let called = false;
  const finish = () => {
    if (called) return;
    called = true;
    el.removeEventListener('transitionend', onEnd);
    done();
  };
  // Only our own transition on el counts; ignore transitionend bubbling from
  // descendants (which would end the animation early).
  const onEnd = (e: TransitionEvent) => {
    if (e.target === el) finish();
  };
  el.addEventListener('transitionend', onEnd);
  setTimeout(finish, 260);
  // next frame so the transition has a start state to animate from
  requestAnimationFrame(() => el.classList.add('collapsing'));
}
