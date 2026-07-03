# Last Sunday — User Guide

A memento-mori new-tab dashboard: a life clock, daily todos (optionally Trello-synced), a daily quote, a pins wall, and sticky notes. Everything lives locally in your browser.

This file is the source of truth for **every keybind and every setting**. If it isn't here, it isn't in the app.

---

## Keybinds

| Key | Action | Where |
|---|---|---|
| `↑` / `+` / `=` | Zoom in (toward day) | Life clock |
| `↓` / `-` / `_` | Zoom out (toward life) | Life clock |
| Mouse wheel | Scroll up = zoom in, down = zoom out | Over the life clock |
| `[` | Previous board | Pins wall (one-board mode) |
| `]` | Next board | Pins wall (one-board mode) |
| `B` | Open the notes board | Anywhere |
| `Enter` | Add the typed task | Todo input |
| `Esc` | Close the open overlay / settings panel | Notes board, settings |

Keybinds are ignored while you're typing in a text field.

### On-screen controls (no keyboard needed)

- **Life clock:** `−` / `+` zoom buttons; click any view name in the breadcrumb (`day · week · month · year · decade · life`) to jump straight to it.
- **Pins:** `‹` / `›` board selector in the card header; the `✎` button toggles rearrange mode (drag pins to reorder).
- **Notes:** `＋ note` opens the composer; the `›` arrow button (with a count badge) opens the board. You can also drag a freshly-saved note toast to the right (~120 px) to open the board.
- **Collapse tabs:** the quote, todo, and life-clock panels each have a small arrow tab to hide/show them.
- **Settings:** the `⚙` gear (bottom-left). Theme toggles with the `☾` / `☀` button in the settings header.

---

## Settings

Open with the `⚙` gear button. Grouped into one tab per module.

### General
- **Theme** — dark or light, toggled with the `☾` / `☀` button. Default: **dark**. Persists across restarts.

### Life clock
- **Birthday** — `YYYY-MM-DD`. Default: **unset**. Needed for the decade and life views (day/week/month/year work without it).
- **Life expectancy (years)** — 1–120. Default: **80**. The "death date" is your birthday plus this many calendar years.
- **Default view** — which view loads first: day / week / month / year / decade / life. Default: **month**.

### Wallpaper
- **Background** — Solid color / Image URL / Uploaded image. Default: **Solid color**.
- **Color** — the solid color (and the instant fallback behind any image). Default: **`#0d1117`**.
- **Image URL** — remote image, used in "Image URL" mode. An unreachable URL silently falls back to the color.
- **Dim overlay** — 0–0.8 black overlay over the image for text legibility. Default: **0.35**.
- **Upload image** — pick a local image (≤ 10 MB). It's downscaled to ≤ 2560 px, re-encoded as JPEG, and stored locally.

### Todo
- **Sync with Trello** — off by default. Purely local until enabled.
- **Trello API key**, **Trello token** — generate both at [trello.com/power-ups/admin](https://trello.com/power-ups/admin).
- **Trello list ID** — open the list's "Copy link"; the list ID is the last path segment.

When enabled with all three creds, cards in the configured list appear locally, adding a task creates a card, and checking it archives the card. Offline or bad creds → todos stay fully local (grey status dot, no errors). **Clear** wipes local items only — it never deletes Trello cards.

### Quote
- **Show quote** — on by default.
- **Fetch daily quote online** — on by default. Pulls ZenQuotes' quote of the day. Off → bundled offline quotes only.
- **Offline categories** — Philosophy / Self-help / Morality, all on by default. These filter the bundled offline pool used when the API is off or unreachable. Turning all three off (with the API off) hides the card.

### Pins
- **Show pins wall** — off by default.
- **Fill with** — One board / All boards pooled. Default: **One board**.
- **Boards** — add named boards (e.g. "hopecore"), each with image URLs, one per line.
- **Auto-switch board** — Off / Daily / Every N minutes (one-board mode only). Default: **Off**. Off = switch manually with `[` `]` or the header selector.
- **Board interval (min)** — used when auto-switch is "Every N minutes".

### Notes
- **Show notes** — on by default. Off hides the corner buttons.

Notes are sticky-note "paper" in five colors (green / yellow / blue / red / gray). Pick a color in the composer; the composer paper changes to match. Deleting a note peels it off the board. Notes persist indefinitely and are capped at 500 characters each.

---

## Data & privacy

- Everything is stored in `chrome.storage.local` on your machine. Nothing is sent to any server we run.
- The **only** outbound network calls are:
  - **Trello** — only if you enable sync and enter credentials.
  - **ZenQuotes** — only if the quote "fetch online" toggle is on.
- With both off (or offline), the dashboard is fully functional: fonts are bundled, the wallpaper paints its color first, and quotes fall back to the bundled set.
