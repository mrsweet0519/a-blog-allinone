import { createProductReviewDraft } from "../../shared/productReviewGenerator.js";
import { BLOG_WRITER_PROMPT_VERSION, buildBlogWriterPromptPayload } from "../../shared/blogWriterPrompt.js";
import { evaluateBlogWriterQuality } from "../../shared/blogWriterQuality.js";
import { createHumanQualityFactMap, evaluateHumanQuality } from "../../shared/blogWriterHumanQuality.js";
import { createBlogWriterTrace, summarizeResultDiff } from "../../shared/blogWriterTrace.js";
import {
  buildBlogWriterPipelineContext,
  createClaimLedger,
  normalizeBlogWriterInput,
  summarizeClaimLedger
} from "../../shared/blogWriterPipeline.js";
import { ANEUNYEOJA_WRITER_PROFILE_ID } from "../../shared/writerProfiles/aneunyeoja.js";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_VISION_MODEL = "gpt-4o-mini";
const LLM_ENABLED_PATTERN = /^(1|true|yes|on)$/iu;
const VISION_SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_VISION_IMAGES = 3;
const MAX_VISION_DATA_URL_LENGTH = 2_500_000;
const OPENAI_REQUEST_TIMEOUT_MS = 45_000;
const OPENAI_RETRY_ATTEMPTS = 3;
const OPENAI_RETRY_BASE_MS = 2_000;
const ALLOWED_LLM_REASONS = new Set([
  "llm-disabled",
  "server-key-missing",
  "model-missing",
  "openai-auth-failed",
  "openai-quota-exceeded",
  "openai-rate-limited",
  "openai-timeout",
  "openai-http-error",
  "openai-invalid-response",
  "llm-schema-invalid",
  "llm-quality-rejected",
  "vision-disabled",
  "vision-request-failed",
  "unknown-llm-error"
]);
const STAGE_REASON_MAP = {
  "llm-disabled": "disabled",
  "server-key-missing": "key-missing",
  "model-missing": "invalid-schema",
  "openai-auth-failed": "auth-failed",
  "openai-quota-exceeded": "quota-exceeded",
  "openai-rate-limited": "rate-limited",
  "openai-timeout": "timeout",
  "openai-http-error": "http-error",
  "openai-invalid-response": "invalid-json",
  "llm-schema-invalid": "invalid-schema",
  "llm-quality-rejected": "quality-rejected",
  "vision-disabled": "disabled",
  "vision-request-failed": "unknown",
  "unknown-llm-error": "unknown"
};

class SafeLlmError extends Error {
  constructor(reason = "unknown-llm-error", { status = null, cause = null, retryAfterMs = null, attempts = 1 } = {}) {
    super(reason);
    this.name = "SafeLlmError";
    this.reason = ALLOWED_LLM_REASONS.has(reason) ? reason : "unknown-llm-error";
    this.status = status;
    this.cause = cause;
    this.retryAfterMs = retryAfterMs;
    this.attempts = attempts;
  }
}

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

const stripJsonFence = (value = "") =>
  String(value || "")
    .replace(/^```(?:json)?/iu, "")
    .replace(/```$/u, "")
    .trim();

const extractFirstJsonObject = (value = "") => {
  const source = stripJsonFence(value);
  const start = source.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
};

const parseLlmJson = (value = "") => {
  const cleaned = stripJsonFence(value);
  return JSON.parse(cleaned);
};

const safeReason = (reason = "") => (ALLOWED_LLM_REASONS.has(reason) ? reason : "unknown-llm-error");

const isLlmEnabled = (env = {}) => LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_LLM_ENABLED || "").trim());

const getOpenAiModel = (env = {}) => env.OPENAI_MODEL || env.BLOG_WRITER_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
const getLlmEnvironmentStatus = (env = {}) => {
  const model = String(getOpenAiModel(env) || "").trim();
  const enabled = isLlmEnabled(env);
  const judgeEnabled = isEnabledFlag(env.BLOG_WRITER_LLM_JUDGE_ENABLED);
  const revisionEnabled = isEnabledFlag(env.BLOG_WRITER_LLM_REVISION_ENABLED);
  const visionEnabled = isEnabledFlag(env.BLOG_WRITER_VISION_ENABLED);
  const keyPresent = Boolean(env.OPENAI_API_KEY);
  const modelPresent = Boolean(model);
  const reason = !enabled ? "llm-disabled" : !keyPresent ? "server-key-missing" : !modelPresent ? "model-missing" : null;

  return {
    enabled,
    judgeEnabled,
    revisionEnabled,
    visionEnabled,
    keyPresent,
    modelPresent,
    model,
    reason
  };
};
const isMockEnvironment = (env = {}) =>
  /^(unit-test-key|mock-key|test-key)$/u.test(String(env.OPENAI_API_KEY || "")) ||
  /^(unit-model|mock-model)$/u.test(String(getOpenAiModel(env) || ""));

const shouldUseLlm = (env = {}) =>
  !getLlmEnvironmentStatus(env).reason;

const shouldUseLlmJudge = (env = {}) =>
  shouldUseLlm(env) &&
  getLlmEnvironmentStatus(env).judgeEnabled;

const shouldUseLlmRevision = (env = {}) =>
  shouldUseLlmJudge(env) &&
  getLlmEnvironmentStatus(env).revisionEnabled;

const shouldUseVision = (env = {}) =>
  Boolean(env.OPENAI_API_KEY) &&
  getLlmEnvironmentStatus(env).visionEnabled;

const getVisionModel = (env = {}) =>
  env.OPENAI_VISION_MODEL || env.BLOG_WRITER_OPENAI_VISION_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_VISION_MODEL;

const classifyOpenAiStatus = (status = 0, responseText = "") => {
  if (status === 401 || status === 403) return "openai-auth-failed";
  if (status === 429) {
    return /quota|insufficient_quota|billing|exceeded your current quota/iu.test(responseText)
      ? "openai-quota-exceeded"
      : "openai-rate-limited";
  }
  return "openai-http-error";
};

const toStageReason = (reason = "") => STAGE_REASON_MAP[reason] || "unknown";

const createLlmStages = (env = {}) => {
  const envStatus = getLlmEnvironmentStatus(env);
  const disabledReason = envStatus.reason ? toStageReason(envStatus.reason) : "disabled";
  return {
    writer: {
      used: false,
      success: false,
      status: null,
      reason: envStatus.reason ? disabledReason : null,
      attempts: 0,
      latencyMs: 0,
      finishReason: null
    },
    judge: {
      used: false,
      success: false,
      status: null,
      reason: envStatus.judgeEnabled ? null : "disabled",
      attempts: 0,
      latencyMs: 0
    },
    revisions: []
  };
};

const recordStageSuccess = (llmStages, stage, { status = 200, attempts = 1, latencyMs = 0, finishReason = null, revisionAttempt = 0 } = {}) => {
  if (!llmStages) return;
  const target =
    stage === "revision"
      ? (() => {
          const entry = {
            attempt: revisionAttempt || llmStages.revisions.length + 1,
            used: true,
            success: true,
            status,
            reason: null,
            attempts,
            latencyMs
          };
          llmStages.revisions.push(entry);
          return entry;
        })()
      : llmStages[stage];
  if (!target) return;
  target.used = true;
  target.success = true;
  target.status = status;
  target.reason = null;
  target.attempts = attempts;
  target.latencyMs = latencyMs;
  if (stage === "writer") target.finishReason = finishReason || null;
};

const recordStageFailure = (llmStages, stage, error, { attempts = 1, latencyMs = 0, revisionAttempt = 0 } = {}) => {
  if (!llmStages) return;
  const reason = toStageReason(error instanceof SafeLlmError ? error.reason : "unknown-llm-error");
  const status = error instanceof SafeLlmError ? safeNumericStatus(error.status) : null;
  const target =
    stage === "revision"
      ? (() => {
          const entry = {
            attempt: revisionAttempt || llmStages.revisions.length + 1,
            used: true,
            success: false,
            status,
            reason,
            attempts,
            latencyMs
          };
          llmStages.revisions.push(entry);
          return entry;
        })()
      : llmStages[stage];
  if (!target) return;
  target.used = true;
  target.success = false;
  target.status = status;
  target.reason = reason;
  target.attempts = attempts;
  target.latencyMs = latencyMs;
};

const getRetryAfterMs = (response) => {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
};

const getRetryDelayMs = ({ env = {}, attempt = 1, retryAfterMs = null } = {}) => {
  if (Number.isFinite(Number(retryAfterMs))) return Number(retryAfterMs);
  const configured = Number(env.BLOG_WRITER_LLM_RETRY_BASE_MS);
  const base = Number.isFinite(configured) ? configured : isMockEnvironment(env) ? 0 : OPENAI_RETRY_BASE_MS;
  const jitter = base > 0 ? Math.floor(Math.random() * Math.min(500, base)) : 0;
  return Math.min(10_000, Math.round(base * Math.pow(2.5, attempt - 1) + jitter));
};

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

const isRetryableError = (error) => {
  if (!(error instanceof SafeLlmError)) return true;
  if (["openai-auth-failed", "openai-quota-exceeded", "llm-schema-invalid", "openai-invalid-response"].includes(error.reason)) return false;
  if (error.reason === "openai-rate-limited" || error.reason === "openai-timeout" || error.reason === "unknown-llm-error") return true;
  return error.reason === "openai-http-error" && [500, 502, 503, 504].includes(Number(error.status));
};

const readSafeResponseText = async (response) => {
  try {
    return String(await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
};

const fetchOpenAiJsonOnce = async ({ url = "https://api.openai.com/v1/chat/completions", env = {}, body = {}, timeoutMs = OPENAI_REQUEST_TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const responseText = await readSafeResponseText(response);
      throw new SafeLlmError(classifyOpenAiStatus(response.status, responseText), {
        status: response.status,
        retryAfterMs: getRetryAfterMs(response)
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new SafeLlmError("openai-invalid-response", { status: response.status, cause: error });
    }
  } catch (error) {
    if (error instanceof SafeLlmError) throw error;
    if (error?.name === "AbortError") throw new SafeLlmError("openai-timeout", { cause: error });
    throw new SafeLlmError("unknown-llm-error", { cause: error });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchOpenAiJson = async ({
  url = "https://api.openai.com/v1/chat/completions",
  env = {},
  body = {},
  timeoutMs = OPENAI_REQUEST_TIMEOUT_MS,
  maxAttempts = OPENAI_RETRY_ATTEMPTS
} = {}) => {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await fetchOpenAiJsonOnce({ url, env, body, timeoutMs });
      payload.__openAiMeta = {
        attempts: attempt,
        status: 200,
        finishReason: payload?.choices?.[0]?.finish_reason || null
      };
      return payload;
    } catch (error) {
      lastError = error;
      if (lastError instanceof SafeLlmError) lastError.attempts = attempt;
      if (attempt >= maxAttempts || !isRetryableError(error)) break;
      await wait(getRetryDelayMs({ env, attempt, retryAfterMs: error?.retryAfterMs }));
    }
  }
  throw lastError;
};

const parseLlmJsonSafely = (content = "") => {
  try {
    const parsed = parseLlmJson(content);
    parsed.__schemaRepair = {
      schemaRepairUsed: false,
      repairedFields: [],
      discardedFields: [],
      rawBodyLength: String(content || "").length,
      recoveredBodyLength: getDraftBody(parsed).length
    };
    return parsed;
  } catch (error) {
    const extracted = extractFirstJsonObject(content);
    if (extracted) {
      try {
        const parsed = JSON.parse(extracted);
        parsed.__schemaRepair = {
          schemaRepairUsed: true,
          repairedFields: ["json-object-extracted"],
          discardedFields: [],
          rawBodyLength: String(content || "").length,
          recoveredBodyLength: getDraftBody(parsed).length
        };
        return parsed;
      } catch {
        // Fall through to the plain-body recovery below.
      }
    }
    const plainBody = stripJsonFence(content);
    if (Array.from(plainBody).length >= 300) {
      return {
        body: plainBody,
        sections: [],
        titleCandidates: [],
        faqItems: [],
        hashtags: [],
        __schemaRepair: {
          schemaRepairUsed: true,
          repairedFields: ["body"],
          discardedFields: [],
          rawBodyLength: plainBody.length,
          recoveredBodyLength: plainBody.length
        }
      };
    }
    throw new SafeLlmError("llm-schema-invalid", { cause: error });
  }
};

const isEnabledFlag = (value = "") => LLM_ENABLED_PATTERN.test(String(value || "").trim());

const safeNumericStatus = (status = null) => {
  if (status === null || status === undefined || status === "") return null;
  const numericStatus = Number(status);
  return Number.isFinite(numericStatus) ? numericStatus : null;
};

const getErrorDiagnostics = (error) => ({
  reason: error instanceof SafeLlmError ? error.reason : "unknown-llm-error",
  status: error instanceof SafeLlmError ? error.status : null
});

const createSafeLlmDiagnostics = ({ env = {}, used = false, reason = null, status = null, attempted = false, accepted = false, judgeUsed = false } = {}) => {
  const envStatus = getLlmEnvironmentStatus(env);
  return {
    used: Boolean(used),
    attempted: Boolean(attempted || used),
    accepted: Boolean(accepted),
    enabled: envStatus.enabled,
    judgeEnabled: envStatus.judgeEnabled,
    revisionEnabled: envStatus.revisionEnabled,
    visionEnabled: envStatus.visionEnabled,
    keyPresent: envStatus.keyPresent,
    modelPresent: envStatus.modelPresent,
    model: envStatus.model,
    reason: reason ? safeReason(reason) : null,
    status: safeNumericStatus(status),
    isMock: isMockEnvironment(env),
    judgeUsed: Boolean(judgeUsed)
  };
};

const getInputImageCount = (form = {}) => {
  if (Number.isFinite(Number(form.imageCount))) return Number(form.imageCount);
  if (Array.isArray(form.imageContext)) return form.imageContext.length;
  if (Array.isArray(form.images)) return form.images.length;
  if (Array.isArray(form.photos)) return form.photos.length;
  if (Array.isArray(form.photoMetadata)) return form.photoMetadata.length;
  return 0;
};

const createSafeVisionDiagnostics = ({ form = {}, result = {} } = {}) => {
  const packageData = result.contentPackage || {};
  const imageAnalysis = packageData.imageAnalysis || result.imageAnalysis || {};
  const trace = packageData.trace || result.trace || {};
  const mode = trace.visionMode || imageAnalysis.mode || "none";
  return {
    mode,
    reason: form.visionDiagnostics?.reason || null,
    status: safeNumericStatus(form.visionDiagnostics?.status),
    imageCount: getInputImageCount(form),
    visibleElementsCount: Array.isArray(imageAnalysis.visuallySupported) ? imageAnalysis.visuallySupported.length : 0
  };
};

const logSafeGenerateBlogEvent = ({ result = {}, env = {}, status = 200 } = {}) => {
  try {
    const packageData = result.contentPackage || {};
    const trace = packageData.trace || result.trace || {};
    const llm = result.llm || {};
    console.log(JSON.stringify({
      route: "/api/generate-blog",
      engine: result.engine || packageData.engine || trace.engine || "fallback",
      judgeEngine: result.judgeEngine || packageData.judgeEngine || trace.judgeEngine || "deterministic",
      enabled: getLlmEnvironmentStatus(env).enabled,
      judgeEnabled: getLlmEnvironmentStatus(env).judgeEnabled,
      revisionEnabled: getLlmEnvironmentStatus(env).revisionEnabled,
      visionEnabled: getLlmEnvironmentStatus(env).visionEnabled,
      keyPresent: getLlmEnvironmentStatus(env).keyPresent,
      modelPresent: getLlmEnvironmentStatus(env).modelPresent,
      llmReason: llm.reason || null,
      visionMode: trace.visionMode || packageData.imageAnalysis?.mode || result.imageAnalysis?.mode || "none",
      status
    }));
  } catch {
    // Logging must never break generation.
  }
};

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
    .map((item) => {
      if (typeof item === "string") {
        return {
          question: "",
          answer: item.trim()
        };
      }
      return {
        question: String(item?.question || "").trim(),
        answer: String(item?.answer || "").trim()
      };
    })
    .filter((item) => item.question && item.answer);
};

const normalizeSections = (sections = []) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((section) => ({
      heading: String(section?.heading || "").trim(),
      paragraphs: Array.isArray(section?.paragraphs)
        ? section.paragraphs.map((paragraph) => String(paragraph || "").trim()).filter(Boolean)
        : [],
      imageRefs: normalizeList(section?.imageRefs || [])
    }))
    .filter((section) => section.heading || section.paragraphs.length > 0);
};

const bodyFromSections = (sections = []) =>
  normalizeSections(sections)
    .map((section) => [section.heading, ...section.paragraphs].filter(Boolean).join("\n\n"))
    .filter(Boolean)
    .join("\n\n");

const getDraftBody = (draft = {}) =>
  String(draft.body || draft.blogBody || bodyFromSections(draft.sections) || "").trim();

function getWriterMaxTokens({ form = {}, fallbackDraft = {} } = {}) {
  const packageData = fallbackDraft.contentPackage || fallbackDraft || {};
  const target = Number(
    form.targetCharCount ||
      form.targetLength ||
      packageData.requestedTargetCharCount ||
      packageData.targetLengthRange?.target ||
      packageData.targetCharCount ||
      2500
  );
  const safeTarget = Number.isFinite(target) ? target : 2500;
  return Math.max(1800, Math.min(7000, Math.ceil(safeTarget * 1.8 + 1200)));
}

const getPostProcessingSteps = (llmDraft = {}) =>
  [
    "schema-validation",
    Array.isArray(llmDraft.sections) ? "sections-to-body" : "",
    "title-candidate-normalization",
    "faq-normalization",
    "hashtag-deduplication",
    "claim-ledger",
    "quality-gate"
  ].filter(Boolean);

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

  const payload = await fetchOpenAiJson({
    env,
    body: {
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
    }
  });

  const content = payload?.choices?.[0]?.message?.content || "";
  return normalizeVisionAnalysis(parseLlmJsonSafely(content), imageItems);
};

const enrichFormWithVision = async (form = {}, env = {}) => {
  if (!LLM_ENABLED_PATTERN.test(String(env.BLOG_WRITER_VISION_ENABLED || "").trim())) {
    return {
      ...form,
      visionDiagnostics: {
        reason: "vision-disabled",
        status: null
      }
    };
  }
  try {
    const imageAnalysis = await requestVisionAnalysis({ env, form });
    return imageAnalysis ? { ...form, imageAnalysis } : form;
  } catch (error) {
    return {
      ...form,
      visionDiagnostics: {
        reason: error instanceof SafeLlmError ? error.reason : "vision-request-failed",
        status: error instanceof SafeLlmError ? error.status : null
      }
    };
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
        revisionInstructions: ["string"],
        coveredFactIds: ["uf1"],
        missingFactIds: ["uf2"],
        unsupportedClaims: ["string"],
        applicability: {
          imageGrounding: { applicable: "boolean", score: "number|null" },
          faqUtility: { applicable: "boolean", score: "number|null" }
        }
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
        claimLedger: draft.contentPackage?.claimLedger || draft.claimLedger || [],
        imageApplicable: Boolean(form.imageCount || form.images?.length || form.photos?.length || form.imageContext?.length),
        faqApplicable: getDraftFaqItems(draft).length > 0
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

const requestLlmHumanJudge = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {}, llmStages = null } = {}) => {
  if (!shouldUseLlmJudge(env)) return null;
  const startedAt = Date.now();
  try {
    const payload = await fetchOpenAiJson({
      env,
      body: {
        model,
        messages: buildHumanJudgeMessages({ form, draft }),
        temperature: 0,
        max_tokens: 1800,
        response_format: { type: "json_object" }
      }
    });
    recordStageSuccess(llmStages, "judge", {
      status: payload.__openAiMeta?.status || 200,
      attempts: payload.__openAiMeta?.attempts || 1,
      latencyMs: Date.now() - startedAt
    });

    const content = payload?.choices?.[0]?.message?.content || "";
    return parseLlmJsonSafely(content);
  } catch (error) {
    recordStageFailure(llmStages, "judge", error, {
      attempts: error?.attempts || 1,
      latencyMs: Date.now() - startedAt
    });
    throw error;
  }
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
      missingFactIds: humanQuality.diagnostics?.inputFactCoverage?.missingFactIds || [],
      missingFacts: humanQuality.diagnostics?.inputFactCoverage?.missingFacts || [],
      unsupportedClaims: humanQuality.diagnostics?.unsupportedClaims || [],
      duplicateParagraphs: humanQuality.diagnostics?.duplicateParagraphs || [],
      lengthContract: draft.contentPackage?.targetLengthContract || null,
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

const requestLlmRevision = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {}, humanQuality = {}, llmStages = null, revisionAttempt = 1 } = {}) => {
  const startedAt = Date.now();
  try {
    const payload = await fetchOpenAiJson({
      env,
      body: {
        model,
        messages: buildRevisionMessages({ form, draft, humanQuality }),
        temperature: 0.35,
        max_tokens: getWriterMaxTokens({ form, fallbackDraft: draft }),
        response_format: { type: "json_object" }
      }
    });
    recordStageSuccess(llmStages, "revision", {
      status: payload.__openAiMeta?.status || 200,
      attempts: payload.__openAiMeta?.attempts || 1,
      latencyMs: Date.now() - startedAt,
      revisionAttempt
    });

    const content = payload?.choices?.[0]?.message?.content || "";
    return parseLlmJsonSafely(content);
  } catch (error) {
    recordStageFailure(llmStages, "revision", error, {
      attempts: error?.attempts || 1,
      latencyMs: Date.now() - startedAt,
      revisionAttempt
    });
    throw error;
  }
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
  const nextTrace = draft.contentPackage?.trace
    ? {
        ...draft.contentPackage.trace,
        judgeEngine: humanQuality.judgeEngine,
        isMock: humanQuality.isMock,
        qualityScore: attachedScore,
        publishReady
      }
    : null;
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
        trace: nextTrace || draft.contentPackage.trace,
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
    trace: nextTrace || draft.trace,
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

const judgeDraft = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {}, engine = "llm", llmStages = null } = {}) => {
  const llmJudge = await requestLlmHumanJudge({
    env,
    model,
    form,
    draft,
    llmStages
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

const attachQualityDiagnostics = (draft = {}, qualityDiagnostics = {}) => ({
  ...draft,
  qualityDiagnostics,
  contentPackage: draft.contentPackage
    ? {
        ...draft.contentPackage,
        qualityDiagnostics
      }
    : draft.contentPackage
});

const buildQualityDiagnostics = ({
  attempts = [],
  revisionCallCount = 0,
  selectedAttempt = 1,
  finalQualityScore = 0
} = {}) => {
  const scores = attempts.map((attempt) => Number(attempt.score) || 0);
  return {
    initialQualityScore: scores[0] ?? 0,
    qualityAttempts: attempts.length || 0,
    revisionUsed: revisionCallCount > 0,
    revisionCallCount,
    attemptScores: scores,
    selectedAttempt,
    finalQualityScore: Number(finalQualityScore) || 0
  };
};

const improveDraftWithQualityAttempts = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, fallbackDraft = {}, initialDraft = {}, llmStages = null } = {}) => {
  let attempts = 1;
  let revisionCallCount = 0;
  let selectedAttempt = 1;
  const attemptSummaries = [];
  let currentDraft = initialDraft;
  let currentQuality = null;
  try {
    currentQuality = await judgeDraft({ env, model, form, draft: currentDraft, engine: "llm", llmStages });
  } catch {
    currentQuality = evaluateDraftHumanQuality({
      form,
      draft: currentDraft,
      engine: "llm"
    });
    const deterministicDraft = attachHumanQuality(currentDraft, currentQuality, attempts);
    return attachQualityDiagnostics(
      deterministicDraft,
      buildQualityDiagnostics({
        attempts: [{ attempt: attempts, score: currentQuality.score }],
        revisionCallCount: 0,
        selectedAttempt: 1,
        finalQualityScore: currentQuality.score
      })
    );
  }
  attemptSummaries.push({ attempt: attempts, score: currentQuality.score });
  let bestDraft = attachHumanQuality(currentDraft, currentQuality, attempts);
  let bestQuality = currentQuality;

  while (shouldUseLlmRevision(env) && attempts < 3 && currentQuality.score < 95) {
    revisionCallCount += 1;
    let revisionDraft = null;
    try {
      revisionDraft = await requestLlmRevision({
        env,
        model,
        form,
        draft: currentDraft,
        humanQuality: currentQuality,
        llmStages,
        revisionAttempt: revisionCallCount
      });
    } catch {
      break;
    }
    if (!hasUsableLlmDraft(revisionDraft)) break;
    attempts += 1;
    currentDraft = mergeAcceptedLlmDraft({
      form,
      fallbackDraft,
      llmDraft: revisionDraft
    });
    try {
      currentQuality = await judgeDraft({ env, model, form, draft: currentDraft, engine: "llm", llmStages });
    } catch {
      currentQuality = evaluateDraftHumanQuality({
        form,
        draft: currentDraft,
        engine: "llm"
      });
    }
    attemptSummaries.push({ attempt: attempts, score: currentQuality.score });
    if (currentQuality.score > bestQuality.score) {
      bestQuality = currentQuality;
      selectedAttempt = attempts;
      bestDraft = attachHumanQuality(currentDraft, currentQuality, attempts);
    }
  }

  return attachQualityDiagnostics(
    attachHumanQuality(bestDraft, bestQuality, attempts),
    buildQualityDiagnostics({
      attempts: attemptSummaries,
      revisionCallCount,
      selectedAttempt,
      finalQualityScore: bestQuality.score
    })
  );
};

const mergeAcceptedLlmDraft = ({ form = {}, fallbackDraft = {}, llmDraft = {} } = {}) => {
  const fallbackPackage = fallbackDraft.contentPackage || {};
  const titleCandidates = normalizeList(llmDraft.titleCandidates || llmDraft.titles, fallbackDraft.titleCandidates || fallbackPackage.titleCandidates || []);
  const finalTitle = String(llmDraft.finalTitle || llmDraft.selectedTitle || titleCandidates[0] || fallbackDraft.finalTitle || "").trim();
  const llmSections = normalizeSections(llmDraft.sections);
  const rawLlmBody = getDraftBody(llmDraft);
  const body = rawLlmBody || String(fallbackDraft.body || "").trim();
  const schemaRepair = llmDraft.__schemaRepair || {
    schemaRepairUsed: false,
    repairedFields: [],
    discardedFields: [],
    rawBodyLength: rawLlmBody.length,
    recoveredBodyLength: body.length
  };
  const repairedFields = new Set(schemaRepair.repairedFields || []);
  if (!Array.isArray(llmDraft.titleCandidates || llmDraft.titles) || normalizeList(llmDraft.titleCandidates || llmDraft.titles).length < 3) repairedFields.add("titleCandidates");
  if (!Array.isArray(llmDraft.faqItems || llmDraft.faq)) repairedFields.add("faqItems");
  if (!Array.isArray(llmDraft.hashtags)) repairedFields.add("hashtags");
  const normalizedSchemaRepair = {
    ...schemaRepair,
    schemaRepairUsed: Boolean(schemaRepair.schemaRepairUsed || repairedFields.size > (schemaRepair.repairedFields || []).length),
    repairedFields: [...repairedFields]
  };
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
  const postProcessingSteps = getPostProcessingSteps(llmDraft);
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
  const deterministicHumanQuality = evaluateHumanQuality({
    title: finalTitle,
    titleCandidates,
    body,
    faq: faqItems,
    hashtags,
    factMap: pipelineContext.factMap,
    imageAnalysis: pipelineContext.imageAnalysis,
    category: fallbackDraft.category,
    visitStatus: pipelineContext.factMap?.visitStatus,
    mainKeyword,
    primaryEntity: fallbackPackage.primaryEntity || fallbackPackage.blogWriterAnalysis?.primaryEntity || fallbackDraft.primaryEntity || mainKeyword,
    subKeywords,
    requestedTargetCharCount: fallbackPackage.requestedTargetCharCount || form.targetCharCount || targetCharCount,
    effectiveTargetCharCount: targetCharCount,
    engine: "llm"
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
  const publishReady = deterministicHumanQuality.publishReady && !claimLedgerSummary.hardFail;
  const trace = createBlogWriterTrace({
    engine: "llm",
    judgeEngine: deterministicHumanQuality.judgeEngine,
    isMock: deterministicHumanQuality.isMock,
    promptVersion: BLOG_WRITER_PROMPT_VERSION,
    writerProfile: ANEUNYEOJA_WRITER_PROFILE_ID,
    imageAnalysis: pipelineContext.imageAnalysis,
    factMap: pipelineContext.factMap,
    postProcessingSteps,
    qualityScore: cappedHumanScore,
    publishReady
  });
  const rawFinalDiff = summarizeResultDiff({
    rawResult: llmDraft,
    finalResult: { body, sections: llmSections },
    postProcessingSteps
  });
  const requestedTargetCharCount = fallbackPackage.requestedTargetCharCount || form.targetCharCount || form.targetLength || targetCharCount;
  const actualCharCount = Array.from(String(body || "")).length;
  const rawWriterCharCount = Array.from(String(rawLlmBody || body || "")).length;
  const postProcessingReductionRatio =
    rawWriterCharCount > 0
      ? Number(((rawWriterCharCount - actualCharCount) / rawWriterCharCount).toFixed(3))
      : 0;
  const targetLengthContract = {
    ...(fallbackPackage.targetLengthContract || {}),
    requestedTargetCharCount,
    effectiveTargetCharCount: targetCharCount,
    rawWriterCharCount,
    actualCharCount,
    finalCharCount: actualCharCount,
    targetComplianceRatio: requestedTargetCharCount > 0 ? Number((actualCharCount / requestedTargetCharCount).toFixed(2)) : 0,
    finishReason: llmDraft.__openAiMeta?.finishReason || null,
    postProcessingReductionRatio,
    informationSufficiency: pipelineContext.informationSufficiency?.level || null,
    resultMode: "honest_draft"
  };

  const contentPackage = {
    ...fallbackPackage,
    resultMode: "honest_draft",
    writerProfile: {
      id: ANEUNYEOJA_WRITER_PROFILE_ID,
      version: BLOG_WRITER_PROMPT_VERSION
    },
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
    sections: llmSections,
    blogBody: body,
    claimLedger,
    claimLedgerSummary,
    engine: "llm",
    actualBodyLength: bodyLength,
    actualBodyCharCount: actualCharCount,
    targetLengthContract,
    requestedTargetCharCount,
    effectiveTargetCharCount: targetCharCount,
    actualCharCount,
    targetComplianceRatio: targetLengthContract.targetComplianceRatio,
    summary: {
      engine: "llm",
      bodyLength,
      actualBodyCharCount: actualCharCount,
      targetCharCount,
      requestedTargetCharCount,
      effectiveTargetCharCount: targetCharCount,
      actualCharCount,
      targetComplianceRatio: targetLengthContract.targetComplianceRatio,
      informationSufficiency: pipelineContext.informationSufficiency?.level || null,
      rawQualityScore,
      cappedScore: cappedHumanScore,
      judgeEngine: deterministicHumanQuality.judgeEngine,
      isMock: deterministicHumanQuality.isMock,
      publishReady
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
    trace,
    diagnostics: {
      ...(fallbackPackage.diagnostics || {}),
      rawFinalDiff,
      schemaRepair: normalizedSchemaRepair
    },
    publishReady,
    judgeEngine: deterministicHumanQuality.judgeEngine,
    isMock: deterministicHumanQuality.isMock,
    qualityAttempts: 1
  };

  const { __schemaRepair: _schemaRepair, __openAiMeta: _openAiMeta, ...safeLlmDraft } = llmDraft;

  return {
    ...fallbackDraft,
    ...safeLlmDraft,
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
    sections: llmSections,
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
      publishReady
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
    trace,
    diagnostics: contentPackage.diagnostics,
    publishReady,
    judgeEngine: deterministicHumanQuality.judgeEngine,
    isMock: deterministicHumanQuality.isMock,
    qualityAttempts: 1
  };
};

const withFallbackRoute = (fallbackDraft = {}, llm = {}, form = {}, env = {}) => {
  const humanQuality = evaluateDraftHumanQuality({ form, draft: fallbackDraft, engine: "fallback" });
  const decorated = attachHumanQuality(fallbackDraft, humanQuality, 1);
  const safeLlm = createSafeLlmDiagnostics({
    env,
    used: false,
    attempted: llm.attempted,
    reason: llm.reason || getLlmEnvironmentStatus(env).reason || "unknown-llm-error",
    status: llm.status
  });
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
    llm: safeLlm,
    llmStages: llm.llmStages || createLlmStages(env),
    vision: createSafeVisionDiagnostics({ form, result: decorated })
  };
};

const hasUsableLlmDraft = (draft = {}) =>
  Boolean(getDraftBody(draft)) &&
  Boolean(String(draft.finalTitle || draft.selectedTitle || "").trim() || normalizeList(draft.titleCandidates || draft.titles).length > 0);

const requestLlmWriter = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, fallbackDraft = {}, promptPayload = {}, llmStages = null } = {}) => {
  let maxTokens = getWriterMaxTokens({ form, fallbackDraft });
  let lastDraft = null;
  let lastPayload = null;

  for (let lengthRetry = 0; lengthRetry < 2; lengthRetry += 1) {
    const startedAt = Date.now();
    try {
      const payload = await fetchOpenAiJson({
        env,
        body: {
          model,
          messages: promptPayload.messages,
          temperature: 0.45,
          max_tokens: maxTokens,
          response_format: { type: "json_object" }
        }
      });
      lastPayload = payload;
      const content = payload?.choices?.[0]?.message?.content || "";
      const draft = parseLlmJsonSafely(content);
      draft.__openAiMeta = {
        ...(payload.__openAiMeta || {}),
        maxTokens,
        lengthRetry
      };
      lastDraft = draft;

      if (payload.__openAiMeta?.finishReason === "length" && lengthRetry === 0) {
        maxTokens = Math.min(9000, Math.ceil(maxTokens * 1.5));
        continue;
      }

      recordStageSuccess(llmStages, "writer", {
        status: payload.__openAiMeta?.status || 200,
        attempts: payload.__openAiMeta?.attempts || 1,
        latencyMs: Date.now() - startedAt,
        finishReason: payload.__openAiMeta?.finishReason || null
      });
      return draft;
    } catch (error) {
      recordStageFailure(llmStages, "writer", error, {
        attempts: error?.attempts || 1,
        latencyMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  recordStageSuccess(llmStages, "writer", {
    status: lastPayload?.__openAiMeta?.status || 200,
    attempts: lastPayload?.__openAiMeta?.attempts || 1,
    latencyMs: 0,
    finishReason: lastPayload?.__openAiMeta?.finishReason || null
  });
  return lastDraft;
};

export async function onRequestPost(context) {
  const env = context?.env ?? {};
  const llmStages = createLlmStages(env);
  const rawForm = await parseJsonRequest(context.request);
  const visionForm = await enrichFormWithVision(rawForm, env);
  const form = normalizeBlogWriterInput(visionForm);
  const fallbackDraft = createProductReviewDraft(form);
  const promptPayload = buildBlogWriterPromptPayload({
    form,
    fallbackDraft
  });

  if (!shouldUseLlm(env)) {
    const fallback = withFallbackRoute(fallbackDraft, {
      reason: getLlmEnvironmentStatus(env).reason || "unknown-llm-error",
      llmStages
    }, form, env);
    logSafeGenerateBlogEvent({ result: fallback, env, status: 200 });
    return jsonResponse(fallback);
  }

  try {
    const model = getOpenAiModel(env);
    const llmDraft = await requestLlmWriter({
      env,
      model,
      form,
      fallbackDraft,
      promptPayload,
      llmStages
    });
    if (!hasUsableLlmDraft(llmDraft)) {
      llmStages.writer.success = false;
      llmStages.writer.reason = "invalid-schema";
      const fallback = withFallbackRoute(fallbackDraft, {
        attempted: true,
        reason: "llm-schema-invalid",
        llmStages
      }, form, env);
      logSafeGenerateBlogEvent({ result: fallback, env, status: 200 });
      return jsonResponse(fallback);
    }

    let acceptedDraft = mergeAcceptedLlmDraft({
      form,
      fallbackDraft,
      llmDraft
    });
    try {
      if (shouldUseLlmJudge(env)) {
        acceptedDraft = await improveDraftWithQualityAttempts({
          env,
          model,
          form,
          fallbackDraft,
          initialDraft: acceptedDraft,
          llmStages
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

    const result = {
      ...acceptedDraft,
      generationRoute: "llm",
      engine: "llm",
      isMock: Boolean(acceptedDraft.isMock || isMockEnvironment(env)),
      llm: createSafeLlmDiagnostics({
        env,
        used: true,
        attempted: true,
        accepted: true,
        reason: null,
        judgeUsed: acceptedDraft.judgeEngine === "llm"
      }),
      llmStages,
      vision: createSafeVisionDiagnostics({ form, result: acceptedDraft })
    };
    logSafeGenerateBlogEvent({ result, env, status: 200 });
    return jsonResponse(result);
  } catch (error) {
    const errorDiagnostics = getErrorDiagnostics(error);
    const fallback = withFallbackRoute(fallbackDraft, {
      attempted: true,
      reason: errorDiagnostics.reason,
      status: errorDiagnostics.status,
      llmStages
    }, form, env);
    logSafeGenerateBlogEvent({ result: fallback, env, status: 200 });
    return jsonResponse(fallback);
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
