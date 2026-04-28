import { Check, Clipboard, Image, PenLine, RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { makerOptions } from "@shared/mvpConfig.js";
import StatusBadge from "../components/StatusBadge.jsx";
import {
  createCtaCandidates,
  createFinalContent,
  createOpeningSentenceCandidates,
  createOutlineSections,
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
  audienceType: "사업자/매장 홍보",
  tone: "친근한",
  strengths: "",
  emphasisPoint: "",
  ctaDirection: "",
  useEmoji: true,
  avoid: "",
  targetLengthOption: "1500",
  customTargetLength: "1800"
};

const TITLE_TYPES = ["정보형", "지역형", "비교형", "클릭형"];
const TITLE_CANDIDATE_LABELS = TITLE_TYPES.map((type) => `${type} 제목`);

const inferTitleType = (titles = [], selectedTitle = "") => {
  const index = titles.indexOf(selectedTitle);

  return index >= 0 ? TITLE_TYPES[index] || "미분류" : "";
};

const emptyResult = {
  topics: [],
  selectedTopic: "",
  titles: [],
  selectedTitle: "",
  selectedTitleType: "",
  outlineSections: [],
  openingSentenceCandidates: [],
  selectedOpeningSentence: "",
  ctaCandidates: [],
  selectedCtaSentence: "",
  body: "",
  hashtags: [],
  hashtagGroups: [],
  imageSuggestions: [],
  strategyMemo: null,
  seoCheck: null,
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

const toOutlineItems = (items = []) =>
  items
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          id: `outline-${index + 1}`,
          heading: item,
          selected: true
        };
      }

      return {
        id: item.id || `outline-${index + 1}`,
        heading: item.heading || "",
        selected: item.selected !== false
      };
    })
    .filter((item) => item.heading.trim());

const getSelectedOutlineHeadings = (outlineSections = []) =>
  outlineSections
    .filter((item) => item.selected !== false)
    .map((item) => item.heading.trim())
    .filter(Boolean)
    .slice(0, 6);

const normalizeResult = (storedResult = {}) => ({
  ...emptyResult,
  ...storedResult,
  selectedTopic: storedResult.selectedTopic || "",
  selectedTitle: storedResult.selectedTitle || "",
  selectedTitleType:
    storedResult.selectedTitleType ||
    storedResult.titleType ||
    inferTitleType(storedResult.titles || [], storedResult.selectedTitle || ""),
  outlineSections: toOutlineItems(storedResult.outlineSections),
  openingSentenceCandidates: storedResult.openingSentenceCandidates || [],
  selectedOpeningSentence: storedResult.selectedOpeningSentence || "",
  ctaCandidates: storedResult.ctaCandidates || [],
  selectedCtaSentence: storedResult.selectedCtaSentence || "",
  hashtagGroups: storedResult.hashtagGroups || [],
  seoCheck: storedResult.seoCheck || null,
  imageSuggestions: storedResult.imageSuggestions || []
});

function resultToClipboard(form, result) {
  const body = String(result.body || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return [
    result.selectedTitle.trim(),
    "",
    body,
    "",
    result.hashtags.join(" ")
  ].join("\n").trim();
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
  const selectedOutlineHeadings = useMemo(
    () => getSelectedOutlineHeadings(result.outlineSections),
    [result.outlineSections]
  );
  const hasOutline = selectedOutlineHeadings.length >= 4 && selectedOutlineHeadings.length <= 6;
  const hasWritingChoices = Boolean(result.selectedOpeningSentence && result.selectedCtaSentence);
  const hasFinal = Boolean(result.body && result.hashtags.length > 0);

  useEffect(() => {
    const draft = location.state?.draftId ? findDraft(location.state.draftId) : null;

    if (!draft) return;

    setForm(normalizeForm(draft.form));
    setResult(
      normalizeResult({
        ...draft.result,
        selectedTitleType:
          draft.result?.selectedTitleType || draft.selectedTitleType || draft.titleType || ""
      })
    );
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
        "ctaDirection",
        "audienceType"
      ].includes(key)
    ) {
      setResult((current) => ({
        ...current,
        outlineSections: [],
        openingSentenceCandidates: [],
        selectedOpeningSentence: "",
        ctaCandidates: [],
        selectedCtaSentence: "",
        body: "",
        hashtags: [],
        hashtagGroups: [],
        imageSuggestions: [],
        strategyMemo: null,
        seoCheck: null,
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
      selectedTitleType: "",
      outlineSections: [],
      openingSentenceCandidates: [],
      selectedOpeningSentence: "",
      ctaCandidates: [],
      selectedCtaSentence: "",
      body: "",
      hashtags: [],
      hashtagGroups: [],
      imageSuggestions: [],
      strategyMemo: null,
      seoCheck: null,
      keywordOptimization: null
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
      selectedTitleType: "",
      outlineSections: [],
      openingSentenceCandidates: [],
      selectedOpeningSentence: "",
      ctaCandidates: [],
      selectedCtaSentence: "",
      body: "",
      hashtags: [],
      hashtagGroups: [],
      imageSuggestions: [],
      strategyMemo: null,
      seoCheck: null,
      keywordOptimization: null
    }));
    setStatus("generated");
  };

  const selectTitle = (title, titleType = "") => {
    setResult((current) => ({
      ...current,
      selectedTitle: title,
      selectedTitleType: titleType || inferTitleType(current.titles, title) || "미분류",
      outlineSections: [],
      openingSentenceCandidates: [],
      selectedOpeningSentence: "",
      ctaCandidates: [],
      selectedCtaSentence: "",
      body: "",
      hashtags: [],
      hashtagGroups: [],
      imageSuggestions: [],
      strategyMemo: null,
      seoCheck: null,
      keywordOptimization: null
    }));
    setEditing(false);
    setStatus("generated");
  };

  const generateOutline = async () => {
    if (!isFormReady || !hasSelectedTopic || !hasSelectedTitle) return;

    setStatus("generating");
    setEditing(false);
    await wait(500);
    const openingSentenceCandidates = createOpeningSentenceCandidates(form);
    const ctaCandidates = createCtaCandidates(form);
    setResult((current) => ({
      ...current,
      outlineSections: toOutlineItems(
        createOutlineSections(form, current.selectedTopic, current.selectedTitle)
      ),
      openingSentenceCandidates,
      selectedOpeningSentence: openingSentenceCandidates[0] || "",
      ctaCandidates,
      selectedCtaSentence: ctaCandidates[0] || "",
      body: "",
      hashtags: [],
      hashtagGroups: [],
      imageSuggestions: [],
      strategyMemo: null,
      seoCheck: null,
      keywordOptimization: null
    }));
    setStatus("generated");
  };

  const generateFinal = async () => {
    if (!isFormReady || !hasSelectedTopic || !hasSelectedTitle || !hasOutline || !hasWritingChoices) return;

    setStatus("generating");
    setEditing(false);
    await wait(650);
    setResult((current) => {
      const finalContent = createFinalContent(
        form,
        current.selectedTopic,
        current.selectedTitle,
        getSelectedOutlineHeadings(current.outlineSections),
        {
          selectedOpeningSentence: current.selectedOpeningSentence,
          selectedCtaSentence: current.selectedCtaSentence
        }
      );

      return {
        ...current,
        ...finalContent,
        selectedTitleType: current.selectedTitleType || inferTitleType(current.titles, current.selectedTitle),
        outlineSections: current.outlineSections
      };
    });
    setStatus("generated");
  };

  const regenerate = () => {
    if (hasOutline && !hasWritingChoices) {
      generateOutline();
      return;
    }

    if (hasOutline) {
      generateFinal();
      return;
    }

    if (hasSelectedTitle) {
      generateOutline();
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
      imageSuggestions: current.imageSuggestions.map((item) => {
        if (item.id !== id) return item;

        if (key === "searchKeyword") {
          return {
            ...item,
            searchKeyword: value,
            query: value,
            imageSearch: item.imageSearch
              ? {
                  ...item.imageSearch,
                  searchKeyword: value,
                  query: value
                }
              : item.imageSearch
          };
        }

        return { ...item, [key]: value };
      })
    }));
  };

  const updateOutlineSection = (id, key, value) => {
    setResult((current) => ({
      ...current,
      outlineSections: current.outlineSections.map((item) =>
        item.id === id ? { ...item, [key]: value } : item
      ),
      body: "",
      hashtags: [],
      hashtagGroups: [],
      imageSuggestions: [],
      strategyMemo: null,
      seoCheck: null,
      keywordOptimization: null
    }));
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
  };

  const selectWritingChoice = (key, value) => {
    setResult((current) => ({
      ...current,
      [key]: value,
      body: "",
      hashtags: [],
      hashtagGroups: [],
      imageSuggestions: [],
      strategyMemo: null,
      seoCheck: null,
      keywordOptimization: null
    }));
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
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

            <fieldset>
              <legend className="text-sm font-semibold">사용자 유형</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {makerOptions.audienceTypes.map((audienceType) => (
                  <label
                    key={audienceType}
                    className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                      form.audienceType === audienceType
                        ? "border-coral bg-coral text-white"
                        : "border-line bg-paper hover:border-coral"
                    }`}
                  >
                    <input
                      type="radio"
                      name="audienceType"
                      value={audienceType}
                      checked={form.audienceType === audienceType}
                      onChange={(event) => updateForm("audienceType", event.target.value)}
                      className="sr-only"
                    />
                    {audienceType}
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
            hasOutline={hasOutline}
            hasWritingChoices={hasWritingChoices}
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
                <h4 className="text-sm font-bold text-ink/70">2. 선택 주제 기준 제목 4개</h4>
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
                itemTypes={TITLE_TYPES}
                itemLabels={TITLE_CANDIDATE_LABELS}
                emptyText="주제를 하나 선택한 뒤 제목 생성을 누르세요."
                onSelect={selectTitle}
              />
            </div>

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-bold text-ink/70">3. 개요 소제목 4~6개</h4>
                <button
                  type="button"
                  onClick={generateOutline}
                  disabled={!hasSelectedTitle || status === "generating"}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  개요 생성
                </button>
              </div>
              <OutlineEditor
                items={result.outlineSections}
                selectedCount={selectedOutlineHeadings.length}
                emptyText="제목을 하나 선택한 뒤 개요 생성을 누르세요."
                onChange={updateOutlineSection}
              />
            </div>

            <div>
              <h4 className="text-sm font-bold text-ink/70">4. 첫 문장과 CTA 선택</h4>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <WritingChoiceGroup
                  title="첫 문장 후보"
                  items={result.openingSentenceCandidates}
                  selected={result.selectedOpeningSentence}
                  emptyText="개요를 생성하면 첫 문장 후보가 표시됩니다."
                  onSelect={(value) => selectWritingChoice("selectedOpeningSentence", value)}
                />
                <WritingChoiceGroup
                  title="CTA 후보"
                  items={result.ctaCandidates}
                  selected={result.selectedCtaSentence}
                  emptyText="개요를 생성하면 CTA 후보가 표시됩니다."
                  onSelect={(value) => selectWritingChoice("selectedCtaSentence", value)}
                />
              </div>
            </div>

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-bold text-ink/70">5. 게시용 최종본 + 보조 메모</h4>
                <button
                  type="button"
                  onClick={generateFinal}
                  disabled={!hasOutline || !hasWritingChoices || status === "generating"}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
                >
                  본문 생성
                </button>
              </div>

              {!hasFinal && (
                <div className="mt-2 grid min-h-[220px] place-items-center rounded-lg border border-dashed border-line bg-paper p-6 text-center text-sm text-ink/60">
                  개요 소제목과 첫 문장, CTA를 선택하면 네이버에 옮겨 쓸 게시용 본문을 생성할 수 있습니다.
                </div>
              )}

              {hasFinal && (
                <div className="mt-4 space-y-5">
                  <div className="rounded-md border border-line bg-white p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <h5 className="text-sm font-bold text-ink/70">1. 제목</h5>
                      <span className="text-xs font-semibold text-moss">네이버 복붙용 결과</span>
                    </div>
                    {editing ? (
                      <input
                        value={result.selectedTitle}
                        onChange={(event) =>
                          setResult((current) => ({ ...current, selectedTitle: event.target.value }))
                        }
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-base font-bold"
                      />
                    ) : (
                      <p className="mt-2 text-xl font-bold leading-8 text-ink">{result.selectedTitle}</p>
                    )}
                  </div>

                  <div>
                    <h5 className="text-sm font-bold text-ink/70">2. 본문</h5>
                    <textarea
                      value={result.body}
                      onChange={(event) =>
                        setResult((current) => ({ ...current, body: event.target.value }))
                      }
                      readOnly={!editing}
                      rows={15}
                      className={`focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-7 whitespace-pre-wrap ${
                        editing ? "bg-white" : ""
                      }`}
                    />
                  </div>

                  <div>
                    <h5 className="text-sm font-bold text-ink/70">3. 검색패턴 해시태그</h5>
                    {editing ? (
                      <textarea
                        value={result.hashtags.join(" ")}
                        onChange={(event) =>
                          setResult((current) => ({
                            ...current,
                            hashtags: event.target.value.split(/\s+/).filter(Boolean).slice(0, 14),
                            hashtagGroups: []
                          }))
                        }
                        rows={3}
                        className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-3 text-sm leading-7"
                      />
                    ) : (
                      <HashtagGroupCards groups={result.hashtagGroups} fallbackTags={result.hashtags} />
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={copyResult}
                    className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-amber px-4 text-sm font-bold text-white transition hover:bg-[#b8862c]"
                  >
                    <Clipboard size={18} aria-hidden="true" />
                    4. 제목 + 본문 + 해시태그 복사
                  </button>

                  <ImageSuggestionList
                    items={result.imageSuggestions}
                    editing={editing}
                    onChange={updateImageSuggestion}
                  />

                  <details className="rounded-md border border-line bg-paper p-4 text-sm">
                    <summary className="cursor-pointer font-bold text-ink/70">선택한 주제/개요 확인</summary>
                    <div className="mt-3 leading-6 text-ink/70">
                      <p className="font-semibold text-ink">선택 주제</p>
                      <p>{result.selectedTopic}</p>
                      <p className="mt-3 font-semibold text-ink">선택 개요</p>
                      <p className="whitespace-pre-line">
                        {selectedOutlineHeadings.map((heading, index) => `${index + 1}. ${heading}`).join("\n")}
                      </p>
                    <p className="mt-3 font-semibold text-ink">선택 문장</p>
                      <p>제목 유형: {result.selectedTitleType || "미분류"}</p>
                      <p>첫 문장: {result.selectedOpeningSentence}</p>
                      <p>CTA: {result.selectedCtaSentence}</p>
                      <p className="mt-3 font-semibold text-ink">목표 글자수</p>
                      <p>
                        {range.target}자 기준, 자연스러운 범위 {range.min}-{range.max}자
                      </p>
                    </div>
                  </details>

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

function HashtagGroupCards({ groups = [], fallbackTags = [] }) {
  const displayGroups =
    groups.length > 0
      ? groups
      : [
          {
            id: "all",
            label: "전체 해시태그",
            description: "복사용 해시태그",
            tags: fallbackTags
          }
        ];

  return (
    <div className="mt-2 grid gap-3 md:grid-cols-2">
      {displayGroups.map((group) => (
        <div key={group.id || group.label} className="rounded-md border border-line bg-paper p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-ink">{group.label}</p>
              {group.description && (
                <p className="mt-1 text-xs leading-5 text-ink/55">{group.description}</p>
              )}
            </div>
            <span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-moss">
              {group.tags.length}개
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {group.tags.map((tag) => (
              <span
                key={`${group.id}-${tag}`}
                className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StrategyMemo({ result }) {
  const memo = result.strategyMemo;
  const keyword = result.keywordOptimization;
  const seoCheck = result.seoCheck || memo?.seoCheck;

  if (!memo && !keyword && !seoCheck) return null;

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
            <p>사용자 유형: {memo.audienceType}</p>
            <p>핵심 메시지: {memo.writingDirection.coreMessage}</p>
            <p>마무리 방향: {memo.writingDirection.ctaDirection}</p>
            <p>본문 길이: {memo.bodyLength}자</p>
            {memo.outlineSections?.length > 0 && (
              <p>개요: {memo.outlineSections.join(" → ")}</p>
            )}
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

        {seoCheck && (
          <div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-bold text-ink">최적화 체크</p>
              <p className="text-xs font-bold text-moss">
                {seoCheck.passedCount}/{seoCheck.totalCount} 통과
              </p>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {seoCheck.items.map((item) => (
                <div key={item.id} className="rounded-md bg-white p-3">
                  <p className={`font-semibold ${item.passed ? "text-moss" : "text-coral"}`}>
                    {item.passed ? "통과" : "확인 필요"} · {item.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-ink/60">{item.detail}</p>
                </div>
              ))}
            </div>
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
                  {item.searchKeyword && (
                    <p>
                      이미지 검색: {item.searchKeyword}
                      {item.query ? ` / query: ${item.query}` : ""}
                      {item.imageProvider ? ` / ${item.imageProvider}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function FlowSteps({
  hasTopics,
  hasSelectedTopic,
  hasTitles,
  hasSelectedTitle,
  hasOutline,
  hasWritingChoices,
  hasFinal
}) {
  const steps = [
    { label: "주제 생성", done: hasTopics },
    { label: "주제 선택", done: hasSelectedTopic },
    { label: "제목 생성", done: hasTitles },
    { label: "제목 선택", done: hasSelectedTitle },
    { label: "개요 확정", done: hasOutline },
    { label: "문장 선택", done: hasWritingChoices },
    { label: "본문 완성", done: hasFinal }
  ];

  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-7">
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

function SelectableList({ title, items, selected, itemTypes = [], itemLabels = [], emptyText, onSelect }) {
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
              onClick={() => onSelect(item, itemTypes[index] || "", index)}
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
                  {itemLabels[index] && (
                    <span className="mb-1 inline-flex rounded-md bg-white px-2 py-0.5 text-xs font-bold text-coral">
                      {itemLabels[index]}
                    </span>
                  )}
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

function WritingChoiceGroup({ title, items, selected, emptyText, onSelect }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <p className="text-xs font-bold text-ink/60">{title}</p>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => {
          const isSelected = selected === item;

          return (
            <button
              key={`${title}-${item}`}
              type="button"
              onClick={() => onSelect(item)}
              className={`focus-ring flex w-full items-start gap-2 rounded-md border px-3 py-3 text-left text-sm leading-6 transition ${
                isSelected
                  ? "border-coral bg-white text-ink"
                  : "border-line bg-white/70 hover:border-coral hover:bg-white"
              }`}
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-xs font-bold">
                {isSelected ? <Check size={13} aria-hidden="true" /> : index + 1}
              </span>
              <span className="font-semibold">{item}</span>
            </button>
          );
        })}

        {items.length === 0 && (
          <div className="rounded-md border border-dashed border-line bg-white p-4 text-center text-sm text-ink/55">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function OutlineEditor({ items, selectedCount, emptyText, onChange }) {
  const isValid = selectedCount >= 4 && selectedCount <= 6;

  return (
    <div className="mt-2">
      {items.length > 0 && (
        <div className="mb-2 rounded-md border border-line bg-paper px-3 py-2 text-xs font-semibold text-ink/60">
          선택된 소제목 {selectedCount}개 / 권장 4~6개
          {!isValid && <span className="ml-2 text-coral">본문 생성 전 4~6개로 맞춰주세요.</span>}
        </div>
      )}

      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={item.id}
            className={`rounded-md border p-3 ${
              item.selected !== false ? "border-moss bg-moss/10" : "border-line bg-paper"
            }`}
          >
            <div className="flex items-start gap-3">
              <label className="mt-2 flex items-center gap-2 text-xs font-bold text-ink/60">
                <input
                  type="checkbox"
                  checked={item.selected !== false}
                  onChange={(event) => onChange(item.id, "selected", event.target.checked)}
                  className="h-4 w-4 accent-[#52796f]"
                />
                {index + 1}
              </label>
              <input
                value={item.heading}
                onChange={(event) => onChange(item.id, "heading", event.target.value)}
                className="focus-ring min-h-10 flex-1 rounded-md border border-line bg-white px-3 text-sm font-semibold"
              />
            </div>
          </div>
        ))}

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
        {items.map((item) => {
          const imageUrl =
            item.previewUrl || item.imageSearch?.thumbnailUrl || item.imageSearch?.imageUrl || "";
          const searchKeyword = item.searchKeyword || item.query || item.imageSearch?.query || "";
          const pexelsQuery = item.query || item.imageSearch?.query || searchKeyword;

          return (
            <div key={item.id} className="rounded-md border border-line bg-paper p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-bold text-moss">{item.label}</p>
                <p className="text-xs font-semibold text-ink/50">{item.insertAfter}</p>
              </div>

              <div className="mt-3 overflow-hidden rounded-md border border-line bg-white">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={item.altText || item.title}
                    className="h-40 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex min-h-24 items-center gap-3 px-3 py-4 text-sm text-ink/55">
                    <Image size={18} className="shrink-0 text-moss" aria-hidden="true" />
                    <span>Pexels 검색어: {pexelsQuery}</span>
                  </div>
                )}
              </div>

              {editing ? (
                <div className="mt-2 space-y-2">
                  <input
                    value={item.title}
                    onChange={(event) => onChange(item.id, "title", event.target.value)}
                    className="focus-ring min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold"
                  />
                  <input
                    value={searchKeyword}
                    onChange={(event) => onChange(item.id, "searchKeyword", event.target.value)}
                    className="focus-ring min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm"
                    placeholder="Pexels 검색 키워드"
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
                  <p className="mt-2 text-xs font-semibold text-ink/50">
                    검색 키워드: {searchKeyword}
                    {pexelsQuery && pexelsQuery !== searchKeyword ? ` / query: ${pexelsQuery}` : ""}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
