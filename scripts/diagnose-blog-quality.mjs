import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBlogWriterPipelineContext } from "../shared/blogWriterPipeline.js";
import {
  DEFAULT_DIAGNOSTIC_TIMEOUT_MS,
  DEFAULT_PREVIEW_BRANCH,
  DEFAULT_PROJECT_NAME,
  buildGenerateBlogUrl,
  discoverLatestPreviewDeployment,
  evaluateOverallResult,
  evaluateQualityResult,
  fetchDiagnosticJson,
  formatDiagnosticAbortError,
  normalizePreviewUrl,
  parseArgs,
  parseTimeoutMs,
  summarizeDiagnosticResponse
} from "./diagnose-blog-preview.mjs";

export const QUALITY_CANARY_EXPORT_DIR = ".tmp-quality-canary";

const text = (value) => String(value ?? "").trim();
const charCount = (value = "") => Array.from(String(value || "")).length;
const hashText = (value = "") => createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);

const safeFilePart = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40) || "canary";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

export const createQualityCanaryInputs = ({ seed = randomUUID().slice(0, 8) } = {}) => [
  {
    category: "fashion",
    productName: `루미핏 ${seed} 데일리 재킷 사용 후기`,
    mainKeyword: "경량 재킷 후기",
    subKeywords: "출근 코디, 착용감",
    targetCharCount: 2200,
    experienceMemo: [
      "지난주 화요일 출근길과 저녁 약속까지 하루 종일 직접 착용했다.",
      "아침에는 얇은 니트 위에 입었고 낮에는 사무실 의자에 걸어두었다가 이동할 때 다시 입었다.",
      "좋았던 점은 어깨가 뻣뻣하지 않아 노트북 가방을 멜 때 움직임이 편했다는 점이다.",
      "또 하나 좋았던 점은 주머니가 깊어서 교통카드와 이어폰 케이스를 따로 챙기기 쉬웠다는 점이다.",
      "아쉬웠던 점은 소매 끝 먼지가 생각보다 잘 붙어서 밝은 셔츠와 입을 때 한 번 털어줘야 했다.",
      "실제 사용 후에는 짧은 외근이나 출근 코디용으로 다시 입을 의사가 있다.",
      "비 오는 날 장시간 외부 활동보다는 실내 이동이 많은 날에 더 잘 맞았다.",
      "검수 기준으로 착용감, 수납, 재사용 의사를 모두 본문에 자연스럽게 반영해야 한다."
    ].join("\n")
  },
  {
    category: "restaurant",
    productName: `온반정 ${seed} 성수 점심 방문 후기`,
    mainKeyword: "성수동 점심 맛집",
    subKeywords: "혼밥, 재방문",
    targetCharCount: 2200,
    experienceMemo: [
      "지난 금요일 오후 1시쯤 성수역 근처에서 혼자 점심을 먹으려고 직접 방문했다.",
      "방문 계기는 회의가 길어져 너무 무겁지 않은 한 그릇 메뉴를 찾고 있었기 때문이다.",
      "좋았던 점은 테이블 간격이 좁지 않아 혼자 앉아도 시선이 부담스럽지 않았다는 점이다.",
      "또 좋았던 점은 국물 간이 세지 않아 오후 업무 전에 속이 무겁지 않았다는 점이다.",
      "아쉬웠던 점은 점심 피크가 지나도 입구 쪽 자리는 사람이 오갈 때 조금 분주하게 느껴졌다는 점이다.",
      "실제 방문 결과 식사 시간은 길지 않았고, 다음에는 동료와 함께 재방문할 의사가 있다.",
      "주문 전에는 메뉴가 단순한지, 혼밥 자리 분위기가 괜찮은지를 가장 궁금하게 봤다.",
      "검수 기준으로 방문 계기, 식사 상황, 좋았던 점 두 가지, 아쉬운 점, 재방문 의사가 모두 들어가야 한다."
    ].join("\n")
  },
  {
    category: "education",
    productName: `문장공방 ${seed} 온라인 글쓰기 클래스 수강 후기`,
    mainKeyword: "온라인 글쓰기 강의",
    subKeywords: "초보자 수업, 과제 피드백",
    targetCharCount: 2200,
    experienceMemo: [
      "지난달 4주 과정 중 1주차와 2주차 수업을 직접 들었고 과제 피드백까지 받아봤다.",
      "수강 계기는 블로그 글 초안을 쓰면 문단 연결이 자주 끊겨서 구조를 잡고 싶었기 때문이다.",
      "좋았던 점은 첫 시간에 제목, 도입, 본문 전개를 한 번에 설명하지 않고 예시별로 나눠 보여준 점이다.",
      "또 좋았던 점은 과제 피드백에서 문장을 전부 고쳐주기보다 왜 어색한지 기준을 알려준 점이다.",
      "아쉬웠던 점은 실시간 질문 시간이 짧아서 개인 사례를 길게 설명하기는 어려웠다는 점이다.",
      "실제 수강 후에는 다음 글을 쓸 때 문단마다 하나의 역할을 먼저 적어보게 됐다.",
      "재수강보다는 심화반이 열리면 이어서 들어볼 의사가 있다.",
      "검수 기준으로 수강 계기, 구체적인 수업 흐름, 좋았던 점 두 가지, 아쉬운 점, 이후 변화가 반영되어야 한다."
    ].join("\n")
  }
];

export const validateQualityCanaryInput = (input = {}) => {
  const context = buildBlogWriterPipelineContext(input);
  const memo = text(input.experienceMemo);
  const memoLines = memo.split(/\n+/u).map(text).filter(Boolean);
  const subKeywords = Array.isArray(context.subKeywords) ? context.subKeywords : [];
  const userFacts = context.factMap?.userFacts || [];
  const checks = {
    informationSufficiencyHigh: context.informationSufficiency?.level === "high",
    highConfidenceFactCount: userFacts.filter((fact) => Number(fact.confidence || 0) >= 0.85).length >= 8,
    actualExperience: ["visited", "stayed", "used", "eaten", "attended", "purchased"].includes(context.experienceStatus),
    positiveFactCount: memoLines.filter((line) => /좋았|편했|쉬웠|괜찮|도움|만족/u.test(line)).length >= 2,
    drawbackFactCount: memoLines.filter((line) => /아쉬|불편|어려|짧|부족|분주/u.test(line)).length >= 1,
    situationFactCount: memoLines.filter((line) => /지난|아침|오후|저녁|회의|출근|수업|방문|착용|수강|사용/u.test(line)).length >= 2,
    returnIntent: /재사용|재방문|재수강|다시|이어/u.test(memo),
    primaryEntity: Boolean(context.primaryEntity),
    mainKeyword: Boolean(context.mainKeyword),
    subKeywords: subKeywords.length >= 2,
    targetRange: Number(input.targetCharCount) >= 1800 && Number(input.targetCharCount) <= 2500
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
  return {
    pass: failed.length === 0,
    failed,
    informationSufficiency: context.informationSufficiency?.level || "unknown",
    highConfidenceFactCount: userFacts.filter((fact) => Number(fact.confidence || 0) >= 0.85).length,
    experienceStatus: context.experienceStatus
  };
};

const createPrecheckFailureSummary = ({ category = "", input = {}, precheck = {} } = {}) => ({
  category,
  primaryEntityCoverage: false,
  engine: "not_tested",
  judgeEngine: "not_tested",
  isMock: false,
  informationSufficiency: precheck.informationSufficiency || "unknown",
  resultMode: "not_tested",
  requestedTargetCharCount: Number(input.targetCharCount) || 0,
  actualCharCount: 0,
  inputFactCoverage: 0,
  qualityScore: 0,
  publishReady: false,
  qualityAttempts: 0,
  hardFail: true,
  issueCodes: ["QUALITY_CANARY_INPUT_NOT_HIGH", ...(precheck.failed || [])],
  connectionResult: "FAIL",
  qualityResult: "FAIL",
  stageReasons: {},
  retryCounts: {},
  stageLatencies: {},
  revisionDiagnostics: {
    initialQualityScore: 0,
    qualityAttempts: 0,
    revisionUsed: false,
    revisionCallCount: 0,
    attemptScores: [],
    selectedAttempt: 0,
    finalQualityScore: 0
  },
  metadata: {
    rawWriterScore: null,
    finalJudgeScore: null,
    appliedCaps: [],
    genericFillerRatio: null,
    changedCharacterRatio: null,
    contentHash: ""
  },
  exportContent: {
    input: {},
    finalTitle: "",
    finalBody: "",
    faq: [],
    hashtags: []
  }
});

const getPackage = (json = {}) => json.contentPackage || {};
const getFaqItems = (json = {}) => json.faq || json.faqItems || getPackage(json).faqItems || [];
const getBody = (json = {}) => text(json.body || getPackage(json).blogBody || "");
const getTitle = (json = {}) => text(json.finalTitle || json.selectedTitle || getPackage(json).finalRecommendedTitle || "");
const getHashtags = (json = {}) => json.hashtags || getPackage(json).hashtags || [];

export const summarizeQualityCanaryResponse = ({
  category = "",
  url = "",
  status = 0,
  json = {},
  requestedTargetCharCount = 0
} = {}) => {
  const base = summarizeDiagnosticResponse({ url, status, json });
  const packageData = getPackage(json);
  const qualityResult = evaluateQualityResult(base, { tested: true });
  const actualCharCount = base.actualCharCount ?? charCount(getBody(json));
  const revisionDiagnostics = base.qualityDiagnostics || {};
  const inferredRevisionCallCount = revisionDiagnostics.revisionCallCount ?? Math.max(0, Number(base.qualityAttempts || 1) - 1);
  const inferredAttemptScores = revisionDiagnostics.attemptScores || [];
  const llmStages = json.llmStages || {};
  const writerStage = llmStages.writer || {};
  const judgeStage = llmStages.judge || {};
  const revisionStages = Array.isArray(llmStages.revisions) ? llmStages.revisions : [];

  return {
    category,
    primaryEntityCoverage: base.primaryEntityCoverage === true,
    engine: base.engine,
    judgeEngine: base.judgeEngine,
    isMock: base.isMock,
    informationSufficiency: base.informationSufficiency || "unknown",
    resultMode: base.resultMode || "unknown",
    requestedTargetCharCount: base.requestedTargetCharCount || requestedTargetCharCount,
    actualCharCount,
    inputFactCoverage: base.inputFactCoverage ?? 0,
    totalUserFacts: base.totalUserFacts ?? 0,
    coveredFactIds: base.coveredFactIds || [],
    missingFactIds: base.missingFactIds || [],
    groundedRepairApplied: base.groundedRepairApplied || [],
    qualityScore: base.qualityScore ?? 0,
    publishReady: base.publishReady,
    qualityAttempts: base.qualityAttempts,
    hardFail: base.hardFail,
    issueCodes: base.issueCodes || [],
    connectionResult: base.connectionResult,
    qualityResult,
    stageReasons: {
      writerReason: writerStage.reason || "",
      writerStatus: writerStage.status ?? null,
      judgeReason: judgeStage.reason || "",
      judgeStatus: judgeStage.status ?? null,
      revisionReasons: revisionStages.map((stage) => stage.reason || null).filter(Boolean)
    },
    retryCounts: {
      writer: writerStage.attempts || 0,
      judge: judgeStage.attempts || 0,
      revisions: revisionStages.map((stage) => stage.attempts || 0)
    },
    stageLatencies: {
      writer: writerStage.latencyMs || 0,
      judge: judgeStage.latencyMs || 0,
      revisions: revisionStages.map((stage) => stage.latencyMs || 0)
    },
    revisionDiagnostics: {
      initialQualityScore: revisionDiagnostics.initialQualityScore ?? base.finalJudgeScore ?? 0,
      qualityAttempts: revisionDiagnostics.qualityAttempts ?? base.qualityAttempts,
      revisionUsed: revisionDiagnostics.revisionUsed ?? inferredRevisionCallCount > 0,
      revisionCallCount: inferredRevisionCallCount,
      attemptScores: inferredAttemptScores,
      selectedAttempt: revisionDiagnostics.selectedAttempt ?? 1,
      finalQualityScore: revisionDiagnostics.finalQualityScore ?? base.finalJudgeScore ?? base.qualityScore ?? 0
    },
    metadata: {
      rawWriterScore: base.rawWriterScore ?? null,
      finalJudgeScore: base.finalJudgeScore ?? null,
      appliedCaps: base.appliedCaps || [],
      genericFillerRatio: base.genericFillerRatio ?? null,
      josaErrorCount: base.josaErrorCount ?? 0,
      changedCharacterRatio: base.changedCharacterRatio ?? null,
      contentHash: hashText(`${getTitle(json)}\n${getBody(json)}`)
    },
    exportContent: {
      input: {
        category,
        productName: packageData.standardInput?.topic || "",
        mainKeyword: packageData.standardInput?.userMainKeyword || "",
        subKeywords: packageData.standardInput?.userSubKeywords || [],
        targetCharCount: requestedTargetCharCount
      },
      finalTitle: getTitle(json),
      finalBody: getBody(json),
      faq: getFaqItems(json),
      hashtags: getHashtags(json)
    }
  };
};

const toConsoleCanary = (summary = {}) => ({
  category: summary.category,
  primaryEntityCoverage: summary.primaryEntityCoverage,
  engine: summary.engine,
  judgeEngine: summary.judgeEngine,
  isMock: summary.isMock,
  informationSufficiency: summary.informationSufficiency,
  resultMode: summary.resultMode,
  requestedTargetCharCount: summary.requestedTargetCharCount,
  actualCharCount: summary.actualCharCount,
  inputFactCoverage: summary.inputFactCoverage,
  totalUserFacts: summary.totalUserFacts,
  coveredFactIds: summary.coveredFactIds,
  missingFactIds: summary.missingFactIds,
  groundedRepairApplied: summary.groundedRepairApplied,
  qualityScore: summary.qualityScore,
  publishReady: summary.publishReady,
  qualityAttempts: summary.qualityAttempts,
  hardFail: summary.hardFail,
  issueCodes: summary.issueCodes,
  connectionResult: summary.connectionResult,
  qualityResult: summary.qualityResult,
  writerReason: summary.stageReasons?.writerReason || "",
  writerStatus: summary.stageReasons?.writerStatus ?? null,
  judgeReason: summary.stageReasons?.judgeReason || "",
  judgeStatus: summary.stageReasons?.judgeStatus ?? null,
  revisionReasons: summary.stageReasons?.revisionReasons || [],
  retryCounts: summary.retryCounts || {},
  stageLatencies: summary.stageLatencies || {}
});

const summarizeAggregate = (canaries = []) => {
  const scores = canaries.map((item) => Number(item.qualityScore) || 0);
  const connectionResult = canaries.every((item) => item.connectionResult === "PASS") ? "PASS" : "FAIL";
  const averageQualityScore = scores.length
    ? Number((scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(2))
    : 0;
  const minQualityScore = scores.length ? Math.min(...scores) : 0;
  const publishReadyCount = canaries.filter((item) => item.publishReady).length;
  const qualityResult =
    canaries.length >= 3 &&
    canaries.every((item) => item.qualityResult === "PASS") &&
    averageQualityScore >= 95 &&
    minQualityScore >= 90 &&
    publishReadyCount === canaries.length
      ? "PASS"
      : "FAIL";

  return {
    connectionResult,
    qualityResult,
    overallResult: evaluateOverallResult({ connectionResult, qualityResult }),
    averageQualityScore,
    minQualityScore,
    publishReadyCount,
    canaryCount: canaries.length
  };
};

const writeCanaryExport = async ({ runId = "", summaries = [], exportDir = QUALITY_CANARY_EXPORT_DIR } = {}) => {
  const dir = join(exportDir, runId);
  await mkdir(dir, { recursive: true });

  await Promise.all(
    summaries.flatMap((summary, index) => {
      const prefix = `${String(index + 1).padStart(2, "0")}-${safeFilePart(summary.category)}`;
      const contentPath = join(dir, `${prefix}-content.json`);
      const metadataPath = join(dir, `${prefix}-metadata.json`);
      return [
        writeFile(contentPath, `${JSON.stringify(summary.exportContent, null, 2)}\n`, "utf8"),
        writeFile(
          metadataPath,
          `${JSON.stringify({
            ...toConsoleCanary(summary),
            revisionDiagnostics: summary.revisionDiagnostics,
            metadata: summary.metadata
          }, null, 2)}\n`,
          "utf8"
        )
      ];
    })
  );

  return dir;
};

export const runQualityDiagnostics = async ({
  previewUrl = "",
  timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS,
  exportResults = false,
  seed = randomUUID().slice(0, 8)
} = {}) => {
  const baseUrl = normalizePreviewUrl(previewUrl);
  const url = buildGenerateBlogUrl(baseUrl);
  const inputs = createQualityCanaryInputs({ seed });
  const summaries = [];

  for (const [index, input] of inputs.entries()) {
    const precheck = validateQualityCanaryInput(input);
    if (!precheck.pass) {
      summaries.push(createPrecheckFailureSummary({ category: input.category, input, precheck }));
      continue;
    }
    const { status, json } = await fetchDiagnosticJson(url, input, { timeoutMs });
    summaries.push(
      summarizeQualityCanaryResponse({
        category: input.category,
        url,
        status,
        json,
        requestedTargetCharCount: input.targetCharCount
      })
    );
    if (index < inputs.length - 1) await wait(3500);
  }

  const aggregate = summarizeAggregate(summaries);
  const runId = `quality-canary-${new Date().toISOString().replace(/[:.]/gu, "-")}-${seed}`;
  const exportPath = exportResults ? await writeCanaryExport({ runId, summaries }) : "";

  return {
    previewUrl: baseUrl,
    runId,
    exported: Boolean(exportResults),
    exportPath,
    ...aggregate,
    canaries: summaries.map(toConsoleCanary),
    revisionDiagnostics: summaries.map((summary) => ({
      category: summary.category,
      ...summary.revisionDiagnostics
    })),
    qualityInvestigation: summaries.map((summary) => ({
      category: summary.category,
      ...summary.metadata
    }))
  };
};

export const runAutoQualityDiagnostics = async ({
  projectName = DEFAULT_PROJECT_NAME,
  branch = DEFAULT_PREVIEW_BRANCH,
  timeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS,
  exportResults = false,
  seed = randomUUID().slice(0, 8)
} = {}) => {
  const auto = await discoverLatestPreviewDeployment({ projectName, branch });
  const diagnostics = await runQualityDiagnostics({
    previewUrl: auto.deployment.Deployment,
    timeoutMs,
    exportResults,
    seed
  });
  return {
    ...auto,
    diagnostics
  };
};

export const formatQualityDiagnosticSummary = ({
  projectName = DEFAULT_PROJECT_NAME,
  branch = DEFAULT_PREVIEW_BRANCH,
  source = "",
  deployment = {},
  diagnostics = {}
} = {}) =>
  [
    "=== Blog Writer Quality Auto Discovery ===",
    `project: ${projectName}`,
    `branch: ${branch}`,
    `localSource: ${source || "unknown"}`,
    `deploymentSource: ${deployment.Source || "unknown"}`,
    `deploymentId: ${deployment.Id || "unknown"}`,
    `previewUrl: ${deployment.Deployment || diagnostics.previewUrl || "unknown"}`,
    "",
    "=== Blog Writer Quality Canary Diagnostics ===",
    JSON.stringify(diagnostics, null, 2)
  ].join("\n");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = parseTimeoutMs(args["timeout-ms"], DEFAULT_DIAGNOSTIC_TIMEOUT_MS);
  const exportResults = Boolean(args.export);
  const seed = text(args.seed) || randomUUID().slice(0, 8);

  if (args.auto) {
    const autoResult = await runAutoQualityDiagnostics({
      projectName: args.project || DEFAULT_PROJECT_NAME,
      branch: args.branch || DEFAULT_PREVIEW_BRANCH,
      timeoutMs,
      exportResults,
      seed
    });
    console.log(formatQualityDiagnosticSummary(autoResult));
    process.exitCode = autoResult.diagnostics.qualityResult === "PASS" ? 0 : 1;
    return;
  }

  const previewUrl = args.url || process.env.BLOG_PREVIEW_URL || "";
  const diagnostics = await runQualityDiagnostics({
    previewUrl,
    timeoutMs,
    exportResults,
    seed
  });
  console.log(JSON.stringify(diagnostics, null, 2));
  process.exitCode = diagnostics.qualityResult === "PASS" ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if ((error?.name === "AbortError" || error?.code === "ABORT_ERR") && error.requestUrl) {
      console.error(formatDiagnosticAbortError(error));
      process.exitCode = 1;
      return;
    }
    console.error(`quality-diagnostic-error: ${error.message}`);
    process.exitCode = 1;
  });
}
