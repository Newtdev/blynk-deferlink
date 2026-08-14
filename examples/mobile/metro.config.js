// Monorepo Metro config: watch the workspace root so the linked SDK source is
// bundled, and resolve modules from both the app and the root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Ensure a single React copy across the app and the linked SDK.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
