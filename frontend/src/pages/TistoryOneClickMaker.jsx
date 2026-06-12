import {
  Check,
  Clipboard,
  FileText,
  Image,
  RefreshCw,
  Upload,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import StatusBadge from "../components/StatusBadge.jsx";
import { createTistoryDraft } from "../lib/tistoryGenerator.js";

const initialForm = {
  keyword: "",
  memo: ""
};

const emptyResult = {
  title: "",
  introSummary: [],
  toc: [],
  sections: [],
  keyTakeaways: [],
  faq: [],
  tags: [],
  body: ""
};

const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGES = 10;

const createImageItem = (file, source = "upload") => ({
  id: `tistory-image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  file,
  url: URL.createObjectURL(file),
  name: file.name || (source === "paste" ? "붙여넣은 이미지" : "참고 이미지"),
  source
});

const resultToClipboard = (result) =>
  [
    result.title,
    "",
    result.body
  ]
    .join("\n")
    .trim();

export default function TistoryOneClickMaker() {
  const pasteAreaRef = useRef(null);
  const imagesRef = useRef([]);
  const [form, setForm] = useState(initialForm);
  const [images, setImages] = useState([]);
  const [result, setResult] = useState(emptyResult);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");

  const isReady = useMemo(() => Boolean(form.keyword.trim()), [form.keyword]);
  const hasResult = Boolean(result.body);

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
    setStatus("idle");
    setCopied("");
  };

  const appendImages = (files, source = "upload") => {
    const accepted = Array.from(files).filter((file) => supportedImageTypes.has(file.type));

    if (accepted.length === 0) {
      setMessage("PNG, JPG, WEBP 형식의 이미지만 추가할 수 있습니다.");
      return;
    }

    setImages((current) => {
      const remainingSlots = Math.max(0, MAX_IMAGES - current.length);
      const nextFiles = accepted.slice(0, remainingSlots);
      const overflowCount = accepted.length - nextFiles.length;

      setMessage(
        overflowCount > 0
          ? `사진은 최대 ${MAX_IMAGES}장까지 넣을 수 있어요. ${overflowCount}장은 제외했습니다.`
          : "참고 사진이 추가되었습니다."
      );

      return [...current, ...nextFiles.map((file) => createImageItem(file, source))];
    });
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

  const generatePost = () => {
    if (!isReady) return;

    const draft = createTistoryDraft({
      ...form,
      imageCount: images.length,
      imageNames: images.map((item) => item.name)
    });
    setResult(draft);
    setStatus("generated");
    setMessage("티스토리에 복사해서 붙여넣기 좋은 정보형 포스팅 초안을 만들었습니다.");
  };

  const copyText = async (mode = "full") => {
    const value =
      mode === "title"
        ? result.title
        : mode === "tags"
          ? result.tags.join(" ")
          : resultToClipboard(result);

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
          <p className="text-sm font-semibold text-coral">검색형 정보글 초안</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">원클릭 티스토리 글쓰기</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/60">
            키워드와 간단한 메모를 넣으면 티스토리에 맞는 정보형 포스팅 초안을 만들어드립니다.
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      {message && (
        <p className="rounded-md border border-line bg-white px-4 py-3 text-sm font-semibold text-moss shadow-soft">
          {message}
        </p>
      )}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(340px,0.38fr)_minmax(0,0.62fr)]">
        <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">티스토리 원클릭 입력</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {isReady ? "초안 준비 완료" : "키워드 입력"}
            </span>
          </div>

          <div className="mt-4 rounded-md border border-moss/20 bg-moss/10 p-3 text-sm leading-6 text-ink/70">
            <p className="text-xs font-bold text-moss">티스토리 정보글은 이렇게 만들어요</p>
            <p className="mt-1 font-semibold">
              주제와 짧은 메모만 입력해도 티스토리에 맞는 정보형 글 초안이 생성됩니다.
            </p>
          </div>

          <div className="mt-5 space-y-5">
            <label className="block">
              <FieldLabel required>주제/키워드</FieldLabel>
              <input
                value={form.keyword}
                onChange={(event) => updateForm("keyword", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="예: 초등 독서노트 쓰는 법 / 티스토리 애드센스 승인 준비 / 장마철 제습기 고르는 법"
              />
            </label>

            <label className="block">
              <FieldLabel>참고 메모</FieldLabel>
              <textarea
                value={form.memo}
                onChange={(event) => updateForm("memo", event.target.value)}
                rows={5}
                className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
                placeholder="예: 초등학생이 부담 없이 독서 기록을 남길 수 있는 방법을 정리하고 싶어요. 준비물, 쓰는 순서, 부모가 도와줄 점, 자주 묻는 질문까지 넣고 싶어요."
              />
            </label>

            <section>
              <FieldLabel>사진 선택 입력</FieldLabel>
              <div
                ref={pasteAreaRef}
                role="button"
                tabIndex={0}
                onPaste={handlePaste}
                onClick={() => pasteAreaRef.current?.focus()}
                className="focus-ring mt-2 rounded-md border border-dashed border-line bg-paper p-4 transition hover:border-moss hover:bg-white"
              >
                <div className="flex flex-col items-center justify-center text-center">
                  <Upload size={24} className="text-moss" aria-hidden="true" />
                  <p className="mt-2 text-sm font-bold text-ink/70">
                    참고 사진은 최대 {MAX_IMAGES}장까지 넣을 수 있어요.
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-ink/50">
                    파일을 올리거나 Ctrl+V로 붙여넣어도 됩니다. 사진이 없어도 글 생성은 가능합니다.
                  </p>
                  <label className="focus-ring mt-3 inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-bold transition hover:border-moss hover:text-moss">
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

              {images.length > 0 && (
                <div className="mt-3 grid auto-cols-[minmax(160px,70vw)] grid-flow-col gap-3 overflow-x-auto pb-1 sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible">
                  {images.map((item, index) => (
                    <div key={item.id} className="rounded-md border border-line bg-paper p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-bold text-moss">사진 {index + 1}</p>
                        <button
                          type="button"
                          onClick={() => removeImage(item.id)}
                          className="focus-ring rounded-md border border-line bg-white px-2 py-1 text-xs font-bold text-ink/55 transition hover:border-coral hover:text-coral"
                        >
                          삭제
                        </button>
                      </div>
                      <img src={item.url} alt={item.name} className="mt-2 h-24 w-full rounded-md border border-line bg-white object-contain" />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <button
              type="button"
              onClick={generatePost}
              disabled={!isReady}
              className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-bold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
            >
              <WandSparkles size={18} aria-hidden="true" />
              티스토리 글 초안 만들기
            </button>
          </div>
        </section>

        <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-moss">생성 결과</p>
              <h3 className="mt-1 text-lg font-bold">티스토리 정보형 포스팅 초안</h3>
            </div>
            <FileText size={22} className="text-moss" aria-hidden="true" />
          </div>

          {!hasResult && (
            <div className="mt-5 grid min-h-[420px] place-items-center rounded-lg border border-dashed border-line bg-paper p-6 text-center text-sm font-semibold leading-6 text-ink/55">
              주제/키워드를 넣고 티스토리 글 초안 만들기를 누르면 검색형 구조가 표시됩니다.
            </div>
          )}

          {hasResult && (
            <div className="mt-5 space-y-5">
              <div className="rounded-lg border border-moss/25 bg-moss/10 p-4 text-sm font-semibold leading-6 text-ink/65">
                <p className="font-bold text-moss">복사해서 바로 티스토리에 붙여넣기 가능</p>
                <p className="mt-1">
                  초안은 복사 후 내 말투에 맞게 한 번만 다듬으면 더 자연스럽습니다.
                </p>
              </div>

              <ResultBlock title="1. 검색형 제목">
                <p className="text-xl font-bold leading-8 text-ink">{result.title}</p>
              </ResultBlock>

              <ResultBlock title="2. 도입 요약">
                <TextList items={result.introSummary} />
              </ResultBlock>

              <ResultBlock title="3. 목차">
                <TextList items={result.toc.map((item, index) => `${index + 1}. ${item}`)} />
              </ResultBlock>

              <ResultBlock title="4. 본문 소제목">
                <div className="space-y-4">
                  {result.sections.map((section, index) => (
                    <article key={section.id} className="rounded-md border border-line bg-paper p-3">
                      <h5 className="text-sm font-bold text-ink">{index + 1}. {section.heading}</h5>
                      <TextList items={section.paragraphs} className="mt-2" />
                    </article>
                  ))}
                </div>
              </ResultBlock>

              <ResultBlock title="5. 핵심 정리">
                <TextList items={result.keyTakeaways} />
              </ResultBlock>

              <ResultBlock title="6. FAQ">
                <div className="space-y-3">
                  {result.faq.map((item, index) => (
                    <div key={`${item.question}-${index}`} className="rounded-md border border-line bg-paper p-3">
                      <p className="text-sm font-bold text-ink/75">Q. {item.question}</p>
                      <p className="mt-1 text-sm leading-6 text-ink/65">A. {item.answer}</p>
                    </div>
                  ))}
                </div>
              </ResultBlock>

              <ResultBlock title="7. 해시태그 또는 태그">
                <div className="flex flex-wrap gap-2">
                  {result.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
                      {tag}
                    </span>
                  ))}
                </div>
              </ResultBlock>

              <ResultBlock title="8. 전체 글 복사하기">
                <div className="grid gap-2 sm:grid-cols-3">
                  <CopyButton active={copied === "full"} onClick={() => copyText("full")}>
                    전체 글 복사하기
                  </CopyButton>
                  <CopyButton active={copied === "title"} onClick={() => copyText("title")}>
                    제목 복사하기
                  </CopyButton>
                  <CopyButton active={copied === "tags"} onClick={() => copyText("tags")}>
                    태그 복사하기
                  </CopyButton>
                  <button
                    type="button"
                    onClick={generatePost}
                    className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-moss hover:text-moss sm:col-span-3"
                  >
                    <RefreshCw size={17} aria-hidden="true" />
                    다시 만들기
                  </button>
                </div>
              </ResultBlock>
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

function ResultBlock({ title, children }) {
  return (
    <section className="rounded-md border border-line bg-white p-4">
      <h4 className="text-sm font-bold text-ink/70">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function TextList({ items = [], className = "" }) {
  return (
    <ul className={`space-y-2 text-sm leading-6 text-ink/75 ${className}`}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
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
