import type { ModuleContext, NoteColor, StickyNote } from '../../core/types';
import { h } from '../../core/dom';

const NOTES_KEY = 'notes';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Persistence helpers (single storage key "notes", a StickyNote[]).
export function loadNotes(ctx: ModuleContext): Promise<StickyNote[]> {
  return ctx.storage.get<StickyNote[]>(NOTES_KEY, []);
}
export function saveNotes(ctx: ModuleContext, notes: StickyNote[]): Promise<void> {
  return ctx.storage.set(NOTES_KEY, notes);
}
export function addNote(list: StickyNote[], text: string, color: NoteColor): StickyNote[] {
  const note: StickyNote = { id: crypto.randomUUID(), text: text.slice(0, 500), color, createdAt: Date.now() };
  return [note, ...list];
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Full-screen board overlay in .slot-overlay. Opens on 'open-notes-board',
// closes on Esc / × / backdrop. Notes reload from storage each open so freshly
// saved notes appear. onChange lets the caller refresh its count badge.
export function mountBoard(ctx: ModuleContext, onChange: () => void): void {
  const overlay = document.querySelector<HTMLElement>('.slot-overlay');
  if (!overlay) return;

  let notes: StickyNote[] = [];
  let open = false;

  const grid = h('div', { class: 'notes-grid' });
  const backdrop = h('div', { class: 'notes-backdrop', onClick: close });
  const panel = h(
    'div',
    { class: 'notes-board' },
    h(
      'div',
      { class: 'notes-board-head' },
      h('h2', { class: 'notes-board-title' }, 'Notes'),
      h('button', { class: 'notes-board-close', title: 'Close (Esc)', 'aria-label': 'Close', onClick: close }, '✕'),
    ),
    grid,
  );
  const root = h('div', { class: 'notes-overlay' }, backdrop, panel);

  function render(): void {
    if (!notes.length) {
      grid.replaceChildren(h('p', { class: 'notes-empty' }, 'No notes yet. Press + note to add one.'));
      return;
    }
    grid.replaceChildren(
      ...notes.map((n) =>
        h(
          'div',
          { class: `note-card note-${n.color}`, 'data-id': n.id },
          h('button', {
            class: 'note-del',
            title: 'Delete',
            'aria-label': 'Delete note',
            onClick: () => remove(n.id),
          }, '×'),
          h('div', { class: 'note-text' }, n.text),
          h('div', { class: 'note-date' }, fmtDate(n.createdAt)),
        ),
      ),
    );
  }

  async function commitRemove(id: string): Promise<void> {
    notes = notes.filter((n) => n.id !== id);
    await saveNotes(ctx, notes);
    render();
    onChange();
  }

  // Peel the card off (curl-up transition), then drop it from state. Skips the
  // animation under prefers-reduced-motion or if the element is already gone.
  function remove(id: string): void {
    const card = grid.querySelector<HTMLElement>(`.note-card[data-id="${id}"]`);
    if (!card || reducedMotion) {
      commitRemove(id);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      card.removeEventListener('transitionend', onEnd);
      commitRemove(id);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === card && e.propertyName === 'transform') finish();
    };
    card.addEventListener('transitionend', onEnd);
    setTimeout(finish, 420); // guard a missed transitionend
    requestAnimationFrame(() => card.classList.add('peeling'));
  }

  async function show(): Promise<void> {
    notes = await loadNotes(ctx);
    render();
    if (!open) {
      overlay!.appendChild(root);
      // next frame so the opacity transition has a start state
      requestAnimationFrame(() => root.classList.add('open'));
      open = true;
    }
  }

  function close(): void {
    if (!open) return;
    root.classList.remove('open');
    open = false;
    const finish = () => root.remove();
    const onEnd = (e: TransitionEvent) => {
      if (e.target === root) {
        root.removeEventListener('transitionend', onEnd);
        finish();
      }
    };
    root.addEventListener('transitionend', onEnd);
    setTimeout(finish, 260); // guard a missed transitionend
  }

  ctx.bus.on('open-notes-board', show);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) close();
  });
}
