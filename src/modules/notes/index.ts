import './notes.css';
import type { DashboardModule, ModuleContext, NoteColor, StickyNote } from '../../core/types';
import { h } from '../../core/dom';
import { addNote, loadNotes, mountBoard, saveNotes } from './board';

const COLORS: NoteColor[] = ['green', 'yellow', 'blue', 'red', 'gray'];
const DRAG_OPEN_PX = 120; // rightward drag on the saved-note toast that opens the board

let ctx: ModuleContext;
let host: HTMLElement;
let items: StickyNote[] = [];
let composer: HTMLElement | null = null;
let onKey: ((e: KeyboardEvent) => void) | undefined;
let unsub: (() => void) | undefined;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function openBoard(): void {
  ctx.bus.emit('open-notes-board');
}

// Disabled → render nothing; else the two corner buttons.
function draw(): void {
  if (!ctx.settings.notes.enabled) {
    closeComposer();
    host.replaceChildren();
    return;
  }
  renderButtons();
}

// Small count badge on the arrow button; kept in sync as notes are added/removed.
function renderButtons(): void {
  const addBtn = h(
    'button',
    { class: 'notes-add-btn', title: 'New note', onClick: toggleComposer },
    '＋ note',
  );
  const boardBtn = h(
    'button',
    { class: 'notes-board-btn', title: 'Open notes board (B)', 'aria-label': 'Open notes board', onClick: openBoard },
    '›',
  );
  if (items.length) boardBtn.appendChild(h('span', { class: 'notes-badge' }, String(items.length)));
  host.replaceChildren(addBtn, boardBtn);
}

function closeComposer(): void {
  if (composer) {
    composer.remove();
    composer = null;
  }
}

function toggleComposer(): void {
  if (composer) {
    closeComposer();
    return;
  }
  let color: NoteColor = 'green';

  const textarea = h('textarea', {
    class: 'notes-composer-text',
    maxlength: 500,
    rows: 4,
    placeholder: 'Write a note…',
  }) as HTMLTextAreaElement;

  const counter = h('span', { class: 'notes-composer-count' }, '0 / 500');
  textarea.addEventListener('input', () => {
    counter.textContent = `${textarea.value.length} / 500`;
  });

  const swatches = h(
    'div',
    { class: 'notes-swatches' },
    ...COLORS.map((c) => {
      const sw = h('button', {
        class: `notes-swatch note-${c}${c === color ? ' selected' : ''}`,
        title: c,
        'aria-label': c,
        onClick: () => {
          color = c;
          swatches.querySelectorAll('.notes-swatch').forEach((s) => s.classList.remove('selected'));
          sw.classList.add('selected');
          // repaint the composer paper to the picked colour
          if (composer) composer.className = `notes-composer note-${c}`;
        },
      });
      return sw;
    }),
  );

  const save = () => {
    const text = textarea.value.trim();
    if (!text) return;
    items = addNote(items, text, color);
    saveNotes(ctx, items);
    closeComposer();
    renderButtons();
    showToast(items[0]);
  };

  composer = h(
    'div',
    { class: `notes-composer note-${color} ui-enter` },
    textarea,
    h('div', { class: 'notes-composer-foot' }, swatches, counter),
    h(
      'div',
      { class: 'notes-composer-actions' },
      h('button', { onClick: closeComposer }, 'Cancel'),
      h('button', { class: 'primary', onClick: save }, 'Save'),
    ),
  );
  host.appendChild(composer);
  textarea.focus();
}

// Saved-note toast: a small preview the user can drag right ≥120px to open the
// board. Auto-dismisses after a few seconds if left alone.
function showToast(note: StickyNote): void {
  const toast = h(
    'div',
    { class: `notes-toast note-${note.color} ui-enter`, title: 'Saved — drag right to open the board' },
    h('span', { class: 'notes-toast-text' }, note.text),
  );
  host.appendChild(toast);

  let dismissTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(dismiss, 4000);
  let startX = 0;
  let dx = 0;
  let dragging = false;

  function dismiss(): void {
    if (dismissTimer) clearTimeout(dismissTimer);
    toast.remove();
  }

  toast.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
    }
    toast.setPointerCapture(e.pointerId);
    toast.classList.add('dragging');
  });
  toast.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = Math.max(0, e.clientX - startX);
    toast.style.transform = `translateX(${dx}px)`;
    toast.style.opacity = String(Math.max(0.2, 1 - dx / (DRAG_OPEN_PX * 2)));
  });
  toast.addEventListener('pointerup', () => {
    dragging = false;
    toast.classList.remove('dragging');
    if (dx >= DRAG_OPEN_PX) {
      dismiss();
      openBoard();
    } else {
      // snap back, then resume the auto-dismiss timer
      toast.style.transform = '';
      toast.style.opacity = '';
      dismissTimer = setTimeout(dismiss, 4000);
    }
  });
}

export const notes: DashboardModule = {
  id: 'notes',
  slot: 'corner',
  order: 10,
  settingsSchema: [{ key: 'notes.enabled', label: 'Show notes', type: 'toggle' }],

  async init(c) {
    ctx = c;
    items = await loadNotes(c);
    mountBoard(c, () => {
      // board deleted a note → reload count and refresh the badge
      loadNotes(c).then((n) => {
        items = n;
        if (host) draw();
      });
    });
    onKey = (e) => {
      if (isTyping(e.target)) return;
      if (e.key === 'b' || e.key === 'B') openBoard();
    };
    window.addEventListener('keydown', onKey);
    unsub = c.bus.on('settings-changed', () => {
      if (host) draw();
    });
  },

  render(el) {
    host = el;
    draw();
  },

  destroy() {
    if (onKey) window.removeEventListener('keydown', onKey);
    if (unsub) unsub();
    closeComposer();
  },
};
