import { Check, Clipboard, Image, PenLine, RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { makerOptions } from "@shared/mvpConfig.js";
import StatusBadge from "../components/StatusBadge.jsx";
import {
  createFinalContent,
  createTitleCandidates,
  createTopicRecommendations,
  getTargetLengthRange
} from "../lib/contentGenerator.js";
import { findDraft, saveDraft } from "../lib/localDrafts.js";

const initialForm = {
  keyword: "",
  category: "",
  brandName: "",
  region: "",
  goal: "정보 전달",
  tone: "친근한",
  strengths: "",
  emphasisPoint: "",
  ctaDirection: "",
  useEmoji: true,
  avoid: "",
  targetLengthOption: "1500",
  customTargetLength: "1800"
};

const emptyResult = {
  topics: [],
  selectedTopic: "",
  titles: [],
  selectedTitle: "",
  body: "",
  hashtags: [],
  imageSuggestions: [],
  strategyMemo: null,
  keywordOptimization: null
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isCustomTargetReady = (form) =>
  form.targetLengthOption !== "custom" || Number.parseInt(form.customTargetLength, 10) >= 600;

const isReadyForm = (form) =>
  Boolean(form.keyword.trim() && form.category && form.goal && form.tone && isCustomTargetReady(form));

const normalizeForm = (storedForm = {}) => {
  const knownTarget = makerOptions.targetLengths.some(
    (option) => option.value === String(storedForm.targetLengthOption)
  );
  const targetLengthOption = knownTarget ? String(storedForm.targetLengthOption) : initialForm.targetLengthOption;

  return {
    ...initialForm,
    ...storedForm,
    targetLengthOption,
    customTargetLength: String(storedForm.customTargetLength || initialForm.customTargetLength)
  };
};

const normalizeResult = (storedResult = {}) => ({
  ...emptyResult,
  ...storedResult,
  selectedTopic: storedResult.selectedTopic || "",
  selectedTitle: storedResult.selectedTitle || "",
  imageSuggestions: storedResult.imageSuggestions || []
});

function resultToClipboard(form, result) {
  return [
    result.selectedTitle,
    "",
    result.body,
    "",
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

  const range = useMemo(() => getTargetLengthRange(form), [form]);
  const isFormReady = useMemo(() => isReadyForm(form), [form]);
  const hasTopics = result.topics.length > 0;
  const hasSelectedTopic = Boolean(result.selectedTopic);
  const hasTitles = result.titles.length > 0;
  const hasSelectedTitle = Boolean(result.selectedTitle);
  const hasFinal = Boolean(result.body && result.hashtags.length > 0);

  useEffect(() => {
    const draft = location.state?.draftId ? findDraft(location.state.draftId) : null;

    if (!draft) return;

    setForm(normalizeForm(draft.form));
    setResult(normalizeResult(draft.result));
    setDraftId(draft.id);
    setStatus("saved");
    setEditing(false);
  }, [location.state]);

  const updateForm = (key, value) => {
    setForm((current) => {
      const nextForm = { ...current, [key]: value };
      setStatus(isReadyForm(nextForm) ? "ready" : "idle");
      return nextForm;
    });
    setDraftId(null);
    setEditing(false);

    if (
      [
        "targetLengthOption",
        "customTargetLength",
        "useEmoji",
        "strengths",
        "emphasisPoint",
        "ctaDirection"
      ].includes(key)
    ) {
      setResult((current) => ({
        ...current,
        body: "",
        hashtags: [],
        imageSuggestions: [],
        strategyMemo: null,
        keywordOptimization: null
      }));
      return;
    }

    setResult(emptyResult);
  };

  const generateTopics = async () => {
    if (!isFormReady) return;

    setStatus("generating");
    setEditing(false);
    await wait(500);
    setResult({
      ...emptyResult,
      topics: createTopicRecommendations(form)
    });
    setStatus("generated");
  };

  const selectTopic = (topic) => {
    setResult((current) => ({
      ...current,
      selectedTopic: topic,
      titles: [],
      selectedTitle: "",
      body: "",
      hashtags: [],
      imageSuggestions: []
    }));
    setEditing(false);
    setStatus("generated");
  };

  const generateTitles = async () => {
    if (!isFormReady || !hasSelectedTopic) return;

    setStatus("generating");
    setEditing(false);
    await wait(500);
    setResult((current) => ({
      ...current,
      titles: createTitleCandidates(form, current.selectedTopic),
      selectedTitle: "",
      body: "",
      hashtags: [],
      imageSuggestions: []
    }));
    setStatus("generated");
  };

  const selectTitle = (title) => {
    setResult((current) => ({
      ...current,
      selectedTitle: title,
      body: "",
      hashtags: [],
      imageSuggestions: []
    }));
    setEditing(false);
    setStatus("generated");
  };

  const generateFinal = async () => {
    if (!isFormReady || !hasSelectedTopic || !hasSelectedTitle) return;

    setStatus("generating");
    setEditing(false);
    await wait(650);
    setResult((current) => ({
      ...current,
      ...createFinalContent(form, current.selectedTopic, current.selectedTitle)
    }));
    setStatus("generated");
  };

  const regenerate = () => {
    if (hasSelectedTitle) {
      generateFinal();
      return;
    }

    if (hasSelectedTopic) {
      generateTitles();
      return;
    }

    generateTopics();
  };

  const saveCurrentDraft = () => {
    if (!hasFinal) return;

    const savedDraft = saveDraft(form, result, draftId);
    setDraftId(savedDraft.id);
    setStatus("saved");
    setEditing(false);
  };

  const toggleEdit = () => {
    if (!hasFinal) return;

    setEditing((current) => {
      const next = !current;
      setStatus(next ? "editing" : "generated");
      return next;
    });
  };

  const copyResult = async () => {
    if (!hasFinal) return;

    await navigator.clipboard.writeText(resultToClipboard(form, result));
    setStatus("copied");
  };

  const updateImageSuggestion = (id, key, value) => {
    setResult((current) => ({
      ...current,
      imageSuggestions: current.imageSuggestions.map((item) =>
        item.id === id ? { ...item, [key]: value } : item
      )
    }));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">선택형 MVP 작업 화면</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">콘텐츠 메이커</h2>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
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

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold">브랜드명/매장명</span>
                <input
                  value={form.brandName}
                  onChange={(event) => updateForm("brandName", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 안티그래비티"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold">지역</span>
                <input
                  value={form.region}
                  onChange={(event) => updateForm("region", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 서울 강남"
                />
              </label>
            </div>

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

            <label className="block">
              <span className="text-sm font-semibold">핵심 강점 2~3개</span>
              <textarea
                value={form.strengths}
                onChange={(event) => updateForm("strengths", event.target.value)}
                rows={3}
                className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
                placeholder="예: 빠른 상담, 꼼꼼한 안내, 합리적인 구성"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold">꼭 강조할 포인트</span>
              <input
                value={form.emphasisPoint}
                onChange={(event) => updateForm("emphasisPoint", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="예: 처음 문의하는 분도 쉽게 이해할 수 있는 안내"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold">CTA 톤/마무리 방향</span>
              <input
                value={form.ctaDirection}
                onChange={(event) => updateForm("ctaDirection", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="예: 부담 없이 문의하도록 부드럽게 마무리"
              />
            </label>

            <fieldset>
              <legend className="text-sm font-semibold">목표 글자수</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {makerOptions.targetLengths.map((option) => (
                  <label
                    key={option.value}
                    className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                      form.targetLengthOption === option.value
                        ? "border-amber bg-amber text-white"
                        : "border-line bg-paper hover:border-amber"
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetLength"
                      value={option.value}
                      checked={form.targetLengthOption === option.value}
                      onChange={(event) => updateForm("targetLengthOption", event.target.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {form.targetLengthOption === "custom" && (
                <input
                  type="number"
                  min="600"
                  max="5000"
                  value={form.customTargetLength}
                  onChange={(event) => updateForm("customTargetLength", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 1800"
                />
              )}
              <p className="mt-2 text-xs leading-5 text-ink/55">
                실제 초안은 문장 흐름을 위해 목표 글자수에 딱 맞추기보다 ±10% 범위인{" "}
                {range.min}-{range.max}자 안에서 자연스럽게 작성합니다.
              </p>
            </fieldset>

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
              onClick={generateTopics}
              disabled={!isFormReady || status === "generating"}
              className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
            >
              <Sparkles size={18} aria-hidden="true" />
              주제 생성
            </button>
            <button
              type="button"
              onClick={regenerate}
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
            <h3 className="text-lg font-bold">선택 및 결과</h3>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={toggleEdit}
                disabled={!hasFinal}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <PenLine size={16} aria-hidden="true" />
                {editing ? "수정 완료" : "수정"}
              </button>
              <button
                type="button"
                onClick={copyResult}
                disabled={!hasFinal}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <Clipboard size={16} aria-hidden="true" />
                복사
              </button>
              <button
                type="button"
                onClick={saveCurrentDraft}
                disabled={!hasFinal}
                className="focus-ring col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-[#3a4046] disabled:cursor-not-allowed disabled:bg-ink/25 sm:col-span-1"
              >
                <Save size={16} aria-hidden="true" />
                로컬 저장
              </button>
            </div>
          </div>

          <FlowSteps
            hasTopics={hasTopics}
            hasSelectedTopic={hasSelectedTopic}
            hasTitles={hasTitles}
            hasSelectedTitle={hasSelectedTitle}
            hasFinal={hasFinal}
          />

          <div className="mt-5 space-y-6">
            <SelectableList
              title="1. 추천 주제 3개"
              items={result.topics}
              selected={result.selectedTopic}
              emptyText="입력값을 채우고 주제 생성을 누르면 후보가 표시됩니다."
              onSelect={selectTopic}
            />

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-bold text-ink/70">2. 선택 주제 기준 제목 3개</h4>
                <button
                  type="button"
                  onClick={generateTitles}
                  disabled={!hasSelectedTopic || status === "generating"}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  제목 생성
                </button>
              </div>
              <SelectableList
                items={result.titles}
                selected={result.selectedTitle}
                emptyText="주제를 하나 선택한 뒤 제목 생성을 누르세요."
                onSelect={selectTitle}
              />
            </div>

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-bold text-ink/70">3. 게시용 최종본 + 보조 메모</h4>
                <button
                  type="button"
                  onClick={generateFinal}
                  disabled={!hasSelectedTitle || status === "generating"}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
                >
                  본문 생성
                </button>
              </div>

              {!hasFinal && (
                <div className="mt-2 grid min-h-[220px] place-items-center rounded-lg border border-dashed border-line bg-paper p-6 text-center text-sm text-ink/60">
                  제목을 하나 선택하면 네이버에 옮겨 쓸 게시용 본문을 생성할 수 있습니다.
                </div>
              )}

              {hasFinal && (
                <div className="mt-4 space-y-5">
                  <div className="rounded-md border border-line bg-paper px-3 py-3 text-sm">
                    <p className="font-semibold">선택 주제</p>
                    <p className="mt-1 text-ink/70">{result.selectedTopic}</p>
                    <p className="mt-3 font-semibold">선택 제목</p>
                    <p className="mt-1 text-ink/70">{result.selectedTitle}</p>
                    <p className="mt-3 font-semibold">목표 글자수</p>
                    <p className="mt-1 text-ink/70">
                      {range.target}자 기준, 자연스러운 범위 {range.min}-{range.max}자
                    </p>
                  </div>

                  <div>
                    <h5 className="text-sm font-bold text-ink/70">게시용 최종본</h5>
                    <textarea
                      value={result.body}
                      onChange={(event) =>
                        setResult((current) => ({ ...current, body: event.target.value }))
                      }
                      readOnly={!editing}
                      rows={15}
                      className={`focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-7 ${
                        editing ? "bg-white" : ""
                      }`}
                    />
                  </div>

                  <ImageSuggestionList
                    items={result.imageSuggestions}
                    editing={editing}
                    onChange={updateImageSuggestion}
                  />

                  <div>
                    <h5 className="text-sm font-bold text-ink/70">해시태그 10개</h5>
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
                          <span
                            key={tag}
                            className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <StrategyMemo result={result} />
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StrategyMemo({ result }) {
  const memo = result.strategyMemo;
  const keyword = result.keywordOptimization;

  if (!memo && !keyword) return null;

  return (
    <details className="rounded-lg border border-line bg-paper p-4">
      <summary className="cursor-pointer text-sm font-bold text-ink/70">
        운영 메모 / 내부 전략 데이터
      </summary>
      <div className="mt-4 grid gap-4 text-sm leading-6 text-ink/70">
        {memo && (
          <div>
            <p className="font-bold text-ink">전략 메모</p>
            <p className="mt-1">생성 구조: {memo.goalTemplate}</p>
            <p>핵심 메시지: {memo.writingDirection.coreMessage}</p>
            <p>마무리 방향: {memo.writingDirection.ctaDirection}</p>
            <p>본문 길이: {memo.bodyLength}자</p>
          </div>
        )}

        {keyword && (
          <div>
            <p className="font-bold text-ink">키워드 최적화 메모</p>
            <p>
              메인 키워드: {keyword.mainKeyword} / 실제 {keyword.actualOccurrences}회 / 목표{" "}
              {keyword.targetOccurrences.min}-{keyword.targetOccurrences.max}회
            </p>
            <p>연관 표현: {keyword.relatedExpressions?.slice(0, 4).join(", ")}</p>
          </div>
        )}

        {memo?.imageBridgeMemo && (
          <div>
            <p className="font-bold text-ink">이미지 브리지 구조</p>
            <div className="mt-2 grid gap-2">
              {memo.imageBridgeMemo.map((item) => (
                <div key={item.id} className="rounded-md bg-white p-3">
                  <p className="font-semibold">{item.slot}</p>
                  <p>{item.insertAfter}</p>
                  <p>{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function FlowSteps({ hasTopics, hasSelectedTopic, hasTitles, hasSelectedTitle, hasFinal }) {
  const steps = [
    { label: "주제 생성", done: hasTopics },
    { label: "주제 선택", done: hasSelectedTopic },
    { label: "제목 생성", done: hasTitles },
    { label: "제목 선택", done: hasSelectedTitle },
    { label: "본문 완성", done: hasFinal }
  ];

  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-5">
      {steps.map((step) => (
        <div
          key={step.label}
          className={`flex min-h-10 items-center justify-center gap-2 rounded-md border px-2 text-xs font-bold ${
            step.done ? "border-moss bg-moss/10 text-moss" : "border-line bg-paper text-ink/45"
          }`}
        >
          {step.done && <Check size={14} aria-hidden="true" />}
          {step.label}
        </div>
      ))}
    </div>
  );
}

function SelectableList({ title, items, selected, emptyText, onSelect }) {
  return (
    <div className={title ? "" : "mt-2"}>
      {title && <h4 className="text-sm font-bold text-ink/70">{title}</h4>}
      <div className="mt-2 space-y-2">
        {items.map((item, index) => {
          const isSelected = selected === item;

          return (
            <button
              type="button"
              key={item}
              onClick={() => onSelect(item)}
              className={`focus-ring block w-full rounded-md border px-3 py-3 text-left text-sm transition ${
                isSelected
                  ? "border-moss bg-moss/10 text-moss"
                  : "border-line bg-paper hover:border-moss hover:bg-white"
              }`}
            >
              <span className="flex items-start gap-2">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-xs">
                  {isSelected ? <Check size={13} aria-hidden="true" /> : index + 1}
                </span>
                <span>
                  <span className="font-semibold">{item}</span>
                  {isSelected && <span className="ml-2 text-xs font-bold">선택됨</span>}
                </span>
              </span>
            </button>
          );
        })}

        {items.length === 0 && (
          <div className="rounded-lg border border-dashed border-line bg-paper p-5 text-center text-sm text-ink/60">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageSuggestionList({ items, editing, onChange }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Image size={17} className="text-moss" aria-hidden="true" />
        <h5 className="text-sm font-bold text-ink/70">이미지 삽입 추천 3개</h5>
      </div>
      <div className="mt-2 grid gap-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-line bg-paper p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-moss">{item.label}</p>
              <p className="text-xs font-semibold text-ink/50">{item.insertAfter}</p>
            </div>

            {editing ? (
              <div className="mt-2 space-y-2">
                <input
                  value={item.title}
                  onChange={(event) => onChange(item.id, "title", event.target.value)}
                  className="focus-ring min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold"
                />
                <textarea
                  value={item.description}
                  onChange={(event) => onChange(item.id, "description", event.target.value)}
                  rows={2}
                  className="focus-ring w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                />
              </div>
            ) : (
              <>
                <p className="mt-2 font-semibold">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-ink/65">{item.description}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
