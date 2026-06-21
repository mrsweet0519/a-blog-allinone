import { createProductReviewDraft } from "../../shared/productReviewGenerator.js";
import { buildBlogWriterPromptPayload } from "../../shared/blogWriterPrompt.js";
import { evaluateBlogWriterQuality } from "../../shared/blogWriterQuality.js";
import { createHumanQualityFactMap, evaluateHumanQuality } from "../../shared/blogWriterHumanQuality.js";
import {
  buildBlogWriterPipelineContext,
  createClaimLedger,
  normalizeBlogWriterInput,
  summarizeClaimLedger
} from "../../shared/blogWriterPipeline.js";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_VISION_MODEL = "gpt-4o-mini";
const LLM_ENABLED_PATTERN = /^(1|true|yes|on)$/iu;
const VISION_SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_VISION_IMAGES = 3;
const MAX_VISION_DATA_URL_LENGTH = 2_500_000;

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
const isMockEnvironment = (env = {}) =>
  /^(unit-test-key|mock-key|test-key)$/u.test(String(env.OPENAI_API_KEY || "")) ||
  /^(unit-model|mock-model)$/u.test(String(getOpenAiModel(env) || ""));

const shouldUseLlm = (env = {}) =>
  isLlmEnabled(env) &&
  Boolean(env.OPENAI_API_KEY);

const shouldUseLlmJudge = (env = {}) =>
  shouldUseLlm(env) &&
  LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_LLM_JUDGE_ENABLED || "").trim());

const shouldUseLlmRevision = (env = {}) =>
  shouldUseLlmJudge(env) &&
  LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_LLM_REVISION_ENABLED || "").trim());

const shouldUseVision = (env = {}) =>
  Boolean(env.OPENAI_API_KEY) &&
  LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_VISION_ENABLED || "").trim());

const getVisionModel = (env = {}) =>
  env.OPENAI_VISION_MODEL || env.BLOG_WRITER_OPENAI_VISION_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_VISION_MODEL;

const compact = (value = "") =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const detectPrimaryMenu = (form = {}, subKeywords = []) => {
  const source = `${form.productName || form.topic || ""} ${form.experienceMemo || form.memory || form.memo || ""} ${subKeywords.join(" ")}`;
  return source.match(/[가-힣A-Za-z0-9]+(?:짬뽕|탕|국밥|파스타|스테이크|커피|브런치|디저트|냉면|칼국수|라멘|초밥|피자|버거)/u)?.[0] || "";
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

const getVisionImageItems = (form = {}) => {
  const source = Array.isArray(form.imageContext)
    ? form.imageContext
    : Array.isArray(form.images)
      ? form.images
      : Array.isArray(form.photos)
        ? form.photos
        : Array.isArray(form.photoMetadata)
          ? form.photoMetadata
          : [];

  return source
    .map((item, index) => {
      const mediaType = String(item?.mediaType || item?.type || "").trim().toLowerCase();
      const dataUrl = String(item?.dataUrl || item?.previewDataUrl || "").trim();
      const base64Data = String(item?.base64Data || item?.base64 || "").trim();
      const resolvedDataUrl = dataUrl || (mediaType && base64Data ? `data:${mediaType};base64,${base64Data}` : "");
      return {
        photoIndex: Number(item?.index || item?.photoIndex) || index + 1,
        mediaType,
        dataUrl: resolvedDataUrl,
        note: String(item?.note || item?.description || "").trim(),
        ocrText: String(item?.ocrText || "").trim()
      };
    })
    .filter((item) =>
      item.dataUrl &&
      VISION_SUPPORTED_MEDIA_TYPES.has(item.mediaType) &&
      item.dataUrl.length <= MAX_VISION_DATA_URL_LENGTH
    )
    .slice(0, MAX_VISION_IMAGES);
};

const normalizeVisionAnalysis = (value = {}, imageItems = []) => {
  const rawItems = Array.isArray(value.items) ? value.items : Array.isArray(value.photos) ? value.photos : [];
  const items = rawItems.map((item, index) => ({
    photoIndex: Number(item.photoIndex || item.index) || imageItems[index]?.photoIndex || index + 1,
    analysisMode: "vision",
    category: String(item.category || "unknown").trim() || "unknown",
    visibleElements: normalizeList(item.visibleElements || item.facts || []),
    safeDescription: String(item.safeDescription || item.description || "").trim(),
    unsafeClaims: normalizeList(item.unsafeClaims || []),
    confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0))
  }));
  const visuallySupported = normalizeList(value.visuallySupported || items.flatMap((item) => item.visibleElements));

  return {
    mode: "vision",
    analysisMode: "vision",
    items,
    visuallySupported,
    unsupportedVisualFields: normalizeList(value.unsupportedVisualFields || ["taste", "price", "quantity", "service", "staff", "businessHours"]),
    canAssertVisualFacts: items.length > 0,
    source: "openai-vision"
  };
};

const requestVisionAnalysis = async ({ env = {}, form = {} } = {}) => {
  if (!shouldUseVision(env) || form.imageAnalysis) return null;
  const imageItems = getVisionImageItems(form);
  if (imageItems.length === 0) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: getVisionModel(env),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "사진에서 시각적으로 보이는 사실만 한국어 JSON으로 요약하세요. 맛, 가격, 양, 직원 응대, 영업시간, 효과처럼 사진만으로 알 수 없는 내용은 unsafeClaims에 넣으세요."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                outputSchema: {
                  items: [
                    {
                      photoIndex: 1,
                      analysisMode: "vision",
                      category: "string",
                      visibleElements: ["string"],
                      safeDescription: "string",
                      unsafeClaims: ["string"],
                      confidence: 0.9
                    }
                  ],
                  visuallySupported: ["string"],
                  unsupportedVisualFields: ["taste", "price", "quantity", "service", "staff", "businessHours"]
                },
                imageNotes: imageItems.map(({ photoIndex, note, ocrText }) => ({ photoIndex, note, ocrText }))
              })
            },
            ...imageItems.map((item) => ({
              type: "image_url",
              image_url: {
                url: item.dataUrl,
                detail: "low"
              }
            }))
          ]
        }
      ]
    })
  });

  if (!response.ok) throw new Error(`Vision request failed with ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "";
  return normalizeVisionAnalysis(parseLlmJson(content), imageItems);
};

const enrichFormWithVision = async (form = {}, env = {}) => {
  try {
    const imageAnalysis = await requestVisionAnalysis({ env, form });
    return imageAnalysis ? { ...form, imageAnalysis } : form;
  } catch {
    return form;
  }
};

const getDraftFaqItems = (draft = {}) => draft.faqItems || draft.contentPackage?.faqItems || [];

const resolveResultMode = (draft = {}, humanQuality = null) => {
  const engine = draft.engine || draft.contentPackage?.engine || "fallback";
  if (engine !== "llm") return "fallback_draft";
  if (humanQuality?.publishReady) return "publish_ready";
  return "honest_draft";
};

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
        subKeywords: form.subKeywords || draft.contentPackage?.subKeywords || [],
        memo: form.experienceMemo || form.memory || form.memo || "",
        imageCount: form.imageCount || form.images?.length || form.photos?.length || 0,
        experienceStatus: draft.contentPackage?.experienceStatus || form.experienceStatus || "",
        contextFacts: draft.contentPackage?.contextFacts || draft.contextFacts || null,
        informationSufficiency: draft.contentPackage?.informationSufficiency || form.informationSufficiency || null,
        factMap: draft.contentPackage?.factMap || null,
        imageAnalysis: draft.contentPackage?.imageAnalysis || form.imageAnalysis || null,
        claimLedger: draft.contentPackage?.claimLedger || draft.claimLedger || []
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
      factMap: draft.contentPackage?.factMap || createHumanQualityFactMap(form, form.imageAnalysis || form.imageContext || form.images || form.photoMetadata),
      contextFacts: draft.contentPackage?.contextFacts || draft.contextFacts || null,
      imageAnalysis: draft.contentPackage?.imageAnalysis || form.imageAnalysis || form.imageContext || form.images || form.photoMetadata || null,
      writerPlan: draft.contentPackage?.writerPlan || null,
      claimLedger: draft.contentPackage?.claimLedger || draft.claimLedger || [],
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
  const factMap = packageData.factMap || createHumanQualityFactMap(form, packageData.imageAnalysis || form.imageAnalysis || form.imageContext || form.images || form.photoMetadata);
  const imageAnalysis = packageData.imageAnalysis || form.imageAnalysis || form.imageContext || form.images || form.photoMetadata || null;
  return evaluateHumanQuality({
    title: draft.finalTitle || draft.selectedTitle || packageData.finalRecommendedTitle || "",
    titleCandidates: draft.titleCandidates || draft.titles || packageData.titleCandidates || [],
    body: draft.body || packageData.blogBody || "",
    faq: getDraftFaqItems(draft),
    hashtags: draft.hashtags || packageData.hashtags || [],
    factMap,
    imageAnalysis,
    category: draft.category || packageData.blogWriterAnalysis?.category || "",
    visitStatus: packageData.experienceStatus || packageData.blogWriterAnalysis?.visitStatus || "",
    mainKeyword: draft.mainKeyword || packageData.mainKeyword || "",
    primaryEntity: draft.primaryEntity || packageData.primaryEntity || packageData.blogWriterAnalysis?.primaryEntity || draft.mainKeyword || packageData.mainKeyword || "",
    subKeywords: packageData.subKeywords || [],
    requestedTargetCharCount: packageData.requestedTargetCharCount || form.targetCharCount || form.targetLength || 2500,
    effectiveTargetCharCount: packageData.targetLengthRange?.target || packageData.targetCharCount || form.targetCharCount || 2500,
    engine,
    llmJudge
  });
};

const attachHumanQuality = (draft = {}, humanQuality = null, qualityAttempts = 1) => {
  if (!humanQuality) return draft;
  const resultMode = resolveResultMode(draft, humanQuality);
  const claimLedgerSummary = draft.contentPackage?.claimLedgerSummary || draft.claimLedgerSummary || {};
  const claimCap = claimLedgerSummary.hardFail ? 55 : 100;
  const attachedScore = Math.min(
    humanQuality.score,
    draft.contentPackage?.qualityScore ?? draft.qualityScore ?? humanQuality.score,
    claimCap
  );
  const publishReady = Boolean(humanQuality.publishReady && !claimLedgerSummary.hardFail);
  const attachedIssues = [
    ...(draft.contentPackage?.qualityIssues || draft.qualityIssues || []),
    ...(humanQuality.issues?.map((issue) => `${issue.code}: ${issue.message}`) || [])
  ].filter(Boolean);
  const nextPackage = draft.contentPackage
    ? {
        ...draft.contentPackage,
        resultMode,
        humanQuality,
        publishReady,
        judgeEngine: humanQuality.judgeEngine,
        isMock: humanQuality.isMock,
        qualityAttempts,
        rawQualityScore: humanQuality.rawQualityScore ?? draft.contentPackage?.rawQualityScore ?? draft.rawQualityScore,
        cappedScore: attachedScore,
        qualityScore: attachedScore,
        summary: {
          ...(draft.contentPackage.summary || {}),
          resultMode,
          judgeEngine: humanQuality.judgeEngine,
          isMock: humanQuality.isMock,
          rawQualityScore: humanQuality.rawQualityScore ?? draft.contentPackage?.rawQualityScore ?? draft.rawQualityScore,
          cappedScore: attachedScore,
          publishReady
        },
        qualityIssues: Array.from(new Set(attachedIssues))
      }
    : draft.contentPackage;
  return {
    ...draft,
    resultMode,
    contentPackage: nextPackage,
    humanQuality,
    publishReady,
    judgeEngine: humanQuality.judgeEngine,
    isMock: humanQuality.isMock,
    qualityAttempts,
    rawQualityScore: humanQuality.rawQualityScore ?? draft.rawQualityScore ?? draft.contentPackage?.rawQualityScore,
    cappedScore: attachedScore,
    qualityScore: attachedScore,
    summary: {
      ...(draft.summary || {}),
      resultMode,
      judgeEngine: humanQuality.judgeEngine,
      isMock: humanQuality.isMock,
      rawQualityScore: humanQuality.rawQualityScore ?? draft.rawQualityScore ?? draft.contentPackage?.rawQualityScore,
      cappedScore: attachedScore,
      publishReady
    },
    qualityIssues: Array.from(new Set(attachedIssues))
  };
};

const judgeDraft = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {}, engine = "llm" } = {}) => {
  const llmJudge = await requestLlmHumanJudge({
    env,
    model,
    form,
    draft
  });
  if (llmJudge) {
    llmJudge.isMock = isMockEnvironment(env);
    llmJudge.model = model;
  }
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

  while (shouldUseLlmRevision(env) && attempts < 3 && currentQuality.score < 95) {
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

  const rawQualityScore = blogWriterQuality.score;
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
    primaryEntity: fallbackPackage.primaryEntity || fallbackPackage.blogWriterAnalysis?.primaryEntity || fallbackDraft.primaryEntity || mainKeyword,
    subKeywords,
    requestedTargetCharCount: fallbackPackage.requestedTargetCharCount || form.targetCharCount || targetCharCount,
    effectiveTargetCharCount: targetCharCount,
    engine: "llm"
  });
  const pipelineContext = buildBlogWriterPipelineContext(form, {
    category: fallbackDraft.category,
    analysis: {
      ...(fallbackPackage.blogWriterAnalysis || {}),
      mainKeyword,
      subKeywords
    },
    factMap: fallbackPackage.factMap,
    contextFacts: fallbackPackage.contextFacts,
    imageAnalysis: fallbackPackage.imageAnalysis,
    experienceStatus: fallbackPackage.experienceStatus,
    informationSufficiency: fallbackPackage.informationSufficiency,
    searchIntent: fallbackPackage.searchIntent,
    writerPlan: fallbackPackage.writerPlan
  });
  const claimLedger = createClaimLedger({
    title: finalTitle,
    body,
    faq: faqItems,
    hashtags,
    factMap: pipelineContext.factMap,
    contextFacts: pipelineContext.contextFacts,
    imageAnalysis: pipelineContext.imageAnalysis,
    experienceStatus: pipelineContext.experienceStatus
  });
  const claimLedgerSummary = summarizeClaimLedger(claimLedger);
  const claimLedgerIssues = claimLedgerSummary.hardFailures.map(
    (item) => `claimLedger.${item.claimType}: ${item.text}`
  );
  const cappedHumanScore = Math.min(deterministicHumanQuality.score, claimLedgerSummary.hardFail ? 55 : 100);
  const mergedQualityIssues = [...qualityIssues, ...claimLedgerIssues];

  const contentPackage = {
    ...fallbackPackage,
    resultMode: "honest_draft",
    standardInputSchema: pipelineContext.standardInputSchema,
    standardInput: pipelineContext.standardInput,
    primaryEntity: pipelineContext.primaryEntity,
    finalRecommendedTitle: finalTitle,
    titleCandidates,
    mainKeyword,
    subKeywords,
    category: fallbackDraft.category,
    searchIntent: pipelineContext.searchIntent,
    experienceStatus: pipelineContext.experienceStatus,
    contextFacts: pipelineContext.contextFacts,
    informationSufficiency: pipelineContext.informationSufficiency,
    factMap: pipelineContext.factMap,
    imageAnalysis: pipelineContext.imageAnalysis,
    writerPlan: pipelineContext.writerPlan,
    blogBody: body,
    claimLedger,
    claimLedgerSummary,
    engine: "llm",
    actualBodyLength: bodyLength,
    actualBodyCharCount: Array.from(String(body || "")).length,
    summary: {
      engine: "llm",
      bodyLength,
      actualBodyCharCount: Array.from(String(body || "")).length,
      targetCharCount,
      informationSufficiency: pipelineContext.informationSufficiency?.level || null,
      rawQualityScore,
      cappedScore: cappedHumanScore,
      judgeEngine: deterministicHumanQuality.judgeEngine,
      isMock: deterministicHumanQuality.isMock,
      publishReady: deterministicHumanQuality.publishReady && !claimLedgerSummary.hardFail
    },
    faqItems,
    hashtags,
    rawQualityScore,
    legacyQualityScore: rawQualityScore,
    cappedScore: cappedHumanScore,
    qualityScore: cappedHumanScore,
    qualityIssues: mergedQualityIssues,
    qualityChecks,
    blogWriterQuality,
    humanQuality: deterministicHumanQuality,
    publishReady: deterministicHumanQuality.publishReady && !claimLedgerSummary.hardFail,
    judgeEngine: deterministicHumanQuality.judgeEngine,
    isMock: deterministicHumanQuality.isMock,
    qualityAttempts: 1
  };

  return {
    ...fallbackDraft,
    ...llmDraft,
    resultMode: "honest_draft",
    finalTitle,
    selectedTitle: finalTitle,
    titleCandidates,
    titles: titleCandidates,
    body,
    bodyLength,
    actualBodyCharCount: Array.from(String(body || "")).length,
    primaryEntity: contentPackage.primaryEntity,
    mainKeyword,
    subKeywords,
    category: fallbackDraft.category,
    searchIntent: contentPackage.searchIntent,
    experienceStatus: contentPackage.experienceStatus,
    contextFacts: contentPackage.contextFacts,
    informationSufficiency: contentPackage.informationSufficiency,
    factMap: contentPackage.factMap,
    imageAnalysis: contentPackage.imageAnalysis,
    writerPlan: contentPackage.writerPlan,
    faq: faqItems,
    hashtags,
    claimLedger,
    claimLedgerSummary,
    engine: "llm",
    summary: {
      resultMode: "honest_draft",
      engine: "llm",
      bodyLength,
      actualBodyCharCount: Array.from(String(body || "")).length,
      targetCharCount,
      informationSufficiency: pipelineContext.informationSufficiency?.level || null,
      rawQualityScore,
      cappedScore: cappedHumanScore,
      judgeEngine: deterministicHumanQuality.judgeEngine,
      isMock: deterministicHumanQuality.isMock,
      publishReady: deterministicHumanQuality.publishReady && !claimLedgerSummary.hardFail
    },
    contentPackage,
    rawQualityScore,
    legacyQualityScore: rawQualityScore,
    cappedScore: cappedHumanScore,
    qualityScore: cappedHumanScore,
    qualityIssues: mergedQualityIssues,
    qualityChecks,
    blogWriterQuality,
    humanQuality: deterministicHumanQuality,
    publishReady: deterministicHumanQuality.publishReady && !claimLedgerSummary.hardFail,
    judgeEngine: deterministicHumanQuality.judgeEngine,
    isMock: deterministicHumanQuality.isMock,
    qualityAttempts: 1
  };
};

const withFallbackRoute = (fallbackDraft = {}, llm = {}, form = {}) => {
  const humanQuality = evaluateDraftHumanQuality({ form, draft: fallbackDraft, engine: "fallback" });
  const decorated = attachHumanQuality(fallbackDraft, humanQuality, 1);
  return {
    ...decorated,
    resultMode: "fallback_draft",
    generationRoute: "static-fallback",
    engine: "fallback",
    summary: {
      ...(decorated.summary || {}),
      resultMode: "fallback_draft",
      engine: "fallback",
      bodyLength: decorated.bodyLength || String(decorated.body || "").replace(/\s+/g, "").length,
      actualBodyCharCount: Array.from(String(decorated.body || "")).length,
      targetCharCount: decorated.contentPackage?.targetLengthRange?.target || decorated.contentPackage?.targetCharCount || null,
      judgeEngine: humanQuality.judgeEngine,
      isMock: humanQuality.isMock,
      rawQualityScore: decorated.rawQualityScore ?? decorated.contentPackage?.rawQualityScore ?? humanQuality.rawQualityScore,
      cappedScore: humanQuality.score,
      publishReady: humanQuality.publishReady
    },
    contentPackage: decorated.contentPackage
      ? {
          ...decorated.contentPackage,
          resultMode: "fallback_draft",
          engine: "fallback",
          actualBodyLength: decorated.bodyLength || String(decorated.body || "").replace(/\s+/g, "").length,
          actualBodyCharCount: Array.from(String(decorated.body || "")).length,
          summary: {
            ...(decorated.contentPackage.summary || {}),
            resultMode: "fallback_draft",
            engine: "fallback",
            bodyLength: decorated.bodyLength || String(decorated.body || "").replace(/\s+/g, "").length,
            actualBodyCharCount: Array.from(String(decorated.body || "")).length,
            targetCharCount: decorated.contentPackage.targetLengthRange?.target || decorated.contentPackage.targetCharCount || null,
            judgeEngine: humanQuality.judgeEngine,
            isMock: humanQuality.isMock,
            rawQualityScore: decorated.rawQualityScore ?? decorated.contentPackage?.rawQualityScore ?? humanQuality.rawQualityScore,
            cappedScore: humanQuality.score,
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
  const rawForm = await parseJsonRequest(context.request);
  const visionForm = await enrichFormWithVision(rawForm, context.env);
  const form = normalizeBlogWriterInput(visionForm);
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
      isMock: Boolean(acceptedDraft.isMock || isMockEnvironment(context.env)),
      llm: {
        used: true,
        accepted: true,
        model,
        isMock: Boolean(acceptedDraft.isMock || isMockEnvironment(context.env)),
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
