import {
  COMMERCIAL_GENERAL_WRITER_PROFILE_ID,
  COMMERCIAL_GENERAL_WRITER_PROFILE_VERSION,
  buildCommercialGeneralWriterInstruction
} from "./writerProfiles/commercialGeneral.js";

export const SIMPLE_BLOG_MODE = "simple-beta";
export const SIMPLE_BLOG_EXPERIENCE_MODES = Object.freeze([
  "information_only",
  "actual_experience"
]);
export const SIMPLE_BLOG_EXPERIENCE_STATUSES = SIMPLE_BLOG_EXPERIENCE_MODES;
export const MIN_ACTUAL_EXPERIENCE_LENGTH = 10;

const EXPERIENCE_MODE_ALIASES = Object.freeze({
  information_only: "information_only",
  "information-only": "information_only",
  actual_experience: "actual_experience",
  actual: "actual_experience"
});

const text = (value) => String(value ?? "").replace(/\r\n/gu, "\n").trim();
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
const compactBodyLength = (value) => String(value || "").replace(/\s+/gu, "").length;

const parseKeywords = (value) =>
  unique(
    (Array.isArray(value) ? value : String(value || "").split(/[,#\n]/u))
      .flatMap((item) => String(item).split(","))
      .map((item) => item.replace(/^#+/u, "").trim())
  ).slice(0, 8);

const normalizePhoto = (photo = {}, index = 0) => ({
  id: text(photo.id) || `photo-${index + 1}`,
  name: text(photo.name).slice(0, 120),
  type: text(photo.type).slice(0, 80),
  memo: text(photo.memo || photo.note).slice(0, 500),
  dataUrl:
    /^data:image\/(?:jpeg|png|webp);base64,/u.test(String(photo.dataUrl || "")) &&
    String(photo.dataUrl).length <= 2_500_000
      ? String(photo.dataUrl)
      : ""
});

export const normalizeSimpleBlogInput = (input = {}) => {
  const rawExperienceMode = text(input.experienceMode || input.experienceStatus);
  const experienceMode = rawExperienceMode
    ? EXPERIENCE_MODE_ALIASES[rawExperienceMode] || ""
    : "information_only";
  const topic = text(input.topic || input.productName).slice(0, 240);
  const primaryEntity = text(input.primaryEntity || topic).slice(0, 240);
  const mainKeyword = text(input.mainKeyword || topic).slice(0, 120);
  const providedInfo = text(
    input.providedInfo ||
      (experienceMode === "information_only"
        ? input.details || input.experienceMemo || input.memo
        : input.productInfoText)
  ).slice(0, 6000);
  const experienceMemo =
    experienceMode === "actual_experience"
      ? text(input.experienceMemo || input.details || input.memo).slice(0, 3000)
      : "";
  const details = unique([providedInfo, experienceMemo]).join("\n").slice(0, 6000);
  const targetLength = Math.max(700, Math.min(2500, Number(input.targetLength || input.targetCharCount) || 1200));

  return {
    topic,
    primaryEntity,
    mainKeyword,
    subKeywords: parseKeywords(input.subKeywords),
    experienceMode,
    experienceStatus: experienceMode === "actual_experience" ? "actual" : "information-only",
    experienceMemo,
    providedInfo,
    details,
    photos: (Array.isArray(input.photos) ? input.photos : []).slice(0, 3).map(normalizePhoto),
    tone: text(input.tone) || "친근하고 자연스러운",
    targetLength
  };
};

export const validateSimpleBlogInput = (input = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const errors = [];

  if (!normalized.topic) errors.push({ field: "topic", message: "글 주제를 입력해주세요." });
  if (!normalized.experienceMode) {
    errors.push({ field: "experienceMode", message: "작성 기준을 확인해주세요." });
  }
  if (
    normalized.experienceMode === "actual_experience" &&
    normalized.experienceMemo.replace(/\s+/gu, "").length < MIN_ACTUAL_EXPERIENCE_LENGTH
  ) {
    errors.push({
      field: "experienceMemo",
      message: "직접 경험형 글을 만들려면 실제 사용·방문 내용을 구체적으로 입력해주세요."
    });
  }

  return { ok: errors.length === 0, errors, value: normalized };
};

const splitFacts = (value = "") =>
  unique(
    String(value || "")
      .split(/\n+|(?<=[.!?。])\s+/u)
      .map((item) => item.replace(/^[-*•]\s*/u, "").trim())
      .filter((item) => item.length >= 2)
  ).slice(0, 24);

export const getSimpleInformationSufficiency = (input = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const detailFacts = splitFacts(normalized.details);
  const photoMemoCount = normalized.photos.filter((photo) => photo.memo).length;
  const detailLength = compactBodyLength(normalized.details);

  if (detailLength >= 180 || detailFacts.length >= 5 || (detailLength >= 100 && photoMemoCount >= 2)) {
    return "high";
  }
  if (detailLength >= 50 || detailFacts.length >= 2 || photoMemoCount >= 1) {
    return "medium";
  }
  return "low";
};

export const createSimpleFactSummary = (input = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  return {
    topic: normalized.topic,
    primaryEntity: normalized.primaryEntity,
    mainKeyword: normalized.mainKeyword,
    subKeywords: normalized.subKeywords,
    experienceMode: normalized.experienceMode,
    providedFacts: splitFacts(normalized.providedInfo),
    experienceFacts: splitFacts(normalized.experienceMemo),
    userFacts: splitFacts(normalized.details),
    photoNotes: normalized.photos.map((photo, index) => ({
      photo: index + 1,
      memo: photo.memo
    })).filter((item) => item.memo),
    informationSufficiency: getSimpleInformationSufficiency(normalized)
  };
};

export const SIMPLE_BLOG_WRITER_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    finalTitle: { type: "string" },
    titleCandidates: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string" }
    },
    body: { type: "string" },
    hashtags: {
      type: "array",
      maxItems: 8,
      items: { type: "string" }
    },
    faq: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"]
      }
    }
  },
  required: ["finalTitle", "titleCandidates", "body", "hashtags", "faq"]
});

export const SIMPLE_BLOG_SAFETY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    safe: { type: "boolean" },
    inventedExperience: { type: "array", items: { type: "string" } },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    metaGuidance: { type: "array", items: { type: "string" } },
    topicContamination: { type: "array", items: { type: "string" } },
    revisionInstructions: { type: "array", items: { type: "string" } }
  },
  required: [
    "safe",
    "inventedExperience",
    "unsupportedClaims",
    "metaGuidance",
    "topicContamination",
    "revisionInstructions"
  ]
});

const toJson = (value) => JSON.stringify(value, null, 2);

const informationOnlyRules = [
  "1인칭 실사용·방문 후기처럼 쓰지 마세요.",
  "'써보니', '사용해보니', '며칠 사용해봤는데', '방문해보니', '직접 느껴보니', '지난 주말', '집에서 사용해보니', '효과를 느꼈다', '만족스러웠다', '재구매하고 싶다', '가족도 좋아했다', '아이가 좋아했다', '남편과 방문했다', '친구와 다녀왔다'를 쓰지 마세요.",
  "제품·서비스 정보, 구성과 특징, 구매 전 확인할 점, 비교 기준, 사용 환경별 확인 포인트를 조건형으로 설명하세요."
];

export const buildSimpleWriterPrompt = (input = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const summary = createSimpleFactSummary(normalized);
  const lowInformation = summary.informationSufficiency === "low";
  const experienceRules =
    normalized.experienceMode === "actual_experience"
      ? [
          "1인칭 경험은 사용자가 경험 메모에 직접 적은 사실만 사용할 수 있습니다.",
          "입력하지 않은 날짜, 동행자, 장소, 효과, 만족도, 가격 평가, 배송 상태, 친절도, 재구매 의사를 만들지 마세요."
        ]
      : informationOnlyRules;
  const userText = [
    "[작업]",
    "아래 근거만 사용해 네이버 블로그 초안을 작성하세요.",
    "",
    "[입력]",
    toJson(summary),
    "",
    "[작성 규칙]",
    ...experienceRules.map((rule) => `- ${rule}`),
    `- 말투: ${normalized.tone}`,
    ...(lowInformation
      ? ["- 입력 정보가 적으면 목표 글자 수를 맞추지 말고 확인 가능한 범위에서 짧은 honest_draft로 끝내세요."]
      : [`- 목표 분량: 약 ${normalized.targetLength}자`]),
    "- finalTitle과 첫 문장에 mainKeyword 또는 primaryEntity를 한 번 자연스럽게 넣으세요.",
    "- 한 문단은 2~4문장으로 구성하고 같은 키워드를 기계적으로 반복하지 마세요.",
    "- 입력이 적으면 일반론으로 길이를 채우지 마세요.",
    "- 사진 메모가 없는 사진에서 가격, 효능, 성능, 맛, 친절도, 배송 상태를 추정하지 마세요.",
    "- 내부 작성 과정이나 평가 기준을 본문에 쓰지 마세요.",
    "- FAQ는 입력 사실로 답할 수 있을 때만 최대 2개 작성하세요.",
    "- JSON 객체만 반환하세요."
  ].join("\n");
  const imageParts = normalized.photos
    .filter((photo) => photo.dataUrl)
    .map((photo) => ({
      type: "image_url",
      image_url: { url: photo.dataUrl, detail: "low" }
    }));

  return {
    profileId: COMMERCIAL_GENERAL_WRITER_PROFILE_ID,
    profileVersion: COMMERCIAL_GENERAL_WRITER_PROFILE_VERSION,
    informationSufficiency: summary.informationSufficiency,
    messages: [
      {
        role: "system",
        content: [
          buildCommercialGeneralWriterInstruction(),
          "",
          "반드시 제공된 근거 안에서만 작성하고 지정된 JSON schema만 반환하세요."
        ].join("\n")
      },
      {
        role: "user",
        content:
          imageParts.length > 0
            ? [{ type: "text", text: userText }, ...imageParts]
            : userText
      }
    ]
  };
};

export const buildSimpleJudgePrompt = ({ input = {}, draft = {} } = {}) => {
  const summary = createSimpleFactSummary(input);
  return {
    messages: [
      {
        role: "system",
        content: [
          "당신은 블로그 초안의 최소 안전 경계만 검사합니다.",
          "문체 점수나 품질 점수를 만들지 마세요.",
          "inventedExperience, unsupportedClaims, metaGuidance, topicContamination 네 범주만 검사하세요.",
          "각 배열에는 문제가 되는 짧은 원문 또는 구체적인 이유만 넣고, 문제가 없으면 빈 배열로 두세요.",
          "어느 배열이든 값이 있으면 safe는 false입니다. JSON 객체만 반환하세요."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "[허용 근거]",
          toJson(summary),
          "",
          "[검사할 초안]",
          toJson({
            finalTitle: draft.finalTitle,
            titleCandidates: draft.titleCandidates,
            body: draft.body,
            hashtags: draft.hashtags,
            faq: draft.faq
          })
        ].join("\n")
      }
    ]
  };
};

export const buildSimpleRevisionPrompt = ({ input = {}, draft = {}, judge = {} } = {}) => ({
  messages: [
    {
      role: "system",
      content: [
        buildCommercialGeneralWriterInstruction(),
        "",
        "안전 검사에서 지적된 문장만 근거 안에서 고치세요.",
        "새 경험이나 새 사실을 추가하지 말고 지정된 JSON schema만 반환하세요."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "[허용 근거]",
        toJson(createSimpleFactSummary(input)),
        "",
        "[이전 초안]",
        toJson(draft),
        "",
        "[수정할 문제]",
        toJson({
          inventedExperience: judge.inventedExperience || [],
          unsupportedClaims: judge.unsupportedClaims || [],
          metaGuidance: judge.metaGuidance || [],
          topicContamination: judge.topicContamination || [],
          revisionInstructions: judge.revisionInstructions || []
        }),
        "",
        "문제를 제거한 전체 초안을 JSON으로 다시 반환하세요."
      ].join("\n")
    }
  ]
});

const assertExactKeys = (value, keys) => {
  const valueKeys = Object.keys(value || {}).sort();
  const expected = [...keys].sort();
  return valueKeys.length === expected.length && valueKeys.every((key, index) => key === expected[index]);
};

export const validateSimpleWriterResult = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!assertExactKeys(value, ["finalTitle", "titleCandidates", "body", "hashtags", "faq"])) return false;
  return (
    typeof value.finalTitle === "string" &&
    Array.isArray(value.titleCandidates) &&
    value.titleCandidates.length >= 3 &&
    value.titleCandidates.length <= 5 &&
    value.titleCandidates.every((item) => typeof item === "string") &&
    typeof value.body === "string" &&
    Array.isArray(value.hashtags) &&
    value.hashtags.every((item) => typeof item === "string") &&
    Array.isArray(value.faq) &&
    value.faq.every(
      (item) =>
        item &&
        typeof item === "object" &&
        assertExactKeys(item, ["question", "answer"]) &&
        typeof item.question === "string" &&
        typeof item.answer === "string"
    )
  );
};

export const validateSimpleSafetyResult = (value) => {
  const keys = [
    "safe",
    "inventedExperience",
    "unsupportedClaims",
    "metaGuidance",
    "topicContamination",
    "revisionInstructions"
  ];
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    assertExactKeys(value, keys) &&
    typeof value.safe === "boolean" &&
    keys.slice(1).every(
      (key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === "string")
    )
  );
};

const normalizeWriterResult = (value = {}) => {
  if (!validateSimpleWriterResult(value)) {
    const error = new Error("simple-writer-schema-invalid");
    error.code = "SIMPLE_WRITER_SCHEMA_INVALID";
    throw error;
  }
  const titleCandidates = unique(value.titleCandidates).slice(0, 5);
  const finalTitle = text(value.finalTitle) || titleCandidates[0] || "";
  return {
    finalTitle,
    titleCandidates: unique([finalTitle, ...titleCandidates]).slice(0, 5),
    body: text(value.body),
    hashtags: unique(value.hashtags.map((tag) => `#${text(tag).replace(/^#+/u, "").replace(/\s+/gu, "")}`)).slice(0, 8),
    faq: value.faq
      .map((item) => ({ question: text(item.question), answer: text(item.answer) }))
      .filter((item) => item.question && item.answer)
      .slice(0, 2)
  };
};

const META_GUIDANCE_PATTERN =
  /Fact\s*Map|입력\s*사실\s*기준|작성\s*방법|자동\s*평가|검증\s*결과|claim\s*ledger|unsupported\s*claim|내부\s*(?:판단|지침|검사)|실제\s*경험이\s*없으므로|안전한\s*표현으로\s*작성하면|위\s*조건을\s*반영하면/giu;
const INFORMATION_ONLY_EXPERIENCE_PATTERN =
  /써\s*보니|사용해\s*보니|며칠\s*(?:간)?\s*사용해?\s*봤|방문해\s*보니|직접\s*느껴|지난\s*주말|집에서\s*사용|효과를?\s*느꼈|만족스러웠|재구매하고\s*싶|재방문하고\s*싶|직접\s*(?:사용|방문|구매|체험|관찰)|(?:가족|아이|남편|친구|동료|동행자)(?:와|과|도|가|는|이|를)?\s*(?:함께|좋아|사용|방문|다녀|만족|추천)/giu;
const ACTUAL_EXPERIENCE_CUES = [
  {
    pattern: /지난\s*(?:주말|주|달)|어제|오늘\s*(?:직접|방문)|며칠\s*(?:간)?/giu,
    cue: /지난\s*(?:주말|주|달)|어제|오늘|며칠/u
  },
  {
    pattern: /(?:가족|아이|남편|친구|동료|동행자)(?:와|과|도|가|는|이|를)?\s*(?:함께|좋아|사용|방문|다녀|만족|추천)/giu,
    cue: /가족|아이|남편|친구|동료|동행자/u
  },
  {
    pattern: /집에서\s*(?:직접\s*)?(?:사용|써)|매장에서\s*(?:직접\s*)?(?:사용|체험)/giu,
    cue: /집에서|매장에서/u
  }
];
const CLAIM_CUES = [
  { pattern: /가격(?:이|은|도)?\s*(?:저렴|합리|만족)|가성비/giu, cue: /가격|가성비/u },
  { pattern: /효과(?:가|를)?\s*(?:있|좋|느꼈|확실)|성능(?:이|은)?\s*(?:좋|뛰어)/giu, cue: /효과|성능/u },
  { pattern: /직원(?:이|은)?\s*친절|친절한\s*응대/giu, cue: /직원|친절|응대/u },
  { pattern: /배송(?:이|은)?\s*(?:빠르|안전|깔끔)|포장(?:이|은)?\s*(?:꼼꼼|안전)/giu, cue: /배송|포장/u },
  { pattern: /재구매|다시\s*(?:사|이용하|방문하)고\s*싶/giu, cue: /재구매|다시\s*(?:구매|이용|방문)/u }
];

const matches = (pattern, value) => unique([...String(value || "").matchAll(pattern)].map((match) => match[0])).slice(0, 5);

export const inspectSimpleDraftDeterministically = ({ input = {}, draft = {}, previousJudge = null } = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const combined = [
    draft.finalTitle,
    ...(draft.titleCandidates || []),
    draft.body,
    ...(draft.hashtags || []),
    ...(draft.faq || []).flatMap((item) => [item.question, item.answer])
  ].join("\n");
  const source = `${normalized.details}\n${normalized.photos.map((photo) => photo.memo).join("\n")}`;
  const inventedExperience =
    normalized.experienceMode === "information_only"
      ? matches(INFORMATION_ONLY_EXPERIENCE_PATTERN, combined)
      : ACTUAL_EXPERIENCE_CUES.flatMap(({ pattern, cue }) =>
          cue.test(source) ? [] : matches(pattern, combined)
        );
  const unsupportedClaims = CLAIM_CUES.flatMap(({ pattern, cue }) =>
    cue.test(source) ? [] : matches(pattern, combined)
  );
  const metaGuidance = matches(META_GUIDANCE_PATTERN, combined);
  const topicContamination = [];
  const keywords = unique([normalized.primaryEntity, normalized.mainKeyword]);
  const firstSentence = text(draft.body).split(/(?<=[.!?。])\s+|\n+/u).find(Boolean) || "";
  const keywordContract = [];
  const contentContract = [];

  if (!text(draft.finalTitle)) contentContract.push("EMPTY_FINAL_TITLE");
  if (!text(draft.body)) contentContract.push("EMPTY_BODY");
  if (keywords.length > 0 && !keywords.some((keyword) => text(draft.finalTitle).includes(keyword))) {
    keywordContract.push("TITLE_KEYWORD_MISSING");
  }
  if (keywords.length > 0 && !keywords.some((keyword) => firstSentence.includes(keyword))) {
    keywordContract.push("FIRST_SENTENCE_KEYWORD_MISSING");
  }

  if (previousJudge) {
    for (const [key, target] of [
      ["inventedExperience", inventedExperience],
      ["unsupportedClaims", unsupportedClaims],
      ["metaGuidance", metaGuidance],
      ["topicContamination", topicContamination]
    ]) {
      for (const evidence of previousJudge[key] || []) {
        const normalizedEvidence = text(evidence);
        if (normalizedEvidence.length >= 4 && combined.includes(normalizedEvidence)) target.push(normalizedEvidence);
      }
    }
  }

  return {
    inventedExperience: unique(inventedExperience),
    unsupportedClaims: unique(unsupportedClaims),
    metaGuidance: unique(metaGuidance),
    topicContamination: unique(topicContamination),
    keywordContract: unique(keywordContract),
    contentContract: unique(contentContract)
  };
};

const judgeHasCriticalIssues = (judge = {}) =>
  Boolean(judge.judgeUnsafeWithoutEvidence) ||
  [
    "inventedExperience",
    "unsupportedClaims",
    "metaGuidance",
    "topicContamination",
    "keywordContract",
    "contentContract"
  ].some((key) => Array.isArray(judge[key]) && judge[key].length > 0);

const createReviewWarnings = (issues = {}) => {
  const warnings = [];
  if (issues.inventedExperience?.length) {
    warnings.push(`입력에 없는 사용·방문 경험 표현을 확인해 주세요: ${issues.inventedExperience.slice(0, 2).join(", ")}`);
  }
  if (issues.unsupportedClaims?.length) {
    warnings.push(`제공 정보로 확인하기 어려운 주장을 확인해 주세요: ${issues.unsupportedClaims.slice(0, 2).join(", ")}`);
  }
  if (issues.metaGuidance?.length) {
    warnings.push("본문에 내부 작성 또는 검토 안내처럼 보이는 문장이 남아 있습니다.");
  }
  if (issues.topicContamination?.length) {
    warnings.push(`다른 주제의 내용이 섞였는지 확인해 주세요: ${issues.topicContamination.slice(0, 2).join(", ")}`);
  }
  if (issues.keywordContract?.includes("TITLE_KEYWORD_MISSING")) {
    warnings.push("추천 제목에 메인 키워드 또는 중심 대상을 자연스럽게 넣어 주세요.");
  }
  if (issues.keywordContract?.includes("FIRST_SENTENCE_KEYWORD_MISSING")) {
    warnings.push("첫 문장에 메인 키워드 또는 중심 대상을 자연스럽게 넣어 주세요.");
  }
  if (issues.contentContract?.length) {
    warnings.push("제목과 본문이 비어 있지 않은지 확인해 주세요.");
  }
  if (issues.judgeUnsafeWithoutEvidence) {
    warnings.push("안전 검토 결과를 구체적으로 확인할 수 없어 발행 준비 상태로 표시하지 않았습니다.");
  }
  return warnings;
};

const ISSUE_ARRAY_KEYS = [
  "inventedExperience",
  "unsupportedClaims",
  "metaGuidance",
  "topicContamination",
  "keywordContract",
  "contentContract"
];

const mergeSafetyIssues = (...sources) => {
  const merged = Object.fromEntries(
    ISSUE_ARRAY_KEYS.map((key) => [key, unique(sources.flatMap((source) => source?.[key] || []))])
  );
  merged.judgeUnsafeWithoutEvidence = sources.some((source) => source?.judgeUnsafeWithoutEvidence);
  return merged;
};

const createSafetySummary = (issues = {}) => {
  const issueCodes = [];
  if (issues.inventedExperience?.length) issueCodes.push("FALSE_EXPERIENCE");
  if (issues.unsupportedClaims?.length) issueCodes.push("UNSUPPORTED_CLAIM");
  if (issues.metaGuidance?.length) issueCodes.push("META_GUIDANCE");
  if (issues.topicContamination?.length) issueCodes.push("TOPIC_CONTAMINATION");
  issueCodes.push(...(issues.keywordContract || []), ...(issues.contentContract || []));
  if (issues.judgeUnsafeWithoutEvidence) issueCodes.push("JUDGE_UNSAFE_WITHOUT_EVIDENCE");

  return {
    falseExperienceCount: issues.inventedExperience?.length || 0,
    unsupportedClaimCount: issues.unsupportedClaims?.length || 0,
    metaGuidanceCount: issues.metaGuidance?.length || 0,
    topicContaminationCount: issues.topicContamination?.length || 0,
    issueCodes: unique(issueCodes)
  };
};

export const createSimpleBlogResponse = ({
  input = {},
  draft = {},
  finalIssues = {},
  revisionUsed = false
} = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const informationSufficiency = getSimpleInformationSufficiency(normalized);
  const reviewWarnings = createReviewWarnings(finalIssues);
  const publishReady = !judgeHasCriticalIssues(finalIssues);

  if (informationSufficiency === "low") {
    reviewWarnings.push("입력 정보가 적어 짧고 보수적인 초안으로 만들었습니다. 구체적인 정보나 사진 메모를 추가하면 더 좋아집니다.");
  }
  if (!publishReady) {
    reviewWarnings.unshift("입력 사실과 다른 표현이 없는지 확인이 필요한 초안입니다.");
  }

  return {
    engine: "llm-simple",
    writerProfile: COMMERCIAL_GENERAL_WRITER_PROFILE_ID,
    experienceMode: normalized.experienceMode,
    resultMode: informationSufficiency === "low" ? "honest_draft" : "full_draft",
    primaryEntity: normalized.primaryEntity,
    mainKeyword: normalized.mainKeyword,
    subKeywords: normalized.subKeywords,
    informationSufficiency,
    titleCandidates: Array.isArray(draft.titleCandidates) ? draft.titleCandidates : [],
    finalTitle: draft.finalTitle || "",
    body: draft.body || "",
    faq: Array.isArray(draft.faq) ? draft.faq : [],
    hashtags: Array.isArray(draft.hashtags) ? draft.hashtags : [],
    bodyLength: compactBodyLength(draft.body),
    publishReady,
    reviewWarnings: unique(reviewWarnings),
    safety: createSafetySummary(finalIssues),
    llm: {
      writerUsed: true,
      revisionUsed: Boolean(revisionUsed),
      judgeUsed: true
    },
    // 이전 베타 UI가 새 응답으로도 깨지지 않도록 읽기 전용 별칭을 유지한다.
    mode: SIMPLE_BLOG_MODE,
    experienceStatus: normalized.experienceStatus,
    revisionUsed: Boolean(revisionUsed)
  };
};

export const runSimpleBlogGeneration = async ({
  input = {},
  callWriter,
  callJudge,
  callRevision
} = {}) => {
  const validation = validateSimpleBlogInput(input);
  if (!validation.ok) {
    const error = new Error(validation.errors[0]?.message || "입력값을 확인해 주세요.");
    error.code = "SIMPLE_INPUT_INVALID";
    error.status = 400;
    error.details = validation.errors;
    throw error;
  }
  if (typeof callWriter !== "function" || typeof callJudge !== "function") {
    throw new Error("simple-llm-adapter-required");
  }

  const normalized = validation.value;
  const writerPrompt = buildSimpleWriterPrompt(normalized);
  const firstDraft = normalizeWriterResult(await callWriter(writerPrompt));
  const judgePrompt = buildSimpleJudgePrompt({ input: normalized, draft: firstDraft });
  const judge = await callJudge(judgePrompt);

  if (!validateSimpleSafetyResult(judge)) {
    const error = new Error("simple-judge-schema-invalid");
    error.code = "SIMPLE_JUDGE_SCHEMA_INVALID";
    throw error;
  }

  const deterministicIssues = inspectSimpleDraftDeterministically({
    input: normalized,
    draft: firstDraft
  });
  const judgeHasEvidence = [
    "inventedExperience",
    "unsupportedClaims",
    "metaGuidance",
    "topicContamination"
  ].some((key) => judge[key].length > 0);
  const initialIssues = mergeSafetyIssues(judge, deterministicIssues, {
    judgeUnsafeWithoutEvidence: judge.safe === false && !judgeHasEvidence
  });
  const critical = judgeHasCriticalIssues(initialIssues);
  let finalDraft = firstDraft;
  let revisionUsed = false;
  if (critical && typeof callRevision === "function") {
    const revisionInstructions = unique([
      ...(judge.revisionInstructions || []),
      ...(initialIssues.keywordContract?.length
        ? ["제목과 첫 문장에 메인 키워드 또는 중심 대상을 자연스럽게 넣으세요."]
        : []),
      ...(initialIssues.contentContract?.length ? ["빈 제목이나 빈 본문을 완성하세요."] : [])
    ]);
    const revisionPrompt = buildSimpleRevisionPrompt({
      input: normalized,
      draft: firstDraft,
      judge: {
        ...judge,
        ...initialIssues,
        revisionInstructions
      }
    });
    finalDraft = normalizeWriterResult(await callRevision(revisionPrompt));
    revisionUsed = true;
  }

  const finalIssues = revisionUsed
    ? mergeSafetyIssues(
        inspectSimpleDraftDeterministically({
          input: normalized,
          draft: finalDraft,
          previousJudge: initialIssues
        }),
        {
          judgeUnsafeWithoutEvidence: initialIssues.judgeUnsafeWithoutEvidence
        }
      )
    : initialIssues;

  return createSimpleBlogResponse({
    input: normalized,
    draft: finalDraft,
    finalIssues,
    revisionUsed
  });
};
