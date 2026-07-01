const path = require("path");
const { spawnSync } = require("child_process");

const { resolveWorkspacePackage } = require("./resolve-workspace-package");

const mobileRoot = path.join(__dirname, "..");
const eslintPath = path.join(resolveWorkspacePackage("eslint"), "bin", "eslint.js");
const result = spawnSync(process.execPath, [eslintPath, "--config", "eslint.config.mjs", "app", "src", "--ext", ".ts,.tsx"], {
  cwd: mobileRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
