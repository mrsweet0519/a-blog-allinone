const text = (value) => String(value ?? "").trim();

const compact = (value = "") =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .toLowerCase();

const getBody = (result = {}) => {
  if (typeof result === "string") return result;
  if (typeof result.body === "string") return result.body;
  if (typeof result.blogBody === "string") return result.blogBody;
  if (Array.isArray(result.sections)) {
    return result.sections
      .map((section) => [section?.heading, ...(section?.paragraphs || [])].map(text).filter(Boolean).join("\n\n"))
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
};

const splitParagraphs = (body = "") =>
  String(body || "")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const tokenize = (value = "") =>
  String(value || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

const uniqueCount = (items = []) => new Set(items.map(compact).filter(Boolean)).size;

const countRepeatedParagraphs = (paragraphs = []) => {
  const seen = new Set();
  let repeated = 0;
  paragraphs.forEach((paragraph) => {
    const key = compact(paragraph);
    if (!key || key.length < 20) return;
    if (seen.has(key)) repeated += 1;
    seen.add(key);
  });
  return repeated;
};

const countPhotoMentions = (body = "") =>
  (String(body || "").match(/사진|이미지|화면|보이는|보였|시각|그림|캡처/gu) || []).length;

export const scoreBlogResultForComparison = ({ result = {}, primaryEntity = "", factMap = null } = {}) => {
  const title = text(result.finalTitle || result.selectedTitle || result.title || "");
  const body = getBody(result);
  const paragraphs = splitParagraphs(body);
  const factValues = Array.isArray(factMap?.facts)
    ? factMap.facts.map((fact) => text(fact?.value)).filter(Boolean)
    : [];
  const tokens = tokenize(body);
  const evidenceHits = factValues.filter((fact) => compact(fact) && compact(body).includes(compact(fact))).length;
  const paragraphValueCount = paragraphs.filter((paragraph) => uniqueCount(tokenize(paragraph)) >= 8).length;
  const repeatedParagraphCount = countRepeatedParagraphs(paragraphs);
  const entityHit = primaryEntity ? compact(`${title}\n${body}`).includes(compact(primaryEntity)) : false;

  return {
    titleNaturalness: title && !/정보\s*정리|기준\s*정리|체크\s*포인트|체험\s*흐름/u.test(title) ? 1 : 0,
    concreteFactCount: uniqueCount([...factValues, ...tokens.filter((token) => /\d|[A-Za-z]{2,}|[가-힣]{3,}/u.test(token))]),
    factualGroundingRatio: factValues.length > 0 ? Number((evidenceHits / factValues.length).toFixed(2)) : null,
    newInfoPerParagraph: paragraphs.length > 0 ? Number((paragraphValueCount / paragraphs.length).toFixed(2)) : 0,
    repeatedParagraphCount,
    humanToneSignal: /더라고요|있었어요|느껴졌|같아요|괜찮|궁금/u.test(body) ? 1 : 0,
    photoInfoUsageCount: countPhotoMentions(body),
    publishabilitySignal: entityHit && repeatedParagraphCount === 0 && paragraphs.length >= 3 ? 1 : 0
  };
};

export const compareBlogWriterResults = ({ rawLlmResult = {}, finalDisplayedResult = {}, referenceResult = "", primaryEntity = "", factMap = null } = {}) => {
  const raw = scoreBlogResultForComparison({ result: rawLlmResult, primaryEntity, factMap });
  const final = scoreBlogResultForComparison({ result: finalDisplayedResult, primaryEntity, factMap });
  const reference = scoreBlogResultForComparison({ result: referenceResult, primaryEntity, factMap });
  const rawBodyLength = getBody(rawLlmResult).replace(/\s+/g, "").length;
  const finalBodyLength = getBody(finalDisplayedResult).replace(/\s+/g, "").length;

  return {
    raw,
    final,
    reference,
    diagnosis:
      raw.publishabilitySignal >= reference.publishabilitySignal && final.publishabilitySignal < raw.publishabilitySignal
        ? "post-processing-risk"
        : raw.publishabilitySignal < reference.publishabilitySignal
          ? "prompt-model-context-risk"
          : "no-obvious-regression",
    lengthDelta: finalBodyLength - rawBodyLength
  };
};
