import { Router } from "express";
import {
  createCommentReplyBatch,
  findForbiddenWords,
  normalizeComment,
  resolveMainKeyword,
  splitForbiddenWords
} from "../services/commentReplyGenerator.js";
import {
  getBlogAutomationLogs,
  getBlogAutomationStatus,
  registerRepliesByBridge,
  runLegacyReplyAutomation,
  scanCommentsByUrl,
  stopBlogAutomation
} from "../services/blogAutomationBridge.js";

export const commentAutomationRouter = Router();

const fallbackReplyPhrases = [
  "소중한 댓글 감사합니다",
  "댓글 감사합니다",
  "댓글 남겨주셔서 감사합니다",
  "좋은 댓글 감사합니다",
  "방문해주셔서 감사합니다"
];

const createReport = (comments = [], overrides = {}) => {
  const skipped = comments.filter(
    (comment) => comment.status === "스킵 권장" || comment.skipReason || comment.hasOwnerReply || comment.isOwnerComment
  );
  const failed = comments.filter((comment) => comment.registerStatus === "등록 실패" || comment.errorMessage);

  return {
    totalComments: comments.length,
    targetComments: Math.max(0, comments.length - skipped.length),
    skippedCount: skipped.length,
    generatedCount: comments.filter((comment) => Boolean(comment.reply)).length,
    registeredCount: comments.filter((comment) => comment.registerStatus === "등록 완료").length,
    failedCount: failed.length,
    retryCount: comments.reduce((sum, comment) => sum + (Number(comment.retryCount) || 0), 0),
    exitReason: "",
    failedComments: failed.map((comment) => ({
      id: comment.id,
      author: comment.author,
      content: comment.content,
      reason: comment.errorMessage || comment.skipReason || "등록 실패"
    })),
    ...overrides
  };
};

const hasRequiredUrlFields = (form = {}) => Boolean(form.blogUrl && form.postTitle);

const text = (value) => String(value || "").trim();

const normalizeToken = (value) =>
  text(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

const tokenSet = (value) =>
  new Set(
    normalizeToken(value)
      .split(/\s+/u)
      .map((token) => token.replace(/(은|는|이|가|을|를|도|만|요|에|의|로|으로)$/u, ""))
      .filter((token) => token.length > 1)
  );

const hasFallbackReplyPhrase = (reply = "") => {
  const normalizedReply = normalizeToken(reply).replace(/\s+/gu, "");
  return fallbackReplyPhrases.some((phrase) => normalizedReply.includes(normalizeToken(phrase).replace(/\s+/gu, "")));
};

const estimateRelationRisk = (comment = {}) => {
  const contentTokens = tokenSet(comment.content);
  const replyTokens = tokenSet(comment.reply);

  if (contentTokens.size < 2 || replyTokens.size < 2) return "low";

  for (const token of contentTokens) {
    if (replyTokens.has(token)) return "low";
  }

  if (comment.type === "짧은반응형" || comment.type === "공감형") return "medium";
  return "high";
};

const validateReplyBeforeRegistration = (form = {}, comment = {}) => {
  const normalized = normalizeComment(comment);
  const forbiddenWords = splitForbiddenWords(form);
  const forbiddenWordsFound = findForbiddenWords(normalized.reply, forbiddenWords);
  const errors = [];

  if (normalized.isOwnerComment) errors.push("내 계정이 작성한 원댓글입니다.");
  if (normalized.hasOwnerReply) errors.push("이미 내 계정 대댓글이 있습니다.");
  if (!normalized.reply) errors.push("대댓글 내용이 비어 있습니다.");
  if (forbiddenWordsFound.length > 0) errors.push(`금지어 포함: ${forbiddenWordsFound.join(", ")}`);
  if (hasFallbackReplyPhrase(normalized.reply)) errors.push("fallback 고정 문구로 보일 수 있습니다.");
  if (normalized.status === "스킵 권장") errors.push(normalized.skipReason || "스킵 권장 댓글입니다.");
  if (normalized.duplicateRisk === "재생성 권장") errors.push("중복 위험이 높습니다.");
  if (estimateRelationRisk(normalized) === "high") errors.push("원댓글과 무관한 답변일 위험이 높습니다.");

  return {
    ...normalized,
    forbiddenWordsFound,
    finalValidationErrors: errors,
    registerStatus: errors.length ? "등록 보류" : normalized.registerStatus || "등록 대기",
    errorMessage: errors.join(" ")
  };
};

commentAutomationRouter.get("/status", async (_req, res) => {
  res.json(await getBlogAutomationStatus());
});

commentAutomationRouter.get("/logs", async (_req, res) => {
  res.json(await getBlogAutomationLogs());
});

commentAutomationRouter.post("/scan", async (req, res) => {
  const { form = {} } = req.body ?? {};

  if (!hasRequiredUrlFields(form)) {
    return res.json({
      ok: false,
      comments: [],
      report: createReport([], { exitReason: "missing_required_fields" }),
      logs: ["블로그 포스팅 URL과 포스팅 제목이 필요합니다."],
      message: "form.blogUrl, form.postTitle are required."
    });
  }

  const result = await scanCommentsByUrl({
    form: {
      ...form,
      mainKeyword: form.mainKeyword || resolveMainKeyword(form)
    },
    blogUrl: form.blogUrl,
    postTitle: form.postTitle
  });

  const comments = (result.comments || []).map((comment, index) =>
    normalizeComment(
      {
        ...comment,
        source: comment.source || "url"
      },
      index
    )
  );

  res.json({
    ...result,
    comments,
    report: result.report || createReport(comments, { exitReason: result.ok ? "scan_completed" : "scan_failed" })
  });
});

commentAutomationRouter.post("/generate", (req, res) => {
  const { form = {}, comments = [], options = {} } = req.body ?? {};

  if (!hasRequiredUrlFields(form) && !form.postTitle) {
    return res.json({
      ok: false,
      comments: [],
      report: createReport([], { exitReason: "missing_required_fields" }),
      logs: ["포스팅 제목이 필요합니다."],
      message: "form.postTitle is required."
    });
  }

  if (!Array.isArray(comments)) {
    return res.json({
      ok: false,
      comments: [],
      report: createReport([], { exitReason: "invalid_comments" }),
      logs: ["comments는 배열이어야 합니다."],
      message: "comments[] are required."
    });
  }

  const formPayload = {
    ...form,
    mainKeyword: form.mainKeyword || resolveMainKeyword(form)
  };
  const generated = createCommentReplyBatch(formPayload, comments, options).map((comment) => ({
    ...comment,
    processStatus: comment.status === "스킵 권장" ? "스킵" : "생성 완료"
  }));

  res.json({
    ok: true,
    comments: generated,
    report: createReport(generated, { exitReason: "generate_completed" }),
    logs: [`${generated.filter((comment) => comment.reply).length}개 대댓글 초안을 생성했습니다.`],
    message: `${generated.length}개 댓글을 분석했습니다.`
  });
});

commentAutomationRouter.post("/register", async (req, res) => {
  const { form = {}, comments = [] } = req.body ?? {};

  if (!hasRequiredUrlFields(form)) {
    return res.json({
      ok: false,
      comments: [],
      report: createReport([], { exitReason: "missing_required_fields" }),
      logs: ["블로그 포스팅 URL과 포스팅 제목이 필요합니다."],
      message: "form.blogUrl, form.postTitle are required."
    });
  }

  const checkedComments = comments.map((comment, index) => validateReplyBeforeRegistration(form, normalizeComment(comment, index)));
  const blocked = checkedComments.filter((comment) => comment.finalValidationErrors?.length);

  if (blocked.length > 0) {
    return res.json({
      ok: false,
      comments: checkedComments,
      report: createReport(checkedComments, {
        failedCount: blocked.length,
        exitReason: "pre_register_validation_failed",
        failedComments: blocked.map((comment) => ({
          id: comment.id,
          author: comment.author,
          content: comment.content,
          reason: comment.errorMessage
        }))
      }),
      logs: blocked.map((comment) => `[등록 보류] ${comment.author}: ${comment.errorMessage}`),
      message: "등록 전 마지막 검증에서 보류된 댓글이 있습니다."
    });
  }

  const result = await registerRepliesByBridge({
    form: {
      ...form,
      mainKeyword: form.mainKeyword || resolveMainKeyword(form)
    },
    comments: checkedComments
  });

  res.json(result);
});

commentAutomationRouter.post("/run", async (req, res) => {
  const { form = {}, autoRegister = false, options = {} } = req.body ?? {};

  if (!hasRequiredUrlFields(form)) {
    return res.json({
      ok: false,
      comments: [],
      report: createReport([], { exitReason: "missing_required_fields" }),
      logs: ["블로그 포스팅 URL과 포스팅 제목이 필요합니다."],
      message: "form.blogUrl, form.postTitle are required."
    });
  }

  if (autoRegister) {
    return res.json(
      await runLegacyReplyAutomation({
        form,
        blogUrl: form.blogUrl,
        options
      })
    );
  }

  const scanned = await scanCommentsByUrl({
    form,
    blogUrl: form.blogUrl,
    postTitle: form.postTitle,
    options
  });
  const comments = (scanned.comments || []).map((comment, index) => normalizeComment(comment, index));

  if (!scanned.ok || comments.length === 0) {
    return res.json({
      ...scanned,
      comments,
      report: scanned.report || createReport(comments, { exitReason: "run_scan_failed" })
    });
  }

  const generated = createCommentReplyBatch(
    {
      ...form,
      mainKeyword: form.mainKeyword || resolveMainKeyword(form)
    },
    comments,
    options
  );

  res.json({
    ok: true,
    comments: generated,
    report: createReport(generated, { exitReason: "run_review_ready" }),
    logs: [...(scanned.logs || []), `${generated.filter((comment) => comment.reply).length}개 대댓글 초안을 생성했습니다.`],
    message: "댓글 수집과 대댓글 생성을 완료했습니다. 검토 후 선택 등록하세요."
  });
});

commentAutomationRouter.post("/stop", async (req, res) => {
  res.json(await stopBlogAutomation(req.body || {}));
});
