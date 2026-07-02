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

async function boot(): Promise<void> {
  const settings = await loadSettings();
  applyTheme(settings.theme);

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
  });

  const app = document.getElementById('app')!;
  await mountAll(ctx, app);

  mountSettingsPanel(ctx);
}

boot();
