import baseConfig from "@bizbil/eslint-config/base";

export default [
  ...baseConfig,
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/coverage/**"]
  }
];
