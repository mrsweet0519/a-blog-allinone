import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";

let devServerProcess = null;

const waitForServer = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch("http://127.0.0.1:5173/");
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Vite dev server did not become ready on http://127.0.0.1:5173/");
};

test.beforeAll(async () => {
  try {
    const response = await fetch("http://127.0.0.1:5173/");
    if (response.ok) return;
  } catch {
    // Start a local dev server for this E2E run.
  }

  devServerProcess = spawn("cmd.exe", ["/c", "npm.cmd run dev --prefix frontend"], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true
  });
  await waitForServer();
});

test.afterAll(() => {
  if (devServerProcess) devServerProcess.kill();
});

test("one-click naver writer keeps keyword flow and generates a grounded draft", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem(
      "a-blog-allinone:access-session",
      JSON.stringify({
        code: "MGO-TEST7",
        label: "7일 테스트",
        expiresAt: "2026-06-30",
        verifiedAt: new Date().toISOString()
      })
    );
  });

  await page.goto("http://127.0.0.1:5173/one-click/naver", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "무엇에 대한 글인가요?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "메인 키워드" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "서브 키워드" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "기억나는 내용" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "사진 추가" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "고급 옵션" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "블로그 초안 만들기" })).toBeVisible();
  await expect(page.getByText("비워두면 글 주제와 메모에서 중심 키워드를 자동으로 추출합니다.")).toBeVisible();
  await expect(page.getByText("최대 3개까지 쉼표로 나눠 입력하세요.")).toBeVisible();

  await page
    .getByPlaceholder("예: 제품 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기")
    .fill("라온비 커피랩 방문 후기");
  await page.getByPlaceholder("예: 상호명 / 상품명 / 강의명 / 장소명").fill("연남동 카페");
  await page.getByPlaceholder("예: 지역 키워드, 대표 특징, 이용 상황").fill("디저트, 창가 자리");
  await page.getByPlaceholder(/좋았던 점/).fill("주말에 들렀음\n커피 향이 기억남");

  await page.getByRole("button", { name: "블로그 초안 만들기" }).click();
  await expect(page.getByText("최종 추천 제목")).toBeVisible({ timeout: 15000 });

  const titleValue = await page.getByLabel("최종 추천 제목 직접 수정").inputValue();
  const bodyValue = await page.locator("textarea[rows='30']").inputValue();
  const resultText = `${titleValue}\n${bodyValue}\n${await page.locator("body").innerText()}`;
  expect(resultText).toContain("라온비 커피랩");
  expect(resultText).toContain("디저트");
  expect(resultText).not.toMatch(/사용자 메모|제공된 정보|확인 필요|본문에서/u);

  await page.screenshot({ path: ".codex-naver-ui-check.png", fullPage: true });
});
