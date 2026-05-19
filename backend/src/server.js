import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { commentReplyRouter } from "./api/commentReplyRoutes.js";
import { contentRouter } from "./api/contentRoutes.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(dirname, "../../frontend/dist");
const frontendIndexPath = path.join(frontendDistPath, "index.html");

const app = express();
const port = process.env.PORT || process.env.BACKEND_PORT || 4000;
const defaultCorsOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"];
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = corsOrigins.length > 0 ? corsOrigins : defaultCorsOrigins;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "a-blog-allinone-backend",
    version: "0.1.0"
  });
});

app.use("/api/content", contentRouter);
app.use("/api/comment-replies", commentReplyRouter);
app.use("/api", (_req, res) => {
  res.status(404).json({
    message: "API route not found."
  });
});

app.use(express.static(frontendDistPath));

app.get("*", (_req, res) => {
  if (!fs.existsSync(frontendIndexPath)) {
    res.status(404).send("Frontend build not found. Run `npm run build --prefix frontend` before starting the server.");
    return;
  }

  res.sendFile(frontendIndexPath);
});

app.listen(port, () => {
  console.log(`Backend API is running on port ${port}`);
});
