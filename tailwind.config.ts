import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cockpit: {
          950: "#050607",
          900: "#0b0d10",
          850: "#11151a",
          800: "#171c22",
          line: "#2a333d"
        },
        signal: {
          blue: "#3ea8ff",
          green: "#4ade80",
          amber: "#f59e0b",
          red: "#ef4444"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(62,168,255,0.18), 0 12px 36px rgba(0,0,0,0.35)"
      }
    }
  },
  plugins: []
};

export default config;
