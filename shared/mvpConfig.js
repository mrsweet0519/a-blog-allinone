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
  audienceTypes: ["사업자/매장 홍보", "인플루언서/수익형"],
  tones: ["친근한", "전문적인", "차분한", "활기찬"],
  targetLengths: [
    { label: "1200자", value: "1200" },
    { label: "1500자", value: "1500" },
    { label: "2000자", value: "2000" },
    { label: "2500자", value: "2500" },
    { label: "직접입력", value: "custom" }
  ]
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
  included: [
    "주제 추천",
    "선택형 제목/본문 초안",
    "목표 글자수",
    "내부 키워드 최적화 규칙",
    "게시용 최종본/내부 메모 분리",
    "광고주형 입력값 보강",
    "이미지 위치 추천",
    "해시태그 구성",
    "기본 대시보드",
    "로컬 초안 보관"
  ],
  excluded: ["댓글/대댓글 자동화 본체", "실제 AI API 연결", "외부 블로그 발행", "고급 자동화 설정"]
};
