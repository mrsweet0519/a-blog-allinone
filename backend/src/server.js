import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { commentAutomationRouter } from "./api/commentAutomationRoutes.js";
import { commentReplyRouter } from "./api/commentReplyRoutes.js";
import { contentRouter } from "./api/contentRoutes.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(dirname, "../../frontend/dist");
const frontendAssetsPath = path.join(frontendDistPath, "assets");
const frontendIndexPath = path.join(frontendDistPath, "index.html");

const app = express();
const port = process.env.PORT || process.env.BACKEND_PORT || 4000;
const defaultCorsOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://a-blog-allinone.onrender.com"
];
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = corsOrigins.length > 0 ? corsOrigins : defaultCorsOrigins;

const isSameOrigin = (origin, host) => {
  if (!origin || !host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

const apiCors = cors((req, callback) => {
  const requestHost = req.get("host");

  callback(null, {
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin) ||
        isSameOrigin(origin, requestHost)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  });
});

app.use(express.json());
app.use("/api", apiCors);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "a-blog-allinone-backend",
    version: "0.1.0"
  });
});

app.use("/api/content", contentRouter);
app.use("/api/comment-replies", commentReplyRouter);
app.use("/api/comment-automation", commentAutomationRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({
    message: "API route not found."
  });
});

app.use(
  "/assets",
  express.static(frontendAssetsPath, {
    fallthrough: false,
    immutable: true,
    maxAge: "1y"
  })
);
app.use("/assets", (error, _req, res, next) => {
  if (!error) {
    next();
    return;
  }

  res.status(error.status || error.statusCode || 500).type("text/plain").send("Static asset not found.");
});

app.use(
  express.static(frontendDistPath, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    }
  })
);

app.get("*", (req, res) => {
  if (path.extname(req.path)) {
    res.status(404).type("text/plain").send("Static asset not found.");
    return;
  }

  if (!fs.existsSync(frontendIndexPath)) {
    res.status(404).send("Frontend build not found. Run `npm run build --prefix frontend` before starting the server.");
    return;
  }

  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(frontendIndexPath);
});

app.listen(port, () => {
  console.log(`Backend API is running on port ${port}`);
});
