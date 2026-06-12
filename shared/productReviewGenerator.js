import {
  createToneTitleSuffix,
  ensureSentence,
  getToneProfile,
  normalizeTone,
  softenForTone
} from "./toneEngine.js";

const DEFAULT_TARGET_LENGTH = 1500;

const text = (value) => String(value ?? "").trim();

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const toHashTag = (value) => {
  const tag = compact(value);
  return tag ? `#${tag}` : "";
};

const stripReviewSuffix = (value = "") =>
  text(value).replace(/\s*후기$/u, "").trim();

const getReviewTitleBase = (value = "") => {
  const withoutSuffix = stripReviewSuffix(value);
  const cleaned = withoutSuffix
    .replace(/\s*직접\s*써본$/u, "")
    .replace(/\s*사용해본$/u, "")
    .trim();

  return cleaned || withoutSuffix || text(value);
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
    .split(/[\n,]/u)
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

const normalizeTargetLength = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TARGET_LENGTH;
  return Math.min(Math.max(parsed, 600), 5000);
};

const getKeywordParts = (form = {}) =>
  uniqueText(splitCommaList(form.mainKeyword || form.keyword, 5));

const getMainKeyword = (form = {}) =>
  getKeywordParts(form)[0] || text(form.productName) || "상품 후기";

const getProductName = (form = {}) =>
  text(form.productName) || getMainKeyword(form);

const getRelatedKeywords = (form = {}) =>
  uniqueText([
    ...getKeywordParts(form).slice(1),
    ...splitCommaList(form.emphasisPoints, 5)
  ]).slice(0, 5);

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
  text(value)
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

const reviewCategoryValues = new Set(["restaurant", "product", "kids-place", "place", "education"]);

const getImageContextItems = (form = {}) =>
  Array.isArray(form.imageContext)
    ? form.imageContext
        .map((item, index) => ({
          index: Number(item.index) || index + 1,
          name: text(item.name),
          note: text(item.note),
          ocrText: text(item.ocrText)
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

const getImageContextSummary = (form = {}) => {
  const highlights = getImageContextItems(form)
    .flatMap((item) => [
      item.note,
      item.ocrText,
      item.name.replace(/\.(png|jpe?g|webp)$/iu, "").replace(/[_-]+/gu, " ")
    ])
    .map((item) => text(item))
    .filter(Boolean)
    .slice(0, 4);

  return highlights.length > 0
    ? `사진과 이미지별 메모에서는 ${highlights.join(", ")} 부분을 확인할 수 있었습니다.`
    : "";
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
    ...getImageContextItems(form).flatMap((item) => [item.name, item.note, item.ocrText])
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");

const inferReviewCategory = (form = {}) => {
  const explicit = text(form.category);
  if (reviewCategoryValues.has(explicit)) return explicit;

  const signalText = getReviewSignalText(form);

  if (/아이|키즈|부모|체험공간|실내|놀이|육아|동반/u.test(signalText)) return "kids-place";
  if (/맛집|식당|중식|한식|양식|일식|카페|회식|메뉴|탕수육|어향가지|디저트|커피|재방문/u.test(signalText)) {
    return "restaurant";
  }
  if (/학원|강의|수업|교육|클래스|강사|커리큘럼/u.test(signalText)) return "education";
  if (/수분크림|크림|로션|세럼|제품|상품|사용감|발림감|향|끈적|보습|성분|용량|패키지/u.test(signalText)) {
    return "product";
  }
  if (/장소|체험|전시|여행|숙소|방문|주차|동선|공간/u.test(signalText)) return "place";

  return text(form.productName) ? "product" : "place";
};

const getReviewProfile = (category) => {
  const profiles = {
    restaurant: {
      label: "맛집/카페 후기",
      hashtagSeeds: ["맛집후기", "방문후기", "메뉴추천", "회식장소", "재방문기준"],
      imageSlots: [
        ["외관 또는 입구 사진", "방문 전 위치와 첫인상을 보여주는 사진"],
        ["메뉴판 또는 주문 메뉴", "가격대와 주문 구성을 설명하기 좋은 사진"],
        ["대표 메뉴 클로즈업", "맛과 양을 자연스럽게 설명할 수 있는 사진"],
        ["내부 분위기", "동행, 좌석, 회식 분위기를 보여주는 사진"],
        ["마무리 컷", "재방문 기준을 정리할 때 넣기 좋은 사진"]
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

const createExperienceTitleCandidates = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const reviewKeyword = withReviewTitleSuffix(mainKeyword);
  const baseKeyword = getReviewTitleBase(mainKeyword);
  const profile = getReviewProfile(category);

  const titleMap = {
    restaurant: [
      reviewKeyword,
      `${baseKeyword} 회식 장소로 본 솔직 후기`,
      `${baseKeyword} 메뉴와 분위기`,
      `${baseKeyword} 가격과 주차 확인 포인트`,
      `${baseKeyword} 재방문 기준`
    ],
    product: [
      reviewKeyword,
      `${baseKeyword} 사용감 중심 후기`,
      `${baseKeyword} 장점과 아쉬운 점`,
      `${baseKeyword} 추천 대상까지 본 후기`,
      `${baseKeyword} 구매 전 확인할 사용 포인트`
    ],
    "kids-place": [
      reviewKeyword,
      `${baseKeyword} 아이 반응 중심 방문 후기`,
      `${baseKeyword} 동선과 부모 대기 공간`,
      `${baseKeyword} 주차까지 확인할 포인트`,
      `${baseKeyword} 아이랑 가기 전 체크할 점`
    ],
    place: [
      reviewKeyword,
      `${baseKeyword} 동선과 분위기`,
      `${baseKeyword} 방문 전 확인할 포인트`,
      `${baseKeyword} 주차와 편의성`,
      `${baseKeyword} 다시 가도 좋을지 본 후기`
    ],
    education: [
      reviewKeyword,
      `${baseKeyword} 수업 흐름과 느낀 점`,
      `${baseKeyword} 커리큘럼 중심 후기`,
      `${baseKeyword} 준비물과 결과물`,
      `${baseKeyword} 수강 전 확인할 포인트`
    ]
  };

  return uniqueText(titleMap[category] || [
    reviewKeyword,
    `${baseKeyword} ${profile.label}`,
    `${baseKeyword} 방문 전 확인할 포인트`
  ]).slice(0, 5);
};

const createExperienceHashtags = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const related = getRelatedKeywords(form);
  const profile = getReviewProfile(category);

  return uniqueText([
    mainKeyword,
    withReviewHashSuffix(mainKeyword),
    ...related,
    ...related.map((item) => `${item}후기`),
    ...profile.hashtagSeeds
  ])
    .map(toHashTag)
    .filter(Boolean)
    .slice(0, 14);
};

const createExperienceImageSuggestions = (form = {}, category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const profile = getReviewProfile(category);
  const slotCount = Math.max(getImageCount(form), 3);

  return Array.from({ length: Math.min(slotCount, 10) }, (_, index) => {
    const [title, description] = profile.imageSlots[index] || [
      `추가 사진 ${index + 1}`,
      "본문 흐름에 맞춰 중간에 넣기 좋은 추가 사진"
    ];

    return {
      id: `review-image-${index + 1}`,
      label: `사진 ${index + 1}`,
      title,
      markerGuide: title,
      description,
      directShotGuide: description,
      aiPrompt: `${mainKeyword} realistic blog review photo, natural light, no text overlay, no watermark`,
      searchKeyword: `${mainKeyword} ${title}`
    };
  }).map((item, index) => ({
    ...item,
    marker: `[여기에 이미지 ${index + 1}을 넣어주세요: ${item.markerGuide}]`
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

const createImageMarker = (suggestions, index) => suggestions[index]?.marker || "";

const getToneNudge = (tone) =>
  getToneProfile(tone).nudge;

const countOccurrences = (value = "", needle = "") => {
  if (!needle) return 0;

  return String(value).split(needle).length - 1;
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

const getDisclosureSentence = (form = {}) => {
  const sponsorship = text(form.sponsorshipType);
  if (!sponsorship) return "";
  if (sponsorship === "직접 구매") {
    return "직접 경험한 내용을 바탕으로 썼고, 느낀 점은 개인차가 있을 수 있습니다";
  }
  return `이 글은 ${sponsorship}을 바탕으로 작성했지만, 실제로 확인한 내용과 느낀 점을 함께 담았습니다`;
};

const WRITING_GUIDE_PATTERN =
  /후기\s*흐름으로\s*정리해보려고|정리해보려고|기준으로\s*풀어두면\s*자연스럽|기준으로\s*풀어두면|중심으로\s*정리(?:했|하)|아래\s*내용은\s*정리했습니다|아래\s*내용은|글에\s*담아보겠습니다|이런\s*흐름으로\s*작성|과하게\s*단정하기보다|기준으로\s*볼\s*것\s*같아요|먼저\s*보려고\s*했/u;

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

const getMemoText = (memoLines = []) => memoLines.map(text).filter(Boolean).join(" ");

const hasMemoCue = (memoText = "", pattern) => pattern.test(memoText);

const getPartySize = (memoText = "") => {
  const match = memoText.match(/(\d+)\s*명/u);
  return match ? `${match[1]}명` : "";
};

const getRestaurantMenus = (memoText = "") =>
  ["탕수육", "어향가지", "짜장면", "짬뽕", "볶음밥", "딤섬", "커피", "디저트"].filter((menu) =>
    memoText.includes(menu)
  );

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

  if (category === "kids-place") {
    return `${reviewObject} 찾는 분이라면, 아이 반응과 부모가 기다리기 편한 공간인지가 먼저 궁금해지더라고요`;
  }

  if (category === "education") {
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

  if (category === "product") {
    return `${baseKeyword} 제품을 고를 때는 사용감, 향, 아침저녁 사용 부담, 끈적임처럼 매일 쓰는 순간에 느껴지는 기준을 함께 보는 게 좋아요`;
  }

  if (category === "kids-place") {
    return `${baseKeyword}을 고를 때는 아이가 흥미를 보이는지, 부모 대기 공간이 편한지, 주차와 화장실 정보를 미리 확인할 수 있는지가 중요해요`;
  }

  if (category === "education") {
    return `${baseKeyword}를 알아볼 때는 수업 난이도, 배울 수 있는 내용, 준비물과 비용처럼 수강 전에 궁금한 부분을 먼저 확인하면 좋아요`;
  }

  return `${baseKeyword}를 방문하기 전에는 동선, 머무는 시간, 주차와 운영 정보를 함께 확인하면 실제로 움직일 때 훨씬 편해요`;
};

const createKeywordReinforcementSentence = (form = {}, category = "place") => {
  const mainKeyword = getMainKeyword(form);

  if (category === "restaurant") {
    return `${mainKeyword}에서는 메뉴 구성과 동행 인원, 방문 전 확인할 정보를 함께 보면 실제로 가기 전에 도움이 돼요`;
  }

  if (category === "product") {
    return `${mainKeyword}는 장점뿐 아니라 아쉬운 점과 추천 대상까지 같이 보면 선택할 때 더 현실적으로 판단할 수 있어요`;
  }

  if (category === "kids-place") {
    return `${mainKeyword}는 아이 반응과 보호자 편의성을 같이 봐야 다녀오기 전 그림이 잡혀요`;
  }

  if (category === "education") {
    return `${mainKeyword}는 수업 흐름과 준비물, 수강 전 확인할 점을 함께 봐야 내 상황에 맞는지 판단하기 좋아요`;
  }

  return `${mainKeyword}는 실제 동선과 좋았던 점, 아쉬운 점을 같이 봐야 방문 전 분위기를 더 쉽게 떠올릴 수 있어요`;
};

const createReviewOutline = (form = {}, category = inferReviewCategory(form)) => {
  const targetLength = normalizeTargetLength(form.targetLength);
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
      "수강 전 궁금했던 점",
      "수업 흐름과 분위기",
      "실습과 결과물",
      "수강 전 확인할 점",
      "이런 분께 맞을 것 같아요"
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
    product: ["사용감", "장점", "아쉬운 점", "추천 대상"],
    "kids-place": ["아이랑 갈만한 곳", "실내 체험", "부모 대기 공간", "주차 확인"],
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
    sentences.push("가격, 주차, 예약처럼 바뀔 수 있는 정보는 방문 전에 한 번 더 확인해두면 좋아요");
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

const createExperienceReviewBody = (form = {}, selectedTitle = "", category = inferReviewCategory(form)) => {
  const mainKeyword = getMainKeyword(form);
  const tone = normalizeTone(form.tone);
  const memoLines = splitMemoLines(form.experienceMemo).map(softenSensitiveExpression);
  const emphasis = splitCommaList(form.emphasisPoints, 5);
  const emphasisText = emphasis.length > 0 ? emphasis.join(", ") : "직접 느낀 점";
  const targetLength = normalizeTargetLength(form.targetLength);
  const imageSuggestions = createImageSuggestions(form);
  const imageSummary = getImageContextSummary(form);
  const disclosure = getDisclosureSentence(form);
  const avoidWords = getAvoidWords(form);
  const memoText = getMemoText(memoLines);
  const partySize = getPartySize(memoText);
  const partyText = partySize || "여럿";
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
    introParagraph,
    createImageMarker(imageSuggestions, 0)
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
      createMarkedSection("수강 전 궁금했던 점", [
        "이번 강의는 커리큘럼만 보고 바로 판단하기보다 실제 수업 흐름이 궁금했어요",
        "사진이나 메모가 있으면 교재, 준비물, 공간 분위기를 함께 보여줄 수 있어 글이 더 구체적으로 느껴집니다"
      ], tone, createImageMarker(imageSuggestions, 1)),
      createMarkedSection("수업 흐름과 분위기", [
        "수업은 설명 방식과 따라가기 쉬운지가 가장 먼저 체감돼요",
        "처음 듣는 분이라면 난이도와 질문하기 편한 분위기도 함께 보면 좋습니다"
      ], tone, createImageMarker(imageSuggestions, 2)),
      createMarkedSection("실습과 결과물", [
        hasMemoCue(memoText, /실습|결과|과제|완성/u)
          ? "실습이나 결과물이 남는 수업이라면 사진으로 보여줄 때 후기가 더 선명해져요"
          : "배운 내용이 실제로 남는지, 혼자 다시 해볼 수 있는지가 수강 후 만족도에 영향을 줘요",
        "수업 후 무엇을 할 수 있게 됐는지와 아직 어려운 부분을 같이 적으면 더 현실적인 후기가 됩니다"
      ], tone, createImageMarker(imageSuggestions, 3)),
      createMarkedSection("수강 전 확인할 점", [
        "수강 전에는 시간, 준비물, 비용, 환불 기준을 한 번 더 확인하는 것이 좋습니다",
        "특히 목적에 따라 필요한 난이도가 다를 수 있어 내 상황과 맞는지 보는 과정이 필요합니다"
      ], tone),
      createMarkedSection("이런 분께 맞을 것 같아요", [
        `${getReviewObjectText(mainKeyword)} 찾는 분 중에서 ${emphasisText}을 중요하게 보는 분께 참고가 될 수 있습니다`,
        "처음부터 완벽한 결과보다 수업 흐름을 경험해보고 싶은 분께 잘 맞을 것 같습니다"
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

export function createProductReviewDraft(form = {}) {
  const category = inferReviewCategory(form);
  const titles = createTitleCandidates(form);
  const selectedTitle = text(form.selectedTitle) || titles[0] || "";
  const body = createBody(form, selectedTitle);
  const hashtags = createHashtags(form);
  const imageSuggestions = createImageSuggestions(form);
  const outline = createReviewOutline(form, category);
  const thumbnailTexts = createThumbnailTexts(form, category);
  const searchKeywords = createSearchKeywordSummary(form, category);
  const closingParagraph = extractClosingParagraph(body);

  return {
    titles,
    selectedTitle,
    body,
    hashtags,
    imageSuggestions,
    outline,
    thumbnailTexts,
    searchKeywords,
    closingParagraph
  };
}
