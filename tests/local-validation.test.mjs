import assert from "node:assert/strict";
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
import {
  createProductReviewDraft,
  extractProductInfoFieldsWithMetaFromText
} from "../shared/productReviewGenerator.js";

const now = new Date(2026, 5, 1, 10, 0, 0);

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
assert.ok(productFirstParagraph.startsWith("수분크림"));
assert.equal(productFirstParagraph.split("수분크림").length - 1, 2);
assert.ok(/해요|더라고요|같아요/u.test(productFirstParagraph));
assert.ok((productFirstParagraph.match(/찾아보다/gu) || []).length <= 1);
assert.ok((productFirstParagraph.match(/궁금/gu) || []).length <= 1);
assert.ok(!/경험 메모|OCR 원문|추출 데이터/u.test(productReview.body));
assert.ok(!/무조건|보장|완벽|즉시효과/u.test(productReview.body));
assert.ok(productReview.body.includes("[여기에 이미지 1을 넣어주세요:"));
assert.ok(productReview.hashtags.includes("#수분크림후기"));

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
assert.ok(restaurantPhotoReview.body.includes("메뉴와 맛"));
assert.ok(restaurantPhotoReview.body.includes("분위기와 동행"));
assert.ok(restaurantPhotoReview.body.includes("가격과 주문 전 확인할 점"));
assert.ok(restaurantPhotoReview.body.includes("재방문 기준"));
assert.ok(restaurantPhotoReview.body.includes("직장인 회식"));
assert.ok(restaurantPhotoReview.body.includes("[여기에 이미지 1을 넣어주세요"));
assert.ok(restaurantPhotoReview.body.includes("[여기에 이미지 3을 넣어주세요"));
assert.ok(!/(^|\n)\s*\*\s+|(^|\n)\s*\*\*.+\*\*/u.test(restaurantPhotoReview.body));

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
assert.ok(creamPhotoReview.body.includes("사용감과 향"));
assert.ok(creamPhotoReview.body.includes("좋았던 점"));
assert.ok(creamPhotoReview.body.includes("아쉬운 점"));
assert.ok(creamPhotoReview.body.includes("이런 분께 추천해요"));
assert.ok(creamPhotoReview.body.includes("발림감"));
assert.ok(creamPhotoReview.body.includes("[여기에 이미지 2을 넣어주세요"));

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
assert.ok(kidsPlacePhotoReview.body.includes("동선과 체험 흐름"));
assert.ok(kidsPlacePhotoReview.body.includes("부모 대기와 피로도"));
assert.ok(kidsPlacePhotoReview.body.includes("주차와 다시 갈 기준"));
assert.ok(kidsPlacePhotoReview.body.includes("주차는 확인이 필요"));
assert.ok(kidsPlacePhotoReview.body.includes("[여기에 이미지 3을 넣어주세요"));

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
