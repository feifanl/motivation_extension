import type { DashboardModule, ModuleContext, SettingsField } from '../../core/types';
import { h } from '../../core/dom';
import { registerFileHandler } from '../../ui/settingsPanel';
import { fileToDataUrl } from './image';

const STORAGE_KEY = 'wallpaperImage';

let ctx: ModuleContext;
let layer: HTMLElement;
let overlay: HTMLElement;

// Paints the solid color instantly, then (for url/upload) swaps in the image
// once it loads. A failed image load leaves the color in place.
function paint(): void {
  const w = ctx.settings.wallpaper;
  layer.style.backgroundColor = w.color;
  layer.style.backgroundImage = '';
  overlay.style.background = 'transparent';

  if (w.mode === 'color') return;

  const apply = (src: string) => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      layer.style.backgroundImage = `url("${src}")`;
      overlay.style.background = `rgb(0 0 0 / ${w.dim})`;
    };
    img.onerror = () => {
      /* keep color */
    };
    img.src = src;
  };

  if (w.mode === 'url') {
    apply(w.url);
  } else {
    // upload: read the stored data URL asynchronously (never blocks first paint)
    ctx.storage.get<string>(STORAGE_KEY, '').then(apply);
  }
}

const schema: SettingsField[] = [
  {
    key: 'wallpaper.mode',
    label: 'Background',
    type: 'select',
    options: [
      { value: 'color', label: 'Solid color' },
      { value: 'url', label: 'Image URL' },
      { value: 'upload', label: 'Uploaded image' },
    ],
  },
  { key: 'wallpaper.color', label: 'Color', type: 'color' },
  { key: 'wallpaper.url', label: 'Image URL', type: 'text', placeholder: 'https://…' },
  { key: 'wallpaper.dim', label: 'Dim overlay', type: 'number', min: 0, max: 0.8, step: 0.05 },
  {
    key: 'wallpaper.image',
    label: 'Upload image',
    type: 'file',
    help: 'JPEG/PNG ≤ 10 MB. Downscaled to 2560px and stored locally.',
  },
];

export const wallpaper: DashboardModule = {
  id: 'wallpaper',
  slot: 'background',
  order: 0,
  settingsSchema: schema,

  init(c) {
    ctx = c;
    registerFileHandler('wallpaper.image', async (file) => {
      const dataUrl = await fileToDataUrl(file);
      await ctx.storage.set(STORAGE_KEY, dataUrl);
      await ctx.saveSettings({ wallpaper: { mode: 'upload' } });
    });
    ctx.bus.on('settings-changed', () => {
      if (layer) paint();
    });
  },

  render(el) {
    layer = h('div', { class: 'wallpaper-layer' });
    overlay = h('div', { class: 'wallpaper-dim' });
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    });
    Object.assign(overlay.style, { position: 'absolute', inset: '0' });
    el.append(layer, overlay);
    paint();
  },
};
