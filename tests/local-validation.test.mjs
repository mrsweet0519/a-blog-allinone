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
assert.ok(productReview.outline.includes("쓰기 전 기대와 걱정이 있었던 부분"));
assert.ok(productReview.outline.includes("직접 써보며 느낀 점"));
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
assert.ok(creamPhotoReview.outline.includes("쓰기 전 기대와 걱정이 있었던 부분"));
assert.ok(creamPhotoReview.body.includes("좋았던 점") || creamPhotoReview.body.includes("좋았어요"));
assert.ok(creamPhotoReview.body.includes("아쉬운 점"));
assert.ok(creamPhotoReview.body.includes("발림감"));
assert.ok(creamPhotoReview.body.includes("향"));
assert.ok(creamPhotoReview.body.includes("아침저녁"));
assert.ok(creamPhotoReview.body.includes("끈적임"));
assert.ok(creamPhotoReview.body.includes("50ml"));
assert.ok(!/여기에 이미지|이미지\s*\d|사진\s*\d/u.test(creamPhotoReview.body));

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
  /정리해보려고|기준으로 풀어두면|중심으로 정리했|이런 흐름으로 작성|글에 담아보겠습니다|아래 내용은|과하게 단정하기보다|기준으로 볼 것 같아요/u;

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
const requestedRestaurantKeywordCount =
  requestedRestaurantFirstParagraph.split("역삼역 중식당 회식 후기").length - 1;
assert.ok(requestedRestaurantFirstSentence.includes("역삼역 중식당 회식 후기"));
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
assert.ok(requestedRestaurantReview.searchKeywords.includes("역삼역 중식당 회식 후기"));
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
assert.ok(requestedCreamReview.outline.includes("쓰기 전 기대와 걱정이 있었던 부분"));
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
assert.ok(goldExchangeReview.outline.includes("처음 방문해도 부담이 덜했던 상담 분위기"));
assert.ok(goldExchangeReview.outline.includes("매입 상담 전에 확인하면 좋은 부분"));
assert.ok(goldExchangeReview.body.includes("금거래소 후기"));
assert.ok(goldExchangeReview.body.includes("사장님"));
assert.ok(goldExchangeReview.body.includes("친절"));
assert.ok(goldExchangeReview.body.includes("아드님"));
assert.ok(goldExchangeReview.body.includes("2대째"));
assert.ok(goldExchangeReview.body.includes("금 시세"));
assert.ok(goldExchangeReview.body.includes("매입 과정"));
assert.ok(goldExchangeReview.body.includes("상담"));
assert.ok(goldExchangeReview.body.includes("확인"));
assert.ok(goldExchangeReview.searchKeywords.includes("매장 후기"));
assert.ok(!/발림감|사용감|향|아침저녁 사용|사용 장면|텍스처|제품 전체|패키지/u.test(goldExchangeReview.body));
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
assert.ok(!/발림감|사용감|향|아침저녁|텍스처|제품 전체|사용 장면/u.test(qualityGoldStoreReview.body));

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
assert.ok(qualityDryShampooReview.outline.includes("운동 후 머리가 신경 쓰일 때 꺼내본 이유"));
assert.ok(qualityDryShampooReview.body.includes("운동"));
assert.ok(qualityDryShampooReview.body.includes("보송"));
assert.ok(qualityDryShampooReview.body.includes("휴대"));
assert.ok(qualityDryShampooReview.body.includes("향"));
assert.ok(!/매장|방문 전|상담 분위기/u.test(qualityDryShampooReview.body));

const qualityPastaReview = createProductReviewDraft({
  mainKeyword: "부천 파스타 맛집 후기",
  experienceMemo:
    "분위기 좋음\n양 많음\n주차 편함\n직원 친절",
  tone: "친근한",
  targetLength: "1500"
});
assert.equal(qualityPastaReview.category, "restaurant");
assert.ok(qualityPastaReview.outline.includes("파스타 먹을 곳을 찾다가 눈에 들어온 곳"));
assert.ok(qualityPastaReview.body.includes("파스타"));
assert.ok(qualityPastaReview.body.includes("분위기"));
assert.ok(qualityPastaReview.body.includes("양"));
assert.ok(qualityPastaReview.body.includes("주차"));
assert.ok(qualityPastaReview.body.includes("직원 응대"));
assert.ok(!/발림감|사용감|아침저녁|텍스처|제품 전체|사용 장면/u.test(qualityPastaReview.body));

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
