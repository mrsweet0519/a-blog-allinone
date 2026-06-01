const text = (value) => String(value ?? "").trim();

export const TONE_OPTIONS = ["친근한", "차분한", "전문적인", "활기찬"];

export const normalizeTone = (tone = "") =>
  TONE_OPTIONS.includes(text(tone)) ? text(tone) : "친근한";

export const getToneProfile = (tone = "") => {
  const normalizedTone = normalizeTone(tone);

  return {
    친근한: {
      label: "친근한",
      sentenceEnd: "soft",
      allowsEmoji: true,
      introVerb: "정리해보려고 해요",
      checkVerb: "확인해보면 좋아요",
      cautionVerb: "무리해서 기대하기보다 천천히 보는 게 좋아요",
      firstPerson: "저는",
      nudge: "너무 어렵게 보기보다 내 생활에 자연스럽게 들어오는지부터 보면 좋더라고요.",
      cta: "비슷한 고민이 있다면 구매 전 확인할 부분부터 가볍게 살펴보면 좋을 것 같아요."
    },
    차분한: {
      label: "차분한",
      sentenceEnd: "formal",
      allowsEmoji: false,
      introVerb: "정리해보겠습니다",
      checkVerb: "확인해보면 좋습니다",
      cautionVerb: "무리하게 기대하기보다 차분히 살펴보는 것이 좋습니다",
      firstPerson: "저는",
      nudge: "서두르지 않고 구성과 사용 흐름을 하나씩 확인하는 편이 좋습니다.",
      cta: "구매 전 필요한 내용을 차분히 확인해보면 선택에 도움이 됩니다."
    },
    전문적인: {
      label: "전문적인",
      sentenceEnd: "formal",
      allowsEmoji: false,
      introVerb: "객관적으로 정리하겠습니다",
      checkVerb: "확인할 필요가 있습니다",
      cautionVerb: "개인차와 사용 기준을 함께 확인할 필요가 있습니다",
      firstPerson: "",
      nudge: "성분, 구성, 섭취 또는 사용 방법을 같은 기준으로 확인하면 판단 근거가 분명해집니다.",
      cta: "구매 전 원료 구성, 섭취 방법, 주의사항을 기준으로 확인하는 것이 중요합니다."
    },
    활기찬: {
      label: "활기찬",
      sentenceEnd: "bright",
      allowsEmoji: true,
      introVerb: "밝게 정리해볼게요",
      checkVerb: "체크해보면 좋아요",
      cautionVerb: "과하게 기대하기보다 내 루틴에 맞는지 보면 좋아요",
      firstPerson: "저는",
      nudge: "핵심만 먼저 잡아도 훨씬 보기 쉽더라고요!",
      cta: "비슷한 고민이라면 필요한 포인트부터 빠르게 체크해보세요."
    }
  }[normalizedTone];
};

const hasSentencePunctuation = (value) => /[.!?。]$/u.test(text(value));

export const ensureSentence = (value = "", tone = "") => {
  const sentence = text(value);

  if (!sentence) return "";
  if (/^\[여기에 이미지 \d+을 넣어주세요:/u.test(sentence)) return sentence;
  if (hasSentencePunctuation(sentence)) return sentence;

  return `${sentence}${normalizeTone(tone) === "활기찬" ? "!" : "."}`;
};

export const softenForTone = (value = "", tone = "") => {
  const normalizedTone = normalizeTone(tone);
  const source = text(value);

  if (!source) return "";
  if (normalizedTone === "전문적인") {
    return source
      .replace(/같아요/g, "것으로 보입니다")
      .replace(/더라고요/g, "확인됩니다")
      .replace(/해요/g, "합니다")
      .replace(/됐어요/g, "되었습니다")
      .replace(/봤어요/g, "확인했습니다")
      .replace(/ㅎㅎ|🙂/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (normalizedTone === "차분한") {
    return source
      .replace(/더라고요/g, "느껴졌습니다")
      .replace(/해요/g, "합니다")
      .replace(/같아요/g, "좋습니다")
      .replace(/됐어요/g, "되었습니다")
      .replace(/ㅎㅎ|🙂/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (normalizedTone === "활기찬") {
    return source
      .replace(/합니다/g, "해요")
      .replace(/습니다/g, "어요")
      .replace(/좋습니다/g, "좋더라고요")
      .replace(/정리하겠습니다/g, "정리해볼게요")
      .replace(/\s+/g, " ")
      .trim();
  }

  return source
    .replace(/정리하겠습니다/g, "정리해보려고 해요")
    .replace(/확인할 필요가 있습니다/g, "확인해보면 좋을 것 같아요")
    .replace(/확인하는 것이 좋습니다/g, "확인해보면 좋아요")
    .replace(/살펴보는 것이 좋습니다/g, "살펴보면 좋겠어요")
    .replace(/좋습니다/g, "좋아요")
    .replace(/같습니다/g, "같아요")
    .replace(/중요합니다/g, "중요하더라고요")
    .replace(/됐습니다/g, "됐어요")
    .replace(/됐다/g, "됐어요")
    .replace(/습니다/g, "어요")
    .replace(/합니다/g, "해요")
    .replace(/\s+/g, " ")
    .trim();
};

export const createToneTitleSuffix = (tone = "") =>
  ({
    친근한: "후기",
    차분한: "정리",
    전문적인: "체크포인트",
    활기찬: "후기"
  })[normalizeTone(tone)];
