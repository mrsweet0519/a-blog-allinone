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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [fieldMeta, setFieldMeta] = useState(() => createInitialFieldMeta());

  const isReady = useMemo(
    () => Boolean(form.productName.trim() && form.mainKeyword.trim() && form.experienceMemo.trim()),
    [form]
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
  };

  const appendImages = (files, source = "upload") => {
    const accepted = Array.from(files).filter((file) => supportedImageTypes.has(file.type));

    if (accepted.length === 0) {
      setOcrWarnings(["PNG, JPG, WEBP 형식의 이미지만 추가할 수 있습니다."]);
      return;
    }

    setImages((current) => [...current, ...accepted.map((file) => createImageItem(file, source))]);
    setOcrStatus("idle");
    setProductInfoOpen(true);
    setOcrMessage("이미지가 추가되었습니다. 상품 정보를 읽어보려면 '이미지에서 상품 정보 추출'을 눌러주세요.");
    setOcrWarnings([]);
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

    const draft = createProductReviewDraft({
      ...form,
      selectedTitle: selectedTitle || form.selectedTitle
    });

    setResult(draft);
    setForm((current) => ({ ...current, selectedTitle: draft.selectedTitle }));
    setStatus("generated");
  };

  const selectTitle = (title) => {
    const draft = createProductReviewDraft({
      ...form,
      selectedTitle: title
    });

    setForm((current) => ({ ...current, selectedTitle: title }));
    setResult(draft);
    setStatus("generated");
  };

  const copyText = async (mode) => {
    if (!hasResult) return;

    const value =
      mode === "body"
        ? resultToClipboard(result, { includeImageMarkers: false })
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
          <p className="text-sm font-semibold text-coral">후기형 포스팅 작업 화면</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">상품 후기 메이커</h2>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(360px,0.4fr)_minmax(0,0.6fr)]">
        <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">입력값</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {isReady ? "입력 완료" : "입력 전"}
            </span>
          </div>
          <div className="mt-4 rounded-md border border-moss/20 bg-moss/10 p-3 text-sm leading-6 text-ink/70">
            <p className="font-semibold">
              상품명, 키워드, 상품 이미지, 간단한 경험 메모만 넣으면 후기형 블로그 글 초안을 만들 수 있습니다.
            </p>
            <ul className="mt-2 grid gap-1 text-xs font-semibold text-ink/55">
              <li>수분크림 후기: 사용감, 보습력, 데일리 케어</li>
              <li>무선 미니청소기 후기: 흡입력, 원룸 청소, 보관 편의성</li>
              <li>아기 식판 후기: 세척 편의성, 흡착력, 이유식 준비</li>
            </ul>
          </div>

          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel required>상품명/브랜드명</FieldLabel>
                <input
                  value={form.productName}
                  onChange={(event) => updateForm("productName", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 수분크림, 무선 미니청소기, 아기 식판"
                />
              </label>

              <label className="block">
                <FieldLabel required>메인 키워드</FieldLabel>
                <input
                  value={form.mainKeyword}
                  onChange={(event) => updateForm("mainKeyword", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 수분크림 후기, 피부 보습, 데일리 크림"
                />
              </label>
            </div>

            <section>
              <FieldLabel>상품 상세 이미지 붙여넣기</FieldLabel>
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
                    Ctrl+V로 여러 장을 붙여넣을 수 있습니다.
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                    상품 이미지나 상세페이지 캡처를 넣으면 읽은 내용을 확인하고 필요한 부분만 수정할 수 있습니다.
                  </p>
                  <label className="focus-ring mt-3 inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-bold transition hover:border-moss hover:text-moss">
                    파일 여러 장 업로드
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
              />

              <button
                type="button"
                onClick={extractInfoFromImages}
                disabled={isReading}
                className="focus-ring mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-bold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {isReading ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
                이미지에서 상품 정보 추출
              </button>
            </section>

            <label className="block">
              <FieldLabel required>내가 느낀 점 또는 쓰고 싶은 내용</FieldLabel>
              <textarea
                value={form.experienceMemo}
                onChange={(event) => updateForm("experienceMemo", event.target.value)}
                rows={6}
                className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
                placeholder={`예:\n처음에는 보습력이 궁금해서 찾아봤어요.\n사용감이 무겁지 않은지 보고 싶었어요.\n아침저녁으로 부담 없이 쓸 수 있는 제품인지 확인하고 싶었어요.`}
              />
            </label>

            <button
              type="button"
              onClick={() => generateReview()}
              disabled={!isReady || status === "generating" || isReading}
              className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-bold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
            >
              <WandSparkles size={18} aria-hidden="true" />
              후기글 생성
            </button>

            <div className="rounded-md border border-line bg-white p-3">
              <p className="text-sm font-bold text-ink/70">간단 설정</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <FieldLabel>글 톤</FieldLabel>
                  <select
                    value={form.tone}
                    onChange={(event) => updateForm("tone", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
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
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  />
                </label>
              </div>
            </div>

            <details
              open={productInfoOpen}
              onToggle={(event) => setProductInfoOpen(event.currentTarget.open)}
              className="rounded-md border border-line bg-paper p-3"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-sm font-bold text-ink/70">사진에서 읽은 내용 / 상품 정보 보정</span>
                    <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                      {images.length > 0
                        ? "읽은 내용을 확인하고 필요한 부분만 수정할 수 있습니다."
                        : "상품 이미지를 넣으면 읽은 내용을 확인할 수 있습니다."}
                    </p>
                  </div>
                  <span className="inline-flex min-h-8 items-center justify-center rounded-md border border-line bg-white px-3 text-xs font-bold text-moss">
                    {productInfoOpen ? "접기" : "열기"}
                  </span>
                </div>
              </summary>

              <div className="mt-3 space-y-3">
                <p className="rounded-md border border-moss/20 bg-white px-3 py-2 text-xs font-semibold leading-5 text-ink/60">
                  {images.length > 0
                    ? "이미지에서 읽은 정보는 초안입니다. 정확하지 않은 항목은 비워두었습니다. 필요한 정보만 직접 채워도 후기글을 만들 수 있습니다."
                    : "이미지가 없거나 글자를 정확히 읽지 못해도 아래에 상품 정보를 직접 입력하면 후기글을 만들 수 있습니다."}
                </p>
                <div className="grid gap-3">
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
                      {fieldMeta[field]?.reason && (
                        <span className="mt-1 block text-[11px] font-semibold leading-4 text-ink/45">
                          {fieldMeta[field].reason}
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                <details
                  open={rawTextOpen}
                  onToggle={(event) => setRawTextOpen(event.currentTarget.open)}
                  className="rounded-md border border-line bg-white p-3"
                >
                  <summary className="cursor-pointer text-sm font-bold text-moss">
                    추출 원문 전체 보기
                  </summary>
                  <label className="mt-3 block">
                    <span className="text-xs font-bold text-ink/55">추출 원문</span>
                    <textarea
                      value={form.productInfoText}
                      onChange={(event) => updateForm("productInfoText", event.target.value)}
                      rows={6}
                      className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
                      placeholder="OCR 결과가 없거나 틀리면 상품명, 성분, 구성, 사용 방법, 특징을 직접 적어주세요."
                    />
                  </label>
                </details>
              </div>
            </details>

            <details
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
              className="rounded-md border border-line bg-white p-3"
            >
              <summary className="cursor-pointer text-sm font-bold text-ink/70">
                고급 설정
              </summary>
              <div className="mt-3 grid gap-3">
                <label className="block">
                  <FieldLabel>강조하고 싶은 포인트</FieldLabel>
                  <input
                    value={form.emphasisPoints}
                    onChange={(event) => updateForm("emphasisPoints", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                    placeholder="예: 사용감, 보습력, 휴대성, 구성, 가격대"
                  />
                </label>

                <label className="block">
                  <FieldLabel>피하고 싶은 표현/금지어</FieldLabel>
                  <input
                    value={form.avoidWords}
                    onChange={(event) => updateForm("avoidWords", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                    placeholder="예: 무조건, 보장, 완벽, 즉시효과"
                  />
                </label>
              </div>
            </details>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-moss">결과</p>
              <h3 className="mt-1 text-lg font-bold">후기형 포스팅 초안</h3>
            </div>
            <PackageSearch size={22} className="text-moss" aria-hidden="true" />
          </div>

          {!hasResult && (
            <div className="mt-5 grid min-h-[420px] place-items-center rounded-lg border border-dashed border-line bg-paper p-6 text-center text-sm font-semibold leading-6 text-ink/55">
              상품명, 메인 키워드, 경험 메모를 입력한 뒤 후기글 생성을 누르세요.
            </div>
          )}

          {hasResult && (
            <div className="mt-5 space-y-5">
              <TitleCandidates result={result} onSelect={selectTitle} onRegenerate={() => generateReview()} />

              <div>
                <h4 className="text-sm font-bold text-ink/70">2. 게시용 본문</h4>
                <textarea
                  value={result.body}
                  onChange={(event) => setResult((current) => ({ ...current, body: event.target.value }))}
                  rows={18}
                  className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-7 whitespace-pre-wrap"
                />
              </div>

              <div>
                <h4 className="text-sm font-bold text-ink/70">3. 해시태그</h4>
                <div className="mt-2 flex flex-wrap gap-2 rounded-md border border-line bg-paper p-3">
                  {result.hashtags.map((tag) => (
                    <span key={tag} className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-ink/70">4. 복사</h4>
                <div className="mt-2 grid gap-2 lg:grid-cols-4">
                  <CopyButton active={copied === "full"} onClick={() => copyText("full")}>
                    이미지 표시 포함
                  </CopyButton>
                  <CopyButton active={copied === "body"} onClick={() => copyText("body")}>
                    본문 복사
                  </CopyButton>
                  <CopyButton active={copied === "hashtags"} onClick={() => copyText("hashtags")}>
                    해시태그 복사
                  </CopyButton>
                  <CopyButton active={copied === "images"} onClick={() => copyText("images")}>
                    이미지 검색어
                  </CopyButton>
                </div>
              </div>

              <ImageSuggestionCards items={result.imageSuggestions} />
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

function ImageGrid({ images = [], onRemove, onMove, onNoteChange }) {
  if (images.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-dashed border-line bg-white p-4 text-center text-sm font-semibold text-ink/50">
        아직 추가된 이미지가 없습니다.
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
          <details className="mt-2 rounded-md border border-line bg-paper p-2 text-xs">
            <summary className="cursor-pointer font-bold text-ink/60">이미지별 메모</summary>
            <textarea
              value={item.note}
              onChange={(event) => onNoteChange(item.id, event.target.value)}
              rows={2}
              className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-2 leading-5"
              placeholder="예: 성분표, 사용법, 가격 정보"
            />
          </details>
          {item.message && (
            <p className="mt-2 text-xs font-semibold leading-5 text-ink/55">{item.message}</p>
          )}
          {item.ocrText && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-bold text-moss">추출 원문 보기</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-paper p-2 leading-5 text-ink/60">{item.ocrText}</p>
            </details>
          )}
          {item.warnings.length > 0 && (
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
        <h4 className="text-sm font-bold text-ink/70">1. 후기형 제목 후보</h4>
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
        <h4 className="text-sm font-bold text-ink/70">5. 이미지 추천 카드</h4>
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
