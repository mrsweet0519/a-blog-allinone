import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const explicitDeployTarget = process.env.VITE_DEPLOY_TARGET || process.env.DEPLOY_TARGET || "";
const deployTarget =
  explicitDeployTarget ||
  (process.env.CF_PAGES
    ? "cloudflare-pages"
    : process.env.VERCEL
      ? "vercel"
      : process.env.GITHUB_PAGES || process.env.PAGES_BUILD_DEPLOYMENT
        ? "github-pages"
        : process.env.RENDER
          ? "render"
          : "");
const routerMode = process.env.VITE_ROUTER_MODE || (deployTarget === "github-pages" ? "hash" : "browser");
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __BLOG_ALLINONE_DEPLOY_TARGET__: JSON.stringify(deployTarget),
    __BLOG_ALLINONE_ROUTER_MODE__: JSON.stringify(routerMode)
  },
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
