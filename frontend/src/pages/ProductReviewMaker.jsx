import {
  ArrowDown,
  ArrowUp,
  Check,
  Clipboard,
  FileText,
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
  extractProductInfoFieldsWithMetaFromText
} from "../lib/productReviewGenerator.js";
import { saveDraft } from "../lib/localDrafts.js";

const initialForm = {
  productName: "",
  brandName: "",
  mainKeyword: "",
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
  sponsorshipType: "",
  avoidWords: "무조건, 보장, 완벽, 즉시효과",
  tone: "친근한",
  targetLength: "3000",
  selectedTitle: ""
};

const emptyResult = {
  category: "",
  titles: [],
  selectedTitle: "",
  body: "",
  hashtags: [],
  imageSuggestions: [],
  outline: [],
  thumbnailTexts: [],
  searchKeywords: [],
  closingParagraph: "",
  contentPackage: null,
  bodyLength: 0
};

const toneOptions = ["친근한", "차분한", "전문적인", "활기찬"];
const reviewCategoryOptions = [
  { value: "", label: "자동 추정" },
  { value: "product", label: "상품 후기" },
  { value: "restaurant", label: "맛집 후기" },
  { value: "store", label: "매장 후기" },
  { value: "education", label: "교육 후기" },
  { value: "hospital", label: "병원 후기" },
  { value: "service", label: "서비스 후기" },
  { value: "travel", label: "여행 후기" },
  { value: "experience", label: "체험 후기" },
  { value: "kids-place", label: "아이 동반 장소 후기" },
  { value: "place", label: "장소 후기" }
];
const sponsorshipOptions = ["직접 구매", "제품 제공", "식사권 제공", "협찬/체험단"];
const MAX_REVIEW_IMAGES = 10;
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

const resultToClipboard = (result, { includeImageMarkers = true } = {}) => {
  const packageData = result.contentPackage;

  if (packageData) {
    return [
      "최종 추천 제목",
      packageData.finalRecommendedTitle || result.selectedTitle,
      "",
      "블로그 본문",
      includeImageMarkers ? packageData.blogBody : stripImageMarkers(packageData.blogBody),
      "",
      "사진 배치 가이드",
      (packageData.photoGuide || [])
        .map((item) => `${item.marker}\n${item.guide}`)
        .join("\n\n"),
      "",
      "업체/상품 정보 정리",
      formatKeyValueItems(packageData.infoSummary || []),
      "",
      "FAQ",
      formatFaqItems(packageData.faqItems || []),
      "",
      "해시태그",
      (packageData.hashtags || result.hashtags || []).join(" ")
    ]
      .filter((line) => line !== undefined && line !== null)
      .join("\n")
      .trim();
  }

  return [
    "최종 추천 제목",
    result.selectedTitle,
    "",
    "블로그 본문",
    includeImageMarkers ? result.body : stripImageMarkers(result.body),
    "",
    "사진 배치 가이드",
    ...(result.imageSuggestions || []).map((item, index) => `${index + 1}. ${item.title} - ${item.description}`),
    "",
    "해시태그",
    result.hashtags.join(" ")
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

const deriveMainKeywordFromTopic = (value = "") =>
  String(value ?? "")
    .trim()
    .replace(/\s*(?:후기|리뷰|방문기|사용기)$/u, "")
    .replace(/\s*(?:직접\s*)?(?:써본|다녀온|방문한)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

export default function ProductReviewMaker() {
  const pasteAreaRef = useRef(null);
  const imagesRef = useRef([]);
  const [form, setForm] = useState(initialForm);
  const [images, setImages] = useState([]);
  const [result, setResult] = useState(emptyResult);
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

  const reviewTopic = useMemo(
    () => form.productName.trim() || form.mainKeyword.trim(),
    [form.mainKeyword, form.productName]
  );
  const resolvedMainKeyword = useMemo(
    () => form.mainKeyword.trim() || deriveMainKeywordFromTopic(form.productName),
    [form.mainKeyword, form.productName]
  );
  const hasSeedInput = useMemo(
    () =>
      images.length > 0 ||
      Boolean(
        form.experienceMemo.trim() ||
          form.productInfoText.trim() ||
          fieldLabels.some(([field]) => form[field].trim())
      ),
    [form, images.length]
  );
  const isReady = useMemo(
    () => Boolean(reviewTopic && hasSeedInput),
    [hasSeedInput, reviewTopic]
  );
  const hasResult = Boolean(result.body);
  const isReading = ocrStatus === "reading" || images.some((item) => item.ocrStatus === "reading");

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
    setOcrMessage("사진이 추가되었습니다. 필요한 경우 자세한 설정에서 사진 속 글자를 읽을 수 있습니다.");
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

  const getImageContext = () =>
    images.map((item, index) => ({
      index: index + 1,
      name: item.name,
      source: item.source,
      note: item.note,
      ocrText: item.ocrText
    }));

  const createReviewPayload = (selectedTitle = "") => {
    const imageContext = getImageContext();
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

    return {
      ...form,
      productName: form.productName || topic,
      mainKeyword,
      keyword: mainKeyword,
      productInfoText: mergeTextBlocks(form.productInfoText, imageText),
      selectedTitle: selectedTitle || form.selectedTitle,
      imageContext,
      imageCount: images.length
    };
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
        message: "OCR 진행 중",
        warnings: []
      });

      const ocrResult = await extractCaptureTextFromImage(item.file, {
        logger: (progress) => {
          if (progress?.status) {
            updateImageOcrState(item.id, { message: `OCR 진행 중: ${progress.status}` });
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

  const generateReview = (selectedTitle = "") => {
    if (!isReady) return;

    const payload = createReviewPayload(selectedTitle);
    const draft = createProductReviewDraft(payload);

    setResult(draft);
    setForm((current) => ({ ...current, selectedTitle: draft.selectedTitle }));
    setStatus("generated");
    setDraftId("");
    setDraftMessage("");
  };

  const selectTitle = (title) => {
    const draft = createProductReviewDraft(createReviewPayload(title));

    setForm((current) => ({ ...current, selectedTitle: title }));
    setResult(draft);
    setStatus("generated");
    setDraftId("");
    setDraftMessage("");
  };

  const saveCurrentDraft = () => {
    if (!hasResult) return;

    const saved = saveDraft(
      {
        ...createReviewPayload(result.selectedTitle),
        keyword: resolvedMainKeyword || reviewTopic,
        targetLengthOption: form.targetLength,
        customTargetLength: form.targetLength
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

    const packageData = result.contentPackage;
    const copyValueByMode = {
      mainKeyword: packageData?.mainKeyword || reviewTopic,
      secondaryKeywords: linesToClipboard(packageData?.secondaryKeywords || []),
      searchIntent: formatObjectSummary(packageData?.searchIntentAnalysis || {}),
      homeFeed: formatObjectSummary(packageData?.homeFeedClickPoint || {}),
      body: stripImageMarkers(result.body),
      titles: linesToClipboard(packageData?.titleCandidates || result.titles.slice(0, 5)),
      finalTitle: packageData?.finalRecommendedTitle || result.selectedTitle,
      openings: linesToClipboard(packageData?.openingSentenceCandidates || []),
      hashtags: result.hashtags.join(" "),
      thumbnail: linesToClipboard(result.thumbnailTexts),
      keywords: result.searchKeywords.join(", "),
      closing: result.closingParagraph,
      images: packageData?.photoGuide
        ? packageData.photoGuide.map((item, index) => `${index + 1}. ${item.marker}\n${item.guide}`).join("\n\n")
        : imageKeywordsToClipboard(result.imageSuggestions),
      info: formatKeyValueItems(packageData?.infoSummary || []),
      recommended: linesToClipboard(packageData?.recommendedFor || []),
      faq: formatFaqItems(packageData?.faqItems || []),
      checklist: formatChecklistItems(packageData?.finalChecklist || []),
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
    <div className="min-w-0 space-y-5">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">원클릭 네이버 블로그 글쓰기</p>
          <h2 className="mt-1 max-w-3xl text-2xl font-bold leading-tight tracking-normal sm:text-3xl">
            사진과 메모를 넣으면 네이버 블로그 후기글 초안이 생성됩니다
          </h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-ink/60">
            입력 → 생성 → 결과 흐름만 남기고, SEO 포스팅 구조는 결과물 안에서 정리합니다.
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <UsageSteps />

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(340px,0.38fr)_minmax(0,0.62fr)]">
        <section className="min-w-0 rounded-xl border border-line/70 bg-white p-5 shadow-[0_12px_28px_rgba(31,36,40,0.05)]">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">원클릭 네이버 블로그 글쓰기</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {isReady ? "초안 준비 완료" : "사진/메모 입력"}
            </span>
          </div>
          <div className="mt-3 rounded-lg border border-moss/15 bg-[#f3f7f3] px-4 py-3 text-sm leading-6 text-ink/70">
            <p className="font-semibold">
              사진과 메모를 넣으면 네이버 블로그 후기글 초안이 생성됩니다.
            </p>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            <label className="block">
              <FieldLabel required>글 주제</FieldLabel>
              <input
                value={form.productName}
                onChange={(event) => updateForm("productName", event.target.value)}
                className="focus-ring mt-2 min-h-12 w-full rounded-md border border-line/80 bg-[#fbfaf6] px-3 text-base"
                placeholder="예: 에어젤 드라이샴푸 후기 / 부천금거래소 후기 / 아이랑 갈만한 카페"
              />
            </label>

            <label className="block">
              <FieldLabel>메인 키워드</FieldLabel>
              <input
                value={form.mainKeyword}
                onChange={(event) => updateForm("mainKeyword", event.target.value)}
                className="focus-ring mt-2 min-h-12 w-full rounded-md border border-line/80 bg-[#fbfaf6] px-3 text-base"
                placeholder="예: 에어젤 드라이샴푸 / 부천금거래소 / 부천 아이랑 카페"
              />
              <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                메인 키워드는 제목과 첫 문장에 자연스럽게 들어갑니다.
              </p>
            </label>

            <section className="order-4">
              <FieldLabel>사진 넣기</FieldLabel>
              <div
                ref={pasteAreaRef}
                role="button"
                tabIndex={0}
                onPaste={handlePaste}
                onClick={() => pasteAreaRef.current?.focus()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") pasteAreaRef.current?.focus();
                }}
                className="focus-ring mt-2 rounded-lg border border-dashed border-line/80 bg-[#fbfaf6] p-5 transition hover:border-moss hover:bg-white"
              >
                <div className="flex flex-col items-center justify-center text-center">
                  <Upload size={24} className="text-moss" aria-hidden="true" />
                  <p className="mt-2 text-sm font-bold text-ink/70">
                    사진은 최대 {MAX_REVIEW_IMAGES}장까지 넣을 수 있어요.
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                    Ctrl+V로 붙여넣어도 됩니다. 사진이 없으면 기억나는 내용만 적어도 괜찮아요.
                  </p>
                  <label className="focus-ring mt-3 inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-moss hover:text-moss">
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

              {ocrMessage && (
                <div className="mt-3 rounded-md border border-line bg-paper p-3 text-sm">
                  <div className="flex items-center gap-2 font-bold text-ink/70">
                    {isReading ? (
                      <Loader2 size={16} className="animate-spin text-moss" aria-hidden="true" />
                    ) : (
                      <FileText size={16} className="text-moss" aria-hidden="true" />
                    )}
                    <span>{ocrMessage}</span>
                  </div>
                  {ocrWarnings.length > 0 && (
                    <ul className="mt-2 grid gap-1 text-xs font-semibold leading-5 text-coral">
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

            <label className="order-3 block">
              <FieldLabel>기억나는 내용</FieldLabel>
              <textarea
                value={form.experienceMemo}
                onChange={(event) => updateForm("experienceMemo", event.target.value)}
                rows={6}
                className="focus-ring mt-2 w-full rounded-md border border-line/80 bg-[#fbfaf6] p-3 text-base leading-7"
                placeholder="예: 탕수육이 바삭했고 어향가지가 맛있었어요. 4명이 먹기 좋았고 직장인 회식 장소로 괜찮아 보였어요. 가격과 주차는 확인이 필요해요."
              />
            </label>

            <details className="order-5 rounded-lg border border-line/80 bg-[#fbfaf6] p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-sm font-bold text-ink/70">자세한 설정</span>
                    <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                      글 톤, 협찬 표시, 사진 속 글자 읽기, 사진별 메모는 필요할 때만 열어보세요.
                    </p>
                  </div>
                  <span className="inline-flex min-h-8 items-center justify-center rounded-md border border-line bg-white px-3 text-xs font-bold text-moss">
                    선택 입력
                  </span>
                </div>
              </summary>

              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <FieldLabel>카테고리</FieldLabel>
                    <select
                      value={form.category}
                      onChange={(event) => updateForm("category", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
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
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
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
                    min="600"
                    max="5000"
                    value={form.targetLength}
                    onChange={(event) => updateForm("targetLength", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                  />
                </label>

                  <label className="block">
                    <FieldLabel>협찬 여부</FieldLabel>
                    <select
                      value={form.sponsorshipType}
                      onChange={(event) => updateForm("sponsorshipType", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                    >
                      <option value="">선택 안 함</option>
                      {sponsorshipOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                <label className="block">
                  <FieldLabel>강조하고 싶은 포인트</FieldLabel>
                  <input
                    value={form.emphasisPoints}
                    onChange={(event) => updateForm("emphasisPoints", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                    placeholder="예: 메뉴, 분위기, 사용감, 주차, 추천 대상"
                  />
                </label>

                <label className="block">
                  <FieldLabel>피하고 싶은 표현/금지어</FieldLabel>
                  <input
                    value={form.avoidWords}
                    onChange={(event) => updateForm("avoidWords", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                    placeholder="예: 무조건, 보장, 완벽, 즉시효과"
                  />
                </label>
              </div>

                <div className="rounded-md border border-line bg-white p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-bold text-ink/70">이미지에서 읽은 내용 · 이미지별 메모</p>
                      <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                        사진 속 글자와 사진별 메모가 글 생성에 함께 반영됩니다. 업로드 파일명은 본문에 넣지 않습니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={extractInfoFromImages}
                      disabled={isReading}
                      className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-bold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                    >
                      {isReading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
                      사진 속 글자 읽기
                    </button>
                  </div>

                  <ImageGrid
                    images={images}
                    onRemove={removeImage}
                    onMove={moveImage}
                    onNoteChange={updateImageNote}
                    showDetails
                  />

                  <details
                    open={productInfoOpen}
                    onToggle={(event) => setProductInfoOpen(event.currentTarget.open)}
                    className="mt-3 rounded-md border border-line bg-paper p-3"
                  >
                    <summary className="cursor-pointer text-sm font-bold text-moss">
                      상품/장소 정보 보정
                    </summary>

                    <div className="mt-3 grid gap-3">
                      {fieldLabels.map(([field, label]) => (
                        <label key={field} className="block">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold text-ink/55">{label}</span>
                            <FieldStatusBadge meta={fieldMeta[field]} />
                          </span>
                          <textarea
                            value={form[field]}
                            onChange={(event) => updateForm(field, event.target.value)}
                            rows={field === "productName" || field === "brandName" ? 1 : 2}
                            className="focus-ring mt-1 w-full rounded-md border border-line bg-white p-2 text-sm leading-6"
                            placeholder={form[field] ? `${label}을 직접 수정할 수 있습니다.` : "직접 입력해도 됩니다."}
                          />
                        </label>
                      ))}
                    </div>
                  </details>

                  <details
                    open={rawTextOpen}
                    onToggle={(event) => setRawTextOpen(event.currentTarget.open)}
                    className="mt-3 rounded-md border border-line bg-paper p-3"
                  >
                    <summary className="cursor-pointer text-sm font-bold text-moss">
                      OCR 원문 보기
                    </summary>
                    <textarea
                      value={form.productInfoText}
                      onChange={(event) => updateForm("productInfoText", event.target.value)}
                      rows={6}
                      className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                      placeholder="사진에서 읽은 원문이나 추가 정보를 직접 적을 수 있습니다."
                    />
                  </details>
                </div>
              </div>
            </details>

            <div className="order-6 rounded-lg border border-moss/20 bg-[#f3f7f3] p-4">
              <p className="text-sm font-semibold leading-6 text-ink/60">
                {isReady
                  ? "사진과 메모를 바탕으로 바로 복사 가능한 네이버 블로그 초안을 만듭니다."
                  : "어떤 글을 쓸지 적고, 사진 또는 기억나는 내용 중 하나 이상을 넣어주세요."}
              </p>
              <button
                type="button"
                onClick={() => generateReview()}
                disabled={!isReady || status === "generating" || isReading}
                className="focus-ring mt-3 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-moss px-4 py-3 text-base font-bold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                <WandSparkles size={18} aria-hidden="true" />
                블로그 글 초안 만들기
              </button>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-xl border border-line/70 bg-white p-5 shadow-[0_12px_28px_rgba(31,36,40,0.05)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-moss">생성 결과</p>
              <h3 className="mt-1 text-lg font-bold">네이버 블로그 포스팅 초안</h3>
            </div>
            <PackageSearch size={22} className="text-moss" aria-hidden="true" />
          </div>

          {!hasResult && (
            <div className="mt-4 rounded-xl border border-dashed border-line/80 bg-[#fbfaf6] p-5 text-center text-sm font-semibold leading-6 text-ink/55">
              <p className="font-bold text-ink/65">아직 생성된 글이 없습니다.</p>
              <p className="mt-1">주제와 메모를 입력한 뒤 초안 만들기를 눌러주세요.</p>
            </div>
          )}

          {hasResult && (
            <div className="mt-5 space-y-5">
              <NaverResultSections
                result={result}
                copied={copied}
                copyText={copyText}
                selectTitle={selectTitle}
                setResult={setResult}
                setForm={setForm}
              />

              <div>
                <h4 className="text-sm font-bold text-ink/70">저장/다시 만들기</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => generateReview(result.selectedTitle)}
                    className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-moss hover:text-moss"
                  >
                    <RefreshCw size={17} aria-hidden="true" />
                    다시 만들기
                  </button>
                  <button
                    type="button"
                    onClick={saveCurrentDraft}
                    className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-moss hover:text-moss"
                  >
                    <Save size={17} aria-hidden="true" />
                    보관함 저장
                  </button>
                </div>
                {draftMessage && (
                  <p className="mt-2 text-xs font-bold text-moss">{draftMessage}</p>
                )}
              </div>

            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function NaverResultSections({ result, copied, copyText, selectTitle, setResult, setForm }) {
  const packageData = result.contentPackage || {};
  const titleCandidates = packageData.titleCandidates || result.titles || [];
  const finalTitle = packageData.finalRecommendedTitle || result.selectedTitle;
  const blogBody = packageData.blogBody || result.body;
  const hashtags = packageData.hashtags || result.hashtags || [];
  const photoGuide = packageData.photoGuide || [];
  const bodyLength = result.bodyLength || blogBody.replace(/\s+/g, "").length;

  const updateSelectedTitle = (title) => {
    setResult((current) => ({
      ...current,
      selectedTitle: title,
      contentPackage: current.contentPackage
        ? {
            ...current.contentPackage,
            finalRecommendedTitle: title
          }
        : current.contentPackage
    }));
    setForm((current) => ({ ...current, selectedTitle: title }));
  };

  const updateBody = (body) => {
    setResult((current) => ({
      ...current,
      body,
      contentPackage: current.contentPackage
        ? {
            ...current.contentPackage,
            blogBody: body
          }
        : current.contentPackage
    }));
  };

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-moss/20 bg-[#fbfdf9] p-4 shadow-[0_10px_24px_rgba(31,36,40,0.035)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-moss">1. 최종 추천 제목</h4>
            <p className="mt-1 text-xs font-semibold text-ink/45">
              바로 복사해 네이버 제목에 사용할 수 있는 추천안입니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyText("finalTitle")}
              className="focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-moss/20 bg-white px-2.5 text-xs font-bold text-moss transition hover:border-moss"
            >
              {copied === "finalTitle" ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
              {copied === "finalTitle" ? "복사됨" : "제목 복사"}
            </button>
            <button
              type="button"
              onClick={() => copyText("full")}
              className="focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md bg-moss px-3 text-xs font-bold text-white transition hover:bg-[#456b61]"
            >
              {copied === "full" ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
              {copied === "full" ? "전체 복사됨" : "전체 글 복사하기"}
            </button>
          </div>
        </div>
        <input
          value={finalTitle}
          onChange={(event) => updateSelectedTitle(event.target.value)}
          className="focus-ring mt-3 min-h-14 w-full rounded-md border border-moss/25 bg-white px-4 text-xl font-bold leading-8 text-ink"
          aria-label="최종 추천 제목 직접 수정"
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <ResultMetric label="메인 키워드" value={packageData.mainKeyword || "키워드 없음"} />
          <ResultMetric label="본문 글자수" value={`${bodyLength}자`} />
          <ResultMetric label="해시태그 개수" value={`${hashtags.length}개`} />
        </div>
      </section>

      <ResultDetailSection title="2. 제목 더보기" copyActive={copied === "titles"} onCopy={() => copyText("titles")}>
        <div className="grid gap-2">
          {titleCandidates.slice(0, 5).map((title, index) => {
            const selected = finalTitle === title || result.selectedTitle === title;

            return (
              <button
                type="button"
                key={title}
                onClick={() => selectTitle(title)}
                className={`focus-ring flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                  selected
                    ? "border-moss/70 bg-moss/10 text-moss"
                    : "border-line/70 bg-white hover:border-moss hover:bg-[#fbfdf9]"
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

      <ResultDetailSection title="3. 블로그 본문" defaultOpen copyActive={copied === "body"} onCopy={() => copyText("body")}>
        <textarea
          value={blogBody}
          onChange={(event) => updateBody(event.target.value)}
          rows={24}
          className="focus-ring min-h-[560px] w-full rounded-md border border-line/70 bg-white p-5 text-[15px] leading-8 text-ink/85 shadow-inner shadow-black/[0.015] whitespace-pre-wrap"
        />
      </ResultDetailSection>

      <ResultDetailSection title="4. 사진 배치 가이드" defaultOpen copyActive={copied === "images"} onCopy={() => copyText("images")}>
        <PhotoGuideList items={photoGuide} />
      </ResultDetailSection>

      <ResultDetailSection title="5. 업체/상품 정보 정리" copyActive={copied === "info"} onCopy={() => copyText("info")}>
        <KeyValueList items={packageData.infoSummary || []} />
      </ResultDetailSection>

      <ResultDetailSection title="6. FAQ" copyActive={copied === "faq"} onCopy={() => copyText("faq")}>
        <FaqList items={packageData.faqItems || []} />
      </ResultDetailSection>

      <ResultDetailSection title="7. 해시태그" copyActive={copied === "hashtags"} onCopy={() => copyText("hashtags")}>
        <KeywordChips items={hashtags} />
      </ResultDetailSection>
    </div>
  );
}

function ResultMetric({ label, value }) {
  return (
    <div className="rounded-md border border-line/60 bg-white px-3 py-2">
      <p className="text-[11px] font-bold text-ink/45">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

function ResultDetailSection({ title, children, defaultOpen = false, copyActive = false, onCopy }) {
  return (
    <details open={defaultOpen} className="rounded-lg border border-line/60 bg-[#fffefa] p-3 shadow-[0_8px_18px_rgba(31,36,40,0.025)]">
      <summary className="cursor-pointer text-sm font-bold text-ink/75">
        {title}
      </summary>
      <div className="mt-3 space-y-3">
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="focus-ring inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-line/70 bg-white px-2.5 text-xs font-bold text-ink/55 transition hover:border-moss/50 hover:text-moss"
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
        <div key={label} className="rounded-md border border-line/60 bg-white p-3 text-sm leading-6">
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
    <div className="flex flex-wrap gap-2 rounded-md border border-line/60 bg-white p-3">
      {items.map((item) => (
        <span key={item} className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
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
        <li key={`${item}-${index}`} className="flex gap-2 rounded-md border border-line/60 bg-white p-3 text-sm leading-6 text-ink/70">
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
        <div key={item.question} className="rounded-md border border-line/60 bg-white p-3 text-sm leading-6">
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

function UsageSteps() {
  const steps = [
    ["입력", "사진 또는 메모를 넣습니다."],
    ["생성", "초안 만들기 버튼을 누릅니다."],
    ["결과", "필요한 섹션을 확인하고 복사합니다."]
  ];

  return (
    <details className="rounded-lg border border-line/70 bg-white/85 px-4 py-3 shadow-[0_8px_22px_rgba(31,36,40,0.04)]">
      <summary className="cursor-pointer text-sm font-bold text-ink/65">
        간단 흐름 보기: 입력 → 생성 → 결과
      </summary>
      <ol className="mt-3 grid gap-2 md:grid-cols-3">
        {steps.map(([step, description]) => (
          <li key={step} className="rounded-md border border-line/70 bg-[#fbfaf6] p-3">
            <span className="inline-flex min-h-6 items-center rounded-md bg-moss/10 px-2 text-xs font-bold text-moss">
              {step}
            </span>
            <p className="mt-2 text-xs font-semibold leading-5 text-ink/55">{description}</p>
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
      <div className="mt-3 rounded-md border border-dashed border-line bg-white p-4 text-center text-sm font-semibold text-ink/50">
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
                placeholder="예: 탕수육 클로즈업, 메뉴판, 성분표, 아이가 좋아한 공간"
              />
            </details>
          )}
          {showDetails && item.message && (
            <p className="mt-2 text-xs font-semibold leading-5 text-ink/55">{item.message}</p>
          )}
          {showDetails && item.ocrText && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-bold text-moss">추출 원문 보기</summary>
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
