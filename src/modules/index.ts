import type { DashboardModule } from '../core/types';
import { wallpaper } from './wallpaper';
import { lifeclock } from './lifeclock';
import { todo } from './todo';
import { quote } from './quote';
import { pins } from './pins';
import { notes } from './notes';
import { search } from './search';
import { help } from './help';

// The only file touched when adding a feature: import the module and append it.
export const modules: DashboardModule[] = [wallpaper, lifeclock, todo, quote, pins, notes, search, help];
