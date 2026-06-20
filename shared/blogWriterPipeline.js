import { analyzeBlogWritingInput } from "./blogWriterCategory.js";

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
  "Information Sufficiency Classification",
  "Fact Map Construction",
  "Image Vision Analysis",
  "Writer Profile Selection",
  "Reader Intent Planning",
  "Dynamic Outline",
  "SEO/GEO Title Generation",
  "Draft Generation",
  "Deterministic Hard Check",
  "LLM Human Judge",
  "Automatic Revision",
  "Best Candidate Selection",
  "Result Schema Validation"
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
    dataUrl: text(item?.dataUrl || item?.previewDataUrl),
    base64Data: text(item?.base64Data || item?.base64)
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
      targetLengthRange: { min: 700, max: 1300, target: 1000 },
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
      targetLengthRange: { min: 2200, max: 3600, target: 2800 },
      reason: "메모, 키워드, 이미지 단서가 충분해 긴 글을 구성할 수 있습니다."
    };
  }

  if (score >= 6) {
    return {
      level: "medium",
      targetLengthRange: { min: 1400, max: 2400, target: 1900 },
      reason: "핵심 상황은 있으나 세부 정보가 제한적이어서 중간 길이가 적합합니다."
    };
  }

  return {
    level: "low",
    targetLengthRange: { min: 800, max: 1400, target: 1200 },
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

const createFact = ({ id = "", field, value, source, confidence = 0.85, allowedAsExperience = false } = {}) => ({
  id,
  field,
  value: text(value),
  source,
  confidence,
  allowedAsExperience
});

export const buildBlogFactMap = ({ form = {}, analysis = analyzeBlogWritingInput(form), imageAnalysis = analyzeBlogImages(form), experienceStatus = detectExperienceStatus(form) } = {}) => {
  const memoText = getMemoText(form);
  const inputSubKeywords = parseSubKeywords(form.subKeywords, analysis.mainKeyword);
  const rawFacts = [
    createFact({ field: "topic", value: analysis.topic || form.productName || form.topic, source: "user_topic", confidence: 0.95 }),
    createFact({ field: "primaryEntity", value: analysis.primaryEntity, source: "primary_entity_extraction", confidence: 0.9 }),
    createFact({ field: "mainKeyword", value: analysis.mainKeyword, source: "user_main_keyword", confidence: 0.9 }),
    createFact({ field: "broadKeyword", value: analysis.broadKeyword, source: "user_main_keyword", confidence: 0.8 }),
    ...inputSubKeywords.map((keyword) =>
      createFact({ field: "subKeyword", value: keyword, source: "user_sub_keyword", confidence: 0.9 })
    ),
    ...memoText
      .split(/\n|(?<=[.!?。])\s+/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((line) =>
        createFact({
          field: "memo",
          value: line,
          source: "user_memory",
          confidence: 0.88,
          allowedAsExperience: getExperienceTone(experienceStatus) === "actual-review"
        })
      ),
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
    supported,
    visuallySupported,
    unsupportedFields,
    denied: unsupportedFields,
    memoText,
    experienceStatus,
    visitStatus: getExperienceTone(experienceStatus) === "actual-review" ? "visited" : experienceStatus === "planned" ? "previsit" : "unknown",
    confidence: facts.length >= 8 ? 0.86 : facts.length >= 4 ? 0.74 : 0.62
  };
};

const CATEGORY_OUTLINES = {
  restaurant: {
    actual: ["들르게 된 상황", "메뉴가 눈에 들어온 이유", "사진으로 본 첫인상", "가족 식사로 기억난 점", "다녀온 뒤 남은 인상", "과장 없는 마무리"],
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
    actual: ["여행 중 들른 이유", "현장에서 기억난 장면", "동행자와 보낸 시간", "다음에 챙길 부분"],
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
  const mainRange = target <= 1400 ? [3, 4] : target <= 2400 ? [4, 6] : [6, 8];
  return {
    mainKeyword,
    subKeywords: subKeywords.slice(0, 3),
    mainKeywordRange: { min: mainRange[0], max: mainRange[1] },
    subKeywordRange: { min: 1, max: 3 },
    rule: "키워드는 문장 의미가 살아 있을 때만 넣고 반복으로 분량을 채우지 않습니다."
  };
};

export const createWriterPlan = ({ form = {}, analysis = analyzeBlogWritingInput(form), category = analysis.category, searchIntent = null, experienceStatus = detectExperienceStatus(form), informationSufficiency = null, factMap = null } = {}) => {
  const experienceTone = getExperienceTone(experienceStatus);
  const resolvedInformation = informationSufficiency || determineInformationSufficiency({ form, analysis });
  const subKeywords = uniqueTexts([...(analysis.subKeywords || []), ...parseSubKeywords(form.subKeywords, analysis.mainKeyword)]).slice(0, 3);
  const outline = resolveOutline({ category, experienceTone, informationSufficiency: resolvedInformation });
  const faqCount = resolvedInformation.level === "low" ? 0 : resolvedInformation.level === "medium" ? 2 : 3;

  return {
    profilePreset: `${category || "experience"}-${experienceTone}`,
    readerIntent: searchIntent?.primary || "",
    tone: experienceTone,
    outline,
    sectionCount: outline.length,
    faqCount,
    keywordPlan: createKeywordPlan({
      targetLengthRange: resolvedInformation.targetLengthRange,
      mainKeyword: analysis.mainKeyword,
      subKeywords
    }),
    factPolicy: {
      useOnly: factMap?.supported || [],
      doNotInvent: factMap?.unsupportedFields || []
    }
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
  const factMap =
    overrides.factMap ||
    buildBlogFactMap({
      form,
      analysis: { ...analysis, subKeywords },
      imageAnalysis,
      experienceStatus
    });
  const writerPlan =
    overrides.writerPlan ||
    createWriterPlan({
      form,
      analysis: { ...analysis, subKeywords },
      category,
      searchIntent,
      experienceStatus,
      informationSufficiency,
      factMap
    });

  return {
    pipelineSteps: BLOG_WRITER_PIPELINE_STEPS,
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
    experienceTone: getExperienceTone(experienceStatus),
    informationSufficiency,
    factMap,
    imageAnalysis,
    writerPlan
  };
};
