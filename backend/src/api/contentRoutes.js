import { Router } from "express";
import {
  createDraftContent,
  createFinalContent,
  createTitleCandidates,
  createTopicRecommendations
} from "../services/contentGenerator.js";

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

contentRouter.post("/topics", (req, res) => {
  const { keyword, category, goal, tone } = req.body ?? {};

  if (!keyword || !category || !goal || !tone) {
    return res.status(400).json({
      message: "keyword, category, goal, tone are required."
    });
  }

  return res.json({ topics: createTopicRecommendations(req.body) });
});

contentRouter.post("/titles", (req, res) => {
  const { keyword, category, goal, tone, selectedTopic } = req.body ?? {};

  if (!keyword || !category || !goal || !tone || !selectedTopic) {
    return res.status(400).json({
      message: "keyword, category, goal, tone, selectedTopic are required."
    });
  }

  return res.json({ titles: createTitleCandidates(req.body, selectedTopic) });
});

contentRouter.post("/final", (req, res) => {
  const { keyword, category, goal, tone, selectedTopic, selectedTitle } = req.body ?? {};

  if (!keyword || !category || !goal || !tone || !selectedTopic || !selectedTitle) {
    return res.status(400).json({
      message: "keyword, category, goal, tone, selectedTopic, selectedTitle are required."
    });
  }

  return res.json(createFinalContent(req.body, selectedTopic, selectedTitle));
});
