import { evaluateBlogWriterQuality } from "./blogWriterQuality.js";
import { evaluateHumanQuality } from "./blogWriterHumanQuality.js";
import { createBlogWriterTrace, summarizeResultDiff } from "./blogWriterTrace.js";
import {
  buildBlogWriterPipelineContext,
  createClaimLedger,
  normalizeBlogWriterInput,
  parseSubKeywords,
  summarizeClaimLedger
} from "./blogWriterPipeline.js";
import {
  ANEUNYEOJA_WRITER_PROFILE_ID,
  ANEUNYEOJA_WRITER_PROFILE_VERSION
} from "./writerProfiles/aneunyeoja.js";

const DEFAULT_TARGET_CHAR_COUNT = 1800;
const MIN_TARGET_CHAR_COUNT = 700;
const MAX_TARGET_CHAR_COUNT = 3600;

const text = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");

const compact = (value = "") =>
  text(value)
    .replace(/\s+/gu, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase();

const uniqueTexts = (values = [], limit = Infinity) => {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const cleaned = text(value);
    const key = compact(cleaned);
    if (!cleaned || !key || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result.slice(0, limit);
};

const splitLines = (value = "", limit = 12) =>
  String(value ?? "")
    .split(/\n|(?<=[.!?。])\s+/u)
    .map((line) =>
      text(line)
        .replace(/^[\-*]\s*/u, "")
        .replace(/^(?:사진\s*메모|사진에서\s*읽은\s*내용|경험\s*메모)\s*[:：]\s*/u, "")
    )
    .filter(Boolean)
    .slice(0, limit);

const splitCommaList = (value = "", limit = 12) =>
  (Array.isArray(value) ? value.join(",") : String(value ?? ""))
    .split(/[,\n/|]+/u)
    .map(text)
    .filter(Boolean)
    .slice(0, limit);

const hasFinalConsonant = (value = "") => {
  const chars = Array.from(compact(value));
  const last = chars.at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return /[0-9]/u.test(last);
  return (code - 0xac00) % 28 !== 0;
};

const topicParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "은" : "는"}`;
};

const subjectParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "이" : "가"}`;
};

const objectParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "을" : "를"}`;
};

const instrumentalParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  const chars = Array.from(compact(cleaned));
  const last = chars.at(-1);
  if (!last) return cleaned;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${cleaned}로`;
  const jong = (code - 0xac00) % 28;
  return `${cleaned}${jong !== 0 && jong !== 8 ? "으로" : "로"}`;
};

const andParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "과" : "와"}`;
};

const sanitizeDraftText = (value = "") =>
  text(value)
    .replace(/사용자\s*메모|제공된\s*정보|실제\s*사용\s*메모가\s*없으면|해당\s*(?:제품|서비스|표현|상품|장소|메뉴)/gu, "")
    .replace(/본문에서|글을\s*읽는\s*사람|글을\s*작성할\s*때|확인\s*필요|정보가\s*부족하면|글의\s*흐름/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

const toNaturalSentence = (value = "") => {
  const cleaned = sanitizeDraftText(value);
  if (!cleaned) return "";
  if (/[.!?。요다]$/u.test(cleaned)) return cleaned;
  const conversational = cleaned
    .replace(/기억남$/u, "기억에 남았어요")
    .replace(/좋았음$/u, "좋았어요")
    .replace(/편했음$/u, "편했어요")
    .replace(/들렀음$/u, "들렀어요")
    .replace(/방문함$/u, "방문했어요")
    .replace(/사용함$/u, "사용했어요")
    .replace(/숙박함$/u, "숙박했어요")
    .replace(/구매함$/u, "구매했어요")
    .replace(/1박함$/u, "1박했어요");
  if (conversational !== cleaned) return `${conversational}.`;
  if (/(?:했음|좋았음|편했음|남았음|기억남|들렀음|사용함|방문함|숙박함|구매함)$/u.test(cleaned)) {
    return `${cleaned}이라는 점이 기억에 남아요.`;
  }
  return `${cleaned}.`;
};

const normalizeTargetCharCount = (form = {}, informationSufficiency = {}) => {
  const requested = Number.parseInt(form.targetCharCount || form.targetLength || form.customTargetLength, 10);
  const bounded = Number.isFinite(requested)
    ? Math.min(Math.max(requested, MIN_TARGET_CHAR_COUNT), MAX_TARGET_CHAR_COUNT)
    : DEFAULT_TARGET_CHAR_COUNT;
  const range = informationSufficiency.targetLengthRange || {};
  const level = informationSufficiency.level || "medium";
  const cap = level === "low" ? 1100 : level === "medium" ? 2200 : MAX_TARGET_CHAR_COUNT;
  const target = Math.min(bounded, cap, range.max || cap);

  return {
    requestedTargetCharCount: Number.isFinite(requested) ? bounded : null,
    targetCharCount: target,
    targetLengthRange: {
      min: range.min || (level === "low" ? 600 : level === "medium" ? 1100 : 2000),
      max: range.max || cap,
      target: range.target ? Math.min(range.target, target) : target
    },
    informationLimited: level === "low" && Number.isFinite(requested) && requested > cap
  };
};

const CATEGORY_LABELS = {
  restaurant: "맛집",
  cafe: "카페",
  accommodation: "숙소",
  travel: "여행",
  product: "상품",
  beauty: "뷰티",
  fashion: "패션",
  education: "교육",
  store: "매장",
  hospital: "병원",
  service: "서비스",
  "kids-place": "아이동반장소",
  experience: "체험",
  information: "정보",
  comparison: "비교",
  event: "행사",
  other: "리뷰"
};

const ACTUAL_EXPERIENCE_STATUSES = new Set(["visited", "stayed", "eaten", "used", "purchased", "attended", "participated"]);

const getExperienceLabel = (experienceStatus = "unknown") => {
  if (experienceStatus === "stayed") return "숙박";
  if (experienceStatus === "eaten") return "식사";
  if (experienceStatus === "used") return "사용";
  if (experienceStatus === "purchased") return "구매";
  if (experienceStatus === "attended" || experienceStatus === "participated") return "참여";
  if (experienceStatus === "visited") return "방문";
  if (experienceStatus === "planned") return "방문 전";
  if (experienceStatus === "researched") return "검색";
  return "정보";
};

const getResultMode = ({ informationSufficiency = {}, engine = "fallback", llmReady = false } = {}) => {
  if (engine !== "llm") return "fallback_draft";
  if (!llmReady || informationSufficiency.level === "low") return "honest_draft";
  return "publish_ready";
};

const createEntityParts = ({ form = {}, context = {} } = {}) => {
  const category = context.category || "";
  const primaryEntity = text(context.primaryEntity || context.mainKeyword || form.productName || form.topic);
  const brand = text(form.brandName || form.brand || "");
  const productName =
    /product|beauty|fashion/u.test(category) ? primaryEntity : text(form.productNameField || form.product || "");
  const placeName =
    /restaurant|cafe|accommodation|travel|store|hospital|kids-place/u.test(category)
      ? primaryEntity
      : text(form.placeName || "");

  return {
    primaryEntity,
    brand,
    productName,
    placeName,
    mainKeyword: context.mainKeyword || primaryEntity,
    subKeywords: context.subKeywords || []
  };
};

const scoreTitle = ({ title = "", context = {}, finalConsonantSafe = true } = {}) => {
  const primary = context.primaryEntity || context.mainKeyword || "";
  const main = context.mainKeyword || primary;
  const subKeywords = context.subKeywords || [];
  const length = Array.from(title).length;
  let score = 0;

  if (primary && title.includes(primary)) score += 28;
  if (main && title.includes(main)) score += 18;
  if (subKeywords.some((keyword) => title.includes(keyword))) score += 12;
  if (length >= 25 && length <= 42) score += 16;
  else if (length >= 18 && length <= 48) score += 8;
  if (!/정보\s*정리|체험\s*흐름|식사\s*후보|해당\s*제품|대표\s*메뉴|체크\s*포인트까지\s*정리/u.test(title)) score += 18;
  if (finalConsonantSafe) score += 8;

  return score;
};

const normalizeTitleCandidate = (value = "") =>
  text(value)
    .replace(/\s+/gu, " ")
    .replace(/(\S+)\s+\1(?=\s|$)/gu, "$1")
    .replace(/정보\s*정리|체험\s*흐름|식사\s*후보|해당\s*제품|대표\s*메뉴/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

const createTitleCandidates = ({ context = {}, entityParts = {} } = {}) => {
  const primary = entityParts.primaryEntity || context.primaryEntity || context.mainKeyword || "블로그";
  const main = context.mainKeyword || primary;
  const categoryLabel = CATEGORY_LABELS[context.category] || "리뷰";
  const subKeywords = context.subKeywords || [];
  const subA = subKeywords[0] || categoryLabel;
  const subB = subKeywords[1] || getExperienceLabel(context.experienceStatus);
  const subC = subKeywords[2] || "처음 볼 부분";
  const isActual = ACTUAL_EXPERIENCE_STATUSES.has(context.experienceStatus);
  const reviewWord = isActual ? "후기" : "";
  const mainText = compact(main) === compact(primary) ? categoryLabel : main;

  return uniqueTexts(
    [
      isActual ? `${primary} ${reviewWord} ${subA} 중심으로 본 점` : `${primary} ${subA} 중심으로 처음 볼 점`,
      `${mainText} 찾을 때 ${primary}에서 먼저 본 부분`,
      `${primary} ${subA} ${subB}까지 자연스럽게 살펴보기`,
      isActual ? `${primary} ${reviewWord} ${subC} 기준` : `${primary} ${subC} 기준으로 살펴보기`,
      `${primary} ${categoryLabel} ${isActual ? "직접 남은 인상" : "처음 볼 때 필요한 부분"}`
    ].map(normalizeTitleCandidate),
    5
  )
    .map((title) => ({
      title,
      intent: "seo_geo_aeo",
      entityIncluded: primary ? title.includes(primary) : false,
      mainKeywordIncluded: main ? title.includes(main) || title.includes(primary) : false,
      naturalness: 0,
      searchClarity: 0,
      clickReason: 0,
      lengthScore: 0,
      categoryFit: title.includes(categoryLabel) || title.includes(primary) ? 1 : 0,
      experienceFit: isActual ? Number(/후기|직접|남은|기준/u.test(title)) : Number(/처음|살펴|볼|필요/u.test(title)),
      awkwardPattern: /정보\s*정리|체험\s*흐름|식사\s*후보|해당\s*제품|대표\s*메뉴/u.test(title),
      similarityToOthers: 0,
      score: scoreTitle({ title, context })
    }))
    .sort((left, right) => right.score - left.score);
};

const createOpeningParagraph = ({ context = {}, facts = [], subKeywords = [] } = {}) => {
  const primary = context.primaryEntity || context.mainKeyword || "";
  const main = context.mainKeyword || primary;
  const mainKey = compact(main);
  const sub = subKeywords.find((keyword) => {
    const key = compact(keyword);
    return key && key !== mainKey && !key.includes(mainKey) && !mainKey.includes(key);
  }) || "";
  const isActual = ACTUAL_EXPERIENCE_STATUSES.has(context.experienceStatus);
  const firstFact = facts[0] || "";
  const firstSentence =
    compact(primary) === compact(main)
      ? `${topicParticle(primary)} ${isActual ? "직접 겪은 장면이 있어" : "처음 알아볼 때"} 중심을 잡기 좋은 주제였어요.`
      : `${topicParticle(primary)} ${instrumentalParticle(main)} ${isActual ? "직접 겪은 장면이 있어" : "처음 알아볼 때"} 중심을 잡기 좋은 주제였어요.`;
  const secondSentence = sub
    ? `${sub}${hasFinalConsonant(sub) ? "도" : "도"} 함께 보면 검색하는 사람이 궁금해할 맥락이 더 선명해져요.`
    : compact(primary).includes(mainKey) && compact(primary) !== mainKey
      ? "처음부터 핵심을 좁혀 보면 기준이 더 선명해져요."
      : `${subjectParticle(main)} 중심에서 벗어나지 않도록 핵심만 간단히 모았습니다.`;
  const thirdSentence = firstFact
    ? toNaturalSentence(firstFact)
    : isActual
      ? `${getExperienceLabel(context.experienceStatus)} 당시 남은 인상을 기준으로 과장 없이 적었습니다.`
      : "처음 보는 주제라면 이름, 쓰임, 함께 볼 조건부터 차분히 보면 좋아요.";

  return [firstSentence, secondSentence, thirdSentence].filter(Boolean).join(" ");
};

const createSectionPlans = ({ context = {}, facts = [], imageFacts = [] } = {}) => {
  const primary = context.primaryEntity || context.mainKeyword || "";
  const subKeywords = context.subKeywords || [];
  const isActual = ACTUAL_EXPERIENCE_STATUSES.has(context.experienceStatus);
  const level = context.informationSufficiency?.level || "medium";
  const base = [
    {
      heading: isActual ? `${objectParticle(primary)} 선택한 이유` : `${objectParticle(primary)} 알아본 이유`,
      purpose: isActual ? "experience_reason" : "research_reason",
      factIndexes: [0, 1]
    },
    {
      heading: subKeywords[0] ? `${subKeywords[0]} 관점에서 본 부분` : "먼저 눈에 들어온 부분",
      purpose: "reader_question",
      factIndexes: [1, 2]
    },
    {
      heading: subKeywords[1] ? `${andParticle(subKeywords[1])} 함께 볼 점` : "기억에 남은 세부 내용",
      purpose: "specific_detail",
      factIndexes: [2, 3]
    }
  ];

  if (imageFacts.length > 0) {
    base.push({
      heading: "사진으로 이어지는 부분",
      purpose: "image_grounding",
      factIndexes: [],
      imageIndexes: [0, 1]
    });
  }

  if (level !== "low") {
    base.push({
      heading: isActual ? "다음에 다시 볼 부분" : "결정 전에 볼 부분",
      purpose: "reader_utility",
      factIndexes: [3, 4]
    });
  }

  base.push({
    heading: "짧은 마무리",
    purpose: "closing",
    factIndexes: [4, 5]
  });

  const maxCount = level === "low" ? 4 : level === "high" ? 7 : 6;
  return base.slice(0, maxCount);
};

const createParagraphForPlan = ({ plan = {}, context = {}, facts = [], imageFacts = [] } = {}) => {
  const primary = context.primaryEntity || context.mainKeyword || "";
  const main = context.mainKeyword || primary;
  const isActual = ACTUAL_EXPERIENCE_STATUSES.has(context.experienceStatus);
  const factSentences = uniqueTexts((plan.factIndexes || []).map((index) => facts[index]).filter(Boolean), 2)
    .map(toNaturalSentence)
    .filter(Boolean);
  const imageSentences = uniqueTexts((plan.imageIndexes || []).map((index) => imageFacts[index]).filter(Boolean), 2)
    .map((value) => `사진으로는 ${sanitizeDraftText(value)} 정도를 참고할 수 있어요.`)
    .filter(Boolean);

  if (plan.purpose === "closing") {
    return isActual
      ? `${topicParticle(primary)} ${objectParticle(main)} 찾는 사람에게 실제로 남은 장면 중심으로 읽히는 글이 가장 자연스러워요. 과장된 결론보다 기억나는 사실을 좁게 남기는 쪽이 발행 후에도 부담이 적었습니다.`
      : `${topicParticle(primary)} 처음 살펴보는 단계라면 핵심 조건만 남겨도 충분해요. 이후 실제 경험이나 세부 정보가 생기면 더 깊게 비교해볼 수 있습니다.`;
  }

  if (plan.purpose === "image_grounding") {
    const body = imageSentences.length > 0
      ? imageSentences.join(" ")
      : `${primary}와 연결된 사진은 보이는 범위에서만 설명하는 편이 안전해요.`;
    return `[사진 삽입: ${primary} 관련 장면]\n\n${body}`;
  }

  if (factSentences.length > 0) {
    return `${factSentences.join(" ")} ${isActual ? "이런 구체적인 장면이 있어 실제 경험의 결이 더 분명해져요." : "처음 보는 사람도 이 정도 범위라면 핵심을 빠르게 파악할 수 있어요."}`;
  }

  if (isActual) {
    return `${topicParticle(primary)} ${getExperienceLabel(context.experienceStatus)} 경험이 있는 주제라서, 느낌을 넓게 부풀리기보다 실제로 떠오르는 부분을 한 가지씩 나누는 편이 좋아요.`;
  }

  if (plan.purpose === "research_reason") {
    return `${topicParticle(primary)} 이름과 용도를 먼저 잡아두면 검색어가 넓어져도 주제가 흐려지지 않아요.`;
  }
  if (plan.purpose === "reader_question") {
    const keyword = (context.subKeywords || [])[0] || main;
    return `${objectParticle(keyword)} 함께 볼 때는 내 상황에서 실제로 필요한 조건인지부터 생각해보면 좋아요.`;
  }
  if (plan.purpose === "specific_detail") {
    const keyword = (context.subKeywords || [])[1] || primary;
    return `${topicParticle(keyword)} 세부 내용을 더하면 나중에 비교하거나 다시 볼 때 판단이 쉬워집니다.`;
  }
  if (plan.purpose === "reader_utility") {
    return `${topicParticle(primary)} 선택 전에 가격, 구성, 위치처럼 바뀔 수 있는 항목은 최신 내용을 따로 살펴보면 좋아요.`;
  }

  return `${topicParticle(primary)} 처음 알아볼 때 이름과 목적, 함께 비교할 조건을 나눠 보면 전체 판단이 쉬워집니다.`;
};

const createBody = ({ context = {}, factMap = {}, imageAnalysis = {} } = {}) => {
  const facts = uniqueTexts(
    (factMap.facts || [])
      .filter((fact) => !["primaryEntity", "mainKeyword", "broadKeyword", "topic", "subKeyword"].includes(fact.field))
      .map((fact) => fact.value)
  );
  const imageFacts = uniqueTexts(imageAnalysis.visuallySupported || []);
  const opening = createOpeningParagraph({
    context,
    facts,
    subKeywords: context.subKeywords || []
  });
  const plans = createSectionPlans({
    context,
    facts,
    imageFacts
  });
  const sections = plans.map((plan) => {
    const paragraph = createParagraphForPlan({
      plan,
      context,
      facts,
      imageFacts
    });
    return [plan.heading, paragraph].filter(Boolean).join("\n\n");
  });

  return sanitizeBody([opening, ...sections].join("\n\n"));
};

const sanitizeBody = (body = "") =>
  String(body || "")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/확인\s*필요/gu, "다시 살펴볼 부분")
    .replace(/제공된\s*정보|사용자\s*메모|본문에서|글의\s*흐름|해당\s*(?:제품|서비스|메뉴|장소)/gu, "")
    .trim();

const toHashTag = (value = "") => {
  const cleaned = compact(value);
  return cleaned ? `#${cleaned}` : "";
};

const createHashtags = ({ context = {}, entityParts = {}, facts = [] } = {}) => {
  const primary = entityParts.primaryEntity || context.primaryEntity || context.mainKeyword || "";
  const categoryLabel = CATEGORY_LABELS[context.category] || "";
  const isActual = ACTUAL_EXPERIENCE_STATUSES.has(context.experienceStatus);
  const raw = [
    primary,
    context.mainKeyword,
    ...context.subKeywords,
    entityParts.brand,
    entityParts.productName,
    entityParts.placeName,
    categoryLabel,
    `${primary}${categoryLabel}`,
    `${context.mainKeyword}${categoryLabel}`,
    isActual ? `${primary}후기` : "",
    isActual ? `${categoryLabel}후기` : "",
    getExperienceLabel(context.experienceStatus),
    ...facts.slice(0, 4)
  ];

  return uniqueTexts(raw.map(toHashTag).filter(Boolean), 12);
};

const createFaqItems = ({ context = {}, factMap = {} } = {}) => {
  const level = context.informationSufficiency?.level || "low";
  if (level === "low") return [];

  const primary = context.primaryEntity || context.mainKeyword || "";
  const facts = uniqueTexts(
    (factMap.facts || [])
      .filter((fact) => ["memo", "visualLabel"].includes(fact.field))
      .map((fact) => fact.value),
    3
  );

  return facts.slice(0, level === "high" ? 3 : 2).map((fact, index) => ({
    question: index === 0 ? `${primary}에서 먼저 볼 점은 무엇인가요?` : `${primary} 글에서 함께 보면 좋은 내용은 무엇인가요?`,
    answer: sanitizeDraftText(fact)
  }));
};

const createPhotoGuideItems = ({ context = {}, imageAnalysis = {} } = {}) => {
  const primary = context.primaryEntity || context.mainKeyword || "";
  return (imageAnalysis.items || []).slice(0, 3).map((item, index) => ({
    id: `photo-${index + 1}`,
    label: `사진 ${index + 1}`,
    title: `${primary} 관련 장면`,
    description: text(item.safeDescription || item.visibleElements?.join(", ") || "사진 메모가 있는 위치"),
    marker: `[사진 삽입: ${primary} 관련 장면]`,
    insertAfter: index === 0 ? "첫 번째 세부 문단 뒤" : "관련 문단 뒤",
    guide: "보이는 사실이나 사용자가 적은 사진 메모만 연결합니다."
  }));
};

const createThumbnailTexts = ({ context = {} } = {}) => {
  const primary = context.primaryEntity || context.mainKeyword || "";
  const main = context.mainKeyword || primary;
  return uniqueTexts([primary, main, context.subKeywords?.[0] || CATEGORY_LABELS[context.category] || ""], 3);
};

const createSearchKeywords = ({ context = {} } = {}) =>
  uniqueTexts([context.primaryEntity, context.mainKeyword, context.broadKeyword, ...(context.subKeywords || [])], 8);

const getClosingParagraph = (body = "") => {
  const paragraphs = String(body || "").split(/\n{2,}/u).map(text).filter(Boolean);
  return paragraphs.at(-1) || "";
};

const EMPTY_FIELD_VALUES = {
  productName: "",
  brandName: "",
  category: "",
  ingredients: "",
  composition: "",
  usage: "",
  price: "",
  capacity: "",
  features: "",
  cautions: "",
  purchaseNotes: ""
};

const PRODUCT_INFO_PATTERNS = [
  ["ingredients", /(?:성분|원료|함유)\s*[:：]?\s*(.+)$/iu],
  ["capacity", /(?:용량|중량|함량)\s*[:：]?\s*([0-9][0-9.,\s]*(?:ml|g|kg|l|매|개|정|포)?)/iu],
  ["usage", /(?:사용법|섭취법|사용\s*방법|섭취\s*방법)\s*[:：]?\s*(.+)$/iu],
  ["price", /(?:가격|판매가|금액)\s*[:：]?\s*([0-9][0-9,.\s]*(?:원|만원)?)/iu],
  ["cautions", /(?:주의|주의사항|보관)\s*[:：]?\s*(.+)$/iu],
  ["composition", /(?:구성|구성품|패키지)\s*[:：]?\s*(.+)$/iu],
  ["brandName", /(?:브랜드|브랜드명)\s*[:：]?\s*(.+)$/iu],
  ["productName", /(?:상품명|제품명)\s*[:：]?\s*(.+)$/iu]
];

const OCR_NOISE_PATTERN =
  /마우스를\s*올려보세요|클릭|더보기|상세보기|닫기|공유|장바구니|옵션|슬라이드|페이지|hover|mouse/iu;
const OCR_SYMBOL_NOISE_PATTERN = /^(?:[@&*#~^_=+|\\/<>[\]{}().,`'"!?%-]|\s)+$/u;
const OCR_SHORT_NOISE_PATTERN = /^(?:[a-z]{1,3}|[0-9０-９]{1,3}|[0-9０-９\s.)-]+)$/iu;

const cleanOcrLine = (line = "") =>
  text(line)
    .replace(/\b[\p{L}\p{N}_ .-]+\.(?:png|jpe?g|webp|gif|heic)\b/giu, "")
    .replace(/(?:이미지|사진)\s*\d+\s*[:.)-]?/giu, "")
    .trim();

const isUsefulOcrLine = (line = "") => {
  const cleaned = cleanOcrLine(line);
  if (!cleaned) return false;
  if (OCR_NOISE_PATTERN.test(cleaned)) return false;
  if (OCR_SYMBOL_NOISE_PATTERN.test(cleaned)) return false;
  if (OCR_SHORT_NOISE_PATTERN.test(cleaned)) return false;
  return true;
};

const createFieldMeta = ({ status = "읽지 못함", confidence = 0, reason = "읽은 내용이 없습니다.", source = "" } = {}) => ({
  status,
  confidence,
  reason,
  source
});

export const extractProductInfoFieldsWithMetaFromText = (value = "") => {
  const lines = String(value || "")
    .split(/\n+/u)
    .map(cleanOcrLine)
    .filter(isUsefulOcrLine);
  const fields = { ...EMPTY_FIELD_VALUES };
  const meta = Object.fromEntries(
    Object.keys(EMPTY_FIELD_VALUES).map((field) => [field, createFieldMeta()])
  );

  lines.forEach((line) => {
    let matched = false;

    PRODUCT_INFO_PATTERNS.forEach(([field, pattern]) => {
      if (fields[field]) return;
      const match = line.match(pattern);
      if (!match?.[1]) return;
      fields[field] = text(match[1]);
      meta[field] = createFieldMeta({
        status: "확인됨",
        confidence: 0.86,
        reason: "이미지 텍스트에서 항목명을 함께 읽었습니다.",
        source: line
      });
      matched = true;
    });

    if (!matched && !fields.features && /간편|데일리|루틴|보습|휴대|가벼|편하|산뜻|부드|초보|구성|특징/u.test(line)) {
      fields.features = line;
      meta.features = createFieldMeta({
        status: "확인됨",
        confidence: 0.72,
        reason: "특징으로 볼 수 있는 설명 문장을 읽었습니다.",
        source: line
      });
    }
  });

  return {
    fields,
    meta,
    cleanedText: lines.join("\n"),
    summary: {
      filledCount: Object.values(fields).filter(Boolean).length,
      ignoredLineCount: Math.max(0, String(value || "").split(/\n+/u).length - lines.length)
    }
  };
};

export const extractProductInfoFieldsFromText = (value = "") =>
  extractProductInfoFieldsWithMetaFromText(value).fields;

export function createProductReviewDraft(form = {}) {
  const normalizedForm = normalizeBlogWriterInput(form);
  const context = buildBlogWriterPipelineContext(normalizedForm);
  const entityParts = createEntityParts({ form: normalizedForm, context });
  const lengthSettings = normalizeTargetCharCount(normalizedForm, context.informationSufficiency);
  const titleEvaluations = createTitleCandidates({ context, entityParts });
  const titleCandidates = titleEvaluations.map((item) => item.title);
  const selectedTitleCandidate = titleEvaluations[0] || { title: titleCandidates[0] || entityParts.primaryEntity, score: 0 };
  const finalTitle = text(form.selectedTitle) && titleCandidates.includes(text(form.selectedTitle))
    ? text(form.selectedTitle)
    : selectedTitleCandidate.title;
  const body = createBody({
    context,
    factMap: context.factMap,
    imageAnalysis: context.imageAnalysis
  });
  const facts = uniqueTexts((context.factMap?.facts || []).map((fact) => fact.value), 12);
  const hashtags = createHashtags({ context, entityParts, facts });
  const faqItems = createFaqItems({ context, factMap: context.factMap });
  const photoGuide = createPhotoGuideItems({ context, imageAnalysis: context.imageAnalysis });
  const claimLedger = createClaimLedger({
    title: finalTitle,
    body,
    faq: faqItems,
    hashtags,
    factMap: context.factMap,
    contextFacts: context.contextFacts,
    imageAnalysis: context.imageAnalysis,
    experienceStatus: context.experienceStatus
  });
  const claimLedgerSummary = summarizeClaimLedger(claimLedger);
  const claimLedgerIssues = claimLedgerSummary.hardFailures.map(
    (item) => `claimLedger.${item.claimType}: ${item.text}`
  );
  const rawQuality = evaluateBlogWriterQuality({
    form: {
      ...normalizedForm,
      primaryEntity: entityParts.primaryEntity,
      engine: "fallback"
    },
    category: context.category,
    selectedTitle: finalTitle,
    titleCandidates,
    body,
    mainKeyword: context.mainKeyword,
    subKeywords: context.subKeywords,
    hashtags,
    faqItems,
    imageCount: context.imageAnalysis?.items?.length || normalizedForm.imageCount || 0,
    photoGuide,
    targetCharCount: lengthSettings.targetCharCount
  });
  const humanQuality = evaluateHumanQuality({
    title: finalTitle,
    titleCandidates,
    body,
    faq: faqItems,
    hashtags,
    factMap: context.factMap,
    imageAnalysis: context.imageAnalysis,
    category: context.category,
    visitStatus: context.factMap?.visitStatus,
    mainKeyword: context.mainKeyword,
    primaryEntity: entityParts.primaryEntity,
    subKeywords: context.subKeywords,
    requestedTargetCharCount: lengthSettings.requestedTargetCharCount || lengthSettings.targetCharCount,
    effectiveTargetCharCount: lengthSettings.targetCharCount,
    engine: "fallback"
  });
  const qualityScore = Math.min(89, humanQuality.score, rawQuality.score, claimLedgerSummary.hardFail ? 55 : 89);
  const generationId = text(form.generationId) || `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const resultMode = getResultMode({
    informationSufficiency: context.informationSufficiency,
    engine: "fallback",
    llmReady: false
  });
  const additionalInfoHints =
    context.informationSufficiency?.level === "low"
      ? ["실제 방문·사용·숙박 여부", "가장 좋았던 점 또는 아쉬웠던 점", "가격·주차·메뉴·시설 등 직접 확인한 정보"]
      : [];
  const bodyLength = body.replace(/\s+/gu, "").length;
  const actualBodyCharCount = Array.from(body).length;
  const postProcessingSteps = ["schema-validation", "duplicate-normalization", "claim-ledger", "quality-gate"];
  const trace = createBlogWriterTrace({
    engine: "fallback",
    judgeEngine: "deterministic",
    isMock: false,
    promptVersion: ANEUNYEOJA_WRITER_PROFILE_VERSION,
    writerProfile: ANEUNYEOJA_WRITER_PROFILE_ID,
    imageAnalysis: context.imageAnalysis,
    factMap: context.factMap,
    postProcessingSteps,
    qualityScore,
    publishReady: false
  });
  const rawFinalDiff = summarizeResultDiff({
    rawResult: { body },
    finalResult: { body },
    postProcessingSteps
  });

  const contentPackage = {
    generationId,
    resultMode,
    writerProfile: {
      id: ANEUNYEOJA_WRITER_PROFILE_ID,
      version: ANEUNYEOJA_WRITER_PROFILE_VERSION
    },
    standardInputSchema: context.standardInputSchema,
    standardInput: context.standardInput,
    pipelineSteps: context.pipelineSteps,
    entityParts,
    primaryEntity: entityParts.primaryEntity,
    brand: entityParts.brand,
    productName: entityParts.productName,
    placeName: entityParts.placeName,
    mainKeyword: context.mainKeyword,
    broadKeyword: context.broadKeyword,
    subKeywords: context.subKeywords,
    category: context.category,
    searchIntent: context.searchIntent,
    experienceStatus: context.experienceStatus,
    contextFacts: context.contextFacts,
    informationSufficiency: context.informationSufficiency,
    factMap: context.factMap,
    imageAnalysis: context.imageAnalysis,
    writerPlan: context.writerPlan,
    titleCandidates,
    titleCandidateEvaluations: titleEvaluations,
    selectedTitleEvaluation: selectedTitleCandidate,
    finalRecommendedTitle: finalTitle,
    blogBody: body,
    faqItems,
    hashtags,
    claimLedger,
    claimLedgerSummary,
    photoGuide,
    targetCharCount: lengthSettings.targetCharCount,
    targetLengthRange: lengthSettings.targetLengthRange,
    requestedTargetCharCount: lengthSettings.requestedTargetCharCount,
    informationLimited: lengthSettings.informationLimited,
    additionalInfoHints,
    engine: "fallback",
    judgeEngine: "deterministic",
    isMock: false,
    publishReady: false,
    qualityAttempts: 1,
    rawQualityScore: rawQuality.score,
    legacyQualityScore: rawQuality.score,
    cappedScore: qualityScore,
    qualityScore,
    qualityIssues: uniqueTexts([...(rawQuality.issues || []), ...(humanQuality.issues || []).map((issue) => `${issue.code}: ${issue.message}`), ...claimLedgerIssues], 16),
    qualityChecks: rawQuality.checks,
    blogWriterQuality: rawQuality,
    humanQuality,
    trace,
    diagnostics: {
      rawFinalDiff
    },
    actualBodyLength: bodyLength,
    actualBodyCharCount,
    summary: {
      resultMode,
      engine: "fallback",
      bodyLength,
      actualBodyCharCount,
      targetCharCount: lengthSettings.targetCharCount,
      requestedTargetCharCount: lengthSettings.requestedTargetCharCount,
      informationLimited: lengthSettings.informationLimited,
      informationSufficiency: context.informationSufficiency?.level || null,
      rawQualityScore: rawQuality.score,
      cappedScore: qualityScore,
      qualityScore,
      judgeEngine: "deterministic",
      isMock: false,
      publishReady: false
    }
  };

  return {
    generationId,
    resultMode,
    category: context.category,
    engine: "fallback",
    titles: titleCandidates,
    titleCandidates,
    titleCandidateEvaluations: titleEvaluations,
    selectedTitleEvaluation: selectedTitleCandidate,
    finalTitle,
    selectedTitle: finalTitle,
    primaryEntity: entityParts.primaryEntity,
    brand: entityParts.brand,
    productName: entityParts.productName,
    placeName: entityParts.placeName,
    mainKeyword: context.mainKeyword,
    broadKeyword: context.broadKeyword,
    subKeywords: context.subKeywords,
    searchIntent: context.searchIntent,
    experienceStatus: context.experienceStatus,
    contextFacts: context.contextFacts,
    informationSufficiency: context.informationSufficiency,
    factMap: context.factMap,
    imageAnalysis: context.imageAnalysis,
    writerPlan: context.writerPlan,
    body,
    faq: faqItems,
    faqItems,
    hashtags,
    claimLedger,
    claimLedgerSummary,
    imageSuggestions: photoGuide,
    outline: createSectionPlans({
      context,
      facts,
      imageFacts: context.imageAnalysis?.visuallySupported || []
    }).map((plan) => plan.heading),
    thumbnailTexts: createThumbnailTexts({ context }),
    searchKeywords: createSearchKeywords({ context }),
    closingParagraph: getClosingParagraph(body),
    contentPackage,
    rawQualityScore: rawQuality.score,
    legacyQualityScore: rawQuality.score,
    cappedScore: qualityScore,
    qualityScore,
    qualityIssues: contentPackage.qualityIssues,
    qualityChecks: rawQuality.checks,
    blogWriterQuality: rawQuality,
    humanQuality,
    trace,
    diagnostics: contentPackage.diagnostics,
    publishReady: false,
    judgeEngine: "deterministic",
    isMock: false,
    qualityAttempts: 1,
    bodyLength,
    actualBodyCharCount,
    summary: contentPackage.summary
  };
}
