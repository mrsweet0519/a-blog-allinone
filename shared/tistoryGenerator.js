const text = (value) => String(value ?? "").trim();

const compact = (value) => text(value).replace(/\s+/g, "");

const unique = (items = []) =>
  Array.from(new Set(items.map((item) => text(item)).filter(Boolean)));

const splitKeywords = (value = "") =>
  unique(
    String(value || "")
      .split(/[,，\n]/u)
      .map((item) => item.trim())
  ).slice(0, 5);

const splitMemoSentences = (value = "") =>
  unique(
    String(value || "")
      .replace(/\r/g, "")
      .split(/(?<=[.!?。]|요\.|다\.)\s+|\n+/u)
      .map((item) => item.replace(/\s+/g, " ").trim())
  ).slice(0, 6);

const ensureSentence = (value = "") => {
  const sentence = text(value).replace(/[.。]+$/u, "");
  if (!sentence) return "";
  return /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`;
};

const toHashTag = (value = "") => {
  const tag = compact(value).replace(/[^\p{L}\p{N}_]/gu, "");
  return tag ? `#${tag}` : "";
};

const getMainKeyword = (form = {}) => splitKeywords(form.keyword || form.topic)[0] || text(form.keyword || form.topic);

const createTitle = (keyword = "") => {
  if (/법|방법|가이드|쓰는\s*법|하는\s*법/u.test(keyword)) {
    return `${keyword}, 처음 시작할 때 바로 쓰는 쉬운 기준`;
  }

  if (/추천|비교|선택/u.test(keyword)) {
    return `${keyword} 전 확인하면 좋은 비교 기준`;
  }

  return `${keyword} 핵심 정리와 바로 적용하는 방법`;
};

const inferAudienceCue = (keyword = "") => {
  if (/초등|아이|어린이|학생|부모/u.test(keyword)) {
    return "아이와 부모가 부담 없이 이어갈 수 있는 방식";
  }

  if (/사업|창업|마케팅|블로그|티스토리/u.test(keyword)) {
    return "처음 운영하는 사람도 순서대로 따라가기 쉬운 방식";
  }

  if (/건강|피부|운동|관리/u.test(keyword)) {
    return "내 상황에 맞는 기준을 먼저 확인하는 방식";
  }

  return "처음 보는 사람도 흐름을 이해하기 쉬운 방식";
};

const createIntroSummary = (keyword = "", memoSentences = []) => {
  const memoCue = memoSentences[0]
    ? `${memoSentences[0].replace(/[.。]+$/u, "")}라는 상황이라면 처음부터 거창하게 시작하기보다 작은 기록부터 만드는 편이 좋습니다.`
    : `${keyword}를 찾는 분이라면 개념 설명보다 바로 적용할 수 있는 순서가 먼저 필요합니다.`;

  return [
    ensureSentence(memoCue),
    ensureSentence(`${keyword}의 핵심은 ${inferAudienceCue(keyword)}으로 정리할 수 있습니다`),
    ensureSentence("아래에서는 준비할 것, 실제 순서, 자주 막히는 지점, FAQ까지 한 번에 확인할 수 있게 정리했습니다")
  ];
};

const createOutline = (keyword = "") => {
  if (/초등|독서|노트|책/u.test(keyword)) {
    return [
      "초등 독서노트가 부담스러워지는 이유",
      "시작 전에 정하면 좋은 기록 기준",
      "3문장으로 끝내는 독서노트 작성 순서",
      "학년별로 다르게 도와주는 방법",
      "꾸준히 이어가기 위한 부모의 역할",
      "자주 하는 실수와 해결 방법"
    ];
  }

  if (/비교|추천|선택/u.test(keyword)) {
    return [
      "먼저 비교해야 할 핵심 기준",
      "상황별로 달라지는 선택 포인트",
      "장점과 아쉬운 점을 나누는 방법",
      "결정 전 확인하면 좋은 체크리스트",
      "처음 선택하는 사람을 위한 정리"
    ];
  }

  return [
    `${keyword}를 먼저 이해해야 하는 이유`,
    "시작 전에 확인할 기본 기준",
    "실제로 적용하는 순서",
    "중간에 자주 막히는 부분",
    "마지막으로 확인할 체크리스트"
  ];
};

const createSectionParagraphs = (heading = "", keyword = "", memoSentences = [], index = 0) => {
  const memo = memoSentences[index % Math.max(1, memoSentences.length)] || "";
  const baseMemo = memo ? memo.replace(/[.。]+$/u, "") : "";
  const audienceCue = inferAudienceCue(keyword);

  const templates = [
    [
      `${keyword}를 처음 시작할 때 가장 많이 막히는 부분은 방법 자체보다 기준이 너무 크다는 점입니다.`,
      `${audienceCue}으로 접근하면 부담이 줄고, 결과도 더 오래 남기 쉽습니다.`
    ],
    [
      baseMemo
        ? `${baseMemo}라면 처음부터 긴 글을 요구하기보다 최소 기준을 정하는 것이 좋습니다.`
        : "시작 전에는 시간, 분량, 반복 주기를 먼저 정해두는 것이 좋습니다.",
      "기준이 간단해야 다시 이어가기 쉽고, 중간에 빠뜨려도 다시 돌아오기 편합니다."
    ],
    [
      "실행 순서는 짧을수록 좋습니다. 먼저 핵심 내용을 한 줄로 적고, 인상 깊은 장면을 하나 고른 뒤, 내 생각을 한 문장으로 붙이면 됩니다.",
      `${keyword}는 완성도보다 반복 가능한 흐름을 만드는 것이 더 중요합니다.`
    ],
    [
      "처음에는 결과를 평가하기보다 어떤 부분에서 막히는지 보는 편이 좋습니다.",
      "필요하다면 질문을 하나만 던지고, 답을 짧게 적게 하는 방식으로 난이도를 낮출 수 있습니다."
    ],
    [
      "꾸준히 이어가려면 결과물을 고쳐주는 시간보다 다시 시도할 수 있게 만드는 반응이 중요합니다.",
      "짧게라도 기록이 남으면 다음 기록으로 이어지는 단서가 생깁니다."
    ],
    [
      "가장 흔한 실수는 처음부터 형식을 너무 많이 정하는 것입니다.",
      "형식은 나중에 늘려도 되니, 처음에는 날짜, 제목, 한 줄 생각처럼 꼭 필요한 항목만 남겨도 충분합니다."
    ]
  ];

  return templates[index] || templates.at(-1);
};

const createKeyTakeaways = (keyword = "") => [
  `${keyword}는 처음부터 길게 쓰는 것보다 반복 가능한 기준을 만드는 것이 먼저입니다.`,
  "확인되지 않은 정보나 상황에 따라 달라질 수 있는 내용은 [확인 필요]로 남겨두는 편이 안전합니다.",
  "글을 발행하기 전에는 제목, 목차, FAQ, 태그가 검색 의도와 맞는지 한 번 더 확인하면 좋습니다."
];

const createFaq = (keyword = "") => [
  {
    question: `${keyword}는 처음에 얼마나 길게 쓰는 게 좋나요?`,
    answer: "처음에는 짧게 시작하는 편이 좋습니다. 한 번에 길게 쓰려고 하면 부담이 커져서 이어가기 어렵습니다."
  },
  {
    question: "매번 같은 형식으로 써야 하나요?",
    answer: "기본 형식은 유지하되 상황에 따라 질문을 바꿔도 됩니다. 중요한 것은 다시 쓸 수 있는 흐름을 만드는 것입니다."
  },
  {
    question: "사진이나 참고 자료가 꼭 필요한가요?",
    answer: "필수는 아닙니다. 다만 사진이나 예시가 있으면 글의 이해도가 높아지고 티스토리 본문 구성도 더 탄탄해집니다."
  }
];

const createTags = (keyword = "", keywords = []) =>
  unique([
    toHashTag(keyword),
    ...keywords.map(toHashTag),
    "#티스토리글쓰기",
    "#정보글",
    "#검색형포스팅",
    "#블로그초안",
    "#글쓰기팁"
  ]).slice(0, 10);

const createBodyText = ({ title, introSummary, toc, sections, keyTakeaways, faq, tags }) =>
  [
    title,
    "",
    "도입 요약",
    ...introSummary,
    "",
    "목차",
    ...toc.map((item, index) => `${index + 1}. ${item}`),
    "",
    ...sections.flatMap((section, index) => [
      `${index + 1}. ${section.heading}`,
      ...section.paragraphs,
      ""
    ]),
    "핵심 정리",
    ...keyTakeaways.map((item) => `- ${item}`),
    "",
    "FAQ",
    ...faq.flatMap((item) => [`Q. ${item.question}`, `A. ${item.answer}`, ""]),
    "태그",
    tags.join(" ")
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function createTistoryDraft(form = {}) {
  const keyword = getMainKeyword(form);
  const keywords = splitKeywords(form.keyword || form.topic);
  const memoSentences = splitMemoSentences(form.memo || form.referenceMemo);
  const title = createTitle(keyword);
  const introSummary = createIntroSummary(keyword, memoSentences);
  const toc = createOutline(keyword).slice(0, 6);
  const sections = toc.map((heading, index) => ({
    id: `section-${index + 1}`,
    heading,
    paragraphs: createSectionParagraphs(heading, keyword, memoSentences, index)
  }));
  const keyTakeaways = createKeyTakeaways(keyword);
  const faq = createFaq(keyword);
  const tags = createTags(keyword, keywords);

  return {
    title,
    introSummary,
    toc,
    sections,
    keyTakeaways,
    faq,
    tags,
    body: createBodyText({ title, introSummary, toc, sections, keyTakeaways, faq, tags })
  };
}
