/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefdf5", 100: "#d7f9e6", 200: "#b2f1d0", 300: "#7ee4b3",
          400: "#43ce90", 500: "#1cb474", 600: "#10925d", 700: "#0e744c",
          800: "#0e5c3e", 900: "#0d4c34",
        },
      },
    },
  },
  plugins: [],
};
