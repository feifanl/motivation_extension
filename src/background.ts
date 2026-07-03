// Service worker: right-click any web image → "Add image to pins board".
// Menus are rebuilt from the saved boards so the submenu always matches the
// user's current boards. Clicking appends the image URL to the chosen board;
// the open new-tab picks it up via chrome.storage.onChanged.
import { DEFAULT_SETTINGS, type PinBoard, type Settings } from './core/types';

const PARENT = 'add-to-pins';
const NEW_BOARD = 'pin-board:__new__';
const BOARD_PREFIX = 'pin-board:';

async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return (settings as Settings) ?? DEFAULT_SETTINGS;
}

async function buildMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: PARENT, title: 'Add image to pins board', contexts: ['image'] });

  const boards = (await getSettings()).pins?.boards ?? [];
  for (const b of boards) {
    chrome.contextMenus.create({
      id: BOARD_PREFIX + b.id,
      parentId: PARENT,
      title: b.name || 'Untitled board',
      contexts: ['image'],
    });
  }
  if (boards.length) {
    chrome.contextMenus.create({ id: 'pin-sep', parentId: PARENT, type: 'separator', contexts: ['image'] });
  }
  chrome.contextMenus.create({ id: NEW_BOARD, parentId: PARENT, title: '＋ New board…', contexts: ['image'] });
}

chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) buildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const id = String(info.menuItemId);
  if (!info.srcUrl || (id !== NEW_BOARD && !id.startsWith(BOARD_PREFIX))) return;

  const s = await getSettings();
  const boards = (s.pins.boards ?? []).map((b) => ({ ...b }));

  let boardId: string;
  if (id === NEW_BOARD) {
    boardId = crypto.randomUUID();
    const board: PinBoard = { id: boardId, name: 'Saved', pins: [], rotation: 'off', index: 0 };
    boards.push(board);
  } else {
    boardId = id.slice(BOARD_PREFIX.length);
  }

  const idx = boards.findIndex((b) => b.id === boardId);
  if (idx < 0) return;
  const board = boards[idx];
  // Skip exact-duplicate URLs; keep the source page as the click-through link.
  if (!board.pins.some((p) => p.imageUrl === info.srcUrl)) {
    board.pins = [...board.pins, { imageUrl: info.srcUrl, linkUrl: info.pageUrl || info.srcUrl }];
  }

  const next: Settings = {
    ...s,
    pins: { ...s.pins, boards, enabled: true, activeBoardId: s.pins.activeBoardId ?? boardId },
  };
  await chrome.storage.local.set({ settings: next });
});
