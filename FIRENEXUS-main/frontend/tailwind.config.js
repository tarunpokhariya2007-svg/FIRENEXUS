/** @type {import('tailwindcss').Config} */
// Colour values live in src/index.css as CSS variables (RGB channel triplets).
// That file is the single source of truth; this config only references them so
// Tailwind opacity modifiers such as bg-primary/10 keep working.
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "surface-container-low": "rgb(var(--color-surface-container-low) / <alpha-value>)",
        "on-error": "rgb(var(--color-on-error) / <alpha-value>)",
        "tertiary-fixed-dim": "rgb(var(--color-tertiary-fixed-dim) / <alpha-value>)",
        "secondary-fixed": "rgb(var(--color-secondary-fixed) / <alpha-value>)",
        "tertiary": "rgb(var(--color-tertiary) / <alpha-value>)",
        "on-secondary-fixed-variant": "rgb(var(--color-on-secondary-fixed-variant) / <alpha-value>)",
        "on-secondary-container": "rgb(var(--color-on-secondary-container) / <alpha-value>)",
        "secondary-fixed-dim": "rgb(var(--color-secondary-fixed-dim) / <alpha-value>)",
        "on-surface": "rgb(var(--color-on-surface) / <alpha-value>)",
        "primary-fixed": "rgb(var(--color-primary-fixed) / <alpha-value>)",
        "inverse-surface": "rgb(var(--color-inverse-surface) / <alpha-value>)",
        "on-tertiary-fixed-variant": "rgb(var(--color-on-tertiary-fixed-variant) / <alpha-value>)",
        "secondary": "rgb(var(--color-secondary) / <alpha-value>)",
        "tertiary-fixed": "rgb(var(--color-tertiary-fixed) / <alpha-value>)",
        "on-tertiary-fixed": "rgb(var(--color-on-tertiary-fixed) / <alpha-value>)",
        "surface-container-high": "rgb(var(--color-surface-container-high) / <alpha-value>)",
        "inverse-on-surface": "rgb(var(--color-inverse-on-surface) / <alpha-value>)",
        "background": "rgb(var(--color-background) / <alpha-value>)",
        "error": "rgb(var(--color-error) / <alpha-value>)",
        "outline": "rgb(var(--color-outline) / <alpha-value>)",
        "outline-variant": "rgb(var(--color-outline-variant) / <alpha-value>)",
        "surface-container-lowest": "rgb(var(--color-surface-container-lowest) / <alpha-value>)",
        "surface-container-highest": "rgb(var(--color-surface-container-highest) / <alpha-value>)",
        "surface-variant": "rgb(var(--color-surface-variant) / <alpha-value>)",
        "surface-container": "rgb(var(--color-surface-container) / <alpha-value>)",
        "secondary-container": "rgb(var(--color-secondary-container) / <alpha-value>)",
        "surface-tint": "rgb(var(--color-surface-tint) / <alpha-value>)",
        "on-tertiary": "rgb(var(--color-on-tertiary) / <alpha-value>)",
        "tertiary-container": "rgb(var(--color-tertiary-container) / <alpha-value>)",
        "surface": "rgb(var(--color-surface) / <alpha-value>)",
        "on-primary": "rgb(var(--color-on-primary) / <alpha-value>)",
        "on-secondary-fixed": "rgb(var(--color-on-secondary-fixed) / <alpha-value>)",
        "primary-fixed-dim": "rgb(var(--color-primary-fixed-dim) / <alpha-value>)",
        "surface-bright": "rgb(var(--color-surface-bright) / <alpha-value>)",
        "on-tertiary-container": "rgb(var(--color-on-tertiary-container) / <alpha-value>)",
        "on-secondary": "rgb(var(--color-on-secondary) / <alpha-value>)",
        "on-surface-variant": "rgb(var(--color-on-surface-variant) / <alpha-value>)",
        "on-error-container": "rgb(var(--color-on-error-container) / <alpha-value>)",
        "on-primary-fixed": "rgb(var(--color-on-primary-fixed) / <alpha-value>)",
        "on-primary-container": "rgb(var(--color-on-primary-container) / <alpha-value>)",
        "primary": "rgb(var(--color-primary) / <alpha-value>)",
        "surface-dim": "rgb(var(--color-surface-dim) / <alpha-value>)",
        "primary-container": "rgb(var(--color-primary-container) / <alpha-value>)",
        "error-container": "rgb(var(--color-error-container) / <alpha-value>)",
        "inverse-primary": "rgb(var(--color-inverse-primary) / <alpha-value>)",
        "on-primary-fixed-variant": "rgb(var(--color-on-primary-fixed-variant) / <alpha-value>)",
        "on-background": "rgb(var(--color-on-background) / <alpha-value>)",
        "modis": "rgb(var(--color-modis) / <alpha-value>)",
        "viirs": "rgb(var(--color-viirs) / <alpha-value>)",
        "fire": "rgb(var(--color-fire) / <alpha-value>)",
        "fire-severe": "rgb(var(--color-fire-severe) / <alpha-value>)",
        "validated": "rgb(var(--color-validated) / <alpha-value>)",
        "border-grid": "rgb(var(--color-border-grid) / <alpha-value>)",
      },
      borderColor: {
        DEFAULT: "rgb(var(--color-border-grid) / <alpha-value>)",
      },
      borderRadius: {
        "DEFAULT": "0.375rem",
        "xs": "0.25rem",
        "sm": "0.25rem",
        "md": "0.375rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "2xl": "1rem",
        "full": "9999px"
      },
      boxShadow: {
        "card": "0 1px 2px rgb(27 27 24 / 0.04), 0 1px 3px rgb(27 27 24 / 0.06)",
        "raised": "0 4px 12px rgb(27 27 24 / 0.08), 0 1px 3px rgb(27 27 24 / 0.06)",
        "drawer": "0 0 40px rgb(27 27 24 / 0.18)"
      },
      // 8px-based scale. Existing page classes (p-space-lg, gap-space-md ...) pick these up automatically.
      spacing: {
        "margin": "1.5rem",
        "space-xs": "0.25rem",
        "space-sm": "0.5rem",
        "space-md": "1rem",
        "gutter": "1rem",
        "space-lg": "1.5rem",
        "space-xl": "2rem"
      },
      fontFamily: {
        // Interface and body
        "sans": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        "body": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        "body-lg": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        "body-md": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        "body-sm": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        // Page titles only
        "display": ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        "headline-lg": ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        // Section and card headings stay in Inter
        "headline-md": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        "headline-sm": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        // Labels are ordinary interface text, so they use Inter, not monospace
        "label-xs": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        "label-sm": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        "label-md": ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "'Segoe UI'", "Roboto", "sans-serif"],
        // Coordinates, IDs, hashes and other technical values (opt in with font-mono)
        "mono": ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"]
      },
      fontSize: {
        "body-lg": ["0.9375rem", { lineHeight: "1.5rem", letterSpacing: "0em", fontWeight: "400" }],
        "body-md": ["0.875rem", { lineHeight: "1.375rem", letterSpacing: "0em", fontWeight: "400" }],
        "body-sm": ["0.8125rem", { lineHeight: "1.25rem", letterSpacing: "0em", fontWeight: "400" }],
        "label-xs": ["0.75rem", { lineHeight: "1rem", letterSpacing: "0em", fontWeight: "500" }],
        "label-sm": ["0.75rem", { lineHeight: "1rem", letterSpacing: "0em", fontWeight: "500" }],
        "label-md": ["0.8125rem", { lineHeight: "1.125rem", letterSpacing: "0em", fontWeight: "500" }],
        "headline-lg": ["1.75rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-md": ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em", fontWeight: "600" }],
        "headline-sm": ["1rem", { lineHeight: "1.5rem", letterSpacing: "-0.005em", fontWeight: "600" }]
      }
    }
  },
  plugins: [],
}
