import {
  ArrowDown,
  ArrowUp,
  Check,
  Clipboard,
  Image,
  Loader2,
  PackageSearch,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import StatusBadge from "../components/StatusBadge.jsx";
import { extractCaptureTextFromImage } from "../lib/captureOcr.js";
import {
  createProductReviewDraft,
  extractProductInfoFieldsWithMetaFromText,
  parseSubKeywords
} from "../lib/productReviewGenerator.js";
import { saveDraft } from "../lib/localDrafts.js";

const initialForm = {
  productName: "",
  brandName: "",
  mainKeyword: "",
  subKeywords: "",
  productInfoText: "",
  category: "",
  ingredients: "",
  composition: "",
  usage: "",
  price: "",
  capacity: "",
  features: "",
  cautions: "",
  purchaseNotes: "",
  experienceMemo: "",
  emphasisPoints: "",
  avoidWords: "무조건, 보장, 완벽, 즉시효과",
  tone: "친근한",
  targetCharCount: "2500",
  selectedTitle: ""
};

const createGenerationId = () => `naver-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createEmptyResult = (generationId = "") => ({
  generationId,
  resultMode: "",
  category: "",
  titles: [],
  titleCandidates: [],
  finalTitle: "",
  selectedTitle: "",
  primaryEntity: "",
  mainKeyword: "",
  subKeywords: [],
  searchIntent: null,
  experienceStatus: "",
  informationSufficiency: null,
  factMap: null,
  imageAnalysis: null,
  writerPlan: null,
  body: "",
  faq: [],
  hashtags: [],
  imageSuggestions: [],
  outline: [],
  thumbnailTexts: [],
  searchKeywords: [],
  closingParagraph: "",
  contentPackage: null,
  bodyLength: 0,
  qualityScore: null,
  qualityIssues: [],
  qualityChecks: [],
  regeneratedTitles: [],
  titleRegenerationState: "idle"
});

const toneOptions = ["친근한", "차분한", "전문적인", "활기찬"];
const reviewCategoryOptions = [
  { value: "", label: "자동 추정" },
  { value: "product", label: "상품 후기" },
  { value: "restaurant", label: "맛집 후기" },
  { value: "underwear", label: "속옷 후기" },
  { value: "store", label: "매장 후기" },
  { value: "education", label: "교육 후기" },
  { value: "hospital", label: "병원 후기" },
  { value: "service", label: "서비스 후기" },
  { value: "travel", label: "여행 후기" },
  { value: "experience", label: "체험 후기" },
  { value: "kids-place", label: "아이 동반 장소 후기" },
  { value: "place", label: "장소 후기" }
];
const MIN_TARGET_CHAR_COUNT = 800;
const MAX_TARGET_CHAR_COUNT = 4000;
const MAX_REVIEW_IMAGES = 10;
const MAX_VISION_IMAGES = 3;
const MAX_VISION_IMAGE_BYTES = 1_600_000;
const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

const fieldLabels = [
  ["productName", "상품명"],
  ["brandName", "브랜드명"],
  ["features", "주요 특징"],
  ["ingredients", "주요 성분/원료"],
  ["composition", "구성"],
  ["usage", "사용법/섭취법"],
  ["price", "가격"],
  ["capacity", "용량"],
  ["cautions", "주의사항"],
  ["purchaseNotes", "구매 전 확인할 점"]
];

const createInitialFieldMeta = (reason = "아직 이미지에서 읽은 정보가 없습니다.") =>
  Object.fromEntries(
    fieldLabels.map(([field]) => [
      field,
      {
        status: "읽지 못함",
        confidence: 0,
        reason,
        source: ""
      }
    ])
  );

const infoFieldKeys = new Set(fieldLabels.map(([field]) => field));

const stripImageMarkers = (body = "") =>
  String(body || "")
    .replace(/\n{0,2}\[여기에 이미지 \d+을 넣어주세요[^\]]*\]/gu, "")
    .replace(/\n{0,2}\[사진 삽입:[^\]]+\]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const formatKeyValueItems = (items = []) =>
  items.map(([label, value]) => `- ${label}: ${value}`).join("\n");

const formatObjectSummary = (value = {}) =>
  Object.entries(value)
    .map(([label, item]) => `- ${label}: ${item}`)
    .join("\n");

const formatFaqItems = (items = []) =>
  items.map((item, index) => `Q${index + 1}. ${item.question}\nA. ${item.answer}`).join("\n\n");

const formatChecklistItems = (items = []) =>
  items.map((item) => `- ${item.label}: ${item.detail}`).join("\n");

const getCurrentPackageData = (result = {}) => {
  const packageData = result.contentPackage;
  if (!packageData) return {};
  if (result.generationId && packageData.generationId && result.generationId !== packageData.generationId) return {};
  return packageData;
};

const getResultTitleCandidates = (result = {}) => {
  const packageData = getCurrentPackageData(result);
  return result.titleCandidates || result.titles || packageData.titleCandidates || [];
};

const getResultFinalTitle = (result = {}) => {
  const titleCandidates = getResultTitleCandidates(result);
  const packageData = getCurrentPackageData(result);
  return result.finalTitle || result.selectedTitle || packageData.finalRecommendedTitle || titleCandidates[0] || "";
};

const getResultBody = (result = {}) => {
  const packageData = getCurrentPackageData(result);
  return result.body || packageData.blogBody || "";
};

const getResultMainKeyword = (result = {}) => {
  const packageData = getCurrentPackageData(result);
  return result.mainKeyword || packageData.mainKeyword || "";
};

const normalizeReviewResult = (draft = {}, generationId = "", sourcePayload = null) => {
  const nextGenerationId = generationId || draft.generationId || draft.contentPackage?.generationId || "";
  const packageData = draft.contentPackage || {};
  const titleCandidates = draft.titleCandidates || draft.titles || packageData.titleCandidates || [];
  const finalTitle = draft.finalTitle || draft.selectedTitle || packageData.finalRecommendedTitle || titleCandidates[0] || "";
  const body = draft.body || packageData.blogBody || "";
  const mainKeyword = draft.mainKeyword || packageData.mainKeyword || "";
  const bodyLength = body.replace(/\s+/g, "").length;
  const qualityScore = draft.qualityScore ?? packageData.qualityScore ?? null;
  const qualityIssues = draft.qualityIssues || packageData.qualityIssues || [];
  const qualityChecks = draft.qualityChecks || packageData.qualityChecks || [];
  const blogWriterQuality = draft.blogWriterQuality || packageData.blogWriterQuality || null;
  const engine = draft.engine || packageData.engine || (draft.generationRoute === "llm" ? "llm" : "fallback");
  const resultMode = draft.resultMode || packageData.resultMode || draft.summary?.resultMode || "";
  const primaryEntity = draft.primaryEntity || packageData.primaryEntity || packageData.blogWriterAnalysis?.primaryEntity || "";
  const subKeywords = draft.subKeywords || packageData.subKeywords || packageData.blogWriterAnalysis?.subKeywords || [];
  const searchIntent = draft.searchIntent || packageData.searchIntent || packageData.blogWriterAnalysis?.searchIntent || null;
  const experienceStatus = draft.experienceStatus || packageData.experienceStatus || packageData.blogWriterAnalysis?.experienceStatus || "";
  const informationSufficiency =
    draft.informationSufficiency || packageData.informationSufficiency || packageData.blogWriterAnalysis?.informationSufficiency || null;
  const factMap = draft.factMap || packageData.factMap || null;
  const imageAnalysis = draft.imageAnalysis || packageData.imageAnalysis || null;
  const writerPlan = draft.writerPlan || packageData.writerPlan || null;
  const faq = draft.faq || draft.faqItems || packageData.faqItems || [];
  const targetLengthContract = draft.targetLengthContract || packageData.targetLengthContract || null;
  const requestedTargetCharCount =
    draft.requestedTargetCharCount ||
    packageData.requestedTargetCharCount ||
    targetLengthContract?.requestedTargetCharCount ||
    null;
  const effectiveTargetCharCount =
    draft.effectiveTargetCharCount ||
    packageData.effectiveTargetCharCount ||
    targetLengthContract?.effectiveTargetCharCount ||
    packageData.targetLengthRange?.target ||
    packageData.targetCharCount ||
    null;
  const actualCharCount =
    draft.actualCharCount ||
    packageData.actualCharCount ||
    targetLengthContract?.actualCharCount ||
    Array.from(body).length;
  const summary = {
    ...(packageData.summary || {}),
    ...(draft.summary || {}),
    engine,
    resultMode,
    bodyLength,
    targetCharCount:
      draft.summary?.targetCharCount ||
      packageData.summary?.targetCharCount ||
      packageData.targetLengthRange?.target ||
      packageData.targetCharCount ||
      effectiveTargetCharCount,
    requestedTargetCharCount,
    effectiveTargetCharCount,
    actualCharCount,
    targetComplianceRatio:
      draft.targetComplianceRatio ||
      packageData.targetComplianceRatio ||
      targetLengthContract?.targetComplianceRatio ||
      null,
    targetAdjustmentReason:
      draft.targetAdjustmentReason ||
      packageData.targetAdjustmentReason ||
      targetLengthContract?.targetAdjustmentReason ||
      ""
  };

  return {
    ...draft,
    generationId: nextGenerationId,
    engine,
    resultMode,
    summary,
    finalTitle,
    selectedTitle: finalTitle,
    titleCandidates,
    titles: titleCandidates,
    primaryEntity,
    mainKeyword,
    subKeywords,
    searchIntent,
    experienceStatus,
    informationSufficiency,
    factMap,
    imageAnalysis,
    writerPlan,
    targetLengthContract,
    requestedTargetCharCount,
    effectiveTargetCharCount,
    actualCharCount,
    targetAdjustmentReason: summary.targetAdjustmentReason,
    targetComplianceRatio: summary.targetComplianceRatio,
    body,
    faq,
    bodyLength,
    qualityScore,
    qualityIssues,
    qualityChecks,
    blogWriterQuality,
    sourcePayload: sourcePayload || draft.sourcePayload || null,
    contentPackage: draft.contentPackage
      ? {
          ...draft.contentPackage,
          generationId: nextGenerationId,
          finalRecommendedTitle: finalTitle,
          titleCandidates,
          primaryEntity,
          mainKeyword,
          subKeywords,
          resultMode,
          searchIntent,
          experienceStatus,
          informationSufficiency,
          factMap,
          imageAnalysis,
          writerPlan,
          targetLengthContract,
          requestedTargetCharCount,
          effectiveTargetCharCount,
          actualCharCount,
          targetAdjustmentReason: summary.targetAdjustmentReason,
          targetComplianceRatio: summary.targetComplianceRatio,
          blogBody: body,
          faqItems: faq,
          engine,
          actualBodyLength: bodyLength,
          summary,
          qualityScore,
          qualityIssues,
          qualityChecks,
          blogWriterQuality
        }
      : null
  };
};

const resultToClipboard = (result, { includeImageMarkers = true } = {}) => {
  const packageData = getCurrentPackageData(result);
  const finalTitle = getResultFinalTitle(result);
  const body = getResultBody(result);
  const hashtags = packageData.hashtags || result.hashtags || [];
  const faqItems = packageData.faqItems || [];

  if (packageData) {
    return [
      "최종 추천 제목",
      finalTitle,
      "",
      "블로그 본문",
      includeImageMarkers ? body : stripImageMarkers(body),
      "",
      ...(faqItems.length > 0 ? ["FAQ", formatFaqItems(faqItems), ""] : []),
      "해시태그",
      hashtags.join(" ")
    ]
      .filter((line) => line !== undefined && line !== null)
      .join("\n")
      .trim();
  }

  return [
    "최종 추천 제목",
    finalTitle,
    "",
    "블로그 본문",
    includeImageMarkers ? body : stripImageMarkers(body),
    "",
    "해시태그",
    hashtags.join(" ")
  ]
    .filter((line) => line !== undefined && line !== null)
    .join("\n")
    .trim();
};

const imageKeywordsToClipboard = (items = []) =>
  items
    .map((item, index) =>
      [
        `${item.label || `추천 위치 ${index + 1}`}. ${item.title}`,
        item.description,
        item.marker
      ].filter(Boolean).join("\n")
    )
    .filter(Boolean)
    .join("\n\n");

const linesToClipboard = (items = []) =>
  items
    .map((item, index) => `${index + 1}. ${item}`)
    .filter(Boolean)
    .join("\n");

const createImageItem = (file, source = "upload") => ({
  id: `review-image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  file,
  url: URL.createObjectURL(file),
  name: file.name || (source === "paste" ? "붙여넣은 캡처 이미지" : "상품 상세 이미지"),
  source,
  note: "",
  ocrText: "",
  ocrStatus: "idle",
  message: "",
  warnings: []
});

const readImageAsDataUrl = (file) =>
  new Promise((resolve) => {
    if (!file || !supportedImageTypes.has(file.type) || file.size > MAX_VISION_IMAGE_BYTES) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });

const mergeTextBlocks = (...blocks) =>
  Array.from(
    new Set(
      blocks
        .join("\n")
        .split(/\n{1,}/u)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ).join("\n");

const normalizeTargetCharCountInput = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return "";

  return String(Math.min(Math.max(parsed, MIN_TARGET_CHAR_COUNT), MAX_TARGET_CHAR_COUNT));
};

const getPayloadTargetCharCount = (value) => {
  const normalized = normalizeTargetCharCountInput(value);
  return normalized ? Number.parseInt(normalized, 10) : undefined;
};

const formatCharCount = (value) =>
  Number.isFinite(Number(value)) ? `${Number(value).toLocaleString("ko-KR")}자` : "-";

const normalizeSignatureText = (value = "") => String(value ?? "").trim().replace(/\s+/g, " ");

const splitKeywordInput = (value = "") =>
  Array.from(
    new Set(
      String(value ?? "")
        .split(/[\n,/]+/u)
        .map((item) => normalizeMainKeywordInput(item))
        .filter(Boolean)
    )
  );

const createFormSignature = (formState = {}, imageItems = []) =>
  JSON.stringify({
    topic: normalizeSignatureText(formState.productName),
    mainKeyword: normalizeSignatureText(formState.mainKeyword),
    subKeywords: parseSubKeywords(formState.subKeywords, formState.mainKeyword).map(normalizeSignatureText),
    memo: normalizeSignatureText(formState.experienceMemo),
    photos: imageItems.map((item, index) => ({
      index,
      id: item.id,
      name: item.name,
      source: item.source,
      note: normalizeSignatureText(item.note),
      ocrText: normalizeSignatureText(item.ocrText)
    })),
    category: formState.category || "",
    tone: formState.tone || "",
    targetCharCount: normalizeTargetCharCountInput(formState.targetCharCount),
    avoidWords: normalizeSignatureText(formState.avoidWords)
  });

const reviewTopicTailPattern =
  /\s*(?:내돈내산\s*)?(?:솔직\s*)?(?:방문\s*후기|사용\s*후기|체험\s*후기|구매\s*후기|이용\s*후기|방문기|사용기|후기|리뷰|추천|정리|방법)$/u;

const mainKeywordTailPattern =
  /\s*(?:방문\s*후기|사용\s*후기|체험\s*후기|구매\s*후기|이용\s*후기|후기|리뷰|정리|추천|방법)$/u;

const stripReviewTopicTail = (value = "") => {
  let current = String(value ?? "").trim();

  for (let index = 0; index < 3; index += 1) {
    const next = current.replace(reviewTopicTailPattern, "").trim();
    if (next === current) break;
    current = next;
  }

  return current;
};

const stripMainKeywordParticle = (value = "") => {
  const current = String(value ?? "").trim();
  if (!current) return "";

  if (/의의$/u.test(current)) return current.slice(0, -1).trim();
  if (/\s의$/u.test(current)) return current.replace(/\s의$/u, "").trim();

  return current
    .replace(/\s*(?:에서|으로|로)$/u, "")
    .replace(/\s*(?:은|는|이|가|을|를)$/u, "")
    .trim();
};

const normalizeMainKeywordInput = (value = "") => {
  let current = String(value ?? "").trim().replace(/\s+/g, " ");

  for (let index = 0; index < 5; index += 1) {
    const next = stripMainKeywordParticle(current.replace(mainKeywordTailPattern, "").trim());
    if (next === current) break;
    current = next;
  }

  return current.replace(/\s+/g, " ").trim();
};

const deriveMainKeywordFromTopic = (value = "") =>
  normalizeMainKeywordInput(
    stripReviewTopicTail(value)
      .replace(/\s*(?:직접\s*)?(?:써본|사용해본|다녀온|방문한|참여한)\s*$/u, "")
      .replace(/\s+/g, " ")
      .trim()
  );

export default function ProductReviewMaker() {
  const pasteAreaRef = useRef(null);
  const imagesRef = useRef([]);
  const activeGenerationIdRef = useRef("");
  const [form, setForm] = useState(initialForm);
  const [images, setImages] = useState([]);
  const [result, setResult] = useState(() => createEmptyResult());
  const [status, setStatus] = useState("idle");
  const [ocrStatus, setOcrStatus] = useState("idle");
  const [ocrMessage, setOcrMessage] = useState("");
  const [ocrWarnings, setOcrWarnings] = useState([]);
  const [copied, setCopied] = useState("");
  const [productInfoOpen, setProductInfoOpen] = useState(false);
  const [rawTextOpen, setRawTextOpen] = useState(false);
  const [fieldMeta, setFieldMeta] = useState(() => createInitialFieldMeta());
  const [draftId, setDraftId] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [lastGeneratedSignature, setLastGeneratedSignature] = useState("");

  const reviewTopic = useMemo(
    () => form.productName.trim() || form.mainKeyword.trim(),
    [form.mainKeyword, form.productName]
  );
  const keywordParts = useMemo(() => splitKeywordInput(form.mainKeyword), [form.mainKeyword]);
  const resolvedMainKeyword = useMemo(
    () => keywordParts[0] || deriveMainKeywordFromTopic(form.productName),
    [form.productName, keywordParts]
  );
  const subKeywords = useMemo(
    () => parseSubKeywords([...keywordParts.slice(1), ...parseSubKeywords(form.subKeywords, resolvedMainKeyword)], resolvedMainKeyword),
    [form.subKeywords, keywordParts, resolvedMainKeyword]
  );
  const currentFormSignature = useMemo(() => createFormSignature(form, images), [form, images]);
  const isReady = useMemo(() => Boolean(reviewTopic), [reviewTopic]);
  const hasResult = Boolean(result.body);
  const isReading = ocrStatus === "reading" || images.some((item) => item.ocrStatus === "reading");
  const hasChangedSinceGeneration = Boolean(
    hasResult && lastGeneratedSignature && currentFormSignature !== lastGeneratedSignature
  );
  const generateButtonLabel = !reviewTopic
    ? "글 주제를 입력해주세요"
    : status === "generating"
    ? "생성 중..."
    : hasResult
    ? hasChangedSinceGeneration
      ? "변경 내용으로 다시 만들기"
      : "다시 만들기"
    : "블로그 초안 만들기";
  const isGenerateButtonEmphasized = !hasResult || hasChangedSinceGeneration;

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(
    () => () => {
      imagesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    },
    []
  );

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (infoFieldKeys.has(key)) {
      setFieldMeta((current) => ({
        ...current,
        [key]: value.trim()
          ? {
              status: "확인됨",
              confidence: 1,
              reason: "사용자가 직접 입력하거나 수정했습니다.",
              source: value.trim()
            }
          : {
              status: "읽지 못함",
              confidence: 0,
              reason: "값이 비어 있습니다.",
              source: ""
            }
      }));
    }
    setStatus("idle");
    setDraftId("");
    setDraftMessage("");
  };

  const appendImages = (files, source = "upload") => {
    const accepted = Array.from(files).filter((file) => supportedImageTypes.has(file.type));

    if (accepted.length === 0) {
      setOcrWarnings(["PNG, JPG, WEBP 형식의 이미지만 추가할 수 있습니다."]);
      return;
    }

    setImages((current) => {
      const remainingSlots = Math.max(0, MAX_REVIEW_IMAGES - current.length);
      const nextFiles = accepted.slice(0, remainingSlots);
      const overflowCount = accepted.length - nextFiles.length;

      if (overflowCount > 0) {
        setOcrWarnings([`사진은 최대 ${MAX_REVIEW_IMAGES}장까지 넣을 수 있어요. ${overflowCount}장은 제외했습니다.`]);
      } else {
        setOcrWarnings([]);
      }

      return [...current, ...nextFiles.map((file) => createImageItem(file, source))];
    });
    setOcrStatus("idle");
    setOcrMessage("사진이 추가되었습니다.");
    setDraftId("");
    setDraftMessage("");
  };

  const handleImageChange = (event) => {
    appendImages(event.target.files || [], "upload");
    event.target.value = "";
  };

  const handlePaste = (event) => {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (files.length === 0) return;

    event.preventDefault();
    appendImages(files, "paste");
  };

  const handleDrop = (event) => {
    event.preventDefault();
    appendImages(event.dataTransfer?.files || [], "drop");
  };

  const removeImage = (id) => {
    setImages((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((item) => item.id !== id);
    });
  };

  const moveImage = (id, direction) => {
    setImages((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + direction;

      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const updateImageNote = (id, note) => {
    setImages((current) => current.map((item) => (item.id === id ? { ...item, note } : item)));
  };

  const updateImageOcrState = (id, updates) => {
    setImages((current) => current.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const applyExtractedInfo = (combinedText) => {
    const extraction = extractProductInfoFieldsWithMetaFromText(combinedText);
    const extractedFields = extraction.fields;

    setForm((current) => {
      const next = {
        ...current,
        productInfoText: mergeTextBlocks(current.productInfoText, combinedText)
      };

      fieldLabels.forEach(([field]) => {
        if (!next[field] && extractedFields[field]) {
          next[field] = extractedFields[field];
        }
      });

      return next;
    });

    setFieldMeta((current) => ({
      ...current,
      ...extraction.meta
    }));

    return {
      filledCount: Object.values(extractedFields).filter((value) => value.trim()).length,
      reviewCount: Object.values(extraction.meta).filter((item) => item.status === "확인 필요").length
    };
  };

  const getImageContext = async () => {
    const visionDataUrls = await Promise.all(
      images.slice(0, MAX_VISION_IMAGES).map((item) => readImageAsDataUrl(item.file))
    );

    return images.map((item, index) => ({
      index: index + 1,
      name: item.name,
      source: item.source,
      note: item.note,
      ocrText: item.ocrText,
      mediaType: item.file?.type || "",
      size: item.file?.size || 0,
      dataUrl: index < MAX_VISION_IMAGES ? visionDataUrls[index] || "" : ""
    }));
  };

  const createReviewPayload = async ({ selectedTitle = "", generationId = result.generationId } = {}) => {
    const imageContext = await getImageContext();
    const photoMetadata = imageContext.map((item) => ({
      index: item.index,
      name: item.name,
      source: item.source,
      note: item.note,
      ocrText: item.ocrText,
      mediaType: item.mediaType,
      size: item.size,
      dataUrl: item.dataUrl
    }));
    const imageText = mergeTextBlocks(
      ...imageContext.map((item) =>
        [
          item.note ? `사진 메모: ${item.note}` : "",
          item.ocrText ? `사진에서 읽은 내용: ${item.ocrText}` : ""
        ].filter(Boolean).join("\n")
      )
    );
    const topic = reviewTopic || form.productName || resolvedMainKeyword;
    const mainKeyword = resolvedMainKeyword || topic;
    const targetCharCount = getPayloadTargetCharCount(form.targetCharCount);
    const joinedKeywords = [mainKeyword, ...subKeywords].filter(Boolean).join(", ");

    return {
      ...form,
      topic,
      memory: form.experienceMemo,
      memo: form.experienceMemo,
      productName: form.productName || topic,
      mainKeyword,
      keyword: joinedKeywords || mainKeyword,
      subKeywords,
      productInfoText: mergeTextBlocks(form.productInfoText, imageText),
      selectedTitle: selectedTitle || "",
      targetCharCount,
      targetLength: targetCharCount,
      generationId,
      images: photoMetadata,
      photos: photoMetadata,
      photoMetadata,
      imageContext,
      imageCount: images.length
    };
  };

  const createLocalFallbackDraft = (payload, generationId) => {
    const fallbackDraft = createProductReviewDraft(payload);

    return normalizeReviewResult(
      {
        ...fallbackDraft,
        generationId,
        generationRoute: "local-fallback",
        engine: "fallback",
        summary: {
          ...(fallbackDraft.summary || {}),
          engine: "fallback"
        },
        llm: {
          used: false,
          reason: "local-fallback"
        }
      },
      generationId,
      payload
    );
  };

  const requestBlogDraft = async (payload, generationId) => {
    try {
      const response = await fetch("/api/generate-blog", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("blog-writer-api-unavailable");
      }

      const draft = await response.json();
      return normalizeReviewResult(
        {
          ...draft,
          generationId
        },
        generationId,
        payload
      );
    } catch {
      return createLocalFallbackDraft(payload, generationId);
    }
  };

  const extractInfoFromImages = async () => {
    if (images.length === 0) {
      setOcrStatus("manual");
      setOcrMessage("상품 이미지를 넣으면 읽은 내용을 확인할 수 있습니다.");
      return;
    }

    setOcrStatus("reading");
    setProductInfoOpen(true);
    setOcrMessage("이미지에서 상품 정보를 읽는 중...");
    setOcrWarnings([]);

    const extractedTexts = [];

    for (const item of images) {
      updateImageOcrState(item.id, {
        ocrStatus: "reading",
        message: "사진 속 글자 읽는 중",
        warnings: []
      });

      const ocrResult = await extractCaptureTextFromImage(item.file, {
        logger: (progress) => {
          if (progress?.status) {
            updateImageOcrState(item.id, { message: `사진 속 글자 읽는 중: ${progress.status}` });
          }
        }
      });

      const imageText = [ocrResult.text, item.note].filter(Boolean).join("\n");
      if (imageText) extractedTexts.push(imageText);

      updateImageOcrState(item.id, {
        ocrStatus: ocrResult.ok ? "done" : "manual",
        ocrText: ocrResult.text || "",
        message:
          ocrResult.message ||
          (ocrResult.ok ? "텍스트를 추출했습니다." : "수동 보정이 필요합니다."),
        warnings: ocrResult.warnings || []
      });
    }

    const combinedText = mergeTextBlocks(...extractedTexts);

    if (combinedText) {
      setProductInfoOpen(true);
      const extractionSummary = applyExtractedInfo(combinedText);

      if (extractionSummary.filledCount > 0) {
        setOcrStatus("done");
        setOcrMessage(
          extractionSummary.reviewCount > 0
            ? "이미지에서 읽은 정보를 정리했습니다. 확인 필요 항목은 직접 수정한 뒤 초안 생성에 반영해주세요."
            : "이미지에서 읽은 내용을 확인하고 필요한 부분만 수정해주세요. 수정한 내용은 초안 생성에 반영됩니다."
        );
      } else {
        setOcrStatus("manual");
        setOcrMessage("이미지에서 내용을 정확히 읽지 못했습니다. 필요한 정보만 직접 입력해도 초안을 만들 수 있습니다.");
      }
    } else {
      setOcrStatus("manual");
      setProductInfoOpen(true);
      setOcrMessage("이미지에서 내용을 정확히 읽지 못했습니다. 아래 영역에 상품 정보를 직접 입력해도 초안을 만들 수 있습니다.");
    }
  };

  const generateReview = async () => {
    if (!isReady) return;

    const generationId = createGenerationId();
    const generationSignature = currentFormSignature;
    activeGenerationIdRef.current = generationId;
    setResult(createEmptyResult(generationId));
    setForm((current) => ({ ...current, selectedTitle: "" }));
    setCopied("");
    setStatus("generating");
    setDraftId("");
    setDraftMessage("");

    const payload = await createReviewPayload({ selectedTitle: "", generationId });
    window.setTimeout(async () => {
      if (activeGenerationIdRef.current !== generationId) return;

      const draft = await requestBlogDraft(payload, generationId);
      if (activeGenerationIdRef.current !== generationId) return;

      setResult(draft);
      setForm((current) => ({ ...current, selectedTitle: draft.finalTitle }));
      setLastGeneratedSignature(generationSignature);
      setStatus("generated");
      setDraftId("");
      setDraftMessage("");
    }, 0);
  };

  const selectTitle = (title) => {
    setForm((current) => ({ ...current, selectedTitle: title }));
    setResult((current) => ({
      ...current,
      finalTitle: title,
      selectedTitle: title,
      contentPackage: current.contentPackage
        ? {
            ...current.contentPackage,
            generationId: current.generationId,
            finalRecommendedTitle: title
          }
        : current.contentPackage
    }));
    setStatus("generated");
    setDraftId("");
    setDraftMessage("");
  };

  const regenerateTitles = async () => {
    if (!hasResult) return;

    const currentBlogBody = getResultBody(result);
    const nextTitleVariantSeed = Number(result.contentPackage?.titleVariantSeed || 0) + 1;
    const basePayload = result.sourcePayload || (await createReviewPayload({ selectedTitle: "", generationId: result.generationId }));
    const draft = normalizeReviewResult(createProductReviewDraft({
      ...basePayload,
      selectedTitle: "",
      generationId: result.generationId,
      titleVariantSeed: nextTitleVariantSeed
    }), result.generationId, { ...basePayload, titleVariantSeed: nextTitleVariantSeed });
    const nextTitles = draft.titleCandidates || [];
    const nextFinalTitle = draft.finalTitle || nextTitles[0] || getResultFinalTitle(result);

    setForm((current) => ({ ...current, selectedTitle: nextFinalTitle }));
    setResult((current) => ({
      ...current,
      finalTitle: nextFinalTitle,
      titles: nextTitles,
      titleCandidates: nextTitles,
      regeneratedTitles: nextTitles,
      titleRegenerationState: "generated",
      selectedTitle: nextFinalTitle,
      body: currentBlogBody,
      bodyLength: currentBlogBody.replace(/\s+/g, "").length,
      generationId: current.generationId,
      sourcePayload: { ...basePayload, titleVariantSeed: nextTitleVariantSeed },
      contentPackage: current.contentPackage
        ? {
            ...current.contentPackage,
            generationId: current.generationId,
            titleCandidates: nextTitles,
            finalRecommendedTitle: nextFinalTitle,
            blogBody: currentBlogBody,
            mainKeyword: current.mainKeyword,
            titleVariantSeed: nextTitleVariantSeed
          }
        : current.contentPackage
    }));
    setStatus("generated");
    setCopied("");
    setDraftId("");
    setDraftMessage("");
  };

  const saveCurrentDraft = async () => {
    if (!hasResult) return;

    const saved = saveDraft(
      {
        ...(await createReviewPayload({ selectedTitle: getResultFinalTitle(result), generationId: result.generationId })),
        keyword: resolvedMainKeyword || reviewTopic,
        targetCharCount: getPayloadTargetCharCount(form.targetCharCount)
      },
      {
        ...result,
        selectedTopic: "원클릭 네이버 블로그 글쓰기",
        selectedTitleType: "후기형 초안"
      },
      draftId
    );

    setDraftId(saved.id);
    setDraftMessage("보관함에 저장했습니다.");
    setStatus("saved");
  };

  const copyText = async (mode) => {
    if (!hasResult) return;

    const currentPackageData = getCurrentPackageData(result);
    const finalTitle = getResultFinalTitle(result);
    const titleCandidates = getResultTitleCandidates(result);
    const blogBody = getResultBody(result);
    const mainKeyword = getResultMainKeyword(result) || reviewTopic;
    const hashtags = currentPackageData.hashtags || result.hashtags || [];
    const copyValueByMode = {
      mainKeyword,
      secondaryKeywords: linesToClipboard(currentPackageData?.secondaryKeywords || []),
      searchIntent: formatObjectSummary(currentPackageData?.searchIntentAnalysis || {}),
      homeFeed: formatObjectSummary(currentPackageData?.homeFeedClickPoint || {}),
      body: blogBody,
      titles: linesToClipboard(titleCandidates.slice(0, 5)),
      finalTitle,
      openings: linesToClipboard(currentPackageData?.openingSentenceCandidates || []),
      hashtags: hashtags.join(" "),
      thumbnail: linesToClipboard(result.thumbnailTexts),
      keywords: result.searchKeywords.join(", "),
      closing: result.closingParagraph,
      images: currentPackageData?.photoGuide
        ? currentPackageData.photoGuide.map((item, index) => `${index + 1}. ${item.marker}\n${item.guide}`).join("\n\n")
        : imageKeywordsToClipboard(result.imageSuggestions),
      info: formatKeyValueItems(currentPackageData?.infoSummary || []),
      recommended: linesToClipboard(currentPackageData?.recommendedFor || []),
      faq: formatFaqItems(currentPackageData?.faqItems || []),
      checklist: formatChecklistItems(currentPackageData?.finalChecklist || []),
      full: resultToClipboard(result, { includeImageMarkers: true })
    };
    const value = copyValueByMode[mode] || copyValueByMode.full;

    if (!value) return;

    await navigator.clipboard.writeText(value);
    setCopied(mode);
    setStatus("copied");
    window.setTimeout(() => setCopied((current) => (current === mode ? "" : current)), 1600);
  };

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-wide text-coral">원클릭 네이버 글쓰기</p>
          <h2 className="mt-2 max-w-xl text-[24px] font-bold leading-[1.18] tracking-normal text-ink sm:text-[28px]">
            <span className="block">사진과 메모로</span>
            <span className="block">네이버 블로그 초안을 만듭니다</span>
          </h2>
          <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-ink/58">
            글 주제와 기억나는 내용만 넣으면 제목, 본문, 해시태그까지 한 번에 정리됩니다.
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <UsageSteps />

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(340px,0.38fr)_minmax(0,0.62fr)]">
        <section className="min-w-0 rounded-[28px] bg-white/92 p-5 shadow-[0_18px_44px_rgba(31,36,40,0.045)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold tracking-wide text-moss/70">ONE CLICK</p>
              <h3 className="mt-1 text-xl font-bold leading-tight text-ink">사진 넣고 글 생성</h3>
            </div>
            <span className="rounded-full bg-[#fff8e6] px-3 py-1 text-xs font-bold text-moss">
              {reviewTopic ? "준비 완료" : "주제 입력"}
            </span>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[#fff8e6]/80 px-3.5 py-3 text-sm leading-6 text-ink/66">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/85 text-moss">
              <WandSparkles size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold leading-5 text-ink">
                사진과 기억나는 내용만 넣어보세요
              </p>
              <p className="mt-0.5 text-[13px] font-semibold leading-5 text-ink/58">
                제품명, 매장명, 방문 느낌처럼 짧은 메모만 있어도 블로그 후기 초안을 만들 수 있습니다.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <section className="rounded-2xl bg-[#fbfaf6] p-4">
              <StepLabel number="1" title="무엇에 대한 글인가요?" />
              <textarea
                value={form.productName}
                onChange={(event) => updateForm("productName", event.target.value)}
                rows={2}
                className="focus-ring mt-3 min-h-[76px] w-full resize-none rounded-2xl border border-line/40 bg-white px-4 py-3 text-lg font-bold leading-7 text-ink placeholder:text-ink/28"
                placeholder="예: 제품 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기"
              />
            </section>

            <section className="rounded-2xl bg-[#fbfaf6] p-4">
              <StepLabel number="2" title="메인 키워드" optional />
              <input
                value={form.mainKeyword}
                onChange={(event) => updateForm("mainKeyword", event.target.value)}
                className="focus-ring mt-3 min-h-11 w-full rounded-xl border border-line/40 bg-white px-3 text-sm font-semibold text-ink/82 placeholder:text-ink/30"
                placeholder="예: 상호명 / 상품명 / 강의명 / 장소명"
              />
              <p className="mt-1.5 text-xs font-semibold leading-5 text-ink/45">
                비워두면 글 주제와 메모에서 중심 키워드를 자동으로 추출합니다.
              </p>
            </section>

            <section className="rounded-2xl bg-[#fbfaf6] p-4">
              <StepLabel number="3" title="서브 키워드" optional />
              <input
                value={form.subKeywords}
                onChange={(event) => updateForm("subKeywords", event.target.value)}
                className="focus-ring mt-3 min-h-11 w-full rounded-xl border border-line/40 bg-white px-3 text-sm font-semibold text-ink/82 placeholder:text-ink/30"
                placeholder="예: 지역 키워드, 대표 특징, 이용 상황"
              />
              <p className="mt-1.5 text-xs font-semibold leading-5 text-ink/45">
                비워두면 글 주제와 메모에서 자동 추천합니다. 최대 3개까지 쉼표로 나눠 입력하세요.
              </p>
            </section>

            <section className="rounded-2xl bg-[#fbfaf6] p-4">
              <StepLabel number="4" title="기억나는 내용" optional />
              <textarea
                value={form.experienceMemo}
                onChange={(event) => updateForm("experienceMemo", event.target.value)}
                rows={4}
                className="focus-ring mt-3 w-full resize-y rounded-2xl border border-line/40 bg-white p-4 text-base leading-7 text-ink/82 placeholder:text-ink/32"
                placeholder="좋았던 점, 아쉬웠던 점, 아이 반응, 재방문 의사처럼 기억나는 말만 적어주세요."
              />
            </section>

            <section className="rounded-2xl bg-[#fbfaf6] p-4">
              <StepLabel number="5" title="사진 추가" optional />
              <div
                ref={pasteAreaRef}
                role="button"
                tabIndex={0}
                onPaste={handlePaste}
                onDrop={handleDrop}
                onDragOver={(event) => event.preventDefault()}
                onClick={() => pasteAreaRef.current?.focus()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") pasteAreaRef.current?.focus();
                }}
                className="focus-ring mt-3 rounded-2xl border border-dashed border-moss/30 bg-white px-4 py-5 transition hover:border-moss hover:bg-[#fffefa]"
              >
                <div className="flex flex-col items-center justify-center text-center">
                  <Upload size={26} className="text-moss" aria-hidden="true" />
                  <p className="mt-2 text-sm font-bold text-ink/72">
                    사진을 끌어오거나 클릭해서 추가하세요.
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-ink/48">
                    업로드 순서대로 본문에 사진 위치가 들어갑니다.
                  </p>
                  <label className="focus-ring mt-3 inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full bg-moss px-4 text-sm font-bold text-white transition hover:bg-[#456b61]">
                    사진 선택
                    <input
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleImageChange}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              {(ocrMessage || ocrWarnings.length > 0) && (
                <div className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs font-semibold leading-5 text-ink/50 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.04)]">
                  {ocrMessage && <p>{ocrMessage}</p>}
                  {ocrWarnings.length > 0 && (
                    <ul className="mt-1 grid gap-1 text-coral">
                      {ocrWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <ImageGrid
                images={images}
                onRemove={removeImage}
                onMove={moveImage}
                onNoteChange={updateImageNote}
                showDetails={false}
              />
            </section>

            <details className="rounded-2xl bg-white/70 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.045)]">
              <summary className="cursor-pointer list-none">
                <StepLabel number="6" title="고급 옵션" optional />
              </summary>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <FieldLabel>카테고리</FieldLabel>
                  <select
                    value={form.category}
                    onChange={(event) => updateForm("category", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line/70 bg-white px-3 text-sm"
                  >
                    {reviewCategoryOptions.map((option) => (
                      <option key={option.value || "auto"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <FieldLabel>글 톤</FieldLabel>
                  <select
                    value={form.tone}
                    onChange={(event) => updateForm("tone", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line/70 bg-white px-3 text-sm"
                  >
                    {toneOptions.map((tone) => (
                      <option key={tone} value={tone}>
                        {tone}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <FieldLabel>목표 글자수</FieldLabel>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={MIN_TARGET_CHAR_COUNT}
                    max={MAX_TARGET_CHAR_COUNT}
                    step="100"
                    value={form.targetCharCount}
                    onChange={(event) => updateForm("targetCharCount", event.target.value)}
                    onBlur={() =>
                      setForm((current) => ({
                        ...current,
                        targetCharCount: normalizeTargetCharCountInput(current.targetCharCount)
                      }))
                    }
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line/70 bg-white px-3 text-sm"
                    placeholder="예: 1800 / 2500 / 3200"
                  />
                  <p className="mt-1.5 text-xs font-semibold leading-5 text-ink/45">
                    800자~4000자 사이로 보정됩니다. 비우면 입력량에 맞춰 자동 추천합니다.
                  </p>
                </label>

                <label className="block sm:col-span-2">
                  <FieldLabel>피하고 싶은 표현</FieldLabel>
                  <input
                    value={form.avoidWords}
                    onChange={(event) => updateForm("avoidWords", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line/70 bg-white px-3 text-sm"
                    placeholder="예: 무조건, 보장, 대박"
                  />
                </label>
              </div>
            </details>

            <section className="rounded-2xl bg-[#fbfaf6] p-4">
              <StepLabel number="7" title="블로그 초안 만들기" />
              <button
                type="button"
                onClick={() => generateReview()}
                disabled={!isReady || status === "generating" || isReading}
                className={`focus-ring mt-3 inline-flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-base font-bold transition disabled:cursor-not-allowed disabled:bg-ink/25 disabled:text-white disabled:shadow-none ${
                  isGenerateButtonEmphasized
                    ? "bg-moss text-white shadow-[0_14px_28px_rgba(73,111,99,0.22)] hover:bg-[#456b61]"
                    : "bg-white text-moss shadow-[inset_0_0_0_1px_rgba(73,111,99,0.18)] hover:bg-[#fff8e6]"
                }`}
              >
                <WandSparkles size={19} aria-hidden="true" />
                {generateButtonLabel}
              </button>
            </section>
          </div>
        </section>

        <section className="min-w-0 rounded-[28px] bg-white/88 p-5 shadow-[0_18px_44px_rgba(31,36,40,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-moss">생성 결과</p>
              <h3 className="mt-1 text-lg font-bold">네이버 블로그 포스팅 초안</h3>
            </div>
            <PackageSearch size={22} className="text-moss" aria-hidden="true" />
          </div>

          {!hasResult && (
          <div className="mt-4 rounded-2xl bg-[#fbfaf6] px-4 py-4 text-left text-sm font-semibold leading-6 text-ink/55">
              <p className="font-bold text-ink/68">아직 생성된 초안이 없습니다.</p>
              <p className="mt-1">글 주제와 메모를 입력한 뒤 초안 만들기를 눌러주세요.</p>
            </div>
          )}

          {hasResult && (
            <div className="mt-5 space-y-5">
              <NaverResultSections
                key={result.generationId || "empty-result"}
                result={result}
                images={images}
                copied={copied}
                copyText={copyText}
                selectTitle={selectTitle}
                regenerateTitles={regenerateTitles}
                setResult={setResult}
                setForm={setForm}
              />

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    onClick={generateReview}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-white px-3 text-xs font-bold text-ink/55 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.06)] transition hover:text-moss"
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    다시 만들기
                  </button>
                  <button
                    type="button"
                    onClick={saveCurrentDraft}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-white px-3 text-xs font-bold text-ink/55 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.06)] transition hover:text-moss"
                  >
                    <Save size={14} aria-hidden="true" />
                    보관함 저장
                  </button>
                {draftMessage && (
                  <p className="text-xs font-bold text-moss">{draftMessage}</p>
                )}
              </div>

            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function NaverResultSections({ result, images = [], copied, copyText, selectTitle, regenerateTitles, setResult, setForm }) {
  const packageData = getCurrentPackageData(result);
  const titleCandidates = getResultTitleCandidates(result);
  const finalTitle = getResultFinalTitle(result);
  const blogBody = getResultBody(result);
  const hashtags = packageData.hashtags || result.hashtags || [];
  const mainKeyword = getResultMainKeyword(result);
  const actualCharCount = packageData.actualCharCount || result.actualCharCount || Array.from(blogBody).length;
  const requestedTargetCharCount =
    packageData.requestedTargetCharCount ||
    result.requestedTargetCharCount ||
    packageData.summary?.requestedTargetCharCount ||
    null;
  const effectiveTargetCharCount =
    packageData.effectiveTargetCharCount ||
    result.effectiveTargetCharCount ||
    packageData.summary?.effectiveTargetCharCount ||
    packageData.targetLengthRange?.target ||
    packageData.targetCharCount ||
    null;
  const targetAdjustmentReason =
    packageData.targetAdjustmentReason ||
    result.targetAdjustmentReason ||
    packageData.summary?.targetAdjustmentReason ||
    "";
  const additionalInfoHints = (packageData.additionalInfoHints || []).slice(0, 3);
  const faqItems = packageData.faqItems || [];
  const lowInformationNotice = Boolean(targetAdjustmentReason);

  const updateSelectedTitle = (title) => {
    setResult((current) => ({
      ...current,
      finalTitle: title,
      selectedTitle: title,
      contentPackage: current.contentPackage
        ? {
            ...current.contentPackage,
            generationId: current.generationId,
            finalRecommendedTitle: title
          }
        : current.contentPackage
    }));
    setForm((current) => ({ ...current, selectedTitle: title }));
  };

  const updateBody = (body) => {
    const nextBodyLength = body.replace(/\s+/g, "").length;
    setResult((current) => ({
      ...current,
      body,
      bodyLength: nextBodyLength,
      contentPackage: current.contentPackage
        ? {
            ...current.contentPackage,
            generationId: current.generationId,
            blogBody: body
          }
        : current.contentPackage
    }));
  };

  return (
    <div className="space-y-4" data-generation-engine={result.engine || packageData.engine || ""}>
      <div className="sticky top-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/94 px-4 py-3 shadow-[0_12px_28px_rgba(31,36,40,0.075)] backdrop-blur">
        <div>
          <p className="text-xs font-bold text-moss">편집 가능한 원고</p>
          <p className="mt-0.5 text-xs font-semibold text-ink/48">
            메인 키워드 {mainKeyword || "자동 추출 중"} · 요청 {formatCharCount(requestedTargetCharCount)} · 현재 {formatCharCount(actualCharCount)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => copyText("full")}
          className="focus-ring inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-moss px-4 text-sm font-bold text-white transition hover:bg-[#456b61]"
        >
          {copied === "full" ? <Check size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}
          {copied === "full" ? "전체 복사됨" : "전체 복사"}
        </button>
      </div>

      <article className="rounded-[30px] bg-white p-5 shadow-[0_18px_48px_rgba(31,36,40,0.045)] sm:p-7">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-moss/70">Final title</p>
              <h4 className="mt-1 text-sm font-bold text-moss">최종 추천 제목</h4>
            </div>
            <button
              type="button"
              onClick={() => copyText("finalTitle")}
              className="focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-moss/18 bg-white px-2.5 text-xs font-bold text-moss transition hover:border-moss"
            >
              {copied === "finalTitle" ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
              {copied === "finalTitle" ? "복사됨" : "제목 복사"}
            </button>
          </div>
          <input
            value={finalTitle}
            onChange={(event) => updateSelectedTitle(event.target.value)}
            className="focus-ring mt-3 min-h-14 w-full rounded-2xl border border-line/35 bg-[#fffefa] px-4 text-xl font-bold leading-8 text-ink shadow-[inset_0_0_0_1px_rgba(31,36,40,0.012)]"
            aria-label="최종 추천 제목 직접 수정"
          />
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-ink/50">
            <span className="rounded-full bg-moss/10 px-3 py-1.5 text-moss">
              메인 키워드: {mainKeyword || "자동 추출"}
            </span>
            <span className="rounded-full bg-[#fbfaf6] px-3 py-1.5">요청 {formatCharCount(requestedTargetCharCount)}</span>
            <span className="rounded-full bg-[#fbfaf6] px-3 py-1.5">현재 {formatCharCount(actualCharCount)}</span>
            <span className="rounded-full bg-[#fbfaf6] px-3 py-1.5">기준 {formatCharCount(effectiveTargetCharCount)}</span>
            <span className="rounded-full bg-[#fbfaf6] px-3 py-1.5">해시태그 {hashtags.length}개</span>
          </div>
          {lowInformationNotice && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-950">
              <p>
                목표 {formatCharCount(requestedTargetCharCount)}보다 입력 정보가 적어 확인 가능한 경험을 중심으로 {formatCharCount(actualCharCount)} 초안을 만들었습니다.
              </p>
              {additionalInfoHints.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900">
                  {additionalInfoHints.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </header>

        <ResultDetailSection title="제목 더보기" copyActive={copied === "titles"} onCopy={() => copyText("titles")}>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={regenerateTitles}
              className="focus-ring inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-moss px-3 text-xs font-bold text-white transition hover:bg-[#456b61]"
            >
              <RefreshCw size={14} aria-hidden="true" />
              제목 다시 만들기
            </button>
          </div>
          <div className="grid gap-2">
            {titleCandidates.slice(0, 5).map((title, index) => {
              const selected = finalTitle === title || result.selectedTitle === title;

              return (
                <button
                  type="button"
                  key={title}
                  onClick={() => selectTitle(title)}
                  className={`focus-ring flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                    selected
                      ? "bg-moss/10 text-moss shadow-[inset_0_0_0_1px_rgba(73,111,99,0.18)]"
                      : "bg-[#fbfaf6] hover:bg-[#fff8e6]"
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-current text-xs font-bold">
                    {selected ? <Check size={14} aria-hidden="true" /> : index + 1}
                  </span>
                  <span className="font-bold leading-6">{title}</span>
                </button>
              );
            })}
          </div>
        </ResultDetailSection>

        <section className="border-t border-line/35 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-base font-bold text-ink">블로그 본문</h4>
              <p className="mt-1 max-w-xl text-xs font-semibold leading-5 text-ink/45">
                초안은 바로 수정할 수 있어요. 내 말투에 맞게 한 번만 다듬으면 더 자연스럽습니다.
              </p>
            </div>
          <button
            type="button"
            onClick={() => copyText("body")}
            className="focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-line/60 bg-white px-2.5 text-xs font-bold text-ink/55 transition hover:border-moss/50 hover:text-moss"
          >
            {copied === "body" ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
            {copied === "body" ? "복사됨" : "본문 복사"}
          </button>
          </div>
          {images.length > 0 && (
            <BlogBodyPreview body={blogBody} images={images} />
          )}
          <textarea
            value={blogBody}
            onChange={(event) => updateBody(event.target.value)}
            rows={30}
            className="focus-ring mt-4 min-h-[760px] w-full resize-y rounded-2xl border border-line/20 bg-white p-5 text-[16px] leading-8 text-ink/88 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.008)] whitespace-pre-wrap sm:p-6"
          />
        </section>

        {faqItems.length > 0 && (
          <ResultDetailSection title="FAQ" copyActive={copied === "faq"} onCopy={() => copyText("faq")}>
            <FaqList items={faqItems} />
          </ResultDetailSection>
        )}

        <ResultDetailSection title="해시태그" copyActive={copied === "hashtags"} onCopy={() => copyText("hashtags")}>
          <KeywordChips items={hashtags} />
        </ResultDetailSection>
      </article>
    </div>
  );
}

const photoInsertMarkerPattern = /^\[사진 삽입:\s*(.+?)\]$/u;

function BlogBodyPreview({ body = "", images = [] }) {
  const paragraphs = String(body || "")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  let photoIndex = 0;

  if (paragraphs.length === 0) return null;

  return (
    <div
      data-testid="naver-body-preview"
      className="mt-4 space-y-3 rounded-2xl border border-line/35 bg-[#fbfaf6] p-4"
    >
      <div className="flex items-center gap-2">
        <Image size={16} className="text-moss" aria-hidden="true" />
        <h5 className="text-sm font-bold text-ink/70">본문 미리보기</h5>
      </div>
      <div className="space-y-3">
        {paragraphs.map((paragraph, index) => {
          const markerMatch = paragraph.match(photoInsertMarkerPattern);

          if (markerMatch) {
            const image = images[photoIndex];
            photoIndex += 1;

            if (!image) return null;

            return (
              <figure
                key={`${paragraph}-${index}`}
                data-testid="inline-photo-preview"
                className="rounded-md border border-line bg-white p-2 shadow-[0_10px_24px_rgba(31,36,40,0.06)]"
              >
                <img
                  src={image.url}
                  alt={markerMatch[1]}
                  className="mx-auto max-h-[520px] w-full rounded-sm object-contain"
                />
                <figcaption className="flex items-center justify-between gap-3 px-1.5 pt-2 text-xs font-bold text-ink/55">
                  <span>{markerMatch[1]}</span>
                  <span className="shrink-0 text-moss">업로드 순서 {photoIndex}</span>
                </figcaption>
              </figure>
            );
          }

          const looksLikeHeading = !/[.!?。요다]$/u.test(paragraph) && Array.from(paragraph).length <= 28;

          return (
            <p
              key={`${paragraph}-${index}`}
              className={`whitespace-pre-wrap text-sm leading-7 ${
                looksLikeHeading
                  ? "pt-2 font-bold text-moss"
                  : "font-semibold text-ink/70"
              }`}
            >
              {paragraph}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function ResultMetric({ label, value }) {
  return (
    <div className="rounded-xl bg-white/85 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.04)]">
      <p className="text-[11px] font-bold text-ink/45">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

function ResultDetailSection({ title, children, defaultOpen = false, copyActive = false, onCopy }) {
  return (
    <details open={defaultOpen} className="border-t border-line/35 py-4">
      <summary className="cursor-pointer list-none text-sm font-bold text-ink/72">
        <span className="inline-flex items-center gap-2">
          <span className="text-ink/40">▸</span>
          {title}
        </span>
      </summary>
      <div className="mt-3 space-y-3 pl-0 sm:pl-5">
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full border border-line/50 bg-white px-2.5 text-xs font-bold text-ink/55 transition hover:border-moss/50 hover:text-moss"
          >
            {copyActive ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
            {copyActive ? "복사됨" : "이 부분 복사"}
          </button>
        )}
        {children}
      </div>
    </details>
  );
}

function ObjectSummary({ value = {} }) {
  const entries = Object.entries(value || {});

  if (entries.length === 0) {
    return <p className="text-sm font-semibold text-ink/50">아직 정리된 내용이 없습니다.</p>;
  }

  return <KeyValueList items={entries} />;
}

function KeyValueList({ items = [] }) {
  if (items.length === 0) {
    return <p className="text-sm font-semibold text-ink/50">정리된 항목이 없습니다.</p>;
  }

  return (
    <dl className="grid gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-white/80 p-3 text-sm leading-6 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.04)]">
          <dt className="text-xs font-bold text-moss">{label}</dt>
          <dd className="mt-1 font-semibold text-ink/70">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function KeywordChips({ items = [] }) {
  if (items.length === 0) {
    return <p className="text-sm font-semibold text-ink/50">키워드가 없습니다.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2 rounded-xl bg-white/75 p-3 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.04)]">
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
          {item}
        </span>
      ))}
    </div>
  );
}

function NumberedList({ items = [] }) {
  if (items.length === 0) {
    return <p className="text-sm font-semibold text-ink/50">항목이 없습니다.</p>;
  }

  return (
    <ol className="grid gap-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2 rounded-xl bg-white/80 p-3 text-sm leading-6 text-ink/70 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.04)]">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-moss">
            {index + 1}
          </span>
          <span className="font-semibold">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function PhotoGuideList({ items = [] }) {
  if (items.length === 0) {
    return <p className="text-sm font-semibold text-ink/50">사진 가이드가 없습니다.</p>;
  }

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={`${item.marker}-${item.insertAfter}`} className="rounded-md border border-line/60 bg-white p-3 text-sm leading-6">
          <p className="text-xs font-bold text-moss">{item.insertAfter}</p>
          <p className="mt-1 font-bold text-ink/75">{item.marker}</p>
          <p className="mt-1 text-ink/60">{item.guide}</p>
        </div>
      ))}
    </div>
  );
}

function FaqList({ items = [] }) {
  if (items.length === 0) {
    return <p className="text-sm font-semibold text-ink/50">FAQ가 없습니다.</p>;
  }

  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        <div key={item.question} className="rounded-xl bg-white/80 p-3 text-sm leading-6 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.04)]">
          <p className="font-bold text-ink">Q{index + 1}. {item.question}</p>
          <p className="mt-1 font-semibold text-ink/65">A. {item.answer}</p>
        </div>
      ))}
    </div>
  );
}

function ChecklistList({ items = [] }) {
  if (items.length === 0) {
    return <p className="text-sm font-semibold text-ink/50">검수표가 없습니다.</p>;
  }

  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item.label} className="flex gap-2 rounded-md border border-line/60 bg-white p-3 text-sm leading-6">
          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
            item.passed ? "bg-moss text-white" : "bg-amber/20 text-[#7a5a1e]"
          }`}>
            <Check size={13} aria-hidden="true" />
          </span>
          <span>
            <span className="block font-bold text-ink/75">{item.label}</span>
            <span className="block font-semibold text-ink/55">{item.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function FieldLabel({ children, required = false }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      <span>{children}</span>
      {required && (
        <span className="rounded-md bg-coral/10 px-2 py-0.5 text-[11px] font-bold text-coral">
          필수
        </span>
      )}
    </span>
  );
}

function StepLabel({ number, title, optional = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-moss text-[11px] font-bold text-white">
          {number}
        </span>
        <h4 className="truncate text-[15px] font-bold text-ink">{title}</h4>
      </div>
      {optional && (
        <span className="shrink-0 whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-ink/45">
          선택사항
        </span>
      )}
    </div>
  );
}

function UsageSteps() {
  const steps = [
    ["입력", "사진 또는 메모를 넣습니다."],
    ["생성", "초안 만들기 버튼을 누릅니다."],
    ["결과", "필요한 섹션을 확인하고 복사합니다."]
  ];

  return (
    <details className="rounded-xl bg-white/70 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.045)]">
      <summary className="cursor-pointer text-xs font-bold text-ink/58">
        간단 흐름: 입력 → 생성 → 결과
      </summary>
      <ol className="mt-2 grid gap-2 md:grid-cols-3">
        {steps.map(([step, description]) => (
          <li key={step} className="rounded-lg bg-[#fbfaf6] p-2.5 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.035)]">
            <span className="inline-flex min-h-5 items-center rounded-md bg-moss/10 px-2 text-[11px] font-bold text-moss">
              {step}
            </span>
            <p className="mt-1.5 text-xs font-semibold leading-5 text-ink/52">{description}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function FieldStatusBadge({ meta }) {
  const status = meta?.status || "읽지 못함";
  const className =
    status === "확인됨"
      ? "border-moss/20 bg-moss/10 text-moss"
      : status === "확인 필요"
        ? "border-amber/35 bg-amber/10 text-[#7a5a1e]"
        : "border-line bg-white text-ink/45";

  return (
    <span
      title={meta?.reason || status}
      className={`inline-flex min-h-6 items-center rounded-md border px-2 text-[11px] font-bold ${className}`}
    >
      {status}
    </span>
  );
}

function ImageGrid({ images = [], onRemove, onMove, onNoteChange, showDetails = true }) {
  if (images.length === 0) {
    return (
      <div className="mt-3 rounded-lg bg-white/75 p-3 text-center text-sm font-semibold text-ink/46 shadow-[inset_0_0_0_1px_rgba(31,36,40,0.04)]">
        아직 추가된 사진이 없습니다.
      </div>
    );
  }

  return (
    <div className="mt-3 grid auto-cols-[minmax(220px,82vw)] grid-flow-col gap-3 overflow-x-auto pb-1 sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible">
      {images.map((item, index) => (
        <div key={item.id} className="rounded-md border border-line bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-bold text-moss">
              이미지 {index + 1} · {item.source === "paste" ? "붙여넣기" : "업로드"}
            </p>
            <div className="flex items-center gap-1">
              <IconButton label="위로" disabled={index === 0} onClick={() => onMove(item.id, -1)}>
                <ArrowUp size={14} aria-hidden="true" />
              </IconButton>
              <IconButton label="아래로" disabled={index === images.length - 1} onClick={() => onMove(item.id, 1)}>
                <ArrowDown size={14} aria-hidden="true" />
              </IconButton>
              <IconButton label="삭제" onClick={() => onRemove(item.id)}>
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border border-line bg-paper">
            <img src={item.url} alt={item.name} className="h-36 w-full object-contain" />
          </div>
          {showDetails && (
            <details className="mt-2 rounded-md border border-line bg-paper p-2 text-xs">
              <summary className="cursor-pointer font-bold text-ink/60">이미지별 메모</summary>
              <textarea
                value={item.note}
                onChange={(event) => onNoteChange(item.id, event.target.value)}
                rows={2}
                className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-2 leading-5"
                placeholder="예: 대표 사진, 메뉴판, 성분표, 아이가 좋아한 공간"
              />
            </details>
          )}
          {showDetails && item.message && (
            <p className="mt-2 text-xs font-semibold leading-5 text-ink/55">{item.message}</p>
          )}
          {showDetails && item.ocrText && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-bold text-moss">사진에서 읽힌 글자 보기</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-paper p-2 leading-5 text-ink/60">{item.ocrText}</p>
            </details>
          )}
          {showDetails && item.warnings.length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs font-semibold leading-5 text-coral">
              {item.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ResultSectionHeader({ title, copyActive = false, onCopy }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-sm font-bold text-ink/70">{title}</h4>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-xs font-bold text-ink/60 transition hover:border-moss hover:text-moss"
        >
          {copyActive ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
          {copyActive ? "복사됨" : "이 부분 복사"}
        </button>
      )}
    </div>
  );
}

function ListBlock({ title, items = [], emphasis = false, copyActive = false, onCopy }) {
  if (items.length === 0) return null;

  return (
    <div>
      <ResultSectionHeader title={title} copyActive={copyActive} onCopy={onCopy} />
      <ol className="mt-2 grid gap-2 rounded-md border border-line bg-paper p-3">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2 text-sm leading-6 text-ink/70">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-moss">
              {index + 1}
            </span>
            <span className={emphasis ? "font-bold text-ink" : "font-semibold"}>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PhotoPlacementList({ items = [], title = "사진 넣을 위치", copyActive = false, onCopy }) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <Image size={17} className="text-moss" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <ResultSectionHeader title={title} copyActive={copyActive} onCopy={onCopy} />
        </div>
      </div>
      <div className="mt-2 grid gap-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-line bg-paper p-3 text-sm leading-6">
            <p className="text-xs font-bold text-moss">{item.label}</p>
            <p className="mt-1 font-bold text-ink/75">{item.title}</p>
            <p className="mt-1 text-ink/55">{item.description}</p>
            <p className="mt-2 rounded-md bg-white px-3 py-2 text-xs font-semibold text-ink/55">
              {item.marker}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconButton({ label, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="focus-ring inline-grid h-8 w-8 place-items-center rounded-md border border-line bg-white text-ink/60 transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function TitleCandidates({ result, onSelect, onRegenerate }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-ink/70">다른 제목 후보</h4>
        <button
          type="button"
          onClick={onRegenerate}
          className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold transition hover:border-moss hover:text-moss"
        >
          <RefreshCw size={14} aria-hidden="true" />
          다시 만들기
        </button>
      </div>
      <div className="mt-2 grid gap-2">
        {result.titles.map((title, index) => {
          const selected = result.selectedTitle === title;

          return (
            <button
              type="button"
              key={title}
              onClick={() => onSelect(title)}
              className={`focus-ring flex min-h-12 items-start gap-2 rounded-md border px-3 py-3 text-left text-sm transition ${
                selected
                  ? "border-moss bg-moss/10 text-moss"
                  : "border-line bg-paper hover:border-moss hover:bg-white"
              }`}
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-xs">
                {selected ? <Check size={13} aria-hidden="true" /> : index + 1}
              </span>
              <span className="font-semibold">{title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CopyButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-moss hover:text-moss"
    >
      {active ? <Check size={17} aria-hidden="true" /> : <Clipboard size={17} aria-hidden="true" />}
      {active ? "복사됨" : children}
    </button>
  );
}

function ImageSuggestionCards({ items = [] }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Image size={17} className="text-moss" aria-hidden="true" />
        <h4 className="text-sm font-bold text-ink/70">사진 작성 참고 정보</h4>
      </div>
      <div className="mt-3 grid gap-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-line bg-paper p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-moss">{item.label}</p>
              <p className="text-sm font-bold text-ink/75">{item.title}</p>
            </div>
            <dl className="mt-3 grid gap-3 text-sm">
              <div>
                <dt className="text-xs font-bold text-ink/50">이미지 컨셉</dt>
                <dd className="mt-1 leading-6 text-ink/70">{item.description}</dd>
              </div>
              <div className="rounded-md border border-moss/20 bg-white p-3">
                <dt className="text-xs font-bold text-moss">직접 촬영 추천</dt>
                <dd className="mt-1 leading-6 text-ink/70">{item.directShotGuide}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-ink/50">AI 이미지 프롬프트</dt>
                <dd className="mt-1 break-words rounded-md border border-line bg-white px-3 py-2 leading-6 text-ink/70">
                  {item.aiPrompt}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-ink/50">이미지 사이트 검색어</dt>
                <dd className="mt-1 rounded-md border border-line bg-white px-3 py-2 font-semibold text-ink/75">
                  {item.searchKeyword}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
