// Relative imports inside this module carry explicit .ts extensions so the
// test runner (node --experimental-strip-types) can resolve real files.
// Bundlers resolve them unchanged, and the package sets
// allowImportingTsExtensions so tsc is happy too.
export * from './registry.ts';
export * from './query.ts';
export * from './definitions.ts';
