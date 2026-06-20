import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accessCodes } from "../frontend/src/data/accessCodes.js";
import {
  clearAccessSession,
  createAccessSession,
  loadAccessSession,
  saveAccessSession,
  validateAccessCode
} from "../frontend/src/lib/accessControl.js";
import {
  deleteWritingProfile,
  loadWritingProfiles,
  saveWritingProfile
} from "../frontend/src/lib/localDrafts.js";
import {
  createFinalContent,
  createOutlineSections,
  createTitleCandidates,
  createTopicRecommendations
} from "../shared/contentGenerator.js";
import {
  assessCapturedCommentExtraction,
  getCaptureOcrConfidenceStatus
} from "../shared/commentReplyGenerator.js";
import { analyzeBlogWritingInput } from "../shared/blogWriterCategory.js";
import {
  evaluateHumanQuality,
  selectBestHumanQualityAttempt
} from "../shared/blogWriterHumanQuality.js";
import { buildBlogWriterPromptPayload } from "../shared/blogWriterPrompt.js";
import { evaluateBlogWriterQuality } from "../shared/blogWriterQuality.js";
import {
  buildBlogWriterPipelineContext,
  normalizeBlogWriterInput,
  parseSubKeywords
} from "../shared/blogWriterPipeline.js";
import { getEntityCoverage } from "../shared/blogWriterEntity.js";
import {
  createProductReviewDraft,
  extractProductInfoFieldsWithMetaFromText
} from "../shared/productReviewGenerator.js";
import { createTistoryDraft } from "../shared/tistoryGenerator.js";
import { onRequestPost as generateBlogOnRequestPost } from "../functions/api/generate-blog.js";

const now = new Date(2026, 5, 1, 10, 0, 0);
const holdoutUnknownTopicFixtures = JSON.parse(
  readFileSync(new URL("./fixtures/blog-quality/holdout-unknown-topics.json", import.meta.url), "utf8")
);
const extraHoldoutUnknownTopicFixtures = [
  { id: "restaurant-low-photo", category: "restaurant", sufficiency: "low-photo", form: { productName: "모래내 우동집 점심 후기", mainKeyword: "동네 우동 맛집", experienceMemo: "점심에 들러서 좋았음", imageContext: [{ index: 1, note: "우동 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "cafe-low-photo", category: "cafe", sufficiency: "low-photo", form: { productName: "초록문 카페 방문 후기", mainKeyword: "동네 카페", experienceMemo: "잠깐 쉬러 들렀고 분위기 좋았음", imageContext: [{ index: 1, note: "커피 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "product-low-photo", category: "product", sufficiency: "low-photo", form: { productName: "클린핏 물병 사용 후기", mainKeyword: "물병 후기", experienceMemo: "가방에 넣고 써봄", imageContext: [{ index: 1, note: "제품 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "store-low-photo", category: "store", sufficiency: "low-photo", form: { productName: "바른생활잡화 매장 방문 후기", mainKeyword: "동네 생활용품점", experienceMemo: "필요한 물건 사러 방문함", imageContext: [{ index: 1, note: "매장 입구 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "education-low-photo", category: "education", sufficiency: "low-photo", form: { productName: "새벽 영어회화 수업 후기", mainKeyword: "영어회화 수업", experienceMemo: "첫 수업 들어보고 기억남", imageContext: [{ index: 1, note: "수업 안내 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "hospital-low-photo", category: "hospital", sufficiency: "low-photo", form: { productName: "온빛내과 검진 방문 후기", mainKeyword: "내과 검진", experienceMemo: "검진 때문에 방문했고 차분했음", imageContext: [{ index: 1, note: "대기 공간 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "service-low-photo", category: "service", sufficiency: "low-photo", form: { productName: "모아설치 블라인드 시공 후기", mainKeyword: "블라인드 시공", experienceMemo: "이사 후 이용했고 좋았음", imageContext: [{ index: 1, note: "시공 전 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "travel-low-photo", category: "travel", sufficiency: "low-photo", form: { productName: "솔바람 호수 산책 후기", mainKeyword: "호수 산책 코스", experienceMemo: "가족이랑 다녀와서 좋았음", imageContext: [{ index: 1, note: "산책로 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "kids-low-photo", category: "kids-place", sufficiency: "low-photo", form: { productName: "하늘콩 키즈카페 방문 후기", mainKeyword: "키즈카페 후기", experienceMemo: "아이랑 다녀와서 좋았음", imageContext: [{ index: 1, note: "놀이 공간 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "experience-low-photo", category: "experience", sufficiency: "low-photo", form: { productName: "종이꽃 만들기 체험 후기", mainKeyword: "만들기 체험", experienceMemo: "처음 해봤고 기억남", imageContext: [{ index: 1, note: "재료 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "information-low-photo", category: "information", sufficiency: "low-photo", form: { productName: "반려견 등록 방법 알아보기", mainKeyword: "반려견 등록", experienceMemo: "처음 알아보는 중", imageContext: [{ index: 1, note: "안내문 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "comparison-low-photo", category: "comparison", sufficiency: "low-photo", form: { productName: "여행용 보조배터리 비교 기준", mainKeyword: "보조배터리 비교", experienceMemo: "구매 전 비교 중", imageContext: [{ index: 1, note: "제품 비교 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "accommodation-low-no-photo", category: "accommodation", sufficiency: "low-no-photo", form: { productName: "달숲스테이 숙박 후기", mainKeyword: "가족 숙소", experienceMemo: "하룻밤 머물렀고 좋았음", targetCharCount: 2500 } },
  { id: "accommodation-low-photo", category: "accommodation", sufficiency: "low-photo", form: { productName: "파도정원 펜션 숙박 후기", mainKeyword: "바다 펜션", experienceMemo: "가족이랑 묵어서 좋았음", imageContext: [{ index: 1, note: "객실 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "accommodation-medium-experience", category: "accommodation", sufficiency: "medium-experience", form: { productName: "노을쉼표 호텔 숙박 후기", mainKeyword: "가족 호텔", subKeywords: "객실, 조식, 주차", experienceMemo: "아이와 1박함\n객실 동선이 궁금했음\n아침에 이동하기 편했던 기억이 남", imageContext: [{ index: 1, note: "객실 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "accommodation-high-detail", category: "accommodation", sufficiency: "high-detail", form: { productName: "숲결펜션 가족 숙소 후기", mainKeyword: "가족 펜션 후기", subKeywords: "침구, 바비큐, 산책", experienceMemo: "가족여행으로 1박함\n침구와 바비큐 공간이 궁금했음\n주변 산책로가 기억남\n다음에도 조용히 쉬고 싶을 때 떠오를 것 같았음", imageContext: [{ index: 1, note: "객실 사진" }, { index: 2, note: "외관 사진" }], imageCount: 2, targetCharCount: 3200 } },
  { id: "beauty-low-no-photo", category: "beauty", sufficiency: "low-no-photo", form: { productName: "데이루틴 선크림 사용 후기", mainKeyword: "선크림 후기", experienceMemo: "며칠 써보고 괜찮았음", targetCharCount: 2500 } },
  { id: "beauty-low-photo", category: "beauty", sufficiency: "low-photo", form: { productName: "포근결 립밤 사용 후기", mainKeyword: "립밤 후기", experienceMemo: "가방에 넣고 써봄", imageContext: [{ index: 1, note: "제품 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "beauty-medium-experience", category: "beauty", sufficiency: "medium-experience", form: { productName: "맑은결 클렌징폼 사용 후기", mainKeyword: "클렌징폼 후기", subKeywords: "세안, 거품, 향", experienceMemo: "저녁 세안 때 사용함\n거품과 향이 궁금했음\n욕실에 두고 쓰기 편했음", imageContext: [{ index: 1, note: "제품 튜브 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "beauty-high-detail", category: "beauty", sufficiency: "high-detail", form: { productName: "수아래 세럼 사용 후기", mainKeyword: "세럼 후기", subKeywords: "아침 루틴, 제형, 흡수감", experienceMemo: "2주 동안 아침 루틴에 사용함\n제형이 무겁지 않은지 궁금했음\n손등에 덜었을 때 흐름이 기억남\n화장 전에 바르기 부담이 덜했음", imageContext: [{ index: 1, note: "제품 병 사진" }, { index: 2, note: "손등 제형 사진" }], imageCount: 2, targetCharCount: 3200 } },
  { id: "fashion-low-no-photo", category: "fashion", sufficiency: "low-no-photo", form: { productName: "데일리핏 셔츠 착용 후기", mainKeyword: "셔츠 후기", experienceMemo: "출근할 때 입어보고 좋았음", targetCharCount: 2500 } },
  { id: "fashion-low-photo", category: "fashion", sufficiency: "low-photo", form: { productName: "모노워크 운동화 착용 후기", mainKeyword: "운동화 후기", experienceMemo: "주말에 신어보고 기억남", imageContext: [{ index: 1, note: "운동화 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "fashion-medium-experience", category: "fashion", sufficiency: "medium-experience", form: { productName: "라운드 니트 착용 후기", mainKeyword: "니트 후기", subKeywords: "출근룩, 두께, 색감", experienceMemo: "출근룩으로 입어봄\n두께와 색감이 궁금했음\n외투 안에 입기 괜찮았음", imageContext: [{ index: 1, note: "착용 사진" }], imageCount: 1, targetCharCount: 2500 } },
  { id: "fashion-high-detail", category: "fashion", sufficiency: "high-detail", form: { productName: "브라운 토트백 사용 후기", mainKeyword: "토트백 후기", subKeywords: "출근가방, 수납, 무게", experienceMemo: "출근할 때 일주일 사용함\n노트북과 파우치가 들어가는지 궁금했음\n손잡이 그립감이 기억남\n무게가 과하지 않아 자주 들게 됨", imageContext: [{ index: 1, note: "가방 전체 사진" }, { index: 2, note: "수납 사진" }], imageCount: 2, targetCharCount: 3200 } }
];
holdoutUnknownTopicFixtures.push(...extraHoldoutUnknownTopicFixtures);

const valid = validateAccessCode("mgo-test7", accessCodes, now);
assert.equal(valid.ok, true);
assert.equal(valid.license.label, "7일 테스트");

const invalid = validateAccessCode("MGO-NOPE", accessCodes, now);
assert.equal(invalid.ok, false);
assert.equal(invalid.message, "유효하지 않은 접속코드입니다.");

const expired = validateAccessCode("MGO-EXPIRED", accessCodes, now);
assert.equal(expired.ok, false);
assert.equal(expired.message, "사용 기간이 종료되었습니다. 연장을 원하시면 문의해주세요.");

const inactive = validateAccessCode("MGO-PAUSED", accessCodes, now);
assert.equal(inactive.ok, false);
assert.equal(inactive.message, "사용이 중지된 코드입니다.");

const memoryStorage = new Map();
const localStorageMock = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, value) => memoryStorage.set(key, String(value)),
  removeItem: (key) => memoryStorage.delete(key)
};
globalThis.localStorage = localStorageMock;
globalThis.window = { localStorage: localStorageMock };
const session = createAccessSession(valid.license, now);
saveAccessSession(session);
assert.equal(loadAccessSession(now).code, "MGO-TEST7");
clearAccessSession();
assert.equal(loadAccessSession(now), null);

const productProfile = saveWritingProfile("수분크림 상품 후기용", {
  audienceType: "인플루언서/수익형",
  category: "뷰티/생활용품",
  goal: "정보 전달",
  tone: "친근한"
});
const shopProfile = saveWritingProfile("피부관리샵 프로필", {
  audienceType: "사업자/매장 홍보",
  category: "피부관리샵",
  goal: "방문 유도",
  tone: "전문적인"
});
assert.equal(loadWritingProfiles().length, 2);
assert.equal(loadWritingProfiles()[0].name, "피부관리샵 프로필");
assert.equal(loadWritingProfiles().find((profile) => profile.id === productProfile.id).values.category, "뷰티/생활용품");
deleteWritingProfile(shopProfile.id);
assert.equal(loadWritingProfiles().length, 1);
const keywordProfile = saveWritingProfile("keyword style profile", { keyword: "main keyword, sub keyword" });
assert.equal(loadWritingProfiles()[0].values.keyword, "main keyword, sub keyword");
deleteWritingProfile(keywordProfile.id);
delete globalThis.window;
delete globalThis.localStorage;

const finalContent = createFinalContent(
  {
    keyword: "드라이샴푸, 하얀가루, 바쁜 아침",
    category: "뷰티용품",
    brandName: "자체 브랜드",
    region: "",
    goal: "상품 홍보",
    audienceType: "인플루언서/수익형",
    tone: "친근한",
    strengths: "가벼운 사용감, 빠른 정리",
    emphasisPoint: "하얀가루와 떡짐이 적은 사용감",
    ctaDirection: "필요한 기준을 비교해보세요.",
    useEmoji: false,
    avoid: "과장 표현, 확정 표현",
    targetLengthOption: "1500",
    customTargetLength: "1800"
  },
  "드라이샴푸 비교 전 먼저 확인할 기준",
  "드라이샴푸 고를 때 하얀가루와 사용감 비교 기준",
  [
    "드라이샴푸를 볼 때 먼저 알아둘 기본 흐름",
    "하얀가루까지 함께 보는 선택 포인트",
    "바쁜 아침과 함께 비교할 포인트",
    "마무리 정리와 다음 확인 포인트"
  ],
  {
    selectedOpeningSentence:
      "드라이샴푸를 처음 본다면 실제로 꾸준히 활용할 수 있는 조건인지 먼저 확인하는 것이 좋습니다.",
    selectedCtaSentence: "필요한 기준을 비교해보세요."
  }
);

const checkIds = finalContent.seoCheck.items.map((item) => item.id);
assert.ok(finalContent.seoCheck.items.length >= 14);
assert.ok(checkIds.includes("first-sentence-keyword"));
assert.ok(checkIds.includes("first-paragraph-keyword-density"));
assert.ok(checkIds.includes("first-paragraph-answer"));
assert.ok(checkIds.includes("title-body-match"));
assert.ok(checkIds.includes("search-intent-goal-match"));
assert.ok(checkIds.includes("outline-body-linked"));
assert.ok(checkIds.includes("experience-comparison-check"));
assert.ok(checkIds.includes("overclaim"));
assert.ok(checkIds.includes("image-markers"));
assert.ok(finalContent.body.includes("[여기에 이미지 1을 넣어주세요:"));
assert.ok(finalContent.imageSuggestions[0].directShotGuide);
assert.ok(finalContent.imageSuggestions[0].aiPrompt);
assert.ok(!finalContent.body.includes("FAQ"));
assert.ok(finalContent.body.includes("구매 전 확인"));
assert.ok(finalContent.seoCheck.items.find((item) => item.id === "faq-question").passed);
assert.ok(finalContent.seoCheck.items.find((item) => item.id === "avoid").passed);

const betaForm = {
  keyword: "수분크림 후기, 피부 보습",
  category: "뷰티/생활용품",
  brandName: "",
  region: "",
  goal: "정보 전달",
  audienceType: "인플루언서/수익형",
  tone: "친근한",
  strengths: "사용감 확인, 보습력, 후기 흐름",
  emphasisPoint: "구매 전 데일리 케어 관점으로 살펴볼 기준",
  ctaDirection: "필요한 기준을 천천히 비교해보세요.",
  purchaseUrl: "온라인 판매처",
  priceInfo: "상세페이지 기준 확인",
  contactMethod: "판매처 문의",
  shippingInfo: "구매처 안내 기준 확인",
  useEmoji: false,
  avoid: "효과 보장, 과장 표현, 완벽",
  targetLengthOption: "2000",
  customTargetLength: "2000"
};
const betaTopic = createTopicRecommendations(betaForm)[0];
const betaTitles = createTitleCandidates(betaForm, betaTopic);
assert.equal(betaTitles.length, 5);
assert.ok(betaTitles.every((title) => Array.from(title).length <= 36));
assert.ok(betaTitles[0].includes("수분크림 후기"));
assert.ok(betaTitles[1].includes("후기"));
const betaOutline = createOutlineSections(betaForm, betaTopic, betaTitles[0]);
assert.equal(betaOutline.length, 5);
const betaContent = createFinalContent(betaForm, betaTopic, betaTitles[0], betaOutline);
const betaFirstParagraph = betaContent.body.split(/\n{2,}/u)[0].replace(/^✨\s*/u, "");
const betaFirstSentence = betaFirstParagraph.split(/(?<=[.!?요다])\s+/u)[0];
assert.ok(betaFirstSentence.includes("수분크림 후기"));
assert.equal(betaFirstParagraph.split("수분크림 후기").length - 1, 3);
assert.ok(/후기|비교|체크/u.test(betaContent.body));
assert.ok(!betaContent.body.includes("FAQ"));
assert.ok(betaContent.body.includes("제품 정보 정리"));
assert.ok(betaContent.hashtags.length >= 10 && betaContent.hashtags.length <= 15);
assert.ok(betaContent.hashtags.includes("#수분크림후기"));
assert.ok(betaContent.seoCheck.items.find((item) => item.id === "first-sentence-keyword").passed);
assert.ok(betaContent.seoCheck.items.find((item) => item.id === "first-paragraph-keyword-density").passed);

const reviewTitleForm = {
  ...betaForm,
  keyword: "데일리백 후기, 출근가방",
  brandName: "",
  strengths: "수납력 확인, 출근길 사용감, 후기 흐름",
  emphasisPoint: "구매 전 후기에서 많이 보는 기준"
};
const reviewTopic = createTopicRecommendations(reviewTitleForm)[0];
const reviewTitles = createTitleCandidates(reviewTitleForm, reviewTopic);
assert.equal(reviewTitles.length, 5);
assert.ok(reviewTitles[0].startsWith("데일리백 후기"));
assert.ok(reviewTitles[1].includes("출근가방 데일리백 후기") && reviewTitles[1].includes("후기"));
assert.ok(reviewTitles[2].includes("비교"));
assert.ok(reviewTitles[3].includes("선택"));
assert.ok(reviewTitles[4].includes("다른 점"));

const betaProductReviewForm = {
  keyword: "수분크림 후기, 피부 보습, 데일리 크림",
  category: "상품 리뷰",
  brandName: "",
  region: "",
  goal: "상품 홍보",
  audienceType: "인플루언서/수익형",
  tone: "친근한",
  strengths: "사용감 확인, 보습감, 데일리 루틴",
  emphasisPoint: "구매 전 데일리 케어 관점으로 볼 기준",
  ctaDirection: "필요한 기준을 천천히 비교해보세요.",
  useEmoji: false,
  avoid: "효과 보장, 과장 표현, 완벽",
  targetLengthOption: "2000",
  customTargetLength: "2000"
};
const betaProductTopic = createTopicRecommendations(betaProductReviewForm)[0];
const betaProductTitle = createTitleCandidates(betaProductReviewForm, betaProductTopic)[0];
const betaProductOutline = createOutlineSections(betaProductReviewForm, betaProductTopic, betaProductTitle);
const editedProductOutline = [
  {
    heading: "수분크림 후기 구매 이유를 바꾼 소제목",
    note: "피부 보습 기준을 첫 문단에 자연스럽게 반영"
  },
  {
    heading: "새로 추가한 데일리 크림 보습 체크",
    note: "데일리 크림 메모 반영"
  },
  {
    heading: betaProductOutline[2],
    note: ""
  },
  {
    heading: betaProductOutline[1],
    note: "순서 변경 확인"
  }
];
const betaProductContent = createFinalContent(
  betaProductReviewForm,
  betaProductTopic,
  betaProductTitle,
  editedProductOutline
);
assert.ok(betaProductContent.body.includes("수분크림 후기 구매 이유를 바꾼 소제목"));
assert.ok(betaProductContent.body.includes("새로 추가한 데일리 크림 보습 체크"));
assert.ok(betaProductContent.body.includes("사용자 메모: 데일리 크림 메모 반영"));
assert.ok(
  betaProductContent.body.indexOf("새로 추가한 데일리 크림 보습 체크") <
    betaProductContent.body.indexOf(betaProductOutline[2])
);
assert.ok(!betaProductContent.body.includes("삭제 테스트용 소제목"));
assert.ok(!/(^|\n)\s*\*\s+|(^|\n)\s*\*\*.+\*\*/u.test(betaProductContent.body));
assert.ok(/했어요|더라고요|같아요|좋겠어요/u.test(betaProductContent.body));
assert.equal(betaProductContent.contentPackage.faqItems.length, 3);
assert.ok(betaProductContent.seoCheck.items.find((item) => item.id === "heading-stars-removed").passed);

const uxEditedTopicForm = {
  keyword: "수분크림 후기, 피부 보습, 데일리 크림",
  category: "상품 리뷰",
  brandName: "",
  region: "",
  goal: "정보 전달",
  audienceType: "인플루언서/수익형",
  tone: "친근한",
  strengths: "사용감 확인, 보습감, 데일리 루틴",
  emphasisPoint: "건조한 피부에 맞는 수분크림 선택 기준",
  ctaDirection: "필요한 기준을 천천히 비교해보세요.",
  useEmoji: false,
  avoid: "효과 보장, 과장 표현",
  targetLengthOption: "1500",
  customTargetLength: "1500"
};
const uxEditedTopic = "건조한 피부에 수분크림을 고를 때 확인한 기준";
const uxEditedTitles = createTitleCandidates(uxEditedTopicForm, uxEditedTopic);
assert.equal(uxEditedTitles.length, 5);
assert.ok(uxEditedTitles[0].includes("수분크림 후기"));
const uxEditedOutline = createOutlineSections(uxEditedTopicForm, uxEditedTopic, uxEditedTitles[0]);
const uxEditedContent = createFinalContent(
  uxEditedTopicForm,
  uxEditedTopic,
  uxEditedTitles[0],
  uxEditedOutline
);
assert.equal(uxEditedContent.strategyMemo.selectedTopic, uxEditedTopic);
assert.equal(uxEditedContent.contentPackage.finalRecommendedTitle, uxEditedTitles[0]);
assert.ok(uxEditedContent.body.includes(uxEditedOutline[0]));
assert.ok(!/(^|\n)\s*\*\s+|(^|\n)\s*\*\*.+\*\*/u.test(uxEditedContent.body));

const betaComparisonForm = {
  ...betaProductReviewForm,
  category: "비교형",
  audienceType: "사업자/매장 홍보",
  goal: "정보 전달",
  tone: "차분한"
};
const betaComparisonTopic = createTopicRecommendations(betaComparisonForm)[0];
const betaComparisonTitle = createTitleCandidates(betaComparisonForm, betaComparisonTopic)[2];
const betaComparisonOutline = createOutlineSections(betaComparisonForm, betaComparisonTopic, betaComparisonTitle);
assert.notDeepEqual(betaComparisonOutline, betaProductOutline);
assert.ok(betaComparisonOutline.join(" ").includes("비교"));

const betaRestaurantForm = {
  keyword: "부천 가족외식, 부천 맛집, 아이랑 식당",
  category: "맛집 리뷰",
  brandName: "",
  region: "부천",
  goal: "방문 유도",
  audienceType: "사업자/매장 홍보",
  tone: "친근한",
  strengths: "",
  emphasisPoint: "",
  ctaDirection: "",
  useEmoji: false,
  avoid: "무조건, 보장",
  targetLengthOption: "2000",
  customTargetLength: "2000"
};
const betaRestaurantTopic = createTopicRecommendations(betaRestaurantForm)[0];
const betaRestaurantTitle = createTitleCandidates(betaRestaurantForm, betaRestaurantTopic)[0];
const betaRestaurantOutline = createOutlineSections(betaRestaurantForm, betaRestaurantTopic, betaRestaurantTitle);
const betaRestaurantContent = createFinalContent(
  betaRestaurantForm,
  betaRestaurantTopic,
  betaRestaurantTitle,
  betaRestaurantOutline
);
assert.ok(betaRestaurantOutline.join(" ").includes("주차"));
assert.ok(betaRestaurantContent.body.includes("주차: [확인 필요]"));
assert.ok(betaRestaurantContent.body.includes("대표 메뉴"));
assert.ok(betaRestaurantContent.body.includes("아이 동반"));
assert.ok(betaRestaurantContent.body.includes("[확인 필요]"));
assert.equal(
  betaRestaurantContent.seoCheck.items.find((item) => item.id === "sponsorship-disclosure").detail,
  "[협찬 여부 확인 필요]"
);

const betaInfoForm = {
  keyword: "초등 독서노트, 독서 습관, 부모 가이드",
  category: "정보글",
  brandName: "",
  region: "",
  goal: "정보 전달",
  audienceType: "사업자/매장 홍보",
  tone: "차분한",
  strengths: "독서 습관 점검, 부모 가이드",
  emphasisPoint: "아이 성향에 맞는 독서 기록 방식",
  ctaDirection: "가정 상황에 맞는 기준부터 확인해보세요.",
  useEmoji: false,
  avoid: "",
  targetLengthOption: "2000",
  customTargetLength: "2000"
};
const betaInfoTopic = createTopicRecommendations(betaInfoForm)[0];
const betaInfoTitle = createTitleCandidates(betaInfoForm, betaInfoTopic)[0];
const betaInfoOutline = createOutlineSections(betaInfoForm, betaInfoTopic, betaInfoTitle);
const betaInfoContent = createFinalContent(betaInfoForm, betaInfoTopic, betaInfoTitle, betaInfoOutline);
assert.ok(betaInfoOutline.join(" ").includes("체크리스트"));
assert.ok(betaInfoContent.body.includes("FAQ"));
assert.ok((betaInfoContent.body.match(/^Q\.\s/gmu) || []).length >= 3);
assert.equal(betaInfoContent.contentPackage.faqItems.length, 3);

const noisyOcrText = [
  "@.마우스를 올려보세요.",
  "이 02 03",
  "& zg",
  "hy",
  "01",
  "간편한 데일리 보습 루틴",
  "성분: 히알루론산, 세라마이드 함유",
  "용량: 50ml",
  "사용법: 아침 저녁 적당량 사용",
  "가격: 29,000원",
  "주의: 직사광선을 피해서 보관"
].join("\n");
const ocrExtraction = extractProductInfoFieldsWithMetaFromText(noisyOcrText);
const extractedProductInfoText = Object.values(ocrExtraction.fields).join("\n");
assert.ok(!/@\.마우스를|이 02 03|& zg|hy|\n01\n/u.test(`\n${extractedProductInfoText}\n`));
assert.ok(ocrExtraction.fields.features.includes("간편한 데일리 보습 루틴"));
assert.ok(ocrExtraction.fields.ingredients.includes("히알루론산"));
assert.ok(ocrExtraction.fields.capacity.includes("50ml"));
assert.ok(ocrExtraction.fields.usage.includes("아침 저녁"));
assert.ok(ocrExtraction.fields.price.includes("29,000원"));
assert.equal(ocrExtraction.meta.capacity.status, "확인됨");
assert.equal(ocrExtraction.meta.features.status, "확인됨");

const noiseOnlyExtraction = extractProductInfoFieldsWithMetaFromText(
  "@.마우스를 올려보세요.\n이 02 03\n& zg\nhy\n02\nQo"
);
assert.equal(Object.values(noiseOnlyExtraction.fields).filter(Boolean).length, 0);
assert.equal(noiseOnlyExtraction.meta.capacity.status, "읽지 못함");
assert.equal(noiseOnlyExtraction.meta.usage.status, "읽지 못함");

const productReview = createProductReviewDraft({
  productName: "수분크림",
  mainKeyword: "수분크림, 피부 보습, 데일리 크림",
  experienceMemo:
    "처음에는 보습력이 궁금해서 찾아봤어요.\n사용감이 무겁지 않은지 보고 싶었어요.\n아침저녁으로 부담 없이 쓸 수 있는 제품인지 확인하고 싶었어요.",
  emphasisPoints: "사용감, 보습력, 데일리 케어",
  avoidWords: "무조건, 보장, 완벽, 즉시효과",
  tone: "친근한",
  targetLength: "1500"
});
const productFirstParagraph = productReview.body.split(/\n{2,}/u)[0];
const productFirstParagraphKeywordCount = productFirstParagraph.split("수분크림").length - 1;
assert.ok(productFirstParagraph.startsWith("수분크림"));
assert.ok(productFirstParagraphKeywordCount >= 2 && productFirstParagraphKeywordCount <= 3);
assert.ok(/해요|더라고요|같아요/u.test(productFirstParagraph));
assert.ok((productFirstParagraph.match(/찾아보다/gu) || []).length <= 1);
assert.ok((productFirstParagraph.match(/궁금/gu) || []).length <= 1);
assert.ok(!/경험 메모|OCR 원문|추출 데이터/u.test(productReview.body));
assert.ok(!/무조건|보장|완벽|즉시효과/u.test(productReview.body));
assert.ok(!/여기에 이미지|이미지\s*\d|사진\s*\d/u.test(productReview.body));
assert.ok(productReview.hashtags.includes("#수분크림후기"));
assert.equal(productReview.titles.slice(0, 3).length, 3);
assert.ok(productReview.outline.includes("사용 전 궁금했던 점"));
assert.ok(productReview.outline.includes("직접 써본 느낌"));
assert.equal(productReview.thumbnailTexts.length, 3);
assert.ok(productReview.searchKeywords.includes("수분크림"));
assert.ok(productReview.closingParagraph.length > 20);

const noisyProductReview = createProductReviewDraft({
  productName: "수분크림",
  mainKeyword: "수분크림, 피부 보습, 데일리 크림",
  productInfoText: noisyOcrText,
  experienceMemo:
    "처음에는 보습력이 궁금해서 찾아봤어요.\n사용감이 무겁지 않은지 보고 싶었어요.\n아침저녁으로 부담 없이 쓸 수 있는 제품인지 확인하고 싶었어요.",
  avoidWords: "무조건, 보장, 완벽, 즉시효과",
  tone: "친근한",
  targetLength: "1500"
});
assert.ok(!/@\.마우스를|이 02 03|& zg|hy/u.test(noisyProductReview.body));
assert.ok(noisyProductReview.body.includes("50ml") || noisyProductReview.body.includes("히알루론산"));

const restaurantPhotoReview = createProductReviewDraft({
  mainKeyword: "역삼역 호홀이 반점 리뷰",
  category: "restaurant",
  experienceMemo:
    "탕수육이 바삭했고 어향가지가 맛있었어요. 4명이 먹기 좋았고 직장인 회식 장소로 괜찮아 보였어요.",
  imageContext: [
    { index: 1, name: "hoholi-entrance.jpg", note: "입구와 외관" },
    { index: 2, name: "crispy-tangsuyuk.jpg", note: "탕수육이 바삭했던 사진" },
    { index: 3, name: "eohyang-gaji.jpg", note: "어향가지 메뉴" }
  ],
  imageCount: 3,
  tone: "친근한",
  targetLength: "1500"
});
assert.equal(restaurantPhotoReview.category, "restaurant");
assert.ok(restaurantPhotoReview.outline.some((heading) => heading.includes("분위기")));
assert.ok(restaurantPhotoReview.outline.some((heading) => heading.includes("추천")));
assert.ok(restaurantPhotoReview.body.includes("직장인 회식"));
assert.ok(restaurantPhotoReview.body.includes("탕수육"));
assert.ok(restaurantPhotoReview.body.includes("어향가지"));
assert.ok(restaurantPhotoReview.body.includes("4명"));
assert.ok(restaurantPhotoReview.body.includes("입구와 외관"));
assert.ok(!/여기에 이미지|이미지\s*\d|사진\s*\d/u.test(restaurantPhotoReview.body));
assert.ok(!/(^|\n)\s*\*\s+|(^|\n)\s*\*\*.+\*\*/u.test(restaurantPhotoReview.body));
assert.equal((restaurantPhotoReview.body.match(/\[사진 삽입:/gu) || []).length, 3);

const creamPhotoReview = createProductReviewDraft({
  mainKeyword: "수분크림 직접 써본 후기",
  category: "product",
  experienceMemo:
    "발림감은 가볍고 향은 은은했어요. 아침저녁으로 쓰기 좋았고 끈적임은 적은 편이었어요.",
  imageContext: [
    { index: 1, name: "cream-package.jpg", note: "제품 패키지" },
    { index: 2, name: "cream-texture.jpg", note: "가벼운 발림감" },
    { index: 3, name: "cream-label.jpg", ocrText: "용량 50ml" }
  ],
  imageCount: 3,
  tone: "친근한",
  targetLength: "1500"
});
assert.equal(creamPhotoReview.category, "product");
assert.ok(creamPhotoReview.outline.includes("사용 전 궁금했던 점"));
assert.ok(creamPhotoReview.body.includes("좋았던 점") || creamPhotoReview.body.includes("좋았어요"));
assert.ok(creamPhotoReview.body.includes("아쉬운 점"));
assert.ok(creamPhotoReview.body.includes("발림감"));
assert.ok(creamPhotoReview.body.includes("향"));
assert.ok(creamPhotoReview.body.includes("아침저녁"));
assert.ok(creamPhotoReview.body.includes("끈적임"));
assert.ok(creamPhotoReview.body.includes("50ml"));
assert.ok(!/여기에 이미지|이미지\s*\d|사진\s*\d/u.test(creamPhotoReview.body));
assert.equal((creamPhotoReview.body.match(/\[사진 삽입:/gu) || []).length, 3);

const singlePhotoReview = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  experienceMemo:
    "운동 후 사용\n앞머리와 정수리 보송\n휴대 편함\n향 무난함",
  imageContext: [
    { index: 1, name: "dry-shampoo-main.jpg", note: "제품 전체 사진" }
  ],
  imageCount: 1,
  tone: "친근한",
  targetLengthOption: "short"
});
assert.ok(["product", "beauty"].includes(singlePhotoReview.category));
assert.equal((singlePhotoReview.body.match(/\[사진 삽입:/gu) || []).length, 1);
assert.ok(singlePhotoReview.body.includes("[사진 삽입: 제품 전체 사진]"));
assert.ok(!/dry-shampoo-main|파일명|OCR|carousel|image page/u.test(singlePhotoReview.body));

const kidsPlacePhotoReview = createProductReviewDraft({
  mainKeyword: "아이랑 다녀온 실내 체험공간 후기",
  category: "kids-place",
  experienceMemo:
    "아이가 체험을 좋아했고 부모 대기 공간도 편했어요. 주차는 확인이 필요해요.",
  imageContext: [
    { index: 1, name: "kids-space.jpg", note: "실내 체험공간 전체" },
    { index: 2, name: "activity-zone.jpg", note: "아이가 좋아한 체험" },
    { index: 3, name: "parent-waiting.jpg", note: "부모 대기 공간" }
  ],
  imageCount: 3,
  tone: "친근한",
  targetLength: "1500"
});
assert.ok(kidsPlacePhotoReview.body.includes("아이 반응"));
assert.ok(kidsPlacePhotoReview.body.includes("체험 흐름"));
assert.ok(kidsPlacePhotoReview.body.includes("부모 대기"));
assert.ok(kidsPlacePhotoReview.body.includes("주차"));
assert.ok(kidsPlacePhotoReview.body.includes("주차는 확인이 필요"));
assert.ok(kidsPlacePhotoReview.outline.some((heading) => heading.includes("아이")));
assert.ok(!/여기에 이미지|이미지\s*\d|사진\s*\d/u.test(kidsPlacePhotoReview.body));

const forbiddenReviewGuidePattern =
  /정리해보려고|기준으로 풀어두면|중심으로 정리했|이런 흐름으로 작성|글에 담아보겠습니다|아래 내용은|과하게 단정하기보다|기준으로 볼 것 같아요|이번 초안|본문 흐름|검색자가 궁금|제공된 메모|확인 필요 정보|최종 발행|네이버 검색|사용자가 직접|최종 검수표|글의 중심이 분명해집니다|구체적으로 보완|글이 더 살아납니다|글이 더 구체적으로|작성하면 좋습니다|작성하면|확인할 부분으로 남겨두는 편|확인할 부분|확인되지 않은 정보는|단정하지 않는 편|후기를 함께 보는 편|방문 전 확인할 항목|안전해요|실제 후기를 함께|맛집 후기답게|본문에서|메모|제공된 정보|사진과 함께 보완|정보가 없다면/u;

const forbiddenUnsupportedRestaurantClaimPattern =
  /분위기와\s*양,\s*응대|메뉴와\s*분위기,\s*양,\s*응대|직원\s*응대가\s*좋|직원\s*친절|주차가\s*편(?:했|한|해)|주차\s*편|다시\s*가고\s*싶|재방문\s*(?:의사|하고\s*싶)|맛있었|가격은\s*\d|가격\s*만족|웨이팅\s*없|예약\s*가능|영업시간\s*(?:은|:)\s*\d/u;

const countOccurrences = (value = "", needle = "") =>
  needle ? String(value || "").split(needle).length - 1 : 0;

const compactText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const isLikelyBodyHeading = (paragraph = "") => {
  const value = String(paragraph || "").trim();
  if (/^(?:왜|대표|매장|맛과|이런|좋았던|가족|마무리|방문 전|정리해서|한 번|.+기준|.+부분|.+점)(?:\s|$)/u.test(value)) {
    return Array.from(value).length <= 32 && !/[.!?。]$/u.test(value);
  }
  return Boolean(value) && !/^\[사진 삽입:/u.test(value) && !/[.!?。요다]$/u.test(value) && Array.from(value).length <= 32;
};

const assertNoDuplicateBodyParts = (body = "") => {
  const paragraphs = String(body || "").split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
  const headings = new Set();
  const paragraphKeys = new Set();

  paragraphs.forEach((paragraph) => {
    if (/^\[사진 삽입:/u.test(paragraph)) return;

    if (isLikelyBodyHeading(paragraph)) {
      const key = compactText(paragraph);
      assert.equal(headings.has(key), false, `중복 소제목: ${paragraph}`);
      headings.add(key);
      return;
    }

    const key = compactText(paragraph).slice(0, 120);
    if (Array.from(key).length < 18) return;
    assert.equal(paragraphKeys.has(key), false, `중복 문단: ${paragraph.slice(0, 50)}`);
    paragraphKeys.add(key);
  });
};

const requestedRestaurantReview = createProductReviewDraft({
  mainKeyword: "역삼역 중식당 회식 후기",
  category: "restaurant",
  experienceMemo:
    "탕수육이 바삭했고 어향가지가 맛있었어요. 4명이 먹기 좋았고 직장인 회식 장소로 괜찮아 보였어요. 가격과 주차는 확인이 필요해요.",
  tone: "친근한",
  targetLength: "1500"
});
const requestedRestaurantFirstSentence = requestedRestaurantReview.body.split(/(?<=[.!?])\s+/u)[0];
const requestedRestaurantFirstParagraph = requestedRestaurantReview.body.split(/\n{2,}/u)[0];
const requestedRestaurantMainKeyword = requestedRestaurantReview.contentPackage.mainKeyword;
const requestedRestaurantKeywordCount =
  requestedRestaurantFirstParagraph.split(requestedRestaurantMainKeyword).length - 1;
assert.equal(requestedRestaurantMainKeyword, "역삼역 중식당 회식");
assert.ok(requestedRestaurantFirstSentence.includes(requestedRestaurantMainKeyword));
assert.ok(requestedRestaurantKeywordCount >= 2 && requestedRestaurantKeywordCount <= 3);
assert.ok(!forbiddenReviewGuidePattern.test(requestedRestaurantReview.body));
assert.ok(requestedRestaurantReview.outline.some((heading) => heading.includes("분위기")));
assert.ok(requestedRestaurantReview.outline.some((heading) => heading.includes("주차")));
assert.ok(requestedRestaurantReview.body.includes("탕수육"));
assert.ok(requestedRestaurantReview.body.includes("어향가지"));
assert.ok(requestedRestaurantReview.body.includes("4명"));
assert.ok(requestedRestaurantReview.body.includes("직장인 회식"));
assert.ok(!requestedRestaurantReview.body.includes("[확인 필요]"));
assert.ok(requestedRestaurantReview.body.includes("최신 메뉴판") || requestedRestaurantReview.body.includes("방문 시점"));
assert.ok(requestedRestaurantReview.body.includes("주차 가능 여부"));
assert.ok(!/후기\s+후기/u.test(requestedRestaurantReview.selectedTitle));
assert.ok(!requestedRestaurantReview.hashtags.some((tag) => /후기후기/u.test(tag)));
assert.equal(requestedRestaurantReview.titles.slice(0, 3).length, 3);
assert.ok(requestedRestaurantReview.outline.some((heading) => heading.includes("주차")));
assert.equal(requestedRestaurantReview.thumbnailTexts.length, 3);
assert.ok(requestedRestaurantReview.searchKeywords.includes(requestedRestaurantMainKeyword));
const requestedRestaurantReferenceSection = requestedRestaurantReview.body.split("방문 전 참고하면 좋은 점")[1] || "";
assert.ok(!requestedRestaurantReferenceSection.includes("[확인 필요]"));
assert.ok(requestedRestaurantReview.contentPackage.infoSummary.some(([, value]) => String(value).includes("[확인 필요]")));

const requestedCreamReview = createProductReviewDraft({
  mainKeyword: "수분크림 직접 써본 후기",
  category: "product",
  experienceMemo:
    "발림감은 가볍고 향은 은은했어요. 아침저녁으로 쓰기 좋았고 끈적임은 적은 편이었어요.",
  tone: "친근한",
  targetLength: "1500"
});
assert.ok(!forbiddenReviewGuidePattern.test(requestedCreamReview.body));
assert.ok(requestedCreamReview.outline.includes("사용 전 궁금했던 점"));
assert.ok(requestedCreamReview.body.includes("좋았"));
assert.ok(requestedCreamReview.body.includes("아쉬운 점"));
assert.ok(requestedCreamReview.body.includes("발림감"));
assert.ok(requestedCreamReview.body.includes("향"));
assert.ok(requestedCreamReview.body.includes("아침저녁"));
assert.ok(requestedCreamReview.body.includes("끈적임"));
assert.ok(!/히알루론산|세라마이드|미백|주름|보습 효과|개선/u.test(requestedCreamReview.body));
assert.ok(!/후기\s+후기/u.test(requestedCreamReview.selectedTitle));
assert.ok(!requestedCreamReview.hashtags.some((tag) => /후기후기/u.test(tag)));

const goldExchangeReview = createProductReviewDraft({
  mainKeyword: "금거래소 후기",
  experienceMemo:
    "사장님이 너무 친절했고 아드님이 같이 하는데 2대째 운영한다고 들었어요. 금 시세 확인부터 매입 과정까지 차분하게 설명해줘서 처음 가도 부담이 적었어요.",
  imageContext: [
    { index: 1, name: "gold-store.jpg", note: "매장 입구와 상담 공간" },
    { index: 2, name: "gold-price-board.jpg", note: "금 시세 안내문" }
  ],
  imageCount: 2,
  tone: "친근한",
  targetLength: "1500"
});
assert.equal(goldExchangeReview.category, "store");
assert.equal(goldExchangeReview.contentPackage.mainKeyword, "금거래소");
assert.ok(goldExchangeReview.outline.includes("처음 방문해도 부담이 덜했던 상담 분위기"));
assert.ok(goldExchangeReview.outline.includes("매입 상담 전에 확인하면 좋은 부분"));
assert.ok(goldExchangeReview.body.includes("금거래소"));
assert.ok(goldExchangeReview.body.includes("사장님"));
assert.ok(goldExchangeReview.body.includes("친절"));
assert.ok(goldExchangeReview.body.includes("아드님"));
assert.ok(goldExchangeReview.body.includes("2대째"));
assert.ok(goldExchangeReview.body.includes("금 시세"));
assert.ok(goldExchangeReview.body.includes("매입 과정"));
assert.ok(goldExchangeReview.body.includes("상담"));
assert.ok(goldExchangeReview.body.includes("확인"));
assert.ok(goldExchangeReview.searchKeywords.includes("매장 후기"));
assert.ok(!/발림감|사용감|(?:^|[\s,])향(?:은|이|도|을|를|처럼|의|이나)?|아침저녁 사용|사용 장면|텍스처|제품 전체|패키지/u.test(goldExchangeReview.body));
assert.ok(!/여기에 이미지|이미지\s*\d|사진\s*\d/u.test(goldExchangeReview.body));
assert.ok(!forbiddenReviewGuidePattern.test(goldExchangeReview.body));

const requestedKidsPlaceReview = createProductReviewDraft({
  mainKeyword: "아이랑 다녀온 실내 체험공간 후기",
  category: "kids-place",
  experienceMemo:
    "아이가 체험을 좋아했고 부모 대기 공간도 편했어요. 주차는 확인이 필요해요.",
  tone: "친근한",
  targetLength: "1500"
});
assert.ok(!forbiddenReviewGuidePattern.test(requestedKidsPlaceReview.body));
assert.ok(requestedKidsPlaceReview.body.includes("아이 반응"));
assert.ok(requestedKidsPlaceReview.body.includes("부모 대기"));
assert.ok(requestedKidsPlaceReview.body.includes("아이가 체험을 좋아"));
assert.ok(requestedKidsPlaceReview.body.includes("주차는 확인이 필요"));

const customsLectureReview = createProductReviewDraft({
  mainKeyword: "세관공매 무료공개강의",
  category: "education",
  experienceMemo:
    "처음에는 세관공매라는 단어 자체가 어렵게 느껴졌어요. 입찰, 공고, 낙찰, 반출, 판로 흐름을 미리 확인할 수 있어서 좋았어요.",
  imageContext: [
    {
      index: 1,
      name: "ChatGPT Image 2026-06-12 carousel page 1.png",
      note: "강의 안내 이미지에서 커리큘럼과 진행 흐름",
      ocrText: "세관공매 입찰 공고 낙찰 반출 판로\n생성 시간: 2026-06-12 image page carousel"
    }
  ],
  imageCount: 1,
  tone: "친근한",
  targetLength: "1500"
});
assert.ok(customsLectureReview.body.includes("세관공매 무료공개강의"));
assert.ok(customsLectureReview.body.includes("세관공매라는 말부터 조금 어렵게 느껴"));
assert.ok(customsLectureReview.body.includes("강의 안내 이미지를 보니"));
assert.ok(customsLectureReview.body.includes("입찰"));
assert.ok(customsLectureReview.body.includes("공고"));
assert.ok(customsLectureReview.body.includes("낙찰"));
assert.ok(customsLectureReview.body.includes("반출"));
assert.ok(customsLectureReview.body.includes("판로"));
assert.ok(!/carousel|ChatGPT Image|image page|업로드 파일명|생성 시간|내부 이미지 식별자|\.png|이미지\s*\d|사진\s*\d/iu.test(customsLectureReview.body));
assert.ok(!forbiddenReviewGuidePattern.test(customsLectureReview.body));

const qualityGoldStoreReview = createProductReviewDraft({
  mainKeyword: "부천금거래소 후기",
  experienceMemo:
    "사장님이 너무 친절\n아드님이랑 같이 하는데 2대째 운영중\n금값 올라서 방문\n매입 상담",
  imageContext: [
    { index: 1, note: "매장 외관과 입구" },
    { index: 2, note: "상담 공간과 진열된 제품" }
  ],
  imageCount: 2,
  tone: "친근한",
  targetLength: "1500"
});
const qualityGoldFirstParagraph = qualityGoldStoreReview.body.split(/\n{2,}/u)[0];
assert.equal(qualityGoldStoreReview.category, "store");
assert.ok(qualityGoldStoreReview.outline.includes("금값이 오르다 보니 자연스럽게 알아보게 된 곳"));
assert.ok(/금값|금값이 오르/u.test(qualityGoldFirstParagraph));
assert.ok(!qualityGoldFirstParagraph.includes("찾는 분이라면"));
assert.ok(qualityGoldStoreReview.body.includes("사장님"));
assert.ok(qualityGoldStoreReview.body.includes("친절"));
assert.ok(qualityGoldStoreReview.body.includes("아드님"));
assert.ok(qualityGoldStoreReview.body.includes("2대째"));
assert.ok(qualityGoldStoreReview.body.includes("금값"));
assert.ok(qualityGoldStoreReview.body.includes("매입 상담"));
assert.ok(qualityGoldStoreReview.body.includes("외관 사진"));
assert.ok(!/발림감|사용감|아침저녁|텍스처|제품 전체|사용 장면|(?:^|[\s,])향(?:은|이|도|을|를|처럼|의|이나)?/u.test(qualityGoldStoreReview.body));

const qualityCustomsEducationReview = createProductReviewDraft({
  mainKeyword: "세관공매 무료공개강의 후기",
  experienceMemo:
    "초보자도 이해 쉬움\n커리큘럼 확인\n입찰 흐름 궁금\n김바울 교수 강의",
  imageContext: [
    { index: 1, note: "강의 안내 이미지 커리큘럼과 입찰 흐름" }
  ],
  imageCount: 1,
  tone: "친근한",
  targetLength: "1500"
});
assert.equal(qualityCustomsEducationReview.category, "education");
assert.ok(qualityCustomsEducationReview.outline.includes("초보자도 흐름을 잡기 쉬웠던 구성"));
assert.ok(qualityCustomsEducationReview.body.includes("초보자"));
assert.ok(qualityCustomsEducationReview.body.includes("커리큘럼"));
assert.ok(qualityCustomsEducationReview.body.includes("입찰 흐름"));
assert.ok(qualityCustomsEducationReview.body.includes("김바울 교수"));
assert.ok(qualityCustomsEducationReview.body.includes("강의 안내 이미지를 보니"));
assert.ok(!/발림감|사용감|배송|패키지|제품 전체|사용 장면/u.test(qualityCustomsEducationReview.body));

const qualityDryShampooReview = createProductReviewDraft({
  mainKeyword: "에어젤 드라이샴푸 후기",
  experienceMemo:
    "운동 후 사용\n떡진 머리 보송\n휴대 편함\n향 괜찮음",
  tone: "친근한",
  targetLength: "1500"
});
assert.ok(["product", "beauty"].includes(qualityDryShampooReview.category));
assert.ok(qualityDryShampooReview.outline.includes("사용하게 된 상황"));
assert.ok(qualityDryShampooReview.body.includes("운동"));
assert.ok(qualityDryShampooReview.body.includes("보송"));
assert.ok(qualityDryShampooReview.body.includes("휴대"));
assert.ok(qualityDryShampooReview.body.includes("향"));
assert.ok(!/상담|서비스|신청|견적|예약 과정|비용 일정|추가 조건|결과 확인 장면/u.test(qualityDryShampooReview.body));

const requestedGoldStorePackageReview = createProductReviewDraft({
  mainKeyword: "부천금거래소 후기",
  experienceMemo:
    "사장님 친절하심\n아드님이 2대째 운영중"
});
assert.equal(requestedGoldStorePackageReview.category, "store");
assert.ok(requestedGoldStorePackageReview.bodyLength >= 1000 && requestedGoldStorePackageReview.bodyLength <= 2200);
assert.equal(requestedGoldStorePackageReview.contentPackage.titleCandidates.length, 5);
assert.equal(requestedGoldStorePackageReview.contentPackage.faqItems.length, 3);
assert.ok(requestedGoldStorePackageReview.contentPackage.secondaryKeywords.includes("금매입"));
assert.ok(requestedGoldStorePackageReview.contentPackage.secondaryKeywords.includes("금시세"));
assert.ok(requestedGoldStorePackageReview.contentPackage.secondaryKeywords.includes("상담 분위기"));
assert.ok(requestedGoldStorePackageReview.body.includes("사장님"));
assert.ok(requestedGoldStorePackageReview.body.includes("친절"));
assert.ok(requestedGoldStorePackageReview.body.includes("아드님"));
assert.ok(requestedGoldStorePackageReview.body.includes("2대째"));
assert.ok(requestedGoldStorePackageReview.contentPackage.infoSummary.some(([, value]) => String(value).includes("[확인 필요]")));
assert.ok(!forbiddenReviewGuidePattern.test(requestedGoldStorePackageReview.body));
assert.ok(!/발림감|사용감|아침저녁|텍스처|제품 전체|사용 장면|(?:^|[\s,])향(?:은|이|도|을|를|처럼|의|이나)?/u.test(requestedGoldStorePackageReview.body));
assert.ok(!/가격\s*[0-9]|영업시간\s*[0-9]|주차\s*가능/u.test(requestedGoldStorePackageReview.body));

const requestedGoldBuySeoReview = createProductReviewDraft({
  productName: "부천금매입 후기",
  mainKeyword: "부천금매입",
  experienceMemo:
    "사장님 친절하심\n아드님이 2대째 운영중"
});
const requestedGoldBuyTitles = requestedGoldBuySeoReview.contentPackage.titleCandidates;
assert.equal(requestedGoldBuyTitles.length, 5);
assert.equal(new Set(requestedGoldBuyTitles).size, 5);
assert.ok(requestedGoldBuyTitles.every((title) => title.indexOf("부천금매입") >= 0 && title.indexOf("부천금매입") <= 8));
assert.ok(requestedGoldBuyTitles.every((title) => Array.from(title).length >= 24));
assert.ok(requestedGoldBuyTitles.every((title) => !/인생|무조건|대박|효과\s*보장|완전\s*추천/u.test(title)));
assert.equal(requestedGoldBuySeoReview.selectedTitle, requestedGoldBuyTitles[0]);
assert.ok(requestedGoldBuyTitles.some((title) => /상담.*분위기|분위기.*방문/u.test(title)));
assert.ok(requestedGoldBuyTitles.some((title) => title.includes("처음 방문")));
assert.ok(requestedGoldBuyTitles.some((title) => title.includes("상담 기준")));
assert.ok(requestedGoldBuyTitles.some((title) => title.includes("체크 포인트")));
assert.ok(requestedGoldBuyTitles.some((title) => title.includes("금값")));
assert.equal(requestedGoldBuySeoReview.contentPackage.titleCandidateEvaluations.length, 5);
assert.equal(
  requestedGoldBuySeoReview.contentPackage.selectedTitleEvaluation.score,
  Math.max(...requestedGoldBuySeoReview.contentPackage.titleCandidateEvaluations.map((item) => item.score))
);
const requestedGoldBuyRetitledReview = createProductReviewDraft({
  productName: "부천금매입 후기",
  mainKeyword: "부천금매입",
  experienceMemo:
    "사장님 친절하심\n아드님이 2대째 운영중",
  titleVariantSeed: 1
});
const requestedGoldBuyRetitledTitles = requestedGoldBuyRetitledReview.contentPackage.titleCandidates;
assert.equal(requestedGoldBuyRetitledTitles.length, 5);
assert.notDeepEqual(requestedGoldBuyRetitledTitles, requestedGoldBuyTitles);
assert.ok(requestedGoldBuyRetitledTitles.every((title) => title.indexOf("부천금매입") >= 0 && title.indexOf("부천금매입") <= 8));
assert.equal(requestedGoldBuyRetitledReview.selectedTitle, requestedGoldBuyRetitledTitles[0]);
assert.equal(
  requestedGoldBuyRetitledReview.contentPackage.selectedTitleEvaluation.score,
  Math.max(...requestedGoldBuyRetitledReview.contentPackage.titleCandidateEvaluations.map((item) => item.score))
);

const autoDryShampooReview = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  experienceMemo:
    "운동 후 사용\n떡진 머리 보송\n휴대 편함\n향 괜찮음"
});
assert.equal(autoDryShampooReview.contentPackage.mainKeyword, "에어젤 드라이샴푸");
assert.ok(autoDryShampooReview.selectedTitle.indexOf("에어젤 드라이샴푸") >= 0 && autoDryShampooReview.selectedTitle.indexOf("에어젤 드라이샴푸") <= 8);
assert.ok(autoDryShampooReview.contentPackage.titleCandidates.every((title) => Array.from(title).length >= 28));
assert.ok(autoDryShampooReview.contentPackage.titleCandidates.every((title) => title !== "에어젤 드라이샴푸 후기"));
assert.ok(!autoDryShampooReview.body.includes("[사진 삽입:"));
assert.equal(autoDryShampooReview.contentPackage.faqItems.length, 3);
assert.ok(autoDryShampooReview.contentPackage.hashtags.length >= 10);

const autoGoldBuyReview = createProductReviewDraft({
  productName: "부천금매입 후기",
  experienceMemo:
    "사장님 친절하심\n아드님이 2대째 운영중"
});
assert.equal(autoGoldBuyReview.category, "store");
assert.equal(autoGoldBuyReview.contentPackage.mainKeyword, "부천금매입");
assert.ok(autoGoldBuyReview.contentPackage.titleCandidates.every((title) => title.indexOf("부천금매입") >= 0 && title.indexOf("부천금매입") <= 8));
assert.ok(autoGoldBuyReview.contentPackage.titleCandidates.every((title) => Array.from(title).length >= 28));
assert.ok(autoGoldBuyReview.contentPackage.titleCandidates.every((title) => title !== "부천금매입 후기"));
assert.ok(autoGoldBuyReview.body.includes("사장님"));
assert.ok(autoGoldBuyReview.body.includes("2대째"));

const shortKeywordExperienceReview = createProductReviewDraft({
  productName: "정서호 후기",
  experienceMemo:
    "처음 참여\n준비 과정 궁금\n진행 흐름 확인"
});
const shortKeywordTitles = shortKeywordExperienceReview.contentPackage.titleCandidates;
assert.equal(shortKeywordExperienceReview.category, "experience");
assert.equal(shortKeywordExperienceReview.contentPackage.mainKeyword, "정서호");
assert.equal(shortKeywordTitles.length, 5);
assert.equal(new Set(shortKeywordTitles).size, 5);
assert.ok(shortKeywordTitles.every((title) => title.indexOf("정서호") >= 0 && title.indexOf("정서호") <= 8));
assert.ok(shortKeywordTitles.every((title) => Array.from(title).length >= 28));
assert.ok(shortKeywordTitles.every((title) => title !== "정서호 후기"));
assert.ok(shortKeywordTitles.some((title) => title.includes("준비")));
assert.ok(shortKeywordTitles.some((title) => title.includes("진행")));
assert.ok(shortKeywordTitles.some((title) => title.includes("기준")));
assert.ok(shortKeywordExperienceReview.body.includes("처음"));
assert.ok(shortKeywordExperienceReview.body.includes("진행"));

const productReviewMakerSource = readFileSync(new URL("../frontend/src/pages/ProductReviewMaker.jsx", import.meta.url), "utf8");
const blogWriterApiSource = readFileSync(new URL("../functions/api/generate-blog.js", import.meta.url), "utf8");
const productReviewGeneratorSource = readFileSync(new URL("../shared/productReviewGenerator.js", import.meta.url), "utf8");
const blogWriterCategorySource = readFileSync(new URL("../shared/blogWriterCategory.js", import.meta.url), "utf8");
const blogWriterPipelineSource = readFileSync(new URL("../shared/blogWriterPipeline.js", import.meta.url), "utf8");
const blogWriterPromptSource = readFileSync(new URL("../shared/blogWriterPrompt.js", import.meta.url), "utf8");
const appLayoutSource = readFileSync(new URL("../frontend/src/components/AppLayout.jsx", import.meta.url), "utf8");
const oneClickProductionSource = [
  productReviewMakerSource,
  blogWriterApiSource,
  productReviewGeneratorSource,
  blogWriterCategorySource,
  blogWriterPipelineSource,
  blogWriterPromptSource
].join("\n");
assert.ok(blogWriterApiSource.includes("context.env"));
assert.ok(blogWriterApiSource.includes("BLOG_WRITER_LLM_ENABLED"));
assert.ok(blogWriterApiSource.includes("OPENAI_API_KEY"));
assert.ok(blogWriterApiSource.includes("static-fallback"));
assert.ok(blogWriterApiSource.includes("evaluateBlogWriterQuality"));
assert.ok(blogWriterApiSource.includes("evaluateHumanQuality"));
assert.ok(blogWriterApiSource.includes("BLOG_WRITER_LLM_JUDGE_ENABLED"));
assert.ok(blogWriterApiSource.includes("BLOG_WRITER_LLM_REVISION_ENABLED"));
assert.ok(blogWriterApiSource.includes("buildHumanJudgeMessages"));
assert.ok(blogWriterApiSource.includes('engine: "llm"'));
assert.ok(blogWriterApiSource.includes('engine: "fallback"'));
assert.ok(blogWriterApiSource.includes("server-key-missing"));
assert.ok(!/sk-[A-Za-z0-9_-]{20,}/u.test(blogWriterApiSource));
assert.ok(!/육짬|대천리조텔|청화횟집|마데카|강화도맛집|초지대교|갈낙짬뽕/u.test(oneClickProductionSource));
assert.ok(appLayoutSource.includes('to="/dashboard"'));
assert.ok(appLayoutSource.includes('aria-label="Dashboard로 이동"'));
assert.ok(appLayoutSource.includes("Blog All-in-One"));
assert.ok(appLayoutSource.includes("cursor-pointer"));
/*
assert.ok(productReviewMakerSource.includes("원클릭 네이버 글쓰기"));
assert.ok(productReviewMakerSource.includes("사진과 메모로"));
assert.ok(productReviewMakerSource.includes("네이버 블로그 초안을 만듭니다"));
assert.ok(productReviewMakerSource.includes("글 주제와 메인 키워드만 넣으면 제목, 본문, 해시태그까지 한 번에 정리됩니다."));
assert.ok(productReviewMakerSource.includes("아직 생성된 초안이 없습니다."));
assert.ok(productReviewMakerSource.includes("글 주제와 메모를 입력한 뒤 초안 만들기를 눌러주세요."));
assert.ok(productReviewMakerSource.includes("사진과 기억나는 내용만 넣어보세요"));
assert.ok(productReviewMakerSource.includes("제품명, 매장명, 방문 느낌처럼 짧은 메모만 있어도 블로그 후기 초안을 만들 수 있습니다."));
assert.ok(productReviewMakerSource.includes("예: 제품 사용 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기"));
assert.ok(productReviewMakerSource.includes("예: 제품명 / 매장명 / 지역명+장소유형"));
assert.ok(productReviewMakerSource.includes("예: 사용해보니 편했던 점, 아쉬웠던 점, 방문 분위기, 아이 반응, 다시 확인할 정보 등을 적어주세요."));
assert.ok(productReviewMakerSource.includes("선택사항"));
assert.ok(productReviewMakerSource.includes("whitespace-nowrap"));
assert.ok(productReviewMakerSource.includes("사진 속 글자 확인"));
assert.ok(productReviewMakerSource.includes("사진에서 읽힌 글자나 추가로 반영할 내용을 직접 확인하고 수정할 수 있습니다."));
assert.ok(productReviewMakerSource.includes("사진 속 글자가 자동으로 읽히면 여기에 표시됩니다. 필요한 내용은 직접 추가해도 됩니다."));
assert.ok(!productReviewMakerSource.includes("사진과 메모만 준비하면 네이버 블로그 초안이 완성됩니다"));
assert.ok(!productReviewMakerSource.includes("예: 에어젤 드라이샴푸 후기 / 부천금거래소 후기 / 아이랑 갈만한 카페"));
assert.ok(!productReviewMakerSource.includes("예: 에어젤 드라이샴푸 / 부천금거래소 / 부천 아이랑 카페"));
assert.ok(!productReviewMakerSource.includes("예: 탕수육이 바삭했고 어향가지가 맛있었어요"));
assert.ok(!productReviewMakerSource.includes("사진과 메모만 준비하세요"));
assert.ok(!productReviewMakerSource.includes("글 주제, 메인 키워드, 기억나는 내용을 넣으면 블로그 후기 초안이 완성됩니다."));
assert.ok(!productReviewMakerSource.includes("선택 입력"));
assert.ok(!productReviewMakerSource.includes("OCR 원문 보기"));
assert.ok(!productReviewMakerSource.includes("OCR"));
assert.ok(productReviewMakerSource.indexOf("1. 최종 추천 제목") < productReviewMakerSource.indexOf("2. 제목 더보기"));
assert.ok(productReviewMakerSource.indexOf("2. 제목 더보기") < productReviewMakerSource.indexOf("3. 블로그 본문"));
assert.ok(productReviewMakerSource.indexOf("3. 블로그 본문") < productReviewMakerSource.indexOf("4. 업체/상품 정보 정리"));
assert.ok(productReviewMakerSource.indexOf("4. 업체/상품 정보 정리") < productReviewMakerSource.indexOf("5. FAQ"));
assert.ok(productReviewMakerSource.indexOf("5. FAQ") < productReviewMakerSource.indexOf("6. 해시태그"));
assert.ok(productReviewMakerSource.includes('<ResultDetailSection title="2. 제목 더보기" copyActive={copied === "titles"} onCopy={() => copyText("titles")}>'));
assert.ok(productReviewMakerSource.includes("제목 다시 만들기"));
assert.ok(productReviewMakerSource.includes("titleVariantSeed"));
assert.ok(productReviewMakerSource.includes("blogBody: currentBlogBody"));
assert.ok(!productReviewMakerSource.includes("1. 제목 후보 5개"));
assert.ok(!productReviewMakerSource.includes("이런 분께 추천해요"));
assert.ok(!productReviewMakerSource.includes("상세 분석 보기"));
assert.ok(!productReviewMakerSource.includes("4. 사진 배치 가이드"));
*/
assert.ok(productReviewMakerSource.includes("원클릭 네이버 글쓰기"));
assert.ok(productReviewMakerSource.includes("사진과 메모로"));
assert.ok(productReviewMakerSource.includes("네이버 블로그 초안을 만듭니다"));
assert.ok(productReviewMakerSource.includes("글 주제와 기억나는 내용만 넣으면 제목, 본문, 해시태그까지 한 번에 정리됩니다."));
assert.ok(productReviewMakerSource.includes("ONE CLICK"));
assert.ok(productReviewMakerSource.includes("사진 넣고 글 생성"));
assert.ok(productReviewMakerSource.includes("사진과 기억나는 내용만 넣어보세요"));
assert.ok(productReviewMakerSource.includes("제품명, 매장명, 방문 느낌처럼 짧은 메모만 있어도 블로그 후기 초안을 만들 수 있습니다."));
assert.ok(productReviewMakerSource.includes("무엇에 대한 글인가요?"));
assert.ok(productReviewMakerSource.includes("예: 제품 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기"));
assert.ok(productReviewMakerSource.includes("기억나는 내용이 있나요?"));
assert.ok(productReviewMakerSource.includes("좋았던 점, 아쉬웠던 점, 아이 반응, 재방문 의사처럼 기억나는 말만 적어주세요."));
assert.ok(productReviewMakerSource.includes("사진 추가"));
assert.ok(productReviewMakerSource.includes("사진을 끌어오거나 클릭해서 추가하세요."));
assert.ok(productReviewMakerSource.includes("업로드 순서대로 본문에 사진 위치가 들어갑니다."));
assert.ok(productReviewMakerSource.includes("선택사항"));
assert.ok(productReviewMakerSource.includes("whitespace-nowrap"));
assert.ok(productReviewMakerSource.includes("고급 옵션"));
assert.ok(productReviewMakerSource.includes("메인 키워드"));
assert.ok(productReviewMakerSource.includes("예: 상호명 / 지역명 맛집 / 대표 메뉴"));
assert.ok(productReviewMakerSource.includes("서브 키워드"));
assert.ok(productReviewMakerSource.includes("예: 지역명 맛집, 대표 메뉴, 가족 외식"));
assert.ok(productReviewMakerSource.includes("비워두면 글 주제와 메모에서 자동 추천합니다. 최대 3개까지 쉼표로 나눠 입력하세요."));
assert.ok(productReviewMakerSource.includes("입력 정보가 적어 확인 가능한 내용을 중심으로 짧은 초안을 만들었습니다."));
assert.ok(productReviewMakerSource.includes("실제 방문·사용 여부"));
assert.ok(productReviewMakerSource.includes("가장 좋았던 점 또는 아쉬웠던 점"));
assert.ok(productReviewMakerSource.includes("가격·주차·메뉴·시설 등 확인한 정보"));
assert.ok(productReviewMakerSource.includes("parseSubKeywords"));
assert.ok(productReviewMakerSource.includes("data-generation-engine"));
assert.ok(productReviewMakerSource.includes("targetCharCount"));
assert.ok(!productReviewMakerSource.includes("협찬 여부"));
assert.ok(!productReviewMakerSource.includes("sponsorshipType"));
assert.ok(productReviewMakerSource.includes("lastGeneratedSignature"));
assert.ok(productReviewMakerSource.includes("currentFormSignature"));
assert.ok(productReviewMakerSource.includes("createFormSignature"));
assert.ok(productReviewMakerSource.includes("subKeywords: parseSubKeywords"));
assert.ok(productReviewMakerSource.includes("글 주제를 입력해주세요"));
assert.ok(productReviewMakerSource.includes("변경 내용으로 다시 만들기"));
assert.ok(!productReviewMakerSource.includes("메인 키워드 직접 지정"));
assert.ok(!productReviewMakerSource.includes("targetLengthOptions"));
assert.ok(productReviewMakerSource.includes("블로그 초안 만들기"));
assert.ok(productReviewMakerSource.includes("아직 생성된 초안이 없습니다."));
assert.ok(productReviewMakerSource.includes("글 주제와 메모를 입력한 뒤 초안 만들기를 눌러주세요."));
assert.ok(productReviewMakerSource.includes("편집 가능한 원고"));
assert.ok(productReviewMakerSource.includes("메인 키워드:"));
assert.ok(productReviewMakerSource.includes("초안은 바로 수정할 수 있어요. 내 말투에 맞게 한 번만 다듬으면 더 자연스럽습니다."));
assert.ok(productReviewMakerSource.includes("bodyLength: nextBodyLength"));
assert.ok(productReviewMakerSource.includes("const blogBody = getResultBody(result)"));
assert.ok(productReviewMakerSource.includes("const finalTitle = getResultFinalTitle(result)"));
assert.ok(productReviewMakerSource.includes("const titleCandidates = getResultTitleCandidates(result)"));
assert.ok(productReviewMakerSource.includes("getCurrentPackageData(result)"));
assert.ok(productReviewMakerSource.includes("data-testid=\"naver-body-preview\""));
assert.ok(productReviewMakerSource.includes("data-testid=\"inline-photo-preview\""));
assert.ok(productReviewMakerSource.includes("photoInsertMarkerPattern"));
assert.ok(productReviewMakerSource.includes("object-contain"));
assert.ok(!productReviewMakerSource.includes("object-cover"));
assert.ok(productReviewMakerSource.includes("stripReviewTopicTail"));
assert.ok(productReviewMakerSource.includes("방문\\s*후기"));
assert.ok(productReviewMakerSource.includes("사용\\s*후기"));
const naverResultSectionsSource = productReviewMakerSource.slice(
  productReviewMakerSource.indexOf("function NaverResultSections"),
  productReviewMakerSource.indexOf("function ResultMetric")
);
assert.ok(naverResultSectionsSource.indexOf("최종 추천 제목") < naverResultSectionsSource.indexOf("제목 더보기"));
assert.ok(naverResultSectionsSource.indexOf("제목 더보기") < naverResultSectionsSource.indexOf("블로그 본문"));
assert.ok(naverResultSectionsSource.indexOf("블로그 본문") < naverResultSectionsSource.indexOf('title="FAQ"'));
assert.ok(naverResultSectionsSource.indexOf('title="FAQ"') < naverResultSectionsSource.indexOf('title="해시태그"'));
assert.ok(!naverResultSectionsSource.includes("qualityScore"));
assert.ok(!naverResultSectionsSource.includes("qualityIssues"));
assert.ok(productReviewMakerSource.includes('<ResultDetailSection title="제목 더보기" copyActive={copied === "titles"} onCopy={() => copyText("titles")}>'));
assert.ok(productReviewMakerSource.includes("제목 다시 만들기"));
assert.ok(productReviewMakerSource.includes("titleVariantSeed"));
assert.ok(productReviewMakerSource.includes("blogBody: currentBlogBody"));
assert.ok(productReviewMakerSource.includes("createGenerationId"));
assert.ok(productReviewMakerSource.includes("activeGenerationIdRef.current = generationId"));
assert.ok(productReviewMakerSource.includes("setResult(createEmptyResult(generationId))"));
assert.ok(productReviewMakerSource.includes('selectedTitle: selectedTitle || ""'));
assert.ok(productReviewMakerSource.includes("window.setTimeout(async () =>"));
assert.ok(productReviewMakerSource.includes('fetch("/api/generate-blog"'));
assert.ok(productReviewMakerSource.includes("createLocalFallbackDraft"));
assert.ok(productReviewMakerSource.includes("requestBlogDraft"));
assert.ok(productReviewMakerSource.includes("topic,"));
assert.ok(productReviewMakerSource.includes("memory: form.experienceMemo"));
assert.ok(productReviewMakerSource.includes("photoMetadata"));
assert.ok(productReviewMakerSource.includes("images: photoMetadata"));
assert.ok(!productReviewMakerSource.includes("generateReview(result.selectedTitle)"));
assert.ok(!productReviewMakerSource.includes("예: 에어젤 드라이샴푸 후기 / 부천금거래소 후기 / 아이랑 갈만한 카페"));
assert.ok(!productReviewMakerSource.includes("예: 에어젤 드라이샴푸 / 부천금거래소 / 부천 아이랑 카페"));
assert.ok(!productReviewMakerSource.includes("선택 입력"));
assert.ok(!productReviewMakerSource.includes("OCR 원문 보기"));
assert.ok(!productReviewMakerSource.includes("OCR"));
assert.ok(!productReviewMakerSource.includes("사진 속 글자 확인"));
assert.ok(!productReviewMakerSource.includes("검색 의도 분석"));
assert.ok(!productReviewMakerSource.includes("홈피드 클릭 포인트"));
assert.ok(!productReviewMakerSource.includes("상세 분석 보기"));
assert.ok(!productReviewMakerSource.includes("최종 검수표"));
assert.ok(!productReviewMakerSource.includes("이런 분께 추천해요"));
assert.ok(!productReviewMakerSource.includes("사진 배치 가이드"));
assert.ok(!productReviewMakerSource.includes("업체/상품 정보 정리"));
const resultToClipboardSource = productReviewMakerSource.slice(
  productReviewMakerSource.indexOf("const resultToClipboard"),
  productReviewMakerSource.indexOf("const imageKeywordsToClipboard")
);
assert.ok(!resultToClipboardSource.includes("titleCandidates"));
assert.ok(!resultToClipboardSource.includes("제목 더보기"));
assert.ok(!resultToClipboardSource.includes("사진 배치 가이드"));
assert.ok(!resultToClipboardSource.includes("photoGuide"));
assert.ok(!resultToClipboardSource.includes("infoSummary"));
assert.ok(!resultToClipboardSource.includes("업체/상품 정보 정리"));

const frontendRoot = fileURLToPath(new URL("../frontend", import.meta.url));
const [{ default: React }, { renderToStaticMarkup }, { createServer: createViteServer }] = await Promise.all([
  import(new URL("../frontend/node_modules/react/index.js", import.meta.url).href),
  import(new URL("../frontend/node_modules/react-dom/server.node.js", import.meta.url).href),
  import(new URL("../frontend/node_modules/vite/dist/node/index.js", import.meta.url).href)
]);
const viteServer = await createViteServer({
  root: frontendRoot,
  logLevel: "silent",
  server: {
    middlewareMode: true
  },
  appType: "custom"
});

try {
  const { default: ProductReviewMaker } = await viteServer.ssrLoadModule("/src/pages/ProductReviewMaker.jsx");
  const productReviewMakerMarkup = renderToStaticMarkup(React.createElement(ProductReviewMaker));
  assert.ok(productReviewMakerMarkup.includes("고급 옵션"));
  assert.ok(productReviewMakerMarkup.includes("메인 키워드"));
  assert.ok(productReviewMakerMarkup.includes("서브 키워드"));
  assert.ok(productReviewMakerMarkup.includes("예: 상호명 / 지역명 맛집 / 대표 메뉴"));
  assert.ok(productReviewMakerMarkup.includes("예: 지역명 맛집, 대표 메뉴, 가족 외식"));
  assert.ok(productReviewMakerMarkup.includes("글 주제를 입력해주세요"));
  assert.ok(productReviewMakerMarkup.includes("비워두면 글 주제와 메모에서 자동으로 추출합니다."));
  assert.ok(productReviewMakerMarkup.includes("비워두면 글 주제와 메모에서 자동 추천합니다. 최대 3개까지 쉼표로 나눠 입력하세요."));
  assert.ok(productReviewMakerMarkup.includes("목표 글자수"));
  assert.ok(!productReviewMakerMarkup.includes("협찬 여부"));
  assert.ok(productReviewMakerMarkup.includes("value=\"2500\""));
  assert.ok(productReviewMakerMarkup.includes("800자~4000자 사이로 보정됩니다."));
  assert.ok(!productReviewMakerMarkup.includes("자동 추천 - 입력량에 맞춰 자연스럽게 작성"));
  assert.ok(!productReviewMakerMarkup.includes("짧게 - 약 1000~1500자"));
  assert.ok(!productReviewMakerMarkup.includes("보통 - 약 1800~2500자"));
  assert.ok(!productReviewMakerMarkup.includes("길게 - 약 2800~3500자"));
  assert.ok(productReviewMakerMarkup.indexOf("고급 옵션") < productReviewMakerMarkup.indexOf("목표 글자수"));
} finally {
  await viteServer.close();
}

assert.deepEqual(
  parseSubKeywords("강화도맛집, 갈낙짬뽕, 가족 외식, 강화도맛집, 육짬 강화도본점, 주차", "육짬 강화도본점"),
  ["강화도맛집", "갈낙짬뽕", "가족 외식"]
);

const normalizedSubKeywordPayload = normalizeBlogWriterInput({
  productName: "육짬 강화도본점 맛집 후기",
  mainKeyword: "강화도맛집",
  subKeywords: "갈낙짬뽕, 가족 외식, 강화도맛집, 주차",
  experienceMemo: "강화도 가족여행중 다녀와서 좋았음"
});
assert.equal(normalizedSubKeywordPayload.mainKeyword, "육짬 강화도본점");
assert.deepEqual(normalizedSubKeywordPayload.subKeywords, ["강화도맛집", "갈낙짬뽕", "가족 외식"]);

const generalPipelineContext = buildBlogWriterPipelineContext({
  productName: "육짬 강화도본점 맛집 후기",
  mainKeyword: "강화도맛집",
  subKeywords: "갈낙짬뽕, 가족 외식",
  experienceMemo: "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음",
  imageContext: [
    { index: 1, note: "대표 메뉴 사진" },
    { index: 2, note: "음식 사진" }
  ],
  imageCount: 2
});
assert.equal(generalPipelineContext.primaryEntity, "육짬 강화도본점");
assert.equal(generalPipelineContext.mainKeyword, "육짬 강화도본점");
assert.equal(generalPipelineContext.experienceStatus, "visited");
assert.equal(generalPipelineContext.imageAnalysis.mode, "label-only");
assert.ok(generalPipelineContext.factMap.facts.every((fact) => fact.source));
assert.ok(generalPipelineContext.factMap.unsupportedFields.includes("staffResponse"));
assert.ok(generalPipelineContext.writerPlan.sectionCount >= 3 && generalPipelineContext.writerPlan.sectionCount <= 7);

const createGenerateBlogRequest = (form, env = {}) =>
  generateBlogOnRequestPost({
    request: new Request("http://local.test/api/generate-blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form)
    }),
    env
  });

const readJsonResponse = async (response) => JSON.parse(await response.text());

const loadBlogQualityFixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/blog-quality/${name}.json`, import.meta.url), "utf8"));

const evaluateBlogQualityFixture = (fixture, overrides = {}) =>
  evaluateHumanQuality({
    title: fixture.title,
    titleCandidates: fixture.titleCandidates,
    body: fixture.body,
    faq: fixture.faq,
    hashtags: fixture.hashtags || [],
    factMap: fixture.factMap,
    imageAnalysis: fixture.factMap?.visuallySupported || null,
    category: fixture.category,
    visitStatus: fixture.factMap?.visitStatus,
    mainKeyword: fixture.mainKeyword,
    subKeywords: fixture.subKeywords,
    requestedTargetCharCount: 2500,
    effectiveTargetCharCount: 1800,
    engine: overrides.engine || "fallback",
    llmJudge: overrides.llmJudge
  });

const badQualityFixtures = [
  "bad-restaurant-generic",
  "bad-meta-guidance",
  "bad-unsupported-claims",
  "bad-duplicate-paragraphs"
].map(loadBlogQualityFixture);

for (const fixture of badQualityFixtures) {
  const result = evaluateBlogQualityFixture(fixture);
  assert.ok(
    result.score <= fixture.expectedMaxScore,
    `${fixture.name} expected <= ${fixture.expectedMaxScore}, got ${result.score}`
  );
  assert.equal(result.publishReady, fixture.expectedPublishReady);
  for (const code of fixture.expectedIssueCodes || []) {
    assert.ok(result.issues.some((issue) => issue.code === code), `${fixture.name} missing issue ${code}`);
  }
}

const sparseHonestFixture = loadBlogQualityFixture("sparse-but-honest");
const sparseHonestQuality = evaluateBlogQualityFixture(sparseHonestFixture);
assert.ok(sparseHonestQuality.score >= sparseHonestFixture.expectedMinScore);
assert.equal(sparseHonestQuality.publishReady, false);
assert.equal(sparseHonestQuality.judgeEngine, "deterministic");
assert.ok(sparseHonestQuality.score <= 89);

const highQualityFixtures = [
  "high-quality-restaurant",
  "high-quality-product",
  "high-quality-education"
].map(loadBlogQualityFixture);
for (const fixture of highQualityFixtures) {
  const deterministicOnly = evaluateBlogQualityFixture(fixture, { engine: "llm" });
  assert.equal(deterministicOnly.judgeEngine, "deterministic");
  assert.ok(deterministicOnly.score <= 89);
  assert.equal(deterministicOnly.publishReady, false);

  const withLlmJudge = evaluateBlogQualityFixture(fixture, {
    engine: "llm",
    llmJudge: fixture.llmJudge
  });
  assert.equal(withLlmJudge.judgeEngine, "llm");
  assert.ok(withLlmJudge.score >= fixture.expectedMinScore, `${fixture.name} score ${withLlmJudge.score}`);
  assert.equal(withLlmJudge.publishReady, fixture.expectedPublishReady);
}

const badYukjjamFixture = loadBlogQualityFixture("bad-restaurant-generic");
const badYukjjamQuality = evaluateBlogQualityFixture(badYukjjamFixture);
assert.ok(badYukjjamQuality.score <= 75);
assert.equal(badYukjjamQuality.publishReady, false);
assert.ok(badYukjjamQuality.issues.some((issue) => issue.code === "GENERIC_FILLER"));
assert.ok(badYukjjamQuality.issues.some((issue) => issue.code === "META_GUIDANCE"));
assert.ok(badYukjjamQuality.issues.some((issue) => issue.code === "TITLE_AWKWARD"));

const bestQualityAttempt = selectBestHumanQualityAttempt([
  { title: badYukjjamFixture.title, body: badYukjjamFixture.body, mainKeyword: badYukjjamFixture.mainKeyword, category: "restaurant" },
  {
    title: highQualityFixtures[0].title,
    titleCandidates: highQualityFixtures[0].titleCandidates,
    body: highQualityFixtures[0].body,
    faq: highQualityFixtures[0].faq,
    factMap: highQualityFixtures[0].factMap,
    imageAnalysis: highQualityFixtures[0].factMap.visuallySupported,
    category: highQualityFixtures[0].category,
    mainKeyword: highQualityFixtures[0].mainKeyword,
    subKeywords: highQualityFixtures[0].subKeywords,
    engine: "llm",
    llmJudge: highQualityFixtures[0].llmJudge
  }
]);
assert.equal(bestQualityAttempt.humanQuality.publishReady, true);
assert.ok(bestQualityAttempt.humanQuality.score >= 95);

const routeSampleForm = {
  productName: "육짬 강화도본점 맛집 후기",
  topic: "육짬 강화도본점 맛집 후기",
  mainKeyword: "강화도맛집",
  memory: "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음",
  experienceMemo: "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음",
  targetCharCount: 2500,
  tone: "친근한",
  category: "",
  avoidWords: "무조건, 보장, 완벽, 즉시효과",
  photoMetadata: [
    { index: 1, name: "menu.jpg", note: "대표 메뉴 사진" },
    { index: 2, name: "food.jpg", note: "음식 사진" }
  ],
  images: [
    { index: 1, name: "menu.jpg", note: "대표 메뉴 사진" },
    { index: 2, name: "food.jpg", note: "음식 사진" }
  ],
  imageCount: 2
};
const routeNoFlagResult = await readJsonResponse(await createGenerateBlogRequest(routeSampleForm, {}));
assert.equal(routeNoFlagResult.generationRoute, "static-fallback");
assert.equal(routeNoFlagResult.engine, "fallback");
assert.equal(routeNoFlagResult.llm.used, false);
assert.equal(routeNoFlagResult.llm.reason, "llm-disabled");
assert.equal(routeNoFlagResult.contentPackage.mainKeyword, "육짬 강화도본점");
assert.ok(routeNoFlagResult.qualityScore >= 80);
assert.equal(routeNoFlagResult.summary.engine, "fallback");
assert.equal(routeNoFlagResult.summary.bodyLength, routeNoFlagResult.bodyLength);
const routeEntityCoverage = getEntityCoverage({
  primaryEntity: routeNoFlagResult.contentPackage.primaryEntity,
  title: routeNoFlagResult.finalTitle,
  titleCandidates: routeNoFlagResult.titleCandidates,
  body: routeNoFlagResult.body
});
assert.equal(routeEntityCoverage.finalTitle, true);
assert.equal(routeEntityCoverage.openingSentence, true);
assert.equal(routeEntityCoverage.body, true);
assert.ok(routeEntityCoverage.titleCandidateHits >= 4);
assert.equal(routeNoFlagResult.contentPackage.humanEvaluationExport.blindFieldsExcluded.includes("qualityScore"), true);
assert.equal(Object.hasOwn(routeNoFlagResult.contentPackage.humanEvaluationExport, "qualityScore"), false);

const routeEnabledNoKeyResult = await readJsonResponse(
  await createGenerateBlogRequest(routeSampleForm, { BLOG_WRITER_LLM_ENABLED: "true" })
);
assert.equal(routeEnabledNoKeyResult.generationRoute, "static-fallback");
assert.equal(routeEnabledNoKeyResult.engine, "fallback");
assert.equal(routeEnabledNoKeyResult.llm.reason, "server-key-missing");
assert.ok(!JSON.stringify(routeEnabledNoKeyResult).includes("unit-test-key"));

const originalFetchForRouteTest = globalThis.fetch;
const routeFallbackDraft = createProductReviewDraft(routeSampleForm);
try {
  const routeVisionForm = {
    ...routeSampleForm,
    imageContext: [
      {
        index: 1,
        note: "갈낙짬뽕 사진",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo="
      }
    ],
    images: [
      {
        index: 1,
        note: "갈낙짬뽕 사진",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo="
      }
    ],
    imageCount: 1
  };
  let visionFetchCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    visionFetchCount += 1;
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const requestBody = JSON.parse(init.body);
    assert.equal(requestBody.model, "unit-model");
    assert.ok(requestBody.messages[1].content.some((item) => item.type === "image_url"));
    assert.ok(!JSON.stringify(requestBody).includes("OPENAI_API_KEY"));

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  {
                    photoIndex: 1,
                    analysisMode: "vision",
                    category: "food_closeup",
                    visibleElements: ["붉은 국물", "해산물", "채소", "그릇"],
                    safeDescription: "붉은 국물 위로 해산물과 채소가 보입니다.",
                    unsafeClaims: ["맛", "가격", "양"],
                    confidence: 0.91
                  }
                ],
                visuallySupported: ["붉은 국물", "해산물", "채소"],
                unsupportedVisualFields: ["taste", "price", "quantity", "service"]
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const routeVisionResult = await readJsonResponse(
    await createGenerateBlogRequest(routeVisionForm, {
      BLOG_WRITER_VISION_ENABLED: "true",
      OPENAI_API_KEY: "unit-test-key",
      OPENAI_MODEL: "unit-model"
    })
  );
  assert.equal(visionFetchCount, 1);
  assert.equal(routeVisionResult.engine, "fallback");
  assert.equal(routeVisionResult.contentPackage.imageAnalysis.mode, "vision");
  assert.equal(routeVisionResult.contentPackage.imageAnalysis.items[0].analysisMode, "vision");
  assert.ok(routeVisionResult.contentPackage.imageAnalysis.visuallySupported.includes("붉은 국물"));
  assert.ok(!JSON.stringify(routeVisionResult).includes("unit-test-key"));

  globalThis.fetch = async () => {
    throw new Error("vision unavailable");
  };
  const routeVisionFailureResult = await readJsonResponse(
    await createGenerateBlogRequest(routeVisionForm, {
      BLOG_WRITER_VISION_ENABLED: "true",
      OPENAI_API_KEY: "unit-test-key",
      OPENAI_MODEL: "unit-model"
    })
  );
  assert.equal(routeVisionFailureResult.engine, "fallback");
  assert.equal(routeVisionFailureResult.contentPackage.imageAnalysis.mode, "label-only");

  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const requestBody = JSON.parse(init.body);
    assert.equal(requestBody.model, "unit-model");
    assert.ok(String(init.headers.authorization).includes("unit-test-key"));
    assert.ok(!JSON.stringify(requestBody).includes("OPENAI_API_KEY"));

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                finalTitle: routeFallbackDraft.finalTitle,
                titleCandidates: routeFallbackDraft.titleCandidates,
                mainKeyword: routeFallbackDraft.mainKeyword,
                subKeywords: routeFallbackDraft.contentPackage.subKeywords,
                body: routeFallbackDraft.body,
                faqItems: routeFallbackDraft.contentPackage.faqItems,
                hashtags: routeFallbackDraft.hashtags
              })
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  const routeLlmResult = await readJsonResponse(
    await createGenerateBlogRequest(routeSampleForm, {
      BLOG_WRITER_LLM_ENABLED: "true",
      OPENAI_API_KEY: "unit-test-key",
      OPENAI_MODEL: "unit-model"
    })
  );
  assert.equal(routeLlmResult.generationRoute, "llm");
  assert.equal(routeLlmResult.engine, "llm");
  assert.equal(routeLlmResult.llm.used, true);
  assert.equal(routeLlmResult.llm.accepted, true);
  assert.equal(routeLlmResult.contentPackage.mainKeyword, "육짬 강화도본점");
  assert.equal(routeLlmResult.summary.engine, "llm");
  assert.equal(routeLlmResult.summary.bodyLength, routeLlmResult.bodyLength);
  assert.ok(routeLlmResult.contentPackage.blogWriterQuality.score >= 95);
  assert.ok(!JSON.stringify(routeLlmResult).includes("unit-test-key"));

  let judgeFetchCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    judgeFetchCount += 1;
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const requestBody = JSON.parse(init.body);
    assert.equal(requestBody.model, "unit-model");
    assert.ok(String(init.headers.authorization).includes("unit-test-key"));
    assert.ok(!JSON.stringify(requestBody).includes("OPENAI_API_KEY"));

    const content =
      judgeFetchCount === 1
        ? {
            finalTitle: routeFallbackDraft.finalTitle,
            titleCandidates: routeFallbackDraft.titleCandidates,
            mainKeyword: routeFallbackDraft.mainKeyword,
            subKeywords: routeFallbackDraft.contentPackage.subKeywords,
            body: routeFallbackDraft.body,
            faqItems: routeFallbackDraft.contentPackage.faqItems,
            hashtags: routeFallbackDraft.hashtags
          }
        : {
            score: 96,
            publishReady: true,
            scores: {
              titleQuality: 10,
              openingQuality: 10,
              factualGrounding: 15,
              specificity: 14,
              humanNaturalness: 14,
              narrativeCoherence: 10,
              paragraphValue: 10,
              keywordNaturalness: 5,
              imageGrounding: 4,
              readerUtility: 4
            },
            issues: [],
            revisionInstructions: []
          };

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(content)
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  const routeLlmJudgeResult = await readJsonResponse(
    await createGenerateBlogRequest(routeSampleForm, {
      BLOG_WRITER_LLM_ENABLED: "true",
      BLOG_WRITER_LLM_JUDGE_ENABLED: "true",
      OPENAI_API_KEY: "unit-test-key",
      OPENAI_MODEL: "unit-model"
    })
  );
  assert.equal(judgeFetchCount, 2);
  assert.equal(routeLlmJudgeResult.judgeEngine, "llm");
  assert.equal(routeLlmJudgeResult.isMock, true);
  assert.equal(routeLlmJudgeResult.llm.isMock, true);
  assert.equal(routeLlmJudgeResult.publishReady, false);
  assert.ok(routeLlmJudgeResult.rawQualityScore >= 95);
  assert.ok(routeLlmJudgeResult.qualityScore <= 89);
  assert.ok(routeLlmJudgeResult.humanQuality.caps.some((cap) => cap.code === "MOCK_LLM_NOT_ACTUAL_QUALITY"));
  assert.equal(routeLlmJudgeResult.qualityAttempts, 1);
  assert.equal(routeLlmJudgeResult.llm.judgeUsed, true);
  assert.equal(routeLlmJudgeResult.contentPackage.humanQuality.judgeEngine, "llm");

  let revisionFetchCount = 0;
  const highRestaurantFixture = loadBlogQualityFixture("high-quality-restaurant");
  globalThis.fetch = async (url, init = {}) => {
    revisionFetchCount += 1;
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const contentByCall = [
      {
        finalTitle: badYukjjamFixture.title,
        titleCandidates: badYukjjamFixture.titleCandidates,
        mainKeyword: routeFallbackDraft.mainKeyword,
        subKeywords: routeFallbackDraft.contentPackage.subKeywords,
        body: badYukjjamFixture.body,
        faqItems: badYukjjamFixture.faq,
        hashtags: routeFallbackDraft.hashtags
      },
      {
        score: 72,
        publishReady: false,
        scores: {
          titleQuality: 4,
          openingQuality: 5,
          factualGrounding: 12,
          specificity: 5,
          humanNaturalness: 5,
          narrativeCoherence: 6,
          paragraphValue: 4,
          keywordNaturalness: 3,
          imageGrounding: 2,
          readerUtility: 3
        },
        issues: [{ code: "GENERIC_FILLER", severity: "high", evidence: "식사 후보", message: "일반론 반복", revisionInstruction: "구체적인 방문 상황으로 바꾸세요." }],
        revisionInstructions: ["일반론을 줄이고 사진 정보를 구체화하세요."]
      },
      {
        finalTitle: highRestaurantFixture.title,
        titleCandidates: highRestaurantFixture.titleCandidates,
        mainKeyword: routeFallbackDraft.mainKeyword,
        subKeywords: routeFallbackDraft.contentPackage.subKeywords,
        body: highRestaurantFixture.body,
        faqItems: highRestaurantFixture.faq,
        hashtags: routeFallbackDraft.hashtags
      },
      {
        score: 97,
        publishReady: true,
        scores: highRestaurantFixture.llmJudge.scores,
        issues: [],
        revisionInstructions: []
      }
    ];

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(contentByCall[revisionFetchCount - 1])
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  const routeLlmRevisionResult = await readJsonResponse(
    await createGenerateBlogRequest(routeSampleForm, {
      BLOG_WRITER_LLM_ENABLED: "true",
      BLOG_WRITER_LLM_JUDGE_ENABLED: "true",
      BLOG_WRITER_LLM_REVISION_ENABLED: "true",
      OPENAI_API_KEY: "unit-test-key",
      OPENAI_MODEL: "unit-model"
    })
  );
  assert.equal(revisionFetchCount, 4);
  assert.equal(routeLlmRevisionResult.qualityAttempts, 2);
  assert.equal(routeLlmRevisionResult.isMock, true);
  assert.equal(routeLlmRevisionResult.publishReady, false);
  assert.ok(routeLlmRevisionResult.rawQualityScore >= 95);
  assert.ok(routeLlmRevisionResult.qualityScore <= 89);
  assert.ok(routeLlmRevisionResult.humanQuality.caps.some((cap) => cap.code === "MOCK_LLM_NOT_ACTUAL_QUALITY"));
  assert.equal(routeLlmRevisionResult.finalTitle, highRestaurantFixture.title);

  globalThis.fetch = async () => {
    throw new Error("network unavailable");
  };
  const routeLlmFailureResult = await readJsonResponse(
    await createGenerateBlogRequest(routeSampleForm, {
      BLOG_WRITER_LLM_ENABLED: "true",
      OPENAI_API_KEY: "unit-test-key",
      OPENAI_MODEL: "unit-model"
    })
  );
  assert.equal(routeLlmFailureResult.generationRoute, "static-fallback");
  assert.equal(routeLlmFailureResult.engine, "fallback");
  assert.equal(routeLlmFailureResult.llm.used, false);
  assert.equal(routeLlmFailureResult.llm.attempted, true);
  assert.equal(routeLlmFailureResult.llm.reason, "llm-failed");
  assert.ok(routeLlmFailureResult.qualityScore >= 80);
  assert.equal(routeLlmFailureResult.summary.engine, "fallback");
  assert.ok(!JSON.stringify(routeLlmFailureResult).includes("network unavailable"));
} finally {
  globalThis.fetch = originalFetchForRouteTest;
}

const collectReviewOutputText = (review = {}) => [
  review.generationId,
  review.category,
  review.finalTitle,
  review.selectedTitle,
  review.mainKeyword,
  ...(review.titleCandidates || []),
  ...(review.titles || []),
  review.body,
  ...(review.hashtags || []),
  review.contentPackage?.generationId,
  review.contentPackage?.mainKeyword,
  review.contentPackage?.finalRecommendedTitle,
  ...(review.contentPackage?.titleCandidates || []),
  ...(review.contentPackage?.faqItems || []).flatMap((item) => [item.question, item.answer])
]
  .filter(Boolean)
  .join(" ");

const getReviewCopyTitle = (review = {}) =>
  review.finalTitle || review.selectedTitle || review.contentPackage?.finalRecommendedTitle || "";

const assertQualityScore = (review = {}, minimum = 80) => {
  assert.equal(Number.isFinite(review.qualityScore), true);
  if (review.judgeEngine === "llm" && !review.isMock) {
    assert.ok(
      review.qualityScore >= minimum,
      `${review.finalTitle || review.selectedTitle || review.category} qualityScore ${review.qualityScore}: ${(review.qualityIssues || []).join(", ")}`
    );
  } else {
    assert.ok(
      review.qualityScore >= minimum && review.qualityScore <= 89,
      `${review.finalTitle || review.selectedTitle || review.category} qualityScore ${review.qualityScore}: ${(review.qualityIssues || []).join(", ")}`
    );
    assert.equal(review.publishReady, false);
    assert.ok((review.rawQualityScore ?? review.qualityScore) >= review.qualityScore);
  }
  assert.equal(review.contentPackage?.qualityScore, review.qualityScore);
  assert.ok(Array.isArray(review.qualityIssues));
  assert.ok(!forbiddenReviewGuidePattern.test(review.body));
  assertNoDuplicateBodyParts(review.body);
};

assert.equal(holdoutUnknownTopicFixtures.length, 60);
assert.equal(new Set(holdoutUnknownTopicFixtures.map((fixture) => `${fixture.category}:${fixture.sufficiency}`)).size, 60);

const holdoutUnsupportedClaimPattern =
  /영업시간\s*(?:은|:)\s*\d|가격\s*(?:은|:)\s*\d|주차가\s*(?:편|좋)|웨이팅\s*(?:없|짧)|직원\s*(?:친절|응대)|무조건|100%\s*만족|효과\s*보장/u;
const holdoutPrimaryEntities = holdoutUnknownTopicFixtures.map((fixture) =>
  buildBlogWriterPipelineContext(fixture.form).primaryEntity
);
const holdoutFallbackResults = holdoutUnknownTopicFixtures.map((fixture) => {
  const normalizedForm = normalizeBlogWriterInput(fixture.form);
  const review = createProductReviewDraft(normalizedForm);
  const entityCoverage = getEntityCoverage({
    primaryEntity: review.primaryEntity || buildBlogWriterPipelineContext(normalizedForm).primaryEntity,
    title: review.finalTitle,
    titleCandidates: review.titleCandidates,
    body: review.body
  });
  const outputText = collectReviewOutputText(review);
  const otherEntities = holdoutPrimaryEntities.filter(
    (entity) => entity && entity !== review.primaryEntity && !review.primaryEntity.includes(entity) && !entity.includes(review.primaryEntity)
  );
  const contaminationCount = otherEntities.filter((entity) => outputText.includes(entity)).length;

  assert.equal(review.engine, "fallback", fixture.id);
  assert.ok(review.qualityScore >= 70, `${fixture.id} fallback score ${review.qualityScore}`);
  assert.equal(review.publishReady, false, fixture.id);
  assert.equal(entityCoverage.finalTitle, true, `${fixture.id} final title entity missing`);
  assert.equal(entityCoverage.openingSentence, true, `${fixture.id} opening entity missing`);
  assert.equal(entityCoverage.body, true, `${fixture.id} body entity missing`);
  assert.ok(entityCoverage.titleCandidateHits >= Math.min(4, entityCoverage.titleCandidateTotal), `${fixture.id} title candidate entity coverage ${entityCoverage.titleCandidateHits}/${entityCoverage.titleCandidateTotal}`);
  assert.ok(!holdoutUnsupportedClaimPattern.test(review.body), fixture.id);
  assert.equal(contaminationCount, 0, `${fixture.id} contaminated by another holdout entity`);
  assert.ok(review.contentPackage.factMap.unsupportedFields.length >= 5, fixture.id);
  assert.ok(["low", "medium", "high"].includes(review.contentPackage.informationSufficiency.level), fixture.id);

  return { fixture, review, entityCoverage };
});
const holdoutFallbackAverage =
  holdoutFallbackResults.reduce((total, item) => total + item.review.qualityScore, 0) / holdoutFallbackResults.length;
assert.ok(holdoutFallbackAverage >= 80, `fallback holdout average ${holdoutFallbackAverage}`);

const holdoutCategoryFallbackStats = Object.fromEntries(
  [...new Set(holdoutUnknownTopicFixtures.map((fixture) => fixture.category))].map((category) => {
    const scores = holdoutFallbackResults
      .filter((item) => item.fixture.category === category)
      .map((item) => item.review.qualityScore);
    return [
      category,
      {
        average: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
        min: Math.min(...scores)
      }
    ];
  })
);
assert.equal(Object.keys(holdoutCategoryFallbackStats).length, 15);
globalThis.__blogHoldoutFallbackStats = {
  average: holdoutFallbackAverage,
  min: Math.min(...holdoutFallbackResults.map((item) => item.review.qualityScore)),
  max: Math.max(...holdoutFallbackResults.map((item) => item.review.qualityScore)),
  publishReady: holdoutFallbackResults.filter((item) => item.review.publishReady).length,
  hardFail: holdoutFallbackResults.filter((item) => item.review.humanQuality?.hardFail).length,
  entityCoverage: {
    finalTitle: holdoutFallbackResults.filter((item) => item.entityCoverage.finalTitle).length,
    openingSentence: holdoutFallbackResults.filter((item) => item.entityCoverage.openingSentence).length,
    body: holdoutFallbackResults.filter((item) => item.entityCoverage.body).length,
    titleCandidates: holdoutFallbackResults.filter((item) => item.entityCoverage.titleCandidateHits >= Math.min(4, item.entityCoverage.titleCandidateTotal)).length
  },
  category: holdoutCategoryFallbackStats
};

const propertyCategories = [
  "restaurant",
  "cafe",
  "accommodation",
  "travel",
  "product",
  "beauty",
  "fashion",
  "education",
  "store",
  "hospital",
  "service",
  "kids-place",
  "experience",
  "information",
  "comparison"
];
const propertyMarkersSeen = [];
const propertyStats = {
  cases: 0,
  mainKeywordChanges: 0,
  entityChanges: 0,
  experienceSignals: 0,
  subKeywordChanges: 0,
  noImageCases: 0,
  lowInfoLengthCases: 0,
  categoryChanges: 0,
  faqEvidenceCases: 0,
  broadKeywordCases: 0
};

for (let index = 0; index < 100; index += 1) {
  const marker = `범용마커${String(index).padStart(3, "0")}`;
  const previousMarkers = [...propertyMarkersSeen];
  const caseType = index % 10;

  if (caseType === 0) {
    const first = createProductReviewDraft({ mainKeyword: `${marker}A 텀블러 후기`, experienceMemo: "며칠 사용함" });
    const second = createProductReviewDraft({ mainKeyword: `${marker}B 텀블러 후기`, experienceMemo: "며칠 사용함" });
    assert.notEqual(first.finalTitle, second.finalTitle, marker);
    assert.notEqual(first.body, second.body, marker);
    assert.notDeepEqual(first.hashtags, second.hashtags, marker);
    assert.ok(!collectReviewOutputText(second).includes(`${marker}A`), marker);
    propertyStats.mainKeywordChanges += 1;
  } else if (caseType === 1) {
    const review = createProductReviewDraft({ productName: `${marker} 샐러드바 방문 후기`, mainKeyword: "지역 맛집", experienceMemo: "점심에 들러서 좋았음" });
    const outputText = collectReviewOutputText(review);
    assert.ok(outputText.includes(marker), marker);
    assert.equal(previousMarkers.filter((previousMarker) => outputText.includes(previousMarker)).length, 0, marker);
    assert.ok(review.contentPackage.mainKeyword.includes(marker), marker);
    propertyStats.entityChanges += 1;
  } else if (caseType === 2) {
    const researched = buildBlogWriterPipelineContext({ productName: `${marker} 정보 알아보기`, mainKeyword: `${marker} 정보`, experienceMemo: "처음 알아보는 중" });
    const visited = buildBlogWriterPipelineContext({ productName: `${marker} 매장 방문 후기`, mainKeyword: `${marker}`, experienceMemo: "직접 방문함\n좋았음" });
    assert.ok(["unknown", "researched", "planned"].includes(researched.experienceStatus), marker);
    assert.equal(visited.experienceStatus, "visited", marker);
    propertyStats.experienceSignals += 1;
  } else if (caseType === 3) {
    const normalized = normalizeBlogWriterInput({
      productName: `${marker} 클래스 수강 후기`,
      mainKeyword: `${marker}`,
      subKeywords: `${marker} 준비물, 초보자, 커리큘럼, ${marker} 준비물`,
      experienceMemo: "처음 수강했고 기억남"
    });
    const review = createProductReviewDraft(normalized);
    assert.deepEqual(normalized.subKeywords.slice(0, 3), [`${marker} 준비물`, "초보자", "커리큘럼"], marker);
    assert.ok(review.contentPackage.subKeywords.includes(`${marker} 준비물`), marker);
    propertyStats.subKeywordChanges += 1;
  } else if (caseType === 4) {
    const review = createProductReviewDraft({ productName: `${marker} 립밤 사용 후기`, mainKeyword: `${marker} 립밤`, experienceMemo: "가방에 넣고 사용함", imageCount: 0 });
    assert.ok(!review.body.includes("[사진 삽입:"), marker);
    assert.ok(review.contentPackage.imageAnalysis.mode === "none" || review.contentPackage.imageAnalysis.mode === "label-only", marker);
    propertyStats.noImageCases += 1;
  } else if (caseType === 5) {
    const review = createProductReviewDraft({ productName: `${marker} 국밥집 맛집 후기`, mainKeyword: "동네맛집", experienceMemo: "궁금했음", targetCharCount: 4000 });
    assert.equal(review.engine, "fallback", marker);
    assert.equal(review.contentPackage.informationLimited, true, marker);
    assert.ok(review.bodyLength <= 2200, `${marker} bodyLength ${review.bodyLength}`);
    propertyStats.lowInfoLengthCases += 1;
  } else if (caseType === 6) {
    const categoryA = propertyCategories[index % propertyCategories.length];
    const categoryB = propertyCategories[(index + 5) % propertyCategories.length];
    const contextA = buildBlogWriterPipelineContext({ productName: `${marker} 후기`, mainKeyword: `${marker}`, category: categoryA, experienceMemo: "직접 경험함" }, { category: categoryA });
    const contextB = buildBlogWriterPipelineContext({ productName: `${marker} 후기`, mainKeyword: `${marker}`, category: categoryB, experienceMemo: "직접 경험함" }, { category: categoryB });
    assert.equal(contextA.category, categoryA, marker);
    assert.equal(contextB.category, categoryB, marker);
    const outlineTextA = JSON.stringify(contextA.writerPlan.outline);
    const outlineTextB = JSON.stringify(contextB.writerPlan.outline);
    assert.notEqual(outlineTextA, outlineTextB, marker);
    propertyStats.categoryChanges += 1;
  } else if (caseType === 7) {
    const context = buildBlogWriterPipelineContext({ productName: `${marker} 처음 알아보기`, mainKeyword: `${marker}`, experienceMemo: "", targetCharCount: 4000 });
    const review = createProductReviewDraft({ productName: `${marker} 처음 알아보기`, mainKeyword: `${marker}`, experienceMemo: "", targetCharCount: 4000 });
    assert.ok(context.writerPlan.faqCount <= 1, marker);
    assert.ok((review.contentPackage.faqItems || []).length <= 3, marker);
    assert.ok(review.contentPackage.factMap.unsupportedFields.length >= 5, marker);
    propertyStats.faqEvidenceCases += 1;
  } else if (caseType === 8) {
    const context = buildBlogWriterPipelineContext({ productName: `${marker} 본점 방문 후기`, mainKeyword: "서울맛집", experienceMemo: "가족이랑 다녀와서 좋았음" });
    assert.ok(context.primaryEntity.includes(marker), marker);
    assert.equal(context.mainKeyword, context.primaryEntity, marker);
    assert.equal(context.broadKeyword, "서울맛집", marker);
    propertyStats.broadKeywordCases += 1;
  } else {
    const context = buildBlogWriterPipelineContext({
      productName: `${marker} 파스타집 방문 후기`,
      mainKeyword: `${marker}`,
      experienceMemo: "가족이랑 방문함",
      imageContext: [{ index: 1, note: "파스타 사진" }],
      imageCount: 1
    });
    assert.equal(context.imageAnalysis.mode, "label-only", marker);
    assert.ok(context.imageAnalysis.items.every((item) => item.analysisMode === "label-only"), marker);
    assert.ok(context.imageAnalysis.items.every((item) => item.unsafeClaims.includes("taste")), marker);
    propertyStats.noImageCases += 1;
  }

  propertyMarkersSeen.push(marker);
  propertyStats.cases += 1;
}
assert.equal(propertyStats.cases, 100);
assert.ok(Object.values(propertyStats).slice(1).every((count) => count >= 10));
globalThis.__blogPropertyBasedStats = propertyStats;

const createHoldoutLlmDraft = (fixture) => {
  const normalizedForm = normalizeBlogWriterInput(fixture.form);
  const context = buildBlogWriterPipelineContext(normalizedForm);
  const primaryEntity = context.primaryEntity || context.mainKeyword;
  const mainKeyword = context.mainKeyword || primaryEntity;
  const broadKeyword = primaryEntity && mainKeyword && primaryEntity !== mainKeyword ? mainKeyword : "";
  const displayKeyword = primaryEntity || mainKeyword;
  const subKeywords = [broadKeyword, ...context.subKeywords].filter(Boolean).slice(0, 3);
  const memoLines = String(normalizedForm.experienceMemo || normalizedForm.memo || "")
    .split(/\n|(?<=[.!?。])\s+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const actualReview = context.experienceTone === "actual-review";
  const actionText = actualReview ? "직접 경험하고 나서" : "알아보면서";
  const openingContext = actualReview
    ? "처음 기대했던 부분과 실제로 기억에 남은 부분을 함께 보게 됐어요"
    : "처음 볼 때 필요한 정보와 내 상황에 맞는지를 함께 보게 됐어요";
  const subjectKeyword = `${displayKeyword} 관련 경험은`;
  const objectKeyword = "이 경험을";
  const keywordSentence = subKeywords.length
    ? `${subKeywords.join(", ")} 같은 단어로만 길게 늘리기보다, 실제로 궁금했던 장면과 연결해서 보는 편이 더 편했습니다.`
    : "큰 장점만 나열하기보다 실제 상황에 맞는지 차분히 보는 편이 더 편했습니다.";
  const memoSentence = memoLines.length
    ? `${memoLines.join(" ")} 이 부분이 이번 경험에서 가장 먼저 떠올랐습니다.`
    : `${displayKeyword}을 처음 볼 때는 기본 정보부터 차근차근 살펴보게 됐습니다.`;
  const imageSentence = context.imageAnalysis.visuallySupported.length
    ? `사진으로는 ${context.imageAnalysis.visuallySupported.slice(0, 2).join(", ")} 정도가 먼저 떠올랐고, 그 밖의 맛이나 가격 같은 내용은 따로 말하지 않았습니다.`
    : "사진으로 덧붙일 장면이 많지는 않아, 직접 기억나는 상황을 중심으로 정리했습니다.";
  const body = [
    `${subjectKeyword} ${actionText} 기억에 남은 점을 차분히 정리해보고 싶었던 주제예요. ${objectKeyword} 볼 때는 이름이나 키워드보다 내가 왜 관심을 갖게 됐는지가 먼저 중요했고, ${openingContext}.`,
    `처음에는 ${displayKeyword}에 관심을 둔 이유를 먼저 떠올리면서 ${broadKeyword || mainKeyword} 맥락도 함께 살펴봤습니다. ${memoSentence} 그래서 이번 후기는 새로 꾸민 이야기보다 기억나는 장면을 기준으로 적었습니다.`,
    `중간에 가장 도움이 된 건 핵심을 너무 넓히지 않는 것이었어요. ${keywordSentence} ${objectKeyword} 다시 떠올려봐도 과장된 표현보다 구체적인 순간이 더 오래 남았습니다.`,
    imageSentence,
    actualReview
      ? "직접 겪은 뒤에는 좋았던 부분도 있었지만 모든 사람에게 똑같이 맞는다고 말하기는 어렵겠더라고요. 그래도 이 경험은 제 안에서는 충분히 다시 떠올릴 만한 시간으로 남았습니다."
      : "아직 직접 경험한 내용이 많지 않은 경우에는 장점만 크게 보지 않고 필요한 조건을 나눠보는 편이 좋겠습니다. 이런 식으로 차분히 살펴보면 선택 전에 기준을 잡기 좋았습니다.",
    `마무리하면 ${displayKeyword} 경험은 한두 문장으로 크게 포장하기보다, 내가 처한 상황과 남아 있는 단서를 함께 놓고 보는 편이 자연스러웠습니다. ${subKeywords[0] || mainKeyword || "관련 정보"}를 찾는 분이라면 이 정도 흐름을 먼저 참고하면 부담이 덜할 것 같아요.`
  ].join("\n\n");
  const titleCandidates = [
    `${displayKeyword} 후기 직접 살펴보며 남은 점`,
    `${displayKeyword} 경험 기준으로 차분히 본 후기`,
    `${displayKeyword} 궁금했던 부분 중심 후기`,
    `${displayKeyword} 처음 볼 때 참고한 부분`,
    `${displayKeyword} 실제 상황에 맞춰 본 후기`
  ];
  const fallbackDraft = createProductReviewDraft(normalizedForm);
  const faqItems = [
    {
      question: `${displayKeyword} 관련해서는 어떤 점이 먼저 떠올랐나요?`,
      answer: `${memoLines[0] || `${displayKeyword}을 보게 된 상황`}이 가장 먼저 떠올랐습니다.`
    },
    {
      question: `${displayKeyword} 관련 내용을 볼 때 어떤 부분을 함께 봤나요?`,
      answer: `${subKeywords[0] || "사용 상황"}과 실제 생활에 맞는지를 함께 봤습니다.`
    },
    {
      question: `${displayKeyword}은 누구에게 참고가 될까요?`,
      answer: "비슷한 상황에서 처음 알아보는 분께 가볍게 참고가 될 수 있습니다."
    }
  ].slice(0, context.writerPlan.faqCount || 0);

  return {
    primaryEntity,
    finalTitle: titleCandidates[0],
    titleCandidates,
    mainKeyword,
    subKeywords: context.subKeywords,
    category: context.category,
    searchIntent: context.searchIntent,
    experienceStatus: context.experienceStatus,
    informationSufficiency: context.informationSufficiency?.level || "medium",
    writerPlan: context.writerPlan,
    body,
    faqItems,
    hashtags: fallbackDraft.hashtags,
    qualityNotes: []
  };
};

const originalFetchForHoldoutTest = globalThis.fetch;
try {
  let activeHoldoutFixture = null;
  globalThis.fetch = async (url, init = {}) => {
    const requestPayload = JSON.parse(String(init.body || "{}"));
    const systemMessage = requestPayload.messages?.[0]?.content || "";
    if (/품질\s*심사자/u.test(systemMessage)) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  score: 100,
                  publishReady: true,
                  scores: {
                    titleQuality: 10,
                    openingQuality: 10,
                    factualGrounding: 15,
                    specificity: 15,
                    humanNaturalness: 15,
                    narrativeCoherence: 10,
                    paragraphValue: 10,
                    keywordNaturalness: 5,
                    imageGrounding: 5,
                    readerUtility: 5
                  },
                  issues: [],
                  revisionInstructions: []
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    const llmDraft = createHoldoutLlmDraft(activeHoldoutFixture);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(llmDraft)
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const holdoutLlmResults = [];
  for (const fixture of holdoutUnknownTopicFixtures) {
    activeHoldoutFixture = fixture;
    const result = await readJsonResponse(
      await createGenerateBlogRequest(fixture.form, {
        BLOG_WRITER_LLM_ENABLED: "true",
        BLOG_WRITER_LLM_JUDGE_ENABLED: "true",
        OPENAI_API_KEY: "unit-test-key",
        OPENAI_MODEL: "unit-model"
      })
    );
    holdoutLlmResults.push({ fixture, result });
    assert.equal(result.engine, "llm", fixture.id);
    assert.equal(result.judgeEngine, "llm", fixture.id);
    assert.equal(result.isMock, true, fixture.id);
    assert.equal(result.llm?.isMock, true, fixture.id);
    assert.equal(result.publishReady, false, fixture.id);
    assert.ok(result.qualityScore <= 89, `${fixture.id} mock llm score ${result.qualityScore}`);
    assert.equal(result.humanQuality?.hardFail, false, fixture.id);
    assert.ok(!holdoutUnsupportedClaimPattern.test(result.body), fixture.id);
  }

  const llmScores = holdoutLlmResults.map((item) => item.result.qualityScore);
  const llmAverage = llmScores.reduce((total, score) => total + score, 0) / llmScores.length;
  const llmMin = Math.min(...llmScores);
  const llmPublishReadyRatio =
    holdoutLlmResults.filter((item) => item.result.publishReady).length / holdoutLlmResults.length;
  const llmHardFailCount = holdoutLlmResults.filter((item) => item.result.humanQuality?.hardFail).length;
  const llmUnsupportedCount = holdoutLlmResults.filter((item) => holdoutUnsupportedClaimPattern.test(item.result.body)).length;
  const llmMockCount = holdoutLlmResults.filter((item) => item.result.isMock).length;
  const actualLlmResults = holdoutLlmResults.filter((item) => !item.result.isMock);
  const holdoutCategoryLlmStats = Object.fromEntries(
    [...new Set(holdoutUnknownTopicFixtures.map((fixture) => fixture.category))].map((category) => {
      const scores = holdoutLlmResults
        .filter((item) => item.fixture.category === category)
        .map((item) => item.result.qualityScore);
      return [
        category,
        {
          average: Math.round(scores.reduce((total, score) => total + score, 0) / scores.length),
          min: Math.min(...scores)
        }
      ];
    })
  );

  assert.equal(llmMockCount, holdoutLlmResults.length);
  assert.equal(actualLlmResults.length, 0);
  assert.ok(llmAverage <= 89, `mock LLM holdout average ${llmAverage}`);
  assert.ok(llmMin <= 89, `mock LLM holdout min ${llmMin}`);
  assert.equal(llmPublishReadyRatio, 0);
  assert.equal(llmHardFailCount, 0);
  assert.equal(llmUnsupportedCount, 0);
  assert.equal(Object.keys(holdoutCategoryLlmStats).length, 15);
  globalThis.__blogHoldoutLlmStats = {
    isMockOnly: true,
    actualCount: actualLlmResults.length,
    average: llmAverage,
    min: llmMin,
    publishReadyRatio: llmPublishReadyRatio,
    hardFailCount: llmHardFailCount,
    unsupportedCount: llmUnsupportedCount,
    category: holdoutCategoryLlmStats
  };
} finally {
  globalThis.fetch = originalFetchForHoldoutTest;
}

const sequentialGeneralizationTopics = [
  { marker: "라임포트", form: { productName: "라임포트 샐러드바 방문 후기", mainKeyword: "라임포트 샐러드바", subKeywords: "샐러드 맛집", experienceMemo: "점심에 들러서 좋았음" } },
  { marker: "오로라펜", form: { productName: "오로라펜 필기구 사용 후기", mainKeyword: "오로라펜", subKeywords: "젤펜", experienceMemo: "업무 노트에 써보고 부드럽게 기억남" } },
  { marker: "담소공방", form: { productName: "담소공방 도자기 클래스 후기", mainKeyword: "담소공방", subKeywords: "도자기 클래스", experienceMemo: "처음 참여했고 완성품이 기억남" } },
  { marker: "해든소아", form: { productName: "해든소아과 예방접종 방문 후기", mainKeyword: "해든소아과", subKeywords: "소아과 방문", experienceMemo: "아이와 방문했고 접수 흐름이 궁금했음" } },
  { marker: "민트렌탈", form: { productName: "민트렌탈 정수기 상담 후기", mainKeyword: "민트렌탈", subKeywords: "정수기 렌탈", experienceMemo: "상담 받아보고 조건을 비교함" } },
  { marker: "별하서점", form: { productName: "별하서점 독립서점 방문 후기", mainKeyword: "별하서점", subKeywords: "독립서점", experienceMemo: "주말에 들렀고 조용한 분위기가 기억남" } },
  { marker: "소담펜션", form: { productName: "소담펜션 가족 숙소 후기", mainKeyword: "소담펜션", subKeywords: "가족 펜션", experienceMemo: "하룻밤 머물렀고 산책하기 좋았음" } },
  { marker: "피크브루", form: { productName: "피크브루 원두 비교 정리", mainKeyword: "피크브루", subKeywords: "원두 비교", experienceMemo: "구매 전 산미와 고소함 차이가 궁금했음" } },
  { marker: "노리숲", form: { productName: "노리숲 실내체험관 아이랑 후기", mainKeyword: "노리숲", subKeywords: "아이랑 실내체험", experienceMemo: "비 오는 날 다녀와서 좋았음" } },
  { marker: "에코캠프", form: { productName: "에코캠프 텐트 설치 후기", mainKeyword: "에코캠프", subKeywords: "텐트 설치", experienceMemo: "처음 설치해보고 순서가 기억남" } },
  { marker: "한별스테이", form: { productName: "한별스테이 숙박 후기", mainKeyword: "한별스테이", subKeywords: "가족 숙소", experienceMemo: "하룻밤 머물렀고 조용해서 좋았음" } },
  { marker: "무드헤어", form: { productName: "무드헤어 앞머리펌 후기", mainKeyword: "무드헤어", subKeywords: "앞머리펌", experienceMemo: "방문해서 상담받고 시술함" } },
  { marker: "솔라백", form: { productName: "솔라백 출근가방 사용 후기", mainKeyword: "솔라백", subKeywords: "출근가방", experienceMemo: "일주일 들고 다녀보니 수납이 기억남" } },
  { marker: "온담한의원", form: { productName: "온담한의원 초진 후기", mainKeyword: "온담한의원", subKeywords: "초진 상담", experienceMemo: "처음 방문했고 접수 흐름이 궁금했음" } },
  { marker: "브릭수업", form: { productName: "브릭수업 코딩 클래스 후기", mainKeyword: "브릭수업", subKeywords: "코딩 클래스", experienceMemo: "아이가 수업 듣고 흥미를 보였음" } },
  { marker: "정리홈", form: { productName: "정리홈 수납 컨설팅 후기", mainKeyword: "정리홈", subKeywords: "수납 컨설팅", experienceMemo: "상담받고 필요한 부분을 알게 됨" } },
  { marker: "라온길", form: { productName: "라온길 당일치기 여행 후기", mainKeyword: "라온길", subKeywords: "당일치기 코스", experienceMemo: "가족이랑 걸어보고 기억남" } },
  { marker: "소복비누", form: { productName: "소복비누 원데이클래스 후기", mainKeyword: "소복비누", subKeywords: "비누 클래스", experienceMemo: "처음 만들어봤고 완성품이 기억남" } },
  { marker: "클리어폼", form: { productName: "클리어폼 클렌징폼 사용 후기", mainKeyword: "클리어폼", subKeywords: "클렌징폼", experienceMemo: "저녁 세안 때 써보고 거품이 기억남" } },
  { marker: "모아카드", form: { productName: "모아카드 교통카드 비교 기준", mainKeyword: "모아카드", subKeywords: "교통카드 비교", experienceMemo: "구매 전 충전 방식이 궁금했음" } }
];
const sequentialOutputs = [];
for (const topic of sequentialGeneralizationTopics) {
  const review = createProductReviewDraft(normalizeBlogWriterInput(topic.form));
  const outputText = collectReviewOutputText(review);
  const previousMarkers = sequentialOutputs.map((item) => item.marker);
  assert.equal(previousMarkers.filter((marker) => outputText.includes(marker)).length, 0, topic.marker);
  assert.ok(outputText.includes(topic.marker), topic.marker);
  sequentialOutputs.push({ marker: topic.marker, outputText });
}
assert.equal(sequentialOutputs.length, 20);

const requestedFamilyCafePackageReview = createProductReviewDraft({
  mainKeyword: "부천 아이랑 갈만한 카페",
  experienceMemo:
    "주말에 가족이랑 방문\n아이 음료 있음\n좌석 넓음"
});
assert.equal(requestedFamilyCafePackageReview.category, "cafe");
assert.ok(requestedFamilyCafePackageReview.bodyLength >= 1000 && requestedFamilyCafePackageReview.bodyLength <= 2200);
assert.ok(requestedFamilyCafePackageReview.contentPackage.secondaryKeywords.includes("아이랑 카페"));
assert.ok(requestedFamilyCafePackageReview.contentPackage.secondaryKeywords.includes("아이 음료"));
assert.ok(requestedFamilyCafePackageReview.body.includes("가족"));
assert.ok(requestedFamilyCafePackageReview.body.includes("아이 음료"));
assert.ok(requestedFamilyCafePackageReview.body.includes("좌석"));
assert.ok(requestedFamilyCafePackageReview.contentPackage.infoSummary.some(([label, value]) => label === "주차" && value === "[확인 필요]"));
assert.ok(requestedFamilyCafePackageReview.contentPackage.infoSummary.some(([label, value]) => label === "대표 메뉴/가격" && value.includes("가격 [확인 필요]")));
assert.ok(requestedFamilyCafePackageReview.contentPackage.finalChecklist.some((item) => item.label === "해시태그 10~15개 포함 여부" && item.passed));
assert.ok(!forbiddenReviewGuidePattern.test(requestedFamilyCafePackageReview.body));
assertQualityScore(requestedFamilyCafePackageReview);

const requestedDryShampooPackageReview = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  mainKeyword: "에어젤 드라이샴푸",
  experienceMemo:
    "운동 후 사용\n떡진 머리 보송\n휴대 편함\n향 괜찮음"
});
const requestedDryShampooFirstSentence = requestedDryShampooPackageReview.body.split(/(?<=[.!?])\s+/u)[0];
assert.ok(["product", "beauty"].includes(requestedDryShampooPackageReview.category));
assert.equal(requestedDryShampooPackageReview.contentPackage.mainKeyword, "에어젤 드라이샴푸");
assert.ok(requestedDryShampooPackageReview.selectedTitle.includes("에어젤 드라이샴푸"));
assert.ok(requestedDryShampooPackageReview.bodyLength >= 1000 && requestedDryShampooPackageReview.bodyLength <= 2200);
assert.ok(requestedDryShampooFirstSentence.includes("에어젤 드라이샴푸"));
assert.ok(requestedDryShampooPackageReview.contentPackage.secondaryKeywords.includes("운동 후 드라이샴푸"));
assert.ok(requestedDryShampooPackageReview.body.includes("운동"));
assert.ok(requestedDryShampooPackageReview.body.includes("앞머리"));
assert.ok(requestedDryShampooPackageReview.body.includes("정수리"));
assert.ok(requestedDryShampooPackageReview.body.includes("보송"));
assert.ok(requestedDryShampooPackageReview.body.includes("휴대"));
assert.ok(requestedDryShampooPackageReview.body.includes("향"));
assert.ok(requestedDryShampooPackageReview.body.includes("완전히 샴푸한 느낌"));
assert.ok(!requestedDryShampooPackageReview.body.includes("[사진 삽입:"));
assert.ok(!/사진\s*\d|이미지\s*\d|업로드 파일/u.test(requestedDryShampooPackageReview.body));
assert.ok(!requestedDryShampooPackageReview.body.includes("최종 검수표"));
assert.ok(!forbiddenReviewGuidePattern.test(requestedDryShampooPackageReview.body));
assert.deepEqual(
  requestedDryShampooPackageReview.contentPackage.photoGuide.slice(0, 3).map((item) => `${item.marker} ${item.guide}`),
  [
    "[대표 사진] 제품명과 패키지가 잘 보이는 사진",
    "[사용 장면] 운동 후 사용 상황을 보여줄 수 있는 사진",
    "[상세 사진] 용량, 사용법, 성분을 확인할 수 있는 사진"
  ]
);
assert.ok(requestedDryShampooPackageReview.contentPackage.finalChecklist.find((item) => item.label === "첫 문장 메인 키워드 포함 여부").passed);
assert.ok(!/효과 보장|무조건 추천|역대급|완전 대박/u.test(requestedDryShampooPackageReview.body));
assert.ok(!/상담|서비스|신청|견적|예약 과정|비용 일정|추가 조건|진행 과정|결과 확인 장면/u.test(requestedDryShampooPackageReview.body));
assertQualityScore(requestedDryShampooPackageReview);

const productForbiddenOutputPattern =
  /상담|서비스|신청|이용 전|진행 과정|비용|일정|견적|추가 조건|상담 과정|상담 방식|결과 확인 장면|혼자 해결하기보다 상담|처음 신청하는 서비스/u;
assert.ok(!productForbiddenOutputPattern.test(collectReviewOutputText(requestedDryShampooPackageReview)));

const restaurantForbiddenOutputPattern =
  /상담|서비스 신청|신청 과정|진행 과정|체험 흐름|비용 일정|견적|결과 확인|사용감|발림감|제형|제품 패키지|커리큘럼|수강 흐름/u;

const sparseYukjjamRestaurantReview = createProductReviewDraft({
  productName: "육짬 강화도본점 맛집후기",
  experienceMemo: "갈낙짬뽕이 유명한 곳",
  targetCharCount: 1600
});
const sparseYukjjamText = collectReviewOutputText(sparseYukjjamRestaurantReview);
assert.equal(sparseYukjjamRestaurantReview.category, "restaurant");
assert.ok(sparseYukjjamRestaurantReview.finalTitle.includes("육짬"));
assert.ok(sparseYukjjamRestaurantReview.finalTitle.includes("갈낙짬뽕"));
assert.ok(sparseYukjjamRestaurantReview.titleCandidates.every((title) => /육짬(?: 강화도본점)?/u.test(title)));
assert.ok(sparseYukjjamRestaurantReview.titleCandidates.filter((title) => title.includes("갈낙짬뽕")).length >= 3);
assert.ok(sparseYukjjamRestaurantReview.body.includes("갈낙짬뽕"));
assert.ok(sparseYukjjamRestaurantReview.body.includes("국물"));
assert.ok(sparseYukjjamRestaurantReview.body.includes("대기"));
assert.ok(sparseYukjjamRestaurantReview.bodyLength >= 1000 && sparseYukjjamRestaurantReview.bodyLength <= 2500);
assert.ok(!restaurantForbiddenOutputPattern.test(sparseYukjjamText));
assert.ok(!forbiddenUnsupportedRestaurantClaimPattern.test(sparseYukjjamRestaurantReview.body));
assertQualityScore(sparseYukjjamRestaurantReview);

const richYukjjamRestaurantReview = createProductReviewDraft({
  productName: "육짬 강화도본점 맛집 후기",
  mainKeyword: "강화도맛집",
  experienceMemo: "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음",
  imageContext: [
    { index: 1, note: "대표 메뉴 사진" },
    { index: 2, note: "음식 사진" }
  ],
  imageCount: 2,
  targetCharCount: 2500
});
const richYukjjamFirstSentence = richYukjjamRestaurantReview.body.split(/(?<=[.!?])\s+/u)[0];
const richYukjjamFirstParagraph = richYukjjamRestaurantReview.body.split(/\n{2,}/u)[0];
const richYukjjamEarlyBody = richYukjjamRestaurantReview.body.split(/\n{2,}/u).slice(0, 8).join("\n");
const richYukjjamTitles = richYukjjamRestaurantReview.titleCandidates;
const richYukjjamMainCount = countOccurrences(richYukjjamRestaurantReview.body, "육짬 강화도본점");
const richYukjjamSubCounts = ["강화도맛집", "갈낙짬뽕"].map((keyword) =>
  countOccurrences(richYukjjamRestaurantReview.body, keyword)
);
const richYukjjamFaqItems = richYukjjamRestaurantReview.contentPackage.faqItems;
const richYukjjamAnalysis = analyzeBlogWritingInput({
  productName: "육짬 강화도본점 맛집 후기",
  mainKeyword: "강화도맛집",
  experienceMemo: "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음"
});
const richYukjjamPromptPayload = buildBlogWriterPromptPayload({
  form: {
    productName: "육짬 강화도본점 맛집 후기",
    mainKeyword: "강화도맛집",
    experienceMemo: "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음",
    targetCharCount: 2500
  },
  analysis: richYukjjamAnalysis,
  fallbackDraft: richYukjjamRestaurantReview
});
const richYukjjamModuleQuality = evaluateBlogWriterQuality({
  form: {
    productName: "육짬 강화도본점 맛집 후기",
    mainKeyword: "강화도맛집",
    experienceMemo: "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음"
  },
  category: richYukjjamRestaurantReview.category,
  selectedTitle: richYukjjamRestaurantReview.selectedTitle,
  titleCandidates: richYukjjamRestaurantReview.titleCandidates,
  body: richYukjjamRestaurantReview.body,
  mainKeyword: richYukjjamRestaurantReview.contentPackage.mainKeyword,
  subKeywords: richYukjjamRestaurantReview.contentPackage.subKeywords,
  hashtags: richYukjjamRestaurantReview.hashtags,
  faqItems: richYukjjamFaqItems,
  imageCount: 2,
  photoGuide: richYukjjamRestaurantReview.contentPackage.photoGuide,
  targetCharCount: richYukjjamRestaurantReview.contentPackage.targetLengthRange.target,
  primaryMenu: "갈낙짬뽕"
});
assert.equal(richYukjjamRestaurantReview.category, "restaurant");
assert.equal(richYukjjamRestaurantReview.engine, "fallback");
assert.equal(richYukjjamRestaurantReview.summary.engine, "fallback");
assert.equal(richYukjjamRestaurantReview.summary.bodyLength, richYukjjamRestaurantReview.bodyLength);
assert.equal(richYukjjamRestaurantReview.summary.requestedTargetCharCount, 2500);
assert.equal(richYukjjamRestaurantReview.summary.informationLimited, true);
assert.equal(richYukjjamAnalysis.primaryEntity, "육짬 강화도본점");
assert.equal(richYukjjamAnalysis.mainKeyword, "육짬 강화도본점");
assert.equal(richYukjjamAnalysis.broadKeyword, "강화도맛집");
assert.ok(richYukjjamAnalysis.entityCorrected);
assert.equal(richYukjjamRestaurantReview.contentPackage.mainKeyword, "육짬 강화도본점");
assert.equal(richYukjjamRestaurantReview.primaryEntity, "육짬 강화도본점");
assert.equal(richYukjjamRestaurantReview.contentPackage.primaryEntity, "육짬 강화도본점");
assert.ok(richYukjjamRestaurantReview.contentPackage.subKeywords.includes("강화도맛집"));
assert.ok(richYukjjamRestaurantReview.contentPackage.subKeywords.includes("갈낙짬뽕"));
assert.ok(richYukjjamRestaurantReview.contentPackage.subKeywords.includes("가족여행"));
assert.equal(richYukjjamRestaurantReview.experienceStatus, "visited");
assert.equal(richYukjjamRestaurantReview.contentPackage.experienceStatus, "visited");
assert.equal(richYukjjamRestaurantReview.contentPackage.imageAnalysis.mode, "label-only");
assert.ok(["low", "medium", "high"].includes(richYukjjamRestaurantReview.contentPackage.informationSufficiency.level));
assert.ok(richYukjjamRestaurantReview.contentPackage.factMap.facts.length >= 4);
assert.ok(richYukjjamRestaurantReview.contentPackage.writerPlan.outline.length >= 3);
assert.deepEqual(richYukjjamRestaurantReview.faq, richYukjjamRestaurantReview.contentPackage.faqItems);
assert.equal(richYukjjamRestaurantReview.contentPackage.blogWriterAnalysis.mainKeyword, "육짬 강화도본점");
assert.ok(richYukjjamRestaurantReview.contentPackage.blogWriterAnalysis.subKeywords.includes("강화도맛집"));
assert.ok(richYukjjamRestaurantReview.contentPackage.blogWriterAnalysis.subKeywords.includes("갈낙짬뽕"));
assert.equal(richYukjjamPromptPayload.mode, "llm-preferred-with-static-fallback");
assert.ok(richYukjjamPromptPayload.messages[0].content.includes("가족 라이프스타일 블로거"));
assert.ok(richYukjjamPromptPayload.messages[0].content.includes("방문 후기형 문장"));
assert.ok(richYukjjamPromptPayload.messages[1].content.includes('"primaryEntity": "육짬 강화도본점"'));
assert.ok(!richYukjjamPromptPayload.messages.some((message) => /OPENAI_API_KEY|sk-/u.test(message.content)));
assert.ok(/육짬 강화도본점|초지대교 맛집/u.test(richYukjjamRestaurantReview.finalTitle));
assert.ok(richYukjjamTitles.every((title) => /육짬 강화도본점|초지대교 맛집/u.test(title)));
assert.ok(richYukjjamTitles.every((title) => Array.from(title).length >= 28 && Array.from(title).length <= 40));
assert.ok(richYukjjamTitles.filter((title) => title.includes("갈낙짬뽕")).length >= 3);
assert.ok(richYukjjamTitles.filter((title) => /강화도맛집|초지대교|강화도|맛집/u.test(title)).length >= 2);
assert.ok(richYukjjamTitles.some((title) => /들른|다녀온|궁금했던|방문 후기/u.test(title)));
assert.ok(richYukjjamTitles.some((title) => /가족여행|가족 식사/u.test(title)));
assert.ok(!richYukjjamTitles.some((title) => /식사 후보|식사로 본 점|정보 정리|확인할 점/u.test(title)));
assert.ok(richYukjjamFirstSentence.includes("육짬 강화도본점"));
assert.ok(countOccurrences(richYukjjamFirstParagraph, "육짬 강화도본점") >= 2);
assert.ok(countOccurrences(richYukjjamFirstParagraph, "육짬 강화도본점") <= 3);
assert.ok(richYukjjamEarlyBody.includes("가족"));
assert.ok(richYukjjamEarlyBody.includes("강화도맛집"));
assert.ok(richYukjjamEarlyBody.includes("갈낙짬뽕"));
assert.ok(richYukjjamFirstParagraph.includes("들르게 된"));
assert.ok(richYukjjamRestaurantReview.body.includes("가족여행 중 들른"));
assert.ok(richYukjjamRestaurantReview.body.includes("다녀온 뒤"));
assert.ok(richYukjjamRestaurantReview.body.includes("[사진 삽입: 대표 메뉴 사진]"));
assert.equal((richYukjjamRestaurantReview.body.match(/\[사진 삽입:/gu) || []).length, 2);
assert.ok(richYukjjamRestaurantReview.actualBodyCharCount >= 1500 && richYukjjamRestaurantReview.actualBodyCharCount <= 2500);
assert.ok(richYukjjamRestaurantReview.body.length >= 1500 && richYukjjamRestaurantReview.body.length <= 2500);
assert.ok(richYukjjamMainCount >= 5 && richYukjjamMainCount <= 6);
assert.ok(richYukjjamSubCounts.every((count) => count >= 2 && count <= 5));
assert.ok(richYukjjamRestaurantReview.body.includes("붉은 국물"));
assert.ok(richYukjjamRestaurantReview.body.includes("해산물"));
assert.ok(richYukjjamRestaurantReview.body.includes("한 끼 메뉴"));
assert.ok(richYukjjamRestaurantReview.body.includes("사진으로 다시 봐도"));
assert.ok(!/식사 후보|판단 기준|정보가 흩어져 있으면/u.test(richYukjjamRestaurantReview.body));
assert.equal(countOccurrences(richYukjjamRestaurantReview.body, "식사권"), 0);
assert.ok(!/협찬이지만\s*솔직히|내돈내산처럼/u.test(richYukjjamRestaurantReview.body));
assert.ok(!/직원\s*친절|주차\s*편|양\s*많|웨이팅\s*없|가격\s*만족|재방문|예약\s*가능|영업시간\s*(?:은|:)\s*\d/u.test(richYukjjamRestaurantReview.body));
assert.ok(!/방문 전 확인|한 번 더 확인|확인이 필요합니다|확인하면 좋겠어요|확인할 항목|실제 후기를 함께|맛을 단정하기보다|맛이나 양을 과하게|맛을 대신|제공된 정보|정보가 없다면|단정하지 않는 편|안전해요/u.test(richYukjjamRestaurantReview.body));
assert.ok(!/글을 읽는 사람|글 안에서|본문에서|광고처럼|단정하지 않고|제공된 정보|작성하면|확인 필요|정보가 부족하면|자연스럽게 정리되는 느낌|글의 흐름|글이 더 구체적으로/u.test(richYukjjamRestaurantReview.body));
assert.ok(!/육짬는/u.test(collectReviewOutputText(richYukjjamRestaurantReview)));
assert.ok(richYukjjamRestaurantReview.body.includes("육짬 강화도본점은"));
assert.ok(richYukjjamRestaurantReview.hashtags.length >= 10 && richYukjjamRestaurantReview.hashtags.length <= 15);
assert.equal(new Set(richYukjjamRestaurantReview.hashtags).size, richYukjjamRestaurantReview.hashtags.length);
assert.equal(new Set(richYukjjamRestaurantReview.hashtags.map((tag) => tag.replace(/^#/u, ""))).size, richYukjjamRestaurantReview.hashtags.length);
assert.equal(richYukjjamFaqItems.length, 3);
assert.ok(richYukjjamFaqItems[0].question.includes("어떤 메뉴"));
assert.ok(richYukjjamFaqItems[0].answer.includes("갈낙짬뽕"));
assert.ok(/방문 시간대|대기|주차/u.test(richYukjjamFaqItems[1].answer));
assert.ok(richYukjjamFaqItems[2].question.includes("강화도맛집"));
assert.ok(!richYukjjamFaqItems.some((item) => /아이/u.test(`${item.question} ${item.answer}`)));
assert.ok(!forbiddenReviewGuidePattern.test(richYukjjamRestaurantReview.body));
assert.ok(!forbiddenUnsupportedRestaurantClaimPattern.test(richYukjjamRestaurantReview.body));
assertNoDuplicateBodyParts(richYukjjamRestaurantReview.body);
assert.ok(richYukjjamModuleQuality.score >= 95, richYukjjamModuleQuality.issues.join(", "));
assert.equal(richYukjjamModuleQuality.criticalFailed, false);
assert.ok(richYukjjamRestaurantReview.blogWriterQuality.score >= 95);
assertQualityScore(richYukjjamRestaurantReview);

const sponsoredYukjjamRestaurantReview = createProductReviewDraft({
  productName: "육짬 강화도본점 맛집 후기",
  mainKeyword: "육짬, 강화도맛집",
  experienceMemo: "강화도 가족여행중 다녀와서 좋았음 식사권 제공",
  imageContext: [
    { index: 1, note: "대표 메뉴 사진" },
    { index: 2, note: "음식 사진" }
  ],
  imageCount: 2,
  targetCharCount: 2500
});
assert.equal(sponsoredYukjjamRestaurantReview.contentPackage.mainKeyword, "육짬 강화도본점");
assert.equal(countOccurrences(sponsoredYukjjamRestaurantReview.body, "식사권"), 1);
assert.ok(/식사권을\s*제공받아/u.test(sponsoredYukjjamRestaurantReview.body));
assert.ok(!/협찬이지만\s*솔직히|내돈내산처럼/u.test(sponsoredYukjjamRestaurantReview.body));
assertQualityScore(sponsoredYukjjamRestaurantReview);

const noProvidedFieldRestaurantReview = createProductReviewDraft({
  productName: "파스타 맛집 후기",
  experienceMemo: "가족 외식으로 방문",
  targetCharCount: 1600
});
assert.equal(noProvidedFieldRestaurantReview.category, "restaurant");
assert.ok(noProvidedFieldRestaurantReview.body.includes("가족"));
assert.ok(!/양\s*많|직원\s*친절|주차\s*편/u.test(noProvidedFieldRestaurantReview.body));
assert.ok(!forbiddenUnsupportedRestaurantClaimPattern.test(noProvidedFieldRestaurantReview.body));
assertNoDuplicateBodyParts(noProvidedFieldRestaurantReview.body);
assertQualityScore(noProvidedFieldRestaurantReview);

const lowTargetCharCountReview = createProductReviewDraft({
  productName: "육짬 강화도본점 맛집후기",
  experienceMemo: "갈낙짬뽕 유명",
  targetCharCount: 200
});
assert.equal(lowTargetCharCountReview.contentPackage.targetCharCount, 800);
assert.equal(lowTargetCharCountReview.contentPackage.targetLengthRange.target, 800);

const highTargetCharCountReview = createProductReviewDraft({
  productName: "육짬 강화도본점 맛집후기",
  experienceMemo: "갈낙짬뽕 유명",
  targetCharCount: 9000
});
assert.equal(highTargetCharCountReview.contentPackage.targetCharCount, 1700);
assert.equal(highTargetCharCountReview.contentPackage.targetLengthRange.target, 1700);
assert.equal(highTargetCharCountReview.contentPackage.requestedTargetCharCount, 4000);
assert.equal(highTargetCharCountReview.contentPackage.informationLimited, true);
assert.ok(highTargetCharCountReview.bodyLength <= 1900);

const dryShampooWithStaleServiceTitle = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  experienceMemo:
    "운동 후 사용\n앞머리와 정수리 보송\n휴대 편함\n향 무난함",
  selectedTitle: "에어젤 드라이샴푸 후기 상담 과정과 이용 전 확인할 점"
});
assert.ok(["product", "beauty"].includes(dryShampooWithStaleServiceTitle.category));
assert.ok(dryShampooWithStaleServiceTitle.selectedTitle.includes("에어젤 드라이샴푸"));
assert.notEqual(dryShampooWithStaleServiceTitle.selectedTitle, "에어젤 드라이샴푸 후기 상담 과정과 이용 전 확인할 점");
assert.ok(!productForbiddenOutputPattern.test(collectReviewOutputText(dryShampooWithStaleServiceTitle)));

const sequentialDryShampooReview = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  experienceMemo:
    "운동 후 사용\n앞머리와 정수리 보송\n휴대 편함\n향 무난함",
  generationId: "seq-dry-shampoo"
});
const sequentialPastaReview = createProductReviewDraft({
  productName: "파스타 맛집 후기",
  experienceMemo:
    "가족 외식으로 방문\n분위기 좋음\n양이 생각보다 많았음\n직원 친절\n주차가 편했음",
  selectedTitle: sequentialDryShampooReview.selectedTitle,
  generationId: "seq-pasta"
});
const sequentialPastaText = collectReviewOutputText(sequentialPastaReview);
assert.equal(sequentialPastaReview.generationId, "seq-pasta");
assert.equal(sequentialPastaReview.contentPackage.generationId, "seq-pasta");
assert.equal(sequentialPastaReview.category, "restaurant");
assert.equal(sequentialPastaReview.contentPackage.mainKeyword, "파스타 맛집");
assert.ok(sequentialPastaReview.finalTitle.includes("파스타 맛집"));
assert.equal(getReviewCopyTitle(sequentialPastaReview), sequentialPastaReview.finalTitle);
assert.ok(sequentialPastaReview.selectedTitle.includes("파스타 맛집"));
assert.ok(sequentialPastaReview.titleCandidates.every((title) => title.includes("파스타 맛집")));
assert.ok(sequentialPastaReview.contentPackage.titleCandidates.every((title) => title.includes("파스타 맛집")));
assert.ok(sequentialPastaReview.body.includes("파스타"));
assert.ok(sequentialPastaReview.body.includes("가족"));
assert.ok(sequentialPastaReview.body.includes("분위기"));
assert.ok(sequentialPastaReview.body.includes("양"));
assert.ok(sequentialPastaReview.body.includes("직원 응대"));
assert.ok(sequentialPastaReview.body.includes("주차"));
assert.ok(!/에어젤|드라이샴푸/u.test(sequentialPastaText));
assert.ok(!restaurantForbiddenOutputPattern.test(sequentialPastaText));
assertQualityScore(sequentialPastaReview);

const sequentialYukjjamReview = createProductReviewDraft({
  productName: "육짬 강화도본점 맛집후기",
  experienceMemo: "갈낙짬뽕이 유명한 곳",
  selectedTitle: sequentialPastaReview.selectedTitle,
  generationId: "seq-yukjjam"
});
const sequentialYukjjamText = collectReviewOutputText(sequentialYukjjamReview);
assert.equal(sequentialYukjjamReview.generationId, "seq-yukjjam");
assert.equal(sequentialYukjjamReview.contentPackage.generationId, "seq-yukjjam");
assert.equal(sequentialYukjjamReview.category, "restaurant");
assert.ok(sequentialYukjjamReview.finalTitle.includes("육짬"));
assert.ok(sequentialYukjjamReview.finalTitle.includes("갈낙짬뽕"));
assert.equal(getReviewCopyTitle(sequentialYukjjamReview), sequentialYukjjamReview.finalTitle);
assert.ok(sequentialYukjjamReview.titleCandidates.filter((title) => title.includes("갈낙짬뽕")).length >= 3);
assert.ok(sequentialYukjjamReview.body.includes("갈낙짬뽕"));
assert.ok(sequentialYukjjamReview.bodyLength >= 1000 && sequentialYukjjamReview.bodyLength <= 1600);
assert.ok(!/에어젤|드라이샴푸|파스타 맛집/u.test(sequentialYukjjamText));
assert.ok(!restaurantForbiddenOutputPattern.test(sequentialYukjjamText));
assertQualityScore(sequentialYukjjamReview);

const sequentialCustomsLectureReview = createProductReviewDraft({
  productName: "세관공매 무료공개강의 후기",
  experienceMemo:
    "초보자도 이해하기 쉬웠음\n커리큘럼을 미리 확인할 수 있었음\n입찰 흐름이 궁금했음\n강의 듣고 전체 흐름을 잡는 데 도움 됐음",
  selectedTitle: sequentialYukjjamReview.selectedTitle,
  generationId: "seq-customs-lecture"
});
const sequentialCustomsText = collectReviewOutputText(sequentialCustomsLectureReview);
assert.equal(sequentialCustomsLectureReview.generationId, "seq-customs-lecture");
assert.equal(sequentialCustomsLectureReview.contentPackage.generationId, "seq-customs-lecture");
assert.equal(sequentialCustomsLectureReview.category, "education");
assert.equal(sequentialCustomsLectureReview.contentPackage.mainKeyword, "세관공매 무료공개강의");
assert.ok(!sequentialCustomsText.includes("세관공매 무료공개강의의"));
assert.ok(/세관공매(?: 무료공개강의)?/u.test(sequentialCustomsLectureReview.finalTitle));
assert.equal(getReviewCopyTitle(sequentialCustomsLectureReview), sequentialCustomsLectureReview.finalTitle);
assert.ok(sequentialCustomsLectureReview.selectedTitle.includes("세관공매 무료공개강의"));
assert.ok(sequentialCustomsLectureReview.titleCandidates.every((title) => title.includes("세관공매 무료공개강의")));
assert.ok(sequentialCustomsLectureReview.contentPackage.titleCandidates.every((title) => title.includes("세관공매 무료공개강의")));
assert.ok(sequentialCustomsLectureReview.body.includes("세관공매"));
assert.ok(sequentialCustomsLectureReview.body.includes("초보자"));
assert.ok(sequentialCustomsLectureReview.body.includes("커리큘럼"));
assert.ok(sequentialCustomsLectureReview.body.includes("입찰 흐름"));
assert.ok(sequentialCustomsLectureReview.body.includes("전체 흐름"));
assert.ok(!/에어젤|드라이샴푸|파스타 맛집|육짬|갈낙짬뽕/u.test(sequentialCustomsText));
assert.ok(!/발림감|사용감|배송|패키지|웨이팅|직원 응대/u.test(sequentialCustomsLectureReview.body));
assertQualityScore(sequentialCustomsLectureReview);

const shortDryShampooLengthReview = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  experienceMemo:
    "운동 후 사용\n앞머리와 정수리 보송\n휴대 편함\n향 무난함",
  targetLengthOption: "short"
});
assert.ok(["product", "beauty"].includes(shortDryShampooLengthReview.category));
assert.ok(shortDryShampooLengthReview.bodyLength >= 1000 && shortDryShampooLengthReview.bodyLength <= 1500);
assert.ok(shortDryShampooLengthReview.finalTitle.includes("에어젤 드라이샴푸"));
assert.ok(shortDryShampooLengthReview.body.includes("운동"));
assert.ok(shortDryShampooLengthReview.body.includes("보송"));
assert.ok(!productForbiddenOutputPattern.test(collectReviewOutputText(shortDryShampooLengthReview)));
assertQualityScore(shortDryShampooLengthReview);

const mediumPastaLengthReview = createProductReviewDraft({
  productName: "파스타 맛집 후기",
  experienceMemo:
    "가족 외식으로 방문\n분위기 좋음\n양이 생각보다 많았음\n직원 친절\n주차 편했음",
  targetLengthOption: "medium"
});
assert.equal(mediumPastaLengthReview.category, "restaurant");
assert.ok(mediumPastaLengthReview.bodyLength >= 1800 && mediumPastaLengthReview.bodyLength <= 2500);
assert.ok(mediumPastaLengthReview.finalTitle.includes("파스타 맛집"));
assert.ok(mediumPastaLengthReview.body.includes("가족"));
assert.ok(mediumPastaLengthReview.body.includes("분위기"));
assert.ok(mediumPastaLengthReview.body.includes("양"));
assert.ok(mediumPastaLengthReview.body.includes("직원 응대"));
assert.ok(mediumPastaLengthReview.body.includes("주차"));
assert.ok(!/에어젤|드라이샴푸/u.test(collectReviewOutputText(mediumPastaLengthReview)));
assert.ok(!restaurantForbiddenOutputPattern.test(collectReviewOutputText(mediumPastaLengthReview)));
assertQualityScore(mediumPastaLengthReview);

const longCustomsLectureLengthReview = createProductReviewDraft({
  productName: "세관공매 무료공개강의 후기",
  experienceMemo:
    "초보자도 이해하기 쉬웠음\n커리큘럼을 미리 확인할 수 있었음\n입찰 흐름이 궁금했음\n강의 듣고 전체 흐름을 잡는 데 도움 됐음",
  targetLengthOption: "long"
});
assert.equal(longCustomsLectureLengthReview.category, "education");
assert.ok(longCustomsLectureLengthReview.bodyLength >= 2800 && longCustomsLectureLengthReview.bodyLength <= 3500);
assert.ok(/세관공매(?: 무료공개강의)?/u.test(longCustomsLectureLengthReview.finalTitle));
assert.ok(longCustomsLectureLengthReview.body.includes("초보자"));
assert.ok(longCustomsLectureLengthReview.body.includes("커리큘럼"));
assert.ok(longCustomsLectureLengthReview.body.includes("입찰 흐름"));
assert.ok(!/파스타 맛집|에어젤 드라이샴푸|발림감|사용감|배송|패키지/u.test(collectReviewOutputText(longCustomsLectureLengthReview)));
assertQualityScore(longCustomsLectureLengthReview);

const autoGoldBuyLengthReview = createProductReviewDraft({
  productName: "부천금매입 후기",
  experienceMemo:
    "사장님 친절\n아드님과 2대째 운영",
  targetLengthOption: "auto"
});
assert.equal(autoGoldBuyLengthReview.category, "store");
assert.ok(autoGoldBuyLengthReview.bodyLength >= 1000 && autoGoldBuyLengthReview.bodyLength <= 1800);
assert.ok(autoGoldBuyLengthReview.finalTitle.includes("부천금매입"));
assert.ok(autoGoldBuyLengthReview.body.includes("사장님"));
assert.ok(autoGoldBuyLengthReview.body.includes("2대째"));

const qualityPastaReview = createProductReviewDraft({
  mainKeyword: "부천 파스타 맛집 후기",
  experienceMemo:
    "분위기 좋음\n양 많음\n주차 편함\n직원 친절",
  tone: "친근한",
  targetLength: "1500"
});
assert.equal(qualityPastaReview.category, "restaurant");
assert.ok(qualityPastaReview.outline.includes("파스타 메뉴를 중심으로 본 부분"));
assert.ok(qualityPastaReview.body.includes("파스타"));
assert.ok(qualityPastaReview.body.includes("분위기"));
assert.ok(qualityPastaReview.body.includes("양"));
assert.ok(qualityPastaReview.body.includes("주차"));
assert.ok(qualityPastaReview.body.includes("직원 응대"));
assert.ok(!/발림감|사용감|아침저녁|텍스처|제품 전체|사용 장면/u.test(qualityPastaReview.body));
assertQualityScore(qualityPastaReview);

const categoryEngineProductReview = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  mainKeyword: "에어젤 드라이샴푸",
  experienceMemo:
    "운동 끝나고 바로 약속이 있어서 사용\n머리를 감기는 애매했는데 앞머리랑 정수리 쪽이 보송해짐\n가방에 넣고 다니기 편했음\n향은 강하지 않고 무난했음\n완전히 샴푸한 느낌은 아니지만 급할 때 쓰기 좋았음"
});
assert.ok(["product", "beauty"].includes(categoryEngineProductReview.category));
assert.ok(categoryEngineProductReview.bodyLength >= 1200);
assert.ok(categoryEngineProductReview.body.includes("운동"));
assert.ok(categoryEngineProductReview.body.includes("앞머리"));
assert.ok(categoryEngineProductReview.body.includes("정수리"));
assert.ok(categoryEngineProductReview.body.includes("보송"));
assert.ok(categoryEngineProductReview.body.includes("휴대"));
assert.ok(categoryEngineProductReview.body.includes("가방"));
assert.ok(categoryEngineProductReview.body.includes("향"));
assert.ok(categoryEngineProductReview.body.includes("완전히 샴푸한 느낌"));
assert.ok(!/상담|신청|서비스|진행 과정|견적|예약 과정|비용 일정|추가 조건|결과 확인 장면/u.test(categoryEngineProductReview.body));
assert.ok(!categoryEngineProductReview.body.includes("운동 후 사용 떡진 머리 보송"));
assert.ok(!categoryEngineProductReview.body.includes("[사진 삽입:"));
assert.ok(!categoryEngineProductReview.body.includes("해당 표현"));
assert.ok(/더라고요|있었어요|느껴졌어요|같아요/u.test(categoryEngineProductReview.body));
assert.ok(categoryEngineProductReview.contentPackage.titleCandidates.every((title) => Array.from(title).length >= 28));
assertQualityScore(categoryEngineProductReview);

const categoryEngineProductGuardReview = createProductReviewDraft({
  productName: "텀블러 후기",
  mainKeyword: "텀블러",
  experienceMemo:
    "가방에 넣고 다니기 편했음\n상담 서비스 신청 비용 일정 같은 표현은 상품 후기에는 빼야 함"
});
assert.equal(categoryEngineProductGuardReview.category, "product");
assert.ok(!/상담|서비스|신청|비용|일정|진행 과정|견적|예약 과정/u.test(categoryEngineProductGuardReview.body));

const categoryEngineRestaurantReview = createProductReviewDraft({
  productName: "부천 파스타 맛집 후기",
  mainKeyword: "부천 파스타 맛집",
  experienceMemo:
    "분위기 좋음\n양 많음\n주차 편함\n직원 친절\n가족 외식으로 괜찮았음"
});
assert.equal(categoryEngineRestaurantReview.category, "restaurant");
assert.ok(categoryEngineRestaurantReview.body.includes("파스타"));
assert.ok(categoryEngineRestaurantReview.body.includes("분위기"));
assert.ok(categoryEngineRestaurantReview.body.includes("양"));
assert.ok(categoryEngineRestaurantReview.body.includes("주차"));
assert.ok(categoryEngineRestaurantReview.body.includes("직원 응대"));
assert.ok(categoryEngineRestaurantReview.body.includes("가족"));
assert.ok(!/발림감|사용감|텍스처|제품 전체|사용 장면|배송|패키지/u.test(categoryEngineRestaurantReview.body));
assert.ok(!/아이 음료|가족 카페|카페를 찾는|카페는/u.test(categoryEngineRestaurantReview.body));
assertQualityScore(categoryEngineRestaurantReview);

const categoryEngineStoreReview = createProductReviewDraft({
  productName: "부천금매입 후기",
  mainKeyword: "부천금매입",
  experienceMemo:
    "금값이 올라서 방문\n사장님 친절\n아드님과 2대째 운영\n처음이라 시세와 매입 과정이 궁금했음"
});
assert.equal(categoryEngineStoreReview.category, "store");
assert.ok(categoryEngineStoreReview.body.includes("사장님"));
assert.ok(categoryEngineStoreReview.body.includes("2대째"));
assert.ok(categoryEngineStoreReview.body.includes("금값"));
assert.ok(categoryEngineStoreReview.body.includes("시세"));
assert.ok(categoryEngineStoreReview.body.includes("상담"));
assert.ok(!/발림감|제형|보송함|아침저녁|피부 흡수|착용감/u.test(categoryEngineStoreReview.body));
assertQualityScore(categoryEngineStoreReview);

const categoryEngineEducationReview = createProductReviewDraft({
  productName: "세관공매 무료공개강의 후기",
  mainKeyword: "세관공매 무료공개강의",
  experienceMemo:
    "초보자도 이해 쉬움\n커리큘럼 확인\n입찰 흐름 궁금\n강의 듣고 전체 흐름 파악"
});
assert.equal(categoryEngineEducationReview.category, "education");
assert.ok(categoryEngineEducationReview.body.includes("초보자"));
assert.ok(categoryEngineEducationReview.body.includes("커리큘럼"));
assert.ok(categoryEngineEducationReview.body.includes("입찰 흐름"));
assert.ok(categoryEngineEducationReview.body.includes("전체 흐름"));
assert.ok(categoryEngineEducationReview.bodyLength >= 1000);
assert.ok(!/발림감|사용감|배송|패키지|맛|웨이팅|객실|체크인/u.test(categoryEngineEducationReview.body));
assertQualityScore(categoryEngineEducationReview);

const categoryEngineKidsPlaceReview = createProductReviewDraft({
  productName: "아이랑 실내 체험관 후기",
  experienceMemo:
    "주말 가족 방문\n아이가 좋아함\n실내라 편함"
});
assert.equal(categoryEngineKidsPlaceReview.category, "kids-place");
assert.ok(categoryEngineKidsPlaceReview.body.includes("아이"));
assert.ok(categoryEngineKidsPlaceReview.body.includes("가족"));
assert.ok(categoryEngineKidsPlaceReview.body.includes("보호자") || categoryEngineKidsPlaceReview.body.includes("부모"));
assert.ok(!/발림감|사용감|상담 과정|서비스 신청/u.test(categoryEngineKidsPlaceReview.body));
assertQualityScore(categoryEngineKidsPlaceReview);

const categoryEngineInformationReview = createProductReviewDraft({
  productName: "세관공매 처음 시작하는 방법",
  mainKeyword: "세관공매",
  experienceMemo:
    "공고문 확인\n입찰 흐름\n초보자 기준\n리스크 확인 필요"
});
assert.equal(categoryEngineInformationReview.category, "information");
assert.ok(categoryEngineInformationReview.body.includes("기본 개념") || categoryEngineInformationReview.body.includes("전체 흐름"));
assert.ok(categoryEngineInformationReview.body.includes("공고문"));
assert.ok(categoryEngineInformationReview.body.includes("입찰 흐름"));
assert.ok(categoryEngineInformationReview.body.includes("리스크"));
assert.ok(categoryEngineInformationReview.bodyLength >= 1000);
assert.ok(!/직접\s*(방문|다녀|가보|사용|써보|이용|참여)|다녀왔|써봤/u.test(categoryEngineInformationReview.body));
assert.ok(!categoryEngineInformationReview.body.includes("[사진 삽입:"));
assert.ok(categoryEngineInformationReview.contentPackage.titleCandidates.every((title) => Array.from(title).length >= 28));
assert.ok(categoryEngineInformationReview.contentPackage.titleCandidates.every((title) => !/후기/u.test(title)));
assertQualityScore(categoryEngineInformationReview);

const categoryEngineServiceReview = createProductReviewDraft({
  productName: "입주청소 서비스 후기",
  experienceMemo:
    "상담 빠름\n일정 조율 편함\n청소 후 확인 필요"
});
assert.equal(categoryEngineServiceReview.category, "service");
assert.ok(categoryEngineServiceReview.body.includes("상담"));
assert.ok(categoryEngineServiceReview.body.includes("일정"));
assert.ok(categoryEngineServiceReview.body.includes("청소"));
assert.ok(!/발림감|사용감|텍스처|제품 전체|사용 장면|향이/u.test(categoryEngineServiceReview.body));

const tistoryDraft = createTistoryDraft({
  keyword: "초등 독서노트 쓰는 법",
  memo: "초등학생이 부담 없이 독서 기록을 남길 수 있는 방법을 정리하고 싶어요."
});
assert.ok(tistoryDraft.title.includes("초등 독서노트 쓰는 법"));
assert.ok(tistoryDraft.introSummary.length >= 3);
assert.ok(tistoryDraft.toc.length >= 4 && tistoryDraft.toc.length <= 6);
assert.ok(tistoryDraft.sections.length >= 4 && tistoryDraft.sections.length <= 6);
assert.ok(tistoryDraft.body.includes("도입 요약"));
assert.ok(tistoryDraft.body.includes("목차"));
assert.ok(tistoryDraft.body.includes("핵심 정리"));
assert.ok(tistoryDraft.body.includes("FAQ"));
assert.ok(tistoryDraft.tags.some((tag) => tag.includes("초등독서노트")));

const customsAuctionForm = {
  keyword: "세관공매",
  category: "교육/강의",
  goal: "정보 전달",
  audienceType: "사업자/매장 홍보",
  tone: "전문적인",
  strengths: "",
  emphasisPoint: "",
  ctaDirection: "",
  useEmoji: false,
  avoid: "상품 리뷰, 사용감, 직접 써본 후기",
  targetLengthOption: "1500",
  customTargetLength: "1500"
};
const customsAuctionTopic = createTopicRecommendations(customsAuctionForm)[0];
const customsAuctionTitle = createTitleCandidates(customsAuctionForm, customsAuctionTopic)[0];
const customsAuctionOutline = createOutlineSections(
  customsAuctionForm,
  customsAuctionTopic,
  customsAuctionTitle
);
const customsAuctionContent = createFinalContent(
  customsAuctionForm,
  customsAuctionTopic,
  customsAuctionTitle,
  customsAuctionOutline
);
const customsAuctionCombined = [
  customsAuctionTopic,
  customsAuctionTitle,
  customsAuctionOutline.join(" "),
  customsAuctionContent.body,
  customsAuctionContent.imageSuggestions.map((item) => `${item.title} ${item.description}`).join(" ")
].join(" ");
assert.ok(customsAuctionCombined.includes("세관공매"));
assert.ok(customsAuctionCombined.includes("공고"));
assert.ok(customsAuctionCombined.includes("입찰"));
assert.ok(customsAuctionCombined.includes("낙찰"));
assert.ok(customsAuctionCombined.includes("반출"));
assert.ok(customsAuctionCombined.includes("판로"));
assert.ok(!/상품 리뷰|사용감|직접 써본 후기/u.test(customsAuctionCombined));

const lowConfidenceCapture = assessCapturedCommentExtraction("AE Sosa Do", {
  confidence: 0.39,
  source: "ocr"
});
assert.equal(lowConfidenceCapture.ok, false);
assert.equal(lowConfidenceCapture.reason, "low_confidence");
assert.equal(lowConfidenceCapture.comments.length, 0);
assert.ok(lowConfidenceCapture.message.includes("댓글을 정확히 읽지 못했습니다"));

const noisyCapture = assessCapturedCommentExtraction("AE Sosa Do", {
  confidence: 0.82,
  source: "ocr"
});
assert.equal(noisyCapture.ok, false);
assert.equal(noisyCapture.reason, "noise_or_empty");
assert.equal(noisyCapture.comments.length, 0);

const reviewConfidenceCapture = assessCapturedCommentExtraction("작성자: 이웃님\n댓글: 예약 전에 확인할 포인트가 궁금해요", {
  confidence: 0.62,
  source: "ocr"
});
assert.equal(reviewConfidenceCapture.ok, true);
assert.equal(getCaptureOcrConfidenceStatus(0.62), "review");
assert.equal(reviewConfidenceCapture.comments[0].content, "예약 전에 확인할 포인트가 궁금해요");

const autoConfidenceCapture = assessCapturedCommentExtraction("작성자: 이웃님\n댓글: 직접 써본 후기라 더 믿음이 가네요", {
  confidence: 0.82,
  source: "ocr"
});
assert.equal(autoConfidenceCapture.ok, true);
assert.equal(getCaptureOcrConfidenceStatus(0.82), "auto");

const forcedNoisyCapture = assessCapturedCommentExtraction("AE Sosa Do", {
  confidence: 0.39,
  source: "ocr",
  force: true
});
assert.equal(forcedNoisyCapture.ok, true);
assert.equal(forcedNoisyCapture.comments[0].content, "AE Sosa Do");

console.log("local validation passed");
