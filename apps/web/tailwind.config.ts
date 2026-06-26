import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        surface: "hsl(var(--surface))",
        ink: "hsl(var(--ink))",
      },
    },
  },
  plugins: [],
};

export default config;
