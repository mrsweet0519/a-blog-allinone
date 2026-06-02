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
