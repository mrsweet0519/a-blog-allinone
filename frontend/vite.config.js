import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      "@shared": path.resolve(dirname, "../shared")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: [path.resolve(dirname, "..")]
    }
  }
});
