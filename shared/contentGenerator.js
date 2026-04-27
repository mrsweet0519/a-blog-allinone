const DEFAULT_TARGET_LENGTH = 1500;

const INTERNAL_KEYWORD_OPTIMIZATION = {
  adminOnly: true,
  targetRanges: [
    { maxLength: 1300, min: 4, max: 7 },
    { maxLength: 1700, min: 5, max: 9 },
    { maxLength: 2200, min: 6, max: 10 },
    { maxLength: 5000, min: 8, max: 12 }
  ],
  placementHints: ["도입부", "핵심 포인트", "구체 상황", "마무리"]
};

const GOAL_LABELS = {
  "정보 전달": "정보 전달형",
  "신뢰 형성": "신뢰 형성형",
  "상품 홍보": "상품 홍보형",
  "방문 유도": "방문 유도형"
};

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const text = (value) => String(value ?? "").trim();

const splitAvoidWords = (avoid) =>
  text(avoid)
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

const splitList = (value) =>
  text(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

const applyAvoidWords = (value, avoidWords) =>
  avoidWords.reduce((result, word) => result.replaceAll(word, "해당 표현"), value);

const uniqueHashTags = (items) =>
  Array.from(new Set(items.filter(Boolean)))
    .slice(0, 10)
    .map((tag) => `#${tag}`);

const countKeywordOccurrences = (value, keyword) => {
  if (!keyword) return 0;

  return String(value).split(keyword).length - 1;
};

const resolveKeywordOccurrenceRange = (targetLength) =>
  INTERNAL_KEYWORD_OPTIMIZATION.targetRanges.find((range) => targetLength <= range.maxLength) ??
  INTERNAL_KEYWORD_OPTIMIZATION.targetRanges.at(-1);

const createKeywordVariants = (keyword, category) =>
  Array.from(
    new Set([
      `${keyword} 선택 기준`,
      `${keyword} 활용 포인트`,
      `${keyword} 체크리스트`,
      `${category} 고객 관점`,
      "고객 판단 기준",
      "실전 체크포인트",
      "방문 전 확인 포인트"
    ].filter(Boolean))
  );

const getBrandLabel = (form) => text(form.brandName) || text(form.category) || "이곳";

const getRegionPhrase = (form) => {
  const region = text(form.region);
  return region ? `${region}에서 ` : "";
};

const getStrengths = (form) => {
  const strengths = splitList(form.strengths);
  return strengths.length > 0 ? strengths : ["꼼꼼한 안내", "상황에 맞춘 제안", "편안한 상담"];
};

const getEmphasis = (form) => text(form.emphasisPoint) || "처음 알아보는 분도 쉽게 판단할 수 있는 설명";

const getCta = (form) =>
  text(form.ctaDirection) ||
  (form.goal === "방문 유도" ? "방문 전 궁금한 점을 편하게 확인해보세요." : "필요한 부분을 천천히 비교해보세요.");

const createHumanList = (items) => {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]}, ${items[1]}`;

  return `${items[0]}, ${items[1]}, ${items[2]}`;
};

export function resolveTargetLength(form = {}) {
  const rawValue =
    form.targetLengthOption === "custom" ? form.customTargetLength : form.targetLengthOption;
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed)) return DEFAULT_TARGET_LENGTH;

  return Math.min(Math.max(parsed, 600), 5000);
}

export function getTargetLengthRange(form = {}) {
  const target = resolveTargetLength(form);

  return {
    target,
    min: Math.round(target * 0.9),
    max: Math.round(target * 1.1)
  };
}

export function createKeywordOptimizationPlan(form = {}) {
  const keyword = text(form.keyword);
  const category = text(form.category);
  const targetLength = resolveTargetLength(form);
  const targetOccurrences = resolveKeywordOccurrenceRange(targetLength);

  return {
    adminOnly: INTERNAL_KEYWORD_OPTIMIZATION.adminOnly,
    mainKeyword: keyword,
    targetLength,
    targetOccurrences: {
      min: targetOccurrences.min,
      max: targetOccurrences.max
    },
    relatedExpressions: createKeywordVariants(keyword, category),
    semanticExpressions: ["선택 기준", "활용 포인트", "실전 체크포인트", "고객 판단 기준"],
    placementHints: INTERNAL_KEYWORD_OPTIMIZATION.placementHints
  };
}

export function createTopicRecommendations(form) {
  const keyword = text(form.keyword);
  const category = text(form.category);
  const goal = text(form.goal);
  const brand = getBrandLabel(form);
  const region = getRegionPhrase(form);
  const avoidWords = splitAvoidWords(form.avoid);

  const topicsByGoal = {
    "정보 전달": [
      `${keyword}를 처음 알아보는 분들이 놓치기 쉬운 선택 포인트`,
      `${region}${keyword}를 비교할 때 먼저 확인하면 좋은 것들`,
      `${category} 고객이 자주 궁금해하는 ${keyword} 활용 팁`
    ],
    "신뢰 형성": [
      `${brand}가 ${keyword}를 꼼꼼하게 안내하는 방식`,
      `${keyword} 선택 전 신뢰할 수 있는 곳을 알아보는 방법`,
      `${region}${category} 고객이 안심하고 문의하는 이유`
    ],
    "상품 홍보": [
      `${keyword}를 찾는 분들이 ${brand}를 살펴보는 이유`,
      `${brand}의 ${keyword} 강점을 자연스럽게 보여주는 이야기`,
      `${category} 고객에게 필요한 ${keyword} 혜택과 활용 장면`
    ],
    "방문 유도": [
      `${region}${keyword}를 찾는 분들이 방문 전 확인하면 좋은 것들`,
      `${brand} 방문 전에 알아두면 편한 ${keyword} 안내`,
      `${category} 고객이 부담 없이 들를 수 있는 ${keyword} 이야기`
    ]
  };

  return (topicsByGoal[goal] ?? topicsByGoal["정보 전달"]).map((topic) =>
    applyAvoidWords(topic, avoidWords)
  );
}

export function createTitleCandidates(form, selectedTopic) {
  const keyword = text(form.keyword);
  const goal = text(form.goal);
  const brand = getBrandLabel(form);
  const region = getRegionPhrase(form);
  const avoidWords = splitAvoidWords(form.avoid);

  const titlesByGoal = {
    "정보 전달": [
      `${keyword} 선택 전 알아두면 좋은 핵심 포인트`,
      `${selectedTopic}`,
      `${keyword}, 처음 알아보는 분들을 위한 쉬운 안내`
    ],
    "신뢰 형성": [
      `${brand}가 ${keyword}를 꼼꼼히 안내하는 이유`,
      `${keyword} 맡기기 전 확인하면 좋은 신뢰 포인트`,
      `${selectedTopic}`
    ],
    "상품 홍보": [
      `${keyword}, 이런 점이 달라서 선택받습니다`,
      `${brand}의 ${keyword} 장점을 한눈에 살펴보기`,
      `${selectedTopic}`
    ],
    "방문 유도": [
      `${region}${keyword} 찾는다면 방문 전 확인해보세요`,
      `${brand} 방문 전에 알아두면 좋은 ${keyword} 안내`,
      `${selectedTopic}`
    ]
  };

  return (titlesByGoal[goal] ?? titlesByGoal["정보 전달"]).map((title) =>
    applyAvoidWords(title, avoidWords)
  );
}

export function createImageSuggestions(form, selectedTopic, selectedTitle) {
  const keyword = text(form.keyword);
  const brand = getBrandLabel(form);
  const strengths = getStrengths(form);
  const avoidWords = splitAvoidWords(form.avoid);

  const suggestions = [
    {
      id: "image-slot-1",
      label: "이미지 추천 1",
      title: "대표 이미지",
      insertAfter: "도입부 다음",
      description: `${brand}의 분위기나 ${keyword} 대표 장면이 한눈에 보이는 이미지`,
      bridge: {
        type: "blog-body-image",
        slot: "opening-visual",
        status: "placeholder",
        context: {
          mainKeyword: keyword,
          selectedTopic,
          selectedTitle
        }
      }
    },
    {
      id: "image-slot-2",
      label: "이미지 추천 2",
      title: "사용 장면",
      insertAfter: "핵심 포인트 설명 뒤",
      description: `${strengths[0]}이 실제로 느껴지는 사용 장면 또는 상담 장면`,
      bridge: {
        type: "blog-body-image",
        slot: "usage-scene",
        status: "placeholder",
        context: {
          mainKeyword: keyword,
          selectedTopic,
          selectedTitle
        }
      }
    },
    {
      id: "image-slot-3",
      label: "이미지 추천 3",
      title: "비교컷",
      insertAfter: "마무리 전",
      description: "전후 비교, 체크리스트, 구성 비교처럼 판단을 도와주는 이미지",
      bridge: {
        type: "blog-body-image",
        slot: "comparison",
        status: "placeholder",
        context: {
          mainKeyword: keyword,
          selectedTopic,
          selectedTitle
        }
      }
    }
  ];

  return suggestions.map((item) => ({
    ...item,
    title: applyAvoidWords(item.title, avoidWords),
    description: applyAvoidWords(item.description, avoidWords)
  }));
}

const createGoalBlocks = (form, selectedTopic, selectedTitle) => {
  const keyword = text(form.keyword);
  const category = text(form.category);
  const goal = text(form.goal);
  const brand = getBrandLabel(form);
  const region = getRegionPhrase(form);
  const strengths = getStrengths(form);
  const strengthText = createHumanList(strengths);
  const emphasis = getEmphasis(form);
  const cta = getCta(form);

  const sharedDetails = [
    `${keyword}를 고를 때는 가격이나 설명 한 줄만 보고 결정하기보다 실제로 내 상황에 맞는지 살펴보는 것이 좋습니다. 특히 ${category}에서는 작은 차이가 이용 만족도로 이어질 수 있어 처음 비교할 때부터 기준을 분명히 잡아두면 도움이 됩니다.`,
    `${brand}에서는 ${strengthText}을 중요하게 봅니다. 거창한 말보다 실제로 확인할 수 있는 부분을 차분히 보여드리는 편이 더 오래 기억에 남기 때문입니다.`,
    `${emphasis}도 함께 살펴보면 좋습니다. 같은 ${keyword}라도 어떤 부분을 먼저 보는지에 따라 만족도가 달라질 수 있습니다.`,
    `궁금한 점이 있다면 방문이나 상담 전에 미리 확인해보는 것도 좋습니다. 필요한 내용을 알고 움직이면 시간도 줄고, 나에게 맞는 선택인지 판단하기가 훨씬 편해집니다.`,
    `처음 상담할 때는 너무 완벽하게 준비하지 않아도 괜찮습니다. 지금 어떤 점이 불편한지, 어떤 결과를 기대하는지만 간단히 정리해도 안내를 받는 데 충분합니다.`,
    `사진이나 짧은 설명만으로는 알기 어려운 부분도 있습니다. 그래서 실제 분위기, 응대 방식, 진행 흐름처럼 직접 경험과 가까운 요소를 함께 보는 것이 좋습니다.`,
    `후기를 볼 때도 단순히 좋다는 말보다 어떤 부분에서 만족했는지 살펴보면 도움이 됩니다. 내 상황과 비슷한 사례가 있는지 확인하면 선택이 더 쉬워집니다.`,
    `문의 전에는 원하는 시간, 필요한 조건, 예산이나 우선순위를 가볍게 적어두면 좋습니다. 작은 메모만 있어도 상담이 훨씬 구체적으로 이어집니다.`,
    `비교가 길어질수록 ${keyword}에서 정말 중요한 부분이 흐려질 수 있습니다. 처음에 정한 우선순위를 기준으로 다시 살펴보면 결정이 한결 편해집니다.`,
    `마지막으로 ${keyword}는 설명이 자연스럽고 이해하기 쉬운 곳을 고르는 것이 좋습니다. 이용하는 사람이 편하게 물어볼 수 있어야 이후 과정도 부담이 줄어듭니다.`,
    `특히 일정이나 준비 과정이 필요한 경우라면 미리 확인하는 습관이 중요합니다. 당일에 급하게 결정하는 것보다 여유를 두고 살펴보면 놓치는 부분이 줄어듭니다.`,
    `작은 차이는 실제 이용 순간에 더 크게 느껴질 수 있습니다. 설명을 들을 때는 좋아 보이는 표현보다 내게 필요한 조건과 맞는지에 집중해보세요.`,
    `온라인에서 많은 정보를 본 뒤에는 오히려 결정이 어려워질 때도 있습니다. 그럴수록 가장 불편했던 점, 가장 기대하는 점, 꼭 필요한 조건을 기준으로 좁혀가는 편이 좋습니다.`,
    `${brand}의 안내가 필요한 분이라면 현재 상황을 편하게 이야기해보는 것부터 시작해도 좋습니다. 처음부터 결정을 내려야 한다는 부담 없이 확인하는 과정만으로도 방향이 잡힐 수 있습니다.`,
    `${keyword}를 이미 여러 번 비교해본 분이라면 가격이나 설명보다 실제 응대와 진행 흐름을 더 꼼꼼히 보는 것이 좋습니다. 오래 만족하는 선택은 이런 세부적인 경험에서 갈리는 경우가 많습니다.`,
    `결정 전에는 장점만 보지 말고 나에게 맞지 않을 수 있는 부분도 함께 생각해보세요. 맞지 않는 부분을 미리 알면 선택 후 아쉬움을 줄일 수 있습니다.`,
    `이런 기준으로 살펴보면 정보가 많아도 판단이 복잡해지지 않습니다. 나에게 필요한 것과 그렇지 않은 것을 구분할 수 있기 때문입니다.`,
    `${keyword}를 선택하는 과정이 어렵게 느껴진다면 혼자 오래 고민하기보다 필요한 부분만 먼저 물어보는 것도 좋은 방법입니다. 짧은 확인만으로도 다음 선택이 훨씬 쉬워집니다.`,
    `결국 좋은 선택은 내 상황을 잘 이해하고 무리 없이 이어갈 수 있는 방향을 찾는 데서 시작됩니다. 처음부터 완벽한 답을 찾기보다 하나씩 확인해보면 충분합니다.`
  ];

  const templates = {
    "정보 전달": {
      opening: [
        `${form.useEmoji ? "✨ " : ""}${selectedTitle}`,
        "",
        `${keyword}를 처음 알아볼 때 가장 헷갈리는 부분은 무엇을 먼저 봐야 하는지입니다. 설명은 많은데 막상 내 상황에 맞는 정보만 골라보려면 생각보다 시간이 걸립니다.`,
        `${region}${keyword}를 비교하고 있다면 몇 가지 포인트만 먼저 확인해도 선택이 훨씬 쉬워집니다.`
      ],
      body: [
        `먼저 확인할 부분은 이용 목적입니다. 단순히 좋아 보이는 선택보다 내가 해결하고 싶은 불편이 무엇인지 생각해보면 ${keyword}를 보는 기준이 분명해집니다.`,
        `두 번째는 실제 사용 장면입니다. 사진이나 설명만 볼 때보다 어떤 상황에서 도움이 되는지 떠올려보면 나에게 필요한지 판단하기 쉽습니다.`,
        `세 번째는 관리와 사후 안내입니다. 처음에는 작은 차이처럼 보여도 이후에 문의하거나 다시 이용할 때는 응대 방식과 안내가 만족도에 큰 영향을 줍니다.`,
        ...sharedDetails
      ],
      closing: `${keyword}는 한 번에 결정하기보다 내 상황과 필요한 기준을 맞춰보는 과정이 중요합니다. 위 포인트를 차근차근 비교해보면 훨씬 편하게 선택할 수 있습니다. ${cta}`
    },
    "신뢰 형성": {
      opening: [
        `${form.useEmoji ? "✨ " : ""}${selectedTitle}`,
        "",
        `${keyword}를 알아볼 때 가장 먼저 드는 생각은 "여기 믿어도 괜찮을까?"일 때가 많습니다. 설명이 좋아 보여도 실제로 꼼꼼하게 안내받을 수 있는지는 직접 확인해봐야 안심이 됩니다.`,
        `${brand}는 ${keyword}를 찾는 분들이 불안한 부분을 줄일 수 있도록 처음 문의부터 차분한 안내를 중요하게 생각합니다.`
      ],
      body: [
        `신뢰는 큰 약속보다 작은 과정에서 만들어집니다. 필요한 내용을 쉽게 설명하고, 가능한 부분과 어려운 부분을 분명히 알려드리는 것이 먼저입니다.`,
        `${brand}에서 특히 신경 쓰는 부분은 ${strengthText}입니다. 고객 입장에서는 이런 디테일이 쌓일수록 선택에 대한 부담이 줄어듭니다.`,
        `${keyword}를 진행하기 전에는 궁금한 점을 충분히 물어보는 것이 좋습니다. 답변이 명확하고 내 상황을 잘 들어주는 곳인지 확인하면 이후 과정도 훨씬 편안합니다.`,
        ...sharedDetails
      ],
      closing: `${keyword}는 결과만큼 과정도 중요합니다. 충분히 묻고 확인한 뒤 선택하면 불필요한 걱정을 줄일 수 있습니다. ${brand}가 궁금하다면 편하게 문의해보세요. ${cta}`
    },
    "상품 홍보": {
      opening: [
        `${form.useEmoji ? "✨ " : ""}${selectedTitle}`,
        "",
        `${keyword}를 찾는 분들이 많아진 만큼 선택지도 다양해졌습니다. 그럴수록 단순히 눈에 띄는 설명보다 실제로 어떤 점이 나에게 맞는지 보는 것이 중요합니다.`,
        `${brand}의 ${keyword}는 ${strengthText}을 중심으로 살펴보면 장점이 더 분명하게 보입니다.`
      ],
      body: [
        `첫 번째 장점은 이용하는 사람이 이해하기 쉬운 흐름입니다. 복잡하게 느껴지는 부분도 필요한 내용부터 차근차근 확인할 수 있어 처음 접하는 분도 부담을 줄일 수 있습니다.`,
        `두 번째는 상황에 맞춘 선택입니다. 모두에게 같은 설명을 하는 것보다 고객이 원하는 방향과 조건을 함께 보고 제안하는 방식이 만족도를 높입니다.`,
        `세 번째는 ${emphasis}입니다. 이 부분은 ${keyword}를 비교하는 분들이 실제로 많이 확인하는 요소이기도 합니다.`,
        ...sharedDetails
      ],
      closing: `${keyword}를 고민하고 있다면 장점이 내 상황과 맞는지 확인해보는 것부터 시작해보세요. ${brand}의 안내가 필요한 분이라면 지금 편하게 살펴보셔도 좋습니다. ${cta}`
    },
    "방문 유도": {
      opening: [
        `${form.useEmoji ? "✨ " : ""}${selectedTitle}`,
        "",
        `${region}${keyword}를 찾다 보면 어디를 방문해야 할지 쉽게 정하기 어렵습니다. 위치가 가까운지도 중요하지만, 막상 방문했을 때 원하는 안내를 받을 수 있는지도 함께 봐야 합니다.`,
        `${brand}를 방문하기 전에는 몇 가지만 확인해도 훨씬 편하게 움직일 수 있습니다.`
      ],
      body: [
        `먼저 방문 목적을 가볍게 정리해보세요. 상담을 받고 싶은지, 직접 보고 싶은지, 비교 후 결정하고 싶은지에 따라 필요한 안내가 달라집니다.`,
        `다음으로 확인할 부분은 운영 방식과 응대입니다. ${keyword}를 알아보는 과정에서 궁금한 점을 편하게 물어볼 수 있는 분위기라면 방문 후 만족도도 높아집니다.`,
        `${brand}에서는 ${strengthText}을 바탕으로 방문하신 분들이 필요한 내용을 빠르게 확인할 수 있도록 돕고 있습니다.`,
        ...sharedDetails
      ],
      closing: `${region}${keyword}를 알아보고 있다면 혼자 오래 고민하기보다 필요한 내용을 먼저 확인해보세요. 방문 전 문의만으로도 방향이 잡히는 경우가 많습니다. ${cta}`
    }
  };

  return templates[goal] ?? templates["정보 전달"];
};

const buildPostBody = (form, selectedTopic, selectedTitle) => {
  const range = getTargetLengthRange(form);
  const template = createGoalBlocks(form, selectedTopic, selectedTitle);
  const parts = [...template.opening, "", template.body[0], template.body[1], template.body[2]];

  for (const block of template.body.slice(3)) {
    if (parts.join("\n\n").length >= range.min) break;
    parts.push(block);
  }

  parts.push(template.closing);

  return parts.join("\n\n");
};

const createStrategyMemo = (form, selectedTopic, selectedTitle, body, imageSuggestions, keywordOptimization) => ({
  adminOnly: true,
  goalTemplate: GOAL_LABELS[form.goal] ?? "정보 전달형",
  selectedTopic,
  selectedTitle,
  writingDirection: {
    audience: `${getRegionPhrase(form)}${text(form.keyword)}를 알아보는 잠재 고객`,
    coreMessage: getEmphasis(form),
    strengths: getStrengths(form),
    ctaDirection: getCta(form)
  },
  keywordMemo: {
    mainKeyword: keywordOptimization.mainKeyword,
    actualOccurrences: keywordOptimization.actualOccurrences,
    targetOccurrences: keywordOptimization.targetOccurrences,
    relatedExpressions: keywordOptimization.relatedExpressions,
    placementHints: keywordOptimization.placementHints
  },
  imageBridgeMemo: imageSuggestions.map((item) => ({
    id: item.id,
    slot: item.bridge.slot,
    insertAfter: item.insertAfter,
    description: item.description
  })),
  bodyLength: body.length
});

export function createFinalContent(form, selectedTopic, selectedTitle) {
  const keyword = text(form.keyword);
  const category = text(form.category);
  const goal = text(form.goal);
  const tone = text(form.tone);
  const avoidWords = splitAvoidWords(form.avoid);
  const keywordPlan = createKeywordOptimizationPlan(form);
  const imageSuggestions = createImageSuggestions(form, selectedTopic, selectedTitle);
  const postBody = applyAvoidWords(buildPostBody(form, selectedTopic, selectedTitle), avoidWords);
  const keywordOptimization = {
    ...keywordPlan,
    actualOccurrences: countKeywordOccurrences(postBody, keyword)
  };
  const strategyMemo = createStrategyMemo(
    form,
    selectedTopic,
    selectedTitle,
    postBody,
    imageSuggestions,
    keywordOptimization
  );

  const hashtags = uniqueHashTags([
    compact(keyword),
    compact(category),
    compact(goal),
    compact(tone),
    compact(text(form.brandName)),
    compact(text(form.region)),
    "블로그운영",
    "콘텐츠기획",
    "고객후기",
    "방문상담",
    "해시태그",
    "콘텐츠전략"
  ]);

  return {
    body: postBody,
    hashtags,
    imageSuggestions,
    strategyMemo,
    keywordOptimization
  };
}

export function createDraftContent(form) {
  const topics = createTopicRecommendations(form);
  const selectedTopic = form.selectedTopic || topics[0];
  const titles = createTitleCandidates(form, selectedTopic);
  const selectedTitle = form.selectedTitle || titles[0];
  const finalContent = createFinalContent(form, selectedTopic, selectedTitle);

  return {
    topics,
    selectedTopic,
    titles,
    selectedTitle,
    ...finalContent
  };
}
