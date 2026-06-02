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
  [`**${heading}**`, ...paragraphs.map((item) => createSentence(item, tone))].filter(Boolean).join("\n\n");

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

const cleanInfoLine = (value = "") =>
  text(value)
    .replace(/^(OCR\s*원문|추출\s*데이터|추출\s*텍스트|이미지에서\s*읽은\s*상품\s*정보)\s*[:：]?\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();

const classifyProductInfoLine = (line = "") => {
  const cleaned = cleanInfoLine(line);
  const [rawLabel, ...rest] = cleaned.split(/[:：]/u);
  const value = rest.join(":").trim();
  const label = text(rawLabel);

  if (value) {
    const field = PRODUCT_INFO_FIELDS.find((fieldKey) =>
      PRODUCT_INFO_FIELD_LABELS[fieldKey].some((candidate) => label.includes(candidate))
    );

    if (field) return { field, value };
  }

  if (/성분|원료/u.test(cleaned)) return { field: "ingredients", value: cleaned };
  if (/사용|섭취|하루|1일|물과/u.test(cleaned)) return { field: "usage", value: cleaned };
  if (/주의|알레르기|임산부|질환/u.test(cleaned)) return { field: "cautions", value: cleaned };
  if (/배송|구매|교환|환불|스마트스토어|공식몰/u.test(cleaned)) return { field: "purchaseNotes", value: cleaned };
  if (/원|가격|할인|판매/u.test(cleaned)) return { field: "price", value: cleaned };
  if (/g|ml|포|정|박스|개입/u.test(cleaned)) return { field: "capacity", value: cleaned };

  return { field: "features", value: cleaned };
};

export const extractProductInfoFieldsFromText = (value = "") => {
  const fields = PRODUCT_INFO_FIELDS.reduce((result, field) => ({ ...result, [field]: "" }), {});

  text(value)
    .split(/\n|[·•]/u)
    .map(cleanInfoLine)
    .filter((line) => line.length >= 2)
    .forEach((line) => {
      const { field, value: fieldValue } = classifyProductInfoLine(line);
      if (!field || !fieldValue) return;

      fields[field] = fields[field] ? `${fields[field]}\n${fieldValue}` : fieldValue;
    });

  return fields;
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

const createTitleCandidates = (form = {}) => {
  const productName = getProductName(form);
  const mainKeyword = getMainKeyword(form);
  const related = getRelatedKeywords(form);
  const firstRelated = related[0] || "사용 루틴";
  const secondRelated = related[1] || "구매 전 체크";
  const titleSuffix = createToneTitleSuffix(form.tone);

  return uniqueText([
    `${mainKeyword} ${titleSuffix}, 직접 보기 전 궁금했던 포인트`,
    `${productName} ${firstRelated} 루틴처럼 살펴본 ${titleSuffix}`,
    `${mainKeyword} ${firstRelated} 관점에서 본 구매 전 체크`,
    `${productName} ${secondRelated}까지 자연스럽게 정리`,
    `${mainKeyword} 광고처럼 보이지 않게 써본 정보형 ${titleSuffix}`
  ]).slice(0, 5);
};

const createHashtags = (form = {}) => {
  const productName = getProductName(form);
  const mainKeyword = getMainKeyword(form);
  const related = getRelatedKeywords(form);

  return uniqueText([
    productName,
    mainKeyword,
    `${mainKeyword}후기`,
    ...related,
    ...related.map((item) => `${item}후기`),
    "상품후기",
    "구매전확인",
    related[0] ? `${related[0]}루틴` : ""
  ])
    .map(toHashTag)
    .filter(Boolean)
    .slice(0, 14);
};

const createImageSuggestions = (form = {}) => {
  const productName = getProductName(form);
  const mainKeyword = getMainKeyword(form);

  return [
    {
      id: "review-image-1",
      label: "이미지 1",
      title: "제품 전체컷",
      markerGuide: "제품 전체컷",
      description: "패키지와 제품명이 한눈에 보이도록 밝은 배경에서 촬영한 대표 이미지",
      directShotGuide: "정면 또는 45도 각도에서 제품명, 패키지, 구성품이 함께 보이게 촬영해보세요.",
      aiPrompt: `${productName} product package on clean desk, natural light, realistic blog review photo, no text overlay, no watermark`,
      searchKeyword: `${mainKeyword} product package lifestyle photo`
    },
    {
      id: "review-image-2",
      label: "이미지 2",
      title: "섭취/사용 루틴 컷",
      markerGuide: "섭취 또는 사용 루틴 컷",
      description: "물컵, 파우치, 손이 함께 보이는 자연스러운 루틴 이미지",
      directShotGuide: "실제로 챙기는 장면처럼 물컵이나 가방, 손을 함께 담으면 후기 흐름이 자연스럽습니다.",
      aiPrompt: `${productName} daily routine scene with water glass, hands, clean morning light, realistic blog photo`,
      searchKeyword: `${mainKeyword} daily routine product photo`
    },
    {
      id: "review-image-3",
      label: "이미지 3",
      title: "상세 정보 확인컷",
      markerGuide: "성분/구성/상세 정보 확인컷",
      description: "성분표, 구성, 섭취 방법처럼 구매 전 확인할 내용을 보여주는 디테일 이미지",
      directShotGuide: "상세페이지나 패키지 뒷면을 찍을 때는 글자가 읽히도록 흔들림 없이 가까이 촬영해보세요.",
      aiPrompt: `${productName} product detail checklist, ingredient label style, clean desk, realistic high detail photo`,
      searchKeyword: `${mainKeyword} product detail ingredient label`
    }
  ].map((item, index) => ({
    ...item,
    marker: `[여기에 이미지 ${index + 1}을 넣어주세요: ${item.markerGuide}]`
  }));
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
    return `이번 글에서는 ${productName}를 직접적인 효과로 단정하지 않고, 구매 전 확인 항목과 생활 루틴 적합성을 중심으로 정리하겠습니다`;
  }

  if (tone === "차분한") {
    return `이번 글에서는 ${productName}를 직접적인 효과로 단정하기보다, 구매 전 확인할 점과 생활 속에서 챙기기 쉬운 포인트를 중심으로 정리했습니다`;
  }

  if (tone === "활기찬") {
    return `이번 글에서는 ${productName}를 효과로 단정하기보다, 구매 전 체크할 점과 생활 속에서 챙기기 쉬운 포인트를 중심으로 정리해볼게요`;
  }

  return `이번 글에서는 ${productName}를 직접적인 효과로 단정하기보다, 구매 전 확인할 점과 생활 속에서 챙기기 쉬운 포인트를 중심으로 정리해보려고 해요`;
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

const createBody = (form = {}, selectedTitle = "") => {
  const productName = getProductName(form);
  const mainKeyword = getMainKeyword(form);
  const tone = normalizeTone(form.tone);
  const related = getRelatedKeywords(form);
  const relatedText = related.length > 0 ? related.join(", ") : "생활 루틴";
  const keywordRelatedText = getKeywordRelatedText(form);
  const memoLines = splitMemoLines(form.experienceMemo).map(softenSensitiveExpression);
  const emphasis = splitCommaList(form.emphasisPoints, 5);
  const emphasisText = emphasis.length > 0 ? emphasis.join(", ") : relatedText;
  const productInfoItems = summarizeProductInfo(form).filter(
    (item) => !["productName", "brandName"].includes(item.field)
  );
  const featureText = getProductInfoField(form, "features");
  const usageText = getProductInfoField(form, "usage");
  const cautionText = getProductInfoField(form, "cautions");
  const purchaseNotes = getProductInfoField(form, "purchaseNotes");
  const targetLength = normalizeTargetLength(form.targetLength);
  const imageSuggestions = createImageSuggestions(form);
  const toneNudge = getToneNudge(form.tone);
  const avoidWords = getAvoidWords(form);
  const intro = [
    createReviewIntroParagraph(form, memoLines),
    createImageMarker(imageSuggestions, 0)
  ];
  const sections = [
    createSection(tone === "친근한" ? "처음 관심이 갔던 이유" : "처음 관심을 갖게 된 이유", [
      createSituationSentence(form).replace(`${productName}는 `, "") ||
        `${keywordRelatedText}에 관심이 생기면서 부담 없이 시작할 수 있는 제품을 찾아보게 됐어요.`,
      tone === "전문적인"
        ? `처음부터 특정 변화를 기대하기보다, 현재 생활 패턴 안에서 ${productName}를 지속적으로 활용할 수 있는지 확인하는 것이 중요합니다.`
        : `처음부터 큰 변화를 기대했다기보다, 지금 생활 패턴 안에서 ${productName}를 부담 없이 챙길 수 있을지가 더 궁금했어요.`
    ], tone),
    createSection(tone === "친근한" ? "요즘 신경 쓰였던 부분" : "내 상황에서 확인한 부분", [
      memoLines[1] || `여름이 가까워지거나 컨디션이 무겁게 느껴질 때는 몸 관리 루틴을 다시 찾아보게 됩니다.`,
      tone === "전문적인"
        ? `건강 루틴 관련 제품은 개인차가 크기 때문에 후기 표현보다 원료 구성과 사용 기준을 확인해야 합니다.`
        : `이런 주제는 개인차가 크니까 좋다는 말만 보기보다 내 상황과 맞는지 확인하는 과정이 필요하겠더라고요.`,
      toneNudge
    ], tone),
    createSection(tone === "친근한" ? "제품에서 눈에 들어온 부분" : "제품에서 확인한 부분", [
      productInfoItems.length > 0
        ? `${productName} 상세 이미지에서는 ${productInfoItems.slice(0, 3).map((item) => item.value).join(", ")} 같은 정보를 먼저 확인할 수 있었습니다.`
        : `${productName}는 상세 이미지에서 성분, 구성, 섭취 또는 사용 방법을 직접 확인한 뒤 판단하는 편이 좋습니다.`,
      featureText
        ? `특히 ${featureText} 부분이 눈에 들어왔고, ${emphasisText}와도 연결해서 볼 수 있었습니다.`
        : `${emphasisText} 같은 포인트가 보여서 광고 문구처럼 바로 믿기보다 실제 루틴에 맞을지 살펴보고 싶어졌습니다.`,
      createImageMarker(imageSuggestions, 1)
    ], tone),
    createSection(tone === "친근한" ? "챙기는 루틴으로 보면" : "사용 방법 또는 루틴", [
      memoLines.find((line) => /한 포|물|챙기|루틴/u.test(line)) ||
        `한 번에 복잡하게 관리하기보다 물과 함께 챙기거나 정해진 시간에 두는 식으로 루틴을 만들면 부담이 줄어들 것 같아요.`,
      usageText
        ? `상세 정보 기준으로는 ${usageText} 부분을 먼저 확인하면 좋습니다.`
        : `섭취량이나 사용 방법은 제품 안내를 기준으로 확인하고, 몸 상태에 맞지 않는 부분이 있으면 무리하지 않는 것이 좋습니다.`
    ], tone),
    createSection(tone === "친근한" ? "좋았던 점과 기대되는 부분" : "기대 포인트", [
      memoLines[2] || `${productName}는 간편함이 먼저 눈에 들어와서 꾸준히 챙길 수 있을지가 가장 기대됐습니다.`,
      `다만 건강 루틴 관련 표현은 사람마다 체감이 다를 수 있어서, 특정 효과보다 생활 속에서 꾸준히 챙길 수 있는지 보는 게 자연스럽습니다.`
    ], tone),
    createSection("이런 분께 맞을 것 같아요", [
      `${relatedText} 정보를 찾아보면서 너무 복잡한 관리보다 간단한 루틴을 먼저 만들고 싶은 분께 잘 맞을 것 같습니다.`,
      `${productName}를 바로 결정하기보다 구성과 사용 방법을 확인하고 천천히 비교해보고 싶은 분에게도 참고가 될 수 있습니다.`
    ], tone),
    createSection("구매 전 확인할 점", [
      purchaseNotes
        ? `구매 전에는 ${purchaseNotes} 부분을 먼저 확인해보세요.`
        : `구매 전에는 성분, 구성, 섭취 또는 사용 방법, 주의사항, 배송과 교환 기준을 꼭 확인해보세요.`,
      cautionText
        ? `주의사항으로는 ${cautionText} 내용을 함께 보는 것이 좋습니다.`
        : `건강이나 다이어트 관련 제품은 개인차가 크기 때문에 후기만 보고 판단하기보다 내 몸 상태와 생활 패턴에 맞는지 함께 보는 것이 좋습니다.`,
      createImageMarker(imageSuggestions, 2)
    ], tone),
    createProductInfoSection(form)
  ];

  if (targetLength >= 1800) {
    sections.splice(
      5,
      0,
      createSection("개인차를 생각하고 본 부분", [
        `같은 ${mainKeyword} 후기라도 사람마다 기대하는 부분과 생활 패턴이 다를 수 있습니다.`,
        `그래서 저는 강한 표현보다 내가 실제로 챙길 수 있는 방식인지, 안내된 정보가 충분한지 중심으로 보는 편이 더 편했습니다.`
      ], tone)
    );
  }

  return applyAvoidWords(polishGeneratedReviewBody([...intro, ...sections].join("\n\n"), form), avoidWords);
};

export function createProductReviewDraft(form = {}) {
  const titles = createTitleCandidates(form);
  const selectedTitle = text(form.selectedTitle) || titles[0] || "";
  const body = createBody(form, selectedTitle);
  const hashtags = createHashtags(form);
  const imageSuggestions = createImageSuggestions(form);

  return {
    titles,
    selectedTitle,
    body,
    hashtags,
    imageSuggestions
  };
}
