export const COMMENT_TYPES = [
  "칭찬형",
  "공감형",
  "경험공유형",
  "질문형",
  "방문의사형",
  "짧은반응형",
  "불만/민감형",
  "광고/스팸형",
  "의미불명형"
];

export const COMMENT_REPLY_STATUSES = ["대기", "생성 완료", "검토 필요", "스킵 권장"];

export const DUPLICATE_RISKS = ["중복 위험 낮음", "중복 주의", "재생성 권장"];

export const DEFAULT_REPLY_FORBIDDEN_WORDS = ["최고", "무조건", "보장"];

const TITLE_STOP_WORDS = new Set([
  "처음",
  "방문",
  "방문전",
  "전",
  "후",
  "확인",
  "확인할",
  "기준",
  "체크",
  "포인트",
  "추천",
  "후기",
  "정리",
  "방법",
  "주의",
  "선택",
  "가이드",
  "비교",
  "가격",
  "비용",
  "좋은",
  "있는",
  "위한",
  "알아보기",
  "꿀팁"
]);

const COMMENT_STOP_WORDS = new Set([
  "여기",
  "저기",
  "그냥",
  "정말",
  "너무",
  "많이",
  "댓글",
  "포스팅",
  "블로그",
  "같아요",
  "보여요",
  "합니다",
  "했어요",
  "있어요",
  "주세요",
  "감사합니다"
]);

const TYPE_TERMS = {
  spam: [
    "http://",
    "https://",
    "무료체험",
    "부업",
    "대출",
    "카지노",
    "도박",
    "성인",
    "광고",
    "홍보",
    "협찬문의",
    "문의주세요",
    "카톡",
    "오픈채팅"
  ],
  sensitive: [
    "별로",
    "실망",
    "불만",
    "환불",
    "비싸",
    "사기",
    "최악",
    "과장",
    "효과없",
    "효과 없",
    "아파",
    "아프",
    "불친절",
    "민원",
    "문제",
    "부작용"
  ],
  question: [
    "궁금",
    "얼마",
    "가격",
    "비용",
    "예약",
    "어디",
    "가능",
    "되나요",
    "될까요",
    "인가요",
    "인가",
    "몇",
    "언제",
    "시간",
    "주차",
    "어떻게",
    "방법"
  ],
  visit: ["가보고", "가볼", "방문", "예약하고", "예약해", "들러", "상담받", "상담 받고", "가야겠"],
  experience: ["저도", "제가", "예전에", "다녀왔", "받아봤", "써봤", "해봤", "경험", "이용해", "관리받"],
  praise: ["꼼꼼", "좋", "깔끔", "예쁘", "유용", "도움", "만족", "믿음", "신뢰", "자세", "정리", "친절"],
  empathy: ["맞아요", "공감", "인정", "그러게", "그쵸", "그렇죠", "맞는", "맞네요"]
};

const text = (value) => String(value ?? "").trim();

const normalizeSpaces = (value) => text(value).replace(/\s+/g, " ");

const compact = (value) => normalizeSpaces(value).replace(/\s+/g, "").toLowerCase();

const includesAny = (value, terms = []) => {
  const normalized = compact(value);
  return terms.some((term) => normalized.includes(compact(term)));
};

const unique = (items) => Array.from(new Set(items.map(text).filter(Boolean)));

const splitList = (value) =>
  unique(
    text(value)
      .split(/[\n,]/u)
      .map((item) => item.trim())
  );

const tokenize = (value) =>
  normalizeSpaces(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);

const getAuthor = (comment = {}) => text(comment.author || comment.writer || comment.nickname);

const getContent = (comment = {}) => text(comment.content || comment.comment || comment.body || comment.text);

export function createMainKeywordCandidates(postTitle = "") {
  const tokens = tokenize(postTitle).filter((token) => {
    const normalized = compact(token);
    return normalized.length > 1 && !TITLE_STOP_WORDS.has(normalized);
  });

  const candidates = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    candidates.push(`${tokens[index]} ${tokens[index + 1]}`);
  }

  tokens
    .filter((token) => /관리|리프팅|상담|시술|맛집|카페|학원|청소|이사|피부|운동/u.test(token))
    .forEach((token) => {
      if (!/(관리|샵|매장|센터|학원|카페|맛집)$/u.test(token)) candidates.push(`${token} 관리`);
    });

  for (let index = 0; index < tokens.length - 2; index += 1) {
    candidates.push(`${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`);
  }

  return unique(candidates).slice(0, 5);
}

export function resolveMainKeyword(form = {}) {
  return text(form.mainKeyword) || createMainKeywordCandidates(form.postTitle || form.title)[0] || "";
}

export function splitForbiddenWords(form = {}) {
  return unique([...DEFAULT_REPLY_FORBIDDEN_WORDS, ...splitList(form.forbiddenWords || form.avoid)]);
}

export function splitOwnerAliases(form = {}) {
  return unique([form.ownerNickname, ...splitList(form.ownerAliases)]);
}

export function parseManualComments(raw = "") {
  const lines = String(raw || "")
    .replace(/\r/g, "")
    .split("\n");
  const comments = [];
  let current = { author: "", content: "" };

  const flush = () => {
    if (!text(current.author) && !text(current.content)) return;

    comments.push({
      id: `comment-${Date.now()}-${comments.length + 1}`,
      author: text(current.author) || "작성자 미입력",
      content: normalizeSpaces(current.content),
      source: "manual",
      hasOwnerReply: false,
      status: "대기"
    });
    current = { author: "", content: "" };
  };

  lines.forEach((rawLine) => {
    const line = text(rawLine);

    if (!line) {
      flush();
      return;
    }

    const authorMatch = line.match(/^(작성자|닉네임|author|writer)\s*[:：]\s*(.+)$/iu);
    if (authorMatch) {
      if (text(current.content)) flush();
      current.author = authorMatch[2];
      return;
    }

    const commentMatch = line.match(/^(댓글|원댓글|comment|body)\s*[:：]\s*(.+)$/iu);
    if (commentMatch) {
      current.content = normalizeSpaces([current.content, commentMatch[2]].filter(Boolean).join(" "));
      return;
    }

    const inlineMatch = line.match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/u);
    if (inlineMatch && !/^https?:\/\//iu.test(line)) {
      if (text(current.content)) flush();
      comments.push({
        id: `comment-${Date.now()}-${comments.length + 1}`,
        author: text(inlineMatch[1]) || "작성자 미입력",
        content: normalizeSpaces(inlineMatch[2]),
        source: "manual",
        hasOwnerReply: false,
        status: "대기"
      });
      current = { author: "", content: "" };
      return;
    }

    current.content = normalizeSpaces([current.content, line].filter(Boolean).join(" "));
  });

  flush();
  return comments.filter((comment) => getContent(comment));
}

export function classifyComment(value = "") {
  const content = normalizeSpaces(value);
  const compacted = compact(content);
  const hasHangulOrAlpha = /[\p{L}\p{N}]/u.test(content);

  if (!content || !hasHangulOrAlpha) return "의미불명형";
  if (includesAny(compacted, TYPE_TERMS.spam)) return "광고/스팸형";
  if (includesAny(compacted, TYPE_TERMS.sensitive)) return "불만/민감형";
  if (content.includes("?") || includesAny(compacted, TYPE_TERMS.question)) return "질문형";
  if (includesAny(compacted, TYPE_TERMS.visit)) return "방문의사형";
  if (includesAny(compacted, TYPE_TERMS.experience)) return "경험공유형";
  if (includesAny(compacted, TYPE_TERMS.empathy)) return "공감형";
  if (includesAny(compacted, TYPE_TERMS.praise)) return "칭찬형";
  if (tokenize(content).length <= 3 || Array.from(content).length <= 14) return "짧은반응형";

  return "공감형";
}

export function inferCommentIntent(type, content = "") {
  const normalized = compact(content);

  if (type === "광고/스팸형") return "답변보다 스킵이 적합한 홍보성 댓글";
  if (type === "불만/민감형") return "불편하거나 예민한 지점 공유";
  if (type === "질문형") {
    if (normalized.includes("가격") || normalized.includes("비용") || normalized.includes("얼마")) {
      return "가격 또는 비용 확인";
    }
    if (normalized.includes("예약") || normalized.includes("시간")) return "예약 가능 여부 확인";
    if (normalized.includes("주차")) return "방문 편의 정보 확인";
    return "궁금한 점 확인";
  }
  if (type === "방문의사형") return "방문 또는 상담 관심";
  if (type === "경험공유형") return "본인 경험 공유";
  if (type === "칭찬형") return "포스팅 또는 매장에 대한 긍정 반응";
  if (type === "공감형") return "내용에 대한 공감";
  if (type === "짧은반응형") return "짧은 호응";
  return "의도를 분명히 파악하기 어려움";
}

export function inferSentiment(type) {
  if (type === "불만/민감형") return "주의";
  if (type === "광고/스팸형" || type === "의미불명형") return "중립";
  if (type === "질문형" || type === "방문의사형") return "관심";
  return "긍정";
}

export function extractCoreKeywords(content = "", form = {}) {
  const mainKeyword = resolveMainKeyword(form);
  const keywordTokens = tokenize(mainKeyword);
  const commentTokens = tokenize(content)
    .map((token) => token.replace(/(은|는|이|가|을|를|도|만|요|요)$/u, ""))
    .filter((token) => token.length > 1 && !COMMENT_STOP_WORDS.has(compact(token)));
  const relatedKeywordTokens = keywordTokens.filter((token) => compact(content).includes(compact(token)));

  return unique([...relatedKeywordTokens, ...commentTokens]).slice(0, 4);
}

function isOwnerComment(comment = {}, form = {}) {
  const author = compact(getAuthor(comment));
  if (!author) return false;

  return splitOwnerAliases(form).some((alias) => author === compact(alias));
}

function isKeywordRelevant(content = "", mainKeyword = "") {
  if (!mainKeyword) return false;

  const keywordTokens = tokenize(mainKeyword).filter((token) => token.length > 1);
  const normalized = compact(content);

  if (keywordTokens.some((token) => normalized.includes(compact(token)))) return true;

  return includesAny(normalized, [
    "관리",
    "상담",
    "방문",
    "예약",
    "후기",
    "기준",
    "꼼꼼",
    "궁금",
    "가격",
    "비용",
    "정보",
    "도움",
    "매장",
    "샵"
  ]);
}

function shouldUseKeyword(type, content, mainKeyword, sequence = 0) {
  if (!mainKeyword || ["광고/스팸형", "불만/민감형", "의미불명형", "짧은반응형"].includes(type)) {
    return false;
  }

  if (!isKeywordRelevant(content, mainKeyword)) return false;

  return sequence % 2 === 0 || tokenize(mainKeyword).some((token) => compact(content).includes(compact(token)));
}

function getQuestionAnswer(content = "", audienceType = "") {
  const normalized = compact(content);
  const isBusiness = audienceType === "사업자/매장 홍보";

  if (normalized.includes("가격") || normalized.includes("비용") || normalized.includes("얼마")) {
    return isBusiness
      ? "가격이나 구성은 목적에 따라 달라질 수 있어요."
      : "가격대는 구성이나 목적에 따라 차이가 있을 수 있어요.";
  }

  if (normalized.includes("예약") || normalized.includes("시간")) {
    return isBusiness
      ? "예약 가능 시간은 일정에 따라 달라질 수 있어요."
      : "예약이나 운영 시간은 방문 전에 한 번 확인해보는 편이 좋더라고요.";
  }

  if (normalized.includes("주차")) {
    return "주차 가능 여부는 지점이나 시간대에 따라 달라질 수 있어서 방문 전 확인이 가장 정확해요.";
  }

  if (normalized.includes("어디") || normalized.includes("위치")) {
    return "위치는 포스팅의 지도나 주소 기준으로 확인해보시면 됩니다.";
  }

  return isBusiness
    ? "문의하신 부분은 방문 목적에 맞춰 먼저 확인해보시면 좋습니다."
    : "그 부분은 목적에 맞는 기준부터 확인해보면 판단하기가 조금 더 쉬워요.";
}

function getSoftCta(form = {}) {
  const ctaTone = text(form.ctaTone || form.ctaDirection);
  if (!ctaTone) return "";

  return createSentence(ctaTone);
}

function createSentence(value = "") {
  const sentence = normalizeSpaces(value);
  if (!sentence) return "";
  if (/[.!?요다]$/u.test(sentence)) return sentence;
  return `${sentence}.`;
}

function getCorePhrase(coreKeywords = []) {
  return coreKeywords[0] || "남겨주신 부분";
}

function keywordSentence(mainKeyword, type, audienceType) {
  if (!mainKeyword) return "";

  if (type === "질문형") return `${mainKeyword}은 상담 흐름과 확인 기준을 같이 보는 게 도움이 됩니다.`;
  if (type === "방문의사형") return `${mainKeyword}을 알아보는 중이라면 방문 전 기준을 가볍게 확인해보셔도 좋습니다.`;
  if (audienceType === "사업자/매장 홍보") {
    return `${mainKeyword}은 처음 보시는 분들도 흐름을 이해하기 쉽게 안내드리는 게 중요하다고 보고 있습니다.`;
  }

  return `${mainKeyword}은 상담과 관리 흐름이 자연스럽게 이어지는지가 중요하더라고요.`;
}

function createReplyCandidates({ type, content, form, coreKeywords, mainKeyword, useKeyword }) {
  const audienceType = text(form.audienceType) || "사업자/매장 홍보";
  const tone = text(form.tone) || "친근한";
  const isBusiness = audienceType === "사업자/매장 홍보";
  const core = getCorePhrase(coreKeywords);
  const keyLine = useKeyword ? keywordSentence(mainKeyword, type, audienceType) : "";
  const softCta = getSoftCta(form);
  const questionAnswer = getQuestionAnswer(content, audienceType);
  const thanks = tone === "전문적인" ? "감사합니다" : tone === "활기찬" ? "감사해요" : "고맙습니다";

  if (type === "광고/스팸형") return [];

  if (type === "불만/민감형") {
    return [
      `말씀해주신 부분은 조심스럽게 확인해보겠습니다. 불편하게 느껴질 수 있는 지점까지 남겨주셔서 ${thanks}.`,
      `남겨주신 의견은 가볍게 넘기지 않고 살펴보겠습니다. 표현이 과해지지 않도록 차분히 확인하겠습니다.`,
      `그렇게 느끼실 수 있는 부분도 있다고 생각합니다. 공유해주신 내용은 참고해서 더 신중히 보겠습니다.`
    ];
  }

  if (type === "질문형") {
    return isBusiness
      ? [
          `${questionAnswer} ${softCta || `궁금한 부분은 편하게 확인해드리겠습니다.`}`,
          `${questionAnswer} ${keyLine || "처음 문의하셔도 필요한 내용부터 차근차근 안내드리겠습니다."}`,
          `${questionAnswer} 남겨주신 질문처럼 미리 확인하면 방문 전 판단이 훨씬 편해집니다.`
        ]
      : [
          `${questionAnswer} 궁금한 포인트 짚어주셔서 ${thanks}.`,
          `${questionAnswer} ${keyLine || "저도 이런 부분은 미리 확인하는 편이 마음이 놓였어요."}`,
          `${questionAnswer} 댓글로 물어봐주신 부분이라 다른 분들께도 도움이 될 것 같아요.`
        ];
  }

  if (type === "방문의사형") {
    return isBusiness
      ? [
          `관심 가져주셔서 ${thanks}. 처음 방문하시는 분들도 편하게 상담받으실 수 있도록 신경 쓰고 있습니다.`,
          `${keyLine || "방문 전 궁금한 부분만 먼저 확인하셔도 부담이 줄어듭니다."} ${softCta || "편한 때에 필요한 내용부터 확인해보세요."}`,
          `반갑게 봐주셔서 ${thanks}. 방문 전에는 목적과 일정만 간단히 정리해오셔도 안내가 더 수월합니다.`
        ]
      : [
          `관심 생기셨다면 방문 전 기준을 한 번 확인해보셔도 좋을 것 같아요. 좋게 봐주셔서 ${thanks}.`,
          `${keyLine || "저도 직접 알아볼 때는 상담 흐름을 먼저 봤어요."} 댓글 남겨주셔서 ${thanks}.`,
          `가보고 싶다는 말이 제일 반갑네요. 부담 없이 비교해보고 맞는지 확인해보시면 좋겠습니다.`
        ];
  }

  if (type === "경험공유형") {
    return isBusiness
      ? [
          `직접 경험까지 나눠주셔서 ${thanks}. 말씀해주신 부분처럼 실제 응대 흐름이 만족도에 큰 영향을 주는 것 같습니다.`,
          `경험을 남겨주셔서 도움이 됩니다. 앞으로도 처음부터 끝까지 편하게 느끼실 수 있도록 챙기겠습니다.`,
          `${core}에 대해 직접 느낀 점을 공유해주셔서 ${thanks}. 다른 분들께도 참고가 될 것 같아요.`
        ]
      : [
          `저도 그 부분이 꽤 인상적이었어요. 경험까지 나눠주셔서 ${thanks}.`,
          `직접 겪어본 이야기가 더 와닿죠. 댓글로 함께 남겨주셔서 ${thanks}.`,
          `${core}에 공감해주셔서 반가웠어요. 저도 후기 남길 때 그 부분을 꼭 담고 싶었습니다.`
        ];
  }

  if (type === "칭찬형") {
    return isBusiness
      ? [
          `${keyLine || `${core}을 좋게 봐주셔서 ${thanks}.`} 앞으로도 편하게 확인하실 수 있도록 꼼꼼히 챙기겠습니다.`,
          `좋게 봐주셔서 ${thanks}. 처음 보시는 분들도 핵심을 편하게 파악하실 수 있게 신경 쓰고 있습니다.`,
          `${core} 부분을 알아봐주셔서 ${thanks}. 실제로 그런 세부 흐름이 만족도에 중요하다고 생각합니다.`
        ]
      : [
          `${keyLine || `${core}을 좋게 봐주셔서 ${thanks}.`} 저도 그 부분이 가장 인상적이었어요.`,
          `좋게 봐주셔서 ${thanks}. 저도 정리하면서 ${core}이 특히 눈에 들어왔습니다.`,
          `${core} 부분을 알아봐주셔서 반가워요. 후기에서 꼭 남기고 싶었던 지점이었어요.`
        ];
  }

  if (type === "공감형") {
    return [
      `맞아요, 저도 그 부분이 중요하다고 느꼈습니다. 공감해주셔서 ${thanks}.`,
      `${core}에 공감해주셔서 반가워요. 짧게 남겨주신 말도 힘이 됩니다.`,
      `저도 같은 생각이에요. 이런 기준을 같이 봐주시면 훨씬 판단하기 쉬운 것 같습니다.`
    ];
  }

  if (type === "짧은반응형") {
    return [
      `좋게 봐주셔서 ${thanks}.`,
      `댓글 남겨주셔서 ${thanks}.`,
      `짧게라도 반응 남겨주셔서 반갑습니다.`
    ];
  }

  return [
    `댓글 남겨주셔서 ${thanks}. 남겨주신 내용은 확인해두겠습니다.`,
    `읽고 반응 남겨주셔서 ${thanks}. 필요한 부분만 차분히 참고해보시면 좋겠습니다.`,
    `들러주셔서 ${thanks}. 남겨주신 댓글도 잘 확인했습니다.`
  ];
}

function wordsForSimilarity(value = "") {
  return unique(
    tokenize(value)
      .map((word) => compact(word))
      .filter((word) => word.length > 1)
  );
}

function jaccardSimilarity(a = "", b = "") {
  const aWords = wordsForSimilarity(a);
  const bWords = wordsForSimilarity(b);
  if (!aWords.length || !bWords.length) return 0;

  const bSet = new Set(bWords);
  const intersection = aWords.filter((word) => bSet.has(word)).length;
  const union = new Set([...aWords, ...bWords]).size;

  return intersection / union;
}

function getReplyStart(value = "") {
  return normalizeSpaces(value).slice(0, 10);
}

export function assessDuplicateRisk(reply = "", previousReplies = []) {
  const normalizedReply = normalizeSpaces(reply);
  const comparableReplies = previousReplies.map(normalizeSpaces).filter(Boolean);

  if (!normalizedReply || comparableReplies.length === 0) return "중복 위험 낮음";

  const start = getReplyStart(normalizedReply);
  const sameStart = comparableReplies.some((previous) => getReplyStart(previous) === start);
  const maxSimilarity = Math.max(...comparableReplies.map((previous) => jaccardSimilarity(normalizedReply, previous)));

  if (sameStart || maxSimilarity >= 0.58) return "재생성 권장";
  if (maxSimilarity >= 0.36) return "중복 주의";

  return "중복 위험 낮음";
}

export function findForbiddenWords(reply = "", forbiddenWords = []) {
  const normalizedReply = compact(reply);
  return forbiddenWords.filter((word) => word && normalizedReply.includes(compact(word)));
}

function chooseReply(candidates = [], previousReplies = [], seed = 0) {
  if (!candidates.length) return "";

  const rotated = candidates.map((_, index) => candidates[(index + seed) % candidates.length]);
  const lowRisk = rotated.find((candidate) => assessDuplicateRisk(candidate, previousReplies) === "중복 위험 낮음");

  return lowRisk || rotated[0];
}

export function normalizeComment(comment = {}, index = 0) {
  return {
    id: text(comment.id) || `comment-${Date.now()}-${index + 1}`,
    author: getAuthor(comment) || "작성자 미입력",
    content: getContent(comment),
    source: comment.source || "manual",
    hasOwnerReply: Boolean(comment.hasOwnerReply),
    type: comment.type || "",
    sentiment: comment.sentiment || "",
    intent: comment.intent || "",
    coreKeywords: Array.isArray(comment.coreKeywords) ? comment.coreKeywords : [],
    reply: text(comment.reply),
    mainKeywordUsed: Boolean(comment.mainKeywordUsed),
    forbiddenWordsFound: Array.isArray(comment.forbiddenWordsFound) ? comment.forbiddenWordsFound : [],
    duplicateRisk: comment.duplicateRisk || "중복 위험 낮음",
    status: comment.status || "대기",
    skipReason: comment.skipReason || ""
  };
}

export function createCommentReplyForOne(form = {}, comment = {}, previousReplies = [], options = {}) {
  const normalizedComment = normalizeComment(comment, options.sequence || 0);
  const content = normalizedComment.content;
  const mainKeyword = resolveMainKeyword(form);
  const keywordCandidates = createMainKeywordCandidates(form.postTitle || form.title);
  const forbiddenWords = splitForbiddenWords(form);
  const type = classifyComment(content);
  const sentiment = inferSentiment(type);
  const intent = inferCommentIntent(type, content);
  const coreKeywords = extractCoreKeywords(content, { ...form, mainKeyword });
  const ownerComment = isOwnerComment(normalizedComment, form);
  const hasOwnerReply = normalizedComment.hasOwnerReply;
  const skipReason = ownerComment
    ? "내 계정이 작성한 원댓글"
    : hasOwnerReply
      ? "이미 내 계정 대댓글 있음"
      : type === "광고/스팸형"
        ? "광고/스팸 댓글"
        : "";

  if (skipReason) {
    return {
      ...normalizedComment,
      type,
      sentiment,
      intent,
      coreKeywords,
      reply: "",
      mainKeyword,
      keywordCandidates,
      mainKeywordUsed: false,
      forbiddenWordsFound: [],
      duplicateRisk: "중복 위험 낮음",
      status: "스킵 권장",
      skipReason
    };
  }

  const sequence = Number.isFinite(options.sequence) ? options.sequence : 0;
  const seed = Number.isFinite(options.seed) ? options.seed : sequence + (normalizedComment.reply ? 1 : 0);
  const useKeyword = shouldUseKeyword(type, content, mainKeyword, sequence + seed);
  const candidates = createReplyCandidates({
    type,
    content,
    form,
    coreKeywords,
    mainKeyword,
    useKeyword
  });
  const reply = chooseReply(candidates, previousReplies, seed);
  const forbiddenWordsFound = findForbiddenWords(reply, forbiddenWords);
  const duplicateRisk = assessDuplicateRisk(reply, previousReplies);
  const needsReview =
    forbiddenWordsFound.length > 0 ||
    duplicateRisk === "재생성 권장" ||
    type === "불만/민감형" ||
    type === "의미불명형";

  return {
    ...normalizedComment,
    type,
    sentiment,
    intent,
    coreKeywords,
    reply,
    mainKeyword,
    keywordCandidates,
    mainKeywordUsed: Boolean(mainKeyword && reply.includes(mainKeyword)),
    forbiddenWordsFound,
    duplicateRisk,
    status: needsReview ? "검토 필요" : "생성 완료",
    skipReason: ""
  };
}

export function createCommentReplyBatch(form = {}, comments = [], options = {}) {
  const previousReplies = Array.isArray(options.previousReplies) ? [...options.previousReplies] : [];

  return comments.map((comment, index) => {
    const generated = createCommentReplyForOne(form, comment, previousReplies, {
      sequence: index,
      seed: Number(options.seed || 0) + index
    });

    if (generated.reply) previousReplies.push(generated.reply);
    return generated;
  });
}

export function createCommentCollectionBridge() {
  return {
    mode: "url-adaptor",
    status: "not_connected",
    supports: ["manual-input", "url-collection-adaptor"],
    canCollectNow: false,
    nextIntegration: "blog-automation"
  };
}

export async function collectCommentsByUrl() {
  return {
    ...createCommentCollectionBridge(),
    comments: [],
    message: "URL 기반 댓글 수집은 blog-automation 연결 단계에서 활성화됩니다."
  };
}
