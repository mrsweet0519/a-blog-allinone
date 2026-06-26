const text = (value) => String(value ?? "").trim();

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const hasFinalConsonant = (value = "") => {
  const chars = Array.from(compact(value));
  const last = chars.at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return /[0-9]/u.test(last);
  return (code - 0xac00) % 28 !== 0;
};

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const countOccurrences = (value = "", needle = "") => {
  const target = text(needle);
  if (!target) return 0;
  return (String(value || "").match(new RegExp(escapeRegExp(target), "gu")) || []).length;
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

const unique = (items = []) => [...new Set(items.map(text).filter(Boolean))];

const splitParagraphs = (body = "") =>
  String(body || "")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const splitSentences = (body = "") =>
  String(body || "")
    .split(/(?<=[.!?。요다])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const tokenize = (value = "") =>
  unique(
    String(value || "")
      .replace(/\[사진 삽입:[^\]]+\]/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length >= 2)
  );

const jaccard = (a = "", b = "") => {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
};

const getNgrams = (value = "", size = 3) => {
  const source = compact(value);
  const result = [];
  for (let index = 0; index <= source.length - size; index += 1) {
    result.push(source.slice(index, index + size));
  }
  return result;
};

const getRepeatedNgramRatio = (body = "") => {
  const grams = getNgrams(body, 3);
  if (grams.length < 20) return 0;
  const counts = new Map();
  grams.forEach((gram) => counts.set(gram, (counts.get(gram) || 0) + 1));
  const repeated = [...counts.values()].filter((count) => count >= 3).reduce((total, count) => total + count, 0);
  return repeated / grams.length;
};

const toIssue = ({ code, severity = "medium", evidence = "", message = "", revisionInstruction = "" }) => ({
  code,
  severity,
  evidence: text(evidence).slice(0, 120),
  message,
  revisionInstruction
});

const addIssue = (issues, issue) => {
  if (!issues.some((item) => item.code === issue.code && item.evidence === issue.evidence)) {
    issues.push(toIssue(issue));
  }
};

export const HUMAN_QUALITY_WEIGHTS = {
  titleQuality: 10,
  openingQuality: 10,
  factualGrounding: 15,
  specificity: 15,
  humanNaturalness: 15,
  narrativeCoherence: 10,
  paragraphValue: 10,
  keywordNaturalness: 5,
  imageGrounding: 5,
  readerUtility: 5
};

export const HUMAN_GUIDE_PATTERN =
  /글을\s*읽는\s*사람|글\s*안에서|본문에서|광고처럼|작성하면|제공된\s*정보|메모에|단정하지\s*않고|자연스럽게\s*정리되는\s*느낌|글의\s*흐름|글이\s*구체적으로\s*완성|확인\s*필요|안전합니다|안전해요|해당\s*표현|식사\s*후보|작성\s*가이드|최종\s*검수표/u;

const AWKWARD_TITLE_PATTERN =
  /식사하며\s*들른\s*곳\s*기록|식사로\s*본\s*점|정보\s*정리|체험\s*흐름|이용\s*전\s*확인할\s*점|후보로\s*본\s*점|기준\s*정리|체크\s*포인트까지\s*정리/u;

const AWKWARD_OPENING_PATTERN =
  /그런\s*흐름에서\s*살펴볼\s*만|식사\s*자리\s*흐름\s*안에서|부담\s*없이\s*떠올려보기|비교적\s*분명한\s*메뉴|자연스럽게\s*확인하게\s*되는|식사\s*후보로\s*보기/u;

const GENERIC_FILLER_PATTERN =
  /식사\s*장소는\s*이동\s*동선|식사\s*장소를\s*고를\s*때|대표\s*메뉴가\s*분명하면|같이\s*간\s*사람이\s*편한지도|방문\s*전\s*정보를\s*확인|메뉴가\s*분명하면\s*고르기|처음\s*보는\s*사람|독자에게\s*도움|사진이\s*여러\s*장이면|기준이\s*중요|후보로\s*보기/u;

const UNSUPPORTED_CLAIM_PATTERNS = [
  { pattern: /직원\s*(?:응대|친절)|사장님\s*친절/u, label: "직원 친절" },
  { pattern: /주차가\s*(?:편|좋|가능)|주차\s*편/u, label: "주차 편함" },
  { pattern: /양(?:이|은)?[^.\n]{0,12}(?:많|넉넉|푸짐)|푸짐했/u, label: "양 많음" },
  { pattern: /웨이팅\s*(?:없|짧)|대기\s*없/u, label: "웨이팅 없음" },
  { pattern: /가격\s*(?:만족|괜찮|저렴)|가성비/u, label: "가격 만족" },
  { pattern: /재방문(?:\s*의사|하고\s*싶)|다시\s*가고\s*싶/u, label: "재방문 의사" },
  { pattern: /맛있었|맛이\s*좋|맵기(?:가|는)\s*딱|국물이\s*시원/u, label: "맛 단정" },
  { pattern: /효과가\s*(?:좋|있|확실)|바로\s*효과/u, label: "효과 단정" }
];

const VISIT_CUE_PATTERN = /다녀|방문|먹어|먹었|갔다|갔|들렀|들른|사용|써봤|수강|듣고|좋았|느꼈|기억/u;
const PLACEHOLDER_PATTERN =
  /해당\s*(?:제품|서비스|업체|장소|메뉴|상품)|대표\s*메뉴(?![가-힣A-Za-z0-9]*(?:\s*사진|\s*메뉴|인|으로|가|는|를|을))|사용자\s*메모|제공된\s*정보|확인\s*필요로\s*남깁/u;

const normalizeFactMap = (factMap = {}, fallbackText = "") => {
  const factValues = [].concat(factMap.facts || []).map((fact) =>
    typeof fact === "object" && fact !== null ? fact.value || fact.text || fact.label || "" : fact
  );
  const supported = unique([
    ...[].concat(factMap.supported || []),
    ...factValues,
    factMap.memoText,
    fallbackText
  ]);
  const visuallySupported = unique([].concat(factMap.visuallySupported || [], factMap.imageFacts || []));
  const denied = unique([].concat(factMap.denied || [], factMap.unsupported || [], factMap.unsupportedFields || []));
  const sourceText = `${supported.join("\n")}\n${visuallySupported.join("\n")}`;
  return { supported, visuallySupported, denied, sourceText };
};

const inferVisitStatus = ({ visitStatus = "", factMap = {}, body = "" }) => {
  const explicit = text(visitStatus || factMap.visitStatus);
  if (explicit) return explicit;
  const source = `${factMap.memoText || ""}\n${body}`;
  if (VISIT_CUE_PATTERN.test(source)) return "visited";
  return "unknown";
};

const collectDuplicateSignals = (paragraphs = []) => {
  const headings = new Map();
  const duplicates = [];
  const similarities = [];

  paragraphs.forEach((paragraph, index) => {
    const isHeading = !/[.!?。요다]$/u.test(paragraph) && Array.from(paragraph).length <= 30;
    if (isHeading) {
      const key = compact(paragraph);
      headings.set(key, (headings.get(key) || 0) + 1);
    }
    for (let next = index + 1; next < paragraphs.length; next += 1) {
      if (/^\[사진 삽입:/u.test(paragraph) || /^\[사진 삽입:/u.test(paragraphs[next])) continue;
      const score = jaccard(paragraph, paragraphs[next]);
      if (score >= 0.7) similarities.push({ score, paragraph: paragraph.slice(0, 80) });
      if (score >= 0.8) duplicates.push(paragraph.slice(0, 80));
    }
  });

  return {
    repeatedHeadingCount: [...headings.values()].filter((count) => count >= 2).length,
    duplicates,
    similarities
  };
};

const countGenericParagraphs = (paragraphs = []) =>
  paragraphs.filter((paragraph) => {
    if (/^\[사진 삽입:/u.test(paragraph)) return false;
    if (!/[.!?。요다]$/u.test(paragraph) && Array.from(paragraph).length <= 30) return false;
    return GENERIC_FILLER_PATTERN.test(paragraph) || tokenize(paragraph).length < 8;
  }).length;

const getKeywordRange = (length = 1500) => {
  if (length <= 1500) return { min: 3, max: 4, hardMax: 6 };
  if (length <= 2500) return { min: 4, max: 6, hardMax: 8 };
  return { min: 6, max: 8, hardMax: 10 };
};

import { getEntityCoverage } from "./blogWriterEntity.js";
import { calculateInputFactCoverage, evaluateCategoryContamination } from "./blogWriterPipeline.js";

const scoreFromPenalty = (max, penalty) => Math.max(0, max - penalty);

const getGrade = (score) => {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
};

const mergeScores = (deterministicBreakdown, llmScores = null) => {
  if (!llmScores) return deterministicBreakdown;
  return Object.fromEntries(
    Object.entries(HUMAN_QUALITY_WEIGHTS).map(([key, max]) => {
      const deterministic = Number(deterministicBreakdown[key] ?? 0);
      const llm = Math.max(0, Math.min(max, Number(llmScores[key] ?? deterministic)));
      return [key, Math.round(deterministic * 0.4 + llm * 0.6)];
    })
  );
};

const sumBreakdown = (breakdown) => Object.values(breakdown).reduce((total, value) => total + Number(value || 0), 0);

const hasConcreteImageInput = (imageAnalysis = null) => {
  if (!imageAnalysis) return false;
  if (Array.isArray(imageAnalysis)) return imageAnalysis.length > 0;
  if (imageAnalysis.mode === "none" || imageAnalysis.analysisMode === "none") return false;
  return Boolean(
    imageAnalysis.canAssertVisualFacts ||
      (Array.isArray(imageAnalysis.items) && imageAnalysis.items.length > 0) ||
      (Array.isArray(imageAnalysis.visuallySupported) && imageAnalysis.visuallySupported.length > 0)
  );
};

const isNoImageIssue = (issue = {}) => /NO[-_]?IMAGE|IMAGE[-_]?LACK|VISUAL/i.test(`${issue.code || ""} ${issue.message || ""}`);

export const evaluateHumanQuality = ({
  title = "",
  titleCandidates = [],
  body = "",
  faq = [],
  faqItems = [],
  hashtags = [],
  factMap = {},
  imageAnalysis = null,
  category = "",
  visitStatus = "",
  mainKeyword = "",
  subKeywords = [],
  requestedTargetCharCount = 2500,
  effectiveTargetCharCount = 2500,
  engine = "fallback",
  llmJudge = null,
  primaryEntity = "",
  informationSufficiency = ""
} = {}) => {
  const normalizedTitle = text(title || titleCandidates[0] || "");
  const titles = unique(titleCandidates.length > 0 ? titleCandidates : [normalizedTitle]);
  const normalizedBody = text(body);
  const paragraphs = splitParagraphs(normalizedBody);
  const contentParagraphs = paragraphs.filter((paragraph) => !/^\[사진 삽입:/u.test(paragraph));
  const firstParagraph = contentParagraphs.find((paragraph) => /[.!?。요다]$/u.test(paragraph)) || contentParagraphs[0] || "";
  const firstSentence = splitSentences(firstParagraph)[0] || firstParagraph;
  const faqList = Array.isArray(faq) && faq.length > 0 ? faq : faqItems;
  const issues = [];
  const caps = [];
  const resolvedFactMap = normalizeFactMap(factMap, `${mainKeyword}\n${subKeywords.join("\n")}`);
  const sourceText = resolvedFactMap.sourceText;
  const resolvedVisitStatus = inferVisitStatus({ visitStatus, factMap, body: sourceText });
  const bodyLength = normalizedBody.replace(/\s+/g, "").length;
  const exactKeywordCount = mainKeyword ? countOccurrences(normalizedBody, mainKeyword) : 0;
  const keywordRange = getKeywordRange(bodyLength || effectiveTargetCharCount || requestedTargetCharCount);
  const duplicateSignals = collectDuplicateSignals(paragraphs);
  const genericCount = countGenericParagraphs(contentParagraphs);
  const genericRatio = contentParagraphs.length > 0 ? genericCount / contentParagraphs.length : 0;
  const guideLeak = HUMAN_GUIDE_PATTERN.test(`${normalizedTitle}\n${normalizedBody}`);
  const placeholderLeak = PLACEHOLDER_PATTERN.test(`${normalizedTitle}\n${normalizedBody}`);
  const awkwardTitle = AWKWARD_TITLE_PATTERN.test(normalizedTitle) || titles.some((item) => AWKWARD_TITLE_PATTERN.test(item));
  const awkwardOpening = AWKWARD_OPENING_PATTERN.test(firstParagraph);
  const repeatedNgramRatio = getRepeatedNgramRatio(normalizedBody);
  const unsupportedClaims = UNSUPPORTED_CLAIM_PATTERNS.filter(({ pattern, label }) => {
    if (!pattern.test(normalizedBody)) return false;
    return !new RegExp(escapeRegExp(label.replace(/\s+/gu, "")), "u").test(compact(sourceText)) && !pattern.test(sourceText);
  });
  const llmCoveredFactIds = Array.isArray(llmJudge?.coveredFactIds) ? llmJudge.coveredFactIds.filter(Boolean) : [];
  const llmCriticalMissingFactIds = Array.isArray(llmJudge?.criticalMissingFactIds) ? llmJudge.criticalMissingFactIds.filter(Boolean) : [];
  const llmMissingFactIds = unique([
    ...(Array.isArray(llmJudge?.missingFactIds) ? llmJudge.missingFactIds : []),
    ...llmCriticalMissingFactIds
  ]);
  const rawLlmIssueCodes = Array.isArray(llmJudge?.issueCodes) ? llmJudge.issueCodes.filter(Boolean) : [];
  const llmUnsupportedClaims = Array.isArray(llmJudge?.unsupportedClaims) ? llmJudge.unsupportedClaims.filter(Boolean) : [];
  const llmCategoryContamination = Array.isArray(llmJudge?.categoryContamination) ? llmJudge.categoryContamination.filter(Boolean) : [];
  const llmMetaGuidance = Array.isArray(llmJudge?.metaGuidance) ? llmJudge.metaGuidance.filter(Boolean) : [];
  const llmJosaErrors = Array.isArray(llmJudge?.josaErrors) ? llmJudge.josaErrors.filter(Boolean) : [];
  const bodySuggestsVisit = /다녀왔|방문했|먹었|사용해봤|수강했|들렀/u.test(normalizedBody);
  const visitContradiction = /not[-_\s]?visited|previsit|unknown|방문전|방문 전 참고/u.test(resolvedVisitStatus) && bodySuggestsVisit;
  const photoMarkers = (normalizedBody.match(/\[사진 삽입:/gu) || []).length;
  const hasImageInput = hasConcreteImageInput(imageAnalysis);
  const concretePhotoText = /붉은\s*국물|낙지|해산물|채소|그릇|토핑|색감|튀김|패키지|커리큘럼|공고문|안내문/u.test(normalizedBody);
  const fakeVisualClaim = !hasImageInput && photoMarkers > 0 && /사진에서는|사진에서\s*보|가까이\s*찍힌|또렷하게\s*보/u.test(normalizedBody) && !/note|라벨/u.test(String(imageAnalysis || ""));
  const allFaqCheckOnly =
    faqList.length > 0 && faqList.every((item) => /확인\s*필요|\[확인 필요\]|확인해야/u.test(`${item.question || ""} ${item.answer || ""}`));
  const entityForCoverage = primaryEntity || mainKeyword;
  const entityCoverage = getEntityCoverage({
    primaryEntity: entityForCoverage,
    title: normalizedTitle,
    titleCandidates: titles,
    body: normalizedBody
  });
  const categoryContaminationResult = evaluateCategoryContamination({
    category,
    values: [normalizedTitle, ...titles, normalizedBody, ...faqList.flatMap((item) => [item.question, item.answer]), ...hashtags]
  });
  const hasCategoryContamination = categoryContaminationResult.hardFail || llmCategoryContamination.length > 0;
  const inputFactCoverage = calculateInputFactCoverage({
    factMap,
    body: normalizedBody,
    coveredFactIds: llmCoveredFactIds,
    missingFactIds: llmMissingFactIds
  });
  const enforceTargetLength = informationSufficiency !== "low";
  const targetComplianceRatio =
    Number(requestedTargetCharCount) > 0
      ? Number((Array.from(normalizedBody).length / Number(requestedTargetCharCount)).toFixed(2))
      : 1;
  const targetLengthIssueApplies = (code = "") => {
    const normalizedCode = String(code || "").toUpperCase();
    if (!/TARGET|LENGTH/u.test(normalizedCode)) return true;
    if (!enforceTargetLength || Number(requestedTargetCharCount) <= 0) return false;
    if (/UNDER_?80|BELOW_?80/u.test(normalizedCode)) return targetComplianceRatio < 0.8;
    if (/UNDER|BELOW/u.test(normalizedCode)) return targetComplianceRatio < 0.85;
    if (/OVER_?115|ABOVE_?115/u.test(normalizedCode)) return targetComplianceRatio > 1.15;
    if (/OVER|ABOVE/u.test(normalizedCode)) return targetComplianceRatio > 1.1;
    return targetComplianceRatio < 0.85 || targetComplianceRatio > 1.1;
  };
  const llmIssueCodes = rawLlmIssueCodes.filter(targetLengthIssueApplies);
  const primaryEntityMissing = Boolean(
    entityForCoverage &&
      (!entityCoverage.finalTitle || !entityCoverage.openingSentence || !entityCoverage.body)
  );
  const josaError = (() => {
    if (!mainKeyword) return false;
    const escaped = escapeRegExp(mainKeyword);
    const badPatterns = hasFinalConsonant(mainKeyword)
      ? [`${escaped}는`, `${escaped}를`, `${escaped}와`, `${escaped}로(?!써)`]
      : [`${escaped}은`, `${escaped}을`, `${escaped}과`, `${escaped}으로`];
    return badPatterns.some((pattern) => new RegExp(pattern, "u").test(normalizedBody));
  })();

  let titlePenalty = 0;
  if (!normalizedTitle || (mainKeyword && !normalizedTitle.includes(mainKeyword))) titlePenalty += 4;
  if (awkwardTitle) titlePenalty += 5;
  if (Array.from(normalizedTitle).length < 18 || Array.from(normalizedTitle).length > 48) titlePenalty += 2;
  if (titles.length >= 5 && new Set(titles.map((item) => compact(item).slice(0, 16))).size < 3) titlePenalty += 2;
  if (/(\S+).*\1.*\1/u.test(normalizedTitle)) titlePenalty += 1;

  let openingPenalty = 0;
  if (!firstSentence || (mainKeyword && !firstSentence.includes(mainKeyword))) openingPenalty += 3;
  if (awkwardOpening) openingPenalty += 5;
  if (guideLeak && HUMAN_GUIDE_PATTERN.test(firstParagraph)) openingPenalty += 3;
  if (resolvedVisitStatus === "visited" && !/다녀|방문|들르|먹|사용|수강|기억|느꼈|좋았/u.test(firstParagraph)) openingPenalty += 2;
  if (tokenize(firstParagraph).length < 15) openingPenalty += 2;

  let factualPenalty = 0;
  if (unsupportedClaims.length > 0 || llmUnsupportedClaims.length > 0) factualPenalty += Math.min(12, (unsupportedClaims.length + llmUnsupportedClaims.length) * 5);
  if (visitContradiction) factualPenalty += 10;
  if (/가격은\s*\d|영업시간\s*(?:은|:)\s*\d/u.test(normalizedBody) && !/\d/u.test(sourceText)) factualPenalty += 5;

  let specificityPenalty = 0;
  if (genericRatio > 0.3) specificityPenalty += 5;
  if (genericRatio > 0.4) specificityPenalty += 4;
  if (tokenize(normalizedBody).filter((token) => sourceText.includes(token)).length < 4) specificityPenalty += 3;
  if (category === "restaurant" && !/메뉴|국물|해산물|채소|가족|여행|방문|사진/u.test(normalizedBody)) specificityPenalty += 3;

  let naturalPenalty = 0;
  if (guideLeak) naturalPenalty += 10;
  if (/(이에요|습니다|좋아요)(?:\s|.){0,18}\1(?:\s|.){0,18}\1/u.test(normalizedBody)) naturalPenalty += 2;
  if (repeatedNgramRatio > 0.12) naturalPenalty += 3;
  if (/([가-힣]+)(?:은|는|이|가|을|를)\s*\1(?:은|는|이|가|을|를)/u.test(normalizedBody)) naturalPenalty += 2;

  let coherencePenalty = 0;
  if (duplicateSignals.repeatedHeadingCount > 0) coherencePenalty += 5;
  if (duplicateSignals.duplicates.length > 0) coherencePenalty += 5;
  if (category === "restaurant" && /방문\s*후기/u.test(normalizedTitle) && /방문\s*전\s*참고/u.test(firstParagraph)) coherencePenalty += 2;
  if (paragraphs.length < 4) coherencePenalty += 2;

  let paragraphPenalty = 0;
  if (genericRatio > 0.3) paragraphPenalty += 4;
  if (duplicateSignals.similarities.length > 0) paragraphPenalty += 3;
  if (contentParagraphs.length > 0 && genericCount >= Math.ceil(contentParagraphs.length / 2)) paragraphPenalty += 3;

  let keywordPenalty = 0;
  if (mainKeyword && exactKeywordCount < Math.max(1, keywordRange.min - 1)) keywordPenalty += 2;
  if (mainKeyword && exactKeywordCount > keywordRange.hardMax) keywordPenalty += 4;
  if (firstParagraph && mainKeyword && countOccurrences(firstParagraph, mainKeyword) >= 4) keywordPenalty += 2;

  let imagePenalty = 0;
  if (photoMarkers > 0 && !concretePhotoText) imagePenalty += 3;
  if (fakeVisualClaim) imagePenalty += 3;
  if (photoMarkers === 0 && hasImageInput) imagePenalty += 2;

  let utilityPenalty = 0;
  if (allFaqCheckOnly) utilityPenalty += 3;
  if (faqList.length > 3) utilityPenalty += 1;
  if (faqList.length > 0 && new Set(faqList.map((item) => compact(`${item.question} ${item.answer}`).slice(0, 20))).size < faqList.length) utilityPenalty += 1;

  const deterministicBreakdown = {
    titleQuality: scoreFromPenalty(10, titlePenalty),
    openingQuality: scoreFromPenalty(10, openingPenalty),
    factualGrounding: scoreFromPenalty(15, factualPenalty),
    specificity: scoreFromPenalty(15, specificityPenalty),
    humanNaturalness: scoreFromPenalty(15, naturalPenalty),
    narrativeCoherence: scoreFromPenalty(10, coherencePenalty),
    paragraphValue: scoreFromPenalty(10, paragraphPenalty),
    keywordNaturalness: scoreFromPenalty(5, keywordPenalty),
    imageGrounding: scoreFromPenalty(5, imagePenalty),
    readerUtility: scoreFromPenalty(5, utilityPenalty)
  };

  if (awkwardTitle) {
    caps.push({ score: 85, code: "TITLE_AWKWARD" });
    addIssue(issues, {
      code: "TITLE_AWKWARD",
      severity: "high",
      evidence: normalizedTitle,
      message: "제목이 검색어 조합처럼 어색하거나 감점 표현을 포함합니다.",
      revisionInstruction: "대표 엔티티와 메뉴, 지역, 실제 상황 중 1~2개만 자연스럽게 조합하세요."
    });
  }
  if (awkwardOpening || genericRatio > 0.3) {
    addIssue(issues, {
      code: "GENERIC_FILLER",
      severity: genericRatio > 0.4 ? "high" : "medium",
      evidence: contentParagraphs.find((paragraph) => GENERIC_FILLER_PATTERN.test(paragraph)) || firstParagraph,
      message: "주제와 무관하게 재사용할 수 있는 일반론이 반복됩니다.",
      revisionInstruction: "사용자 메모나 사진에서 확인된 구체적인 장면으로 교체하세요."
    });
  }
  if (guideLeak) {
    caps.push({ score: 60, code: "META_GUIDANCE" });
    addIssue(issues, {
      code: "META_GUIDANCE",
      severity: "critical",
      evidence: (HUMAN_GUIDE_PATTERN.exec(`${normalizedTitle}\n${normalizedBody}`) || [])[0] || "",
      message: "작성 가이드성 문장이 최종 본문에 노출됐습니다.",
      revisionInstruction: "내부 평가나 작성 지시 표현을 실제 후기 문장으로 바꾸세요."
    });
  }
  if (placeholderLeak) {
    caps.push({ score: 50, code: "PLACEHOLDER_LEAK" });
    issues.push({
      code: "PLACEHOLDER_LEAK",
      severity: "critical",
      evidence: (PLACEHOLDER_PATTERN.exec(`${normalizedTitle}\n${normalizedBody}`) || [])[0] || "",
      message: "자리표시자나 내부 안내 표현이 최종 원고에 노출됐습니다.",
      revisionInstruction: "자리표시자는 삭제하고 확인된 사실 문장으로만 다시 쓰세요."
    });
  }
  if (entityForCoverage && !entityCoverage.finalTitle) {
    caps.push({ score: 55, code: "PRIMARY_ENTITY_TITLE_MISSING" });
    issues.push({
      code: "PRIMARY_ENTITY_TITLE_MISSING",
      severity: "critical",
      evidence: entityForCoverage,
      message: "대표 엔티티가 최종 제목에서 누락됐습니다.",
      revisionInstruction: "최종 제목과 제목 후보를 대표 엔티티 중심으로 다시 맞추세요."
    });
  }
  if (entityForCoverage && !entityCoverage.openingSentence) {
    caps.push({ score: 75, code: "PRIMARY_ENTITY_OPENING_MISSING" });
    issues.push({
      code: "PRIMARY_ENTITY_OPENING_MISSING",
      severity: "high",
      evidence: entityForCoverage,
      message: "대표 엔티티가 첫 문장에서 누락됐습니다.",
      revisionInstruction: "첫 문장에 원형 대표 엔티티를 자연스럽게 포함하세요."
    });
  }
  if (entityForCoverage && !entityCoverage.body) {
    caps.push({ score: 55, code: "PRIMARY_ENTITY_BODY_MISSING" });
    issues.push({
      code: "PRIMARY_ENTITY_BODY_MISSING",
      severity: "critical",
      evidence: entityForCoverage,
      message: "대표 엔티티가 본문에서 누락됐습니다.",
      revisionInstruction: "본문 중심 문단에 대표 엔티티를 다시 반영하세요."
    });
  }
  if (unsupportedClaims.length > 0 || llmUnsupportedClaims.length > 0 || visitContradiction) {
    caps.push({ score: 55, code: "UNSUPPORTED_CLAIM" });
    addIssue(issues, {
      code: "UNSUPPORTED_CLAIM",
      severity: "critical",
      evidence: unsupportedClaims.map((item) => item.label).join(", ") || "방문 상태 불일치",
      message: "사용자가 제공하지 않은 경험이나 사실을 단정합니다.",
      revisionInstruction: "Fact Map에 있는 사실과 사진에서 보이는 정보만 남기세요."
    });
  }
  if (duplicateSignals.duplicates.length > 0) {
    caps.push({ score: 70, code: "DUPLICATE_PARAGRAPH" });
    addIssue(issues, {
      code: "DUPLICATE_PARAGRAPH",
      severity: "high",
      evidence: duplicateSignals.duplicates[0],
      message: "동일하거나 매우 유사한 문단이 반복됩니다.",
      revisionInstruction: "중복 문단은 합치고 각 문단에 새로운 정보 하나를 넣으세요."
    });
  }
  if (duplicateSignals.repeatedHeadingCount > 0) {
    caps.push({ score: 70, code: "REPEATED_HEADING" });
  }
  if (genericRatio >= 0.5) caps.push({ score: 70, code: "GENERIC_FILLER_50" });
  else if (genericRatio >= 0.4) caps.push({ score: 75, code: "GENERIC_FILLER_40" });
  else if (genericRatio >= 0.3) caps.push({ score: 90, code: "GENERIC_FILLER_30" });
  if (mainKeyword && exactKeywordCount > keywordRange.hardMax) {
    caps.push({ score: 80, code: "KEYWORD_STUFFING" });
    addIssue(issues, {
      code: "KEYWORD_STUFFING",
      severity: "high",
      evidence: `${mainKeyword} ${exactKeywordCount}회`,
      message: "키워드 반복이 글 길이에 비해 과합니다.",
      revisionInstruction: "상호명 반복을 줄이고 대명사나 자연스러운 문맥으로 분산하세요."
    });
  }
  if (fakeVisualClaim) {
    caps.push({ score: 75, code: "UNSUPPORTED_IMAGE_FACT" });
    addIssue(issues, {
      code: "UNSUPPORTED_IMAGE_FACT",
      severity: "high",
      evidence: "사진 시각 정보 단정",
      message: "실제 이미지 분석 없이 구체적인 시각 사실을 단정했습니다.",
      revisionInstruction: "이미지 분석 결과나 사용자가 제공한 사진 메모에 있는 시각 정보만 사용하세요."
    });
  }
  if (josaError) {
    caps.push({ score: 75, code: "JOSA_ERROR" });
    issues.push({
      code: "JOSA_ERROR",
      severity: "high",
      evidence: mainKeyword,
      message: "대표 엔티티 뒤 한국어 조사가 어색합니다.",
      revisionInstruction: "엔티티의 받침 여부에 맞게 은/는, 이/가, 을/를, 과/와, 으로/로 조사를 고치세요."
    });
  }
  if (llmJosaErrors.length > 0) {
    caps.push({ score: 75, code: "JOSA_ERROR" });
    addIssue(issues, {
      code: "JOSA_ERROR",
      severity: "high",
      evidence: llmJosaErrors.join(", "),
      message: "LLM judge reported awkward particles or spelling.",
      revisionInstruction: "Fix awkward particles and spelling while keeping the exact primaryEntity natural."
    });
  }
  if (llmMetaGuidance.length > 0) {
    caps.push({ score: 60, code: "META_GUIDANCE" });
    addIssue(issues, {
      code: "META_GUIDANCE",
      severity: "critical",
      evidence: llmMetaGuidance.join(", "),
      message: "LLM judge reported meta guidance in the draft.",
      revisionInstruction: "Replace writing-guide language with grounded reader-facing sentences."
    });
  }
  if (allFaqCheckOnly) caps.push({ score: 85, code: "FAQ_CHECK_ONLY" });
  if (faqList.length > 2) {
    caps.push({ score: 85, code: "FAQ_TOO_MANY" });
    addIssue(issues, {
      code: "FAQ_TOO_MANY",
      severity: "medium",
      evidence: `${faqList.length}개`,
      message: "FAQ는 최대 2개까지만 생성합니다.",
      revisionInstruction: "근거가 약하거나 본문과 겹치는 FAQ를 삭제하세요."
    });
  }
  if (hasCategoryContamination) {
    caps.push({ score: 50, code: "CATEGORY_CONTAMINATION" });
    addIssue(issues, {
      code: "CATEGORY_CONTAMINATION",
      severity: "critical",
      evidence: [...categoryContaminationResult.categoryContamination.map((item) => item.term), ...llmCategoryContamination].join(", "),
      message: "카테고리에 맞지 않는 표현이 섞였습니다.",
      revisionInstruction: "현재 카테고리의 금지 표현을 삭제하고 입력 fact에 맞는 표현으로 바꾸세요."
    });
  }
  if (inputFactCoverage.criticalFactCoverage < 1) {
    caps.push({ score: 60, code: "CRITICAL_FACT_MISSING" });
    addIssue(issues, {
      code: "CRITICAL_FACT_MISSING",
      severity: "critical",
      evidence: inputFactCoverage.missingCriticalFactIds.join(", "),
      message: "critical user facts are missing from the body.",
      revisionInstruction: "Cover every critical user fact once with grounded, non-duplicated sentences."
    });
  }
  if (inputFactCoverage.highFactCoverage < 0.9) {
    caps.push({ score: 80, code: "HIGH_FACT_COVERAGE_LOW" });
    addIssue(issues, {
      code: "HIGH_FACT_COVERAGE_LOW",
      severity: "high",
      evidence: inputFactCoverage.missingHighFactIds.join(", "),
      message: "high-priority user facts are below the 90% coverage requirement.",
      revisionInstruction: "Add the missing high-priority facts without inventing new claims."
    });
  }
  if (inputFactCoverage.inputFactCoverage < 0.7) {
    caps.push({ score: inputFactCoverage.inputFactCoverage < 0.5 ? 65 : 80, code: "LOW_INPUT_FACT_COVERAGE" });
    addIssue(issues, {
      code: "LOW_INPUT_FACT_COVERAGE",
      severity: inputFactCoverage.inputFactCoverage < 0.5 ? "critical" : "high",
      evidence: inputFactCoverage.missingFactIds.join(", "),
      message: "사용자가 입력한 핵심 fact가 본문에 충분히 반영되지 않았습니다.",
      revisionInstruction: "누락된 userFactId의 내용을 새 경험을 만들지 않고 자연스럽게 본문에 반영하세요."
    });
  } else if (inputFactCoverage.inputFactCoverage < 0.9) {
    addIssue(issues, {
      code: "INPUT_FACT_COVERAGE_BELOW_PUBLISH_READY",
      severity: "medium",
      evidence: inputFactCoverage.missingFactIds.join(", "),
      message: "발행 준비 기준인 사용자 fact 90% 반영에 못 미칩니다.",
      revisionInstruction: "누락된 사용자 fact를 중복 없이 한 번씩 반영하세요."
    });
  }
  if (enforceTargetLength && Number(requestedTargetCharCount) > 0 && targetComplianceRatio < 0.85) {
    caps.push({ score: 89, code: "TARGET_LENGTH_UNDER_85" });
    addIssue(issues, {
      code: "TARGET_LENGTH_UNDER_85",
      severity: "high",
      evidence: `${Array.from(normalizedBody).length}/${requestedTargetCharCount}`,
      message: "충분한 정보 입력인데 요청 글자수의 85%에 미달했습니다.",
      revisionInstruction: "새 경험을 만들지 말고 누락된 fact와 구체적 상황을 서로 다른 문단에 반영해 목표 길이의 85~110%로 확장하세요."
    });
  } else if (enforceTargetLength && Number(requestedTargetCharCount) > 0 && targetComplianceRatio > 1.15) {
    caps.push({ score: 89, code: "TARGET_LENGTH_OVER_115" });
    addIssue(issues, {
      code: "TARGET_LENGTH_OVER_115",
      severity: "high",
      evidence: `${Array.from(normalizedBody).length}/${requestedTargetCharCount}`,
      message: "요청 글자수 대비 원고가 과도하게 깁니다.",
      revisionInstruction: "중복과 일반론을 줄여 목표 길이의 85~110%로 압축하세요."
    });
  }

  const rawLlmScores = llmJudge?.scores || llmJudge?.breakdown || null;
  const llmScores = rawLlmScores
    ? {
        ...rawLlmScores,
        ...(hasImageInput ? {} : { imageGrounding: HUMAN_QUALITY_WEIGHTS.imageGrounding })
      }
    : null;
  const isMock = Boolean(llmJudge?.isMock || llmJudge?.mock || llmJudge?.model === "mock-model" || llmJudge?.model === "unit-model");
  const hasLlmJudge = Boolean(llmJudge && Number.isFinite(Number(llmJudge.score)));
  const breakdown = mergeScores(deterministicBreakdown, llmScores);
  let score = hasLlmJudge
    ? Math.round(sumBreakdown(deterministicBreakdown) * 0.4 + Number(llmJudge.score) * 0.6)
    : sumBreakdown(breakdown);
  const rawQualityScore = clamp(score);

  if (!hasLlmJudge) {
    caps.push({ score: 89, code: "DETERMINISTIC_ONLY_MAX_89" });
  }
  if (hasLlmJudge && isMock) {
    caps.push({ score: 89, code: "MOCK_LLM_NOT_ACTUAL_QUALITY" });
  }
  caps.forEach((cap) => {
    score = Math.min(score, cap.score);
  });
  score = clamp(score);

  const hardFail = caps.some((cap) => cap.score <= 60) || issues.some((issue) => issue.severity === "critical");
  const publishReady =
    score >= 95 &&
    hasLlmJudge &&
    !isMock &&
    !hardFail &&
    !guideLeak &&
    !placeholderLeak &&
    !josaError &&
    llmJosaErrors.length === 0 &&
    llmMetaGuidance.length === 0 &&
    !primaryEntityMissing &&
    unsupportedClaims.length === 0 &&
    llmUnsupportedClaims.length === 0 &&
    duplicateSignals.duplicates.length === 0 &&
    !awkwardTitle &&
    inputFactCoverage.inputFactCoverage >= 0.9 &&
    inputFactCoverage.criticalFactCoverage >= 1 &&
    inputFactCoverage.highFactCoverage >= 0.9 &&
    informationSufficiency !== "low" &&
    (!enforceTargetLength || Number(requestedTargetCharCount) <= 0 || (targetComplianceRatio >= 0.85 && targetComplianceRatio <= 1.1)) &&
    !hasCategoryContamination &&
    genericRatio < 0.3;

  const llmIssues = (Array.isArray(llmJudge?.issues) ? llmJudge.issues.map(toIssue) : []).filter((issue) => {
    if (!hasImageInput && isNoImageIssue(issue)) return false;
    if (!targetLengthIssueApplies(issue.code)) return false;
    if (
      /MISSING_FACT|LOW_INPUT_FACT|FACT_COVERAGE/u.test(String(issue.code || "")) &&
      Number(inputFactCoverage.inputFactCoverage || 0) >= 0.9 &&
      Number(inputFactCoverage.criticalFactCoverage || 0) >= 1 &&
      Number(inputFactCoverage.highFactCoverage || 0) >= 0.9
    ) {
      return false;
    }
    return true;
  });
  const revisionInstructions = unique([
    ...issues.map((issue) => issue.revisionInstruction),
    ...(Array.isArray(llmJudge?.revisionInstructions) ? llmJudge.revisionInstructions : []),
    ...llmIssues.map((issue) => issue.revisionInstruction)
  ]).slice(0, 6);
  const applicableItems = {
    imageGrounding: hasImageInput,
    faqUtility: faqList.length > 0
  };

  return {
    score,
    grade: getGrade(score),
    publishReady,
    hardFail,
    judgeEngine: hasLlmJudge ? "llm" : "deterministic",
    isMock,
    confidence: hasLlmJudge ? 0.91 : 0.74,
    breakdown,
    rawQualityScore,
    deterministicScore: clamp(sumBreakdown(deterministicBreakdown)),
    llmJudgeScore: hasLlmJudge ? clamp(llmJudge.score) : null,
    issues: [...issues, ...llmIssues],
    revisionInstructions,
    caps,
    diagnostics: {
      genericFillerRatio: Number(genericRatio.toFixed(2)),
      genericParagraphs: genericCount,
      paragraphCount: contentParagraphs.length,
      keywordCount: exactKeywordCount,
      duplicateParagraphs: duplicateSignals.duplicates,
      repeatedHeadingCount: duplicateSignals.repeatedHeadingCount,
      repeatedNgramRatio: Number(repeatedNgramRatio.toFixed(3)),
      entityCoverage,
      inputFactCoverage,
      targetComplianceRatio,
      unsupportedClaims: [
        ...unsupportedClaims.map((item) => item.label),
        ...llmUnsupportedClaims
      ],
      applicability: applicableItems,
      categoryContamination: [
        ...categoryContaminationResult.categoryContamination,
        ...llmCategoryContamination.map((term) => ({ category, term, severity: "hardFail" }))
      ],
      metaGuidance: llmMetaGuidance,
      josaErrors: llmJosaErrors,
      issueCodes: unique([
        ...issues.map((issue) => issue.code),
        ...llmIssues.map((issue) => issue.code),
        ...llmIssueCodes,
        ...caps.map((cap) => cap.code)
      ]),
      categoryFitScore: categoryContaminationResult.categoryFitScore
    },
    requestedTargetCharCount,
    effectiveTargetCharCount,
    engine
  };
};

export const createHumanQualityFactMap = (form = {}, imageAnalysis = null) => {
  const memoText = text(form.experienceMemo || form.memory || form.memo || "");
  const topic = text(form.productName || form.topic || form.title || "");
  const mainKeyword = text(form.mainKeyword || form.keyword || "");
  const experienceStatus = text(form.experienceStatus || form.contentPackage?.experienceStatus || "");
  const imageFacts = [];
  const imageItems = Array.isArray(imageAnalysis)
    ? imageAnalysis
    : Array.isArray(form.imageContext)
      ? form.imageContext
      : Array.isArray(form.images)
        ? form.images
        : Array.isArray(form.photoMetadata)
          ? form.photoMetadata
          : [];
  imageItems.forEach((item) => {
    const note = text(item?.note || item?.description || item?.ocrText || item?.alt);
    if (note) imageFacts.push(note);
  });
  return {
    facts: unique([topic, mainKeyword, memoText]).map((value) => ({
      field: "input",
      value,
      source: "request",
      confidence: 0.75,
      allowedAsExperience: VISIT_CUE_PATTERN.test(memoText)
    })),
    supported: unique([topic, mainKeyword, memoText]),
    visuallySupported: unique(imageFacts),
    unsupportedFields: ["exactPrice", "businessHours", "parkingEase", "waitingTime", "staffResponse", "tasteGuarantee", "quantityGuarantee"],
    memoText,
    experienceStatus: experienceStatus || (VISIT_CUE_PATTERN.test(memoText) ? "visited" : "unknown"),
    visitStatus: experienceStatus
      ? ["visited", "stayed", "used", "eaten", "attended", "purchased"].includes(experienceStatus)
        ? "visited"
        : "unknown"
      : VISIT_CUE_PATTERN.test(memoText)
        ? "visited"
        : "unknown"
  };
};

export const selectBestHumanQualityAttempt = (attempts = []) => {
  const normalized = attempts
    .map((attempt, index) => ({
      ...attempt,
      attempt: attempt.attempt ?? index + 1,
      humanQuality: attempt.humanQuality || evaluateHumanQuality(attempt)
    }))
    .sort((left, right) => {
      const scoreDiff = (right.humanQuality?.score || 0) - (left.humanQuality?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (left.attempt || 0) - (right.attempt || 0);
    });
  return normalized[0] || null;
};
