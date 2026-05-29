const DEFAULT_TARGET_LENGTH = 1500;

const INTERNAL_KEYWORD_OPTIMIZATION = {
  adminOnly: true,
  targetRanges: [
    { maxLength: 1300, min: 5, max: 7 },
    { maxLength: 1700, min: 5, max: 7 },
    { maxLength: 2200, min: 5, max: 7 },
    { maxLength: 5000, min: 5, max: 7 }
  ],
  placementHints: ["첫 문장", "첫 문단", "핵심 기준", "판단 문단", "마무리"]
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

const toHashTag = (value) => {
  const tag = compact(value);

  return tag ? `#${tag}` : "";
};

const text = (value) => String(value ?? "").trim();

const hasFinalConsonant = (value) => {
  const normalized = text(value).replace(/[^\p{L}\p{N}]+$/gu, "");
  const lastChar = Array.from(normalized).at(-1);

  if (!lastChar) return false;

  const code = lastChar.charCodeAt(0);

  if (code < 0xac00 || code > 0xd7a3) return false;

  return (code - 0xac00) % 28 !== 0;
};

const attachParticle = (value, withFinal, withoutFinal) => {
  const phrase = text(value);

  if (!phrase) return "";

  return `${phrase}${hasFinalConsonant(phrase) ? withFinal : withoutFinal}`;
};

const asObject = (value) => attachParticle(value, "을", "를");
const asSubject = (value) => attachParticle(value, "은", "는");
const asActor = (value) => attachParticle(value, "이", "가");

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

const uniqueText = (items = []) =>
  Array.from(new Set(items.map(text).filter(Boolean)));

const splitKeywordInput = (value) =>
  text(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

const BRAND_KEYWORD_HINTS = [
  "코스",
  "랩",
  "몰",
  "샵",
  "클리닉",
  "스튜디오",
  "센터",
  "브랜드",
  "제품",
  "공구",
  "올영"
];

const isBrandLikeKeyword = (keyword, index, total) => {
  const value = text(keyword);
  const lower = value.toLowerCase();

  return (
    index >= 2 ||
    /[a-z]/iu.test(value) ||
    BRAND_KEYWORD_HINTS.some((hint) => lower.includes(hint))
  ) && total > 1;
};

export const parseKeywordInput = (value = "") => {
  const keywords = splitKeywordInput(value);

  if (keywords.length === 0) {
    return {
      rawKeywords: [],
      mainKeyword: "",
      secondaryKeywords: [],
      brandKeywords: []
    };
  }

  const mainKeyword = keywords.length >= 2 ? `${keywords[0]} ${keywords[1]}` : keywords[0];
  const baseSecondary = keywords.length >= 2 ? keywords.slice(2) : [];
  const derivedSecondary =
    keywords.length >= 2
      ? [`${keywords[0]} 관리`, `${keywords[1]} 후기`]
      : [`${keywords[0]} 선택 기준`, `${keywords[0]} 후기`];
  const brandKeywords = uniqueText(
    keywords.filter((keyword, index) => isBrandLikeKeyword(keyword, index, keywords.length))
  );
  const secondaryKeywords = uniqueText([...baseSecondary, ...derivedSecondary]).filter(
    (keyword) => compact(keyword) !== compact(mainKeyword)
  );

  return {
    rawKeywords: keywords,
    mainKeyword,
    secondaryKeywords,
    brandKeywords
  };
};

const getKeywordContext = (form = {}) => parseKeywordInput(form.keyword);
const getMainKeyword = (form = {}) => getKeywordContext(form).mainKeyword || text(form.keyword);
const getSecondaryKeywords = (form = {}) => getKeywordContext(form).secondaryKeywords;
const getBrandKeywords = (form = {}) => getKeywordContext(form).brandKeywords;

const applyAvoidWords = (value, avoidWords) =>
  avoidWords.reduce((result, word) => result.replaceAll(word, "해당 표현"), value);

const uniqueHashTags = (items) =>
  Array.from(new Set(items.filter(Boolean)))
    .slice(0, 10)
    .map((tag) => (String(tag).startsWith("#") ? tag : `#${tag}`));

const countKeywordOccurrences = (value, keyword) => {
  if (!keyword) return 0;

  return String(value).split(keyword).length - 1;
};

const resolveKeywordOccurrenceRange = (targetLength) =>
  INTERNAL_KEYWORD_OPTIMIZATION.targetRanges.find((range) => targetLength <= range.maxLength) ??
  INTERNAL_KEYWORD_OPTIMIZATION.targetRanges.at(-1);

const createKeywordVariants = (keyword, category, secondaryKeywords = []) =>
  Array.from(
    new Set([
      `${keyword} 선택 기준`,
      `${keyword} 활용 포인트`,
      `${keyword} 체크리스트`,
      ...secondaryKeywords,
      `${category} 고객 관점`,
      "고객 판단 기준",
      "실전 체크포인트",
      "방문 전 확인 포인트"
    ].filter(Boolean))
  );

const getBrandLabel = (form) =>
  text(form.brandName) || getBrandKeywords(form)[0] || text(form.category) || "이곳";

const getRegionPhrase = (form) => {
  const region = text(form.region);
  return region ? `${region}에서 ` : "";
};

const getRegionTokens = (region) => {
  const normalized = text(region).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  if (!normalized) return [];

  const tokens = normalized.split(" ").filter(Boolean);
  const compacted = compact(normalized);

  return Array.from(new Set([compacted, ...tokens.map(compact)].filter(Boolean)));
};

const getStrengths = (form) => {
  const strengths = splitList(form.strengths);
  return strengths.length > 0 ? strengths : ["꼼꼼한 안내", "상황에 맞춘 제안", "편안한 상담"];
};

const getEmphasis = (form) => text(form.emphasisPoint) || "처음 알아보는 분도 쉽게 판단할 수 있는 설명";

const getCta = (form) =>
  text(form.ctaDirection) ||
  (form.goal === "방문 유도" ? "방문 전 궁금한 점을 편하게 확인해보세요." : "필요한 부분을 천천히 비교해보세요.");

const getAudienceType = (form = {}) =>
  text(form.audienceType) || "사업자/매장 홍보";

const getAudienceProfile = (form = {}) => {
  const audienceType = getAudienceType(form);

  if (audienceType === "인플루언서/수익형") {
    return {
      label: audienceType,
      readerLabel: "콘텐츠를 보고 저장, 클릭, 문의를 고민하는 독자",
      situationHeading: "스크롤을 멈추게 하는 첫 번째 포인트",
      criteriaHeading: "저장해두고 싶은 정보는 이렇게 다릅니다",
      judgmentHeading: "광고처럼 보이지 않는 신뢰 포인트",
      actionHeading: "필요할 때 다시 찾기 쉬운 마무리",
      situationLine: (keyword) =>
        `${asObject(keyword)} 알아보는 분들은 당장 결정하지 않더라도 나중에 다시 볼 만한 정보를 찾는 경우가 많습니다. 그래서 단순한 소개보다 비교할 때 도움이 되는 내용이 더 오래 남습니다.`,
      judgmentLine: (brand, keyword) =>
        `${asObject(brand)} 볼 때도 광고처럼 좋은 말만 이어지는지보다 ${asObject(keyword)} 고르는 과정에서 실제로 도움이 되는 근거가 있는지 살펴보는 편이 좋습니다.`,
      actionLine: (brand, cta) =>
        `지금 바로 결정하지 않아도 괜찮습니다. 저장해두고 비교하다가 궁금한 점이 생기면 그때 필요한 내용부터 가볍게 확인해보세요. ${cta || `${brand}가 궁금하다면 필요한 내용부터 가볍게 확인해보세요.`}`
    };
  }

  return {
    label: "사업자/매장 홍보",
    readerLabel: "문의나 방문 전 정보를 비교하는 잠재 고객",
    situationHeading: "방문 전 가장 먼저 망설이게 되는 부분",
    criteriaHeading: "가격보다 먼저 봐야 할 기준",
    judgmentHeading: "믿고 문의할 수 있는지 보는 포인트",
    actionHeading: "부담 없이 문의하기 좋은 마무리",
    situationLine: (keyword) =>
      `${asObject(keyword)} 찾는 고객은 보통 가격이나 조건만 보는 것이 아니라, 문의했을 때 원하는 안내를 받을 수 있는지도 함께 봅니다.`,
    judgmentLine: (brand, keyword) =>
      `${asObject(brand)} 선택할지 고민하는 고객에게는 ${keyword} 설명보다 실제 상담 흐름과 응대 방식이 더 직접적인 판단 기준이 됩니다.`,
    actionLine: (brand, cta) =>
      `처음부터 바로 결정하지 않아도 됩니다. 필요한 부분을 먼저 묻고, 내 상황과 맞는지 확인하는 것만으로도 방향이 훨씬 분명해집니다. ${cta || `${brand}가 궁금하다면 필요한 부분부터 편하게 문의해보세요.`}`
  };
};

const createHumanList = (items) => {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]}, ${items[1]}`;

  return `${items[0]}, ${items[1]}, ${items[2]}`;
};

const createSentence = (value) => {
  const sentence = text(value);

  if (!sentence) return "";
  if (/[.!?요다]$/.test(sentence)) return sentence;

  return `${sentence}.`;
};

export const createCtaCandidates = (form = {}) => {
  const audienceType = getAudienceType(form);
  const brand = getBrandLabel(form);
  const keyword = getMainKeyword(form);
  const region = text(form.region);
  const direction = text(form.ctaDirection);
  const wantsBooking = direction.includes("예약");
  const wantsVisit = direction.includes("방문");

  if (audienceType === "인플루언서/수익형") {
    return [
      `저는 이 기준으로 골라보는 쪽을 추천드려요.`,
      `비슷한 고민이라면 한 번 비교해보셔도 좋을 것 같아요.`,
      `${brand}가 궁금했다면 내 기준과 맞는지 직접 확인해보는 걸 추천드려요.`
    ];
  }

  if (wantsBooking) {
    return [
      `${brand}가 궁금하다면 예약 가능 시간부터 편하게 확인해보세요.`,
      `방문 전 기준을 정리한 뒤 원하는 시간대를 편하게 물어보셔도 좋습니다.`,
      `${region ? `${region}에서 ` : ""}${asObject(keyword)} 고민 중이라면 예약 전 필요한 부분부터 확인해보세요.`
    ];
  }

  if (wantsVisit) {
    return [
      `방문 전 기준부터 확인해보고 편하게 문의해보셔도 좋습니다.`,
      `${brand}가 궁금하다면 방문 전 필요한 내용을 먼저 물어보세요.`,
      `${region ? `${region}에서 ` : ""}${asObject(keyword)} 찾고 있다면 방문 가능 여부부터 확인해보세요.`
    ];
  }

  return [
    `${brand}가 궁금하다면 부담 없이 상담 받아보세요.`,
    `방문 전 기준부터 확인해보고 편하게 문의해보셔도 좋습니다.`,
    `${region ? `${region}에서 ` : ""}${asObject(keyword)} 고민 중이라면 필요한 부분만 먼저 물어보세요.`
  ];
};

const createCtaSentence = (form, selectedCtaSentence = "") => {
  const selected = text(selectedCtaSentence);

  if (selected) return createSentence(selected);

  return createCtaCandidates(form)[0] || getCta(form);
};

const createReaderCue = (form) => {
  const keyword = getMainKeyword(form);
  const region = text(form.region);

  return region ? `${region}에서 ${asObject(keyword)} 알아보고 계신다면` : `${asObject(keyword)} 알아보고 계신다면`;
};

const TONE_PROFILES = {
  친근한: {
    opening: (keyword) =>
      `${asObject(keyword)} 검색해보면 업체도 많고 말도 비슷해서, 결국 뭘 보고 골라야 할지 헷갈릴 때가 많죠.`,
    topicBridge: (topic, angle) =>
      `"${topic}"에 대해 찾아보고 있었다면, 오늘은 ${asObject(angle)} 부담 없이 풀어보겠습니다. 복잡한 설명 사이에서도 나에게 맞는 선택이 조금 더 또렷해질 수 있습니다.`,
    purposeLine: (keyword) =>
      `먼저 내가 왜 ${asObject(keyword)} 찾고 있는지 가볍게 떠올려보세요. 원하는 결과가 선명해지면 어떤 설명을 믿고 넘겨야 할지도 훨씬 쉬워집니다.`,
    categoryLine: (category) =>
      `${category} 정보는 처음 보면 다 좋아 보일 수 있습니다. 그래서 화려한 말보다 내 상황을 알아듣고 풀어주는지가 더 중요합니다.`,
    trustLine: (keyword) =>
      `${asObject(keyword)} 맡기기 전에는 답변이 편한지부터 느껴보세요. 설명이 쉽게 들어오면 이후 과정도 덜 부담스럽습니다.`,
    promoLine: (keyword, brand) =>
      `${brand}의 ${keyword}가 궁금하다면 장점 목록만 훑기보다, 그 장점이 내 상황에서 어떻게 도움이 될지 연결해서 보는 게 좋습니다.`,
    visitLine: (keyword) =>
      `${asObject(keyword)} 보러 움직이기 전에는 목적을 먼저 정해두면 좋아요. 상담이 필요한지, 직접 보고 싶은지에 따라 물어볼 내용이 달라집니다.`,
    strengthLine: (brand, strengthText) =>
      `${brand}의 강점은 ${strengthText}입니다. 이런 부분이 실제 대화나 진행 과정에서도 자연스럽게 느껴지는지 보면 선택이 더 편해집니다.`,
    emphasisLine: (emphasis, keyword) =>
      `${emphasis} 부분은 ${asObject(keyword)} 고민할 때 그냥 지나치기 아쉬운 지점입니다. 가격이나 구성만큼 실제 만족도에 영향을 줄 수 있습니다.`,
    compareLine: (keyword) =>
      `${asObject(keyword)} 여러 곳과 비교 중이라면 설명, 후기, 진행 과정을 따로 보지 말고 하나의 경험처럼 이어서 살펴보세요.`,
    photoLine: (keyword) =>
      `사진은 첫인상을 보는 데 도움이 됩니다. 다만 ${asObject(keyword)} 고를 때는 사진 뒤에 있는 응대 방식과 실제 과정까지 함께 봐야 더 현실적입니다.`,
    localLine: (region, keyword) =>
      region
        ? `${region}에서 ${asObject(keyword)} 알아보고 있다면 상담 가능 시간이나 진행 방식처럼 실제로 움직일 때 필요한 내용도 편하게 물어보세요.`
        : `${keyword} 문의 전에는 원하는 조건과 궁금한 점을 짧게 적어두면 대화가 훨씬 편해집니다.`,
    closingLine: (keyword, cta) =>
      `${asObject(keyword)} 오래 고민하고 있다면 지금 가장 궁금한 부분 하나만 먼저 물어봐도 충분합니다. ${cta}`.replace(/\s+/g, " ")
  },
  전문적인: {
    opening: (keyword) =>
      `${asObject(keyword)} 검토할 때 중요한 것은 많은 정보를 모으는 것보다 판단 기준을 정확히 세우는 일입니다.`,
    topicBridge: (topic, angle) =>
      `"${topic}"에 대해 살펴볼 때는 ${asObject(angle)} 먼저 정리하는 것이 좋습니다. 조건, 과정, 사후 안내를 같은 기준으로 보면 선택의 근거가 명확해집니다.`,
    purposeLine: (keyword) =>
      `${asObject(keyword)} 비교하기 전에는 이용 목적과 기대 결과, 필요한 조건을 구분해야 합니다. 이 세 가지가 정리되면 불필요한 선택지를 줄일 수 있습니다.`,
    categoryLine: (category) =>
      `${category} 영역에서는 비슷한 설명이라도 실제 운영 방식에 따라 만족도가 달라집니다. 표현보다 확인 가능한 절차와 응대 방식을 우선해보는 것이 좋습니다.`,
    trustLine: (keyword) =>
      `${asObject(keyword)} 선택할 때는 결과뿐 아니라 상담 응대, 진행 절차, 사후 안내를 함께 검토해야 합니다. 과정이 명확해야 불필요한 리스크가 줄어듭니다.`,
    promoLine: (keyword, brand) =>
      `${brand}의 ${keyword}를 볼 때는 장점이 실제 니즈와 어떻게 맞물리는지 확인하는 것이 핵심입니다. 단순 소개보다 적용 가능성과 지속성이 중요합니다.`,
    visitLine: (keyword) =>
      `${asObject(keyword)} 위해 방문을 고려한다면 목적과 확인 항목을 미리 정리하는 편이 좋습니다. 그래야 상담 시간이 효율적으로 쓰입니다.`,
    strengthLine: (brand, strengthText) =>
      `${brand}의 주요 강점은 ${strengthText}입니다. 이 강점이 상담, 진행, 사후 안내에서 일관되게 드러나는지 살펴보는 것이 좋습니다.`,
    emphasisLine: (emphasis, keyword) =>
      `${emphasis} 항목은 ${asObject(keyword)} 판단할 때 반드시 확인해야 할 요소입니다. 내 조건과 맞는지 객관적으로 점검해보세요.`,
    compareLine: (keyword) =>
      `${asObject(keyword)} 비교할 때는 비용, 설명, 후기, 진행 방식을 같은 기준으로 놓고 판단해야 합니다.`,
    photoLine: (keyword) =>
      `이미지는 분위기 파악에 유용하지만 ${keyword} 선택의 근거로는 부족할 수 있습니다. 실제 응대와 절차를 함께 확인해야 합니다.`,
    localLine: (region, keyword) =>
      region
        ? `${region}에서 ${asObject(keyword)} 찾고 있다면 접근성뿐 아니라 상담 방식, 가능 일정, 안내 채널까지 확인하는 것이 좋습니다.`
        : `${keyword} 문의 전에는 조건, 일정, 우선순위를 정리해두면 상담 품질을 높일 수 있습니다.`,
    closingLine: (keyword, cta) =>
      `${asSubject(keyword)} 기준을 세운 뒤 확인하면 선택의 근거가 훨씬 명확해집니다. ${cta}`.replace(/\s+/g, " ")
  },
  차분한: {
    opening: (keyword) =>
      `${asObject(keyword)} 알아보다 보면 정보는 많은데 마음은 오히려 더 복잡해질 때가 있습니다.`,
    topicBridge: (topic, angle) =>
      `"${topic}"에 마음이 갔다면, ${asObject(angle)} 하나씩 차분히 살펴보면 됩니다. 급하게 결정하기보다 필요한 부분부터 정리해보면 충분합니다.`,
    purposeLine: (keyword) =>
      `먼저 ${asObject(keyword)} 찾는 이유를 조용히 정리해보세요. 지금 불편한 점과 기대하는 결과를 나눠보면 선택지가 자연스럽게 좁혀집니다.`,
    categoryLine: (category) =>
      `${category} 정보가 많아도 모두를 한 번에 볼 필요는 없습니다. 나에게 필요한 조건과 맞는지부터 천천히 보면 됩니다.`,
    trustLine: (keyword) =>
      `${asObject(keyword)} 알아볼 때는 설명이 차분하게 이어지는지도 중요합니다. 편하게 물어볼 수 있어야 이후 과정도 안정적입니다.`,
    promoLine: (keyword, brand) =>
      `${brand}의 ${keyword}가 궁금하다면 장점을 하나씩 내 상황에 대입해보세요. 천천히 맞춰보면 필요한 부분이 조금씩 분명해집니다.`,
    visitLine: (keyword) =>
      `${asObject(keyword)} 위해 방문을 생각 중이라면 먼저 궁금한 점만 간단히 정리해도 괜찮습니다. 준비가 완벽하지 않아도 상담은 충분히 시작할 수 있습니다.`,
    strengthLine: (brand, strengthText) =>
      `${brand}에서는 ${strengthText}을 중요하게 봅니다. 이런 부분이 내 상황에 잘 맞는지 차분히 확인해보세요.`,
    emphasisLine: (emphasis, keyword) =>
      `${emphasis} 부분은 ${asObject(keyword)} 결정하기 전에 천천히 짚어볼 만한 요소입니다. 작은 차이처럼 보여도 만족도에 영향을 줄 수 있습니다.`,
    compareLine: (keyword) =>
      `${asObject(keyword)} 비교할 때는 너무 많은 정보를 한꺼번에 보지 않아도 됩니다. 중요한 조건부터 하나씩 맞춰보세요.`,
    photoLine: (keyword) =>
      `사진과 후기는 참고가 됩니다. 다만 ${asObject(keyword)} 선택할 때는 실제 상담 흐름과 안내 방식까지 함께 보시면 더 안정적입니다.`,
    localLine: (region, keyword) =>
      region
        ? `${region}에서 ${asObject(keyword)} 알아보고 있다면 거리와 일정뿐 아니라 편하게 문의할 수 있는지도 함께 확인해보세요.`
        : `${keyword} 문의 전에는 지금 궁금한 점 한두 가지만 적어두어도 충분합니다.`,
    closingLine: (keyword, cta) =>
      `${asSubject(keyword)} 서두르기보다 내 상황과 맞는지 천천히 확인하는 과정이 중요합니다. ${cta}`.replace(/\s+/g, " ")
  },
  활기찬: {
    opening: (keyword) =>
      `${asObject(keyword)} 찾고 있다면 오래 헤매기 전에 핵심부터 잡아두는 게 좋습니다.`,
    topicBridge: (topic, angle) =>
      `"${topic}"에 관심이 있다면, ${asObject(angle)} 빠르게 정리해보겠습니다. 핵심만 잡아도 비교 시간이 훨씬 줄어듭니다.`,
    purposeLine: (keyword) =>
      `첫 단계는 목적 정리입니다. ${asObject(keyword)} 왜 필요한지 정하면 비교할 때 흔들리지 않습니다.`,
    categoryLine: (category) =>
      `${category} 정보가 많아도 핵심은 간단합니다. 내 조건에 맞는지, 설명이 바로 이해되는지만 먼저 보세요.`,
    trustLine: (keyword) =>
      `${asObject(keyword)} 선택 전에는 응대 속도와 설명의 명확함을 바로 체크해보세요. 답이 선명하면 결정도 빨라집니다.`,
    promoLine: (keyword, brand) =>
      `${brand}의 ${keyword}를 볼 때는 장점이 실제 상황에서 어떻게 도움이 되는지 바로 연결해보는 것이 좋습니다.`,
    visitLine: (keyword) =>
      `${asObject(keyword)} 보러 가기 전에는 방문 목적과 궁금한 점을 빠르게 정리해보세요. 확인할 것이 분명하면 움직이기 쉽습니다.`,
    strengthLine: (brand, strengthText) =>
      `${brand}의 포인트는 ${strengthText}입니다. 이 강점이 필요한 분이라면 상담에서 바로 확인해보셔도 좋습니다.`,
    emphasisLine: (emphasis, keyword) =>
      `${emphasis} 부분은 ${asObject(keyword)} 비교할 때 놓치면 아쉬운 핵심입니다. 내 조건과 맞는지 꼭 체크해보세요.`,
    compareLine: (keyword) =>
      `${asObject(keyword)} 비교할 때는 오래 망설이기보다 기준을 세우고 빠르게 좁혀보세요.`,
    photoLine: (keyword) =>
      `사진으로 분위기를 보고, 문의로 실제 흐름을 확인해보세요. ${asObject(keyword)} 판단이 훨씬 빨라집니다.`,
    localLine: (region, keyword) =>
      region
        ? `${region}에서 ${asObject(keyword)} 찾고 있다면 상담 가능 시간과 진행 방식을 먼저 확인해보세요.`
        : `${keyword} 문의 전에는 원하는 조건만 간단히 정리해도 다음 단계가 빨라집니다.`,
    closingLine: (keyword, cta) =>
      `${asObject(keyword)} 고민 중이라면 필요한 기준부터 바로 확인해보세요. ${cta}`.replace(/\s+/g, " ")
  }
};

const getToneProfile = (tone) => TONE_PROFILES[tone] ?? TONE_PROFILES.친근한;

const createTitleAngle = (selectedTitle, keyword, goal) => {
  const title = text(selectedTitle);

  if (title.includes("방문")) return "방문 전 확인 기준";
  if (title.includes("신뢰") || title.includes("믿")) return "믿고 선택할 수 있는 기준";
  if (title.includes("장점") || title.includes("달라") || goal === "상품 홍보") {
    return `${keyword} 장점과 실제 활용 포인트`;
  }
  if (title.includes("처음") || title.includes("쉬운")) return "처음 알아볼 때 필요한 기준";
  if (title.includes("선택")) return `${keyword} 선택 기준`;

  return `${keyword} 판단 기준`;
};

const createCoreFocus = (goal, keyword, brand, emphasis) => {
  const messages = {
    "정보 전달": `${asSubject(keyword)} 정보를 많이 아는 것보다 내 상황에 맞는 기준을 먼저 잡는 것이 중요합니다.`,
    "신뢰 형성": `${asSubject(keyword)} 결과만 보고 고르기보다 설명과 응대가 끝까지 편안한지 보는 것이 중요합니다.`,
    "상품 홍보": `${brand}의 ${keyword}를 볼 때 핵심은 장점이 실제 상황에서 체감되는지입니다. 특히 ${emphasis} 부분이 중요합니다.`,
    "방문 유도": `${asSubject(keyword)} 가까운 곳을 찾는 것에서 끝나지 않고, 방문했을 때 원하는 안내를 받을 수 있는지가 중요합니다.`
  };

  return messages[goal] ?? messages["정보 전달"];
};

const cleanHeadingText = (value) =>
  text(value)
    .replace(/ 부분$/, "")
    .replace(/\s+/g, " ");

const createHeadingLead = (heading, index, audienceLabel) => {
  const businessLeads = [
    `처음에는 선택지가 많아 보이지만, 내 상황에 맞는 기준을 잡으면 비교가 훨씬 단순해집니다.`,
    `실제로 문의나 상담으로 이어질 때는 작은 차이가 먼저 체감되는 경우가 많습니다.`,
    `여기서부터는 겉으로 보이는 설명보다 실제로 나에게 맞는지를 보는 것이 중요합니다.`,
    `판단이 어려울수록 상담 흐름과 안내 방식을 기준으로 보면 훨씬 현실적입니다.`,
    `마지막에는 부담 없이 다음 행동을 떠올릴 수 있어야 합니다.`,
    `선택 후 만족도는 작은 기준을 미리 확인했는지에서 갈리는 경우가 많습니다.`
  ];
  const influencerLeads = [
    `저도 처음에는 비슷한 정보를 여러 번 열어보면서 기준을 잡기 어려웠습니다.`,
    `이런 내용은 단순한 소개보다 저장해두고 다시 볼 수 있을 때 더 도움이 됩니다.`,
    `장점을 바로 밀어붙이기보다 직접 보고 납득할 수 있는 흐름이 더 자연스럽습니다.`,
    `비교 포인트가 분명하면 광고처럼 느껴지기보다 참고할 만한 정보로 받아들여집니다.`,
    `마지막에는 저장할지, 클릭할지, 직접 확인할지 자연스럽게 떠올라야 합니다.`,
    `좋은 콘텐츠는 정보가 끝까지 하나의 흐름으로 이어질 때 더 오래 남습니다.`
  ];
  const leads = audienceLabel === "인플루언서/수익형" ? influencerLeads : businessLeads;

  return leads[index] ?? leads.at(-1);
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripMainKeyword = (value, keyword, replacement = "이 기준") => {
  const source = text(value);

  if (!source || !keyword) return source;

  return source
    .replace(new RegExp(`${escapeRegExp(keyword)}(에서|으로|을|를|은|는|이|가|에|와|과|로|의)?`, "g"), replacement)
    .replace(/^[,\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

export const createOpeningSentenceCandidates = (form = {}) => {
  const keyword = getMainKeyword(form);
  const secondaryKeywords = getSecondaryKeywords(form);
  const secondaryCue = secondaryKeywords[0] || "비교 기준";
  const tone = text(form.tone);
  const audienceType = getAudienceType(form);
  const region = text(form.region);
  const category = text(form.category);

  if (audienceType === "인플루언서/수익형") {
    return [
      `${asObject(keyword)} 처음 본다면 실제로 꾸준히 활용할 수 있는 조건인지 먼저 확인하는 것이 좋습니다.`,
      `${asObject(keyword)} 찾아볼 때는 ${asObject(secondaryCue)} 함께 보면 내 상황에 맞는 후기인지 구분하기 쉽습니다.`,
      `${asObject(keyword)} 콘텐츠는 장점보다 경험, 비교 기준, 사용 맥락이 함께 보일 때 더 오래 읽힙니다.`
    ];
  }

  const toneMatched = {
    친근한: `${asObject(keyword)} 처음 알아본다면 가격보다 내 상황에 맞는 선택 기준부터 잡는 것이 좋습니다.`,
    전문적인: `${asObject(keyword)} 검토할 때는 가격보다 사용 목적과 확인 기준이 먼저 정리되어야 합니다.`,
    차분한: `${asObject(keyword)} 정보가 많을수록 처음에는 필요한 기준부터 차분히 확인하는 것이 좋습니다.`,
    활기찬: `${asObject(keyword)} 빠르게 비교하려면 처음부터 선택 기준과 체크포인트를 나눠보는 편이 좋습니다.`
  };

  return [
    toneMatched[tone] ?? toneMatched.친근한,
    `${region ? `${region}에서 ` : ""}${asObject(keyword)} 찾는 분들은 보통 가격보다 실제 이용 흐름이 내 상황과 맞는지 먼저 궁금해합니다.`,
    `${category} 정보를 비교할 때 ${asObject(keyword)} 기준 없이 보면 좋은 설명도 비슷하게 느껴질 수 있습니다.`
  ];
};

const createOpeningParagraph = (form, selectedOpeningSentence = "") => {
  const keyword = getMainKeyword(form);
  const brand = getBrandLabel(form);
  const region = text(form.region);
  const category = text(form.category);
  const strengthText = createHumanList(getStrengths(form));
  const audienceType = getAudienceType(form);
  const selected = text(selectedOpeningSentence);
  const firstSentence = selected || createOpeningSentenceCandidates(form)[0];
  const secondSentence =
    audienceType === "인플루언서/수익형"
      ? `${keyword} 콘텐츠는 장점보다 경험과 비교 기준이 함께 보일 때 더 오래 읽히고 저장됩니다.`
      : `검색해보면 ${keyword} 관련 정보가 많지만, 사진이나 가격만으로는 상담 방식과 만족도를 충분히 알기 어렵습니다.`;
  const thirdSentence =
    audienceType === "인플루언서/수익형"
      ? `저도 ${brand}를 볼 때 ${strengthText} 같은 부분이 자연스럽게 느껴지는지 먼저 확인하게 됩니다.`
      : `${brand}를 볼 때도 ${region ? `${region} 안에서 움직이기 편한지와 ` : ""}${category} 이용자가 실제로 느낄 수 있는 차이를 함께 보는 것이 좋습니다.`;

  return [firstSentence, secondSentence, thirdSentence].join(" ");
};

const createTopicBridgeParagraph = (form, selectedTopic, selectedTitle, titleAngle) => {
  const keyword = getMainKeyword(form);
  const audienceType = getAudienceType(form);
  const topicCue = stripMainKeyword(selectedTopic || selectedTitle || titleAngle, keyword, "") || "확인 기준";

  if (audienceType === "인플루언서/수익형") {
    return `${asObject(topicCue)} 중심으로 보면 장점을 나열하기보다 경험, 비교 기준, 확인할 포인트가 자연스럽게 이어지는지가 중요합니다. 그래서 아래 내용은 후기처럼 읽히면서도 필요할 때 다시 꺼내볼 수 있게 정리했습니다.`;
  }

  return `${asObject(topicCue)} 중심으로 보면 선택지를 많이 보는 것보다 내 상황에서 필요한 기준을 차례대로 확인하는 것이 더 중요합니다. 아래 내용은 각 항목마다 먼저 결론을 짚고, 문의나 구매 전에 바로 참고할 수 있는 기준으로 정리했습니다.`;
};

const createFaqAnswerParagraph = (form) => {
  const keyword = getMainKeyword(form);
  const secondaryCue = getSecondaryKeywords(form)[0] || "후기와 비교 기준";
  const audienceType = getAudienceType(form);

  if (audienceType === "인플루언서/수익형") {
    return `자주 묻는 질문처럼 "${keyword}는 어떤 사람에게 맞나요?"라고 본다면, ${secondaryCue}를 함께 확인했을 때 내 루틴과 부담 없이 이어질 수 있는지가 가장 현실적인 기준입니다.`;
  }

  return `자주 묻는 질문처럼 "${keyword}는 무엇을 먼저 확인해야 하나요?"라고 본다면, 가격보다 내 상황에 맞는 기준과 ${secondaryCue}를 함께 보는 것이 좋습니다.`;
};

const getToneNudge = (tone) =>
  ({
    친근한: "어렵게 생각하기보다 지금 필요한 부분부터 가볍게 보면 됩니다.",
    전문적인: "조건, 절차, 응대 방식을 같은 기준으로 확인하면 판단 근거가 분명해집니다.",
    차분한: "서두르지 않고 하나씩 맞춰보면 불필요한 고민을 줄일 수 있습니다.",
    활기찬: "핵심만 먼저 잡아도 비교 시간이 훨씬 줄어듭니다."
  })[tone] ?? "필요한 기준부터 차근차근 확인해보면 됩니다.";

const createFlowBlocks = ({ form, cta }) => {
  const keyword = getMainKeyword(form);
  const category = text(form.category);
  const brand = getBrandLabel(form);
  const region = text(form.region);
  const tone = text(form.tone);
  const strengthText = createHumanList(getStrengths(form));
  const emphasis = getEmphasis(form);
  const audienceType = getAudienceType(form);
  const toneNudge = getToneNudge(tone);

  if (audienceType === "인플루언서/수익형") {
    return {
      empathy: [
        `처음부터 결론을 내리려고 하면 오히려 비교가 더 어려워집니다. 나와 비슷한 상황에서 어떤 점을 봤는지부터 확인하면 훨씬 편합니다.`,
        `${toneNudge} 특히 ${category} 정보는 실제 경험처럼 읽힐 때 기억에 오래 남습니다.`
      ],
      situation: [
        `${keyword}를 볼 때는 예쁜 사진보다 왜 이 선택지가 눈에 들어왔는지 먼저 보는 편이 좋습니다.`,
        `${brand}의 경우에도 ${strengthText} 같은 부분이 자연스럽게 드러나면 부담 없이 더 살펴보게 됩니다.`
      ],
      criteria: [
        `${emphasis}은 저장해두고 다시 확인하기 좋은 기준이 됩니다.`,
        `비슷한 정보를 비교할 때는 장점이 얼마나 크냐보다 내 상황에 맞게 이해되는지가 더 중요합니다.`
      ],
      judgment: [
        `제가 볼 때 신뢰가 생기는 지점은 과장된 표현보다 실제 확인할 수 있는 설명이 있는지입니다.`,
        `사진이나 짧은 후기만 보기보다 안내 방식, 분위기, 비교 포인트가 자연스럽게 이어지는지도 함께 보면 좋습니다.`
      ],
      extra: [
        `공유하고 싶은 글은 결국 읽는 사람이 자기 상황을 떠올릴 수 있어야 합니다.`,
        `너무 많은 정보를 한 번에 담기보다 필요한 기준을 순서대로 보여주면 체류시간과 저장 가능성이 함께 올라갑니다.`
      ],
      action: [
        `${region ? `${region}에서 ` : ""}${keyword}가 궁금하다면 직접 확인할 수 있는 내용부터 저장해두고 필요할 때 다시 보는 것도 좋습니다.`,
        `${cta}`
      ]
    };
  }

  return {
    empathy: [
      `처음부터 결정하려고 하면 가격, 후기, 위치, 설명이 한꺼번에 보여 더 헷갈릴 수 있습니다.`,
      `${toneNudge} 특히 ${category}에서는 실제 상담이나 이용 과정에서 느끼는 차이가 만족도로 이어집니다.`
    ],
    situation: [
      `${keyword}를 찾는 분들은 보통 조건만 보는 것이 아니라 문의했을 때 원하는 안내를 받을 수 있는지도 함께 봅니다.`,
      `${brand}의 강점인 ${strengthText}도 실제 대화와 진행 과정에서 자연스럽게 느껴지는지 확인해보면 좋습니다.`
    ],
    criteria: [
      `${keyword}를 고를 때 기준은 화려한 설명보다 내 상황에 맞는지 확인할 수 있는 구체적인 안내입니다.`,
      `${emphasis}은 처음 비교할 때 놓치기 쉽지만 실제 만족도에는 꽤 큰 영향을 줄 수 있습니다.`
    ],
    judgment: [
      `${brand}를 선택할지 고민된다면 상담 흐름, 응대 속도, 설명의 명확함을 함께 보는 것이 좋습니다.`,
      `사진과 후기는 참고가 되지만, 실제로 편하게 물어볼 수 있는지까지 확인해야 결정 후 부담이 줄어듭니다.`
    ],
    extra: [
      `비교가 길어질수록 처음에 중요하다고 생각했던 기준이 흐려질 수 있습니다.`,
      `그럴 때는 원하는 결과, 필요한 일정, 우선순위를 간단히 적어두고 다시 살펴보는 편이 현실적입니다.`
    ],
    action: [
      `${keyword} 문의 전에는 궁금한 점을 완벽하게 정리하지 않아도 괜찮습니다.`,
      `현재 상황과 필요한 부분만 먼저 확인해도 다음 선택이 훨씬 분명해집니다. ${cta}`
    ]
  };
};

const normalizeOutlineSections = (outlineSections = []) =>
  outlineSections
    .map((item) => (typeof item === "string" ? item : item?.heading))
    .map(text)
    .filter(Boolean)
    .slice(0, 6);

export function getOutlineSectionCount(form = {}) {
  const target = resolveTargetLength(form);

  if (target < 1400) return 3;
  if (target < 1800) return 4;
  if (target < 2300) return 5;

  return 6;
}

const OUTLINE_ROLES_BY_COUNT = {
  3: ["핵심 기준", "선택 포인트", "마무리 정리"],
  4: ["공감/문제", "선택 기준", "비교 포인트", "마무리"],
  5: ["공감/문제", "핵심 기준", "비교/주의점", "실제 활용 포인트", "마무리 CTA"],
  6: ["공감/문제", "기본 개념", "선택 기준", "비교 포인트", "자주 묻는 질문", "마무리 CTA"]
};

const createOutlineHeading = ({ role, keyword, secondaryCue, brand, audienceLabel, goal, titleAngle }) => {
  const isInfluencer = audienceLabel === "인플루언서/수익형";

  switch (role) {
    case "공감/문제":
      return isInfluencer
        ? `${keyword}, 직접 보기 전 헷갈리는 부분`
        : `${keyword}, 처음 찾는 고객이 헷갈리는 부분`;
    case "기본 개념":
      return `${keyword}를 볼 때 먼저 알아둘 기본 흐름`;
    case "핵심 기준":
      return `${keyword}, 처음이라면 먼저 확인할 핵심 기준`;
    case "선택 기준":
      return `${keyword} 선택 전 먼저 볼 기준`;
    case "선택 포인트":
      return `${secondaryCue || keyword}까지 함께 보는 선택 포인트`;
    case "비교 포인트":
      return `${secondaryCue || brand}와 함께 비교할 포인트`;
    case "비교/주의점":
      return `${secondaryCue || titleAngle} 비교할 때 주의할 점`;
    case "실제 활용 포인트":
      return isInfluencer
        ? `후기처럼 풀어내기 좋은 실제 활용 포인트`
        : `문의나 구매 전 확인하면 좋은 실제 활용 포인트`;
    case "자주 묻는 질문":
      return `${keyword}를 보기 전 자주 묻는 질문`;
    case "마무리 CTA":
      return goal === "방문 유도" ? `방문 전 확인할 마지막 체크` : `마무리 정리와 다음 확인 포인트`;
    case "마무리":
    case "마무리 정리":
    default:
      return `마무리 정리와 다음 확인 포인트`;
  }
};

export function createOutlineSections(form, selectedTopic, selectedTitle) {
  const keyword = getMainKeyword(form);
  const goal = text(form.goal);
  const brand = getBrandLabel(form);
  const audienceProfile = getAudienceProfile(form);
  const titleAngle = createTitleAngle(selectedTitle, keyword, goal);
  const avoidWords = splitAvoidWords(form.avoid);
  const secondaryCue = getSecondaryKeywords(form)[0] || stripMainKeyword(selectedTopic, keyword, "") || "";
  const count = getOutlineSectionCount(form);
  const roles = OUTLINE_ROLES_BY_COUNT[count] ?? OUTLINE_ROLES_BY_COUNT[4];

  return roles
    .map((role) =>
      createOutlineHeading({
        role,
        keyword,
        secondaryCue,
        brand,
        audienceLabel: audienceProfile.label,
        goal,
        titleAngle
      })
    )
    .map((section) => applyAvoidWords(section, avoidWords))
    .slice(0, count);
}

const formatHeading = (heading) => {
  const cleaned = text(heading).replace(/^\*\*(.+)\*\*$/u, "$1");

  return cleaned ? `**${cleaned}**` : "";
};

const createSection = (heading, paragraphs) =>
  [formatHeading(heading), ...paragraphs.map(createSentence)].filter(Boolean).join("\n\n");

const normalizeBlogBody = (body) =>
  String(body ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const createReaderFacingPostBody = (
  form,
  selectedTopic,
  selectedTitle,
  outlineSections = [],
  writingChoices = {}
) => {
  const range = getTargetLengthRange(form);
  const keyword = getMainKeyword(form);
  const goal = text(form.goal);
  const selectedOpeningSentence =
    text(writingChoices.selectedOpeningSentence) || text(form.selectedOpeningSentence);
  const selectedCtaSentence = text(writingChoices.selectedCtaSentence) || text(form.selectedCtaSentence);
  const cta = createCtaSentence(form, selectedCtaSentence);
  const titleAngle = createTitleAngle(selectedTitle, keyword, goal);
  const audienceProfile = getAudienceProfile(form);
  const normalizedOutline = normalizeOutlineSections(outlineSections);
  const outline =
    normalizedOutline.length >= 3
      ? normalizedOutline
      : createOutlineSections(form, selectedTopic, selectedTitle);
  const flowBlocks = createFlowBlocks({ form, cta });
  const intro = [
    `${form.useEmoji ? "✨ " : ""}${createOpeningParagraph(form, selectedOpeningSentence)}`,
    createTopicBridgeParagraph(form, selectedTopic, selectedTitle, titleAngle)
  ];
  const blockOrder = ["empathy", "situation", "criteria", "judgment", "extra"];
  const sectionBlocks = outline.map((heading, index) => {
    const blockKey = index === outline.length - 1 ? "action" : blockOrder[index] ?? "extra";
    const baseBlocks = flowBlocks[blockKey] ?? flowBlocks.extra;

    return {
      heading,
      paragraphs: [createHeadingLead(heading, index, audienceProfile.label), ...baseBlocks]
    };
  });
  const contextualDetails =
    audienceProfile.label === "인플루언서/수익형"
      ? [
          `비슷한 글이 많을수록 중요한 건 내 경험과 연결되는 한 문장입니다.`,
          `그래서 장점, 분위기, 확인 기준이 따로 놀지 않고 하나의 이야기처럼 이어지는지를 보는 편이 좋습니다.`
        ]
      : [
          `처음 상담할 때는 너무 완벽하게 준비하지 않아도 됩니다.`,
          `원하는 결과와 궁금한 점만 간단히 남겨도 필요한 안내를 받기 쉽습니다.`
        ];

  const faqTargetIndex = sectionBlocks.findIndex((section) => text(section.heading).includes("자주 묻는 질문"));
  sectionBlocks[faqTargetIndex >= 0 ? faqTargetIndex : Math.max(0, sectionBlocks.length - 2)]?.paragraphs.push(
    createFaqAnswerParagraph(form)
  );

  if (
    [...intro, ...sectionBlocks.map((section) => createSection(section.heading, section.paragraphs))].join("\n\n")
      .length < range.min
  ) {
    const targetIndex = Math.max(0, sectionBlocks.length - 2);
    sectionBlocks[targetIndex].paragraphs.push(...contextualDetails);
  }

  return normalizeBlogBody([
    ...intro,
    ...sectionBlocks.map((section) => createSection(section.heading, section.paragraphs))
  ].join("\n\n"));
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
  const keyword = getMainKeyword(form);
  const keywordContext = getKeywordContext(form);
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
    secondaryKeywords: keywordContext.secondaryKeywords,
    brandKeywords: keywordContext.brandKeywords,
    relatedExpressions: createKeywordVariants(keyword, category, keywordContext.secondaryKeywords),
    semanticExpressions: ["선택 기준", "활용 포인트", "실전 체크포인트", "고객 판단 기준"],
    placementHints: INTERNAL_KEYWORD_OPTIMIZATION.placementHints
  };
}

const getTopicVariationOffset = (form, total) => {
  if (!total) return 0;

  const regenerationCount = Number.parseInt(
    form?.regenerationCount ?? form?.topicRegenerationCount ?? 0,
    10
  );
  const seed = text(form?.variationSeed);
  const seedOffset = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return (Math.max(0, Number.isFinite(regenerationCount) ? regenerationCount : 0) * 3 + seedOffset) % total;
};

const getPreviousTopicSet = (form = {}) =>
  new Set(
    [
      ...(Array.isArray(form.previousTopics) ? form.previousTopics : []),
      ...(Array.isArray(form.topicHistory) ? form.topicHistory : [])
    ]
      .map(text)
      .filter(Boolean)
  );

export function createTopicRecommendations(form = {}) {
  const keyword = getMainKeyword(form);
  const category = text(form.category);
  const goal = text(form.goal);
  const brand = getBrandLabel(form);
  const region = getRegionPhrase(form);
  const audienceProfile = getAudienceProfile(form);
  const secondaryKeywords = getSecondaryKeywords(form);
  const secondaryCue = secondaryKeywords[0] || `${keyword} 후기`;
  const brandCue = getBrandKeywords(form)[0] || brand;
  const avoidWords = splitAvoidWords(form.avoid);
  const previousTopics = getPreviousTopicSet(form);

  const businessTopicsByGoal = {
    "정보 전달": [
      `${asObject(keyword)} 처음 찾는 고객이 먼저 확인하는 선택 기준`,
      `${secondaryCue}까지 비교하기 전 헷갈리는 체크포인트`,
      `${brandCue}를 보기 전 ${keyword} 정보를 읽는 순서`,
      `${category} 고객이 ${asObject(keyword)} 고를 때 자주 묻는 질문`,
      `${region}${asObject(keyword)} 살펴볼 때 놓치기 쉬운 기준`,
      `후기보다 먼저 보면 좋은 ${keyword} 판단 흐름`,
      `${keyword} 선택 전 초보자가 구분해야 할 표현`,
      `${secondaryCue}와 ${asObject(keyword)} 함께 볼 때 필요한 기준`,
      `${asSubject(keyword)} 필요한 순간과 실제 확인할 포인트`
    ],
    "신뢰 형성": [
      `${keyword} 선택 전 믿을 수 있는 안내를 구분하는 법`,
      `${brandCue}를 처음 알아볼 때 확인하면 좋은 신뢰 요소`,
      `${region}${asObject(keyword)} 문의 전 불안을 줄이는 질문`,
      `${keyword} 후기보다 상담 흐름을 먼저 봐야 하는 이유`,
      `${category} 고객이 안심하는 ${keyword} 설명 방식`,
      `${keyword} 선택 기준에서 과장 표현을 걸러내는 방법`,
      `${brandCue}의 안내가 실제 고객에게 편하게 느껴지는 지점`,
      `${keyword} 상담 전 많이 묻는 질문과 답변 흐름`,
      `${secondaryCue}를 볼 때 신뢰를 판단하는 세부 기준`
    ],
    "상품 홍보": [
      `${asObject(keyword)} 찾는 고객이 ${brandCue}를 살펴보는 이유`,
      `${brandCue}의 장점을 고객 고민과 연결해 보여주는 방법`,
      `${secondaryCue}를 활용해 ${keyword} 선택 이유를 설명하는 글 방향`,
      `${keyword} 구매 전 확인하면 좋은 제품 장점과 사용 상황`,
      `${category} 고객에게 ${keyword}가 필요한 순간`,
      `${keyword} 장점을 과장 없이 전달하는 비교 포인트`,
      `${brandCue}를 처음 보는 고객이 궁금해할 이점 정리`,
      `${keyword} 선택 전 놓치면 아쉬운 활용 기준`,
      `${secondaryCue}로 자연스럽게 이어지는 제품 소개 흐름`
    ],
    "방문 유도": [
      `${region}${asObject(keyword)} 찾는 고객이 방문 전 확인하는 기준`,
      `${brandCue} 방문 또는 문의 전에 자주 묻는 질문 정리`,
      `${keyword} 상담 전 준비하면 좋은 체크포인트`,
      `${category} 고객이 부담 없이 문의하도록 돕는 정보 흐름`,
      `${region}${keyword} 처음 방문할 때 헷갈리는 부분`,
      `${keyword}가 필요한 순간과 예약 전 확인 기준`,
      `${brandCue}에 문의하기 전 불안을 줄이는 안내 방식`,
      `${secondaryCue}를 본 뒤 실제 상담으로 이어지는 흐름`,
      `${keyword} 방문 전 움직이기 쉬워지는 비교 기준`
    ]
  };

  const influencerTopicsByGoal = {
    "정보 전달": [
      `${asObject(keyword)} 직접 챙기기 전 알아둔 선택 기준`,
      `${secondaryCue}까지 비교하며 헷갈렸던 포인트`,
      `${brandCue}를 고를 때 저장해두면 좋은 체크리스트`,
      `${keyword} 루틴에 더하기 전 먼저 본 정보`,
      `${keyword} 후기를 읽을 때 실제로 도움 된 기준`,
      `${secondaryCue}를 자연스럽게 이해하는 초보자 관점`,
      `${asObject(keyword)} 볼 때 나에게 맞는지 판단하는 방법`,
      `비슷한 후기 사이에서 ${asObject(keyword)} 구분한 기준`,
      `${brandCue}를 처음 볼 때 놓치기 쉬운 정보`
    ],
    "신뢰 형성": [
      `${keyword} 후기에서 진짜 참고한 부분과 아쉬웠던 부분`,
      `${brandCue}를 광고처럼 보이지 않게 비교해본 기준`,
      `${secondaryCue}를 직접 확인하며 신뢰가 생긴 포인트`,
      `${asObject(keyword)} 고르기 전 독자가 궁금해할 질문`,
      `${keyword} 경험담처럼 자연스럽게 정리하는 흐름`,
      `${brandCue}를 다시 찾아보게 만든 설명 포인트`,
      `${keyword} 선택 전 내가 먼저 확인한 주의점`,
      `${secondaryCue} 후기를 읽을 때 과장 없이 보는 법`,
      `${keyword} 정보가 오래 남는 글 구성`
    ],
    "상품 홍보": [
      `${brandCue}의 ${keyword} 장점을 경험처럼 풀어내는 방향`,
      `${asObject(keyword)} 써보고 싶게 만드는 사용 상황`,
      `${secondaryCue}와 함께 보여주면 좋은 비교 포인트`,
      `${keyword} 선택 이유를 독자 공감으로 연결하는 글`,
      `${brandCue}를 자연스럽게 떠올리게 하는 후기형 구성`,
      `${keyword} 장점을 루틴과 사용감 중심으로 보여주는 방법`,
      `${secondaryCue}를 통해 구매 전 확인할 부분 정리`,
      `${asObject(keyword)} 저장하고 싶게 만드는 정보 흐름`,
      `${brandCue}의 차이를 과장 없이 전달하는 포인트`
    ],
    "방문 유도": [
      `${keyword} 방문 전 저장해둘 실제 체크 포인트`,
      `${brandCue}를 직접 확인하고 싶게 만드는 후기 흐름`,
      `${secondaryCue}를 보고 문의 전 궁금했던 부분`,
      `${asObject(keyword)} 보러 가기 전 비교한 기준`,
      `${region}${asObject(keyword)} 찾는 독자가 확인할 정보`,
      `${keyword} 방문 고민을 줄여주는 경험형 정리`,
      `${brandCue} 문의 전 부담을 낮추는 체크리스트`,
      `${asObject(keyword)} 직접 확인해보고 싶게 만드는 포인트`,
      `${secondaryCue}에서 방문 결정까지 이어지는 흐름`
    ]
  };

  const topicsByGoal =
    audienceProfile.label === "인플루언서/수익형" ? influencerTopicsByGoal : businessTopicsByGoal;
  const pool = topicsByGoal[goal] ?? topicsByGoal["정보 전달"];
  const offset = getTopicVariationOffset(form, pool.length);
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  const candidates = Array.from(
    new Set(rotated.map((topic) => applyAvoidWords(topic, avoidWords)).filter(Boolean))
  );
  const freshTopics = candidates.filter((topic) => !previousTopics.has(topic));
  const fallbackTopics = candidates.filter((topic) => previousTopics.has(topic));

  return [...freshTopics, ...fallbackTopics].slice(0, 3);
}

export function createTitleCandidates(form, selectedTopic) {
  const keyword = getMainKeyword(form);
  const goal = text(form.goal);
  const brand = getBrandLabel(form);
  const region = text(form.region);
  const regionPhrase = getRegionPhrase(form);
  const audienceType = getAudienceType(form);
  const secondaryKeywords = getSecondaryKeywords(form);
  const secondaryCue = secondaryKeywords[0] || "선택 기준";
  const brandCue = getBrandKeywords(form)[0] || brand;
  const avoidWords = splitAvoidWords(form.avoid);
  const infoTitle =
    goal === "신뢰 형성"
      ? `${keyword} 선택 전 믿을 수 있는 기준`
      : `${keyword} 처음 알아볼 때 먼저 확인할 기준`;
  const localTitle = region
    ? `${regionPhrase}${keyword} 찾는다면 방문 전 확인할 것`
    : `${keyword} 선택 전 ${secondaryCue}까지 확인할 부분`;
  const comparisonTitle =
    goal === "상품 홍보"
      ? `${brandCue}의 ${keyword} 장점 비교할 때 볼 포인트`
      : `${keyword} 고르기 전 비교해야 할 포인트`;
  const clickTitle =
    audienceType === "인플루언서/수익형"
      ? goal === "방문 유도"
        ? `${keyword} 방문 전 저장해둘 실제 체크 포인트`
        : goal === "상품 홍보"
          ? `${keyword}, 다 비슷해 보여도 사용감은 다릅니다`
          : `${keyword}, 다 비슷해 보여도 확인할 부분은 다릅니다`
      : goal === "방문 유도"
        ? `${regionPhrase}${keyword} 방문 전 꼭 확인해야 할 3가지`
        : goal === "상품 홍보"
          ? `${keyword} 선택 전 놓치면 아쉬운 차이`
          : `${keyword}, 처음이라면 꼭 봐야 할 기준`;

  return Array.from(new Set([infoTitle, localTitle, comparisonTitle, clickTitle]))
    .map((title) => applyAvoidWords(title, avoidWords))
    .slice(0, 4);
}

const createImageSearchConfig = ({ searchKeyword, altText, orientation = "landscape" }) => ({
  provider: "pexels",
  status: "ready",
  searchKeyword,
  query: searchKeyword,
  locale: "ko-KR",
  orientation,
  perPage: 8,
  altText,
  imageUrl: "",
  thumbnailUrl: "",
  sourceUrl: "",
  photographer: ""
});

const IMAGE_QUERY_PRESETS = {
  "온라인 쇼핑몰": {
    hero: "ecommerce product photography workspace",
    scene: "online store product packaging laptop",
    detail: "product detail checklist desk",
    heroDescription: "상품 촬영 소품, 노트북, 패키지가 함께 보이는 쇼핑몰 작업 공간",
    sceneDescription: "상품 구성이나 상세페이지 작업 과정을 보여줄 수 있는 책상 위 작업 장면",
    detailDescription: "체크리스트, 상품 구성표, 노트북 화면처럼 비교 포인트를 정리한 장면"
  },
  "로컬 매장": {
    hero: "small business storefront interior",
    scene: "customer consultation local shop",
    detail: "store counter checklist notebook",
    heroDescription: "매장 입구, 카운터, 내부 분위기가 자연스럽게 보이는 공간 이미지",
    sceneDescription: "직원이 고객과 상담하거나 안내하는 실제 매장 응대 장면",
    detailDescription: "방문 전 확인할 내용을 적어둔 노트나 매장 안내 자료 장면"
  },
  "교육/강의": {
    hero: "tutoring classroom student notebook",
    scene: "teacher helping student study",
    detail: "study plan checklist notebook",
    heroDescription: "책상, 노트, 교재가 보이는 차분한 학습 공간 이미지",
    sceneDescription: "강사와 학생이 문제를 함께 보거나 학습 방향을 상담하는 장면",
    detailDescription: "오답 노트, 학습 계획표, 체크리스트가 보이는 공부 자료 이미지"
  },
  "전문 서비스": {
    hero: "business consultation meeting office",
    scene: "professional advisor client meeting",
    detail: "service checklist clipboard office",
    heroDescription: "상담 테이블, 노트북, 문서가 정돈된 전문 상담 공간",
    sceneDescription: "전문가가 고객에게 자료를 보여주며 설명하는 미팅 장면",
    detailDescription: "체크리스트나 상담 문서가 놓인 사무실 책상 장면"
  },
  "브랜드 콘텐츠": {
    hero: "brand storytelling workspace moodboard",
    scene: "creative planning team meeting",
    detail: "content strategy checklist desk",
    heroDescription: "무드보드, 노트북, 기획 자료가 놓인 브랜드 콘텐츠 작업 공간",
    sceneDescription: "콘텐츠 방향을 함께 논의하는 기획 회의 장면",
    detailDescription: "콘텐츠 캘린더, 체크리스트, 메모가 보이는 전략 기획 이미지"
  },
  기타: {
    hero: "small business consultation desk",
    scene: "customer service consultation meeting",
    detail: "business checklist notebook desk",
    heroDescription: "상담 책상과 노트북이 보이는 깔끔한 비즈니스 이미지",
    sceneDescription: "고객과 상담하며 필요한 내용을 설명하는 장면",
    detailDescription: "체크리스트, 메모, 노트북이 놓인 비교 정리 이미지"
  }
};

const getImageQueryPreset = (category) =>
  IMAGE_QUERY_PRESETS[text(category)] ?? IMAGE_QUERY_PRESETS.기타;

export function createImageSuggestions(form, selectedTopic, selectedTitle) {
  const keyword = getMainKeyword(form);
  const brand = getBrandLabel(form);
  const category = text(form.category);
  const strengths = getStrengths(form);
  const avoidWords = splitAvoidWords(form.avoid);
  const imagePreset = getImageQueryPreset(category);

  const suggestions = [
    {
      id: "image-slot-1",
      label: "이미지 추천 1",
      title: "대표 이미지",
      insertAfter: "도입부 다음",
      description: `${brand}의 첫인상이 보이도록 ${asObject(imagePreset.heroDescription)} 추천합니다. 공간, 제품, 상담 분위기가 한눈에 들어오는 컷이 좋습니다.`,
      searchKeyword: imagePreset.hero,
      query: imagePreset.hero,
      altText: `${brand} ${keyword} 대표 이미지`,
      previewUrl: "",
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
      description: `${strengths[0]} 같은 강점이 실제로 느껴지도록 ${asObject(imagePreset.sceneDescription)} 넣으면 좋습니다. 고객이 이용하거나 상담받는 자연스러운 분위기 컷을 우선 추천합니다.`,
      searchKeyword: imagePreset.scene,
      query: imagePreset.scene,
      altText: `${keyword} 상담 또는 사용 장면`,
      previewUrl: "",
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
      description: `본문 마무리 전에는 독자가 판단을 정리할 수 있게 ${asObject(imagePreset.detailDescription)} 배치하면 좋습니다. 체크리스트, 노트, 비교표처럼 검색 결과에서 바로 찾기 쉬운 이미지를 권장합니다.`,
      searchKeyword: imagePreset.detail,
      query: imagePreset.detail,
      altText: `${keyword} 체크리스트 비교 이미지`,
      previewUrl: "",
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
    description: applyAvoidWords(item.description, avoidWords),
    searchKeyword: applyAvoidWords(item.searchKeyword, avoidWords),
    query: applyAvoidWords(item.query, avoidWords),
    altText: applyAvoidWords(item.altText, avoidWords),
    imageSearch: createImageSearchConfig({
      searchKeyword: applyAvoidWords(item.query, avoidWords),
      altText: applyAvoidWords(item.altText, avoidWords),
      orientation: item.id === "image-slot-2" ? "portrait" : "landscape"
    })
  }));
}

const SERVICE_TAG_PRESETS = [
  {
    patterns: ["리프팅", "피부", "탄력", "에스테틱", "관리"],
    tags: ["피부관리샵", "에스테틱", "리프팅관리"],
    intentTags: ["방문전확인", "피부탄력관리", "리프팅상담"]
  },
  {
    patterns: ["학원", "수학", "영어", "공부", "교육", "강의"],
    tags: ["학원상담", "학습관리", "교육상담"],
    intentTags: ["방문전상담", "학습상담", "수업문의"]
  },
  {
    patterns: ["상세페이지", "스마트스토어", "쇼핑몰", "제품"],
    tags: ["온라인쇼핑몰", "상세페이지제작", "쇼핑몰운영"],
    intentTags: ["제작상담", "상세페이지기획", "매출개선"]
  },
  {
    patterns: ["브랜드", "콘텐츠", "마케팅", "블로그"],
    tags: ["브랜드콘텐츠", "콘텐츠기획", "블로그마케팅"],
    intentTags: ["콘텐츠상담", "브랜드기획", "마케팅전략"]
  }
];

const CATEGORY_TAG_PRESETS = {
  "온라인 쇼핑몰": ["온라인쇼핑몰", "상세페이지제작", "쇼핑몰운영"],
  "로컬 매장": ["로컬매장", "방문상담", "매장홍보"],
  "교육/강의": ["교육상담", "학습관리", "강의문의"],
  "전문 서비스": ["전문상담", "서비스상담", "고객상담"],
  "브랜드 콘텐츠": ["브랜드콘텐츠", "콘텐츠기획", "블로그마케팅"],
  기타: ["상담문의", "서비스안내", "방문전확인"]
};

const getServiceTagPreset = (keyword, category) => {
  const source = `${keyword} ${category}`;

  return (
    SERVICE_TAG_PRESETS.find((preset) => preset.patterns.some((pattern) => source.includes(pattern))) ?? {
      tags: CATEGORY_TAG_PRESETS[category] ?? CATEGORY_TAG_PRESETS.기타,
      intentTags: ["방문전확인", "상담문의", "선택기준"]
    }
  );
};

const createHashtagGroups = (form) => {
  const keyword = getMainKeyword(form);
  const secondaryKeywords = getSecondaryKeywords(form);
  const brandKeywords = getBrandKeywords(form);
  const category = text(form.category);
  const brand = text(form.brandName) || brandKeywords[0] || "";
  const region = text(form.region);
  const goal = text(form.goal);
  const regionTokens = getRegionTokens(region);
  const regionCompact = regionTokens[0] || "";
  const localName = regionTokens.at(-1) || regionCompact;
  const servicePreset = getServiceTagPreset(keyword, category);
  const serviceTags = servicePreset.tags;
  const intentTags = Array.from(
    new Set([
      goal === "방문 유도" ? "방문전확인" : goal === "신뢰 형성" ? "신뢰상담" : "선택기준",
      ...servicePreset.intentTags
    ])
  );
  const longTailTags = [
    `${keyword}선택기준`,
    `${keyword}방문전확인`,
    secondaryKeywords[0] || "",
    secondaryKeywords[1] || "",
    brand ? `${brand}${keyword}` : `${keyword}상담`
  ];

  const groups = [
    {
      id: "main",
      label: "메인 키워드",
      description: "검색 중심이 되는 대표 태그",
      tags: [toHashTag(keyword)]
    },
    {
      id: "region",
      label: "지역 조합",
      description: "지역명과 서비스를 함께 찾는 검색 패턴",
      tags: [
        regionCompact && `${regionCompact}${keyword}`,
        localName && serviceTags[0] ? `${localName}${serviceTags[0]}` : "",
        localName && keyword ? `${localName}${keyword}` : ""
      ].map(toHashTag)
    },
    {
      id: "category",
      label: "업종/서비스",
      description: "업종과 서비스 범위를 설명하는 태그",
      tags: [category, ...serviceTags].map(toHashTag)
    },
    {
      id: "intent",
      label: "검색 의도",
      description: "방문, 상담, 비교처럼 사용자가 실제 검색하는 목적",
      tags: intentTags.map(toHashTag)
    },
    {
      id: "brand",
      label: "브랜드/매장명",
      description: "상호명 검색과 재방문 유입을 위한 태그",
      tags: [brand].map(toHashTag)
    },
    {
      id: "longtail",
      label: "롱테일 보조 태그",
      description: "구체적인 고민과 행동 의도를 담은 보조 태그",
      tags: longTailTags.map(toHashTag)
    }
  ];

  return groups
    .map((group) => ({
      ...group,
      tags: Array.from(new Set(group.tags.filter(Boolean))).slice(0, group.id === "main" ? 1 : 3)
    }))
    .filter((group) => group.tags.length > 0);
};

const flattenHashtagGroups = (groups) =>
  Array.from(new Set(groups.flatMap((group) => group.tags))).slice(0, 14);

const getFirstParagraph = (body) => text(String(body ?? "").split(/\n{2,}/)[0]);

const getFirstSentence = (body) =>
  getFirstParagraph(body)
    .replace(/^✨\s*/u, "")
    .split(/(?<=[.!?요다])\s+/u)[0] || "";

const inferSearchIntentTitleType = (title, region) => {
  const source = text(title);

  if (region && source.includes(region)) return "지역형";
  if (source.includes("비교")) return "비교형";
  if (source.includes("처음") || source.includes("기준") || source.includes("확인")) return "정보형";
  if (source.includes("다릅니다") || source.includes("놓치")) return "클릭형";

  return "";
};

const createSeoCheck = (form, body, outlineSections, hashtags, selectedCtaSentence, selectedTitle = "") => {
  const keyword = getMainKeyword(form);
  const secondaryKeywords = getSecondaryKeywords(form);
  const region = text(form.region);
  const avoidWords = splitAvoidWords(form.avoid);
  const firstParagraph = getFirstParagraph(body);
  const title = text(selectedTitle);
  const firstParagraphCount = countKeywordOccurrences(firstParagraph, keyword);
  const actualOccurrences = countKeywordOccurrences(body, keyword);
  const targetOccurrences = resolveKeywordOccurrenceRange(resolveTargetLength(form));
  const regionTokens = getRegionTokens(region);
  const combinedForChecks = [body, ...hashtags].join(" ");
  const compactCombined = compact(combinedForChecks);
  const outlineCount = normalizeOutlineSections(outlineSections).length;
  const expectedOutlineCount = getOutlineSectionCount(form);
  const secondaryMatches = secondaryKeywords.filter((keywordItem) =>
    compactCombined.includes(compact(keywordItem))
  );
  const hasFaqQuestion = /무엇을|어떤 사람|어떻게|확인해야 하나요|맞나요|좋나요|\?/u.test(body);
  const forbiddenFound = avoidWords.filter((word) => combinedForChecks.includes(word));
  const items = [
    {
      id: "title-main-keyword",
      label: "메인 키워드 제목 반영",
      passed: Boolean(title && title.includes(keyword)),
      detail: title || "선택 제목 없음"
    },
    {
      id: "first-paragraph-keyword",
      label: "메인 키워드 첫 문단 반영",
      passed: firstParagraphCount >= 1,
      detail: `첫 문단 ${firstParagraphCount}회`
    },
    {
      id: "secondary-keywords",
      label: "보조 키워드 자연 반영",
      passed: secondaryKeywords.length === 0 || secondaryMatches.length > 0,
      detail:
        secondaryKeywords.length === 0
          ? "보조 키워드 없음"
          : `${secondaryMatches.length}/${secondaryKeywords.length}개 반영`
    },
    {
      id: "outline-count",
      label: "목표 글자수에 맞는 소제목 수",
      passed: outlineCount === expectedOutlineCount,
      detail: `${outlineCount}개 / 목표 ${expectedOutlineCount}개`
    },
    {
      id: "keyword-overuse",
      label: "동일 키워드 과다 반복 없음",
      passed: actualOccurrences >= 2 && actualOccurrences <= targetOccurrences.max + 2,
      detail: `전체 ${actualOccurrences}회 / 권장 ${targetOccurrences.min}-${targetOccurrences.max}회`
    },
    {
      id: "search-intent-title",
      label: "검색 의도에 맞는 제목 유형",
      passed: Boolean(inferSearchIntentTitleType(title, region)),
      detail: inferSearchIntentTitleType(title, region) || "제목 유형 확인 필요"
    },
    {
      id: "faq-question",
      label: "FAQ/질문형 문장 포함",
      passed: hasFaqQuestion,
      detail: hasFaqQuestion ? "질문에 답하는 문장 포함" : "질문형 문장 없음"
    },
    {
      id: "region",
      label: "지역명 반영",
      passed: !region || regionTokens.some((token) => compactCombined.includes(token)),
      detail: region ? `${region} 반영 확인` : "지역 입력값 없음"
    },
    {
      id: "cta",
      label: "CTA 반영",
      passed: Boolean(selectedCtaSentence && body.includes(selectedCtaSentence)),
      detail: selectedCtaSentence || "선택 CTA 없음"
    },
    {
      id: "avoid",
      label: "금지어 포함 여부",
      passed: forbiddenFound.length === 0,
      detail: forbiddenFound.length > 0 ? forbiddenFound.join(", ") : "금지어 없음"
    }
  ];

  return {
    passedCount: items.filter((item) => item.passed).length,
    totalCount: items.length,
    items
  };
};

const createGoalBlocks = (form, selectedTopic, selectedTitle) => {
  const keyword = getMainKeyword(form);
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

const buildPostBody = (form, selectedTopic, selectedTitle, outlineSections, writingChoices) => {
  return createReaderFacingPostBody(form, selectedTopic, selectedTitle, outlineSections, writingChoices);
};

const createStrategyMemo = (
  form,
  selectedTopic,
  selectedTitle,
  outlineSections,
  body,
  imageSuggestions,
  keywordOptimization,
  seoCheck
) => ({
  adminOnly: true,
  goalTemplate: GOAL_LABELS[form.goal] ?? "정보 전달형",
  audienceType: getAudienceType(form),
  selectedTopic,
  selectedTitle,
  outlineSections,
  writingDirection: {
    audience: getAudienceProfile(form).readerLabel,
    coreMessage: getEmphasis(form),
    strengths: getStrengths(form),
    ctaDirection: getCta(form),
    selectedOpeningSentence: keywordOptimization.selectedOpeningSentence,
    selectedCtaSentence: keywordOptimization.selectedCtaSentence
  },
  keywordMemo: {
    mainKeyword: keywordOptimization.mainKeyword,
    secondaryKeywords: keywordOptimization.secondaryKeywords,
    brandKeywords: keywordOptimization.brandKeywords,
    actualOccurrences: keywordOptimization.actualOccurrences,
    targetOccurrences: keywordOptimization.targetOccurrences,
    relatedExpressions: keywordOptimization.relatedExpressions,
    placementHints: keywordOptimization.placementHints
  },
  seoCheck,
  imageBridgeMemo: imageSuggestions.map((item) => ({
    id: item.id,
    slot: item.bridge.slot,
    insertAfter: item.insertAfter,
    description: item.description,
    searchKeyword: item.searchKeyword,
    query: item.query,
    imageProvider: item.imageSearch?.provider
  })),
  bodyLength: body.length
});

export function createFinalContent(
  form,
  selectedTopic,
  selectedTitle,
  outlineSections = [],
  writingChoices = {}
) {
  const keyword = getMainKeyword(form);
  const category = text(form.category);
  const goal = text(form.goal);
  const tone = text(form.tone);
  const avoidWords = splitAvoidWords(form.avoid);
  const keywordPlan = createKeywordOptimizationPlan(form);
  const resolvedOutline = normalizeOutlineSections(outlineSections);
  const finalOutline =
    resolvedOutline.length >= 3 ? resolvedOutline : createOutlineSections(form, selectedTopic, selectedTitle);
  const openingSentenceCandidates = createOpeningSentenceCandidates(form);
  const ctaCandidates = createCtaCandidates(form);
  const selectedOpeningSentence =
    text(writingChoices.selectedOpeningSentence) ||
    text(form.selectedOpeningSentence) ||
    openingSentenceCandidates[0];
  const selectedCtaSentence =
    text(writingChoices.selectedCtaSentence) || text(form.selectedCtaSentence) || ctaCandidates[0];
  const imageSuggestions = createImageSuggestions(form, selectedTopic, selectedTitle);
  const hashtagGroups = createHashtagGroups(form);
  const hashtags = flattenHashtagGroups(hashtagGroups);
  const postBody = applyAvoidWords(
    buildPostBody(form, selectedTopic, selectedTitle, finalOutline, {
      selectedOpeningSentence,
      selectedCtaSentence
    }),
    avoidWords
  );
  const keywordOptimization = {
    ...keywordPlan,
    actualOccurrences: countKeywordOccurrences(postBody, keyword),
    selectedOpeningSentence,
    selectedCtaSentence
  };
  const seoCheck = createSeoCheck(form, postBody, finalOutline, hashtags, selectedCtaSentence, selectedTitle);
  const strategyMemo = createStrategyMemo(
    form,
    selectedTopic,
    selectedTitle,
    finalOutline,
    postBody,
    imageSuggestions,
    keywordOptimization,
    seoCheck
  );

  return {
    outlineSections: finalOutline,
    openingSentenceCandidates,
    selectedOpeningSentence,
    ctaCandidates,
    selectedCtaSentence,
    body: postBody,
    hashtags,
    hashtagGroups,
    seoCheck,
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
  const outlineSections = createOutlineSections(form, selectedTopic, selectedTitle);
  const finalContent = createFinalContent(form, selectedTopic, selectedTitle, outlineSections);

  return {
    topics,
    selectedTopic,
    titles,
    selectedTitle,
    outlineSections,
    ...finalContent
  };
}
