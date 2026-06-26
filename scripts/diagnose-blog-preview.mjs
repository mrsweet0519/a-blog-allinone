import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 180_000;
const MAX_IMAGE_BYTES = 1_600_000;
export const DEFAULT_PROJECT_NAME = "a-blog-allinone";
export const DEFAULT_PREVIEW_BRANCH = "canary/fact-grounded-blog-writer";
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

export const selectLatestPreviewDeployment = (deployments = [], { branch = DEFAULT_PREVIEW_BRANCH, source = "" } = {}) => {
  const matches = deployments.filter((deployment) =>
    text(deployment.Branch) === branch &&
    text(deployment.Deployment)
  );
  if (!matches.length) {
    throw new Error(`No preview deployment found for branch ${branch}.`);
  }
  return matches.find((deployment) => source && text(deployment.Source) === source) || matches[0];
};

export const parseArgs = (argv = []) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    if (rest.length > 0) {
      args[key] = rest.join("=");
      continue;
    }
    const next = argv[index + 1] || "";
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
      continue;
    }
    args[key] = "1";
  }
  return args;
};

export const parseTimeoutMs = (value = "", fallback = DEFAULT_DIAGNOSTIC_TIMEOUT_MS) => {
  const raw = text(value);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--timeout-ms must be a positive number.");
  }
  return Math.trunc(parsed);
};

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

export const discoverLatestPreviewDeployment = async ({
  projectName = DEFAULT_PROJECT_NAME,
  branch = DEFAULT_PREVIEW_BRANCH
} = {}) => {
  await assertWranglerAuthenticated();
  const deployments = await listPreviewDeployments(projectName);
  const source = await getCurrentGitSource();
  const deployment = selectLatestPreviewDeployment(deployments, { branch, source });
  return {
    projectName,
    branch,
    source,
    deployment
  };
};

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

const isAbortError = (error) => error?.name === "AbortError" || error?.code === "ABORT_ERR";

export const formatDiagnosticAbortError = (error = {}) =>
  [
    "diagnostic-error: request aborted",
    `requestUrl: ${error.requestUrl || "unknown"}`,
    `elapsedMs: ${error.elapsedMs ?? "unknown"}`,
    `timeoutMs: ${error.timeoutMs ?? "unknown"}`,
    `abortStage: ${error.abortStage || "unknown"}`
  ].join("\n");

const createDiagnosticAbortError = ({ requestUrl = "", elapsedMs = 0, timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS, abortStage = "request", cause = null } = {}) => {
  const error = new Error("Preview diagnostic request aborted.");
  error.name = "AbortError";
  error.requestUrl = requestUrl;
  error.elapsedMs = elapsedMs;
  error.timeoutMs = timeoutMs;
  error.abortStage = abortStage;
  error.cause = cause;
  return error;
};

export const fetchDiagnosticJson = async (url, payload, { timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let abortStage = "request";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let json = null;
    try {
      abortStage = "response-json";
      json = await response.json();
    } catch (error) {
      if (isAbortError(error)) throw error;
      json = {};
    }
    return { status: response.status, json };
  } catch (error) {
    if (isAbortError(error)) {
      throw createDiagnosticAbortError({
        requestUrl: url,
        elapsedMs: Date.now() - startedAt,
        timeoutMs,
        abortStage,
        cause: error
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const uniqueTexts = (values = []) => {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const cleaned = text(value);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    result.push(cleaned);
  });
  return result;
};

const numericOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeIssueCode = (value = "") => {
  const cleaned = text(value);
  if (!cleaned) return "";
  const code = cleaned.includes(":") ? cleaned.split(":")[0] : cleaned;
  return code.trim().replace(/\s+/gu, "_").toUpperCase();
};

const collectIssueCodes = ({ humanQuality = {}, qualityIssues = [], claimLedgerSummary = {} } = {}) =>
  uniqueTexts([
    ...(Array.isArray(humanQuality.issues) ? humanQuality.issues.map((issue) => normalizeIssueCode(issue?.code)) : []),
    ...(Array.isArray(humanQuality.diagnostics?.issueCodes) ? humanQuality.diagnostics.issueCodes.map(normalizeIssueCode) : []),
    ...(Array.isArray(qualityIssues) ? qualityIssues.map(normalizeIssueCode) : []),
    ...((claimLedgerSummary.hardFailures || []).map((item) => `CLAIM_${normalizeIssueCode(item?.claimType)}`))
  ].filter(Boolean));

const countHighSeverityIssues = (humanQuality = {}) =>
  (Array.isArray(humanQuality.issues) ? humanQuality.issues : []).filter((issue) =>
    ["high", "critical"].includes(text(issue?.severity).toLowerCase())
  ).length;

const hasIssueCode = (codes = [], pattern = /$^/u) => codes.some((code) => pattern.test(code));

export const evaluateConnectionResult = (summary = {}) => {
  const reason = text(summary.llmReason).toLowerCase();
  const reasonOk = !reason || reason === "none" || reason === "llm-quality-rejected";
  return summary.status === 200 &&
    summary.engine === "llm" &&
    summary.judgeEngine === "llm" &&
    summary.isMock === false &&
    summary.keyPresent === true &&
    summary.llmUsed === true &&
    reasonOk
    ? "PASS"
    : "FAIL";
};

export const evaluateQualityResult = (summary = {}, { tested = true } = {}) => {
  if (!tested) return "NOT_TESTED";
  const issueCodes = summary.issueCodes || [];
  const noUnsupportedClaims =
    Number(summary.unsupportedClaimCount || 0) === 0 &&
    !hasIssueCode(issueCodes, /UNSUPPORTED|CONTRADICTORY/u);
  const noMetaGuidance =
    Number(summary.metaGuidanceCount || 0) === 0 &&
    !hasIssueCode(issueCodes, /META_GUIDANCE|PLACEHOLDER/u);
  const noJosaErrors = !hasIssueCode(issueCodes, /JOSA/u);
  const noCategoryContamination =
    Number(summary.categoryContaminationCount || 0) === 0 &&
    !hasIssueCode(issueCodes, /CATEGORY_CONTAMINATION/u);

  return Number(summary.qualityScore || 0) >= 95 &&
    summary.publishReady === true &&
    summary.hardFail === false &&
    Number(summary.highSeverityIssueCount || 0) === 0 &&
    noCategoryContamination &&
    noUnsupportedClaims &&
    summary.primaryEntityCoverage === true &&
    noMetaGuidance &&
    noJosaErrors
    ? "PASS"
    : "FAIL";
};

export const evaluateOverallResult = ({ connectionResult = "FAIL", qualityResult = "NOT_TESTED" } = {}) => {
  if (connectionResult !== "PASS") return "FAIL";
  return qualityResult === "PASS" ? "PASS" : "PARTIAL";
};

export const summarizeQualityInvestigation = (summary = {}) => ({
  rawWriterScore: summary.rawWriterScore ?? null,
  finalJudgeScore: summary.finalJudgeScore ?? null,
  appliedCaps: summary.appliedCaps || [],
  informationSufficiency: summary.informationSufficiency || "",
  resultMode: summary.resultMode || "",
  inputFactCoverage: summary.inputFactCoverage ?? null,
  genericFillerRatio: summary.genericFillerRatio ?? null,
  changedCharacterRatio: summary.changedCharacterRatio ?? null,
  topIssueCodes: (summary.issueCodes || []).slice(0, 5)
});

export const summarizeDiagnosticResponse = ({ url = "", status = 0, json = {}, imageExpected = false } = {}) => {
  const packageData = json.contentPackage || {};
  const trace = json.trace || packageData.trace || {};
  const llm = json.llm || {};
  const vision = json.vision || {};
  const imageAnalysis = json.imageAnalysis || packageData.imageAnalysis || {};
  const humanQuality = json.humanQuality || packageData.humanQuality || {};
  const humanDiagnostics = humanQuality.diagnostics || {};
  const claimLedgerSummary = json.claimLedgerSummary || packageData.claimLedgerSummary || {};
  const qualityIssues = json.qualityIssues || packageData.qualityIssues || [];
  const issueCodes = collectIssueCodes({ humanQuality, qualityIssues, claimLedgerSummary });
  const entityCoverage = humanDiagnostics.entityCoverage || {};
  const primaryEntityCoverage = Object.keys(entityCoverage).length > 0
    ? Boolean(entityCoverage.finalTitle && entityCoverage.openingSentence && entityCoverage.body)
    : null;
  const categoryContaminationCount = Array.isArray(humanDiagnostics.categoryContamination)
    ? humanDiagnostics.categoryContamination.length
    : 0;
  const claimCounts = claimLedgerSummary.counts || {};
  const unsupportedClaimCount =
    Number(claimCounts.unsupported || 0) +
    Number(claimCounts.contradictory || 0) +
    (claimLedgerSummary.hardFailures || []).filter((item) => ["unsupported", "contradictory"].includes(item?.claimType)).length;
  const metaGuidanceCount =
    Number(claimCounts.metaGuidance || 0) +
    Number(claimCounts.placeholder || 0) +
    (claimLedgerSummary.hardFailures || []).filter((item) => ["metaGuidance", "placeholder"].includes(item?.claimType)).length;
  const rawFinalDiff = json.diagnostics?.rawFinalDiff || packageData.diagnostics?.rawFinalDiff || {};
  const qualityDiagnostics = json.qualityDiagnostics || packageData.qualityDiagnostics || {};
  const llmStages = json.llmStages || packageData.llmStages || {};
  const targetLengthContract = packageData.targetLengthContract || {};
  const targetLengthDiagnostics = packageData.diagnostics?.targetLength || {};
  const schemaRepair = packageData.diagnostics?.schemaRepair || {};
  const responseExtraction = packageData.diagnostics?.responseExtraction || {};
  const groundedRepair = packageData.diagnostics?.groundedRepair || {};
  const inputFactCoverageDiagnostics =
    humanDiagnostics.inputFactCoverage ||
    groundedRepair.inputFactCoverage ||
    packageData.inputFactCoverage ||
    {};
  const userFactIds = Array.isArray(packageData.factMap?.userFacts)
    ? packageData.factMap.userFacts.map((fact) => text(fact?.id)).filter(Boolean)
    : [];
  const missingFactIds = Array.isArray(inputFactCoverageDiagnostics.missingFactIds)
    ? inputFactCoverageDiagnostics.missingFactIds.map(text).filter(Boolean)
    : [];
  const coveredFactIds = userFactIds.filter((id) => !missingFactIds.includes(id));
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
    informationSufficiency: packageData.informationSufficiency?.level || packageData.summary?.informationSufficiency || null,
    resultMode: json.resultMode || packageData.resultMode || packageData.summary?.resultMode || null,
    requestedTargetCharCount:
      numericOrNull(packageData.requestedTargetCharCount ?? packageData.targetLengthContract?.requestedTargetCharCount ?? packageData.summary?.requestedTargetCharCount),
    effectiveTargetCharCount:
      numericOrNull(packageData.effectiveTargetCharCount ?? targetLengthContract.effectiveTargetCharCount ?? targetLengthDiagnostics.effectiveTargetCharCount),
    actualCharCount:
      numericOrNull(json.actualBodyCharCount ?? packageData.actualBodyCharCount ?? packageData.actualCharCount ?? packageData.summary?.actualBodyCharCount),
    rawWriterCharCount: numericOrNull(targetLengthContract.rawWriterCharCount),
    finalCharCount: numericOrNull(targetLengthContract.finalCharCount ?? targetLengthContract.actualCharCount),
    targetComplianceRatio: numericOrNull(targetLengthContract.targetComplianceRatio),
    sectionBudgetTotal: numericOrNull(targetLengthContract.sectionBudgetTotal ?? targetLengthDiagnostics.sectionBudgetTotal),
    sectionActualTotal: numericOrNull(targetLengthContract.sectionActualTotal ?? targetLengthDiagnostics.sectionActualTotal),
    targetLengthFailureReason: targetLengthContract.targetLengthFailureReason || targetLengthDiagnostics.targetLengthFailureReason || "",
    finishReason: targetLengthContract.finishReason || llmStages.writer?.finishReason || "",
    postProcessingReductionRatio: numericOrNull(targetLengthContract.postProcessingReductionRatio),
    schemaRepairUsed: Boolean(schemaRepair.schemaRepairUsed),
    apiEndpoint: responseExtraction.apiEndpoint || "",
    responseShape: responseExtraction.responseShape || "unknown",
    textExtracted: typeof responseExtraction.textExtracted === "boolean" ? responseExtraction.textExtracted : null,
    extractedTextLength: numericOrNull(responseExtraction.extractedTextLength),
    extractedTextHash: responseExtraction.extractedTextHash || "",
    writerAttempts: numericOrNull(responseExtraction.writerAttempts),
    schemaFailureCount: numericOrNull(responseExtraction.schemaFailureCount),
    repairedFields: schemaRepair.repairedFields || [],
    inputFactCoverage:
      numericOrNull(inputFactCoverageDiagnostics.inputFactCoverage),
    totalUserFacts: userFactIds.length,
    coveredFactIds,
    missingFactIds,
    groundedRepairApplied: groundedRepair.applied || [],
    genericFillerRatio: numericOrNull(humanDiagnostics.genericFillerRatio),
    josaErrorCount: Array.isArray(humanDiagnostics.josaErrors) ? humanDiagnostics.josaErrors.length : 0,
    changedCharacterRatio: numericOrNull(rawFinalDiff.changedCharacterRatio),
    rawWriterScore: numericOrNull(json.rawQualityScore ?? packageData.rawQualityScore ?? packageData.summary?.rawQualityScore),
    finalJudgeScore: numericOrNull(humanQuality.llmJudgeScore ?? humanQuality.score ?? qualityScore),
    appliedCaps: uniqueTexts([
      ...(Array.isArray(humanQuality.caps) ? humanQuality.caps.map((cap) => cap?.code).filter(Boolean) : []),
      claimLedgerSummary.hardFail ? "CLAIM_LEDGER_HARD_FAIL" : ""
    ]),
    hardFail: Boolean(humanQuality.hardFail || claimLedgerSummary.hardFail),
    highSeverityIssueCount: countHighSeverityIssues(humanQuality),
    categoryContaminationCount,
    unsupportedClaimCount,
    metaGuidanceCount,
    primaryEntityCoverage,
    issueCodes,
    qualityDiagnostics,
    llmStages,
    qualityScore,
    publishReady: Boolean(json.publishReady ?? packageData.publishReady),
    qualityAttempts,
    imageCount: vision.imageCount ?? json.imageCount ?? 0,
    visibleElementsCount: vision.visibleElementsCount ?? imageAnalysis.visuallySupported?.length ?? 0,
    imageExpected
  };
  const connectionResult = evaluateConnectionResult(summary);
  const qualityResult = evaluateQualityResult(summary, { tested: false });

  return {
    ...summary,
    connectionResult,
    qualityResult,
    overallResult: evaluateOverallResult({ connectionResult, qualityResult }),
    pass: connectionResult === "PASS" && (!imageExpected || summary.visionMode === "vision")
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
  `observedQualityScore: ${summary.qualityScore ?? "unknown"}`,
  `observedPublishReady: ${summary.publishReady}`,
  `observedQualityAttempts: ${summary.qualityAttempts}`,
  `informationSufficiency: ${summary.informationSufficiency || "unknown"}`,
  `resultMode: ${summary.resultMode || "unknown"}`,
  `rawWriterScore: ${summary.rawWriterScore ?? "unknown"}`,
  `finalJudgeScore: ${summary.finalJudgeScore ?? "unknown"}`,
  `appliedCaps: ${(summary.appliedCaps || []).join(", ") || "none"}`,
  `inputFactCoverage: ${summary.inputFactCoverage ?? "unknown"}`,
  `totalUserFacts: ${summary.totalUserFacts ?? "unknown"}`,
  `coveredFactIds: ${(summary.coveredFactIds || []).join(", ") || "none"}`,
  `missingFactIds: ${(summary.missingFactIds || []).join(", ") || "none"}`,
  `groundedRepairApplied: ${(summary.groundedRepairApplied || []).join(", ") || "none"}`,
  `genericFillerRatio: ${summary.genericFillerRatio ?? "unknown"}`,
  `josaErrorCount: ${summary.josaErrorCount ?? "unknown"}`,
  `changedCharacterRatio: ${summary.changedCharacterRatio ?? "unknown"}`,
  `effectiveTargetCharCount: ${summary.effectiveTargetCharCount ?? "unknown"}`,
  `rawWriterCharCount: ${summary.rawWriterCharCount ?? "unknown"}`,
  `finalCharCount: ${summary.finalCharCount ?? "unknown"}`,
  `targetComplianceRatio: ${summary.targetComplianceRatio ?? "unknown"}`,
  `sectionBudgetTotal: ${summary.sectionBudgetTotal ?? "unknown"}`,
  `sectionActualTotal: ${summary.sectionActualTotal ?? "unknown"}`,
  `targetLengthFailureReason: ${summary.targetLengthFailureReason || "none"}`,
  `finishReason: ${summary.finishReason || "unknown"}`,
  `postProcessingReductionRatio: ${summary.postProcessingReductionRatio ?? "unknown"}`,
  `schemaRepairUsed: ${summary.schemaRepairUsed}`,
  `apiEndpoint: ${summary.apiEndpoint || "unknown"}`,
  `responseShape: ${summary.responseShape || "unknown"}`,
  `textExtracted: ${summary.textExtracted === null ? "unknown" : summary.textExtracted}`,
  `extractedTextLength: ${summary.extractedTextLength ?? "unknown"}`,
  `extractedTextHash: ${summary.extractedTextHash || "unknown"}`,
  `writerAttempts: ${summary.writerAttempts ?? "unknown"}`,
  `schemaFailureCount: ${summary.schemaFailureCount ?? "unknown"}`,
  `repairedFields: ${(summary.repairedFields || []).join(", ") || "none"}`,
  `topIssueCodes: ${(summary.issueCodes || []).slice(0, 5).join(", ") || "none"}`,
  `writerStage: ${summary.llmStages?.writer?.success ?? "unknown"} reason=${summary.llmStages?.writer?.reason || "none"} attempts=${summary.llmStages?.writer?.attempts ?? "unknown"}`,
  `judgeStage: ${summary.llmStages?.judge?.success ?? "unknown"} reason=${summary.llmStages?.judge?.reason || "none"} attempts=${summary.llmStages?.judge?.attempts ?? "unknown"}`,
  `revisionEnabled: ${summary.revisionEnabled === null ? "unknown" : summary.revisionEnabled}`,
  `revisionUsed: ${summary.qualityDiagnostics?.revisionUsed ?? "unknown"}`,
  `revisionCallCount: ${summary.qualityDiagnostics?.revisionCallCount ?? "unknown"}`,
  `attemptScores: ${(summary.qualityDiagnostics?.attemptScores || []).join(", ") || "unknown"}`,
  `selectedAttempt: ${summary.qualityDiagnostics?.selectedAttempt ?? "unknown"}`,
  `imageCount: ${summary.imageCount}`,
  `visibleElementsCount: ${summary.visibleElementsCount}`,
  `connectionResult: ${summary.connectionResult}`,
  `qualityResult: ${summary.qualityResult}`,
  `overallResult: ${summary.overallResult}`
].join("\n");

export const runDiagnostics = async ({ previewUrl = "", imagePath = "", timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS } = {}) => {
  const url = buildGenerateBlogUrl(previewUrl);
  const image = await readDiagnosticImage(imagePath);
  const payload = buildDiagnosticPayload({ image });
  const { status, json } = await fetchDiagnosticJson(url, payload, { timeoutMs });
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
  imagePath = "",
  timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS
} = {}) => {
  const { source, deployment } = await discoverLatestPreviewDeployment({ projectName, branch });
  const summary = await runDiagnostics({
    previewUrl: deployment.Deployment,
    imagePath,
    timeoutMs
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
  const timeoutMs = parseTimeoutMs(args["timeout-ms"], DEFAULT_DIAGNOSTIC_TIMEOUT_MS);
  if (args.auto) {
    const autoResult = await runAutoDiagnostics({
      projectName: args.project || DEFAULT_PROJECT_NAME,
      branch: args.branch || DEFAULT_PREVIEW_BRANCH,
      imagePath: args.image || "",
      timeoutMs
    });
    console.log(formatAutoDiagnosticSummary(autoResult));
    process.exitCode = autoResult.summary.pass ? 0 : 1;
    return;
  }

  const previewUrl = args.url || process.env.BLOG_PREVIEW_URL || "";
  const imagePath = args.image || "";
  const summary = await runDiagnostics({ previewUrl, imagePath, timeoutMs });
  console.log(formatDiagnosticSummary(summary));
  process.exitCode = summary.pass ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (isAbortError(error) && error.requestUrl) {
      console.error(formatDiagnosticAbortError(error));
      process.exitCode = 1;
      return;
    }
    console.error(`diagnostic-error: ${error.message}`);
    process.exitCode = 1;
  });
}
