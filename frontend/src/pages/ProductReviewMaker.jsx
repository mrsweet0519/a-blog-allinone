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
  targetLength: "1500",
  selectedTitle: ""
};

const emptyResult = {
  titles: [],
  selectedTitle: "",
  body: "",
  hashtags: [],
  imageSuggestions: []
};

const toneOptions = ["친근한", "차분한", "전문적인", "활기찬"];
const reviewCategoryOptions = [
  { value: "", label: "자동 추정" },
  { value: "restaurant", label: "맛집/카페 후기" },
  { value: "product", label: "상품 후기" },
  { value: "kids-place", label: "아이 동반 장소 후기" },
  { value: "place", label: "장소/체험 후기" },
  { value: "education", label: "교육/강의 후기" }
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

const resultToClipboard = (result, { includeImageMarkers = true } = {}) =>
  [
    result.selectedTitle,
    "",
    includeImageMarkers ? result.body : stripImageMarkers(result.body),
    "",
    result.hashtags.join(" ")
  ]
    .join("\n")
    .trim();

const imageKeywordsToClipboard = (items = []) =>
  items
    .map((item, index) =>
      [`이미지 ${index + 1} 검색어`, item.searchKeyword].filter(Boolean).join("\n")
    )
    .filter(Boolean)
    .join("\n\n");

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
    () => form.mainKeyword.trim() || form.productName.trim(),
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
          `사진 ${item.index}: ${item.name}`,
          item.note ? `사진 메모: ${item.note}` : "",
          item.ocrText ? `사진에서 읽은 내용: ${item.ocrText}` : ""
        ].filter(Boolean).join("\n")
      )
    );
    const topic = reviewTopic || form.mainKeyword || form.productName;

    return {
      ...form,
      productName: form.productName || topic,
      mainKeyword: topic,
      keyword: topic,
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
            ? "이미지에서 읽은 정보를 정리했습니다. 확인 필요 항목은 직접 수정한 뒤 후기글 생성에 반영해주세요."
            : "이미지에서 읽은 내용을 확인하고 필요한 부분만 수정해주세요. 수정한 내용은 후기글 생성에 반영됩니다."
        );
      } else {
        setOcrStatus("manual");
        setOcrMessage("이미지에서 내용을 정확히 읽지 못했습니다. 필요한 정보만 직접 입력해도 후기글을 만들 수 있습니다.");
      }
    } else {
      setOcrStatus("manual");
      setProductInfoOpen(true);
      setOcrMessage("이미지에서 내용을 정확히 읽지 못했습니다. 아래 영역에 상품 정보를 직접 입력해도 후기글을 만들 수 있습니다.");
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
        keyword: reviewTopic,
        targetLengthOption: form.targetLength,
        customTargetLength: form.targetLength
      },
      {
        ...result,
        selectedTopic: "사진+메모 후기글",
        selectedTitleType: "후기글"
      },
      draftId
    );

    setDraftId(saved.id);
    setDraftMessage("보관함에 저장했습니다.");
    setStatus("saved");
  };

  const copyText = async (mode) => {
    if (!hasResult) return;

    const value =
      mode === "body"
        ? stripImageMarkers(result.body)
        : mode === "hashtags"
          ? result.hashtags.join(" ")
          : mode === "images"
            ? imageKeywordsToClipboard(result.imageSuggestions)
            : resultToClipboard(result, { includeImageMarkers: true });

    if (!value) return;

    await navigator.clipboard.writeText(value);
    setCopied(mode);
    setStatus("copied");
    window.setTimeout(() => setCopied((current) => (current === mode ? "" : current)), 1600);
  };

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">사진과 메모 기반 블로그 초안</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">후기글 만들기</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60">
            사진과 기억나는 내용만 넣으면 블로그 후기 초안을 만들어드려요.
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(360px,0.4fr)_minmax(0,0.6fr)]">
        <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">후기글 만들기</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {isReady ? "입력 완료" : "입력 전"}
            </span>
          </div>
          <div className="mt-4 rounded-md border border-moss/20 bg-moss/10 p-3 text-sm leading-6 text-ink/70">
            <p className="font-semibold">
              사진과 메모만 넣으면 블로그 후기 초안이 나옵니다.
            </p>
            <ul className="mt-2 grid gap-1 text-xs font-semibold text-ink/55">
              <li>맛집 후기: 메뉴, 분위기, 동행, 재방문 기준</li>
              <li>상품 후기: 사용감, 장점, 아쉬운 점, 추천 대상</li>
              <li>장소 후기: 동선, 주차, 아이 반응, 부모 피로도</li>
            </ul>
          </div>

          <div className="mt-5 space-y-5">
            <label className="block">
              <FieldLabel required>어떤 후기를 쓸까요?</FieldLabel>
              <input
                value={form.mainKeyword}
                onChange={(event) => updateForm("mainKeyword", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="예: 역삼역 중식당 회식 후기 / 수분크림 직접 써본 후기 / 아이랑 다녀온 실내 체험공간 후기"
              />
            </label>

            <section>
              <FieldLabel>사진 추가</FieldLabel>
              <div
                ref={pasteAreaRef}
                role="button"
                tabIndex={0}
                onPaste={handlePaste}
                onClick={() => pasteAreaRef.current?.focus()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") pasteAreaRef.current?.focus();
                }}
                className="focus-ring mt-2 rounded-md border border-dashed border-line bg-paper p-4 transition hover:border-moss hover:bg-white"
              >
                <div className="flex flex-col items-center justify-center text-center">
                  <Upload size={24} className="text-moss" aria-hidden="true" />
                  <p className="mt-2 text-sm font-bold text-ink/70">
                    사진은 최대 {MAX_REVIEW_IMAGES}장까지 넣을 수 있어요.
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                    파일을 올리거나 Ctrl+V로 붙여넣어도 됩니다. 사진이 없으면 기억나는 내용만 적어도 괜찮아요.
                  </p>
                  <label className="focus-ring mt-3 inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-bold transition hover:border-moss hover:text-moss">
                    사진 업로드
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

            <label className="block">
              <FieldLabel>기억나는 내용을 적어주세요</FieldLabel>
              <textarea
                value={form.experienceMemo}
                onChange={(event) => updateForm("experienceMemo", event.target.value)}
                rows={6}
                className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
                placeholder="예: 탕수육이 바삭했고 어향가지가 맛있었어요. 4명이 먹기 좋았고 가격과 주차는 확인이 필요해요."
              />
            </label>

            <details className="rounded-md border border-line bg-paper p-3">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-sm font-bold text-ink/70">자세한 설정</span>
                    <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                      글 톤, 협찬 표시, 사진 속 글자 읽기, 이미지별 메모는 필요할 때만 열어보세요.
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
                        사진 속 글자, 파일명, 이미지별 메모가 글 생성에 함께 반영됩니다.
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

            <div className="rounded-md border border-moss/20 bg-moss/10 p-3">
              <p className="text-xs font-semibold leading-5 text-ink/60">
                {isReady
                  ? "사진과 메모를 바탕으로 바로 복사 가능한 블로그 후기 초안을 만듭니다."
                  : "후기 주제를 적고, 사진 또는 기억나는 내용 중 하나 이상을 넣어주세요."}
              </p>
              <button
                type="button"
                onClick={() => generateReview()}
                disabled={!isReady || status === "generating" || isReading}
                className="focus-ring mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-bold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                <WandSparkles size={18} aria-hidden="true" />
                후기글 생성
              </button>
            </div>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-moss">생성 결과</p>
              <h3 className="mt-1 text-lg font-bold">블로그 후기 초안</h3>
            </div>
            <PackageSearch size={22} className="text-moss" aria-hidden="true" />
          </div>

          {!hasResult && (
            <div className="mt-5 grid min-h-[420px] place-items-center rounded-lg border border-dashed border-line bg-paper p-6 text-center text-sm font-semibold leading-6 text-ink/55">
              후기 주제를 적고 사진 또는 기억나는 내용 중 하나 이상을 넣은 뒤 후기글 생성을 누르세요.
            </div>
          )}

          {hasResult && (
            <div className="mt-5 space-y-5">
              <div>
                <h4 className="text-sm font-bold text-ink/70">1. 제목</h4>
                <input
                  value={result.selectedTitle}
                  onChange={(event) => {
                    const title = event.target.value;
                    setResult((current) => ({ ...current, selectedTitle: title }));
                    setForm((current) => ({ ...current, selectedTitle: title }));
                  }}
                  className="focus-ring mt-2 min-h-12 w-full rounded-md border border-line bg-paper px-3 text-base font-bold text-ink"
                />
              </div>

              <div>
                <h4 className="text-sm font-bold text-ink/70">2. 블로그 본문</h4>
                <textarea
                  value={result.body}
                  onChange={(event) => setResult((current) => ({ ...current, body: event.target.value }))}
                  rows={18}
                  className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-7 whitespace-pre-wrap"
                />
              </div>

              <PhotoPlacementList items={result.imageSuggestions} />

              <div>
                <h4 className="text-sm font-bold text-ink/70">4. 해시태그</h4>
                <div className="mt-2 flex flex-wrap gap-2 rounded-md border border-line bg-paper p-3">
                  {result.hashtags.map((tag) => (
                    <span key={tag} className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-ink/70">5. 복사와 저장</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <CopyButton active={copied === "body"} onClick={() => copyText("body")}>
                    본문 복사
                  </CopyButton>
                  <CopyButton active={copied === "hashtags"} onClick={() => copyText("hashtags")}>
                    해시태그 복사
                  </CopyButton>
                  <CopyButton active={copied === "full"} onClick={() => copyText("full")}>
                    전체 복사
                  </CopyButton>
                  <button
                    type="button"
                    onClick={() => generateReview(result.selectedTitle)}
                    className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-moss hover:text-moss"
                  >
                    <RefreshCw size={17} aria-hidden="true" />
                    다시 생성
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

              <details className="rounded-md border border-line bg-paper p-3">
                <summary className="cursor-pointer text-sm font-bold text-moss">
                  글 작성 참고 정보 보기
                </summary>
                <div className="mt-4 space-y-5">
                  <TitleCandidates result={result} onSelect={selectTitle} onRegenerate={() => generateReview()} />
                  <ImageSuggestionCards items={result.imageSuggestions} />
                  <div className="rounded-md border border-line bg-white p-3 text-sm leading-6 text-ink/65">
                    <p className="font-bold text-ink/70">입력 반영 정보</p>
                    <p className="mt-2">글 주제: {reviewTopic || "미입력"}</p>
                    <p>카테고리: {reviewCategoryOptions.find((option) => option.value === form.category)?.label || "자동 추정"}</p>
                    <p>사진 수: {images.length}장</p>
                    <p>메모: {form.experienceMemo.trim() ? "반영됨" : "미입력"}</p>
                  </div>
                </div>
              </details>
            </div>
          )}
        </section>
      </div>
    </div>
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

function PhotoPlacementList({ items = [] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <Image size={17} className="text-moss" aria-hidden="true" />
        <h4 className="text-sm font-bold text-ink/70">3. 사진 넣을 위치</h4>
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
          다시 생성
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
