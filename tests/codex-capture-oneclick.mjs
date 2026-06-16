import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { accessCodes } from "../frontend/src/data/accessCodes.js";

export const origin = "http://127.0.0.1:4173";
export const screenshotsDir = resolve("screenshots");

const distRoot = resolve("frontend", "dist");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

export const screenshotPaths = {
  targetLength: resolve(screenshotsDir, "naver-target-length-options.png"),
  yukjjam: resolve(screenshotsDir, "naver-yukjjam-result.png"),
  dryShampoo: resolve(screenshotsDir, "naver-dryshampoo-result.png"),
  customsLecture: resolve(screenshotsDir, "naver-customs-lecture-result.png"),
  photoPreview: resolve(screenshotsDir, "naver-photo-inline-preview.png")
};

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

export const startStaticServer = () =>
  new Promise((resolveServer) => {
    const server = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url || "/", origin);
        const requestedPath = resolve(distRoot, `.${decodeURIComponent(requestUrl.pathname)}`);
        const targetPath = requestedPath.startsWith(distRoot) ? requestedPath : join(distRoot, "index.html");
        const filePath = existsSync(targetPath) && (await stat(targetPath)).isFile()
          ? targetPath
          : join(distRoot, "index.html");

        response.writeHead(200, {
          "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
        });
        createReadStream(filePath).pipe(response);
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error.message);
      }
    });

    server.listen(4173, "127.0.0.1", () => resolveServer(server));
  });

const createAccessSession = () => ({
  code: validAccessCode.code,
  label: validAccessCode.label,
  expiresAt: validAccessCode.expiresAt,
  verifiedAt: new Date().toISOString()
});

const splitFirstSentences = (body = "") =>
  body
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?요다])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 5);

const hardForbiddenPattern =
  /인생맛집|역대급|효과\s*보장|가격\s*미쳤다|협찬이지만\s*솔직히|내돈내산처럼|무조건\s*추천|완전\s*대박|100%\s*해결|즉시효과|완치/u;

const goToNaverMaker = async (page) => {
  await page.goto(`${origin}/one-click/naver`, { waitUntil: "networkidle" });
};

const fillAndGenerate = async (page, topic, memo) => {
  await page
    .getByPlaceholder("예: 제품 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기")
    .fill(topic);
  await page
    .getByPlaceholder("좋았던 점, 아쉬웠던 점, 아이 반응, 재방문 의사처럼 기억나는 말만 적어주세요.")
    .fill(memo);
  await page.getByRole("button", { name: "블로그 초안 만들기" }).click();
  await page.getByText("최종 추천 제목").waitFor({ state: "visible" });
};

const readResult = async (page, screenshotPath) => {
  const finalTitle = await page
    .locator("section")
    .filter({ hasText: "최종 추천 제목" })
    .locator("input")
    .first()
    .inputValue();
  const body = await page
    .locator("section")
    .filter({ hasText: "블로그 본문" })
    .locator("textarea")
    .first()
    .inputValue();
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    finalTitle,
    firstFiveSentences: splitFirstSentences(body),
    bodyLength: body.replace(/\s+/g, "").length,
    forbiddenMixed: hardForbiddenPattern.test(`${finalTitle}\n${body}`)
  };
};

export const runOneClickCapture = async (page) => {
  await mkdir(screenshotsDir, { recursive: true });

  const results = {};

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.evaluate((session) => {
    localStorage.setItem("a-blog-allinone:access-session", JSON.stringify(session));
  }, createAccessSession());

  await goToNaverMaker(page);
  const advancedOptions = page.locator("details").filter({ hasText: "고급 옵션" }).first();
  await advancedOptions.locator("summary").click();
  await page.getByLabel("목표 글자수").selectOption("short");
  results.targetLength = {
    selectedTargetLength: await page.getByLabel("목표 글자수").inputValue(),
    visible: await page.getByLabel("목표 글자수").isVisible()
  };
  await page.screenshot({ path: screenshotPaths.targetLength, fullPage: true });

  await goToNaverMaker(page);
  await fillAndGenerate(page, "육짬 강화도본점 맛집후기", "갈낙짬뽕이 유명한 곳");
  results.yukjjam = await readResult(page, screenshotPaths.yukjjam);

  await goToNaverMaker(page);
  await fillAndGenerate(
    page,
    "에어젤 드라이샴푸 후기",
    "운동 후 사용\n앞머리와 정수리 보송\n휴대 편함\n향 무난함\n완전히 샴푸한 느낌은 아니지만 급할 때 좋았음"
  );
  results.dryShampoo = await readResult(page, screenshotPaths.dryShampoo);

  await goToNaverMaker(page);
  await fillAndGenerate(
    page,
    "세관공매 무료공개강의 후기",
    "초보자도 이해하기 쉬웠음\n커리큘럼을 미리 확인할 수 있었음\n입찰 흐름이 궁금했음\n강의 듣고 전체 흐름을 잡는 데 도움 됐음"
  );
  results.customsLecture = await readResult(page, screenshotPaths.customsLecture);

  const uploadImagePath = resolve("test-results", "codex-upload-sample.png");
  await mkdir(resolve("test-results"), { recursive: true });
  await writeFile(
    uploadImagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAVUlEQVR4nO3PQQ0AIBDAMMC/58MCP7KkVbDtmXnS9wLYmQPgY8AB8DBgADwMGAAPAwbAw4AB8DBgADwMGAAPAwbAw4AB8DBgADwMGAAPAwbAw4AB8DBgADwMGAAvHHwBpUjH5+YAAAAASUVORK5CYII=",
      "base64"
    )
  );
  await goToNaverMaker(page);
  await page.locator('input[type="file"]').setInputFiles(uploadImagePath);
  await fillAndGenerate(
    page,
    "에어젤 드라이샴푸 후기",
    "운동 후 사용\n앞머리와 정수리 보송\n휴대 편함\n향 무난함"
  );
  await page.getByTestId("inline-photo-preview").first().waitFor({ state: "visible" });
  results.photoPreview = {
    ...(await readResult(page, screenshotPaths.photoPreview)),
    inlinePhotoPreviewCount: await page.getByTestId("inline-photo-preview").count(),
    bodyPreviewVisible: await page.getByTestId("naver-body-preview").isVisible()
  };

  return {
    screenshots: screenshotPaths,
    results
  };
};
