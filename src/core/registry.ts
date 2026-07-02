import type { ModuleContext, Slot } from './types';
import { h } from './dom';
import { modules } from '../modules';

// Builds the fixed slot scaffold inside #app, then mounts every module.
// A single module throwing in init/render never blanks the tab: it is logged
// and skipped.
export async function mountAll(ctx: ModuleContext, root: HTMLElement): Promise<void> {
  root.replaceChildren();

  const background = h('div', { class: 'slot-background' });
  const main = h('div', { class: 'slot-main' });
  const sidebar = h('div', { class: 'slot-sidebar' });
  const layout = h('div', { class: 'layout' }, sidebar, main);
  const corner = h('div', { class: 'slot-corner' });
  const overlay = h('div', { class: 'slot-overlay' });
  root.append(background, layout, corner, overlay);

  const containers: Record<Slot, HTMLElement> = {
    background,
    main,
    sidebar,
    corner,
    overlay,
  };

  const sorted = [...modules].sort((a, b) => a.order - b.order);
  for (const mod of sorted) {
    const host = h('div', { class: `mod mod-${mod.id}` });
    containers[mod.slot].appendChild(host);
    try {
      await mod.init(ctx);
    } catch (err) {
      console.warn(`[module ${mod.id}] init failed, skipping render`, err);
      host.remove();
      continue;
    }
    try {
      mod.render(host);
    } catch (err) {
      console.warn(`[module ${mod.id}] render failed`, err);
      host.remove();
    }
  }
}
