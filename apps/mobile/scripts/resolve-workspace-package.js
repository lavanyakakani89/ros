const fs = require("fs");
const path = require("path");

function resolveWorkspacePackage(packageName) {
  const mobileRoot = path.join(__dirname, "..");
  const repoRoot = path.join(__dirname, "../../..");

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [mobileRoot, repoRoot],
    });
    return path.dirname(packageJsonPath);
  } catch {
    // Fall back to the pnpm store layout for older local installs.
  }

  const pnpmDir = path.join(__dirname, "../../../node_modules/.pnpm");
  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
  const encodedName = packageName.replace("/", "+");
  const match = entries.find((entry) => entry.isDirectory() && (entry.name === encodedName || entry.name.startsWith(`${encodedName}@`)));

  if (!match) {
    throw new Error(`Unable to locate workspace package: ${packageName}`);
  }

  const packageDir = path.join(pnpmDir, match.name, "node_modules", packageName);
  if (!fs.existsSync(packageDir)) {
    throw new Error(`Workspace package directory not found: ${packageName}`);
  }

  return packageDir;
}

module.exports = { resolveWorkspacePackage };
