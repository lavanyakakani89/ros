const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.maxWorkers = 1;
config.watchFolders = [path.resolve(monorepoRoot, "packages/shared")];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  "@retailos/shared": path.resolve(monorepoRoot, "packages/shared"),
};

module.exports = config;
