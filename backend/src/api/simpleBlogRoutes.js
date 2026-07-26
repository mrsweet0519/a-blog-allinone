import { Router } from "express";
import { runSimpleBlogRequest } from "../../../functions/api/generate-blog-simple.js";

export const simpleBlogRouter = Router();

simpleBlogRouter.post("/", async (req, res) => {
  try {
    const result = await runSimpleBlogRequest({
      payload: req.body || {},
      env: process.env,
      fetchImpl: globalThis.fetch
    });
    res.json(result);
  } catch (error) {
    const status = error?.status || (error?.code === "SIMPLE_INPUT_INVALID" ? 400 : 502);
    res.status(status).json({
      ok: false,
      code: error?.code || error?.reason || "SIMPLE_BETA_FAILED",
      message:
        error?.code === "SIMPLE_INPUT_INVALID"
          ? error.message
          : "빠른 초안을 만들지 못했습니다. 서버 연결 설정을 확인해 주세요.",
      errors: error?.code === "SIMPLE_INPUT_INVALID" ? error.details || [] : []
    });
  }
});
