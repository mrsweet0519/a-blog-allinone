import { Clipboard, PenLine, RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { makerOptions } from "@shared/mvpConfig.js";
import StatusBadge from "../components/StatusBadge.jsx";
import { createDraftContent } from "../lib/contentGenerator.js";
import { findDraft, saveDraft } from "../lib/localDrafts.js";

const initialForm = {
  keyword: "",
  category: "",
  goal: "정보 전달",
  tone: "친근한",
  useEmoji: true,
  avoid: ""
};

const emptyResult = {
  topics: [],
  titles: [],
  body: "",
  hashtags: []
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resultToClipboard(result) {
  return [
    "[추천 주제]",
    ...result.topics.map((item, index) => `${index + 1}. ${item}`),
    "",
    "[제목 후보]",
    ...result.titles.map((item, index) => `${index + 1}. ${item}`),
    "",
    "[본문 초안]",
    result.body,
    "",
    "[해시태그]",
    result.hashtags.join(" ")
  ].join("\n");
}

export default function ContentMaker() {
  const location = useLocation();
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(emptyResult);
  const [status, setStatus] = useState("idle");
  const [editing, setEditing] = useState(false);
  const [draftId, setDraftId] = useState(null);

  const isFormReady = useMemo(
    () => Boolean(form.keyword.trim() && form.category && form.goal && form.tone),
    [form]
  );
  const hasResult = result.topics.length > 0 && result.titles.length > 0 && result.body;

  useEffect(() => {
    const draft = location.state?.draftId ? findDraft(location.state.draftId) : null;

    if (draft) {
      setForm(draft.form);
      setResult(draft.result);
      setDraftId(draft.id);
      setStatus("saved");
      setEditing(false);
      return;
    }

    if (!hasResult) {
      setStatus(isFormReady ? "ready" : "idle");
    }
  }, [location.state, isFormReady, hasResult]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const generate = async () => {
    if (!isFormReady) return;

    setStatus("generating");
    setEditing(false);
    await wait(650);
    setResult(createDraftContent(form));
    setStatus("generated");
  };

  const saveCurrentDraft = () => {
    if (!hasResult) return;

    const savedDraft = saveDraft(form, result, draftId);
    setDraftId(savedDraft.id);
    setStatus("saved");
    setEditing(false);
  };

  const toggleEdit = () => {
    if (!hasResult) return;

    setEditing((current) => {
      const next = !current;
      setStatus(next ? "editing" : "generated");
      return next;
    });
  };

  const copyResult = async () => {
    if (!hasResult) return;

    await navigator.clipboard.writeText(resultToClipboard(result));
    setStatus("copied");
  };

  const updateResultList = (key, index, value) => {
    setResult((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) => (itemIndex === index ? value : item))
    }));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">MVP 작업 화면</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">콘텐츠 메이커</h2>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">입력값</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {isFormReady ? "입력 완료" : "입력 전"}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">키워드</span>
              <input
                value={form.keyword}
                onChange={(event) => updateForm("keyword", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="예: 스마트스토어 상세페이지"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold">업종/주제</span>
              <select
                value={form.category}
                onChange={(event) => updateForm("category", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
              >
                <option value="">선택</option>
                {makerOptions.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <fieldset>
              <legend className="text-sm font-semibold">글 목적</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {makerOptions.goals.map((goal) => (
                  <label
                    key={goal}
                    className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                      form.goal === goal
                        ? "border-moss bg-moss text-white"
                        : "border-line bg-paper hover:border-moss"
                    }`}
                  >
                    <input
                      type="radio"
                      name="goal"
                      value={goal}
                      checked={form.goal === goal}
                      onChange={(event) => updateForm("goal", event.target.value)}
                      className="sr-only"
                    />
                    {goal}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="text-sm font-semibold">말투</span>
              <select
                value={form.tone}
                onChange={(event) => updateForm("tone", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
              >
                {makerOptions.tones.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-h-12 items-center justify-between gap-4 rounded-md border border-line bg-paper px-3">
              <span className="text-sm font-semibold">이모지 사용</span>
              <input
                type="checkbox"
                checked={form.useEmoji}
                onChange={(event) => updateForm("useEmoji", event.target.checked)}
                className="h-5 w-5 accent-[#52796f]"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold">금지어</span>
              <input
                value={form.avoid}
                onChange={(event) => updateForm("avoid", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="쉼표로 구분"
              />
            </label>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={!isFormReady || status === "generating"}
              className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
            >
              <Sparkles size={18} aria-hidden="true" />
              생성
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={!isFormReady || status === "generating"}
              className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
            >
              <RefreshCw size={18} aria-hidden="true" />
              다시 생성
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-bold">출력영역</h3>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={toggleEdit}
                disabled={!hasResult}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <PenLine size={16} aria-hidden="true" />
                {editing ? "수정 완료" : "수정"}
              </button>
              <button
                type="button"
                onClick={copyResult}
                disabled={!hasResult}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <Clipboard size={16} aria-hidden="true" />
                복사
              </button>
              <button
                type="button"
                onClick={saveCurrentDraft}
                disabled={!hasResult}
                className="focus-ring col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-[#3a4046] disabled:cursor-not-allowed disabled:bg-ink/25 sm:col-span-1"
              >
                <Save size={16} aria-hidden="true" />
                로컬 저장
              </button>
            </div>
          </div>

          {!hasResult && (
            <div className="mt-5 grid min-h-[420px] place-items-center rounded-lg border border-dashed border-line bg-paper p-6 text-center text-sm text-ink/60">
              키워드와 업종/주제를 입력하면 결과가 여기에 표시됩니다.
            </div>
          )}

          {hasResult && (
            <div className="mt-5 space-y-5">
              <OutputList
                title="추천 주제 3개"
                items={result.topics}
                editing={editing}
                onChange={(index, value) => updateResultList("topics", index, value)}
              />
              <OutputList
                title="제목 후보 3개"
                items={result.titles}
                editing={editing}
                onChange={(index, value) => updateResultList("titles", index, value)}
              />

              <div>
                <h4 className="text-sm font-bold text-ink/70">본문 초안 1개</h4>
                <textarea
                  value={result.body}
                  onChange={(event) => setResult((current) => ({ ...current, body: event.target.value }))}
                  readOnly={!editing}
                  rows={11}
                  className={`focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-7 ${
                    editing ? "bg-white" : ""
                  }`}
                />
              </div>

              <div>
                <h4 className="text-sm font-bold text-ink/70">해시태그 10개</h4>
                {editing ? (
                  <textarea
                    value={result.hashtags.join(" ")}
                    onChange={(event) =>
                      setResult((current) => ({
                        ...current,
                        hashtags: event.target.value.split(/\s+/).filter(Boolean).slice(0, 10)
                      }))
                    }
                    rows={3}
                    className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-3 text-sm leading-7"
                  />
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.hashtags.map((tag) => (
                      <span key={tag} className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function OutputList({ title, items, editing, onChange }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-ink/70">{title}</h4>
      <div className="mt-2 space-y-2">
        {items.map((item, index) =>
          editing ? (
            <input
              key={`${title}-${index}`}
              value={item}
              onChange={(event) => onChange(index, event.target.value)}
              className="focus-ring min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
            />
          ) : (
            <div key={item} className="rounded-md border border-line bg-paper px-3 py-3 text-sm font-semibold">
              {index + 1}. {item}
            </div>
          )
        )}
      </div>
    </div>
  );
}
