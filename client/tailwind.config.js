/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        fondo: "#f6f4ee",
        superficie: "#ffffff",
        linea: "#ddd8cb",
        tinta: "#14201c",
        marca: {
          DEFAULT: "#1f6b52",
          tinte: "#e4efe9",
        },
        ambar: "#c9862e",
        coral: "#c25a44",
        azul: "#3a6b8a",
        violeta: "#6b5b8a",
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        sutil: "0 1px 2px rgba(20, 32, 28, 0.06), 0 1px 8px rgba(20, 32, 28, 0.04)",
      },
    },
  },
  plugins: [],
};
