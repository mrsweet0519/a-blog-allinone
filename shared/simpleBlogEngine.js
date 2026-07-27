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

const CONTROL_ONLY_FACT_PATTERN =
  /^(?:(?:(?:실제|직접)\s*)?(?:사용|방문|체험)(?:한)?\s*(?:경험)?(?:은|이|가)?\s*(?:없(?:음|습니다)?|아니(?:다|며|었습니다)?|아닙니다)|(?:실제로|직접)\s*(?:사용|방문|체험)하지(?:는)?\s*않(?:았(?:음|습니다)?|음|습니다)?|(?:제품|서비스)\s*정보만\s*(?:전달|제공)받(?:았(?:으며|고|음|습니다)?|은|음)?(?:\s*[,;]?\s*(?:(?:실제|직접)\s*)?(?:사용|방문|체험)(?:한)?\s*(?:경험)?(?:은|이|가)?\s*(?:없(?:음|습니다)?|아닙니다))?)$/iu;
const CONTROL_FACT_SUFFIX_PATTERN =
  /\s*[,;]\s*(?:(?:실제|직접)\s*)?(?:사용|방문|체험)(?:한)?\s*(?:경험)?(?:은|이|가)?\s*(?:없(?:음|습니다)?|아닙니다)([.!?。]*)$/iu;

const splitFacts = (value = "") =>
  unique(
    String(value || "")
      .split(/\n+|(?<=[.!?。])\s+/u)
      .map((item) =>
        item
          .replace(/^[-*•]\s*/u, "")
          .replace(CONTROL_FACT_SUFFIX_PATTERN, "$1")
          .trim()
      )
      .filter((item) => item.length >= 2)
      .filter((item) => !CONTROL_ONLY_FACT_PATTERN.test(item.replace(/[.!?。]+$/u, "")))
  ).slice(0, 24);

const getSimpleEvidence = (input = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const providedFacts = splitFacts(normalized.providedInfo);
  const experienceFacts = splitFacts(normalized.experienceMemo);
  const photoNotes = normalized.photos.flatMap((photo, index) =>
    splitFacts(photo.memo).map((memo) => ({ photo: index + 1, memo }))
  );
  const evidenceFacts = unique([
    ...providedFacts,
    ...experienceFacts,
    ...photoNotes.map((item) => item.memo)
  ]);
  const experienceFactCharacterCount = compactBodyLength(experienceFacts.join(" "));
  const specificExperienceCount = experienceFacts.filter((fact) => {
    const compactLength = compactBodyLength(fact);
    const tokenCount = fact.split(/\s+/u).filter(Boolean).length;
    return compactLength >= 12 && (tokenCount >= 4 || /\d/u.test(fact));
  }).length;

  return {
    normalized,
    providedFacts,
    experienceFacts,
    photoNotes,
    evidenceFacts,
    factCount: evidenceFacts.length,
    factCharacterCount: compactBodyLength(evidenceFacts.join(" ")),
    experienceFactCharacterCount,
    specificExperienceCount
  };
};

const getSimpleEvidenceCapacity = ({
  normalized,
  factCount,
  factCharacterCount,
  experienceFacts,
  experienceFactCharacterCount,
  specificExperienceCount,
  photoNotes
}) => {
  const photoMemoCount = new Set(photoNotes.map((item) => item.photo)).size;
  const rawCapacity =
    normalized.experienceMode === "actual_experience"
      ? 600 +
        experienceFacts.length * 100 +
        Math.min(experienceFactCharacterCount * 2, 700) +
        specificExperienceCount * 20 +
        photoMemoCount * 150
      : 600 +
        factCount * 180 +
        Math.min(factCharacterCount * 3, 900) +
        photoMemoCount * 150;

  return Math.max(700, Math.min(2500, Math.round(rawCapacity / 50) * 50));
};

export const getSimpleInformationSufficiency = (input = {}) => {
  const evidence = getSimpleEvidence(input);
  const {
    normalized,
    factCount,
    factCharacterCount,
    experienceFacts,
    experienceFactCharacterCount,
    specificExperienceCount,
    photoNotes
  } = evidence;
  const photoMemoCount = new Set(photoNotes.map((item) => item.photo)).size;
  const evidenceCapacity = getSimpleEvidenceCapacity(evidence);
  const supportsRequestedLength = evidenceCapacity >= normalized.targetLength * 0.85;

  if (normalized.experienceMode === "actual_experience") {
    const hasConcreteExperience =
      (experienceFacts.length >= 3 && specificExperienceCount >= 2) ||
      experienceFactCharacterCount >= 100;
    if (!hasConcreteExperience || !supportsRequestedLength) return "low";
    return evidenceCapacity >= normalized.targetLength ? "high" : "medium";
  }

  const hasGroundingBase =
    factCount >= 3 ||
    (factCount >= 2 && factCharacterCount >= 60) ||
    (photoMemoCount >= 2 && factCharacterCount >= 50);
  if (!hasGroundingBase || !supportsRequestedLength) return "low";
  return evidenceCapacity >= normalized.targetLength ? "high" : "medium";
};

export const createSimpleFactSummary = (input = {}) => {
  const {
    normalized,
    providedFacts,
    experienceFacts,
    photoNotes,
    evidenceFacts,
    factCount,
    factCharacterCount,
    experienceFactCharacterCount,
    specificExperienceCount
  } = getSimpleEvidence(input);
  return {
    topic: normalized.topic,
    primaryEntity: normalized.primaryEntity,
    mainKeyword: normalized.mainKeyword,
    subKeywords: normalized.subKeywords,
    experienceMode: normalized.experienceMode,
    providedFacts,
    experienceFacts,
    userFacts: evidenceFacts,
    photoNotes,
    factCount,
    factCharacterCount,
    experienceFactCharacterCount,
    specificExperienceCount,
    informationSufficiency: getSimpleInformationSufficiency(normalized)
  };
};

export const deriveSimpleLengthContract = (input = {}, factSummary = null) => {
  const normalized = normalizeSimpleBlogInput(input);
  const summary = factSummary || createSimpleFactSummary(normalized);
  const requestedTargetLength = normalized.targetLength;
  const resultMode =
    summary.informationSufficiency === "low" ? "honest_draft" : "full_draft";
  const evidenceTarget = getSimpleEvidenceCapacity({
    normalized,
    factCount: summary.factCount || 0,
    factCharacterCount: summary.factCharacterCount || 0,
    experienceFacts: summary.experienceFacts || [],
    experienceFactCharacterCount: summary.experienceFactCharacterCount || 0,
    specificExperienceCount: summary.specificExperienceCount || 0,
    photoNotes: summary.photoNotes || []
  });
  const effectiveTargetLength =
    resultMode === "honest_draft"
      ? Math.min(requestedTargetLength, 1300, evidenceTarget)
      : requestedTargetLength;

  return {
    requestedTargetLength,
    effectiveTargetLength,
    targetComplianceRatio: null,
    targetAdjustmentReason:
      effectiveTargetLength < requestedTargetLength
        ? "입력 정보 범위에 맞춰 요청 분량을 조정했습니다."
        : "",
    resultMode,
    minimumTargetLength: Math.ceil(effectiveTargetLength * 0.85),
    maximumTargetLength: Math.floor(effectiveTargetLength * 1.1)
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

const getSimpleExpansionRoles = (experienceMode = "information_only") =>
  experienceMode === "actual_experience"
    ? [
        "사용하게 된 맥락",
        "실제 사용 과정",
        "직접 확인한 장점",
        "직접 확인한 아쉬운 점",
        "입력 경험으로 확인 가능한 조건"
      ]
    : [
        "핵심 정보 정리",
        "기능별 확인 포인트",
        "구매·이용 전 비교 기준",
        "사용 환경별 고려사항",
        "최종 체크리스트"
      ];

export const buildSimpleWriterPrompt = (input = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const summary = createSimpleFactSummary(normalized);
  const lengthContract = deriveSimpleLengthContract(normalized, summary);
  const expansionRoles = getSimpleExpansionRoles(normalized.experienceMode);
  const experienceRules =
    normalized.experienceMode === "actual_experience"
      ? [
          "1인칭 경험은 사용자가 경험 메모에 직접 적은 사실만 사용할 수 있습니다.",
          "입력하지 않은 날짜, 동행자, 장소, 효과, 만족도, 가격 평가, 배송 상태, 친절도, 재구매 의사를 만들지 마세요.",
          "입력 사실의 반대 조건을 추론하거나, 사실에서 새 만족도·추천·효과를 도출하지 마세요.",
          "자연스러운 문장으로 바꾸는 것은 가능하지만 평가 강도를 높이지 마세요."
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
    `- 요청 분량: ${lengthContract.requestedTargetLength}자`,
    `- 적용 목표 분량: 약 ${lengthContract.effectiveTargetLength}자`,
    `- 본문은 ${lengthContract.minimumTargetLength}~${lengthContract.maximumTargetLength}자 범위에서 작성하세요.`,
    ...(lengthContract.resultMode === "honest_draft"
      ? ["- 입력 근거에 맞춰 조정된 적용 목표까지만 작성하고 원래 요청 분량을 억지로 채우지 마세요."]
      : []),
    `- 문단 역할을 서로 다르게 구성하세요: ${expansionRoles.join(", ")}`,
    "- finalTitle과 첫 문장에 mainKeyword 또는 primaryEntity를 한 번 자연스럽게 넣으세요.",
    "- 한 문단은 2~4문장으로 구성하고 같은 키워드를 기계적으로 반복하지 마세요.",
    "- 입력이 적으면 일반론으로 길이를 채우지 마세요.",
    "- 사진 메모가 없는 사진에서 가격, 효능, 성능, 맛, 친절도, 배송 상태를 추정하지 마세요.",
    "- 내부 작성 과정, 경험 유무 통제 문장, 분량 조정 사유를 본문에 쓰지 마세요.",
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
    lengthContract,
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
          "actual_experience에서는 단순한 문장 다듬기와 새로운 만족도·추천·효과·반대 조건 일반화를 구분하세요.",
          "입력 사실보다 평가 강도가 높아졌거나 새 결론을 도출했다면 unsupportedClaims에 넣으세요.",
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

export const buildSimpleRevisionPrompt = ({ input = {}, draft = {}, judge = {} } = {}) => {
  const summary = createSimpleFactSummary(input);
  const lengthContract = deriveSimpleLengthContract(input, summary);
  const currentBodyLength = compactBodyLength(draft.body);
  const missingCharacterCount = Math.max(
    0,
    lengthContract.effectiveTargetLength - currentBodyLength
  );

  return {
    messages: [
      {
        role: "system",
        content: [
          buildCommercialGeneralWriterInstruction(),
          "",
          "안전 검사에서 지적된 문제를 근거 안에서 고치세요.",
          "경험 유무 같은 통제 문장이 지적되면 그대로 남기거나 어색하게 삭제하지 말고, 제공된 제품 정보나 선택 기준 문장으로 자연스럽게 전환하세요.",
          "새 경험이나 새 사실을 추가하지 말고 지정된 JSON schema만 반환하세요."
        ].join("\n")
      },
      {
        role: "user",
        content: [
          "[허용 근거]",
          toJson(summary),
          "",
          "[이전 초안]",
          toJson(draft),
          "",
          "[길이 계약]",
          toJson({
            currentBodyLength,
            effectiveTargetLength: lengthContract.effectiveTargetLength,
            minimumTargetLength: lengthContract.minimumTargetLength,
            maximumTargetLength: lengthContract.maximumTargetLength,
            missingCharacterCount,
            expansionRoles: getSimpleExpansionRoles(summary.experienceMode)
          }),
          "",
          "[수정할 문제]",
          toJson({
            inventedExperience: judge.inventedExperience || [],
            unsupportedClaims: judge.unsupportedClaims || [],
            metaGuidance: judge.metaGuidance || [],
            topicContamination: judge.topicContamination || [],
            lengthContract: judge.lengthContract || [],
            revisionInstructions: judge.revisionInstructions || []
          }),
          "",
          `반복하지 말아야 할 기존 사실: ${summary.userFacts.join(" | ") || "없음"}`,
          "같은 사실이나 문장을 반복하지 말고 문단별 역할을 다르게 확장하세요.",
          "문제를 제거하고 길이 계약을 반영한 전체 초안을 JSON으로 다시 반환하세요."
        ].join("\n")
      }
    ]
  };
};

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
  /Fact\s*Map|입력\s*사실\s*기준|작성\s*방법|자동\s*평가|검증\s*결과|claim\s*ledger|unsupported\s*claim|내부\s*(?:판단|지침|검사)|실제\s*경험이\s*없으므로|안전한\s*표현으로\s*작성하면|위\s*조건을\s*반영하면|(?:제품|서비스)\s*정보만\s*(?:전달|제공)받|(?:실제로|직접)\s*(?:사용|방문|체험)하지|(?:실제|직접)\s*(?:사용|방문|체험)(?:한)?\s*(?:경험)?(?:은|이|가)?\s*없|(?:실제|직접)\s*(?:사용|방문|체험)한\s*것(?:은|이)\s*아니|제공받은\s*정보로만\s*작성|정보형으로\s*작성/giu;
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
const SUBJECTIVE_EVALUATION_CUES = [
  {
    pattern: /(?:기본|핵심)\s*(?:기능|역할|성능)(?:에|이|은)?\s*충실/giu,
    cue: /(?:기본|핵심)\s*(?:기능|역할|성능)(?:에|이|은)?\s*충실/iu
  },
  {
    pattern: /(?:한\s*번쯤?|한번쯤?).{0,12}(?:써|사용|경험|방문).{0,8}(?:볼|해\s*볼)\s*만|(?:무난|적극).{0,8}추천|추천(?:하고|할)\s*만/giu,
    cue: /(?:써|사용|경험|방문).{0,8}(?:볼|해\s*볼)\s*만|(?:무난|적극).{0,8}추천|추천(?:하고|할)\s*만/iu
  },
  {
    pattern: /(?:특히|정말|매우|아주).{0,16}(?:편리|유용|잘\s*맞|만족|좋|효과)/giu,
    cue: /(?:특히|정말|매우|아주).{0,16}(?:편리|유용|잘\s*맞|만족|좋|효과)/iu
  },
  {
    pattern: /힘(?:이|을)?\s*(?:덜|적게)\s*들/giu,
    cue: /힘(?:이|을)?\s*(?:덜|적게)\s*들/iu
  },
  {
    pattern: /만족도(?:가|는|도)?\s*(?:높|좋)|만족스러/giu,
    cue: /만족도(?:가|는|도)?\s*(?:높|좋)|만족스러/iu
  }
];
const OPPOSITE_CONDITION_INFERENCE_CUES = [
  {
    sourceNegative: /좁[^\s,.]{0,8}.{0,24}(?:어렵|어려|불편|제한|힘들)/iu,
    sourcePositive: /넓[^\s,.]{0,8}.{0,24}(?:잘\s*맞|적합|편리|좋)/iu,
    draftPositive: /넓[^\s,.]{0,8}.{0,24}(?:잘\s*맞|적합|편리|좋)/giu
  },
  {
    sourceNegative: /작[^\s,.]{0,8}.{0,24}(?:어렵|어려|불편|제한|힘들)/iu,
    sourcePositive: /크[^\s,.]{0,8}.{0,24}(?:잘\s*맞|적합|편리|좋)/iu,
    draftPositive: /크[^\s,.]{0,8}.{0,24}(?:잘\s*맞|적합|편리|좋)/giu
  }
];

const matches = (pattern, value) => unique([...String(value || "").matchAll(pattern)].map((match) => match[0])).slice(0, 5);

export const inspectSimpleDraftDeterministically = ({ input = {}, draft = {}, previousJudge = null } = {}) => {
  const normalized = normalizeSimpleBlogInput(input);
  const factSummary = createSimpleFactSummary(normalized);
  const lengthContract = deriveSimpleLengthContract(normalized, factSummary);
  const combined = [
    draft.finalTitle,
    ...(draft.titleCandidates || []),
    draft.body,
    ...(draft.hashtags || []),
    ...(draft.faq || []).flatMap((item) => [item.question, item.answer])
  ].join("\n");
  const source = [
    ...factSummary.providedFacts,
    ...factSummary.experienceFacts,
    ...factSummary.photoNotes.map((item) => item.memo)
  ].join("\n");
  const experienceSource = factSummary.experienceFacts.join("\n");
  const inventedExperience =
    normalized.experienceMode === "information_only"
      ? matches(INFORMATION_ONLY_EXPERIENCE_PATTERN, combined)
      : ACTUAL_EXPERIENCE_CUES.flatMap(({ pattern, cue }) =>
          cue.test(source) ? [] : matches(pattern, combined)
        );
  const unsupportedClaims = CLAIM_CUES.flatMap(({ pattern, cue }) =>
    cue.test(source) ? [] : matches(pattern, combined)
  );
  if (normalized.experienceMode === "actual_experience") {
    unsupportedClaims.push(
      ...SUBJECTIVE_EVALUATION_CUES.flatMap(({ pattern, cue }) =>
        cue.test(experienceSource) ? [] : matches(pattern, combined)
      ),
      ...OPPOSITE_CONDITION_INFERENCE_CUES.flatMap(
        ({ sourceNegative, sourcePositive, draftPositive }) =>
          sourceNegative.test(experienceSource) && !sourcePositive.test(experienceSource)
            ? matches(draftPositive, combined)
            : []
      )
    );
  }
  const metaGuidance = matches(META_GUIDANCE_PATTERN, combined);
  const topicContamination = [];
  const keywords = unique([normalized.primaryEntity, normalized.mainKeyword]);
  const firstSentence = text(draft.body).split(/(?<=[.!?。])\s+|\n+/u).find(Boolean) || "";
  const keywordContract = [];
  const contentContract = [];
  const lengthContractIssues = [];
  const bodyLength = compactBodyLength(draft.body);

  if (!text(draft.finalTitle)) contentContract.push("EMPTY_FINAL_TITLE");
  if (!text(draft.body)) contentContract.push("EMPTY_BODY");
  if (keywords.length > 0 && !keywords.some((keyword) => text(draft.finalTitle).includes(keyword))) {
    keywordContract.push("TITLE_KEYWORD_MISSING");
  }
  if (keywords.length > 0 && !keywords.some((keyword) => firstSentence.includes(keyword))) {
    keywordContract.push("FIRST_SENTENCE_KEYWORD_MISSING");
  }
  if (bodyLength < lengthContract.minimumTargetLength) {
    lengthContractIssues.push("TARGET_LENGTH_UNDER_85");
  }
  if (bodyLength > lengthContract.maximumTargetLength) {
    lengthContractIssues.push("TARGET_LENGTH_OVER_110");
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
    contentContract: unique(contentContract),
    lengthContract: unique(lengthContractIssues)
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
    "contentContract",
    "lengthContract"
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
  if (issues.lengthContract?.includes("TARGET_LENGTH_UNDER_85")) {
    warnings.push("요청한 분량보다 짧게 생성되어 한 번 더 확인이 필요합니다.");
  }
  if (issues.lengthContract?.includes("TARGET_LENGTH_OVER_110")) {
    warnings.push("적용한 분량보다 길게 생성되어 반복 표현이 없는지 확인해 주세요.");
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
  "contentContract",
  "lengthContract"
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
  issueCodes.push(...(issues.lengthContract || []));
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
  const factSummary = createSimpleFactSummary(normalized);
  const informationSufficiency = factSummary.informationSufficiency;
  const lengthContract = deriveSimpleLengthContract(normalized, factSummary);
  const responseIssues = mergeSafetyIssues(
    finalIssues,
    inspectSimpleDraftDeterministically({ input: normalized, draft })
  );
  const reviewWarnings = createReviewWarnings(responseIssues);
  const publishReady = !judgeHasCriticalIssues(responseIssues);
  const bodyLength = compactBodyLength(draft.body);
  const targetComplianceRatio =
    lengthContract.effectiveTargetLength > 0
      ? Number((bodyLength / lengthContract.effectiveTargetLength).toFixed(4))
      : 0;

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
    resultMode: lengthContract.resultMode,
    primaryEntity: normalized.primaryEntity,
    mainKeyword: normalized.mainKeyword,
    subKeywords: normalized.subKeywords,
    informationSufficiency,
    titleCandidates: Array.isArray(draft.titleCandidates) ? draft.titleCandidates : [],
    finalTitle: draft.finalTitle || "",
    body: draft.body || "",
    faq: Array.isArray(draft.faq) ? draft.faq : [],
    hashtags: Array.isArray(draft.hashtags) ? draft.hashtags : [],
    bodyLength,
    requestedTargetLength: lengthContract.requestedTargetLength,
    effectiveTargetLength: lengthContract.effectiveTargetLength,
    targetComplianceRatio,
    targetAdjustmentReason: lengthContract.targetAdjustmentReason,
    publishReady,
    reviewWarnings: unique(reviewWarnings),
    safety: createSafetySummary(responseIssues),
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
      ...(initialIssues.contentContract?.length ? ["빈 제목이나 빈 본문을 완성하세요."] : []),
      ...(initialIssues.lengthContract?.includes("TARGET_LENGTH_UNDER_85")
        ? ["적용 목표 분량의 85% 이상이 되도록 서로 다른 문단 역할로 근거 안에서 확장하세요."]
        : []),
      ...(initialIssues.lengthContract?.includes("TARGET_LENGTH_OVER_110")
        ? ["적용 목표 분량의 110% 안으로 반복 표현을 줄이세요."]
        : [])
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
