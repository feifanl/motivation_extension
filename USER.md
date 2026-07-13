# Inspire - A Better New Tab - User Guide

A new-tab dashboard with a life clock, daily todos (optionally synced with Trello), a daily quote, a pins wall, and sticky notes. Everything lives locally in your browser.

This file lists every keybind and every setting.

---

## Keybinds

| Key | Action | Where |
|---|---|---|
| `up` / `+` / `=` | Zoom in (toward day) | Life clock |
| `down` / `-` / `_` | Zoom out (toward life) | Life clock |
| Mouse wheel | Scroll up to zoom in, down to zoom out | Over the life clock |
| `[` | Previous board | Pins wall (one-board mode) |
| `]` | Next board | Pins wall (one-board mode) |
| `B` | Open the notes board | Anywhere |
| `Enter` | Add the typed task | Todo input |
| `Enter` | Run the web search | Search bar |
| `Esc` | Close the open overlay or settings panel | Notes board, settings |

Keybinds are ignored while you're typing in a text field.

### On-screen controls

You never *need* the keyboard.

- **Life clock:** the `-` / `+` zoom buttons, or click any view name in the breadcrumb (`day, week, month, year, decade, life`) to jump to it.
- **Pins:** a chevron tab (top-right) opens the board switcher (`<` name `>`); `[` / `]` also cycle boards. Drag a pin to move it; a plain click opens its link.
- **Notes:** `+ note` opens the composer; the `>` arrow button (with a count badge) opens the board. You can also drag a freshly-saved note toast to the right to open the board.
- **Collapse tabs:** the quote, todo, and life-clock panels each have a small arrow tab to hide or show them.
- **Settings:** the gear button (bottom-left). Its header holds the theme and liquid-glass toggles.
- **Help:** the `?` button (bottom-right) opens this guide.

---

## Settings

Open with the gear button.

### Header buttons

- **Theme** - dark or light. Defaults to dark. Sticks across restarts.
- **Liquid glass** - frosted translucent surfaces (cards, panel, notes board) vs flat opaque ones. 0Defaults to on.

### Life clock

The life clock is a reminder that time is finite, not a reason to spiral. Watch a bit of each day, week, month, year, decade, and life tick by.

- **Birthday** - `YYYY-MM-DD`. Unset by default. Needed for the decade and life views (day/week/month/year work without it).
- **Life expectancy (years)** - 1 to 120. Defaults to 80. Your "death date" is your birthday plus this many years.
- **Default view** - which view loads first: day / week / month / year / decade / life. Defaults to month.

### Wallpaper

- **Background** - Solid color, Image URL, or Uploaded image. Defaults to Solid color.
- **Color** - the solid color, and the instant fallback behind any image. Defaults to `#0d1117`.
- **Image URL** - a remote image, used in Image URL mode. A bad URL quietly falls back to the color.
- **Dim overlay** - 0 to 0.8 black overlay over the image so text stays readable. Defaults to 0.35.
- **Upload image** - pick a local image (up to 10 MB). It's downscaled to 2560 px, re-encoded as JPEG, and stored locally.

### Todo

- **Sync with Trello** - off by default. Purely local until you turn it on.
- **Trello API key**, **Trello token** - generate both at [trello.com/power-ups/admin](https://trello.com/power-ups/admin).
- **Trello list ID** - open the list's "Copy link"; the list ID is the last part of the path.

With all three creds set, cards in the list show up locally, adding a task creates a card, and checking it archives the card. Offline or bad creds keep todos fully local (grey status dot, no errors). **Clear** wipes local items only; it never touches Trello cards.

### Quote

- **Show quote** - on by default.
- **Fetch daily quote online** - on by default. Pulls ZenQuotes' quote of the day. Off means bundled offline quotes only.
- **Offline categories** - Philosophy, Self-help, Morality, all on by default. They filter the bundled offline pool used when the API is off or unreachable. Turn all three off (with the API off) to hide the card.

### Pins

- **Show pins wall** - off by default.
- **Fill with** - One board, or All boards pooled. Defaults to One board.
- **Boards** - add named boards (e.g. "hopecore"). Each board has a pin editor: drop image files onto it, paste an image or URL, add URLs by hand, drag thumbnails to reorder, and remove pins with the `x`. Dropped or pasted images are downscaled and stored locally. You can also drag pins on the wall to rearrange them.
- **Auto-switch board** - Off, Daily, or Every N minutes (one-board mode only). Defaults to Off. Off means switch by hand with `[` `]` or the header selector.
- **Board interval (min)** - used when auto-switch is "Every N minutes".
- **Rotate pins on screen** - Off, Daily, Every N minutes, or Panorama scroll. Defaults to Off. When a board has more pins than fit on screen, cycle through them. Daily and interval jump a full screenful; Panorama scroll drifts left slowly and loops through every pin, pausing while you drag a pin, then resuming.
- **Screen rotation interval (min)** - used when screen rotation is "Every N minutes".
- **Scroll speed (seconds per column)** - panorama only. Higher is slower. Defaults to 20.

**Add pins while browsing:** right-click any image on the web, pick **Add image to pins board**, then choose a board (or "+ New board..."). It saves instantly and shows up on the wall next time you open a tab.

### Search

- **Show search bar** - on by default. A glass pill above the life clock, focused on a fresh tab. Type and press `Enter`.
- **Search engine** - Google, DuckDuckGo, Brave, or Bing. Defaults to Google.

### Notes

- **Show notes** - on by default. Off hides the corner buttons.

Notes are sticky-note paper in five colors (green, yellow, blue, red, gray). Pick a color in the composer and the paper matches. Deleting a note peels it off the board. Notes stick around forever and cap at 500 characters each.

---

## Data and privacy

- Everything is stored in `chrome.storage.local` on your machine. Nothing is sent to any server I run.
- The only outbound network calls are:
  - **Trello** - only if you enable sync and enter credentials.
  - **ZenQuotes** - only if the quote "fetch online" toggle is on.
- With both off, or offline, the dashboard still works fully: fonts are bundled, the wallpaper paints its color first, and quotes fall back to the bundled set.
- The right-click "Add image to pins board" feature uses the `contextMenus` permission and a small background worker. It reads only the URL of the image you right-click and writes it to your local boards. No page content is collected and nothing is uploaded.

---

Questions or feature requests? Email me at [feifan.liu@utexas.edu](mailto:feifan.liu@utexas.edu).
