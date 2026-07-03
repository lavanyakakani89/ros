import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appRoot, "../..");
const pnpmDir = path.resolve(appRoot, "../../node_modules/.pnpm");

function resolveWorkspacePackage(packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`, { paths: [appRoot, repoRoot] }));
  } catch {
    // Fall back to pnpm's virtual store when the package is not linked into this workspace.
  }

  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true });
  const encodedName = packageName.replace("/", "+");
  const match = entries.find((entry) => entry.isDirectory() && (entry.name === encodedName || entry.name.startsWith(`${encodedName}@`)));

  if (!match) {
    throw new Error(`Unable to resolve ${packageName} from ${pnpmDir}`);
  }

  return path.join(pnpmDir, match.name, "node_modules", packageName);
}

const js = require(path.join(resolveWorkspacePackage("@eslint/js"), "src/index.js"));
const tseslint = require(path.join(resolveWorkspacePackage("typescript-eslint"), "dist/index.js"));

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".expo/**",
      "android/**",
      "ios/**",
      "app/(app)/more/audit-log.tsx",
      "app/(app)/more/coupons.tsx",
      "app/(app)/more/credit-notes.tsx",
      "app/(app)/more/purchases.tsx",
      "app/(app)/more/purchases/*.tsx",
      "app/(app)/more/quotations.tsx",
      "app/(app)/more/suppliers.tsx",
      "app/(app)/more/users.tsx",
      "app/(app)/more/whatsapp-orders.tsx",
      "app/(app)/more/whatsapp-orders/*.tsx",
    ],
  },
  {
    files: ["app/**/*.ts", "app/**/*.tsx", "src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
