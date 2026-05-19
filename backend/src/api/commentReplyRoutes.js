import { Router } from "express";
import {
  collectCommentsByUrl,
  createCommentCollectionBridge,
  createCommentReplyBatch,
  createCommentReplyForOne,
  createMainKeywordCandidates,
  parseManualComments,
  resolveMainKeyword
} from "../services/commentReplyGenerator.js";

export const commentReplyRouter = Router();

const hasRequiredPostFields = (body = {}) => Boolean(body.blogUrl && body.postTitle);

commentReplyRouter.post("/parse", (req, res) => {
  return res.json({
    comments: parseManualComments(req.body?.raw || "")
  });
});

commentReplyRouter.post("/keyword-candidates", (req, res) => {
  const postTitle = req.body?.postTitle || "";

  return res.json({
    mainKeyword: resolveMainKeyword(req.body || {}),
    keywordCandidates: createMainKeywordCandidates(postTitle)
  });
});

commentReplyRouter.post("/generate-one", (req, res) => {
  const { form = {}, comment = {}, previousReplies = [] } = req.body ?? {};

  if (!hasRequiredPostFields(form) || !comment.content) {
    return res.status(400).json({
      message: "form.blogUrl, form.postTitle, comment.content are required."
    });
  }

  return res.json({
    comment: createCommentReplyForOne(form, comment, previousReplies, req.body?.options || {})
  });
});

commentReplyRouter.post("/generate", (req, res) => {
  const { form = {}, comments = [] } = req.body ?? {};

  if (!hasRequiredPostFields(form) || !Array.isArray(comments)) {
    return res.status(400).json({
      message: "form.blogUrl, form.postTitle, comments[] are required."
    });
  }

  return res.json({
    comments: createCommentReplyBatch(form, comments, req.body?.options || {})
  });
});

commentReplyRouter.get("/bridge", (_req, res) => {
  return res.json(createCommentCollectionBridge());
});

commentReplyRouter.post("/collect", async (_req, res) => {
  return res.json(await collectCommentsByUrl());
});
