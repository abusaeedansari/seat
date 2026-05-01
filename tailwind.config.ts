import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        chalk: "#F8FBFA",
        ink: "#263238",
        berry: "#F7C9D4",
        skysoft: "#BFE4F8",
        mintsoft: "#C9EAD9",
        sunsoft: "#FFE8A8",
        lilacsoft: "#DDD2F3",
      },
      boxShadow: {
        soft: "0 16px 40px rgba(38, 50, 56, 0.10)",
        insetsoft: "inset 0 1px 0 rgba(255, 255, 255, 0.75)",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
};

export default config;
