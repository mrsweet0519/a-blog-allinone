import cors from "cors";
import express from "express";
import { contentRouter } from "./api/contentRoutes.js";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "a-blog-allinone-backend",
    version: "0.1.0"
  });
});

app.use("/api/content", contentRouter);

app.listen(port, () => {
  console.log(`Backend API is running at http://localhost:${port}`);
});
