const path = require("path");
const { spawnSync } = require("child_process");

const { resolveWorkspacePackage } = require("./resolve-workspace-package");

const mobileRoot = path.join(__dirname, "..");
const tscPath = path.join(resolveWorkspacePackage("typescript"), "bin", "tsc");
const result = spawnSync(process.execPath, [tscPath, "-p", "tsconfig.json", "--noEmit"], {
  cwd: mobileRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
