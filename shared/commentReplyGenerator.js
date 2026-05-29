export const COMMENT_TYPES = [
  "칭찬형",
  "구매의사형",
  "기대감표현형",
  "맛/사용감 반응형",
  "공감형",
  "경험공유형",
  "질문형",
  "방문의사형",
  "짧은반응형",
  "민감/불만형",
  "스팸/의미불명형"
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
    "방법",
    "문의",
    "알려주세요",
    "물어봐도"
  ],
  purchase: ["구매", "구매갑", "사야", "사야져", "사야지", "살래", "사볼", "장바구니", "담아", "주문"],
  expectation: ["기대", "기대돼", "궁금해져", "밝아질", "눈길", "끌리", "산뜻", "좋을 것", "좋을것", "고민없이"],
  tasteUse: [
    "맛",
    "비릿",
    "비린",
    "레몬에이드",
    "상큼",
    "달달",
    "먹으면",
    "먹기",
    "마시면",
    "챙기기",
    "사용감",
    "발림",
    "제형",
    "향",
    "부담"
  ],
  visit: ["가보고", "가볼", "방문", "예약하고", "예약해", "들러", "상담받", "상담 받고", "가야겠"],
  experience: [
    "저도",
    "제가",
    "예전에",
    "다녀왔",
    "받아봤",
    "써봤",
    "해봤",
    "경험",
    "이용해",
    "관리받",
    "공구때",
    "올영",
    "사 먹던",
    "먹던템",
    "꾸준히",
    "3개월",
    "톤업효과"
  ],
  praise: ["꼼꼼", "좋", "좋은", "깔끔", "예쁘", "유용", "도움", "만족", "믿음", "신뢰", "자세", "정리", "친절"],
  empathy: ["맞아요", "공감", "인정", "그러게", "그쵸", "그렇죠", "맞는", "맞네요"]
};

const text = (value) => String(value ?? "").trim();

const normalizeSpaces = (value) => text(value).replace(/\s+/g, " ");

const compact = (value) => normalizeSpaces(value).replace(/\s+/g, "").toLowerCase();

const includesAny = (value, terms = []) => {
  const normalized = compact(value);
  return terms.some((term) => normalized.includes(compact(term)));
};

const hasQuestionIntent = (value = "") => {
  const content = normalizeSpaces(value);
  const normalized = compact(content);

  return (
    includesAny(normalized, TYPE_TERMS.question) ||
    /(궁금(?:해요|합니다|한데|해서)?|어떻게|어디(?:서|에)?|언제|얼마|가격|비용|예약|가능(?:한가요|할까요|한지|할지|해요)?|되나요|될까요|인가요|뭐예요|뭔가요|무엇|왜|몇\s*(시|개|분|원)?|주차|방법|문의|알려주세요|물어봐도)/u.test(
      content
    )
  );
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

const getCommentId = (comment = {}) =>
  text(comment.commentId || comment.commentNo || comment.commentKey || comment.id);

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
  const blocks = String(raw || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const comments = [];

  const pushComment = (author = "", content = "") => {
    const normalizedContent = normalizeSpaces(content);
    if (!normalizedContent) return;

    comments.push({
      id: `comment-${Date.now()}-${comments.length + 1}`,
      author: text(author),
      content: normalizedContent,
      source: "manual",
      hasOwnerReply: false,
      status: "대기"
    });
  };

  blocks.forEach((block) => {
    const lines = block
      .split("\n")
      .map(text)
      .filter(Boolean);
    let currentAuthor = "";
    let currentContent = [];
    let usedStructuredLabel = false;

    const flushStructured = () => {
      pushComment(currentAuthor, currentContent.join(" "));
      currentAuthor = "";
      currentContent = [];
    };

    lines.forEach((line) => {
      const authorMatch = line.match(/^(작성자|닉네임|author|writer)\s*[:：]\s*(.+)$/iu);
      if (authorMatch) {
        if (currentContent.length > 0) flushStructured();
        currentAuthor = authorMatch[2];
        usedStructuredLabel = true;
        return;
      }

      const commentMatch = line.match(/^(댓글|원댓글|comment|body)\s*[:：]\s*(.+)$/iu);
      if (commentMatch) {
        currentContent.push(commentMatch[2]);
        usedStructuredLabel = true;
        return;
      }

      const inlineMatch = line.match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/u);
      if (inlineMatch && !/^https?:\/\//iu.test(line)) {
        if (currentContent.length > 0) flushStructured();
        pushComment(inlineMatch[1], inlineMatch[2]);
        usedStructuredLabel = true;
        return;
      }

      currentContent.push(line);
    });

    if (usedStructuredLabel) {
      flushStructured();
      return;
    }

    if (lines.length <= 1) {
      pushComment("", lines.join(" "));
      return;
    }

    lines.forEach((line) => pushComment("", line));
  });

  return comments.filter((comment) => getContent(comment));
}

const CAPTURE_NOISE_LINES = new Set([
  "답글",
  "답글쓰기",
  "공감",
  "신고",
  "삭제",
  "수정",
  "댓글",
  "대댓글",
  "좋아요",
  "좋아요수",
  "블로그",
  "블로그주인",
  "작성자",
  "프로필",
  "프로필이미지",
  "더보기",
  "접기",
  "전체보기",
  "로그인",
  "이전",
  "다음"
]);

const CAPTURE_SECRET_COMMENT_TEXTS = new Set(["비밀 댓글입니다", "비밀 댓글입니다."]);

const CAPTURE_AUTHOR_NOISE_TOKENS = new Set([
  "qo",
  "q0",
  "oo",
  "0o",
  "o0",
  "ne",
  "n e",
  "zea",
  "o",
  "q",
  "0",
  "1"
]);

const CAPTURE_AUTHOR_ENDING_PATTERN =
  /(습니다|했어요|같아요|보여요|네요|어요|아요|입니다|니다|해요|돼요|되요|군요|구요|ㅋㅋ|ㅎㅎ|!!|\?!)$/u;

const CAPTURE_TIMESTAMP_PATTERN =
  /(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\.?\s*(?:\s*(?:오전|오후)?\s*\d{1,2}:\d{2})?|(?:오전|오후)?\s*\d{1,2}:\d{2}|방금|오늘|어제|\d+\s*(분|시간|일|주|개월|년)\s*전)/u;

const isCaptureTimestampLine = (value = "") =>
  CAPTURE_TIMESTAMP_PATTERN.test(normalizeSpaces(value));

const stripCaptureInlineMeta = (value = "") => {
  const withoutDate = normalizeSpaces(value).split(CAPTURE_TIMESTAMP_PATTERN)[0];

  return withoutDate
    .replace(/[|｜]/g, " ")
    .replace(/[♡♥]\s*\d+/gu, " ")
    .replace(/\b(신고|답글|수정|삭제|더보기|공감|좋아요)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isCaptureNoiseLine = (value = "") => {
  const normalized = normalizeSpaces(value).replace(/[|｜]/g, " ").trim();
  const compacted = compact(normalized);
  if (!normalized) return true;
  if (CAPTURE_SECRET_COMMENT_TEXTS.has(normalized)) return true;
  if (CAPTURE_NOISE_LINES.has(normalized) || CAPTURE_NOISE_LINES.has(compacted)) return true;
  if (/^(답글쓰기|댓글쓰기|더보기|접기|전체보기|로그인|이전|다음|번역보기|새로고침)$/u.test(normalized)) return true;
  if (/^(답글|신고|수정|삭제|더보기|공감|좋아요)\s*(qo|q0|oo|0o|o0|ne|o|q|\d+)?$/iu.test(normalized)) return true;
  if (/^(공감|좋아요|하트|heart)?\s*[♡♥]?\s*\d+\s*(개|명)?$/iu.test(normalized)) return true;
  if (/^\d+\s*(개|명)?$/u.test(normalized)) return true;
  if (/^\d+\s*\/\s*\d+$/u.test(normalized)) return true;
  if (/^[#@~*._\-–—|/\\()[\]{}♡♥!?·•]+$/u.test(normalized)) return true;
  if (/^(qo|q0|oo|0o|o0|ne|n e|o|q)$/iu.test(compacted)) return true;
  if (/^(프로필|아이콘|이미지|사진)\s*(이미지|사진)?$/u.test(normalized)) return true;
  if (/^(블로그주인|작성자|관리자)\s*(배지|표시)?$/u.test(normalized)) return true;
  if (isCaptureTimestampLine(normalized) && !stripCaptureInlineMeta(normalized)) return true;
  return false;
};

const cleanCaptureAuthor = (value = "") => {
  const raw = normalizeSpaces(value);
  if (raw === "작성자 미입력" || raw === "작성자 미확인") return raw;

  return stripCaptureInlineMeta(value)
    .replace(/^(작성자|닉네임|author|writer)\s*[:：]?\s*/iu, "")
    .replace(/^[^0-9A-Za-z가-힣]+/u, "")
    .replace(/[^0-9A-Za-z가-힣._-]+$/u, "")
    .replace(/\s*(님|작성자)$/u, "")
    .trim();
};

const isMeaninglessCaptureAuthor = (value = "") => {
  const author = cleanCaptureAuthor(value);
  const compacted = compact(author);
  if (!author || isCaptureNoiseLine(author)) return true;
  if (/^[#@~*._\-–—|/\\()[\]{}♡♥!?·•]+$/u.test(author)) return true;
  if (/^\d+$/u.test(author)) return true;
  if (CAPTURE_AUTHOR_NOISE_TOKENS.has(compacted)) return true;
  if (/^[a-z]+$/iu.test(author) && author.length < 3) return true;
  if (/^[가-힣]+$/u.test(author) && author.length < 2) return true;
  return false;
};

const isLikelyCommentContent = (value = "") => {
  const cleaned = stripCaptureInlineMeta(value);
  if (!cleaned || isCaptureNoiseLine(cleaned)) return false;
  if (CAPTURE_SECRET_COMMENT_TEXTS.has(cleaned)) return false;
  if (Array.from(cleaned).length < 5) return false;
  return /[\p{L}\p{N}]/u.test(cleaned);
};

const looksLikeCaptureAuthor = (line = "", nextLine = "") => {
  const normalized = cleanCaptureAuthor(line);
  const next = stripCaptureInlineMeta(nextLine);
  if (!normalized || normalized.length > 24) return false;
  if (isMeaninglessCaptureAuthor(normalized)) return false;
  if (isCaptureTimestampLine(normalized) || isCaptureNoiseLine(normalized)) return false;
  if (/[:：?.!,]/u.test(normalized)) return false;
  if (/\s/.test(normalized) && tokenize(normalized).length > 2) return false;
  if (CAPTURE_AUTHOR_ENDING_PATTERN.test(normalized)) return false;
  return isLikelyCommentContent(next);
};

export function parseNaverCommentsFromText(raw = "") {
  const normalizedRaw = String(raw || "")
    .replace(/\r/g, "")
    .replace(/[|｜]/g, " ")
    .replace(/\u00a0/g, " ");
  const lines = normalizedRaw
    .split("\n")
    .map(normalizeSpaces)
    .map((line) => line.trim())
    .filter(Boolean);
  const comments = [];
  let current = null;

  const resetCurrent = () => {
    current = null;
  };

  const flush = () => {
    if (!current) return;

    const content = stripCaptureInlineMeta(current.content);
    if (current.secret || !isLikelyCommentContent(content)) {
      resetCurrent();
      return;
    }

    comments.push({
      id: `capture-${Date.now()}-${comments.length + 1}`,
      author: isMeaninglessCaptureAuthor(current.author) ? "작성자 미입력" : cleanCaptureAuthor(current.author),
      content,
      createdAt: current.createdAt || "",
      source: "capture",
      hasOwnerReply: false,
      status: "대기"
    });
    resetCurrent();
  };

  lines.forEach((line, index) => {
    const nextLine = lines[index + 1] || "";
    const cleanedLine = stripCaptureInlineMeta(line);
    const inlineMatch = line.match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/u);

    if (CAPTURE_SECRET_COMMENT_TEXTS.has(normalizeSpaces(line))) {
      if (current) current.secret = true;
      return;
    }

    if (isCaptureTimestampLine(line)) {
      if (current) current.createdAt = normalizeSpaces(line.match(CAPTURE_TIMESTAMP_PATTERN)?.[0] || line);
      flush();
      return;
    }

    if (isCaptureNoiseLine(line)) return;

    if (inlineMatch && !/^https?:\/\//iu.test(line) && isLikelyCommentContent(inlineMatch[2])) {
      flush();
      current = {
        author: inlineMatch[1],
        content: inlineMatch[2],
        createdAt: ""
      };
      return;
    }

    if (looksLikeCaptureAuthor(line, nextLine)) {
      flush();
      current = {
        author: line,
        content: "",
        createdAt: ""
      };
      return;
    }

    if (!current) {
      if (!isLikelyCommentContent(cleanedLine)) return;

      current = {
        author: "작성자 미입력",
        content: "",
        createdAt: ""
      };
    }

    if (!isLikelyCommentContent(cleanedLine) && !current.content) return;

    current.content = normalizeSpaces([current.content, cleanedLine].filter(Boolean).join(" "));
  });

  flush();
  return comments;
}

export function parseCapturedComments(raw = "") {
  const normalizedRaw = String(raw || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ");
  const hasStructuredManualLabels =
    /^(작성자|닉네임|author|writer|댓글|원댓글|comment|body)\s*[:：]/imu.test(normalizedRaw) ||
    normalizedRaw
      .split("\n")
      .some((line) => {
        const normalizedLine = normalizeSpaces(line);
        return (
          !isCaptureTimestampLine(normalizedLine) &&
          /^([^:：]{1,24})\s*[:：]\s*(.+)$/u.test(normalizedLine) &&
          !/^https?:\/\//iu.test(normalizedLine)
        );
      });

  if (hasStructuredManualLabels) {
    const manualParsed = parseManualComments(normalizedRaw);

    if (manualParsed.length > 0) {
      return manualParsed
        .filter((comment) => isLikelyCommentContent(comment.content))
        .map((comment, index) => ({
          ...comment,
          id: `capture-${Date.now()}-${index + 1}`,
          author: isMeaninglessCaptureAuthor(comment.author) ? "작성자 미입력" : cleanCaptureAuthor(comment.author),
          source: "capture"
        }));
    }
  }

  return parseNaverCommentsFromText(normalizedRaw);
}

export function classifyComment(value = "") {
  const content = normalizeSpaces(value);
  const compacted = compact(content);
  const hasHangulOrAlpha = /[\p{L}\p{N}]/u.test(content);

  if (!content || !hasHangulOrAlpha) return "스팸/의미불명형";
  if (includesAny(compacted, TYPE_TERMS.spam)) return "스팸/의미불명형";
  if (includesAny(compacted, TYPE_TERMS.sensitive)) return "민감/불만형";
  if (hasQuestionIntent(content)) return "질문형";
  if (includesAny(compacted, TYPE_TERMS.experience)) return "경험공유형";
  if (includesAny(compacted, TYPE_TERMS.purchase)) return "구매의사형";
  if (includesAny(compacted, TYPE_TERMS.tasteUse)) return "맛/사용감 반응형";
  if (includesAny(compacted, TYPE_TERMS.expectation)) return "기대감표현형";
  if (includesAny(compacted, TYPE_TERMS.visit)) return "방문의사형";
  if (includesAny(compacted, TYPE_TERMS.empathy)) return "공감형";
  if (includesAny(compacted, TYPE_TERMS.praise)) return "칭찬형";
  if (tokenize(content).length <= 3 || Array.from(content).length <= 14) return "짧은반응형";

  return "공감형";
}

export function inferCommentIntent(type, content = "") {
  const normalized = compact(content);

  if (type === "스팸/의미불명형" || type === "광고/스팸형" || type === "의미불명형") {
    return "답변보다 스킵이 적합한 댓글";
  }
  if (type === "민감/불만형" || type === "불만/민감형") return "불편하거나 예민한 지점 공유";
  if (type === "질문형") {
    if (normalized.includes("가격") || normalized.includes("비용") || normalized.includes("얼마")) {
      return "가격 또는 비용 확인";
    }
    if (normalized.includes("예약") || normalized.includes("시간")) return "예약 가능 여부 확인";
    if (normalized.includes("주차")) return "방문 편의 정보 확인";
    return "궁금한 점 확인";
  }
  if (type === "방문의사형") return "방문 또는 상담 관심";
  if (type === "구매의사형") return "구매 의사와 호감 표현";
  if (type === "기대감표현형") return "기대감 또는 첫인상 호감";
  if (type === "맛/사용감 반응형") return "맛이나 사용감에 대한 반응";
  if (type === "경험공유형") return "본인 경험 공유";
  if (type === "칭찬형") return "포스팅 또는 매장에 대한 긍정 반응";
  if (type === "공감형") return "내용에 대한 공감";
  if (type === "짧은반응형") return "짧은 호응";
  return "의도를 분명히 파악하기 어려움";
}

export function inferSentiment(type) {
  if (type === "민감/불만형" || type === "불만/민감형") return "주의";
  if (type === "스팸/의미불명형" || type === "광고/스팸형" || type === "의미불명형") return "중립";
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
  if (comment.isOwnerComment || comment.isMine || comment.isMyComment) return true;

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
    "샵",
    "패키지",
    "맛",
    "비릿",
    "레몬에이드",
    "꾸준",
    "톤업"
  ]);
}

function shouldUseKeyword(type, content, mainKeyword, sequence = 0) {
  if (
    !mainKeyword ||
    ["광고/스팸형", "스팸/의미불명형", "불만/민감형", "민감/불만형", "의미불명형", "짧은반응형"].includes(
      type
    )
  ) {
    return false;
  }

  if (!isKeywordRelevant(content, mainKeyword)) return false;

  const keywordAppearsInComment = tokenize(mainKeyword).some((token) => compact(content).includes(compact(token)));

  if (type === "질문형" || type === "방문의사형") return sequence % 2 === 0 || keywordAppearsInComment;
  if (type === "맛/사용감 반응형") return keywordAppearsInComment && sequence % 3 === 0;
  if (["구매의사형", "기대감표현형", "경험공유형", "칭찬형", "공감형"].includes(type)) {
    return keywordAppearsInComment && sequence % 2 === 0;
  }

  return sequence % 3 === 0 || keywordAppearsInComment;
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
    ? "남겨주신 부분은 목적에 맞춰 먼저 살펴보면 판단하기가 더 쉽습니다."
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

function hasFinalConsonant(value = "") {
  const lastCharacter = Array.from(normalizeSpaces(value)).pop();
  if (!lastCharacter) return false;

  const code = lastCharacter.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;

  return (code - 0xac00) % 28 !== 0;
}

function withParticle(value = "", consonantParticle, vowelParticle) {
  const phrase = normalizeSpaces(value);
  if (!phrase) return "";

  return `${phrase}${hasFinalConsonant(phrase) ? consonantParticle : vowelParticle}`;
}

const withTopicParticle = (value = "") => withParticle(value, "은", "는");

const withObjectParticle = (value = "") => withParticle(value, "을", "를");

const withSubjectParticle = (value = "") => withParticle(value, "이", "가");

function getCorePhrase(coreKeywords = []) {
  return coreKeywords[0] || "남겨주신 부분";
}

const FALLBACK_REPLY_BLOCKLIST = [
  "문의하신 부분은",
  "방문 목적에 맞춰",
  "먼저 확인해보시면 좋습니다",
  "방문 전 궁금한 부분만 먼저 확인",
  "궁금한 부분은 편하게",
  "편하게 확인해드리겠습니다",
  "확인해드리겠습니다",
  "짧게 남겨주신 말도 힘이 됩니다",
  "다른 분들께도 참고가 될 것 같아요"
];

function containsFallbackReplyPhrase(reply = "") {
  return FALLBACK_REPLY_BLOCKLIST.some((phrase) => normalizeSpaces(reply).includes(phrase));
}

function getInteractionPoint(content = "", coreKeywords = []) {
  const normalized = compact(content);

  if (normalized.includes("패키지")) return "패키지 느낌";
  if (normalized.includes("레몬에이드")) return "레몬에이드맛";
  if (normalized.includes("비릿") || normalized.includes("비린")) return "맛 부담";
  if (normalized.includes("공구") || normalized.includes("올영")) return "공구나 올영에서 챙겨보신 경험";
  if (normalized.includes("3개월") || normalized.includes("꾸준")) return "꾸준히 챙겨본 후기";
  if (normalized.includes("톤업")) return "톤업 효과";
  if (normalized.includes("꼼꼼")) return "꼼꼼한 부분";
  if (normalized.includes("밝아질")) return "밝아질 것 같은 첫인상";
  if (normalized.includes("고민없이")) return "고민 없이 담고 싶다는 말";

  return getCorePhrase(coreKeywords);
}

function keywordSentence(mainKeyword, type, audienceType) {
  if (!mainKeyword) return "";

  if (type === "질문형") return `${withTopicParticle(mainKeyword)} 기준을 같이 보면 이해하기가 더 쉽습니다.`;
  if (type === "맛/사용감 반응형") return `${mainKeyword}도 맛이 부담스러우면 꾸준히 챙기기 어렵더라고요.`;
  if (type === "구매의사형" || type === "기대감표현형") {
    return `${withTopicParticle(mainKeyword)} 첫인상과 편하게 챙길 수 있는 느낌이 같이 중요하더라고요.`;
  }
  if (type === "경험공유형") return `${withTopicParticle(mainKeyword)} 꾸준히 챙겨본 경험담이 특히 참고가 되더라고요.`;
  if (type === "방문의사형") return `${withObjectParticle(mainKeyword)} 알아보는 중이라면 필요한 기준을 가볍게 확인해보셔도 좋습니다.`;
  if (audienceType === "사업자/매장 홍보") {
    return `${withTopicParticle(mainKeyword)} 처음 보시는 분들도 흐름을 편하게 이해하는 게 중요하다고 보고 있습니다.`;
  }

  return `${withTopicParticle(mainKeyword)} 맥락이 자연스럽게 이어질 때 더 와닿더라고요.`;
}

function createReplyCandidates({ type, content, form, coreKeywords, mainKeyword, useKeyword }) {
  const audienceType = text(form.audienceType) || "사업자/매장 홍보";
  const tone = text(form.tone) || "친근한";
  const isBusiness = audienceType === "사업자/매장 홍보";
  const core = getCorePhrase(coreKeywords);
  const point = getInteractionPoint(content, coreKeywords);
  const normalized = compact(content);
  const keyLine = useKeyword ? keywordSentence(mainKeyword, type, audienceType) : "";
  const softCta = getSoftCta(form);
  const questionAnswer = getQuestionAnswer(content, audienceType);
  const thanks = tone === "전문적인" ? "감사합니다" : tone === "활기찬" ? "감사해요" : "고마워요";

  if (type === "스팸/의미불명형" || type === "광고/스팸형" || type === "의미불명형") return [];

  if (type === "민감/불만형" || type === "불만/민감형") {
    return [
      `말씀해주신 부분은 조심스럽게 확인해보겠습니다. 불편하게 느껴질 수 있는 지점까지 남겨주셔서 ${thanks}.`,
      `남겨주신 의견은 가볍게 넘기지 않고 살펴보겠습니다. 표현이 과해지지 않도록 차분히 확인하겠습니다.`,
      `그렇게 느끼실 수 있는 부분도 있다고 생각합니다. 공유해주신 내용은 참고해서 더 신중히 보겠습니다.`
    ];
  }

  if (type === "질문형") {
    return isBusiness
      ? [
          `${questionAnswer} ${softCta || "남겨주신 질문 기준으로 차분히 짚어볼게요."}`,
          `${questionAnswer} ${keyLine || "처음 보시는 분들도 필요한 기준부터 차근차근 보시면 됩니다."}`,
          `${questionAnswer} 남겨주신 질문처럼 미리 확인하면 방문 전 판단이 훨씬 편해집니다.`
        ]
      : [
          `${questionAnswer} 궁금한 포인트 짚어주셔서 ${thanks}.`,
          `${questionAnswer} ${keyLine || "저도 이런 부분은 미리 확인하는 편이 마음이 놓였어요."}`,
          `${questionAnswer} 댓글로 물어봐주신 부분이라 다른 분들께도 도움이 될 것 같아요.`
        ];
  }

  if (type === "구매의사형") {
    const purchasePhrase = normalized.includes("고민없이")
      ? "고민 없이 담고 싶다는 말"
      : includesAny(normalized, ["구매", "사야", "구매갑", "주문"])
        ? "바로 구매하고 싶다는 반응"
        : "관심 있게 봐주신 반응";
    const packageReply = normalized.includes("패키지")
      ? "패키지 느낌까지 산뜻하게 봐주셨네요ㅎㅎ 고민 없이 담고 싶다는 말이 딱 공감돼요. 편하게 챙기기 좋은 느낌이라 더 눈길이 가더라고요."
      : `${point}을 좋게 봐주셨네요ㅎㅎ ${purchasePhrase}이 반갑고 저도 그 마음이 공감돼요.`;

    return [
      packageReply,
      `${purchasePhrase}이 반갑네요ㅎㅎ ${point}이 먼저 눈에 들어오는 댓글이라 저도 공감됐어요.`,
      `그렇게 관심 있게 봐주셔서 반가워요. ${point}이 산뜻하게 느껴져서 더 손이 가는 것 같아요.`
    ];
  }

  if (type === "기대감표현형") {
    return [
      `${point}을 기대감 있게 봐주셨네요ㅎㅎ 첫인상이 좋게 닿았다니 반가워요.`,
      `밝고 산뜻하게 느껴진 포인트를 짚어주셔서 좋네요. 그런 기대감이 생기는 댓글이라 저도 흐뭇했어요.`,
      `${core} 쪽으로 눈길이 갔다니 반갑습니다. 과하지 않게 편하게 느껴지는 부분이 매력인 것 같아요.`
    ];
  }

  if (type === "맛/사용감 반응형") {
    const lemonReply = normalized.includes("레몬에이드")
      ? "레몬에이드맛이라는 점이 확실히 편하게 느껴지는 포인트였어요."
      : `${point}이 부담을 덜어주는 포인트로 느껴졌어요.`;
    const fishyReply = normalized.includes("비릿") || normalized.includes("비린")
      ? "비릿할까 봐 걱정되는 부분 저도 공감해요."
      : "맛이나 사용감이 편해야 꾸준히 손이 가더라고요.";
    const contextualTasteLine = mainKeyword
      ? `${mainKeyword}도 맛이 부담스럽지 않아야 꾸준히 챙기기 좋은데, ${lemonReply}`
      : lemonReply;

    return [
      `맞아요, 이런 제품은 맛이 부담스러우면 꾸준히 챙기기 어렵더라고요. ${lemonReply}`,
      `${fishyReply} ${contextualTasteLine}`,
      `${keyLine || "꾸준히 챙기는 제품일수록 첫 느낌이 꽤 중요하더라고요."} ${point}을 좋게 봐주셔서 반가워요.`
    ];
  }

  if (type === "방문의사형") {
    return isBusiness
      ? [
          `관심 가져주셔서 ${thanks}. 처음 방문하시는 분들도 편하게 상담받으실 수 있도록 신경 쓰고 있습니다.`,
          `${keyLine || "방문 전에 원하는 방향만 가볍게 정리해두면 상담 흐름을 잡기 쉽습니다."} ${softCta || "필요한 기준부터 천천히 살펴보세요."}`,
          `반갑게 봐주셔서 ${thanks}. 방문 전에는 목적과 일정만 간단히 정리해오셔도 안내가 더 수월합니다.`
        ]
      : [
          `관심 생기셨다면 방문 전 기준을 한 번 확인해보셔도 좋을 것 같아요. 좋게 봐주셔서 ${thanks}.`,
          `${keyLine || "저도 직접 알아볼 때는 상담 흐름을 먼저 봤어요."} 댓글 남겨주셔서 ${thanks}.`,
          `가보고 싶다는 말이 제일 반갑네요. 부담 없이 비교해보고 맞는지 확인해보시면 좋겠습니다.`
        ];
  }

  if (type === "경험공유형") {
    return [
      `이미 꾸준히 챙겨보신 후기라 더 현실감 있네요ㅎㅎ 직접 드셔본 경험까지 공유해주셔서 다른 분들께도 도움이 될 것 같아요.`,
      `공구나 올영에서 챙겨보셨던 템이라고 해주시니 더 와닿아요. ${point}까지 남겨주셔서 든든합니다.`,
      `직접 경험해본 이야기는 확실히 참고가 되네요ㅎㅎ ${point}을 공유해주셔서 다른 분들도 보기 좋을 것 같아요.`
    ];
  }

  if (type === "칭찬형") {
    return isBusiness
      ? [
          `${keyLine || `${withObjectParticle(point)} 좋게 봐주셔서 ${thanks}.`} 앞으로도 편하게 보실 수 있도록 꼼꼼히 챙기겠습니다.`,
          `좋게 봐주셔서 ${thanks}. 처음 보시는 분들도 핵심을 편하게 파악하실 수 있게 신경 쓰고 있습니다.`,
          `${point}을 알아봐주셔서 ${thanks}. 실제로 그런 세부 흐름이 만족도에 중요하다고 생각합니다.`
        ]
      : [
          `${keyLine || `${withObjectParticle(point)} 좋게 봐주셔서 ${thanks}.`} 저도 그 부분이 가장 인상적이었어요.`,
          `좋게 봐주셔서 ${thanks}. 저도 정리하면서 ${withSubjectParticle(point)} 특히 눈에 들어왔습니다.`,
          `${point}을 알아봐주셔서 반가워요. 후기에서 꼭 남기고 싶었던 지점이었어요.`
        ];
  }

  if (type === "공감형") {
    return [
      `맞아요, ${point}이 확실히 눈에 들어오더라고요. 공감해주셔서 ${thanks}.`,
      `${point}에 공감해주셔서 반가워요. 같이 봐주신 포인트가 잘 와닿았습니다.`,
      `저도 같은 생각이에요. 이런 기준을 같이 봐주시면 훨씬 판단하기 쉬운 것 같습니다.`
    ];
  }

  if (type === "짧은반응형") {
    return [
      `좋게 봐주셔서 ${thanks}.`,
      `댓글 남겨주셔서 ${thanks}.`,
      `반응 남겨주셔서 반갑습니다.`
    ];
  }

  return [
    `${point}을 짚어주셔서 반가워요. 댓글 남겨주셔서 ${thanks}.`,
    `읽고 반응 남겨주셔서 ${thanks}. 남겨주신 포인트가 잘 와닿았습니다.`,
    `들러주셔서 ${thanks}. ${core}에 대한 반응도 잘 봤어요.`
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

function getMaxSimilarity(reply = "", previousReplies = []) {
  const comparableReplies = previousReplies.map(normalizeSpaces).filter(Boolean);
  if (!reply || comparableReplies.length === 0) return 0;

  return Math.max(...comparableReplies.map((previous) => jaccardSimilarity(reply, previous)));
}

function isDistinctReply(reply = "", previousReplies = []) {
  const normalizedReply = normalizeSpaces(reply);
  const comparableReplies = previousReplies.map(normalizeSpaces).filter(Boolean);
  if (!normalizedReply || comparableReplies.length === 0) return true;

  return comparableReplies.every(
    (previous) =>
      previous !== normalizedReply &&
      getReplyStart(previous) !== getReplyStart(normalizedReply) &&
      jaccardSimilarity(normalizedReply, previous) < 0.5
  );
}

function rephraseSimilarReply(reply = "", seed = 0) {
  const normalized = normalizeSpaces(reply);
  if (!normalized) return "";

  const variants = [
    normalized
      .replace(/^맞아요,?\s*/u, "저도 그렇게 느꼈어요. ")
      .replace(/고마워요/g, "감사해요")
      .replace(/반가워요/g, "좋네요"),
    normalized
      .replace(/^좋게 봐주셔서/u, "이 부분을 좋게 봐주셔서")
      .replace(/반갑습니다/g, "감사합니다")
      .replace(/반가워요/g, "기쁩니다"),
    normalized
      .replace(/댓글 남겨주셔서/g, "이렇게 남겨주셔서")
      .replace(/잘 와닿았습니다/g, "분명하게 와닿았어요")
      .replace(/좋을 것 같아요/g, "도움이 됩니다")
  ].filter((variant) => variant && variant !== normalized);

  return variants[seed % Math.max(1, variants.length)] || normalized;
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

  const cleanCandidates = candidates.filter((candidate) => candidate && !containsFallbackReplyPhrase(candidate));
  if (!cleanCandidates.length) return "";

  const rotated = cleanCandidates.map((_, index) => cleanCandidates[(index + seed) % cleanCandidates.length]);
  const distinct = rotated.find((candidate) => isDistinctReply(candidate, previousReplies));
  if (distinct) return distinct;

  const lowRisk = rotated.find((candidate) => getMaxSimilarity(candidate, previousReplies) < 0.58);
  const fallback = lowRisk || rotated[0];
  const rephrased = rephraseSimilarReply(fallback, seed);

  return containsFallbackReplyPhrase(rephrased) ? fallback : rephrased;
}

export function normalizeComment(comment = {}, index = 0) {
  const existingReplies = Array.isArray(comment.existingReplies)
    ? comment.existingReplies
    : Array.isArray(comment.replies)
      ? comment.replies
      : [];
  const hasOwnerReply = Boolean(comment.hasOwnerReply || comment.hasMyReply || comment.alreadyReplied);

  return {
    id: text(comment.id) || getCommentId(comment) || `comment-${Date.now()}-${index + 1}`,
    commentId: getCommentId(comment),
    author: getAuthor(comment) || "작성자 미입력",
    content: getContent(comment),
    createdAt: text(comment.createdAt || comment.writtenAt || comment.datetime || comment.date),
    source: comment.source || "manual",
    isOwnerComment: Boolean(comment.isOwnerComment || comment.isMine || comment.isMyComment),
    hasOwnerReply,
    existingReplies,
    type: comment.type || "",
    sentiment: comment.sentiment || "",
    intent: comment.intent || "",
    coreKeywords: Array.isArray(comment.coreKeywords) ? comment.coreKeywords : [],
    reply: text(comment.reply),
    mainKeywordUsed: Boolean(comment.mainKeywordUsed),
    forbiddenWordsFound: Array.isArray(comment.forbiddenWordsFound) ? comment.forbiddenWordsFound : [],
    duplicateRisk: comment.duplicateRisk || "중복 위험 낮음",
    status: comment.status || "대기",
    skipReason: comment.skipReason || "",
    processStatus: comment.processStatus || comment.processingStatus || "",
    registerStatus: comment.registerStatus || "",
    selected: Boolean(comment.selected),
    retryCount: Number.isFinite(comment.retryCount) ? comment.retryCount : 0,
    regenerationCount: Number.isFinite(Number(comment.regenerationCount)) ? Number(comment.regenerationCount) : 0,
    errorMessage: text(comment.errorMessage || comment.error)
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
      : type === "스팸/의미불명형" || type === "광고/스팸형" || type === "의미불명형"
        ? "스팸/의미불명 댓글"
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
  const regenerationCount = Number.isFinite(Number(options.regenerationCount))
    ? Number(options.regenerationCount)
    : normalizedComment.regenerationCount || 0;
  const seedBase = Number.isFinite(options.seed) ? Number(options.seed) : sequence + (normalizedComment.reply ? 1 : 0);
  const seed = seedBase + regenerationCount * 7;
  const previousForChoice =
    options.regenerate && normalizedComment.reply
      ? unique([normalizedComment.reply, ...previousReplies])
      : previousReplies;
  const useKeyword = shouldUseKeyword(type, content, mainKeyword, sequence + seed);
  const candidates = createReplyCandidates({
    type,
    content,
    form,
    coreKeywords,
    mainKeyword,
    useKeyword
  });
  const reply = chooseReply(candidates, previousForChoice, seed);
  const forbiddenWordsFound = findForbiddenWords(reply, forbiddenWords);
  const duplicateRisk = assessDuplicateRisk(reply, previousForChoice);
  const needsReview =
    forbiddenWordsFound.length > 0 ||
    duplicateRisk === "재생성 권장" ||
    type === "민감/불만형" ||
    type === "불만/민감형" ||
    type === "스팸/의미불명형" ||
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
    regenerationCount,
    skipReason: ""
  };
}

function createContextualCaptureCandidates({ type, content, form, coreKeywords, mainKeyword }) {
  const normalized = compact(content);
  const point = getInteractionPoint(content, coreKeywords);
  const questionAnswer = getQuestionAnswer(content, text(form.audienceType || form.userType));
  const brandName = text(form.brandName || form.storeName);
  const brandPhrase = brandName ? `${brandName}도 ` : "";

  if (type === "구매의사형" || type === "기대감표현형") {
    return [
      normalized.includes("패키지")
        ? "패키지 느낌까지 산뜻하게 봐주셨네요ㅎㅎ 고민 없이 담고 싶다는 말이 딱 공감돼요. 편하게 챙기기 좋은 느낌이라 더 눈길이 가더라고요."
        : `${point}을 좋게 봐주셔서 반가워요ㅎㅎ 관심 있게 담고 싶다는 반응이 자연스럽게 와닿았어요.`,
      `바로 구매하고 싶다고 봐주신 게 반갑네요ㅎㅎ ${point}이 먼저 눈에 들어오는 댓글이라 저도 공감됐어요.`,
      `기대감 있게 봐주셔서 좋아요. ${point}이 산뜻하게 느껴져서 더 손이 가는 것 같아요.`
    ];
  }

  if (type === "맛/사용감 반응형") {
    const lemonLine = normalized.includes("레몬에이드")
      ? "레몬에이드맛이라는 점이 확실히 편하게 느껴지는 포인트였어요."
      : `${point}이 부담을 덜어주는 포인트로 느껴졌어요.`;

    return [
      `맞아요, 이런 제품은 맛이 부담스러우면 꾸준히 챙기기 어렵더라고요. ${lemonLine}`,
      `비릿할까 봐 걱정되는 부분 저도 공감해요. ${lemonLine}`,
      `${brandPhrase}꾸준히 챙기는 제품일수록 맛이나 사용감이 편해야 손이 가더라고요. ${lemonLine}`
    ];
  }

  if (type === "경험공유형") {
    return [
      "이미 꾸준히 챙겨보신 후기라 더 현실감 있네요ㅎㅎ 직접 드셔본 경험까지 공유해주셔서 다른 분들께도 도움이 될 것 같아요.",
      `공구나 올영에서 챙겨보셨던 템이라고 해주시니 더 와닿아요. ${point}까지 남겨주셔서 댓글 보시는 분들도 참고하기 좋을 것 같아요.`,
      `직접 경험해본 이야기는 확실히 힘이 있네요ㅎㅎ ${point}을 나눠주셔서 더 현실감 있게 느껴져요.`
    ];
  }

  if (type === "칭찬형") {
    return [
      `${point}을 좋게 봐주셔서 반가워요. 댓글로 짚어주신 부분이 딱 전하고 싶던 포인트였어요.`,
      `좋게 봐주셔서 고마워요. ${point}이 눈에 들어왔다니 저도 흐뭇하네요.`,
      `${point}을 알아봐주셨네요ㅎㅎ 편하게 봐주신 반응이라 더 반갑습니다.`
    ];
  }

  if (type === "질문형") {
    return [
      `${questionAnswer} 남겨주신 질문 기준으로 짧게 정리해봤어요.`,
      `${questionAnswer} 댓글에서 궁금해하신 포인트를 먼저 보면 이해가 더 쉬울 것 같아요.`,
      `${questionAnswer} 필요한 부분은 포스팅 맥락에 맞춰 차분히 보면 됩니다.`
    ];
  }

  if (type === "방문의사형") {
    return [
      `관심 있게 봐주셔서 반가워요ㅎㅎ ${point}을 보고 방문이나 상담까지 떠올리셨다면 필요한 기준만 가볍게 챙겨보시면 좋겠어요.`,
      `방문 생각이 드셨다니 반갑네요. 댓글에서 짚어주신 ${point}부터 편하게 살펴보시면 될 것 같아요.`,
      `가보고 싶다는 반응은 늘 반갑더라고요. ${point}이 눈에 들어온 만큼 부담 없이 비교해보셔도 좋아요.`
    ];
  }

  if (type === "공감형") {
    return [
      `맞아요, ${point}이 확실히 눈에 들어오더라고요. 같이 공감해주셔서 반가워요.`,
      `${point}에 공감해주셔서 좋네요ㅎㅎ 댓글로 짚어주신 포인트가 잘 와닿았습니다.`,
      `저도 같은 생각이에요. ${point}을 같이 봐주셔서 더 반가웠어요.`
    ];
  }

  if (type === "짧은반응형") {
    return [
      "좋게 봐주셔서 고마워요ㅎㅎ",
      "반응 남겨주셔서 반가워요.",
      "댓글 남겨주셔서 고마워요ㅎㅎ"
    ];
  }

  if (type === "민감/불만형" || type === "불만/민감형") {
    return [
      "말씀해주신 부분은 가볍게 넘기지 않고 차분히 살펴보겠습니다.",
      "그렇게 느끼실 수 있는 부분도 있다고 생각해요. 남겨주신 의견은 신중하게 참고하겠습니다.",
      "불편하게 느껴질 수 있는 지점을 짚어주셔서 차분히 돌아보겠습니다."
    ];
  }

  return [
    `${point}을 짚어주셔서 반가워요. 남겨주신 반응이 잘 와닿았습니다.`,
    `댓글 남겨주셔서 고마워요. ${point}에 대한 반응도 잘 봤습니다.`,
    `읽고 반응 남겨주셔서 반갑습니다. ${point}을 같이 봐주신 게 좋았어요.`
  ];
}

export function generateContextualCaptureReply(comment = {}, context = {}, previousReplies = [], options = {}) {
  const normalizedComment = normalizeComment({ ...comment, source: comment.source || "capture" }, options.sequence || 0);
  const content = normalizedComment.content;
  const mainKeyword = resolveMainKeyword(context);
  const keywordCandidates = createMainKeywordCandidates(context.postTitle || context.title);
  const forbiddenWords = splitForbiddenWords(context);
  const type = classifyComment(content);
  const sentiment = inferSentiment(type);
  const intent = inferCommentIntent(type, content);
  const coreKeywords = extractCoreKeywords(content, { ...context, mainKeyword });
  const ownerComment = isOwnerComment(normalizedComment, context);
  const hasOwnerReply = normalizedComment.hasOwnerReply;
  const isSecret = CAPTURE_SECRET_COMMENT_TEXTS.has(normalizeSpaces(content));
  const skipReason = !content
    ? "빈 댓글"
    : isSecret
      ? "비밀 댓글로 내용 확인 불가"
      : ownerComment
        ? "내 계정이 작성한 원댓글"
        : hasOwnerReply
          ? "이미 내 계정 대댓글 있음"
          : type === "스팸/의미불명형" || type === "광고/스팸형" || type === "의미불명형"
            ? "스팸/의미불명 댓글"
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

  const candidates = createContextualCaptureCandidates({
    type,
    content,
    form: context,
    coreKeywords,
    mainKeyword
  });
  const regenerationCount = Number.isFinite(Number(options.regenerationCount))
    ? Number(options.regenerationCount)
    : normalizedComment.regenerationCount || 0;
  const seedBase = Number.isFinite(options.seed) ? Number(options.seed) : 0;
  const seed = seedBase + regenerationCount * 7;
  const previousForChoice =
    options.regenerate && normalizedComment.reply
      ? unique([normalizedComment.reply, ...previousReplies])
      : previousReplies;
  const reply = chooseReply(candidates, previousForChoice, seed);
  const forbiddenWordsFound = findForbiddenWords(reply, forbiddenWords);
  const duplicateRisk = assessDuplicateRisk(reply, previousForChoice);
  const needsReview =
    !reply ||
    forbiddenWordsFound.length > 0 ||
    duplicateRisk === "재생성 권장" ||
    type === "민감/불만형" ||
    type === "불만/민감형";

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
    regenerationCount,
    skipReason: ""
  };
}

export function generateContextualCaptureReplies(comments = [], context = {}, options = {}) {
  const previousReplies = Array.isArray(options.previousReplies) ? [...options.previousReplies] : [];
  const baseSeed = Number(options.seed || 0);

  return comments.map((comment, index) => {
    const regenerationCount =
      Number(comment?.regenerationCount || 0) + (options.regenerate && comment?.reply ? 1 : 0);
    const generated = generateContextualCaptureReply(comment, context, previousReplies, {
      sequence: index,
      seed: baseSeed + index,
      regenerate: Boolean(options.regenerate),
      regenerationCount
    });

    if (generated.reply) previousReplies.push(generated.reply);
    return generated;
  });
}

export function createCommentReplyBatch(form = {}, comments = [], options = {}) {
  const previousReplies = Array.isArray(options.previousReplies) ? [...options.previousReplies] : [];
  const baseSeed = Number(options.seed || 0);

  return comments.map((comment, index) => {
    const regenerationCount =
      Number(comment?.regenerationCount || 0) + (options.regenerate && comment?.reply ? 1 : 0);
    const generated = createCommentReplyForOne(form, comment, previousReplies, {
      sequence: index,
      seed: baseSeed + index,
      regenerate: Boolean(options.regenerate),
      regenerationCount
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
