import {
  AlertCircle,
  Check,
  Clipboard,
  FileText,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 1_600_000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const initialForm = {
  topic: "",
  mainKeyword: "",
  subKeywords: "",
  experienceStatus: "",
  details: "",
  tone: "친근한",
  targetLength: "1200"
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });

const requestSimpleDraft = async (payload) => {
  const apiBase = import.meta.env.DEV ? "http://localhost:4000" : "";
  const response = await fetch(`${apiBase}/api/generate-blog-simple`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || "빠른 초안을 만들지 못했습니다.");
    error.data = data;
    throw error;
  }

  return data;
};

const fullResultText = (result = {}) =>
  [
    result.finalTitle,
    "",
    result.body,
    result.faq?.length
      ? ["", "자주 묻는 질문", ...result.faq.flatMap((item) => [`Q. ${item.question}`, `A. ${item.answer}`, ""])].join("\n")
      : "",
    result.hashtags?.length ? `\n${result.hashtags.join(" ")}` : ""
  ]
    .filter((item) => item !== undefined && item !== null)
    .join("\n")
    .trim();

export default function SimpleBlogMaker() {
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(initialForm);
  const [photos, setPhotos] = useState([]);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");

  const actualMemoMissing =
    form.experienceStatus === "actual" && form.details.trim().length === 0;
  const isReady = useMemo(
    () =>
      Boolean(
        form.topic.trim() &&
          form.experienceStatus &&
          (form.experienceStatus !== "actual" || form.details.trim())
      ),
    [form.details, form.experienceStatus, form.topic]
  );

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const addPhotos = async (files) => {
    const available = Math.max(0, MAX_PHOTOS - photos.length);
    const selected = Array.from(files).slice(0, available);
    const warnings = [];
    const accepted = [];

    for (const file of selected) {
      if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
        warnings.push(`${file.name}: PNG, JPG, WEBP 파일만 사용할 수 있습니다.`);
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        warnings.push(`${file.name}: 사진은 한 장당 1.6MB 이하여야 합니다.`);
        continue;
      }
      try {
        accepted.push({
          id: `simple-photo-${Date.now()}-${accepted.length}`,
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
          memo: ""
        });
      } catch (error) {
        warnings.push(`${file.name}: ${error.message}`);
      }
    }

    if (Array.from(files).length > available) {
      warnings.push(`사진은 최대 ${MAX_PHOTOS}장까지 추가할 수 있습니다.`);
    }
    setPhotos((current) => [...current, ...accepted].slice(0, MAX_PHOTOS));
    setMessage(warnings.join(" "));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updatePhotoMemo = (photoId, memo) => {
    setPhotos((current) =>
      current.map((photo) => (photo.id === photoId ? { ...photo, memo } : photo))
    );
  };

  const removePhoto = (photoId) => {
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
  };

  const generate = async () => {
    if (!isReady || status === "generating") return;
    setStatus("generating");
    setMessage("");

    try {
      const nextResult = await requestSimpleDraft({
        ...form,
        targetLength: Number(form.targetLength),
        photos: photos.map(({ id, name, type, size, dataUrl, memo }) => ({
          id,
          name,
          type,
          size,
          dataUrl,
          memo
        }))
      });
      setResult(nextResult);
      setStatus("generated");
    } catch (error) {
      setStatus("error");
      setMessage(error.message);
    }
  };

  const copy = async (type) => {
    const value = type === "body" ? result?.body || "" : fullResultText(result);
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(type);
    window.setTimeout(() => setCopied((current) => (current === type ? "" : current)), 1600);
  };

  return (
    <div className="space-y-6 pb-12">
      <header className="rounded-2xl border border-line bg-white p-5 shadow-soft sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-moss text-white">
            <Sparkles size={21} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold text-moss">SIMPLE BETA</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">네이버 블로그 빠른 초안 베타</h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-ink/60">
              입력한 사실과 키워드를 기준으로 블로그 초안을 만듭니다. 실제 경험이 없는 경우에는 사용
              후기처럼 지어내지 않습니다.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-soft sm:p-7">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-moss" aria-hidden="true" />
          <h2 className="text-lg font-bold">초안에 필요한 정보</h2>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Field label="글 주제" required>
            <input
              value={form.topic}
              onChange={(event) => updateForm("topic", event.target.value)}
              className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm font-semibold"
              placeholder="예: 제품 특징과 구매 전 확인할 점"
            />
          </Field>

          <Field label="메인 키워드">
            <input
              value={form.mainKeyword}
              onChange={(event) => updateForm("mainKeyword", event.target.value)}
              className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm font-semibold"
              placeholder="비워두면 글 주제를 사용합니다"
            />
          </Field>

          <Field label="서브 키워드">
            <input
              value={form.subKeywords}
              onChange={(event) => updateForm("subKeywords", event.target.value)}
              className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm"
              placeholder="쉼표로 구분해 입력"
            />
          </Field>

          <div>
            <span className="text-sm font-bold text-ink/75">
              실제 경험 여부 <span className="text-coral">*</span>
            </span>
            <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="실제 경험 여부">
              <ExperienceOption
                checked={form.experienceStatus === "actual"}
                value="actual"
                label="실제 사용·방문 경험이 있음"
                onChange={(value) => updateForm("experienceStatus", value)}
              />
              <ExperienceOption
                checked={form.experienceStatus === "information-only"}
                value="information-only"
                label="제품·서비스 정보만 가지고 작성"
                onChange={(value) => updateForm("experienceStatus", value)}
              />
            </div>
          </div>
        </div>

        <label className="mt-5 block">
          <span className="text-sm font-bold text-ink/75">
            {form.experienceStatus === "actual"
              ? "실제로 기억나는 내용"
              : "기억나는 내용 또는 광고주 제공 정보"}
            {form.experienceStatus === "actual" && <span className="text-coral"> *</span>}
          </span>
          <textarea
            value={form.details}
            onChange={(event) => updateForm("details", event.target.value)}
            rows={6}
            className="focus-ring mt-2 w-full rounded-lg border border-line bg-paper p-3 text-sm leading-7"
            placeholder={
              form.experienceStatus === "actual"
                ? "직접 사용한 기간, 장소, 좋았던 점과 아쉬운 점 등 실제로 기억나는 사실만 적어주세요."
                : "구성, 특징, 용도, 구매 전 확인할 점 등 제공받은 정보를 적어주세요."
            }
          />
          {actualMemoMissing && (
            <span className="mt-2 block text-sm font-semibold text-coral" role="alert">
              실제로 사용하거나 방문하면서 기억나는 내용을 한 문장 이상 입력해주세요.
            </span>
          )}
        </label>

        <div className="mt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold text-ink/75">사진 (선택 · 최대 3장)</p>
              <p className="mt-1 text-xs font-semibold text-ink/45">
                JPG, PNG, WEBP · 장당 1.6MB 이하 · 확인할 사실은 사진 메모에 적어주세요.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={photos.length >= MAX_PHOTOS}
              className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-bold text-ink/65 transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ImagePlus size={17} aria-hidden="true" />
              사진 추가
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              onChange={(event) => addPhotos(event.target.files || [])}
            />
          </div>

          {photos.length > 0 && (
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              {photos.map((photo, index) => (
                <article key={photo.id} className="overflow-hidden rounded-xl border border-line bg-paper">
                  <div className="relative aspect-[4/3] overflow-hidden bg-white">
                    <img src={photo.dataUrl} alt={`업로드 사진 ${index + 1}`} className="h-full w-full object-cover" />
                    <span className="absolute left-2 top-2 rounded-full bg-ink/85 px-2 py-1 text-xs font-bold text-white">
                      사진 {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePhoto(photo.id)}
                      className="focus-ring absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-white text-coral shadow"
                      aria-label={`사진 ${index + 1} 삭제`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <label className="block p-3">
                    <span className="text-xs font-bold text-ink/60">사진 메모</span>
                    <textarea
                      value={photo.memo}
                      onChange={(event) => updatePhotoMemo(photo.id, event.target.value)}
                      rows={3}
                      className="focus-ring mt-2 w-full rounded-lg border border-line bg-white p-2.5 text-sm leading-6"
                      placeholder="사진에서 확인되는 내용이나 촬영 상황"
                    />
                  </label>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="말투">
            <select
              value={form.tone}
              onChange={(event) => updateForm("tone", event.target.value)}
              className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm font-semibold"
            >
              {["친근한", "차분한", "전문적인", "활기찬"].map((tone) => (
                <option key={tone} value={tone}>
                  {tone}
                </option>
              ))}
            </select>
          </Field>
          <Field label="목표 글자 수">
            <select
              value={form.targetLength}
              onChange={(event) => updateForm("targetLength", event.target.value)}
              className="focus-ring mt-2 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-sm font-semibold"
            >
              <option value="800">약 800자</option>
              <option value="1200">약 1,200자</option>
              <option value="1500">약 1,500자</option>
              <option value="2000">약 2,000자</option>
            </select>
          </Field>
        </div>

        {message && (
          <p
            className={`mt-5 flex items-start gap-2 rounded-lg border px-3 py-3 text-sm font-semibold leading-6 ${
              status === "error"
                ? "border-coral/25 bg-coral/10 text-coral"
                : "border-amber/25 bg-amber/10 text-ink/70"
            }`}
            role="status"
          >
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={generate}
          disabled={!isReady || status === "generating"}
          className="focus-ring mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-moss px-5 text-sm font-bold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {status === "generating" ? (
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles size={18} aria-hidden="true" />
          )}
          {status === "generating"
            ? "초안과 안전 검토를 진행하고 있습니다..."
            : result
              ? "다시 만들기"
              : "초안 만들기"}
        </button>
        {!form.experienceStatus && (
          <p className="mt-2 text-center text-xs font-semibold text-ink/45">
            실제 경험 여부를 선택하면 초안 만들기 버튼이 활성화됩니다.
          </p>
        )}
      </section>

      {result && (
        <ResultPanel
          result={result}
          copied={copied}
          onCopy={copy}
          onRegenerate={generate}
          generating={status === "generating"}
        />
      )}
    </div>
  );
}

function Field({ label, required = false, children }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-ink/75">
        {label}
        {required && <span className="text-coral"> *</span>}
      </span>
      {children}
    </label>
  );
}

function ExperienceOption({ checked, value, label, onChange }) {
  return (
    <label
      className={`focus-within:ring-2 focus-within:ring-moss focus-within:ring-offset-2 flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-bold transition ${
        checked ? "border-moss bg-moss/10 text-moss" : "border-line bg-paper text-ink/65"
      }`}
    >
      <input
        type="radio"
        name="experienceStatus"
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.target.value)}
        className="h-4 w-4 accent-[#52796f]"
      />
      {label}
    </label>
  );
}

function ResultPanel({ result, copied, onCopy, onRegenerate, generating }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-soft sm:p-7">
      <header className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div
            className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-xs font-bold ${
              result.publishReady
                ? "border-moss/25 bg-moss/10 text-moss"
                : "border-amber/30 bg-amber/10 text-[#8a650e]"
            }`}
          >
            {result.publishReady ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
            {result.publishReady ? "바로 검토 가능" : "추가 확인 필요"}
          </div>
          <h2 className="mt-3 text-xl font-bold">완성된 빠른 초안</h2>
          <p className="mt-1 text-xs font-semibold text-ink/45">
            {result.experienceStatus === "actual" ? "실제 경험 기반" : "정보 기반"} · 입력 정보{" "}
            {result.informationSufficiency} · 본문 {result.bodyLength.toLocaleString("ko-KR")}자
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton active={copied === "full"} onClick={() => onCopy("full")} label="전체 복사" />
          <CopyButton active={copied === "body"} onClick={() => onCopy("body")} label="본문만 복사" />
          <button
            type="button"
            onClick={onRegenerate}
            disabled={generating}
            className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-bold text-ink/65 hover:border-moss hover:text-moss disabled:opacity-45"
          >
            <RefreshCw size={15} />
            다시 만들기
          </button>
        </div>
      </header>

      {result.reviewWarnings.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber/30 bg-amber/10 p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[#76570b]">
            <AlertCircle size={17} />
            검토 경고
          </h3>
          <ul className="mt-2 space-y-2 pl-5 text-sm font-semibold leading-6 text-ink/65">
            {result.reviewWarnings.map((warning) => (
              <li key={warning} className="list-disc">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <p className="text-xs font-bold text-moss">최종 추천 제목</p>
        <h3 className="mt-2 text-2xl font-bold leading-tight">{result.finalTitle}</h3>
      </div>

      <div className="mt-5">
        <p className="text-xs font-bold text-ink/45">제목 후보</p>
        <ol className="mt-2 grid gap-2 sm:grid-cols-2">
          {result.titleCandidates.map((title, index) => (
            <li key={`${title}-${index}`} className="rounded-lg border border-line bg-paper px-3 py-3 text-sm font-semibold leading-6">
              <span className="mr-2 font-bold text-moss">{index + 1}</span>
              {title}
            </li>
          ))}
        </ol>
      </div>

      <article className="mt-6 rounded-xl border border-line bg-paper p-5 sm:p-6">
        <p className="text-xs font-bold text-ink/45">본문</p>
        <div className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-ink/78">{result.body}</div>
      </article>

      {result.faq.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold">자주 묻는 질문</h3>
          <div className="mt-3 space-y-3">
            {result.faq.map((item) => (
              <article key={item.question} className="rounded-lg border border-line p-4">
                <p className="font-bold">Q. {item.question}</p>
                <p className="mt-2 text-sm leading-6 text-ink/65">A. {item.answer}</p>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-line bg-white px-4 py-3">
        <p className="text-xs font-bold text-ink/45">해시태그</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-moss">{result.hashtags.join(" ") || "없음"}</p>
      </div>
    </section>
  );
}

function CopyButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-bold text-ink/65 hover:border-moss hover:text-moss"
    >
      {active ? <Check size={15} /> : <Clipboard size={15} />}
      {active ? "복사됨" : label}
    </button>
  );
}
