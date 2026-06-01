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

const kneeProfile = saveWritingProfile("무릎보호대 상품 후기용", {
  audienceType: "인플루언서/수익형",
  category: "스포츠용품",
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
assert.equal(loadWritingProfiles().find((profile) => profile.id === kneeProfile.id).values.category, "스포츠용품");
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
    brandName: "M.GO 샘플",
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
assert.ok(finalContent.body.includes("[여기에 이미지를 넣어주세요 이미지 1]"));
assert.ok(finalContent.imageSuggestions[0].directShotGuide);
assert.ok(finalContent.imageSuggestions[0].aiPrompt);
assert.ok(finalContent.body.includes("FAQ"));
assert.ok(finalContent.seoCheck.items.find((item) => item.id === "faq-question").passed);
assert.ok(finalContent.seoCheck.items.find((item) => item.id === "avoid").passed);

const betaForm = {
  keyword: "이더라이트, 변비해결",
  category: "온라인 쇼핑몰",
  brandName: "라비크",
  region: "",
  goal: "정보 전달",
  audienceType: "인플루언서/수익형",
  tone: "친근한",
  strengths: "성분 확인, 섭취 방식, 후기 흐름",
  emphasisPoint: "구매 전 생활 관리 관점으로 살펴볼 기준",
  ctaDirection: "필요한 기준을 천천히 비교해보세요.",
  purchaseUrl: "라비크 공식몰",
  priceInfo: "상세페이지 기준 확인",
  contactMethod: "공식몰 문의",
  shippingInfo: "구매처 안내 기준 확인",
  useEmoji: false,
  avoid: "효과 보장, 치료, 완치",
  targetLengthOption: "2000",
  customTargetLength: "2000"
};
const betaTopic = createTopicRecommendations(betaForm)[0];
const betaTitles = createTitleCandidates(betaForm, betaTopic);
assert.equal(betaTitles.length, 5);
assert.ok(betaTitles.every((title) => Array.from(title).length <= 36));
assert.ok(betaTitles[0].includes("이더라이트 변비해결"));
assert.ok(betaTitles[1].includes("후기"));
const betaOutline = createOutlineSections(betaForm, betaTopic, betaTitles[0]);
assert.equal(betaOutline.length, 5);
const betaContent = createFinalContent(betaForm, betaTopic, betaTitles[0], betaOutline);
const betaFirstParagraph = betaContent.body.split(/\n{2,}/u)[0].replace(/^✨\s*/u, "");
const betaFirstSentence = betaFirstParagraph.split(/(?<=[.!?요다])\s+/u)[0];
assert.ok(betaFirstSentence.includes("이더라이트 변비해결"));
assert.equal(betaFirstParagraph.split("이더라이트 변비해결").length - 1, 2);
assert.ok(/후기|비교|체크/u.test(betaContent.body));
assert.ok(betaContent.body.includes("FAQ"));
assert.ok(betaContent.body.includes("제품/매장 정보 정리"));
assert.ok(betaContent.hashtags.length >= 10 && betaContent.hashtags.length <= 15);
assert.ok(betaContent.hashtags.includes("#이더라이트"));
assert.ok(betaContent.seoCheck.items.find((item) => item.id === "first-sentence-keyword").passed);
assert.ok(betaContent.seoCheck.items.find((item) => item.id === "first-paragraph-keyword-density").passed);

const reviewTitleForm = {
  ...betaForm,
  keyword: "변비해결, 이너라이트",
  brandName: "",
  strengths: "생활 관리 기준, 섭취 전 확인, 후기 흐름",
  emphasisPoint: "구매 전 후기에서 많이 보는 기준"
};
const reviewTopic = createTopicRecommendations(reviewTitleForm)[0];
const reviewTitles = createTitleCandidates(reviewTitleForm, reviewTopic);
assert.equal(reviewTitles.length, 5);
assert.ok(reviewTitles[0].startsWith("변비해결 이너라이트"));
assert.ok(reviewTitles[1].includes("이너라이트 변비해결") && reviewTitles[1].includes("후기"));
assert.ok(reviewTitles[2].includes("비교"));
assert.ok(reviewTitles[3].includes("선택"));
assert.ok(reviewTitles[4].includes("다른 점"));

console.log("local validation passed");
