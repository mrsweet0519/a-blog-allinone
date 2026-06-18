import {
  createToneTitleSuffix,
  ensureSentence,
  getToneProfile,
  normalizeTone,
  softenForTone
} from "./toneEngine.js";
import {
  analyzeBlogWritingInput,
  collectBlogSubKeywords,
  shouldUseTopicEntityAsMain
} from "./blogWriterCategory.js";
import {
  BLOG_WRITER_GUIDE_PATTERN,
  evaluateBlogWriterQuality
} from "./blogWriterQuality.js";

const DEFAULT_TARGET_LENGTH = 2500;
const MIN_TARGET_CHAR_COUNT = 800;
const MAX_TARGET_CHAR_COUNT = 4000;

const text = (value) => String(value ?? "").trim();

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const toHashTag = (value) => {
  const tag = compact(value);
  return tag ? `#${tag}` : "";
};

const REVIEW_TOPIC_TAIL_PATTERN =
  /\s*(?:내돈내산\s*)?(?:솔직\s*)?(?:방문\s*후기|사용\s*후기|체험\s*후기|구매\s*후기|이용\s*후기|방문기|사용기|후기|리뷰|추천|정리|방법)$/u;

const MAIN_KEYWORD_TAIL_PATTERN =
  /\s*(?:방문\s*후기|사용\s*후기|체험\s*후기|구매\s*후기|이용\s*후기|후기|리뷰|정리|추천|방법)$/u;

const stripReviewSuffix = (value = "") => {
  let current = text(value);

  for (let index = 0; index < 3; index += 1) {
    const next = current.replace(REVIEW_TOPIC_TAIL_PATTERN, "").trim();
    if (next === current) break;
    current = next;
  }

  return current;
};

const stripMainKeywordParticle = (value = "") => {
  const current = text(value);
  if (!current) return "";

  if (/의의$/u.test(current)) return current.slice(0, -1).trim();
  if (/\s의$/u.test(current)) return current.replace(/\s의$/u, "").trim();

  return current
    .replace(/\s*(?:에서|으로|로)$/u, "")
    .replace(/\s*(?:은|는|이|가|을|를)$/u, "")
    .trim();
};

const normalizeMainKeyword = (value = "") => {
  let current = text(value).replace(/\s+/g, " ");

  for (let index = 0; index < 5; index += 1) {
    const next = stripMainKeywordParticle(current.replace(MAIN_KEYWORD_TAIL_PATTERN, "").trim());
    if (next === current) break;
    current = next;
  }

  return current.replace(/\s+/g, " ").trim();
};

const deriveMainKeywordFromTopic = (value = "") => {
  const cleaned = normalizeMainKeyword(
    stripReviewSuffix(value)
      .replace(/\s*(?:직접\s*)?(?:써본|사용해본|다녀온|방문한|참여한)\s*$/u, "")
      .replace(/\s+/g, " ")
      .trim()
  ).replace(/\s+(?:방문|식사|후기|리뷰)$/u, "").trim();

  const branchMatch = cleaned.match(/^(.+?(?:본점|지점|점|센터|거래소|강의))(?:\s+.+)?$/u);
  if (branchMatch?.[1]) return branchMatch[1].trim();

  const withoutRestaurantDescriptor = cleaned.replace(/\s+맛집$/u, "").trim();
  if (withoutRestaurantDescriptor && /\s/u.test(withoutRestaurantDescriptor)) {
    return withoutRestaurantDescriptor;
  }

  return cleaned;
};

const resolveMainKeywordFromParts = (parts = [], form = {}) => {
  const first = text(parts[0]);
  const topicKeyword = deriveMainKeywordFromTopic(form.productName);

  if (!first) return topicKeyword || "상품 후기";
  const topicLooksLikeHowTo = /처음|시작|방법|기준|흐름/u.test(topicKeyword) && !/본점|지점|센터|거래소|강의/u.test(topicKeyword);
  if (
    shouldUseTopicEntityAsMain({
      inputKeyword: first,
      topicKeyword,
      topic: form.productName
    }) &&
    !(compact(first).length <= 4 && topicLooksLikeHowTo)
  ) {
    return topicKeyword;
  }
  const shouldPromoteLongTopic =
    (compact(first).length <= 4 && !/처음|시작|방법|기준|흐름/u.test(topicKeyword)) ||
    /본점|지점|센터|거래소|강의/u.test(topicKeyword);

  if (
    topicKeyword &&
    compact(topicKeyword).includes(compact(first)) &&
    compact(topicKeyword).length > compact(first).length + 2 &&
    shouldPromoteLongTopic
  ) {
    return topicKeyword;
  }

  return first;
};

const getReviewTitleBase = (value = "") => {
  const withoutSuffix = stripReviewSuffix(value);
  const cleaned = withoutSuffix
    .replace(/\s*직접\s*써본$/u, "")
    .replace(/\s*사용해본$/u, "")
    .trim();

  return cleaned || withoutSuffix || text(value);
};

const hasFinalConsonant = (value = "") => {
  const chars = Array.from(compact(value));
  const last = chars.at(-1);
  if (!last) return false;

  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return /[0-9]/u.test(last);

  return (code - 0xac00) % 28 !== 0;
};

const withObjectParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "을" : "를"}`;
};

const withSubjectParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "이" : "가"}`;
};

const withTopicParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "은" : "는"}`;
};

const withConditionalParticle = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  return `${cleaned}${hasFinalConsonant(cleaned) ? "이라면" : "라면"}`;
};

const withReviewTitleSuffix = (value = "") => {
  const keyword = text(value);
  if (!keyword) return "후기";
  return keyword.endsWith("후기") ? keyword : `${keyword} 후기`;
};

const withReviewHashSuffix = (value = "") => {
  const keyword = text(value);
  if (!keyword) return "";
  return keyword.endsWith("후기") ? keyword : `${keyword}후기`;
};

const uniqueText = (items = []) =>
  Array.from(new Set(items.map(text).filter(Boolean)));

const splitCommaList = (value = "", limit = 10) =>
  text(value)
    .split(/[\n,/]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);

const splitMemoLines = (value = "") =>
  text(value)
    .split(/\n|(?<=[.!?。])\s+/u)
    .map((item) => item.replace(/^[\-*]\s*/u, "").replace(/^경험\s*메모\s*[:：]\s*/u, "").trim())
    .filter(Boolean)
    .slice(0, 8);

const createSentence = (value, tone = "친근한") => ensureSentence(softenForTone(value, tone), tone);

const createSection = (heading, paragraphs = [], tone = "친근한") =>
  [heading, ...paragraphs.map((item) => createSentence(item, tone))].filter(Boolean).join("\n\n");

const normalizeBody = (value = "") =>
  String(value ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const INTERNAL_IMAGE_META_LINE_PATTERN =
  /carousel|chatgpt\s*image|image\s*page|업로드\s*파일명|생성\s*시간|내부\s*이미지\s*식별자|generated\s*time|created\s*at|file\s*name|filename|review-image-[a-z0-9-]+/iu;
const INTERNAL_IMAGE_META_INLINE_PATTERN =
  /(?:carousel\s*page\s*\d*|chatgpt\s*image|image\s*page\s*\d*|업로드\s*파일명\s*[:：]?\s*|생성\s*시간\s*[:：]?\s*[^,\n]*|내부\s*이미지\s*식별자\s*[:：]?\s*\S+|generated\s*time\s*[:：]?\s*[^,\n]*|created\s*at\s*[:：]?\s*[^,\n]*|file\s*name\s*[:：]?\s*|filename\s*[:：]?\s*|review-image-[a-z0-9-]+)/giu;
const UPLOAD_FILE_NAME_PATTERN = /\b[\p{L}\p{N}_ .-]+\.(?:png|jpe?g|webp|gif|heic)\b/giu;
const MECHANICAL_IMAGE_LABEL_PATTERN = /(?:이미지|사진)\s*\d+\s*[:.)-]?/giu;

const sanitizeImageMetadataText = (value = "") =>
  text(value)
    .split(/\n+/u)
    .map((line) =>
      line
        .replace(INTERNAL_IMAGE_META_INLINE_PATTERN, " ")
        .replace(UPLOAD_FILE_NAME_PATTERN, " ")
        .replace(MECHANICAL_IMAGE_LABEL_PATTERN, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !INTERNAL_IMAGE_META_LINE_PATTERN.test(line))
    .join("\n")
    .trim();

const sanitizeReviewSourceText = (value = "") =>
  sanitizeImageMetadataText(value)
    .replace(/^사진\s*메모\s*[:：]\s*/u, "")
    .replace(/^사진에서\s*읽은\s*내용\s*[:：]\s*/u, "")
    .replace(/^이미지별\s*메모\s*[:：]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeNumericTargetLength = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TARGET_LENGTH;
  return Math.min(Math.max(parsed, MIN_TARGET_CHAR_COUNT), MAX_TARGET_CHAR_COUNT);
};

const getExplicitTargetCharCount = (form = {}) => {
  const candidates = [
    form.targetCharCount,
    form.targetCharCountInput,
    form.customTargetLength,
    form.targetLength,
    form.targetLengthOption
  ];

  for (const candidate of candidates) {
    const raw = text(candidate);
    if (!raw || /^(?:auto|short|medium|normal|long|자동 추천|자동|짧게|보통|길게)$/iu.test(raw)) continue;

    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return normalizeNumericTargetLength(parsed);
  }

  return null;
};

const normalizeTargetLengthOption = (form = {}) => {
  const raw = text(form.targetLengthOption || form.targetLengthMode || form.bodyLengthOption || "");
  const fromTargetLength = text(form.targetLength);
  const value = (raw || (/^(?:auto|short|medium|normal|long|자동 추천|자동|짧게|보통|길게)$/iu.test(fromTargetLength) ? fromTargetLength : "")).toLowerCase();

  if (/^(?:short|짧게)$/iu.test(value)) return "short";
  if (/^(?:medium|normal|보통)$/iu.test(value)) return "medium";
  if (/^(?:long|길게)$/iu.test(value)) return "long";
  return "auto";
};

const hasExplicitNumericTargetLength = (form = {}) =>
  Number.isFinite(getExplicitTargetCharCount(form));

const hasSparseRestaurantFallbackInput = (form = {}, category = inferReviewCategory(form)) => {
  if (category !== "restaurant" && category !== "cafe") return false;

  const memoCount = splitMemoLines(form.experienceMemo || form.memory || form.memo).length;
  const imageCount = getImageCount(form);
  const productInfoLength = text(form.productInfoText || form.productInfo || "").length;
  const imageDetailLength = getImageContextItems(form)
    .map((item) => `${item.note || ""} ${item.ocrText || ""}`)
    .join(" ")
    .trim().length;

  return memoCount <= 4 && imageCount <= 2 && productInfoLength < 160 && imageDetailLength < 140;
};

const getTargetLengthSettings = (form = {}, category = inferReviewCategory(form)) => {
  const memoCount = splitMemoLines(form.experienceMemo).length;
  const imageCount = getImageCount(form);
  const sparseInput = memoCount <= 4 && imageCount === 0;
  const sparseFallbackInput = hasSparseRestaurantFallbackInput(form, category);

  if (hasExplicitNumericTargetLength(form)) {
    const requestedTarget = getExplicitTargetCharCount(form);
    if (sparseFallbackInput && requestedTarget > 1900) {
      return {
        option: "custom",
        target: 1700,
        min: 1200,
        max: 1900,
        requestedTarget,
        informationLimited: true
      };
    }

    const target = requestedTarget;
    return {
      option: "custom",
      target,
      min: Math.max(MIN_TARGET_CHAR_COUNT, target - 450),
      max: Math.min(MAX_TARGET_CHAR_COUNT, target + 550),
      requestedTarget
    };
  }

  const option = normalizeTargetLengthOption(form);

  if (option === "short") return { option, target: 1300, min: 1000, max: 1500 };
  if (option === "medium") return { option, target: 2200, min: 1800, max: 2500 };
  if (option === "long") return { option, target: 3200, min: 2800, max: 3500 };

  if (sparseInput && (category === "restaurant" || category === "cafe")) {
    return { option, target: 1300, min: 1000, max: 1600 };
  }

  if (sparseInput) return { option, target: 1400, min: 1000, max: 1800 };

  return {
    option,
    target: category === "product" ? 2200 : 2600,
    min: 2200,
    max: 3200
  };
};

const normalizeTargetLength = (value) => normalizeNumericTargetLength(value);

const getKeywordParts = (form = {}) =>
  uniqueText([
    ...splitCommaList(form.mainKeyword || form.keyword, 5).map(normalizeMainKeyword),
    ...splitCommaList(form.subKeywords, 5).map(normalizeMainKeyword)
  ]);

const getMainKeyword = (form = {}) =>
  resolveMainKeywordFromParts(getKeywordParts(form), form);

const getProductName = (form = {}) =>
  text(form.productName) || getMainKeyword(form);

const getRelatedKeywords = (form = {}) =>
  uniqueText([
    ...getKeywordParts(form).filter((keyword) => compact(keyword) !== compact(getMainKeyword(form))),
    ...getKeywordParts(form).slice(1),
    ...splitCommaList(form.emphasisPoints, 5)
  ]).slice(0, 5);

const getSubKeywords = (form = {}) => {
  const main = compact(getMainKeyword(form));

  return uniqueText([
    ...getKeywordParts(form).filter((keyword) => {
      const current = compact(keyword);
      return current !== main && !(main.includes(current) && current.length <= 4);
    }),
    ...collectBlogSubKeywords(form, getMainKeyword(form)),
    ...(/육짬/u.test(`${getMainKeyword(form)} ${text(form.productName)} ${text(form.mainKeyword)} ${text(form.keyword)}`) ? ["갈낙짬뽕"] : [])
  ])
    .filter((keyword) => {
      const current = compact(keyword);
      return current && current !== main && !(main.includes(current) && current.length <= 4);
    })
    .slice(0, 5);
};

const getKeywordRelatedText = (form = {}) => {
  const keywordRelated = getKeywordParts(form).slice(1);

  return keywordRelated.length > 0 ? keywordRelated.join(", ") : "생활 루틴";
};

const getAvoidWords = (form = {}) =>
  uniqueText([
    ...splitCommaList(form.avoidWords || form.avoid, 20),
    "무조건",
    "보장",
    "치료",
    "완치",
    "즉시효과",
    "100% 해결"
  ]);

const applyAvoidWords = (value, avoidWords) =>
  avoidWords.reduce((result, word) => result.replaceAll(word, "해당 표현"), value);

const softenSensitiveExpression = (value = "") =>
  text(value)
    .replace(/^경험\s*메모\s*[:：]\s*/u, "")
    .replace(/변비\s*해결/gu, "장 관리 고민을 살펴보는")
    .replace(/변비도\s*관리될\s*것\s*같고/gu, "장 관리 루틴도 함께 살펴볼 수 있을 것 같고")
    .replace(/라인이\s*점점\s*변화되고\s*있다/gu, "라인 관리 루틴을 기대해보고 싶었다")
    .replace(/라인이\s*변화/gu, "라인 관리 변화 기대")
    .replace(/해결/gu, "관리")
    .replace(/효과\s*보장/gu, "체감 기준")
    .replace(/즉시\s*효과/gu, "빠른 확인 포인트")
    .replace(/완치|치료/gu, "관리")
    .replace(/무조건/gu, "개인차는 있지만")
    .replace(/\s+/g, " ")
    .trim();

const PRODUCT_INFO_FIELD_LABELS = {
  productName: ["상품명", "제품명"],
  brandName: ["브랜드", "브랜드명"],
  category: ["카테고리", "분류"],
  ingredients: ["성분", "원료", "주요 성분", "주요 원료"],
  composition: ["구성", "구성품", "패키지"],
  usage: ["사용법", "섭취법", "섭취 방법", "사용 방법"],
  price: ["가격", "판매가"],
  capacity: ["용량", "중량", "함량"],
  features: ["특징", "포인트", "장점", "주요 특징"],
  cautions: ["주의사항", "주의", "섭취 시 주의"],
  purchaseNotes: ["구매처", "배송", "교환", "구매 전 확인"]
};

const PRODUCT_INFO_FIELDS = Object.keys(PRODUCT_INFO_FIELD_LABELS);
const FIELD_STATUS = {
  confirmed: "확인됨",
  review: "확인 필요",
  missing: "읽지 못함"
};

const FIELD_STATUS_RANK = {
  [FIELD_STATUS.confirmed]: 3,
  [FIELD_STATUS.review]: 2,
  [FIELD_STATUS.missing]: 1
};

const OCR_UI_NOISE_PATTERN =
  /마우스를\s*올려보세요|클릭|더보기|상세보기|이전|다음|닫기|공유|검색|장바구니|옵션|슬라이드|페이지|hover|mouse/iu;
const OCR_GIBBERISH_PATTERN = /^(?:[@&*#~^_=+|\\/<>[\]{}().,`'"!?%-]|\s)+$/u;
const SHORT_LATIN_NOISE_PATTERN = /^[a-z]{1,3}$/iu;
const NUMBER_SEQUENCE_PATTERN =
  /^(?:[0-9０-９]{1,3}|[0-9０-９]{1,3}\s*[.)-]?|이\s*)+(?:\s+[0-9０-９]{1,3})*$/u;
const PRODUCT_NAME_SIGNAL_PATTERN = /상품명|제품명|브랜드|브랜드명/u;
const FEATURE_SIGNAL_PATTERN =
  /간편|휴대|한\s*포|데일리|루틴|관리|무첨가|저자극|보습|흡수|사용감|수납|흡입|세척|구성|편의|가벼|부담|촉촉|산뜻/u;
const INGREDIENT_SIGNAL_PATTERN =
  /성분|원료|함유|추출물|분말|비타민|유산균|식이섬유|단백질|히알루론산|세라마이드|콜라겐|나이아신/u;
const COMPOSITION_SIGNAL_PATTERN = /구성|세트|개입|입\b|포\b|정\b|박스|패키지|구성품|본품|리필|증정/u;
const USAGE_SIGNAL_PATTERN = /하루|1일|1회|섭취|사용|물과\s*함께|아침|저녁|권장|적당량|발라|도포|흔들어/u;
const PRICE_SIGNAL_PATTERN = /(?:₩|원\b|가격|할인가|판매가|정가|[0-9]{1,3}(?:,[0-9]{3})+)/u;
const CAPACITY_SIGNAL_PATTERN = /(?:\d+(?:\.\d+)?\s*(?:g|G|kg|KG|ml|mL|ML|l|L|포|정|개입|매|박스|개|입)\b)|용량|중량|함량/u;
const CAUTION_SIGNAL_PATTERN =
  /주의|보관|알레르기|임산부|어린이|섭취\s*전|사용\s*전|직사광선|고온다습|질환|상담|피부\s*이상/u;
const PURCHASE_SIGNAL_PATTERN =
  /구매|배송|교환|반품|환불|판매처|구매처|스마트스토어|공식몰|문의|가격|구성|사용법|보관|개인차/u;
const HEALTH_OVERCLAIM_PATTERN = /치료|효과\s*보장|즉시\s*효과|즉시효과|완치|무조건|변비\s*해결\s*보장|독소\s*제거\s*보장/u;

const createEmptyProductInfoFields = () =>
  PRODUCT_INFO_FIELDS.reduce((result, field) => ({ ...result, [field]: "" }), {});

const createMissingProductInfoMeta = (reason = "이미지에서 읽은 값이 없습니다.") =>
  PRODUCT_INFO_FIELDS.reduce(
    (result, field) => ({
      ...result,
      [field]: {
        status: FIELD_STATUS.missing,
        confidence: 0,
        reason,
        source: ""
      }
    }),
    {}
  );

const cleanInfoLine = (value = "") =>
  sanitizeImageMetadataText(value)
    .replace(/^(OCR\s*원문|추출\s*데이터|추출\s*텍스트|이미지에서\s*읽은\s*상품\s*정보)\s*[:：]?\s*/u, "")
    .replace(/[|｜]+/g, " ")
    .replace(/[•·●○◆◇▶▷▪︎■□]+/gu, " ")
    .replace(/^[\s\-–—_:：.,/\\|()[\]{}]+/u, "")
    .replace(/[\s\-–—_:：.,/\\|()[\]{}]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

const isLikelyOcrNoise = (value = "") => {
  const cleaned = cleanInfoLine(value);
  const compacted = compact(cleaned);
  const letters = cleaned.match(/\p{L}/gu) || [];
  const digits = cleaned.match(/\p{N}/gu) || [];
  const symbols = cleaned.match(/[^\p{L}\p{N}\s]/gu) || [];

  if (!cleaned || compacted.length < 2) return true;
  if (OCR_UI_NOISE_PATTERN.test(cleaned)) return true;
  if (OCR_GIBBERISH_PATTERN.test(cleaned)) return true;
  if (NUMBER_SEQUENCE_PATTERN.test(cleaned)) return true;
  if (/^이\s*\d{1,2}(?:\s+\d{1,2})+$/u.test(cleaned)) return true;
  if (/^[&@#*]\s*[a-z]{1,3}$/iu.test(cleaned)) return true;
  if (SHORT_LATIN_NOISE_PATTERN.test(cleaned) && !/[A-Z]{2,}/u.test(cleaned)) return true;
  if (symbols.length > letters.length + digits.length && letters.length + digits.length <= 3) return true;
  if (digits.length > 0 && letters.length <= 1 && !CAPACITY_SIGNAL_PATTERN.test(cleaned) && !PRICE_SIGNAL_PATTERN.test(cleaned)) {
    return true;
  }

  return false;
};

const sanitizeExtractedInfoValue = (value = "") =>
  softenSensitiveExpression(value)
    .replace(/독소\s*제거\s*보장/gu, "클렌즈 관련 표현은 개인차가 있을 수 있음")
    .replace(/변비\s*해결\s*보장/gu, "장 관리 루틴에 참고")
    .replace(/\s+/g, " ")
    .trim();

const normalizeProductInfoCandidate = (field, value = "") => {
  let cleaned = sanitizeExtractedInfoValue(cleanInfoLine(value));
  if (!cleaned || isLikelyOcrNoise(cleaned)) return "";

  if (field === "price" && !PRICE_SIGNAL_PATTERN.test(cleaned)) return "";
  if (field === "capacity" && !CAPACITY_SIGNAL_PATTERN.test(cleaned)) return "";
  if (field === "usage" && !USAGE_SIGNAL_PATTERN.test(cleaned)) return "";
  if (field === "ingredients" && !INGREDIENT_SIGNAL_PATTERN.test(cleaned)) return "";
  if (field === "composition" && !COMPOSITION_SIGNAL_PATTERN.test(cleaned)) return "";
  if (field === "cautions" && !CAUTION_SIGNAL_PATTERN.test(cleaned)) return "";

  if (field === "features" && !FEATURE_SIGNAL_PATTERN.test(cleaned)) return "";
  if (["productName", "brandName"].includes(field)) {
    cleaned = cleaned.replace(/^(상품명|제품명|브랜드명|브랜드)\s*[:：]?\s*/u, "").trim();
    const hasKorean = /\p{Script=Hangul}/u.test(cleaned);
    const latinLength = (cleaned.match(/[a-z]/giu) || []).length;
    if (!hasKorean && latinLength < 3) return "";
    if (compact(cleaned).length < 2) return "";
  }

  return cleaned;
};

const createCandidateResult = ({ field, value, status, confidence, reason }) => {
  const normalizedValue = normalizeProductInfoCandidate(field, value);
  if (!field || !normalizedValue) return null;

  return {
    field,
    value: normalizedValue,
    status,
    confidence,
    reason
  };
};

const classifyProductInfoLine = (line = "") => {
  const cleaned = cleanInfoLine(line);
  const [rawLabel, ...rest] = cleaned.split(/[:：]/u);
  const value = rest.join(":").trim();
  const label = text(rawLabel);
  const hasOverclaim = HEALTH_OVERCLAIM_PATTERN.test(cleaned);

  if (value) {
    const field = PRODUCT_INFO_FIELDS.find((fieldKey) =>
      PRODUCT_INFO_FIELD_LABELS[fieldKey].some((candidate) => label.includes(candidate))
    );

    if (field) {
      return createCandidateResult({
        field,
        value,
        status: hasOverclaim ? FIELD_STATUS.review : FIELD_STATUS.confirmed,
        confidence: hasOverclaim ? 0.56 : 0.88,
        reason: hasOverclaim ? "과장 표현 가능성이 있어 확인이 필요합니다." : "라벨과 값이 함께 인식됐습니다."
      });
    }
  }

  if (PRICE_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "price",
      value: cleaned,
      status: FIELD_STATUS.confirmed,
      confidence: 0.86,
      reason: "가격 표현이 인식됐습니다."
    });
  }

  if (USAGE_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "usage",
      value: cleaned,
      status: /사용법|섭취법|하루|1일|1회|물과\s*함께/u.test(cleaned) ? FIELD_STATUS.confirmed : FIELD_STATUS.review,
      confidence: /사용법|섭취법|하루|1일|1회|물과\s*함께/u.test(cleaned) ? 0.82 : 0.62,
      reason: "사용 또는 섭취 흐름으로 보이는 표현입니다."
    });
  }

  if (INGREDIENT_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "ingredients",
      value: cleaned,
      status: /성분|원료|함유/u.test(cleaned) ? FIELD_STATUS.confirmed : FIELD_STATUS.review,
      confidence: /성분|원료|함유/u.test(cleaned) ? 0.82 : 0.62,
      reason: "성분 또는 원료 관련 표현입니다."
    });
  }

  if (CAUTION_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "cautions",
      value: cleaned,
      status: FIELD_STATUS.confirmed,
      confidence: 0.82,
      reason: "주의사항 관련 표현입니다."
    });
  }

  if (CAPACITY_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "capacity",
      value: cleaned,
      status: /\d/u.test(cleaned) ? FIELD_STATUS.confirmed : FIELD_STATUS.review,
      confidence: /\d/u.test(cleaned) ? 0.82 : 0.58,
      reason: "용량 또는 수량 단위가 인식됐습니다."
    });
  }

  if (COMPOSITION_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "composition",
      value: cleaned,
      status: /\d|본품|리필|구성|세트/u.test(cleaned) ? FIELD_STATUS.confirmed : FIELD_STATUS.review,
      confidence: /\d|본품|리필|구성|세트/u.test(cleaned) ? 0.78 : 0.6,
      reason: "구성 또는 패키지 관련 표현입니다."
    });
  }

  if (PURCHASE_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "purchaseNotes",
      value: cleaned,
      status: FIELD_STATUS.review,
      confidence: 0.58,
      reason: "구매 전 확인할 만한 표현입니다."
    });
  }

  if (PRODUCT_NAME_SIGNAL_PATTERN.test(cleaned) && value) {
    return createCandidateResult({
      field: label.includes("브랜드") ? "brandName" : "productName",
      value,
      status: FIELD_STATUS.review,
      confidence: 0.6,
      reason: "상품명 또는 브랜드명 후보입니다."
    });
  }

  if (FEATURE_SIGNAL_PATTERN.test(cleaned)) {
    return createCandidateResult({
      field: "features",
      value: cleaned,
      status: /특징|장점|포인트|간편|무첨가|저자극|보습|사용감/u.test(cleaned)
        ? FIELD_STATUS.confirmed
        : FIELD_STATUS.review,
      confidence: /특징|장점|포인트|간편|무첨가|저자극|보습|사용감/u.test(cleaned) ? 0.76 : 0.58,
      reason: "상품 장점으로 보이는 표현입니다."
    });
  }

  return null;
};

export const extractProductInfoFieldsWithMetaFromText = (value = "") => {
  const fields = createEmptyProductInfoFields();
  const meta = createMissingProductInfoMeta();

  text(value)
    .split(/\n|[·•]/u)
    .map(cleanInfoLine)
    .filter((line) => line.length >= 2)
    .filter((line) => !isLikelyOcrNoise(line))
    .forEach((line) => {
      const candidate = classifyProductInfoLine(line);
      if (!candidate?.field || !candidate.value) return;

      const currentMeta = meta[candidate.field] || { status: FIELD_STATUS.missing, confidence: 0 };
      const currentRank = FIELD_STATUS_RANK[currentMeta.status] || 0;
      const nextRank = FIELD_STATUS_RANK[candidate.status] || 0;
      const existingValues = fields[candidate.field]
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      const duplicate = existingValues.some((item) => compact(item) === compact(candidate.value));

      if (!fields[candidate.field] || nextRank > currentRank || candidate.confidence > currentMeta.confidence) {
        fields[candidate.field] = candidate.value;
        meta[candidate.field] = {
          status: candidate.status,
          confidence: candidate.confidence,
          reason: candidate.reason,
          source: candidate.value
        };
        return;
      }

      if (!duplicate && existingValues.length < 3 && nextRank >= currentRank && candidate.status === currentMeta.status) {
        fields[candidate.field] = [...existingValues, candidate.value].join("\n");
        meta[candidate.field] = {
          ...currentMeta,
          confidence: Math.max(currentMeta.confidence || 0, candidate.confidence),
          source: fields[candidate.field]
        };
      }
    });

  return { fields, meta };
};

export const extractProductInfoFieldsFromText = (value = "") => {
  return extractProductInfoFieldsWithMetaFromText(value).fields;
};

const getProductInfoField = (form = {}, field) =>
  text(form[field]) || text(extractProductInfoFieldsFromText(form.productInfoText)[field]);

const summarizeProductInfo = (form = {}) => {
  const extracted = extractProductInfoFieldsFromText(form.productInfoText);
  const merged = {
    ...extracted,
    productName: text(form.productName) || extracted.productName,
    brandName: text(form.brandName) || extracted.brandName,
    category: text(form.category) || extracted.category,
    ingredients: text(form.ingredients) || extracted.ingredients,
    composition: text(form.composition) || extracted.composition,
    usage: text(form.usage) || extracted.usage,
    price: text(form.price) || extracted.price,
    capacity: text(form.capacity) || extracted.capacity,
    features: text(form.features) || extracted.features,
    cautions: text(form.cautions) || extracted.cautions,
    purchaseNotes: text(form.purchaseNotes) || extracted.purchaseNotes
  };

  return PRODUCT_INFO_FIELDS.map((field) => ({
    field,
    value: text(merged[field])
  })).filter((item) => item.value);
};

const createSituationSentence = (form = {}) => {
  const productName = getProductName(form);
  const tone = normalizeTone(form.tone);
  const memoLines = splitMemoLines(form.experienceMemo);
  const firstMemo = softenSensitiveExpression(memoLines[0] || "").replace(/[.。]+$/u, "");
  const keywordRelatedText = getKeywordRelatedText(form);

  if (firstMemo.includes(productName)) {
    if (tone === "전문적인") {
      return `${productName}는 ${keywordRelatedText} 관련 정보를 검토하다가 관심을 갖게 된 제품입니다`;
    }
    if (tone === "차분한") {
      return `${productName}는 ${keywordRelatedText} 정보를 살펴보다가 관심을 갖게 된 제품입니다`;
    }
    return `${productName}는 ${keywordRelatedText} 쪽으로 정보를 찾아보다가 궁금해진 제품이에요`;
  }

  if (firstMemo) {
    const normalizedMemo = firstMemo
      .replace(/만난 제품이다$/u, "알게 된 제품")
      .replace(/제품이다$/u, "제품")
      .replace(/알게 됐다$/u, "알게 된 제품")
      .replace(/습니다$/u, "어요");

    if (tone === "전문적인") return `${productName}는 ${normalizedMemo}입니다`;
    if (tone === "차분한") return `${productName}는 ${normalizedMemo}입니다`;
    if (tone === "활기찬") return `${productName}는 ${normalizedMemo}이에요`;
    return `${productName}는 ${normalizedMemo}이에요`;
  }

  const related = getRelatedKeywords(form)[0] || "생활 루틴";
  if (tone === "전문적인") return `${productName}는 ${related} 정보를 확인할 때 검토할 만한 제품입니다`;
  if (tone === "차분한") return `${productName}는 ${related} 정보를 살펴보다가 관심이 간 제품입니다`;
  return `${productName}는 ${related} 정보를 찾아보다가 자연스럽게 관심이 간 제품이에요`;
};

const reviewCategoryValues = new Set([
  "product",
  "restaurant",
  "cafe",
  "store",
  "education",
  "hospital",
  "service",
  "travel",
  "experience",
  "kids-place",
  "information",
  "comparison",
  "place"
]);

const reviewCategoryAliases = new Map([
  ["상품 후기", "product"],
  ["맛집 후기", "restaurant"],
  ["카페 후기", "cafe"],
  ["매장 방문 후기", "store"],
  ["매장 후기", "store"],
  ["병원/관리 후기", "hospital"],
  ["병원/시술/관리 후기", "hospital"],
  ["병원/시술 후기", "hospital"],
  ["병원 후기", "hospital"],
  ["관리 후기", "hospital"],
  ["교육/강의 후기", "education"],
  ["교육 후기", "education"],
  ["강의 후기", "education"],
  ["체험/클래스 후기", "experience"],
  ["체험 후기", "experience"],
  ["클래스 후기", "experience"],
  ["아이와 갈만한 곳 후기", "kids-place"],
  ["아이 동반 장소 후기", "kids-place"],
  ["여행/숙소 후기", "travel"],
  ["여행 후기", "travel"],
  ["숙소 후기", "travel"],
  ["서비스 이용 후기", "service"],
  ["서비스 후기", "service"],
  ["정보 정리형 글", "information"],
  ["정보 정리형", "information"],
  ["정보글", "information"],
  ["구매 전 비교/체크리스트형 글", "comparison"],
  ["구매 전 비교형", "comparison"],
  ["비교형", "comparison"],
  ["체크리스트형", "comparison"]
]);

const normalizeReviewCategoryValue = (value = "") => {
  const normalized = text(value);
  if (!normalized) return "";
  if (reviewCategoryValues.has(normalized)) return normalized;
  return reviewCategoryAliases.get(normalized) || "";
};

const getImageContextItems = (form = {}) =>
  Array.isArray(form.imageContext)
    ? form.imageContext
        .map((item, index) => ({
          index: Number(item.index) || index + 1,
          name: sanitizeReviewSourceText(item.name),
          note: sanitizeReviewSourceText(item.note),
          ocrText: sanitizeReviewSourceText(item.ocrText)
        }))
        .filter((item) => item.name || item.note || item.ocrText)
    : [];

const getImageCount = (form = {}) => {
  const declaredCount = Number.parseInt(form.imageCount, 10);
  return Math.min(
    Math.max(Number.isFinite(declaredCount) ? declaredCount : 0, getImageContextItems(form).length),
    10
  );
};

const getImageContextHighlights = (form = {}) =>
  getImageContextItems(form)
    .flatMap((item) => [item.note, item.ocrText, item.name])
    .map(sanitizeReviewSourceText)
    .filter(Boolean)
    .filter((item) => !isLikelyOcrNoise(item))
    .slice(0, 4);

const getImageContextSummary = (form = {}, category = "place") => {
  const highlights = getImageContextItems(form)
    .flatMap((item) => [item.note, item.ocrText, item.name])
    .map(sanitizeReviewSourceText)
    .filter(Boolean)
    .filter((item) => !isLikelyOcrNoise(item))
    .slice(0, 3);
  const imageCount = getImageCount(form);
  const highlightText = highlights.length > 0
    ? highlights
        .map((item) =>
          item
            .replace(/^(?:강의\s*안내|수업\s*분위기)?\s*(?:사진|이미지)(?:에서|으로)?\s*/u, "")
            .trim()
        )
        .filter(Boolean)
        .join(", ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/^,\s*/u, "")
        .trim()
    : "";

  if (!imageCount) return "";

  if (category === "education") {
    return highlightText
      ? `강의 안내 이미지에서 ${highlightText} 내용을 확인할 수 있어서 처음 보는 사람도 수업 흐름을 잡기 쉬웠어요`
      : "수업 분위기를 보여주는 이미지가 있어 처음 듣는 사람도 부담 없이 확인할 수 있었습니다";
  }

  if (category === "restaurant") {
    return highlightText
      ? `사진으로 ${highlightText}를 함께 보니 메뉴와 분위기를 더 쉽게 떠올릴 수 있었어요`
      : "사진을 함께 보니 방문 전 분위기와 메뉴 구성을 더 쉽게 떠올릴 수 있었어요";
  }

  if (category === "cafe") {
    return highlightText
      ? `사진으로 ${highlightText}를 함께 보니 음료와 공간 분위기를 더 쉽게 떠올릴 수 있었어요`
      : "사진을 함께 보니 좌석, 음료, 공간 분위기를 방문 전부터 더 쉽게 떠올릴 수 있었어요";
  }

  if (category === "product") {
    return highlightText
      ? `사진으로 ${highlightText}를 보면서 사용 전 느낌을 조금 더 구체적으로 상상할 수 있었어요`
      : "사진을 함께 보니 패키지와 사용감을 더 쉽게 떠올릴 수 있었어요";
  }

  if (category === "store") {
    return highlightText
      ? `사진으로 ${highlightText}를 확인하니 매장 분위기와 상담 흐름을 더 자연스럽게 떠올릴 수 있었어요`
      : "사진을 함께 보니 처음 방문하는 사람도 매장 분위기와 상담 흐름을 미리 그려보기 좋았어요";
  }

  if (category === "hospital") {
    return highlightText
      ? `사진으로 ${highlightText}를 확인하니 접수부터 상담까지의 분위기를 미리 살펴보기 좋았어요`
      : "사진을 함께 보니 처음 방문하기 전 접수와 대기 분위기를 조금 더 쉽게 떠올릴 수 있었어요";
  }

  if (category === "service") {
    return highlightText
      ? `사진으로 ${highlightText}를 확인하니 상담 과정과 진행 방식을 더 구체적으로 떠올릴 수 있었어요`
      : "사진을 함께 보니 서비스 진행 흐름과 상담 분위기를 미리 확인하기 좋았어요";
  }

  if (category === "travel") {
    return highlightText
      ? `사진으로 ${highlightText}를 확인하니 여행 동선과 현장 분위기가 더 생생하게 그려졌어요`
      : "사진을 함께 보니 여행지 분위기와 이동 동선을 미리 떠올리기 좋았어요";
  }

  if (category === "experience") {
    return highlightText
      ? `사진으로 ${highlightText}를 확인하니 체험 흐름과 기억에 남은 장면이 더 자연스럽게 이어졌어요`
      : "사진을 함께 보니 체험 순서와 현장 분위기를 미리 떠올리기 좋았어요";
  }

  if (category === "kids-place") {
    return highlightText
      ? `사진으로 ${highlightText}를 확인하니 아이와 가기 전 분위기를 잡기 쉬웠어요`
      : "사진을 함께 보니 아이가 머무를 공간과 보호자 동선을 미리 떠올리기 좋았어요";
  }

  if (category === "information" || category === "comparison") {
    return highlightText
      ? `사진으로 ${highlightText}를 확인하니 기준을 정리할 때 참고하기 좋았어요`
      : "";
  }

  return highlightText
    ? `사진으로 ${highlightText}를 확인하니 방문 전 분위기가 더 잘 그려졌어요`
    : "사진을 함께 보니 처음 방문하는 사람도 분위기와 동선을 미리 떠올리기 좋았어요";
};

const getReviewSignalText = (form = {}) =>
  [
    form.category,
    form.productName,
    form.brandName,
    form.mainKeyword,
    form.keyword,
    form.productInfoText,
    form.experienceMemo,
    form.emphasisPoints,
    ...getImageContextItems(form).flatMap((item) => [item.note, item.ocrText, item.name])
  ]
    .map(sanitizeReviewSourceText)
    .filter(Boolean)
    .join(" ");

const REVIEW_CATEGORY_SIGNAL_PATTERNS = {
  product:
    /제품|상품명|상품|샴푸|드라이샴푸|크림|세럼|앰플|패드|팩|보호대|수면양말|텀블러|가방|신발|패션|생활용품|착용|휴대|향|발림감|보송함|보송|효과|장점|아쉬운\s*점|떡진\s*머리|운동\s*후|사용감|제형|용량|성분/u,
  restaurant:
    /맛집|식당|음식점|메뉴|점심|저녁|회식|가족외식|방문\s*후기|양|맛|가격|웨이팅|직원\s*친절|중식|한식|양식|일식|파스타|피자|스테이크|고기|국밥|짬뽕|갈낙짬뽕|탕수육|어향가지/u,
  cafe:
    /카페|디저트|커피|음료|좌석|아이랑\s*카페|뷰\s*카페|조용한\s*카페|브런치|베이커리/u,
  store:
    /매장|방문|상담|사장님|응대|위치|외관|내부|금매입|금거래소|금은방|귀금속|금\s*시세|금시세|순금|돌반지|반지|목걸이|팔찌|아드님|2대째|이대째|수리|판매점|샵|주얼리|전문점|지점|공방/u,
  hospital:
    /병원|의원|피부관리|마사지|시술|접수|대기|설명|관리|예약|통증|회복|치과|한의원|피부과|정형외과|내과|검진|진료|의사|간호|처방|상담실/u,
  education:
    /강의|수업|클래스|커리큘럼|교수|강사|수강|교육|입문|초보자|교육\s*과정|수강\s*과정|강의\s*과정|실습|공개강의|학원|입찰\s*흐름/u,
  experience:
    /체험|원데이클래스|만들기|키즈체험|활동|참여|프로그램|준비물|전시|행사|축제|팝업|공연/u,
  "kids-place":
    /아이랑|아이와|가족|주말|체험관|키즈|놀이터|박물관|전시|실내|실외|부모|아이\s*반응|아이/u,
  travel:
    /여행|숙소|호텔|펜션|리조트|조식|체크인|객실|위치|뷰|이동|공항|항공|코스|해변|바다|산책|관광|가이드투어/u,
  service:
    /신청|상담|이용|예약|견적|설치|수리|청소|대행|배송|일정|비용|이사|렌탈|보험|세무|노무|컨설팅|A\/?S|에이에스|입주청소/u,
  information:
    /방법|기준|차이|뜻|정리|체크리스트|알아보기|비교|가이드|주의사항|처음\s*시작|시작하는\s*방법|초보자\s*기준/u,
  comparison:
    /비교|추천|고르는\s*법|구매\s*전|장단점|체크포인트|체크\s*포인트|선택\s*기준|구매\s*기준/u
};

const hasReviewIntent = (value = "") => /후기|방문|사용\s*후기|이용\s*후기|수강\s*후기|체험\s*후기/u.test(value);
const hasCategorySignal = (signalText = "", category = "place") =>
  (REVIEW_CATEGORY_SIGNAL_PATTERNS[category] || /$a/u).test(signalText);
const STRONG_PRODUCT_REVIEW_PATTERN =
  /수분크림|드라이샴푸|샴푸|화장품|크림|세럼|앰플|패드|팩|보호대|수면양말|텀블러|생활용품|상품명|제품명|사용감|발림감|제형|성분|용량/u;
const STRONG_RESTAURANT_REVIEW_PATTERN =
  /맛집|식당|음식점|메뉴|파스타|피자|스테이크|고기|국밥|짬뽕|갈낙짬뽕|탕수육|어향가지|중식|한식|양식|일식/u;
const STRONG_STORE_REVIEW_PATTERN =
  /금매입|금거래소|금은방|귀금속|금\s*시세|금시세|매입|사장님|아드님|2대째|이대째|주얼리|판매점|매장|샵/u;

const inferReviewCategory = (form = {}) => {
  const explicit = normalizeReviewCategoryValue(form.category);
  if (explicit) return explicit;

  const signalText = getReviewSignalText(form);
  const topicText = [form.productName, form.mainKeyword, form.keyword].map(sanitizeReviewSourceText).filter(Boolean).join(" ");
  const topicHasReviewIntent = hasReviewIntent(topicText);

  if (hasCategorySignal(signalText, "comparison") && /구매\s*전|비교|고르는\s*법|선택\s*기준|장단점/u.test(topicText)) {
    return "comparison";
  }

  if (hasCategorySignal(signalText, "information") && !topicHasReviewIntent) {
    return "information";
  }

  if (hasCategorySignal(signalText, "cafe")) return "cafe";
  if (hasCategorySignal(signalText, "kids-place") && /아이랑|아이와|체험관|키즈|놀이터|박물관|아이\s*반응|실내\s*체험/u.test(signalText)) return "kids-place";
  if (STRONG_RESTAURANT_REVIEW_PATTERN.test(signalText)) return "restaurant";
  if (STRONG_STORE_REVIEW_PATTERN.test(signalText)) return "store";
  if (hasCategorySignal(signalText, "hospital")) return "hospital";
  if (hasCategorySignal(signalText, "education")) return "education";
  if (STRONG_PRODUCT_REVIEW_PATTERN.test(signalText) || hasCategorySignal(signalText, "product")) return "product";
  if (hasCategorySignal(signalText, "restaurant")) return "restaurant";
  if (hasCategorySignal(signalText, "travel")) return "travel";
  if (hasCategorySignal(signalText, "service")) return "service";
  if (hasCategorySignal(signalText, "store")) return "store";
  if (hasCategorySignal(signalText, "experience")) return "experience";
  if (/장소|방문|주차|동선|공간/u.test(signalText)) return "place";

  return "experience";
};

const getReviewProfile = (category) => {
  const profiles = {
    restaurant: {
      label: "맛집 후기",
      hashtagSeeds: ["맛집후기", "방문후기", "메뉴추천", "회식장소", "재방문기준"],
      imageSlots: [
        ["대표 메뉴 사진", "본문 초반에 대표 메뉴를 보여주는 사진"],
        ["메뉴 클로즈업", "국물, 재료, 메뉴 구성을 확인하기 좋은 사진"],
        ["전체 상차림", "주문 구성을 한눈에 보여주는 사진"],
        ["매장 분위기", "좌석과 공간 분위기를 참고할 수 있는 사진"],
        ["마무리 컷", "방문 전 확인할 점을 정리할 때 넣기 좋은 사진"]
      ]
    },
    cafe: {
      label: "카페 후기",
      hashtagSeeds: ["카페후기", "카페방문", "디저트카페", "좌석분위기", "카페추천"],
      imageSlots: [
        ["카페 외관 또는 입구", "방문 전 위치와 첫인상을 보여주는 사진"],
        ["음료 또는 디저트", "주문한 메뉴와 구성을 설명하기 좋은 사진"],
        ["좌석과 내부 분위기", "머무는 동안의 분위기를 보여주는 사진"],
        ["주차 또는 편의 정보", "방문 전 확인할 내용을 정리하기 좋은 사진"],
        ["마무리 컷", "재방문 기준을 정리하기 좋은 사진"]
      ]
    },
    product: {
      label: "상품 후기",
      hashtagSeeds: ["상품후기", "직접써본후기", "사용감후기", "추천대상", "구매전확인"],
      imageSlots: [
        ["제품 전체 사진", "패키지와 제품명이 보이는 대표 사진"],
        ["텍스처 또는 사용 장면", "사용감과 발림감을 설명하기 좋은 사진"],
        ["상세 정보 사진", "성분, 용량, 사용법을 확인할 수 있는 사진"],
        ["사용 후 보관 컷", "일상에서 쓰는 분위기를 보여주는 사진"],
        ["추천 대상 정리 컷", "마무리 전에 넣기 좋은 사진"]
      ]
    },
    store: {
      label: "매장 후기",
      hashtagSeeds: ["매장후기", "방문후기", "상담후기", "친절한응대", "방문전확인"],
      imageSlots: [
        ["매장 외관 또는 입구", "처음 방문할 때 위치와 첫인상을 보여주는 사진"],
        ["상담 공간", "응대 분위기와 상담 흐름을 설명하기 좋은 사진"],
        ["안내문 또는 확인 정보", "시세, 가격, 절차처럼 확인할 내용을 정리하기 좋은 사진"],
        ["내부 분위기", "처음 방문하는 사람이 부담 없이 볼 수 있는 공간 사진"],
        ["마무리 컷", "방문 후 느낀 점과 추천 대상을 정리하기 좋은 사진"]
      ]
    },
    hospital: {
      label: "병원 후기",
      hashtagSeeds: ["병원후기", "방문후기", "진료후기", "예약확인", "방문전확인"],
      imageSlots: [
        ["병원 외관 또는 입구", "처음 방문할 때 위치와 첫인상을 보여주는 사진"],
        ["접수 또는 대기 공간", "대기 분위기와 동선을 설명하기 좋은 사진"],
        ["안내문 또는 진료 정보", "예약, 진료 시간, 비용처럼 확인할 내용을 정리하기 좋은 사진"],
        ["상담 공간 분위기", "상담 과정에서 느낀 점을 자연스럽게 연결하기 좋은 사진"],
        ["마무리 기록", "방문 후 확인할 점을 정리하기 좋은 사진"]
      ]
    },
    service: {
      label: "서비스 후기",
      hashtagSeeds: ["서비스후기", "상담후기", "진행과정", "견적확인", "이용전확인"],
      imageSlots: [
        ["상담 전 확인 자료", "서비스를 알아보게 된 배경을 설명하기 좋은 사진"],
        ["진행 과정", "상담이나 작업 흐름을 보여주는 사진"],
        ["결과 확인 장면", "서비스 후 달라진 점을 설명하기 좋은 사진"],
        ["안내 정보", "비용, 예약, 진행 시간을 정리하기 좋은 사진"],
        ["마무리 컷", "추천 대상과 아쉬운 점을 정리하기 좋은 사진"]
      ]
    },
    travel: {
      label: "여행 후기",
      hashtagSeeds: ["여행후기", "여행코스", "동선추천", "숙소후기", "여행팁"],
      imageSlots: [
        ["여행지 첫 장면", "도착했을 때 분위기를 보여주는 사진"],
        ["이동 동선", "코스와 이동 흐름을 설명하기 좋은 사진"],
        ["기억에 남은 장소", "가장 좋았던 장면을 보여주는 사진"],
        ["숙소 또는 휴식 공간", "머무는 동안 편했는지 설명하기 좋은 사진"],
        ["마무리 컷", "다시 가고 싶은 기준을 정리하기 좋은 사진"]
      ]
    },
    experience: {
      label: "체험 후기",
      hashtagSeeds: ["체험후기", "방문후기", "체험기록", "준비물확인", "추천대상"],
      imageSlots: [
        ["체험 장소 첫 장면", "도착했을 때 분위기를 보여주는 사진"],
        ["체험 과정", "어떤 순서로 진행됐는지 보여주는 사진"],
        ["결과물 또는 기억에 남은 장면", "체험 후 남은 느낌을 설명하기 좋은 사진"],
        ["안내 정보", "준비물, 비용, 운영시간을 확인하기 좋은 사진"],
        ["마무리 컷", "추천 대상과 다시 해볼 기준을 정리하기 좋은 사진"]
      ]
    },
    "kids-place": {
      label: "아이 동반 장소 후기",
      hashtagSeeds: ["아이랑갈만한곳", "실내체험", "아이반응", "부모대기공간", "주차확인"],
      imageSlots: [
        ["입구 또는 전체 공간", "처음 도착했을 때 분위기를 보여주는 사진"],
        ["체험 공간", "아이가 실제로 좋아한 활동을 보여주는 사진"],
        ["동선 사진", "움직이는 순서와 공간 구성을 설명하기 좋은 사진"],
        ["부모 대기 공간", "보호자가 쉬거나 기다리는 환경을 보여주는 사진"],
        ["주차 또는 안내 정보", "방문 전 확인할 내용을 정리하기 좋은 사진"]
      ]
    },
    place: {
      label: "장소/체험 후기",
      hashtagSeeds: ["장소후기", "체험후기", "방문후기", "동선체크", "주차확인"],
      imageSlots: [
        ["입구 또는 대표 공간", "장소의 첫인상을 보여주는 사진"],
        ["체험 핵심 장면", "가장 기억에 남는 포인트를 보여주는 사진"],
        ["동선 또는 시설 사진", "이동 흐름과 편의시설을 설명하기 좋은 사진"],
        ["쉬는 공간", "머무르기 편한지 판단할 수 있는 사진"],
        ["안내 정보", "가격, 주차, 운영시간을 확인하기 좋은 사진"]
      ]
    },
    information: {
      label: "정보 정리형 글",
      hashtagSeeds: ["정보정리", "초보자가이드", "방법정리", "체크리스트", "주의사항"],
      imageSlots: [
        ["핵심 요약 이미지", "개념과 흐름을 한눈에 보여주는 사진"],
        ["기준 정리 이미지", "확인 기준을 정리하기 좋은 사진"],
        ["체크리스트 이미지", "주의할 점을 보여주는 사진"],
        ["예시 자료", "초보자가 이해하기 쉬운 참고 자료"],
        ["마무리 요약", "핵심 기준을 다시 정리하는 사진"]
      ]
    },
    comparison: {
      label: "구매 전 비교형 글",
      hashtagSeeds: ["구매전비교", "선택기준", "장단점정리", "체크포인트", "구매가이드"],
      imageSlots: [
        ["비교 대상 사진", "선택지를 한눈에 보여주는 사진"],
        ["장점 정리 이미지", "좋았던 점을 설명하기 좋은 사진"],
        ["아쉬운 점 확인 이미지", "구매 전 체크할 부분을 보여주는 사진"],
        ["사용 상황 예시", "누구에게 맞는지 설명하기 좋은 사진"],
        ["최종 기준 정리", "선택 기준을 마무리하기 좋은 사진"]
      ]
    },
    education: {
      label: "교육/강의 후기",
      hashtagSeeds: ["교육후기", "강의후기", "수업후기", "커리큘럼", "학습기록"],
      imageSlots: [
        ["교재 또는 준비물", "수업 전 준비 과정을 보여주는 사진"],
        ["수업 공간", "수업 분위기와 환경을 설명하기 좋은 사진"],
        ["실습 또는 결과물", "배운 내용을 보여주는 사진"],
        ["커리큘럼 안내", "수업 구성을 확인하기 좋은 사진"],
        ["마무리 기록", "수업 후 느낀 점을 정리할 때 넣기 좋은 사진"]
      ]
    }
  };

  return profiles[category] || profiles.place;
};

const getTitleVariantIndex = (form = {}) => {
  const parsed = Number.parseInt(form.titleVariantSeed ?? form.titleRefreshSeed ?? "0", 10);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

const SEO_TITLE_SUPPORT_PHRASES = {
  store: ["상담 분위기와 확인할 점", "방문 전 참고한 후기", "상담 기준 정리", "체크 포인트", "알아본 이유"],
  restaurant: ["방문 전 확인할 점", "가족 후기", "메뉴와 좌석 기준", "체크 포인트", "알아본 이유"],
  cafe: ["공간 분위기와 확인할 점", "카페 방문 후기", "좌석과 메뉴 기준", "방문 체크", "알아본 이유"],
  product: ["사용감과 확인할 점", "직접 써본 후기", "구매 전 기준", "사용 상황 체크", "알아본 이유"],
  education: ["수업 흐름과 확인할 점", "강의 후기", "커리큘럼 기준", "준비 체크", "알아본 이유"],
  hospital: ["방문 전 확인할 점", "상담 후기", "예약 기준", "접수 체크", "궁금했던 이유"],
  service: ["상담 과정과 확인할 점", "진행 후기", "비용 기준", "상담 체크", "알아본 이유"],
  travel: ["동선과 확인할 점", "여행 후기", "코스 기준", "방문 체크", "알아본 이유"],
  experience: ["체험 흐름과 확인할 점", "체험 후기", "준비물 기준", "참여 체크", "알아본 이유"],
  "kids-place": ["아이 반응과 확인할 점", "가족 후기", "체험 기준", "방문 체크", "알아본 이유"],
  information: ["핵심 기준과 확인할 점", "초보자 정리", "주의사항 기준", "체크리스트", "알아본 이유"],
  comparison: ["선택 기준과 확인할 점", "구매 전 비교", "장단점 기준", "체크 포인트", "알아본 이유"],
  place: ["방문 전 확인할 점", "직접 다녀온 후기", "이용 기준", "체크 포인트", "알아본 이유"]
};

const SEO_TITLE_EXPANSION_PHRASES = {
  store: [
    "상담 전 확인한 분위기와 방문 포인트",
    "처음 방문하며 느낀 상담 흐름과 확인할 점",
    "방문 전 알아두면 좋은 매입 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "금값 흐름 때문에 알아본 상담 기준과 포인트"
  ],
  restaurant: [
    "방문 전 확인한 메뉴와 분위기 포인트",
    "직접 다녀오며 느낀 식사 흐름과 후기",
    "가기 전 알아두면 좋은 좌석 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "모임 장소로 알아본 이유와 방문 포인트"
  ],
  cafe: [
    "방문 전 확인한 공간 분위기와 메뉴 포인트",
    "직접 머물며 느낀 좌석과 음료 후기",
    "가기 전 알아두면 좋은 주차와 좌석 기준",
    "좋았던 점과 아쉬운 점을 나눠본 카페 후기",
    "머물기 좋은 카페인지 알아본 이유와 포인트"
  ],
  product: [
    "사용 전 확인한 장점과 아쉬운 점",
    "직접 써보며 느낀 사용감과 실제 후기",
    "구매 전 알아두면 좋은 사용 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "필요한 순간에 알아본 이유와 사용 포인트"
  ],
  education: [
    "수강 전 확인한 준비 과정과 진행 흐름",
    "직접 들어보며 느낀 수업 흐름과 후기",
    "신청 전 알아두면 좋은 커리큘럼 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "초보자 입장에서 알아본 이유와 확인 포인트"
  ],
  hospital: [
    "방문 전 확인한 접수 흐름과 안내 분위기",
    "직접 방문하며 느낀 상담 분위기와 후기",
    "예약 전 알아두면 좋은 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "처음 방문 전 궁금했던 기준과 포인트"
  ],
  service: [
    "상담 전 확인한 진행 기준과 체크 포인트",
    "직접 이용하며 느낀 진행 흐름과 후기",
    "신청 전 알아두면 좋은 비용 기준과 확인할 점",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "처음 알아보게 된 이유와 상담 포인트"
  ],
  travel: [
    "방문 전 확인한 동선과 분위기 포인트",
    "직접 다녀오며 느낀 여행 흐름과 후기",
    "가기 전 알아두면 좋은 코스 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "사진을 보고 알아본 이유와 포인트"
  ],
  experience: [
    "처음 참여 전 확인한 준비 과정과 진행 흐름",
    "직접 경험하며 느낀 진행 흐름과 참여 포인트",
    "참여 전 알아두면 좋은 준비 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "궁금해서 알아본 이유와 참여 전 확인 포인트"
  ],
  "kids-place": [
    "방문 전 확인한 아이 반응과 동선 포인트",
    "직접 다녀오며 느낀 체험 흐름과 후기",
    "가기 전 알아두면 좋은 가족 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "아이와 가볼 만한지 알아본 포인트"
  ],
  information: [
    "처음 시작 전 알아둘 기준과 핵심 정리",
    "초보자 입장에서 정리한 흐름과 확인 포인트",
    "놓치기 쉬운 기준과 주의사항 체크리스트",
    "알아보기 전 비교하면 좋은 핵심 기준",
    "검색 전 궁금한 내용을 한 번에 정리한 가이드"
  ],
  comparison: [
    "구매 전 확인할 선택 기준과 체크 포인트",
    "직접 비교하기 전 알아둘 장점과 아쉬운 점",
    "고르기 전에 봐야 할 기준과 주의사항",
    "누구에게 맞는지 나눠본 구매 전 비교",
    "후회 줄이려고 먼저 확인한 선택 포인트"
  ],
  place: [
    "방문 전 확인한 분위기와 동선 포인트",
    "직접 다녀오며 느낀 이용 흐름과 후기",
    "가기 전 알아두면 좋은 기준과 체크 포인트",
    "좋았던 점과 아쉬운 점을 나눠본 실제 후기",
    "궁금해서 알아본 이유와 방문 포인트"
  ]
};

const escapeRegExp = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSeoTitleCandidate = (candidate = "", mainKeyword = "", category = "place", index = 0) => {
  const keyword = text(mainKeyword);
  let title = text(candidate)
    .replace(/인생|무조건|대박|효과\s*보장|완전\s*추천/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!keyword || !title) return title;

  if (!title.includes(keyword)) {
    title = `${keyword} ${title}`;
  } else if (title.indexOf(keyword) > 8) {
    title = `${keyword} ${title.replace(new RegExp(escapeRegExp(keyword), "u"), "").trim()}`;
  }

  let keywordCount = 0;
  title = title
    .replace(new RegExp(escapeRegExp(keyword), "gu"), (match) => {
      keywordCount += 1;
      return keywordCount === 1 ? match : "";
    })
    .replace(/\s+/g, " ")
    .trim();

  const visibleLength = Array.from(title).length;
  const reviewTitle = withReviewTitleSuffix(keyword);
  const nonReviewTitleCategories = new Set(["information", "comparison"]);
  const titlePrefix = nonReviewTitleCategories.has(category) ? keyword : reviewTitle;
  const simpleReviewTitle = compact(title) === compact(reviewTitle);

  if (category === "restaurant" && visibleLength < 28 && !simpleReviewTitle && visibleLength >= 24) {
    title = /기록$/u.test(title) ? `${title} 모음` : /후기/u.test(title) ? `${title} 기록` : `${title} 방문 후기`;
  } else if (visibleLength < 28 || simpleReviewTitle) {
    const expansion =
      (SEO_TITLE_EXPANSION_PHRASES[category] || SEO_TITLE_EXPANSION_PHRASES.place)[index] ||
      (SEO_TITLE_SUPPORT_PHRASES[category] || SEO_TITLE_SUPPORT_PHRASES.place)[index] ||
      "방문 전 확인한 기준과 포인트";
    title = nonReviewTitleCategories.has(category)
      ? `${titlePrefix} ${expansion}`
      : `${titlePrefix}｜${expansion}`;
  }

  if (Array.from(title).length < 28) {
    const suffix = nonReviewTitleCategories.has(category)
      ? "체크 포인트"
      : "방문 전 체크 포인트까지 정리";
    title = `${title} ${suffix}`;
  }

  return title.replace(/\s+/g, " ").trim();
};

const createExperienceTitleCandidates = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const baseKeyword = getReviewTitleBase(mainKeyword);
  const titleKeyword = text(mainKeyword) || baseKeyword;
  const reviewKeyword = withReviewTitleSuffix(titleKeyword);
  const memoText = getFormMemoText(form);
  const hasGoldSignal = /금값|금\s*시세|금시세|매입|금거래소/u.test(`${titleKeyword} ${memoText}`);
  const hasKidsCafeSignal = /아이|카페|좌석|음료/u.test(`${titleKeyword} ${memoText}`);
  const hasDryShampooSignal = /드라이샴푸|운동|떡진|보송|휴대/u.test(`${titleKeyword} ${memoText}`);
  const primaryRestaurantMenu = getPrimaryRestaurantMenu(form, memoText);
  const restaurantMenuForTitle =
    primaryRestaurantMenu && !titleKeyword.includes(primaryRestaurantMenu) ? primaryRestaurantMenu : "";
  const secondaryTitleKeywords = getKeywordParts(form).slice(1);
  const restaurantPlaceKeyword =
    secondaryTitleKeywords.find((keyword) => /맛집|초지|강화|본점|근처|동네|역/u.test(keyword) && keyword !== restaurantMenuForTitle) ||
    "";
  const restaurantRegionKeyword =
    restaurantPlaceKeyword ||
    (/강화/u.test(`${titleKeyword} ${memoText}`) ? "강화도 맛집" : "") ||
    (/초지/u.test(`${titleKeyword} ${memoText}`) ? "초지대교 맛집" : "") ||
    "지역 맛집";
  const restaurantFamilyCue = /가족|여행|외식|아이/u.test(memoText);
  const restaurantFamilyPhrase = restaurantFamilyCue ? "가족여행 중 들른 곳" : "식사하며 들른 곳";
  const titleVariantIndex = getTitleVariantIndex(form);

  const titleMap = {
    store: hasGoldSignal
      ? [
          `${reviewKeyword} 상담 분위기와 방문 전 확인할 점`,
          `${titleKeyword} 처음 방문 전 상담 흐름 참고 후기`,
          `${titleKeyword} 알아볼 때 확인한 상담 기준과 시세 체크`,
          `${titleKeyword} 방문 전 봐야 할 매입 상담 체크 포인트`,
          `금값 오를 때 ${titleKeyword} 알아본 이유와 확인할 점`
        ]
      : [
          `${reviewKeyword} 상담 분위기와 방문 전 확인할 점`,
          `${titleKeyword} 처음 방문 전 응대 흐름 참고 후기`,
          `${titleKeyword} 알아볼 때 확인한 상담 기준 정리`,
          `${titleKeyword} 방문 전 봐야 할 체크 포인트`,
          `${titleKeyword} 처음 가기 전 궁금했던 이유와 후기`
        ],
    restaurant: restaurantMenuForTitle
      ? [
          `${titleKeyword} ${restaurantMenuForTitle} 후기 ${restaurantFamilyPhrase}`,
          `${titleKeyword} 후기 ${restaurantMenuForTitle}이 궁금했던 가족여행 맛집`,
          `${restaurantRegionKeyword} ${titleKeyword} ${restaurantMenuForTitle} 가족 방문 후기`,
          `${titleKeyword} ${restaurantMenuForTitle} 가족 식사로 다녀온 후기 기록`,
          `${titleKeyword} ${/강화/u.test(`${titleKeyword} ${memoText}`) ? "가족여행 중 들른" : "가족과 함께 들른"} ${restaurantMenuForTitle} 맛집 후기`
        ]
      : hasKidsCafeSignal
      ? [
          `${reviewKeyword} 아이 음료와 좌석 분위기 확인`,
          `${titleKeyword} 아이랑 방문 전 참고한 가족 후기`,
          `${titleKeyword} 알아볼 때 확인한 좌석과 메뉴 기준`,
          `${titleKeyword} 방문 전 봐야 할 가족 카페 체크 포인트`,
          `주말 가족 나들이로 ${titleKeyword} 알아본 이유`
        ]
      : [
          `${titleKeyword} 메뉴와 분위기가 기억에 남은 가족 식사 후기`,
          `${titleKeyword} 가족 외식으로 다녀온 분위기 후기 기록`,
          `${titleKeyword} 메뉴가 궁금했던 가족 식사 방문 후기 기록`,
          `${titleKeyword} 근처 식사 장소로 들른 방문 후기`,
          `${titleKeyword} 가족과 함께 들른 분위기 좋은 식사 후기`
        ],
    cafe: [
      `${reviewKeyword} 공간 분위기와 방문 전 확인할 점`,
      `${titleKeyword} 직접 머물며 느낀 음료와 좌석 후기`,
      `${titleKeyword} 알아볼 때 확인한 메뉴와 주차 기준`,
      `${titleKeyword} 방문 전 봐야 할 카페 체크 포인트`,
      `${titleKeyword} 머물기 좋은지 알아본 이유와 후기`
    ],
    product: hasDryShampooSignal
      ? [
          `${reviewKeyword} 운동 후 사용감과 확인할 점`,
          `${titleKeyword} 운동 후 직접 써본 보송함 후기`,
          `${titleKeyword} 알아볼 때 확인한 휴대성과 향 기준`,
          `${titleKeyword} 구매 전 봐야 할 사용 상황 체크 포인트`,
          `운동 후 머리 신경 쓰일 때 ${titleKeyword} 알아본 이유`
        ]
      : [
          `${reviewKeyword} 사용감과 구매 전 확인할 점`,
          `${titleKeyword} 직접 써본 장점과 아쉬운 점 후기`,
          `${titleKeyword} 알아볼 때 확인한 사용 기준 정리`,
          `${titleKeyword} 구매 전 봐야 할 체크 포인트`,
          `${titleKeyword} 생활 루틴에 맞는지 알아본 이유`
        ],
    education: [
      `${reviewKeyword} 수업 흐름과 수강 전 확인할 점`,
      `${titleKeyword} 처음 듣기 전 참고한 강의 후기`,
      `${titleKeyword} 알아볼 때 확인한 커리큘럼 기준`,
      `${titleKeyword} 수강 전 봐야 할 준비 체크 포인트`,
      `${titleKeyword} 초보자 입장에서 알아본 이유`
    ],
    hospital: [
      `${reviewKeyword} 접수 흐름과 방문 전 확인할 점`,
      `${titleKeyword} 처음 방문 전 참고한 상담 후기`,
      `${titleKeyword} 알아볼 때 확인한 예약과 안내 기준`,
      `${titleKeyword} 방문 전 봐야 할 접수 체크 포인트`,
      `${titleKeyword} 처음 진료 전 궁금했던 이유`
    ],
    service: [
      `${reviewKeyword} 상담 과정과 이용 전 확인할 점`,
      `${titleKeyword} 처음 이용 전 참고한 진행 후기`,
      `${titleKeyword} 알아볼 때 확인한 비용과 일정 기준`,
      `${titleKeyword} 신청 전 봐야 할 상담 체크 포인트`,
      `${titleKeyword} 맡기기 전 궁금했던 이유와 후기`
    ],
    travel: [
      `${reviewKeyword} 동선과 여행 전 확인할 점`,
      `${titleKeyword} 처음 가기 전 참고한 여행 후기`,
      `${titleKeyword} 알아볼 때 확인한 코스와 분위기 기준`,
      `${titleKeyword} 떠나기 전 봐야 할 동선 체크 포인트`,
      `${titleKeyword} 사진 보고 알아본 이유와 후기`
    ],
    experience: [
      `${reviewKeyword} 체험 흐름과 방문 전 확인할 점`,
      `${titleKeyword} 처음 참여 전 참고한 체험 후기`,
      `${titleKeyword} 알아볼 때 확인한 준비물과 진행 기준`,
      `${titleKeyword} 체험 전 봐야 할 체크 포인트`,
      `${titleKeyword} 직접 해보기 전 궁금했던 이유`
    ],
    "kids-place": [
      `${reviewKeyword} 아이 반응과 방문 전 확인할 점`,
      `${titleKeyword} 아이랑 가기 전 참고한 체험 후기`,
      `${titleKeyword} 알아볼 때 확인한 동선과 대기 기준`,
      `${titleKeyword} 방문 전 봐야 할 가족 체크 포인트`,
      `주말 아이와 갈 곳으로 ${titleKeyword} 알아본 이유`
    ],
    information: [
      `${titleKeyword} 처음 시작 전 확인할 핵심 기준`,
      `${titleKeyword} 초보자 기준으로 정리한 흐름`,
      `${titleKeyword} 알아볼 때 놓치기 쉬운 주의사항`,
      `${titleKeyword} 체크리스트로 보는 선택 기준`,
      `${titleKeyword} 궁금한 점을 먼저 정리한 이유`
    ],
    comparison: [
      `${titleKeyword} 구매 전 확인할 선택 기준`,
      `${titleKeyword} 비교하며 본 장점과 아쉬운 점`,
      `${titleKeyword} 고르기 전 봐야 할 체크 포인트`,
      `${titleKeyword} 누구에게 맞는지 나눠본 기준`,
      `${titleKeyword} 후회 줄이려고 알아본 비교 포인트`
    ],
    place: [
      `${reviewKeyword} 동선과 방문 전 확인할 점`,
      `${titleKeyword} 처음 가기 전 참고한 방문 후기`,
      `${titleKeyword} 알아볼 때 확인한 분위기와 편의 기준`,
      `${titleKeyword} 방문 전 봐야 할 체크 포인트`,
      `${titleKeyword} 직접 가보기 전 궁금했던 이유`
    ]
  };

  const titleVariantMap = {
    store: hasGoldSignal
      ? [
          [
            `${reviewKeyword} 시세 확인과 상담 기준 정리`,
            `${titleKeyword} 처음 알아볼 때 본 응대 흐름 후기`,
            `${titleKeyword} 방문 전 비교한 매입 기준과 설명`,
            `${titleKeyword} 상담 전 체크한 시세와 확인 포인트`,
            `${titleKeyword} 금값 오를 때 알아본 상담 기준`
          ]
        ]
      : [
          [
            `${reviewKeyword} 응대 흐름과 확인할 기준 정리`,
            `${titleKeyword} 처음 방문 전 살펴본 분위기 후기`,
            `${titleKeyword} 알아볼 때 비교한 상담 기준`,
            `${titleKeyword} 방문 전에 챙길 체크 포인트`,
            `${titleKeyword} 처음 알아본 이유와 실제 느낌`
          ]
        ],
    restaurant: restaurantMenuForTitle
      ? [
          [
            `${titleKeyword} ${restaurantMenuForTitle} 후기 가족여행 중 들른 곳`,
            `${titleKeyword} 후기 ${restaurantMenuForTitle}이 궁금했던 가족여행 맛집`,
            `${restaurantRegionKeyword} ${titleKeyword} ${restaurantMenuForTitle} 가족 방문 후기`,
            `${titleKeyword} ${restaurantMenuForTitle} 가족 식사로 다녀온 후기 기록`,
            `${titleKeyword} ${/강화/u.test(`${titleKeyword} ${memoText}`) ? "가족여행 중 들른" : "가족과 함께 들른"} ${restaurantMenuForTitle} 맛집 후기`
          ]
        ]
      : hasKidsCafeSignal
      ? [
          [
            `${reviewKeyword} 아이랑 가기 전 확인한 기준`,
            `${titleKeyword} 가족 방문 전 살펴본 좌석 후기`,
            `${titleKeyword} 알아볼 때 본 메뉴와 동선 기준`,
            `${titleKeyword} 아이 동반 전에 볼 체크 포인트`,
            `${titleKeyword} 주말 가족 카페로 본 이유`
          ]
        ]
      : [
          [
            `${titleKeyword} 메뉴와 분위기가 기억에 남은 가족 식사 후기`,
            `${titleKeyword} 가족 외식으로 다녀온 분위기 후기 기록`,
            `${titleKeyword} 메뉴가 궁금했던 가족 식사 방문 후기 기록`,
            `${titleKeyword} 근처 식사 장소로 들른 방문 후기`,
            `${titleKeyword} 가족과 함께 들른 분위기 좋은 식사 후기`
          ]
        ],
    cafe: [
      [
        `${reviewKeyword} 좌석과 분위기 기준 정리`,
        `${titleKeyword} 직접 머물며 살펴본 카페 후기`,
        `${titleKeyword} 알아볼 때 본 음료와 주차 기준`,
        `${titleKeyword} 방문 전에 비교한 체크 포인트`,
        `${titleKeyword} 오래 머물기 좋은지 본 이유`
      ]
    ],
    product: hasDryShampooSignal
      ? [
          [
            `${reviewKeyword} 운동 후 보송함과 휴대성 정리`,
            `${titleKeyword} 직접 써보며 느낀 향과 사용감`,
            `${titleKeyword} 알아볼 때 본 운동 후 사용 기준`,
            `${titleKeyword} 구매 전 비교한 장점과 아쉬운 점`,
            `${titleKeyword} 운동 가방에 넣기 좋은 이유와 후기`
          ]
        ]
      : [
          [
            `${reviewKeyword} 사용감과 구매 기준 정리`,
            `${titleKeyword} 직접 써보며 느낀 장점 후기`,
            `${titleKeyword} 알아볼 때 본 성분과 사용 기준`,
            `${titleKeyword} 구매 전에 비교한 체크 포인트`,
            `${titleKeyword} 내 루틴에 맞는지 살펴본 이유`
          ]
        ],
    education: [
      [
        `${reviewKeyword} 수업 흐름과 준비 기준 정리`,
        `${titleKeyword} 처음 듣기 전 살펴본 강의 후기`,
        `${titleKeyword} 알아볼 때 본 커리큘럼과 일정 기준`,
        `${titleKeyword} 수강 전에 비교한 체크 포인트`,
        `${titleKeyword} 초보자가 먼저 확인한 이유`
      ]
    ],
    hospital: [
      [
        `${reviewKeyword} 접수 흐름과 예약 기준 정리`,
        `${titleKeyword} 처음 방문 전 살펴본 상담 후기`,
        `${titleKeyword} 알아볼 때 본 안내와 대기 기준`,
        `${titleKeyword} 방문 전에 비교한 체크 포인트`,
        `${titleKeyword} 처음 진료 전 확인한 이유`
      ]
    ],
    service: [
      [
        `${reviewKeyword} 상담 과정과 이용 기준 정리`,
        `${titleKeyword} 처음 맡기기 전 살펴본 진행 후기`,
        `${titleKeyword} 알아볼 때 본 비용과 일정 기준`,
        `${titleKeyword} 신청 전에 비교한 체크 포인트`,
        `${titleKeyword} 이용 전 먼저 확인한 이유`
      ]
    ],
    travel: [
      [
        `${reviewKeyword} 동선과 여행 기준 정리`,
        `${titleKeyword} 처음 가기 전 살펴본 여행 후기`,
        `${titleKeyword} 알아볼 때 본 코스와 분위기 기준`,
        `${titleKeyword} 떠나기 전에 비교한 체크 포인트`,
        `${titleKeyword} 사진 보며 먼저 확인한 이유`
      ]
    ],
    experience: [
      [
        `${reviewKeyword} 체험 흐름과 준비 기준 정리`,
        `${titleKeyword} 처음 참여 전 살펴본 체험 후기`,
        `${titleKeyword} 알아볼 때 본 준비물과 진행 기준`,
        `${titleKeyword} 체험 전에 비교한 체크 포인트`,
        `${titleKeyword} 직접 해보기 전 확인한 이유`
      ]
    ],
    "kids-place": [
      [
        `${reviewKeyword} 아이 반응과 동선 기준 정리`,
        `${titleKeyword} 아이랑 가기 전 살펴본 체험 후기`,
        `${titleKeyword} 알아볼 때 본 대기 공간과 동선`,
        `${titleKeyword} 방문 전에 비교한 가족 체크 포인트`,
        `${titleKeyword} 주말 아이와 갈 곳으로 본 이유`
      ]
    ],
    information: [
      [
        `${titleKeyword} 초보자 기준 핵심 흐름 정리`,
        `${titleKeyword} 처음 알아볼 때 본 기준과 주의점`,
        `${titleKeyword} 시작 전 확인할 체크리스트`,
        `${titleKeyword} 헷갈리는 부분을 나눈 가이드`,
        `${titleKeyword} 검색 전에 먼저 정리한 이유`
      ]
    ],
    comparison: [
      [
        `${titleKeyword} 구매 전 선택 기준 정리`,
        `${titleKeyword} 비교하며 살펴본 장점과 단점`,
        `${titleKeyword} 고르기 전 확인할 체크리스트`,
        `${titleKeyword} 내 상황에 맞는지 보는 기준`,
        `${titleKeyword} 후회 줄이려고 먼저 본 포인트`
      ]
    ],
    place: [
      [
        `${reviewKeyword} 동선과 방문 기준 정리`,
        `${titleKeyword} 처음 가기 전 살펴본 방문 후기`,
        `${titleKeyword} 알아볼 때 본 분위기와 편의 기준`,
        `${titleKeyword} 방문 전에 비교한 체크 포인트`,
        `${titleKeyword} 직접 가보기 전 확인한 이유`
      ]
    ]
  };
  const variantSets = titleVariantMap[category] || titleVariantMap.place || [];
  const sourceTitles =
    titleVariantIndex > 0 && variantSets.length > 0
      ? variantSets[(titleVariantIndex - 1) % variantSets.length]
      : titleMap[category] || titleMap.place;

  return uniqueText(sourceTitles)
    .map((title, index) => normalizeSeoTitleCandidate(title, titleKeyword, category, index))
    .filter(Boolean)
    .slice(0, 5);
};

const createExperienceHashtags = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const related = getRelatedKeywords(form);
  const profile = getReviewProfile(category);
  const primaryRestaurantMenu = category === "restaurant" ? getPrimaryRestaurantMenu(form, getFormMemoText(form)) : "";
  const yukjjamSeeds =
    category === "restaurant" && /육짬/u.test(`${mainKeyword} ${text(form.productName)} ${text(form.mainKeyword)} ${text(form.keyword)}`)
      ? [
          "육짬강화도본점",
          "육짬후기",
          "강화도맛집",
          "초지대교맛집",
          "갈낙짬뽕",
          "강화도가족여행",
          "강화도식사",
          "강화도짬뽕",
          "가족여행맛집",
          "맛집후기",
          "방문후기",
          "강화도여행코스",
          "갈낙짬뽕후기",
          "아이랑강화도",
          "강화도점심"
        ]
      : [];
  const genericSeeds =
    category === "product"
      ? ["생활후기", "후기정리", "구매전확인", "사용전확인"]
      : ["생활후기", "후기정리", "방문전확인", "정보정리"];

  return uniqueText(uniqueText([
    mainKeyword,
    withReviewHashSuffix(mainKeyword),
    ...related,
    ...related.map((item) => `${item}후기`),
    primaryRestaurantMenu,
    primaryRestaurantMenu ? `${primaryRestaurantMenu}후기` : "",
    ...yukjjamSeeds,
    ...createSecondaryKeywords(form, category),
    ...profile.hashtagSeeds,
    ...genericSeeds
  ])
    .map(toHashTag)
    .filter(Boolean))
    .slice(0, 15);
};

const createExperienceImageSuggestions = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const profile = getReviewProfile(category);
  const actualImageCount = getImageCount(form);
  const slotCount = Math.max(actualImageCount, 3);
  const placementLabels = [
    "도입부 사진",
    "첫 번째 소제목 아래",
    "본문 중간 사진",
    "확인 포인트 사진",
    "마무리 전 사진"
  ];
  const createBodySentence = (index, title, description) => {
    const sentenceMap = {
      restaurant: [
        "사진으로 보기에는 대표 메뉴의 국물과 재료 구성이 먼저 눈에 들어왔어요",
        "메뉴 클로즈업 사진이 있으면 실제 맛을 단정하지 않아도 어떤 구성을 확인하면 좋을지 자연스럽게 이어집니다",
        "전체 상차림 사진은 여러 메뉴를 함께 볼 때 주문 구성을 가늠하는 데 도움이 됩니다",
        "매장 분위기 사진이 있으면 좌석과 공간 느낌을 방문 전 참고하기 좋겠습니다",
        "마무리 컷을 함께 보면 가격, 대기, 운영시간처럼 확인할 정보를 정리하기 좋습니다"
      ],
      cafe: [
        "카페 외관 사진이 있으면 처음 방문할 때 위치와 분위기를 잡기 쉬워요",
        "음료나 디저트 사진이 있으면 주문 구성을 자연스럽게 설명할 수 있어요",
        "좌석과 내부 분위기 사진이 있으면 오래 머물기 괜찮은지 판단하기 좋아요",
        "주차나 안내 정보 사진은 방문 전 확인할 부분을 정리할 때 도움이 됩니다",
        "마무리 컷을 넣으면 재방문 기준을 차분하게 정리할 수 있어요"
      ],
      product: [
        "제품 전체 사진을 보니 패키지와 첫인상을 한눈에 확인할 수 있었어요",
        "사용 장면 사진이 있으면 발림감이나 질감이 어떤지 더 쉽게 떠올릴 수 있었어요",
        "상세 정보 사진을 함께 보면 성분이나 용량처럼 구매 전 확인할 부분을 놓치기 어렵겠더라고요",
        "일상에서 쓰는 모습이 보이면 실제 루틴에 넣었을 때의 느낌이 더 잘 전달돼요",
        "마무리 사진이 있으면 추천 대상을 정리하는 부분도 더 자연스럽게 이어집니다"
      ],
      store: [
        "매장 입구 사진을 보니 처음 방문할 때의 분위기와 위치를 미리 떠올리기 좋았어요",
        "상담 공간 사진이 있으면 응대가 편안했는지와 설명 흐름을 더 자연스럽게 전할 수 있어요",
        "안내문이나 확인 정보 사진을 함께 보면 시세나 절차처럼 바뀔 수 있는 부분을 정리하기 좋아요",
        "내부 분위기 사진이 있으면 처음 가는 사람도 부담이 덜한지 판단하기 쉬워요",
        "마무리 사진이 있으면 방문 후 느낀 점과 추천 대상을 차분하게 정리할 수 있습니다"
      ],
      hospital: [
        "외관이나 입구 사진을 보니 처음 찾아갈 때의 위치와 분위기를 미리 확인하기 좋았어요",
        "접수 공간 사진이 있으면 대기 흐름과 안내 분위기를 설명하기가 쉬워요",
        "안내문 사진은 예약, 진료 시간, 비용처럼 방문 전 확인할 부분을 정리할 때 도움이 됩니다",
        "상담 공간 분위기가 보이면 처음 방문하는 사람도 부담을 조금 덜 수 있어요",
        "마무리 기록 사진은 방문 후 확인할 점을 차분하게 정리하기 좋습니다"
      ],
      service: [
        "상담 전 확인 자료가 있으면 서비스를 알아보게 된 이유를 자연스럽게 설명하기 좋아요",
        "진행 과정 사진이 있으면 어떤 순서로 상담이나 작업이 이어졌는지 더 쉽게 전달돼요",
        "결과 확인 장면이 보이면 서비스 후 느낀 변화를 구체적으로 적기 좋아요",
        "안내 정보 사진은 비용, 예약, 진행 시간을 정리할 때 독자가 바로 참고하기 좋습니다",
        "마무리 컷을 함께 넣으면 추천 대상과 아쉬운 점을 자연스럽게 연결할 수 있어요"
      ],
      travel: [
        "여행지 첫 장면을 보니 도착했을 때의 분위기가 더 생생하게 떠올랐어요",
        "이동 동선 사진이 있으면 코스를 따라가듯 읽을 수 있어서 글 흐름이 편해져요",
        "기억에 남은 장소 사진은 좋았던 장면을 이야기하듯 풀어내기 좋아요",
        "숙소나 휴식 공간 사진이 있으면 머무는 동안 편했는지도 함께 전달됩니다",
        "마무리 컷은 다시 가고 싶은 기준을 정리할 때 자연스럽게 어울려요"
      ],
      experience: [
        "체험 장소 첫 장면을 보니 도착했을 때의 분위기를 미리 떠올리기 좋았어요",
        "체험 과정 사진이 있으면 어떤 순서로 진행됐는지 더 쉽게 설명할 수 있어요",
        "결과물이나 기억에 남은 장면 사진은 실제로 해본 느낌을 살리기 좋습니다",
        "안내 정보 사진은 준비물, 비용, 운영시간처럼 확인할 부분을 정리할 때 도움이 돼요",
        "마무리 컷을 넣으면 추천 대상과 다시 해볼 기준을 자연스럽게 정리할 수 있어요"
      ],
      "kids-place": [
        "전체 공간 사진을 보니 아이와 처음 들어갔을 때의 분위기를 미리 떠올리기 좋았어요",
        "체험 공간을 보여주는 사진이 있어 아이가 어떤 활동을 할 수 있는지 더 쉽게 보였어요",
        "동선 사진이 있으면 처음 가는 가족도 어디부터 움직이면 좋을지 감을 잡기 쉬워요",
        "부모 대기 공간 사진이 있으면 보호자가 기다리는 동안 편할지도 함께 확인할 수 있어요",
        "안내 정보 사진은 주차나 운영시간처럼 방문 전 확인할 부분을 정리할 때 도움이 됩니다"
      ],
      information: [
        "요약 이미지가 있으면 처음 보는 사람도 핵심 흐름을 더 쉽게 잡을 수 있어요",
        "기준 정리 이미지는 확인할 항목을 나눠 설명할 때 도움이 됩니다",
        "체크리스트 이미지는 주의할 점을 빠르게 훑어보기 좋습니다",
        "예시 자료가 있으면 초보자도 개념을 더 현실적으로 이해할 수 있어요",
        "마무리 요약 이미지는 마지막 정리를 깔끔하게 보여주기 좋습니다"
      ],
      comparison: [
        "비교 대상 사진이 있으면 선택지를 한눈에 보여주기 좋아요",
        "장점 정리 이미지는 어떤 기준이 맞는지 설명할 때 도움이 됩니다",
        "아쉬운 점 확인 이미지는 구매 전 체크할 부분을 자연스럽게 보여줘요",
        "사용 상황 예시는 누구에게 맞는지 설명할 때 글 흐름을 살려줍니다",
        "최종 기준 이미지는 선택 포인트를 정리하는 데 잘 맞습니다"
      ],
      place: [
        "대표 공간 사진을 보니 처음 방문했을 때의 분위기를 미리 떠올리기 좋았어요",
        "체험 핵심 장면이 보이면 무엇이 기억에 남았는지 글 흐름이 더 선명해져요",
        "시설 사진을 함께 보면 이동 동선과 편의성을 설명하기가 훨씬 쉬워요",
        "쉬는 공간을 보여주는 사진이 있으면 머무는 동안 편했는지도 자연스럽게 전달됩니다",
        "안내 정보 사진은 가격이나 운영시간처럼 확인이 필요한 내용을 정리할 때 좋아요"
      ],
      education: [
        "강의 안내 이미지에서 커리큘럼과 진행 흐름을 한눈에 볼 수 있었어요",
        "수업 분위기를 보여주는 이미지가 있어 처음 듣는 사람도 부담 없이 확인할 수 있었습니다",
        "실습이나 결과물 사진이 있으면 수업 후 무엇을 얻을 수 있는지 더 구체적으로 보였어요",
        "커리큘럼 안내 이미지를 함께 보니 어떤 순서로 배우는지 미리 확인할 수 있어서 좋았어요",
        "마무리 기록 사진이 있으면 수강 후 느낀 점을 정리하는 흐름도 더 자연스럽습니다"
      ]
    };
    const fallback = `${title}을 함께 보면 ${description}는 점이 더 자연스럽게 전달됩니다`;

    return (sentenceMap[category] || sentenceMap.place)[index] || fallback;
  };

  return Array.from({ length: Math.min(slotCount, 10) }, (_, index) => {
    const [title, description] = profile.imageSlots[index] || [
      "추가 사진",
      "본문 흐름에 맞춰 중간에 넣기 좋은 추가 사진"
    ];
    const placementLabel = placementLabels[index] || "추가 위치";

    return {
      id: `review-image-${index + 1}`,
      label: placementLabel,
      title,
      markerGuide: `${placementLabel}: ${title}`,
      description,
      directShotGuide: description,
      aiPrompt: `${mainKeyword} realistic blog review photo, natural light, no text overlay, no watermark`,
      searchKeyword: `${mainKeyword} ${title}`,
      bodySentence: index < actualImageCount ? createBodySentence(index, title, description) : ""
    };
  }).map((item, index) => ({
    ...item,
    marker: `${item.markerGuide} 위치에 넣으면 글 흐름이 자연스럽습니다.`
  }));
};

const createTitleCandidates = (form = {}) => {
  const reviewCategory = inferReviewCategory(form);
  return createExperienceTitleCandidates(form, reviewCategory);
};

const createHashtags = (form = {}) => {
  const reviewCategory = inferReviewCategory(form);
  return createExperienceHashtags(form, reviewCategory);
};

const createImageSuggestions = (form = {}) => {
  const reviewCategory = inferReviewCategory(form);
  return createExperienceImageSuggestions(form, reviewCategory);
};

const createImageMarker = (suggestions, index) => suggestions[index]?.bodySentence || "";

const getToneNudge = (tone) =>
  getToneProfile(tone).nudge;

const countOccurrences = (value = "", needle = "") => {
  if (!needle) return 0;

  return String(value).split(needle).length - 1;
};

const regexTest = (pattern, value = "") => {
  pattern.lastIndex = 0;
  return pattern.test(value);
};

const getMemoLineMatching = (memoLines = [], pattern) =>
  memoLines.find((line) => pattern.test(line)) || "";

const createReviewIntroFirstSentence = (form = {}, memoLines = []) => {
  const productName = getProductName(form);
  const tone = normalizeTone(form.tone);
  const relatedKeywords = getKeywordParts(form).slice(1);
  const hasSummerCue = memoLines.some((line) => /여름|다이어트|라인|몸 관리/u.test(line));
  const hasInnerBeauty = relatedKeywords.some((item) => /이너뷰티|뷰티/u.test(item));
  const hasDetox = relatedKeywords.some((item) => /디톡스|장/u.test(item));
  const seasonCue = hasSummerCue ? "여름이 시작되면서" : "생활 루틴을 조금 가볍게 바꿔보고 싶어서";
  const routineCue = hasInnerBeauty
    ? `가벼운 몸 관리와 ${relatedKeywords.find((item) => /이너뷰티/u.test(item)) || "이너뷰티"} 루틴`
    : hasDetox
      ? "가볍게 챙길 수 있는 관리 루틴"
      : "생활 속에서 챙기기 쉬운 루틴";

  if (tone === "전문적인") {
    return `${productName}는 ${routineCue}을 검토하는 과정에서 확인하게 된 제품입니다`;
  }

  if (tone === "차분한") {
    return `${productName}는 ${seasonCue} ${routineCue}을 살펴보다가 알게 된 제품입니다`;
  }

  if (tone === "활기찬") {
    return `${productName}는 ${seasonCue} ${routineCue}을 찾아보다가 알게 된 제품이에요`;
  }

  return `${productName}는 ${seasonCue} ${routineCue}을 찾아보다가 알게 된 제품이에요`;
};

const createReviewIntroConcernSentence = (form = {}, memoLines = []) => {
  const tone = normalizeTone(form.tone);
  const relatedKeywords = getKeywordParts(form).slice(1);
  const detoxKeyword = relatedKeywords.find((item) => /디톡스/u.test(item)) || "관리";
  const hasDigestiveCue = memoLines.some((line) => /변비|장|더부룩|속|무겁/u.test(line));
  const hasRoutineCue = memoLines.some((line) => /한 포|간편|챙기/u.test(line));

  if (tone === "전문적인") {
    return hasDigestiveCue
      ? `장 관리나 컨디션 관련 표현은 개인차가 크기 때문에, ${detoxKeyword} 관점에서도 섭취 방식과 주의사항을 함께 확인할 필요가 있습니다`
      : `구매 전에는 ${detoxKeyword} 관련 표현보다 섭취 방식, 구성, 주의사항을 우선 확인할 필요가 있습니다`;
  }

  if (tone === "차분한") {
    return hasDigestiveCue
      ? `평소 속이 더부룩하거나 몸이 무겁게 느껴질 때가 있어, 간편하게 챙길 수 있는 ${detoxKeyword} 제품을 차분히 살펴보게 되었습니다`
      : `복잡한 관리보다 부담 없이 이어갈 수 있는 ${detoxKeyword} 제품인지 확인해보고 싶었습니다`;
  }

  if (tone === "활기찬") {
    return hasDigestiveCue || hasRoutineCue
      ? `평소 속이 더부룩하거나 몸이 무겁게 느껴질 때가 있어서, 간편하게 챙길 수 있는 ${detoxKeyword} 제품이 더 눈에 들어오더라고요!`
      : `복잡한 관리보다 가볍게 챙길 수 있는 ${detoxKeyword} 제품인지 확인해보고 싶더라고요!`;
  }

  return hasDigestiveCue || hasRoutineCue
    ? `평소 속이 더부룩하거나 몸이 무겁게 느껴질 때가 있어서, 간편하게 챙길 수 있는 ${detoxKeyword} 제품이 궁금해지더라고요`
    : `복잡한 관리보다 부담 없이 챙길 수 있는 ${detoxKeyword} 제품인지 확인해보고 싶더라고요`;
};

const createReviewIntroClosingSentence = (form = {}) => {
  const productName = getProductName(form);
  const tone = normalizeTone(form.tone);

  if (tone === "전문적인") {
    return `이번 글에서는 ${productName}를 직접적인 효과로 단정하지 않고, 구매 전 확인 항목과 생활 루틴 적합성을 함께 살펴봅니다`;
  }

  if (tone === "차분한") {
    return `이번 글에서는 ${productName}를 직접적인 효과로 단정하지 않고, 구매 전 확인할 점과 생활 속에서 챙기기 쉬운 포인트를 함께 봅니다`;
  }

  if (tone === "활기찬") {
    return `이번 글에서는 ${productName}를 효과로 단정하지 않고, 구매 전 체크할 점과 생활 속에서 챙기기 쉬운 포인트를 함께 볼게요`;
  }

  return `이번 글에서는 ${productName}를 직접적인 효과로 단정하지 않고, 구매 전 확인할 점과 생활 속에서 챙기기 쉬운 포인트를 함께 볼게요`;
};

const trimMainKeywordDensity = (paragraph = "", keyword = "", targetCount = 2) => {
  if (!keyword || countOccurrences(paragraph, keyword) <= targetCount) return paragraph;

  let seen = 0;
  return paragraph.replace(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"), (match) => {
    seen += 1;
    return seen > targetCount ? "이 제품" : match;
  });
};

const polishIntroParagraph = (paragraph = "", form = {}) => {
  const mainKeyword = getMainKeyword(form);
  const relatedText = getKeywordRelatedText(form);
  const sentences = text(paragraph)
    .split(/(?<=[.!?。])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const uniqueSentences = [];
  const seenSentences = new Set();

  sentences.forEach((sentence) => {
    const key = sentence
      .replace(mainKeyword, "")
      .replace(relatedText, "")
      .replace(/\s+/g, " ")
      .trim();
    if (seenSentences.has(key)) return;
    seenSentences.add(key);
    uniqueSentences.push(sentence);
  });

  let polished = uniqueSentences.join(" ");
  polished = polished
    .replace(new RegExp(`(${relatedText} 쪽으로 정보를 찾아보다[^.?!。]*[.?!。])\\s*평소 ${relatedText} 쪽으로 정보를 찾아보다[^.?!。]*[.?!。]`, "u"), "$1")
    .replace(/궁금해진 제품이에요\.\s*평소 ([^.?!。]+) 궁금해졌어요\./u, "관심이 갔어요. 평소 $1 궁금해지더라고요.")
    .replace(/찾아보다가 궁금해진/u, "찾아보다가 알게 된")
    .replace(/궁금해졌어요\./u, "궁금해지더라고요.")
    .replace(/\s+/g, " ")
    .trim();

  return trimMainKeywordDensity(polished, mainKeyword, 2);
};

const createReviewIntroParagraph = (form = {}, memoLines = []) => {
  const tone = normalizeTone(form.tone);
  const sentences = [
    createReviewIntroFirstSentence(form, memoLines),
    createReviewIntroConcernSentence(form, memoLines),
    createReviewIntroClosingSentence(form)
  ].map((sentence) => createSentence(sentence, tone));

  return polishIntroParagraph(sentences.join(" "), form);
};

const polishGeneratedReviewBody = (body = "", form = {}) => {
  const paragraphs = normalizeBody(body).split(/\n{2,}/u);
  if (paragraphs.length === 0) return normalizeBody(body);

  paragraphs[0] = polishIntroParagraph(paragraphs[0], form);

  return normalizeBody(paragraphs.join("\n\n"));
};

const createProductInfoSection = (form = {}) => {
  const productName = getProductName(form);
  const mainKeyword = getMainKeyword(form);
  const related = getRelatedKeywords(form);
  const tone = normalizeTone(form.tone);
  const productInfoItems = summarizeProductInfo(form).filter(
    (item) => !["productName", "brandName"].includes(item.field)
  );
  const labelMap = {
    productName: "상품명",
    brandName: "브랜드명",
    category: "카테고리",
    ingredients: "주요 성분/원료",
    composition: "구성",
    usage: "사용법/섭취법",
    price: "가격",
    capacity: "용량",
    features: "주요 특징",
    cautions: "주의사항",
    purchaseNotes: "구매 전 확인할 점"
  };
  const entries = [
    ["상품명/브랜드명", productName],
    ["메인 키워드", mainKeyword],
    ["관련 키워드", related.join(", ")],
    ...productInfoItems.map((item) => [labelMap[item.field] || item.field, item.value])
  ].filter(([, value]) => value);

  return createSection("제품 정보 정리", [
    tone === "친근한"
      ? "마지막으로 구매 전에 다시 보기 쉽게 제품 정보를 정리해둘게요."
      : "마지막으로 구매 전 확인할 제품 정보를 정리합니다.",
    ...entries.map(([label, value]) => `${label}: ${value}`)
  ], tone);
};

const createMarkedSection = (heading, paragraphs = [], tone = "친근한", marker = "") =>
  [createSection(heading, paragraphs, tone), marker].filter(Boolean).join("\n\n");

const getDetectedSponsorshipType = (form = {}) => {
  const source = [form.experienceMemo, form.productInfoText, form.memo, form.notes].map(text).filter(Boolean).join(" ");
  if (!source) return "";

  if (/식사권\s*제공|식사권|식사\s*지원|식대\s*지원/u.test(source)) return "식사권 제공";
  if (/제품\s*제공|제품을\s*제공|제공받아/u.test(source)) return "제품 제공";
  if (/협찬|체험단|원고료|광고|지원받아/u.test(source)) return "지원";

  return "";
};

const getDisclosureSentence = (form = {}) => {
  const sponsorship = getDetectedSponsorshipType(form);
  if (!sponsorship) return "";
  if (sponsorship === "식사권 제공") {
    return "이 글은 식사권을 제공받아 방문한 후기로, 가족 식사 기준에서 참고할 만한 부분을 담았습니다";
  }
  if (sponsorship === "제품 제공") {
    return "이 글은 제품을 제공받아 작성한 후기이며, 실제 사용 상황에서 참고할 만한 부분을 중심으로 정리했습니다";
  }
  return "이 글은 지원을 받아 작성한 후기이며, 직접 참고할 만한 부분을 중심으로 정리했습니다";
};

const WRITING_GUIDE_PATTERN =
  /후기\s*흐름으로\s*정리해보려고|정리해보려고|기준으로\s*풀어두면\s*자연스럽|기준으로\s*풀어두면|중심으로\s*정리(?:했|하)|아래\s*내용은\s*정리했습니다|아래\s*내용은|글에\s*담아보겠습니다|이런\s*흐름으로\s*작성|과하게\s*단정하기보다|기준으로\s*볼\s*것\s*같아요|먼저\s*보려고\s*했|사진이\s*있다면|사진과\s*메모만으로도\s*초안|발행\s*전|본문\s*흐름|본문에서|글\s*흐름|글의\s*흐름|글을\s*읽는\s*사람|글\s*안에서|글이\s*더\s*구체적으로|자연스럽게\s*정리되는\s*느낌|광고처럼|작성\s*가이드|검색자가\s*궁금해할\s*포인트|제공된\s*메모|확인\s*필요\s*정보는\s*따로|최종\s*발행|네이버\s*검색|글의\s*중심이\s*분명해집니다|구체적으로\s*보완|글이\s*더\s*살아납니다|작성하면\s*좋습니다|작성하면|확인할\s*부분으로\s*남겨두는\s*편|확인할\s*부분|확인되지\s*않은\s*정보는|단정하지\s*않고|단정하지\s*않는\s*편|후기를\s*함께\s*보는\s*편|방문\s*전\s*확인할\s*항목|안전해요|실제\s*후기를\s*함께|맛집\s*후기답게|제공된\s*정보|사진과\s*함께\s*보완|정보가\s*없다면/u;

const removeWritingGuideParagraphs = (body = "") =>
  normalizeBody(body)
    .split(/\n{2,}/u)
    .filter((paragraph) => !WRITING_GUIDE_PATTERN.test(paragraph))
    .join("\n\n");

const getReviewObjectText = (keyword = "") => {
  const mainKeyword = text(keyword);
  if (!mainKeyword) return "후기를";
  return mainKeyword.endsWith("후기") ? `${mainKeyword}를` : `${mainKeyword} 후기를`;
};

const getMemoText = (memoLines = []) => memoLines.map(text).filter(Boolean).join("\n");

const hasMemoCue = (memoText = "", pattern) => pattern.test(memoText);

const getPartySize = (memoText = "") => {
  const match = memoText.match(/(\d+)\s*명/u);
  return match ? `${match[1]}명` : "";
};

const hasVisitedReviewCue = (memoText = "") =>
  /다녀|방문|먹어|먹었|사용|갔다|갔|좋았|기억|느꼈|들렀|들른/u.test(memoText);

const RESTAURANT_MENU_TERMS = [
  "갈낙짬뽕",
  "차돌짬뽕",
  "해물짬뽕",
  "고기짬뽕",
  "짬뽕",
  "짜장면",
  "탕수육",
  "어향가지",
  "볶음밥",
  "딤섬",
  "파스타",
  "피자",
  "스테이크",
  "국밥",
  "칼국수",
  "냉면",
  "라멘",
  "우동",
  "김밥",
  "고기",
  "갈비",
  "삼겹살",
  "커피",
  "디저트"
];

const getRestaurantMenus = (sourceText = "") => {
  const source = text(sourceText);
  const matched = RESTAURANT_MENU_TERMS.filter((menu) => source.includes(menu));
  const menus = [];

  matched.forEach((menu) => {
    if (!menus.some((existing) => existing.includes(menu))) menus.push(menu);
  });

  return uniqueText(menus);
};

const getPrimaryRestaurantMenu = (form = {}, memoText = "") =>
  getRestaurantMenus([
    form.experienceMemo,
    memoText,
    form.productName,
    form.mainKeyword,
    form.subKeywords,
    form.keyword,
    form.productInfoText
  ].map(text).filter(Boolean).join(" "))[0] ||
  (/육짬/u.test([form.productName, form.mainKeyword, form.keyword].map(text).join(" ")) ? "갈낙짬뽕" : "");

const createExperienceIntroSentence = (form = {}, category = "place", memoText = "") => {
  const mainKeyword = getMainKeyword(form);
  const reviewObject = getReviewObjectText(mainKeyword);
  const partySize = getPartySize(memoText);
  const partySubject = partySize ? `${partySize}이` : "여럿이";

  if (category === "restaurant") {
    return `${reviewObject} 찾는 분이라면, ${partySubject} 함께 나눠 먹기 좋은 메뉴와 분위기를 먼저 보게 되더라고요`;
  }

  if (category === "product") {
    return `${reviewObject} 찾는 분이라면, 발림감이나 향처럼 매일 쓰면서 바로 느껴지는 부분이 먼저 궁금해지더라고요`;
  }

  if (category === "store") {
    return `${reviewObject} 찾는 분이라면, 처음 방문했을 때 응대가 편한지와 설명을 믿고 들을 수 있는지가 먼저 궁금해지더라고요`;
  }

  if (category === "hospital") {
    return `${reviewObject} 찾는 분이라면, 접수부터 상담까지 부담 없이 안내받을 수 있는지가 먼저 궁금해지더라고요`;
  }

  if (category === "service") {
    return `${reviewObject} 찾는 분이라면, 상담 과정이 친절한지와 내가 원하는 부분을 잘 이해해주는지가 먼저 궁금해지더라고요`;
  }

  if (category === "travel") {
    return `${reviewObject} 찾는 분이라면, 실제 동선이 편한지와 사진으로 본 분위기가 현장에서도 괜찮은지가 먼저 궁금해지더라고요`;
  }

  if (category === "experience") {
    return `${reviewObject} 찾는 분이라면, 처음 가도 어렵지 않은지와 실제 체험 흐름이 어떤지가 먼저 궁금해지더라고요`;
  }

  if (category === "kids-place") {
    return `${reviewObject} 찾는 분이라면, 아이 반응과 부모가 기다리기 편한 공간인지가 먼저 궁금해지더라고요`;
  }

  if (category === "education") {
    if (/세관공매/u.test(mainKeyword)) {
      return `${mainKeyword}를 찾아보기 전에는 세관공매라는 단어 자체가 어렵게 느껴졌어요`;
    }
    return `${reviewObject} 찾는 분이라면, 수업 흐름과 처음 듣는 사람이 따라가기 편한지가 먼저 궁금해지더라고요`;
  }

  return `${reviewObject} 찾는 분이라면, 실제 동선과 머무는 동안 편했는지가 먼저 궁금해지더라고요`;
};

const createSearchAnswerSentence = (form = {}, category = "place", memoText = "") => {
  const mainKeyword = getMainKeyword(form);
  const baseKeyword = getReviewTitleBase(mainKeyword);

  if (category === "restaurant") {
    return `${baseKeyword} 장소를 볼 때는 메뉴가 나눠 먹기 좋은지, 인원수에 맞는 구성이 가능한지, 가격과 주차는 미리 확인해야 하는지를 같이 보면 좋아요`;
  }

  if (category === "cafe") {
    return `${baseKeyword}를 볼 때는 음료와 디저트뿐 아니라 좌석, 소음, 주차처럼 머무는 기준을 함께 확인하면 좋아요`;
  }

  if (category === "product") {
    return `${baseKeyword} 제품을 고를 때는 사용감, 향, 아침저녁 사용 부담, 끈적임처럼 매일 쓰는 순간에 느껴지는 기준을 함께 보는 게 좋아요`;
  }

  if (category === "store") {
    return `${baseKeyword}를 볼 때는 상담 과정, 응대 분위기, 시세나 비용처럼 바뀔 수 있는 정보를 함께 확인하면 좋아요`;
  }

  if (category === "hospital") {
    return `${baseKeyword}를 알아볼 때는 예약 방법, 대기 시간, 상담 흐름, 비용처럼 방문 전에 궁금한 부분을 나눠 확인하면 좋아요`;
  }

  if (category === "service") {
    return `${baseKeyword}를 이용하기 전에는 상담 방식, 진행 순서, 비용과 일정처럼 실제 이용에 필요한 정보를 함께 보면 좋아요`;
  }

  if (category === "travel") {
    return `${baseKeyword}를 준비할 때는 이동 동선, 머무는 시간, 비용과 예약처럼 현장에서 바로 영향을 주는 부분을 먼저 보면 좋아요`;
  }

  if (category === "experience") {
    return `${baseKeyword}를 알아볼 때는 체험 순서, 준비물, 비용과 예약 여부처럼 처음 가기 전에 필요한 내용을 같이 보면 좋아요`;
  }

  if (category === "kids-place") {
    return `${baseKeyword}을 고를 때는 아이가 흥미를 보이는지, 부모 대기 공간이 편한지, 주차와 화장실 정보를 미리 확인할 수 있는지가 중요해요`;
  }

  if (category === "education") {
    return `${baseKeyword}를 알아볼 때는 수업 난이도, 배울 수 있는 내용, 준비물과 비용처럼 수강 전에 궁금한 부분을 먼저 확인하면 좋아요`;
  }

  if (category === "information") {
    return `${baseKeyword}를 처음 볼 때는 기본 개념, 진행 순서, 확인 기준을 나눠보면 핵심을 더 빠르게 잡을 수 있어요`;
  }

  if (category === "comparison") {
    return `${baseKeyword}를 비교할 때는 장점, 아쉬운 점, 선택 기준, 구매 전 확인할 조건을 같이 보면 판단이 쉬워요`;
  }

  return `${baseKeyword}를 방문하기 전에는 동선, 머무는 시간, 주차와 운영 정보를 함께 확인하면 실제로 움직일 때 훨씬 편해요`;
};

const createKeywordReinforcementSentence = (form = {}, category = "place") => {
  const mainKeyword = getMainKeyword(form);

  if (category === "restaurant") {
    return `${mainKeyword}에서는 메뉴 구성과 동행 인원, 방문 전 확인할 정보를 함께 보면 실제로 가기 전에 도움이 돼요`;
  }

  if (category === "cafe") {
    return `${mainKeyword}는 공간 분위기와 좌석, 음료 구성을 함께 봐야 방문 전 기대와 실제 이용 기준을 맞추기 좋아요`;
  }

  if (category === "product") {
    return `${mainKeyword}는 장점뿐 아니라 아쉬운 점과 추천 대상까지 같이 보면 선택할 때 더 현실적으로 판단할 수 있어요`;
  }

  if (category === "store") {
    return `${mainKeyword}는 매장 분위기와 상담 흐름, 방문 전 확인할 내용을 함께 봐야 처음 가는 분도 부담이 줄어요`;
  }

  if (category === "hospital") {
    return `${mainKeyword}는 안내 흐름과 상담 분위기, 방문 전 확인할 점을 같이 봐야 처음 예약할 때 덜 막막해요`;
  }

  if (category === "service") {
    return `${mainKeyword}는 상담에서 실제 진행까지 이어지는 흐름과 아쉬운 점을 함께 봐야 이용 전 판단하기 좋아요`;
  }

  if (category === "travel") {
    return `${mainKeyword}는 좋았던 장면만큼 동선과 시간, 다시 가고 싶은 기준을 같이 봐야 여행 계획에 도움이 돼요`;
  }

  if (category === "experience") {
    return `${mainKeyword}는 체험 흐름과 준비할 점, 실제로 기억에 남은 장면을 같이 봐야 처음 가도 그림이 잡혀요`;
  }

  if (category === "kids-place") {
    return `${mainKeyword}는 아이 반응과 보호자 편의성을 같이 봐야 다녀오기 전 그림이 잡혀요`;
  }

  if (category === "education") {
    return `${mainKeyword}는 수업 흐름과 준비물, 수강 전 확인할 점을 함께 봐야 내 상황에 맞는지 판단하기 좋아요`;
  }

  if (category === "information") {
    return `${mainKeyword}는 직접 경험처럼 꾸미기보다 개념, 순서, 확인 기준을 나눠야 처음 보는 사람도 이해하기 쉬워요`;
  }

  if (category === "comparison") {
    return `${mainKeyword}는 장점과 아쉬운 점, 누구에게 맞는지를 함께 봐야 구매 전 선택 기준이 분명해져요`;
  }

  return `${mainKeyword}는 실제 동선과 좋았던 점, 아쉬운 점을 같이 봐야 방문 전 분위기를 더 쉽게 떠올릴 수 있어요`;
};

const createReviewOutline = (form = {}, category = inferReviewCategory(form)) => {
  const targetLength = getTargetLengthSettings(form, category).target;
  const naturalOutline = createNaturalReviewOutline(form, category);

  if (naturalOutline.length > 0) {
    const outline = [...naturalOutline];

    if (targetLength >= 1800) {
      outline.splice(Math.max(1, outline.length - 1), 0, "발행 전에 한 번 더 확인하면 좋은 부분");
    }

    return outline;
  }

  const outlineMap = {
    restaurant: [
      "방문하게 된 이유",
      "메뉴와 맛",
      "분위기와 동행",
      "좋았던 점",
      "가격과 주문 전 확인할 점",
      "재방문 기준",
      "이런 분께 추천해요"
    ],
    product: [
      "처음 써보게 된 이유",
      "사용감과 향",
      "좋았던 점",
      "아쉬운 점과 확인할 부분",
      "이런 분께 추천해요"
    ],
    store: [
      "방문하게 된 이유",
      "처음 궁금했던 점",
      "상담과 응대",
      "사진과 메모로 확인한 내용",
      "좋았던 점",
      "방문 전 확인할 점",
      "이런 분께 추천해요"
    ],
    hospital: [
      "방문하게 된 이유",
      "예약과 접수 흐름",
      "상담과 안내 분위기",
      "좋았던 점",
      "방문 전 확인할 점",
      "이런 분께 추천해요"
    ],
    service: [
      "알아보게 된 이유",
      "상담과 진행 흐름",
      "실제로 좋았던 점",
      "아쉬운 점과 확인할 부분",
      "이용 전 확인할 점",
      "이런 분께 추천해요"
    ],
    travel: [
      "여행을 계획한 이유",
      "동선과 첫인상",
      "기억에 남은 장면",
      "아쉬웠던 점",
      "다시 간다면 확인할 점",
      "이런 여행자에게 추천해요"
    ],
    experience: [
      "체험하게 된 이유",
      "처음 궁금했던 점",
      "체험 흐름과 분위기",
      "좋았던 점",
      "준비물과 확인할 점",
      "이런 분께 추천해요"
    ],
    "kids-place": [
      "방문하게 된 이유",
      "아이 반응",
      "동선과 체험 흐름",
      "부모 대기와 피로도",
      "주차와 다시 갈 기준",
      "이런 가족에게 추천해요"
    ],
    place: [
      "방문 전 기대한 점",
      "공간과 동선",
      "기억에 남은 체험",
      "주차와 편의성",
      "다시 방문할 기준"
    ],
    education: [
      "관심 갖게 된 이유",
      "처음 궁금했던 점",
      "사진과 메모로 확인한 내용",
      "좋았던 점",
      "초보자에게 도움이 된 부분",
      "수강 전 확인할 점",
      "이런 분께 추천해요"
    ]
  };
  const outline = [...(outlineMap[category] || outlineMap.place)];

  if (targetLength >= 1800) {
    outline.splice(Math.max(1, outline.length - 1), 0, "방문 전 한 번 더 보면 좋은 점");
  }

  return outline;
};

const createThumbnailTexts = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const baseKeyword = getReviewTitleBase(mainKeyword);
  const memoText = text(form.experienceMemo);
  const confirmText = /가격|주차|운영시간|예약|비용|환불/u.test(memoText)
    ? "확인할 점까지 정리"
    : "좋았던 점과 아쉬운 점";
  const thumbnailMap = {
    restaurant: [`${baseKeyword}`, "회식 전 메뉴 체크", confirmText],
    product: [`${baseKeyword}`, "직접 써본 사용감", "장점·아쉬운 점 정리"],
    store: [`${baseKeyword}`, "상담 분위기 먼저 보기", "방문 전 확인할 점"],
    hospital: [`${baseKeyword}`, "예약·접수 흐름", "방문 전 확인사항"],
    service: [`${baseKeyword}`, "상담부터 진행까지", "비용·일정 체크"],
    travel: [`${baseKeyword}`, "동선과 분위기", "여행 전 확인 팁"],
    experience: [`${baseKeyword}`, "체험 흐름 미리 보기", "준비물·예약 체크"],
    "kids-place": [`${baseKeyword}`, "아이 반응 먼저 보기", "주차·대기공간 체크"],
    place: [`${baseKeyword}`, "방문 전 분위기 확인", "동선·편의성 체크"],
    education: [`${baseKeyword}`, "수업 흐름 미리 보기", "준비물·난이도 체크"]
  };

  return uniqueText(thumbnailMap[category] || thumbnailMap.place).slice(0, 3);
};

const createSearchKeywordSummary = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const baseKeyword = getReviewTitleBase(mainKeyword);
  const related = getRelatedKeywords(form);
  const categoryKeywords = {
    restaurant: ["회식 장소", "메뉴 추천", "가격 확인", "주차 확인"],
    cafe: ["카페 분위기", "음료 메뉴", "좌석 확인", "주차 확인"],
    product: ["사용감", "장점", "아쉬운 점", "추천 대상"],
    store: ["매장 후기", "상담 후기", "친절한 응대", "방문 전 확인"],
    hospital: ["병원 후기", "예약 확인", "상담 분위기", "방문 전 확인"],
    service: ["서비스 후기", "상담 과정", "진행 순서", "비용 확인"],
    travel: ["여행 후기", "여행 코스", "동선", "여행 팁"],
    experience: ["체험 후기", "체험 흐름", "준비물", "예약 확인"],
    "kids-place": ["아이랑 갈만한 곳", "실내 체험", "부모 대기 공간", "주차 확인"],
    information: ["방법 정리", "초보자 기준", "주의사항", "체크리스트"],
    comparison: ["구매 전 비교", "선택 기준", "장단점", "체크 포인트"],
    place: ["방문 후기", "동선", "편의시설", "주차 확인"],
    education: ["수강 후기", "수업 흐름", "준비물", "수강 전 확인"]
  };

  return uniqueText([
    mainKeyword,
    baseKeyword,
    withReviewHashSuffix(mainKeyword),
    ...related,
    ...(categoryKeywords[category] || categoryKeywords.place)
  ]).slice(0, 9);
};

const REVIEW_CATEGORY_LABELS = {
  restaurant: "맛집 후기",
  cafe: "카페 후기",
  product: "상품 후기",
  store: "매장 후기",
  education: "교육 후기",
  hospital: "병원 후기",
  service: "서비스 후기",
  travel: "여행 후기",
  experience: "체험 후기",
  "kids-place": "아이 동반 장소 후기",
  information: "정보 정리형 글",
  comparison: "구매 전 비교형 글",
  place: "장소 후기"
};

const BLOG_WRITER_PERSONAS = {
  product: {
    name: "생활소비 리뷰 작가",
    perspective: "워킹맘 4인 가족의 생활 속 사용 장면과 장점, 아쉬운 점을 솔직하게 나눠 쓰는 후기체"
  },
  restaurant: {
    name: "가족 외식 리뷰 작가",
    perspective: "방문 계기, 매장 분위기, 메뉴, 맛, 양, 주차와 동행자 관점까지 함께 보는 후기체"
  },
  cafe: {
    name: "공간형 카페 리뷰 작가",
    perspective: "공간 분위기, 음료와 디저트, 좌석, 조용함, 아이 동반 가능성을 함께 보는 후기체"
  },
  store: {
    name: "매장 방문 리뷰 작가",
    perspective: "외관과 위치, 내부 분위기, 상담과 응대, 신뢰가 간 지점을 차분히 정리하는 후기체"
  },
  education: {
    name: "초보자 강의 리뷰 작가",
    perspective: "수강 전 궁금했던 점, 수업 흐름, 초보자 입장에서 이해된 부분을 중심으로 쓰는 후기체"
  },
  "kids-place": {
    name: "아이 동반 장소 리뷰 작가",
    perspective: "아이 반응과 부모 입장의 동선, 주차, 화장실, 휴식 공간을 함께 살피는 후기체"
  },
  service: {
    name: "서비스 이용 리뷰 작가",
    perspective: "필요했던 이유, 상담과 진행 흐름, 편했던 점과 확인할 점을 나눠 쓰는 후기체"
  },
  information: {
    name: "정보 정리형 블로그 작가",
    perspective: "직접 경험한 척하지 않고 검색자가 궁금해할 개념, 기준, 주의사항을 정리하는 설명체"
  },
  comparison: {
    name: "구매 전 비교 작가",
    perspective: "장점과 아쉬운 점, 선택 기준, 구매 전 확인할 조건을 과장 없이 비교하는 설명체"
  },
  default: {
    name: "생활 후기 블로그 작가",
    perspective: "실제 생활 맥락과 확인할 기준을 자연스럽게 이어 쓰는 후기체"
  }
};

const getBlogWriterPersona = (category = "place") =>
  BLOG_WRITER_PERSONAS[category] || BLOG_WRITER_PERSONAS.default;

const getFormMemoText = (form = {}) =>
  getMemoText(splitMemoLines(form.experienceMemo).map(softenSensitiveExpression));

const hasProvidedParking = (memoText = "") => /주차\s*(편|가능|있|넓|좋)|주차가\s*편/u.test(memoText);
const hasParkingNeedsCheck = (memoText = "") => /주차.*확인|주차는\s*확인/u.test(memoText);

const createSecondaryKeywords = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const baseKeyword = getReviewTitleBase(mainKeyword);
  const specialKeywords = [];

  if (category === "store" && /금거래소|금값|금\s*시세|금시세|매입/u.test(`${mainKeyword} ${memoText}`)) {
    specialKeywords.push("금거래소", "금매입", "금시세", "상담 분위기", "매장 후기");
  }

  if (category === "restaurant" && /카페/u.test(`${mainKeyword} ${memoText}`)) {
    specialKeywords.push("아이랑 카페", "가족 카페", "아이 음료", "좌석 넓은 카페", "주차 확인");
  }

  if (category === "cafe") {
    if (/아이|가족/u.test(`${mainKeyword} ${memoText}`)) {
      specialKeywords.push("아이랑 카페", "가족 카페", "아이 음료");
    }
    specialKeywords.push("카페 분위기", "음료 메뉴", "좌석 확인", "카페 주차", "방문 전 확인");
  }

  if (category === "product" && /드라이샴푸|운동|떡진|보송|휴대/u.test(`${mainKeyword} ${memoText}`)) {
    specialKeywords.push("드라이샴푸 후기", "운동 후 드라이샴푸", "떡진 머리", "보송함", "휴대용 드라이샴푸");
  }

  if (category === "information") {
    specialKeywords.push("초보자 기준", "방법 정리", "주의사항", "체크리스트");
  }

  if (category === "comparison") {
    specialKeywords.push("구매 전 비교", "선택 기준", "장단점", "체크 포인트");
  }

  const summaryKeywords = createSearchKeywordSummary(form, category);

  return uniqueText([
    ...getRelatedKeywords(form),
    ...specialKeywords,
    ...summaryKeywords,
    baseKeyword
  ])
    .filter((keyword) => compact(keyword) !== compact(mainKeyword))
    .slice(0, 5);
};

const createSearchIntentAnalysis = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const secondaryKeywords = createSecondaryKeywords(form, category);
  const categoryLabel = REVIEW_CATEGORY_LABELS[category] || "후기형 글";

  return {
    contentType: categoryLabel,
    summary: `${mainKeyword}를 검색한 사람이 ${secondaryKeywords[0] || "실제 후기"}와 확인이 필요한 정보를 빠르게 판단하려는 의도입니다.`,
    readerQuestion: `${mainKeyword}를 보기 전에 무엇을 확인하면 좋을까요?`,
    answer: createSearchAnswerSentence(form, category, getFormMemoText(form))
  };
};

const createHomeFeedClickPoint = (form = {}, selectedTitle = "", imageSuggestions = [], category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const firstImage = imageSuggestions[0];
  const thumbnailCopyMap = {
    restaurant: /카페/u.test(mainKeyword) ? "아이랑 가기 전 체크" : "메뉴와 분위기 체크",
    product: "사용감과 아쉬운 점",
    store: "상담 분위기 먼저 보기",
    education: "수업 흐름 미리 보기",
    hospital: "접수 흐름 확인",
    service: "상담 과정 체크",
    travel: "동선과 분위기 보기",
    experience: "체험 흐름 미리 보기",
    "kids-place": "아이 반응 먼저 보기",
    place: "동선과 분위기 보기"
  };

  return {
    situationTitle: selectedTitle || `${mainKeyword} 후기`,
    thumbnailCopy: thumbnailCopyMap[category] || "확인 포인트 정리",
    firstImageCandidate: firstImage?.title || "대표 사진",
    clickReason: "광고 문구보다 실제로 확인할 기준이 먼저 보여 저장하거나 클릭하기 좋습니다."
  };
};

const createOpeningSentenceCandidates = (form = {}, category = inferReviewCategory(form), body = "") => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const firstSentence = text(body).split(/(?<=[.!?。])\s+/u)[0];

  return uniqueText([
    firstSentence,
    `${mainKeyword}를 알아볼 때는 실제로 확인한 내용과 [확인 필요] 정보를 나눠 보는 게 좋더라고요.`,
    createSearchAnswerSentence(form, category, memoText)
  ]).slice(0, 3);
};

const PHOTO_GUIDE_LABELS = ["대표 사진", "사용 장면", "상세 사진", "분위기 사진", "마무리 사진"];

const createShortPhotoGuideText = (item = {}, index = 0, form = {}) => {
  const memoText = getFormMemoText(form);
  const source = `${item.title || ""} ${item.description || ""} ${item.directShotGuide || ""} ${getMainKeyword(form)} ${memoText}`;

  if (index === 1 && /운동|드라이샴푸|떡진|보송/u.test(source)) return "운동 후 사용 상황을 보여줄 수 있는 사진";
  if (/패키지|제품명|제품\s*전체/u.test(source)) return "제품명과 패키지가 잘 보이는 사진";
  if (/성분|용량|사용법|상세|정보/u.test(source)) return "용량, 사용법, 성분을 확인할 수 있는 사진";
  if (/사용|텍스처|발림|운동|장면/u.test(source)) return "실제로 사용하는 상황을 보여줄 수 있는 사진";
  if (/입구|외관|대표|첫/u.test(source)) return "입구와 전체 분위기가 잘 보이는 사진";
  if (/메뉴|가격|안내|시세|커리큘럼/u.test(source)) return "가격, 메뉴, 안내 정보를 확인할 수 있는 사진";
  if (/내부|공간|분위기|좌석/u.test(source)) return "공간 분위기와 동선이 보이는 사진";
  if (/마무리|정리|추천/u.test(source)) return "글 마지막에 넣기 좋은 정리용 사진";

  return [
    "전체 모습이 잘 보이는 대표 사진",
    "직접 경험한 상황을 보여주는 사진",
    "세부 정보를 확인할 수 있는 사진",
    "분위기와 동선을 보여주는 사진",
    "마무리 전에 넣기 좋은 사진"
  ][index] || "글 흐름에 맞춰 넣기 좋은 사진";
};

const createPhotoGuideItems = (imageSuggestions = [], form = {}) =>
  imageSuggestions.slice(0, 5).map((item, index) => {
    const marker = `[${PHOTO_GUIDE_LABELS[index] || item.title || `사진 ${index + 1}`}]`;
    const guide = createShortPhotoGuideText(item, index, form);

    return {
      title: PHOTO_GUIDE_LABELS[index] || item.title,
      insertAfter: item.label,
      guide,
      marker,
      description: guide
    };
  });

const PHOTO_INSERT_LABELS = {
  product: ["제품 전체 사진", "사용 장면", "상세 정보 사진"],
  store: ["매장 외관", "내부 분위기", "상담 공간 또는 제품 진열"],
  restaurant: ["대표 메뉴 사진", "메뉴 클로즈업", "전체 상차림"],
  cafe: ["카페 외관", "음료 또는 디저트", "좌석과 내부 분위기"],
  education: ["강의 안내 이미지", "수업 분위기", "커리큘럼 이미지"],
  hospital: ["외관 또는 입구", "접수 공간", "안내 정보"],
  service: ["상담 전 확인 자료", "진행 과정", "결과 확인 장면"],
  travel: ["여행지 첫 장면", "이동 동선", "기억에 남은 장소"],
  experience: ["체험 장소 첫 장면", "체험 과정", "결과물 또는 기억 장면"],
  "kids-place": ["입구 또는 전체 공간", "체험 공간", "부모 대기 공간"],
  information: ["핵심 요약 이미지", "기준 정리 이미지", "체크리스트 이미지"],
  comparison: ["비교 대상 사진", "장점 정리 이미지", "구매 전 체크 이미지"],
  place: ["대표 공간", "체험 핵심 장면", "동선 또는 시설 사진"]
};

const createPhotoInsertMarkers = (category = "place", imageCount = 0) => {
  if (imageCount <= 0) return [];

  const markerCount = imageCount === 1 ? 1 : Math.min(imageCount, 3);

  return (PHOTO_INSERT_LABELS[category] || PHOTO_INSERT_LABELS.place)
    .slice(0, markerCount)
    .map((label) => `[사진 삽입: ${label}]`);
};

const insertPhotoMarkersIntoBody = (body = "", category = "place", imageCount = 0) => {
  const normalized = normalizeBody(body);
  if (!normalized || normalized.includes("[사진 삽입:")) return normalized;

  const paragraphs = normalized
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const markers = createPhotoInsertMarkers(category, imageCount);
  if (markers.length === 0) return normalized;

  if (paragraphs.length <= 2) {
    return normalizeBody([paragraphs[0], markers[0], ...paragraphs.slice(1), ...markers.slice(1)].join("\n\n"));
  }

  const positions = Array.from(
    new Set([
      Math.min(1, paragraphs.length - 1),
      Math.min(Math.max(2, Math.floor(paragraphs.length / 2)), paragraphs.length - 1),
      Math.min(Math.max(3, paragraphs.length - 2), paragraphs.length - 1)
    ])
  );
  const result = [];
  let markerIndex = 0;

  paragraphs.forEach((paragraph, index) => {
    result.push(paragraph);

    if (positions.includes(index) && markers[markerIndex]) {
      result.push(markers[markerIndex]);
      markerIndex += 1;
    }
  });

  return normalizeBody([...result, ...markers.slice(markerIndex)].join("\n\n"));
};

const replaceRepeatedPhrase = (value = "", phrase = "", alternatives = [], keepCount = 1) => {
  if (!phrase || alternatives.length === 0) return value;
  let seen = 0;

  return value.replace(new RegExp(escapeRegExp(phrase), "gu"), (match) => {
    seen += 1;
    if (seen <= keepCount) return match;
    return alternatives[(seen - keepCount - 1) % alternatives.length];
  });
};

const polishPublishableBlogBody = (body = "") => {
  let polished = removeWritingGuideParagraphs(body);

  polished = replaceRepeatedPhrase(polished, "좋더라고요", [
    "편하게 느껴졌어요",
    "판단하기 쉬웠어요",
    "조금 더 자연스럽게 다가왔어요"
  ]);
  polished = replaceRepeatedPhrase(polished, "좋아요", [
    "좋습니다",
    "괜찮습니다",
    "편합니다"
  ], 2);
  polished = replaceRepeatedPhrase(polished, "좋겠습니다", [
    "확인해두면 편합니다",
    "챙겨보면 도움이 됩니다"
  ], 2);
  polished = replaceRepeatedPhrase(polished, "도움이 돼요", [
    "판단하기가 한결 쉽습니다",
    "방문 전 기준을 잡기 편합니다"
  ], 2);

  return normalizeBody(
    polished
      .replace(/않어요/gu, "않아요")
      .replace(/되요/gu, "돼요")
      .replace(/남어요/gu, "남아요")
      .replace(/맞어요/gu, "맞아요")
      .replace(/자연스럽어요/gu, "자연스러워요")
      .replace(/대표 메뉴이/gu, "대표 메뉴가")
      .replace(/대표 메뉴은/gu, "대표 메뉴는")
      .replace(/대표 메뉴을/gu, "대표 메뉴를")
      .replace(/대표 메뉴명\s*메뉴/gu, "대표 메뉴")
      .replace(/대표 메뉴명이/gu, "대표 메뉴가")
      .replace(/대표 메뉴명은/gu, "대표 메뉴는")
      .replace(/대표 메뉴명을/gu, "대표 메뉴를")
      .replace(/이 메뉴\s*메뉴/gu, "대표 메뉴")
      .replace(/이 메뉴이/gu, "이 메뉴가")
      .replace(/이 메뉴은/gu, "이 메뉴는")
      .replace(/이 메뉴을/gu, "이 메뉴를")
      .replace(/짬뽕 메뉴이/gu, "짬뽕 메뉴가")
      .replace(/짬뽕 메뉴은/gu, "짬뽕 메뉴는")
      .replace(/짬뽕 메뉴을/gu, "짬뽕 메뉴를")
      .replace(/높이에요/gu, "높여줘요")
  );
};

const getInfoValue = (value = "") => text(value) || "[확인 필요]";

const createRestaurantInfoSummary = (form = {}) => {
  const memoText = getFormMemoText(form);
  const menus = getRestaurantMenus(memoText);
  const hasChildDrink = /아이\s*음료|어린이\s*음료/u.test(memoText);
  const hasWideSeat = /좌석\s*넓|자리\s*넓|좌석.*넉넉/u.test(memoText);
  const menuInfo = uniqueText([
    ...menus,
    hasChildDrink ? "아이 음료 있음" : "",
    text(form.price) || text(form.priceInfo) || "가격 [확인 필요]"
  ]).join(" / ");

  return [
    ["장소/업체명", getMainKeyword(form)],
    ["주소", getInfoValue(form.address || form.region)],
    ["영업시간", "[확인 필요]"],
    ["주차", hasProvidedParking(memoText) && !hasParkingNeedsCheck(memoText) ? "주차 편함(사용자 메모)" : "[확인 필요]"],
    ["대표 메뉴/가격", menuInfo || "[확인 필요]"],
    ["아이 동반 정보", hasChildDrink ? "아이 음료 있음(사용자 메모)" : "[확인 필요]"],
    ["좌석", hasWideSeat ? "좌석 넓음(사용자 메모)" : "[확인 필요]"]
  ];
};

const createProductInfoSummaryForReview = (form = {}) => {
  const productInfoItems = Object.fromEntries(
    summarizeProductInfo(form).map((item) => [item.field, item.value])
  );

  return [
    ["상품명/브랜드명", getInfoValue(text(form.brandName) || getMainKeyword(form))],
    ["가격", getInfoValue(text(form.price) || productInfoItems.price)],
    ["용량/구성", getInfoValue(text(form.capacity) || text(form.composition) || productInfoItems.capacity || productInfoItems.composition)],
    ["구매처", getInfoValue(form.purchaseUrl || form.purchaseNotes || productInfoItems.purchaseNotes)],
    ["사용 기간", "[확인 필요]"],
    ["주의사항", getInfoValue(text(form.cautions) || productInfoItems.cautions)]
  ];
};

const createStoreInfoSummary = (form = {}) => {
  const memoText = getFormMemoText(form);

  return [
    ["업체/매장명", getMainKeyword(form)],
    ["주소", getInfoValue(form.address || form.region)],
    ["영업시간", "[확인 필요]"],
    ["주차", hasProvidedParking(memoText) && !hasParkingNeedsCheck(memoText) ? "주차 가능/편함(사용자 메모)" : "[확인 필요]"],
    ["상담/매입 기준", /매입/u.test(memoText) ? "매입 상담 메모 있음, 실제 기준은 [확인 필요]" : "[확인 필요]"],
    ["가격/시세", /금값|금\s*시세|금시세|시세/u.test(memoText) ? "시세 변동 가능, 방문 시 [확인 필요]" : "[확인 필요]"]
  ];
};

const createEducationInfoSummary = (form = {}) => [
  ["강의/수업명", getMainKeyword(form)],
  ["강의 시간", "[확인 필요]"],
  ["수강료", "[확인 필요]"],
  ["준비물", "[확인 필요]"],
  ["강사/기관", getLecturerName(getFormMemoText(form)) || "[확인 필요]"]
];

const createGenericInfoSummary = (form = {}, category = inferReviewCategory(form)) => {
  if (category === "restaurant") return createRestaurantInfoSummary(form);
  if (category === "cafe") return createRestaurantInfoSummary(form);
  if (category === "product") return createProductInfoSummaryForReview(form);
  if (category === "store") return createStoreInfoSummary(form);
  if (category === "education") return createEducationInfoSummary(form);

  return [
    ["이름", getMainKeyword(form)],
    ["위치/주소", getInfoValue(form.address || form.region)],
    ["운영시간", "[확인 필요]"],
    ["비용/가격", "[확인 필요]"],
    ["예약/문의", getInfoValue(form.contactMethod)]
  ];
};

const createRecommendedForItems = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);

  const items = {
    restaurant: [
      /카페/u.test(mainKeyword) ? "아이와 함께 갈 카페를 찾는 가족" : "메뉴와 분위기를 함께 보고 식사 장소를 고르는 분",
      /좌석\s*넓/u.test(memoText) ? "좌석 여유를 중요하게 보는 분" : "가격과 주차처럼 바뀔 수 있는 정보를 발행 전 확인할 분",
      "광고보다 실제 메모 기반 후기를 먼저 보고 싶은 분"
    ],
    cafe: [
      "카페 분위기와 좌석 편의성을 함께 보고 싶은 분",
      /아이|가족/u.test(memoText) ? "아이와 함께 머물기 괜찮은 카페를 찾는 분" : "음료와 공간 분위기를 같이 비교하고 싶은 분",
      "주차나 좌석처럼 방문 전에 확인할 기준이 필요한 분"
    ],
    product: [
      `${getReviewTitleBase(mainKeyword)}의 실제 사용 상황이 궁금한 분`,
      "장점과 아쉬운 점을 같이 보고 구매를 판단하고 싶은 분",
      "효과 단정보다 사용감과 휴대성 같은 현실 기준이 필요한 분"
    ],
    store: [
      "처음 방문 전 상담 분위기가 궁금한 분",
      "시세나 비용처럼 바뀌는 정보를 구분해서 보고 싶은 분",
      "친절한 응대와 설명 흐름을 중요하게 보는 분"
    ],
    education: [
      "처음 배우는 내용의 난이도가 궁금한 분",
      "커리큘럼과 진행 순서를 먼저 확인하고 싶은 분",
      "수강 전 준비물과 비용을 따로 체크할 분"
    ],
    information: [
      `${mainKeyword}를 처음 알아보는 분`,
      "직접 경험담보다 기준과 순서를 먼저 알고 싶은 분",
      "확인되지 않은 정보는 구분해서 보고 싶은 분"
    ],
    comparison: [
      `${mainKeyword}를 구매하거나 선택하기 전에 기준을 잡고 싶은 분`,
      "장점만 보지 않고 아쉬운 점까지 비교하고 싶은 분",
      "내 상황에 맞는 선택지를 차분히 고르고 싶은 분"
    ]
  };

  return items[category] || [
    `${mainKeyword}를 처음 알아보는 분`,
    "사진과 메모 기반의 현실적인 후기가 필요한 분",
    "확인되지 않은 정보를 구분해서 보고 싶은 분"
  ];
};

const createFaqItems = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);

  if (category === "restaurant") {
    const subKeywords = getSubKeywords(form);
    const primaryMenu = getPrimaryRestaurantMenu(form, memoText) || "대표 메뉴";
    const regionKeyword =
      subKeywords.find((keyword) => /초지|강화|맛집|근처/u.test(keyword)) ||
      (/강화/u.test(`${mainKeyword} ${memoText}`) ? "강화도맛집" : "지역 맛집");
    const hasChildInfo = /아이|유아|아기|어린이/u.test(memoText);
    const baseItems = [
      {
        question: `${withTopicParticle(mainKeyword)} 어떤 메뉴를 먼저 보면 좋나요?`,
        answer: `대표 메뉴로 언급된 ${withObjectParticle(primaryMenu)} 먼저 살펴보면 메뉴 구성과 방문 흐름을 잡기 쉽습니다.`
      },
      {
        question: "가족여행 중 들르기 전 무엇을 보면 좋나요?",
        answer: "방문 시간대, 대기 여부, 주차 가능 여부처럼 이동에 영향을 주는 정보를 미리 살펴두면 동선을 잡는 데 도움이 됩니다."
      },
      {
        question: `${regionKeyword}으로 볼 때 어떤 점이 중요할까요?`,
        answer: "위치와 대표 메뉴, 식사 동선이 가족여행 일정과 맞는지를 함께 보는 것이 좋습니다."
      }
    ];

    if (hasChildInfo) {
      baseItems[1] = {
        question: "아이와 함께 들를 때 무엇을 보면 좋나요?",
        answer: "아이 메뉴, 좌석 형태, 대기 시간처럼 동행자가 편하게 머물 수 있는 기준을 함께 살펴보면 좋습니다."
      };
    }

    return baseItems;
  }

  if (category === "restaurant-legacy") {
    return [
      {
        question: `${mainKeyword}는 아이와 함께 가기 괜찮나요?`,
        answer: /아이\s*음료/u.test(memoText)
          ? "사용자 메모 기준으로 아이 음료가 있고 좌석도 넓게 느껴졌다고 정리할 수 있습니다."
          : "아이 동반 가능 여부와 유아 의자, 소음 정도는 [확인 필요]로 남기는 편이 좋습니다."
      },
      {
        question: "메뉴 가격은 확인됐나요?",
        answer: text(form.price) || text(form.priceInfo) ? `제공된 가격 정보는 ${text(form.price) || text(form.priceInfo)}입니다.` : "메뉴 가격은 제공되지 않아 [확인 필요]로 표시하는 것이 안전합니다."
      },
      {
        question: "주차 정보는 있나요?",
        answer: hasProvidedParking(memoText) && !hasParkingNeedsCheck(memoText)
          ? "사용자 메모에는 주차가 편하다고 되어 있지만, 발행 전 실제 주차 가능 여부를 다시 확인하면 좋습니다."
          : "주차 정보는 제공되지 않아 [확인 필요]로 남겨두는 것이 좋습니다."
      }
    ];
  }

  if (category === "cafe") {
    return [
      {
        question: `${mainKeyword}는 오래 머물기 괜찮나요?`,
        answer: /좌석|분위기|조용/u.test(memoText)
          ? "사용자 메모 기준으로 좌석과 분위기에서 기억에 남은 점을 중심으로 정리할 수 있습니다."
          : "좌석 간격, 소음, 콘센트, 운영시간은 제공된 정보가 부족하면 [확인 필요]로 남기는 편이 안전합니다."
      },
      {
        question: "음료나 디저트 정보는 확인됐나요?",
        answer: /음료|커피|디저트|메뉴/u.test(memoText)
          ? "메모에 남은 음료나 디저트 내용을 중심으로 자연스럽게 정리할 수 있습니다."
          : "구체적인 메뉴와 가격은 제공되지 않아 [확인 필요]로 표시하는 것이 좋습니다."
      },
      {
        question: "주차 정보는 있나요?",
        answer: hasProvidedParking(memoText) && !hasParkingNeedsCheck(memoText)
          ? "메모에는 주차가 편하다고 되어 있지만, 발행 전 실제 주차 가능 여부를 다시 확인하면 좋습니다."
          : "주차 정보는 제공되지 않아 [확인 필요]로 남겨두는 것이 좋습니다."
      }
    ];
  }

  if (category === "product") {
    return [
      {
        question: `${mainKeyword}는 언제 쓰기 좋나요?`,
        answer: /운동|떡진|보송/u.test(memoText)
          ? "사용자 메모 기준으로 운동 후 머리가 신경 쓰일 때, 빠르게 보송하게 정리하고 싶을 때 참고하기 좋습니다."
          : "사용 상황은 사용자 메모에 있는 범위 안에서만 정리하고, 효과는 단정하지 않는 편이 좋습니다."
      },
      {
        question: "향이나 사용감은 어떤가요?",
        answer: /향/u.test(memoText)
          ? "메모에는 향이 괜찮다고 되어 있어 부담이 크지 않은 쪽으로 정리할 수 있습니다."
          : "향과 사용감은 개인차가 있어 실제 사용 메모가 없으면 [확인 필요]로 두는 편이 안전합니다."
      },
      {
        question: "가격이나 구매처 정보가 있나요?",
        answer: text(form.price) || text(form.purchaseNotes)
          ? `제공된 정보는 ${[form.price, form.purchaseNotes].map(text).filter(Boolean).join(", ")}입니다.`
          : "가격과 구매처는 제공되지 않아 [확인 필요]로 표시합니다."
      }
    ];
  }

  if (category === "store") {
    return [
      {
        question: `${mainKeyword} 방문 전에 무엇을 확인하면 좋나요?`,
        answer: "금 시세, 매입 기준, 운영시간, 주차 여부처럼 변동될 수 있는 정보는 방문 전에 다시 확인하는 편이 좋습니다."
      },
      {
        question: "상담 분위기는 어떤가요?",
        answer: /친절|사장님/u.test(memoText)
          ? "사용자 메모에는 사장님이 친절했다는 경험이 있어 상담 분위기 중심으로 정리할 수 있습니다."
          : "상담 분위기는 제공된 경험이 부족하면 [확인 필요]로 남기는 편이 좋습니다."
      },
      {
        question: "가격이나 시세를 글에 써도 되나요?",
        answer: "구체적인 금액은 제공되지 않았으므로 임의로 쓰지 않고 [확인 필요] 또는 변동 가능 정보로 표시합니다."
      }
    ];
  }

  if (category === "information") {
    return [
      {
        question: `${mainKeyword}를 처음 볼 때 가장 먼저 확인할 것은 무엇인가요?`,
        answer: "기본 개념, 진행 순서, 확인 기준을 먼저 나눠보면 전체 흐름을 잡기 쉽습니다."
      },
      {
        question: "직접 경험한 것처럼 써도 되나요?",
        answer: "정보 정리형 글은 직접 다녀온 척하거나 사용한 척하지 않고, 확인한 기준과 주의사항 중심으로 쓰는 편이 안전합니다."
      },
      {
        question: "확인되지 않은 정보는 어떻게 쓰나요?",
        answer: "가격, 주소, 운영시간처럼 변동되는 정보는 단정하지 않고 [확인 필요]로 남기는 것이 좋습니다."
      }
    ];
  }

  if (category === "comparison") {
    return [
      {
        question: `${mainKeyword}를 비교할 때 가장 중요한 기준은 무엇인가요?`,
        answer: "사용 목적, 예산, 장점과 아쉬운 점, 구매 후 확인할 조건을 함께 보는 편이 좋습니다."
      },
      {
        question: "추천처럼 보여도 괜찮나요?",
        answer: "과장 표현보다 어떤 사람에게 맞는지 기준을 나눠 쓰면 광고처럼 보이지 않고 판단에 도움이 됩니다."
      },
      {
        question: "구매 전 꼭 확인할 점은 무엇인가요?",
        answer: "가격, 구성, 교환/환불, 실제 사용 조건처럼 바뀔 수 있는 정보는 발행 전에 다시 확인하는 것이 안전합니다."
      }
    ];
  }

  return [
    {
      question: `${mainKeyword}를 보기 전에 무엇을 확인하면 좋나요?`,
      answer: "가격, 운영시간, 예약, 주차처럼 바뀔 수 있는 정보는 [확인 필요]로 남기고 발행 전에 다시 확인하면 좋습니다."
    },
    {
      question: "실제 경험처럼 써도 되나요?",
      answer: "사용자가 제공한 메모와 사진에서 확인되는 내용만 1인칭 흐름으로 쓰고, 없는 경험은 만들지 않는 편이 안전합니다."
    },
    {
      question: "사진은 어디에 넣으면 좋나요?",
      answer: "도입부에는 대표 사진, 본문 중간에는 상세 사진, 마무리 전에는 확인 포인트 사진을 넣으면 흐름이 자연스럽습니다."
    }
  ];
};

const createInfoSummaryBodySection = (infoSummary = []) =>
  createSectionBlock("업체 정보 또는 상품 정보 정리", [
    [
      "제공된 정보만 따로 모아두면 발행 전에 확인해야 할 부분이 훨씬 잘 보입니다.",
      ...infoSummary.map(([label, value]) => `${label}: ${value}`)
    ]
  ]);

const createRecommendedBodySection = (recommendedFor = []) =>
  createSectionBlock("이런 분께 추천해요", [recommendedFor]);

const createFaqBodySection = (faqItems = []) =>
  ["FAQ", ...faqItems.flatMap((item) => [`Q. ${item.question}`, `A. ${item.answer}`])].join("\n\n");

const createPhotoGuideBodySection = (photoGuide = []) => {
  if (photoGuide.length === 0) return "";

  return [
    "사진 배치 가이드",
    ...photoGuide.slice(0, 4).flatMap((item) => [
      item.marker,
      `${item.guide} ${item.description ? item.description : ""}`.replace(/\s+/g, " ").trim()
    ])
  ].join("\n\n");
};

const createLongFormSupportSection = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);

  if (category === "product") {
    return createSectionBlock("워킹맘 4인 가족 기준으로 본 사용 상황", [
      [
        `${mainKeyword}는 혼자만 쓰는 제품이라도 결국 생활 루틴 안에서 얼마나 부담 없이 꺼내 쓰는지가 중요하더라고요.`,
        /운동|떡진|보송/u.test(memoText)
          ? "운동 후 바로 머리를 감기 어려운 날, 아이 픽업이나 외출 일정이 이어지는 날처럼 시간이 부족한 상황에서 기준이 더 분명해졌어요."
          : "아침 준비나 외출 전처럼 시간이 촉박할 때도 손이 갈 수 있는지, 보관과 휴대가 불편하지 않은지도 함께 보게 됩니다.",
        "다만 사용감은 개인차가 있어서 좋았던 점과 아쉬운 점을 같이 적어두는 편이 실제 후기처럼 읽힙니다."
      ]
    ]);
  }

  if (category === "restaurant") {
    return createSectionBlock("4인 가족 기준으로 보면 좋았던 부분", [
      [
        /아이\s*음료/u.test(memoText)
          ? "아이 음료가 있다는 점은 가족이 함께 움직일 때 작은 것 같아도 꽤 중요한 기준이 됩니다."
          : "아이와 함께 간다면 아이 메뉴, 유아 의자, 좌석 간격은 발행 전에 한 번 더 확인하면 좋습니다.",
        /좌석\s*넓/u.test(memoText)
          ? "좌석이 넓게 느껴졌다는 메모는 가족 단위 방문에서 편하게 머물 수 있는지 판단하는 데 도움이 됐어요."
          : "좌석이 넓은지, 소음이 크지 않은지, 대기 시간이 있는지는 가족 외식 만족도에 영향을 줍니다.",
        "가격과 주차는 제공된 정보가 없으면 [확인 필요]로 남겨두는 편이 과장 없이 안전합니다."
      ]
    ]);
  }

  if (category === "store") {
    return createSectionBlock("가족 기준으로 확인하면 좋은 부분", [
      [
        "금거래소처럼 금액이 오가는 매장은 혼자 판단하기보다 가족과 함께 시세, 매입 기준, 상담 내용을 차분히 비교하게 됩니다.",
        /친절|사장님/u.test(memoText)
          ? "응대가 친절했다는 메모는 처음 방문하는 사람에게 부담을 줄여주는 중요한 포인트로 볼 수 있어요."
          : "응대 분위기는 실제 방문 전 알기 어려우니 제공된 경험이 부족하면 [확인 필요]로 남겨두는 편이 좋습니다.",
        "구체적인 가격, 영업시간, 주차 정보는 임의로 쓰지 않고 확인 항목으로 분리했습니다."
      ]
    ]);
  }

  return createSectionBlock("발행 전에 한 번 더 확인하면 좋은 부분", [
    [
      `${mainKeyword} 글은 경험 메모와 확인 필요 정보를 나눠두면 독자가 스스로 판단하기 훨씬 편합니다.`,
      "가격, 운영시간, 예약, 주차처럼 바뀔 수 있는 정보는 발행 전에 다시 확인하고, 확인되지 않은 내용은 그대로 [확인 필요]로 남기는 편이 좋습니다."
    ]
  ]);
};

const createDepthSupportSections = ({
  form = {},
  category = inferReviewCategory(form),
  infoSummary = [],
  recommendedFor = []
} = {}) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const firstRecommendation = recommendedFor[0] || `${mainKeyword}를 처음 알아보는 분`;
  const infoLines = infoSummary
    .filter(([, value]) => text(value))
    .slice(0, 5)
    .map(([label, value]) => `${label}: ${value}`);

  if (category === "education") {
    return [
      createSectionBlock("처음 듣는 사람에게 중요한 기준", [
        [
          `${withTopicParticle(mainKeyword)} 처음 알아볼 때는 강의가 어렵지 않은지보다 내가 따라갈 수 있는 순서로 설명되는지가 더 중요했습니다`,
          "세관공매처럼 낯선 주제는 용어를 한 번에 외우려고 하면 부담이 커지기 쉬워서, 전체 흐름을 먼저 잡는 방식이 편했습니다",
          "초보자 입장에서는 공고를 어디서 보고, 입찰은 어떤 순서로 이어지고, 이후 확인은 어떻게 하는지 큰 줄기가 보이는지만으로도 막막함이 줄어듭니다"
        ]
      ]),
      createSectionBlock("커리큘럼을 볼 때 확인한 부분", [
        [
          "커리큘럼은 단순한 목차보다 실제 수업에서 어떤 순서로 이어지는지가 중요하게 느껴졌습니다",
          "처음에는 세관공매라는 말만 들어도 어렵게 느껴지지만, 공고 확인과 입찰 흐름처럼 단계가 나뉘면 이해할 수 있는 부분이 생깁니다",
          "무료공개강의라면 전체 강의가 내 목적과 맞는지 부담 없이 먼저 확인해볼 수 있다는 점도 장점으로 볼 수 있습니다"
        ]
      ]),
      createSectionBlock("수강 전에 따로 볼 정보", [
        [
          "강의 시간, 준비물, 비용, 환불 기준은 시기마다 달라질 수 있어 신청 전에 한 번 더 확인하는 편이 좋겠습니다",
          "입찰 흐름을 더 깊게 배우고 싶다면 실제 사례를 어느 정도 다루는지, 초보자가 질문할 수 있는 시간은 있는지도 같이 보면 도움이 됩니다",
          "강의를 들은 뒤 바로 결과를 기대하기보다, 내가 다음 단계에서 무엇을 더 찾아봐야 하는지 기준을 잡는 용도로 보면 더 현실적입니다"
        ],
        infoLines
      ]),
      createSectionBlock("공고와 입찰 흐름을 나눠보면", [
        [
          "세관공매를 처음 보면 공고, 입찰, 낙찰, 반출 같은 말이 한꺼번에 나와서 어렵게 느껴질 수 있습니다",
          "이럴 때는 각 단어를 외우기보다 실제 순서가 어떻게 이어지는지 먼저 보는 편이 부담이 적습니다",
          "무료공개강의에서 이런 흐름을 예시와 함께 잡아준다면 이후에 공고문을 볼 때도 무엇을 먼저 확인해야 하는지 더 쉽게 떠올릴 수 있습니다"
        ]
      ]),
      createSectionBlock("초보자가 질문해보면 좋은 부분", [
        [
          "처음 듣는 수업이라면 준비물이 필요한지, 수업 전에 알아두면 좋은 기본 용어가 있는지 먼저 물어보는 것도 좋겠습니다",
          "입찰 과정에서 자주 헷갈리는 부분이나 주의해야 할 기준이 있다면 강의 중에 따로 표시해두면 나중에 다시 찾아보기 편합니다",
          "강의가 끝난 뒤 바로 실행하기보다 내가 이해한 순서가 맞는지, 추가로 확인해야 할 자료는 무엇인지 정리해두면 더 안정적으로 다음 단계를 볼 수 있습니다"
        ]
      ]),
      createSectionBlock("듣고 난 뒤 남길 기준", [
        [
          "수업을 듣고 가장 먼저 남겨둘 것은 어렵게 느껴진 단어보다 전체 순서가 어떻게 이어졌는지입니다",
          "공고를 보는 기준, 입찰을 준비하는 기준, 결과를 확인하는 기준이 나뉘면 세관공매라는 주제가 훨씬 작게 느껴집니다",
          "초보자에게는 한 번에 모든 내용을 이해하는 것보다 내가 다시 찾아봐야 할 항목을 분명히 아는 것이 더 현실적인 성과일 수 있습니다"
        ]
      ]),
      createSectionBlock("내 상황과 맞는지 보는 법", [
        [
          "강의를 선택할 때는 내용이 많아 보이는지보다 내가 지금 필요한 단계와 맞는지가 더 중요합니다",
          "세관공매를 막 알아보기 시작했다면 전문 용어를 깊게 파기 전에 전체 절차를 한 번 들어보고, 이후에 세부 자료를 찾아보는 순서가 부담이 적습니다",
          "반대로 이미 공고문을 본 적이 있다면 입찰 전 확인할 조건과 이후 절차를 더 자세히 다루는지 살펴보는 편이 좋겠습니다"
        ]
      ]),
      createSectionBlock("이런 분께 특히 맞을 수 있는 수업", [
        [
          `${firstRecommendation}에게는 전체 흐름을 먼저 들어보고 난이도를 판단하는 방식이 잘 맞을 수 있습니다`,
          "세관공매를 처음 접하는 분이라면 어려운 용어를 세세하게 외우기보다 공고, 입찰, 결과 확인처럼 반복되는 순서부터 잡아보는 편이 좋겠습니다",
          "이미 어느 정도 알고 있는 분이라도 커리큘럼을 통해 내가 놓친 단계가 있는지 확인하는 용도로 참고할 수 있습니다",
          "무엇보다 처음부터 혼자 판단하기 어렵다면 공개 강의를 통해 큰 흐름을 먼저 듣고, 이후 필요한 자료를 차근차근 더 찾아보는 방식이 현실적입니다"
        ]
      ])
    ];
  }

  if (category === "restaurant") {
    const primaryMenu = getPrimaryRestaurantMenu(form, memoText);
    const hasFamilyCue = /가족|여행|외식|아이/u.test(memoText);
    const hasParkingCue = /주차/u.test(memoText);

    return [
      createSectionBlock("방문 전에 더 확인한 기준", [
        [
          primaryMenu
            ? `${withTopicParticle(primaryMenu)} 궁금하다면 사진으로 보이는 구성과 메뉴 이름을 먼저 살펴보면 됩니다`
            : "대표 메뉴가 분명하지 않을 때는 메뉴판 사진과 주문 구성을 먼저 살펴보면 됩니다",
          hasFamilyCue
            ? "가족과 함께 움직이는 날에는 식사 시간, 이동 동선, 아이가 먹기 괜찮은 메뉴까지 같이 보게 됩니다"
            : "함께 식사하는 자리라면 방문 시간대와 대기 여부도 메뉴만큼 중요하게 느껴질 수 있습니다",
          hasParkingCue
            ? "주차 관련 내용은 이동 방식과 함께 정리하면 방문 계획을 세우기 더 쉽습니다"
            : "주차 가능 여부는 방문 시간대마다 달라질 수 있어 출발 전에 한 번 살펴보면 좋겠습니다"
        ]
      ]),
      createSectionBlock("대표 메뉴를 볼 때 나눈 기준", [
        [
          primaryMenu && /짬뽕/u.test(primaryMenu)
            ? "짬뽕 메뉴는 사진으로 보이는 국물과 재료 구성을 먼저 보고, 맵기나 간은 개인차가 있을 수 있다고 보는 게 편했습니다"
            : "대표 메뉴는 사진으로 보이는 구성과 가격, 같이 곁들일 메뉴가 있는지를 나눠 보면 주문하기가 더 편합니다",
          "양이나 가격은 사진만으로 단정하기 어려워서 메뉴판을 한 번 더 보고 고르는 쪽이 현실적입니다",
          "맛 표현은 직접 기억나는 범위 안에서만 남기는 편이 읽는 사람에게도 부담이 적었습니다"
        ]
      ]),
      createSectionBlock("정리해서 참고할 부분", [
        [
          `${withTopicParticle(mainKeyword)} 찾는 분이라면 대표 메뉴, 위치, 대기 여부를 먼저 보고 움직이면 시행착오를 줄일 수 있습니다`,
          "중요한 약속이나 가족 식사라면 운영시간과 예약 여부도 함께 보는 편이 마음이 편합니다",
          "좋았던 기억은 살리되 가격이나 시간처럼 바뀔 수 있는 정보는 최신 안내를 보는 쪽이 좋겠습니다"
        ],
        infoLines
      ])
    ];
  }

  if (category === "product") {
    return [
      createSectionBlock("생활 속에서 볼 기준", [
        [
          `${withTopicParticle(mainKeyword)} 좋은 제품인지 보려면 장점보다 어떤 상황에서 손이 가는지를 먼저 떠올리게 됩니다`,
          "향, 휴대성, 사용 후 마무리감처럼 개인차가 있는 부분은 느낀 범위 안에서만 적는 편이 자연스럽습니다",
          "가격과 용량, 구매처처럼 바뀔 수 있는 정보는 구매 전에 다시 확인하면 더 현실적으로 비교할 수 있습니다"
        ]
      ]),
      createSectionBlock("추천 대상을 나눠보면", [
        [
          `${firstRecommendation}에게는 사용 상황이 분명할수록 장점이 더 잘 보일 수 있습니다`,
          "기대하는 역할이 제품 설명과 맞는지, 내 생활 패턴에서 반복해서 쓸 수 있는지도 함께 보는 편이 좋겠습니다",
          "처음부터 큰 변화를 기대하기보다 불편했던 순간을 얼마나 줄여주는지 기준으로 보면 판단이 쉬워집니다"
        ],
        infoLines
      ])
    ];
  }

  return [
    createSectionBlock("마지막으로 더 확인할 기준", [
      [
        `${withTopicParticle(mainKeyword)} 처음 알아보는 분이라면 좋았던 점과 확인이 필요한 정보를 함께 보는 편이 좋겠습니다`,
        "가격, 운영시간, 예약 여부처럼 바뀔 수 있는 항목은 시점에 따라 달라질 수 있어 한 번 더 확인하면 안전합니다",
        `${firstRecommendation}에게는 전체 분위기보다 실제로 선택할 때 필요한 기준이 더 도움이 될 수 있습니다`
      ],
      infoLines
    ])
  ];
};

const createChecklistItems = ({ form = {}, category = inferReviewCategory(form), selectedTitle = "", body = "", hashtags = [], photoGuide = [], infoSummary = [] } = {}) => {
  const mainKeyword = getMainKeyword(form);
  const firstParagraph = normalizeBody(body).split(/\n{2,}/u)[0] || "";
  const firstSentence = firstParagraph.split(/(?<=[.!?。])\s+/u)[0] || firstParagraph;
  const bodyKeywordCount = countOccurrences(body, mainKeyword);
  const hasMemo = splitMemoLines(form.experienceMemo).length > 0;
  const hasUncheckedInfo = body.includes("[확인 필요]") || infoSummary.some(([, value]) => String(value).includes("[확인 필요]"));
  const sponsorship = getDetectedSponsorshipType(form);

  return [
    {
      label: "메인 키워드 제목 포함 여부",
      passed: selectedTitle.includes(mainKeyword),
      detail: selectedTitle.includes(mainKeyword) ? "포함" : "확인 필요"
    },
    {
      label: "첫 문장 메인 키워드 포함 여부",
      passed: firstSentence.includes(mainKeyword),
      detail: firstSentence.includes(mainKeyword) ? "포함" : "확인 필요"
    },
    {
      label: "첫 문단 광고 느낌 여부",
      passed: !/무조건|역대급|대박|보장/u.test(firstParagraph),
      detail: !/무조건|역대급|대박|보장/u.test(firstParagraph) ? "과장 표현 없음" : "표현 점검 필요"
    },
    {
      label: "메인 키워드 반복 과다 여부",
      passed: bodyKeywordCount <= 8,
      detail: `${bodyKeywordCount}회 사용`
    },
    {
      label: "실제 경험 기반 여부",
      passed: hasMemo,
      detail: hasMemo ? "사용자 메모 기반" : "정보 정리형 초안"
    },
    {
      label: "확인되지 않은 정보 표시 여부",
      passed: hasUncheckedInfo,
      detail: hasUncheckedInfo ? "[확인 필요] 표시" : "추가 확인 권장"
    },
    {
      label: "협찬/체험단 표시 여부",
      passed: true,
      detail: sponsorship ? `${sponsorship} 감지` : "메모 내 협찬 단어 없음"
    },
    {
      label: "사진 가이드 포함 여부",
      passed: photoGuide.length > 0,
      detail: photoGuide.length > 0 ? `${photoGuide.length}개 포함` : "사진 가이드 없음"
    },
    {
      label: "업체/상품 정보 정리 여부",
      passed: infoSummary.length > 0,
      detail: infoSummary.length > 0 ? "정리됨" : "확인 필요"
    },
    {
      label: "해시태그 10~15개 포함 여부",
      passed: hashtags.length >= 10 && hashtags.length <= 15,
      detail: `${hashtags.length}개`
    },
    {
      label: "카테고리 금지 표현 점검",
      passed: !getCategoryForbiddenExpressions(
        category,
        detectProductSubtype(form, getFormMemoText(form)),
        `${getMainKeyword(form)}\n${getFormMemoText(form)}`
      ).some((pattern) => regexTest(pattern, body)),
      detail: "점검 완료"
    }
  ];
};

const QUALITY_STOP_WORDS = new Set([
  "후기",
  "리뷰",
  "유명한",
  "곳",
  "사용",
  "방문",
  "확인",
  "필요",
  "좋음",
  "좋았음",
  "편함",
  "무난함",
  "궁금했음",
  "도움",
  "됐음"
]);

const normalizeMemoQualitySignal = (value = "") =>
  text(value)
    .replace(/(?:이|가|은|는|을|를|와|과|도|만|라|으로|로)$/u, "")
    .replace(/(?:했음|였음|었음|았음|함)$/u, "")
    .trim();

const HARD_FORBIDDEN_EXPRESSION_PATTERN =
  /인생맛집|역대급|효과\s*보장|가격\s*미쳤다|협찬이지만\s*솔직히|내돈내산처럼|무조건\s*추천|완전\s*대박|100%\s*해결|즉시효과|완치/u;

const getMemoQualitySignals = (form = {}) =>
  uniqueText(
    splitMemoLines(form.experienceMemo)
      .join(" ")
      .match(/[\p{Script=Hangul}A-Za-z0-9]+/gu) || []
  )
    .map((item) => normalizeMemoQualitySignal(item))
    .filter((item) => Array.from(item).length >= 2)
    .filter((item) => !QUALITY_STOP_WORDS.has(item))
    .slice(0, 16);

const countMemoSignalsInBody = (signals = [], body = "") =>
  signals.filter((signal) => body.includes(signal)).length;

const hasUnsupportedInformationClaim = (body = "", category = "place", memoText = "") => {
  if (category === "information" || category === "comparison") {
    return /직접\s*(?:방문|다녀|가보|사용|써보|이용|참여)|다녀왔|써봤/u.test(body);
  }

  if (category === "restaurant" || category === "cafe") {
    const hasParkingMemo = /주차/u.test(memoText);
    const hasWaitMemo = /웨이팅|대기/u.test(memoText);
    const hasPriceMemo = /가격|원|비싸|저렴/u.test(memoText);
    const hasAmountMemo = /양|많|넉넉|푸짐/u.test(memoText);
    const hasStaffMemo = /직원|응대|친절|서비스/u.test(memoText);
    const hasRevisitMemo = /재방문|다시\s*(?:가|방문)|또\s*가/u.test(memoText);
    const hasTasteMemo = /맛있|맛\s*좋|국물\s*(?:좋|진|시원|칼칼)|매콤|담백|불맛|식감/u.test(memoText);
    const parkingClaim = /주차(?:가|는)?\s*(?:편(?:했|한|해|합니다)|가능(?:했|한|합니다|해요)|무료(?:였|입니다|로)|넓(?:었|은|습니다))/u.test(body) && !hasParkingMemo;
    const waitClaim = /웨이팅(?:이|은)?\s*(?:없|짧|길|많)/u.test(body) && !hasWaitMemo;
    const priceClaim = /가격(?:은|이)?\s*(?:저렴|괜찮|비싸|\d[\d,]*원)/u.test(body) && !hasPriceMemo;
    const amountClaim = /(?:분위기와\s*)?양(?:이|은|도|까지)?\s*(?:많|넉넉|푸짐|부족하지|기억에\s*남|만족)|양,\s*응대/u.test(body) && !hasAmountMemo;
    const staffClaim = /직원\s*응대(?:가|는)?\s*(?:좋|친절|편)|응대(?:가|는|도|까지)?\s*(?:좋|친절|기억|편)/u.test(body) && !hasStaffMemo;
    const revisitClaim = /다시\s*(?:가고|방문하고)\s*싶|재방문\s*(?:의사|하고\s*싶|하고픈)/u.test(body) && !hasRevisitMemo;
    const tasteClaim = /맛있었|맛이\s*좋았|국물이\s*(?:시원|진하|칼칼|좋았)|식감이\s*좋/u.test(body) && !hasTasteMemo;

    return parkingClaim || waitClaim || priceClaim || amountClaim || staffClaim || revisitClaim || tasteClaim;
  }

  return false;
};

const normalizeQualityForbiddenScanText = (value = "", category = "place") => {
  if (category !== "product") return value;

  return String(value || "")
    .replace(/바쁜\s*일정/gu, "바쁜 하루")
    .replace(/일정\s*사이/gu, "하루 사이")
    .replace(/이동\s*일정/gu, "이동하는 날");
};

const createQualityCheck = (id, label, passed, weight, detail = "") => ({
  id,
  label,
  passed: Boolean(passed),
  weight,
  detail
});

const getRestaurantTitleIntentCount = (titles = [], mainKeyword = "", primaryMenu = "") => {
  const intents = new Set();

  titles.forEach((title) => {
    if (primaryMenu && title.includes(primaryMenu)) intents.add("menu");
    if (/초지|강화|지역|근처|맛집/u.test(title)) intents.add("region");
    if (/방문\s*후기|다녀온|들른|궁금했던|살펴보기|대기/u.test(title)) intents.add("experience");
    if (/가족|여행|외식|식사/u.test(title)) intents.add("family");
    if (/근처|위치|초지대교|강화도맛집/u.test(title)) intents.add("local-search");
    if (mainKeyword && title.startsWith(mainKeyword)) intents.add("main-front");
  });

  return intents.size;
};

const hasRestaurantTitleCandidateQuality = (titles = [], form = {}) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const primaryMenu = getPrimaryRestaurantMenu(form, memoText);
  const candidateTitles = uniqueText(titles).filter(Boolean).slice(0, 5);
  if (candidateTitles.length < 5) return false;

  const menuMentions = primaryMenu ? candidateTitles.filter((title) => title.includes(primaryMenu)).length : 5;
  const regionMentions = candidateTitles.filter((title) => /초지|강화|지역|근처|맛집/u.test(title)).length;
  const structureSeeds = new Set(candidateTitles.map((title) => title.replace(mainKeyword, "").split(/\s+/u).slice(0, 3).join(" ")));
  const hasAwkwardRepeatedTitle = candidateTitles.some((title) => /식사\s*후보|식사로\s*본\s*점|정보\s*정리|확인할\s*점/u.test(title));

  return (
    !hasAwkwardRepeatedTitle &&
    candidateTitles.every((title) => title.includes(mainKeyword) && Array.from(title).length >= 24 && Array.from(title).length <= 44) &&
    menuMentions >= 3 &&
    regionMentions >= 2 &&
    structureSeeds.size >= 4 &&
    getRestaurantTitleIntentCount(candidateTitles, mainKeyword, primaryMenu) >= 5
  );
};

const assessBlogWriterQuality = ({
  form = {},
  category = inferReviewCategory(form),
  selectedTitle = "",
  titleCandidates = [],
  body = "",
  hashtags = [],
  photoGuide = [],
  faqItems = []
} = {}) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const targetSettings = getTargetLengthSettings(form, category);
  const keywordRange = getMainKeywordTargetRange(targetSettings.target);
  const normalizedBody = normalizeBody(body);
  const paragraphs = normalizedBody.split(/\n{2,}/u).filter(Boolean);
  const firstParagraph =
    paragraphs.find((paragraph) => !/^\[사진 삽입:/u.test(paragraph) && !isLikelyBodyHeading(paragraph)) ||
    paragraphs[0] ||
    "";
  const firstSentence = firstParagraph.split(/(?<=[.!?。])\s+/u)[0] || firstParagraph;
  const keywordCount = countOccurrences(normalizedBody, mainKeyword);
  const subKeywords = getSubKeywords(form);
  const subKeywordCounts = subKeywords.map((keyword) => countOccurrences(normalizedBody, keyword));
  const memoSignals = getMemoQualitySignals(form);
  const memoMatches = countMemoSignalsInBody(memoSignals, normalizedBody);
  const forbiddenScanText = normalizeQualityForbiddenScanText(`${selectedTitle}\n${normalizedBody}`, category);
  const categoryForbidden = getCategoryForbiddenExpressions(
    category,
    detectProductSubtype(form, memoText),
    `${mainKeyword}\n${memoText}`
  ).some((pattern) => regexTest(pattern, forbiddenScanText));
  const imageCount = getImageCount(form);
  const photoMarkerCount = (normalizedBody.match(/\[사진 삽입:/gu) || []).length;
  const titleLength = Array.from(selectedTitle).length;
  const hasHardForbidden = HARD_FORBIDDEN_EXPRESSION_PATTERN.test(`${selectedTitle}\n${normalizedBody}`);
  const hasUnsupportedClaim = hasUnsupportedInformationClaim(normalizedBody, category, memoText);
  const hasWritingGuideLeak = WRITING_GUIDE_PATTERN.test(normalizedBody) || BLOG_WRITER_GUIDE_PATTERN.test(normalizedBody);
  const duplicateBodyIssues = collectDuplicateBodyIssues(normalizedBody);
  const primaryRestaurantMenu = category === "restaurant" ? getPrimaryRestaurantMenu(form, memoText) : "";
  const restaurantTitleCandidatesOk =
    category !== "restaurant" || hasRestaurantTitleCandidateQuality(titleCandidates.length > 0 ? titleCandidates : [selectedTitle], form);
  const sponsorship = getDetectedSponsorshipType(form);
  const sponsorshipDisclosureCount = sponsorship
    ? sponsorship === "식사권 제공"
      ? countOccurrences(normalizedBody, "식사권")
      : countOccurrences(normalizedBody, sponsorship)
    : 0;
  const hasSponsorshipDisclosure =
    !sponsorship ||
    sponsorship === "직접 구매" ||
    (sponsorship === "식사권 제공"
      ? sponsorshipDisclosureCount === 1 && /식사권을\s*제공받아/u.test(normalizedBody)
      : sponsorshipDisclosureCount === 1);
  const repeatedCheckInfo =
    category === "restaurant" &&
    ((normalizedBody.match(/\[확인 필요\]/gu) || []).length >= 2 ||
      (normalizedBody.match(/확인(?:해|하|할|하면|하고|한)/gu) || []).length > 14);
  const earlyRestaurantBody = paragraphs.slice(0, 5).join("\n");
  const hasWeakRestaurantMenuFocus =
    category === "restaurant" &&
    primaryRestaurantMenu &&
    (countOccurrences(normalizedBody, primaryRestaurantMenu) < 2 || !earlyRestaurantBody.includes(primaryRestaurantMenu));
  const hasKeywordPlacement =
    category === "restaurant"
      ? firstSentence.includes(mainKeyword) && keywordCount >= keywordRange.idealMin && keywordCount <= keywordRange.max
      : keywordCount >= 2 && keywordCount <= 8;
  const hasFirstSentenceQuality =
    (category === "restaurant" ? firstSentence.includes(mainKeyword) : true) &&
    !/무조건|대박|보장|이번 글/u.test(firstSentence) &&
    Array.from(firstSentence).length >= 16;
  const hasTone = /더라고요|있었어요|느껴졌어요|같아요|좋겠다는 생각/u.test(normalizedBody);
  const repeatedPhrasePenalty =
    (normalizedBody.match(/좋더라고요/gu) || []).length > 4 ||
    (normalizedBody.match(/궁금/gu) || []).length > 12;
  const blogWriterQuality = evaluateBlogWriterQuality({
    form,
    category,
    selectedTitle,
    titleCandidates,
    body: normalizedBody,
    mainKeyword,
    subKeywords,
    hashtags,
    faqItems,
    imageCount,
    photoGuide,
    targetCharCount: targetSettings.target,
    primaryMenu: primaryRestaurantMenu
  });

  const checks = [
    createQualityCheck(
      "category-match",
      "카테고리 일치도",
      !categoryForbidden && !hasHardForbidden,
      12,
      categoryForbidden ? "카테고리와 맞지 않는 표현이 섞였습니다." : "카테고리 표현 일치"
    ),
    createQualityCheck(
      "title-seo",
      "제목 SEO 품질",
      selectedTitle.includes(mainKeyword) && titleLength >= 24 && titleLength <= 46 && !hasHardForbidden,
      10,
      `${titleLength}자`
    ),
    createQualityCheck(
      "keyword-placement",
      "메인 키워드 배치",
      hasKeywordPlacement,
      10,
      `${keywordCount}회`
    ),
    createQualityCheck(
      "sub-keyword-coverage",
      "보조 키워드 반영",
      subKeywords.length === 0 || subKeywordCounts.every((count) => count >= 1 && count <= 5),
      4,
      subKeywords.length === 0 ? "보조 키워드 없음" : subKeywords.map((keyword, index) => `${keyword} ${subKeywordCounts[index]}회`).join(", ")
    ),
    createQualityCheck(
      "first-sentence",
      "첫 문장 품질",
      hasFirstSentenceQuality,
      8,
      firstSentence
    ),
    createQualityCheck(
      "memo-reflection",
      "메모 반영도",
      memoSignals.length === 0 || memoMatches >= Math.min(3, Math.max(1, Math.ceil(memoSignals.length * 0.45))),
      12,
      `${memoMatches}/${memoSignals.length}`
    ),
    createQualityCheck(
      "natural-tone",
      "문장 자연스러움",
      hasTone && paragraphs.length >= 6,
      8,
      hasTone ? "아는여자 톤 반영" : "말투 확인 필요"
    ),
    createQualityCheck(
      "repetition",
      "반복 표현 여부",
      !repeatedPhrasePenalty && duplicateBodyIssues.length === 0,
      6,
      duplicateBodyIssues[0] || (repeatedPhrasePenalty ? "반복 표현 점검 필요" : "반복 과다 없음")
    ),
    createQualityCheck(
      "writing-guide-leak",
      "작성 가이드 문장 노출 여부",
      !hasWritingGuideLeak,
      0,
      hasWritingGuideLeak ? "내부 작성 가이드 문장 포함" : "노출 없음"
    ),
    createQualityCheck(
      "forbidden-expression",
      "금지 표현 포함 여부",
      !hasHardForbidden,
      12,
      hasHardForbidden ? "금지 표현 포함" : "금지 표현 없음"
    ),
    createQualityCheck(
      "unsupported-claim",
      "확인되지 않은 정보 단정 여부",
      !hasUnsupportedClaim,
      8,
      hasUnsupportedClaim ? "제공되지 않은 정보 단정 가능성" : "확인 필요 정보 분리"
    ),
    createQualityCheck(
      "core-menu-focus",
      "대표 메뉴 중심성",
      !hasWeakRestaurantMenuFocus,
      0,
      hasWeakRestaurantMenuFocus ? `${primaryRestaurantMenu} 초반 반영 부족` : "대표 메뉴 초반 반영"
    ),
    createQualityCheck(
      "restaurant-title-intents",
      "맛집 제목 후보 의도 분리",
      restaurantTitleCandidatesOk,
      0,
      restaurantTitleCandidatesOk ? "의도 분리" : "메뉴/지역/상황형 제목 후보 보강 필요"
    ),
    createQualityCheck(
      "publishable-blog-quality",
      "판매용 블로그 품질",
      blogWriterQuality.score >= 95 && !blogWriterQuality.criticalFailed,
      0,
      blogWriterQuality.issues[0] || `${blogWriterQuality.score}점`
    ),
    createQualityCheck(
      "sponsorship-disclosure",
      "협찬 고지 1회 반영",
      hasSponsorshipDisclosure,
      0,
      hasSponsorshipDisclosure ? "고지 정상" : "협찬 고지 누락 또는 반복"
    ),
    createQualityCheck(
      "check-info-repetition",
      "확인 정보 반복 여부",
      !repeatedCheckInfo,
      0,
      repeatedCheckInfo ? "확인 정보 반복 과다" : "반복 없음"
    ),
    createQualityCheck(
      "photo-placement",
      "사진 삽입 위치 자연스러움",
      imageCount === 0 || (photoMarkerCount >= 1 && photoMarkerCount <= Math.min(imageCount, 3) && photoGuide.length > 0),
      6,
      `${photoMarkerCount}/${imageCount}`
    ),
    createQualityCheck(
      "faq-quality",
      "FAQ 품질",
      faqItems.length >= 3 && faqItems.every((item) => text(item.question).length > 0 && text(item.answer).length > 0),
      8,
      `${faqItems.length}개`
    ),
    createQualityCheck(
      "hashtag-quality",
      "해시태그 품질",
      hashtags.length >= 8 && hashtags.length <= 15 && hashtags.some((tag) => compact(tag).includes(compact(mainKeyword).slice(0, 4))),
      6,
      `${hashtags.length}개`
    )
  ];
  const rawScore = checks.reduce((score, item) => score + (item.passed ? item.weight : 0), 0);
  const criticalFailed =
    categoryForbidden ||
    hasHardForbidden ||
    hasUnsupportedClaim ||
    hasWritingGuideLeak ||
    duplicateBodyIssues.length > 0 ||
    hasWeakRestaurantMenuFocus ||
    !restaurantTitleCandidatesOk ||
    blogWriterQuality.criticalFailed ||
    !hasSponsorshipDisclosure ||
    repeatedCheckInfo ||
    (category === "restaurant" && keywordCount < keywordRange.min);
  const score = Math.max(0, Math.min(100, Math.round(criticalFailed ? Math.min(rawScore, 89) : rawScore)));
  const issues = checks
    .filter((item) => !item.passed)
    .map((item) => `${item.label}: ${item.detail}`);

  return {
    score,
    issues,
    checks,
    blogWriterQuality
  };
};

const createChecklistBodySection = (items = []) =>
  [
    "최종 검수표",
    ...items.map((item) => `- ${item.label}: ${item.detail}`)
  ].join("\n");

const getBodyLength = (body = "") => String(body || "").replace(/\s+/g, "").length;

const getMainKeywordTargetRange = (targetCharCount = DEFAULT_TARGET_LENGTH) => {
  const target = Number.isFinite(Number(targetCharCount)) ? Number(targetCharCount) : DEFAULT_TARGET_LENGTH;

  if (target < 1600) return { min: 4, idealMin: 4, idealMax: 5, max: 6 };
  if (target < 2400) return { min: 5, idealMin: 5, idealMax: 6, max: 7 };
  if (target < 3500) return { min: 6, idealMin: 7, idealMax: 8, max: 9 };
  return { min: 7, idealMin: 8, idealMax: 9, max: 10 };
};

const createRestaurantKeywordSupportParagraphs = (form = {}, currentBody = "", targetSettings = {}) => {
  const mainKeyword = getMainKeyword(form);
  if (!mainKeyword) return [];

  const memoText = getFormMemoText(form);
  const range = getMainKeywordTargetRange(targetSettings.target);
  const currentCount = countOccurrences(currentBody, mainKeyword);
  const needed = Math.max(0, range.idealMin - currentCount);
  if (needed === 0) return [];

  const subKeywords = getSubKeywords(form);
  const regionKeyword = subKeywords.find((keyword) => /맛집|초지|강화|근처|지역/u.test(keyword)) || "";
  const primaryMenu = getPrimaryRestaurantMenu(form, memoText) || subKeywords.find((keyword) => getRestaurantMenus(keyword).length > 0) || "";
  const familyCue = /가족|여행|외식|아이/u.test(memoText);
  const familySupportContext = /강화|여행/u.test(`${mainKeyword} ${regionKeyword} ${memoText}`) ? "강화도 가족여행 중 식사할 곳을 찾을 때" : "가족 식사를 떠올릴 때";
  const support = [
    `${mainKeyword}은 ${familyCue ? familySupportContext : "식사할 곳을 찾을 때"} 메뉴 이름과 방문 상황이 함께 떠오르는 곳이었습니다`,
    regionKeyword
      ? `${regionKeyword}으로 찾는다면 ${mainKeyword}의 메뉴 사진과 주변 일정을 나란히 떠올리게 됩니다`
      : `${mainKeyword}을 볼 때는 메뉴 사진과 방문 상황을 함께 떠올리게 됩니다`,
    primaryMenu
      ? `${mainKeyword}은 ${primaryMenu} 메뉴가 먼저 떠오르는 곳이라 사진으로 보이는 구성을 차분히 살펴보게 됐습니다`
      : `${mainKeyword}은 대표 메뉴 구성이 먼저 궁금해지는 곳이라 사진으로 보이는 범위를 차분히 살펴보게 됐습니다`,
    `${mainKeyword}을 다시 보면 가격이나 운영시간보다, ${familyCue ? "가족과 함께 들른 식사 기억" : "식사 자리의 흐름"}이 먼저 남았습니다`
  ];

  return support.slice(0, Math.min(needed, support.length));
};

const ensureRestaurantKeywordDensity = (body = "", form = {}, category = inferReviewCategory(form), targetSettings = {}) => {
  if (category !== "restaurant") return body;

  const supportParagraphs = createRestaurantKeywordSupportParagraphs(form, body, targetSettings);
  if (supportParagraphs.length === 0) return body;

  const supportSection = createSectionBlock("식사 후보로 볼 때", [supportParagraphs], normalizeTone(form.tone));
  if (body.includes("\n\n사진으로 본 메뉴 구성\n\n")) {
    return normalizeBody(body.replace("\n\n사진으로 본 메뉴 구성\n\n", `\n\n${supportSection}\n\n사진으로 본 메뉴 구성\n\n`));
  }
  if (body.includes("\n\n방문 전 참고하면 좋은 점\n\n")) {
    return normalizeBody(body.replace("\n\n방문 전 참고하면 좋은 점\n\n", `\n\n${supportSection}\n\n방문 전 참고하면 좋은 점\n\n`));
  }

  return normalizeBody([body, supportSection].join("\n\n"));
};

const ensureRestaurantMinimumBodyLength = (body = "", form = {}, category = inferReviewCategory(form), targetSettings = {}) => {
  if (category === "restaurant" && targetSettings.informationLimited) return body;
  if (category === "restaurant" && targetSettings.option === "custom" && getBodyLength(body) >= 1200) return body;

  const desiredMin = Number.isFinite(Number(targetSettings.target))
    ? Math.max(Number(targetSettings.min) || 0, Math.min(Number(targetSettings.target), Number(targetSettings.max) || Number(targetSettings.target)))
    : Number(targetSettings.min) || 0;
  if (category !== "restaurant" || getBodyLength(body) >= desiredMin) return body;

  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const subKeywords = getSubKeywords(form);
  const regionKeyword = subKeywords.find((keyword) => /초지|강화|맛집|근처/u.test(keyword)) || "지역 맛집";
  const primaryMenu = getPrimaryRestaurantMenu(form, memoText) || subKeywords.find((keyword) => getRestaurantMenus(keyword).length > 0) || "대표 메뉴";
  const hasFamilyCue = /가족|여행|외식|아이/u.test(memoText);
  const hasGroupCue = /회식|직장인|모임|동료/u.test(memoText);
  const hasRegionTravelCue = /강화|여행/u.test(`${mainKeyword} ${regionKeyword} ${memoText}`);
  const familyContextLabel = hasRegionTravelCue ? "가족여행" : "가족 식사";
  const supportHeading = hasGroupCue ? "회식 식사로 볼 부분" : hasFamilyCue ? `${familyContextLabel}에서 본 부분` : "식사 전에 본 부분";
  const planText = hasGroupCue ? "회식 자리" : hasFamilyCue ? "가족 식사 계획" : "식사 계획";
  const supportParagraphs = [
    `${regionKeyword}으로 찾는 날에는 상호명만 보는 것보다 메뉴 사진과 식사 시간을 함께 떠올리게 됩니다. ${mainKeyword}은 그런 흐름에서 위치와 메뉴를 나란히 놓고 보기 좋았습니다.`,
    hasGroupCue
      ? `직장인 회식 장소로 볼 때는 메뉴를 나눠 먹기 좋은지와 인원수에 맞는 구성이 가능한지가 먼저 보였습니다. 같이 움직이는 자리에서는 메뉴가 분명하고 위치를 가늠하기 쉬운지가 생각보다 크게 남습니다.`
      : hasFamilyCue
      ? `${familyContextLabel}으로 다녀와서 좋았던 기억은 거창한 장점보다 메뉴가 분명해 함께 고르기 편했다는 쪽에 가까웠습니다. 같이 움직이는 날에는 식사 시간이 너무 늘어지지 않는지도 자연스럽게 보게 됩니다.`
      : `같이 움직이는 날에는 메뉴가 분명하고 식사 시간이 부담스럽지 않은지가 생각보다 크게 남습니다. 이런 부분이 실제 방문 전 마음을 정하는 데 더 도움이 됐습니다.`,
    `사진으로 보니 ${withTopicParticle(primaryMenu)} 메뉴 이름과 구성이 먼저 눈에 들어왔습니다. 방문 전 메뉴를 고를 때도 이런 사진이 있으면 선택이 조금 쉬워집니다.`,
    `${regionKeyword}을 살펴볼 때는 가격이나 운영시간처럼 바뀌는 정보보다 먼저 메뉴 사진과 방문 상황을 보게 됩니다. 그 다음 최신 안내를 한 번 살피면 ${planText}을 세우기가 훨씬 편합니다.`,
    "사진이 있으면 음식의 첫인상과 구성을 차분히 볼 수 있습니다. 메뉴 사진과 방문 상황이 이어지면 그날의 식사 분위기도 더 쉽게 떠오릅니다.",
    hasGroupCue
      ? "회식처럼 함께 움직이는 날에는 한 사람이 좋아하는 메뉴보다 여럿이 나눠 먹기 좋은 선택지가 중요했습니다. 그래서 대표 메뉴와 위치, 대기 가능성을 나눠 보는 방식이 더 현실적으로 느껴졌습니다."
      : "가족과 함께 움직이는 날에는 한 사람이 좋아하는 메뉴보다 모두가 무난하게 고를 수 있는 선택지가 중요했습니다. 그래서 대표 메뉴와 위치, 대기 가능성을 나눠 보는 방식이 더 현실적으로 느껴졌습니다.",
    "식사 전에는 메뉴 이름이 분명한지, 오가는 길이 부담스럽지 않은지, 사진으로 볼 수 있는 구성이 충분한지를 차례로 보게 됩니다. 이 정도만 보아도 가족 식사 일정에 넣을지 감이 조금 잡힙니다.",
    `처음 보는 식당은 이름만 보는 것보다 왜 그곳을 보게 됐는지, 어떤 상황에서 떠올리면 좋은지가 드러날 때 더 오래 기억됩니다. ${hasGroupCue ? "회식처럼" : "가족 식사처럼"} 동행이 있는 날에는 이런 맥락이 특히 중요합니다.`,
    hasRegionTravelCue
      ? "강화도 일정에서는 이동 시간이 길어질 수 있어 식사 시간이 과하게 늘어지지 않는지도 생각하게 됩니다. 메뉴가 뚜렷한 곳은 이런 상황에서 선택을 줄이는 데 도움이 됩니다."
      : "가족이나 여럿이 움직이는 일정에서는 식사 시간이 과하게 늘어지지 않는지도 생각하게 됩니다. 메뉴가 뚜렷한 곳은 이런 상황에서 선택을 줄이는 데 도움이 됩니다.",
    "여럿이 함께 움직이면 각자 먹고 싶은 메뉴가 달라질 수 있지만, 국물 메뉴처럼 중심이 되는 메뉴가 있으면 선택이 조금 쉬워집니다. 그 점에서 메뉴 이름과 사진이 함께 보이는 후기가 더 편하게 읽힙니다.",
    "가족여행 중 들른 식당은 위치, 메뉴, 여행 상황이 같이 남을 때 더 오래 기억됩니다. 같은 지역을 다시 찾을 때도 그날의 식사 장면을 떠올리기가 쉽습니다.",
    `마지막에는 좋았던 감정과 함께 어떤 점에서 편했는지가 남으면 더 실용적입니다. ${familyContextLabel} 중 들른 식사였다는 맥락이 있으면 같은 지역을 찾는 사람에게도 도움이 됩니다.`,
    "여행 중 식사는 목적지가 아니라 일정 사이에 자연스럽게 들어가는 시간이기도 합니다. 그래서 부담 없이 들를 수 있는지, 대표 메뉴가 분명한지, 사진으로 본 구성이 낯설지 않은지가 실제 선택에 영향을 줍니다.",
    "이런 기준이 잡히면 짧은 식사 시간도 여행 기억 안에서 훨씬 또렷하게 남습니다."
  ];
  const selectedParagraphs = [];
  let draft = body;

  for (const paragraph of supportParagraphs) {
    if (getBodyLength(draft) >= desiredMin) break;
    selectedParagraphs.push(paragraph);
    const supportSection = createSectionBlock(supportHeading, [selectedParagraphs], normalizeTone(form.tone));
    draft = body.includes("\n\n사진으로 본 메뉴 구성\n\n")
      ? normalizeBody(body.replace("\n\n사진으로 본 메뉴 구성\n\n", `\n\n${supportSection}\n\n사진으로 본 메뉴 구성\n\n`))
      : normalizeBody([body, supportSection].join("\n\n"));
  }

  return selectedParagraphs.length > 0 ? draft : body;
};

const limitRestaurantSubKeywordRepetition = (body = "", form = {}, category = inferReviewCategory(form)) => {
  if (category !== "restaurant") return body;

  let result = body;
  getSubKeywords(form).forEach((keyword) => {
    const isMenuKeyword = getRestaurantMenus(keyword).length > 0;
    const keepCount = isMenuKeyword ? 5 : /가족|여행/u.test(keyword) ? 8 : 4;
    if (!keyword || countOccurrences(result, keyword) <= keepCount) return;

    const alternatives = isMenuKeyword
      ? /짬뽕|갈낙/u.test(keyword)
        ? ["이 메뉴", "짬뽕 메뉴", "메뉴 사진", "국물 메뉴"]
        : ["대표 메뉴", "이 메뉴", "메뉴 사진", "함께 볼 메뉴"]
      : /가족|여행/u.test(keyword)
        ? ["여행 중 식사", "가족 식사", "그날 일정", "식사 기억"]
        : ["지역 맛집", "강화도 일정", "근처 식당", "여행 중 식사"];
    let seen = 0;
    result = result.replace(new RegExp(escapeRegExp(keyword), "gu"), (match) => {
      seen += 1;
      if (seen <= keepCount) return match;
      return alternatives[(seen - keepCount - 1) % alternatives.length];
    });
  });

  return normalizeBody(result);
};

const limitRestaurantHeadingCount = (body = "", category = "place", maxHeadings = 8) => {
  if (category !== "restaurant") return body;

  let headingCount = 0;
  const paragraphs = normalizeBody(body).split(/\n{2,}/u).filter(Boolean);
  const filtered = paragraphs.filter((paragraph) => {
    if (!isLikelyBodyHeading(paragraph)) return true;
    headingCount += 1;
    return headingCount <= maxHeadings;
  });

  return normalizeBody(filtered.join("\n\n"));
};

const ensureGeneralMinimumBodyLength = (body = "", form = {}, category = inferReviewCategory(form), targetSettings = {}) => {
  const desiredMin = category === "information" ? Math.max(Number(targetSettings.min) || 0, 1000) : Number(targetSettings.min) || 0;
  if (category === "restaurant" || getBodyLength(body) >= desiredMin) return body;

  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const tone = normalizeTone(form.tone);
  const educationSupport = [
    `${mainKeyword}을 처음 보는 입장에서는 용어를 외우는 것보다 전체 순서를 먼저 잡는 편이 부담이 적습니다. 공고를 보고, 조건을 살피고, 입찰 흐름을 이해하는 순서가 보이면 낯선 주제도 조금 작게 느껴집니다.`,
    /커리큘럼/u.test(memoText)
      ? "커리큘럼을 미리 볼 수 있다는 점은 수업을 고를 때 꽤 중요한 기준이 됩니다. 내가 궁금한 단계가 포함되어 있는지, 초보자가 따라갈 수 있는 흐름인지 비교하기가 쉬워지기 때문입니다."
      : "수업을 고를 때는 강의 시간이 길어 보이는지보다 내가 궁금한 단계가 실제로 다뤄지는지가 더 중요합니다. 처음 듣는 사람일수록 전체 순서와 예시가 함께 있는 구성이 편합니다.",
    /입찰/u.test(memoText)
      ? "입찰 흐름은 한 번에 이해하기보다 반복되는 단계를 나눠 보는 쪽이 현실적입니다. 공고, 조건, 참여 방식, 이후 절차가 구분되면 수업 뒤에 무엇을 더 찾아봐야 할지도 선명해집니다."
      : "낯선 분야는 결과보다 준비 과정이 더 크게 느껴질 때가 많습니다. 그래서 수업 전에는 준비물, 기본 용어, 질문할 수 있는 범위를 차례로 보는 것이 좋습니다.",
    `${mainKeyword}은 초보자 기준으로 보면 어려운 단어를 줄이고 큰 흐름을 먼저 잡는 데 의미가 있습니다. 이후 세부 자료를 다시 찾아보더라도 처음 방향을 잡아둔 상태라면 훨씬 덜 막막합니다.`
  ];
  const informationSupport = [
    `${mainKeyword}을 처음 보는 입장에서는 공고문 기준일, 신청 대상, 제외 조건을 먼저 나눠두면 전체 흐름이 더 선명해집니다. 조건이 맞는지부터 본 뒤 세부 절차를 따라가면 불필요한 시행착오를 줄일 수 있습니다.`,
    /입찰|공고/u.test(memoText)
      ? "입찰 흐름은 공고 확인, 내용 검토, 참여 준비, 결과 확인처럼 단계가 이어집니다. 각 단계마다 필요한 자료와 판단 기준이 달라서 한 번에 결론을 내리기보다 순서를 나눠 보는 편이 현실적입니다."
      : "절차형 정보는 준비 단계, 신청 단계, 결과 확인 단계를 나눠 보면 읽는 부담이 줄어듭니다. 단계별로 필요한 자료가 달라질 수 있어 최신 안내와 기준일을 함께 보는 편이 좋습니다.",
    /리스크|위험|주의/u.test(memoText)
      ? "리스크가 있는 주제는 장점보다 제한 조건, 비용, 일정 변수를 먼저 보는 편이 안전합니다. 특히 조건이 바뀔 수 있는 정보는 공고문 원문과 최신 안내를 함께 보아야 판단이 흔들리지 않습니다."
      : "마지막에는 내가 바로 확인할 항목과 나중에 다시 볼 항목을 나누면 좋습니다. 이렇게 정리해두면 같은 내용을 다시 볼 때도 필요한 부분을 더 빨리 찾을 수 있습니다."
  ];
  const genericSupport = [
    `${mainKeyword}을 처음 살펴볼 때는 장점만 보는 것보다 내 상황과 맞는 기준을 먼저 나누는 편이 좋습니다. 필요한 정보가 어디에 있는지 알면 실제 선택이 훨씬 쉬워집니다.`,
    "사진이나 짧은 기억이 함께 있으면 전체 분위기를 떠올리기 좋습니다. 다만 바뀔 수 있는 정보는 최신 안내를 보고, 직접 느낀 부분과 구분해서 읽는 편이 더 현실적입니다.",
    "마지막으로 비교할 기준을 남겨두면 같은 주제를 다시 볼 때도 덜 헷갈립니다. 처음 본 인상, 실제로 중요했던 점, 나중에 다시 살펴볼 내용을 나눠두면 글의 쓰임이 분명해집니다."
  ];
  const support = category === "education" ? educationSupport : category === "information" ? informationSupport : genericSupport;
  const selectedParagraphs = [];
  let draft = body;

  for (const paragraph of support) {
    if (getBodyLength(draft) >= desiredMin) break;
    selectedParagraphs.push(paragraph);
    draft = normalizeBody([body, createSectionBlock("마지막으로 비교할 기준", [selectedParagraphs], tone)].join("\n\n"));
  }

  return selectedParagraphs.length > 0 ? draft : body;
};

const createInformationMinimumTopUpSection = (form = {}) => {
  const mainKeyword = getMainKeyword(form) || "정보";
  return [
    "리스크와 확인 순서",
    [
      `${withObjectParticle(mainKeyword)} 볼 때는 공고문 기준일과 제한 조건을 먼저 나눠두는 편이 좋아요.`,
      "입찰 흐름은 공고 확인, 내용 검토, 참여 준비, 결과 확인 순서로 이어지기 때문에 단계별로 필요한 자료가 달라질 수 있어요.",
      "리스크는 장점 뒤로 미루기보다 비용, 일정, 제외 조건과 함께 보아야 나중에 판단이 덜 흔들려요.",
      "처음에는 공고문 제목만 보고 전체 내용을 안다고 느끼기 쉽지만, 실제로는 신청 대상과 제외 조건을 따로 보는 과정이 더 중요해요.",
      "일정이 바뀌거나 제출 서류가 달라질 수 있는 주제라면 기준일을 적어두고 최신 안내를 다시 보는 편이 훨씬 안정적이에요.",
      "초보자 기준에서는 어려운 용어를 모두 외우기보다 공고문에서 반복되는 표현과 절차를 먼저 익히는 편이 현실적이에요.",
      "공고문을 읽을 때는 대상, 기간, 준비서류, 제한 조건을 따로 표시해두면 다음 단계에서 필요한 자료를 찾기가 쉬워요.",
      "입찰 흐름처럼 단계가 있는 주제는 한 문단에 몰아쓰기보다 순서를 나눠두어야 초보자도 덜 막막해요.",
      "헷갈리는 표현은 공고문 원문과 함께 적어두면 나중에 다시 비교하기도 쉬워요.",
      "마지막에는 내가 바로 볼 항목과 나중에 다시 볼 항목을 나눠두면 같은 내용을 다시 찾아볼 때도 훨씬 덜 헷갈려요."
    ].join(" ")
  ].join("\n\n");
};

const isLikelyBodyHeading = (paragraph = "") => {
  const value = text(paragraph);
  if (!value || /^\[사진 삽입:/u.test(value)) return false;
  if (/^(?:왜|대표|매장|맛과|이런|좋았던|가족|마무리|방문 전|정리해서|한 번|.+기준|.+부분|.+점)(?:\s|$)/u.test(value)) {
    return Array.from(value).length <= 32 && !/[.!?。]$/u.test(value);
  }
  return !/[.!?。요다]$/u.test(value) && Array.from(value).length <= 32;
};

const normalizeDuplicateBodyKey = (paragraph = "") =>
  compact(paragraph)
    .replace(/(?:이에요|예요|입니다|습니다|했어요|합니다|같아요|좋겠어요|좋겠습니다|되었습니다)$/u, "")
    .slice(0, 120);

const collectDuplicateBodyIssues = (body = "") => {
  const paragraphs = normalizeBody(body).split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const headings = new Set();
  const paragraphKeys = new Set();
  const issues = [];

  paragraphs.forEach((paragraph) => {
    if (/^\[사진 삽입:/u.test(paragraph)) return;

    if (isLikelyBodyHeading(paragraph)) {
      const headingKey = compact(paragraph);
      if (headings.has(headingKey)) {
        issues.push(`중복 소제목: ${paragraph}`);
      }
      headings.add(headingKey);
      return;
    }

    const key = normalizeDuplicateBodyKey(paragraph);
    if (Array.from(key).length < 18) return;

    if (paragraphKeys.has(key)) {
      issues.push(`중복 문단: ${paragraph.slice(0, 32)}`);
    }
    paragraphKeys.add(key);
  });

  return issues;
};

const dedupePublishableBody = (body = "") => {
  const paragraphs = normalizeBody(body).split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const headings = new Set();
  const paragraphKeys = new Set();
  const result = [];

  paragraphs.forEach((paragraph) => {
    if (/^\[사진 삽입:/u.test(paragraph)) {
      result.push(paragraph);
      return;
    }

    if (isLikelyBodyHeading(paragraph)) {
      const headingKey = compact(paragraph);
      if (headings.has(headingKey)) return;
      headings.add(headingKey);
      result.push(paragraph);
      return;
    }

    const key = normalizeDuplicateBodyKey(paragraph);
    if (Array.from(key).length >= 18 && paragraphKeys.has(key)) return;
    if (Array.from(key).length >= 18) paragraphKeys.add(key);
    result.push(paragraph);
  });

  const withoutOrphanHeadings = result.filter((paragraph, index) => {
    if (!isLikelyBodyHeading(paragraph)) return true;

    const nextContent = result.slice(index + 1).find((item) => !/^\[사진 삽입:/u.test(item));
    return Boolean(nextContent && !isLikelyBodyHeading(nextContent));
  });

  return normalizeBody(withoutOrphanHeadings.join("\n\n"));
};

const trimBodyToMaxLength = (body = "", targetSettings = {}) => {
  const max = Number(targetSettings.max);
  const min = Number(targetSettings.min) || 0;
  const normalized = normalizeBody(body);

  if (!Number.isFinite(max) || getBodyLength(normalized) <= max) return normalized;

  const paragraphs = normalized.split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const kept = [];

  for (const paragraph of paragraphs) {
    const trial = normalizeBody([...kept, paragraph].join("\n\n"));
    const current = normalizeBody(kept.join("\n\n"));

    if (kept.length > 0 && getBodyLength(trial) > max && getBodyLength(current) >= min) {
      break;
    }

    kept.push(paragraph);
  }

  return normalizeBody(kept.join("\n\n")) || normalized;
};

const createNaturalReviewExpansionSections = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const baseKeyword = getReviewTitleBase(mainKeyword);
  const memoText = getFormMemoText(form);
  const tone = normalizeTone(form.tone);
  const isDryShampoo = category === "product" && /드라이샴푸|운동|떡진|보송/u.test(`${mainKeyword} ${memoText}`);

  if (category === "product") {
    return [
      createSectionBlock("왜 사용하게 됐는지", [
        [
          isDryShampoo
            ? "운동을 하고 난 뒤 바로 씻거나 드라이할 시간이 없을 때 머리 상태가 가장 신경 쓰였습니다"
            : "처음에는 제품 설명보다 실제 생활 안에서 손이 자주 갈 수 있는지가 더 궁금했습니다",
          `${withTopicParticle(mainKeyword)} 그런 순간에 바로 꺼내 쓸 수 있는지, 사용 후 느낌이 부담스럽지 않은지를 중심으로 보게 됐습니다`,
          "후기를 남길 때도 과장된 표현보다 내가 실제로 불편했던 상황에서 얼마나 도움이 됐는지가 더 중요하게 느껴졌습니다"
        ]
      ], tone),
      createSectionBlock("직접 사용하며 느낀 점", [
        [
          isDryShampoo
            ? "운동 후에는 앞머리나 정수리 쪽이 눌려 보이는 순간이 있는데, 그때 빠르게 정돈할 수 있다는 점이 가장 먼저 남았습니다"
            : "처음 사용할 때는 향, 질감, 사용 후 남는 느낌처럼 작은 부분을 더 자세히 보게 됐습니다",
          /휴대/u.test(memoText)
            ? "휴대가 편하다는 점은 생각보다 크게 느껴졌습니다. 집에서만 쓰는 제품이면 손이 덜 가는데, 가방에 넣어두기 괜찮으면 필요한 순간에 바로 꺼내기 쉽습니다"
            : "사용 과정이 번거롭지 않은지는 오래 쓰게 되는 제품인지 판단할 때 꽤 중요한 기준이었습니다",
          /향/u.test(memoText)
            ? "향은 너무 강하게 남는 쪽보다 무난하게 지나가는 쪽으로 느껴졌고, 운동 후에 써도 부담이 크지 않았습니다"
            : "향이나 마무리감은 사람마다 다르게 느낄 수 있어서 처음에는 적은 양으로 확인해보는 편이 편했습니다"
        ]
      ], tone),
      createSectionBlock("좋았던 점", [
        [
          /보송/u.test(memoText)
            ? "가장 좋았던 점은 떡져 보이는 느낌을 조금 더 보송하게 정리할 수 있었다는 부분입니다"
            : "가장 좋았던 점은 손이 가는 상황이 분명하다는 부분이었습니다",
          isDryShampoo
            ? "완전히 스타일링을 새로 하는 느낌은 아니어도, 급하게 사람을 만나거나 이동해야 할 때 머리 상태가 덜 신경 쓰이게 해주는 정도로는 충분히 만족스러웠습니다"
            : "매일 쓰는 제품은 드라마틱한 변화보다 불편함 없이 반복해서 쓸 수 있는지가 더 중요하다고 느꼈습니다",
          "사용 전후를 사진으로 남겨두면 내가 느낀 차이를 나중에 다시 보기에도 좋고, 글을 읽는 사람도 사용 상황을 더 쉽게 떠올릴 수 있을 것 같습니다"
        ]
      ], tone),
      createSectionBlock("아쉬운 점", [
        [
          isDryShampoo
            ? "아쉬운 점은 어디까지나 급할 때 쓰는 보조 제품에 가깝다는 점입니다"
            : "아쉬운 점은 기대한 사용감과 실제 느낌이 사람마다 조금씩 다를 수 있다는 부분입니다",
          "가격, 용량, 구매처처럼 바뀔 수 있는 정보는 직접 확인한 뒤 비교하는 편이 좋겠고, 사용감은 내 두피나 생활 패턴과 맞는지도 같이 봐야 합니다",
          "그래도 짧은 시간 안에 정리가 필요했던 상황을 떠올리면, 이런 제품을 하나쯤 챙겨두는 이유는 분명히 느껴졌습니다"
        ]
      ], tone),
      createSectionBlock("이런 분께 추천해요", [
        [
          isDryShampoo
            ? "운동 후 바로 약속이 있거나 출근 전 시간이 부족한 분이라면 특히 활용도가 있을 것 같습니다"
            : "사용 과정이 간단하고 일상에서 부담 없이 쓸 제품을 찾는 분께 잘 맞을 것 같습니다",
          /휴대/u.test(memoText)
            ? "휴대성을 중요하게 보는 분에게도 괜찮습니다. 큰 준비 없이 가방에 넣어두고 필요할 때 꺼내는 용도로 생각하면 기대치가 더 잘 맞습니다"
            : "매일 쓰는 루틴에 새 제품을 추가할 때 번거로움을 싫어하는 분이라면 사용 방식부터 먼저 비교해보면 좋겠습니다",
          /향/u.test(memoText)
            ? "향이 너무 강한 제품을 부담스러워하는 분이라면 향의 잔향이 내 취향과 맞는지도 같이 보면 좋겠습니다"
            : "향이나 마무리감은 취향 차이가 있어서, 가능하면 실제 사용 후기를 여러 개 비교해보는 편이 편합니다"
        ]
      ], tone),
      createSectionBlock("전체적으로 보면", [
        [
          `${withTopicParticle(mainKeyword)} 한 번에 모든 고민을 해결해주는 제품이라기보다, 필요한 순간에 빠르게 정리해주는 보조 아이템에 가깝게 느껴졌습니다`,
          "그 기준으로 보면 장점이 꽤 분명합니다. 사용 상황이 맞으면 만족도가 올라가고, 기대하는 역할이 다르면 아쉬움도 생길 수 있습니다",
          "저는 운동 후처럼 머리 상태가 갑자기 신경 쓰이는 순간을 기준으로 봤을 때, 휴대성과 간편함이 가장 크게 남았습니다",
          "바쁜 날에는 작은 불편함을 빨리 줄여주는 제품이 더 자주 손에 잡히는데, 이 제품도 그런 용도로 생각하면 기대치가 잘 맞았습니다"
        ]
      ], tone),
      createSectionBlock("마무리", [
        [
          `${withTopicParticle(mainKeyword)} 바쁜 일정 사이에 머리 상태를 빠르게 정돈하고 싶을 때 떠올리기 좋은 제품이었습니다`,
          isDryShampoo
            ? "특히 운동 후 바로 이동해야 하거나 머리를 감기 애매한 상황이 자주 있는 분이라면 한 번쯤 비교해볼 만합니다"
            : `${withConditionalParticle(`${baseKeyword} 사용감`)} 중요하게 보는 분이라면 내 루틴과 맞는지 기준을 잡아보기 좋습니다`,
          "사용 전에는 기대치를 너무 크게 잡기보다 내가 불편했던 순간을 줄여주는지에 맞춰 보는 편이 좋았습니다",
          "좋았던 점과 아쉬운 점이 모두 있는 만큼, 내 상황에 맞는 보조 아이템인지 차분히 보고 선택하면 더 만족스럽게 쓸 수 있을 것 같습니다",
          "저처럼 운동 후 머리 상태가 신경 쓰였던 분이라면 사용 상황을 떠올려보고, 향과 마무리감이 취향에 맞는지도 함께 보면 좋겠습니다"
        ]
      ], tone)
    ];
  }

  if (category === "store") {
    return [
      createSectionBlock("왜 방문하게 됐는지", [
        [
          `${withObjectParticle(mainKeyword)} 알아보게 된 건 처음 방문해도 편하게 상담을 받을 수 있는 곳인지 궁금했기 때문입니다`,
          "금액이나 조건이 얽힌 일은 설명을 듣는 과정이 편해야 마음이 놓이는데, 그래서 응대 분위기를 가장 먼저 보게 됐습니다",
          "처음부터 결정을 내리기보다 어떤 흐름으로 상담이 이어지는지, 궁금한 점을 물어보기 괜찮은 분위기인지가 중요했습니다"
        ]
      ], tone),
      createSectionBlock("방문하면서 느낀 점", [
        [
          `${withObjectParticle(mainKeyword)} 알아볼 때는 가격이나 조건도 중요하지만, 처음 상담을 받을 때 부담이 덜한지가 크게 느껴졌습니다`,
          /친절|사장님/u.test(memoText)
            ? "응대가 친절했다는 기억이 남아 있으면 처음 방문하는 사람도 조금 더 편하게 들어갈 수 있겠다는 생각이 듭니다"
            : "처음 방문하는 매장은 설명을 차분하게 들을 수 있는지부터 보게 됩니다",
          /아드님|2대째|이대째/u.test(memoText)
            ? "2대째 이어오는 곳이라는 점도 오래 운영된 분위기를 느끼게 해줘서 인상적이었습니다"
            : "상담 과정이 너무 빠르게 지나가지 않고 궁금한 부분을 물어볼 수 있으면 훨씬 편합니다",
          "매장 분위기가 딱딱하지 않으면 처음 가는 사람도 내가 알고 싶은 내용을 차분히 정리해서 물어볼 수 있습니다"
        ]
      ], tone),
      createSectionBlock("좋았던 점과 확인할 점", [
        [
          "좋았던 점은 방문 전 막연했던 부분을 실제 분위기 중심으로 떠올릴 수 있었다는 점입니다",
          "시세나 비용처럼 매일 달라질 수 있는 정보는 글만 보고 단정하기보다 방문 시점에 다시 확인하는 편이 좋겠습니다",
          `${withConditionalParticle(mainKeyword)} 처음 알아보는 분이라면 상담 분위기와 설명 흐름을 먼저 보고 비교해보면 도움이 될 것 같습니다`,
          "친절한 응대가 기억에 남는다는 건 단순히 기분 좋은 경험을 넘어서, 다시 문의할 수 있겠다는 기준이 되기도 합니다"
        ]
      ], tone),
      createSectionBlock("아쉬운 점", [
        [
          "아쉬운 점이라기보다 미리 알고 가면 좋을 부분은 있습니다",
          "금 시세나 매입 기준은 방문 시점과 물품 상태에 따라 달라질 수 있어서, 글을 보고 바로 판단하기보다 현장에서 다시 확인하는 편이 안전합니다",
          "운영시간이나 주차처럼 실제 방문에 영향을 주는 정보도 가기 전에 한 번 더 보는 편이 마음이 편했습니다"
        ]
      ], tone),
      createSectionBlock("이런 분께 추천해요", [
        [
          "처음 금거래소를 알아보는 분, 상담 분위기가 너무 딱딱할까 봐 걱정되는 분께 참고가 될 것 같습니다",
          "가족과 함께 시세나 매입 여부를 차분히 비교해보고 싶은 분에게도 이런 분위기 정보가 도움이 될 수 있습니다",
          "무엇보다 친절하게 설명을 듣고 싶은 분이라면 방문 후보로 두고 직접 상담해보는 것도 좋겠습니다"
        ]
      ], tone),
      createSectionBlock("마무리", [
        [
          "전체적으로 처음 방문하기 전의 긴장감을 줄이고, 어떤 분위기에서 상담이 이어지는지 가늠하기 좋은 경험이었습니다",
          "금액이 오가는 일일수록 친절한 설명과 차분한 응대가 중요하게 느껴졌고, 그런 부분을 기준으로 다시 비교해보게 됐습니다",
          `${withTopicParticle(mainKeyword)} 시세만 보는 곳이 아니라 상담을 어떻게 받을 수 있는지도 함께 보고 싶은 분께 남겨두고 싶은 후기입니다`
        ]
      ], tone)
    ];
  }

  if (category === "restaurant") {
    const hasFamilyCue = /가족|외식|아이|아이랑/u.test(memoText);
    const hasChildCue = /아이|아이랑|아이\s*음료/u.test(memoText);
    const primaryMenu = getPrimaryRestaurantMenu(form, memoText);
    const hasParkingMemo = /주차/u.test(memoText);
    const hasStaffMemo = /직원|응대|친절/u.test(memoText);
    const hasAmountMemo = /양|많|넉넉|푸짐/u.test(memoText);
    const hasTasteMemo = /맛있|맛\s*좋|국물\s*(?:좋|진|시원|칼칼)|매콤|담백|불맛|식감/u.test(memoText);
    const placeCue = /초지대교/u.test(`${mainKeyword} ${memoText}`) ? "초지대교 근처에서" : "근처에서";

    return [
      createSectionBlock("왜 찾게 됐는지", [
        [
          primaryMenu
            ? hasFamilyCue
              ? `${withObjectParticle(mainKeyword)} 찾아본 건 가족여행 중 ${placeCue} 식사할 곳을 보다가 ${withSubjectParticle(primaryMenu)} 대표 메뉴로 언급되는 걸 봤기 때문입니다`
              : `${withObjectParticle(mainKeyword)} 찾아본 건 ${withSubjectParticle(primaryMenu)} 대표 메뉴로 언급되어 먼저 확인해보고 싶었기 때문입니다`
            : hasFamilyCue
            ? `${withObjectParticle(mainKeyword)} 알아본 건 가족이 함께 식사해도 분위기와 메뉴 구성이 괜찮을지 궁금했기 때문입니다`
            : `${withObjectParticle(mainKeyword)} 알아본 건 대표 메뉴와 이동 기준을 같이 보고 싶었기 때문입니다`,
          primaryMenu && /짬뽕/u.test(primaryMenu)
            ? `${withTopicParticle(primaryMenu)} 사진으로 보기에는 국물과 해산물 구성이 먼저 눈에 들어와 메뉴 구성이 궁금했습니다`
            : /파스타/u.test(`${mainKeyword} ${memoText}`)
            ? "파스타를 먹으러 갈 때는 메뉴 구성과 식사 상황이 내 동행과 맞는지 먼저 보게 됩니다"
            : "식사 장소는 대표 메뉴만 보지 않고 위치, 대기 여부, 운영시간처럼 움직임에 영향을 주는 정보도 함께 확인하면 좋습니다",
          hasParkingMemo
            ? "차를 가지고 움직이는 날이라면 주차 관련 기억도 식사 동선을 잡는 기준이 됩니다"
            : "주차 여부는 방문 시간대마다 달라질 수 있어 출발 전에 한 번 살펴보면 좋겠습니다"
        ]
      ], tone),
      createSectionBlock(primaryMenu ? "대표 메뉴를 보며 확인할 점" : "직접 방문하며 느낀 점", [
        [
          primaryMenu
            ? `${withObjectParticle(primaryMenu)} 중심으로 보면 이 글에서 가장 먼저 봐야 할 메뉴가 분명해집니다`
            : `${withObjectParticle(mainKeyword)} 볼 때는 대표 메뉴와 이동 정보를 나눠 보는 편이 좋습니다`,
          hasAmountMemo
            ? "양과 관련해 직접 남긴 내용이 있다면 가족 외식이나 여러 명이 나눠 먹는 상황에서 중요한 참고점이 됩니다"
            : primaryMenu
              ? "양은 사진만으로 단정하기 어려워서 인원수에 맞춰 메뉴판을 다시 보는 쪽이 좋겠습니다"
              : "함께 방문하는 자리라면 메뉴 구성과 위치, 운영시간을 먼저 확인하는 것이 현실적입니다",
          hasStaffMemo
            ? "직원 응대와 관련해 직접 남긴 내용은 주문 흐름을 설명할 때 자연스럽게 살릴 수 있습니다"
            : "주문 흐름은 방문 시간대와 매장 상황에 따라 달라질 수 있어 가볍게 참고하는 정도가 좋겠습니다",
          hasChildCue
            ? "아이와 함께라면 아이 메뉴나 화장실 동선도 추가로 확인하면 더 편하게 다녀올 수 있습니다"
            : "가격이나 운영시간처럼 바뀔 수 있는 정보는 방문 전에 한 번 더 확인하면 더 편하게 다녀올 수 있습니다"
        ]
      ], tone),
      createSectionBlock("좋았던 점과 아쉬운 점", [
        [
          hasTasteMemo
            ? "실제로 기억나는 맛 표현은 과장하지 않고 떠오르는 범위 안에서만 적는 것이 자연스럽습니다"
            : primaryMenu
              ? `${withTopicParticle(primaryMenu)} 유명하다는 점은 충분히 살리되, 맛 표현은 기억나는 범위 안에서만 보는 것이 좋습니다`
              : "맛 표현은 직접 남긴 내용이 있을 때 더 구체적으로 적고, 부족한 부분은 메뉴 구성 중심으로 보는 편이 좋습니다",
          /분위기/u.test(memoText)
            ? "좋았던 점은 분위기가 편하게 느껴져 식사하는 동안 부담이 크지 않았다는 부분입니다"
            : "좋았던 점은 대표 메뉴가 분명해 식사 후보를 고르기 쉬웠다는 부분입니다",
          "시간대에 따라 대기나 운영 흐름은 달라질 수 있으니, 중요한 일정이라면 예약 여부를 같이 보는 편이 좋겠습니다",
          `${withObjectParticle(mainKeyword)} 고를 때 대표 메뉴와 위치를 함께 보는 분이라면 참고하기 좋은 후기입니다`,
          hasFamilyCue
            ? "가족여행처럼 같이 움직이는 자리라면 메뉴 선택과 이동 부담을 함께 보는 것이 더 현실적입니다"
            : "맛만 길게 쓰기보다 메뉴, 위치, 대기 여부처럼 식사 계획에 필요한 정보를 함께 보는 편이 좋습니다"
        ]
      ], tone),
      createSectionBlock(hasFamilyCue ? "가족 외식 기준으로 본 부분" : "방문 전 살펴볼 부분", [
        [
          hasFamilyCue
            ? "가족 외식에서는 메뉴가 모두에게 맞을지, 식사 시간이 부담스럽지 않을지, 이동 동선이 괜찮을지를 함께 보게 됩니다"
            : "대표 메뉴와 방문 시간대, 대기 여부를 먼저 확인하면 식사 계획을 잡기 더 편합니다",
          hasParkingMemo
            ? "주차 관련 기억이 있다면 이동 방식과 함께 자연스럽게 정리할 수 있습니다"
            : "주차 정보가 없다면 출발 전에 한 번 살펴보는 편이 마음이 편합니다",
          "가격과 운영시간은 바뀔 수 있으니 방문 전 최신 안내를 보는 편이 좋겠습니다"
        ]
      ], tone),
      createSectionBlock("이런 분께 추천해요", [
        [
          hasFamilyCue
            ? "가족여행 중 식사 장소를 찾으면서 대표 메뉴와 위치를 함께 보는 분께 참고가 될 것 같습니다"
            : "대표 메뉴와 위치 정보를 함께 보고 식사 장소를 고르는 분께 참고가 될 것 같습니다",
          "맛집을 고를 때 메뉴 사진만 보는 것보다 위치와 대기 여부까지 함께 보는 분에게 잘 맞습니다",
          "다만 중요한 약속이라면 예약 여부와 대표 메뉴 가격은 방문 전에 다시 확인하는 편이 좋겠습니다"
        ]
      ], tone),
      createSectionBlock("마무리", [
        [
          primaryMenu
            ? `${withTopicParticle(mainKeyword)} ${withObjectParticle(primaryMenu)} 중심으로 먼저 보면 식사 전 궁금한 점이 훨씬 줄어듭니다`
            : `${withTopicParticle(mainKeyword)} 대표 메뉴와 위치 정보를 나눠보면 판단이 더 쉬워집니다`,
          hasFamilyCue
            ? "가족과 함께 움직이는 날에는 식사 시간과 이동 부담이 같이 중요해서 확인할 정보를 미리 나눠두는 편이 좋았습니다"
            : "함께 가는 식사라면 맛뿐 아니라 위치와 운영 흐름도 함께 보는 편이 좋았습니다",
          "가격, 운영시간, 대기처럼 바뀔 수 있는 정보만 한 번 더 챙긴다면 더 편하게 다녀올 수 있을 것 같습니다"
        ]
      ], tone)
    ];
  }

  if (category === "cafe") {
    return [
      createSectionBlock("아이와 함께라면 더 보게 되는 부분", [
        [
          /아이|가족/u.test(memoText)
            ? "아이와 함께 카페에 가면 음료가 있는지뿐 아니라 앉아 있는 동안 아이가 답답해하지 않는지도 함께 보게 됩니다"
            : "카페는 혼자 가는지, 함께 가는지에 따라 좋은 좌석의 기준이 달라집니다",
          "좌석이 넓거나 동선이 복잡하지 않으면 짐을 두고 주문하고 다시 자리로 돌아오는 과정도 훨씬 편하게 느껴집니다",
          "이런 부분은 사진 한 장보다 실제로 머물렀을 때 더 크게 남아서, 카페 후기를 쓸 때 공간 기준으로 정리해두면 읽는 사람도 판단하기 쉽습니다"
        ]
      ], tone),
      createSectionBlock("방문 전 확인하면 좋은 기준", [
        [
          "방문 전에는 운영시간, 주차 가능 여부, 사람이 몰리는 시간대를 한 번 더 확인하는 편이 좋습니다",
          "아이와 함께라면 아이 음료, 화장실 동선, 유아 의자처럼 현장에서 바로 필요한 정보도 같이 보면 더 편합니다",
          "특히 주말 방문이라면 잠깐 쉬어갈 수 있는 자리인지, 주문 후 기다리는 시간이 부담스럽지 않은지도 함께 보면 좋습니다",
          `${withTopicParticle(mainKeyword)} 분위기만 보고 고르기보다 실제로 머물기 편한 기준까지 함께 보면 만족도가 더 분명해질 것 같습니다`
        ]
      ], tone)
    ];
  }

  if (category === "education") {
    return [
      createSectionBlock("수업을 보며 느낀 점", [
        [
          `${withObjectParticle(mainKeyword)} 알아볼 때는 설명이 얼마나 쉬운지, 처음 듣는 사람도 흐름을 따라갈 수 있는지가 가장 중요했습니다`,
          /초보자|이해/u.test(memoText)
            ? "초보자도 이해하기 쉬웠다는 점이 남아 있으면 수업을 시작하기 전 부담이 줄어듭니다"
            : "처음 배우는 내용일수록 용어보다 전체 흐름을 먼저 잡는 과정이 필요했습니다",
          /커리큘럼|입찰|공고|낙찰/u.test(memoText)
            ? "커리큘럼과 단계가 보이면 내가 어디에서 막히는지, 어떤 부분을 더 확인해야 하는지도 조금 더 분명해집니다"
            : "수강 전에는 시간, 준비물, 난이도처럼 실제 참여에 영향을 주는 부분도 함께 보게 됩니다"
        ]
      ], tone),
      createSectionBlock("초보자 입장에서 이해된 부분", [
        [
          /초보자|이해/u.test(memoText)
            ? "초보자도 이해하기 쉬웠다는 기억은 단순히 쉬운 강의라는 뜻보다, 낯선 용어를 전체 흐름 안에서 받아들일 수 있었다는 의미로 볼 수 있습니다"
            : "처음 배우는 내용은 용어 하나하나보다 전체 흐름이 먼저 잡혀야 부담이 줄어듭니다",
          /입찰/u.test(memoText)
            ? "입찰 흐름처럼 단계가 있는 내용은 공고 확인부터 다음 절차까지 순서가 보여야 실제로 이해하기 쉽습니다"
            : "수업을 듣기 전에는 내가 어디까지 알고 있는지, 어떤 부분을 더 확인해야 하는지 나눠보는 것이 좋습니다",
          /커리큘럼/u.test(memoText)
            ? "커리큘럼을 확인했다는 점은 수강 전 기대치를 맞추는 데 도움이 됩니다"
            : "커리큘럼이나 준비물은 발행 전에 한 번 더 확인해두면 글을 읽는 사람도 판단하기 편합니다"
        ]
      ], tone),
      createSectionBlock("수강 전 확인하면 좋은 기준", [
        [
          "강의 시간, 수강료, 준비물처럼 바뀔 수 있는 정보는 단정하지 않고 확인 항목으로 남기는 편이 안전합니다",
          "무료공개강의라면 전체 흐름을 먼저 들어보고 내 목적과 맞는지 판단하는 방식이 부담이 적습니다",
          "후기에서는 결과를 과하게 약속하기보다 수업 흐름, 이해도, 다음에 확인할 점을 나눠 쓰는 편이 더 자연스럽습니다"
        ]
      ], tone),
      createSectionBlock("마무리", [
        [
          "전체적으로 처음 접하는 사람에게 큰 흐름을 잡아주는 수업인지가 가장 기억에 남았습니다",
          "바로 결정하기보다 내 목적과 난이도에 맞는지 차분히 보고 선택하면 더 편하게 시작할 수 있을 것 같습니다"
        ]
      ], tone)
    ];
  }

  if (category === "information") {
    return [
      createSectionBlock("초보자가 먼저 나눠볼 기준", [
        [
          `${withObjectParticle(mainKeyword)} 처음 볼 때는 용어를 한 번에 외우기보다 공고문, 절차, 확인 기준을 나눠보는 편이 훨씬 편합니다`,
          /공고문/u.test(memoText)
            ? "공고문은 조건과 제한 사항이 같이 담기는 경우가 많아서, 제목만 보고 넘기기보다 세부 내용을 천천히 확인해야 합니다"
            : "자료를 볼 때는 출처와 기준일을 먼저 확인하고, 바뀔 수 있는 정보는 따로 표시해두는 편이 안전합니다",
          /리스크|위험|주의/u.test(memoText)
            ? "리스크가 있는 항목은 장점보다 먼저 확인해두면 나중에 판단이 흔들리지 않습니다"
            : "주의할 점은 마지막에 몰아서 보기보다 단계마다 같이 확인하는 편이 좋습니다"
        ]
      ], tone),
      createSectionBlock("확인 기준을 나눠두면 좋은 이유", [
        [
          /입찰/u.test(memoText)
            ? "입찰 흐름은 한 번에 이해하려고 하면 복잡해 보이지만, 공고 확인, 조건 검토, 참여 여부 판단처럼 단계로 나누면 훨씬 현실적으로 보입니다"
            : "처음 시작하는 방법은 큰 개념과 세부 기준을 나눠야 읽는 사람이 바로 따라가기 쉽습니다",
          /초보자|기준/u.test(memoText)
            ? "초보자 기준에서는 내가 모르는 용어를 전부 해결하려고 하기보다, 지금 꼭 확인해야 할 기준부터 잡는 편이 좋습니다"
            : "처음 보는 정보일수록 출처와 기준일, 바뀔 수 있는 조건을 따로 표시해두면 신뢰가 높아집니다",
          /리스크|위험|주의/u.test(memoText)
            ? "리스크는 장점 뒤에 덧붙이는 내용이 아니라 선택 전에 먼저 확인해야 할 기준으로 두는 편이 안전합니다"
            : "주의사항은 마지막 요약에만 넣기보다 각 단계에서 함께 확인하면 놓치는 부분이 줄어듭니다"
        ]
      ], tone),
      createSectionBlock("요약해서 보면", [
        [
          "정보 정리형 글은 경험담처럼 꾸미기보다 검색자가 바로 확인할 수 있는 기준을 차분히 나눠주는 쪽이 더 신뢰가 갑니다",
          `${withTopicParticle(mainKeyword)} 처음이라면 기본 개념, 확인 순서, 주의사항을 먼저 잡고 세부 사례를 추가하는 방식이 가장 안전합니다`,
          "각 단계마다 확인한 날짜나 출처를 따로 적어두면 나중에 다시 볼 때도 기준이 흐려지지 않습니다"
        ]
      ], tone)
    ];
  }

  if (category === "comparison") {
    return [
      createSectionBlock("비교할 때 먼저 볼 기준", [
        [
          `${withObjectParticle(mainKeyword)} 고를 때는 장점만 모아보기보다 내가 실제로 쓸 상황과 맞는지부터 보는 편이 좋습니다`,
          "가격이나 구성처럼 바뀔 수 있는 정보는 마지막에 다시 확인하고, 선택 기준은 사용 목적과 아쉬운 점까지 함께 놓고 비교하면 판단이 쉬워집니다"
        ]
      ], tone),
      createSectionBlock("최종 판단 기준", [
        [
          "누구에게나 맞는 선택지는 없어서, 내 상황에서 덜 불편하고 오래 쓸 수 있는 쪽을 고르는 게 현실적입니다",
          "그래서 비교형 글에서는 추천보다 기준을 분명히 보여주는 것이 더 도움이 됩니다"
        ]
      ], tone)
    ];
  }

  return [
    createSectionBlock("직접 경험하며 느낀 점", [
      [
        `${withObjectParticle(mainKeyword)} 경험하면서 가장 먼저 본 건 처음 접하는 사람도 부담 없이 이해할 수 있는지였습니다`,
        "좋았던 부분은 실제로 기억에 남은 장면이 분명했다는 점이고, 아쉬운 부분은 상황에 따라 달라질 수 있는 정보가 있다는 점입니다",
        "전체적으로 내 상황과 맞는지 차분히 비교해보기 좋은 경험으로 남았습니다"
      ]
    ], tone)
  ];
};

const createNaturalReviewFinishingSections = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = getFormMemoText(form);
  const tone = normalizeTone(form.tone);

  if (category === "store") {
    return [
      createSectionBlock("다시 방문한다면", [
        [
          "다시 방문한다면 먼저 당일 시세와 상담 가능 시간을 확인하고 갈 것 같습니다",
          "처음에는 긴장되기 쉬운 곳이라도 설명이 차분하게 이어지면 비교할 기준이 조금 더 분명해집니다",
          /친절|사장님/u.test(memoText)
            ? "친절한 응대가 기억에 남았기 때문에, 다음에도 궁금한 부분을 정리해서 물어보기 좋겠다는 생각이 들었습니다"
            : "상담을 받을 때는 내가 궁금한 내용을 미리 적어가면 훨씬 편하게 이야기를 나눌 수 있을 것 같습니다"
        ]
      ], tone),
      createSectionBlock("전체적으로 남은 느낌", [
        [
          `${withTopicParticle(mainKeyword)} 단순히 가격만 보는 곳이라기보다 상담을 통해 기준을 잡는 과정이 중요하게 느껴졌습니다`,
          "방문 전에는 막연했던 부분도 실제 응대와 설명 흐름을 떠올리면 훨씬 현실적으로 비교할 수 있습니다",
          "처음 알아보는 분이라면 시세, 매입 기준, 운영시간을 따로 확인하고, 현장에서는 설명이 충분히 이해되는지 차분히 보는 편이 좋겠습니다",
          "무엇보다 급하게 결정하기보다 충분히 설명을 듣고 비교할 수 있는 분위기인지 보는 것이 가장 중요하게 느껴졌습니다",
          "방문 전에는 짧은 후기라도 상담 흐름과 확인할 점이 함께 보이면 첫 상담을 준비하는 데 훨씬 도움이 됩니다"
        ]
      ], tone)
    ];
  }

  if (category === "restaurant") {
    const hasFamilyCue = /가족|외식|아이|아이랑/u.test(memoText);
    const primaryMenu = getPrimaryRestaurantMenu({ productName: mainKeyword }, memoText);
    const hasParkingCue = /주차/u.test(memoText);
    const hasStaffCue = /직원|응대|친절/u.test(memoText);
    const hasAmountCue = /양|많|넉넉|푸짐/u.test(memoText);

    return [
      createSectionBlock("방문 전 더 볼 점", [
        [
          "방문 시간대에 따라 좌석 여유와 대기 여부는 달라질 수 있어 먼저 확인하면 좋겠습니다",
          hasParkingCue
            ? "주차 관련 내용이 있다면 이동 방식과 함께 정리하면 방문 계획을 세우기 더 쉽습니다"
            : "주차나 예약 여부는 시간대에 따라 달라질 수 있어 한 번 더 확인하는 편이 좋겠습니다",
          hasAmountCue
            ? "양과 관련해 직접 남긴 내용이 있다면 인원수에 맞춰 메뉴를 고를 때 참고가 됩니다"
            : "대표 메뉴와 사이드 구성을 미리 보면 주문할 때 훨씬 덜 고민하게 됩니다",
          hasFamilyCue
            ? "가족 외식이라면 모두가 먹기 편한 메뉴와 이동 동선을 같이 보는 편이 좋겠습니다"
            : "함께 식사하는 자리라면 대표 메뉴와 방문 시간을 먼저 맞춰보는 편이 좋겠습니다"
        ]
      ], tone),
      createSectionBlock("정리해서 보면", [
        [
          primaryMenu
            ? `${withTopicParticle(mainKeyword)} ${withObjectParticle(primaryMenu)} 중심으로 보면 식사 전 궁금한 점을 정리하기 쉽습니다`
            : `${withTopicParticle(mainKeyword)} 대표 메뉴와 위치 정보를 나눠보면 방문 전 판단이 쉬워집니다`,
          "사진 속 음식이 좋아 보여도 실제 맛과 맵기, 가격은 방문 시점과 개인차를 함께 생각하는 편이 좋겠습니다",
          hasStaffCue
            ? "직원 응대와 관련해 직접 남긴 내용은 주문 흐름을 설명할 때 자연스럽게 살릴 수 있습니다"
            : "응대와 주문 흐름은 방문 시간대와 매장 상황에 따라 달라질 수 있습니다",
          "주말이나 저녁처럼 사람이 몰릴 수 있는 시간대에는 방문 시간과 예약 여부까지 함께 보면 더 편안하게 다녀올 수 있습니다"
        ]
      ], tone)
    ];
  }

  if (category === "education") {
    return [
      createSectionBlock("수강 전 다시 확인할 점", [
        [
          "수강 전에는 강의 시간, 준비물, 비용처럼 실제 참여에 영향을 주는 정보를 한 번 더 확인하는 편이 좋겠습니다",
          /커리큘럼/u.test(memoText)
            ? "커리큘럼을 먼저 확인해두면 내가 기대하는 내용과 실제 수업 흐름이 맞는지 비교하기가 쉬워집니다"
            : "커리큘럼 정보가 부족하다면 수업에서 다루는 범위부터 다시 확인하는 편이 안전합니다",
          /입찰/u.test(memoText)
            ? "입찰 흐름처럼 단계가 있는 내용은 강의에서 어느 부분까지 다루는지 미리 알아두면 좋습니다"
            : "초보자라면 난이도와 질문 가능 여부도 같이 확인해두면 마음이 편합니다"
        ]
      ], tone),
      createSectionBlock("전체적으로 남은 느낌", [
        [
          `${withTopicParticle(mainKeyword)} 처음 듣는 사람에게 전체 흐름을 잡아주는지가 가장 중요한 기준으로 남았습니다`,
          "강의 후기는 좋다는 말보다 어떤 부분이 이해됐고, 무엇을 더 확인해야 하는지가 보여야 실제로 도움이 됩니다",
          "바로 결정하기보다 내 목적과 난이도에 맞는지 차분히 보고 선택하면 더 편하게 시작할 수 있을 것 같습니다"
        ]
      ], tone)
    ];
  }

  if (category === "information") {
    return [
      createSectionBlock("마지막으로 정리하면", [
        [
          `${withTopicParticle(mainKeyword)} 처음 시작할 때는 전체를 한 번에 이해하려고 하기보다 공고문, 입찰 흐름, 확인 기준을 차례대로 보는 편이 좋습니다`,
          "확인되지 않은 가격이나 일정은 단정하지 않고, 바뀔 수 있는 정보는 최종 작성 전에 다시 확인하는 기준으로 남겨두면 글의 신뢰도가 올라갑니다",
          "초보자 기준에서는 무엇을 모르는지부터 나누는 것이 첫 단계라, 핵심 용어와 주의사항을 함께 정리해두면 다음 행동을 정하기 쉬워집니다"
        ]
      ], tone)
    ];
  }

  if (category === "comparison") {
    return [
      createSectionBlock("마지막으로 비교할 기준", [
        [
          `${withTopicParticle(mainKeyword)} 구매 전 비교할 때는 장점보다 내 상황에 맞는지, 아쉬운 점을 감당할 수 있는지를 먼저 보는 편이 좋습니다`,
          "가격과 구성은 바뀔 수 있으니 마지막에 다시 확인하고, 선택 기준은 사용 목적과 우선순위 중심으로 남겨두면 판단이 훨씬 편해집니다"
        ]
      ], tone)
    ];
  }

  return [
    createSectionBlock("마지막으로 남은 느낌", [
      [
        `${withTopicParticle(mainKeyword)} 직접 경험한 상황을 기준으로 보면 좋았던 점과 다시 확인하고 싶은 점이 모두 있었습니다`,
        "처음 알아볼 때는 막연했지만, 실제 장면을 떠올리며 정리하니 어떤 기준으로 보면 좋을지 조금 더 분명해졌습니다",
        "내 상황과 맞는지 차분히 비교해보고 선택하면 더 만족스럽게 경험할 수 있을 것 같습니다"
      ]
    ], tone)
  ];
};

const createPublishableReviewBody = ({
  baseBody = "",
  form = {},
  category = inferReviewCategory(form),
  infoSummary = [],
  recommendedFor = []
} = {}) => {
  const targetSettings = getTargetLengthSettings(form, category);
  const targetMin = targetSettings.min;
  const memoCount = splitMemoLines(form.experienceMemo).length;
  const imageCount = getImageCount(form);
  const sparseInput = memoCount <= 4 && imageCount === 0;
  const categoryMinLength =
    targetSettings.option === "short"
      ? 1000
      : targetSettings.option === "medium"
        ? 1800
        : targetSettings.option === "long"
          ? 2800
          : category === "product"
            ? 0
      : category === "information"
        ? 900
        : category === "comparison"
          ? 1000
          : sparseInput
            ? 1000
            : memoCount >= 6 || imageCount > 0
              ? 2200
              : 1600;
  const desiredMin = Math.max(targetMin, categoryMinLength);
  let body = normalizeBody(baseBody);

  if (category !== "restaurant" && desiredMin > 0 && getBodyLength(body) < desiredMin) {
    body = normalizeBody([body, ...createNaturalReviewExpansionSections(form, category)].join("\n\n"));
  }

  if (category !== "restaurant" && desiredMin > 0 && getBodyLength(body) < desiredMin) {
    body = normalizeBody([body, ...createNaturalReviewFinishingSections(form, category)].join("\n\n"));
  }

  if (category !== "restaurant" && targetSettings.option === "long" && getBodyLength(body) < desiredMin) {
    body = normalizeBody([
      body,
      ...createDepthSupportSections({
        form,
        category,
        infoSummary,
        recommendedFor
      })
    ].join("\n\n"));
  }

  body = dedupePublishableBody(removeWritingGuideParagraphs(polishPublishableBlogBody(body)));

  if (
    category !== "restaurant" &&
    (targetSettings.option === "medium" || targetSettings.option === "long") &&
    getBodyLength(body) < desiredMin
  ) {
    const expandedBody = normalizeBody([
      body,
      ...createDepthSupportSections({
        form,
        category,
        infoSummary,
        recommendedFor
      })
    ].join("\n\n"));
    body = dedupePublishableBody(removeWritingGuideParagraphs(polishPublishableBlogBody(expandedBody)));
  }

  body = dedupePublishableBody(removeWritingGuideParagraphs(polishPublishableBlogBody(
    ensureGeneralMinimumBodyLength(
      limitRestaurantHeadingCount(
        limitRestaurantSubKeywordRepetition(
          ensureRestaurantMinimumBodyLength(
            ensureRestaurantKeywordDensity(body, form, category, targetSettings),
            form,
            category,
            targetSettings
          ),
          form,
          category
        ),
        category
      ),
      form,
      category,
      targetSettings
    )
  )));

  body = trimBodyToMaxLength(body, targetSettings);

  return dedupePublishableBody(insertPhotoMarkersIntoBody(body, category, getImageCount(form)));
};

const createProductReviewContentPackage = ({
  form = {},
  category = inferReviewCategory(form),
  titles = [],
  selectedTitle = "",
  body = "",
  imageSuggestions = [],
  hashtags = [],
  searchKeywords = [],
  photoGuide = [],
  infoSummary = [],
  recommendedFor = [],
  faqItems = [],
  finalChecklist = [],
  qualityScore = null,
  qualityIssues = [],
  qualityChecks = [],
  blogWriterQuality = null,
  generationId = ""
} = {}) => {
  const mainKeyword = getMainKeyword(form);
  const targetSettings = getTargetLengthSettings(form, category);
  const blogWriterAnalysis = analyzeBlogWritingInput(form);

  return {
    generationId,
    mainKeyword,
    subKeywords: getSubKeywords(form),
    blogWriterAnalysis: {
      ...blogWriterAnalysis,
      mainKeyword,
      subKeywords: getSubKeywords(form)
    },
    targetCharCount: targetSettings.option === "custom" ? targetSettings.target : null,
    targetLengthOption: targetSettings.option,
    targetLengthRange: {
      min: targetSettings.min,
      max: targetSettings.max,
      target: targetSettings.target
    },
    requestedTargetCharCount: targetSettings.requestedTarget || null,
    informationLimited: Boolean(targetSettings.informationLimited),
    engine: "fallback",
    actualBodyLength: body.replace(/\s+/g, "").length,
    summary: {
      engine: "fallback",
      bodyLength: body.replace(/\s+/g, "").length,
      targetCharCount: targetSettings.target,
      requestedTargetCharCount: targetSettings.requestedTarget || null,
      informationLimited: Boolean(targetSettings.informationLimited)
    },
    secondaryKeywords: createSecondaryKeywords(form, category),
    searchIntentAnalysis: createSearchIntentAnalysis(form, category),
    homeFeedClickPoint: createHomeFeedClickPoint(form, selectedTitle, imageSuggestions, category),
    titleCandidates: titles.slice(0, 5),
    finalRecommendedTitle: selectedTitle,
    openingSentenceCandidates: createOpeningSentenceCandidates(form, category, body),
    blogBody: body,
    photoGuide,
    infoSummary,
    recommendedFor,
    faqItems,
    hashtags,
    finalChecklist,
    qualityScore,
    qualityIssues,
    qualityChecks,
    blogWriterQuality,
    searchKeywords,
    sponsorshipCheck: getDetectedSponsorshipType(form) || ""
  };
};

const extractClosingParagraph = (body = "") =>
  normalizeBody(body)
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !/^\[여기에 이미지 \d+을 넣어주세요/u.test(paragraph))
    .at(-1) || "";

const createRestaurantMenuSentences = (memoText = "") => {
  const sentences = [];
  const menus = getRestaurantMenus(memoText);
  const primaryMenu = menus[0] || "";

  if (primaryMenu) {
    sentences.push(
      `${withTopicParticle(primaryMenu)} 방문 전 가장 먼저 눈에 들어온 대표 메뉴였습니다`
    );

    if (/짬뽕/u.test(primaryMenu)) {
      sentences.push(
        `${primaryMenu}은 사진으로 보기에는 국물과 재료 구성이 먼저 보이고, 실제 맛과 맵기는 개인차가 있을 수 있습니다`
      );
    } else {
      sentences.push(
        `${withTopicParticle(primaryMenu)} 사진으로 보이는 구성과 가격 정보를 함께 보면 방문 전 판단하기가 더 쉬워요`
      );
    }
  }

  if (hasMemoCue(memoText, /탕수육|바삭/u)) {
    sentences.push("탕수육은 눅눅한 느낌보다 바삭한 식감이 먼저 느껴져서 여러 명이 나눠 먹기 괜찮았어요");
  }

  if (hasMemoCue(memoText, /어향가지/u)) {
    sentences.push("어향가지는 소스가 진한 편으로 느껴져서 탕수육 같은 메뉴와 곁들였을 때 구성이 더 풍성해졌어요");
  }

  if (sentences.length === 0 && menus.length > 0) {
    sentences.push(`${menus.join(", ")}처럼 기억에 남은 메뉴를 중심으로 보면 주문 구성을 잡기 쉬워요`);
  }

  if (sentences.length === 0) {
    sentences.push("메뉴는 대표 메뉴와 같이 나눠 먹기 좋은 구성이 있는지부터 보게 되더라고요");
  }

  return sentences;
};

const createRestaurantCheckSentences = (memoText = "") => {
  const sentences = [];

  if (hasMemoCue(memoText, /가격/u)) {
    sentences.push("가격: [확인 필요]. 메뉴 가격은 방문 시점에 따라 달라질 수 있어서 가기 전에 한 번 더 보는 게 좋겠어요");
  }

  if (hasMemoCue(memoText, /주차/u)) {
    sentences.push("주차: [확인 필요]. 회식 자리라면 이동 인원이 있어서 주차 가능 여부도 미리 확인해두면 편해요");
  }

  if (hasMemoCue(memoText, /예약/u)) {
    sentences.push("예약: [확인 필요]. 저녁 회식 시간대라면 자리 여유가 있는지도 같이 확인해보면 좋아요");
  }

  if (sentences.length === 0) {
    sentences.push("맛이나 양, 가격 정보는 직접 기억나는 범위 안에서만 더하면 글이 훨씬 현실적으로 읽혀요");
    sentences.push("주차나 웨이팅 여부는 방문 시간대에 따라 달라질 수 있으니 출발 전에 한 번 살펴보면 좋겠습니다");
  }

  return sentences;
};

const createProductUsageSentences = (memoText = "") => {
  const sentences = [];

  if (hasMemoCue(memoText, /발림감|가볍/u)) {
    sentences.push("발림감은 가볍게 느껴져서 바쁜 아침에 바를 때도 부담이 덜했어요");
  }

  if (hasMemoCue(memoText, /향|은은/u)) {
    sentences.push("향은 은은한 편이라 가까이에서 사용할 때도 강하게 남는 느낌은 적었어요");
  }

  if (hasMemoCue(memoText, /아침|저녁/u)) {
    sentences.push("아침저녁으로 쓰기 좋았다는 점은 매일 손이 가는 제품인지 볼 때 중요한 부분이었어요");
  }

  if (hasMemoCue(memoText, /끈적/u)) {
    sentences.push("끈적임은 적은 편으로 느껴져서 바른 뒤 바로 다음 루틴으로 넘어가기 편했어요");
  }

  if (sentences.length === 0) {
    sentences.push("사용감은 바르는 순간의 질감, 향의 강도, 바른 뒤 남는 느낌을 함께 보면 판단하기 쉬워요");
  }

  return sentences;
};

const PRODUCT_INFO_RESULT_LABELS = {
  ingredients: "성분",
  composition: "구성",
  usage: "사용법",
  price: "가격",
  capacity: "용량",
  features: "특징",
  cautions: "주의사항",
  purchaseNotes: "구매 전 확인"
};

const createProductInfoReviewSentences = (form = {}) => {
  const productInfoItems = summarizeProductInfo(form).filter(
    (item) => !["productName", "brandName", "category"].includes(item.field)
  );

  if (productInfoItems.length === 0) {
    return [
      "성분이나 효과처럼 입력되지 않은 정보는 임의로 넣지 않았고, 실제로 적어둔 사용감 위주로만 봤어요",
      "가격, 용량, 성분처럼 구매 전에 필요한 정보는 상세페이지나 패키지에서 다시 확인해보면 좋아요"
    ];
  }

  const summary = productInfoItems
    .slice(0, 4)
    .map((item) => `${PRODUCT_INFO_RESULT_LABELS[item.field] || item.field} ${item.value}`)
    .join(", ");

  return [
    `상세 정보에서는 ${summary} 내용을 확인할 수 있었어요`,
    "다만 사용감이나 만족도는 개인차가 있어서, 확인된 정보와 직접 느낀 부분을 나눠 보는 게 좋겠어요"
  ];
};

const createEducationDetailSentences = (memoText = "") => {
  const terms = ["입찰", "공고", "낙찰", "반출", "판로"].filter((term) => memoText.includes(term));

  if (/세관공매/u.test(memoText) && terms.length > 0) {
    return [
      `메모를 보면 ${terms.join(", ")} 흐름을 차례로 확인할 수 있어서 전체 과정이 조금 더 현실적으로 느껴졌어요`,
      "처음에는 단어들이 낯설었지만, 공고를 보고 입찰한 뒤 낙찰과 반출까지 이어지는 순서를 잡으니 훨씬 이해하기 쉬웠습니다"
    ];
  }

  if (terms.length > 0) {
    return [
      `${terms.join(", ")}처럼 단계가 나뉘는 내용은 순서대로 정리해두면 처음 듣는 사람도 따라가기 쉬워요`,
      "수업 전에 어떤 흐름으로 배우는지 미리 확인할 수 있다는 점이 도움이 됐습니다"
    ];
  }

  return [
    "사진과 메모를 함께 보니 수업에서 어떤 내용을 먼저 다루는지 큰 흐름을 잡기 쉬웠어요",
    "처음 듣는 사람 입장에서는 준비물이나 진행 순서를 미리 알 수 있다는 점이 꽤 도움이 됩니다"
  ];
};

const getMemoEvidenceSnippets = (memoText = "", limit = 3) =>
  uniqueText(
    splitMemoLines(memoText)
      .map((line) => softenSensitiveExpression(line).replace(/[.。]+$/u, "").trim())
      .filter(Boolean)
  ).slice(0, limit);

const createStoreEvidenceSentences = (memoText = "") => {
  const sentences = [];

  if (hasMemoCue(memoText, /사장님.*친절|친절.*사장님/u)) {
    sentences.push("가장 먼저 기억에 남은 건 사장님이 너무 친절하게 설명해준 부분이었어요");
  } else if (hasMemoCue(memoText, /친절/u)) {
    sentences.push("응대가 친절했다는 점이 방문 후에도 가장 먼저 떠올랐어요");
  }

  if (hasMemoCue(memoText, /아드님|2대째|이대째/u)) {
    sentences.push("아드님이 함께하고 2대째 이어오는 곳이라는 이야기도 신뢰감 있게 느껴졌어요");
  }

  if (hasMemoCue(memoText, /금\s*시세|금시세|시세|매입/u)) {
    sentences.push("금 시세 확인부터 매입 과정까지 차분하게 설명해준 점도 처음 방문하는 입장에서 부담을 줄여줬어요");
  }

  if (sentences.length === 0) {
    getMemoEvidenceSnippets(memoText, 2).forEach((snippet) => {
      sentences.push(`메모에 남겨둔 ${snippet} 부분이 실제 방문 분위기를 떠올리게 해줬어요`);
    });
  }

  if (sentences.length === 0) {
    sentences.push("매장 후기는 화려한 설명보다 실제로 어떤 응대를 받았는지와 방문 후 무엇이 남았는지가 더 중요하게 느껴졌어요");
  }

  return uniqueText(sentences).slice(0, 4);
};

const createStoreCheckSentences = (memoText = "") => {
  const sentences = [];

  if (hasMemoCue(memoText, /금\s*시세|금시세|시세/u)) {
    sentences.push("금 시세: [확인 필요]. 시세는 방문 시점에 따라 달라질 수 있어서 가기 전에 한 번 더 확인하는 게 좋겠어요");
  }

  if (hasMemoCue(memoText, /매입|판매|가격|비용/u)) {
    sentences.push("매입 기준과 비용: [확인 필요]. 실제 금액은 당일 기준과 물품 상태에 따라 달라질 수 있어요");
  }

  if (hasMemoCue(memoText, /주차/u)) {
    sentences.push("주차: [확인 필요]. 처음 방문한다면 매장 위치와 주차 가능 여부를 미리 확인해두면 편해요");
  }

  if (hasMemoCue(memoText, /예약/u)) {
    sentences.push("예약: [확인 필요]. 상담이 필요한 방문이라면 예약 여부를 먼저 확인해보면 좋아요");
  }

  if (sentences.length === 0) {
    sentences.push("시세, 비용, 운영시간, 주차처럼 바뀔 수 있는 정보는 방문 전에 한 번 더 확인해두면 좋아요");
  }

  return sentences;
};

const createCategoryMemoSentences = (memoText = "", fallback = "") => {
  const snippets = getMemoEvidenceSnippets(memoText, 2);

  if (snippets.length === 0) return [fallback].filter(Boolean);

  return snippets.map((snippet) => {
    const normalized = snippet
      .replace(/좋음$/u, "좋게 느껴졌습니다")
      .replace(/편함$/u, "편하게 느껴졌습니다")
      .replace(/괜찮음$/u, "괜찮게 느껴졌습니다")
      .replace(/많음$/u, "넉넉하게 느껴졌습니다")
      .replace(/궁금$/u, "궁금했습니다")
      .replace(/확인$/u, "확인할 수 있었습니다")
      .replace(/필요$/u, "필요했습니다")
      .trim();

    if (/[.?!。]$/u.test(normalized)) return normalized;
    if (/(?:습니다|어요|입니다|였습니다|됐습니다)$/u.test(normalized)) return `${normalized}.`;

    return `${normalized} 부분이 기억에 남았습니다`;
  });
};

const BEAUTY_OR_CARE_PRODUCT_PATTERN =
  /크림|로션|세럼|샴푸|드라이샴푸|헤어|두피|피부|화장품|스킨|토너|바디|향수|보송|발림감|제형|끈적|보습|향/u;
const PRODUCT_REVIEW_TERMS_PATTERN =
  /발림감|사용감|아침저녁(?:\s*사용)?|텍스처|제형|제품\s*전체|사용\s*장면|패키지|배송/gu;
const PRODUCT_REVIEW_TERMS_WITH_SCENT_PATTERN =
  /발림감|사용감|아침저녁(?:\s*사용)?|텍스처|제형|제품\s*전체|사용\s*장면|패키지|배송|(?:^|[\s,])향(?:은|이|도|을|를|처럼|의|이나)?/gu;

const detectProductSubtype = (form = {}, memoText = "") => {
  const signal = [getMainKeyword(form), form.productName, form.productInfoText, memoText].map(text).join(" ");
  return BEAUTY_OR_CARE_PRODUCT_PATTERN.test(signal) ? "care" : "general";
};

const getPhotoElementsForAnalysis = (form = {}) =>
  getImageContextItems(form)
    .flatMap((item) => [item.note, item.ocrText])
    .map(sanitizeReviewSourceText)
    .filter(Boolean)
    .filter((item) => !isLikelyOcrNoise(item))
    .slice(0, 6);

const getLecturerName = (memoText = "") => {
  const match = memoText.match(/([가-힣A-Za-z]+)\s*교수/u);
  return match ? `${match[1]} 교수` : "";
};

const getFirstCue = (memoText = "", pattern, fallback = "") => {
  const match = memoText.match(pattern);
  return match?.[0] || fallback;
};

const createReviewAnalysis = (form = {}, category = inferReviewCategory(form), context = {}) => {
  const memoLines = context.memoLines || splitMemoLines(form.experienceMemo).map(softenSensitiveExpression);
  const memoText = context.memoText || getMemoText(memoLines);
  const imageSuggestions = context.imageSuggestions || createImageSuggestions(form);
  const photoElements = getPhotoElementsForAnalysis(form);
  const productSubtype = detectProductSubtype(form, memoText);
  const mainKeyword = getMainKeyword(form);
  const subKeywords = getSubKeywords(form);
  const productInfoItems = summarizeProductInfo(form).filter(
    (item) => !["productName", "brandName", "category"].includes(item.field)
  );

  return {
    topic: mainKeyword,
    subKeywords,
    keywordSourceText: [mainKeyword, ...subKeywords].join(" "),
    baseKeyword: getReviewTitleBase(mainKeyword),
    category,
    writerPersona: getBlogWriterPersona(category),
    purpose: inferReviewPurpose(form, category, memoText),
    importantPoints: inferImportantReviewPoints(category, memoText),
    photoElements,
    photoSentences: createPhotoInsightSentences(category, photoElements),
    requiredMemo: getMemoEvidenceSnippets(memoText, 5),
    forbiddenExpressions: getCategoryForbiddenExpressions(category, productSubtype, `${mainKeyword}\n${memoText}`),
    recommendedReader: inferRecommendedReader(form, category, memoText),
    emotionTone: inferReviewEmotionTone(category, memoText),
    memoText,
    memoLines,
    imageSuggestions,
    imageCount: getImageCount(form),
    productSubtype,
    productInfoSentences: category === "product" && productInfoItems.length > 0
      ? createProductInfoReviewSentences(form)
      : [],
    tone: normalizeTone(form.tone),
    disclosure: getDisclosureSentence(form),
    avoidWords: getAvoidWords(form),
    outline: createNaturalReviewOutlineFromContext({
      form,
      category,
      mainKeyword,
      baseKeyword: getReviewTitleBase(mainKeyword),
      memoText,
      productSubtype
    })
  };
};

const inferReviewPurpose = (form = {}, category = "place", memoText = "") => {
  const topic = getMainKeyword(form);

  if (category === "store") {
    if (/금값|금\s*시세|금시세|매입/u.test(memoText)) return "금값이 오르면서 시세와 매입 상담을 직접 확인해보고 싶었던 상황";
    return "처음 방문해도 상담을 편하게 받을 수 있는 매장인지 확인하고 싶었던 상황";
  }

  if (category === "education") {
    if (/입찰|세관공매|커리큘럼/u.test(`${topic} ${memoText}`)) return "낯선 주제의 흐름을 초보자 입장에서 먼저 확인하고 싶었던 상황";
    return "수업을 듣기 전 난이도와 진행 흐름을 미리 알고 싶었던 상황";
  }

  if (category === "product") {
    if (/운동|떡진|보송|휴대/u.test(memoText)) return "운동 후나 외출 전 급하게 정돈이 필요했던 상황";
    if (/아침|저녁|루틴|끈적|발림감/u.test(memoText)) return "매일 쓰는 루틴에 부담 없이 들어올지 확인하고 싶었던 상황";
    return `${topic}을 실제 생활에서 써봤을 때 어떤지 확인하고 싶었던 상황`;
  }

  if (category === "restaurant") {
    if (/회식|모임|직장인/u.test(memoText)) return "함께 먹기 좋은 메뉴와 분위기를 확인하고 싶었던 자리";
    return "식사 자리로 분위기와 메뉴 구성이 괜찮은지 확인하고 싶었던 방문";
  }

  if (category === "cafe") return "카페에서 머무는 동안 공간, 음료, 좌석이 내 상황에 맞는지 확인하고 싶었던 방문";
  if (category === "hospital") return "처음 방문 전 예약과 상담 흐름이 막막하지 않은지 확인하고 싶었던 상황";
  if (category === "service") return "서비스를 신청하기 전 상담부터 진행까지 믿고 맡길 수 있는지 확인하고 싶었던 상황";
  if (category === "travel") return "직접 가기 전 동선과 분위기가 내 일정에 맞을지 확인하고 싶었던 여행";
  if (category === "experience" || category === "kids-place") return "처음 참여해도 흐름을 따라가기 쉬운지 확인하고 싶었던 체험";
  if (category === "information") return `${topic}를 처음 알아보는 사람이 기본 흐름과 확인 기준을 잡고 싶었던 상황`;
  if (category === "comparison") return `${topic}를 선택하기 전에 장점과 아쉬운 점, 선택 기준을 비교하고 싶었던 상황`;

  return `${topic}을 직접 확인해보고 싶었던 상황`;
};

const inferImportantReviewPoints = (category = "place", memoText = "") => {
  const points = [];

  if (/친절/u.test(memoText)) points.push("친절한 응대");
  if (/아드님|2대째|이대째/u.test(memoText)) points.push("2대째 운영에서 느껴지는 신뢰감");
  if (/금값|금\s*시세|금시세|매입/u.test(memoText)) points.push("시세와 매입 상담 흐름");
  if (/초보자|이해/u.test(memoText)) points.push("초보자도 이해하기 쉬운 설명");
  if (/커리큘럼/u.test(memoText)) points.push("커리큘럼 확인");
  if (/입찰/u.test(memoText)) points.push("입찰 흐름");
  if (/운동/u.test(memoText)) points.push("운동 후 사용 상황");
  if (/떡진|보송/u.test(memoText)) points.push("보송하게 정리되는 느낌");
  if (/휴대/u.test(memoText)) points.push("휴대성");
  if (/향/u.test(memoText)) points.push("향의 부담감");
  if (/분위기/u.test(memoText)) points.push("분위기");
  if (/음료|커피|디저트/u.test(memoText)) points.push("음료와 디저트");
  if (/양/u.test(memoText)) points.push("양");
  if (/주차/u.test(memoText)) points.push("주차 편의성");
  if (/직원/u.test(memoText)) points.push("직원 응대");

  if (points.length > 0) return uniqueText(points).slice(0, 5);

  const fallback = {
    product: ["직접 써본 느낌", "좋았던 점과 아쉬운 점"],
    store: ["상담 분위기", "방문 전 확인할 점"],
    education: ["수업 흐름", "초보자 관점"],
    restaurant: ["메뉴와 분위기", "응대와 편의성"],
    cafe: ["공간 분위기", "음료와 좌석"],
    hospital: ["예약과 상담 흐름", "방문 전 확인할 점"],
    service: ["상담 과정", "진행 흐름"],
    travel: ["동선과 분위기", "다시 간다면 볼 점"],
    experience: ["진행 과정", "추천 대상"],
    "kids-place": ["아이 반응", "보호자 편의성"],
    information: ["핵심 개념", "확인 기준"],
    comparison: ["선택 기준", "장점과 아쉬운 점"]
  };

  return fallback[category] || ["직접 확인한 점", "방문 전 확인할 점"];
};

const inferRecommendedReader = (form = {}, category = "place", memoText = "") => {
  const topic = getMainKeyword(form);

  if (category === "store") return `${withObjectParticle(topic)} 처음 알아보면서 상담 분위기와 신뢰할 만한 응대를 먼저 보고 싶은 분`;
  if (category === "education") return "낯선 내용을 바로 시작하기 전 전체 흐름과 난이도를 먼저 확인하고 싶은 분";
  if (category === "product") return "실제 생활에서 바로 쓰기 편한지와 아쉬운 점까지 같이 보고 싶은 분";
  if (category === "restaurant") return "분위기, 양, 주차, 응대까지 한 번에 보고 식사 장소를 고르고 싶은 분";
  if (category === "cafe") return "카페 분위기와 좌석, 음료 구성을 방문 전 확인하고 싶은 분";
  if (category === "hospital") return "예약과 상담 흐름을 먼저 알고 방문 부담을 줄이고 싶은 분";
  if (category === "service") return "신청 전 상담 방식과 진행 과정을 미리 알고 싶은 분";
  if (category === "travel") return "사진으로 본 분위기와 실제 동선을 함께 확인하고 싶은 분";
  if (category === "experience" || category === "kids-place") return "처음 체험하기 전 진행 흐름과 준비할 점이 궁금한 분";
  if (category === "information") return "처음 알아보는 주제를 기준과 순서대로 정리해보고 싶은 분";
  if (category === "comparison") return "구매나 선택 전 장단점과 기준을 차분히 비교하고 싶은 분";

  return `${withObjectParticle(topic)} 처음 알아보는 분`;
};

const inferReviewEmotionTone = (category = "place", memoText = "") => {
  if (/친절|편함|부담이 적|차분/u.test(memoText)) return "안심";
  if (/궁금|처음|초보/u.test(memoText)) return "궁금함에서 이해로 넘어가는 흐름";
  if (/좋음|좋았|맛있|보송|편함/u.test(memoText)) return "만족";
  if (category === "hospital") return "조심스럽고 차분함";
  return "솔직하고 편안함";
};

const hasRemovalInstructionForExpression = (sourceText = "", label = "") => {
  const source = text(sourceText);
  if (!source || !label || !source.includes(label)) return false;

  const escaped = escapeRegExp(label);
  const removalPattern = new RegExp(
    `${escaped}.{0,48}(?:빼|제외|금지|안\\s*넣|넣지\\s*말|들어가면\\s*안|삭제)|(?:빼|제외|금지|안\\s*넣|넣지\\s*말|들어가면\\s*안|삭제).{0,48}${escaped}`,
    "u"
  );

  return removalPattern.test(source);
};

const shouldKeepSourceExpression = (sourceText = "", labels = []) =>
  labels.some((label) => {
    const source = text(sourceText);
    return source.includes(label) && !hasRemovalInstructionForExpression(source, label);
  });

const productForbiddenPattern = (pattern, labels = []) => ({ pattern, labels });

const getCategoryForbiddenExpressions = (category = "place", productSubtype = "general", sourceText = "") => {
  if (category === "product") {
    const productForbidden = [
      productForbiddenPattern(/처음\s*신청하는\s*서비스/gu, ["처음 신청하는 서비스"]),
      productForbiddenPattern(/신청하는\s*서비스/gu, ["신청하는 서비스"]),
      productForbiddenPattern(/혼자\s*해결하기보다\s*상담/gu, ["혼자 해결하기보다 상담"]),
      productForbiddenPattern(/상담\s*과정/gu, ["상담 과정"]),
      productForbiddenPattern(/상담\s*방식/gu, ["상담 방식"]),
      productForbiddenPattern(/상담\s*분위기/gu, ["상담 분위기"]),
      productForbiddenPattern(/결과\s*확인\s*장면/gu, ["결과 확인 장면"]),
      productForbiddenPattern(/진행\s*과정/gu, ["진행 과정"]),
      productForbiddenPattern(/비용\s*,?\s*일정\s*,?\s*추가\s*조건/gu, ["비용 일정 추가 조건", "비용", "일정", "추가 조건"]),
      productForbiddenPattern(/서비스\s*이용/gu, ["서비스 이용"]),
      productForbiddenPattern(/이용\s*전/gu, ["이용 전"]),
      productForbiddenPattern(/견적/gu, ["견적"]),
      productForbiddenPattern(/예약\s*과정/gu, ["예약 과정"]),
      productForbiddenPattern(/추가\s*조건/gu, ["추가 조건"]),
      productForbiddenPattern(/상담/gu, ["상담"]),
      productForbiddenPattern(/서비스/gu, ["서비스"]),
      productForbiddenPattern(/신청\s*전/gu, ["신청 전"]),
      productForbiddenPattern(/신청/gu, ["신청"]),
      productForbiddenPattern(/비용/gu, ["비용"]),
      productForbiddenPattern(/일정/gu, ["일정"])
    ];

    const sourceAwareProductForbidden = productForbidden
      .filter((item) => !shouldKeepSourceExpression(sourceText, item.labels))
      .map((item) => item.pattern);

    return productSubtype === "care"
      ? [/매장\s*방문/gu, /상담\s*분위기/gu]
          .concat(sourceAwareProductForbidden)
      : [PRODUCT_REVIEW_TERMS_WITH_SCENT_PATTERN, /매장\s*방문/gu, /상담\s*분위기/gu].concat(sourceAwareProductForbidden);
  }

  if (category === "store") {
    return [
      /발림감/gu,
      /제형/gu,
      /보송함/gu,
      /아침저녁\s*사용/gu,
      /피부\s*흡수/gu,
      /착용감/gu,
      PRODUCT_REVIEW_TERMS_WITH_SCENT_PATTERN
    ];
  }

  if (category === "education") return [PRODUCT_REVIEW_TERMS_WITH_SCENT_PATTERN, /제품\s*후기/gu, /의학적\s*효과/gu, /배송/gu, /패키지/gu, /웨이팅/gu, /객실/gu, /체크인/gu];
  if (category === "restaurant" || category === "cafe") {
    const restaurantForbidden = [
      productForbiddenPattern(/서비스\s*신청/gu, ["서비스 신청"]),
      productForbiddenPattern(/신청\s*과정/gu, ["신청 과정"]),
      productForbiddenPattern(/진행\s*과정/gu, ["진행 과정"]),
      productForbiddenPattern(/체험\s*흐름/gu, ["체험 흐름"]),
      productForbiddenPattern(/비용\s*일정/gu, ["비용 일정"]),
      productForbiddenPattern(/결과\s*확인/gu, ["결과 확인"]),
      productForbiddenPattern(/제품\s*패키지/gu, ["제품 패키지"]),
      productForbiddenPattern(/수강\s*흐름/gu, ["수강 흐름"]),
      productForbiddenPattern(/커리큘럼/gu, ["커리큘럼"]),
      productForbiddenPattern(/발림감/gu, ["발림감"]),
      productForbiddenPattern(/사용감/gu, ["사용감"]),
      productForbiddenPattern(/제형/gu, ["제형"]),
      productForbiddenPattern(/견적/gu, ["견적"]),
      productForbiddenPattern(/상담/gu, ["상담"])
    ];

    return restaurantForbidden
      .filter((item) => !shouldKeepSourceExpression(sourceText, item.labels))
      .map((item) => item.pattern)
      .concat([/시술\s*효과/gu]);
  }
  if (category === "hospital") return [PRODUCT_REVIEW_TERMS_WITH_SCENT_PATTERN, /치료\s*효과\s*보장/gu, /완치/gu, /즉시\s*효과/gu, /의학적\s*단정/gu, /무조건\s*추천/gu];
  if (category === "travel") return [PRODUCT_REVIEW_TERMS_WITH_SCENT_PATTERN, /제품\s*사용감/gu, /커리큘럼/gu, /상담\s*과정/gu];
  if (category === "information") {
    return [
      /직접\s*(?:방문|다녀|가보|사용|써보|이용|참여)[^.\n]*(?:[.。]|$)/gu,
      /방문하게\s*된\s*이유/gu,
      /직접\s*써본\s*느낌/gu,
      /직접\s*다녀온\s*후기/gu,
      /가격은\s*\d[\d,]*/gu,
      /주소는\s*[^.\n]+/gu,
      /영업시간은\s*[^.\n]+/gu
    ];
  }

  return [PRODUCT_REVIEW_TERMS_WITH_SCENT_PATTERN];
};

const createPhotoInsightSentences = (category = "place", photoElements = []) => {
  const joined = photoElements.join(" ");
  const sentences = [];

  if (!joined) return sentences;

  if (/외관|입구|위치/u.test(joined)) {
    sentences.push(
      category === "store"
        ? "외관 사진을 보니 처음 방문하는 사람도 위치를 찾기 어렵지 않아 보였어요"
        : "입구와 외관을 먼저 보니 처음 가는 사람도 분위기를 미리 잡기 좋았어요"
    );
  }

  if (/내부|안쪽|상담\s*공간|대기|공간/u.test(joined)) {
    sentences.push(
      category === "store"
        ? "매장 안쪽은 생각보다 깔끔하게 정리되어 있었고, 상담받는 동안 부담스럽지 않은 분위기로 이어질 것 같았어요"
        : "내부 공간이 함께 보이니 실제로 머무는 동안의 분위기를 더 자연스럽게 떠올릴 수 있었어요"
    );
  }

  if (/진열|제품|정돈/u.test(joined) && category === "store") {
    sentences.push("진열된 제품들이 깔끔하게 정돈되어 있어 매장 관리가 잘 되고 있다는 인상을 받았습니다");
  }

  if (category === "product" && /용량|성분|사용법|가격|ml|mL|g|G/u.test(joined)) {
    const detail = photoElements.find((item) => /용량|성분|사용법|가격|ml|mL|g|G/u.test(item)) || joined;
    sentences.push(`상세 정보 이미지에서 ${detail} 내용을 확인할 수 있어 구매 전에 보기 좋았어요`);
  }

  if (/강의|커리큘럼|수업|안내/u.test(joined)) {
    sentences.push("강의 안내 이미지를 보니 어떤 순서로 배우는지 흐름을 한눈에 볼 수 있었습니다");
  }

  if (/메뉴|파스타|음식|양|주문/u.test(joined)) {
    sentences.push("메뉴 사진이 있으면 양과 구성을 함께 볼 수 있어서 실제로 주문할 때의 느낌이 더 잘 살아납니다");
  }

  if (/시세|가격|안내문|공고|입찰/u.test(joined)) {
    sentences.push(
      category === "education"
        ? "안내 이미지에 핵심 용어가 함께 보이면 강의에서 어떤 내용을 다루는지 미리 감을 잡기 좋습니다"
        : "안내문이 함께 보이면 시세나 비용처럼 바뀔 수 있는 정보를 따로 확인하기 좋겠다는 생각이 들었어요"
    );
  }

  if (sentences.length === 0) {
    sentences.push(
      category === "product"
        ? "사진을 함께 보니 실제로 꺼내 쓰는 장면이 더 자연스럽게 떠올랐어요"
        : "사진을 함께 보니 글만 읽을 때보다 현장 분위기를 더 편하게 상상할 수 있었어요"
    );
  }

  return uniqueText(sentences).slice(0, 3);
};

const createNaturalReviewOutlineFromContext = ({ form = {}, category = "place", mainKeyword = "", baseKeyword = "", memoText = "", productSubtype = "general" } = {}) => {
  const topic = mainKeyword || getMainKeyword(form);
  const base = baseKeyword || getReviewTitleBase(topic);

  if (category === "store") {
    if (/금거래소|금값|금\s*시세|금시세|매입/u.test(`${topic} ${memoText}`)) {
      return [
        "금값이 오르다 보니 자연스럽게 알아보게 된 곳",
        "처음 방문해도 부담이 덜했던 상담 분위기",
        "2대째 운영이라는 점에서 느껴진 신뢰감",
        "매입 상담 전에 확인하면 좋은 부분",
        "이런 분께 잘 맞을 것 같아요"
      ];
    }

    return [
      `${withObjectParticle(base)} 직접 확인해보고 싶었던 이유`,
      "처음 방문해도 편하게 물어볼 수 있었던 분위기",
      "응대에서 신뢰가 갔던 부분",
      "방문 전에 확인하면 좋은 것들",
      "이런 분께 잘 맞을 것 같아요"
    ];
  }

  if (category === "education") {
    if (/세관공매|입찰/u.test(`${topic} ${memoText}`)) {
      return [
        "세관공매가 어렵게 느껴져서 먼저 알아본 강의",
        "초보자도 흐름을 잡기 쉬웠던 구성",
        "입찰 흐름을 미리 볼 수 있다는 점",
        "수강 전에 확인하면 좋은 부분",
        "이런 분들께 맞을 것 같아요"
      ];
    }

    return [
      `${withObjectParticle(base)} 알아보게 된 이유`,
      "듣기 전에 가장 궁금했던 부분",
      "수업 흐름을 따라가며 느낀 점",
      "수강 전에 확인하면 좋은 부분",
      "이런 분들께 맞을 것 같아요"
    ];
  }

  if (category === "product") {
    if (/드라이샴푸|운동|떡진|보송/u.test(`${topic} ${memoText}`)) {
      return [
        "사용하게 된 상황",
        "사용 전 궁금했던 점",
        "직접 써본 느낌",
        "좋았던 점",
        "아쉬웠던 점",
        "어떤 사람에게 맞는지",
        "마무리"
      ];
    }

    return [
      "사용하게 된 상황",
      "사용 전 궁금했던 점",
      "직접 써본 느낌",
      "좋았던 점",
      "아쉬웠던 점",
      "어떤 사람에게 맞는지",
      "마무리"
    ];
  }

  if (category === "restaurant") {
    const primaryMenu = getPrimaryRestaurantMenu(form, memoText);
    if (primaryMenu) {
      return [
        `${withSubjectParticle(primaryMenu)} 궁금해서 보게 된 곳`,
        `${primaryMenu} 메뉴를 중심으로 본 부분`,
        "매장 분위기와 주차 등 방문 전 참고할 점",
        "맛과 가격을 볼 때",
        "이런 식사 상황에 추천하고 싶어요"
      ];
    }

    return [
      /파스타/u.test(`${topic} ${memoText}`)
        ? "파스타 먹을 곳을 찾다가 눈에 들어온 곳"
        : "식사 자리로 괜찮을지 궁금했던 곳",
      "분위기와 메뉴 구성이 먼저 보였어요",
      "양과 응대에서 기억에 남은 부분",
      "주차까지 생각하면 편했던 점",
      "이런 상황에 추천하고 싶어요"
    ];
  }

  if (category === "cafe") {
    return [
      `${withObjectParticle(base)} 방문 전 궁금했던 이유`,
      "공간 분위기와 좌석이 먼저 보였어요",
      "음료와 디저트에서 기억에 남은 점",
      "주차와 아이 동반 여부처럼 확인할 부분",
      "다시 간다면 참고하고 싶은 기준"
    ];
  }

  if (category === "hospital") {
    return [
      "처음 방문 전 가장 신경 쓰였던 부분",
      "예약과 접수 흐름은 어땠는지",
      "상담 설명이 편하게 느껴졌던 부분",
      "방문 전에 확인하면 좋은 것들"
    ];
  }

  if (category === "service") {
    return [
      "필요해서 알아보게 된 순간",
      "상담 과정에서 편했던 부분",
      "진행하면서 느낀 장점과 아쉬움",
      "이런 분께 추천하고 싶은 서비스"
    ];
  }

  if (category === "travel") {
    return [
      "가보게 된 이유와 첫인상",
      "이동하면서 느낀 위치와 동선",
      "풍경과 분위기가 좋았던 포인트",
      "다시 간다면 참고하고 싶은 점"
    ];
  }

  if (category === "kids-place") {
    return [
      "아이와 가기 전 가장 궁금했던 부분",
      "아이 반응과 체험 흐름",
      "부모 대기 공간에서 느낀 편안함",
      "주차까지 생각하면 다시 볼 기준",
      "이런 가족에게 추천하고 싶어요"
    ];
  }

  if (category === "information") {
    return [
      "처음 알아볼 때 가장 궁금한 질문",
      "기본 개념과 전체 흐름",
      "확인해야 할 기준",
      "주의할 점",
      "선택 기준과 요약 정리"
    ];
  }

  if (category === "comparison") {
    return [
      "비교가 필요한 이유",
      "선택 기준",
      "장점과 아쉬운 점",
      "어떤 사람에게 맞는지",
      "구매 전 확인할 점과 최종 판단 기준"
    ];
  }

  if (category === "experience") {
    return [
      "참여해보고 싶었던 이유",
      "시작 전 기대했던 부분",
      "직접 해보며 느낀 흐름",
      "이런 분께 추천하고 싶어요"
    ];
  }

  return [
    `${withObjectParticle(base)} 직접 확인해본 이유`,
    "사진과 메모로 떠올린 현장 분위기",
    "좋았던 점과 아쉬운 점",
    "다시 본다면 확인할 부분"
  ];
};

const createNaturalReviewOutline = (form = {}, category = inferReviewCategory(form)) => {
  const memoLines = splitMemoLines(form.experienceMemo).map(softenSensitiveExpression);
  const memoText = getMemoText(memoLines);
  const mainKeyword = getMainKeyword(form);

  return createNaturalReviewOutlineFromContext({
    form,
    category,
    mainKeyword,
    baseKeyword: getReviewTitleBase(mainKeyword),
    memoText,
    productSubtype: detectProductSubtype(form, memoText)
  });
};

const createHumanParagraph = (sentences = [], tone = "친근한") =>
  sentences.filter(Boolean).map((sentence) => createSentence(sentence, tone)).join(" ");

const createSectionBlock = (heading, paragraphs = [], tone = "친근한") =>
  [heading, ...paragraphs.filter(Boolean).map((paragraph) => createHumanParagraph(Array.isArray(paragraph) ? paragraph : [paragraph], tone))]
    .filter(Boolean)
    .join("\n\n");

const createHumanIntroParagraph = (analysis) => {
  const { category, memoText, topic, tone } = analysis;

  if (category === "store") {
    return createHumanParagraph([
      /금값|금\s*시세|금시세|매입/u.test(memoText)
        ? `금값이 오르다 보니 ${withObjectParticle(topic)} 그냥 넘기기 어렵더라고요`
        : `${withObjectParticle(topic)} 알아보게 된 건 처음 방문해도 편하게 상담받을 수 있는 곳인지 궁금해서였어요`,
      "처음에는 시세나 상담 과정이 딱딱하게 느껴질까 걱정했는데, 실제로 확인한 분위기는 생각보다 편안한 쪽에 가까웠습니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "education") {
    return createHumanParagraph([
      /세관공매/u.test(topic)
        ? `${withObjectParticle(topic)} 알아본 건 세관공매라는 말부터 조금 어렵게 느껴졌기 때문이에요`
        : `${withObjectParticle(topic)} 알아본 건 수업을 듣기 전에 난이도와 흐름을 먼저 알고 싶어서였어요`,
      /초보자|이해/u.test(memoText)
        ? "초보자도 이해하기 쉬운지 먼저 보고 싶었고, 커리큘럼이 어떻게 이어지는지도 궁금했습니다"
        : "강의 소개만 보고 바로 판단하기보다 실제로 어떤 순서로 진행되는지가 더 궁금했습니다",
      analysis.photoSentences.find((sentence) => /강의|안내|커리큘럼/u.test(sentence)) || ""
    ], tone);
  }

  if (category === "product") {
    const productText = topic || analysis.baseKeyword;

    return createHumanParagraph([
      /운동|떡진|보송/u.test(memoText)
        ? `운동하고 나면 머리가 금방 눌리거나 떡져 보여서 ${withObjectParticle(productText)} 자연스럽게 찾아보게 됐어요`
        : `${withObjectParticle(productText)} 써보게 된 건 일상에서 정말 편하게 쓸 수 있는지 궁금했기 때문이에요`,
      /운동|떡진|보송/u.test(memoText)
        ? `${withTopicParticle(topic)} 바로 감거나 손질하기 애매한 순간에 얼마나 보송하게 정리되는지가 제일 궁금하더라고요`
        : `${withTopicParticle(topic)} 쓰기 전에는 장점만큼이나 불편한 점은 없는지 같이 확인해보고 싶더라고요`,
      /운동|떡진|보송/u.test(memoText)
        ? "바쁜 날에는 머리 상태 하나만 어색해도 계속 신경이 쓰여서, 이런 제품은 실제 생활에서 얼마나 빠르게 쓸 수 있는지가 중요했습니다"
        : "좋다는 말보다 언제 손이 가고 언제 애매한지가 보여야 실제로 고를 때 도움이 됐습니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "restaurant") {
    const keywordSourceText = analysis.keywordSourceText || topic;
    const primaryMenu = getPrimaryRestaurantMenu({ productName: keywordSourceText }, memoText);
    const hasFamilyTravelCue = /가족|여행|외식/u.test(memoText);
    const placeCue = /초지대교/u.test(`${keywordSourceText} ${memoText}`) ? "초지대교 근처에서" : "근처에서";

    if (primaryMenu) {
      return createHumanParagraph([
        hasFamilyTravelCue
          ? `${withObjectParticle(topic)} 찾아본 건 가족여행 중 ${placeCue} 식사할 곳을 알아보다가 ${withSubjectParticle(primaryMenu)} 유명하다는 이야기를 봤기 때문이에요`
          : `${withObjectParticle(topic)} 알아보게 된 건 ${withSubjectParticle(primaryMenu)} 유명하다는 이야기가 먼저 눈에 들어왔기 때문이에요`,
        /짬뽕/u.test(primaryMenu)
          ? `${primaryMenu}처럼 국물 메뉴는 사진으로 보이는 재료 구성을 먼저 보게 되고, 맵기는 사람마다 다를 수 있겠더라고요`
          : `${withTopicParticle(primaryMenu)} 취향을 탈 수 있는 메뉴라 사진으로 보이는 구성을 먼저 살펴보게 됐습니다`,
        `${withTopicParticle(topic)} ${withObjectParticle(primaryMenu)} 중심으로 보면 메뉴와 위치 흐름이 자연스럽게 잡힙니다`,
        analysis.photoSentences[0] || ""
      ], tone);
    }

    return createHumanParagraph([
      `${withObjectParticle(topic)} 알아본 건 대표 메뉴와 식사 동선을 함께 보고 싶었기 때문이에요`,
      /주차/u.test(memoText)
        ? `${withTopicParticle(topic)} 음식 맛도 중요하지만 차를 가지고 움직이는 날에는 주차가 편한지도 꽤 크게 느껴지더라고요`
        : `${withTopicParticle(topic)} 메뉴만 보고 고르기보다 같이 간 사람이 편하게 식사할 수 있을지도 함께 보게 됐습니다`,
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "cafe") {
    return createHumanParagraph([
      `${withObjectParticle(topic)} 정리해두고 싶었던 건 음료나 디저트만큼 공간 분위기와 좌석 편의성도 중요하게 느껴졌기 때문이에요`,
      /아이|가족/u.test(memoText)
        ? "아이와 함께 움직이는 날에는 메뉴보다 머무는 동안 불편하지 않은지가 더 크게 느껴질 때가 있습니다"
        : "카페는 잠깐 들르는 곳이라도 좌석, 소음, 주차처럼 머무는 기준이 맞아야 만족도가 더 오래 남습니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "hospital") {
    return createHumanParagraph([
      `${withObjectParticle(topic)} 알아볼 때는 진료 내용만큼이나 예약, 대기, 접수 흐름이 궁금했어요`,
      "처음 방문하는 곳은 작은 안내 하나도 부담을 줄여주기 때문에 실제 분위기를 먼저 보게 됩니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "information") {
    return createHumanParagraph([
      `${withObjectParticle(topic)} 처음 알아볼 때는 어디서부터 확인해야 할지 헷갈릴 수 있어요`,
      "그래서 경험담처럼 꾸미기보다 기본 개념, 진행 흐름, 확인 기준을 차례대로 나눠보는 방식이 더 안전하고 읽기 쉽습니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "comparison") {
    return createHumanParagraph([
      `${withObjectParticle(topic)} 고를 때는 장점만 보는 것보다 내 상황에 맞는 기준을 먼저 정해두는 편이 좋아요`,
      "구매 전에는 가격이나 구성처럼 바뀔 수 있는 정보보다 선택 기준, 아쉬운 점, 확인할 조건을 나눠보는 것이 판단에 더 도움이 됩니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "service") {
    return createHumanParagraph([
      `${withObjectParticle(topic)} 알아본 건 혼자 해결하기보다 상담을 받아보는 편이 낫겠다는 생각이 들어서였어요`,
      "처음 신청하는 서비스는 결과보다 과정이 더 궁금해서 상담이 어떻게 이어지는지 먼저 보게 됩니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  if (category === "travel") {
    return createHumanParagraph([
      `${withTopicParticle(topic)} 사진으로 봤을 때 분위기가 좋아 보여서 실제 동선까지 궁금해졌어요`,
      "막상 가보면 이동 시간이나 머무는 방식에 따라 만족도가 달라져서 그 부분을 중심으로 보게 됐습니다",
      analysis.photoSentences[0] || ""
    ], tone);
  }

  return createHumanParagraph([
    `${withObjectParticle(topic)} 직접 해보거나 방문해보고 싶었던 건 처음이어도 어렵지 않을지 궁금했기 때문이에요`,
    "사진과 짧은 기억만 다시 봐도 그때 어떤 부분이 남았는지 자연스럽게 떠올랐습니다",
    analysis.photoSentences[0] || ""
  ], tone);
};

const createStoreHumanEvidenceSentences = (analysis) => {
  const { memoText } = analysis;
  const sentences = [];

  if (/사장님.*친절|친절.*사장님|사장님/u.test(memoText)) {
    sentences.push("상담을 받을 때 가장 먼저 느낀 건 응대가 굉장히 편안하다는 점이었어요");
    sentences.push("사장님이 설명을 차분하게 해주셔서 처음 방문한 사람도 부담이 덜했습니다");
  }

  if (/아드님|2대째|이대째/u.test(memoText)) {
    sentences.push("아드님과 함께 2대째 운영하고 있다는 이야기를 들으니 매장에 대한 신뢰도 자연스럽게 생겼습니다");
  }

  if (/금값|금\s*시세|금시세|매입/u.test(memoText)) {
    sentences.push("금값이 올라 방문하게 된 상황이라 매입 상담과 매입 과정을 어떻게 설명해주는지가 중요했는데, 시세와 절차를 차분히 확인할 수 있다는 점이 좋았습니다");
  }

  return sentences.length > 0 ? sentences : createStoreEvidenceSentences(memoText);
};

const createProductHumanExperienceSentences = (analysis) => {
  const { memoText, productSubtype } = analysis;
  const sentences = [];

  if (/운동/u.test(memoText)) {
    sentences.push("운동 후 바로 약속이 있거나 이동해야 할 때 머리 상태가 신경 쓰이는데, 그런 순간에 꺼내 쓰기 좋은 쪽으로 느껴졌어요");
  }

  if (/떡진|보송/u.test(memoText)) {
    sentences.push("앞머리와 정수리 쪽이 떡져 보일 때 보송하게 정리되는 느낌이 있어 급하게 머리를 정돈해야 할 때 도움이 됐습니다");
  }

  if (/휴대|가방|넣고\s*다니|들고\s*다니/u.test(memoText)) {
    sentences.push("휴대가 편하다는 점도 꽤 현실적인 장점이었어요. 가방에 넣어두고 필요할 때 꺼내 쓰기 좋겠다는 생각이 들었습니다");
  }

  if (/급할\s*때|급하게|바로\s*약속|외출\s*전/u.test(memoText)) {
    sentences.push("급하게 정리해야 하는 날에는 완벽한 스타일링보다 신경 쓰이는 부분을 빨리 가라앉히는지가 더 현실적인 기준이었습니다");
  }

  if (/향/u.test(memoText) && productSubtype === "care") {
    sentences.push(
      /운동|드라이샴푸|떡진|보송/u.test(memoText)
        ? "향은 강하게 튀기보다 무난하게 느껴져서 운동 후에 써도 부담이 크지 않았어요"
        : "향은 은은하게 느껴져서 가까이에서 써도 부담이 크지 않았어요"
    );
  }

  if (/발림감|가볍/u.test(memoText) && productSubtype === "care") {
    sentences.push("발림감은 무겁게 남기보다 가볍게 정리되는 편이라 매일 쓰는 루틴에 넣기에도 부담이 덜했어요");
  }

  if (/아침|저녁/u.test(memoText) && productSubtype === "care") {
    sentences.push("아침저녁으로 쓰기 좋다는 점은 꾸준히 손이 가는지 볼 때 중요한 기준이었습니다");
  }

  if (/끈적/u.test(memoText) && productSubtype === "care") {
    sentences.push("끈적임이 적게 느껴진 점도 좋았어요. 바른 뒤 다음 단계로 넘어갈 때 답답함이 덜했습니다");
  }

  if (sentences.length === 0) {
    sentences.push("직접 써보니 장점은 분명했지만, 내 생활 패턴에 맞는지 함께 봐야 만족도가 더 현실적으로 판단됩니다");
  }

  return sentences;
};

const createEducationHumanDetailSentences = (analysis) => {
  const { memoText, topic } = analysis;
  const lecturer = getLecturerName(memoText);
  const terms = ["입찰", "공고", "낙찰", "반출", "판로"].filter((term) => memoText.includes(term));
  const sentences = [];

  if (/초보자|이해/u.test(memoText)) {
    sentences.push("초보자 입장에서 좋았던 건 처음부터 어려운 말만 이어지기보다 전체 흐름을 먼저 잡을 수 있다는 점이었어요");
  }

  if (/커리큘럼/u.test(memoText)) {
    sentences.push("커리큘럼을 확인할 수 있어서 어떤 순서로 배우는지 미리 그려볼 수 있었습니다");
  }

  if (/입찰/u.test(memoText)) {
    sentences.push("특히 입찰 흐름이 궁금했던 입장에서는 공고를 보고 어떤 단계로 이어지는지 미리 들어볼 수 있다는 점이 도움이 됐어요");
  }

  if (terms.length >= 2) {
    sentences.push(`${terms.join(", ")}처럼 단계가 나뉘는 내용은 한 번에 외우기보다 순서대로 들어야 훨씬 현실적으로 이해됩니다`);
  }

  if (lecturer) {
    sentences.push(`${lecturer} 강의라는 점도 기억에 남았습니다. 처음 듣는 사람에게 설명이 어떻게 전달되는지가 중요한 주제라 강의자의 안내 방식도 자연스럽게 보게 되더라고요`);
  }

  if (/세관공매/u.test(topic) && sentences.length === 0) {
    return createEducationDetailSentences(memoText);
  }

  return sentences.length > 0 ? sentences : ["수업 흐름을 먼저 확인할 수 있어서 듣기 전 막연함을 줄이는 데 도움이 됐습니다"];
};

const createHumanReviewSections = (analysis) => {
  const { category, memoText, topic, tone, outline, photoSentences, recommendedReader, importantPoints, productInfoSentences = [] } = analysis;
  const photoDetail = photoSentences.slice(1);

  if (category === "store") {
    return [
      createSectionBlock(outline[0], [
        [
          /금값|금\s*시세|금시세/u.test(memoText)
            ? "금값이 올랐다는 이야기를 자주 듣다 보니 가지고 있던 금이나 매입 상담이 자연스럽게 궁금해졌어요"
            : "처음 가는 매장은 괜히 긴장되기 마련이라 상담 분위기가 편한지가 먼저 궁금했습니다",
          "특히 금액이 오가는 상담은 설명을 얼마나 차분하게 해주는지가 생각보다 큰 기준이 됩니다"
        ]
      ], tone),
      createSectionBlock(outline[1], [
        [
          ...createStoreHumanEvidenceSentences(analysis).slice(0, 2)
        ],
        photoDetail[0] ? [photoDetail[0]] : []
      ], tone),
      createSectionBlock(outline[2], [
        [
          ...createStoreHumanEvidenceSentences(analysis).slice(2),
          "이런 부분은 단순히 친절했다는 말보다 실제로 상담을 받는 동안 마음이 편했는지를 보여주는 포인트라고 느꼈어요"
        ]
      ], tone),
      createSectionBlock(outline[3], [
        createStoreCheckSentences(memoText)
      ], tone),
      createSectionBlock(outline[4], [
        [
          `${withConditionalParticle(recommendedReader)} 방문 전에 분위기를 파악하는 데 도움이 될 것 같아요`,
          "다만 시세와 매입 기준은 방문 시점에 따라 달라질 수 있으니 최종 금액은 현장에서 다시 확인하는 편이 좋겠습니다"
        ]
      ], tone)
    ];
  }

  if (category === "education") {
    return [
      createSectionBlock(outline[0], [
        [
          /세관공매/u.test(topic)
            ? "세관공매는 단어만 보면 어렵고 멀게 느껴지지만, 막상 필요한 흐름을 나눠보면 확인해야 할 단계가 보이기 시작해요"
            : "강의를 알아볼 때는 수업 소개보다 실제로 따라갈 수 있는지가 먼저 궁금했습니다",
          "그래서 화려한 후기보다 초보자가 이해할 수 있는지, 커리큘럼이 어떤 순서로 이어지는지를 중심으로 보게 됐습니다"
        ]
      ], tone),
      createSectionBlock(outline[1], [
        createEducationHumanDetailSentences(analysis).slice(0, 2),
        photoDetail[0] ? [photoDetail[0]] : []
      ], tone),
      createSectionBlock(outline[2], [
        createEducationHumanDetailSentences(analysis).slice(2),
        [
          /입찰/u.test(memoText)
            ? "입찰 흐름은 처음부터 결과만 보는 것보다 공고 확인, 입찰 준비, 이후 절차를 순서대로 들어야 훨씬 덜 막막합니다"
            : "수업 흐름을 먼저 잡아두면 내가 더 알아봐야 할 부분도 자연스럽게 보입니다"
        ]
      ], tone),
      createSectionBlock(outline[3], [
        [
          "수강 전에는 강의 시간, 준비물, 비용, 환불 기준을 한 번 더 확인해두는 편이 좋아요",
          "무료공개강의라면 전체 흐름을 먼저 듣고 내 상황에 맞는지 판단해보는 방식도 부담이 적습니다"
        ]
      ], tone),
      createSectionBlock(outline[4], [
        [
          `${recommendedReader}에게 잘 맞을 것 같아요`,
          "처음부터 모든 걸 이해하려고 하기보다 큰 흐름을 잡고 다음 단계를 판단하고 싶은 분께 특히 도움이 될 수 있습니다"
        ]
      ], tone)
    ];
  }

  if (category === "product") {
    const experienceSentences = createProductHumanExperienceSentences(analysis);
    const isDryShampoo = /드라이샴푸|운동|떡진|보송/u.test(`${topic} ${memoText}`);
    const productName = topic || "제품";
    const heading = (index, fallback) => outline[index] || fallback;

    return [
      createSectionBlock(heading(0, "사용하게 된 상황"), [
        [
          isDryShampoo
            ? `운동이 끝난 뒤 바로 약속이나 이동이 있으면 머리를 다시 감기 애매할 때가 있어요`
            : `${withObjectParticle(productName)} 써보게 된 건 일상에서 실제로 손이 자주 갈지 궁금했기 때문이에요`,
          isDryShampoo
            ? "특히 앞머리와 정수리 쪽이 눌리거나 떡져 보이면 작은 차이도 신경 쓰이는데, 그런 순간에 빠르게 정리할 수 있는지가 가장 현실적으로 느껴졌습니다"
            : "상품 후기는 장점만 적는 것보다 내가 어떤 상황에서 필요했는지부터 적어야 실제 사용 흐름이 자연스럽게 보입니다",
          isDryShampoo
            ? "특히 운동복을 갈아입고 바로 이동해야 하는 날에는 샴푸나 드라이까지 다시 하기 어려워서, 짧은 시간 안에 티 나는 부분만 정리할 수 있는지가 중요했습니다"
            : "생활용품이나 뷰티 제품은 한 번 썼을 때의 느낌보다 반복해서 쓸 때 부담이 없는지가 더 오래 남습니다"
        ]
      ], tone),
      createSectionBlock(heading(1, "사용 전 궁금했던 점"), [
        [
          isDryShampoo
            ? `${withTopicParticle(productName)} 정말 보송하게 정리되는지, 향이 부담스럽지는 않은지, 가방에 넣고 다니기 편한지가 먼저 궁금했습니다`
            : "사용 전에는 설명에 적힌 장점보다 내 생활 패턴과 맞는지, 불편한 부분은 없는지가 먼저 궁금했습니다",
          "기대치를 너무 크게 잡기보다 실제로 불편했던 순간을 줄여주는지 보는 편이 만족도를 판단하기 쉬웠습니다"
          ,
          isDryShampoo
            ? "완전히 새로 감은 머리처럼 만들기보다, 약속 전에 보이는 부분을 자연스럽게 정돈하는 정도를 기대하고 보는 게 맞겠다고 생각했습니다"
            : "그래서 사용 전에는 내 루틴에 들어왔을 때 번거롭지 않은지부터 먼저 보게 됐습니다"
        ],
        photoDetail[0] ? [photoDetail[0]] : []
      ], tone),
      createSectionBlock(heading(2, "직접 써본 느낌"), [
        experienceSentences.slice(0, 5),
        [
          isDryShampoo
            ? "머리를 완전히 감은 듯한 개운함과는 다르지만, 급하게 정돈해야 할 때 앞머리와 정수리 쪽을 빠르게 손보는 용도로는 역할이 분명했습니다"
            : importantPoints.length > 0
              ? `${importantPoints.join(", ")} 같은 부분이 실제로 기억에 남았습니다`
              : "직접 써본 느낌을 기준으로 보면 장점과 아쉬운 점이 비교적 분명하게 나뉩니다",
          isDryShampoo
            ? "사용 후 머리를 만졌을 때 보송하게 정리된 느낌은 있었지만, 두피까지 씻긴 듯한 개운함과는 구분해서 보는 편이 좋았습니다"
            : "이런 부분은 개인차가 있을 수 있어서 내가 자주 쓰는 상황과 맞춰보는 게 가장 현실적입니다"
        ]
      ], tone),
      createSectionBlock(heading(3, "좋았던 점"), [
        [
          isDryShampoo
            ? "좋았던 점은 운동 후처럼 시간이 애매한 순간에 머리 상태를 빠르게 정리할 수 있다는 점이었습니다"
            : "좋았던 점은 사용 상황이 분명할 때 장점도 더 쉽게 느껴진다는 부분이었습니다",
          /휴대|가방|넣고\s*다니|들고\s*다니/u.test(memoText)
            ? "휴대가 편해서 가방에 넣고 다니기 좋다는 점도 현실적인 장점으로 남았습니다"
            : "사용 방법이 복잡하지 않으면 필요한 순간에 다시 꺼내 쓰기 쉬워집니다",
          /향/u.test(memoText)
            ? "향은 강하게 튀는 느낌보다 무난하게 지나가는 쪽이라 부담이 적었습니다"
            : "향이나 마무리감은 취향 차이가 있을 수 있어 직접 느낀 범위 안에서만 정리하는 편이 좋습니다",
          isDryShampoo
            ? "준비 시간이 부족한 날에 머리 때문에 전체 인상이 흐트러져 보이는 걸 줄여준다는 점에서 활용도가 있었습니다"
            : "크게 마음먹고 쓰는 제품보다 필요한 순간에 자연스럽게 손이 가는 제품인지가 장점으로 느껴졌습니다"
        ]
      ], tone),
      createSectionBlock(heading(4, "아쉬웠던 점"), [
        [
          isDryShampoo
            ? "아쉬운 점은 완전히 샴푸한 느낌을 기대하면 차이가 있다는 부분입니다"
            : analysis.productSubtype === "care"
              ? "아쉬운 점은 피부 타입이나 취향에 따라 만족도가 달라질 수 있다는 부분입니다"
              : "아쉬운 점은 쓰는 상황과 기대한 기능에 따라 만족도가 달라질 수 있다는 부분입니다",
          isDryShampoo
            ? "급할 때 쓰기 좋은 보조 제품으로 생각하면 만족도가 맞지만, 두피까지 개운하게 씻긴 느낌을 대신한다고 보기는 어렵습니다"
            : "구매 전에는 크기, 구성, 가격처럼 실제 사용에 영향을 주는 정보를 같이 확인하는 편이 좋습니다",
          "그래서 장점을 볼 때도 기대치를 너무 크게 잡기보다, 내가 불편했던 순간을 얼마나 줄여주는지 기준으로 보는 편이 좋았습니다"
        ],
        productInfoSentences
      ], tone),
      createSectionBlock(heading(5, "어떤 사람에게 맞는지"), [
        [
          isDryShampoo
            ? "운동 후 바로 약속이 있거나 외출 전에 머리 상태가 신경 쓰이는 분께 잘 맞을 것 같습니다"
            : `${withConditionalParticle(recommendedReader)} 참고하기 좋아요`,
          "다만 기대하는 역할을 분명히 잡고, 가격과 용량, 구매처처럼 바뀔 수 있는 정보는 구매 전에 한 번 더 확인하는 편이 좋습니다",
          isDryShampoo
            ? "머리를 바로 감기 어려운 상황이 자주 있거나 운동 가방에 가볍게 넣어둘 제품을 찾는 분이라면 더 현실적으로 맞을 수 있습니다"
            : "내 생활 패턴에서 자주 쓰는 장면이 떠오르는 분이라면 비교해볼 만합니다"
        ]
      ], tone),
      createSectionBlock(heading(6, "마무리"), [
        [
          `${withTopicParticle(productName)} 필요한 순간이 분명할수록 장점이 잘 보이는 제품이었습니다`,
          isDryShampoo
            ? "저는 운동 후 머리가 눌리거나 떡져 보일 때 빠르게 정리하는 용도로 생각하면 가장 자연스럽게 맞았습니다"
            : "좋았던 점과 아쉬운 점을 같이 보면 내 생활에 맞는 제품인지 더 차분하게 판단할 수 있습니다",
          "막연히 좋다고 말하기보다는 내가 쓰려는 상황과 기대하는 역할이 맞는지 확인하면 실패 확률을 줄일 수 있을 것 같습니다"
        ]
      ], tone)
    ];
  }

  if (category === "restaurant") {
    const partySize = getPartySize(memoText);
    const keywordSourceText = analysis.keywordSourceText || topic;
    const primaryMenu = getPrimaryRestaurantMenu({ productName: keywordSourceText }, memoText);
    const hasFamilyCue = /가족|외식|아이|아이랑|여행/u.test(memoText);
    const hasTasteCue = /맛|국물|매콤|칼칼|시원|진하|불맛|담백|맛있/u.test(memoText);
    const hasAmountCue = /양|많|넉넉|푸짐/u.test(memoText);
    const hasParkingCue = /주차/u.test(memoText);
    const hasStaffCue = /직원|응대|친절/u.test(memoText);
    const placeCue = /초지대교/u.test(`${keywordSourceText} ${memoText}`) ? "초지대교 근처" : "근처";

    return [
      createSectionBlock(outline[0], [
        [
          primaryMenu
            ? hasFamilyCue
              ? `${placeCue}에서 가족 식사 장소를 찾다가 ${withSubjectParticle(primaryMenu)} 유명하다는 점이 먼저 눈에 들어왔어요`
              : `${withSubjectParticle(primaryMenu)} 유명하다는 점은 이곳을 볼 때 가장 먼저 확인하게 되는 부분이었어요`
            : `${withObjectParticle(topic)} 보게 된 건 대표 메뉴와 식사 분위기를 함께 확인하고 싶었기 때문이에요`,
          primaryMenu && /짬뽕/u.test(primaryMenu)
            ? "짬뽕 메뉴는 사진으로 보이는 국물과 재료 구성이 먼저 눈에 들어오지만, 실제 맛과 맵기는 개인차가 있을 수 있습니다"
            : primaryMenu
              ? `${withTopicParticle(primaryMenu)} 사진으로 보이는 구성과 메뉴 이름을 함께 보면 식사 후보를 잡기 좋은 메뉴입니다`
              : "대표 메뉴가 분명하면 방문 전 어떤 메뉴를 먼저 볼지 정하기 더 쉽습니다",
          /본점|강화도/u.test(`${topic} ${memoText}`)
            ? "본점이나 지역명이 함께 들어간 맛집은 처음 가는 사람도 위치와 대표 메뉴를 같이 확인하고 싶어 합니다"
            : "",
          /회식|직장인/u.test(memoText)
            ? "직장인 회식 자리로 본다면 메뉴가 나눠 먹기 좋은지와 대화하기 편한 분위기인지도 함께 보게 됩니다"
            : "",
          partySize ? `${partySize}이 함께 먹는 자리라면 메뉴를 여러 개 나눠 먹기 편한지도 자연스럽게 보게 됩니다` : ""
        ],
        photoDetail[0] ? [photoDetail[0]] : []
      ], tone),
      createSectionBlock(outline[1], [
        [
          ...createRestaurantMenuSentences(`${topic}\n${memoText}`),
          hasTasteCue
            ? "실제로 기억나는 맛 표현은 국물, 소스, 재료, 맵기처럼 떠오르는 범위 안에서만 적는 편이 자연스럽습니다"
            : "맛을 단정하기보다 메뉴 사진으로 보이는 구성과 동행 상황을 먼저 보는 흐름이 자연스럽습니다",
          hasAmountCue
            ? "양과 관련해 남긴 내용이 있다면 가족 외식이나 여러 명이 나눠 먹는 자리에서 중요한 참고점이 됩니다"
            : "양은 사진만으로 단정하기 어려워서 인원수에 맞춰 메뉴판을 다시 보는 쪽이 좋겠습니다"
        ]
      ], tone),
      createSectionBlock(outline[2], [
        [
          /분위기/u.test(memoText)
            ? "분위기가 좋았던 기억은 가족 외식이나 여행 중 식사 장소를 고를 때 특히 읽기 좋은 포인트입니다"
            : "매장 분위기와 좌석, 주문 동선은 사진으로 확인되는 범위 안에서만 보는 편이 좋습니다",
          hasStaffCue
            ? "직원 응대가 친절했다는 점은 처음 방문한 맛집에서 주문 흐름을 편하게 만들어주는 기준이 됩니다"
            : "응대나 주문 흐름은 방문 시간대와 매장 상황에 따라 달라질 수 있습니다",
          hasParkingCue
            ? "주차가 편했다는 점은 차로 이동하는 가족 외식이나 여행 동선에서 꽤 중요한 장점으로 남습니다"
            : "주차 정보는 방문 시간대마다 달라질 수 있어 출발 전에 한 번 살펴보면 좋겠습니다"
        ]
      ], tone),
      createSectionBlock(outline[3], [
        [
          "가격, 운영시간, 대기처럼 바뀔 수 있는 정보는 한 번만 짚어두면 글이 과장되지 않고 읽기 편합니다",
          ...createRestaurantCheckSentences(memoText)
        ]
      ], tone),
      createSectionBlock(outline[4], [
        [
          hasFamilyCue
            ? "가족 외식이나 강화도 여행 중 식사 장소를 찾는 분이라면 대표 메뉴와 대기 여부를 함께 확인해보면 좋겠습니다"
            : `${recommendedReader}께 참고가 될 것 같아요`,
          primaryMenu
            ? `${withTopicParticle(primaryMenu)} 궁금한 분이라면 메뉴 사진과 위치를 먼저 보고 방문 계획을 잡는 방식이 좋겠습니다`
            : "대표 메뉴와 방문 시간대, 주차 가능 여부를 같이 보면 실제로 움직일 때 더 편합니다",
          partySize ? `${partySize}이 함께 움직이는 자리라면 메뉴 선택과 식사 시간을 먼저 맞춰보는 편이 좋겠습니다` : ""
        ]
      ], tone)
    ];
  }

  if (category === "cafe") {
    return [
      createSectionBlock(outline[0], [
        [
          /아이|가족/u.test(memoText)
            ? "아이와 함께 카페를 갈 때는 음료나 디저트보다 머무는 동안 편한지가 먼저 보입니다"
            : "카페를 고를 때는 메뉴만큼이나 공간 분위기와 좌석이 내 목적에 맞는지가 중요했습니다",
          /가족/u.test(memoText)
            ? "주말에 가족이 함께 방문하는 상황이라면 모두가 편하게 앉을 수 있는지도 중요한 기준이 됩니다"
            : "",
          /주차/u.test(memoText)
            ? "주차가 편하다는 점은 방문 전후의 부담을 줄여주는 요소로 남았습니다"
            : "방문 전에는 좌석 간격, 소음, 운영시간처럼 실제로 머무는 데 영향을 주는 부분도 함께 보게 됩니다"
        ],
        photoDetail[0] ? [photoDetail[0]] : []
      ], tone),
      createSectionBlock(outline[1], [
        [
          /분위기/u.test(memoText)
            ? "분위기가 좋게 느껴지면 짧게 머물러도 만족도가 오래 남습니다"
            : "공간은 사진보다 실제로 앉았을 때 편한지, 대화하기 괜찮은지가 더 크게 느껴집니다",
          /좌석/u.test(memoText)
            ? "좌석이 편하거나 여유롭게 느껴졌다면 아이와 함께 가거나 오래 머무를 때도 기준이 됩니다"
            : "좌석 정보가 부족하다면 발행 전 콘센트, 테이블 간격, 혼잡 시간대를 한 번 더 확인하면 좋겠습니다"
        ]
      ], tone),
      createSectionBlock(outline[2], [
        [
          /음료|커피|디저트|메뉴/u.test(memoText)
            ? "음료나 디저트는 메모에 남은 느낌을 중심으로 정리하면 과장 없이 자연스럽습니다"
            : "메뉴와 가격은 제공된 정보가 부족하면 임의로 만들지 않고 [확인 필요]로 남기는 편이 안전합니다",
          "카페 후기는 맛 표현만 길게 쓰기보다 공간, 좌석, 주문 흐름을 함께 적을 때 실제 방문에 더 도움이 됩니다"
        ]
      ], tone),
      createSectionBlock(outline[3], [
        [
          /아이/u.test(memoText)
            ? "아이와 함께 간다면 아이 음료, 유아 의자, 화장실 동선처럼 작은 부분이 체감 만족도에 영향을 줍니다"
            : "주차, 운영시간, 대기 여부는 방문 시간대에 따라 달라질 수 있어 한 번 더 확인하는 편이 좋습니다",
          "아쉬운 점도 함께 적어두면 글이 광고처럼 보이지 않고 실제 방문 기준으로 읽힙니다"
        ]
      ], tone),
      createSectionBlock(outline[4], [
        [
          `${withConditionalParticle(recommendedReader)} 참고하기 좋겠습니다`,
          "다시 간다면 사람이 몰리는 시간대와 주차 가능 여부, 내가 원하는 좌석 분위기가 맞는지를 먼저 볼 것 같습니다"
        ]
      ], tone)
    ];
  }

  if (category === "information") {
    const memoSentences = [
      /공고문/u.test(memoText) ? "공고문은 조건과 제한 사항을 확인하는 출발점이라 처음부터 따로 표시해두는 편이 좋습니다" : "",
      /입찰/u.test(memoText) ? "입찰 흐름은 공고 확인부터 결과 확인까지 순서가 이어지므로 단계별로 보는 편이 이해하기 쉽습니다" : "",
      /초보자|기준/u.test(memoText) ? "초보자 기준에서는 어려운 용어보다 지금 확인해야 할 기준을 먼저 잡는 것이 현실적입니다" : "",
      /리스크|위험|주의/u.test(memoText) ? "리스크는 마지막에 보는 항목이 아니라 시작 전에 먼저 확인해야 할 기준으로 두는 편이 안전합니다" : ""
    ].filter(Boolean);

    return [
      createSectionBlock(outline[0], [
        [
          `${withObjectParticle(topic)} 처음 알아볼 때 가장 헷갈리는 건 용어보다 전체 흐름입니다`,
          "먼저 무엇을 확인해야 하는지 정리하면 다음 단계에서 찾아볼 정보도 훨씬 분명해집니다"
        ]
      ], tone),
      createSectionBlock(outline[1], [
        [
          /세관공매/u.test(topic)
            ? "세관공매는 공고문 확인, 입찰 흐름, 결과 확인처럼 단계가 나뉘어 있어서 순서대로 보는 편이 좋습니다"
            : "처음 시작하는 방법을 볼 때는 개념, 준비 단계, 확인 기준을 나눠두면 부담이 줄어듭니다",
          ...(memoSentences.length > 0 ? memoSentences.slice(0, 2) : ["처음 보는 주제라면 핵심 용어와 진행 순서를 먼저 나눠보는 편이 이해하기 쉽습니다"])
        ]
      ], tone),
      createSectionBlock(outline[2], [
        [
          /공고문/u.test(memoText) ? "공고문은 조건과 일정을 확인하는 기준이 되므로 먼저 읽는 습관을 들이는 편이 좋습니다" : "",
          /입찰/u.test(memoText) ? "입찰 흐름은 신청부터 결과 확인까지 어떤 순서로 이어지는지 먼저 잡아두면 덜 막막합니다" : "",
          /초보자|기준/u.test(memoText) ? "초보자 기준에서는 어려운 용어를 한 번에 외우기보다 반복해서 나오는 기준부터 확인하는 것이 현실적입니다" : ""
        ]
      ], tone),
      createSectionBlock(outline[3], [
        [
          "확인되지 않은 가격, 주소, 운영시간은 단정하지 않는 편이 안전합니다",
          "정보 정리형 글에서는 확인한 기준과 주의할 점을 구분해두는 것이 신뢰를 높입니다"
        ]
      ], tone),
      createSectionBlock(outline[4], [
        [
          `${withTopicParticle(topic)} 처음이라면 기본 개념, 진행 순서, 확인 기준을 먼저 잡고 세부 정보를 더해가는 방식이 좋습니다`,
          "마지막에는 내가 지금 바로 확인할 것과 나중에 다시 찾아볼 것을 나눠두면 글을 읽는 사람도 행동하기 쉬워집니다"
        ]
      ], tone)
    ];
  }

  if (category === "comparison") {
    return [
      createSectionBlock(outline[0], [
        [
          `${withObjectParticle(topic)} 바로 고르기보다 비교 기준을 먼저 잡아두면 선택이 훨씬 편해집니다`,
          "구매 전에는 장점만 눈에 들어오기 쉬워서 아쉬운 점과 확인할 조건을 같이 보는 편이 좋습니다"
        ]
      ], tone),
      createSectionBlock(outline[1], [
        [
          "선택 기준은 가격, 구성, 사용 목적, 유지 관리처럼 실제 만족도에 영향을 주는 항목부터 나누면 좋습니다",
          ...createCategoryMemoSentences(memoText, "메모에 남은 기준을 중심으로 비교하면 과장 없이 판단하기 쉽습니다").slice(0, 2)
        ],
        photoDetail[0] ? [photoDetail[0]] : []
      ], tone),
      createSectionBlock(outline[2], [
        [
          "장점은 내가 자주 쓰는 상황과 맞을 때 의미가 있고, 아쉬운 점은 구매 후 불편으로 이어질 수 있는지 확인해야 합니다",
          "단순 추천보다 어떤 사람에게 맞고 어떤 사람에게는 애매할 수 있는지 나눠두면 글이 더 설득력 있게 읽힙니다"
        ]
      ], tone),
      createSectionBlock(outline[3], [
        [
          `${withConditionalParticle(recommendedReader)} 기준을 잡는 데 도움이 됩니다`,
          "내 상황과 맞지 않는 장점은 크게 의미가 없기 때문에 사용 목적을 먼저 정해두는 편이 좋습니다"
        ]
      ], tone),
      createSectionBlock(outline[4], [
        [
          "구매 전에는 가격, 구성, 교환/환불, 실제 사용 조건처럼 바뀔 수 있는 정보를 한 번 더 확인해야 합니다",
          "최종 판단은 가장 많은 장점이 아니라 내 목적에 가장 덜 불편한 선택지인지로 보는 편이 현실적입니다"
        ]
      ], tone)
    ];
  }

  if (category === "hospital") {
    return [
      createSectionBlock(outline[0], [["처음 병원을 알아볼 때는 진료 자체보다 접수와 대기 흐름이 막막하지 않은지가 먼저 신경 쓰였습니다"]], tone),
      createSectionBlock(outline[1], [createCategoryMemoSentences(memoText, "예약과 접수 흐름은 방문 전 한 번 더 확인해두면 마음이 훨씬 편합니다")], tone),
      createSectionBlock(outline[2], [["상담은 결과를 단정하기보다 설명을 이해하기 쉬웠는지, 질문하기 편했는지를 중심으로 보는 게 좋습니다"]], tone),
      createSectionBlock(outline[3], [["진료 시간, 비용, 준비물은 방문 전에 확인하고, 의학적 효과는 개인차가 있으니 단정하지 않는 편이 좋겠습니다"]], tone)
    ];
  }

  if (category === "service") {
    return [
      createSectionBlock(outline[0], [["혼자 해결하기 애매한 부분이 있어 서비스를 알아보게 됐고, 상담 과정이 얼마나 편한지가 먼저 궁금했습니다"]], tone),
      createSectionBlock(outline[1], [createCategoryMemoSentences(memoText, "상담 과정에서 필요한 내용을 차근차근 확인할 수 있으면 처음 이용하는 사람도 부담이 줄어듭니다")], tone),
      createSectionBlock(outline[2], [["진행 과정은 결과만큼 중요했습니다. 비용, 일정, 추가 조건을 미리 나눠 확인하면 이용 전 판단이 훨씬 쉬워집니다"]], tone),
      createSectionBlock(outline[3], [[`${withConditionalParticle(recommendedReader)} 참고하기 좋은 후기입니다`]], tone)
    ];
  }

  if (category === "travel") {
    return [
      createSectionBlock(outline[0], [["처음 가보는 여행지는 사진으로 본 분위기가 실제로도 괜찮은지, 이동이 무리 없는지가 가장 궁금했습니다"]], tone),
      createSectionBlock(outline[1], [photoDetail.length ? photoDetail : ["동선은 무리하게 많이 넣기보다 머무는 시간을 기준으로 잡는 편이 편했습니다"]], tone),
      createSectionBlock(outline[2], [createCategoryMemoSentences(memoText, "풍경과 분위기는 직접 가본 뒤 기억에 남은 장면을 중심으로 적으면 더 자연스럽게 읽힙니다")], tone),
      createSectionBlock(outline[3], [["다시 간다면 이동 시간, 예약 여부, 날씨와 운영시간을 먼저 확인할 것 같아요"]], tone)
    ];
  }

  if (category === "kids-place") {
    return [
      createSectionBlock(outline[0], [
        [
          "아이와 함께 가는 공간은 체험 내용만큼이나 아이가 실제로 흥미를 보이는지가 가장 궁금했어요",
          "보호자 입장에서는 기다리는 동안 편한지, 동선이 복잡하지 않은지도 같이 보게 됩니다"
        ],
        photoDetail[0] ? [photoDetail[0]] : []
      ], tone),
      createSectionBlock(outline[1], [
        [
          /아이|좋아|체험/u.test(memoText)
            ? "아이가 체험을 좋아했다는 점이 가장 먼저 기억에 남았습니다"
            : "아이 반응은 시설 설명보다 실제 만족도를 판단하는 데 더 크게 남습니다",
          "체험 흐름이 너무 복잡하지 않으면 처음 가는 가족도 부담이 덜합니다"
        ]
      ], tone),
      createSectionBlock(outline[2], [
        [
          /부모|대기|편/u.test(memoText)
            ? "부모 대기 공간이 편했다는 점도 실제 방문 만족도에 영향을 줬어요"
            : "보호자가 잠깐 쉬거나 기다릴 수 있는 공간이 있으면 체험 시간이 훨씬 편해집니다"
        ]
      ], tone),
      createSectionBlock(outline[3], [
        [
          /주차/u.test(memoText)
            ? "주차는 확인이 필요해요. 아이와 함께 움직일 때는 입차 동선과 주차 가능 여부를 미리 보는 편이 좋습니다"
            : "운영시간, 예약, 주차 여부는 방문 전에 한 번 더 확인해두면 좋습니다"
        ]
      ], tone),
      createSectionBlock(outline[4], [
        [
          "실내에서 아이가 체험할 거리가 필요하고, 보호자도 편하게 기다릴 공간을 중요하게 보는 가족에게 잘 맞을 것 같아요"
        ]
      ], tone)
    ];
  }

  return [
    createSectionBlock(outline[0], [["처음 참여하기 전에는 어렵지 않을지와 실제 진행 흐름이 가장 궁금했습니다"]], tone),
    createSectionBlock(outline[1], [createCategoryMemoSentences(memoText, "체험 전 기대했던 부분과 직접 해보며 느낀 차이를 함께 적으면 실제 후기처럼 읽힙니다")], tone),
    createSectionBlock(outline[2], [photoDetail.length ? photoDetail : ["진행 과정은 순서대로 떠올리면 처음 보는 사람도 쉽게 따라올 수 있습니다"]], tone),
    createSectionBlock(outline[3], [[`${withConditionalParticle(recommendedReader)} 부담 없이 참고할 수 있을 것 같아요`]], tone)
  ];
};

const applyCategoryGuardrails = (body = "", analysis = {}) => {
  const category = analysis.category || "place";
  const productSubtype = analysis.productSubtype || "general";
  const patterns = getCategoryForbiddenExpressions(category, productSubtype, `${analysis.topic || ""}\n${analysis.memoText || ""}`);
  let guarded = body;

  patterns.forEach((pattern) => {
    guarded = guarded.replace(pattern, "");
  });

  return normalizeBody(
    guarded
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/(?:이미지|사진)\s*\d+/gu, "사진")
      .replace(/carousel|ChatGPT Image|image page|업로드된 이미지|업로드 파일명|생성 시간|내부 이미지 식별자/giu, "")
  );
};

const getRestaurantPhotoMarkerLabels = (form = {}, primaryMenu = "") => {
  const imageCount = getImageCount(form);
  if (imageCount <= 0) return [];

  const imageItems = getImageContextItems(form);
  const fallbackLabels = [
    primaryMenu ? `${primaryMenu} 사진` : "대표 메뉴 사진",
    primaryMenu ? `${primaryMenu} 가까운 사진` : "음식 사진",
    "전체 상차림"
  ];

  return Array.from({ length: Math.min(imageCount, 3) }, (_, index) => {
    const note = text(imageItems[index]?.note).replace(/^사진\s*[:：]?\s*/u, "");
    return note || fallbackLabels[index] || `사진 ${index + 1}`;
  });
};

const createRestaurantVisualSentences = ({ mainKeyword = "", primaryMenu = "", hasPhotos = false, hasVisitedCue = false, hasFamilyCue = false } = {}) => {
  if (/짬뽕|갈낙|국물/u.test(primaryMenu)) {
    return hasPhotos
      ? [
          `사진으로 보니 ${primaryMenu}은 붉은 국물 위에 해산물과 채소가 큼직하게 올라가 있어서 첫인상부터 한 끼 메뉴처럼 보였어요`,
          hasVisitedCue && hasFamilyCue
            ? "가족여행 중 먹는 식사는 너무 가볍기보다 메뉴 구성이 또렷한 쪽이 편했는데, 사진으로 다시 봐도 그 구성이 분명하게 느껴졌습니다"
            : "짬뽕 메뉴는 국물 색감이나 들어간 재료만 봐도 분위기가 느껴져서, 메뉴를 고를 때 이런 사진이 꽤 도움이 되더라고요"
        ]
      : [
          `${primaryMenu}처럼 국물 메뉴가 중심인 식당은 사진에서 보이는 색감과 재료 구성이 메뉴를 떠올리는 데 큰 역할을 해요`,
          "다만 실제 맛이나 양은 사진만으로 단정하기 어려워서, 눈에 보이는 비주얼 중심으로만 기대를 잡는 편이 편했습니다"
        ];
  }

  if (/탕수육/u.test(primaryMenu)) {
    return [
      hasPhotos
        ? `사진으로 보니 ${primaryMenu}은 튀김 색과 담긴 모양이 먼저 보여서 메뉴의 첫인상을 잡기 쉬웠어요`
        : `${primaryMenu}은 튀김 색이나 담긴 모양이 보이면 메뉴의 첫인상을 잡기 쉬운 편이에요`,
      hasPhotos
        ? "사진에서 보이는 부분은 색감과 구성에 가까워서, 실제 식감이나 양은 방문 상황에 따라 다르게 느껴질 수 있습니다"
        : "식감이나 양은 기억나는 범위 안에서만 적고, 바뀔 수 있는 부분은 가볍게 남겨두는 쪽이 편합니다"
    ];
  }

  return [
    hasPhotos
      ? `사진으로 보니 ${mainKeyword}의 메뉴는 색감과 담긴 구성이 먼저 눈에 들어왔어요`
      : `${mainKeyword}을 볼 때는 메뉴 이름과 사진에서 보이는 구성을 함께 떠올리게 돼요`,
    "사진만으로 실제 맛까지 알 수는 없지만, 어떤 메뉴를 먼저 볼지 정하는 데는 충분히 도움이 됐습니다"
  ];
};

const createFocusedRestaurantReviewBody = (form = {}, analysis = {}) => {
  const mainKeyword = getMainKeyword(form);
  const memoText = analysis.memoText || getFormMemoText(form);
  const subKeywords = getSubKeywords(form);
  const regionKeyword =
    subKeywords.find((keyword) =>
      /초지|강화|근처/u.test(keyword) ||
      (/맛집/u.test(keyword) && !/후기/u.test(keyword) && !compact(keyword).includes(compact(mainKeyword)))
    ) ||
    (/강화/u.test(`${mainKeyword} ${memoText}`) ? "강화도맛집" : "지역 맛집");
  const primaryMenu = getPrimaryRestaurantMenu(form, memoText) || "대표 메뉴";
  const hasFamilyCue = /가족|여행|외식|아이/u.test(memoText);
  const hasGroupCue = /회식|직장인|모임|동료/u.test(memoText);
  const hasTravelCue = /강화|여행/u.test(`${mainKeyword} ${regionKeyword} ${memoText}`);
  const visitedCue = hasVisitedReviewCue(memoText);
  const hasExplicitCheckMemo = /가격|주차|예약|대기|웨이팅|영업시간|운영/u.test(memoText);
  const mentionedMenus = getRestaurantMenus(memoText).filter((menu) => menu !== primaryMenu).slice(0, 2);
  const partySize = getPartySize(memoText);
  const placeHint = hasTravelCue ? "초지대교 근처 맛집" : regionKeyword === "지역 맛집" ? "가족 식사 장소" : regionKeyword;
  const placePair =
    placeHint === regionKeyword
      ? regionKeyword
      : `${placeHint}${hasFinalConsonant(placeHint) ? "이나" : "나"} ${regionKeyword}`;
  const familyIntroLabel = subKeywords.find((keyword) => /가족|외식|여행/u.test(keyword)) || "가족과 함께";
  const familyIntroContext =
    familyIntroLabel === "가족과 함께" || /가족여행/u.test(familyIntroLabel)
      ? "가족과 함께 움직이는 날"
      : `${familyIntroLabel}처럼 움직이는 날`;
  const contextText = hasGroupCue
    ? "직장인 회식"
    : hasFamilyCue
      ? hasTravelCue ? "강화도 가족여행" : "가족 식사"
      : "식사 자리";
  const hasPhotos = getImageCount(form) > 0 || analysis.imageCount > 0;
  const markerLabels = getRestaurantPhotoMarkerLabels(form, primaryMenu);
  const visualSentences = createRestaurantVisualSentences({ mainKeyword, primaryMenu, hasPhotos, hasVisitedCue: visitedCue, hasFamilyCue });
  const menuIntroLabel =
    primaryMenu && compact(mainKeyword).includes(compact(`${primaryMenu}맛집`))
      ? `${primaryMenu} 메뉴가 떠오른 곳`
      : `${primaryMenu} 맛집`;
  const disclosure = getDisclosureSentence(form);
  const tone = analysis.tone || normalizeTone(form.tone);

  const intro = createHumanParagraph([
    hasFamilyCue && hasTravelCue
      ? `${mainKeyword}은 강화도 가족여행 중 식사할 곳을 찾다가 들르게 된 ${primaryMenu} 맛집이에요`
      : `${mainKeyword}은 식사할 곳을 찾다가 들르게 된 ${menuIntroLabel}이에요`,
    `${withTopicParticle(mainKeyword)} ${placePair}을 찾는 분들이 함께 확인하기 좋은 곳으로 보였고, 대표 메뉴인 ${withSubjectParticle(primaryMenu)} 먼저 눈에 들어왔어요`,
    hasFamilyCue
      ? `${familyIntroContext}에는 메뉴도 중요하지만 식사 시간이 너무 부담스럽지 않은지도 보게 되는데, ${mainKeyword}은 그런 점에서 기억에 남았습니다`
      : `여럿이 함께 먹는 날에는 메뉴가 분명한지와 식사 시간이 부담스럽지 않은지도 보게 되는데, ${mainKeyword}은 그런 흐름에서 한 번 살펴볼 만했습니다`
  ], tone);

  const discovery = createHumanParagraph([
    visitedCue
      ? `막상 ${mainKeyword}에 들렀던 기억을 떠올리면 복잡한 설명보다 ${withSubjectParticle(primaryMenu)} 먼저 떠올라요`
      : `처음 ${mainKeyword}을 알게 된 이유는 복잡한 설명보다 메뉴명이 먼저 기억에 남았기 때문이에요`,
    hasFamilyCue && hasTravelCue
      ? visitedCue
        ? "강화도 가족여행 중 들른 곳이라, 가족이 함께 먹기 괜찮은지도 자연스럽게 보게 됐어요"
        : "강화도처럼 이동 시간이 길어질 수 있는 여행지에서는 밥 먹는 시간이 너무 늘어지지 않는지도 같이 보게 되더라고요"
      : hasGroupCue
        ? "회식처럼 여러 명이 함께 움직이는 자리에서는 메뉴 선택이 너무 어려워지지 않는지도 꽤 중요하게 느껴집니다"
        : "처음 가는 식당은 메뉴가 분명하면 어디서부터 볼지 정하기가 조금 쉬워지더라고요",
    visitedCue
      ? `다녀온 뒤에도 ${withTopicParticle(primaryMenu)} 궁금했던 마음과 가족 식사로 괜찮았던 기억이 같이 남았습니다`
      : `이 메뉴가 궁금했던 것도 이름에서 방향이 또렷하게 느껴져서였고, ${contextText} 흐름 안에서 부담 없이 떠올려보기 좋았습니다`
  ], tone);

  const photoParagraphs = [
    markerLabels[0] ? `[사진 삽입: ${markerLabels[0]}]` : "",
    createHumanParagraph(visualSentences, tone),
    markerLabels[1] ? `[사진 삽입: ${markerLabels[1]}]` : "",
    markerLabels[1]
      ? createHumanParagraph([
          "다른 사진에서는 그릇 안쪽 색감과 올라간 재료가 조금 더 가까이 보여서 첫 사진에서 본 인상이 이어졌어요",
          visitedCue
            ? "다녀온 날의 식사 기억도 이렇게 전체 모습과 가까운 장면을 나눠 보니 더 또렷하게 떠올랐습니다"
            : "사진이 여러 장이면 같은 메뉴라도 전체 모습과 가까운 장면을 나눠 볼 수 있어서 메뉴 구성이 더 자연스럽게 떠오릅니다"
        ], tone)
      : "",
    markerLabels[2] ? `[사진 삽입: ${markerLabels[2]}]` : "",
    markerLabels[2]
      ? createHumanParagraph([
          mentionedMenus.length > 0
            ? `${mentionedMenus.join(", ")}처럼 함께 언급된 메뉴가 있으면 한 가지 메뉴만 보는 글보다 식사 구성을 조금 더 넓게 떠올릴 수 있어요`
            : "마지막 사진은 메뉴나 공간의 다른 장면을 이어서 보여줘서 전체 식사 분위기를 상상하기 좋았어요",
          "사진마다 역할이 조금씩 다르면 본문도 같은 설명을 반복하지 않고 첫인상, 메뉴 구성, 함께 볼 부분으로 나눠 쓰기 편합니다"
        ], tone)
      : ""
  ].filter(Boolean);

  const familyViewSentences = [
    hasFamilyCue
      ? `${mainKeyword}은 가족 식사로 볼 때 메뉴가 낯설지 않은지, 같이 간 사람이 고르기 어렵지 않은지를 먼저 떠올리게 됐어요`
      : `${mainKeyword}은 식사 자리로 볼 때 메뉴가 낯설지 않은지, 함께 먹는 사람이 고르기 어렵지 않은지를 먼저 떠올리게 됐어요`,
    /분위기/u.test(memoText)
      ? "분위기가 좋았던 기억이 있으면 식사하는 동안의 부담이 덜했는지도 함께 떠올리게 됩니다"
      : "",
    /양|많|넉넉|푸짐/u.test(memoText)
      ? "양이 넉넉했다는 기억은 동행 인원에 맞춰 주문을 생각할 때 현실적인 참고가 됩니다"
      : "",
    hasProvidedParking(memoText) && !hasParkingNeedsCheck(memoText)
      ? "주차가 편했다는 점은 차로 움직이는 일정에서는 꽤 크게 남는 부분이었습니다"
      : /주차/u.test(memoText)
      ? "주차는 방문 시간대에 따라 달라질 수 있어 식사 계획을 잡기 전에 따로 보는 편이 좋습니다"
      : "",
    /직원|응대|친절/u.test(memoText)
      ? "직원 응대가 친절했다는 기억이 있으면 처음 방문하는 사람도 주문 흐름을 조금 더 편하게 떠올릴 수 있습니다"
      : "",
    partySize ? `${partySize}이 함께 먹는 자리라면 한 가지 메뉴보다 함께 볼 메뉴가 있는지도 자연스럽게 보게 됩니다` : "",
    mentionedMenus.length > 0 ? `${mentionedMenus.join(", ")}도 함께 떠올라서 메뉴 선택지가 더 또렷하게 느껴졌어요` : "",
    hasFamilyCue
      ? "다녀온 뒤 좋았던 기억도 거창한 표현보다 함께 움직이는 날에 식사 시간을 무리 없이 넣을 수 있었다는 쪽에 가까웠습니다"
      : "다녀온 뒤 남는 기억도 거창한 표현보다 식사 흐름을 무리 없이 잡기 좋았다는 쪽에 가까웠습니다",
    visitedCue && hasFamilyCue
      ? hasTravelCue
        ? "강화도 여행 중에는 한 끼 식사가 다음 일정의 기분에도 이어져서, 너무 거창하지 않아도 편하게 먹고 움직일 수 있었던 점이 좋았어요"
        : "가족 외식에서는 한 끼 식사가 그날 분위기에도 이어져서, 너무 거창하지 않아도 편하게 먹고 움직일 수 있었던 점이 좋았어요"
      : "",
    "메뉴를 길게 고민하기보다 메뉴 구성과 식사 시간을 함께 떠올릴 수 있었던 점도 편하게 남았습니다",
    hasTravelCue
      ? "강화도 여행처럼 하루 일정이 이어지는 날에는 식사 한 번도 다음 움직임과 자연스럽게 이어지는지가 꽤 중요하게 느껴졌어요"
      : "하루 일정이 이어지는 날에는 식사 한 번도 다음 움직임과 자연스럽게 이어지는지가 꽤 중요하게 느껴졌어요"
  ].filter(Boolean);
  const familyView = createHumanParagraph(familyViewSentences, tone);

  const preVisit = createHumanParagraph([
    visitedCue
      ? `다녀온 뒤 돌아보면 영업시간, 대기 여부, 최신 메뉴판 정도는 출발 전에 가볍게 보고 가면 ${contextText} 일정이 더 편했을 것 같아요`
      : `가기 전에는 영업시간, 대기 여부, 주차 가능 여부, 최신 메뉴판 정도를 한 번만 확인해두면 ${contextText} 계획을 잡을 때 훨씬 편할 것 같아요`,
    /가격/u.test(memoText)
      ? "가격: [확인 필요]. 메뉴 가격은 방문 시점에 따라 달라질 수 있어 최신 메뉴판을 보는 쪽이 현실적입니다"
      : "",
    /주차/u.test(memoText)
      ? "주차: [확인 필요]. 차로 움직이는 일정이라면 주차 가능 여부도 미리 살펴두는 편이 좋습니다"
      : "",
    visitedCue
      ? "다음에 다시 간다면 가격이나 운영 정보는 출발 전에 공식 안내나 최근 후기를 한 번 보고 움직일 것 같아요"
      : "가격이나 운영 정보는 시점에 따라 달라질 수 있으니 출발 전에 공식 안내나 최근 후기를 같이 보는 쪽이 현실적입니다",
    visitedCue
      ? "메뉴 구성이 궁금해서 들른 만큼 사진에서 보이던 구성과 실제 메뉴판을 함께 보니 선택하기가 더 편했습니다"
      : `${primaryMenu}을 보고 방문을 생각한다면 사진에서 보이는 구성과 실제 메뉴판을 함께 놓고 고르면 기대치를 더 편하게 맞출 수 있습니다`,
    partySize ? `${partySize}이 함께 움직이는 자리라면 메뉴 하나만 보기보다 곁들일 메뉴와 식사 시간을 같이 생각하게 됩니다` : "",
    hasFamilyCue
      ? "가족이 함께 움직이는 날에는 식사 시간이 조금만 어긋나도 다음 일정이 밀릴 수 있어서, 이런 기본 정보만 미리 챙겨도 마음이 훨씬 가벼웠습니다"
      : "여럿이 함께 움직이는 날에는 식사 시간이 조금만 어긋나도 다음 일정이 밀릴 수 있어서, 이런 기본 정보만 미리 챙겨도 마음이 훨씬 가벼웠습니다"
  ].filter(Boolean), tone);

  const closing = createHumanParagraph([
    `이곳은 메뉴 구성이 궁금해서 들르게 된 곳이고, ${regionKeyword}을 찾던 기억 속에서도 상호와 메뉴가 비교적 또렷하게 남았습니다`,
    visitedCue
      ? "전체적으로는 과하게 좋다고 몰아가기보다, 가족이 함께 움직이는 날에 메뉴와 위치가 같이 기억에 남은 곳이었어요"
      : "전체적으로는 과하게 좋다고 몰아가기보다, 가족이나 동행과 함께 움직이는 날에 메뉴와 위치를 차분히 떠올려보기 좋은 후기였어요",
    hasTravelCue
      ? `다음에 강화도 쪽에서 식사 일정을 다시 잡는다면 ${mainKeyword}의 메뉴 사진과 기본 정보를 먼저 보고, 가족 일정에 맞는지만 가볍게 맞춰볼 것 같아요`
      : `다음에 ${regionKeyword} 주변에서 식사할 일이 있다면 ${mainKeyword}의 메뉴 사진과 기본 정보를 먼저 보고, 일정에 맞는지만 가볍게 맞춰볼 것 같아요`,
    visitedCue && hasFamilyCue
      ? "가족여행 중 들른 식당으로는 메뉴가 선명해서 다녀온 기억을 다시 떠올리기에도 어렵지 않았습니다"
      : "",
    visitedCue
      ? "사진에서 보이던 첫인상과 다녀온 날의 기억이 이어져서, 부담 없이 편하게 남겨둘 만한 가족여행 식사 후기였습니다"
      : "사진에서 보이는 첫인상과 기본 정보를 함께 보니 처음 떠올렸던 메뉴 분위기가 더 또렷하게 남았습니다"
  ], tone);

  const body = normalizeBody([
    intro,
    discovery,
    ...photoParagraphs,
    familyView,
    visitedCue && !hasExplicitCheckMemo ? "다녀온 뒤 기억에 남은 점" : "방문 전 참고하면 좋은 점",
    preVisit,
    closing,
    disclosure ? createHumanParagraph([disclosure], tone) : ""
  ].filter(Boolean).join("\n\n"));

  return applyCategoryGuardrails(removeWritingGuideParagraphs(body), analysis);
};

const createHumanReviewBody = (form = {}, analysis = {}) => {
  if ((analysis.category || inferReviewCategory(form)) === "restaurant") {
    return createFocusedRestaurantReviewBody(form, analysis);
  }

  const intro = createHumanIntroParagraph(analysis);
  const sections = createHumanReviewSections(analysis);
  const disclosure = analysis.disclosure ? createHumanParagraph([analysis.disclosure], analysis.tone) : "";
  const rawBody = [intro, ...sections, disclosure].filter(Boolean).join("\n\n");
  const withoutGuide = removeWritingGuideParagraphs(rawBody);
  const withAvoidWords = applyAvoidWords(withoutGuide, analysis.avoidWords || []);

  return applyCategoryGuardrails(withAvoidWords, analysis);
};

const createExperienceReviewBody = (form = {}, selectedTitle = "", category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const tone = normalizeTone(form.tone);
  const memoLines = splitMemoLines(form.experienceMemo).map(softenSensitiveExpression);
  const emphasis = splitCommaList(form.emphasisPoints, 5);
  const emphasisText = emphasis.length > 0 ? emphasis.join(", ") : "직접 느낀 점";
  const targetLength = getTargetLengthSettings(form, category).target;
  const imageSuggestions = createImageSuggestions(form);
  const imageSummary = getImageContextSummary(form, category);
  const disclosure = getDisclosureSentence(form);
  const avoidWords = getAvoidWords(form);
  const memoText = getMemoText(memoLines);
  const partySize = getPartySize(memoText);
  const partyText = partySize || "여럿";
  const reviewAnalysis = createReviewAnalysis(form, category, {
    memoLines,
    memoText,
    imageSuggestions,
    imageSummary
  });

  return createHumanReviewBody(form, reviewAnalysis);

  const introParagraph = [
    createExperienceIntroSentence(form, category, memoText),
    createKeywordReinforcementSentence(form, category),
    createSearchAnswerSentence(form, category, memoText),
    disclosure,
    imageSummary
  ]
    .filter(Boolean)
    .map((sentence) => createSentence(sentence, tone))
    .join(" ");
  const intro = [
    introParagraph
  ].filter(Boolean);

  const sectionMap = {
    restaurant: [
      createMarkedSection("방문하게 된 이유", [
        hasMemoCue(memoText, /회식|직장인/u)
          ? "이번 방문은 직장인 회식 장소로 괜찮을지 보게 된 자리였어요"
          : "이번 방문은 같이 간 사람들과 편하게 머물 수 있는지 먼저 보게 된 자리였어요",
        "맛집을 고를 때는 음식 맛만큼 주문하기 편한지, 대화하기 좋은 분위기인지도 같이 보게 되더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("메뉴와 맛", [
        ...createRestaurantMenuSentences(memoText)
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("분위기와 동행", [
        partySize
          ? `${partySize}이 함께 먹는 자리라면 메뉴를 여러 개 나눠 먹을 수 있는지가 꽤 중요해요`
          : "여럿이 방문하는 자리라면 메뉴를 나눠 먹기 편한지와 대화하기 좋은 분위기인지가 중요해요",
        hasMemoCue(memoText, /회식|직장인/u)
          ? "직장인 회식 장소로 볼 때는 좌석 간격, 소음, 주문 흐름도 음식 맛만큼 신경 쓰이더라고요"
          : "동행이 있는 식사는 각자 먹고 싶은 메뉴를 고르기보다 같이 나눌 메뉴가 있는지가 만족도를 좌우해요"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("좋았던 점", [
        `${partyText}이 함께 먹기 좋은 메뉴 구성이 보였고, 기억에 남은 메뉴가 분명해서 만족스러운 장면도 더 또렷했어요`,
        "탕수육처럼 나눠 먹기 좋은 메뉴와 어향가지처럼 곁들이기 좋은 메뉴가 있으면 회식 자리에서도 선택지가 넓어져요"
      ], tone),
      createMarkedSection("가격과 주문 전 확인할 점", [
        ...createRestaurantCheckSentences(memoText),
        "처음 방문한다면 대표 메뉴를 먼저 고르고 인원수에 맞춰 곁들일 메뉴를 추가하는 방식이 부담이 적어요"
      ], tone),
      createMarkedSection("재방문 기준", [
        "다시 간다면 바삭한 메뉴가 끝까지 괜찮았는지, 여럿이 먹어도 주문 구성이 부족하지 않았는지를 다시 보게 될 것 같아요",
        "회식처럼 함께 먹는 자리에서는 맛과 분위기, 이동 편의성이 같이 맞아야 재방문하고 싶어지더라고요"
      ], tone, createImageMarker(imageSuggestions, 4)),
      createMarkedSection("이런 분께 추천해요", [
        `${mainKeyword}를 찾는 분 중에서 메뉴를 나눠 먹는 회식이나 소규모 모임을 생각하는 분께 잘 맞을 것 같아요`,
        "다만 가격과 주차처럼 바뀔 수 있는 정보는 방문 전에 꼭 한 번 더 확인해보면 좋겠어요"
      ], tone)
    ],
    product: [
      createMarkedSection("처음 써보게 된 이유", [
        hasMemoCue(memoText, /궁금|찾아|써본|사용/u)
          ? "이번 제품은 실제로 써봤을 때 사용감이 어떤지 궁금해서 눈에 들어왔어요"
          : "이번 제품은 매일 쓰는 루틴에 부담 없이 들어올지 먼저 보게 됐어요",
        "상품 후기는 좋은 말만 길게 쓰기보다 내가 실제로 느낀 질감과 불편했던 부분이 같이 있어야 읽기 편하더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("사용감과 향", [
        ...createProductUsageSentences(memoText)
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("좋았던 점", [
        hasMemoCue(memoText, /가볍|은은|끈적임은 적|아침|저녁/u)
          ? "가볍게 발리고 향이 은은한 편이라 자주 손이 가는 사용감으로 느껴졌어요"
          : `${emphasisText}이 기억에 남는다면 그 부분을 장점으로 먼저 볼 수 있어요`,
        "사진으로 질감이나 패키지 정보를 함께 보면 사용 전 느낌을 더 쉽게 떠올릴 수 있어요"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("아쉬운 점과 확인할 부분", [
        ...createProductInfoReviewSentences(form)
      ], tone),
      createMarkedSection("이런 분께 추천해요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 ${emphasisText}을 중요하게 보는 분이라면 참고하기 좋습니다`,
        "처음부터 모든 효과를 기대하기보다 내 루틴에 무리 없이 들어오는지 확인하고 싶은 분께 맞을 것 같아요"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    store: [
      createMarkedSection("방문하게 된 이유", [
        hasMemoCue(memoText, /금거래소|금\s*시세|금시세|매입/u)
          ? "처음 금거래소를 알아볼 때는 시세나 매입 과정이 어렵게 느껴져서 실제로 설명을 편하게 들을 수 있는지가 궁금했어요"
          : "처음 방문하는 매장은 분위기보다도 내가 궁금한 내용을 편하게 물어볼 수 있는지가 먼저 신경 쓰였어요",
        "매장 후기는 좋은 말만 나열하기보다 방문 전 궁금했던 점과 실제 응대가 어땠는지를 같이 봐야 더 현실적으로 읽히더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("처음 궁금했던 점", [
        hasMemoCue(memoText, /금\s*시세|금시세|시세/u)
          ? "특히 금 시세처럼 매일 달라질 수 있는 정보는 글만 보고 판단하기보다 현장에서 어떻게 안내받는지가 중요해 보였어요"
          : "방문 전에는 비용, 상담 시간, 설명 방식처럼 실제로 가봐야 알 수 있는 부분이 가장 궁금했어요",
        "처음 가는 입장에서는 너무 딱딱한 분위기보다 차분하게 설명해주는 곳인지가 은근히 큰 기준이 됩니다"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("상담과 응대", [
        ...createStoreEvidenceSentences(memoText),
        "이런 부분은 광고 문구보다 실제 방문 메모에 남은 내용이라 더 자연스럽게 신뢰가 갔어요"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("사진과 메모로 확인한 내용", [
        imageSummary || "사진과 메모를 같이 보니 매장 분위기와 상담 흐름을 글로 풀어내기가 훨씬 쉬웠어요",
        hasMemoCue(memoText, /2대째|이대째|아드님/u)
          ? "가족이 함께 운영하는 느낌이 전해져서 처음 방문하는 사람도 조금 더 편하게 상담을 시작할 수 있겠다는 생각이 들었어요"
          : "사진이 있다면 매장 입구, 상담 공간, 안내 정보를 순서대로 넣으면 처음 보는 사람도 흐름을 따라가기 좋아요"
      ], tone),
      createMarkedSection("좋았던 점", [
        hasMemoCue(memoText, /친절|차분|설명/u)
          ? "좋았던 점은 궁금한 부분을 급하게 넘기지 않고 차분하게 설명해주는 분위기였어요"
          : "좋았던 점은 처음 방문하는 사람이 무엇을 궁금해할지 기준을 잡아볼 수 있었다는 부분이에요",
        "금액이나 조건처럼 바로 단정하기 어려운 내용은 확인이 필요하다고 나눠두면 글을 읽는 사람도 더 편하게 받아들일 수 있어요"
      ], tone),
      createMarkedSection("방문 전 확인할 점", [
        ...createStoreCheckSentences(memoText)
      ], tone),
      createMarkedSection("이런 분께 추천해요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 처음 방문이 부담스럽고 상담 분위기를 먼저 알고 싶은 분께 참고가 될 것 같아요`,
        "특히 시세나 절차를 바로 결정하기보다 설명을 듣고 차분히 비교해보고 싶은 분이라면 방문 전 체크용으로 보기 좋겠습니다"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    hospital: [
      createMarkedSection("방문하게 된 이유", [
        "처음 병원을 알아볼 때는 진료 자체보다 예약이나 접수 과정이 복잡하지 않은지가 먼저 궁금했어요",
        "병원 후기는 과장된 표현보다 실제 방문 전 확인할 수 있는 흐름이 잘 보일 때 더 도움이 되더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("예약과 접수 흐름", [
        ...createCategoryMemoSentences(memoText, "예약, 접수, 대기 시간은 방문 전 한 번 더 확인해두면 마음이 훨씬 편해요"),
        "처음 방문한다면 운영시간과 예약 필요 여부를 먼저 확인하는 게 좋겠습니다"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("상담과 안내 분위기", [
        hasMemoCue(memoText, /친절|상담|설명/u)
          ? "상담이나 안내가 친절했다는 점은 병원을 고를 때 생각보다 크게 남는 부분이에요"
          : "상담 분위기는 직접 가보기 전까지 알기 어려워서 후기에서 자연스럽게 풀어주는 게 좋습니다",
        "사진이 있다면 대기 공간이나 안내문을 함께 넣어 처음 방문하는 사람이 흐름을 쉽게 볼 수 있게 하면 좋아요"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("좋았던 점", [
        "좋았던 점은 처음 방문하는 사람이 헷갈릴 수 있는 부분을 미리 나눠볼 수 있었다는 점이에요",
        "다만 진료 결과나 비용은 개인 상황에 따라 달라질 수 있어 단정하지 않고 확인 필요로 남겨두는 편이 자연스럽습니다"
      ], tone),
      createMarkedSection("방문 전 확인할 점", [
        "예약, 진료 시간, 비용, 준비물은 방문 전에 한 번 더 확인하는 것이 좋습니다",
        "증상이나 치료 결과는 개인차가 있으니 후기는 방문 흐름을 참고하는 정도로 보는 게 편해요"
      ], tone),
      createMarkedSection("이런 분께 추천해요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 처음 방문 전 분위기와 접수 흐름을 알고 싶은 분께 참고가 될 것 같아요`,
        "복잡한 설명보다 실제로 어디서 무엇을 확인하면 되는지 알고 싶은 분께 잘 맞는 후기입니다"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    service: [
      createMarkedSection("알아보게 된 이유", [
        "처음 서비스를 알아볼 때는 비용보다도 내가 원하는 내용을 제대로 이해해주는지가 먼저 궁금했어요",
        "서비스 후기는 결과만 말하기보다 상담 과정과 진행 흐름이 같이 보여야 실제 이용 전 판단하기 쉽더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("상담과 진행 흐름", [
        ...createCategoryMemoSentences(memoText, "상담 과정에서 어떤 내용을 먼저 확인했는지 정리해두면 처음 이용하는 사람도 흐름을 잡기 쉬워요"),
        "사진이 있다면 상담 자료나 진행 과정 이미지를 중간에 넣어 설명을 이어가면 좋습니다"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("실제로 좋았던 점", [
        hasMemoCue(memoText, /친절|빠르|꼼꼼|차분/u)
          ? "좋았던 점은 응대가 급하지 않고 필요한 부분을 차분히 확인해주는 느낌이었다는 점이에요"
          : "좋았던 점은 처음 이용하는 사람이 어떤 순서로 진행되는지 감을 잡을 수 있었다는 부분이에요",
        "결과만 강조하기보다 진행 중 편했던 점을 함께 쓰면 실제 후기처럼 더 자연스럽게 읽힙니다"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("아쉬운 점과 확인할 부분", [
        "비용, 일정, 추가 조건처럼 상황에 따라 달라질 수 있는 부분은 [확인 필요]로 남겨두는 게 좋아요",
        "처음 이용한다면 상담 전에 원하는 범위와 예산을 간단히 정리해두면 대화가 훨씬 편해집니다"
      ], tone),
      createMarkedSection("이용 전 확인할 점", [
        "견적, 예약 시간, 진행 기간, 추가 비용 여부는 이용 전에 한 번 더 확인해두면 좋습니다",
        "서비스 범위가 넓다면 내가 필요한 부분이 포함되는지도 꼭 나눠서 보는 편이 안전해요"
      ], tone),
      createMarkedSection("이런 분께 추천해요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 상담 과정과 진행 순서를 미리 알고 싶은 분께 참고가 될 것 같아요`,
        "처음 이용하는 서비스라 막막하다면 이런 흐름으로 확인해보면 부담을 줄일 수 있습니다"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    travel: [
      createMarkedSection("여행을 계획한 이유", [
        "여행지를 고를 때는 사진으로 본 분위기가 실제로도 괜찮은지, 이동 동선이 무리 없는지가 가장 궁금했어요",
        "여행 후기는 좋은 장면만 모으는 것보다 이동하면서 느낀 편한 점과 아쉬운 점이 같이 있을 때 더 도움이 되더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("동선과 첫인상", [
        ...createCategoryMemoSentences(memoText, "도착했을 때의 첫인상과 이동 동선을 함께 정리하면 여행 계획을 세우는 사람에게 도움이 됩니다"),
        "사진이 있다면 도착 장면, 이동 동선, 기억에 남은 장소를 순서대로 넣으면 글이 코스처럼 읽혀요"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("기억에 남은 장면", [
        hasMemoCue(memoText, /좋|예쁘|편|여유|산책/u)
          ? "메모에 남은 좋았던 장면을 중심으로 풀어내면 실제 다녀온 느낌이 훨씬 살아나요"
          : "여행은 작은 장면이 오래 남는 경우가 많아서, 사진 속 분위기를 내 감정과 함께 적으면 자연스럽습니다",
        "너무 완벽한 코스처럼 쓰기보다 실제로 편했던 순간과 다시 생각나는 장소를 중심으로 쓰면 읽기 좋아요"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("아쉬웠던 점", [
        "이동 시간, 대기, 비용처럼 현장에서 달라질 수 있는 부분은 미리 확인해두면 좋아요",
        "아쉬운 점도 솔직하게 적어두면 글이 광고처럼 보이지 않고 실제 후기처럼 느껴집니다"
      ], tone),
      createMarkedSection("다시 간다면 확인할 점", [
        "다시 간다면 이동 시간, 예약 필요 여부, 날씨와 운영시간을 먼저 확인할 것 같아요",
        "사진으로 봤을 때 좋은 장소라도 시간대에 따라 분위기가 달라질 수 있으니 일정에 맞춰 보는 게 좋겠습니다"
      ], tone),
      createMarkedSection("이런 여행자에게 추천해요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 동선과 분위기를 먼저 보고 싶은 분께 참고가 될 것 같아요`,
        "여유 있게 움직이고 싶은 분이라면 코스를 너무 촘촘하게 잡기보다 기억에 남을 장면을 중심으로 계획해보면 좋겠습니다"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    experience: [
      createMarkedSection("체험하게 된 이유", [
        "처음 체험을 알아볼 때는 재미있어 보이는지보다 내가 따라가기 어렵지 않은지가 먼저 궁금했어요",
        "체험 후기는 결과만 보여주기보다 어떤 순서로 진행됐고 실제로 어떤 순간이 좋았는지가 있어야 더 자연스럽게 읽히더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("처음 궁금했던 점", [
        "처음 가기 전에는 준비물이 필요한지, 설명을 듣고 바로 따라 할 수 있는지, 시간이 얼마나 걸리는지가 궁금했어요",
        "이런 정보는 직접 경험한 메모와 사진을 같이 넣으면 처음 보는 사람도 부담 없이 이해할 수 있습니다"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("체험 흐름과 분위기", [
        ...createCategoryMemoSentences(memoText, "체험 과정은 순서대로 정리해두면 처음 방문하는 사람도 쉽게 따라올 수 있어요"),
        "사진이 있다면 시작 장면, 진행 과정, 결과물을 나눠 넣는 편이 글 흐름이 가장 자연스럽습니다"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("좋았던 점", [
        hasMemoCue(memoText, /좋|재밌|친절|쉬웠|편/u)
          ? "좋았던 점은 체험 과정에서 부담이 덜했고, 기억에 남는 장면이 분명했다는 부분이에요"
          : "좋았던 점은 처음 하는 사람도 전체 흐름을 예상할 수 있었다는 부분이에요",
        "완성도만 강조하기보다 실제로 해보면서 편했던 점을 같이 적으면 더 사람 냄새 나는 후기가 됩니다"
      ], tone),
      createMarkedSection("준비물과 확인할 점", [
        "준비물, 비용, 예약, 운영시간은 체험 전에 한 번 더 확인해두면 좋습니다",
        "체험 난이도나 소요 시간은 개인차가 있을 수 있어 내 일정과 같이 맞춰보는 편이 좋아요"
      ], tone),
      createMarkedSection("이런 분께 추천해요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 처음 해봐도 괜찮을지 궁금한 분께 참고가 될 것 같아요`,
        "새로운 체험을 해보고 싶지만 막상 시작이 부담스러운 분이라면 먼저 전체 흐름을 확인해보면 좋겠습니다"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    "kids-place": [
      createMarkedSection("방문하게 된 이유", [
        "이번 공간은 아이가 실내에서 지루해하지 않고 체험할 수 있을지 궁금해서 보게 된 곳이에요",
        "아이와 가는 장소는 체험 내용뿐 아니라 보호자가 기다리는 동안 편한지도 같이 보게 되더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("아이 반응", [
        hasMemoCue(memoText, /아이|좋아|체험/u)
          ? "아이가 체험을 좋아했다는 점이 가장 먼저 기억에 남았어요"
          : "아이 동반 장소는 시설보다 아이가 실제로 흥미를 보였는지가 가장 크게 남아요",
        "아이 동반 장소는 시설보다 아이가 실제로 흥미를 보였는지가 가장 크게 남더라고요"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("동선과 체험 흐름", [
        "입장 후 어떤 순서로 움직이면 편한지, 체험 공간 사이 이동이 복잡하지 않은지도 같이 보면 좋아요",
        "공간이 넓거나 체험 구역이 나뉘어 있다면 처음부터 욕심내기보다 아이 컨디션에 맞춰 움직이는 편이 편합니다"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("부모 대기와 피로도", [
        hasMemoCue(memoText, /부모|대기|편/u)
          ? "부모 입장에서 편했던 점은 아이가 체험하는 동안 기다릴 공간이 괜찮았다는 부분이에요"
          : "부모 대기 공간이 편하면 아이가 체험하는 동안 보호자도 조금 덜 지쳐요",
        "앉을 곳, 짐을 둘 곳, 잠깐 쉬는 공간이 있는지는 실제 만족도에 꽤 영향을 줍니다"
      ], tone),
      createMarkedSection("주차와 다시 갈 기준", [
        hasMemoCue(memoText, /주차/u)
          ? "주차는 확인이 필요해요. 방문 전 주차 가능 여부와 입차 동선을 한 번 더 보는 게 좋겠어요"
          : "주차와 화장실 위치는 아이와 함께 가기 전에 한 번 더 확인해두면 좋아요",
        "다시 간다면 아이가 좋아했던 체험이 반복해도 괜찮은지, 부모가 기다리기 편한지를 같이 보게 될 것 같아요"
      ], tone, createImageMarker(imageSuggestions, 4)),
      createMarkedSection("이런 가족에게 추천해요", [
        "실내에서 아이가 체험할 거리가 필요하고, 보호자도 편하게 기다릴 공간을 중요하게 보는 가족에게 잘 맞을 것 같아요",
        "처음 방문한다면 운영시간, 주차, 예약 필요 여부를 미리 확인하고 가면 더 편하게 다녀올 수 있어요"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    place: [
      createMarkedSection("방문 전 기대한 점", [
        "이번 장소는 실제로 가면 동선이 편한지, 머무는 동안 볼거리가 충분한지 궁금했어요",
        `처음 가는 분이라면 ${emphasisText}이 실제 만족도와 잘 맞는지도 같이 보게 될 것 같아요`
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("공간과 동선", [
        "공간은 어디부터 둘러보면 좋은지, 이동이 복잡하지 않은지부터 보게 되더라고요",
        "처음 방문하는 곳은 사진으로 동선이 잡히면 글을 읽는 사람도 훨씬 편하게 따라올 수 있습니다"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("기억에 남은 체험", [
        hasMemoCue(memoText, /체험|좋|기억|재밌/u)
          ? "기억에 남은 장면이 있다면 그 순간을 중심으로 분위기가 더 선명하게 살아나요"
          : "장소 후기는 실제로 머문 시간과 다시 떠오르는 장면이 있을 때 더 잘 읽혀요",
        "사진이 있다면 대표 공간과 세부 시설을 나눠 넣으면 방문 전 분위기를 더 쉽게 볼 수 있어요"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("주차와 편의성", [
        hasMemoCue(memoText, /주차/u) ? "주차는 확인이 필요해요" : "주차나 편의시설은 방문 전 확인하면 좋은 부분이에요",
        "사진으로 안내판이나 시설 정보가 남아 있다면 이 부분에 같이 넣으면 독자가 바로 참고하기 좋습니다"
      ], tone),
      createMarkedSection("다시 방문할 기준", [
        "다시 방문한다면 이동 동선, 머무는 시간, 같이 간 사람의 만족도를 다시 보게 될 것 같아요",
        "전체적으로 처음 가기 전 분위기를 알고 싶은 분께 참고가 되는 후기입니다"
      ], tone, createImageMarker(imageSuggestions, 4))
    ],
    education: [
      createMarkedSection("관심 갖게 된 이유", [
        /세관공매/u.test(mainKeyword)
          ? "처음에는 세관공매라는 단어 자체가 어렵게 느껴졌는데, 무료공개강의라면 전체 흐름을 먼저 들어볼 수 있겠다는 점이 눈에 들어왔어요"
          : "처음에는 강의 소개만 보고 바로 판단하기보다 실제 수업 흐름이 어떤지가 더 궁금했어요",
        "수업 후기를 볼 때는 광고 문구보다 초보자가 따라갈 수 있는지, 어떤 내용을 배우는지가 먼저 보이더라고요"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("처음 궁금했던 점", [
        "막상 신청하기 전에는 난이도가 너무 높지 않은지, 용어를 모르는 상태에서도 따라갈 수 있는지가 가장 궁금했어요",
        "특히 처음 듣는 분이라면 수업 시간, 준비물, 질문하기 편한 분위기까지 함께 확인해두면 마음이 훨씬 편합니다"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("사진과 메모로 확인한 내용", [
        ...createEducationDetailSentences(memoText)
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("좋았던 점", [
        "좋았던 점은 처음부터 결과를 강하게 약속하기보다, 어떤 순서로 이해하면 되는지 흐름을 먼저 잡아준다는 부분이었어요",
        "수업 전에 어떤 내용을 배우는지 미리 확인할 수 있다는 점도 처음 듣는 사람에게는 꽤 큰 도움이 됩니다"
      ], tone),
      createMarkedSection("초보자에게 도움이 된 부분", [
        /세관공매/u.test(mainKeyword)
          ? "세관공매를 처음 접하는 입장에서는 입찰, 공고, 낙찰, 반출, 판로가 따로 떨어진 단어처럼 느껴질 수 있는데 흐름으로 묶어보니 부담이 줄었어요"
          : "초보자 입장에서는 용어를 먼저 외우기보다 전체 흐름을 보고 내 상황에 맞는지 판단할 수 있다는 점이 편했어요",
        "막연히 어렵다고 느끼던 내용을 단계별로 나눠 보면, 내가 더 알아봐야 할 부분도 자연스럽게 보이기 시작합니다"
      ], tone),
      createMarkedSection("수강 전 확인할 점", [
        "수강 전에는 시간, 준비물, 비용, 환불 기준을 한 번 더 확인하는 것이 좋습니다",
        "특히 목적에 따라 필요한 난이도가 다를 수 있어 내 상황과 맞는지 보는 과정이 필요합니다"
      ], tone),
      createMarkedSection("이런 분께 추천해요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 ${emphasisText}을 중요하게 보는 분께 참고가 될 수 있습니다`,
        /세관공매/u.test(mainKeyword)
          ? "세관공매 무료공개강의를 찾는 분들이라면 먼저 전체 흐름을 들어보고 판단해보는 것도 좋겠다는 생각이 들었어요"
          : "처음부터 완벽한 결과보다 수업 흐름을 경험해보고 싶은 분께 잘 맞을 것 같습니다"
      ], tone, createImageMarker(imageSuggestions, 4))
    ]
  };

  const sections = sectionMap[category] || sectionMap.place;

  if (targetLength >= 1800) {
    sections.splice(
      Math.max(1, sections.length - 1),
      0,
      createMarkedSection("방문 전 한 번 더 보면 좋은 점", [
        "사진과 메모만으로도 초안은 만들 수 있지만, 발행 전에는 가격, 운영시간, 주소처럼 바뀔 수 있는 정보는 한 번 더 확인하는 편이 좋습니다",
        "독자가 바로 따라 해볼 수 있도록 내 경험과 확인이 필요한 정보를 나눠 적으면 글이 더 편하게 읽힙니다"
      ], tone)
    );
  }

  return removeWritingGuideParagraphs(applyAvoidWords(normalizeBody([...intro, ...sections].join("\n\n")), avoidWords));
};

const createBody = (form = {}, selectedTitle = "") => {
  const reviewCategory = inferReviewCategory(form);
  return createExperienceReviewBody(form, selectedTitle, reviewCategory);
};

const isSelectedTitleUsableForCurrentDraft = (candidateTitle = "", form = {}, category = inferReviewCategory(form)) => {
  const title = text(candidateTitle);
  if (!title) return false;

  const mainKeyword = getMainKeyword(form);
  if (mainKeyword && !title.includes(mainKeyword)) return false;

  const memoText = getFormMemoText(form);
  const productSubtype = detectProductSubtype(form, memoText);
  const sourceText = `${mainKeyword}\n${text(form.productName)}\n${memoText}`;
  const forbiddenPatterns = getCategoryForbiddenExpressions(category, productSubtype, sourceText);
  if (forbiddenPatterns.some((pattern) => regexTest(pattern, title))) return false;

  if (category === "product") {
    return !getCategoryForbiddenExpressions(category, productSubtype, sourceText).some((pattern) => regexTest(pattern, title));
  }

  return true;
};

export function createProductReviewDraft(form = {}) {
  const category = inferReviewCategory(form);
  const titles = createTitleCandidates(form);
  const requestedTitle = text(form.selectedTitle);
  const selectedTitle = isSelectedTitleUsableForCurrentDraft(requestedTitle, form, category)
    ? requestedTitle
    : titles[0] || "";
  const generationId = text(form.generationId) || `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const hashtags = createHashtags(form);
  const imageSuggestions = createImageSuggestions(form);
  const outline = createReviewOutline(form, category);
  const thumbnailTexts = createThumbnailTexts(form, category);
  const searchKeywords = createSearchKeywordSummary(form, category);
  const photoGuide = createPhotoGuideItems(imageSuggestions, form);
  const infoSummary = createGenericInfoSummary(form, category);
  const recommendedFor = createRecommendedForItems(form, category);
  const faqItems = createFaqItems(form, category);
  const baseBody = createBody(form, selectedTitle);
  let bodyWithoutChecklist = createPublishableReviewBody({
    baseBody,
    form,
    category,
    photoGuide,
    infoSummary,
    recommendedFor,
    faqItems
  });
  let finalChecklist = createChecklistItems({
    form,
    category,
    selectedTitle,
    body: bodyWithoutChecklist,
    hashtags,
    photoGuide,
    infoSummary
  });
  let body = normalizeBody(bodyWithoutChecklist);
  let quality = assessBlogWriterQuality({
    form,
    category,
    selectedTitle,
    titleCandidates: titles,
    body,
    hashtags,
    photoGuide,
    faqItems
  });

  if (quality.score < 90) {
    const targetSettings = getTargetLengthSettings(form, category);
    bodyWithoutChecklist = trimBodyToMaxLength(
      polishPublishableBlogBody(
        ensureRestaurantKeywordDensity(
          normalizeBody([body, ...createNaturalReviewFinishingSections(form, category)].join("\n\n")),
          form,
          category,
          targetSettings
        )
      ),
      targetSettings
    );
    finalChecklist = createChecklistItems({
      form,
      category,
      selectedTitle,
      body: bodyWithoutChecklist,
      hashtags,
      photoGuide,
      infoSummary
    });
    body = normalizeBody(bodyWithoutChecklist);
    quality = assessBlogWriterQuality({
      form,
      category,
      selectedTitle,
      titleCandidates: titles,
      body,
      hashtags,
      photoGuide,
      faqItems
    });
  }

  if (category === "information" && getBodyLength(body) < 1000) {
    const cleanedInformationBody = normalizeBody(
      body.replace(/\n\n리스크와 확인 순서\n\n마지막으로 정리하면(?=\n\n|$)/u, "")
    );
    bodyWithoutChecklist = normalizeBody([cleanedInformationBody, createInformationMinimumTopUpSection(form)].join("\n\n"));
    finalChecklist = createChecklistItems({
      form,
      category,
      selectedTitle,
      body: bodyWithoutChecklist,
      hashtags,
      photoGuide,
      infoSummary
    });
    body = normalizeBody(bodyWithoutChecklist);
    quality = assessBlogWriterQuality({
      form,
      category,
      selectedTitle,
      titleCandidates: titles,
      body,
      hashtags,
      photoGuide,
      faqItems
    });
  }

  const closingParagraph = extractClosingParagraph(baseBody);
  const contentPackage = createProductReviewContentPackage({
    form,
    category,
    titles,
    selectedTitle,
    body,
    imageSuggestions,
    hashtags,
    searchKeywords,
    photoGuide,
    infoSummary,
    recommendedFor,
    faqItems,
    finalChecklist,
    qualityScore: quality.score,
    qualityIssues: quality.issues,
    qualityChecks: quality.checks,
    blogWriterQuality: quality.blogWriterQuality,
    generationId
  });
  const titleCandidates = contentPackage.titleCandidates || titles.slice(0, 5);
  const finalTitle = contentPackage.finalRecommendedTitle || selectedTitle || titleCandidates[0] || "";

  return {
    generationId,
    category,
    engine: "fallback",
    titles: titleCandidates,
    titleCandidates,
    finalTitle,
    selectedTitle: finalTitle,
    mainKeyword: contentPackage.mainKeyword,
    body,
    hashtags,
    imageSuggestions,
    outline,
    thumbnailTexts,
    searchKeywords,
    closingParagraph,
    contentPackage,
    qualityScore: quality.score,
    qualityIssues: quality.issues,
    qualityChecks: quality.checks,
    blogWriterQuality: quality.blogWriterQuality,
    bodyLength: body.replace(/\s+/g, "").length,
    summary: {
      engine: "fallback",
      bodyLength: body.replace(/\s+/g, "").length,
      targetCharCount: contentPackage.targetLengthRange?.target || null,
      requestedTargetCharCount: contentPackage.requestedTargetCharCount || null,
      informationLimited: Boolean(contentPackage.informationLimited)
    }
  };
}
