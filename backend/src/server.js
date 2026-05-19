import cors from "cors";
import express from "express";
import { commentReplyRouter } from "./api/commentReplyRoutes.js";
import { contentRouter } from "./api/contentRoutes.js";

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

app.listen(port, () => {
  console.log(`Backend API is running on port ${port}`);
});
