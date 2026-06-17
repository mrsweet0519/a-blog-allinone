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
  advancedOptionsNoSponsorship: resolve(screenshotsDir, "naver-advanced-options-no-sponsorship.png"),
  targetLength: resolve(screenshotsDir, "naver-target-length-options.png"),
  keywordInput: resolve(screenshotsDir, "naver-keyword-input.png"),
  yukjjam: resolve(screenshotsDir, "naver-yukjjam-result.png"),
  titleCandidates: resolve(screenshotsDir, "naver-title-candidates.png"),
  faq: resolve(screenshotsDir, "naver-faq-result.png"),
  regenerateButton: resolve(screenshotsDir, "naver-regenerate-button.png"),
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
  /인생맛집|역대급|효과\s*보장|가격\s*미쳤다|협찬이지만\s*솔직히|내돈내산처럼|무조건\s*추천|완전\s*대박|100%\s*해결|즉시효과|완치|글의\s*중심이\s*분명해집니다|구체적으로\s*보완|글이\s*더\s*살아납니다|글이\s*더\s*구체적으로|작성하면\s*좋습니다|확인할\s*부분으로\s*남겨두는\s*편|확인할\s*부분|확인되지\s*않은\s*정보는|단정하지\s*않는\s*편|후기를\s*함께\s*보는\s*편|방문\s*전\s*확인할\s*항목|안전해요|실제\s*후기를\s*함께|맛집\s*후기답게|본문에서|메모|제공된\s*정보|사진과\s*함께\s*보완|정보가\s*없다면|직원\s*응대가\s*좋|직원\s*친절|주차가\s*편(?:했|한|해)|주차\s*편|다시\s*가고\s*싶|웨이팅\s*없|예약\s*가능|영업시간\s*(?:은|:)\s*\d/u;

const goToNaverMaker = async (page) => {
  await page.goto(`${origin}/one-click/naver`, { waitUntil: "networkidle" });
};

const fillAndGenerate = async (page, topic, memo, { keywords = "", targetCharCount = "" } = {}) => {
  await page
    .getByPlaceholder("예: 제품 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기")
    .fill(topic);
  if (keywords) {
    await page
      .getByPlaceholder("예: 상호명 / 지역명 맛집 / 대표 메뉴")
      .fill(keywords);
  }
  await page
    .getByPlaceholder("좋았던 점, 아쉬웠던 점, 아이 반응, 재방문 의사처럼 기억나는 말만 적어주세요.")
    .fill(memo);
  if (targetCharCount) {
    const advancedOptions = page.locator("details").filter({ hasText: "고급 옵션" }).first();
    await advancedOptions.locator("summary").click();
  }
  if (targetCharCount) {
    await page.getByLabel("목표 글자수").fill(String(targetCharCount));
  }
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
  await page
    .getByPlaceholder("예: 제품 후기 / 매장 방문 후기 / 아이와 다녀온 체험 후기")
    .fill("육짬 강화도본점 맛집 후기");
  await page
    .getByPlaceholder("예: 상호명 / 지역명 맛집 / 대표 메뉴")
    .fill("육짬, 강화도맛집");
  results.keywordInput = {
    visible: await page.getByLabel("메인 키워드").isVisible(),
    value: await page.getByLabel("메인 키워드").inputValue()
  };
  await page.screenshot({ path: screenshotPaths.keywordInput, fullPage: true });

  await goToNaverMaker(page);
  const advancedOptions = page.locator("details").filter({ hasText: "고급 옵션" }).first();
  await advancedOptions.locator("summary").click();
  await page.getByLabel("목표 글자수").fill("2500");
  results.targetLength = {
    selectedTargetLength: await page.getByLabel("목표 글자수").inputValue(),
    visible: await page.getByLabel("목표 글자수").isVisible(),
    sponsorshipVisibleCount: await page.getByText("협찬 여부").count()
  };
  await page.screenshot({ path: screenshotPaths.advancedOptionsNoSponsorship, fullPage: true });
  await page.screenshot({ path: screenshotPaths.targetLength, fullPage: true });

  await goToNaverMaker(page);
  await fillAndGenerate(
    page,
    "육짬 강화도본점 맛집 후기",
    "강화도 가족여행중 다녀와서 좋았음\n갈낙짬뽕이 궁금했음",
    {
      keywords: "강화도맛집",
      targetCharCount: 2500
    }
  );
  results.yukjjam = await readResult(page, screenshotPaths.yukjjam);
  await page.getByText("제목 더보기").click();
  results.titleCandidates = {
    visible: await page.getByText("제목 더보기").isVisible(),
    galnakCount: await page.getByText("갈낙짬뽕").count()
  };
  await page.screenshot({ path: screenshotPaths.titleCandidates, fullPage: true });
  await page.getByText("FAQ").scrollIntoViewIfNeeded();
  results.faq = {
    visible: await page.getByText("FAQ").isVisible(),
    galnakVisibleCount: await page.getByText("갈낙짬뽕").count()
  };
  await page.screenshot({ path: screenshotPaths.faq, fullPage: true });
  await page
    .getByPlaceholder("좋았던 점, 아쉬웠던 점, 아이 반응, 재방문 의사처럼 기억나는 말만 적어주세요.")
    .fill("강화도 가족여행중 다녀와서 좋았음\n아이랑 먹기 편한지도 다시 보고 싶음");
  results.regenerateButton = {
    text: await page.getByRole("button", { name: /변경 내용으로 다시 만들기/u }).textContent()
  };
  await page.screenshot({ path: screenshotPaths.regenerateButton, fullPage: true });

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
