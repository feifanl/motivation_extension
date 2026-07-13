// Boot entry.
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';

import { loadSettings, saveSettings } from './core/settings';
import { storage } from './core/storage';
import { bus } from './core/events';
import { mountAll } from './core/registry';
import { mountSettingsPanel } from './ui/settingsPanel';
import type { ModuleContext, Settings } from './core/types';

function applyTheme(theme: Settings['theme']): void {
  document.documentElement.dataset.theme = theme;
}

function applyGlass(on: boolean): void {
  document.documentElement.dataset.glass = on ? 'on' : 'off';
}

// Drive the --z zoom factor: below BASE the dashboard lays out on a virtual
// canvas of BASE size and scales down (see .zoom-root), so a smaller window
// shows a zoomed-out full-screen — pins, life clock, sidebar all shrink and more
// fits. BASE_W sits just above the width the sidebar+centred column need to not
// overlap, so the canvas never falls below it and the layout stays overlap-free
// without any per-breakpoint reflow. Set on <html> so every CSS `/ var(--z)` and
// the pins masonry (which reads it) pick it up.
function installZoom(): void {
  const BASE_W = 1220;
  const BASE_H = 780;
  const MIN = 0.4;
  const apply = (): void => {
    const z = Math.max(MIN, Math.min(1, window.innerWidth / BASE_W, window.innerHeight / BASE_H));
    document.documentElement.style.setProperty('--z', String(Math.round(z * 1000) / 1000));
  };
  window.addEventListener('resize', apply);
  apply();
}

async function boot(): Promise<void> {
  installZoom(); // set --z before anything mounts so first paint is scaled right

  const settings = await loadSettings();
  applyTheme(settings.theme);
  applyGlass(settings.ui.glass);

  const ctx: ModuleContext = {
    settings,
    saveSettings: (patch) => saveSettings(patch).then(() => undefined),
    storage,
    bus,
  };

  // Keep the live snapshot + theme in sync whenever settings change.
  bus.on('settings-changed', (s) => {
    ctx.settings = s as Settings;
    applyTheme(ctx.settings.theme);
    applyGlass(ctx.settings.ui.glass);
  });

  // Settings can also change from outside this page — the service worker's
  // "Add image to pins board" writes storage directly. Reload and re-broadcast
  // so open tabs update live. Skip when the change matches our own last write.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    loadSettings().then((s) => {
      if (JSON.stringify(s) === JSON.stringify(ctx.settings)) return; // our own write
      applyTheme(s.theme);
      applyGlass(s.ui.glass);
      bus.emit('settings-changed', s);
    });
  });

  const app = document.getElementById('app')!;
  await mountAll(ctx, app);

  mountSettingsPanel(ctx);
}

boot();
