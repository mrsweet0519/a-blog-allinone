import { Router } from "express";
import { createDraftContent } from "../services/contentGenerator.js";

export const contentRouter = Router();

contentRouter.post("/generate", (req, res) => {
  const { keyword, category, goal, tone } = req.body ?? {};

  if (!keyword || !category || !goal || !tone) {
    return res.status(400).json({
      message: "keyword, category, goal, tone are required."
    });
  }

  return res.json(createDraftContent(req.body));
});
