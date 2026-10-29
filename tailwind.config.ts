import type { Config } from "tailwindcss";

// Colours are CSS variables defined in app/globals.css.
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        page: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        chip: "var(--chip)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        ink: "var(--text)",
        soft: "var(--text-soft)",
        muted: "var(--muted)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        pending: "var(--pending)",
        "allow-bg": "var(--allow-bg)",
        "allow-border": "var(--allow-border)",
        "allow-text": "var(--allow-text)",
        "hold-bg": "var(--hold-bg)",
        "hold-border": "var(--hold-border)",
        "hold-text": "var(--hold-text)",
        "danger-bg": "var(--danger-bg)",
        "danger-border": "var(--danger-border)",
        "danger-text": "var(--danger-text)",
      },
    },
  },
  plugins: [],
};
export default config;
