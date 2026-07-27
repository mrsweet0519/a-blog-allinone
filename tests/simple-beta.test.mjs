import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSimpleJudgePrompt,
  buildSimpleRevisionPrompt,
  buildSimpleWriterPrompt,
  createSimpleBlogResponse,
  createSimpleFactSummary,
  deriveSimpleLengthContract,
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
const compactLength = (value = "") => String(value).replace(/\s+/gu, "").length;
const buildGroundedTestBody = (mainKeyword, targetLength) => {
  const paragraphs = [
    `${mainKeyword}를 살펴볼 때는 제공된 구성과 필요한 사용 조건을 먼저 나누어 확인할 수 있습니다.`,
    "구성 정보는 항목별로 구분하고 실제로 필요한 범위와 맞는지 차례대로 대조해 볼 수 있습니다.",
    "사용 환경을 먼저 정리하면 확인할 규격과 배치 조건을 빠뜨리지 않고 살펴보는 데 도움이 됩니다.",
    "선택 전에는 안내된 특징과 주의 사항을 각각 확인하고 서로 다른 조건을 한꺼번에 단정하지 않는 편이 좋습니다.",
    "마지막에는 필요한 구성, 설치 공간, 관리 방법을 체크리스트로 다시 확인할 수 있습니다."
  ];
  const body = [paragraphs[0]];
  let index = 1;
  while (compactLength(body.join("\n\n")) < targetLength) {
    body.push(`${index}번째 확인 항목입니다. ${paragraphs[index % paragraphs.length]}`);
    index += 1;
  }
  return body.join("\n\n");
};
const longSafeDraft = {
  ...safeDraft,
  body: buildGroundedTestBody(keyword, 1400)
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
  details: [
    "구성품은 본체와 안내서로 구분됩니다.",
    "설치 전에 사용할 공간의 폭을 확인해야 합니다.",
    "안내된 규격을 배치 환경과 비교할 수 있습니다.",
    "구성 항목은 제공 목록을 기준으로 확인합니다.",
    "사용 전 관리 방법을 안내서에서 확인합니다.",
    "보관할 공간을 미리 정하는 것이 필요합니다.",
    "필요한 용도와 제공 기능을 항목별로 비교합니다.",
    "주의 사항은 사용 전에 따로 확인합니다."
  ].join("\n"),
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
const sparseWriterPrompt = buildSimpleWriterPrompt(sparseInput);
const sparsePrompt = JSON.stringify(sparseWriterPrompt.messages);
assert.equal(sparsePrompt.includes("700~1000자"), false);
assert.equal(sparseWriterPrompt.lengthContract.requestedTargetLength, 2500);
assert.ok(sparseWriterPrompt.lengthContract.effectiveTargetLength < 2500);
assert.ok(sparsePrompt.includes("요청 분량: 2500자"));
assert.ok(sparsePrompt.includes("적용 목표 분량:"));
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
    return longSafeDraft;
  },
  callJudge: async () => {
    calls.push("judge");
    return safeJudge;
  },
  callRevision: async () => {
    calls.push("revision");
    return longSafeDraft;
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
  "requestedTargetLength",
  "effectiveTargetLength",
  "targetComplianceRatio",
  "targetAdjustmentReason",
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
  ...longSafeDraft
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
  callWriter: async () => longSafeDraft,
  callJudge: async () => ({ ...safeJudge, safe: false }),
  callRevision: async () => longSafeDraft
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
  draft: longSafeDraft,
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

const fanKeyword = "휴대용 미니 선풍기";
const fanInput = {
  topic: fanKeyword,
  mainKeyword: fanKeyword,
  subKeywords: "USB 선풍기, 책상용 선풍기",
  experienceMode: "information_only",
  details: [
    "3단 풍속 조절",
    "USB-C 충전",
    "접이식 거치 가능",
    "실제 사용 경험 없음"
  ].join("\n"),
  targetLength: 1200
};
const fanSummary = createSimpleFactSummary(fanInput);
assert.deepEqual(fanSummary.providedFacts, [
  "3단 풍속 조절",
  "USB-C 충전",
  "접이식 거치 가능"
]);
assert.equal(fanSummary.userFacts.some((fact) => fact.includes("사용 경험 없음")), false);
const fanLengthContract = deriveSimpleLengthContract(fanInput, fanSummary);
assert.equal(fanLengthContract.resultMode, "full_draft");
assert.equal(fanLengthContract.requestedTargetLength, 1200);
assert.equal(fanLengthContract.effectiveTargetLength, 1200);
assert.equal(fanLengthContract.minimumTargetLength, 1020);
assert.equal(fanLengthContract.maximumTargetLength, 1320);

const fanShortDraft = {
  ...safeDraft,
  finalTitle: `${fanKeyword} 선택 전 확인할 점`,
  titleCandidates: [
    `${fanKeyword} 선택 전 확인할 점`,
    `${fanKeyword} 기능별 비교 기준`,
    `${fanKeyword} 사용 환경 체크리스트`
  ],
  body: buildGroundedTestBody(fanKeyword, 313)
};
const fanShortInspection = inspectSimpleDraftDeterministically({
  input: fanInput,
  draft: fanShortDraft
});
assert.deepEqual(fanShortInspection.inventedExperience, []);
assert.ok(fanShortInspection.lengthContract.includes("TARGET_LENGTH_UNDER_85"));

const fanControlDraft = {
  ...fanShortDraft,
  body: `${fanShortDraft.body}\n\n제품 정보만 전달받았으며 직접 사용한 경험은 없습니다.`
};
const fanControlInspection = inspectSimpleDraftDeterministically({
  input: fanInput,
  draft: fanControlDraft
});
assert.ok(fanControlInspection.metaGuidance.length > 0);
const fanResponse = createSimpleBlogResponse({
  input: fanInput,
  draft: fanControlDraft,
  finalIssues: {}
});
assert.equal(fanResponse.publishReady, false);
assert.ok(fanResponse.safety.issueCodes.includes("META_GUIDANCE"));
assert.ok(fanResponse.safety.issueCodes.includes("TARGET_LENGTH_UNDER_85"));

const fanRevisionPrompt = buildSimpleRevisionPrompt({
  input: fanInput,
  draft: fanShortDraft,
  judge: { ...safeJudge, lengthContract: ["TARGET_LENGTH_UNDER_85"] }
});
const fanRevisionPromptText = JSON.stringify(fanRevisionPrompt.messages);
for (const field of [
  "currentBodyLength",
  "effectiveTargetLength",
  "missingCharacterCount",
  "expansionRoles"
]) {
  assert.ok(fanRevisionPromptText.includes(field), `revision length field missing: ${field}`);
}
assert.ok(fanRevisionPromptText.includes("구매·이용 전 비교 기준"));
assert.ok(fanRevisionPromptText.includes("같은 사실이나 문장을 반복하지 말고"));

const fanRevisionCalls = [];
const fanFullDraft = {
  ...fanShortDraft,
  body: buildGroundedTestBody(fanKeyword, 1100)
};
const fanRevisedResult = await runSimpleBlogGeneration({
  input: fanInput,
  callWriter: async () => {
    fanRevisionCalls.push("writer");
    return fanShortDraft;
  },
  callJudge: async () => {
    fanRevisionCalls.push("judge");
    return safeJudge;
  },
  callRevision: async () => {
    fanRevisionCalls.push("revision");
    return fanFullDraft;
  }
});
assert.deepEqual(fanRevisionCalls, ["writer", "judge", "revision"]);
assert.equal(fanRevisedResult.llm.revisionUsed, true);
assert.equal(fanRevisedResult.publishReady, true);

const brushKeyword = "텀블러 세척솔";
const brushInput = {
  topic: brushKeyword,
  mainKeyword: brushKeyword,
  subKeywords: "세척 브러시, 주방용품",
  experienceMode: "actual_experience",
  experienceMemo: [
    "일주일 동안 집에서 매일 사용",
    "손잡이가 길어 600ml 텀블러 바닥까지 닿음",
    "솔이 단단해 물때를 문지르기 편함",
    "입구가 좁은 병에는 넣기 어려움"
  ].join("\n"),
  targetLength: 2500
};
const brushSummary = createSimpleFactSummary(brushInput);
const brushLengthContract = deriveSimpleLengthContract(brushInput, brushSummary);
assert.equal(brushLengthContract.resultMode, "honest_draft");
assert.equal(brushLengthContract.requestedTargetLength, 2500);
assert.ok(brushLengthContract.effectiveTargetLength >= 900);
assert.ok(brushLengthContract.effectiveTargetLength <= 1300);
assert.notEqual(
  brushLengthContract.requestedTargetLength,
  brushLengthContract.effectiveTargetLength
);
assert.ok(brushLengthContract.targetAdjustmentReason);

const brushUnsupportedDraft = {
  ...safeDraft,
  finalTitle: `${brushKeyword} 일주일 사용 기록`,
  titleCandidates: [`${brushKeyword} 일주일 사용 기록`],
  body: [
    buildGroundedTestBody(brushKeyword, 220),
    "특히 편리했습니다.",
    "기본 기능에 충실하다고 느꼈습니다.",
    "한 번쯤 써볼 만한 주방용품 같아요.",
    "세척할 때 힘이 덜 들었어요.",
    "입구가 넓은 텀블러에는 정말 잘 맞았던 것 같습니다."
  ].join("\n")
};
const brushUnsupportedInspection = inspectSimpleDraftDeterministically({
  input: brushInput,
  draft: brushUnsupportedDraft
});
for (const phrase of ["기본 기능에 충실", "한 번쯤 써볼 만", "넓은 텀블러에는 정말 잘 맞"]) {
  assert.ok(
    brushUnsupportedInspection.unsupportedClaims.some((claim) => claim.includes(phrase)),
    `unsupported actual-experience inference missing: ${phrase}`
  );
}
assert.ok(brushUnsupportedInspection.lengthContract.includes("TARGET_LENGTH_UNDER_85"));
const brushResponse = createSimpleBlogResponse({
  input: brushInput,
  draft: brushUnsupportedDraft,
  finalIssues: {}
});
assert.equal(brushResponse.publishReady, false);
assert.equal(brushResponse.resultMode, "honest_draft");
assert.equal(brushResponse.requestedTargetLength, 2500);
assert.equal(brushResponse.effectiveTargetLength, brushLengthContract.effectiveTargetLength);

const brushGroundedInspection = inspectSimpleDraftDeterministically({
  input: brushInput,
  draft: {
    ...safeDraft,
    finalTitle: `${brushKeyword} 실제 사용 기록`,
    titleCandidates: [`${brushKeyword} 실제 사용 기록`],
    body: `${brushKeyword}은 일주일 동안 집에서 매일 사용했습니다. 손잡이가 길어 600ml 텀블러 바닥까지 닿았습니다. 솔이 단단해 물때를 문지를 때 편했습니다. 입구가 좁은 병에는 넣기 어려웠습니다.`
  }
});
assert.deepEqual(brushGroundedInspection.unsupportedClaims, []);

const sufficientLongInput = {
  topic: "충분한 정보 입력",
  mainKeyword: "충분한 정보 입력",
  experienceMode: "information_only",
  details: Array.from(
    { length: 10 },
    (_, index) =>
      `${index + 1}번 고유 사실은 구성과 규격, 사용 환경, 관리 조건을 구체적으로 구분해 확인할 수 있도록 제공됩니다.`
  ).join("\n"),
  targetLength: 2500
};
const sufficientLongContract = deriveSimpleLengthContract(sufficientLongInput);
assert.equal(sufficientLongContract.resultMode, "full_draft");
assert.equal(sufficientLongContract.effectiveTargetLength, 2500);

const sparseLengthContract = deriveSimpleLengthContract(sparseInput);
const sparseCompliantResponse = createSimpleBlogResponse({
  input: sparseInput,
  draft: {
    ...safeDraft,
    body: buildGroundedTestBody(keyword, 650)
  },
  finalIssues: {}
});
assert.equal(sparseCompliantResponse.resultMode, "honest_draft");
assert.equal(sparseCompliantResponse.effectiveTargetLength, sparseLengthContract.effectiveTargetLength);
assert.equal(sparseCompliantResponse.publishReady, true);
assert.ok(sparseCompliantResponse.targetComplianceRatio >= 0.85);
assert.ok(sparseCompliantResponse.targetComplianceRatio <= 1.1);

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
const responseQueue = [longSafeDraft, safeJudge];
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
  "requestedTargetLength",
  "effectiveTargetLength",
  "입력 정보 범위에 맞춰",
  "정직한 초안으로 조정했습니다.",
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
