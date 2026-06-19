import { createHumanQualityFactMap, evaluateHumanQuality } from "./blogWriterHumanQuality.js";

const text = (value) => String(value ?? "").trim();

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countOccurrences = (value = "", keyword = "") => {
  const source = String(value || "");
  const target = text(keyword);
  if (!source || !target) return 0;
  return (source.match(new RegExp(escapeRegExp(target), "gu")) || []).length;
};

const normalizeParagraphKey = (paragraph = "") =>
  text(paragraph)
    .replace(/\[사진 삽입:[^\]]+\]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

export const BLOG_WRITER_GUIDE_PATTERN =
  /정보가 부족하면|사진과 함께 보완하면|본문에서는|본문에서|글을 읽는 사람|글 안에서|광고처럼|구체적으로|확인 필요 정보는|단정하지 않고|단정하지 않는 편이|단정하지 않는 편|제공된 정보|메모에|맛집 후기답게|글의 중심|글의 흐름|글이 더 구체적으로|자연스럽게 정리되는 느낌|자연스러운 흐름|작성 가이드|글 작성|작성하면|초안에서는|사진을 추가하면|안전해요|맛을 단정하기보다|실제 후기를 함께|맛을 대신/u;

export const BLOG_WRITER_FORBIDDEN_CATEGORY_PATTERN =
  /서비스 신청|신청 과정|진행 과정|체험 흐름|비용 일정|견적|결과 확인 장면|사용감|발림감|제형|제품 패키지|커리큘럼|수강 흐름/u;

export const getBlogWriterKeywordRange = (targetCharCount = 2500) => {
  const target = Number.isFinite(Number(targetCharCount)) ? Number(targetCharCount) : 2500;

  if (target <= 1600) return { min: 4, idealMin: 4, idealMax: 5, max: 5 };
  if (target <= 2400) return { min: 5, idealMin: 5, idealMax: 6, max: 6 };
  if (target <= 3500) return { min: 7, idealMin: 7, idealMax: 8, max: 8 };
  return { min: 8, idealMin: 8, idealMax: 9, max: 10 };
};

export const collectDuplicateParagraphs = (body = "") => {
  const seen = new Map();
  const duplicates = [];

  String(body || "")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .forEach((paragraph) => {
      if (/^\[사진 삽입:/u.test(paragraph)) return;
      const key = normalizeParagraphKey(paragraph);
      if (key.length < 38) return;
      if (seen.has(key)) {
        duplicates.push(paragraph.slice(0, 60));
        return;
      }
      seen.set(key, paragraph);
    });

  return duplicates;
};

const getRestaurantTitleIntentCount = (titles = []) => {
  const joinedTitles = titles.join("\n");
  return [
    /갈낙짬뽕|짬뽕|탕수육|파스타|대표 메뉴|메뉴/u,
    /강화도맛집|초지대교|강화도|지역|근처|맛집/u,
    /방문 후기|다녀온|들른|궁금했던|가기 전/u,
    /가족여행|가족 식사|가족|회식|모임|여행/u,
    /후기|위치|근처|식사/u
  ].filter((pattern) => pattern.test(joinedTitles)).length;
};

const RESTAURANT_GENERIC_EXPLANATION_PATTERN =
  /식사 장소를 고를 때는 이런 기준|위치와 대표 메뉴를 나눠 보면|식사 후보로 보기|판단 기준|정보가 흩어져 있으면 판단|기준이 됩니다|후보를 고를 때|기준에서 위치와 메뉴|방문 전 확인할 항목/u;

const countRestaurantRoleOverlaps = (paragraphs = []) => {
  const rolePatterns = [
    /식사\s*후보/u,
    /이동\s*동선/u,
    /대표\s*메뉴/u,
    /방문\s*전\s*확인/u
  ];

  return rolePatterns.reduce((total, pattern) => {
    const paragraphHits = paragraphs.filter((paragraph) => pattern.test(paragraph)).length;
    return total + Math.max(0, paragraphHits - 1);
  }, 0);
};

export const evaluateBlogWriterQuality = ({
  form = {},
  category = "",
  selectedTitle = "",
  titleCandidates = [],
  body = "",
  mainKeyword = "",
  subKeywords = [],
  hashtags = [],
  faqItems = [],
  imageCount = 0,
  photoGuide = [],
  targetCharCount = 2500,
  primaryMenu = ""
} = {}) => {
  const normalizedBody = String(body || "").trim();
  const titles = titleCandidates.length > 0 ? titleCandidates : [selectedTitle].filter(Boolean);
  const paragraphs = normalizedBody.split(/\n{2,}/u).filter(Boolean);
  const firstParagraph =
    paragraphs.find((paragraph) => !/^\[사진 삽입:/u.test(paragraph) && !/^[^\n]{1,22}$/u.test(paragraph)) ||
    paragraphs[0] ||
    "";
  const firstSentence = firstParagraph.split(/(?<=[.!?。])\s+/u)[0] || firstParagraph;
  const range = getBlogWriterKeywordRange(targetCharCount);
  const keywordCount = countOccurrences(normalizedBody, mainKeyword);
  const titleText = titles.join("\n");
  const duplicateParagraphs = collectDuplicateParagraphs(normalizedBody);
  const guideLeak = BLOG_WRITER_GUIDE_PATTERN.test(normalizedBody);
  const repeatedCheckInfo =
    category === "restaurant" &&
    ((normalizedBody.match(/\[확인 필요\]/gu) || []).length > 1 ||
      (normalizedBody.match(/확인(?:해|하|할|하면|하고|한)/gu) || []).length > 12);
  const restaurantWrongCategory =
    category === "restaurant" && /서비스 신청|신청 과정|사용감|발림감|제품 패키지|커리큘럼|수강 흐름/u.test(`${titleText}\n${normalizedBody}`);
  const productWrongCategory =
    /product|lifestyleProduct/u.test(category) && /상담|서비스 신청|견적|예약 과정|비용 일정|진행 과정/u.test(`${titleText}\n${normalizedBody}`);
  const broadKeyword = text(form.mainKeyword || form.keyword);
  const broadKeywordRepeatedInsteadOfEntity =
    category === "restaurant" &&
    broadKeyword &&
    mainKeyword &&
    compact(broadKeyword) !== compact(mainKeyword) &&
    countOccurrences(firstParagraph, broadKeyword) > countOccurrences(firstParagraph, mainKeyword);
  const photoMarkerCount = (normalizedBody.match(/\[사진 삽입:/gu) || []).length;
  const uniqueHashtags = new Set(hashtags.map((tag) => compact(tag))).size;
  const menuTitleCount = primaryMenu ? titles.filter((title) => title.includes(primaryMenu)).length : 0;
  const regionTitleCount = titles.filter((title) => /강화도맛집|초지대교|강화도|맛집|근처/u.test(title)).length;
  const criterionWordCount = (normalizedBody.match(/기준|후보|확인/gu) || []).length;
  const genericExplanationCount = (normalizedBody.match(RESTAURANT_GENERIC_EXPLANATION_PATTERN) || []).length;
  const restaurantRoleOverlapCount = category === "restaurant" ? countRestaurantRoleOverlaps(paragraphs) : 0;
  const firstParagraphAwkward =
    category === "restaurant" &&
    /흐름의\s*식당|자연스럽게\s*살펴보게\s*되는|식사\s*후보|판단\s*기준/u.test(firstParagraph);
  const photoContextBland =
    category === "restaurant" &&
    imageCount > 0 &&
    !/붉은\s*국물|해산물|채소|색감|그릇|재료|토핑|튀김\s*색|담긴\s*구성/u.test(normalizedBody);
  const awkwardTitle =
    category === "restaurant" &&
    (titles.some((title) => /식사\s*후보|식사로\s*본\s*점|정보\s*정리|기준\s*정리|확인할\s*점/u.test(title)) ||
      getRestaurantTitleIntentCount(titles) < 5);
  const weakExperienceFlow =
    category === "restaurant" &&
    !/(가족여행|가족 식사|회식|다녀온 뒤|알게 된 이유|궁금했던 이유|사진으로 보니)/u.test(normalizedBody);
  const forcedLengthExpansion =
    category === "restaurant" &&
    Number(targetCharCount) >= 2400 &&
    normalizedBody.length >= 2500 &&
    (criterionWordCount >= 14 || genericExplanationCount > 0 || restaurantRoleOverlapCount >= 2);

  const checks = [
    {
      id: "publishable-body",
      passed: normalizedBody.length >= 900 && paragraphs.length >= 5,
      penalty: 8,
      detail: "본문 길이와 문단 구조"
    },
    {
      id: "guide-leak",
      passed: !guideLeak,
      penalty: 30,
      critical: true,
      detail: "작성 가이드 문장 노출"
    },
    {
      id: "duplicate-paragraphs",
      passed: duplicateParagraphs.length === 0,
      penalty: 20,
      critical: true,
      detail: duplicateParagraphs[0] || "중복 문단 없음"
    },
    {
      id: "main-entity",
      passed: !broadKeywordRepeatedInsteadOfEntity,
      penalty: 20,
      critical: true,
      detail: "상호/상품 엔티티 중심"
    },
    {
      id: "first-paragraph-seo",
      passed:
        category !== "restaurant" ||
        (firstSentence.includes(mainKeyword) &&
          countOccurrences(firstParagraph, mainKeyword) >= 2 &&
          countOccurrences(firstParagraph, mainKeyword) <= 3 &&
          subKeywords.some((keyword) => firstParagraph.includes(keyword))),
      penalty: 12,
      detail: "첫 문단 메인 키워드 2~3회와 서브키워드 포함"
    },
    {
      id: "keyword-density",
      passed: category !== "restaurant" || (keywordCount >= range.min && keywordCount <= range.max),
      penalty: 10,
      detail: `${keywordCount}회`
    },
    {
      id: "title-intents",
      passed:
        category !== "restaurant" ||
        (new Set(titles).size >= Math.min(5, titles.length) &&
          getRestaurantTitleIntentCount(titles) >= 5 &&
          (!primaryMenu || menuTitleCount >= 3) &&
          regionTitleCount >= 2),
      penalty: 10,
      detail: "메뉴/지역/방문전/가족상황/정보형 제목 후보"
    },
    {
      id: "photo-context",
      passed: imageCount === 0 || (photoMarkerCount >= 1 && photoMarkerCount <= Math.min(imageCount, 3) && photoGuide.length > 0),
      penalty: 6,
      detail: `${photoMarkerCount}/${imageCount}`
    },
    {
      id: "faq",
      passed: faqItems.length >= 3 && faqItems.every((item) => text(item.question) && text(item.answer)),
      penalty: 6,
      detail: `${faqItems.length}개`
    },
    {
      id: "hashtags",
      passed: hashtags.length >= 10 && hashtags.length <= 15 && uniqueHashtags === hashtags.length,
      penalty: 6,
      detail: `${hashtags.length}개`
    },
    {
      id: "category-terms",
      passed: !restaurantWrongCategory && !productWrongCategory,
      penalty: 24,
      critical: restaurantWrongCategory || productWrongCategory,
      detail: "카테고리 표현 일치"
    },
    {
      id: "check-info-repetition",
      passed: !repeatedCheckInfo,
      penalty: 12,
      critical: repeatedCheckInfo,
      detail: "확인 필요 반복"
    },
    {
      id: "restaurant-natural-flow",
      passed:
        category !== "restaurant" ||
        (!firstParagraphAwkward &&
          !weakExperienceFlow &&
          criterionWordCount <= 11 &&
          genericExplanationCount === 0 &&
          restaurantRoleOverlapCount <= 1),
      penalty: 16,
      critical: firstParagraphAwkward || genericExplanationCount > 0 || restaurantRoleOverlapCount >= 3,
      detail: "맛집 후기 자연스러움"
    },
    {
      id: "restaurant-photo-specificity",
      passed: category !== "restaurant" || !photoContextBland,
      penalty: 8,
      detail: "사진 시각 정보 구체성"
    },
    {
      id: "restaurant-title-click",
      passed: category !== "restaurant" || !awkwardTitle,
      penalty: 8,
      detail: "제목 후보 클릭감"
    },
    {
      id: "restaurant-forced-length",
      passed: !forcedLengthExpansion,
      penalty: 20,
      critical: forcedLengthExpansion,
      detail: "무리한 분량 확장"
    }
  ];

  const issues = checks.filter((check) => !check.passed);
  const score = Math.max(0, Math.min(100, 100 - issues.reduce((total, check) => total + check.penalty, 0)));
  const criticalFailed = issues.some((check) => check.critical);
  const humanQuality = evaluateHumanQuality({
    title: selectedTitle,
    titleCandidates: titles,
    body: normalizedBody,
    faq: faqItems,
    hashtags,
    factMap: createHumanQualityFactMap(form),
    imageAnalysis: form.imageAnalysis || form.imageContext || form.images || form.photoMetadata || null,
    category,
    visitStatus: createHumanQualityFactMap(form).visitStatus,
    mainKeyword,
    subKeywords,
    requestedTargetCharCount: form.requestedTargetCharCount || form.targetCharCount || targetCharCount,
    effectiveTargetCharCount: targetCharCount,
    engine: form.engine || "fallback"
  });

  return {
    score,
    criticalFailed,
    issues: issues.map((check) => `${check.id}: ${check.detail}`),
    checks,
    duplicateParagraphs,
    keywordCount,
    firstParagraph,
    firstSentence,
    humanQuality
  };
};
