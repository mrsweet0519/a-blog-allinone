import { Router } from "express";
import {
  collectCommentsByUrl,
  createCommentCollectionBridge,
  createCommentReplyBatch,
  createCommentReplyForOne,
  createMainKeywordCandidates,
  generateContextualCaptureReplies,
  generateContextualCaptureReply,
  parseCapturedComments,
  parseManualComments,
  resolveMainKeyword
} from "../services/commentReplyGenerator.js";

export const commentReplyRouter = Router();

const hasRequiredPostFields = (body = {}) => Boolean(body.postTitle);

commentReplyRouter.post("/parse", (req, res) => {
  return res.json({
    comments: parseManualComments(req.body?.raw || "")
  });
});

commentReplyRouter.post("/parse-capture", (req, res) => {
  return res.json({
    comments: parseCapturedComments(req.body?.raw || "")
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
  const options = req.body?.options || {};

  if (!hasRequiredPostFields(form) || !comment.content) {
    return res.status(400).json({
      message: "form.postTitle and comment.content are required."
    });
  }

  return res.json({
    comment:
      options.source === "capture" || comment.source === "capture"
        ? generateContextualCaptureReply(comment, form, previousReplies, options)
        : createCommentReplyForOne(form, comment, previousReplies, options)
  });
});

commentReplyRouter.post("/generate", (req, res) => {
  const { form = {}, comments = [] } = req.body ?? {};
  const options = req.body?.options || {};

  if (!hasRequiredPostFields(form) || !Array.isArray(comments)) {
    return res.status(400).json({
      message: "form.postTitle and comments[] are required."
    });
  }

  return res.json({
    comments:
      options.source === "capture" || comments.some((comment) => comment?.source === "capture")
        ? generateContextualCaptureReplies(comments, form, options)
        : createCommentReplyBatch(form, comments, options)
  });
});

commentReplyRouter.get("/bridge", (_req, res) => {
  return res.json(createCommentCollectionBridge());
});

commentReplyRouter.post("/collect", async (_req, res) => {
  return res.json(await collectCommentsByUrl());
});
