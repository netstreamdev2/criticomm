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

module.exports = config;
