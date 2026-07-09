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
export function updateNote(list: StickyNote[], id: string, text: string): StickyNote[] {
  return list.map((n) => (n.id === id ? { ...n, text: text.slice(0, 500) } : n));
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
  let closing = false; // true while the close fade is running (before detach)
  let editingId: string | null = null; // note whose text is being edited inline

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
    grid.replaceChildren(...notes.map((n) => (editingId === n.id ? editCard(n) : viewCard(n))));
    // focus the edit box (and drop the cursor at the end) once it's in the DOM
    if (editingId) {
      const ta = grid.querySelector<HTMLTextAreaElement>('.note-card.editing .note-edit-text');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }

  // Static card. Clicking the text switches it into the edit form.
  function viewCard(n: StickyNote): HTMLElement {
    return h(
      'div',
      { class: `note-card note-${n.color}`, 'data-id': n.id },
      h('button', {
        class: 'note-del',
        title: 'Delete',
        'aria-label': 'Delete note',
        onClick: () => remove(n.id),
      }, '×'),
      h('div', { class: 'note-text', title: 'Click to edit', onClick: () => beginEdit(n.id) }, n.text),
      h('div', { class: 'note-date' }, fmtDate(n.createdAt)),
    );
  }

  // Edit form: textarea + Save/Cancel. Ctrl/⌘+Enter saves, Esc cancels.
  function editCard(n: StickyNote): HTMLElement {
    const ta = h('textarea', {
      class: 'note-edit-text',
      maxlength: 500,
      value: n.text,
    }) as HTMLTextAreaElement;
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't let Esc also close the board
        cancelEdit();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        commitEdit(n.id, ta.value);
      }
    });
    return h(
      'div',
      { class: `note-card note-${n.color} editing`, 'data-id': n.id },
      ta,
      h(
        'div',
        { class: 'note-edit-actions' },
        h('button', { onClick: cancelEdit }, 'Cancel'),
        h('button', { class: 'primary', onClick: () => commitEdit(n.id, ta.value) }, 'Save'),
      ),
      h('div', { class: 'note-date' }, fmtDate(n.createdAt)),
    );
  }

  function beginEdit(id: string): void {
    editingId = id;
    render();
  }

  function cancelEdit(): void {
    editingId = null;
    render();
  }

  async function commitEdit(id: string, text: string): Promise<void> {
    const t = text.trim();
    editingId = null;
    if (t) {
      notes = updateNote(notes, id, t);
      await saveNotes(ctx, notes);
      onChange();
    }
    render();
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
    editingId = null;
    render();
    if (open) return;
    open = true;
    closing = false; // cancel any pending close so it can't yank a reopened board
    if (!root.isConnected) overlay!.appendChild(root);
    // next frame so the opacity transition has a start state
    requestAnimationFrame(() => root.classList.add('open'));
  }

  function close(): void {
    if (!open) return;
    root.classList.remove('open');
    open = false;
    closing = true;
    // Only detach if we're still closing — a reopen during the fade clears the flag.
    const finish = () => {
      if (!closing) return;
      closing = false;
      root.removeEventListener('transitionend', onEnd);
      root.remove();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === root) finish();
    };
    root.addEventListener('transitionend', onEnd);
    setTimeout(finish, 260); // guard a missed transitionend
  }

  ctx.bus.on('open-notes-board', show);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) close();
  });
}
