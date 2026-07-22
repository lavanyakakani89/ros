import baseConfig from "./packages/eslint-config/base.js";

export default [
  ...baseConfig,
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/coverage/**"]
  }
];
