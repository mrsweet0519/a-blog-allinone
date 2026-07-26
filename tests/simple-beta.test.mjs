import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSimpleJudgePrompt,
  buildSimpleWriterPrompt,
  createSimpleBlogResponse,
  getSimpleInformationSufficiency,
  inspectSimpleDraftDeterministically,
  normalizeSimpleBlogInput,
  runSimpleBlogGeneration,
  validateSimpleBlogInput
} from "../shared/simpleBlogEngine.js";
import {
  getSimpleJudgeModel,
  getSimpleWriterModel,
  onRequest,
  runSimpleBlogRequest
} from "../functions/api/generate-blog-simple.js";
import {
  COMMERCIAL_GENERAL_WRITER_PROFILE,
  COMMERCIAL_GENERAL_WRITER_PROFILE_ID,
  COMMERCIAL_GENERAL_WRITER_PROFILE_VERSION
} from "../shared/writerProfiles/commercialGeneral.js";
import {
  fetchBlogDraftWithPolicy,
  resolveBlogGenerationRoute,
  SIMPLE_BLOG_FAILURE_MESSAGE
} from "../frontend/src/lib/blogGenerationRoute.js";

const seed = Date.now().toString(36);
const topic = `검증 주제 ${seed}`;
const keyword = `핵심 키워드 ${seed}`;
const safeDraft = {
  finalTitle: `${keyword} 선택 전에 살펴볼 내용`,
  titleCandidates: [
    `${keyword} 선택 전에 살펴볼 내용`,
    `${topic} 구성과 특징`,
    `${topic} 비교 기준`
  ],
  body: `${keyword}를 찾을 때는 제공된 구성과 용도를 먼저 살펴볼 수 있습니다.\n\n구매 전에는 필요한 조건과 제공 정보를 서로 비교해 보는 편이 좋습니다.`,
  hashtags: [`#${seed}`, "#정보"],
  faq: []
};
const safeJudge = {
  safe: true,
  inventedExperience: [],
  unsupportedClaims: [],
  metaGuidance: [],
  topicContamination: [],
  revisionInstructions: []
};

assert.equal(COMMERCIAL_GENERAL_WRITER_PROFILE.version, COMMERCIAL_GENERAL_WRITER_PROFILE_VERSION);
assert.equal(COMMERCIAL_GENERAL_WRITER_PROFILE_ID, "generic-commercial");
assert.equal(JSON.stringify(COMMERCIAL_GENERAL_WRITER_PROFILE).includes("아는여자"), false);
assert.equal(JSON.stringify(COMMERCIAL_GENERAL_WRITER_PROFILE).includes("워킹맘"), false);

const informationOnlyInput = {
  topic,
  mainKeyword: keyword,
  subKeywords: `선택 기준 ${seed}, 구성 ${seed}`,
  experienceMode: "information_only",
  details:
    "광고주가 제공한 구성과 용도 정보가 있습니다. 구매 전에는 규격과 설치 환경을 확인해야 하며 구성품은 안내된 항목을 기준으로 살펴봅니다.",
  photos: [],
  targetLength: 1500
};
const informationPrompt = buildSimpleWriterPrompt(informationOnlyInput);
const informationPromptText = informationPrompt.messages
  .map((message) =>
    typeof message.content === "string"
      ? message.content
      : message.content.map((item) => item.text || "").join("\n")
  )
  .join("\n");
for (const phrase of ["써보니", "사용해보니", "방문해보니", "재구매하고 싶다", "1인칭 실사용"]) {
  assert.ok(informationPromptText.includes(phrase), `information-only prohibition missing: ${phrase}`);
}
assert.equal(informationPromptText.includes("실제 경험이 있음"), false);

const actualMemo = `직접 입력한 경험 ${seed}: 이틀 동안 지정한 환경에서 확인했고 버튼 위치가 기억에 남았습니다.`;
const actualInput = {
  topic,
  mainKeyword: keyword,
  experienceMode: "actual_experience",
  experienceMemo: actualMemo
};
const actualValidation = validateSimpleBlogInput(actualInput);
assert.equal(actualValidation.ok, true);
const actualPromptText = JSON.stringify(buildSimpleWriterPrompt(actualInput).messages);
assert.ok(actualPromptText.includes(actualMemo));
assert.ok(actualPromptText.includes("경험 메모에 직접 적은 사실만"));
assert.ok(actualPromptText.includes("입력하지 않은 날짜"));

const missingActualMemo = validateSimpleBlogInput({
  topic,
  experienceMode: "actual_experience",
  experienceMemo: ""
});
assert.equal(missingActualMemo.ok, false);
assert.equal(
  missingActualMemo.errors[0].message,
  "직접 경험형 글을 만들려면 실제 사용·방문 내용을 구체적으로 입력해주세요."
);
assert.equal(
  validateSimpleBlogInput({
    topic,
    experienceMode: "actual_experience",
    experienceMemo: "짧음"
  }).ok,
  false
);

const sparseInput = normalizeSimpleBlogInput({
  topic,
  mainKeyword: keyword,
  experienceMode: "information_only",
  targetLength: 2500
});
assert.equal(getSimpleInformationSufficiency(sparseInput), "low");
const sparsePrompt = JSON.stringify(buildSimpleWriterPrompt(sparseInput).messages);
assert.equal(sparsePrompt.includes("700~1000자"), false);
assert.equal(sparsePrompt.includes("목표 분량:"), false);
assert.ok(sparsePrompt.includes("일반론으로 길이를 채우지 마세요"));

assert.ok(informationPromptText.includes("finalTitle과 첫 문장에 mainKeyword 또는 primaryEntity"));
assert.ok(informationPromptText.includes(keyword));
const judgePrompt = JSON.stringify(buildSimpleJudgePrompt({ input: informationOnlyInput, draft: safeDraft }));
assert.ok(judgePrompt.includes(keyword));
assert.equal(judgePrompt.includes("90점"), false);
assert.equal(judgePrompt.includes("95점"), false);

const metaInspection = inspectSimpleDraftDeterministically({
  input: informationOnlyInput,
  draft: {
    ...safeDraft,
    body: `${safeDraft.body}\n\nFact Map과 입력 사실 기준으로 자동 평가를 마쳤습니다.`
  }
});
assert.ok(metaInspection.metaGuidance.length >= 2);
for (const phrase of [
  "claim ledger",
  "unsupported claim",
  "실제 경험이 없으므로",
  "안전한 표현으로 작성하면",
  "위 조건을 반영하면"
]) {
  const inspection = inspectSimpleDraftDeterministically({
    input: informationOnlyInput,
    draft: {
      ...safeDraft,
      body: `${keyword} 정보를 정리합니다. ${phrase}`
    }
  });
  assert.ok(inspection.metaGuidance.length > 0, `meta phrase not detected: ${phrase}`);
}

const unsafeExperienceInspection = inspectSimpleDraftDeterministically({
  input: informationOnlyInput,
  draft: {
    ...safeDraft,
    body: `${keyword}를 직접 사용해보니 만족스러웠다. 재구매하고 싶다.`
  }
});
assert.ok(unsafeExperienceInspection.inventedExperience.length > 0);
assert.ok(unsafeExperienceInspection.unsupportedClaims.length > 0);

const familyInspection = inspectSimpleDraftDeterministically({
  input: informationOnlyInput,
  draft: {
    ...safeDraft,
    titleCandidates: [...safeDraft.titleCandidates, `${keyword} 아이도 좋아했어요`],
    body: `${keyword}를 살펴봤습니다. 가족도 좋아했고 친구와 다녀온 경험이 있습니다.`
  }
});
assert.ok(familyInspection.inventedExperience.length > 0);

const actualBoundaryInspection = inspectSimpleDraftDeterministically({
  input: actualInput,
  draft: {
    ...safeDraft,
    body: `${keyword}를 이틀 동안 확인했습니다. 남편도 좋아했고 지난 주말 다시 방문했습니다.`
  }
});
assert.ok(actualBoundaryInspection.inventedExperience.length > 0);

const keywordContractInspection = inspectSimpleDraftDeterministically({
  input: informationOnlyInput,
  draft: {
    ...safeDraft,
    finalTitle: "선택 전에 살펴볼 내용",
    body: "구성과 용도를 먼저 살펴볼 수 있습니다."
  }
});
assert.deepEqual(keywordContractInspection.keywordContract, [
  "TITLE_KEYWORD_MISSING",
  "FIRST_SENTENCE_KEYWORD_MISSING"
]);

const calls = [];
const successfulResult = await runSimpleBlogGeneration({
  input: informationOnlyInput,
  callWriter: async () => {
    calls.push("writer");
    return safeDraft;
  },
  callJudge: async () => {
    calls.push("judge");
    return safeJudge;
  },
  callRevision: async () => {
    calls.push("revision");
    return safeDraft;
  }
});
assert.deepEqual(calls, ["writer", "judge"]);
for (const key of [
  "engine",
  "writerProfile",
  "experienceMode",
  "resultMode",
  "primaryEntity",
  "mainKeyword",
  "subKeywords",
  "informationSufficiency",
  "titleCandidates",
  "finalTitle",
  "body",
  "faq",
  "hashtags",
  "bodyLength",
  "publishReady",
  "reviewWarnings",
  "safety",
  "llm"
]) {
  assert.equal(Object.hasOwn(successfulResult, key), true, `response field missing: ${key}`);
}
assert.equal(successfulResult.engine, "llm-simple");
assert.equal(successfulResult.writerProfile, "generic-commercial");
assert.equal(successfulResult.experienceMode, "information_only");
assert.equal(successfulResult.resultMode, "full_draft");
assert.equal(successfulResult.publishReady, true);
assert.equal(successfulResult.llm.revisionUsed, false);
assert.deepEqual(successfulResult.safety, {
  falseExperienceCount: 0,
  unsupportedClaimCount: 0,
  metaGuidanceCount: 0,
  topicContaminationCount: 0,
  issueCodes: []
});

const sparseResponse = createSimpleBlogResponse({
  input: sparseInput,
  draft: safeDraft,
  finalIssues: {}
});
assert.equal(sparseResponse.resultMode, "honest_draft");

const revisionCalls = [];
const revisedDraft = {
  ...safeDraft,
  body: `${keyword}의 제공 정보와 구매 전 확인 기준을 정리했습니다.`
};
const revisedResult = await runSimpleBlogGeneration({
  input: informationOnlyInput,
  callWriter: async () => {
    revisionCalls.push("writer");
    return { ...safeDraft, body: `${keyword}를 사용해보니 만족스러웠다.` };
  },
  callJudge: async () => {
    revisionCalls.push("judge");
    return {
      ...safeJudge,
      safe: false,
      inventedExperience: ["사용해보니"],
      unsupportedClaims: ["만족스러웠다"],
      revisionInstructions: ["입력에 없는 경험과 만족도 표현을 제거하세요."]
    };
  },
  callRevision: async () => {
    revisionCalls.push("revision");
    return revisedDraft;
  }
});
assert.deepEqual(revisionCalls, ["writer", "judge", "revision"]);
assert.equal(revisedResult.llm.revisionUsed, true);
assert.equal(revisedResult.publishReady, true);

const unsafeWithoutEvidenceResult = await runSimpleBlogGeneration({
  input: informationOnlyInput,
  callWriter: async () => safeDraft,
  callJudge: async () => ({ ...safeJudge, safe: false }),
  callRevision: async () => safeDraft
});
assert.equal(unsafeWithoutEvidenceResult.publishReady, false);
assert.ok(
  unsafeWithoutEvidenceResult.safety.issueCodes.includes("JUDGE_UNSAFE_WITHOUT_EVIDENCE")
);

const unsafeRevisionResult = await runSimpleBlogGeneration({
  input: informationOnlyInput,
  callWriter: async () => ({
    ...safeDraft,
    body: `${keyword}를 사용해보니 만족스러웠습니다.`
  }),
  callJudge: async () => ({
    ...safeJudge,
    safe: false,
    inventedExperience: ["사용해보니"],
    revisionInstructions: ["입력에 없는 경험을 제거하세요."]
  }),
  callRevision: async () => ({
    ...safeDraft,
    body: `${keyword} 정보를 정리합니다. 아이도 좋아했어요.`
  })
});
assert.equal(unsafeRevisionResult.publishReady, false);
assert.ok(unsafeRevisionResult.safety.falseExperienceCount > 0);

const unresolvedResult = createSimpleBlogResponse({
  input: informationOnlyInput,
  draft: safeDraft,
  finalIssues: {
    inventedExperience: [],
    unsupportedClaims: ["제공되지 않은 효과"],
    metaGuidance: [],
    topicContamination: []
  },
  revisionUsed: true
});
assert.equal(unresolvedResult.publishReady, false);
assert.ok(unresolvedResult.reviewWarnings.some((warning) => warning.includes("확인하기 어려운 주장")));

assert.equal(getSimpleWriterModel({}), "gpt-4.1");
assert.equal(getSimpleWriterModel({ OPENAI_MODEL: "writer-base", OPENAI_MODEL_SIMPLE: "writer-simple" }), "writer-simple");
assert.equal(getSimpleWriterModel({ OPENAI_MODEL_FULL: "writer-full" }), "writer-full");
assert.equal(getSimpleJudgeModel({}), "gpt-4.1-mini");
assert.equal(
  getSimpleJudgeModel({
    OPENAI_MODEL: "writer-base",
    OPENAI_MODEL_SIMPLE: "writer-simple",
    OPENAI_MODEL_JUDGE: "judge-explicit"
  }),
  "judge-explicit"
);

const openAiPayloads = [];
const responseQueue = [safeDraft, safeJudge];
const mockedFetch = async (_url, options) => {
  openAiPayloads.push(JSON.parse(options.body));
  const next = responseQueue.shift();
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(next) } }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
};
const apiResult = await runSimpleBlogRequest({
  payload: informationOnlyInput,
  env: {
    OPENAI_API_KEY: "unit-key-not-real",
    OPENAI_MODEL_SIMPLE: "unit-writer",
    OPENAI_MODEL_JUDGE: "unit-judge"
  },
  fetchImpl: mockedFetch
});
assert.equal(apiResult.engine, "llm-simple");
assert.equal(openAiPayloads.length, 2);
assert.equal(openAiPayloads[0].model, "unit-writer");
assert.equal(openAiPayloads[1].model, "unit-judge");
assert.equal(openAiPayloads[0].response_format.json_schema.name, "simple_blog_writer");
assert.equal(openAiPayloads[1].response_format.json_schema.name, "simple_blog_safety");
assert.equal(JSON.stringify(apiResult).includes("unit-key-not-real"), false);
assert.equal(JSON.stringify(apiResult).includes("messages"), false);

assert.deepEqual(resolveBlogGenerationRoute(""), {
  endpoint: "/api/generate-blog-simple",
  allowLocalFallback: false
});
assert.deepEqual(resolveBlogGenerationRoute("?engine=legacy"), {
  endpoint: "/api/generate-blog",
  allowLocalFallback: true
});
let localFallbackCalls = 0;
await assert.rejects(
  fetchBlogDraftWithPolicy({
    payload: { topic },
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
    legacyFallback: () => {
      localFallbackCalls += 1;
      return { engine: "fallback" };
    }
  })
);
assert.equal(localFallbackCalls, 0);
const legacyFallbackResult = await fetchBlogDraftWithPolicy({
  payload: { topic },
  search: "?engine=legacy",
  fetchImpl: async () => new Response("unavailable", { status: 503 }),
  legacyFallback: () => {
    localFallbackCalls += 1;
    return { engine: "fallback" };
  }
});
assert.equal(localFallbackCalls, 1);
assert.equal(legacyFallbackResult.fallbackUsed, true);
assert.equal(legacyFallbackResult.draft.engine, "fallback");
assert.equal(
  SIMPLE_BLOG_FAILURE_MESSAGE,
  "글 생성에 실패했습니다. 입력한 내용은 유지되어 있습니다. 잠시 후 다시 시도해주세요."
);

const productReviewSource = readFileSync(
  new URL("../frontend/src/pages/ProductReviewMaker.jsx", import.meta.url),
  "utf8"
);
for (const contractText of [
  'experienceMode: "information_only"',
  'value="actual_experience"',
  "제공된 정보만으로 작성",
  "직접 사용·방문 경험을 바탕으로 작성",
  "꼭 반영할 사실이나 내용",
  "직접 사용·방문한 경험",
  "입력 사실과 다른 표현이 없는지 확인이 필요한 초안입니다.",
  "fetchBlogDraftWithPolicy"
]) {
  assert.ok(productReviewSource.includes(contractText), `ProductReview contract missing: ${contractText}`);
}

const optionsResponse = await onRequest({
  request: new Request("https://example.invalid/api/generate-blog-simple", { method: "OPTIONS" }),
  env: {}
});
assert.equal(optionsResponse.status, 204);
const getResponse = await onRequest({
  request: new Request("https://example.invalid/api/generate-blog-simple", { method: "GET" }),
  env: {}
});
assert.equal(getResponse.status, 405);

console.log("simple beta validation passed");
