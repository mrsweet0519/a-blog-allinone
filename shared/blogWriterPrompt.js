import { analyzeBlogWritingInput } from "./blogWriterCategory.js";

export const BLOG_WRITER_SYSTEM_PROMPT = `
당신은 네이버 블로그에 실제로 올릴 수 있는 한국어 생활형 후기를 쓰는 가족 라이프스타일 블로거입니다.
독자는 30~40대 엄마, 가족 단위 방문자, 생활 제품을 직접 찾아보는 사람입니다.

카테고리는 맛집, 카페, 아이랑 갈 곳, 가족 외식, 생활 제품, 시즌 상품, 패션, 꽃, 체험, 매장, 교육, 정보 글을 다룹니다.
글의 중심은 반드시 상호명, 상품명, 강의명, 장소명 같은 primary entity입니다.
지역명 맛집, 대표 메뉴, 가족여행, 근처 검색어 같은 broad keyword는 서브키워드로 자연스럽게 분산합니다.

허위 경험, 가격, 영업시간, 주차, 웨이팅, 메뉴판, 효과, 직원 응대, 재구매 의사는 만들지 않습니다.
부족한 정보는 본문 전체에서 한 번만 방문 참고 맥락으로 자연스럽게 다룹니다.
최종 본문에는 작성 계획, 가이드, 방어 문장, 프롬프트 설명, 제공된 정보 언급을 넣지 않습니다.

말투는 "~더라고요", "~있었어요", "~괜찮았어요", "~같아요", "궁금하더라고요", "확인해보면 좋겠다는 생각이 들었어요"처럼 편안하게 씁니다.
과장, 검색 순위 보장, 광고성 확신, 의학적 효과 보장, 무조건 추천 표현은 피합니다.

맛집 글은 실제 가족여행 후기처럼 씁니다. 일반적인 선택 기준 설명문으로 분량을 채우지 말고, 알게 된 상황, 메뉴가 눈에 들어온 이유, 사진에서 보이는 시각 정보, 가족 식사 맥락, 방문 전 참고 정보, 과장 없는 마무리를 서로 겹치지 않게 나눕니다.
사진 설명은 사진에서 보이는 국물 색감, 재료, 그릇 구성, 메뉴 첫인상만 다루고 맛, 가격, 양, 직원 응대는 사진만 보고 단정하지 않습니다.
입력 정보가 적으면 targetCharCount가 높아도 1500~1900자 안에서 자연스럽게 끝냅니다. "기준", "후보", "확인" 같은 단어를 반복해 길이를 늘리지 않습니다.
`.trim();

export const BLOG_WRITER_OUTPUT_SCHEMA = {
  finalTitle: "string",
  titleCandidates: ["string"],
  mainKeyword: "string",
  subKeywords: ["string"],
  body: "string",
  faqItems: [{ question: "string", answer: "string" }],
  hashtags: ["string"],
  qualityNotes: ["string"]
};

const toJsonBlock = (value) => JSON.stringify(value, null, 2);

export const buildBlogWriterUserPrompt = ({ form = {}, analysis = analyzeBlogWritingInput(form), fallbackDraft = null } = {}) => {
  const payload = {
    task: "네이버 블로그 publishable draft 생성",
    category: analysis.category,
    topic: analysis.topic,
    primaryEntity: analysis.primaryEntity,
    mainKeyword: analysis.mainKeyword,
    broadKeyword: analysis.broadKeyword,
    subKeywords: analysis.subKeywords,
    memoText: analysis.memoText,
    targetCharCount: form.targetCharCount || form.targetLength || 2500,
    effectiveTargetCharCount:
      fallbackDraft?.contentPackage?.targetLengthRange?.target ||
      fallbackDraft?.contentPackage?.targetCharCount ||
      form.targetCharCount ||
      form.targetLength ||
      2500,
    informationLimited: Boolean(fallbackDraft?.contentPackage?.informationLimited),
    imageContext: form.imageContext || [],
    imageCount: form.imageCount || 0,
    outputSchema: BLOG_WRITER_OUTPUT_SCHEMA,
    fallbackReference: fallbackDraft
      ? {
          titleCandidates: fallbackDraft.titleCandidates || [],
          body: fallbackDraft.body || "",
          faqItems: fallbackDraft.contentPackage?.faqItems || [],
          hashtags: fallbackDraft.hashtags || []
        }
      : null
  };

  return [
    "아래 입력값만 근거로 최종 원고를 작성하세요.",
    "메인 키워드는 primary entity를 우선하고, broad keyword는 서브키워드로만 자연스럽게 배치하세요.",
    "맛집 글이면 첫 문장에 mainKeyword를 넣고, 첫 문단에는 mainKeyword 2~3회와 서브키워드 1개 이상을 넣으세요.",
    "맛집 글의 본문 문단 역할은 1) 가족여행 중 식사 장소를 찾게 된 상황 2) 상호와 메뉴를 알게 된 이유 3) 사진으로 본 메뉴 첫인상 4) 가족 식사 관점 5) 방문 전 참고 정보 6) 과장 없는 마무리 순서로 겹치지 않게 작성하세요.",
    "맛집 제목 후보 5개는 의도를 분리하고, 식사 후보라는 표현은 쓰지 말며, 대표 메뉴는 3개 이상 제목에 포함하세요.",
    "정보가 부족하면 억지로 길게 쓰지 말고 실제 본문 길이에 맞춰 자연스럽게 마무리하세요.",
    "사진이 있으면 본문 흐름 안에 [사진 삽입: 설명] 마커를 넣되 파일명은 쓰지 마세요.",
    "최종 응답은 JSON만 반환하세요.",
    toJsonBlock(payload)
  ].join("\n\n");
};

export const buildBlogWriterPromptPayload = ({ form = {}, analysis = null, fallbackDraft = null } = {}) => {
  const resolvedAnalysis = analysis || analyzeBlogWritingInput(form);

  return {
    mode: "llm-preferred-with-static-fallback",
    keyPolicy: "Use server-side environment variables only. Never expose API keys to the browser.",
    messages: [
      {
        role: "system",
        content: BLOG_WRITER_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: buildBlogWriterUserPrompt({
          form,
          analysis: resolvedAnalysis,
          fallbackDraft
        })
      }
    ],
    analysis: resolvedAnalysis
  };
};
