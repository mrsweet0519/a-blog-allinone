const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const splitAvoidWords = (avoid) =>
  String(avoid ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

const applyAvoidWords = (text, avoidWords) =>
  avoidWords.reduce((result, word) => result.replaceAll(word, "해당 표현"), text);

export function createDraftContent(form) {
  const keyword = form.keyword.trim();
  const category = form.category;
  const goal = form.goal;
  const tone = form.tone;
  const avoidWords = splitAvoidWords(form.avoid);
  const emojiPrefix = form.useEmoji ? "✨ " : "";

  const topics = [
    `${keyword}로 ${category} 고객의 첫 관심을 만드는 방법`,
    `${keyword} 선택 전 확인하면 좋은 실전 체크리스트`,
    `${category} 관점에서 본 ${keyword} 활용 아이디어`
  ];

  const titles = [
    `${keyword}, 처음 시작하는 분들을 위한 핵심 정리`,
    `${category} 고객이 ${keyword}를 찾을 때 궁금해하는 것들`,
    `${keyword} 활용 전에 꼭 알아둘 3가지 포인트`
  ];

  const body = `${emojiPrefix}${keyword}에 관심이 생긴 고객은 보통 바로 구매하거나 문의하기보다 먼저 믿을 만한 정보를 찾습니다.

이번 글에서는 ${category} 상황에서 ${keyword}를 고민하는 분들이 빠르게 판단할 수 있도록 핵심 기준을 정리합니다. ${goal}를 목표로 할 때는 장점만 나열하기보다, 어떤 문제를 해결할 수 있는지와 실제 선택 기준을 함께 보여주는 편이 좋습니다.

첫째, 고객이 가장 먼저 묻는 질문을 제목과 도입부에 배치합니다. 둘째, 비교 기준이나 체크리스트를 짧게 제시해 읽는 사람이 스스로 판단할 수 있게 돕습니다. 셋째, 마지막에는 상담, 방문, 저장 등 다음 행동을 자연스럽게 안내합니다.

${tone} 말투를 유지하면서도 과장된 표현은 줄이고, 경험과 기준이 드러나는 문장으로 마무리하면 초안의 완성도가 더 높아집니다.`;

  const hashtags = Array.from(
    new Set([
      compact(keyword),
      compact(category),
      "블로그운영",
      "콘텐츠기획",
      "마케팅글쓰기",
      "브랜드콘텐츠",
      "고객관심",
      "초안작성",
      "해시태그",
      "콘텐츠메이커",
      "콘텐츠전략",
      "글쓰기팁"
    ].filter(Boolean))
  )
    .slice(0, 10)
    .map((tag) => `#${tag}`);

  return {
    topics: topics.map((topic) => applyAvoidWords(topic, avoidWords)),
    titles: titles.map((title) => applyAvoidWords(title, avoidWords)),
    body: applyAvoidWords(body, avoidWords),
    hashtags
  };
}
