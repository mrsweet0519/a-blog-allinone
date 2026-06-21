const text = (value) => String(value ?? "").trim();

const getBody = (result = {}) => {
  if (!result || typeof result !== "object") return "";
  if (typeof result.body === "string") return result.body;
  if (typeof result.blogBody === "string") return result.blogBody;
  if (Array.isArray(result.sections)) {
    return result.sections
      .map((section) => {
        const heading = text(section?.heading);
        const paragraphs = Array.isArray(section?.paragraphs)
          ? section.paragraphs.map(text).filter(Boolean)
          : [];
        return [heading, ...paragraphs].filter(Boolean).join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
};

const hashText = (value = "") => {
  let hash = 0x811c9dc5;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const countChangedCharacters = (left = "", right = "") => {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  const length = Math.max(leftChars.length, rightChars.length);
  if (length === 0) return 0;
  let changed = Math.abs(leftChars.length - rightChars.length);
  const shared = Math.min(leftChars.length, rightChars.length);
  for (let index = 0; index < shared; index += 1) {
    if (leftChars[index] !== rightChars[index]) changed += 1;
  }
  return changed;
};

export const summarizeResultDiff = ({ rawResult = {}, finalResult = {}, postProcessingSteps = [] } = {}) => {
  const rawBody = getBody(rawResult);
  const finalBody = getBody(finalResult);
  const rawLength = Array.from(rawBody.replace(/\s+/g, "")).length;
  const finalLength = Array.from(finalBody.replace(/\s+/g, "")).length;
  const maxLength = Math.max(Array.from(rawBody).length, Array.from(finalBody).length, 1);
  const changedCharacterRatio = Number((countChangedCharacters(rawBody, finalBody) / maxLength).toFixed(4));

  return {
    rawBodyLength: rawLength,
    finalBodyLength: finalLength,
    rawBodyHash: hashText(rawBody),
    finalBodyHash: hashText(finalBody),
    changedCharacterRatio,
    postProcessingSteps
  };
};

export const createBlogWriterTrace = ({
  engine = "fallback",
  judgeEngine = "deterministic",
  isMock = false,
  promptVersion = "",
  writerProfile = "",
  imageAnalysis = null,
  factMap = null,
  postProcessingSteps = [],
  qualityScore = 0,
  publishReady = false
} = {}) => {
  const imageItems = imageAnalysis?.items || [];
  return {
    engine,
    judgeEngine,
    isMock: Boolean(isMock),
    promptVersion,
    writerProfile,
    visionMode: imageAnalysis?.mode || imageAnalysis?.analysisMode || "none",
    factCount: Array.isArray(factMap?.facts) ? factMap.facts.length : 0,
    experienceFactCount: Array.isArray(factMap?.experienceEvidence) ? factMap.experienceEvidence.length : 0,
    imageFactCount: Array.isArray(factMap?.imageEvidence)
      ? factMap.imageEvidence.length
      : imageItems.reduce((total, item) => total + (Array.isArray(item.visibleElements) ? item.visibleElements.length : 0), 0),
    postProcessingSteps,
    qualityScore: Number(qualityScore) || 0,
    publishReady: Boolean(publishReady)
  };
};

export const attachTraceDiagnostics = ({ result = {}, rawResult = {}, postProcessingSteps = [], trace = {} } = {}) => ({
  trace,
  rawFinalDiff: summarizeResultDiff({
    rawResult,
    finalResult: result,
    postProcessingSteps
  })
});
