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
import {
  createProductReviewDraft,
  extractProductInfoFieldsWithMetaFromText
} from "../shared/productReviewGenerator.js";
import { createTistoryDraft } from "../shared/tistoryGenerator.js";

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
assert.equal(singlePhotoReview.category, "product");
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
  /분위기와\s*양,\s*응대|메뉴와\s*분위기,\s*양,\s*응대|직원\s*응대가\s*좋|직원\s*친절|주차가\s*편(?:했|한|해)|주차\s*편|다시\s*가고\s*싶|재방문\s*(?:의사|하고\s*싶)|맛있었|가격은\s*\d|가격\s*만족|웨이팅\s*없|예약\s*가능|영업시간/u;

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
assert.ok(requestedRestaurantReview.body.includes("가격: [확인 필요]"));
assert.ok(requestedRestaurantReview.body.includes("주차: [확인 필요]"));
assert.ok(!/후기\s+후기/u.test(requestedRestaurantReview.selectedTitle));
assert.ok(!requestedRestaurantReview.hashtags.some((tag) => /후기후기/u.test(tag)));
assert.equal(requestedRestaurantReview.titles.slice(0, 3).length, 3);
assert.ok(requestedRestaurantReview.outline.some((heading) => heading.includes("주차")));
assert.equal(requestedRestaurantReview.thumbnailTexts.length, 3);
assert.ok(requestedRestaurantReview.searchKeywords.includes(requestedRestaurantMainKeyword));
assert.ok(requestedRestaurantReview.closingParagraph.includes("가격") || requestedRestaurantReview.closingParagraph.includes("주차"));

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
assert.equal(qualityDryShampooReview.category, "product");
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
assert.ok(/상담.*분위기|분위기.*방문/u.test(requestedGoldBuyTitles[0]));
assert.ok(requestedGoldBuyTitles[1].includes("처음 방문"));
assert.ok(requestedGoldBuyTitles[2].includes("상담 기준"));
assert.ok(requestedGoldBuyTitles[3].includes("체크 포인트"));
assert.ok(requestedGoldBuyTitles[4].includes("금값"));
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
const appLayoutSource = readFileSync(new URL("../frontend/src/components/AppLayout.jsx", import.meta.url), "utf8");
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
assert.ok(productReviewMakerSource.includes("targetCharCount"));
assert.ok(productReviewMakerSource.includes("lastGeneratedSignature"));
assert.ok(productReviewMakerSource.includes("currentFormSignature"));
assert.ok(productReviewMakerSource.includes("createFormSignature"));
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
assert.ok(productReviewMakerSource.includes("window.setTimeout(() =>"));
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
  assert.ok(productReviewMakerMarkup.includes("예: 상호명 / 지역명 맛집 / 대표 메뉴"));
  assert.ok(productReviewMakerMarkup.includes("글 주제를 입력해주세요"));
  assert.ok(productReviewMakerMarkup.includes("비워두면 글 주제와 메모에서 자동으로 추출합니다."));
  assert.ok(productReviewMakerMarkup.includes("목표 글자수"));
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

const assertQualityScore = (review = {}, minimum = 95) => {
  assert.equal(Number.isFinite(review.qualityScore), true);
  assert.ok(
    review.qualityScore >= minimum,
    `${review.finalTitle || review.selectedTitle || review.category} qualityScore ${review.qualityScore}: ${(review.qualityIssues || []).join(", ")}`
  );
  assert.equal(review.contentPackage?.qualityScore, review.qualityScore);
  assert.ok(Array.isArray(review.qualityIssues));
  assert.ok(!forbiddenReviewGuidePattern.test(review.body));
  assertNoDuplicateBodyParts(review.body);
};

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
assert.equal(requestedDryShampooPackageReview.category, "product");
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
  productName: "육짬 강화도본점 맛집후기",
  mainKeyword: "육짬 강화도본점, 초지대교 맛집, 갈낙짬뽕",
  experienceMemo: "강화도 가족여행중 다녀와서 좋았음",
  imageContext: [
    { index: 1, note: "대표 메뉴 사진" },
    { index: 2, note: "매장 분위기 사진" }
  ],
  imageCount: 2,
  targetCharCount: 2900,
  sponsorshipType: "식사권 제공"
});
const richYukjjamFirstSentence = richYukjjamRestaurantReview.body.split(/(?<=[.!?])\s+/u)[0];
const richYukjjamEarlyBody = richYukjjamRestaurantReview.body.split(/\n{2,}/u).slice(0, 6).join("\n");
const richYukjjamTitles = richYukjjamRestaurantReview.titleCandidates;
const richYukjjamMainCount = countOccurrences(richYukjjamRestaurantReview.body, "육짬 강화도본점");
const richYukjjamSubCounts = ["초지대교 맛집", "갈낙짬뽕"].map((keyword) =>
  countOccurrences(richYukjjamRestaurantReview.body, keyword)
);
assert.equal(richYukjjamRestaurantReview.category, "restaurant");
assert.equal(richYukjjamRestaurantReview.contentPackage.mainKeyword, "육짬 강화도본점");
assert.deepEqual(richYukjjamRestaurantReview.contentPackage.subKeywords, ["초지대교 맛집", "갈낙짬뽕"]);
assert.ok(/육짬 강화도본점|초지대교 맛집/u.test(richYukjjamRestaurantReview.finalTitle));
assert.ok(richYukjjamTitles.every((title) => title.includes("육짬 강화도본점")));
assert.ok(richYukjjamTitles.every((title) => Array.from(title).length >= 28 && Array.from(title).length <= 40));
assert.ok(richYukjjamTitles.filter((title) => title.includes("갈낙짬뽕")).length >= 3);
assert.ok(richYukjjamTitles.filter((title) => /초지대교|강화도|맛집/u.test(title)).length >= 2);
assert.ok(richYukjjamTitles.some((title) => /방문 전|체크/u.test(title)));
assert.ok(richYukjjamTitles.some((title) => /가족여행|가족 식사|식사 후보/u.test(title)));
assert.ok(richYukjjamTitles.some((title) => /정보|요약|위치/u.test(title)));
assert.ok(richYukjjamFirstSentence.includes("육짬 강화도본점"));
assert.ok(richYukjjamEarlyBody.includes("가족"));
assert.ok(richYukjjamEarlyBody.includes("초지대교"));
assert.ok(richYukjjamEarlyBody.includes("갈낙짬뽕"));
assert.ok(richYukjjamRestaurantReview.body.includes("[사진 삽입: 대표 메뉴 사진]"));
assert.equal((richYukjjamRestaurantReview.body.match(/\[사진 삽입:/gu) || []).length, 2);
assert.ok(richYukjjamRestaurantReview.bodyLength >= 2400 && richYukjjamRestaurantReview.bodyLength <= 3500);
assert.ok(richYukjjamMainCount >= 7 && richYukjjamMainCount <= 8);
assert.ok(richYukjjamSubCounts.every((count) => count >= 2 && count <= 4));
assert.equal(countOccurrences(richYukjjamRestaurantReview.body, "식사권"), 1);
assert.ok(/식사권을\s*제공받아/u.test(richYukjjamRestaurantReview.body));
assert.ok(!/협찬이지만\s*솔직히|내돈내산처럼/u.test(richYukjjamRestaurantReview.body));
assert.ok(!/직원\s*친절|주차\s*편|양\s*많|웨이팅\s*없|가격\s*만족|재방문|예약\s*가능|영업시간/u.test(richYukjjamRestaurantReview.body));
assert.ok((richYukjjamRestaurantReview.body.match(/방문 전 .*확인|확인 .*정보|확인이 필요한 부분/gu) || []).length <= 1);
assert.ok(!forbiddenReviewGuidePattern.test(richYukjjamRestaurantReview.body));
assert.ok(!forbiddenUnsupportedRestaurantClaimPattern.test(richYukjjamRestaurantReview.body));
assertNoDuplicateBodyParts(richYukjjamRestaurantReview.body);
assertQualityScore(richYukjjamRestaurantReview);

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
assert.equal(highTargetCharCountReview.contentPackage.targetCharCount, 4000);
assert.equal(highTargetCharCountReview.contentPackage.targetLengthRange.target, 4000);

const dryShampooWithStaleServiceTitle = createProductReviewDraft({
  productName: "에어젤 드라이샴푸 후기",
  experienceMemo:
    "운동 후 사용\n앞머리와 정수리 보송\n휴대 편함\n향 무난함",
  selectedTitle: "에어젤 드라이샴푸 후기 상담 과정과 이용 전 확인할 점"
});
assert.equal(dryShampooWithStaleServiceTitle.category, "product");
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
assert.equal(shortDryShampooLengthReview.category, "product");
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
assert.equal(categoryEngineProductReview.category, "product");
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
