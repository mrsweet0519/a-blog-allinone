import {
  SIMPLE_BLOG_SAFETY_SCHEMA,
  SIMPLE_BLOG_WRITER_SCHEMA,
  runSimpleBlogGeneration
} from "../../shared/simpleBlogEngine.js";
import {
  SafeLlmError,
  requestOpenAiStrictJson
} from "../../shared/server/openAiJsonClient.js";

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });

export const getSimpleWriterModel = (env = {}) =>
  env.OPENAI_MODEL_SIMPLE || env.OPENAI_MODEL || env.OPENAI_MODEL_FULL || "gpt-4.1";

export const getSimpleJudgeModel = (env = {}) =>
  env.OPENAI_MODEL_JUDGE || env.OPENAI_MODEL_SIMPLE || env.OPENAI_MODEL || "gpt-4.1-mini";

const safeErrorMessage = (error) => {
  if (error?.code === "SIMPLE_INPUT_INVALID") return error.message;
  if (error instanceof SafeLlmError) {
    const messages = {
      "server-key-missing": "서버의 OpenAI 연결 설정을 확인해 주세요.",
      "openai-auth-failed": "OpenAI 인증 설정을 확인해 주세요.",
      "openai-quota-exceeded": "OpenAI 사용 한도를 확인한 뒤 다시 시도해 주세요.",
      "openai-rate-limited": "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      "openai-timeout": "초안 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
      "openai-refusal": "현재 입력으로 초안을 만들 수 없습니다. 입력 내용을 조정해 주세요.",
      "openai-output-incomplete": "초안 응답이 완전하지 않습니다. 다시 시도해 주세요.",
      "llm-schema-invalid": "초안 응답 형식을 확인할 수 없습니다. 다시 시도해 주세요."
    };
    return messages[error.reason] || "OpenAI 연결 중 문제가 발생했습니다. 다시 시도해 주세요.";
  }
  if (error?.code === "SIMPLE_WRITER_SCHEMA_INVALID" || error?.code === "SIMPLE_JUDGE_SCHEMA_INVALID") {
    return "초안 검토 응답 형식을 확인할 수 없습니다. 다시 시도해 주세요.";
  }
  return "빠른 초안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
};

export const runSimpleBlogRequest = async ({
  payload = {},
  env = {},
  fetchImpl = globalThis.fetch
} = {}) => {
  const apiKey = env.OPENAI_API_KEY;
  const writerModel = getSimpleWriterModel(env);
  const judgeModel = getSimpleJudgeModel(env);
  const requestStrictJson = ({ model, messages, schema, schemaName, temperature, maxTokens }) =>
    requestOpenAiStrictJson({
      apiKey,
      model,
      messages,
      schema,
      schemaName,
      temperature,
      maxTokens,
      timeoutMs: 45_000,
      fetchImpl
    });

  return runSimpleBlogGeneration({
    input: payload,
    callWriter: ({ messages }) =>
      requestStrictJson({
        model: writerModel,
        messages,
        schema: SIMPLE_BLOG_WRITER_SCHEMA,
        schemaName: "simple_blog_writer",
        temperature: 0.45,
        maxTokens: 3600
      }),
    callJudge: ({ messages }) =>
      requestStrictJson({
        model: judgeModel,
        messages,
        schema: SIMPLE_BLOG_SAFETY_SCHEMA,
        schemaName: "simple_blog_safety",
        temperature: 0,
        maxTokens: 1200
      }),
    callRevision: ({ messages }) =>
      requestStrictJson({
        model: writerModel,
        messages,
        schema: SIMPLE_BLOG_WRITER_SCHEMA,
        schemaName: "simple_blog_revision",
        temperature: 0.25,
        maxTokens: 3600
      })
  });
};

export async function onRequestPost(context) {
  let payload = {};
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse(
      {
        ok: false,
        code: "INVALID_JSON",
        message: "요청 형식을 확인해 주세요."
      },
      { status: 400 }
    );
  }

  try {
    const result = await runSimpleBlogRequest({
      payload,
      env: context.env || {},
      fetchImpl: globalThis.fetch
    });
    return jsonResponse(result);
  } catch (error) {
    const status =
      error?.status ||
      (error?.code === "SIMPLE_INPUT_INVALID" ? 400 : error instanceof SafeLlmError ? 503 : 502);
    return jsonResponse(
      {
        ok: false,
        code: error?.code || error?.reason || "SIMPLE_BETA_FAILED",
        message: safeErrorMessage(error),
        errors: error?.code === "SIMPLE_INPUT_INVALID" ? error.details || [] : []
      },
      { status }
    );
  }
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (context.request.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, { status: 405 });
  }
  return onRequestPost(context);
}
