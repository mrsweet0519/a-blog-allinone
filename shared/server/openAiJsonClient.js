const SAFE_LLM_REASONS = new Set([
  "server-key-missing",
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
  "unknown-llm-error"
]);

export class SafeLlmError extends Error {
  constructor(reason = "unknown-llm-error", { status = null, cause = null } = {}) {
    super(SAFE_LLM_REASONS.has(reason) ? reason : "unknown-llm-error");
    this.name = "SafeLlmError";
    this.reason = SAFE_LLM_REASONS.has(reason) ? reason : "unknown-llm-error";
    this.status = status;
    this.cause = cause;
  }
}

export const createStrictJsonResponseFormat = (name, schema) => ({
  type: "json_schema",
  json_schema: {
    name,
    strict: true,
    schema
  }
});

export const extractOpenAiAssistantText = (payload = {}) => {
  const choice = payload?.choices?.[0] || {};
  const message = choice.message || {};

  if (message.refusal) {
    throw new SafeLlmError("openai-refusal");
  }

  if (choice.finish_reason === "length") {
    throw new SafeLlmError("openai-output-incomplete");
  }

  const content = message.content;
  const text = Array.isArray(content)
    ? content
        .map((item) => (typeof item === "string" ? item : item?.text || item?.content || ""))
        .join("")
        .trim()
    : String(content || "").trim();

  if (!text) {
    throw new SafeLlmError("openai-empty-output");
  }

  return text;
};

const classifyHttpError = (status, payload = {}) => {
  if (status === 401 || status === 403) return "openai-auth-failed";
  if (status === 429) {
    const type = String(payload?.error?.type || payload?.error?.code || "").toLowerCase();
    return /quota|billing|credit/u.test(type) ? "openai-quota-exceeded" : "openai-rate-limited";
  }
  return "openai-http-error";
};

export const requestOpenAiStrictJson = async ({
  apiKey,
  model,
  messages,
  schema,
  schemaName,
  temperature = 0.4,
  maxTokens = 3200,
  timeoutMs = 45_000,
  fetchImpl = globalThis.fetch
} = {}) => {
  if (!String(apiKey || "").trim()) {
    throw new SafeLlmError("server-key-missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: createStrictJsonResponseFormat(schemaName, schema)
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new SafeLlmError("openai-timeout", { cause: error });
      }
      throw new SafeLlmError("unknown-llm-error", { cause: error });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new SafeLlmError("openai-invalid-response", {
        status: response.status,
        cause: error
      });
    }

    if (!response.ok) {
      throw new SafeLlmError(classifyHttpError(response.status, payload), {
        status: response.status
      });
    }

    const text = extractOpenAiAssistantText(payload);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new SafeLlmError("llm-schema-invalid", { cause: error });
    }
  } finally {
    clearTimeout(timeout);
  }
};
