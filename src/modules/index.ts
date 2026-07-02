import type { DashboardModule } from '../core/types';
import { wallpaper } from './wallpaper';

// The only file touched when adding a feature: import the module and append it.
export const modules: DashboardModule[] = [wallpaper];
