import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBlogWriterPipelineContext,
  normalizeBlogWriterInput,
  parseSubKeywords
} from "../shared/blogWriterPipeline.js";
import { getEntityCoverage } from "../shared/blogWriterEntity.js";
import {
  createProductReviewDraft,
  extractProductInfoFieldsWithMetaFromText
} from "../shared/productReviewGenerator.js";
import { buildBlogWriterPromptPayload } from "../shared/blogWriterPrompt.js";
import { evaluateHumanQuality } from "../shared/blogWriterHumanQuality.js";
import { compareBlogWriterResults } from "../shared/blogWriterComparison.js";
import {
  ANEUNYEOJA_WRITER_PROFILE_ID,
  ANEUNYEOJA_WRITER_PROFILE_VERSION
} from "../shared/writerProfiles/aneunyeoja.js";
import { onRequestPost as generateBlogOnRequestPost } from "../functions/api/generate-blog.js";
import {
  buildDiagnosticPayload,
  DEFAULT_DIAGNOSTIC_TIMEOUT_MS,
  evaluateOverallResult,
  evaluateQualityResult,
  formatDiagnosticAbortError,
  formatDiagnosticSummary,
  parseArgs,
  parseTimeoutMs,
  runDiagnostics,
  summarizeDiagnosticResponse
} from "../scripts/diagnose-blog-preview.mjs";
import {
  createQualityCanaryInputs,
  summarizeQualityCanaryResponse
} from "../scripts/diagnose-blog-quality.mjs";

const ROOT = new URL("../", import.meta.url);

const productionSource = [
  "frontend/src/pages/ProductReviewMaker.jsx",
  "functions/api/generate-blog.js",
  "shared/productReviewGenerator.js",
  "shared/blogWriterCategory.js",
  "shared/blogWriterPipeline.js",
  "shared/blogWriterPrompt.js",
  "shared/blogWriterQuality.js",
  "shared/blogWriterHumanQuality.js",
  "shared/blogWriterTrace.js",
  "shared/blogWriterComparison.js",
  "shared/writerProfiles/aneunyeoja.js"
]
  .map((path) => readFileSync(new URL(path, ROOT), "utf8"))
  .join("\n");

const forbiddenMetaPattern =
  /사용자\s*메모|제공된\s*정보|실제\s*사용\s*메모가\s*없으면|해당\s*(?:제품|서비스|상품|장소|메뉴)|본문에서|글을\s*읽는\s*사람|글을\s*작성할\s*때|확인\s*필요|정보가\s*부족하면|사진은\s*어디|작성\s*가이드|최종\s*검수표/u;
const oldFixturePattern =
  /육짬|갈낙짬뽕|대천리조텔|청화횟집|마데카|강화도맛집|초지대교|에어젤|부천금|세관공매/u;
const hardClaimTypes = new Set(["unsupported", "contradictory", "metaGuidance", "placeholder"]);

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const countOccurrences = (source = "", phrase = "") => {
  if (!phrase) return 0;
  return [...String(source).matchAll(new RegExp(escapeRegExp(phrase), "gu"))].length;
};

const firstParagraph = (body = "") => String(body || "").split(/\n{2,}/u).find(Boolean) || "";

const bodyText = (review) => [
  review.finalTitle,
  ...(review.titleCandidates || []),
  review.body,
  ...(review.faq || []).flatMap((item) => [item.question, item.answer]),
  ...(review.hashtags || [])
].join("\n");

const assertDraftContract = (review, form = {}) => {
  assert.ok(review.generationId);
  assert.equal(review.engine, "fallback");
  assert.equal(review.resultMode, "fallback_draft");
  assert.equal(review.publishReady, false);
  assert.equal(review.judgeEngine, "deterministic");
  assert.ok(review.qualityScore <= 89);
  assert.ok(review.primaryEntity);
  assert.ok(review.mainKeyword);
  assert.ok(Array.isArray(review.subKeywords));
  assert.ok(review.subKeywords.length <= 3);
  assert.ok(review.titleCandidates.length >= 5);
  assert.ok(review.finalTitle.includes(review.primaryEntity));
  assert.ok(review.body.includes(review.primaryEntity));
  assert.ok(!forbiddenMetaPattern.test(bodyText(review)));
  assert.ok(!oldFixturePattern.test(bodyText(review)));
  assert.ok(review.contentPackage?.standardInputSchema);
  assert.equal(review.contentPackage?.writerProfile?.id, ANEUNYEOJA_WRITER_PROFILE_ID);
  assert.equal(review.contentPackage?.writerProfile?.version, ANEUNYEOJA_WRITER_PROFILE_VERSION);
  assert.equal(review.trace?.engine, "fallback");
  assert.equal(review.trace?.judgeEngine, "deterministic");
  assert.equal(review.trace?.writerProfile, ANEUNYEOJA_WRITER_PROFILE_ID);
  assert.equal(review.trace?.promptVersion, ANEUNYEOJA_WRITER_PROFILE_VERSION);
  assert.equal(review.contentPackage?.diagnostics?.rawFinalDiff?.changedCharacterRatio, 0);
  assert.ok(review.contextFacts);
  assert.ok(review.contextFacts.companions);
  assert.ok(review.contextFacts.occasion);
  assert.ok(review.contextFacts.visitPurpose);
  assert.ok(Array.isArray(review.factMap?.contextEvidence));
  assert.ok(Array.isArray(review.claimLedger));
  assert.ok(review.claimLedger.length > 0);
  assert.equal(review.claimLedgerSummary?.hardFail, false, JSON.stringify(review.claimLedgerSummary?.hardFailures || []));
  assert.ok(!review.claimLedger.some((item) => hardClaimTypes.has(item.claimType)));
  assert.ok(Array.isArray(review.writerPlan?.sections));
  assert.ok(review.writerPlan.sections.every((section) => Array.isArray(section.evidenceIds) && Array.isArray(section.imageRefs)));
  assert.ok(review.titleCandidateEvaluations?.every((item) => "categoryFit" in item && "experienceFit" in item));

  const opening = firstParagraph(review.body);
  assert.ok(countOccurrences(opening, review.mainKeyword) <= 2, `${review.mainKeyword}: opening repeats main keyword too much`);
  if (review.subKeywords[0]) {
    assert.ok(countOccurrences(opening, review.subKeywords[0]) <= 1, `${review.subKeywords[0]}: opening repeats sub keyword too much`);
  }

  const coverage = getEntityCoverage({
    primaryEntity: review.primaryEntity,
    title: review.finalTitle,
    titleCandidates: review.titleCandidates,
    body: review.body
  });
  assert.equal(coverage.finalTitle, true, `${form.productName || form.topic}: final title misses entity`);
  assert.equal(coverage.openingParagraph, true, `${form.productName || form.topic}: opening paragraph misses entity`);
  assert.equal(coverage.body, true, `${form.productName || form.topic}: body misses entity`);
};

const createSeededRandom = (seed = 1) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const pick = (random, values) => values[Math.floor(random() * values.length)];

const entityPrefixes = ["라온", "모아", "하늘", "브리즈", "오르", "수아", "노을", "초록", "바른", "해밀"];
const entityNouns = ["커피랩", "물병", "스테이", "키즈룸", "클래스", "내과", "토트백", "펜션", "공방", "설치"];
const categories = [
  ["restaurant", "맛집 방문 후기", "지역 맛집", "점심에 방문함\n가족과 들렀음\n창가 자리가 좋았음"],
  ["cafe", "카페 방문 후기", "동네 카페", "잠깐 쉬러 들렀음\n커피 향이 기억남\n디저트가 궁금했음"],
  ["accommodation", "펜션 숙박 후기", "가족 펜션", "아이와 1박함\n객실 동선이 편했음\n주변 산책이 기억남"],
  ["product", "물병 사용 후기", "물병 추천", "가방에 넣고 사용함\n세척이 궁금했음\n휴대가 편했음"],
  ["beauty", "립밤 사용 후기", "립밤 후기", "가방에 넣고 사용함\n향이 강하지 않았음\n건조할 때 떠올랐음"],
  ["fashion", "토트백 사용 후기", "출근가방", "출근할 때 사용함\n수납이 궁금했음\n무게가 부담스럽지 않았음"],
  ["education", "클래스 수강 후기", "온라인 클래스", "첫 수업을 들었음\n준비 과정이 궁금했음\n초보자도 따라가기 쉬웠음"],
  ["store", "매장 방문 후기", "동네 매장", "필요한 물건을 사러 방문함\n상담이 차분했음\n위치가 궁금했음"],
  ["hospital", "검진 방문 후기", "내과 검진", "검진 때문에 방문함\n대기 공간이 차분했음\n절차가 궁금했음"],
  ["service", "시공 서비스 후기", "블라인드 시공", "이사 후 이용함\n일정 조율이 궁금했음\n설치 후 공간이 정리됐음"],
  ["travel", "호수 산책 후기", "산책 코스", "가족과 다녀왔음\n산책로가 기억남\n주말 동선이 궁금했음"],
  ["kids-place", "키즈카페 방문 후기", "아이랑 키즈카페", "아이와 방문함\n놀이 공간이 기억남\n보호자 대기 공간이 궁금했음"],
  ["experience", "만들기 체험 후기", "체험 후기", "처음 참여함\n재료가 궁금했음\n완성 과정이 기억남"],
  ["information", "등록 방법 알아보기", "등록 방법", "처음 알아보는 중\n준비 서류가 궁금함\n절차를 나눠 보고 싶음"],
  ["comparison", "보조배터리 비교 기준", "보조배터리 비교", "구매 전 비교 중\n용량과 무게가 궁금함\n가방 수납을 보고 싶음"]
];

const makeForm = (index, [category, suffix, mainKeyword, memo], overrides = {}) => {
  const entity = `${entityPrefixes[index % entityPrefixes.length]}${entityNouns[index % entityNouns.length]}${index}`;
  return {
    productName: `${entity} ${suffix}`,
    mainKeyword,
    subKeywords: "대표 특징, 이용 상황, 가격, 초과 키워드",
    experienceMemo: memo,
    category,
    targetCharCount: 3200,
    ...overrides
  };
};

const noisyOcrText = [
  "@.마우스를 올려보세요.",
  "이 02 03",
  "& zg",
  "hy",
  "01",
  "간편한 데일리 보습 루틴",
  "성분: 히알루론산, 세라마이드 함유",
  "용량: 50ml",
  "사용법: 아침 저녁 적당량 사용",
  "가격: 29,000원",
  "주의: 직사광선을 피해서 보관"
].join("\n");
const ocrExtraction = extractProductInfoFieldsWithMetaFromText(noisyOcrText);
assert.ok(!/@\.마우스를|이 02 03|& zg|hy|\n01\n/u.test(`\n${Object.values(ocrExtraction.fields).join("\n")}\n`));
assert.ok(ocrExtraction.fields.features.includes("간편한 데일리 보습 루틴"));
assert.ok(ocrExtraction.fields.ingredients.includes("히알루론산"));
assert.ok(ocrExtraction.fields.capacity.includes("50ml"));
assert.ok(ocrExtraction.fields.usage.includes("아침 저녁"));
assert.ok(ocrExtraction.fields.price.includes("29,000원"));
assert.equal(ocrExtraction.meta.capacity.status, "확인됨");
assert.equal(extractProductInfoFieldsWithMetaFromText("@@ \n 01 \n hy").summary.filledCount, 0);

assert.deepEqual(parseSubKeywords("대표 메뉴, 가족 외식, 대표 메뉴, 주차, 가격", "대표 메뉴"), ["가족 외식", "주차", "가격"]);
assert.ok(productionSource.includes("메인 키워드"));
assert.ok(productionSource.includes("예: 상호명 / 상품명 / 강의명 / 장소명"));
assert.ok(productionSource.includes("예: 지역 키워드, 대표 특징, 이용 상황"));
assert.ok(productionSource.includes("최대 3개까지 쉼표로 나눠 입력하세요."));
assert.ok(!productionSource.includes("예: 지역명 맛집, 대표 메뉴, 가족 외식"));
assert.ok(!oldFixturePattern.test(productionSource));
assert.ok(!/sk-[A-Za-z0-9_-]{20,}/u.test(productionSource));

const pipeline = buildBlogWriterPipelineContext(makeForm(0, categories[0]));
assert.equal(pipeline.writerProfile.id, ANEUNYEOJA_WRITER_PROFILE_ID);
assert.deepEqual(pipeline.pipelineSteps, [
  "Input Normalization",
  "Primary Entity Extraction",
  "Brand/Product/Place Separation",
  "Main/Sub Keyword Parsing",
  "Open-set Category Classification",
  "Search Intent Classification",
  "Experience Status Classification",
  "Context Fact Classification",
  "Information Sufficiency Classification",
  "Fact Map Construction",
  "Image Vision Analysis",
  "Writer Profile Selection",
  "Reader Intent Planning",
  "Dynamic Outline Generation",
  "SEO/GEO Title Candidate Generation",
  "Draft Generation",
  "Deterministic Hard Check",
  "LLM Human Judge",
  "Automatic Revision",
  "Best Candidate Selection"
]);

const promptPayload = buildBlogWriterPromptPayload({
  form: makeForm(1, categories[1])
});
assert.equal(promptPayload.promptVersion, ANEUNYEOJA_WRITER_PROFILE_VERSION);
assert.equal(promptPayload.writerProfile, ANEUNYEOJA_WRITER_PROFILE_ID);
assert.ok(promptPayload.messages[0].content.includes("Canonical Writer Profile"));
assert.ok(promptPayload.messages[0].content.includes("아는여자"));

const comparison = compareBlogWriterResults({
  rawLlmResult: {
    finalTitle: "라온커피랩 라떼가 궁금했던 방문 후기",
    body: "라온커피랩은 라떼가 궁금해서 살펴본 곳이에요.\n\n창가 자리와 메뉴판 사진이 기억에 남았어요.\n\n다시 볼 때도 라떼와 공간 동선을 먼저 보게 될 것 같아요."
  },
  finalDisplayedResult: {
    finalTitle: "라온커피랩 라떼가 궁금했던 방문 후기",
    body: "라온커피랩은 라떼가 궁금해서 살펴본 곳이에요.\n\n창가 자리와 메뉴판 사진이 기억에 남았어요.\n\n다시 볼 때도 라떼와 공간 동선을 먼저 보게 될 것 같아요."
  },
  referenceResult: "라온커피랩은 라떼와 창가 자리 정보가 자연스럽게 이어지는 글이에요.",
  primaryEntity: "라온커피랩",
  factMap: {
    facts: [
      { value: "라온커피랩" },
      { value: "라떼" },
      { value: "창가 자리" }
    ]
  }
});
assert.equal(comparison.diagnosis, "no-obvious-regression");

const broadKeywordForm = {
  productName: "노을정원 샐러드바 방문 후기",
  mainKeyword: "지역 맛집",
  subKeywords: "샐러드, 가족 외식",
  experienceMemo: "점심에 방문함\n창가 자리가 기억남"
};
const broadKeywordReview = createProductReviewDraft(normalizeBlogWriterInput(broadKeywordForm));
assert.equal(broadKeywordReview.primaryEntity, "노을정원 샐러드바");
assert.ok(broadKeywordReview.finalTitle.includes("노을정원 샐러드바"));
assert.ok(broadKeywordReview.body.includes("노을정원 샐러드바"));
assert.ok(!broadKeywordReview.finalTitle.startsWith("지역 맛집"));
assertDraftContract(broadKeywordReview, broadKeywordForm);

const lowInformationReview = createProductReviewDraft({
  productName: "브리즈핏 물병 알아보기",
  mainKeyword: "물병 추천",
  subKeywords: "가방 수납, 세척, 가격",
  experienceMemo: "",
  targetCharCount: 4000
});
assert.equal(lowInformationReview.informationSufficiency.level, "low");
assert.equal(lowInformationReview.faq.length, 0);
assert.ok(lowInformationReview.actualBodyCharCount <= 1100);
assert.ok(!/다녀왔|방문했|써봤|사용해봤|구매했/u.test(lowInformationReview.body));
assert.ok(lowInformationReview.contentPackage.additionalInfoHints.length <= 3);
assertDraftContract(lowInformationReview);

const imageFallbackReview = createProductReviewDraft({
  productName: "하늘숲 펜션 숙박 후기",
  mainKeyword: "가족 펜션",
  subKeywords: "객실, 산책",
  experienceMemo: "아이와 1박함\n객실 동선이 편했음",
  imageContext: [{ index: 1, note: "객실 창가 사진" }],
  imageCount: 1
});
assert.equal(imageFallbackReview.imageAnalysis.mode, "label-only");
assert.ok(imageFallbackReview.body.includes("[사진 삽입:"));
assert.ok(!/맛있|가격이 좋|직원 친절|주차가 편/u.test(imageFallbackReview.body));
assert.ok(imageFallbackReview.claimLedger.some((item) => item.claimType === "visuallySupported"));
assertDraftContract(imageFallbackReview);

const actualReview = createProductReviewDraft({
  productName: "수아 클렌징폼 사용 후기",
  mainKeyword: "클렌징폼 후기",
  experienceMemo: "저녁 세안 때 사용함\n거품이 궁금했음\n욕실에 두고 쓰기 편했음"
});
assert.equal(actualReview.experienceStatus, "used");
assert.ok(/사용|편했/u.test(actualReview.body));
assertDraftContract(actualReview);

const travelOnlyReview = createProductReviewDraft({
  productName: "초록호수 산책 여행 후기",
  mainKeyword: "산책 코스",
  subKeywords: "주말 동선, 전망",
  experienceMemo: "여행 중 들렀음\n산책로가 기억남\n해질녘 풍경이 좋았음",
  category: "travel"
});
assert.equal(travelOnlyReview.contextFacts.occasion.value, "travel");
assert.notEqual(travelOnlyReview.contextFacts.companions.value, "family");
assert.notEqual(travelOnlyReview.contextFacts.companions.value, "children");
assert.ok(!/가족|아이/u.test(travelOnlyReview.body));
assertDraftContract(travelOnlyReview);

const explicitChildContextReview = createProductReviewDraft({
  productName: "하늘놀이터 키즈카페 방문 후기",
  mainKeyword: "아이랑 키즈카페",
  subKeywords: "놀이 공간, 보호자 대기",
  experienceMemo: "아이와 방문함\n놀이 공간이 기억남\n보호자 대기 공간이 궁금했음",
  category: "kids-place"
});
assert.equal(explicitChildContextReview.contextFacts.companions.value, "children");
assert.ok(explicitChildContextReview.contextFacts.companions.evidenceIds.length > 0);
assert.ok(explicitChildContextReview.factMap.contextEvidence.length > 0);
assertDraftContract(explicitChildContextReview);

const random = createSeededRandom(95);
for (let index = 0; index < 300; index += 1) {
  const categoryTuple = pick(random, categories);
  const form = makeForm(index, categoryTuple, {
    subKeywords: `${pick(random, ["가족 외식", "객실", "세척", "위치", "초보자"])}, ${pick(random, ["가격", "산책", "수납", "준비물", "동선"])}`
  });
  const review = createProductReviewDraft(form);
  assertDraftContract(review, form);
  assert.ok(review.subKeywords.length <= 3);
  assert.ok(review.titleCandidates.filter((title) => title.includes(review.primaryEntity)).length >= 4);
  assert.ok(!/서비스 신청|견적|발림감|시공 일정|상담 비용/u.test(review.category === "product" ? review.body : ""));
}

for (let index = 0; index < 150; index += 1) {
  const categoryTuple = categories[index % categories.length];
  const withPhoto = index % 3 === 0;
  const sparse = index % 4 === 0;
  const form = makeForm(index + 300, categoryTuple, {
    experienceMemo: sparse ? "" : categoryTuple[3],
    imageContext: withPhoto ? [{ index: 1, note: `${entityPrefixes[index % entityPrefixes.length]} 사진 메모` }] : [],
    imageCount: withPhoto ? 1 : 0
  });
  const review = createProductReviewDraft(form);
  assertDraftContract(review, form);
  if (sparse) {
    assert.equal(review.informationSufficiency.level, "low");
    assert.ok(review.actualBodyCharCount <= 1100);
  }
  if (withPhoto) {
    assert.ok(["label-only", "vision"].includes(review.imageAnalysis.mode));
  }
}

let previousEntity = "";
for (let index = 0; index < 30; index += 1) {
  const form = makeForm(index + 700, categories[index % categories.length]);
  const review = createProductReviewDraft(form);
  const combined = bodyText(review);
  assertDraftContract(review, form);
  if (previousEntity) {
    assert.ok(!combined.includes(previousEntity));
  }
  previousEntity = review.primaryEntity;
}

const apiResponse = await generateBlogOnRequestPost({
  request: new Request("https://local.test/api/generate-blog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productName: "모아설치 블라인드 시공 후기",
      mainKeyword: "블라인드 시공",
      subKeywords: "일정 조율, 설치",
      experienceMemo: "이사 후 이용함\n일정 조율이 궁금했음"
    })
  }),
  env: {
    BLOG_WRITER_LLM_ENABLED: "0",
    OPENAI_API_KEY: "sk-test-not-returned-to-client"
  }
});
const apiDraft = await apiResponse.json();
assert.equal(apiDraft.resultMode, "fallback_draft");
assert.equal(apiDraft.engine, "fallback");
assert.equal(apiDraft.publishReady, false);
assert.ok(apiDraft.qualityScore <= 89);
assert.equal(apiDraft.trace.engine, "fallback");
assert.equal(apiDraft.contentPackage.trace.visionMode, "none");
assert.equal(apiDraft.contentPackage.diagnostics.rawFinalDiff.rawBodyLength, apiDraft.contentPackage.diagnostics.rawFinalDiff.finalBodyLength);
assert.equal(apiDraft.llm.used, false);
assert.equal(apiDraft.llm.enabled, false);
assert.equal(apiDraft.llm.judgeEnabled, false);
assert.equal(apiDraft.llm.revisionEnabled, false);
assert.equal(apiDraft.llm.visionEnabled, false);
assert.equal(apiDraft.llm.keyPresent, true);
assert.equal(apiDraft.llm.reason, "llm-disabled");
assert.equal(apiDraft.llm.status, null);
assert.ok(!JSON.stringify(apiDraft).includes("sk-test-not-returned-to-client"));
assertDraftContract(apiDraft);

const makeApiRequest = (body = {}) =>
  new Request("https://local.test/api/generate-blog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      productName: "오르기록 도구 정보 점검",
      mainKeyword: "생활 기록 도구",
      subKeywords: "기록 방식, 알림 설정",
      experienceMemo: "처음 알아보는 중\n기록 방식이 궁금함",
      ...body
    })
  });

const callApiWithFetch = async ({ env = {}, fetchImpl = null, body = {} } = {}) => {
  const originalFetch = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    const response = await generateBlogOnRequestPost({
      request: makeApiRequest(body),
      env
    });
    return response.json();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const missingKeyDraft = await callApiWithFetch({
  env: {
    BLOG_WRITER_LLM_ENABLED: "true"
  }
});
assert.equal(missingKeyDraft.engine, "fallback");
assert.equal(missingKeyDraft.llm.keyPresent, false);
assert.equal(missingKeyDraft.llm.reason, "server-key-missing");

const mockSuccessDraft = await callApiWithFetch({
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_JUDGE_ENABLED: "false",
    BLOG_WRITER_LLM_REVISION_ENABLED: "false",
    BLOG_WRITER_VISION_ENABLED: "true",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                finalTitle: "Daily note tool review",
                titleCandidates: ["Daily note tool review", "How the note tool felt"],
                body: Array(18).fill("I checked the note flow, reminder setup, and data organization from a practical user view.").join(" "),
                faqItems: [],
                hashtags: ["#note", "#productivity"]
              })
            }
          }
        ]
      }),
      { status: 200 }
    )
});
assert.equal(mockSuccessDraft.engine, "llm");
assert.equal(mockSuccessDraft.llm.used, true);
assert.equal(mockSuccessDraft.llm.enabled, true);
assert.equal(mockSuccessDraft.llm.judgeEnabled, false);
assert.equal(mockSuccessDraft.llm.revisionEnabled, false);
assert.equal(mockSuccessDraft.llm.visionEnabled, true);
assert.equal(mockSuccessDraft.llm.keyPresent, true);
assert.equal(mockSuccessDraft.llm.model, "gpt-4.1");
assert.equal(mockSuccessDraft.llm.status, null);

const authFailureDraft = await callApiWithFetch({
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    OPENAI_API_KEY: "unit-test-key"
  },
  fetchImpl: async () => new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })
});
assert.equal(authFailureDraft.engine, "fallback");
assert.equal(authFailureDraft.llm.reason, "openai-auth-failed");
assert.equal(authFailureDraft.llm.status, 401);
assert.ok(!JSON.stringify(authFailureDraft).includes("unit-test-key"));

const quotaFailureDraft = await callApiWithFetch({
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    OPENAI_API_KEY: "unit-test-key"
  },
  fetchImpl: async () => new Response(JSON.stringify({ error: { message: "insufficient_quota" } }), { status: 429 })
});
assert.equal(quotaFailureDraft.llm.reason, "openai-quota-exceeded");

const rateFailureDraft = await callApiWithFetch({
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    OPENAI_API_KEY: "unit-test-key"
  },
  fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 })
});
assert.equal(rateFailureDraft.llm.reason, "openai-rate-limited");

const timeoutFailureDraft = await callApiWithFetch({
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    OPENAI_API_KEY: "unit-test-key"
  },
  fetchImpl: async () => {
    throw new DOMException("aborted", "AbortError");
  }
});
assert.equal(timeoutFailureDraft.llm.reason, "openai-timeout");

const invalidSchemaDraft = await callApiWithFetch({
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    OPENAI_API_KEY: "unit-test-key"
  },
  fetchImpl: async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "{not-json" } }]
      }),
      { status: 200 }
    )
});
assert.equal(invalidSchemaDraft.llm.reason, "llm-schema-invalid");

const revisionCanaryInput = createQualityCanaryInputs({ seed: "unitrev" })[0];
const revisionMemoLines = revisionCanaryInput.experienceMemo.split("\n").filter(Boolean);
const makeMockLlmDraft = (attemptLabel = "initial") => ({
  finalTitle: `${revisionCanaryInput.productName} ${revisionCanaryInput.mainKeyword}`,
  titleCandidates: [
    `${revisionCanaryInput.productName} ${revisionCanaryInput.mainKeyword}`,
    `${revisionCanaryInput.productName} 출근 코디 착용감`,
    `${revisionCanaryInput.productName} 실제 사용 후기`,
    `${revisionCanaryInput.productName} 수납과 소매 먼지`,
    `${revisionCanaryInput.productName} 재사용 의사 정리`
  ],
  body: [
    `${revisionCanaryInput.productName}의 ${revisionCanaryInput.mainKeyword}를 실제 착용 흐름으로 정리했다.`,
    ...revisionMemoLines.map((line) => `${line} ${attemptLabel}`),
    `${revisionCanaryInput.productName}은 출근 코디와 착용감 기준으로 다시 사용할 만한지 판단하기 쉬웠다.`
  ].join("\n\n"),
  faqItems: [
    {
      question: "출근용으로 다시 입을 만했나요?",
      answer: "실내 이동이 많은 날에는 다시 입을 의사가 있습니다."
    }
  ],
  hashtags: ["#경량재킷후기", "#출근코디", "#착용감", "#데일리재킷", "#수납"]
});
let revisionFetchCount = 0;
const revisionDraft = await callApiWithFetch({
  body: revisionCanaryInput,
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_JUDGE_ENABLED: "true",
    BLOG_WRITER_LLM_REVISION_ENABLED: "true",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () => {
    revisionFetchCount += 1;
    if ([1, 3, 5].includes(revisionFetchCount)) {
      const attemptLabel = revisionFetchCount === 1 ? "initial" : `revision-${Math.floor(revisionFetchCount / 2)}`;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(makeMockLlmDraft(attemptLabel)) } }]
        }),
        { status: 200 }
      );
    }
    const judgeScore = revisionFetchCount === 2 ? 52 : revisionFetchCount === 4 ? 72 : 88;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: judgeScore,
                publishReady: judgeScore >= 95,
                scores: {
                  titleQuality: 8,
                  openingQuality: 8,
                  factualGrounding: 12,
                  specificity: 12,
                  humanNaturalness: 12,
                  narrativeCoherence: 8,
                  paragraphValue: 8,
                  keywordNaturalness: 4,
                  imageGrounding: 5,
                  readerUtility: 4
                },
                issues: judgeScore < 95 ? [{ code: "UNIT_NEEDS_REVISION", severity: "medium", message: "needs revision" }] : [],
                revisionInstructions: judgeScore < 95 ? ["Reflect the provided facts without inventing a new experience."] : []
              })
            }
          }
        ]
      }),
      { status: 200 }
    );
  }
});
assert.equal(revisionFetchCount, 6);
assert.equal(revisionDraft.llm.reason, null);
assert.ok(!JSON.stringify(revisionDraft).includes("unit-test-key"));
assert.equal(revisionDraft.qualityDiagnostics.revisionUsed, true);
assert.equal(revisionDraft.qualityDiagnostics.revisionCallCount, 2);
assert.equal(revisionDraft.qualityDiagnostics.qualityAttempts, 3);
assert.ok(revisionDraft.qualityDiagnostics.revisionCallCount <= 2);
assert.equal(revisionDraft.qualityDiagnostics.attemptScores.length, 3);
assert.equal(
  revisionDraft.qualityDiagnostics.attemptScores[revisionDraft.qualityDiagnostics.selectedAttempt - 1],
  Math.max(...revisionDraft.qualityDiagnostics.attemptScores)
);

let judgeTimeoutFetchCount = 0;
const judgeTimeoutDraft = await callApiWithFetch({
  body: revisionCanaryInput,
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_JUDGE_ENABLED: "true",
    BLOG_WRITER_LLM_REVISION_ENABLED: "false",
    BLOG_WRITER_LLM_RETRY_BASE_MS: "0",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () => {
    judgeTimeoutFetchCount += 1;
    if (judgeTimeoutFetchCount === 1) {
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(makeMockLlmDraft("judge-timeout")) } }] }), { status: 200 });
    }
    throw new DOMException("aborted", "AbortError");
  }
});
assert.equal(judgeTimeoutDraft.engine, "llm");
assert.equal(judgeTimeoutDraft.judgeEngine, "deterministic");
assert.equal(judgeTimeoutDraft.llmStages.writer.success, true);
assert.equal(judgeTimeoutDraft.llmStages.judge.success, false);
assert.equal(judgeTimeoutDraft.llmStages.judge.reason, "timeout");

let revisionTimeoutFetchCount = 0;
const revisionTimeoutDraft = await callApiWithFetch({
  body: revisionCanaryInput,
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_JUDGE_ENABLED: "true",
    BLOG_WRITER_LLM_REVISION_ENABLED: "true",
    BLOG_WRITER_LLM_RETRY_BASE_MS: "0",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () => {
    revisionTimeoutFetchCount += 1;
    if (revisionTimeoutFetchCount === 1) {
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(makeMockLlmDraft("before-revision")) } }] }), { status: 200 });
    }
    if (revisionTimeoutFetchCount === 2) {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: 80, publishReady: false, scores: {}, issues: [], revisionInstructions: ["expand facts"] }) } }] }), { status: 200 });
    }
    throw new DOMException("aborted", "AbortError");
  }
});
assert.equal(revisionTimeoutDraft.engine, "llm");
assert.equal(revisionTimeoutDraft.llmStages.revisions[0].success, false);
assert.equal(revisionTimeoutDraft.llmStages.revisions[0].reason, "timeout");
assert.ok(revisionTimeoutDraft.body.includes("before-revision"));

const partialSchemaDraft = await callApiWithFetch({
  body: revisionCanaryInput,
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_JUDGE_ENABLED: "false",
    BLOG_WRITER_LLM_RETRY_BASE_MS: "0",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                finalTitle: `${revisionCanaryInput.productName} ${revisionCanaryInput.mainKeyword}`,
                body: makeMockLlmDraft("partial-schema").body
              })
            }
          }
        ]
      }),
      { status: 200 }
    )
});
assert.equal(partialSchemaDraft.engine, "llm");
assert.ok(partialSchemaDraft.body.includes("partial-schema"));
assert.equal(partialSchemaDraft.contentPackage.diagnostics.schemaRepair.schemaRepairUsed, true);
assert.ok(partialSchemaDraft.contentPackage.diagnostics.schemaRepair.repairedFields.includes("titleCandidates"));

let retryFetchCount = 0;
const retrySuccessDraft = await callApiWithFetch({
  body: revisionCanaryInput,
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_JUDGE_ENABLED: "false",
    BLOG_WRITER_LLM_RETRY_BASE_MS: "0",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () => {
    retryFetchCount += 1;
    if (retryFetchCount === 1) {
      return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(makeMockLlmDraft("retry-success")) } }] }), { status: 200 });
  }
});
assert.equal(retryFetchCount, 2);
assert.equal(retrySuccessDraft.engine, "llm");
assert.equal(retrySuccessDraft.llmStages.writer.attempts, 2);

let quotaFetchCount = 0;
const quotaNoRetryDraft = await callApiWithFetch({
  body: revisionCanaryInput,
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_RETRY_BASE_MS: "0",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () => {
    quotaFetchCount += 1;
    return new Response(JSON.stringify({ error: { message: "insufficient_quota" } }), { status: 429 });
  }
});
assert.equal(quotaFetchCount, 1);
assert.equal(quotaNoRetryDraft.engine, "fallback");
assert.equal(quotaNoRetryDraft.llmStages.writer.reason, "quota-exceeded");

let writerFailureFetchCount = 0;
const writerFailureDraft = await callApiWithFetch({
  body: revisionCanaryInput,
  env: {
    BLOG_WRITER_LLM_ENABLED: "true",
    BLOG_WRITER_LLM_RETRY_BASE_MS: "0",
    OPENAI_API_KEY: "unit-test-key",
    OPENAI_MODEL: "gpt-4.1"
  },
  fetchImpl: async () => {
    writerFailureFetchCount += 1;
    throw new DOMException("aborted", "AbortError");
  }
});
assert.equal(writerFailureFetchCount, 3);
assert.equal(writerFailureDraft.engine, "fallback");
assert.equal(writerFailureDraft.llmStages.writer.reason, "timeout");
assert.equal(writerFailureDraft.llmStages.writer.attempts, 3);

const diagnosticPayload = buildDiagnosticPayload();
assert.equal(diagnosticPayload.imageCount, 0);
assert.ok(!JSON.stringify(diagnosticPayload).includes("sk-"));
assert.equal(DEFAULT_DIAGNOSTIC_TIMEOUT_MS, 180000);
assert.deepEqual(parseArgs(["--auto", "--timeout-ms", "180000", "--branch=preview"]), {
  auto: "1",
  "timeout-ms": "180000",
  branch: "preview"
});
assert.equal(parseTimeoutMs("180000"), 180000);
assert.throws(() => parseTimeoutMs("0"), /positive number/u);

const originalDiagnosticFetch = globalThis.fetch;
globalThis.fetch = async (_url, options = {}) =>
  new Promise((_resolve, reject) => {
    options.signal?.addEventListener(
      "abort",
      () => reject(new DOMException("This operation was aborted", "AbortError")),
      { once: true }
    );
  });
try {
  await assert.rejects(
    () => runDiagnostics({ previewUrl: "https://preview.example", timeoutMs: 5 }),
    (error) => {
      assert.equal(error.name, "AbortError");
      assert.equal(error.requestUrl, "https://preview.example/api/generate-blog");
      assert.ok(error.elapsedMs >= 0);
      assert.equal(error.timeoutMs, 5);
      assert.equal(error.abortStage, "request");
      const formatted = formatDiagnosticAbortError(error);
      assert.ok(formatted.includes("requestUrl: https://preview.example/api/generate-blog"));
      assert.ok(formatted.includes("timeoutMs: 5"));
      assert.ok(formatted.includes("abortStage: request"));
      assert.ok(!formatted.includes("Authorization"));
      assert.ok(!formatted.includes("unit-test-key"));
      return true;
    }
  );

  globalThis.fetch = async (_url, options = {}) => ({
    status: 200,
    json: async () =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("This operation was aborted", "AbortError")),
          { once: true }
        );
      })
  });
  await assert.rejects(
    () => runDiagnostics({ previewUrl: "https://preview.example", timeoutMs: 5 }),
    (error) => {
      assert.equal(error.name, "AbortError");
      assert.equal(error.abortStage, "response-json");
      assert.equal(error.timeoutMs, 5);
      return true;
    }
  );
} finally {
  globalThis.fetch = originalDiagnosticFetch;
}

const diagnosticPass = summarizeDiagnosticResponse({
  url: "https://preview.example/api/generate-blog",
  status: 200,
  json: {
    engine: "llm",
    judgeEngine: "llm",
    isMock: false,
    vision: { mode: "none", imageCount: 0, visibleElementsCount: 0 },
    llm: { used: true, keyPresent: true, model: "unit-model", reason: null },
    qualityScore: 96,
    publishReady: true,
    qualityAttempts: 1
  }
});
assert.equal(diagnosticPass.pass, true);
assert.equal(diagnosticPass.connectionResult, "PASS");
assert.equal(diagnosticPass.qualityResult, "NOT_TESTED");
assert.equal(diagnosticPass.overallResult, "PARTIAL");
assert.ok(formatDiagnosticSummary(diagnosticPass).includes("connectionResult: PASS"));
assert.ok(formatDiagnosticSummary(diagnosticPass).includes("qualityResult: NOT_TESTED"));
assert.ok(!formatDiagnosticSummary(diagnosticPass).includes("result: PASS"));

const diagnosticQuality55 = summarizeDiagnosticResponse({
  url: "https://preview.example/api/generate-blog",
  status: 200,
  json: {
    engine: "llm",
    judgeEngine: "llm",
    isMock: false,
    llm: { used: true, keyPresent: true, model: "unit-model", reason: "llm-quality-rejected" },
    resultMode: "honest_draft",
    qualityScore: 55,
    publishReady: false,
    qualityAttempts: 3,
    humanQuality: {
      score: 55,
      llmJudgeScore: 55,
      hardFail: true,
      issues: [{ code: "UNSUPPORTED_CLAIM", severity: "critical", message: "unsupported" }],
      caps: [{ code: "UNSUPPORTED_CLAIM", score: 55 }],
      diagnostics: {
        entityCoverage: { finalTitle: true, openingSentence: true, body: true },
        inputFactCoverage: { inputFactCoverage: 0.4 },
        genericFillerRatio: 0.1,
        categoryContamination: []
      }
    },
    contentPackage: {
      informationSufficiency: { level: "low" },
      diagnostics: { rawFinalDiff: { changedCharacterRatio: 0.2 } },
      qualityDiagnostics: {
        initialQualityScore: 55,
        qualityAttempts: 3,
        revisionUsed: true,
        revisionCallCount: 2,
        attemptScores: [55, 55, 55],
        selectedAttempt: 1,
        finalQualityScore: 55
      }
    }
  }
});
assert.equal(diagnosticQuality55.connectionResult, "PASS");
assert.equal(diagnosticQuality55.qualityResult, "NOT_TESTED");
assert.equal(evaluateQualityResult(diagnosticQuality55, { tested: true }), "FAIL");
assert.equal(evaluateOverallResult({ connectionResult: "PASS", qualityResult: "FAIL" }), "PARTIAL");
assert.equal(evaluateOverallResult({ connectionResult: "PASS", qualityResult: "PASS" }), "PASS");
assert.equal(evaluateOverallResult({ connectionResult: "FAIL", qualityResult: "PASS" }), "FAIL");

const diagnosticFallback = summarizeDiagnosticResponse({
  url: "https://preview.example/api/generate-blog",
  status: 200,
  json: {
    engine: "fallback",
    judgeEngine: "deterministic",
    llm: { used: false, keyPresent: false, model: "unit-model", reason: "server-key-missing", status: 0 }
  }
});
assert.equal(diagnosticFallback.pass, false);
assert.ok(formatDiagnosticSummary(diagnosticFallback).includes("llm.reason: server-key-missing"));
assert.ok(formatDiagnosticSummary(diagnosticFallback).includes("llm.status: none"));

const diagnosticVisionWarning = summarizeDiagnosticResponse({
  url: "https://preview.example/api/generate-blog",
  status: 200,
  imageExpected: true,
  json: {
    engine: "llm",
    judgeEngine: "llm",
    vision: { mode: "label-only", imageCount: 1, visibleElementsCount: 0 },
    llm: { used: true, keyPresent: true, model: "unit-model", reason: null }
  }
});
assert.equal(diagnosticVisionWarning.pass, false);

const qualityCanaryInputs = createQualityCanaryInputs({ seed: "unitquality" });
assert.equal(qualityCanaryInputs.length, 3);
for (const input of qualityCanaryInputs) {
  const context = buildBlogWriterPipelineContext(input);
  assert.equal(context.informationSufficiency.level, "high");
  assert.ok(!productionSource.includes(input.productName));
}

const noImageContext = buildBlogWriterPipelineContext(qualityCanaryInputs[0]);
const noImageBody = [
  `${qualityCanaryInputs[0].productName} ${qualityCanaryInputs[0].mainKeyword}를 직접 사용한 흐름으로 정리했다.`,
  qualityCanaryInputs[0].experienceMemo,
  "출근 코디와 착용감 기준에서는 다시 사용할 의사가 있고, 비 오는 날 장시간 외부 활동보다 실내 이동이 많은 날에 맞았다."
].join("\n\n");
const noImageQuality = evaluateHumanQuality({
  title: `${qualityCanaryInputs[0].productName} ${qualityCanaryInputs[0].mainKeyword}`,
  titleCandidates: [`${qualityCanaryInputs[0].productName} ${qualityCanaryInputs[0].mainKeyword}`],
  body: noImageBody,
  faq: [],
  hashtags: [],
  factMap: noImageContext.factMap,
  imageAnalysis: noImageContext.imageAnalysis,
  category: noImageContext.category,
  visitStatus: noImageContext.experienceStatus,
  mainKeyword: noImageContext.mainKeyword,
  primaryEntity: noImageContext.primaryEntity,
  subKeywords: noImageContext.subKeywords,
  requestedTargetCharCount: 2200,
  effectiveTargetCharCount: 2200,
  engine: "llm",
  llmJudge: {
    score: 96,
    scores: { imageGrounding: 0, readerUtility: 0 },
    issues: [{ code: "NO_IMAGE_OR_VISUAL_REFERENCE", severity: "high", message: "no image" }],
    coveredFactIds: noImageContext.factMap.userFacts.map((fact) => fact.id),
    missingFactIds: []
  }
});
assert.equal(noImageQuality.diagnostics.applicability.imageGrounding, false);
assert.equal(noImageQuality.diagnostics.applicability.faqUtility, false);
assert.ok(!noImageQuality.issues.some((issue) => /NO_IMAGE/u.test(issue.code)));
assert.equal(noImageQuality.diagnostics.inputFactCoverage.inputFactCoverage, 1);

const qualityCanaryPass = summarizeQualityCanaryResponse({
  category: "fashion",
  url: "https://preview.example/api/generate-blog",
  status: 200,
  requestedTargetCharCount: 2200,
  json: {
    engine: "llm",
    judgeEngine: "llm",
    isMock: false,
    llm: { used: true, keyPresent: true, model: "unit-model", reason: null },
    finalTitle: "루미핏 unitquality 데일리 재킷 경량 재킷 후기",
    body: "루미핏 unitquality 데일리 재킷 경량 재킷 후기를 실제 착용 기준으로 정리했다.",
    qualityScore: 96,
    publishReady: true,
    qualityAttempts: 2,
    humanQuality: {
      score: 96,
      llmJudgeScore: 98,
      hardFail: false,
      issues: [],
      caps: [],
      diagnostics: {
        entityCoverage: { finalTitle: true, openingSentence: true, body: true },
        inputFactCoverage: { inputFactCoverage: 0.95 },
        categoryContamination: [],
        genericFillerRatio: 0.05
      }
    },
    contentPackage: {
      resultMode: "publish_ready",
      informationSufficiency: { level: "high" },
      requestedTargetCharCount: 2200,
      actualBodyCharCount: 2100,
      qualityDiagnostics: {
        initialQualityScore: 86,
        qualityAttempts: 2,
        revisionUsed: true,
        revisionCallCount: 1,
        attemptScores: [86, 96],
        selectedAttempt: 2,
        finalQualityScore: 96
      },
      diagnostics: { rawFinalDiff: { changedCharacterRatio: 0.1 } }
    },
    claimLedgerSummary: { hardFail: false, counts: {}, hardFailures: [] }
  }
});
assert.equal(qualityCanaryPass.connectionResult, "PASS");
assert.equal(qualityCanaryPass.qualityResult, "PASS");
assert.equal(qualityCanaryPass.revisionDiagnostics.revisionCallCount, 1);
assert.ok(!JSON.stringify(qualityCanaryPass.metadata).includes("루미핏 unitquality"));

const qualityCanaryFail = summarizeQualityCanaryResponse({
  category: "fashion",
  url: "https://preview.example/api/generate-blog",
  status: 200,
  requestedTargetCharCount: 2200,
  json: {
    engine: "llm",
    judgeEngine: "llm",
    isMock: false,
    llm: { used: true, keyPresent: true, model: "unit-model", reason: null },
    qualityScore: 55,
    publishReady: false,
    humanQuality: {
      score: 55,
      hardFail: true,
      issues: [{ code: "PRIMARY_ENTITY_BODY_MISSING", severity: "critical", message: "missing" }],
      diagnostics: {
        entityCoverage: { finalTitle: true, openingSentence: true, body: false },
        inputFactCoverage: { inputFactCoverage: 0.5 },
        categoryContamination: []
      }
    },
    contentPackage: {
      resultMode: "honest_draft",
      informationSufficiency: { level: "low" }
    }
  }
});
assert.equal(qualityCanaryFail.qualityResult, "FAIL");

console.log("local validation passed");
