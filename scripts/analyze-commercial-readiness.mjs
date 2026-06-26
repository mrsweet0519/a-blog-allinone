#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./diagnose-blog-preview.mjs";
import { COMMERCIAL_EXPORT_DIR } from "./diagnose-commercial-readiness.mjs";

const text = (value) => String(value ?? "").trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const boolYN = (value) => {
  const cleaned = text(value).toUpperCase();
  if (cleaned === "Y") return true;
  if (cleaned === "N") return false;
  return null;
};
const score1to5 = (value) => {
  const parsed = number(value, NaN);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
};
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
};
const average = (values = []) => {
  const safe = values.map(Number).filter(Number.isFinite);
  return safe.length ? safe.reduce((total, value) => total + value, 0) / safe.length : 0;
};
const csvCell = (value = "") => `"${String(value ?? "").replace(/"/gu, '""')}"`;
const csvLine = (values = []) => values.map(csvCell).join(",");

export class CommercialAnalysisBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CommercialAnalysisBlockedError";
    this.details = details;
  }
}

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
  if (!dirs.length) {
    throw new Error(`No commercial readiness export found in ${root}.`);
  }
  return dirs[0].path;
};

const parseCsv = (source = "") => {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some((item) => item !== "")) rows.push(row);
  return rows;
};

const csvObjects = (source = "") => {
  const [headers = [], ...rows] = parseCsv(source);
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
  );
};

const readJsonIfExists = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

const loadMetadataCases = async (exportDir = "") => {
  const metadataDir = join(exportDir, "metadata");
  const files = (await readdir(metadataDir)).filter((name) => name.endsWith(".json")).sort();
  const cases = [];
  for (const file of files) {
    cases.push(JSON.parse(await readFile(join(metadataDir, file), "utf8")));
  }
  return cases.sort((a, b) => text(a.caseId).localeCompare(text(b.caseId)));
};

const loadReviews = async (exportDir = "") => {
  const csvPath = join(exportDir, "human-review.csv");
  const jsonPath = join(exportDir, "human-review.json");
  const byCase = new Map();
  const jsonReviews = await readJsonIfExists(jsonPath, []);
  if (Array.isArray(jsonReviews)) {
    jsonReviews.forEach((review) => {
      if (review?.caseId) byCase.set(review.caseId, { ...review });
    });
  }
  if (existsSync(csvPath)) {
    const rows = csvObjects(await readFile(csvPath, "utf8"));
    rows.forEach((row) => {
      if (!row.caseId) return;
      const previous = byCase.get(row.caseId) || {};
      const merged = { ...previous };
      Object.entries(row).forEach(([key, value]) => {
        if (value !== "") merged[key] = value;
      });
      byCase.set(row.caseId, merged);
    });
  }
  return [...byCase.values()].sort((a, b) => text(a.caseId).localeCompare(text(b.caseId)));
};

const requiredReviewFields = (metadata = {}) => [
  "titleUsableYN",
  "openingNatural1to5",
  "humanLike1to5",
  "factReflection1to5",
  "inventedExperienceYN",
  "sectionNewInfo1to5",
  ...(metadata.imageExpected ? ["photoConnection1to5OrNA"] : []),
  "publishWithin3MinYN",
  "reuseIntent1to5"
];

const invalidReviewFields = (review = {}, metadata = {}) =>
  requiredReviewFields(metadata).filter((field) => {
    const value = text(review[field]);
    if (!value) return true;
    if (field.endsWith("YN")) return boolYN(value) === null;
    if (field === "photoConnection1to5OrNA") return value.toUpperCase() !== "N/A" && score1to5(value) === null;
    return score1to5(value) === null;
  });

export const inspectHumanReviewCompleteness = ({ cases = [], reviews = [] } = {}) => {
  const reviewsByCase = new Map(reviews.map((review) => [review.caseId, review]));
  const missingCaseIds = [];
  const incomplete = [];
  cases.forEach((item) => {
    const review = reviewsByCase.get(item.caseId);
    if (!review) {
      missingCaseIds.push(item.caseId);
      return;
    }
    const missingFields = invalidReviewFields(review, item);
    if (missingFields.length) incomplete.push({ caseId: item.caseId, missingFields });
  });
  return {
    expectedCaseCount: cases.length,
    submittedReviewCount: reviews.length,
    completeReviewCount: cases.length - missingCaseIds.length - incomplete.length,
    complete: cases.length > 0 && missingCaseIds.length === 0 && incomplete.length === 0,
    missingCaseIds,
    incompleteCaseIds: incomplete.map((item) => item.caseId),
    incomplete
  };
};

const calculateHumanScores = (review = {}, metadata = {}) => {
  const titleUsable = boolYN(review.titleUsableYN) === true;
  const opening = score1to5(review.openingNatural1to5) || 0;
  const natural = score1to5(review.humanLike1to5) || 0;
  const facts = score1to5(review.factReflection1to5) || 0;
  const invented = boolYN(review.inventedExperienceYN) === true;
  const sections = score1to5(review.sectionNewInfo1to5) || 0;
  const publish3m = boolYN(review.publishWithin3MinYN) === true;
  const reuse = score1to5(review.reuseIntent1to5) || 0;
  const photoRaw = text(review.photoConnection1to5OrNA);
  const photoScore = metadata.imageExpected && photoRaw.toUpperCase() !== "N/A"
    ? score1to5(photoRaw)
    : null;
  const parts = [
    { key: "title", value: titleUsable ? 15 : 0, max: 15 },
    { key: "opening", value: (opening / 5) * 15, max: 15 },
    { key: "naturalness", value: (natural / 5) * 20, max: 20 },
    { key: "factReflection", value: (facts / 5) * 15, max: 15 },
    { key: "noUnsupportedExperience", value: invented ? 0 : 15, max: 15 },
    { key: "sectionValue", value: (sections / 5) * 10, max: 10 },
    ...(photoScore === null ? [] : [{ key: "vision", value: (photoScore / 5) * 5, max: 5 }]),
    { key: "publishWithin3Minutes", value: publish3m ? 10 : 0, max: 10 },
    { key: "reuseIntent", value: (reuse / 5) * 10, max: 10 }
  ];
  const earned = parts.reduce((total, part) => total + part.value, 0);
  const possible = parts.reduce((total, part) => total + part.max, 0);
  return {
    humanScore: possible ? round((earned / possible) * 100, 2) : 0,
    humanTitleUsable: titleUsable,
    humanOpeningScore: opening,
    humanNaturalnessScore: natural,
    humanFactReflectionScore: facts,
    humanUnsupportedExperience: invented,
    humanSectionValueScore: sections,
    humanVisionScore: photoScore,
    humanPublishWithin3Minutes: publish3m,
    humanReuseIntentScore: reuse,
    humanComments: text(review.needsFix)
  };
};

const judgeFailure = (metadata = {}) => {
  const codes = metadata.issueCodes || [];
  const codeText = codes.join(" ");
  if (!metadata.judgeSuccess) {
    const type = /SCHEMA|JSON/u.test(codeText) ? "schema" : "transport";
    return {
      judgeFailureType: type,
      judgeReason: type === "schema" ? "Judge response schema/json failure" : "Judge call or diagnostic response did not complete",
      judgeScore: null
    };
  }
  if (metadata.publishReady === false || metadata.caseResult === "FAIL") {
    return {
      judgeFailureType: "quality",
      judgeReason: codes.length ? codes.slice(0, 5).join(", ") : metadata.failureCategory || "quality rejection",
      judgeScore: number(metadata.qualityScore, null)
    };
  }
  return { judgeFailureType: "none", judgeReason: "", judgeScore: number(metadata.qualityScore, null) };
};

const classifyCrossResult = (metadata = {}, human = {}) => {
  const autoReady = metadata.publishReady === true;
  const humanPublishable =
    human.humanTitleUsable === true &&
    human.humanPublishWithin3Minutes === true &&
    human.humanNaturalnessScore >= 4 &&
    human.humanUnsupportedExperience === false;
  if (autoReady && (human.humanUnsupportedExperience || !human.humanPublishWithin3Minutes)) return "JUDGE_FALSE_POSITIVE";
  if (autoReady && humanPublishable) return "TRUE_PASS";
  if (!autoReady && humanPublishable) return "JUDGE_FALSE_NEGATIVE";
  return "TRUE_REJECT";
};

const revisionEffectiveness = (metadata = {}) => {
  const attempts = Array.isArray(metadata.attemptScores) ? metadata.attemptScores.map(Number).filter(Number.isFinite) : [];
  const initialScore = attempts[0] ?? number(metadata.qualityScore);
  const selectedIndex = Math.max(0, number(metadata.selectedAttempt, attempts.length || 1) - 1);
  const selectedScore = attempts[selectedIndex] ?? number(metadata.qualityScore);
  const revisionGain = selectedScore - initialScore;
  let classification = initialScore >= 95 ? "NOT_NEEDED" : "FAILED";
  if (number(metadata.revisionCallCount) > 0) {
    if (initialScore >= 95) classification = "UNNECESSARY";
    else if (selectedScore < initialScore) classification = "DEGRADED";
    else if (revisionGain >= 3) classification = "EFFECTIVE";
    else classification = "NO_IMPROVEMENT";
  } else if (initialScore < 95 && metadata.publishReady !== true) {
    classification = "FAILED";
  }
  return {
    caseId: metadata.caseId,
    initialScore,
    revision1Score: attempts[1] ?? null,
    revision2Score: attempts[2] ?? null,
    selectedScore,
    revisionGain,
    classification
  };
};

const failureLayers = (metadata = {}, crossClassification = "", revisionClassification = "") => {
  const codes = metadata.issueCodes || [];
  const codeText = codes.join(" ");
  const layers = [];
  if (metadata.primaryEntityCoverage !== true || /PRIMARY_ENTITY|TITLE_MISSING/u.test(codeText)) layers.push("PRIMARY_ENTITY");
  if (number(metadata.categoryContaminationCount) > 0 || /CATEGORY|INTENT/u.test(codeText)) layers.push("CATEGORY_OR_INTENT");
  if (metadata.falseExperience || /EXPERIENCE|CONTRADICT/u.test(codeText)) layers.push("EXPERIENCE_STATUS");
  if (number(metadata.inputFactCoverage) < 0.9 || number(metadata.unsupportedClaimCount) > 0 || /MISSING_FACT|CLAIM|FACT/u.test(codeText)) layers.push("FACT_MAP");
  if (number(metadata.targetComplianceRatio) < 0.85 || number(metadata.targetComplianceRatio) > 1.1 || /TARGET|LENGTH/u.test(codeText)) layers.push("TARGET_LENGTH");
  if (metadata.imageExpected && metadata.visionMode !== "vision") layers.push("VISION");
  if (!metadata.judgeSuccess) layers.push(/SCHEMA|JSON/u.test(codeText) ? "JUDGE_RELIABILITY" : "JUDGE_RELIABILITY");
  if (crossClassification === "JUDGE_FALSE_NEGATIVE" || crossClassification === "JUDGE_FALSE_POSITIVE") layers.push("JUDGE_CALIBRATION");
  if ((number(metadata.revisionCallCount) > 0 && metadata.publishReady !== true) || revisionClassification === "UNNECESSARY") layers.push("REVISION_STRATEGY");
  if (number(metadata.metaGuidanceCount) > 0 || number(metadata.josaErrorCount) > 0 || number(metadata.genericFillerRatio) > 0.1) layers.push("POST_PROCESSING");
  if (!layers.length && metadata.publishReady !== true) layers.push("HUMAN_PREFERENCE_ONLY");
  return [...new Set(layers)];
};

const rootCauses = (matrix = []) => {
  const byLayer = new Map();
  matrix.forEach((item) => {
    item.failureLayers.forEach((layer) => {
      const entry = byLayer.get(layer) || { rootCause: layer, affectedCases: [], frequency: 0 };
      entry.affectedCases.push(item.caseId);
      entry.frequency += 1;
      byLayer.set(layer, entry);
    });
  });
  return [...byLayer.values()]
    .filter((item) => item.frequency >= 3 || item.affectedCases.some((caseId) => matrix.find((row) => row.caseId === caseId)?.hardFail))
    .map((item) => ({
      ...item,
      severity: item.affectedCases.some((caseId) => matrix.find((row) => row.caseId === caseId)?.hardFail)
        ? "critical"
        : item.frequency >= 5 ? "high" : "medium",
      recommendedLayer: item.rootCause,
      expectedImpact: "Improve repeated commercial readiness failures without case-specific exceptions.",
      regressionRisk: item.rootCause === "JUDGE_CALIBRATION" ? "medium" : "low"
    }));
};

const targetLengthClass = (metadata = {}, human = {}) => {
  const ratio = number(metadata.targetComplianceRatio);
  if (ratio < 0.85) return human.humanPublishWithin3Minutes ? "D" : "A";
  if (ratio > 1.1) return number(metadata.genericFillerRatio) > 0.1 ? "C" : "D";
  if (metadata.informationSufficiency !== "high" && metadata.publishReady !== true) return "B";
  return "D";
};

const matrixHeaders = [
  "caseId",
  "category",
  "informationSufficiency",
  "engine",
  "judgeEngine",
  "visionMode",
  "qualityScore",
  "publishReady",
  "hardFail",
  "issueCodes",
  "attemptScores",
  "selectedAttempt",
  "writerSuccess",
  "judgeSuccess",
  "revisionCallCount",
  "inputFactCoverage",
  "targetComplianceRatio",
  "effectiveTargetCharCount",
  "rawWriterCharCount",
  "finalCharCount",
  "sectionBudgetTotal",
  "sectionActualTotal",
  "targetLengthFailureReason",
  "postProcessingReductionRatio",
  "finishReason",
  "unsupportedClaimCount",
  "categoryContaminationCount",
  "metaGuidanceCount",
  "josaErrorCount",
  "genericFillerRatio",
  "latencyMs",
  "totalTokens",
  "humanTitleUsable",
  "humanOpeningScore",
  "humanNaturalnessScore",
  "humanFactReflectionScore",
  "humanUnsupportedExperience",
  "humanSectionValueScore",
  "humanVisionScore",
  "humanPublishWithin3Minutes",
  "humanReuseIntentScore",
  "humanScore",
  "autoScore",
  "scoreGap",
  "judgeFailureType",
  "judgeReason",
  "judgeScore",
  "crossClassification",
  "failureLayers",
  "revisionClassification",
  "targetLengthClass",
  "humanComments"
];

const matrixToCsv = (matrix = []) => [
  csvLine(matrixHeaders),
  ...matrix.map((item) => csvLine(matrixHeaders.map((key) => Array.isArray(item[key]) ? item[key].join("|") : item[key] ?? "")))
].join("\n");

const markdownReport = ({ exportDir = "", summary = {}, rootCauseItems = [], matrix = [], revisionItems = [] } = {}) => `# Commercial Failure Analysis

Export dir: ${exportDir}

## Summary

- Human review count: ${summary.humanReviewCount}
- TRUE_PASS: ${summary.truePass}
- TRUE_REJECT: ${summary.trueReject}
- JUDGE_FALSE_NEGATIVE: ${summary.judgeFalseNegative}
- JUDGE_FALSE_POSITIVE: ${summary.judgeFalsePositive}
- Average human score: ${summary.averageHumanScore}
- Average auto score: ${summary.averageAutoScore}
- Average score gap: ${summary.averageScoreGap}
- Max score gap: ${summary.maxScoreGap}
- Judge transport/schema failures: ${summary.judgeExecutionFailures}
- Judge quality rejections: ${summary.judgeQualityRejections}
- Average latency ms: ${summary.averageLatencyMs}
- P95 latency ms: ${summary.p95LatencyMs}
- Average tokens/case: ${summary.averageTokens}
- Average LLM calls/case: ${summary.averageLlmCalls}
- Revision average gain: ${summary.revisionAverageGain}
- Revision degraded cases: ${summary.revisionDegradedCases}

## Repeated Root Causes

${rootCauseItems.length ? rootCauseItems.map((item) => `- ${item.rootCause}: ${item.frequency} cases, severity=${item.severity}, layer=${item.recommendedLayer}`).join("\n") : "- No repeated root cause met the selection criteria."}

## Case Classifications

${matrix.map((item) => `- ${item.caseId}: ${item.crossClassification}; layers=${item.failureLayers.join("|") || "none"}; judge=${item.judgeFailureType}`).join("\n")}

## Revision

${revisionItems.map((item) => `- ${item.caseId}: ${item.classification}; gain=${item.revisionGain}`).join("\n")}
`;

const nextTask = (rootCauseItems = []) => `# Next Codex Task

Analyze and fix only repeated commercial readiness failures listed below. Do not lower judge thresholds, do not add case-specific exceptions, and do not push to main.

## Scope

${rootCauseItems.length ? rootCauseItems.map((item) => `- ${item.rootCause}: ${item.frequency} cases; recommended layer ${item.recommendedLayer}; severity ${item.severity}`).join("\n") : "- No production fix is recommended from the current evidence."}

## Verification

- npm.cmd run test:local
- npm.cmd run build
- npm.cmd run diagnose:commercial -- --timeout-ms=180000 --export
- npm.cmd run analyze:commercial -- --dir="<latest commercial readiness export>"
`;

export const analyzeCommercialReadiness = async ({ dir = "" } = {}) => {
  const exportDir = resolve(dir || await findLatestExportDir());
  const cases = await loadMetadataCases(exportDir);
  const reviews = await loadReviews(exportDir);
  const completeness = inspectHumanReviewCompleteness({ cases, reviews });
  if (!completeness.complete) {
    throw new CommercialAnalysisBlockedError("Human blind review is incomplete.", {
      exportDir,
      ...completeness,
      reviewCommand: `npm.cmd run review:commercial -- --dir="${exportDir}"`
    });
  }

  const reviewsByCase = new Map(reviews.map((review) => [review.caseId, review]));
  const matrix = cases.map((metadata) => {
    const human = calculateHumanScores(reviewsByCase.get(metadata.caseId), metadata);
    const judge = judgeFailure(metadata);
    const crossClassification = classifyCrossResult(metadata, human);
    const revision = revisionEffectiveness(metadata);
    const totalTokens = number(metadata.tokenUsage?.total);
    return {
      caseId: metadata.caseId,
      category: metadata.category,
      informationSufficiency: metadata.informationSufficiency,
      engine: metadata.engine,
      judgeEngine: metadata.judgeEngine,
      visionMode: metadata.visionMode,
      qualityScore: number(metadata.qualityScore),
      publishReady: metadata.publishReady === true,
      hardFail: metadata.hardFail === true,
      issueCodes: metadata.issueCodes || [],
      attemptScores: metadata.attemptScores || [],
      selectedAttempt: number(metadata.selectedAttempt),
      writerSuccess: metadata.writerSuccess === true,
      judgeSuccess: metadata.judgeSuccess === true,
      revisionCallCount: number(metadata.revisionCallCount),
      inputFactCoverage: number(metadata.inputFactCoverage),
      targetComplianceRatio: number(metadata.targetComplianceRatio),
      effectiveTargetCharCount: number(metadata.effectiveTargetCharCount),
      rawWriterCharCount: number(metadata.rawWriterCharCount),
      finalCharCount: number(metadata.finalCharCount || metadata.actualCharCount),
      sectionBudgetTotal: number(metadata.sectionBudgetTotal),
      sectionActualTotal: number(metadata.sectionActualTotal),
      targetLengthFailureReason: metadata.targetLengthFailureReason || "",
      postProcessingReductionRatio: number(metadata.postProcessingReductionRatio),
      finishReason: metadata.finishReason || "",
      unsupportedClaimCount: number(metadata.unsupportedClaimCount),
      categoryContaminationCount: number(metadata.categoryContaminationCount),
      metaGuidanceCount: number(metadata.metaGuidanceCount),
      josaErrorCount: number(metadata.josaErrorCount),
      genericFillerRatio: number(metadata.genericFillerRatio),
      latencyMs: number(metadata.latencyMs),
      totalTokens,
      ...human,
      autoScore: number(metadata.qualityScore),
      scoreGap: round(human.humanScore - number(metadata.qualityScore), 2),
      ...judge,
      crossClassification,
      failureLayers: failureLayers(metadata, crossClassification, revision.classification),
      revisionClassification: revision.classification,
      targetLengthClass: targetLengthClass(metadata, human)
    };
  });
  const revisions = matrix.map((item) => revisionEffectiveness(cases.find((metadata) => metadata.caseId === item.caseId)));
  const roots = rootCauses(matrix);
  const sortedLatencies = matrix.map((item) => item.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1);
  const summary = {
    exportDir,
    humanReviewCount: completeness.completeReviewCount,
    truePass: matrix.filter((item) => item.crossClassification === "TRUE_PASS").length,
    trueReject: matrix.filter((item) => item.crossClassification === "TRUE_REJECT").length,
    judgeFalseNegative: matrix.filter((item) => item.crossClassification === "JUDGE_FALSE_NEGATIVE").length,
    judgeFalsePositive: matrix.filter((item) => item.crossClassification === "JUDGE_FALSE_POSITIVE").length,
    averageHumanScore: round(average(matrix.map((item) => item.humanScore))),
    averageAutoScore: round(average(matrix.map((item) => item.autoScore))),
    averageScoreGap: round(average(matrix.map((item) => item.scoreGap))),
    maxScoreGap: round(Math.max(...matrix.map((item) => Math.abs(item.scoreGap)))),
    judgeExecutionFailures: matrix.filter((item) => ["transport", "schema"].includes(item.judgeFailureType)).length,
    judgeQualityRejections: matrix.filter((item) => item.judgeFailureType === "quality").length,
    hardFailTypes: [...new Set(matrix.filter((item) => item.hardFail).flatMap((item) => item.failureLayers))],
    repeatedRootCauses: roots,
    averageLlmCalls: round(average(cases.map((item) => number(item.retryCounts?.writer) + number(item.retryCounts?.judge) + (Array.isArray(item.retryCounts?.revisions) ? item.retryCounts.revisions.length : 0)))),
    averageTokens: round(average(matrix.map((item) => item.totalTokens))),
    averageLatencyMs: round(average(matrix.map((item) => item.latencyMs))),
    p95LatencyMs: sortedLatencies[p95Index] || 0,
    revisionAverageGain: round(average(revisions.map((item) => item.revisionGain))),
    revisionDegradedCases: revisions.filter((item) => item.classification === "DEGRADED").length,
    productionChangeRecommended: roots.length > 0
  };

  const analysisDir = join(exportDir, "analysis");
  await mkdir(analysisDir, { recursive: true });
  await writeFile(join(analysisDir, "case-matrix.csv"), `${matrixToCsv(matrix)}\n`, "utf8");
  await writeFile(join(analysisDir, "root-causes.json"), `${JSON.stringify({ summary, rootCauses: roots }, null, 2)}\n`, "utf8");
  await writeFile(join(analysisDir, "judge-calibration.json"), `${JSON.stringify({ summary, cases: matrix.map(({ humanComments, ...item }) => item) }, null, 2)}\n`, "utf8");
  await writeFile(join(analysisDir, "revision-effectiveness.json"), `${JSON.stringify({ summary, revisions }, null, 2)}\n`, "utf8");
  await writeFile(join(analysisDir, "commercial-failure-analysis.md"), markdownReport({ exportDir, summary, rootCauseItems: roots, matrix, revisionItems: revisions }), "utf8");
  await writeFile(join(analysisDir, "next-codex-task.md"), nextTask(roots), "utf8");
  return { exportDir, analysisDir, summary };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await analyzeCommercialReadiness({ dir: args.dir || "" });
    console.log(JSON.stringify({
      exportDir: result.exportDir,
      analysisDir: result.analysisDir,
      humanReviewCount: result.summary.humanReviewCount,
      truePass: result.summary.truePass,
      trueReject: result.summary.trueReject,
      judgeFalseNegative: result.summary.judgeFalseNegative,
      judgeFalsePositive: result.summary.judgeFalsePositive,
      averageHumanScore: result.summary.averageHumanScore,
      averageAutoScore: result.summary.averageAutoScore,
      averageScoreGap: result.summary.averageScoreGap,
      repeatedRootCauses: result.summary.repeatedRootCauses.map((item) => ({
        rootCause: item.rootCause,
        frequency: item.frequency,
        severity: item.severity,
        recommendedLayer: item.recommendedLayer
      })),
      nextRecommendation: result.summary.productionChangeRecommended ? "REPEATED_ROOT_CAUSE_FOUND" : "NO_PRODUCTION_CHANGE_RECOMMENDED"
    }, null, 2));
  } catch (error) {
    if (error instanceof CommercialAnalysisBlockedError) {
      console.error(JSON.stringify({
        status: "BLOCKED_HUMAN_REVIEW_INCOMPLETE",
        ...error.details
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.error(`commercial-analysis-error: ${error.message}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
