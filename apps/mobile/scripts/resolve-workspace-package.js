const fs = require("fs");
const path = require("path");

function resolveWorkspacePackage(packageName) {
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
