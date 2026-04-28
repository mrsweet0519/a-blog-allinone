import { Router } from "express";
import {
  createCtaCandidates,
  createDraftContent,
  createFinalContent,
  createOpeningSentenceCandidates,
  createOutlineSections,
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

contentRouter.post("/outline", (req, res) => {
  const { keyword, category, goal, tone, selectedTopic, selectedTitle } = req.body ?? {};

  if (!keyword || !category || !goal || !tone || !selectedTopic || !selectedTitle) {
    return res.status(400).json({
      message: "keyword, category, goal, tone, selectedTopic, selectedTitle are required."
    });
  }

  return res.json({ outlineSections: createOutlineSections(req.body, selectedTopic, selectedTitle) });
});

contentRouter.post("/writing-choices", (req, res) => {
  const { keyword, category, goal, tone } = req.body ?? {};

  if (!keyword || !category || !goal || !tone) {
    return res.status(400).json({
      message: "keyword, category, goal, tone are required."
    });
  }

  return res.json({
    openingSentenceCandidates: createOpeningSentenceCandidates(req.body),
    ctaCandidates: createCtaCandidates(req.body)
  });
});

contentRouter.post("/final", (req, res) => {
  const { keyword, category, goal, tone, selectedTopic, selectedTitle } = req.body ?? {};

  if (!keyword || !category || !goal || !tone || !selectedTopic || !selectedTitle) {
    return res.status(400).json({
      message: "keyword, category, goal, tone, selectedTopic, selectedTitle are required."
    });
  }

  return res.json(
    createFinalContent(req.body, selectedTopic, selectedTitle, req.body.outlineSections, {
      selectedOpeningSentence: req.body.selectedOpeningSentence,
      selectedCtaSentence: req.body.selectedCtaSentence
    })
  );
});
