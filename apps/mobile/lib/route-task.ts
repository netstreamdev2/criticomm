import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { recordFixes, ROUTE_TASK } from './tracker';

/**
 * The background task that receives position fixes while on duty.
 *
 * Defined when the app's code first loads (index.ts), before any screen:
 * Android may start the app's code with no screen at all just to hand the
 * task its fixes, and a task defined inside a screen would not exist then.
 */
try {
  TaskManager.defineTask<{ locations?: LocationObject[] }>(ROUTE_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await recordFixes(data.locations);
  });
} catch (e) {
  // A build without the background module: the app records while open instead.
  console.warn('[criticom] route task unavailable', e);
}
