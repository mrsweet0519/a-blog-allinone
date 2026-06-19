import { createProductReviewDraft } from "../../shared/productReviewGenerator.js";
import { buildBlogWriterPromptPayload } from "../../shared/blogWriterPrompt.js";
import { evaluateBlogWriterQuality } from "../../shared/blogWriterQuality.js";
import { createHumanQualityFactMap, evaluateHumanQuality } from "../../shared/blogWriterHumanQuality.js";

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

const shouldUseLlmJudge = (env = {}) =>
  shouldUseLlm(env) &&
  LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_LLM_JUDGE_ENABLED || "").trim());

const shouldUseLlmRevision = (env = {}) =>
  shouldUseLlmJudge(env) &&
  LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_LLM_REVISION_ENABLED || "").trim());

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

const getDraftFaqItems = (draft = {}) => draft.faqItems || draft.contentPackage?.faqItems || [];

const buildHumanJudgeMessages = ({ form = {}, draft = {} } = {}) => [
  {
    role: "system",
    content:
      "당신은 한국 네이버 블로그 편집자이자 냉정한 콘텐츠 품질 심사자입니다. 키워드 개수나 형식 충족이 아니라 실제 사람이 읽었을 때의 자연스러움, 구체성, 사실성, 문단 가치, 발행 가능성을 평가하세요. 작성 과정은 출력하지 말고 JSON만 반환하세요."
  },
  {
    role: "user",
    content: JSON.stringify({
      outputSchema: {
        score: "number 0-100",
        publishReady: "boolean",
        scores: {
          titleQuality: "0-10",
          openingQuality: "0-10",
          factualGrounding: "0-15",
          specificity: "0-15",
          humanNaturalness: "0-15",
          narrativeCoherence: "0-10",
          paragraphValue: "0-10",
          keywordNaturalness: "0-5",
          imageGrounding: "0-5",
          readerUtility: "0-5"
        },
        issues: [{ code: "string", severity: "low|medium|high|critical", evidence: "string", message: "string", revisionInstruction: "string" }],
        revisionInstructions: ["string"]
      },
      form: {
        productName: form.productName || form.topic || "",
        mainKeyword: form.mainKeyword || form.keyword || "",
        memo: form.experienceMemo || form.memory || form.memo || "",
        imageCount: form.imageCount || form.images?.length || form.photos?.length || 0
      },
      draft: {
        title: draft.finalTitle || draft.selectedTitle || "",
        titleCandidates: draft.titleCandidates || draft.titles || [],
        body: draft.body || "",
        faq: getDraftFaqItems(draft)
      }
    })
  }
];

const requestLlmHumanJudge = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {} } = {}) => {
  if (!shouldUseLlmJudge(env)) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: buildHumanJudgeMessages({ form, draft }),
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`LLM judge request failed with ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "";
  return parseLlmJson(content);
};

const buildRevisionMessages = ({ form = {}, draft = {}, humanQuality = {} } = {}) => [
  {
    role: "system",
    content:
      "당신은 네이버 블로그 원고를 개선하는 한국어 편집자입니다. 새 경험을 만들지 말고 Fact Map, 이미지 분석, 현재 원고, qualityIssues, revisionInstructions만 근거로 재작성하세요. 글자수 늘리기, 키워드 횟수 맞추기, 같은 문단 반복은 금지입니다. JSON만 반환하세요."
  },
  {
    role: "user",
    content: JSON.stringify({
      factMap: createHumanQualityFactMap(form, form.imageAnalysis || form.imageContext || form.images || form.photoMetadata),
      imageAnalysis: form.imageAnalysis || form.imageContext || form.images || form.photoMetadata || null,
      currentDraft: {
        finalTitle: draft.finalTitle || draft.selectedTitle || "",
        titleCandidates: draft.titleCandidates || draft.titles || [],
        body: draft.body || "",
        faqItems: getDraftFaqItems(draft),
        hashtags: draft.hashtags || draft.contentPackage?.hashtags || []
      },
      qualityIssues: humanQuality.issues || [],
      revisionInstructions: humanQuality.revisionInstructions || [],
      outputSchema: {
        finalTitle: "string",
        titleCandidates: ["string"],
        body: "string",
        faqItems: [{ question: "string", answer: "string" }],
        hashtags: ["string"]
      }
    })
  }
];

const requestLlmRevision = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {}, humanQuality = {} } = {}) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: buildRevisionMessages({ form, draft, humanQuality }),
      temperature: 0.35,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`LLM revision request failed with ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "";
  return parseLlmJson(content);
};

const evaluateDraftHumanQuality = ({ form = {}, draft = {}, engine = "fallback", llmJudge = null } = {}) => {
  const packageData = draft.contentPackage || {};
  return evaluateHumanQuality({
    title: draft.finalTitle || draft.selectedTitle || packageData.finalRecommendedTitle || "",
    titleCandidates: draft.titleCandidates || draft.titles || packageData.titleCandidates || [],
    body: draft.body || packageData.blogBody || "",
    faq: getDraftFaqItems(draft),
    hashtags: draft.hashtags || packageData.hashtags || [],
    factMap: createHumanQualityFactMap(form, form.imageAnalysis || form.imageContext || form.images || form.photoMetadata),
    imageAnalysis: form.imageAnalysis || form.imageContext || form.images || form.photoMetadata || null,
    category: draft.category || packageData.blogWriterAnalysis?.category || "",
    visitStatus: packageData.blogWriterAnalysis?.visitStatus || "",
    mainKeyword: draft.mainKeyword || packageData.mainKeyword || "",
    subKeywords: packageData.subKeywords || [],
    requestedTargetCharCount: packageData.requestedTargetCharCount || form.targetCharCount || form.targetLength || 2500,
    effectiveTargetCharCount: packageData.targetLengthRange?.target || packageData.targetCharCount || form.targetCharCount || 2500,
    engine,
    llmJudge
  });
};

const attachHumanQuality = (draft = {}, humanQuality = null, qualityAttempts = 1) => {
  if (!humanQuality) return draft;
  const nextPackage = draft.contentPackage
    ? {
        ...draft.contentPackage,
        humanQuality,
        publishReady: humanQuality.publishReady,
        judgeEngine: humanQuality.judgeEngine,
        qualityAttempts,
        qualityScore: humanQuality.score,
        qualityIssues: humanQuality.issues?.map((issue) => `${issue.code}: ${issue.message}`) || []
      }
    : draft.contentPackage;
  return {
    ...draft,
    contentPackage: nextPackage,
    humanQuality,
    publishReady: humanQuality.publishReady,
    judgeEngine: humanQuality.judgeEngine,
    qualityAttempts,
    qualityScore: humanQuality.score,
    qualityIssues: humanQuality.issues?.map((issue) => `${issue.code}: ${issue.message}`) || []
  };
};

const judgeDraft = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {}, engine = "llm" } = {}) => {
  const llmJudge = await requestLlmHumanJudge({
    env,
    model,
    form,
    draft
  });
  return evaluateDraftHumanQuality({
    form,
    draft,
    engine,
    llmJudge
  });
};

const improveDraftWithQualityAttempts = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, fallbackDraft = {}, initialDraft = {} } = {}) => {
  let attempts = 1;
  let currentDraft = initialDraft;
  let currentQuality = await judgeDraft({ env, model, form, draft: currentDraft, engine: "llm" });
  let bestDraft = attachHumanQuality(currentDraft, currentQuality, attempts);
  let bestQuality = currentQuality;

  while (shouldUseLlmRevision(env) && attempts < 2 && currentQuality.score < 95) {
    const revisionDraft = await requestLlmRevision({
      env,
      model,
      form,
      draft: currentDraft,
      humanQuality: currentQuality
    });
    if (!hasUsableLlmDraft(revisionDraft)) break;
    attempts += 1;
    currentDraft = mergeAcceptedLlmDraft({
      form,
      fallbackDraft,
      llmDraft: revisionDraft
    });
    currentQuality = await judgeDraft({ env, model, form, draft: currentDraft, engine: "llm" });
    if (currentQuality.score > bestQuality.score) {
      bestQuality = currentQuality;
      bestDraft = attachHumanQuality(currentDraft, currentQuality, attempts);
    }
  }

  return attachHumanQuality(bestDraft, bestQuality, attempts);
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
    form: { ...form, engine: "llm" },
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
  const deterministicHumanQuality = evaluateHumanQuality({
    title: finalTitle,
    titleCandidates,
    body,
    faq: faqItems,
    hashtags,
    factMap: createHumanQualityFactMap(form, form.imageAnalysis || form.imageContext || form.images || form.photoMetadata),
    imageAnalysis: form.imageAnalysis || form.imageContext || form.images || form.photoMetadata || null,
    category: fallbackDraft.category,
    mainKeyword,
    subKeywords,
    requestedTargetCharCount: fallbackPackage.requestedTargetCharCount || form.targetCharCount || targetCharCount,
    effectiveTargetCharCount: targetCharCount,
    engine: "llm"
  });

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
    blogWriterQuality,
    humanQuality: deterministicHumanQuality,
    publishReady: deterministicHumanQuality.publishReady,
    judgeEngine: deterministicHumanQuality.judgeEngine,
    qualityAttempts: 1
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
    blogWriterQuality,
    humanQuality: deterministicHumanQuality,
    publishReady: deterministicHumanQuality.publishReady,
    judgeEngine: deterministicHumanQuality.judgeEngine,
    qualityAttempts: 1
  };
};

const withFallbackRoute = (fallbackDraft = {}, llm = {}, form = {}) => {
  const humanQuality = evaluateDraftHumanQuality({ form, draft: fallbackDraft, engine: "fallback" });
  const decorated = attachHumanQuality(fallbackDraft, humanQuality, 1);
  return {
    ...decorated,
    generationRoute: "static-fallback",
    engine: "fallback",
    summary: {
      ...(decorated.summary || {}),
      engine: "fallback",
      bodyLength: decorated.bodyLength || String(decorated.body || "").replace(/\s+/g, "").length,
      targetCharCount: decorated.contentPackage?.targetLengthRange?.target || decorated.contentPackage?.targetCharCount || null,
      judgeEngine: humanQuality.judgeEngine,
      publishReady: humanQuality.publishReady
    },
    contentPackage: decorated.contentPackage
      ? {
          ...decorated.contentPackage,
          engine: "fallback",
          actualBodyLength: decorated.bodyLength || String(decorated.body || "").replace(/\s+/g, "").length,
          summary: {
            ...(decorated.contentPackage.summary || {}),
            engine: "fallback",
            bodyLength: decorated.bodyLength || String(decorated.body || "").replace(/\s+/g, "").length,
            targetCharCount: decorated.contentPackage.targetLengthRange?.target || decorated.contentPackage.targetCharCount || null,
            judgeEngine: humanQuality.judgeEngine,
            publishReady: humanQuality.publishReady
          }
        }
      : decorated.contentPackage,
    llm: {
      used: false,
      ...llm
    }
  };
};

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
    }, form));
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
      }, form));
    }

    let acceptedDraft = mergeAcceptedLlmDraft({
      form,
      fallbackDraft,
      llmDraft
    });
    try {
      if (shouldUseLlmJudge(context.env)) {
        acceptedDraft = await improveDraftWithQualityAttempts({
          env: context.env,
          model,
          form,
          fallbackDraft,
          initialDraft: acceptedDraft
        });
      }
    } catch {
      const humanQuality = evaluateDraftHumanQuality({
        form,
        draft: acceptedDraft,
        engine: "llm"
      });
      acceptedDraft = attachHumanQuality(acceptedDraft, humanQuality, 1);
    }

    return jsonResponse({
      ...acceptedDraft,
      generationRoute: "llm",
      engine: "llm",
      llm: {
        used: true,
        accepted: true,
        model,
        judgeUsed: acceptedDraft.judgeEngine === "llm"
      }
    });
  } catch {
    return jsonResponse(withFallbackRoute(fallbackDraft, {
      attempted: true,
      reason: "llm-failed"
    }, form));
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
