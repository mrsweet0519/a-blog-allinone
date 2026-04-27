export const STORAGE_KEYS = {
  drafts: "a-blog-allinone:drafts",
  settings: "a-blog-allinone:settings"
};

export const makerOptions = {
  categories: [
    "온라인 쇼핑몰",
    "로컬 매장",
    "교육/강의",
    "전문 서비스",
    "브랜드 콘텐츠",
    "기타"
  ],
  goals: ["정보 전달", "신뢰 형성", "상품 홍보", "방문 유도"],
  tones: ["친근한", "전문적인", "차분한", "활기찬"]
};

export const makerStatuses = {
  idle: "입력 전",
  ready: "입력 완료",
  generating: "생성 중",
  generated: "생성 완료",
  editing: "수정 중",
  saved: "저장됨",
  copied: "복사 완료"
};

export const mvpScope = {
  included: ["주제 추천", "제목/본문 초안", "해시태그 구성", "기본 대시보드", "로컬 초안 보관"],
  excluded: ["댓글/대댓글 자동화 본체", "실제 AI API 연결", "외부 블로그 발행", "고급 자동화 설정"]
};
