import { createServer } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./diagnose-blog-preview.mjs";
import { COMMERCIAL_EXPORT_DIR } from "./diagnose-commercial-readiness.mjs";

const text = (value) => String(value ?? "").trim();
const csvCell = (value = "") => `"${String(value ?? "").replace(/"/gu, '""')}"`;
const toCsvLine = (values = []) => values.map(csvCell).join(",");

const REVIEW_HEADERS = [
  "reviewerId",
  "caseId",
  "titleUsableYN",
  "openingNatural1to5",
  "humanLike1to5",
  "factReflection1to5",
  "inventedExperienceYN",
  "sectionNewInfo1to5",
  "photoConnection1to5OrNA",
  "publishWithin3MinYN",
  "reuseIntent1to5",
  "needsFix",
  "submittedAt"
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const findLatestExportDir = async (root = COMMERCIAL_EXPORT_DIR) => {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    const info = await stat(path);
    dirs.push({ path, mtimeMs: info.mtimeMs });
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!dirs.length) throw new Error(`No commercial readiness export found in ${root}. Run npm.cmd run diagnose:commercial -- --cases=8 --export first.`);
  return dirs[0].path;
};

const loadBlindCases = async (exportDir = "") => {
  const blindDir = join(exportDir, "blind");
  const files = (await readdir(blindDir)).filter((name) => name.endsWith(".json")).sort();
  const cases = [];
  for (const file of files) {
    const content = JSON.parse(await readFile(join(blindDir, file), "utf8"));
    cases.push(content);
  }
  return cases;
};

const reviewToCsv = (reviews = []) => [
  toCsvLine(REVIEW_HEADERS),
  ...reviews.map((review) => toCsvLine(REVIEW_HEADERS.map((key) => review[key] ?? "")))
].join("\n");

const readJsonIfExists = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

const saveReviews = async ({ exportDir = "", reviews = [] } = {}) => {
  await mkdir(exportDir, { recursive: true });
  const jsonPath = join(exportDir, "human-review.json");
  const csvPath = join(exportDir, "human-review.csv");
  await writeFile(jsonPath, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");
  await writeFile(csvPath, `${reviewToCsv(reviews)}\n`, "utf8");
  return { jsonPath, csvPath };
};

const response = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
};

const readRequestBody = (req) =>
  new Promise((resolveRequest, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolveRequest(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Commercial Blind Review</title>
  <style>
    :root { color-scheme: light; font-family: Arial, "Noto Sans KR", sans-serif; }
    body { margin: 0; background: #f7f7f5; color: #1d1d1f; }
    header { position: sticky; top: 0; background: #ffffff; border-bottom: 1px solid #deded8; padding: 12px 20px; z-index: 2; }
    main { max-width: 1040px; margin: 0 auto; padding: 20px; display: grid; gap: 18px; }
    section { background: #fff; border: 1px solid #deded8; border-radius: 8px; padding: 18px; }
    h1 { font-size: 20px; margin: 0; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    button, select, input, textarea { font: inherit; }
    button { border: 1px solid #b8b8b0; background: #fff; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    button.primary { background: #1d4f3a; border-color: #1d4f3a; color: #fff; }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .field { display: grid; gap: 6px; }
    .body { white-space: pre-wrap; line-height: 1.7; }
    .muted { color: #696963; font-size: 13px; }
    img { max-width: 100%; max-height: 360px; object-fit: contain; border: 1px solid #deded8; border-radius: 6px; background: #fafafa; }
    details { border: 1px solid #deded8; border-radius: 6px; padding: 10px 12px; }
    textarea { min-height: 90px; resize: vertical; }
  </style>
</head>
<body>
  <header>
    <div class="toolbar">
      <h1>Commercial Blind Review</h1>
      <span id="progress" class="muted"></span>
      <button id="prev">이전</button>
      <button id="next">다음</button>
      <button id="save" class="primary">저장</button>
    </div>
  </header>
  <main>
    <section>
      <h2 id="caseTitle"></h2>
      <div id="inputSummary" class="muted"></div>
    </section>
    <section>
      <h2>최종 제목</h2>
      <p id="finalTitle"></p>
      <details>
        <summary>제목 후보 펼치기</summary>
        <ol id="titleCandidates"></ol>
      </details>
    </section>
    <section>
      <h2>사진</h2>
      <div id="images" class="grid"></div>
    </section>
    <section>
      <h2>본문</h2>
      <div id="body" class="body"></div>
    </section>
    <section>
      <h2>FAQ</h2>
      <div id="faq"></div>
    </section>
    <section>
      <h2>평가</h2>
      <div class="grid" id="form"></div>
    </section>
  </main>
  <script>
    const fields = [
      ["titleUsableYN", "제목을 그대로 사용할 수 있는가?", ["Y", "N"]],
      ["openingNatural1to5", "첫 문단이 자연스러운가?", ["1", "2", "3", "4", "5"]],
      ["humanLike1to5", "사람이 작성한 글처럼 읽히는가?", ["1", "2", "3", "4", "5"]],
      ["factReflection1to5", "사용자 입력 사실이 잘 반영됐는가?", ["1", "2", "3", "4", "5"]],
      ["inventedExperienceYN", "입력하지 않은 경험이 추가됐는가?", ["N", "Y"]],
      ["sectionNewInfo1to5", "소제목마다 새로운 정보가 있는가?", ["1", "2", "3", "4", "5"]],
      ["photoConnection1to5OrNA", "사진과 글이 자연스럽게 연결되는가?", ["N/A", "1", "2", "3", "4", "5"]],
      ["publishWithin3MinYN", "3분 안에 수정 후 발행 가능한가?", ["Y", "N"]],
      ["reuseIntent1to5", "돈을 내고 다시 사용할 의향이 있는가?", ["1", "2", "3", "4", "5"]]
    ];
    let cases = [];
    let reviews = [];
    let current = 0;

    const qs = (id) => document.getElementById(id);
    const valueFor = (caseId, key) => (reviews.find((item) => item.caseId === caseId) || {})[key] || "";
    const upsertReview = (caseId, patch) => {
      let review = reviews.find((item) => item.caseId === caseId);
      if (!review) {
        review = { reviewerId: localStorage.getItem("commercialReviewerId") || "reviewer-1", caseId };
        reviews.push(review);
      }
      Object.assign(review, patch, { submittedAt: new Date().toISOString() });
    };

    const renderForm = (item) => {
      const root = qs("form");
      root.innerHTML = "";
      fields.forEach(([key, label, options]) => {
        const div = document.createElement("label");
        div.className = "field";
        div.textContent = label;
        const select = document.createElement("select");
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "선택";
        select.appendChild(blank);
        options.forEach((option) => {
          const el = document.createElement("option");
          el.value = option;
          el.textContent = option;
          select.appendChild(el);
        });
        select.value = valueFor(item.caseId, key);
        select.addEventListener("change", () => upsertReview(item.caseId, { [key]: select.value }));
        div.appendChild(select);
        root.appendChild(div);
      });
      const memo = document.createElement("label");
      memo.className = "field";
      memo.textContent = "수정이 필요한 부분";
      const textarea = document.createElement("textarea");
      textarea.value = valueFor(item.caseId, "needsFix");
      textarea.addEventListener("input", () => upsertReview(item.caseId, { needsFix: textarea.value }));
      memo.appendChild(textarea);
      root.appendChild(memo);
    };

    const render = () => {
      const item = cases[current];
      if (!item) return;
      qs("progress").textContent = (current + 1) + " / " + cases.length;
      qs("caseTitle").textContent = item.caseId;
      qs("inputSummary").textContent = [item.inputSummary.category, item.inputSummary.productName, item.inputSummary.mainKeyword, item.inputSummary.targetCharCount + "자"].join(" · ");
      qs("finalTitle").textContent = item.finalTitle || "";
      qs("titleCandidates").innerHTML = (item.titleCandidates || []).map((title) => "<li>" + title + "</li>").join("");
      qs("images").innerHTML = (item.images || []).length ? item.images.map((image) => '<div><img src="/asset/' + image.path + '" alt=""><p class="muted">' + (image.note || "") + '</p></div>').join("") : '<p class="muted">N/A</p>';
      qs("body").textContent = item.body || "";
      qs("faq").innerHTML = (item.faq || []).length ? item.faq.map((faq) => "<p><b>Q.</b> " + faq.question + "<br><b>A.</b> " + faq.answer + "</p>").join("") : '<p class="muted">N/A</p>';
      renderForm(item);
    };

    const save = async () => {
      if (cases[current]) upsertReview(cases[current].caseId, {});
      const res = await fetch("/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reviews }) });
      if (!res.ok) alert("저장 실패");
    };

    qs("prev").onclick = () => { current = Math.max(0, current - 1); render(); };
    qs("next").onclick = async () => { await save(); current = Math.min(cases.length - 1, current + 1); render(); };
    qs("save").onclick = save;

    fetch("/data").then((res) => res.json()).then((data) => {
      cases = data.cases || [];
      reviews = data.reviews || [];
      render();
    });
  </script>
</body>
</html>`;

export const startCommercialReviewServer = async ({ dir = "", port = 4177, host = "127.0.0.1", checkOnly = false } = {}) => {
  const exportDir = resolve(dir || await findLatestExportDir());
  const cases = await loadBlindCases(exportDir);
  if (!cases.length) throw new Error(`No blind review cases found in ${exportDir}.`);
  const existingReviews = await readJsonIfExists(join(exportDir, "human-review.json"), []);

  if (checkOnly) {
    return {
      exportDir,
      caseCount: cases.length,
      existingReviewCount: existingReviews.length,
      status: "OK"
    };
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`);
      if (req.method === "GET" && url.pathname === "/") {
        response(res, 200, html, { "content-type": "text/html; charset=utf-8" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/data") {
        const reviews = await readJsonIfExists(join(exportDir, "human-review.json"), []);
        response(res, 200, JSON.stringify({ cases, reviews }), { "content-type": "application/json; charset=utf-8" });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/asset/")) {
        const relative = decodeURIComponent(url.pathname.replace(/^\/asset\//u, ""));
        const assetPath = resolve(join(exportDir, "blind", relative));
        if (!assetPath.startsWith(resolve(join(exportDir, "blind")))) {
          response(res, 403, "Forbidden");
          return;
        }
        const type = mimeTypes[extname(assetPath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
        createReadStream(assetPath).pipe(res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/review") {
        const body = JSON.parse(await readRequestBody(req));
        const reviews = Array.isArray(body.reviews) ? body.reviews : [];
        await saveReviews({ exportDir, reviews });
        response(res, 200, JSON.stringify({ ok: true }), { "content-type": "application/json; charset=utf-8" });
        return;
      }
      response(res, 404, "Not found");
    } catch (error) {
      response(res, 500, error.message || "review server error");
    }
  });

  await new Promise((resolveServer) => server.listen(port, host, resolveServer));
  return {
    exportDir,
    caseCount: cases.length,
    url: `http://${host}:${port}`,
    server
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || process.env.COMMERCIAL_REVIEW_PORT || 4177) || 4177;
  const dir = text(args.dir);
  const checkOnly = Boolean(args.check);
  const result = await startCommercialReviewServer({ dir, port, checkOnly });
  const { server, ...printable } = result;
  console.log(JSON.stringify(printable, null, 2));
  if (!server) return;
  console.log(`Open ${result.url} to review. Press Ctrl+C to stop.`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`commercial-review-error: ${error.message}`);
    process.exitCode = 1;
  });
}
