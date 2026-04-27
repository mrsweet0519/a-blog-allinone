/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}", "../shared/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Pretendard", "Inter", "system-ui", "sans-serif"]
      },
      colors: {
        ink: "#1f2428",
        paper: "#f7f7f2",
        line: "#dedbd2",
        moss: "#52796f",
        coral: "#d66a5f",
        amber: "#c9973f"
      },
      boxShadow: {
        soft: "0 18px 45px rgba(31, 36, 40, 0.08)"
      }
    }
  },
  plugins: []
};
