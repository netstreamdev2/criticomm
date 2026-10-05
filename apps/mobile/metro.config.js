// Monorepo-aware Metro config (Expo SDK 52).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so @criticom/db and @criticom/api hot-reload.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The workspace packages expose subpaths through the package.json "exports"
// field (@criticom/db/client, @criticom/api/rollup, …). Metro ignores that
// field unless this is on, so those imports resolve in tsc and in Next but
// fail at bundle time — which is exactly how they got this far unnoticed.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require', 'import'];

// One React for the whole app. This repo has two (web: React 19, app: React
// 18.3.1), and pnpm's hidden hoisting folder (node_modules/.pnpm/node_modules)
// holds whichever one its last install picked. Packages that use React without
// declaring it, expo-router among them, then load the web's React 19 next to
// the app's 18, and the app dies at start-up with "Objects are not valid as a
// React child". So React and its subpaths always resolve from this app,
// whoever asks, and no install can change that.
const fromThisApp = path.join(projectRoot, 'package.json');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return resolve({ ...context, originModulePath: fromThisApp }, moduleName, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
