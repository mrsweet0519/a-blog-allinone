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
import { createFinalContent } from "../shared/contentGenerator.js";

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
assert.equal(finalContent.seoCheck.items.length, 10);
assert.ok(checkIds.includes("first-paragraph-answer"));
assert.ok(checkIds.includes("image-markers"));
assert.ok(finalContent.body.includes("[여기에 이미지를 넣어주세요 이미지 1]"));
assert.ok(finalContent.imageSuggestions[0].directShotGuide);
assert.ok(finalContent.imageSuggestions[0].aiPrompt);
assert.ok(finalContent.body.includes("FAQ"));
assert.ok(finalContent.seoCheck.items.find((item) => item.id === "faq-question").passed);
assert.ok(finalContent.seoCheck.items.find((item) => item.id === "avoid").passed);

console.log("local validation passed");
