// The background route task must exist before anything else loads (see lib/route-task.ts).
import './lib/route-task';
import { AppRegistry } from 'react-native';
// Runs for as long as the officer is on duty on a radio or hard hat, so the app's
// timers keep going with the screen off (modules/radio-keys keepJsRunning).
AppRegistry.registerHeadlessTask('HikTechKeepRunning', () => () => new Promise<void>(() => {}));
import 'expo-router/entry';
