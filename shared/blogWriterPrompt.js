import { analyzeBlogWritingInput } from "./blogWriterCategory.js";
import { buildBlogWriterPipelineContext } from "./blogWriterPipeline.js";
import {
  ANEUNYEOJA_WRITER_PROFILE,
  ANEUNYEOJA_WRITER_PROFILE_ID,
  ANEUNYEOJA_WRITER_PROFILE_VERSION,
  buildAneunyeojaWriterProfileInstruction
} from "./writerProfiles/aneunyeoja.js";

export const BLOG_WRITER_PROMPT_VERSION = ANEUNYEOJA_WRITER_PROFILE_VERSION;

const BLOG_WRITER_CORE_SYSTEM_PROMPT = `
당신은 네이버 블로그에 실제로 올릴 수 있는 한국어 사실 근거형 블로그 원고를 쓰는 편집자입니다.
독자는 방문, 구매, 수강, 비교, 정보 확인 전에 실제 입력 근거 안에서 판단하고 싶은 사람입니다.

카테고리는 맛집, 카페, 숙소, 여행, 상품, 뷰티, 패션, 속옷/언더웨어, 교육, 매장, 병원, 서비스, 아이 동반 장소, 체험, 정보, 비교, 행사, 기타 글을 다룹니다.
글의 중심은 반드시 상호명, 상품명, 강의명, 장소명 같은 primary entity입니다.
지역명 맛집, 확인된 메뉴, 가족여행, 근처 검색어 같은 broad keyword는 중심 주제로 삼지 말고 서브키워드로 자연스럽게 분산합니다.
가족, 아이, 친구, 동료, 단체 같은 동행자 맥락은 입력에 명시된 경우에만 씁니다. 여행이라는 단어만으로 가족여행이나 아이 동반을 만들지 않습니다.

허위 경험, 가격, 영업시간, 주차, 웨이팅, 메뉴판, 효과, 직원 응대, 재구매 의사는 만들지 않습니다.
부족한 정보는 본문 전체에서 한 번만 방문 참고 맥락으로 자연스럽게 다룹니다.
최종 본문에는 작성 계획, 가이드, 방어 문장, 프롬프트 설명, 제공된 정보 언급을 넣지 않습니다.
최종 본문에는 "글을 읽는 사람", "글 안에서", "본문에서", "광고처럼", "단정하지 않고", "제공된 정보", "작성하면", "확인 필요", "정보가 부족하면", "자연스럽게 정리되는 느낌", "글의 흐름", "글이 더 구체적으로" 같은 메타 표현을 넣지 않습니다.

말투는 "~더라고요", "~있었어요", "~괜찮았어요", "~같아요", "궁금하더라고요", "확인해보면 좋겠다는 생각이 들었어요"처럼 편안하게 씁니다.
과장, 검색 순위 보장, 광고성 확신, 의학적 효과 보장, 무조건 추천 표현은 피합니다.

실제 경험 신호가 있으면 경험형 문장을 쓰고, 경험 신호가 없으면 정보형 또는 방문 전 참고형 문장을 씁니다.
사진 설명은 Vision 결과나 사용자가 직접 적은 사진 메모에 있는 시각 사실만 다루고, 맛, 가격, 양, 직원 응대, 효과는 사진만 보고 단정하지 않습니다.
입력 정보가 적으면 targetCharCount가 높아도 600~1100자 안에서 자연스럽게 끝냅니다. 중간 정보는 1100~2200자, 충분한 정보는 2000~3600자를 기준으로 합니다. 같은 기준어를 반복해 길이를 늘리지 않습니다.
최종 원고의 각 주장에는 Fact Map, Context Facts, Image Analysis 중 하나 이상의 근거가 있거나 안전한 일반화여야 합니다. unsupported, contradictory, metaGuidance, placeholder 유형의 문장은 최종 원고에 남기지 않습니다.
`.trim();

export const BLOG_WRITER_SYSTEM_PROMPT = [
  buildAneunyeojaWriterProfileInstruction(),
  BLOG_WRITER_CORE_SYSTEM_PROMPT
].join("\n\n").trim();

export const BLOG_WRITER_OUTPUT_SCHEMA = {
  titleCandidates: ["string"],
  finalTitle: "string",
  sections: [
    {
      heading: "string",
      paragraphs: ["string"],
      imageRefs: ["string"]
    }
  ],
  faq: [{ question: "string", answer: "string" }],
  hashtags: ["string"]
};

export const BLOG_WRITER_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    titleCandidates: {
      type: "array",
      items: { type: "string" },
      minItems: 5,
      maxItems: 5
    },
    finalTitle: {
      type: "string"
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: {
            type: ["string", "null"]
          },
          paragraphs: {
            type: "array",
            items: { type: "string" }
          },
          imageRefs: {
            type: "array",
            items: { type: "integer" }
          }
        },
        required: ["heading", "paragraphs", "imageRefs"],
        additionalProperties: false
      }
    },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" }
        },
        required: ["question", "answer"],
        additionalProperties: false
      }
    },
    hashtags: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["titleCandidates", "finalTitle", "sections", "faq", "hashtags"],
  additionalProperties: false
};

const toJsonBlock = (value) => JSON.stringify(value, null, 2);

const sanitizePromptImageContext = (items = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    index: Number(item?.index || item?.photoIndex) || index + 1,
    name: String(item?.name || "").trim(),
    source: String(item?.source || "").trim(),
    note: String(item?.note || item?.description || item?.alt || "").trim(),
    ocrText: String(item?.ocrText || "").trim(),
    mediaType: String(item?.mediaType || item?.type || "").trim(),
    size: Number(item?.size) || 0,
    hasInlineData: Boolean(item?.dataUrl || item?.previewDataUrl || item?.base64Data || item?.base64)
  }));

const buildWriterBrief = (pipelineContext = {}, { targetCharCount = 2500 } = {}) => {
  const primaryEntity = pipelineContext.primaryEntity || pipelineContext.mainKeyword || "";
  const writerPlan = pipelineContext.writerPlan || {};
  const factMap = pipelineContext.factMap || {};
  const requiredFactIds = (factMap.userFacts || [])
    .filter((fact) => Number(fact.confidence || 0) >= 0.85)
    .map((fact) => fact.id)
    .filter(Boolean);
  const criticalFactIds = (factMap.userFacts || [])
    .filter((fact) => Number(fact.confidence || 0) >= 0.85 && fact.priority === "critical")
    .map((fact) => fact.id)
    .filter(Boolean);
  const highFactIds = (factMap.userFacts || [])
    .filter((fact) => Number(fact.confidence || 0) >= 0.85 && fact.priority === "high")
    .map((fact) => fact.id)
    .filter(Boolean);
  const requestedTargetCharCount = Number(targetCharCount) || writerPlan.requestedTargetCharCount || 2500;
  const effectiveTargetCharCount = writerPlan.effectiveTargetCharCount || requestedTargetCharCount;
  const sectionBudgets = (writerPlan.sectionBudgets || []).map((section) => {
    const targetChars = Number(section.targetChars || section.targetCharCount || 0) || 0;
    return {
      ...section,
      targetChars,
      minChars: targetChars > 0 ? Math.floor(targetChars * 0.85) : 0,
      maxChars: targetChars > 0 ? Math.floor(targetChars * 1.1) : 0
    };
  });
  const allowedClaims = writerPlan.factPolicy?.allowedClaims || factMap.supported || [];
  const forbiddenClaims = writerPlan.factPolicy?.forbiddenClaims || factMap.unsupportedFields || [];
  const unknownFields = writerPlan.factPolicy?.unknownFields || factMap.unsupportedFields || [];

  return {
    primaryEntity,
    canonicalEntity: primaryEntity,
    mainKeyword: pipelineContext.mainKeyword || "",
    subKeywords: pipelineContext.subKeywords || [],
    category: pipelineContext.category || "",
    searchIntent: pipelineContext.searchIntent || null,
    experienceStatus: pipelineContext.experienceStatus || "",
    informationSufficiency: pipelineContext.informationSufficiency?.level || pipelineContext.informationSufficiency || "",
    requestedTargetCharCount,
    effectiveTargetCharCount,
    sectionBudgets,
    criticalFactIds,
    highFactIds,
    allowedClaims,
    forbiddenClaims,
    unknownFields,
    requiredEntityPlacements: ["finalTitle", "openingFirstSentence", "openingParagraph", "body"],
    titleRules: {
      candidateCount: 5,
      minimumCandidatesWithPrimaryEntity: 4,
      characterRange: [25, 42],
      chooseHighestIntentFit: true
    },
    factCoverageRules: {
      requiredFactIds,
      minimumInputFactCoverage: 0.9,
      criticalFactsMustBeCovered: true,
      doNotCountRepeatedFactTwice: true
    },
    claimBoundary: {
      allowedClaims,
      forbiddenClaims,
      unknownFields
    },
    lengthContract: {
      requestedTargetCharCount,
      effectiveTargetCharCount,
      acceptableRatio: [0.85, 1.1],
      sectionBudgets
    },
    sectionPlan: (writerPlan.sections || []).map((section) => {
      const targetChars = Number(section.targetChars || section.targetCharCount || 0) || 0;
      return {
      sectionId: section.sectionId,
      heading: section.heading,
      purpose: section.purpose,
      requiredFactIds: section.requiredFactIds || [],
      optionalFactIds: section.optionalFactIds || [],
      targetCharCount: targetChars,
      targetChars,
      minChars: targetChars > 0 ? Math.floor(targetChars * 0.85) : 0,
      maxChars: targetChars > 0 ? Math.floor(targetChars * 1.1) : 0,
      forbiddenDuplicateFactIds: section.forbiddenDuplicateFactIds || [],
      forbiddenRepeatedFactIds: section.forbiddenRepeatedFactIds || section.forbiddenDuplicateFactIds || [],
      imageRefs: section.imageRefs || []
      };
    })
  };
};

export const buildBlogWriterUserPrompt = ({ form = {}, analysis = analyzeBlogWritingInput(form), fallbackDraft = null } = {}) => {
  const pipelineContext = buildBlogWriterPipelineContext(form, {
    category: fallbackDraft?.category || fallbackDraft?.contentPackage?.category || analysis.category,
    analysis
  });
  const targetCharCount =
    form.targetCharCount ||
    form.targetLength ||
    fallbackDraft?.contentPackage?.requestedTargetCharCount ||
    fallbackDraft?.contentPackage?.targetCharCount ||
    2500;
  const payload = {
    task: "네이버 블로그 publishable draft 생성",
    promptVersion: BLOG_WRITER_PROMPT_VERSION,
    writerProfile: {
      id: ANEUNYEOJA_WRITER_PROFILE_ID,
      version: ANEUNYEOJA_WRITER_PROFILE_VERSION,
      displayName: ANEUNYEOJA_WRITER_PROFILE.displayName,
      scope: "문체와 관점만 제공하며 경험·동행·가족 정보를 만들지 않음"
    },
    pipelineSteps: pipelineContext.pipelineSteps,
    standardInputSchema: pipelineContext.standardInputSchema,
    standardInput: pipelineContext.standardInput,
    category: pipelineContext.category,
    topic: analysis.topic,
    primaryEntity: pipelineContext.primaryEntity,
    mainKeyword: pipelineContext.mainKeyword,
    broadKeyword: pipelineContext.broadKeyword,
    subKeywords: pipelineContext.subKeywords,
    searchIntent: pipelineContext.searchIntent,
    experienceStatus: pipelineContext.experienceStatus,
    contextFacts: pipelineContext.contextFacts,
    informationSufficiency: pipelineContext.informationSufficiency,
    factMap: pipelineContext.factMap,
    imageAnalysis: pipelineContext.imageAnalysis,
    writerPlan: pipelineContext.writerPlan,
    writerBrief: buildWriterBrief(pipelineContext, { targetCharCount }),
    memoText: analysis.memoText,
    targetCharCount,
    effectiveTargetCharCount:
      fallbackDraft?.contentPackage?.targetLengthRange?.target ||
      fallbackDraft?.contentPackage?.targetCharCount ||
      form.targetCharCount ||
      form.targetLength ||
      2500,
    informationLimited: Boolean(fallbackDraft?.contentPackage?.informationLimited),
    imageContext: sanitizePromptImageContext(form.imageContext || form.images || form.photos || form.photoMetadata || []),
    imageCount: form.imageCount || 0,
    outputSchema: BLOG_WRITER_OUTPUT_SCHEMA,
    fallbackReference: fallbackDraft
      ? {
          titleCandidates: fallbackDraft.titleCandidates || [],
          body: fallbackDraft.body || "",
          faqItems: fallbackDraft.contentPackage?.faqItems || [],
          hashtags: fallbackDraft.hashtags || []
        }
      : null
  };

  return [
    "아래 입력값만 근거로 최종 원고를 작성하세요.",
    "Input Normalization → Primary Entity Extraction → Brand/Product/Place Separation → Main/Sub Keyword Parsing → Open-set Category Classification → Search Intent Classification → Experience Status Classification → Context Fact Classification → Information Sufficiency Classification → Fact Map Construction → Image Vision Analysis → Writer Profile Selection → Reader Intent Planning → Dynamic Outline Generation → SEO/GEO Title Candidate Generation → Draft Generation → Deterministic Hard Check → LLM Human Judge → Automatic Revision → Best Candidate Selection 순서의 writerPlan을 따르세요.",
    "메인 키워드는 primary entity를 우선하고, broad keyword는 서브키워드로만 자연스럽게 배치하세요.",
    "contextFacts.companions가 unknown이면 가족, 아이, 친구, 동료, 단체 동행을 추정하지 마세요. 여행 맥락만으로 가족여행을 만들지 마세요.",
    "experienceStatus가 visited/stayed/used/eaten/attended/purchased가 아니면 실제 방문·사용 후기처럼 쓰지 마세요.",
    "imageAnalysis.mode가 label-only이면 라벨과 메모로 알 수 있는 내용만 쓰고, 사진 속 맛·가격·양·직원 응대·영업시간은 만들지 마세요.",
    "informationSufficiency가 low이면 긴 글자수를 억지로 맞추지 말고 700~1300자 안의 밀도 있는 원고로 끝내세요. low는 FAQ를 만들지 않습니다.",
    "informationSufficiency가 high 또는 medium이면 effectiveTargetCharCount의 85~110% 안에 들어오도록 작성하세요. 글자수를 늘릴 때 일반론을 쓰지 말고 factMap.userFacts의 각 fact를 서로 다른 문단에서 구체적인 상황, 판단 이유, 결과로 확장하세요.",
    "각 section은 writerBrief.sectionPlan의 targetChars를 중심으로 작성하고 minChars보다 지나치게 짧게 끝내지 마세요. requiredFactIds를 먼저 반영한 뒤 optionalFactIds로만 보강하고, forbiddenRepeatedFactIds의 fact를 표현만 바꿔 다시 쓰지 마세요.",
    "high 또는 medium 입력에서는 모든 critical/high fact, 좋았던 점, 아쉬웠던 점, 실제 결과, 재사용·재방문·재수강 의사를 빠뜨리지 마세요. 각 섹션은 writerPlan.sections의 evidenceIds 중 하나 이상을 실제 문장에 반영해야 합니다.",
    "문단별 역할은 겹치지 않게 나누고, 마무리 문단은 앞 문단을 반복하지 말고 실제 결과와 다음 사용/방문 판단만 정리하세요.",
    "첫 문장에는 primaryEntity 또는 mainKeyword를 넣고, 첫 문단에는 mainKeyword를 1~2회만, subKeyword는 최대 1개만 자연스럽게 연결하세요.",
    "본문 문단은 readerIntent의 서로 다른 질문에 답하고, 각 문단은 factMap evidenceIds 또는 imageRefs 중 하나 이상과 연결하세요.",
    "제목 후보 5개는 SEO/GEO Title Candidate Generation 단계로 만들고 categoryFit, experienceFit 관점으로 평가하세요. 정보 정리, 체험 흐름, 식사 후보, 해당 제품, 대표 메뉴 같은 기계적 표현을 쓰지 마세요.",
    "사용자 메모에 방문·숙박·사용·수강 신호가 있으면 실제 경험형 문장을 쓰고, 신호가 없으면 경험한 척하지 마세요.",
    "경험 주장은 experienceEvidence, 가족·아이·동행 주장은 contextEvidence, 사진 주장은 imageEvidence가 있을 때만 쓰세요.",
    "unsupported, contradictory, metaGuidance, placeholder 문장이 최종 섹션에 남지 않게 스스로 검토하세요. Claim Ledger는 서버가 최종 본문 기준으로 다시 만듭니다.",
    "FAQ는 Fact Map으로 직접 답할 수 있을 때만 0~2개 생성하세요. 운영시간, 예약, 주차, 글 작성법, 확인 필요만 말하는 질문은 만들지 마세요. FAQ, 해시태그, 키워드 반복, 정보 정리 문단으로 본문 길이를 채우지 마세요.",
    "hashtags는 중복 없이 3~8개만 반환하세요. 해시태그는 본문 품질을 보완하는 용도가 아니며 unsupported claim이나 category contamination을 만들면 안 됩니다.",
    "writer 출력은 titleCandidates, finalTitle, sections, faq, hashtags만 반환하세요. body, qualityScore, Fact Map, Claim Ledger, trace, publishReady 같은 내부 분석 필드는 절대 반환하지 마세요.",
    "FAQ가 필요 없으면 faq는 빈 배열로 두고, 이미지가 없으면 imageRefs는 빈 배열로 두세요. 소제목이 필요 없는 section은 heading을 null로 두세요.",
    "최종 본문에는 내부 writerPlan에서나 쓸 메타 표현을 넣지 마세요.",
    "정보가 부족하면 억지로 길게 쓰지 말고 실제 본문 길이에 맞춰 자연스럽게 마무리하세요.",
    "사진이 있으면 본문 흐름 안에 [사진 삽입: 설명] 마커를 넣되 파일명은 쓰지 마세요.",
    "최종 응답은 JSON만 반환하세요.",
    "Use writerBrief as the binding brief. Include the canonical primaryEntity in finalTitle, the first sentence, the opening paragraph, and the body. At least 4 of 5 titleCandidates must include the exact primaryEntity.",
    "Follow writerBrief.sectionPlan and sectionBudgets. Each section must stay near its targetChars, cover its requiredFactIds with distinct grounded sentences, and avoid forbiddenRepeatedFactIds. Do not replace the primaryEntity with a broad keyword.",
    "If writerBrief.informationSufficiency is high or medium, write within 85-110% by expanding distinct user facts, not by repeating keywords, headings, FAQ, hashtags, or generic filler. If it is low, keep an honest short draft.",
    "Before returning JSON, self-check: inputFactCoverage >= 0.90, no unsupportedClaims, no category contamination, no meta guidance, no josa awkwardness, and target length 85-110% only for high/medium inputs.",
    toJsonBlock(payload)
  ].join("\n\n");
};

export const buildBlogWriterPromptPayload = ({ form = {}, analysis = null, fallbackDraft = null } = {}) => {
  const resolvedAnalysis = analysis || analyzeBlogWritingInput(form);

  return {
    mode: "llm-preferred-with-static-fallback",
    promptVersion: BLOG_WRITER_PROMPT_VERSION,
    writerProfile: ANEUNYEOJA_WRITER_PROFILE_ID,
    keyPolicy: "Use server-side environment variables only. Never expose API keys to the browser.",
    messages: [
      {
        role: "system",
        content: BLOG_WRITER_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: buildBlogWriterUserPrompt({
          form,
          analysis: resolvedAnalysis,
          fallbackDraft
        })
      }
    ],
    analysis: resolvedAnalysis
  };
};
