const text = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");

const ENTITY_TAIL_PATTERN =
  /\s*(?:내돈내산\s*)?(?:솔직\s*)?(?:방문\s*)?(?:사용\s*)?(?:착용\s*)?(?:숙박\s*)?(?:수강\s*)?(?:체험\s*)?(?:구매\s*)?(?:이용\s*)?(?:후기|리뷰|정보|추천|정리|방법|가이드)$/u;

export const normalizeEntityDisplay = (value = "") => {
  let current = text(value);

  for (let index = 0; index < 3; index += 1) {
    const next = current.replace(ENTITY_TAIL_PATTERN, "").trim();
    if (next === current) break;
    current = next;
  }

  return current;
};

export const normalizeEntityKey = (value = "") =>
  normalizeEntityDisplay(value)
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const unique = (values = []) => {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const cleaned = text(value);
    const key = normalizeEntityKey(cleaned);
    if (!cleaned || !key || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result;
};

export const getEntityAliases = (primaryEntity = "", aliases = []) => {
  const display = text(primaryEntity);
  const stripped = normalizeEntityDisplay(display);
  const noSpace = stripped.replace(/\s+/gu, "");
  const spacedBranch = stripped.replace(/([가-힣A-Za-z0-9]+)(본점|지점|분점)$/u, "$1 $2");
  const compactBranch = stripped.replace(/\s+(본점|지점|분점)$/u, "$1");

  return unique([display, stripped, noSpace, spacedBranch, compactBranch, ...aliases]);
};

export const containsEntity = (value = "", primaryEntity = "", aliases = []) => {
  const valueKey = normalizeEntityKey(value);
  if (!valueKey) return false;

  return getEntityAliases(primaryEntity, aliases).some((alias) => {
    const aliasKey = normalizeEntityKey(alias);
    return aliasKey && valueKey.includes(aliasKey);
  });
};

export const getEntityCoverage = ({
  primaryEntity = "",
  title = "",
  titleCandidates = [],
  body = "",
  aliases = []
} = {}) => {
  const normalizedBody = text(body);
  const paragraphs = normalizedBody.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
  const firstParagraph = paragraphs.find((paragraph) => !/^\[사진 삽입:/u.test(paragraph)) || paragraphs[0] || "";
  const firstSentence = firstParagraph.split(/(?<=[.!?。])\s+/u)[0] || firstParagraph;
  const candidateHits = titleCandidates.filter((candidate) => containsEntity(candidate, primaryEntity, aliases)).length;

  return {
    finalTitle: containsEntity(title, primaryEntity, aliases),
    titleCandidateHits: candidateHits,
    titleCandidateTotal: titleCandidates.length,
    openingSentence: containsEntity(firstSentence, primaryEntity, aliases),
    openingParagraph: containsEntity(firstParagraph, primaryEntity, aliases),
    body: containsEntity(normalizedBody, primaryEntity, aliases),
    firstSentence,
    firstParagraph,
    canonicalAliases: getEntityAliases(primaryEntity, aliases)
  };
};

export const hasEntityCoverageFailure = (coverage = {}) =>
  !coverage.finalTitle || !coverage.openingSentence || !coverage.body;
