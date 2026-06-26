import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(214 18% 88%)",
        surface: "hsl(210 20% 98%)",
        ink: "hsl(222 34% 12%)",
      },
    },
  },
  plugins: [],
};

export default config;
