import { createProductReviewDraft } from "../../shared/productReviewGenerator.js";
import { buildBlogWriterPromptPayload } from "../../shared/blogWriterPrompt.js";
import { evaluateBlogWriterQuality } from "../../shared/blogWriterQuality.js";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const LLM_ENABLED_PATTERN = /^(1|true|yes|on)$/iu;

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });

const parseJsonRequest = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

const parseLlmJson = (value = "") => {
  const cleaned = String(value || "")
    .replace(/^```(?:json)?/iu, "")
    .replace(/```$/u, "")
    .trim();
  return JSON.parse(cleaned);
};

const isLlmEnabled = (env = {}) => LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_LLM_ENABLED || "").trim());

const getOpenAiModel = (env = {}) => env.OPENAI_MODEL || env.BLOG_WRITER_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;

const shouldUseLlm = (env = {}) =>
  isLlmEnabled(env) &&
  Boolean(env.OPENAI_API_KEY);

const compact = (value = "") =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const detectPrimaryMenu = (form = {}, subKeywords = []) => {
  const source = `${form.productName || form.topic || ""} ${form.experienceMemo || form.memory || form.memo || ""} ${subKeywords.join(" ")}`;
  return source.match(/갈낙짬뽕|짬뽕|탕수육|파스타|스테이크|커피|브런치|디저트/u)?.[0] || "";
};

const normalizeList = (value, fallback = []) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]+/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return fallback;
};

const normalizeFaqItems = (value, fallback = []) => {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => ({
      question: String(item?.question || "").trim(),
      answer: String(item?.answer || "").trim()
    }))
    .filter((item) => item.question && item.answer);
};

const mergeAcceptedLlmDraft = ({ form = {}, fallbackDraft = {}, llmDraft = {} } = {}) => {
  const fallbackPackage = fallbackDraft.contentPackage || {};
  const titleCandidates = normalizeList(llmDraft.titleCandidates || llmDraft.titles, fallbackDraft.titleCandidates || fallbackPackage.titleCandidates || []);
  const finalTitle = String(llmDraft.finalTitle || llmDraft.selectedTitle || titleCandidates[0] || fallbackDraft.finalTitle || "").trim();
  const body = String(llmDraft.body || llmDraft.blogBody || fallbackDraft.body || "").trim();
  const hashtags = normalizeList(llmDraft.hashtags, fallbackDraft.hashtags || fallbackPackage.hashtags || []);
  const faqItems = normalizeFaqItems(llmDraft.faqItems || llmDraft.faq, fallbackPackage.faqItems || []);
  const fallbackMainKeyword = String(fallbackDraft.mainKeyword || fallbackPackage.mainKeyword || "").trim();
  const llmMainKeyword = String(llmDraft.mainKeyword || "").trim();
  const mainKeyword = compact(llmMainKeyword) === compact(fallbackMainKeyword) ? llmMainKeyword : fallbackMainKeyword;
  const subKeywords = normalizeList(
    [...normalizeList(llmDraft.subKeywords), ...(fallbackPackage.subKeywords || [])],
    fallbackPackage.subKeywords || []
  );
  const targetCharCount = fallbackPackage.informationLimited
    ? fallbackPackage.targetLengthRange?.target || fallbackPackage.targetCharCount || 1700
    : form.targetCharCount || form.targetLength || fallbackPackage.targetLengthRange?.target || 2500;
  const bodyLength = body.replace(/\s+/g, "").length;
  const blogWriterQuality = evaluateBlogWriterQuality({
    form,
    category: fallbackDraft.category,
    selectedTitle: finalTitle,
    titleCandidates,
    body,
    mainKeyword,
    subKeywords,
    hashtags,
    faqItems,
    imageCount: form.imageCount || form.images?.length || form.photos?.length || 0,
    photoGuide: fallbackPackage.photoGuide || [],
    targetCharCount,
    primaryMenu: detectPrimaryMenu(form, subKeywords)
  });

  const qualityScore = blogWriterQuality.score;
  const qualityIssues = blogWriterQuality.issues;
  const qualityChecks = blogWriterQuality.checks;
  const contentPackage = {
    ...fallbackPackage,
    finalRecommendedTitle: finalTitle,
    titleCandidates,
    mainKeyword,
    subKeywords,
    blogBody: body,
    engine: "llm",
    actualBodyLength: bodyLength,
    summary: {
      engine: "llm",
      bodyLength,
      targetCharCount
    },
    faqItems,
    hashtags,
    qualityScore,
    qualityIssues,
    qualityChecks,
    blogWriterQuality
  };

  return {
    ...fallbackDraft,
    ...llmDraft,
    finalTitle,
    selectedTitle: finalTitle,
    titleCandidates,
    titles: titleCandidates,
    body,
    bodyLength,
    mainKeyword,
    hashtags,
    engine: "llm",
    summary: {
      engine: "llm",
      bodyLength,
      targetCharCount
    },
    contentPackage,
    qualityScore,
    qualityIssues,
    qualityChecks,
    blogWriterQuality
  };
};

const withFallbackRoute = (fallbackDraft = {}, llm = {}) => ({
  ...fallbackDraft,
  generationRoute: "static-fallback",
  engine: "fallback",
  summary: {
    ...(fallbackDraft.summary || {}),
    engine: "fallback",
    bodyLength: fallbackDraft.bodyLength || String(fallbackDraft.body || "").replace(/\s+/g, "").length,
    targetCharCount: fallbackDraft.contentPackage?.targetLengthRange?.target || fallbackDraft.contentPackage?.targetCharCount || null
  },
  contentPackage: fallbackDraft.contentPackage
    ? {
        ...fallbackDraft.contentPackage,
        engine: "fallback",
        actualBodyLength: fallbackDraft.bodyLength || String(fallbackDraft.body || "").replace(/\s+/g, "").length,
        summary: {
          ...(fallbackDraft.contentPackage.summary || {}),
          engine: "fallback",
          bodyLength: fallbackDraft.bodyLength || String(fallbackDraft.body || "").replace(/\s+/g, "").length,
          targetCharCount: fallbackDraft.contentPackage.targetLengthRange?.target || fallbackDraft.contentPackage.targetCharCount || null
        }
      }
    : fallbackDraft.contentPackage,
  llm: {
    used: false,
    ...llm
  }
});

const hasUsableLlmDraft = (draft = {}) =>
  Boolean(String(draft.body || draft.blogBody || "").trim()) &&
  Boolean(String(draft.finalTitle || draft.selectedTitle || "").trim() || normalizeList(draft.titleCandidates || draft.titles).length > 0);

export async function onRequestPost(context) {
  const form = await parseJsonRequest(context.request);
  const fallbackDraft = createProductReviewDraft(form);
  const promptPayload = buildBlogWriterPromptPayload({
    form,
    fallbackDraft
  });

  if (!shouldUseLlm(context.env)) {
    return jsonResponse(withFallbackRoute(fallbackDraft, {
      reason: isLlmEnabled(context.env) ? "server-key-missing" : "llm-disabled"
    }));
  }

  try {
    const model = getOpenAiModel(context.env);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: promptPayload.messages,
        temperature: 0.45,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with ${response.status}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    const llmDraft = parseLlmJson(content);
    if (!hasUsableLlmDraft(llmDraft)) {
      return jsonResponse(withFallbackRoute(fallbackDraft, {
        attempted: true,
        reason: "llm-schema-unusable"
      }));
    }

    const acceptedDraft = mergeAcceptedLlmDraft({
      form,
      fallbackDraft,
      llmDraft
    });

    return jsonResponse({
      ...acceptedDraft,
      generationRoute: "llm",
      engine: "llm",
      llm: {
        used: true,
        accepted: true,
        model
      }
    });
  } catch {
    return jsonResponse(withFallbackRoute(fallbackDraft, {
      attempted: true,
      reason: "llm-failed"
    }));
  }
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        allow: "POST, OPTIONS"
      }
    });
  }

  if (context.request.method !== "POST") {
    return jsonResponse({ message: "Use POST with blog writing form data." }, { status: 405 });
  }

  return onRequestPost(context);
}
