import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

const DIAGNOSTIC_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 1_600_000;
const SUPPORTED_IMAGE_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

const text = (value) => String(value ?? "").trim();

export const parseArgs = (argv = []) =>
  argv.reduce((acc, item) => {
    if (!item.startsWith("--")) return acc;
    const [key, ...rest] = item.slice(2).split("=");
    acc[key] = rest.length > 0 ? rest.join("=") : "1";
    return acc;
  }, {});

export const normalizePreviewUrl = (value = "") => {
  const raw = text(value);
  if (!raw) throw new Error("Missing preview URL. Use --url=<PREVIEW_URL> or BLOG_PREVIEW_URL.");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Preview URL must start with http:// or https://.");
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
};

export const buildGenerateBlogUrl = (previewUrl = "") => `${normalizePreviewUrl(previewUrl)}/api/generate-blog`;

export const buildDiagnosticPayload = ({ image = null } = {}) => {
  const imageContext = image
    ? [
        {
          index: 1,
          name: image.name,
          source: "diagnostic",
          note: "진단용 이미지입니다. 보이는 사실만 확인합니다.",
          mediaType: image.mediaType,
          size: image.size,
          dataUrl: image.dataUrl
        }
      ]
    : [];

  return {
    productName: "새로운 생활 기록 도구 정보 점검",
    mainKeyword: "생활 기록 도구",
    subKeywords: "기록 방식, 알림 설정, 데이터 정리",
    experienceMemo: "처음 알아보는 중\n기록 방식이 궁금함\n알림 설정과 데이터 정리 기준을 비교하고 싶음",
    category: "information",
    targetCharCount: 1800,
    imageContext,
    images: imageContext,
    photoMetadata: imageContext,
    imageCount: imageContext.length
  };
};

export const readDiagnosticImage = async (imagePath = "") => {
  const resolvedPath = text(imagePath);
  if (!resolvedPath) return null;

  const mediaType = SUPPORTED_IMAGE_TYPES.get(extname(resolvedPath).toLowerCase());
  if (!mediaType) throw new Error("Only JPEG, PNG, and WebP images are supported.");

  const fileStat = await stat(resolvedPath);
  if (fileStat.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large for diagnostics. Limit: ${MAX_IMAGE_BYTES} bytes.`);
  }

  const buffer = await readFile(resolvedPath);
  return {
    name: basename(resolvedPath),
    mediaType,
    size: buffer.length,
    dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`
  };
};

const fetchJson = async (url, payload) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIAGNOSTIC_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
};

export const summarizeDiagnosticResponse = ({ url = "", status = 0, json = {}, imageExpected = false } = {}) => {
  const packageData = json.contentPackage || {};
  const trace = json.trace || packageData.trace || {};
  const llm = json.llm || {};
  const vision = json.vision || {};
  const imageAnalysis = json.imageAnalysis || packageData.imageAnalysis || {};
  const qualityScore = json.qualityScore ?? packageData.qualityScore ?? packageData.summary?.qualityScore ?? null;
  const qualityAttempts = json.qualityAttempts ?? packageData.qualityAttempts ?? 0;
  const visionMode = vision.mode || trace.visionMode || imageAnalysis.mode || "none";
  const summary = {
    url,
    status,
    engine: json.engine || packageData.engine || trace.engine || "unknown",
    judgeEngine: json.judgeEngine || packageData.judgeEngine || trace.judgeEngine || "unknown",
    isMock: Boolean(json.isMock ?? packageData.isMock ?? trace.isMock),
    visionMode,
    keyPresent: typeof llm.keyPresent === "boolean" ? llm.keyPresent : null,
    model: llm.model || null,
    llmUsed: Boolean(llm.used),
    llmReason: llm.reason || null,
    llmStatus: llm.status ?? null,
    qualityScore,
    publishReady: Boolean(json.publishReady ?? packageData.publishReady),
    qualityAttempts,
    imageCount: vision.imageCount ?? json.imageCount ?? 0,
    visibleElementsCount: vision.visibleElementsCount ?? imageAnalysis.visuallySupported?.length ?? 0,
    imageExpected
  };

  return {
    ...summary,
    pass: summary.engine === "llm" && (!imageExpected || summary.visionMode === "vision")
  };
};

export const formatDiagnosticSummary = (summary = {}) => [
  "=== Blog Writer Preview Diagnostics ===",
  `URL: ${summary.url}`,
  `HTTP status: ${summary.status}`,
  `engine: ${summary.engine}`,
  `judgeEngine: ${summary.judgeEngine}`,
  `isMock: ${summary.isMock}`,
  `visionMode: ${summary.visionMode}`,
  `keyPresent: ${summary.keyPresent === null ? "unknown" : summary.keyPresent}`,
  `model: ${summary.model || "unknown"}`,
  `llm.used: ${summary.llmUsed}`,
  `llm.reason: ${summary.llmReason || "none"}`,
  `llm.status: ${summary.llmStatus ?? "none"}`,
  `qualityScore: ${summary.qualityScore ?? "unknown"}`,
  `publishReady: ${summary.publishReady}`,
  `qualityAttempts: ${summary.qualityAttempts}`,
  `imageCount: ${summary.imageCount}`,
  `visibleElementsCount: ${summary.visibleElementsCount}`,
  `result: ${summary.pass ? "PASS" : "FAIL"}`
].join("\n");

export const runDiagnostics = async ({ previewUrl = "", imagePath = "" } = {}) => {
  const url = buildGenerateBlogUrl(previewUrl);
  const image = await readDiagnosticImage(imagePath);
  const payload = buildDiagnosticPayload({ image });
  const { status, json } = await fetchJson(url, payload);
  return summarizeDiagnosticResponse({
    url,
    status,
    json,
    imageExpected: Boolean(image)
  });
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const previewUrl = args.url || process.env.BLOG_PREVIEW_URL || "";
  const imagePath = args.image || "";
  const summary = await runDiagnostics({ previewUrl, imagePath });
  console.log(formatDiagnosticSummary(summary));
  process.exitCode = summary.pass ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`diagnostic-error: ${error.message}`);
    process.exitCode = 1;
  });
}
