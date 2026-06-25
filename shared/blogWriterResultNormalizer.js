const text = (value) => String(value ?? "").trim();

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();

const uniqueStrings = (values = []) => {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const cleaned = text(typeof value === "string" ? value : value?.title || value?.text || value?.value || "");
    const key = compact(cleaned);
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });
  return result;
};

const nestedCandidates = (apiResponse = {}) => [
  apiResponse,
  apiResponse?.result,
  apiResponse?.draft,
  apiResponse?.data,
  apiResponse?.data?.result,
  apiResponse?.data?.draft,
  apiResponse?.result?.draft,
  apiResponse?.contentPackage,
  apiResponse?.result?.contentPackage,
  apiResponse?.draft?.contentPackage,
  apiResponse?.data?.contentPackage
].filter((item) => item && typeof item === "object");

const normalizeParagraphs = (section = {}) => {
  const source = Array.isArray(section)
    ? section
    : section.paragraphs || section.paragraph || section.body || section.text || section.content || [];
  const values = Array.isArray(source) ? source : [source];
  return uniqueStrings(values);
};

export const normalizeBlogWriterSections = (sections = []) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((section) => {
      if (typeof section === "string") {
        return { heading: "", paragraphs: [text(section)].filter(Boolean), imageRefs: [] };
      }
      const heading = text(section?.heading ?? section?.title ?? section?.label ?? "");
      const paragraphs = normalizeParagraphs(section);
      const imageRefs = Array.isArray(section?.imageRefs || section?.images)
        ? uniqueStrings(section.imageRefs || section.images)
        : [];
      return { heading, paragraphs, imageRefs };
    })
    .filter((section) => section.heading || section.paragraphs.length > 0);
};

export const bodyFromBlogWriterSections = (sections = []) => {
  const seen = new Set();
  return normalizeBlogWriterSections(sections)
    .map((section) => {
      const parts = [section.heading, ...section.paragraphs].filter(Boolean);
      const deduped = parts.filter((part) => {
        const key = compact(part);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return deduped.join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
};

const normalizeFaq = (value = []) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      question: text(item?.question ?? item?.q ?? ""),
      answer: text(item?.answer ?? item?.a ?? "")
    }))
    .filter((item) => item.question && item.answer);
};

export const normalizeBlogWriterResult = (apiResponse = {}) => {
  const candidates = nestedCandidates(apiResponse);
  const titleCandidates = uniqueStrings(candidates.flatMap((item) => item.titleCandidates || item.titles || []));
  const finalTitle = text(
    candidates.map((item) => item.finalTitle || item.selectedTitle || item.finalRecommendedTitle).find((value) => text(value)) ||
      titleCandidates[0] ||
      ""
  );
  const sections = normalizeBlogWriterSections(
    candidates.map((item) => item.sections).find((value) => Array.isArray(value) && value.length > 0) || []
  );
  const body = text(
    candidates.map((item) => item.body || item.blogBody).find((value) => text(value)) ||
      bodyFromBlogWriterSections(sections)
  );
  const faq = normalizeFaq(
    candidates.map((item) => item.faq || item.faqItems).find((value) => Array.isArray(value) && value.length > 0) || []
  );
  const hashtags = uniqueStrings(candidates.flatMap((item) => item.hashtags || []));
  const images = candidates.map((item) => item.images).find((value) => Array.isArray(value)) || [];

  return {
    finalTitle,
    titleCandidates,
    sections,
    body,
    faq,
    hashtags,
    images
  };
};

export const validateNormalizedBlogWriterResult = (result = {}, { informationLevel = "high" } = {}) => {
  const finalTitle = text(result.finalTitle);
  const body = text(result.body);
  const titleCandidates = Array.isArray(result.titleCandidates) ? result.titleCandidates.filter((item) => text(item)) : [];
  const lowInformation = informationLevel === "low";
  const minBodyLength = lowInformation ? 100 : 300;
  const errors = [];
  if (finalTitle.length < 10) errors.push("missingTitle");
  if (!body) errors.push("missingBody");
  if (body && body.length < minBodyLength) errors.push("shortBody");
  if (!lowInformation && titleCandidates.length < 1) errors.push("missingTitleCandidates");
  return {
    valid: errors.length === 0,
    errors,
    finalTitleLength: finalTitle.length,
    bodyLength: body.length,
    titleCandidatesCount: titleCandidates.length,
    minBodyLength
  };
};
