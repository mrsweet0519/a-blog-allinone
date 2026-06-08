import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Image,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { makerOptions } from "@shared/mvpConfig.js";
import StatusBadge from "../components/StatusBadge.jsx";
import {
  createCtaCandidates,
  createFinalContent,
  createOpeningSentenceCandidates,
  createOutlineSections,
  createTitleCandidates,
  createTopicRecommendations
} from "../lib/contentGenerator.js";
import { isBackendApiEnabled, postBackend } from "../lib/backendApi.js";
import {
  deleteWritingProfile,
  findDraft,
  loadWritingProfiles,
  saveDraft,
  saveWritingProfile
} from "../lib/localDrafts.js";

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
  address: "",
  businessHours: "",
  priceInfo: "",
  purchaseUrl: "",
  contactMethod: "",
  shippingInfo: "",
  sponsorshipType: "",
  useEmoji: true,
  avoid: "",
  targetLengthOption: "1500",
  customTargetLength: "1800"
};

const OUTLINE_MIN = 3;
const OUTLINE_MAX = 6;
const TOPIC_MAX = 5;

const WRITING_PROFILE_FIELDS = [
  "keyword",
  "audienceType",
  "category",
  "goal",
  "brandName",
  "region",
  "strengths",
  "emphasisPoint",
  "tone",
  "useEmoji",
  "avoid",
  "ctaDirection",
  "address",
  "businessHours",
  "priceInfo",
  "purchaseUrl",
  "contactMethod",
  "shippingInfo",
  "sponsorshipType",
  "targetLengthOption",
  "customTargetLength"
];

const STARTER_EXAMPLES = [
  {
    id: "store",
    label: "매장 홍보 예시",
    keyword: "강남 피부관리샵, 리프팅 관리, 피부탄력",
    category: "피부관리샵",
    audienceType: "사업자/매장 홍보",
    goal: "방문 유도"
  },
  {
    id: "review",
    label: "상품 후기 예시",
    keyword: "수분크림 후기, 피부 보습, 데일리 크림",
    category: "뷰티/생활용품",
    audienceType: "인플루언서/수익형",
    goal: "정보 전달"
  },
  {
    id: "info",
    label: "정보글 예시",
    keyword: "육아서적 추천, 초등 독서, 부모 가이드",
    category: "육아/도서",
    audienceType: "인플루언서/수익형",
    goal: "정보 전달"
  }
];

const pickWritingProfileValues = (form) =>
  WRITING_PROFILE_FIELDS.reduce(
    (defaults, key) => ({
      ...defaults,
      [key]: form[key]
    }),
    {}
  );

const mergeUnique = (...groups) =>
  Array.from(new Set(groups.flat().map((item) => String(item || "").trim()).filter(Boolean)));

const FIELD_TOOLTIPS = {
  keyword: {
    title: "키워드",
    description:
      "검색되고 싶은 핵심 키워드를 입력하세요. 1개만 입력해도 되고, 쉼표로 2~3개까지 입력할 수 있습니다. 첫 번째 키워드는 메인 키워드로, 나머지는 보조 키워드로 활용됩니다.",
    example: "강남 피부관리샵, 리프팅 관리, 피부탄력 / 수분크림 후기, 피부 보습, 데일리 크림 / 육아서적 추천, 초등 독서, 부모 가이드"
  },
  category: {
    title: "업종/주제",
    description: "글 주제와 가장 가까운 업종을 선택하세요.",
    example: "로컬 매장, 온라인 쇼핑몰"
  },
  audienceType: {
    title: "사용자 유형",
    description: "글을 사용할 목적에 가까운 유형을 선택하세요.",
    example: "사업자/매장 홍보, 인플루언서/수익형"
  },
  goal: {
    title: "글 목적",
    description: "글이 독자에게 해야 할 역할을 선택하세요.",
    example: "정보 전달, 신뢰 형성, 방문 유도"
  },
  targetLength: {
    title: "목표 글자수",
    description: "원하는 본문 길이를 선택하세요.",
    example: "1200자, 1500자, 직접입력"
  },
  tone: {
    title: "말투",
    description: "전체 글의 분위기를 선택하세요.",
    example: "친근한, 전문적인, 차분한"
  },
  brandName: {
    title: "브랜드명/매장명",
    description: "매장명이나 브랜드명을 입력하세요. 모르면 비워도 됩니다.",
    example: "우리 매장명, 자체 브랜드명"
  },
  region: {
    title: "지역",
    description: "지역 기반 글이면 입력하세요. 온라인 상품은 비워도 됩니다.",
    example: "서울 강남, 부산 수영구"
  },
  strengths: {
    title: "핵심 강점",
    description: "고객이 자주 칭찬하는 장점이나 차별점을 입력하세요.",
    example: "1:1 상담, 맞춤 관리, 사후 안내"
  },
  emphasisPoint: {
    title: "강조 포인트",
    description: "글에서 꼭 강조하고 싶은 내용을 입력하세요.",
    example: "처음 방문 고객도 편하게 상담 가능"
  },
  avoid: {
    title: "금지어",
    description: "글에 나오지 않았으면 하는 단어를 입력하세요.",
    example: "최고, 무조건, 보장, 즉시효과"
  },
  ctaDirection: {
    title: "CTA 톤",
    description: "마무리 문장의 방향을 입력하세요.",
    example: "부담 없이 상담 받아보세요, 기준부터 확인해보세요"
  },
  address: {
    title: "주소",
    description: "본문 하단 정보 정리에 넣을 주소를 입력하세요.",
    example: "서울 강남구 ○○로 00"
  },
  businessHours: {
    title: "영업시간",
    description: "방문 전 확인하기 좋은 운영 시간을 입력하세요.",
    example: "평일 10:00-19:00, 토요일 예약제"
  },
  priceInfo: {
    title: "가격/가격대",
    description: "상품 가격이나 대략적인 가격대를 입력하세요.",
    example: "29,000원대, 상담 후 안내"
  },
  purchaseUrl: {
    title: "구매처",
    description: "쇼핑몰명, 스마트스토어명, 구매 가능한 경로를 입력하세요.",
    example: "자사몰, 네이버 스마트스토어"
  },
  contactMethod: {
    title: "문의 방법",
    description: "예약, 상담, 구매 문의 방법을 입력하세요.",
    example: "카카오톡 채널, 전화, 네이버 톡톡"
  },
  shippingInfo: {
    title: "배송/교환 정보",
    description: "상품형 글에서 구매 전 확인할 배송이나 교환 정보를 입력하세요.",
    example: "평일 오후 2시 전 주문 당일 출고, 단순 변심 교환 가능"
  },
  sponsorshipType: {
    title: "협찬 여부",
    description: "직접 구매, 제품 제공, 식사권 제공처럼 표시해야 할 경제적 이해관계가 있을 때만 선택하세요.",
    example: "직접 구매 / 제품 제공 / 식사권 제공"
  },
  useEmoji: {
    title: "이모지 사용",
    description: "본문 첫머리에 가벼운 이모지를 넣을지 선택합니다.",
    example: "켜기 또는 끄기"
  }
};

const TITLE_TYPES = ["검색형", "후기형", "비교형", "선택형", "클릭형"];
const TITLE_CANDIDATE_LABELS = TITLE_TYPES.map((type) => `${type} 제목`);
const PRIMARY_TITLE_INDEXES = [0, 1, 4];

const inferTitleType = (titles = [], selectedTitle = "") => {
  const index = titles.indexOf(selectedTitle);

  return index >= 0 ? TITLE_TYPES[index] || "미분류" : "";
};

const resetAfterTopicChange = {
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
  keywordOptimization: null,
  contentPackage: null
};

const emptyResult = {
  topics: [],
  topicHistory: [],
  topicRegenerationCount: 0,
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
  keywordOptimization: null,
  contentPackage: null
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isCustomTargetReady = (form) =>
  form.targetLengthOption !== "custom" || Number.parseInt(form.customTargetLength, 10) >= 600;

const isReadyForm = (form) =>
  Boolean(form.keyword.trim() && form.category && form.goal && form.tone && isCustomTargetReady(form));

const requestContentApi = async (path, payload, fallback) => {
  if (!isBackendApiEnabled()) return fallback();

  try {
    return await postBackend(path, payload);
  } catch (error) {
    console.warn(error);
    return fallback();
  }
};

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
        note: "",
        selected: true
      };
      }

      return {
        id: item.id || `outline-${index + 1}`,
        heading: item.heading || "",
        note: item.note || item.memo || "",
        selected: item.selected !== false
      };
    })
    .filter((item) => item.heading.trim())
    .slice(0, OUTLINE_MAX);

const getSelectedOutlineHeadings = (outlineSections = []) =>
  outlineSections
    .filter((item) => item.selected !== false)
    .map((item) => item.heading.trim())
    .filter(Boolean)
    .slice(0, OUTLINE_MAX);

const getSelectedOutlineItems = (outlineSections = []) =>
  outlineSections
    .filter((item) => item.selected !== false)
    .map((item) => ({
      id: item.id,
      heading: String(item.heading || "").trim(),
      note: String(item.note || "").trim()
    }))
    .filter((item) => item.heading)
    .slice(0, OUTLINE_MAX);

const normalizeResult = (storedResult = {}) => ({
  ...emptyResult,
  ...storedResult,
  topicHistory: storedResult.topicHistory || [],
  topicRegenerationCount: storedResult.topicRegenerationCount || 0,
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
  imageSuggestions: storedResult.imageSuggestions || [],
  contentPackage: storedResult.contentPackage || null
});

const stripImageInsertionMarkers = (body = "") =>
  String(body || "")
    .replace(
      /\n{0,2}\[(?:이미지 삽입 추천 \d+|이미지 \d+ 삽입 위치|여기에 이미지를 넣어주세요 이미지 \d+|여기에 이미지 \d+을 넣어주세요[^\]]*)\][\s\S]*?(?=\n{2,}|$)/gu,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const stripMarkdownHeadingStars = (body = "") =>
  String(body || "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*\*\*(.+?)\*\*\s*$/u, "$1")
        .replace(/^\s*\*\s+/u, "")
        .trimEnd()
    )
    .join("\n");

const normalizeClipboardBody = (body = "", { includeImageMarkers = false } = {}) => {
  const source = includeImageMarkers ? String(body || "") : stripImageInsertionMarkers(body);

  return stripMarkdownHeadingStars(source)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

function resultToClipboard(_form, result, options = {}) {
  const body = String(result.body || "")
    ? normalizeClipboardBody(result.body, options)
    : "";

  return [
    result.selectedTitle.trim(),
    "",
    body,
    "",
    result.hashtags.join(" ")
  ].join("\n").trim();
}

const imageKeywordsToClipboard = (imageSuggestions = []) =>
  imageSuggestions
    .map((item, index) => {
      const keyword = item.searchKeyword || item.query || item.imageSearch?.query || "";
      return [`이미지 ${index + 1} 검색어`, keyword].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

export default function ContentMaker() {
  const location = useLocation();
  const finalResultRef = useRef(null);
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(emptyResult);
  const [status, setStatus] = useState("idle");
  const [editing, setEditing] = useState(false);
  const [draftId, setDraftId] = useState(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [defaultMessage, setDefaultMessage] = useState("");
  const [writingProfiles, setWritingProfiles] = useState(() => loadWritingProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState(() => loadWritingProfiles()[0]?.id || "");
  const [profileName, setProfileName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const isFormReady = useMemo(() => isReadyForm(form), [form]);
  const hasTopics = result.topics.length > 0;
  const hasSelectedTopic = Boolean(result.selectedTopic);
  const hasTitles = result.titles.length > 0;
  const hasSelectedTitle = Boolean(result.selectedTitle);
  const selectedOutlineHeadings = useMemo(
    () => getSelectedOutlineHeadings(result.outlineSections),
    [result.outlineSections]
  );
  const selectedOutlineItems = useMemo(
    () => getSelectedOutlineItems(result.outlineSections),
    [result.outlineSections]
  );
  const hasOutline = selectedOutlineItems.length >= OUTLINE_MIN && selectedOutlineItems.length <= OUTLINE_MAX;
  const hasWritingChoices = Boolean(result.selectedOpeningSentence && result.selectedCtaSentence);
  const hasFinal = Boolean(result.body && result.hashtags.length > 0);
  const hasWritingProfiles = writingProfiles.length > 0;

  useEffect(() => {
    const draft = location.state?.draftId ? findDraft(location.state.draftId) : null;

    if (!draft) {
      const profiles = loadWritingProfiles();
      setWritingProfiles(profiles);
      setSelectedProfileId((current) => current || profiles[0]?.id || "");
      setDefaultMessage(
        profiles.length > 0
          ? `저장된 작성 프로필 ${profiles.length}개가 있습니다. 목록에서 선택한 뒤 불러오세요.`
          : ""
      );
      return;
    }

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
    setDefaultMessage("");
  }, [location.state]);

  const updateForm = (key, value) => {
    setForm((current) => {
      const nextForm = { ...current, [key]: value };
      setStatus(isReadyForm(nextForm) ? "ready" : "idle");
      return nextForm;
    });
    setDraftId(null);
    setDraftMessage("");
    setEditing(false);

    if (
      [
        "targetLengthOption",
        "customTargetLength",
        "useEmoji",
        "strengths",
        "emphasisPoint",
        "ctaDirection",
        "audienceType",
        "sponsorshipType"
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
        keywordOptimization: null,
        contentPackage: null
      }));
      return;
    }

    setResult(emptyResult);
  };

  const applyStarterExample = (example) => {
    setForm((current) => {
      const nextForm = normalizeForm({
        ...current,
        keyword: example.keyword,
        category: example.category,
        audienceType: example.audienceType,
        goal: example.goal
      });
      setStatus(isReadyForm(nextForm) ? "ready" : "idle");
      return nextForm;
    });
    setResult(emptyResult);
    setDraftId(null);
    setDraftMessage("");
    setDefaultMessage(`${example.label} 입력값을 채웠습니다.`);
    setEditing(false);
  };

  const generateTopics = async ({ forceNew = false } = {}) => {
    if (!isFormReady) return;

    const shouldRegenerate = forceNew || result.topics.length > 0;
    const previousTopics = shouldRegenerate ? mergeUnique(result.topicHistory, result.topics) : [];
    const nextRegenerationCount = shouldRegenerate ? (result.topicRegenerationCount || 0) + 1 : 0;
    const topicPayload = {
      ...form,
      previousTopics,
      topicHistory: previousTopics,
      regenerationCount: nextRegenerationCount,
      variationSeed: shouldRegenerate ? `${Date.now()}-${nextRegenerationCount}` : ""
    };

    setStatus("generating");
    setEditing(false);
    await wait(500);
    const data = await requestContentApi(
      "/api/content/topics",
      topicPayload,
      () => ({ topics: createTopicRecommendations(topicPayload) })
    );
    const nextTopics = data.topics || [];
    setResult({
      ...emptyResult,
      topics: nextTopics,
      topicHistory: mergeUnique(previousTopics, nextTopics).slice(-30),
      topicRegenerationCount: nextRegenerationCount
    });
    setDraftId(null);
    setStatus("generated");
  };

  const selectTopic = (topic) => {
    const selectedTopic = String(topic || "");

    if (!selectedTopic.trim()) return;

    setResult((current) => ({
      ...current,
      selectedTopic,
      ...resetAfterTopicChange
    }));
    setEditing(false);
    setStatus("generated");
  };

  const updateTopicCandidate = (index, value) => {
    setResult((current) => {
      const previousTopic = current.topics[index] || "";
      const topics = current.topics.map((topic, topicIndex) =>
        topicIndex === index ? value : topic
      );
      const isSelectedTopic = current.selectedTopic === previousTopic;
      const selectedTopic = isSelectedTopic ? (value.trim() ? value : "") : current.selectedTopic;

      return {
        ...current,
        topics,
        selectedTopic,
        ...(isSelectedTopic ? resetAfterTopicChange : {})
      };
    });
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
  };

  const addTopicCandidate = () => {
    setResult((current) => {
      if (current.topics.length >= TOPIC_MAX) return current;

      return {
        ...current,
        topics: [
          ...current.topics,
          `새 글 방향 ${current.topics.length + 1}`
        ]
      };
    });
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
  };

  const generateTitles = async () => {
    if (!isFormReady || !hasSelectedTopic) return;

    setStatus("generating");
    setEditing(false);
    await wait(500);
    const data = await requestContentApi(
      "/api/content/titles",
      {
        ...form,
        selectedTopic: result.selectedTopic
      },
      () => ({ titles: createTitleCandidates(form, result.selectedTopic) })
    );
    setResult((current) => ({
      ...current,
      titles: data.titles,
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
      keywordOptimization: null,
      contentPackage: null
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
      keywordOptimization: null,
      contentPackage: null
    }));
    setEditing(false);
    setStatus("generated");
  };

  const generateOutline = async () => {
    if (!isFormReady || !hasSelectedTopic || !hasSelectedTitle) return;

    setStatus("generating");
    setEditing(false);
    await wait(500);
    const [outlineData, writingChoiceData] = await Promise.all([
      requestContentApi(
        "/api/content/outline",
        {
          ...form,
          selectedTopic: result.selectedTopic,
          selectedTitle: result.selectedTitle
        },
        () => ({
          outlineSections: createOutlineSections(form, result.selectedTopic, result.selectedTitle)
        })
      ),
      requestContentApi(
        "/api/content/writing-choices",
        form,
        () => ({
          openingSentenceCandidates: createOpeningSentenceCandidates(form),
          ctaCandidates: createCtaCandidates(form)
        })
      )
    ]);
    const openingSentenceCandidates = writingChoiceData.openingSentenceCandidates || [];
    const ctaCandidates = writingChoiceData.ctaCandidates || [];
    setResult((current) => ({
      ...current,
      outlineSections: toOutlineItems(outlineData.outlineSections),
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
      keywordOptimization: null,
      contentPackage: null
    }));
    setStatus("generated");
  };

  const generateFinal = async () => {
    if (!isFormReady || !hasSelectedTopic || !hasSelectedTitle || !hasOutline || !hasWritingChoices) return;

    setStatus("generating");
    setEditing(false);
    await wait(650);
    const finalContent = await requestContentApi(
      "/api/content/final",
      {
        ...form,
        selectedTopic: result.selectedTopic,
        selectedTitle: result.selectedTitle,
        outlineSections: selectedOutlineItems,
        selectedOpeningSentence: result.selectedOpeningSentence,
        selectedCtaSentence: result.selectedCtaSentence
      },
      () =>
        createFinalContent(form, result.selectedTopic, result.selectedTitle, selectedOutlineItems, {
          selectedOpeningSentence: result.selectedOpeningSentence,
          selectedCtaSentence: result.selectedCtaSentence
        })
    );

    setResult((current) => ({
        ...current,
        ...finalContent,
        selectedTitleType: current.selectedTitleType || inferTitleType(current.titles, current.selectedTitle),
        outlineSections: current.outlineSections
    }));
    setStatus("generated");
    window.requestAnimationFrame(() => {
      finalResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const regenerate = () => {
    generateTopics({ forceNew: true });
  };

  const saveCurrentDraft = () => {
    if (!hasFinal) return;

    const savedDraft = saveDraft(form, result, draftId);
    setDraftId(savedDraft.id);
    setStatus("saved");
    setDraftMessage("내 보관함에 저장되었습니다.");
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

  const copyResult = async (copyMode = "body") => {
    if (!hasFinal) return;

    const copyText =
      copyMode === "withImageMarkers"
        ? resultToClipboard(form, result, { includeImageMarkers: true })
        : copyMode === "imageKeywords"
          ? imageKeywordsToClipboard(result.imageSuggestions)
          : resultToClipboard(form, result);

    if (!copyText) return;

    await navigator.clipboard.writeText(copyText);
    setStatus("copied");
  };

  const refreshWritingProfiles = (selectedId = "") => {
    const profiles = loadWritingProfiles();
    setWritingProfiles(profiles);
    setSelectedProfileId(selectedId || profiles[0]?.id || "");
    return profiles;
  };

  const saveWritingProfileFromForm = () => {
    const fallbackName =
      form.brandName ||
      form.category ||
      String(form.keyword || "").split(",")[0]?.trim() ||
      `작성 프로필 ${writingProfiles.length + 1}`;
    const profile = saveWritingProfile(
      profileName || fallbackName,
      pickWritingProfileValues(form)
    );

    refreshWritingProfiles(profile.id);
    setProfileName("");
    setDefaultMessage(`작성 프로필 "${profile.name}"을 저장했습니다. 목록에서 선택해 다시 불러올 수 있습니다.`);
  };

  const loadSelectedWritingProfileToForm = () => {
    const profiles = loadWritingProfiles();
    const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) || profiles[0];

    setWritingProfiles(profiles);

    if (!selectedProfile) {
      setSelectedProfileId("");
      setDefaultMessage("저장된 작성 프로필이 아직 없습니다.");
      return;
    }

    setForm((current) => {
      const nextForm = normalizeForm({
        ...current,
        ...selectedProfile.values
      });
      setStatus(isReadyForm(nextForm) ? "ready" : "idle");
      return nextForm;
    });
    setResult(emptyResult);
    setDraftId(null);
    setEditing(false);
    setSelectedProfileId(selectedProfile.id);
    setProfileName(selectedProfile.name);
    setDefaultMessage(`작성 프로필 "${selectedProfile.name}"을 입력값에 반영했습니다.`);
  };

  const deleteSelectedWritingProfile = () => {
    const selectedProfile = writingProfiles.find((profile) => profile.id === selectedProfileId);

    if (!selectedProfile) {
      setDefaultMessage("삭제할 작성 프로필을 먼저 선택해주세요.");
      return;
    }

    const confirmed = window.confirm(`작성 프로필 "${selectedProfile.name}"을 삭제할까요?`);

    if (!confirmed) return;

    const nextProfiles = deleteWritingProfile(selectedProfile.id);
    setWritingProfiles(nextProfiles);
    setSelectedProfileId(nextProfiles[0]?.id || "");
    setProfileName("");
    setDefaultMessage(`작성 프로필 "${selectedProfile.name}"을 삭제했습니다.`);
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
      keywordOptimization: null,
      contentPackage: null
    }));
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
  };

  const addOutlineSection = () => {
    setResult((current) => {
      if (current.outlineSections.length >= OUTLINE_MAX) return current;

      return {
        ...current,
        outlineSections: [
          ...current.outlineSections,
          {
            id: `outline-${Date.now()}`,
            heading: `새 소제목 ${current.outlineSections.length + 1}`,
            note: "",
            selected: true
          }
        ],
        body: "",
        hashtags: [],
        hashtagGroups: [],
        imageSuggestions: [],
        strategyMemo: null,
        seoCheck: null,
        keywordOptimization: null,
        contentPackage: null
      };
    });
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
  };

  const deleteOutlineSection = (id) => {
    setResult((current) => {
      const nextOutline = current.outlineSections.filter((item) => item.id !== id);
      const selectedCount = getSelectedOutlineHeadings(nextOutline).length;

      if (current.outlineSections.length <= OUTLINE_MIN || selectedCount < OUTLINE_MIN) {
        return current;
      }

      return {
        ...current,
        outlineSections: nextOutline,
        body: "",
        hashtags: [],
        hashtagGroups: [],
        imageSuggestions: [],
        strategyMemo: null,
        seoCheck: null,
        keywordOptimization: null,
        contentPackage: null
      };
    });
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
  };

  const moveOutlineSection = (id, direction) => {
    setResult((current) => {
      const currentIndex = current.outlineSections.findIndex((item) => item.id === id);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.outlineSections.length) {
        return current;
      }

      const nextOutline = [...current.outlineSections];
      const [movedItem] = nextOutline.splice(currentIndex, 1);
      nextOutline.splice(nextIndex, 0, movedItem);

      return {
        ...current,
        outlineSections: nextOutline,
        body: "",
        hashtags: [],
        hashtagGroups: [],
        imageSuggestions: [],
        strategyMemo: null,
        seoCheck: null,
        keywordOptimization: null,
        contentPackage: null
      };
    });
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
      keywordOptimization: null,
      contentPackage: null
    }));
    setDraftId(null);
    setEditing(false);
    setStatus("generated");
  };

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">선택형 MVP 작업 화면</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">콘텐츠 메이커</h2>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(320px,0.38fr)_minmax(0,0.62fr)]">
        <section className="order-2 min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft xl:order-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">입력값</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {isFormReady ? "입력 완료" : "입력 전"}
            </span>
          </div>

          <div className="mt-4 rounded-md border border-line bg-paper px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-ink/55">
                <span>작성 프로필 관리</span>
                <span className={`rounded-md px-2 py-0.5 ${hasWritingProfiles ? "bg-moss/10 text-moss" : "bg-white"}`}>
                  {hasWritingProfiles ? `${writingProfiles.length}개 저장됨` : "없음"}
                </span>
              </div>
            </div>
            <p className="mt-2 text-xs font-semibold leading-5 text-ink/55">
              자주 쓰는 업종, 말투, 금지어, 글 목적, 키워드 스타일을 저장해두는 기능입니다.
            </p>
            <div className="mt-3 grid gap-2">
              <label className="block">
                <span className="text-xs font-bold text-ink/55">프로필 이름</span>
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="focus-ring mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm"
                  placeholder="예: 수분크림 상품 후기용"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-ink/55">저장된 작성 프로필</span>
                <select
                  value={selectedProfileId}
                  onChange={(event) => {
                    const profile = writingProfiles.find((item) => item.id === event.target.value);
                    setSelectedProfileId(event.target.value);
                    setProfileName(profile?.name || "");
                  }}
                  disabled={!hasWritingProfiles}
                  className="focus-ring mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm disabled:cursor-not-allowed disabled:text-ink/35"
                >
                  {!hasWritingProfiles && <option value="">저장된 프로필 없음</option>}
                  {writingProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={saveWritingProfileFromForm}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-bold transition hover:border-moss hover:text-moss"
                >
                  <Save size={14} aria-hidden="true" />
                  프로필 저장
                </button>
                <button
                  type="button"
                  onClick={loadSelectedWritingProfileToForm}
                  disabled={!hasWritingProfiles}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-bold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  불러오기
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedWritingProfile}
                  disabled={!hasWritingProfiles}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-bold transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  삭제
                </button>
              </div>
            </div>
          </div>
          {defaultMessage && (
            <p className="mt-2 rounded-md bg-paper px-3 py-2 text-xs font-semibold text-moss">
              {defaultMessage}
            </p>
          )}

          <div className="mt-4 hidden xl:block">
            <FirstUseGuide onFillExample={applyStarterExample} />
          </div>

          <div className="mt-5 space-y-5">
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-ink/70">기본 입력</h4>

              <label className="block">
                <FieldLabel required tooltip={FIELD_TOOLTIPS.keyword}>키워드</FieldLabel>
                <input
                  value={form.keyword}
                  onChange={(event) => updateForm("keyword", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 강남 피부관리샵, 리프팅 관리, 피부탄력"
                />
                <p className="mt-2 text-xs leading-5 text-ink/55">
                  검색되고 싶은 핵심 키워드를 1개 입력하거나, 쉼표로 2~3개까지 입력할 수 있습니다.
                  첫 번째 키워드는 메인 키워드로, 나머지는 보조 키워드로 활용됩니다.
                </p>
              </label>

              <label className="block">
                <FieldLabel required tooltip={FIELD_TOOLTIPS.category}>업종/주제</FieldLabel>
                <select
                  value={form.category}
                  onChange={(event) => updateForm("category", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                >
                  <option value="">업종 고르기</option>
                  {makerOptions.categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>

              <div className="xl:hidden">
                <details className="rounded-md border border-line bg-paper p-3">
                  <summary className="cursor-pointer text-sm font-bold text-ink/70">
                    글 조건 더 보기
                  </summary>
                  <div className="mt-4 space-y-4">
                    <fieldset>
                      <legend>
                        <FieldLabel tooltip={FIELD_TOOLTIPS.audienceType}>사용자 유형</FieldLabel>
                      </legend>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {makerOptions.audienceTypes.map((audienceType) => (
                          <label
                            key={`mobile-${audienceType}`}
                            className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                              form.audienceType === audienceType
                                ? "border-coral bg-coral text-white"
                                : "border-line bg-white hover:border-coral"
                            }`}
                          >
                            <input
                              type="radio"
                              name="audienceTypeMobile"
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

                    <fieldset>
                      <legend>
                        <FieldLabel required tooltip={FIELD_TOOLTIPS.goal}>글 목적</FieldLabel>
                      </legend>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {makerOptions.goals.map((goal) => (
                          <label
                            key={`mobile-${goal}`}
                            className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                              form.goal === goal
                                ? "border-moss bg-moss text-white"
                                : "border-line bg-white hover:border-moss"
                            }`}
                          >
                            <input
                              type="radio"
                              name="goalMobile"
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
                      <legend>
                        <FieldLabel tooltip={FIELD_TOOLTIPS.targetLength}>목표 글자수</FieldLabel>
                      </legend>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {makerOptions.targetLengths.map((option) => (
                          <label
                            key={`mobile-${option.value}`}
                            className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-semibold transition ${
                              form.targetLengthOption === option.value
                                ? "border-amber bg-amber text-white"
                                : "border-line bg-white hover:border-amber"
                            }`}
                          >
                            <input
                              type="radio"
                              name="targetLengthMobile"
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
                          className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                          placeholder="예: 1800"
                        />
                      )}
                    </fieldset>

                    <label className="block">
                      <FieldLabel required tooltip={FIELD_TOOLTIPS.tone}>말투</FieldLabel>
                      <select
                        value={form.tone}
                        onChange={(event) => updateForm("tone", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                      >
                        {makerOptions.tones.map((tone) => (
                          <option key={`mobile-${tone}`} value={tone}>
                            {tone}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </details>
              </div>

              <fieldset className="hidden xl:block">
                <legend>
                  <FieldLabel tooltip={FIELD_TOOLTIPS.audienceType}>사용자 유형</FieldLabel>
                </legend>
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

              <fieldset className="hidden xl:block">
                <legend>
                  <FieldLabel required tooltip={FIELD_TOOLTIPS.goal}>글 목적</FieldLabel>
                </legend>
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

              <fieldset className="hidden xl:block">
                <legend>
                  <FieldLabel tooltip={FIELD_TOOLTIPS.targetLength}>목표 글자수</FieldLabel>
                </legend>
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
              </fieldset>

              <label className="hidden xl:block">
                <FieldLabel required tooltip={FIELD_TOOLTIPS.tone}>말투</FieldLabel>
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
            </div>

            <div className="border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setAdvancedOpen((current) => !current)}
                aria-expanded={advancedOpen}
                className="focus-ring flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-line bg-white px-3 text-sm font-bold transition hover:border-moss hover:text-moss"
              >
                <span>고급 입력 {advancedOpen ? "닫기" : "열기"}</span>
                <ChevronDown
                  size={17}
                  className={`transition ${advancedOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              {advancedOpen && (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.brandName}>브랜드명/매장명</FieldLabel>
                      <input
                        value={form.brandName}
                        onChange={(event) => updateForm("brandName", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 우리 매장명"
                      />
                    </label>

                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.region}>지역</FieldLabel>
                      <input
                        value={form.region}
                        onChange={(event) => updateForm("region", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 서울 강남"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <FieldLabel tooltip={FIELD_TOOLTIPS.strengths}>핵심 강점</FieldLabel>
                    <textarea
                      value={form.strengths}
                      onChange={(event) => updateForm("strengths", event.target.value)}
                      rows={3}
                      className="focus-ring mt-2 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
                      placeholder="예: 1:1 상담, 맞춤 관리"
                    />
                  </label>

                  <label className="block">
                    <FieldLabel tooltip={FIELD_TOOLTIPS.emphasisPoint}>강조 포인트</FieldLabel>
                    <input
                      value={form.emphasisPoint}
                      onChange={(event) => updateForm("emphasisPoint", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                      placeholder="예: 처음 방문 고객도 편하게 상담 가능"
                    />
                  </label>

                  <label className="block">
                    <FieldLabel tooltip={FIELD_TOOLTIPS.ctaDirection}>CTA 톤</FieldLabel>
                    <input
                      value={form.ctaDirection}
                      onChange={(event) => updateForm("ctaDirection", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                      placeholder="예: 부담 없이 상담 받아보세요"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.address}>주소</FieldLabel>
                      <input
                        value={form.address}
                        onChange={(event) => updateForm("address", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 서울 강남구 ○○로 00"
                      />
                    </label>

                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.businessHours}>영업시간</FieldLabel>
                      <input
                        value={form.businessHours}
                        onChange={(event) => updateForm("businessHours", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 평일 10:00-19:00"
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.priceInfo}>가격/가격대</FieldLabel>
                      <input
                        value={form.priceInfo}
                        onChange={(event) => updateForm("priceInfo", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 29,000원대"
                      />
                    </label>

                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.purchaseUrl}>구매처</FieldLabel>
                      <input
                        value={form.purchaseUrl}
                        onChange={(event) => updateForm("purchaseUrl", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 네이버 스마트스토어"
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.contactMethod}>문의 방법</FieldLabel>
                      <input
                        value={form.contactMethod}
                        onChange={(event) => updateForm("contactMethod", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 카카오톡 채널, 전화"
                      />
                    </label>

                    <label className="block">
                      <FieldLabel tooltip={FIELD_TOOLTIPS.shippingInfo}>배송/교환 정보</FieldLabel>
                      <input
                        value={form.shippingInfo}
                        onChange={(event) => updateForm("shippingInfo", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                        placeholder="예: 평일 오후 2시 전 주문 당일 출고"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <FieldLabel tooltip={FIELD_TOOLTIPS.sponsorshipType}>협찬 여부</FieldLabel>
                    <select
                      value={form.sponsorshipType}
                      onChange={(event) => updateForm("sponsorshipType", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                    >
                      <option value="">미입력 - 검수표에 확인 필요 표시</option>
                      <option value="직접 구매">직접 구매</option>
                      <option value="제품 제공">제품 제공</option>
                      <option value="식사권 제공">식사권 제공</option>
                      <option value="협찬/체험단">협찬/체험단</option>
                    </select>
                  </label>

                  <label className="flex min-h-12 items-center justify-between gap-4 rounded-md border border-line bg-paper px-3">
                    <FieldLabel tooltip={FIELD_TOOLTIPS.useEmoji}>이모지 사용</FieldLabel>
                    <input
                      type="checkbox"
                      checked={form.useEmoji}
                      onChange={(event) => updateForm("useEmoji", event.target.checked)}
                      className="h-5 w-5 accent-[#52796f]"
                    />
                  </label>

                  <label className="block">
                    <FieldLabel tooltip={FIELD_TOOLTIPS.avoid}>금지어</FieldLabel>
                    <input
                      value={form.avoid}
                      onChange={(event) => updateForm("avoid", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                      placeholder="예: 최고, 무조건, 보장"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={generateTopics}
              disabled={!isFormReady || status === "generating"}
              className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
            >
              <Sparkles size={18} aria-hidden="true" />
              글 방향 생성
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
          {result.topicRegenerationCount > 0 && (
            <p className="mt-2 text-xs font-semibold text-ink/55">
              이전 글 방향과 겹치지 않도록 새로운 관점으로 {result.topicRegenerationCount + 1}번째 후보를 만들었습니다.
            </p>
          )}
        </section>

        <section className="order-1 min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft xl:order-2">
          <div className="mb-5 rounded-lg border border-line bg-paper p-4 xl:hidden">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">빠른 시작</h3>
              <span className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-ink/60">
                {isFormReady ? "입력 완료" : "입력 전"}
              </span>
            </div>
            <div className="mt-3">
              <FirstUseGuide compact onFillExample={applyStarterExample} />
            </div>
            <div className="mt-4 grid gap-3">
              <label className="block">
                <FieldLabel required tooltip={FIELD_TOOLTIPS.keyword}>키워드</FieldLabel>
                <input
                  value={form.keyword}
                  onChange={(event) => updateForm("keyword", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                  placeholder="예: 강남 피부관리샵, 리프팅 관리, 피부탄력"
                />
              </label>

              <label className="block">
                <FieldLabel required tooltip={FIELD_TOOLTIPS.category}>업종/주제</FieldLabel>
                <select
                  value={form.category}
                  onChange={(event) => updateForm("category", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                >
                  <option value="">업종 고르기</option>
                  {makerOptions.categories.map((category) => (
                    <option key={`quick-${category}`} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={generateTopics}
                disabled={!isFormReady || status === "generating"}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                <Sparkles size={18} aria-hidden="true" />
                글 방향 생성
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
          </div>
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
                onClick={() => copyResult()}
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
                내 보관함 저장
              </button>
            </div>
          </div>

          {draftMessage && (
            <p className="mt-3 rounded-md border border-moss/20 bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
              {draftMessage}
            </p>
          )}

          <div className="mt-5 space-y-6">
            <EditableTopicList
              title="1. 글 방향 3개"
              items={result.topics}
              selected={result.selectedTopic}
              emptyText="입력값을 채우고 글 방향 생성을 누르면 후보가 표시됩니다."
              canAdd={result.topics.length > 0 && result.topics.length < TOPIC_MAX}
              onChange={updateTopicCandidate}
              onSelect={selectTopic}
              onAdd={addTopicCandidate}
            />

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-bold text-ink/70">2. 선택한 글 방향 기준 제목 고르기</h4>
                <button
                  type="button"
                  onClick={generateTitles}
                  disabled={!hasSelectedTopic || status === "generating"}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  제목 생성
                </button>
              </div>
              <TitleCandidateList
                items={result.titles}
                selected={result.selectedTitle}
                emptyText="글 방향을 하나 선택한 뒤 제목 생성을 누르세요."
                onSelect={selectTitle}
              />
            </div>

            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-bold text-ink/70">3. 본문 구성 수정</h4>
                  <p className="mt-1 text-xs leading-5 text-ink/55">
                    글에 들어갈 순서를 직접 바꿀 수 있어요. 필요 없는 항목은 삭제하고,
                    추가하고 싶은 내용은 메모에 적어주세요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={generateOutline}
                  disabled={!hasSelectedTitle || status === "generating"}
                  className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  글 구성 만들기
                </button>
              </div>
              <OutlineEditor
                items={result.outlineSections}
                selectedCount={selectedOutlineHeadings.length}
                emptyText="제목을 하나 선택한 뒤 글 구성 만들기를 누르세요."
                onChange={updateOutlineSection}
                onAdd={addOutlineSection}
                onDelete={deleteOutlineSection}
                onMove={moveOutlineSection}
              />
            </div>

            <div>
              <h4 className="text-sm font-bold text-ink/70">4. 첫 문장과 CTA 선택</h4>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <WritingChoiceGroup
                  title="첫 문장 후보"
                  items={result.openingSentenceCandidates}
                  selected={result.selectedOpeningSentence}
                  emptyText="글 구성을 만들면 첫 문장 후보가 표시됩니다."
                  onSelect={(value) => selectWritingChoice("selectedOpeningSentence", value)}
                />
                <WritingChoiceGroup
                  title="CTA 후보"
                  items={result.ctaCandidates}
                  selected={result.selectedCtaSentence}
                  emptyText="글 구성을 만들면 CTA 후보가 표시됩니다."
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
                  이 구성으로 본문 만들기
                </button>
              </div>

              {!hasFinal && (
                <div className="mt-2 grid min-h-[220px] place-items-center rounded-lg border border-dashed border-line bg-paper p-6 text-center text-sm text-ink/60">
                  글 구성과 첫 문장, CTA를 선택하면 네이버에 옮겨 쓸 게시용 본문을 생성할 수 있습니다.
                </div>
              )}

              {hasFinal && (
                <div ref={finalResultRef}>
                  <FinalResultPanel
                    result={result}
                    editing={editing}
                    onCopy={copyResult}
                    onImageChange={updateImageSuggestion}
                    onTitleChange={(value) =>
                      setResult((current) => ({ ...current, selectedTitle: value }))
                    }
                    onBodyChange={(value) => setResult((current) => ({ ...current, body: value }))}
                    onHashtagsChange={(value) =>
                      setResult((current) => ({
                        ...current,
                        hashtags: value.split(/\s+/).filter(Boolean).slice(0, 14),
                        hashtagGroups: []
                      }))
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function FieldLabel({ children, required = false, tooltip = null }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      <span>{children}</span>
      {required && (
        <span className="rounded-md bg-coral/10 px-2 py-0.5 text-[11px] font-bold text-coral">
          필수
        </span>
      )}
      {tooltip && <FieldTooltip text={tooltip} />}
    </span>
  );
}

function FieldTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const tooltip = typeof text === "string" ? { description: text } : text;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="focus-ring inline-grid h-5 w-5 place-items-center rounded-full text-ink/45 transition hover:bg-white hover:text-moss"
        aria-label="입력 도움말"
      >
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      {open && (
        <span className="absolute bottom-7 left-1/2 z-30 w-64 -translate-x-1/2 rounded-md border border-line bg-white px-3 py-3 text-xs font-medium leading-6 text-ink/70 shadow-soft sm:w-72">
          {tooltip?.title && <span className="block text-sm font-bold text-ink">{tooltip.title}</span>}
          {tooltip?.description && (
            <span className="mt-1 block whitespace-normal">{tooltip.description}</span>
          )}
          {tooltip?.example && (
            <span className="mt-1 block whitespace-normal text-moss">
              예: {tooltip.example}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function FirstUseGuide({ compact = false, onFillExample }) {
  const content = (
    <div className="space-y-3">
      <p className="text-sm font-semibold leading-6 text-ink/70">
        키워드는 내 글이 검색되길 원하는 핵심 단어입니다. 매장 홍보라면 지역+업종,
        상품 후기라면 상품명+후기, 정보글이라면 사람들이 궁금해할 질문을 넣어보세요.
      </p>
      {!compact && (
        <ul className="grid gap-1 text-xs font-semibold leading-5 text-ink/55">
          <li>매장 홍보: 강남 피부관리샵, 리프팅 관리, 피부탄력</li>
          <li>상품 후기: 수분크림 후기, 피부 보습, 데일리 크림</li>
          <li>정보글: 육아서적 추천, 초등 독서, 부모 가이드</li>
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
        {STARTER_EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => onFillExample(example)}
            className="focus-ring inline-flex min-h-10 items-center justify-center rounded-md border border-line bg-white px-3 text-sm font-bold transition hover:border-moss hover:text-moss"
          >
            {example.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (compact) {
    return (
      <details className="rounded-md border border-line bg-white p-3">
        <summary className="cursor-pointer text-sm font-bold text-ink/70">
          처음 사용 가이드
        </summary>
        <div className="mt-3">{content}</div>
      </details>
    );
  }

  return (
    <div className="rounded-md border border-moss/20 bg-moss/10 p-3">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-moss" aria-hidden="true" />
        <p className="text-sm font-bold text-ink/75">처음 사용 가이드</p>
      </div>
      <div className="mt-2">{content}</div>
    </div>
  );
}

const isBodyDisplayHeading = (paragraph = "") => {
  const value = String(paragraph || "").trim();

  if (!value) return false;
  if (/^\[여기에 이미지 \d+을 넣어주세요/u.test(value)) return false;
  if (/^(Q\.|A\.|[-•]|\d+\.)/u.test(value)) return false;
  if (value.includes(":")) return false;

  return Array.from(value).length <= 42 && !/[.!?。]$/u.test(value);
};

function BodyPreview({ body = "" }) {
  const paragraphs = stripMarkdownHeadingStars(body)
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="mt-2 max-h-[560px] overflow-auto rounded-md border border-line bg-paper p-4 text-sm leading-7 text-ink/80">
      {paragraphs.map((paragraph, index) => {
        const isImageMarker = /^\[여기에 이미지 \d+을 넣어주세요/u.test(paragraph);

        if (isBodyDisplayHeading(paragraph)) {
          return (
            <p key={`${paragraph}-${index}`} className="mt-5 first:mt-0 text-base font-bold text-ink">
              {paragraph}
            </p>
          );
        }

        return (
          <p
            key={`${paragraph}-${index}`}
            className={`mt-3 whitespace-pre-wrap first:mt-0 ${
              isImageMarker
                ? "rounded-md border border-moss/20 bg-white px-3 py-2 text-xs font-semibold text-moss"
                : ""
            }`}
          >
            {paragraph}
          </p>
        );
      })}
    </div>
  );
}

function DetailedAnalysisPanel({ packageData }) {
  if (!packageData) return null;

  return (
    <details className="rounded-md border border-line bg-white p-4">
      <summary className="cursor-pointer text-sm font-bold text-ink/70">
        8. 상세 분석 보기
      </summary>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <PackageBlock title="메인 키워드" items={[packageData.mainKeyword]} />
        <PackageBlock title="보조 키워드" items={packageData.secondaryKeywords} />
        <PackageBlock title="사람들이 궁금해할 내용" items={[packageData.searchIntentAnalysis?.summary]} />
        <PackageBlock
          title="클릭을 높이는 포인트"
          items={[
            packageData.homeFeedClickPoint?.situationTitle,
            packageData.homeFeedClickPoint?.thumbnailCopy,
            packageData.homeFeedClickPoint?.saveAsset
          ]}
        />
        <PackageBlock title="제목 후보 전체" items={packageData.titleCandidates} />
        <PackageBlock title="첫 문장 후보" items={packageData.openingSentenceCandidates} />
        <PackageBlock
          title="업체/상품 정보 정리"
          items={(packageData.infoSummary || []).map(([label, value]) => `${label}: ${value}`)}
        />
      </div>
    </details>
  );
}

function ResultListPanel({ title, items = [], emptyText = "[확인 필요]" }) {
  const displayItems = items.map((item) => String(item || "").trim()).filter(Boolean);

  return (
    <section className="rounded-md border border-line bg-white p-4">
      <h5 className="text-sm font-bold text-ink/70">{title}</h5>
      <ul className="mt-2 space-y-2 text-sm leading-6 text-ink/75">
        {displayItems.length > 0 ? (
          displayItems.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)
        ) : (
          <li>{emptyText}</li>
        )}
      </ul>
    </section>
  );
}

function FaqPanel({ items = [] }) {
  if (!items.length) return null;

  return (
    <section className="rounded-md border border-line bg-white p-4">
      <h5 className="text-sm font-bold text-ink/70">6. FAQ</h5>
      <div className="mt-2 space-y-3">
        {items.map((item, index) => (
          <div key={`${item.question}-${index}`} className="rounded-md border border-line bg-paper p-3">
            <p className="text-sm font-bold text-ink/75">Q. {item.question}</p>
            <p className="mt-1 text-sm leading-6 text-ink/65">A. {item.answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PackageBlock({ title, items = [] }) {
  const displayItems = items.map((item) => String(item || "").trim()).filter(Boolean);

  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <p className="text-xs font-bold text-ink/55">{title}</p>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-ink/75">
        {displayItems.length > 0 ? (
          displayItems.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)
        ) : (
          <li>[확인 필요]</li>
        )}
      </ul>
    </div>
  );
}

function FinalResultPanel({
  result,
  editing,
  onCopy,
  onImageChange,
  onTitleChange,
  onBodyChange,
  onHashtagsChange
}) {
  const packageData = result.contentPackage;

  return (
    <div className="mt-5 space-y-5 border-t border-line pt-5">
      <div className="rounded-md border border-line bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h5 className="text-sm font-bold text-ink/70">1. 선택 제목</h5>
          <span className="text-xs font-semibold text-moss">게시용 결과</span>
        </div>
        {editing ? (
          <input
            value={result.selectedTitle}
            onChange={(event) => onTitleChange(event.target.value)}
            className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-base font-bold"
          />
        ) : (
          <p className="mt-2 text-xl font-bold leading-8 text-ink">{result.selectedTitle}</p>
        )}
      </div>

      <div>
        <h5 className="text-sm font-bold text-ink/70">2. 블로그 본문</h5>
        {editing ? (
          <textarea
            value={result.body}
            onChange={(event) => onBodyChange(event.target.value)}
            rows={15}
            className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-3 text-sm leading-7 whitespace-pre-wrap"
          />
        ) : (
          <BodyPreview body={result.body} />
        )}
      </div>

      <div>
        <h5 className="text-sm font-bold text-ink/70">3. 해시태그</h5>
        {editing ? (
          <textarea
            value={result.hashtags.join(" ")}
            onChange={(event) => onHashtagsChange(event.target.value)}
            rows={3}
            className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-3 text-sm leading-7"
          />
        ) : (
          <HashtagGroupCards groups={result.hashtagGroups} fallbackTags={result.hashtags} />
        )}
      </div>

      <ImageSuggestionList items={result.imageSuggestions} editing={editing} onChange={onImageChange} />

      <ResultListPanel title="5. 이런 분께 추천해요" items={packageData?.recommendedFor || []} />

      <FaqPanel items={packageData?.faqItems || []} />

      <BlogStructureCheckPanel seoCheck={result.seoCheck} />

      <DetailedAnalysisPanel packageData={packageData} />

      <div>
        <h5 className="text-sm font-bold text-ink/70">복사하기</h5>
        <div className="mt-2 grid gap-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => onCopy("body")}
            className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-amber px-4 text-sm font-bold text-white transition hover:bg-[#b8862c]"
          >
            <Clipboard size={18} aria-hidden="true" />
            본문만 복사
          </button>
          <button
            type="button"
            onClick={() => onCopy("withImageMarkers")}
            className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-moss hover:text-moss"
          >
            <Image size={18} aria-hidden="true" />
            본문 + 이미지 삽입 표시 포함 복사
          </button>
          <button
            type="button"
            onClick={() => onCopy("imageKeywords")}
            className="focus-ring inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-bold transition hover:border-amber hover:text-[#7a5a1e]"
          >
            <Clipboard size={18} aria-hidden="true" />
            이미지 검색어만 복사
          </button>
        </div>
      </div>

    </div>
  );
}

function HashtagGroupCards({ groups = [], fallbackTags = [] }) {
  const [copiedGroupId, setCopiedGroupId] = useState("");
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
  const allTags = Array.from(new Set(displayGroups.flatMap((group) => group.tags || [])));
  const copyTags = async (id, tags = []) => {
    const copyText = tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`))
      .join(" ");

    if (!copyText) return;

    await navigator.clipboard.writeText(copyText);
    setCopiedGroupId(id);
    window.setTimeout(() => setCopiedGroupId((currentId) => (currentId === id ? "" : currentId)), 1600);
  };

  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-bold text-ink/70">네이버 블로그 태그 입력에 바로 붙여넣을 수 있습니다.</p>
        <button
          type="button"
          onClick={() => copyTags("all", allTags)}
          disabled={allTags.length === 0}
          className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-moss px-3 text-xs font-bold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
        >
          {copiedGroupId === "all" ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
          {copiedGroupId === "all" ? "복사됨" : "전체 해시태그 복사"}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
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
            <button
              type="button"
              onClick={() => copyTags(group.id || group.label, group.tags)}
              disabled={group.tags.length === 0}
              className="focus-ring mt-3 inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold text-ink/60 transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:opacity-45"
            >
              {copiedGroupId === (group.id || group.label) ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Clipboard size={14} aria-hidden="true" />
              )}
              {copiedGroupId === (group.id || group.label) ? "복사됨" : `${group.label} 복사`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const SEO_CHECK_LABELS = {
  "title-main-keyword": "메인 키워드가 제목에 포함됨",
  "first-sentence-keyword": "첫 문장에 메인 키워드 반영",
  "first-paragraph-keyword-density": "첫 문단에 키워드 2~3회 자연 반영",
  "first-paragraph-answer": "첫 문단이 정보형 답변으로 시작함",
  "secondary-keywords": "보조 키워드가 본문과 소제목에 자연스럽게 분산됨",
  "title-body-match": "제목과 본문 주제가 일치함",
  "search-intent-goal-match": "사람들이 궁금해할 내용과 글 목적이 일치함",
  "outline-body-linked": "소제목이 본문 내용과 연결됨",
  "experience-comparison-check": "경험/후기/비교/체크포인트 중 하나 이상 포함",
  "keyword-overuse": "키워드 과다 반복 없음",
  "audience-goal-flow": "사용자 유형과 글 목적이 본문 흐름에 반영됨",
  "outline-count": "목표 글자수에 맞는 소제목 수가 적용됨",
  "image-markers": "본문 안에 이미지 삽입 추천 위치가 표시됨",
  "faq-question": "FAQ 또는 질문형 답변 구조가 포함됨",
  overclaim: "과장 표현 없음",
  cta: "마무리 CTA가 자연스럽게 들어감",
  avoid: "금지어 없음",
  "unverified-info-marked": "확인되지 않은 정보 표시 여부",
  "sponsorship-disclosure": "협찬/체험단 표시 여부",
  "experience-source": "실제 경험 기반 여부",
  "photo-guide": "사진 가이드 포함 여부",
  "info-summary": "업체/상품 정보 정리 여부",
  "hashtag-count": "해시태그 10~15개 포함 여부",
  "heading-stars-removed": "소제목 별표 제거 여부"
};

const createSeoChecklist = (seoCheck) => {
  const items = seoCheck?.items || [];

  if (items.length > 0) {
    return items.map((item) => ({
      id: item.id,
      label: SEO_CHECK_LABELS[item.id] || item.label || item.id,
      detail: item.detail || "",
      passed: item?.passed === true
    }));
  }

  return Object.entries(SEO_CHECK_LABELS).map(([id, label]) => {
    const item = items.find((check) => check.id === id);

    return {
      id,
      label,
      detail: item?.detail || "",
      passed: item?.passed === true
    };
  });
};

function BlogStructureCheckPanel({ seoCheck }) {
  if (!seoCheck) return null;

  const checklist = createSeoChecklist(seoCheck);
  const passedCount = checklist.filter((item) => item.passed).length;
  const totalCount = checklist.length;

  return (
    <section className="rounded-md border border-moss/25 bg-moss/10 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold text-moss">블로그 글 구조 점검</p>
          <h5 className="mt-1 text-base font-bold text-ink">7. 글 발행 전 확인사항</h5>
          <p className="mt-1 text-sm leading-6 text-ink/65">
            제목, 첫 문단, 글 구성, 키워드, 마무리 문장이 사람들이 궁금해할 내용에 맞게 구성됐는지 확인합니다.
          </p>
        </div>
        <span className="inline-flex min-h-8 items-center justify-center rounded-md bg-white px-3 text-xs font-bold text-moss">
          {passedCount}/{totalCount} 확인
        </span>
      </div>

      <ul className="mt-4 grid gap-2 lg:grid-cols-2">
        {checklist.map((item) => (
          <li key={item.id} className="rounded-md border border-line bg-white p-3">
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  item.passed ? "bg-moss/10 text-moss" : "bg-amber/10 text-[#7a5a1e]"
                }`}
              >
                {item.passed ? <Check size={13} aria-hidden="true" /> : <CircleHelp size={13} aria-hidden="true" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink/75">{item.label}</p>
                {item.detail && <p className="mt-1 text-xs leading-5 text-ink/55">{item.detail}</p>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StrategyMemo({ result, range }) {
  const memo = result.strategyMemo;
  const keyword = result.keywordOptimization;
  const seoCheck = result.seoCheck || memo?.seoCheck;

  if (!memo && !keyword && !seoCheck) return null;

  const summaryItems = [
    ["글 방향", memo?.selectedTopic || result.selectedTopic],
    ["선택 제목", memo?.selectedTitle || result.selectedTitle],
    ["메인 키워드", keyword?.mainKeyword],
    ["보조 키워드", (keyword?.secondaryKeywords || []).join(", ")],
    ["목표 글자수", `${range?.target || keyword?.targetLength || ""}자`],
    ["사용자 유형", memo?.audienceType]
  ].filter(([, value]) => value && value !== "자");
  const checklist = createSeoChecklist(seoCheck);
  const imageItems = (result.imageSuggestions || []).map((item) => ({
    id: item.id,
    label: item.label || item.title,
    keyword: item.searchKeyword || item.query || item.imageSearch?.query || "",
    concept: item.description || item.title || ""
  }));

  return (
    <details className="rounded-md border border-line bg-white p-4 text-sm">
      <summary className="cursor-pointer font-bold text-ink/65">
        운영 메모 / 내부 전략 데이터
      </summary>
      <div className="mt-4 space-y-4 leading-6 text-ink/70">
        <section>
          <h6 className="text-xs font-bold text-ink/50">선택값 요약</h6>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {summaryItems.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[72px_1fr] gap-2">
                <dt className="text-xs font-bold text-ink/45">{label}</dt>
                <dd className="min-w-0 text-sm text-ink/75">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {seoCheck && (
          <section className="border-t border-line pt-4">
            <div className="flex items-center justify-between gap-2">
              <h6 className="text-xs font-bold text-ink/50">본문 흐름 점검</h6>
              <span className="text-xs font-bold text-moss">
                {checklist.filter((item) => item.passed).length}/{checklist.length} 통과
              </span>
            </div>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                      item.passed ? "bg-moss/10 text-moss" : "bg-coral/10 text-coral"
                    }`}
                  >
                    {item.passed ? <Check size={13} aria-hidden="true" /> : <CircleHelp size={13} aria-hidden="true" />}
                  </span>
                  <span className="text-ink/75">{item.label}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {imageItems.length > 0 && (
          <section className="border-t border-line pt-4">
            <h6 className="text-xs font-bold text-ink/50">이미지 추천 데이터</h6>
            <ul className="mt-2 space-y-2">
              {imageItems.map((item) => (
                <li key={item.id} className="text-sm">
                  <p className="font-semibold text-ink/75">{item.label}</p>
                  {item.keyword && (
                    <p className="text-ink/60">이미지 사이트 검색어: {item.keyword}</p>
                  )}
                  {item.concept && (
                    <p className="line-clamp-2 text-ink/60">추천 이미지 컨셉: {item.concept}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
  );
}

const getPrimaryTitleIndexes = (items = []) => {
  const allIndexes = items.map((_, index) => index);
  const preferredIndexes = [...PRIMARY_TITLE_INDEXES, ...allIndexes];

  return Array.from(new Set(preferredIndexes))
    .filter((index) => index < items.length)
    .slice(0, Math.min(3, items.length));
};

function EditableTopicList({
  title,
  items,
  selected,
  emptyText,
  canAdd,
  onChange,
  onSelect,
  onAdd
}) {
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-bold text-ink/70">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-ink/55">
            마음에 드는 방향을 고른 뒤 문구를 직접 고쳐 쓸 수 있어요.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold text-moss transition hover:border-moss disabled:cursor-not-allowed disabled:text-ink/30"
        >
          <Plus size={14} aria-hidden="true" />
          글 방향 추가
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {items.map((item, index) => {
          const isSelected = selected === item;
          const canSelect = Boolean(String(item || "").trim());

          return (
            <div
              key={`topic-${index}`}
              className={`rounded-md border p-3 transition ${
                isSelected ? "border-moss bg-moss/10" : "border-line bg-paper"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-2 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-xs font-bold text-moss">
                  {isSelected ? <Check size={13} aria-hidden="true" /> : index + 1}
                </span>
                <textarea
                  value={item}
                  onChange={(event) => onChange(index, event.target.value)}
                  rows={2}
                  className="focus-ring min-h-16 flex-1 rounded-md border border-line bg-white p-3 text-sm font-semibold leading-6"
                  placeholder="예: 건조한 피부에 수분크림을 고를 때 확인한 기준"
                />
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  disabled={!canSelect}
                  className={`focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:bg-ink/20 ${
                    isSelected
                      ? "bg-moss text-white"
                      : "border border-line bg-white text-ink/60 hover:border-moss hover:text-moss"
                  }`}
                >
                  {isSelected ? "선택됨" : "이 방향 선택"}
                </button>
              </div>
            </div>
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

function TitleCandidateList({ items, selected, emptyText, onSelect }) {
  const [showAll, setShowAll] = useState(false);
  const primaryIndexes = getPrimaryTitleIndexes(items);
  const hiddenIndexes = items
    .map((_, index) => index)
    .filter((index) => !primaryIndexes.includes(index));
  const displayIndexes = showAll ? [...primaryIndexes, ...hiddenIndexes] : primaryIndexes;

  useEffect(() => {
    setShowAll(false);
  }, [items]);

  return (
    <div>
      <SelectableList
        items={displayIndexes.map((index) => items[index])}
        selected={selected}
        itemTypes={displayIndexes.map((index) => TITLE_TYPES[index] || "미분류")}
        itemLabels={displayIndexes.map((index) => TITLE_CANDIDATE_LABELS[index] || "제목 후보")}
        emptyText={emptyText}
        onSelect={onSelect}
      />

      {hiddenIndexes.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="focus-ring mt-2 inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold text-ink/60 transition hover:border-moss hover:text-moss"
        >
          <ChevronDown
            size={14}
            className={showAll ? "rotate-180 transition" : "transition"}
            aria-hidden="true"
          />
          {showAll ? "제목 접기" : "제목 더 보기"}
        </button>
      )}
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
              key={`${index}-${item}`}
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

function OutlineEditor({ items, selectedCount, emptyText, onChange, onAdd, onDelete, onMove }) {
  const isValid = selectedCount >= OUTLINE_MIN && selectedCount <= OUTLINE_MAX;
  const canAdd = items.length > 0 && items.length < OUTLINE_MAX;

  return (
    <div className="mt-2">
      {items.length > 0 && (
        <div className="mb-2 flex flex-col gap-2 rounded-md border border-line bg-paper px-3 py-2 text-xs font-semibold text-ink/60 sm:flex-row sm:items-center sm:justify-between">
          <p>
            선택된 항목 {selectedCount}개 / 권장 {OUTLINE_MIN}~{OUTLINE_MAX}개
            {!isValid && (
              <span className="ml-2 text-coral">
                본문 생성 전 {OUTLINE_MIN}~{OUTLINE_MAX}개로 맞춰주세요.
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={onAdd}
            disabled={!canAdd}
            className="focus-ring inline-flex min-h-8 items-center justify-center gap-1 rounded-md bg-white px-2.5 text-xs font-bold text-moss transition hover:bg-moss hover:text-white disabled:cursor-not-allowed disabled:text-ink/30"
          >
            <Plus size={14} aria-hidden="true" />
            항목 추가
          </button>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item, index) => {
          const isSelected = item.selected !== false;
          const toggleDisabled = isSelected && selectedCount <= OUTLINE_MIN;
          const deleteDisabled = items.length <= OUTLINE_MIN || (isSelected && selectedCount <= OUTLINE_MIN);

          return (
            <div
              key={item.id}
              className={`rounded-md border p-3 ${
                isSelected ? "border-moss bg-moss/10" : "border-line bg-paper"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <label className="flex min-h-10 items-center gap-2 text-xs font-bold text-ink/60 sm:w-16">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={toggleDisabled}
                    onChange={(event) => onChange(item.id, "selected", event.target.checked)}
                    className="h-4 w-4 accent-[#52796f] disabled:opacity-40"
                  />
                  {index + 1}
                </label>
                <input
                  value={item.heading}
                  onChange={(event) => onChange(item.id, "heading", event.target.value)}
                  className="focus-ring min-h-10 flex-1 rounded-md border border-line bg-white px-3 text-sm font-semibold"
                  placeholder={`항목 ${index + 1}`}
                />
                <div className="grid grid-cols-2 gap-1 sm:w-20">
                  <button
                    type="button"
                    onClick={() => onMove(item.id, -1)}
                    disabled={index === 0}
                    className="focus-ring inline-flex min-h-10 items-center justify-center rounded-md border border-line bg-white text-ink/55 transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/25"
                    aria-label="항목 위로 이동"
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(item.id, 1)}
                    disabled={index === items.length - 1}
                    className="focus-ring inline-flex min-h-10 items-center justify-center rounded-md border border-line bg-white text-ink/55 transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/25"
                    aria-label="항목 아래로 이동"
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  disabled={deleteDisabled}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold text-ink/55 transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:text-ink/30 sm:w-20"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  삭제
                </button>
              </div>
              <label className="mt-2 block">
                <span className="flex flex-wrap items-center gap-2 text-xs font-bold text-ink/55">
                  추가 메모
                  <span className="rounded-md bg-white px-2 py-0.5 text-[11px] text-ink/45">
                    선택 입력
                  </span>
                </span>
                <textarea
                  value={item.note || ""}
                  onChange={(event) => onChange(item.id, "note", event.target.value)}
                  rows={2}
                  className="focus-ring mt-1 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                  placeholder="예: 발림감은 좋았지만 향은 조금 강했어요."
                />
              </label>
              <p className="mt-1 text-xs leading-5 text-ink/50">
                이 부분에 꼭 넣고 싶은 내용을 적어주세요. 안 적어도 괜찮아요.
              </p>
            </div>
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

function ImageSuggestionList({ items = [], editing, onChange }) {
  const [copiedImageField, setCopiedImageField] = useState("");

  const copyImageText = async (id, field, value) => {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) return;

    const copyId = `${id}:${field}`;
    await navigator.clipboard.writeText(normalizedValue);
    setCopiedImageField(copyId);
    window.setTimeout(() => setCopiedImageField((currentId) => (currentId === copyId ? "" : currentId)), 1600);
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Image size={17} className="text-moss" aria-hidden="true" />
        <h5 className="text-sm font-bold text-ink/70">4. 사진 배치 가이드</h5>
      </div>
      <p className="mt-2 rounded-md border border-moss/20 bg-moss/10 px-3 py-2 text-sm leading-6 text-ink/70">
        본문 흐름에 맞춰 사진을 넣기 좋은 위치를 정리했습니다. 직접 촬영하거나 참고 이미지를 준비할 때 활용해보세요.
      </p>
      <div className="mt-3 grid gap-2">
        {items.map((item) => {
          const imageUrl =
            item.previewUrl || item.imageSearch?.thumbnailUrl || item.imageSearch?.imageUrl || "";
          const searchKeyword = item.searchKeyword || item.query || item.imageSearch?.query || "";
          const pexelsQuery = item.query || item.imageSearch?.query || searchKeyword;
          const displayKeyword = searchKeyword || pexelsQuery;
          const promptCopied = copiedImageField === `${item.id}:prompt`;
          const keywordCopied = copiedImageField === `${item.id}:keyword`;

          return (
            <div key={item.id} className="rounded-md border border-line bg-paper p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-bold text-moss">{item.label}</p>
                <p className="text-sm font-bold text-ink/75">{item.title}</p>
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
                    <span>직접 촬영 추천: {item.directShotGuide || item.description}</span>
                  </div>
                )}
              </div>

              {editing ? (
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="text-xs font-bold text-ink/55">카드 제목</span>
                    <input
                      value={item.title}
                      onChange={(event) => onChange(item.id, "title", event.target.value)}
                      className="focus-ring mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-ink/55">이미지 추천 위치</span>
                    <input
                      value={item.insertAfter}
                      onChange={(event) => onChange(item.id, "insertAfter", event.target.value)}
                      className="focus-ring mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-ink/55">이미지 컨셉</span>
                    <textarea
                      value={item.description}
                      onChange={(event) => onChange(item.id, "description", event.target.value)}
                      rows={2}
                      className="focus-ring mt-1 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-ink/55">직접 촬영 추천</span>
                    <textarea
                      value={item.directShotGuide || ""}
                      onChange={(event) => onChange(item.id, "directShotGuide", event.target.value)}
                      rows={2}
                      className="focus-ring mt-1 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-ink/55">AI 이미지 프롬프트</span>
                    <textarea
                      value={item.aiPrompt || ""}
                      onChange={(event) => onChange(item.id, "aiPrompt", event.target.value)}
                      rows={2}
                      className="focus-ring mt-1 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-ink/55">이미지 사이트 검색어</span>
                    <input
                      value={searchKeyword}
                      onChange={(event) => onChange(item.id, "searchKeyword", event.target.value)}
                      className="focus-ring mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm"
                      placeholder="이미지 사이트 검색어"
                    />
                  </label>
                </div>
              ) : (
                <dl className="mt-3 grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-bold text-ink/50">이미지 컨셉</dt>
                    <dd className="mt-1 leading-6 text-ink/70">{item.description}</dd>
                  </div>
                  <div className="rounded-md border border-moss/20 bg-white p-3">
                    <dt className="text-xs font-bold text-moss">직접 촬영 추천</dt>
                    <dd className="mt-1 leading-6 text-ink/70">{item.directShotGuide || item.description}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-ink/50">본문 삽입 위치</dt>
                    <dd className="mt-1 font-semibold text-ink/75">
                      본문에 표시된 [여기에 이미지 {items.indexOf(item) + 1}을 넣어주세요] 위치에 넣어주세요.
                    </dd>
                  </div>
                  <div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <dt className="text-xs font-bold text-ink/50">AI 이미지 프롬프트</dt>
                      <button
                        type="button"
                        onClick={() => copyImageText(item.id, "prompt", item.aiPrompt)}
                        disabled={!item.aiPrompt}
                        className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold text-ink/60 transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:opacity-45 sm:w-32"
                      >
                        {promptCopied ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
                        {promptCopied ? "복사됨" : "프롬프트 복사"}
                      </button>
                    </div>
                    <dd className="mt-1 break-words rounded-md border border-line bg-white px-3 py-2 leading-6 text-ink/70">
                      {item.aiPrompt}
                      <span className="mt-1 block text-xs font-semibold text-ink/45">
                        티스토리, SNS, 참고 이미지 제작용으로 활용하세요.
                      </span>
                    </dd>
                  </div>
                  <div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <dt className="text-xs font-bold text-ink/50">이미지 사이트 검색어</dt>
                      <button
                        type="button"
                        onClick={() => copyImageText(item.id, "keyword", displayKeyword)}
                        disabled={!displayKeyword}
                        className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-3 text-xs font-bold text-ink/60 transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:opacity-45 sm:w-28"
                      >
                        {keywordCopied ? <Check size={14} aria-hidden="true" /> : <Clipboard size={14} aria-hidden="true" />}
                        {keywordCopied ? "복사됨" : "검색어 복사"}
                      </button>
                    </div>
                    <dd className="mt-1 break-words rounded-md border border-line bg-white px-3 py-2 font-semibold text-ink/75">
                      {displayKeyword}
                      {pexelsQuery && pexelsQuery !== searchKeyword ? (
                        <span className="block pt-1 text-xs font-semibold text-ink/45">보조 검색어: {pexelsQuery}</span>
                      ) : null}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
