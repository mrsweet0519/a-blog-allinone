import { analyzeBlogWritingInput } from "./blogWriterCategory.js";
import {
  ANEUNYEOJA_WRITER_PROFILE_ID,
  ANEUNYEOJA_WRITER_PROFILE_VERSION
} from "./writerProfiles/aneunyeoja.js";

const text = (value) => String(value ?? "").trim();

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase();

const splitList = (value = "", limit = 10) => {
  const source = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return source
    .split(/[,\n/|]+/u)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, limit);
};

const uniqueTexts = (values = []) => {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const cleaned = text(value).replace(/\s+/g, " ");
    const key = compact(cleaned);
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result;
};

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createTermPattern = (term = "") => {
  const escaped = escapeRegExp(term).replace(/\s+/gu, "\\s*");
  if (Array.from(term).length === 1) {
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}]|[이가은는을를와과도만에처럼])`, "u");
  }
  return new RegExp(escaped, "u");
};

const contaminationPolicy = ({ allow = [], forbid = [] } = {}) => ({
  allow,
  forbid: forbid.map((term) => ({
    term,
    pattern: createTermPattern(term)
  }))
});

export const CATEGORY_CONTAMINATION_MATRIX = {
  underwear: contaminationPolicy({
    allow: ["착용감", "무게감", "압박감", "봉제선", "밴드", "어깨끈", "사이즈", "데일리 착용", "세탁"],
    forbid: ["향", "피부 타입", "제형", "발림감", "흡수력", "용량", "운영시간", "예약", "주차", "방문 전", "상담 과정", "구매처 확인"]
  }),
  fashion: contaminationPolicy({
    allow: ["착용감", "무게감", "수납", "사이즈", "소재", "코디", "데일리 착용"],
    forbid: ["향", "피부 타입", "제형", "발림감", "흡수력", "용량", "운영시간", "예약", "주차", "방문 전", "상담 과정"]
  }),
  beauty: contaminationPolicy({
    allow: ["제형", "발림감", "마무리감", "사용 순서", "패키지", "향", "보습"],
    forbid: ["착용감", "압박감", "봉제선", "밴드", "어깨끈", "객실", "숙박", "주차", "운영시간", "예약", "방문 전"]
  }),
  product: contaminationPolicy({
    allow: ["사용감", "휴대", "구성", "세척", "수납", "가격", "용량"],
    forbid: ["운영시간", "예약", "주차", "방문 전", "상담 과정", "수강 흐름", "객실", "숙박"]
  }),
  restaurant: contaminationPolicy({
    allow: ["메뉴", "맛", "양", "응대", "웨이팅", "주차", "방문"],
    forbid: ["발림감", "착용감", "제형", "피부 타입", "용량", "수강 흐름", "객실", "숙박"]
  }),
  cafe: contaminationPolicy({
    allow: ["커피", "디저트", "공간", "메뉴", "방문"],
    forbid: ["발림감", "착용감", "제형", "피부 타입", "수강 흐름", "객실", "숙박"]
  }),
  accommodation: contaminationPolicy({
    allow: ["객실", "체크인", "숙박", "시설", "위치", "주차", "소음"],
    forbid: ["피부 타입", "향", "착용감", "발림감", "제형", "수강 흐름"]
  }),
  education: contaminationPolicy({
    allow: ["수강", "강의", "커리큘럼", "난이도", "준비"],
    forbid: ["발림감", "착용감", "객실", "숙박", "메뉴 맛"]
  }),
  store: contaminationPolicy({
    allow: ["매장", "상담", "위치", "구매", "진열"],
    forbid: ["발림감", "착용감", "객실", "숙박", "수강 흐름"]
  }),
  service: contaminationPolicy({
    allow: ["상담", "일정", "설치", "진행", "비용"],
    forbid: ["발림감", "착용감", "객실", "숙박", "메뉴 맛"]
  })
};

export const evaluateCategoryContamination = ({ category = "", values = [] } = {}) => {
  const policy = CATEGORY_CONTAMINATION_MATRIX[category] || contaminationPolicy();
  const source = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(text)
    .filter(Boolean)
    .join("\n");
  const contamination = policy.forbid
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => ({
      category,
      term: rule.term,
      severity: "hardFail"
    }));

  return {
    categoryContamination: contamination,
    categoryFitScore: contamination.length === 0 ? 100 : Math.max(0, 100 - contamination.length * 50),
    hardFail: contamination.length > 0,
    allowedConcepts: policy.allow,
    forbiddenConcepts: policy.forbid.map((rule) => rule.term)
  };
};

const factTokens = (value = "") =>
  uniqueTexts(
    String(value || "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/u)
      .map((token) => token.trim())
      .map((token) => token.replace(/(?:은|는|이|가|을|를|과|와|도|만|에|에서|으로|로|에게|까지|부터)$/u, ""))
      .map((token) => token.replace(/(?:했다|했어요|했음|였다|이었어요|이었다|입니다|이에요|예요|어요|아요|더라고요|같아요|습니다)$/u, ""))
      .filter((token) => Array.from(token).length >= 2)
  );

const normalizeSemanticToken = (value = "") =>
  text(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/(?:으로서|으로써|으로|에서|에게|까지|부터|처럼|보다|마다|이라서|라서|이고|하고|이며|거나|지만|는데|했다|했음|했어요|했지만|했고|했다가|하는|했던|해서|이다|였다|한다|된다|됐다|합니다|됩니다|이에요|예요|어요|아요|네요|죠|요|은|는|이|가|을|를|과|와|도|만|에|의|로)$/u, "");

const normalizeFactMatch = (value = "") =>
  compact(value)
    .replace(/사용(?:함|했어요|했음|했다)/gu, "사용")
    .replace(/착용(?:함|했어요|했음|했다)/gu, "착용")
    .replace(/방문(?:함|했어요|했음|했다)/gu, "방문")
    .replace(/숙박(?:함|했어요|했음|했다)/gu, "숙박")
    .replace(/구매(?:함|했어요|했음|했다)/gu, "구매")
    .replace(/수강(?:함|했어요|했음|했다)/gu, "수강")
    .replace(/궁금(?:했음|했어요|했다)/gu, "궁금")
    .replace(/떠올랐(?:음|어요)/gu, "떠올")
    .replace(/좋았(?:음|어요)/gu, "좋")
    .replace(/편했(?:음|어요)/gu, "편")
    .replace(/않았(?:음|어요)/gu, "않았");

export const isFactReflected = (factValue = "", body = "") => {
  const factKey = compact(factValue);
  const bodyKey = compact(body);
  const normalizedFactKey = normalizeFactMatch(factValue);
  const normalizedBodyKey = normalizeFactMatch(body);
  if (!factKey) return false;
  if (bodyKey.includes(factKey)) return true;
  if (normalizedFactKey && normalizedBodyKey.includes(normalizedFactKey)) return true;
  const tokens = factTokens(factValue);
  if (tokens.length === 0) return false;
  const bodyTokens = new Set(factTokens(body).map(normalizeSemanticToken).filter(Boolean));
  const numericTokens = tokens.map(normalizeSemanticToken).filter((token) => /\p{N}/u.test(token));
  if (
    numericTokens.length > 0 &&
    !numericTokens.every((token) => bodyTokens.has(token) || normalizedBodyKey.includes(token))
  ) {
    return false;
  }
  const hitCount = tokens.filter((token) => {
    const normalizedToken = normalizeFactMatch(token);
    const semanticToken = normalizeSemanticToken(token);
    return body.includes(token) ||
      normalizedBodyKey.includes(normalizedToken) ||
      normalizedBodyKey.includes(compact(token)) ||
      bodyTokens.has(semanticToken);
  }).length;
  const threshold = tokens.length >= 8 ? 0.38 : tokens.length >= 5 ? 0.45 : 0.55;
  return hitCount / tokens.length >= threshold;
};

export const calculateInputFactCoverage = ({ factMap = {}, body = "", coveredFactIds = [], missingFactIds = [] } = {}) => {
  const highConfidenceFacts = (factMap.userFacts || []).filter((fact) => Number(fact.confidence || 0) >= 0.85);
  const coveredSet = new Set(coveredFactIds.filter(Boolean));
  const explicitMissingSet = new Set(missingFactIds.filter(Boolean));
  const reflected = highConfidenceFacts.filter((fact) =>
    (coveredSet.has(fact.id) && !explicitMissingSet.has(fact.id)) ||
    isFactReflected(fact.value, body) ||
    (fact.aliases || []).some((alias) => isFactReflected(alias, body))
  );
  const missing = highConfidenceFacts.filter((fact) => !reflected.some((item) => item.id === fact.id));
  const reflectedIds = new Set(reflected.map((fact) => fact.id));
  const criticalFacts = highConfidenceFacts.filter((fact) => fact.priority === "critical");
  const highFacts = highConfidenceFacts.filter((fact) => fact.priority === "high");
  const criticalReflected = criticalFacts.filter((fact) => reflectedIds.has(fact.id));
  const highReflected = highFacts.filter((fact) => reflectedIds.has(fact.id));

  return {
    totalHighConfidenceFacts: highConfidenceFacts.length,
    reflectedFacts: reflected.length,
    inputFactCoverage: highConfidenceFacts.length === 0 ? 1 : Number((reflected.length / highConfidenceFacts.length).toFixed(2)),
    criticalFactCoverage: criticalFacts.length === 0 ? 1 : Number((criticalReflected.length / criticalFacts.length).toFixed(2)),
    highFactCoverage: highFacts.length === 0 ? 1 : Number((highReflected.length / highFacts.length).toFixed(2)),
    criticalFactIds: criticalFacts.map((fact) => fact.id),
    highFactIds: highFacts.map((fact) => fact.id),
    missingCriticalFactIds: criticalFacts.filter((fact) => !reflectedIds.has(fact.id)).map((fact) => fact.id),
    missingHighFactIds: highFacts.filter((fact) => !reflectedIds.has(fact.id)).map((fact) => fact.id),
    missingFactIds: missing.map((fact) => fact.id),
    missingFacts: missing.map((fact) => ({
      id: fact.id,
      type: fact.type,
      priority: fact.priority,
      value: fact.value
    }))
  };
};

const isBroadBlogKeyword = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return false;
  if (/본점|지점|분점|점|센터|거래소|강의|학원|매장|식당|카페|브랜드/u.test(cleaned)) return false;
  return /맛집|카페|추천|근처|가볼만한|갈만한|후기|리뷰|정리|방법|정보|비교|체크|아이랑|가족|여행|지역|메뉴|강의|수업/u.test(cleaned);
};

export const BLOG_WRITER_PIPELINE_STEPS = [
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
];

export const parseSubKeywords = (value = "", mainKeyword = "") => {
  const mainKey = compact(mainKeyword);
  return uniqueTexts(splitList(value, 12))
    .filter((keyword) => compact(keyword) !== mainKey)
    .slice(0, 3);
};

const getMemoText = (form = {}) =>
  text(form.experienceMemo || form.memory || form.memo || form.productInfoText || form.productInfo || "");

const getInputSourceText = (form = {}) =>
  [
    form.productName,
    form.topic,
    form.mainKeyword,
    form.keyword,
    form.subKeywords,
    form.category,
    form.productInfoText,
    form.experienceMemo,
    form.memory,
    form.memo,
    form.emphasisPoints
  ]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(text)
    .filter(Boolean)
    .join(" ");

const STANDARD_INPUT_SCHEMA = {
  topic: "string",
  userMainKeyword: "string",
  userSubKeywords: ["string"],
  memory: "string",
  images: [{ index: "number", name: "string", note: "string", ocrText: "string" }],
  categoryOverride: "string",
  tone: "string",
  targetCharCount: "number",
  avoidWords: ["string"]
};

export const normalizeBlogWriterInput = (form = {}) => {
  const analysis = analyzeBlogWritingInput(form);
  const inputMainKeyword = splitList(form.mainKeyword || form.keyword, 1)[0] || "";
  const resolvedMainKeyword = analysis.mainKeyword || inputMainKeyword || analysis.primaryEntity || "";
  const inputSubKeywords = parseSubKeywords(form.subKeywords, resolvedMainKeyword);
  const legacySubKeywords = splitList(form.mainKeyword || form.keyword, 8).slice(1);
  const inputMainAsSub = inputMainKeyword && compact(inputMainKeyword) !== compact(resolvedMainKeyword) ? [inputMainKeyword] : [];
  const normalizedSubKeywords = parseSubKeywords([...inputMainAsSub, ...inputSubKeywords, ...legacySubKeywords], resolvedMainKeyword);
  const keyword = uniqueTexts([resolvedMainKeyword, ...normalizedSubKeywords]).join(", ");

  return {
    ...form,
    mainKeyword: resolvedMainKeyword || form.mainKeyword || "",
    keyword: keyword || form.keyword || form.mainKeyword || "",
    subKeywords: normalizedSubKeywords,
    originalMainKeyword: form.mainKeyword || form.keyword || "",
    inputMainKeyword,
    inputSubKeywords: normalizedSubKeywords
  };
};

export const detectExperienceStatus = (form = {}) => {
  const source = getInputSourceText(form);

  if (/숙박|묵었|머물렀|체크인|객실|호텔|펜션|리조트/u.test(source)) return "stayed";
  if (/먹어봄|먹어봤|먹었|식사했|마셔봤|마셨|맛봤/u.test(source)) return "eaten";
  if (/사용함|사용해|써봄|써봤|착용|발라봤|이용함|이용해/u.test(source)) return "used";
  if (/참석|참여|수강|들었|들어봄|공연|행사|클래스/u.test(source)) return "attended";
  if (/구매|샀|주문|결제|배송받/u.test(source)) return "purchased";
  if (/다녀옴|다녀왔|다녀와|방문함|방문했|갔다옴|갔다|갔|들렀|들른|좋았|기억남|기억에|느꼈/u.test(source)) {
    return "visited";
  }
  if (/예약|예정|계획|가려고|방문\s*전|가기\s*전/u.test(source)) return "planned";
  if (/알아봄|알아보|궁금|찾아보|비교|검색/u.test(source)) return "researched";

  return "unknown";
};

export const getExperienceTone = (experienceStatus = "unknown") => {
  if (["visited", "stayed", "used", "eaten", "attended", "purchased"].includes(experienceStatus)) {
    return "actual-review";
  }
  if (experienceStatus === "researched" || experienceStatus === "planned") return "reference";
  return "neutral";
};

const getImageItems = (form = {}) => {
  const source = Array.isArray(form.imageContext)
    ? form.imageContext
    : Array.isArray(form.images)
      ? form.images
      : Array.isArray(form.photos)
        ? form.photos
        : Array.isArray(form.photoMetadata)
          ? form.photoMetadata
          : [];

  return source.map((item, index) => ({
    index: Number(item?.index) || index + 1,
    name: text(item?.name),
    source: text(item?.source),
    note: text(item?.note || item?.description || item?.alt),
    ocrText: text(item?.ocrText),
    mediaType: text(item?.mediaType || item?.type),
    size: Number(item?.size) || 0,
    hasInlineData: Boolean(item?.dataUrl || item?.previewDataUrl || item?.base64Data || item?.base64)
  }));
};

export const analyzeBlogImages = (form = {}) => {
  if (form.imageAnalysis && typeof form.imageAnalysis === "object") {
    const existing = form.imageAnalysis;
    return {
      mode: existing.mode || existing.analysisMode || "vision",
      analysisMode: existing.mode || existing.analysisMode || "vision",
      items: Array.isArray(existing.items)
        ? existing.items.map((item, index) => ({
            photoIndex: Number(item.photoIndex || item.index) || index + 1,
            analysisMode: item.analysisMode || existing.mode || existing.analysisMode || "vision",
            category: item.category || "unknown",
            visibleElements: uniqueTexts(item.visibleElements || item.facts || []),
            safeDescription: text(item.safeDescription || item.description),
            unsafeClaims: uniqueTexts(item.unsafeClaims || []),
            confidence: Number(item.confidence) || 0
          }))
        : [],
      visuallySupported: uniqueTexts(existing.visuallySupported || existing.visibleElements || existing.facts || []),
      unsupportedVisualFields: existing.unsupportedVisualFields || [],
      canAssertVisualFacts: true,
      source: "provided-image-analysis"
    };
  }

  const items = getImageItems(form);
  const visibleLabels = uniqueTexts(items.flatMap((item) => [item.note, item.ocrText]).filter(Boolean));

  if (items.length === 0) {
    return {
      mode: "none",
      analysisMode: "none",
      items: [],
      visuallySupported: [],
      unsupportedVisualFields: ["taste", "price", "quantity", "service", "staff", "businessHours"],
      canAssertVisualFacts: false,
      source: "no-image"
    };
  }

  return {
    mode: "label-only",
    analysisMode: "label-only",
    items: items.map((item) => ({
      photoIndex: item.index,
      analysisMode: "label-only",
      category: "unknown",
      visibleElements: [],
      safeDescription: item.note || item.ocrText || "",
      unsafeClaims: ["taste", "price", "quantity", "service", "staff", "businessHours"],
      confidence: item.note || item.ocrText ? 0.35 : 0,
      source: item.source || "upload",
      hasUserLabel: Boolean(item.note || item.ocrText)
    })),
    visuallySupported: visibleLabels,
    unsupportedVisualFields: ["taste", "price", "quantity", "service", "staff", "businessHours"],
    canAssertVisualFacts: visibleLabels.length > 0,
    source: "metadata-labels"
  };
};

export const determineInformationSufficiency = ({ form = {}, analysis = analyzeBlogWritingInput(form), imageAnalysis = null } = {}) => {
  const memoText = getMemoText(form);
  const memoLines = memoText
    .split(/\n|(?<=[.!?。])\s+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const sourceLength = getInputSourceText(form).replace(/\s+/g, "").length;
  const visualFactCount = imageAnalysis?.visuallySupported?.length || 0;
  const explicitSubKeywordCount = parseSubKeywords(form.subKeywords, analysis.mainKeyword).length;
  if (memoLines.length === 0 && visualFactCount <= 1) {
    return {
      level: "low",
      targetLengthRange: { min: 600, max: 1100, target: 900 },
      reason: "사용자 메모가 거의 없어 서브 키워드만으로 긴 글을 만들지 않습니다."
    };
  }
  const score =
    memoLines.length * 2 +
    Math.min(6, Math.floor(sourceLength / 45)) +
    visualFactCount * 2 +
    explicitSubKeywordCount +
    (analysis.primaryEntity ? 1 : 0);

  if (score >= 12) {
    return {
      level: "high",
      targetLengthRange: { min: 2000, max: 3600, target: 2800 },
      reason: "메모, 키워드, 이미지 단서가 충분해 긴 글을 구성할 수 있습니다."
    };
  }

  if (score >= 6) {
    return {
      level: "medium",
      targetLengthRange: { min: 1100, max: 2200, target: 1700 },
      reason: "핵심 상황은 있으나 세부 정보가 제한적이어서 중간 길이가 적합합니다."
    };
  }

  return {
    level: "low",
    targetLengthRange: { min: 600, max: 1100, target: 900 },
    reason: "입력 정보가 적어 억지 확장보다 짧고 구체적인 글이 적합합니다."
  };
};

export const inferSearchIntent = ({ category = "experience", analysis = {}, experienceStatus = "unknown" } = {}) => {
  const reviewTone = getExperienceTone(experienceStatus);
  const mainKeyword = analysis.mainKeyword || analysis.primaryEntity || "";
  const broadKeyword = analysis.broadKeyword || "";
  const subKeywords = analysis.subKeywords || [];
  const categoryIntent = {
    restaurant: "맛집 후기와 확인된 메뉴 탐색",
    cafe: "카페 방문 분위기와 메뉴 탐색",
    accommodation: "숙소 정보와 숙박 후기 탐색",
    product: "상품 사용 후기와 구매 전 비교",
    beauty: "뷰티 제품 사용 후기와 구매 전 비교",
    fashion: "패션 착용 후기와 구매 전 비교",
    store: "매장 방문 후기와 상담 분위기 탐색",
    education: "강의 내용과 수강 전 난이도 탐색",
    hospital: "방문 전 절차와 상담 분위기 탐색",
    service: "서비스 이용 과정과 비용 전 확인",
    travel: "여행 동선과 숙소/장소 후기 탐색",
    "kids-place": "아이 동반 방문 가능성과 현장 분위기 탐색",
    experience: "체험 과정과 준비물 탐색",
    information: "처음 알아보는 주제의 핵심 정리",
    comparison: "구매 전 비교와 선택 기준 탐색",
    place: "장소 방문 후기와 이용 전 참고",
    other: "주제 정보와 이용 전 참고"
  };
  const hasFamilyCue = /가족|아이/u.test(`${analysis.topic || ""} ${analysis.memoText || ""} ${subKeywords.join(" ")}`);
  const intentType = (() => {
    if (category === "comparison") return "comparison_guide";
    if (category === "information") return /방법|하는\s*법|how/u.test(`${analysis.topic || ""} ${analysis.mainKeyword || ""}`) ? "how_to" : "researched_information";
    if (category === "accommodation") return reviewTone === "actual-review" ? "accommodation_review" : "researched_information";
    if (category === "product" || category === "beauty" || category === "fashion") {
      return reviewTone === "actual-review" ? "product_usage_review" : "purchase_consideration";
    }
    if (category === "restaurant" || category === "cafe" || category === "kids-place") {
      if (hasFamilyCue && reviewTone === "actual-review") return "family_visit_review";
      if (broadKeyword || subKeywords.some((keyword) => /맛집|카페|근처|지역|동|역|시|군|구/u.test(keyword))) return "local_search";
      return reviewTone === "actual-review" ? "first_person_review" : "pre_visit_guide";
    }
    if (reviewTone === "actual-review") return "first_person_review";
    if (experienceStatus === "planned") return "pre_visit_guide";
    return "researched_information";
  })();

  return {
    type: intentType,
    primary: categoryIntent[category] || categoryIntent.experience,
    tone: reviewTone,
    queryFocus: uniqueTexts([mainKeyword, broadKeyword, ...subKeywords]).slice(0, 5),
    readerQuestion:
      reviewTone === "actual-review"
        ? "직접 다녀오거나 써본 사람이 무엇을 기억했는지 알고 싶다."
        : "방문 또는 구매 전에 어떤 점을 먼저 살펴보면 좋을지 알고 싶다."
  };
};

const EXPERIENCE_EVIDENCE_PATTERN =
  /숙박|묵었|머물렀|체크인|객실|호텔|펜션|리조트|먹어봄|먹어봤|먹었|식사했|마셔봤|마셨|맛봤|사용함|사용해|써봄|써봤|착용|발라봤|이용함|이용해|참석|참여|수강|들었|공연|행사|클래스|구매|주문|결제|배송받|다녀왔|방문|갔다|가봤|들렀|보러/u;

const CONTEXT_COMPANION_RULES = [
  ["children", /아이|아이와|아이랑|아기|유아|어린이|자녀|키즈|초등|중학생|고등학생/u],
  ["family", /가족|부모|부모님|엄마|아빠|어머니|아버지|남편|아내|배우자|부부/u],
  ["friends", /친구|지인|친한\s*사람/u],
  ["colleagues", /동료|회사|직장|팀원|상사|출장|미팅/u],
  ["group", /단체|모임|여럿|일행|동행/u],
  ["solo", /혼자|혼밥|혼술|혼캠|단독|혼자서/u]
];

const CONTEXT_OCCASION_RULES = [
  ["business", /출장|업무|미팅|회사|직장|상담|시공|검진/u],
  ["study", /공부|수업|강의|클래스|수강|시험|스터디/u],
  ["event", /행사|공연|축제|기념일|생일|모임|체험/u],
  ["travel", /여행|휴가|나들이|산책|코스|숙박|펜션|호텔|리조트/u],
  ["daily", /일상|출근|퇴근|점심|저녁|주말|데일리|생활|가방|집/u]
];

const VISIT_PURPOSE_RULES = [
  ["식사", /식사|점심|저녁|먹|마시|메뉴|디저트/u],
  ["휴식", /휴식|쉬러|카페|커피|잠깐/u],
  ["숙박", /숙박|1박|호텔|펜션|객실|체크인/u],
  ["산책", /산책|코스|동선|걷/u],
  ["구매 전 비교", /구매|비교|가격|구성|용량|수납/u],
  ["사용 확인", /사용|써봄|착용|발라|세척|휴대/u],
  ["수강", /수강|수업|강의|클래스/u],
  ["검진", /검진|병원|내과|절차/u],
  ["시공 상담", /시공|설치|상담|일정/u],
  ["체험", /체험|참여|만들기|공방/u],
  ["정보 확인", /방법|정보|절차|준비|알아보/u]
];

const USER_FACT_TYPE_RULES = [
  ["usage_context", /계기|때문|위해|하려고|찾다가|필요|궁금|알아보|출근|퇴근|여행|주말|일상|가방|집|회사/u],
  ["actual_usage", /사용|써봄|써봤|착용|입어|들고|발라|먹어|마셔|방문|다녀|숙박|수강|참여|이용/u],
  ["fit_or_feel", /맛|향|식감|착용감|사용감|무게|압박|편했|부담|부드|산뜻|건조|수납|세척/u],
  ["positive_experience", /좋았|편했|기억|만족|괜찮|쉬웠|차분|부담스럽지|눈에\s*들/u],
  ["concern_or_drawback", /아쉬|불편|걱정|궁금|부담|고민|헷갈|주의/u],
  ["future_intent", /재방문|재구매|다시|계속|의향|또\s*(?:가|사|쓰|입)/u],
  ["price", /가격|금액|원|만원|비용/u],
  ["location", /위치|근처|주차|동선|역|길|거리/u],
  ["facility", /시설|객실|공간|자리|창가|대기|놀이|산책로/u]
];

const classifyUserFactType = (value = "") =>
  USER_FACT_TYPE_RULES.find(([, pattern]) => pattern.test(value))?.[0] || "memo";

const createFact = ({ id = "", field, type = "", value, source, confidence = 0.85, allowedAsExperience = false } = {}) => ({
  id,
  field,
  type: type || field,
  value: text(value),
  source,
  confidence,
  allowedAsExperience
});

const evidenceIdsForPattern = (facts = [], pattern = /$^/u) =>
  uniqueTexts(
    facts
      .filter((fact) => pattern.test(fact.value || ""))
      .map((fact) => fact.id)
      .filter(Boolean)
  );

const makeContextFact = (value = "unknown", evidenceIds = []) => ({
  value,
  evidenceIds: uniqueTexts(evidenceIds)
});

export const classifyContextFacts = ({ form = {}, factMap = null } = {}) => {
  const source = getInputSourceText(form);
  const facts = factMap?.facts || [];
  const selectRule = (rules) => rules.find(([, pattern]) => pattern.test(source));
  const companionRule = selectRule(CONTEXT_COMPANION_RULES);
  const occasionRule = selectRule(CONTEXT_OCCASION_RULES);
  const purposeRule = selectRule(VISIT_PURPOSE_RULES);

  return {
    companions: companionRule
      ? makeContextFact(companionRule[0], evidenceIdsForPattern(facts, companionRule[1]))
      : makeContextFact("unknown"),
    occasion: occasionRule
      ? makeContextFact(occasionRule[0], evidenceIdsForPattern(facts, occasionRule[1]))
      : makeContextFact("unknown"),
    visitPurpose: purposeRule
      ? makeContextFact(purposeRule[0], evidenceIdsForPattern(facts, purposeRule[1]))
      : makeContextFact("")
  };
};

const collectContextEvidenceIds = (contextFacts = {}) =>
  uniqueTexts([
    ...(contextFacts.companions?.evidenceIds || []),
    ...(contextFacts.occasion?.evidenceIds || []),
    ...(contextFacts.visitPurpose?.evidenceIds || [])
  ]);

export const buildBlogFactMap = ({ form = {}, analysis = analyzeBlogWritingInput(form), imageAnalysis = analyzeBlogImages(form), experienceStatus = detectExperienceStatus(form) } = {}) => {
  const memoText = getMemoText(form);
  const inputSubKeywords = parseSubKeywords(form.subKeywords, analysis.mainKeyword);
  const memoLines = memoText
    .split(/\n|(?<=[.!?。])\s+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const memoFacts = memoLines.map((line, index) =>
    createFact({
      id: `uf${index + 1}`,
      field: "memo",
      type: classifyUserFactType(line),
      value: line,
      source: "user_memory",
      confidence: 0.92,
      allowedAsExperience: getExperienceTone(experienceStatus) === "actual-review"
    })
  );
  const userFacts = memoFacts.map((fact) => ({
    id: fact.id,
    type: fact.type,
    value: fact.value,
    aliases: uniqueTexts([normalizeFactMatch(fact.value), compact(fact.value)]).filter((alias) => alias && alias !== fact.value),
    priority: ["actual_usage", "positive_experience", "concern_or_drawback", "future_intent"].includes(fact.type) ? "critical" : "high",
    confidence: fact.confidence,
    source: fact.source
  }));
  const rawFacts = [
    createFact({
      field: "topic",
      value: analysis.topic || form.productName || form.topic,
      source: "user_topic",
      confidence: 0.95,
      allowedAsExperience: EXPERIENCE_EVIDENCE_PATTERN.test(analysis.topic || form.productName || form.topic || "")
    }),
    createFact({ field: "primaryEntity", value: analysis.primaryEntity, source: "primary_entity_extraction", confidence: 0.9 }),
    createFact({
      field: "mainKeyword",
      value: analysis.mainKeyword,
      source: "user_main_keyword",
      confidence: 0.9,
      allowedAsExperience: EXPERIENCE_EVIDENCE_PATTERN.test(analysis.mainKeyword || "")
    }),
    createFact({ field: "broadKeyword", value: analysis.broadKeyword, source: "user_main_keyword", confidence: 0.8 }),
    ...inputSubKeywords.map((keyword) =>
      createFact({ field: "subKeyword", value: keyword, source: "user_sub_keyword", confidence: 0.9 })
    ),
    ...memoFacts,
    ...(imageAnalysis?.visuallySupported || []).map((value) =>
      createFact({
        field: "visualLabel",
        value,
        source: imageAnalysis.mode === "vision" ? "image_n" : "image_label",
        confidence: imageAnalysis.mode === "vision" ? 0.92 : 0.65,
        allowedAsExperience: false
      })
    )
  ].filter((item) => item.value);
  const facts = rawFacts.map((fact, index) => ({
    ...fact,
    id: fact.id || `f${index + 1}`
  }));

  const supported = uniqueTexts(facts.map((fact) => fact.value));
  const visuallySupported = uniqueTexts(
    facts.filter((fact) => fact.field === "visualLabel").map((fact) => fact.value)
  );
  const experienceEvidence = uniqueTexts(
    facts
      .filter((fact) => fact.allowedAsExperience || EXPERIENCE_EVIDENCE_PATTERN.test(fact.value || ""))
      .map((fact) => fact.id)
  );
  const imageEvidence = uniqueTexts(
    facts
      .filter((fact) => fact.field === "visualLabel")
      .map((fact) => fact.id)
  );
  const unsupportedFields = uniqueTexts([
    ...(imageAnalysis?.unsupportedVisualFields || []),
    "exactPrice",
    "businessHours",
    "parkingEase",
    "waitingTime",
    "staffResponse",
    "tasteGuarantee",
    "quantityGuarantee"
  ]);

  return {
    facts,
    userFacts,
    supported,
    visuallySupported,
    unsupportedFields,
    denied: unsupportedFields,
    memoText,
    experienceStatus,
    experienceEvidence,
    imageEvidence,
    contextEvidence: [],
    visitStatus: getExperienceTone(experienceStatus) === "actual-review" ? "visited" : experienceStatus === "planned" ? "previsit" : "unknown",
    confidence: facts.length >= 8 ? 0.86 : facts.length >= 4 ? 0.74 : 0.62
  };
};

const CATEGORY_OUTLINES = {
  restaurant: {
    actual: ["들르게 된 상황", "메뉴가 눈에 들어온 이유", "사진으로 본 첫인상", "식사 상황에서 기억난 점", "다녀온 뒤 남은 인상", "과장 없는 마무리"],
    reference: ["알아보게 된 이유", "메뉴와 위치 맥락", "사진으로 본 첫인상", "방문 전 살펴볼 부분", "어울리는 상황"]
  },
  cafe: {
    actual: ["들르게 된 이유", "주문과 공간 첫인상", "머무는 동안 좋았던 점", "다시 떠오르는 장면"],
    reference: ["알아본 이유", "메뉴와 공간 분위기", "방문 전 볼 부분", "어울리는 상황"]
  },
  product: {
    actual: ["사용하게 된 상황", "처음 써본 느낌", "생활에서 편했던 점", "아쉬운 점과 맞는 사람"],
    reference: ["관심이 간 이유", "구성에서 볼 부분", "구매 전 비교할 점", "맞을 만한 상황"]
  },
  beauty: {
    actual: ["사용하게 된 상황", "처음 써본 느낌", "피부와 생활 루틴에서 본 점", "아쉬운 점과 맞는 사람"],
    reference: ["관심이 간 이유", "성분과 제형에서 볼 부분", "구매 전 비교할 점", "맞을 만한 상황"]
  },
  fashion: {
    actual: ["입어보게 된 상황", "착용 첫인상", "코디와 활동에서 본 점", "아쉬운 점과 맞는 사람"],
    reference: ["관심이 간 이유", "사이즈와 소재에서 볼 부분", "구매 전 비교할 점", "어울리는 상황"]
  },
  underwear: {
    actual: ["착용하게 된 이유", "착용 상황", "실제 착용감", "편했던 점", "아쉬웠던 점", "데일리 활용 여부", "계속 착용할 의향"],
    reference: ["관심이 간 이유", "사이즈와 소재에서 볼 부분", "착용 전 비교할 점", "어울리는 상황"]
  },
  accommodation: {
    actual: ["숙박하게 된 이유", "객실과 공용공간 첫인상", "머무는 동안 기억난 점", "예약 전 챙길 부분", "과장 없는 마무리"],
    reference: ["숙소로 알아본 이유", "객실과 시설 정보", "주변 환경에서 볼 부분", "예약 전 살펴볼 점"]
  },
  lifestyleProduct: {
    actual: ["사용하게 된 상황", "처음 써본 느낌", "생활에서 편했던 점", "아쉬운 점과 맞는 사람"],
    reference: ["관심이 간 이유", "구성에서 볼 부분", "구매 전 비교할 점", "맞을 만한 상황"]
  },
  education: {
    actual: ["수강하게 된 이유", "처음 들었을 때 흐름", "초보자에게 남은 부분", "수강 전 보면 좋은 점"],
    reference: ["알아보게 된 이유", "커리큘럼 핵심", "초보자가 볼 부분", "신청 전 살펴볼 점"]
  },
  store: {
    actual: ["방문하게 된 이유", "매장에서 본 첫인상", "상담하며 기억난 점", "방문 전 챙길 부분"],
    reference: ["알아보게 된 이유", "매장 정보에서 볼 부분", "상담 전 준비할 점", "어울리는 상황"]
  },
  travel: {
    actual: ["여행 중 들른 이유", "현장에서 기억난 장면", "현장에서 보낸 시간", "다음에 챙길 부분"],
    reference: ["여행지로 알아본 이유", "동선과 분위기", "사진으로 본 장면", "방문 전 살펴볼 부분"]
  },
  experience: {
    actual: ["참여하게 된 이유", "처음 진행된 흐름", "직접 해보며 남은 점", "준비하면 좋은 부분"],
    reference: ["관심이 간 이유", "진행 방식", "준비할 점", "어울리는 사람"]
  },
  information: {
    actual: ["알아보게 된 배경", "핵심 개념", "처음 볼 때 막혔던 부분", "정리하며 남은 점"],
    reference: ["알아볼 주제", "핵심 개념", "순서대로 볼 부분", "주의할 점"]
  }
};

const resolveOutline = ({ category = "experience", experienceTone = "neutral", informationSufficiency = {} } = {}) => {
  const preset = CATEGORY_OUTLINES[category] || CATEGORY_OUTLINES.experience;
  const base = experienceTone === "actual-review" ? preset.actual : preset.reference;
  const level = informationSufficiency.level || "medium";
  const count = level === "low" ? 3 : level === "high" ? Math.min(7, base.length + 1) : Math.min(5, base.length);
  const outline = base.slice(0, count);
  if (outline.length < count) outline.push("과장 없는 마무리");
  return outline.slice(0, Math.max(3, Math.min(7, count)));
};

const createKeywordPlan = ({ targetLengthRange = {}, mainKeyword = "", subKeywords = [] } = {}) => {
  const target = Number(targetLengthRange.target || 1800);
  const mainRange = target <= 1100 ? [2, 4] : target <= 2200 ? [4, 6] : [6, 8];
  return {
    mainKeyword,
    subKeywords: subKeywords.slice(0, 3),
    mainKeywordRange: { min: mainRange[0], max: mainRange[1] },
    subKeywordRange: { min: 1, max: 3 },
    openingParagraph: {
      mainKeywordRange: { min: 1, max: 2 },
      subKeywordMax: 1
    },
    rule: "키워드는 문장 의미가 살아 있을 때만 넣고 반복으로 분량을 채우지 않습니다."
  };
};

const distributeFactsForSection = (facts = [], sectionIndex = 0, sectionCount = 1) => {
  if (facts.length === 0) return { required: [], optional: [] };
  const middleCount = Math.max(1, sectionCount - 2);
  const bucketSize = Math.max(1, Math.ceil(facts.length / middleCount));
  const start = sectionIndex <= 0 ? 0 : Math.max(0, (sectionIndex - 1) * bucketSize);
  const required =
    sectionIndex === 0
      ? facts.slice(0, Math.min(2, facts.length))
      : sectionIndex === sectionCount - 1
        ? facts.slice(Math.max(0, facts.length - 2))
        : facts.slice(start, start + bucketSize);
  const requiredIds = new Set(required.map((fact) => fact.id).filter(Boolean));
  const optional = facts.filter((fact) => !requiredIds.has(fact.id)).slice(0, 3);
  return { required, optional };
};

const createSectionBudgets = ({ sectionCount = 1, targetCharCount = 1800, factCount = 0, informationLevel = "medium" } = {}) => {
  const safeCount = Math.max(1, Number(sectionCount) || 1);
  const safeTarget = Math.max(700, Number(targetCharCount) || 1800);
  if (safeCount === 1) return [safeTarget];
  const denseFacts = Number(factCount || 0) >= safeCount;
  const opening = Math.round(safeTarget * (informationLevel === "low" ? 0.18 : denseFacts ? 0.14 : 0.16));
  const closing = Math.round(safeTarget * (informationLevel === "low" ? 0.12 : 0.1));
  const middleCount = Math.max(1, safeCount - 2);
  const middle = Math.max(informationLevel === "low" ? 120 : 220, Math.round((safeTarget - opening - closing) / middleCount));
  return Array.from({ length: safeCount }, (_, index) => {
    if (index === 0) return opening;
    if (index === safeCount - 1) return closing;
    return middle;
  });
};

const createPlanSections = ({ outline = [], factMap = {}, contextFacts = {}, targetCharCount = 1800, informationLevel = "medium" } = {}) => {
  const facts = factMap?.facts || [];
  const userFacts = (factMap?.userFacts || []).filter((fact) => Number(fact.confidence || 0) >= 0.85);
  const contextEvidence = collectContextEvidenceIds(contextFacts);
  const imageEvidence = factMap?.imageEvidence || [];
  const sectionBudgets = createSectionBudgets({ sectionCount: outline.length, targetCharCount, factCount: userFacts.length, informationLevel });
  const assignedSoFar = new Set();

  return outline.map((heading, index) => {
    const fact = facts[index % Math.max(facts.length, 1)];
    const assigned = distributeFactsForSection(userFacts, index, outline.length);
    const requiredFactIds = assigned.required.map((item) => item.id).filter(Boolean);
    const optionalFactIds = assigned.optional.map((item) => item.id).filter(Boolean);
    const forbiddenDuplicateFactIds = [...assignedSoFar].filter((id) => !requiredFactIds.includes(id));
    requiredFactIds.forEach((id) => assignedSoFar.add(id));
    const evidenceIds = uniqueTexts([
      ...requiredFactIds,
      fact?.id,
      ...(index === 0 ? contextEvidence.slice(0, 2) : []),
      ...(index > 0 && index < 3 ? contextEvidence.slice(0, 1) : [])
    ].filter(Boolean));
    const imageRefs = index === 2 || /사진|이미지/u.test(heading)
      ? imageEvidence.slice(0, 2)
      : [];

    return {
      sectionId: `s${index + 1}`,
      heading,
      purpose: index === 0 ? "opening_context" : index === outline.length - 1 ? "closing" : "reader_intent",
      requiredFactIds,
      optionalFactIds,
      targetCharCount: sectionBudgets[index] || 0,
      targetChars: sectionBudgets[index] || 0,
      forbiddenDuplicateFactIds,
      evidenceIds,
      imageRefs
    };
  });
};

export const createWriterPlan = ({ form = {}, analysis = analyzeBlogWritingInput(form), category = analysis.category, searchIntent = null, experienceStatus = detectExperienceStatus(form), informationSufficiency = null, factMap = null, contextFacts = null } = {}) => {
  const experienceTone = getExperienceTone(experienceStatus);
  const resolvedInformation = informationSufficiency || determineInformationSufficiency({ form, analysis });
  const subKeywords = uniqueTexts([...(analysis.subKeywords || []), ...parseSubKeywords(form.subKeywords, analysis.mainKeyword)]).slice(0, 3);
  const outline = resolveOutline({ category, experienceTone, informationSufficiency: resolvedInformation });
  const faqCount = resolvedInformation.level === "low" ? 0 : resolvedInformation.level === "medium" ? 1 : 2;
  const requestedTarget = Number(form.targetCharCount || form.targetLength || 0) || 0;
  const effectiveTargetCharCount =
    resolvedInformation.level === "high" && requestedTarget > 0
      ? requestedTarget
      : requestedTarget || resolvedInformation.targetLengthRange?.target || 1800;
  const sections = createPlanSections({
    outline,
    factMap,
    contextFacts,
    targetCharCount: effectiveTargetCharCount,
    informationLevel: resolvedInformation.level
  });
  const contaminationPolicy = CATEGORY_CONTAMINATION_MATRIX[category] || { allow: [], forbid: [] };

  return {
    profilePreset: `${category || "experience"}-${experienceTone}`,
    readerIntent: searchIntent?.primary || "",
    tone: experienceTone,
    outline,
    dynamicOutline: sections,
    sections,
    sectionCount: outline.length,
    requestedTargetCharCount: requestedTarget || effectiveTargetCharCount,
    effectiveTargetCharCount,
    sectionBudgets: sections.map((section) => ({
      sectionId: section.sectionId,
      targetChars: section.targetCharCount,
      requiredFactIds: section.requiredFactIds || [],
      purpose: section.purpose,
      forbiddenDuplicateFactIds: section.forbiddenDuplicateFactIds || []
    })),
    faqCount,
    keywordPlan: createKeywordPlan({
      targetLengthRange: resolvedInformation.targetLengthRange,
      mainKeyword: analysis.mainKeyword,
      subKeywords
    }),
    factPolicy: {
      useOnly: factMap?.supported || [],
      allowedClaims: factMap?.supported || [],
      forbiddenClaims: [
        ...(factMap?.unsupportedFields || []),
        "unprovided companion details",
        "unverified price",
        "unverified business hours",
        "unverified parking convenience",
        "unverified staff attitude",
        "unverified taste or effect guarantee",
        "unprovided revisit or repurchase intent"
      ],
      unknownFields: factMap?.unsupportedFields || [],
      doNotInvent: factMap?.unsupportedFields || [],
      categoryAllowedConcepts: contaminationPolicy.allow || [],
      categoryForbiddenConcepts: (contaminationPolicy.forbid || []).map((rule) => rule.term || rule)
    },
    contextFacts: contextFacts || null
  };
};

const CLAIM_HARD_FAIL_TYPES = new Set(["unsupported", "contradictory", "metaGuidance", "placeholder"]);
const META_GUIDANCE_PATTERN =
  /사용자\s*메모|제공된\s*정보|실제\s*사용\s*메모가\s*없으면|해당\s*(?:제품|서비스|상품|장소|메뉴)|본문에서|글을\s*읽는\s*사람|글을\s*작성할\s*때|확인\s*필요|정보가\s*부족하면|작성\s*가이드|최종\s*검수표|writerPlan|factMap|프롬프트/u;
const PLACEHOLDER_PATTERN = /TODO|TBD|\{[^}]+\}|\[[^\]]*(?:제목|내용|설명|placeholder)[^\]]*\]|사진은\s*어디/u;
const EXPERIENCE_CLAIM_PATTERN =
  /다녀왔|다녀온|방문했|방문함|들렀|갔다|가봤|머물렀|묵었|숙박했|먹었|마셨|써봤|사용해봤|사용함|구매했|수강했|참여했|체험했|이용했|편했|기억남|기억났|남았|좋았/u;
const CONTEXT_CLAIM_PATTERN =
  /가족|아이|아이와|아이랑|아기|유아|어린이|자녀|친구|동료|동행|일행|부모|부모님|엄마|아빠|남편|아내|단체|모임/u;
const IMAGE_CLAIM_PATTERN = /사진|이미지|화면|보이는|보였|눈에\s*보|시각/u;

const splitClaimUnits = ({ title = "", body = "", faq = [], hashtags = [] } = {}) =>
  uniqueTexts([
    title,
    ...String(body || "")
      .split(/\n+|(?<=[.!?。요])\s+/u)
      .map((item) => item.trim())
      .filter(Boolean),
    ...faq.flatMap((item) => [item?.question, item?.answer]),
    ...hashtags
  ]).slice(0, 80);

const claimEvidenceFacts = (factMap = {}) => {
  const seen = new Set();
  return [...(factMap.facts || []), ...(factMap.userFacts || [])].filter((fact) => {
    const factValue = fact?.value || "";
    const key = `${fact?.id || ""}:${compact(factValue)}`;
    if (!factValue || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const evidenceIdsForText = (value = "", factMap = {}) => {
  const normalized = compact(value);
  if (!normalized) return [];
  return uniqueTexts(
    claimEvidenceFacts(factMap)
      .filter((fact) => {
        const factKey = compact(fact.value || "");
        return factKey && (normalized.includes(factKey) || factKey.includes(normalized.slice(0, Math.min(10, normalized.length))) || isFactReflected(fact.value, value));
      })
      .map((fact) => fact.id)
      .filter(Boolean)
  );
};

const classifyClaim = ({ value = "", factMap = {}, contextFacts = {}, imageAnalysis = {}, experienceStatus = "unknown" } = {}) => {
  const evidenceIds = evidenceIdsForText(value, factMap);
  const hasContextEvidence = collectContextEvidenceIds(contextFacts).length > 0 || (factMap.contextEvidence || []).length > 0;
  const hasExperienceEvidence = (factMap.experienceEvidence || []).length > 0;
  const hasImageEvidence = (factMap.imageEvidence || []).length > 0 || (imageAnalysis.visuallySupported || []).length > 0;
  const isActual = getExperienceTone(experienceStatus || factMap.experienceStatus) === "actual-review";

  if (META_GUIDANCE_PATTERN.test(value)) return { claimType: "metaGuidance", evidenceIds: [] };
  if (PLACEHOLDER_PATTERN.test(value)) return { claimType: "placeholder", evidenceIds: [] };
  if (CONTEXT_CLAIM_PATTERN.test(value) && !hasContextEvidence && evidenceIds.length === 0) return { claimType: "unsupported", evidenceIds };
  if (EXPERIENCE_CLAIM_PATTERN.test(value) && !hasExperienceEvidence) {
    if (evidenceIds.length > 0) return { claimType: "supported", evidenceIds };
    return { claimType: isActual ? "unsupported" : "contradictory", evidenceIds };
  }
  if (IMAGE_CLAIM_PATTERN.test(value) && !hasImageEvidence) return { claimType: "unsupported", evidenceIds };
  if (IMAGE_CLAIM_PATTERN.test(value) && hasImageEvidence) {
    return { claimType: "visuallySupported", evidenceIds: uniqueTexts([...evidenceIds, ...(factMap.imageEvidence || [])]) };
  }
  if (evidenceIds.length > 0) return { claimType: "supported", evidenceIds };
  return { claimType: "safeGeneralization", evidenceIds: [] };
};

export const createClaimLedger = ({ title = "", body = "", faq = [], hashtags = [], factMap = {}, contextFacts = {}, imageAnalysis = {}, experienceStatus = "" } = {}) =>
  splitClaimUnits({ title, body, faq, hashtags }).map((value) => {
    const classification = classifyClaim({
      value,
      factMap,
      contextFacts,
      imageAnalysis,
      experienceStatus
    });

    return {
      text: value,
      claimType: classification.claimType,
      evidenceIds: classification.evidenceIds
    };
  });

export const summarizeClaimLedger = (claimLedger = []) => {
  const counts = claimLedger.reduce((acc, item) => {
    acc[item.claimType] = (acc[item.claimType] || 0) + 1;
    return acc;
  }, {});
  const hardFailures = claimLedger.filter((item) => CLAIM_HARD_FAIL_TYPES.has(item.claimType));

  return {
    total: claimLedger.length,
    counts,
    hardFail: hardFailures.length > 0,
    hardFailures
  };
};

export const buildBlogWriterPipelineContext = (form = {}, overrides = {}) => {
  const normalizedForm = normalizeBlogWriterInput(form);
  const standardInput = {
    topic: text(form.topic || form.productName),
    userMainKeyword: text(form.mainKeyword || form.keyword),
    userSubKeywords: parseSubKeywords(form.subKeywords, form.mainKeyword || form.keyword),
    memory: text(form.memory || form.experienceMemo || form.memo),
    images: getImageItems(form),
    categoryOverride: text(form.category),
    tone: text(form.tone),
    targetCharCount: Number(form.targetCharCount || form.targetLength || 0) || 0,
    avoidWords: splitList(form.avoidWords || form.avoid, 20)
  };
  const analysis = {
    ...analyzeBlogWritingInput(normalizedForm),
    ...(overrides.analysis || {})
  };
  const category = overrides.category || analysis.category;
  const inputSubKeywords = parseSubKeywords(form.subKeywords, analysis.mainKeyword);
  const inputBroadKeyword =
    analysis.broadKeyword ||
    (standardInput.userMainKeyword && compact(standardInput.userMainKeyword) !== compact(analysis.mainKeyword) && isBroadBlogKeyword(standardInput.userMainKeyword)
      ? standardInput.userMainKeyword
      : "");
  const subKeywords = uniqueTexts([
    ...inputSubKeywords,
    ...(inputBroadKeyword ? [inputBroadKeyword] : []),
    ...(analysis.subKeywords || [])
  ]).filter((keyword) => compact(keyword) !== compact(analysis.mainKeyword)).slice(0, 3);
  const imageAnalysis = overrides.imageAnalysis || analyzeBlogImages(form);
  const experienceStatus = overrides.experienceStatus || detectExperienceStatus(form);
  const informationSufficiency =
    overrides.informationSufficiency ||
    determineInformationSufficiency({
      form,
      analysis,
      imageAnalysis
    });
  const searchIntent =
    overrides.searchIntent ||
    inferSearchIntent({
      category,
      analysis: { ...analysis, subKeywords },
      experienceStatus
    });
  const baseFactMap =
    overrides.factMap ||
    buildBlogFactMap({
      form,
      analysis: { ...analysis, subKeywords },
      imageAnalysis,
      experienceStatus
    });
  const contextFacts =
    overrides.contextFacts ||
    classifyContextFacts({
      form: normalizedForm,
      factMap: baseFactMap
    });
  const factMap = {
    ...baseFactMap,
    contextFacts,
    contextEvidence: uniqueTexts([...(baseFactMap.contextEvidence || []), ...collectContextEvidenceIds(contextFacts)])
  };
  const writerPlan =
    overrides.writerPlan ||
    createWriterPlan({
      form,
      analysis: { ...analysis, subKeywords },
      category,
      searchIntent,
      experienceStatus,
      informationSufficiency,
      factMap,
      contextFacts
    });

  return {
    writerProfile: {
      id: ANEUNYEOJA_WRITER_PROFILE_ID,
      version: ANEUNYEOJA_WRITER_PROFILE_VERSION
    },
    pipelineSteps: BLOG_WRITER_PIPELINE_STEPS,
    standardInputSchema: STANDARD_INPUT_SCHEMA,
    standardInput,
    normalizedInput: normalizedForm,
    primaryEntity: analysis.primaryEntity || analysis.mainKeyword,
    mainKeyword: analysis.mainKeyword,
    broadKeyword: inputBroadKeyword,
    inputMainKeyword: normalizedForm.inputMainKeyword || "",
    inputSubKeywords,
    subKeywords,
    category,
    searchIntent,
    experienceStatus,
    contextFacts,
    experienceTone: getExperienceTone(experienceStatus),
    informationSufficiency,
    factMap,
    imageAnalysis,
    writerPlan
  };
};
