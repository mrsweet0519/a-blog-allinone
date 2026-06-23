import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const DIAGNOSTIC_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 1_600_000;
const DEFAULT_PROJECT_NAME = "a-blog-allinone";
const DEFAULT_PREVIEW_BRANCH = "canary/fact-grounded-blog-writer";
const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_MAX_BUFFER = 10 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const SUPPORTED_IMAGE_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

const text = (value) => String(value ?? "").trim();
const quoteCmdArg = (value = "") => {
  const raw = String(value);
  if (!/[ \t&()^|<>"]/u.test(raw)) return raw;
  return `"${raw.replace(/"/gu, '\\"')}"`;
};

const resolveCommand = (name, args = []) => {
  if (process.platform === "win32" && name === "npx") {
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", ["npx.cmd", ...args].map(quoteCmdArg).join(" ")]
    };
  }
  return { file: name, args };
};

const runCommand = async (name, args = [], options = {}) => {
  const command = resolveCommand(name, args);
  try {
    const result = await execFileAsync(command.file, command.args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: COMMAND_MAX_BUFFER,
      windowsHide: true,
      ...options
    });
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || ""
    };
  } catch (error) {
    const stdout = error.stdout || "";
    const stderr = error.stderr || "";
    const combined = `${stdout}\n${stderr}`.trim();
    const message = combined || error.message || "command failed";
    const wrapped = new Error(message);
    wrapped.stdout = stdout;
    wrapped.stderr = stderr;
    wrapped.code = error.code;
    throw wrapped;
  }
};

const runWrangler = (args = []) => runCommand("npx", ["wrangler", ...args]);

const assertWranglerAuthenticated = async () => {
  try {
    const result = await runWrangler(["whoami"]);
    const output = `${result.stdout}\n${result.stderr}`;
    if (/not authenticated|wrangler login/iu.test(output)) {
      throw new Error("Wrangler is not authenticated. Run: npx.cmd wrangler login");
    }
    return output;
  } catch (error) {
    if (/not authenticated|wrangler login/iu.test(error.message)) {
      throw new Error("Wrangler is not authenticated. Run: npx.cmd wrangler login");
    }
    throw error;
  }
};

const getCurrentGitSource = async () => {
  try {
    const result = await runCommand("git", ["rev-parse", "--short=7", "HEAD"]);
    return text(result.stdout);
  } catch {
    return "";
  }
};

const listPreviewDeployments = async (projectName = DEFAULT_PROJECT_NAME) => {
  const result = await runWrangler([
    "pages",
    "deployment",
    "list",
    "--project-name",
    projectName,
    "--environment",
    "preview",
    "--json"
  ]);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not parse Wrangler deployment JSON: ${error.message}`);
  }
};

const selectLatestPreviewDeployment = (deployments = [], { branch = DEFAULT_PREVIEW_BRANCH, source = "" } = {}) => {
  const matches = deployments.filter((deployment) =>
    text(deployment.Branch) === branch &&
    text(deployment.Deployment)
  );
  if (!matches.length) {
    throw new Error(`No preview deployment found for branch ${branch}.`);
  }
  return matches.find((deployment) => source && text(deployment.Source) === source) || matches[0];
};

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
          note: "Diagnostic image sample. Check only visible facts.",
          mediaType: image.mediaType,
          size: image.size,
          dataUrl: image.dataUrl
        }
      ]
    : [];

  return {
    productName: "Daily note workflow tool",
    mainKeyword: "daily note workflow",
    subKeywords: "recording method, reminder setup, data organization",
    experienceMemo: "I am checking how a first-time user would compare note entry, reminder setup, and data organization.",
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
    llmEnabled: typeof llm.enabled === "boolean" ? llm.enabled : null,
    judgeEnabled: typeof llm.judgeEnabled === "boolean" ? llm.judgeEnabled : null,
    revisionEnabled: typeof llm.revisionEnabled === "boolean" ? llm.revisionEnabled : null,
    visionEnabled: typeof llm.visionEnabled === "boolean" ? llm.visionEnabled : null,
    keyPresent: typeof llm.keyPresent === "boolean" ? llm.keyPresent : null,
    model: llm.model || null,
    llmUsed: Boolean(llm.used),
    llmReason: llm.reason || null,
    llmStatus: llm.status === 0 ? null : llm.status ?? null,
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
  `llm.enabled: ${summary.llmEnabled === null ? "unknown" : summary.llmEnabled}`,
  `llm.judgeEnabled: ${summary.judgeEnabled === null ? "unknown" : summary.judgeEnabled}`,
  `llm.revisionEnabled: ${summary.revisionEnabled === null ? "unknown" : summary.revisionEnabled}`,
  `llm.visionEnabled: ${summary.visionEnabled === null ? "unknown" : summary.visionEnabled}`,
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

export const runAutoDiagnostics = async ({
  projectName = DEFAULT_PROJECT_NAME,
  branch = DEFAULT_PREVIEW_BRANCH,
  imagePath = ""
} = {}) => {
  await assertWranglerAuthenticated();
  const deployments = await listPreviewDeployments(projectName);
  const source = await getCurrentGitSource();
  const deployment = selectLatestPreviewDeployment(deployments, { branch, source });
  const summary = await runDiagnostics({
    previewUrl: deployment.Deployment,
    imagePath
  });
  return {
    projectName,
    branch,
    source,
    deployment,
    summary
  };
};

export const formatAutoDiagnosticSummary = ({ projectName = DEFAULT_PROJECT_NAME, branch = DEFAULT_PREVIEW_BRANCH, source = "", deployment = {}, summary = {} } = {}) =>
  [
    "=== Blog Writer Preview Auto Discovery ===",
    `project: ${projectName}`,
    `branch: ${branch}`,
    `localSource: ${source || "unknown"}`,
    `deploymentSource: ${deployment.Source || "unknown"}`,
    `deploymentId: ${deployment.Id || "unknown"}`,
    `previewUrl: ${deployment.Deployment || "unknown"}`,
    "",
    formatDiagnosticSummary(summary)
  ].join("\n");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.auto) {
    const autoResult = await runAutoDiagnostics({
      projectName: args.project || DEFAULT_PROJECT_NAME,
      branch: args.branch || DEFAULT_PREVIEW_BRANCH,
      imagePath: args.image || ""
    });
    console.log(formatAutoDiagnosticSummary(autoResult));
    process.exitCode = autoResult.summary.pass ? 0 : 1;
    return;
  }

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
