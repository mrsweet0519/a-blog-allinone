import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { accessCodes } from "../frontend/src/data/accessCodes.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const origin = "http://127.0.0.1:4173";
const screenshotsDir = resolve("screenshots");
const screenshotInput = resolve(screenshotsDir, "naver-oneclick-input.png");
const screenshotResult = resolve(screenshotsDir, "naver-oneclick-result.png");

const parseDateOnly = (value = "") => {
  const [year, month, day] = String(value).split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day, 23, 59, 59, 999);
};

const validAccessCode = accessCodes.find(
  (item) => item.active === true && parseDateOnly(item.expiresAt).getTime() > Date.now()
);

if (!validAccessCode) {
  throw new Error("No active local access code is available for screenshot verification.");
}

await mkdir(screenshotsDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

await page.goto(origin, { waitUntil: "networkidle" });
await page.evaluate(
  (session) => {
    localStorage.setItem("a-blog-allinone:access-session", JSON.stringify(session));
  },
  {
    code: validAccessCode.code,
    label: validAccessCode.label,
    expiresAt: validAccessCode.expiresAt,
    verifiedAt: new Date().toISOString()
  }
);

await page.goto(`${origin}/one-click/naver`, { waitUntil: "networkidle" });
await page.screenshot({ path: screenshotInput, fullPage: true });

await page
  .getByPlaceholder("예: 제품 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기")
  .fill("에어젤 드라이샴푸 후기");
await page
  .getByPlaceholder("좋았던 점, 아쉬웠던 점, 아이 반응, 재방문 의사처럼 기억나는 말만 적어주세요.")
  .fill("운동 후 사용\n떡진 머리 보송\n휴대 편함\n향 괜찮음");
await page.getByRole("button", { name: "블로그 초안 만들기" }).click();
await page.getByText("최종 추천 제목").waitFor({ state: "visible" });
await page.getByText("에어젤 드라이샴푸").first().waitFor({ state: "visible" });

const titleMore = page.locator("details").filter({ hasText: "제목 더보기" }).first();
const titleMoreOpenInitially = await titleMore.evaluate((element) => element.open);
const bodyTextarea = page.locator("section").filter({ hasText: "블로그 본문" }).locator("textarea").first();
const bodyBeforeTitleRefresh = await bodyTextarea.inputValue();

await page.screenshot({ path: screenshotResult, fullPage: true });

await titleMore.locator("summary").click();
await page.getByRole("button", { name: "제목 다시 만들기" }).click();
await page.waitForTimeout(150);

const bodyAfterTitleRefresh = await bodyTextarea.inputValue();
const finalTitle = await page.locator("section").filter({ hasText: "최종 추천 제목" }).locator("input").first().inputValue();
const candidateTitles = await titleMore.locator("button").filter({ hasText: "에어젤 드라이샴푸" }).allTextContents();
const hiddenTexts = [
  "검색 의도 분석",
  "홈피드 클릭 포인트",
  "최종 검수표",
  "상세 분석 보기",
  "사진 배치 가이드",
  "OCR 원문 보기",
  "사진 속 글자 확인",
  "업체/상품 정보 정리"
];

const hiddenTextCounts = {};
for (const label of hiddenTexts) {
  hiddenTextCounts[label] = await page.getByText(label).count();
}

await browser.close();

console.log(
  JSON.stringify(
    {
      screenshots: [screenshotInput, screenshotResult],
      finalTitle,
      titleMoreOpenInitially,
      candidateCountAfterOpen: candidateTitles.length,
      titleRefreshKeptBody: bodyBeforeTitleRefresh === bodyAfterTitleRefresh,
      hiddenTextCounts
    },
    null,
    2
  )
);
