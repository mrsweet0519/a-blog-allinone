import { createProductReviewDraft } from "../../shared/productReviewGenerator.js";
import {
  BLOG_WRITER_OUTPUT_JSON_SCHEMA,
  BLOG_WRITER_PROMPT_VERSION,
  buildBlogWriterPromptPayload
} from "../../shared/blogWriterPrompt.js";
import { evaluateBlogWriterQuality } from "../../shared/blogWriterQuality.js";
import { createHumanQualityFactMap, evaluateHumanQuality } from "../../shared/blogWriterHumanQuality.js";
import { createBlogWriterTrace, summarizeResultDiff } from "../../shared/blogWriterTrace.js";
import {
  buildBlogWriterPipelineContext,
  calculateInputFactCoverage,
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
  "openai-refusal",
  "openai-output-incomplete",
  "openai-empty-output",
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
  "openai-refusal": "refusal",
  "openai-output-incomplete": "incomplete",
  "openai-empty-output": "empty-output",
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

const simpleHash = (value = "") => {
  let hash = 5381;
  for (const char of String(value || "")) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const getOpenAiApiEndpoint = () => "chat-completions";

export const extractOpenAiText = (payload = {}, { endpoint = getOpenAiApiEndpoint() } = {}) => {
  if (payload?.refusal || payload?.choices?.[0]?.message?.refusal) {
    return {
      apiEndpoint: endpoint,
      responseShape: endpoint === "responses" ? "responses-output" : "chat-choices",
      text: "",
      textExtracted: false,
      extractedTextLength: 0,
      extractedTextHash: "",
      refusal: true,
      finishReason: payload?.choices?.[0]?.finish_reason || null
    };
  }

  if (endpoint === "responses") {
    const outputText = String(payload.output_text || "");
    const nestedText = (payload.output || [])
      .flatMap((item) => item?.content || [])
      .map((item) => item?.text || item?.value || "")
      .filter(Boolean)
      .join("\n");
    const textValue = outputText || nestedText;
    return {
      apiEndpoint: "responses",
      responseShape: textValue ? "responses-output" : "unknown",
      text: textValue,
      textExtracted: Boolean(textValue),
      extractedTextLength: textValue.length,
      extractedTextHash: textValue ? simpleHash(textValue) : "",
      refusal: false,
      finishReason: payload.status === "incomplete" ? "length" : payload.status || null
    };
  }

  const textValue = String(payload?.choices?.[0]?.message?.content || "");
  return {
    apiEndpoint: "chat-completions",
    responseShape: textValue ? "chat-choices" : "unknown",
    text: textValue,
    textExtracted: Boolean(textValue),
    extractedTextLength: textValue.length,
    extractedTextHash: textValue ? simpleHash(textValue) : "",
    refusal: false,
    finishReason: payload?.choices?.[0]?.finish_reason || null
  };
};

const structuredResponseFormat = (name = "blog_writer_result", schema = BLOG_WRITER_OUTPUT_JSON_SCHEMA) => ({
  type: "json_schema",
  json_schema: {
    name,
    strict: true,
    schema
  }
});

export const BLOG_JUDGE_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    publishReady: { type: "boolean" },
    hardFail: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          severity: { type: "string" },
          evidence: { type: "string" },
          message: { type: "string" },
          revisionInstruction: { type: "string" }
        },
        required: ["code", "severity", "evidence", "message", "revisionInstruction"],
        additionalProperties: false
      }
    },
    coveredFactIds: { type: "array", items: { type: "string" } },
    missingFactIds: { type: "array", items: { type: "string" } },
    criticalMissingFactIds: { type: "array", items: { type: "string" } },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    categoryContamination: { type: "array", items: { type: "string" } },
    metaGuidance: { type: "array", items: { type: "string" } },
    josaErrors: { type: "array", items: { type: "string" } },
    genericFillerRatio: { type: "number" },
    targetComplianceRatio: { type: "number" },
    revisionInstructions: { type: "array", items: { type: "string" } },
    issueCodes: { type: "array", items: { type: "string" } }
  },
  required: [
    "score",
    "publishReady",
    "hardFail",
    "issues",
    "coveredFactIds",
    "missingFactIds",
    "criticalMissingFactIds",
    "unsupportedClaims",
    "categoryContamination",
    "metaGuidance",
    "josaErrors",
    "genericFillerRatio",
    "targetComplianceRatio",
    "revisionInstructions",
    "issueCodes"
  ],
  additionalProperties: false
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

const normalizeOpenAiUsage = (usage = null) => {
  if (!usage || typeof usage !== "object") return { input: 0, output: 0, total: 0 };
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.input ?? 0) || 0;
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.output ?? 0) || 0;
  const total = Number(usage.total_tokens ?? usage.total ?? 0) || input + output;
  return { input, output, total };
};

const recordStageSuccess = (llmStages, stage, { status = 200, attempts = 1, latencyMs = 0, finishReason = null, revisionAttempt = 0, usage = null } = {}) => {
  if (!llmStages) return;
  const tokenUsage = normalizeOpenAiUsage(usage);
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
            latencyMs,
            tokenUsage
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
  target.tokenUsage = tokenUsage;
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
        finishReason: payload?.choices?.[0]?.finish_reason || null,
        usage: normalizeOpenAiUsage(payload?.usage)
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
    if (Array.from(plainBody).length >= 120) {
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
    .filter((item) => item.question && item.answer)
    .slice(0, 2);
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

const charLength = (value = "") => Array.from(String(value || "")).length;

const splitBodyParagraphs = (body = "") =>
  String(body || "")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const joinBodyParagraphs = (paragraphs = []) =>
  paragraphs.map((paragraph) => String(paragraph || "").trim()).filter(Boolean).join("\n\n");

const dedupeBodyParagraphs = (body = "") => {
  const seen = new Set();
  let removedCount = 0;
  const paragraphs = splitBodyParagraphs(body).filter((paragraph) => {
    const key = compact(paragraph);
    if (!key) return false;
    if (seen.has(key)) {
      removedCount += 1;
      return false;
    }
    seen.add(key);
    return true;
  });
  return {
    body: joinBodyParagraphs(paragraphs),
    removedCount
  };
};

const includesCompact = (source = "", needle = "") => {
  const target = compact(needle);
  if (!target) return true;
  return compact(source).includes(target);
};

const firstSentenceHasEntity = (body = "", entity = "") => {
  const firstParagraph = splitBodyParagraphs(body)[0] || "";
  const firstSentence = firstParagraph.split(/(?<=[.!?。！？요다])\s+/u)[0] || firstParagraph;
  return includesCompact(firstSentence, entity);
};

const ensureEntityTitle = ({ title = "", primaryEntity = "", mainKeyword = "" } = {}) => {
  const cleanedTitle = String(title || "").trim();
  if (!primaryEntity || includesCompact(cleanedTitle, primaryEntity)) return cleanedTitle || primaryEntity || mainKeyword;
  const tail = cleanedTitle && !includesCompact(cleanedTitle, mainKeyword) && mainKeyword ? `${mainKeyword} ${cleanedTitle}` : cleanedTitle || mainKeyword;
  return `${primaryEntity} ${tail}`.trim();
};

const ensureEntityTitleCandidates = ({ candidates = [], primaryEntity = "", mainKeyword = "" } = {}) => {
  const base = normalizeList(candidates).slice(0, 5);
  const templates = [
    `${primaryEntity} ${mainKeyword}`.trim(),
    `${primaryEntity} 실제 사용 기준`.trim(),
    `${primaryEntity} 좋았던 점과 아쉬운 점`.trim(),
    `${primaryEntity} 다시 볼 때 남은 기준`.trim(),
    `${primaryEntity} 선택 전 확인할 점`.trim()
  ].filter(Boolean);
  const merged = [...base, ...templates]
    .map((title) => ensureEntityTitle({ title, primaryEntity, mainKeyword }))
    .filter(Boolean);
  const seen = new Set();
  const uniqueTitles = merged.filter((title) => {
    const key = compact(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  while (uniqueTitles.length < 5) {
    uniqueTitles.push(`${primaryEntity || mainKeyword} ${uniqueTitles.length + 1}`.trim());
  }
  const entityTitles = uniqueTitles.filter((title) => includesCompact(title, primaryEntity)).length;
  if (primaryEntity && entityTitles < 4) {
    return templates.concat(uniqueTitles).filter((title, index, arr) => arr.findIndex((item) => compact(item) === compact(title)) === index).slice(0, 5);
  }
  return uniqueTitles.slice(0, 5);
};

const ensureOpeningEntity = ({ body = "", primaryEntity = "", mainKeyword = "" } = {}) => {
  const paragraphs = splitBodyParagraphs(body);
  if (!primaryEntity || paragraphs.length === 0 || firstSentenceHasEntity(body, primaryEntity)) return body;
  const first = paragraphs[0];
  paragraphs[0] = `${primaryEntity} ${mainKeyword || "후기"} 관련 기준으로 보면, ${first}`;
  return paragraphs.join("\n\n");
};

const buildGroundedFactParagraph = ({ primaryEntity = "", mainKeyword = "", fact = {}, index = 0, detailed = false } = {}) => {
  const factText = String(fact?.value || "").trim();
  if (!factText) return "";
  const entity = primaryEntity || mainKeyword || "이번 주제";
  if (!detailed) {
    return `${entity}에서는 ${factText} 이 부분이 실제 흐름에서 바로 남았다. 좋았던 점과 아쉬운 점을 따로 부풀리지 않고, 그 상황에서 무엇이 편했고 무엇을 다시 볼지 중심으로 정리했다.`;
  }
  const templates = [
    `${entity}에서 가장 먼저 남는 대목은 ${factText} 이었다. 이 경험은 단순한 호불호보다 실제 상황을 보여준다. 그래서 좋은 점은 어떤 조건에서 좋았는지, 아쉬운 점은 다음 선택 때 무엇을 살피게 만드는지로 나뉜다. 같은 조건에서 다시 고른다면 이 지점이 우선순위를 바꿀 수 있다.`,
    `${factText} 라는 점도 ${entity}를 볼 때 따로 남겨둘 만했다. 순간적인 인상만 적으면 비슷한 글처럼 흐르기 쉬운데, 이 부분은 사용하거나 방문한 흐름 안에서 구체적으로 떠올릴 수 있는 장면이었다. 만족한 이유와 망설인 이유가 함께 있어서 한쪽으로만 기울지 않는다.`,
    `${entity}를 다시 떠올리면 ${factText} 이 부분이 선택 기준을 꽤 분명하게 만들었다. 좋았던 점은 실제 상황에서 체감된 장점으로 남았고, 아쉬웠던 점은 다음에 같은 조건을 만났을 때 먼저 살필 항목이 됐다. 그래서 추천보다 판단에 가까운 기록으로 이어진다.`,
    `${factText} 때문에 ${entity}에 대한 인상은 한 문장으로만 정리하기 어려웠다. 편했던 부분은 그대로 장점이 됐지만, 불편하거나 애매했던 부분도 이후 재사용이나 재방문 판단에 영향을 줬다. 이런 균형이 있어야 비슷한 상황의 독자가 자기 조건과 비교하기 쉽다.`
  ];
  return templates[index % templates.length];
};

const buildGroundedFactExpansionParagraph = ({ primaryEntity = "", mainKeyword = "", fact = {}, index = 0, detailed = false } = {}) => {
  const factText = String(fact?.value || "").trim();
  if (!factText) return "";
  const entity = primaryEntity || mainKeyword || "이번 주제";
  if (!detailed) {
    return `${entity}를 볼 때 "${factText}"라는 점은 실제 판단 기준 안에서 함께 봐야 했다. 그래서 이 부분은 새 경험을 만들지 않고, 입력된 fact가 어떤 상황에서 의미가 있었는지 중심으로 정리했다.`;
  }
  const templates = [
    `${entity}에서 먼저 남는 기준은 "${factText}"였다. 이 fact는 단순한 분위기 설명이 아니라 사용하거나 방문한 흐름을 판단하는 근거라서, 앞뒤 문단과 겹치지 않게 별도 판단 포인트로 정리했다.`,
    `"${factText}"라는 내용은 ${entity}의 만족 요소와 망설임을 함께 보게 만든다. 같은 문장을 반복하기보다 이 fact가 어떤 선택 기준으로 이어지는지, 그리고 다음에 비슷한 조건이면 무엇을 먼저 확인할지까지 연결했다.`,
    `${entity}를 다시 떠올릴 때 "${factText}"는 결론을 보강하는 핵심 근거가 된다. 그래서 추천 문구로 부풀리지 않고, 실제 입력된 경험 안에서 어떤 의미였는지를 짚는 방식으로 남겼다.`,
    `"${factText}"는 ${entity}를 판단할 때 빠지면 글의 균형이 흔들리는 정보다. 좋은 점만 강조하거나 아쉬운 점만 키우지 않고, 해당 상황이 전체 인상에 어떤 영향을 줬는지 중심으로 정리했다.`
  ];
  return templates[index % templates.length];
};

export const getTargetLengthDecision = ({
  requestedTargetCharCount = 0,
  finalCharCount = 0,
  informationSufficiency = "medium"
} = {}) => {
  const target = Number(requestedTargetCharCount) || 0;
  const actual = Number(finalCharCount) || 0;
  const level = typeof informationSufficiency === "string" ? informationSufficiency : informationSufficiency?.level || "";
  const ratio = target > 0 ? actual / target : 1;
  if (level === "low" || target <= 0) {
    return { mode: "honest_draft", ratio: Number(ratio.toFixed(2)), enforceTarget: false };
  }
  if (ratio < 0.8) return { mode: "rewrite_expand", ratio: Number(ratio.toFixed(2)), enforceTarget: true };
  if (ratio < 0.85) return { mode: "targeted_expand", ratio: Number(ratio.toFixed(2)), enforceTarget: true };
  if (ratio > 1.15) return { mode: "compress", ratio: Number(ratio.toFixed(2)), enforceTarget: true };
  if (ratio > 1.1) return { mode: "targeted_compress", ratio: Number(ratio.toFixed(2)), enforceTarget: true };
  return { mode: "within_range", ratio: Number(ratio.toFixed(2)), enforceTarget: true };
};

export const getSectionLengthDiagnostics = ({ sections = [], sectionBudgets = [], body = "" } = {}) => {
  const normalizedSections = normalizeSections(sections);
  const budgets = Array.isArray(sectionBudgets) ? sectionBudgets : [];
  const rows = normalizedSections.map((section, index) => {
    const budget = budgets[index] || {};
    const targetChars = Number(budget.targetChars || budget.targetCharCount || 0) || 0;
    const actualChars = charLength([section.heading, ...(section.paragraphs || [])].filter(Boolean).join("\n\n"));
    return {
      sectionId: budget.sectionId || `s${index + 1}`,
      targetChars,
      actualChars,
      shortageChars: targetChars > 0 ? Math.max(0, Math.ceil(targetChars * 0.85) - actualChars) : 0,
      excessChars: targetChars > 0 ? Math.max(0, actualChars - Math.floor(targetChars * 1.15)) : 0,
      requiredFactIds: budget.requiredFactIds || [],
      optionalFactIds: budget.optionalFactIds || [],
      forbiddenRepeatedFactIds: budget.forbiddenRepeatedFactIds || budget.forbiddenDuplicateFactIds || []
    };
  });
  return {
    sections: rows,
    sectionBudgetTotal: budgets.reduce((total, section) => total + (Number(section?.targetChars || section?.targetCharCount || 0) || 0), 0),
    sectionActualTotal: rows.length > 0
      ? rows.reduce((total, section) => total + (Number(section.actualChars) || 0), 0)
      : charLength(body),
    totalShortageChars: rows.reduce((total, section) => total + (Number(section.shortageChars) || 0), 0),
    totalExcessChars: rows.reduce((total, section) => total + (Number(section.excessChars) || 0), 0)
  };
};

export const getTargetLengthFailureReason = ({
  requestedTargetCharCount = 0,
  effectiveTargetCharCount = 0,
  rawWriterCharCount = 0,
  finalCharCount = 0,
  sectionBudgetTotal = 0,
  sectionActualTotal = 0,
  postProcessingReductionRatio = 0,
  finishReason = "",
  informationSufficiency = "medium",
  revisionCallCount = 0,
  revisionGain = null
} = {}) => {
  const decision = getTargetLengthDecision({
    requestedTargetCharCount,
    finalCharCount,
    informationSufficiency
  });
  if (!decision.enforceTarget) return decision.mode === "honest_draft" ? "information-sufficiency-low" : "";
  if (decision.mode === "within_range") return "";
  if (String(finishReason || "").toLowerCase() === "length") return "output-token-limit";
  if (Number(postProcessingReductionRatio || 0) > 0.1) return "post-processing-over-reduced";
  if (Number(sectionBudgetTotal || 0) > 0 && Number(effectiveTargetCharCount || requestedTargetCharCount || 0) > 0) {
    const target = Number(effectiveTargetCharCount || requestedTargetCharCount || 0);
    if (Number(sectionBudgetTotal) < Math.ceil(target * 0.95)) return "section-budget-too-small";
  }
  const minTarget = Math.ceil(Number(requestedTargetCharCount || 0) * 0.85);
  if (minTarget > 0 && Number(rawWriterCharCount || 0) < minTarget) return "writer-under-generated";
  if (minTarget > 0 && Number(sectionActualTotal || 0) > 0 && Number(sectionActualTotal) < minTarget) {
    return "writer-under-generated";
  }
  if (Number(revisionCallCount || 0) > 0 && Number(revisionGain || 0) <= 0) return "revision-did-not-expand";
  return "unknown";
};

const repairGroundedDraft = ({ body = "", titleCandidates = [], finalTitle = "", pipelineContext = {}, targetCharCount = 0 } = {}) => {
  const primaryEntity = pipelineContext.primaryEntity || pipelineContext.mainKeyword || "";
  const mainKeyword = pipelineContext.mainKeyword || "";
  const requestedTarget = Number(targetCharCount) || Number(pipelineContext.writerPlan?.effectiveTargetCharCount) || 0;
  const informationLevel = pipelineContext.informationSufficiency?.level || "medium";
  const enforceTarget = informationLevel !== "low";
  const minTarget = enforceTarget && requestedTarget > 0 ? Math.ceil(requestedTarget * 0.85) : 0;
  const detailedExpansion = enforceTarget && requestedTarget >= 1800;
  const applied = [];
  let repairedBody = String(body || "").trim();
  let repairedTitle = ensureEntityTitle({ title: finalTitle, primaryEntity, mainKeyword });
  let repairedTitles = ensureEntityTitleCandidates({ candidates: titleCandidates, primaryEntity, mainKeyword });

  if (repairedTitle !== finalTitle) applied.push("primaryEntityTitle");
  if (primaryEntity && repairedTitles.filter((title) => includesCompact(title, primaryEntity)).length >= 4) applied.push("primaryEntityTitleCandidates");

  const beforeOpening = repairedBody;
  repairedBody = ensureOpeningEntity({ body: repairedBody, primaryEntity, mainKeyword });
  if (repairedBody !== beforeOpening) applied.push("primaryEntityOpening");

  const userFacts = (pipelineContext.factMap?.userFacts || []).filter((fact) => Number(fact.confidence || 0) >= 0.85);
  const missingFacts = () =>
    calculateInputFactCoverage({
      factMap: pipelineContext.factMap,
      body: repairedBody
    }).missingFacts || [];

  const paragraphsToAdd = [];
  const seenFactIds = new Set();
  const pushFact = (fact, index, { detailed = detailedExpansion } = {}) => {
    if (!fact?.id || seenFactIds.has(fact.id)) return;
    const paragraph = buildGroundedFactExpansionParagraph({ primaryEntity, mainKeyword, fact, index, detailed });
    const currentBody = [repairedBody, ...paragraphsToAdd].filter(Boolean).join("\n\n");
    const projectedBody = [currentBody, paragraph].filter(Boolean).join("\n\n");
    const maxTarget = requestedTarget > 0 ? Math.floor(requestedTarget * 1.1) : Infinity;
    if (minTarget > 0 && charLength(currentBody) >= minTarget && charLength(projectedBody) > maxTarget) return;
    seenFactIds.add(fact.id);
    if (paragraph) paragraphsToAdd.push(paragraph);
  };

  missingFacts().forEach((fact, index) => pushFact(fact, index, { detailed: detailedExpansion }));
  if (paragraphsToAdd.length > 0) applied.push("missingFactExpansion");
  let detailedExpansionCount = 0;
  userFacts.forEach((fact, index) => {
    const currentBody = [repairedBody, ...paragraphsToAdd].filter(Boolean).join("\n\n");
    if (minTarget > 0 && charLength(currentBody) < minTarget) {
      const paragraph = buildGroundedFactExpansionParagraph({ primaryEntity, mainKeyword, fact, index, detailed: detailedExpansion });
      const projectedBody = [currentBody, paragraph].filter(Boolean).join("\n\n");
      const maxTarget = requestedTarget > 0 ? Math.floor(requestedTarget * 1.1) : Infinity;
      if (paragraph && charLength(projectedBody) <= maxTarget) {
        paragraphsToAdd.push(paragraph);
        detailedExpansionCount += 1;
      }
    }
  });
  if (detailedExpansionCount > 0) applied.push("targetLengthExpansion");
  if (paragraphsToAdd.length > 0) {
    repairedBody = [repairedBody, ...paragraphsToAdd].filter(Boolean).join("\n\n");
  }

  return {
    body: repairedBody,
    finalTitle: repairedTitle,
    titleCandidates: repairedTitles,
    applied: [...new Set(applied)],
    finalCharCount: charLength(repairedBody),
    targetComplianceRatio: requestedTarget > 0 ? Number((charLength(repairedBody) / requestedTarget).toFixed(2)) : 0,
    targetLengthDecision: getTargetLengthDecision({
      requestedTargetCharCount: requestedTarget,
      finalCharCount: charLength(repairedBody),
      informationSufficiency: informationLevel
    }),
    inputFactCoverage: calculateInputFactCoverage({
      factMap: pipelineContext.factMap,
      body: repairedBody
    })
  };
};

const removeUnsafeClaimSegments = ({
  body = "",
  finalTitle = "",
  faqItems = [],
  hashtags = [],
  pipelineContext = {},
  targetCharCount = 0
} = {}) => {
  const applied = [];
  const diagnostics = {
    removals: [],
    skippedRemovals: []
  };
  let nextBody = String(body || "").trim();
  let nextFaqItems = Array.isArray(faqItems) ? faqItems : [];
  let nextHashtags = Array.isArray(hashtags) ? hashtags : [];
  const minTarget = Number(targetCharCount) >= 1800 ? Math.ceil(Number(targetCharCount) * 0.85) : 0;
  const originalBodyLength = charLength(nextBody);

  const deduped = dedupeBodyParagraphs(nextBody);
  if (deduped.removedCount > 0) {
    const beforeLength = charLength(nextBody);
    nextBody = deduped.body;
    const afterLength = charLength(nextBody);
    applied.push("duplicateParagraphRemoval");
    diagnostics.removals.push({
      reason: "duplicateParagraphRemoval",
      removedCount: deduped.removedCount,
      removedCharCount: Math.max(0, beforeLength - afterLength),
      reductionRatio: beforeLength > 0 ? Number(((beforeLength - afterLength) / beforeLength).toFixed(3)) : 0
    });
  }

  const getSummary = () =>
    summarizeClaimLedger(createClaimLedger({
      title: finalTitle,
      body: nextBody,
      faq: nextFaqItems,
      hashtags: nextHashtags,
      factMap: pipelineContext.factMap,
      contextFacts: pipelineContext.contextFacts,
      imageAnalysis: pipelineContext.imageAnalysis,
      experienceStatus: pipelineContext.experienceStatus
    }));

  let summary = getSummary();
  if (!summary.hardFail) return { body: nextBody, faqItems: nextFaqItems, hashtags: nextHashtags, applied };

  const hardTexts = summary.hardFailures.map((item) => String(item?.text || "").trim()).filter(Boolean);
  if (hardTexts.length === 0) return { body: nextBody, faqItems: nextFaqItems, hashtags: nextHashtags, applied };

  const hasHardText = (value = "") => {
    const source = String(value || "");
    return hardTexts.some((textValue) => source === textValue || source.includes(textValue));
  };

  nextFaqItems = nextFaqItems.filter((item) => !hasHardText(`${item?.question || ""}\n${item?.answer || ""}`));
  nextHashtags = nextHashtags.filter((tag) => !hasHardText(tag));
  if (nextFaqItems.length !== faqItems.length) applied.push("unsafeFaqRemoval");
  if (nextHashtags.length !== hashtags.length) applied.push("unsafeHashtagRemoval");
  if (nextFaqItems.length !== faqItems.length) {
    diagnostics.removals.push({
      reason: "unsafeFaqRemoval",
      removedCount: faqItems.length - nextFaqItems.length
    });
  }
  if (nextHashtags.length !== hashtags.length) {
    diagnostics.removals.push({
      reason: "unsafeHashtagRemoval",
      removedCount: hashtags.length - nextHashtags.length
    });
  }

  const paragraphs = splitBodyParagraphs(nextBody);
  for (const paragraph of paragraphs) {
    if (!hasHardText(paragraph)) continue;
    const candidateParagraphs = paragraphs.filter((item) => item !== paragraph);
    const candidateBody = joinBodyParagraphs(candidateParagraphs);
    const beforeLength = charLength(nextBody);
    const afterLength = charLength(candidateBody);
    const reductionRatio = beforeLength > 0 ? (beforeLength - afterLength) / beforeLength : 0;
    const coverage = calculateInputFactCoverage({
      factMap: pipelineContext.factMap,
      body: candidateBody
    });
    const lengthOk = minTarget === 0 || charLength(candidateBody) >= minTarget;
    const priorityCoverageOk = Number(coverage.criticalFactCoverage || 0) >= 1 && Number(coverage.highFactCoverage || 0) >= 0.9;
    if (reductionRatio > 0.1) {
      diagnostics.skippedRemovals.push({
        reason: "unsafeClaimParagraphRemoval",
        skippedReason: "largePostProcessingReduction",
        removedCharCount: Math.max(0, beforeLength - afterLength),
        reductionRatio: Number(reductionRatio.toFixed(3))
      });
      continue;
    }
    if (lengthOk && Number(coverage.inputFactCoverage || 0) >= 0.9 && priorityCoverageOk) {
      nextBody = candidateBody;
      applied.push("unsafeClaimParagraphRemoval");
      diagnostics.removals.push({
        reason: "unsafeClaimParagraphRemoval",
        removedCharCount: Math.max(0, beforeLength - afterLength),
        reductionRatio: Number(reductionRatio.toFixed(3))
      });
      break;
    }
  }

  summary = getSummary();
  const finalBodyLength = charLength(nextBody);
  diagnostics.postProcessingReductionRatio =
    originalBodyLength > 0 ? Number(((originalBodyLength - finalBodyLength) / originalBodyLength).toFixed(3)) : 0;
  return {
    body: nextBody,
    faqItems: nextFaqItems,
    hashtags: nextHashtags,
    applied,
    hardFailRemaining: summary.hardFail,
    diagnostics
  };
};

function getWriterMaxTokens({ form = {}, fallbackDraft = {} } = {}) {
  const packageData = fallbackDraft.contentPackage || fallbackDraft || {};
  const informationLevel = packageData.informationSufficiency?.level || packageData.informationSufficiency || "";
  const lowInformationTarget = Number(
    packageData.effectiveTargetCharCount ||
      packageData.targetLengthRange?.target ||
      packageData.targetCharCount ||
      900
  );
  const target = Number(
    informationLevel === "low"
      ? lowInformationTarget
      : form.targetCharCount ||
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

const buildJudgePrecheck = ({ form = {}, draft = {} } = {}) => {
  const packageData = draft.contentPackage || {};
  const body = draft.body || packageData.blogBody || "";
  const factMap = packageData.factMap || createHumanQualityFactMap(form, packageData.imageAnalysis || form.imageAnalysis || form.imageContext || form.images || form.photoMetadata);
  const requestedTargetCharCount = Number(packageData.requestedTargetCharCount || form.targetCharCount || form.targetLength || 0) || 0;
  const actualCharCount = charLength(body);
  const inputFactCoverage = calculateInputFactCoverage({
    factMap,
    body
  });
  const targetComplianceRatio = requestedTargetCharCount > 0 ? Number((actualCharCount / requestedTargetCharCount).toFixed(2)) : 1;
  const claimLedgerSummary = packageData.claimLedgerSummary || draft.claimLedgerSummary || {};

  return {
    requestedTargetCharCount,
    actualCharCount,
    targetComplianceRatio,
    inputFactCoverage: {
      totalHighConfidenceFacts: inputFactCoverage.totalHighConfidenceFacts,
      reflectedFacts: inputFactCoverage.reflectedFacts,
      inputFactCoverage: inputFactCoverage.inputFactCoverage,
      criticalFactCoverage: inputFactCoverage.criticalFactCoverage,
      highFactCoverage: inputFactCoverage.highFactCoverage,
      totalFacts: inputFactCoverage.totalFacts,
      criticalFacts: inputFactCoverage.criticalFacts,
      highFacts: inputFactCoverage.highFacts,
      coveredFactIds: inputFactCoverage.coveredFactIds,
      criticalMissingFactIds: inputFactCoverage.criticalMissingFactIds,
      missingCriticalFactIds: inputFactCoverage.missingCriticalFactIds,
      missingHighFactIds: inputFactCoverage.missingHighFactIds,
      missingFactIds: inputFactCoverage.missingFactIds
    },
    claimLedger: {
      hardFail: Boolean(claimLedgerSummary.hardFail),
      counts: claimLedgerSummary.counts || {},
      hardFailureCount: Array.isArray(claimLedgerSummary.hardFailures) ? claimLedgerSummary.hardFailures.length : 0
    }
  };
};

const buildHumanJudgeMessages = ({ form = {}, draft = {} } = {}) => [
  {
    role: "system",
    content:
      "당신은 한국 네이버 블로그 편집자이자 냉정한 콘텐츠 품질 심사자입니다. 키워드 개수나 형식 충족이 아니라 실제 사람이 읽었을 때의 자연스러움, 구체성, 사실성, 문단 가치, 발행 가능성을 평가하세요. 작성 과정은 출력하지 말고 JSON만 반환하세요."
  },
  {
    role: "system",
    content:
      "Publish readiness requires all of these: primaryEntity in finalTitle/opening/body, inputFactCoverage >= 0.90, target length 85-110% for high/medium inputs, zero unsupported claims, zero category contamination, no meta guidance, no awkward josa, and natural Korean. Missing critical facts, unsupported claims, weak opening entity placement, or target length outside range must be reflected in missingFactIds, criticalMissingFactIds, unsupportedClaims, issues, issueCodes, and revisionInstructions. Judge the reader-facing draft body first; FAQ is optional support and hashtags are metadata, so do not make hashtag count alone a blocking issue unless it introduces unsupported, contaminated, or meta language. Low-information inputs may remain honest_draft instead of forcing length. Use deterministicPrecheck as a consistency check: if it shows coverage >= 0.90, targetComplianceRatio 0.85-1.10, and no claimLedger hard fail, do not assign a score below 95 unless you can name a concrete high or critical reader-facing issue."
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
        criticalMissingFactIds: ["uf3"],
        unsupportedClaims: ["string"],
        categoryContamination: ["string"],
        metaGuidance: ["string"],
        josaErrors: ["string"],
        genericFillerRatio: "number",
        targetComplianceRatio: "number",
        issueCodes: ["TARGET_LENGTH_UNDER_85"],
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
      deterministicPrecheck: buildJudgePrecheck({ form, draft }),
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
        response_format: structuredResponseFormat("blog_judge_result", BLOG_JUDGE_OUTPUT_JSON_SCHEMA)
      }
    });
    recordStageSuccess(llmStages, "judge", {
      status: payload.__openAiMeta?.status || 200,
      attempts: payload.__openAiMeta?.attempts || 1,
      latencyMs: Date.now() - startedAt,
      usage: payload.__openAiMeta?.usage
    });

    const extraction = extractOpenAiText(payload);
    if (extraction.refusal) throw new SafeLlmError("openai-refusal", { status: 200 });
    if (extraction.finishReason === "length") throw new SafeLlmError("openai-output-incomplete", { status: 200 });
    if (!extraction.textExtracted) throw new SafeLlmError("openai-empty-output", { status: 200 });
    const content = extraction.text;
    return parseLlmJsonSafely(content);
  } catch (error) {
    recordStageFailure(llmStages, "judge", error, {
      attempts: error?.attempts || 1,
      latencyMs: Date.now() - startedAt
    });
    throw error;
  }
};

const getParagraphIdsByText = (body = "", matches = []) => {
  const matchSet = new Set((matches || []).map((item) => String(item || "").trim()).filter(Boolean));
  if (matchSet.size === 0) return [];
  return splitBodyParagraphs(body)
    .map((paragraph, index) => ({
      paragraphId: `p${index + 1}`,
      paragraph
    }))
    .filter(({ paragraph }) => [...matchSet].some((item) => paragraph === item || paragraph.includes(item)))
    .map(({ paragraphId }) => paragraphId);
};

const getGenericFillerParagraphIds = (humanQuality = {}, draft = {}) => {
  const ratio = Number(humanQuality.diagnostics?.genericFillerRatio || 0);
  if (ratio < 0.3) return [];
  return splitBodyParagraphs(draft.body || draft.contentPackage?.blogBody || "")
    .map((paragraph, index) => ({ paragraph, paragraphId: `p${index + 1}` }))
    .filter(({ paragraph }) => paragraph.length < 220 || /same|repeat|generic|일반/u.test(paragraph))
    .map(({ paragraphId }) => paragraphId);
};

const getRevisionIssueCodes = (humanQuality = {}) =>
  Array.from(new Set([
    ...(humanQuality.issues || []).map((issue) => issue.code).filter(Boolean),
    ...(humanQuality.caps || []).map((cap) => cap.code).filter(Boolean),
    ...(humanQuality.diagnostics?.issueCodes || []).filter(Boolean)
  ]));

export const getRevisionDecision = ({ humanQuality = {}, draft = {} } = {}) => {
  const score = Number(humanQuality.score) || 0;
  const hardFail = Boolean(humanQuality.hardFail);
  const packageData = draft.contentPackage || {};
  const informationSufficiency = packageData.informationSufficiency?.level || packageData.informationSufficiency || "";
  const requestedTargetCharCount =
    humanQuality.requestedTargetCharCount ||
    packageData.requestedTargetCharCount ||
    packageData.targetLengthRange?.target ||
    packageData.targetCharCount ||
    0;
  const diagnosticRatio = Number(humanQuality.diagnostics?.targetComplianceRatio || 0);
  const finalCharCount =
    diagnosticRatio > 0 && requestedTargetCharCount > 0
      ? Math.round(Number(requestedTargetCharCount) * diagnosticRatio)
      : charLength(draft.body || packageData.blogBody || "");
  const targetLengthDecision = getTargetLengthDecision({
    requestedTargetCharCount,
    finalCharCount,
    informationSufficiency
  });
  const issueCodes = getRevisionIssueCodes(humanQuality);
  const targetOnlyLowInformation =
    informationSufficiency === "low" &&
    issueCodes.length > 0 &&
    issueCodes.every((code) => /^TARGET_LENGTH_/u.test(String(code)));

  if (targetOnlyLowInformation) {
    return { mode: "none", reason: "no_revision_needed", targetLengthDecision };
  }
  if (targetLengthDecision.mode === "rewrite_expand") {
    return { mode: "rebuild", reason: "target_length_under_80", targetLengthDecision };
  }
  if (targetLengthDecision.mode === "targeted_expand") {
    return { mode: "targeted", reason: "target_length_under_85", targetLengthDecision };
  }
  if (targetLengthDecision.mode === "compress") {
    return { mode: "targeted", reason: "target_length_over_115", targetLengthDecision };
  }
  if (targetLengthDecision.mode === "targeted_compress") {
    return { mode: "targeted", reason: "target_length_over_110", targetLengthDecision };
  }
  if (score >= 95 && !hardFail) {
    return { mode: "none", reason: "no_revision_needed", targetLengthDecision };
  }
  if (score >= 90 && score <= 94 && !hardFail) {
    return { mode: "targeted", reason: "score_90_94", targetLengthDecision };
  }
  return { mode: "rebuild", reason: hardFail ? "hard_fail" : "score_below_90", targetLengthDecision };
};

export const getRevisionSignature = ({ humanQuality = {}, draft = {} } = {}) => {
  const body = draft.body || draft.contentPackage?.blogBody || "";
  const issueCodes = getRevisionIssueCodes(humanQuality).sort();
  const unsupportedClaims = humanQuality.diagnostics?.unsupportedClaims || [];
  const targetComplianceRatio = Number(humanQuality.diagnostics?.targetComplianceRatio || 0);
  const targetBucket =
    targetComplianceRatio < 0.8
      ? "under_80"
      : targetComplianceRatio < 0.85
        ? "under_85"
        : targetComplianceRatio > 1.15
          ? "over_115"
          : targetComplianceRatio > 1.1
            ? "over_110"
            : "ok";
  return JSON.stringify({
    issueCodes,
    missingFactIds: humanQuality.diagnostics?.inputFactCoverage?.missingFactIds || [],
    unsupportedClaimHashes: unsupportedClaims.map((item) => simpleHash(String(item || ""))),
    targetBucket,
    primaryEntityPlacement: humanQuality.diagnostics?.entityCoverage || {},
    genericFillerBucket: Number(humanQuality.diagnostics?.genericFillerRatio || 0) >= 0.3 ? "high" : "ok",
    duplicateParagraphIds: getParagraphIdsByText(body, humanQuality.diagnostics?.duplicateParagraphs || []),
    categoryContaminationCount: (humanQuality.diagnostics?.categoryContamination || []).length,
    revisionInstructionCount: (humanQuality.revisionInstructions || []).length
  });
};

export const shouldStopRepeatedRevision = ({ signature = "", noImprovementSignatures = new Set() } = {}) =>
  Boolean(signature && noImprovementSignatures.has(signature));

const buildRevisionMessages = ({ form = {}, draft = {}, humanQuality = {}, revisionDecision = null } = {}) => {
  const body = draft.body || "";
  const targetRatio = Number(humanQuality.diagnostics?.targetComplianceRatio || 0);
  const requestedTarget = humanQuality.requestedTargetCharCount || draft.contentPackage?.requestedTargetCharCount || 0;
  const actualLength = charLength(body);
  const duplicateParagraphIds = getParagraphIdsByText(body, humanQuality.diagnostics?.duplicateParagraphs || []);
  const factCoverage = humanQuality.diagnostics?.inputFactCoverage || {};
  const sectionPlan = draft.contentPackage?.writerPlan?.sections || draft.writerPlan?.sections || [];
  const sectionBudgets = draft.contentPackage?.writerPlan?.sectionBudgets || draft.writerPlan?.sectionBudgets || [];
  const sectionLengthDiagnostics = getSectionLengthDiagnostics({
    sections: draft.sections || draft.contentPackage?.sections || [],
    sectionBudgets,
    body
  });
  const shortageChars = requestedTarget > 0 ? Math.max(0, Math.ceil(requestedTarget * 0.85) - actualLength) : 0;
  const excessChars = requestedTarget > 0 ? Math.max(0, actualLength - Math.floor(requestedTarget * 1.1)) : 0;
  const revisionFocus = {
    currentScore: Number(humanQuality.score) || 0,
    targetScore: 95,
    revisionMode: revisionDecision?.mode || "targeted",
    revisionReason: revisionDecision?.reason || "",
    sectionPlan,
    sectionBudgets,
    sectionLengthDiagnostics: sectionLengthDiagnostics.sections,
    currentDraft: {
      finalTitle: draft.finalTitle || draft.selectedTitle || "",
      titleCandidates: draft.titleCandidates || draft.titles || [],
      body,
      faqItems: getDraftFaqItems(draft),
      hashtags: draft.hashtags || draft.contentPackage?.hashtags || []
    },
    missingFactIds: factCoverage.missingFactIds || [],
    criticalMissingFactIds: factCoverage.criticalMissingFactIds || factCoverage.missingCriticalFactIds || [],
    highMissingFactIds: factCoverage.missingHighFactIds || [],
    missingFacts: factCoverage.missingFacts || [],
    missingFactValues: (factCoverage.missingFacts || []).map((fact) => ({
      id: fact.id,
      priority: fact.priority || "",
      value: fact.value || ""
    })),
    coveredFactIds: factCoverage.coveredFactIds || [],
    inputFactCoverage: {
      totalFacts: factCoverage.totalFacts ?? factCoverage.totalHighConfidenceFacts ?? 0,
      criticalFacts: factCoverage.criticalFacts ?? 0,
      highFacts: factCoverage.highFacts ?? 0,
      inputFactCoverage: factCoverage.inputFactCoverage ?? 0,
      criticalFactCoverage: factCoverage.criticalFactCoverage ?? 0,
      highFactCoverage: factCoverage.highFactCoverage ?? 0
    },
    unsupportedClaims: humanQuality.diagnostics?.unsupportedClaims || [],
    targetLengthDelta: {
      requestedTargetCharCount: requestedTarget,
      actualCharCount: actualLength,
      targetComplianceRatio: targetRatio || null,
      shortageChars,
      excessChars,
      requiredAdditionalCharacterRange: shortageChars > 0 ? [shortageChars, Math.max(shortageChars, Math.floor(requestedTarget * 1.1) - actualLength)] : [0, 0],
      sectionBudgetTotal: sectionLengthDiagnostics.sectionBudgetTotal,
      sectionActualTotal: sectionLengthDiagnostics.sectionActualTotal
    },
    primaryEntityPlacementIssue: humanQuality.diagnostics?.entityCoverage || {},
    genericFillerParagraphIds: getGenericFillerParagraphIds(humanQuality, draft),
    duplicateParagraphIds,
    categoryContamination: humanQuality.diagnostics?.categoryContamination || [],
    allowedClaims: draft.contentPackage?.writerPlan?.factPolicy?.allowedClaims || [],
    forbiddenClaims: draft.contentPackage?.writerPlan?.factPolicy?.forbiddenClaims || [],
    unknownFields: draft.contentPackage?.writerPlan?.factPolicy?.unknownFields || [],
    issueCodes: getRevisionIssueCodes(humanQuality),
    revisionInstructions: humanQuality.revisionInstructions || [],
    outputSchema: {
      titleCandidates: ["string"],
      finalTitle: "string",
      sections: [{ heading: "string|null", paragraphs: ["string"], imageRefs: ["integer"] }],
      faq: [{ question: "string", answer: "string" }],
      hashtags: ["string"]
    }
  };

  return [
  {
    role: "system",
    content:
      "당신은 네이버 블로그 원고를 개선하는 한국어 편집자입니다. 새 경험, 입력하지 않은 동행자·가족·아이, 효과, 가격, 운영 정보를 만들지 말고 Fact Map, 이미지 분석, 현재 원고, qualityIssues, revisionInstructions만 근거로 재작성하세요. 글자수 늘리기, 키워드 횟수 맞추기, FAQ 강제 추가, 같은 문단 반복, 일반론 확대는 금지입니다. JSON만 반환하세요."
  },
  {
    role: "system",
    content:
      "Revision policy: if score is 90-94, repair the failing sections only; if score is below 90 or hardFail is true, rebuild the section plan and rewrite the whole draft. Use sectionLengthDiagnostics to add or remove grounded text in the sections with shortageChars or excessChars. Always fix missingFactIds, unsupportedClaims, primaryEntity placement, target length shortage/excess, generic filler, duplicated paragraphs, and category contamination. Do not invent new experiences. Return only titleCandidates, finalTitle, sections, faq, and hashtags."
  },
  {
    role: "user",
    content: JSON.stringify(revisionFocus)
  }
  ];
};

const requestLlmRevision = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, draft = {}, humanQuality = {}, llmStages = null, revisionAttempt = 1, revisionDecision = null } = {}) => {
  let maxTokens = getWriterMaxTokens({ form, fallbackDraft: draft });
  for (let lengthRetry = 0; lengthRetry < 2; lengthRetry += 1) {
    const startedAt = Date.now();
    try {
      const payload = await fetchOpenAiJson({
        env,
        body: {
          model,
          messages: buildRevisionMessages({ form, draft, humanQuality, revisionDecision }),
          temperature: 0.35,
          max_tokens: maxTokens,
          response_format: structuredResponseFormat("blog_revision_result", BLOG_WRITER_OUTPUT_JSON_SCHEMA)
        }
      });
      const extraction = extractOpenAiText(payload);
      if (extraction.refusal) throw new SafeLlmError("openai-refusal", { status: 200 });
      if (extraction.finishReason === "length" && lengthRetry === 0) {
        maxTokens = Math.min(9000, Math.ceil(maxTokens * 1.5));
        continue;
      }
      if (extraction.finishReason === "length") throw new SafeLlmError("openai-output-incomplete", { status: 200 });
      if (!extraction.textExtracted) throw new SafeLlmError("openai-empty-output", { status: 200 });
      recordStageSuccess(llmStages, "revision", {
        status: payload.__openAiMeta?.status || 200,
        attempts: payload.__openAiMeta?.attempts || 1,
        latencyMs: Date.now() - startedAt,
        revisionAttempt,
        finishReason: extraction.finishReason || null,
        usage: payload.__openAiMeta?.usage
      });
      const content = extraction.text;
      const parsed = parseLlmJsonSafely(content);
      parsed.__openAiMeta = {
        ...(payload.__openAiMeta || {}),
        finishReason: extraction.finishReason || null,
        maxTokens,
        lengthRetry
      };
      return parsed;
    } catch (error) {
      recordStageFailure(llmStages, "revision", error, {
        attempts: error?.attempts || 1,
        latencyMs: Date.now() - startedAt,
        revisionAttempt
      });
      throw error;
    }
  }
  return null;
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
    informationSufficiency: packageData.informationSufficiency?.level || packageData.informationSufficiency || "",
    llmJudge
  });
};

const attachHumanQuality = (draft = {}, humanQuality = null, qualityAttempts = 1) => {
  if (!humanQuality) return draft;
  const resultMode = resolveResultMode(draft, humanQuality);
  const claimLedgerSummary = draft.contentPackage?.claimLedgerSummary || draft.claimLedgerSummary || {};
  const claimCap = claimLedgerSummary.hardFail ? 55 : 100;
  const draftCap = humanQuality.judgeEngine === "llm" ? 100 : draft.contentPackage?.qualityScore ?? draft.qualityScore ?? humanQuality.score;
  const attachedScore = Math.min(humanQuality.score, draftCap, claimCap);
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

const normalizeRevisionStrategy = (mode = "") => {
  if (mode === "targeted") return "partial";
  if (mode === "rebuild") return "rebuild";
  return "none";
};

const buildQualityDiagnostics = ({
  attempts = [],
  revisionCallCount = 0,
  selectedAttempt = 1,
  finalQualityScore = 0,
  revisionClassifications = [],
  revisionDecisions = []
} = {}) => {
  const scores = attempts.map((attempt) => Number(attempt.score) || 0);
  const initialScore = scores[0] ?? 0;
  const revisionGain = Number(finalQualityScore || 0) - initialScore;
  const hasFailedRevision = revisionClassifications.some((item) => item.classification === "FAILED");
  const unnecessaryRevision = revisionCallCount > 0 && initialScore >= 95;
  const revisionEffectiveness =
    hasFailedRevision
      ? "FAILED"
      : unnecessaryRevision
        ? "UNNECESSARY"
        : revisionCallCount === 0
          ? initialScore >= 95
            ? "NOT_NEEDED"
            : "FAILED"
          : revisionGain >= 3
            ? "EFFECTIVE"
            : revisionGain >= 0
              ? "NO_IMPROVEMENT"
              : "DEGRADED";
  const revisionReason =
    hasFailedRevision
      ? "revision-call-failed"
      : unnecessaryRevision
        ? "initial-score-95-plus-revised"
        : revisionCallCount === 0
          ? initialScore >= 95
            ? "initial-publish-ready"
            : "revision-not-run"
          : revisionGain >= 3
            ? "score-gain-3-plus"
            : revisionGain >= 0
              ? "score-gain-below-3"
              : "selected-score-degraded";
  const selectedAttempts = attempts.map((attempt) => ({
    ...attempt,
    selected: Number(attempt.attempt) === Number(selectedAttempt)
  }));
  return {
    initialQualityScore: initialScore,
    qualityAttempts: attempts.length || 0,
    revisionUsed: revisionCallCount > 0,
    revisionCallCount,
    attemptScores: scores,
    attempts: selectedAttempts,
    revisionClassifications,
    revisionDecisions,
    revisionEffectiveness,
    revisionGain,
    revisionReason,
    selectedAttempt,
    finalQualityScore: Number(finalQualityScore) || 0
  };
};

const isBetterQualityAttempt = (candidate = {}, current = {}) => {
  if (Boolean(candidate.hardFail) !== Boolean(current.hardFail)) return !Boolean(candidate.hardFail);
  const candidateHasLlmJudge = candidate.judgeEngine === "llm";
  const currentHasLlmJudge = current.judgeEngine === "llm";
  if (candidateHasLlmJudge !== currentHasLlmJudge) {
    if (candidateHasLlmJudge) return true;
    if (currentHasLlmJudge) return false;
  }
  const candidateScore = Number(candidate.score) || 0;
  const currentScore = Number(current.score) || 0;
  if (candidateScore !== currentScore) return candidateScore > currentScore;
  const candidateTargetDistance = Math.abs((Number(candidate.diagnostics?.targetComplianceRatio) || 0) - 1);
  const currentTargetDistance = Math.abs((Number(current.diagnostics?.targetComplianceRatio) || 0) - 1);
  if (candidateTargetDistance !== currentTargetDistance) return candidateTargetDistance < currentTargetDistance;
  const candidateCoverage = Number(candidate.diagnostics?.inputFactCoverage?.inputFactCoverage) || 0;
  const currentCoverage = Number(current.diagnostics?.inputFactCoverage?.inputFactCoverage) || 0;
  if (candidateCoverage !== currentCoverage) return candidateCoverage > currentCoverage;
  if (Boolean(candidate.publishReady) !== Boolean(current.publishReady)) return Boolean(candidate.publishReady);
  return false;
};

export { isBetterQualityAttempt };

const classifyRevisionAttempt = ({ previousQuality = {}, currentQuality = {}, failed = false } = {}) => {
  if (failed) return "FAILED";
  const scoreGain = (Number(currentQuality.score) || 0) - (Number(previousQuality.score) || 0);
  if (scoreGain < 0) return "DEGRADED";
  if (scoreGain === 0) return "NO_IMPROVEMENT";
  if (isBetterQualityAttempt(currentQuality, previousQuality)) return "EFFECTIVE";
  if (isBetterQualityAttempt(previousQuality, currentQuality)) return "DEGRADED";
  return "NO_IMPROVEMENT";
};

const summarizeQualityAttempt = ({ attempt = 1, quality = {}, strategy = "none" } = {}) => {
  const coverage = quality.diagnostics?.inputFactCoverage || {};
  return {
    attempt,
    strategy,
    score: Number(quality.score) || 0,
    publishReady: Boolean(quality.publishReady),
    hardFail: Boolean(quality.hardFail),
    targetComplianceRatio: Number(quality.diagnostics?.targetComplianceRatio || 0),
    inputFactCoverage: Number(coverage.inputFactCoverage || 0),
    unsupportedClaimCount: (quality.diagnostics?.unsupportedClaims || []).length,
    genericFillerRatio: Number(quality.diagnostics?.genericFillerRatio || 0),
    selected: false
  };
};

const improveDraftWithQualityAttempts = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, fallbackDraft = {}, initialDraft = {}, llmStages = null } = {}) => {
  let attempts = 1;
  let revisionCallCount = 0;
  let selectedAttempt = 1;
  const attemptSummaries = [];
  const revisionClassifications = [];
  const revisionDecisions = [];
  const noImprovementSignatures = new Set();
  let forceRebuildAfterNoImprovement = false;
  let noImprovementCount = 0;
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
  }
  attemptSummaries.push(summarizeQualityAttempt({ attempt: attempts, quality: currentQuality }));
  let bestDraft = attachHumanQuality(currentDraft, currentQuality, attempts);
  let bestQuality = currentQuality;

  while (shouldUseLlmRevision(env) && attempts < 3 && !currentQuality.publishReady) {
    let revisionDecision = getRevisionDecision({ humanQuality: currentQuality, draft: currentDraft });
    const revisionSignature = getRevisionSignature({ humanQuality: currentQuality, draft: currentDraft });
    if (forceRebuildAfterNoImprovement && revisionDecision.mode !== "none") {
      revisionDecision = {
        ...revisionDecision,
        previousMode: revisionDecision.mode,
        previousReason: revisionDecision.reason,
        mode: "rebuild",
        reason: "no_improvement_rebuild"
      };
    }
    const revisionStrategy = normalizeRevisionStrategy(revisionDecision.mode);
    revisionDecisions.push({
      attempt: attempts + 1,
      strategy: revisionStrategy,
      mode: revisionDecision.mode,
      reason: revisionDecision.reason,
      previousMode: revisionDecision.previousMode || "",
      previousReason: revisionDecision.previousReason || "",
      targetLengthMode: revisionDecision.targetLengthDecision?.mode || ""
    });
    if (
      revisionDecision.mode === "none" ||
      (!forceRebuildAfterNoImprovement && shouldStopRepeatedRevision({ signature: revisionSignature, noImprovementSignatures }))
    ) {
      break;
    }
    forceRebuildAfterNoImprovement = false;
    revisionCallCount += 1;
    let revisionDraft = null;
    const previousDraft = currentDraft;
    const previousQuality = currentQuality;
    try {
      revisionDraft = await requestLlmRevision({
        env,
        model,
        form,
        draft: currentDraft,
        humanQuality: currentQuality,
        llmStages,
        revisionAttempt: revisionCallCount,
        revisionDecision
      });
    } catch {
      revisionClassifications.push({ attempt: attempts + 1, strategy: revisionStrategy, classification: "FAILED" });
      break;
    }
    if (!hasUsableLlmDraft(revisionDraft)) {
      revisionClassifications.push({ attempt: attempts + 1, strategy: revisionStrategy, classification: "FAILED" });
      break;
    }
    attempts += 1;
    const candidateDraft = mergeAcceptedLlmDraft({
      form,
      fallbackDraft: previousDraft,
      llmDraft: revisionDraft
    });
    let candidateQuality = null;
    try {
      candidateQuality = await judgeDraft({ env, model, form, draft: candidateDraft, engine: "llm", llmStages });
    } catch {
      candidateQuality = evaluateDraftHumanQuality({
        form,
        draft: candidateDraft,
        engine: "llm"
      });
    }
    currentQuality = candidateQuality;
    attemptSummaries.push(summarizeQualityAttempt({ attempt: attempts, quality: currentQuality, strategy: revisionStrategy }));
    const classification = classifyRevisionAttempt({ previousQuality, currentQuality });
    revisionClassifications.push({ attempt: attempts, strategy: revisionStrategy, classification });
    if (isBetterQualityAttempt(currentQuality, bestQuality)) {
      bestQuality = currentQuality;
      selectedAttempt = attempts;
      bestDraft = attachHumanQuality(candidateDraft, currentQuality, attempts);
    }
    if (classification === "DEGRADED") {
      currentDraft = bestDraft;
      currentQuality = bestQuality;
      noImprovementSignatures.add(revisionSignature);
      break;
    }
    if (classification === "NO_IMPROVEMENT") {
      noImprovementCount += 1;
      noImprovementSignatures.add(revisionSignature);
      currentDraft = bestDraft;
      currentQuality = bestQuality;
      if (noImprovementCount >= 2 || attempts >= 3) break;
      forceRebuildAfterNoImprovement = true;
      continue;
    }
    noImprovementCount = 0;
    currentDraft = candidateDraft;
  }

  return attachQualityDiagnostics(
    attachHumanQuality(bestDraft, bestQuality, attempts),
    buildQualityDiagnostics({
      attempts: attemptSummaries,
      revisionCallCount,
      selectedAttempt,
      finalQualityScore: bestQuality.score,
      revisionClassifications,
      revisionDecisions
    })
  );
};

const mergeAcceptedLlmDraft = ({ form = {}, fallbackDraft = {}, llmDraft = {} } = {}) => {
  const fallbackPackage = fallbackDraft.contentPackage || {};
  let titleCandidates = normalizeList(llmDraft.titleCandidates || llmDraft.titles, fallbackDraft.titleCandidates || fallbackPackage.titleCandidates || []);
  let finalTitle = String(llmDraft.finalTitle || llmDraft.selectedTitle || titleCandidates[0] || fallbackDraft.finalTitle || "").trim();
  const llmSections = normalizeSections(llmDraft.sections);
  const rawLlmBody = getDraftBody(llmDraft);
  let body = rawLlmBody || String(fallbackDraft.body || "").trim();
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
  let hashtags = normalizeList(llmDraft.hashtags, fallbackDraft.hashtags || fallbackPackage.hashtags || []);
  let faqItems = normalizeFaqItems(llmDraft.faqItems || llmDraft.faq, fallbackPackage.faqItems || []);
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
  let postProcessingSteps = getPostProcessingSteps(llmDraft);
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
  const groundedRepair = repairGroundedDraft({
    body,
    titleCandidates,
    finalTitle,
    pipelineContext,
    targetCharCount
  });
  body = groundedRepair.body;
  finalTitle = groundedRepair.finalTitle;
  titleCandidates = groundedRepair.titleCandidates;
  if (groundedRepair.applied.length > 0) {
    postProcessingSteps = [...postProcessingSteps, ...groundedRepair.applied.map((item) => `grounded-${item}`)];
  }
  const safetyRepair = removeUnsafeClaimSegments({
    body,
    finalTitle,
    faqItems,
    hashtags,
    pipelineContext,
    targetCharCount
  });
  body = safetyRepair.body;
  faqItems = safetyRepair.faqItems;
  hashtags = safetyRepair.hashtags;
  if (safetyRepair.applied.length > 0) {
    postProcessingSteps = [...postProcessingSteps, ...safetyRepair.applied.map((item) => `safety-${item}`)];
  }
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
    engine: "llm",
    informationSufficiency: pipelineContext.informationSufficiency?.level || ""
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
      ? Number((Math.max(0, rawWriterCharCount - actualCharCount) / rawWriterCharCount).toFixed(3))
      : 0;
  const sectionLengthDiagnostics = getSectionLengthDiagnostics({
    sections: llmSections,
    sectionBudgets: pipelineContext.writerPlan?.sectionBudgets || [],
    body
  });
  const targetLengthFailureReason = getTargetLengthFailureReason({
    requestedTargetCharCount,
    effectiveTargetCharCount: targetCharCount,
    rawWriterCharCount,
    finalCharCount: actualCharCount,
    sectionBudgetTotal: sectionLengthDiagnostics.sectionBudgetTotal,
    sectionActualTotal: sectionLengthDiagnostics.sectionActualTotal,
    postProcessingReductionRatio,
    finishReason: llmDraft.__openAiMeta?.finishReason || null,
    informationSufficiency: pipelineContext.informationSufficiency?.level || ""
  });
  const targetLengthContract = {
    ...(fallbackPackage.targetLengthContract || {}),
    requestedTargetCharCount,
    effectiveTargetCharCount: targetCharCount,
    rawWriterCharCount,
    actualCharCount,
    finalCharCount: actualCharCount,
    targetComplianceRatio: requestedTargetCharCount > 0 ? Number((actualCharCount / requestedTargetCharCount).toFixed(2)) : 0,
    sectionBudgetTotal: sectionLengthDiagnostics.sectionBudgetTotal,
    sectionActualTotal: sectionLengthDiagnostics.sectionActualTotal,
    sectionLengthDiagnostics: sectionLengthDiagnostics.sections,
    finishReason: llmDraft.__openAiMeta?.finishReason || null,
    postProcessingReductionRatio,
    targetLengthFailureReason,
    postProcessingReductionReason:
      postProcessingReductionRatio > 0.1
        ? [...new Set(postProcessingSteps.filter((step) => /repair|removal|dedupe|safety|grounded|schema/u.test(step)))].join("|") || "post-processing"
        : "",
    targetLengthDecision: getTargetLengthDecision({
      requestedTargetCharCount,
      finalCharCount: actualCharCount,
      informationSufficiency: pipelineContext.informationSufficiency?.level || ""
    }),
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
      schemaRepair: normalizedSchemaRepair,
      groundedRepair: {
        applied: groundedRepair.applied,
        finalCharCount: groundedRepair.finalCharCount,
        targetComplianceRatio: groundedRepair.targetComplianceRatio,
        targetLengthDecision: groundedRepair.targetLengthDecision,
        inputFactCoverage: {
          totalHighConfidenceFacts: groundedRepair.inputFactCoverage.totalHighConfidenceFacts,
          reflectedFacts: groundedRepair.inputFactCoverage.reflectedFacts,
          inputFactCoverage: groundedRepair.inputFactCoverage.inputFactCoverage,
          criticalFactCoverage: groundedRepair.inputFactCoverage.criticalFactCoverage,
          highFactCoverage: groundedRepair.inputFactCoverage.highFactCoverage,
          missingFactIds: groundedRepair.inputFactCoverage.missingFactIds,
          missingCriticalFactIds: groundedRepair.inputFactCoverage.missingCriticalFactIds,
          missingHighFactIds: groundedRepair.inputFactCoverage.missingHighFactIds
        }
      },
      safetyRepair: {
        applied: safetyRepair.applied,
        finalCharCount: charLength(body),
        hardFailRemaining: Boolean(safetyRepair.hardFailRemaining),
        diagnostics: safetyRepair.diagnostics
      },
      targetLength: {
        requestedTargetCharCount,
        effectiveTargetCharCount: targetCharCount,
        rawWriterCharCount,
        finalCharCount: actualCharCount,
        targetComplianceRatio: targetLengthContract.targetComplianceRatio,
        sectionBudgetTotal: sectionLengthDiagnostics.sectionBudgetTotal,
        sectionActualTotal: sectionLengthDiagnostics.sectionActualTotal,
        targetLengthFailureReason,
        postProcessingReductionRatio,
        finishReason: llmDraft.__openAiMeta?.finishReason || null
      },
      responseExtraction: {
        apiEndpoint: llmDraft.__openAiMeta?.apiEndpoint || fallbackPackage.diagnostics?.responseExtraction?.apiEndpoint || getOpenAiApiEndpoint(),
        responseShape: llmDraft.__openAiMeta?.responseShape || fallbackPackage.diagnostics?.responseExtraction?.responseShape || "unknown",
        textExtracted: Boolean(llmDraft.__openAiMeta?.textExtracted ?? fallbackPackage.diagnostics?.responseExtraction?.textExtracted),
        extractedTextLength: llmDraft.__openAiMeta?.extractedTextLength || fallbackPackage.diagnostics?.responseExtraction?.extractedTextLength || 0,
        extractedTextHash: llmDraft.__openAiMeta?.extractedTextHash || fallbackPackage.diagnostics?.responseExtraction?.extractedTextHash || "",
        writerAttempts: llmDraft.__openAiMeta?.writerAttempts || fallbackPackage.diagnostics?.responseExtraction?.writerAttempts || 1,
        schemaFailureCount: llmDraft.__openAiMeta?.schemaFailureCount || fallbackPackage.diagnostics?.responseExtraction?.schemaFailureCount || 0,
        maxTokens: llmDraft.__openAiMeta?.maxTokens || fallbackPackage.diagnostics?.responseExtraction?.maxTokens || null,
        lengthRetry: llmDraft.__openAiMeta?.lengthRetry || fallbackPackage.diagnostics?.responseExtraction?.lengthRetry || 0
      }
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
  const fallbackPackage = decorated.contentPackage || {};
  const fallbackBody = decorated.body || fallbackPackage.blogBody || "";
  const fallbackActualCharCount = charLength(fallbackBody);
  const fallbackRequestedTarget =
    fallbackPackage.requestedTargetCharCount ||
    form.targetCharCount ||
    form.targetLength ||
    fallbackPackage.targetLengthRange?.target ||
    fallbackPackage.targetCharCount ||
    0;
  const fallbackEffectiveTarget =
    fallbackPackage.effectiveTargetCharCount ||
    fallbackPackage.targetLengthRange?.target ||
    fallbackPackage.targetCharCount ||
    fallbackRequestedTarget;
  const fallbackInformationSufficiency =
    fallbackPackage.informationSufficiency?.level ||
    fallbackPackage.informationSufficiency ||
    "medium";
  const fallbackSectionLengthDiagnostics = getSectionLengthDiagnostics({
    sections: fallbackPackage.sections || decorated.sections || [],
    sectionBudgets: fallbackPackage.writerPlan?.sectionBudgets || [],
    body: fallbackBody
  });
  const fallbackTargetLengthFailureReason = getTargetLengthFailureReason({
    requestedTargetCharCount: fallbackRequestedTarget,
    effectiveTargetCharCount: fallbackEffectiveTarget,
    rawWriterCharCount: fallbackActualCharCount,
    finalCharCount: fallbackActualCharCount,
    sectionBudgetTotal: fallbackSectionLengthDiagnostics.sectionBudgetTotal,
    sectionActualTotal: fallbackSectionLengthDiagnostics.sectionActualTotal,
    informationSufficiency: fallbackInformationSufficiency
  });
  const fallbackTargetLengthContract = {
    ...(fallbackPackage.targetLengthContract || {}),
    requestedTargetCharCount: fallbackRequestedTarget,
    effectiveTargetCharCount: fallbackEffectiveTarget,
    rawWriterCharCount: fallbackActualCharCount,
    actualCharCount: fallbackActualCharCount,
    finalCharCount: fallbackActualCharCount,
    targetComplianceRatio: fallbackRequestedTarget > 0 ? Number((fallbackActualCharCount / fallbackRequestedTarget).toFixed(2)) : 0,
    sectionBudgetTotal: fallbackSectionLengthDiagnostics.sectionBudgetTotal,
    sectionActualTotal: fallbackSectionLengthDiagnostics.sectionActualTotal,
    sectionLengthDiagnostics: fallbackSectionLengthDiagnostics.sections,
    finishReason: null,
    postProcessingReductionRatio: 0,
    targetLengthFailureReason: fallbackTargetLengthFailureReason,
    targetLengthDecision: getTargetLengthDecision({
      requestedTargetCharCount: fallbackRequestedTarget,
      finalCharCount: fallbackActualCharCount,
      informationSufficiency: fallbackInformationSufficiency
    }),
    informationSufficiency: fallbackInformationSufficiency,
    resultMode: "fallback_draft"
  };
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
      actualBodyCharCount: fallbackActualCharCount,
      targetCharCount: fallbackEffectiveTarget || null,
      requestedTargetCharCount: fallbackRequestedTarget,
      effectiveTargetCharCount: fallbackEffectiveTarget,
      actualCharCount: fallbackActualCharCount,
      targetComplianceRatio: fallbackTargetLengthContract.targetComplianceRatio,
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
          actualBodyCharCount: fallbackActualCharCount,
          actualCharCount: fallbackActualCharCount,
          targetLengthContract: fallbackTargetLengthContract,
          requestedTargetCharCount: fallbackRequestedTarget,
          effectiveTargetCharCount: fallbackEffectiveTarget,
          targetComplianceRatio: fallbackTargetLengthContract.targetComplianceRatio,
          diagnostics: {
            ...(decorated.contentPackage.diagnostics || {}),
            targetLength: {
              requestedTargetCharCount: fallbackRequestedTarget,
              effectiveTargetCharCount: fallbackEffectiveTarget,
              rawWriterCharCount: fallbackActualCharCount,
              finalCharCount: fallbackActualCharCount,
              targetComplianceRatio: fallbackTargetLengthContract.targetComplianceRatio,
              sectionBudgetTotal: fallbackSectionLengthDiagnostics.sectionBudgetTotal,
              sectionActualTotal: fallbackSectionLengthDiagnostics.sectionActualTotal,
              targetLengthFailureReason: fallbackTargetLengthFailureReason,
              postProcessingReductionRatio: 0,
              finishReason: null
            }
          },
          summary: {
            ...(decorated.contentPackage.summary || {}),
            resultMode: "fallback_draft",
            engine: "fallback",
            bodyLength: decorated.bodyLength || String(decorated.body || "").replace(/\s+/g, "").length,
            actualBodyCharCount: fallbackActualCharCount,
            targetCharCount: fallbackEffectiveTarget || null,
            requestedTargetCharCount: fallbackRequestedTarget,
            effectiveTargetCharCount: fallbackEffectiveTarget,
            actualCharCount: fallbackActualCharCount,
            targetComplianceRatio: fallbackTargetLengthContract.targetComplianceRatio,
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

const hasUsableLlmDraft = (draft = {}) => Boolean(getDraftBody(draft));

const requestLlmWriter = async ({ env = {}, model = DEFAULT_OPENAI_MODEL, form = {}, fallbackDraft = {}, promptPayload = {}, llmStages = null } = {}) => {
  let maxTokens = getWriterMaxTokens({ form, fallbackDraft });
  let lastDraft = null;
  let lastPayload = null;
  let schemaFailureCount = 0;
  const correctionMessage = {
    role: "user",
    content:
      "Return only a JSON object that matches the required schema: titleCandidates with exactly 5 strings, finalTitle, sections, faq, and hashtags. Do not include body, analysis, notes, markdown, or extra fields."
  };

  for (let schemaAttempt = 0; schemaAttempt < 2; schemaAttempt += 1) {
    const messages = schemaAttempt === 0 ? promptPayload.messages : [...promptPayload.messages, correctionMessage];
    for (let lengthRetry = 0; lengthRetry < 2; lengthRetry += 1) {
      const startedAt = Date.now();
      try {
        const payload = await fetchOpenAiJson({
          env,
          body: {
            model,
            messages,
            temperature: 0.45,
            max_tokens: maxTokens,
            response_format: structuredResponseFormat("blog_writer_result", BLOG_WRITER_OUTPUT_JSON_SCHEMA)
          }
        });
        lastPayload = payload;
        const extraction = extractOpenAiText(payload);
        if (extraction.refusal) throw new SafeLlmError("openai-refusal", { status: 200 });
        if (extraction.finishReason === "length" && lengthRetry === 0) {
          maxTokens = Math.min(9000, Math.ceil(maxTokens * 1.5));
          continue;
        }
        if (extraction.finishReason === "length") throw new SafeLlmError("openai-output-incomplete", { status: 200 });
        if (!extraction.textExtracted) throw new SafeLlmError("openai-empty-output", { status: 200 });
        const content = extraction.text;
        const draft = parseLlmJsonSafely(content);
        draft.__openAiMeta = {
          ...(payload.__openAiMeta || {}),
          apiEndpoint: extraction.apiEndpoint,
          responseShape: extraction.responseShape,
          textExtracted: extraction.textExtracted,
          extractedTextLength: extraction.extractedTextLength,
          extractedTextHash: extraction.extractedTextHash,
          schemaFailureCount,
          writerAttempts: schemaAttempt + 1,
          maxTokens,
          lengthRetry
        };
        lastDraft = draft;

        recordStageSuccess(llmStages, "writer", {
          status: payload.__openAiMeta?.status || 200,
          attempts: schemaAttempt + (payload.__openAiMeta?.attempts || 1),
          latencyMs: Date.now() - startedAt,
          finishReason: extraction.finishReason || null,
          usage: payload.__openAiMeta?.usage
        });
        return draft;
      } catch (error) {
        if (error instanceof SafeLlmError && error.reason === "llm-schema-invalid" && schemaAttempt === 0) {
          schemaFailureCount += 1;
          break;
        }
        recordStageFailure(llmStages, "writer", error, {
          attempts: schemaAttempt + (error?.attempts || 1),
          latencyMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  }

  recordStageSuccess(llmStages, "writer", {
    status: lastPayload?.__openAiMeta?.status || 200,
    attempts: lastPayload?.__openAiMeta?.attempts || 1,
    latencyMs: 0,
    finishReason: lastPayload?.__openAiMeta?.finishReason || null,
    usage: lastPayload?.__openAiMeta?.usage
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
