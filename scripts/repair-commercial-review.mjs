#!/usr/bin/env node
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./diagnose-blog-preview.mjs";
import { COMMERCIAL_EXPORT_DIR } from "./diagnose-commercial-readiness.mjs";
import {
  normalizeBlogWriterResult,
  validateNormalizedBlogWriterResult
} from "../shared/blogWriterResultNormalizer.js";
import { validateCommercialReviewPackage } from "./review-commercial-results.mjs";

const text = (value) => String(value ?? "").trim();

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const writeJson = async (path, value) => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const csvCell = (value = "") => `"${String(value ?? "").replace(/"/gu, '""')}"`;
const toCsvLine = (values = []) => values.map(csvCell).join(",");

const createBlindMarkdown = ({ inputSummary = {}, finalTitle = "", titleCandidates = [], body = "", faq = [], hashtags = [], images = [] } = {}) => [
  `# ${inputSummary.caseId || ""}`,
  "",
  "## Input Summary",
  `- Category: ${inputSummary.category || ""}`,
  `- Topic: ${inputSummary.productName || ""}`,
  `- Main keyword: ${inputSummary.mainKeyword || ""}`,
  `- Sub keywords: ${inputSummary.subKeywords || ""}`,
  `- Target chars: ${inputSummary.targetCharCount || ""}`,
  `- Information level: ${inputSummary.informationLevel || ""}`,
  "",
  "## Final Title",
  finalTitle,
  "",
  "## Title Candidates",
  ...(titleCandidates.length ? titleCandidates.map((candidate, index) => `${index + 1}. ${candidate}`) : ["N/A"]),
  "",
  "## Images",
  ...(images.length ? images.map((image) => `- ${image.path || ""}`) : ["N/A"]),
  "",
  "## Body",
  body,
  "",
  "## FAQ",
  ...(faq.length ? faq.flatMap((item) => [`Q. ${item.question}`, `A. ${item.answer}`, ""]) : ["N/A"]),
  "",
  "## Hashtags",
  hashtags.join(" ")
].join("\n");

const backupIfExists = async (path) => {
  if (!existsSync(path)) return null;
  const backupPath = `${path}.bak`;
  if (!existsSync(backupPath)) {
    await copyFile(path, backupPath);
    return backupPath;
  }
  return backupPath;
};

const loadMetadataByCase = async (metadataDir = "") => {
  const result = new Map();
  if (!existsSync(metadataDir)) return result;
  const files = (await readdir(metadataDir)).filter((name) => name.endsWith(".json"));
  for (const file of files) {
    const content = await readJson(join(metadataDir, file));
    if (content.caseId) result.set(content.caseId, { file, content });
  }
  return result;
};

const chooseBestNormalized = (blind = {}, metadata = {}) => {
  const informationLevel = blind.inputSummary?.informationLevel || blind.informationLevel || metadata.informationLevel || "high";
  const blindResult = normalizeBlogWriterResult(blind);
  const metadataResult = normalizeBlogWriterResult(metadata);
  const blindValidation = validateNormalizedBlogWriterResult(blindResult, { informationLevel });
  const metadataValidation = validateNormalizedBlogWriterResult(metadataResult, { informationLevel });
  if (metadataValidation.valid && !blindValidation.valid) return { result: metadataResult, source: "metadata", validation: metadataValidation };
  if (blindValidation.valid) return { result: blindResult, source: "blind", validation: blindValidation };
  return {
    result: metadataResult.body || metadataResult.finalTitle ? metadataResult : blindResult,
    source: metadataResult.body || metadataResult.finalTitle ? "metadata-partial" : "unavailable",
    validation: metadataResult.body || metadataResult.finalTitle ? metadataValidation : blindValidation
  };
};

const reviewSheet = (cases = []) => {
  const headers = [
    "caseId",
    "category",
    "titleUsableYN",
    "openingNatural1to5",
    "humanLike1to5",
    "factReflection1to5",
    "inventedExperienceYN",
    "sectionNewInfo1to5",
    "photoConnection1to5OrNA",
    "publishWithin3MinYN",
    "reuseIntent1to5",
    "needsFix"
  ];
  return [
    toCsvLine(headers),
    ...cases.map((item) => toCsvLine([
      item.caseId,
      item.inputSummary?.category || "",
      "",
      "",
      "",
      "",
      "",
      "",
      item.inputSummary?.imageExpected ? "" : "N/A",
      "",
      "",
      ""
    ]))
  ].join("\n");
};

export const repairCommercialReviewPackage = async ({ dir = "" } = {}) => {
  const exportDir = resolve(dir || COMMERCIAL_EXPORT_DIR);
  const blindDir = join(exportDir, "blind");
  const metadataDir = join(exportDir, "metadata");
  const blindFiles = (await readdir(blindDir)).filter((name) => name.endsWith(".json")).sort();
  const metadataByCase = await loadMetadataByCase(metadataDir);
  await backupIfExists(join(exportDir, "human-review.json"));
  await backupIfExists(join(exportDir, "human-review.csv"));

  const cases = [];
  const repairedCases = [];
  const preservedCases = [];
  const unrecoverableCases = [];

  for (const file of blindFiles) {
    const blindPath = join(blindDir, file);
    const blind = await readJson(blindPath);
    const metadata = metadataByCase.get(blind.caseId)?.content || {};
    const beforeValidation = validateNormalizedBlogWriterResult(normalizeBlogWriterResult(blind), {
      informationLevel: blind.inputSummary?.informationLevel || blind.informationLevel || "high"
    });
    const chosen = chooseBestNormalized(blind, metadata);
    const repaired = {
      ...blind,
      ...chosen.result,
      caseId: blind.caseId,
      inputSummary: blind.inputSummary || {},
      images: blind.images || chosen.result.images || []
    };
    const afterValidation = validateNormalizedBlogWriterResult(repaired, {
      informationLevel: repaired.inputSummary?.informationLevel || repaired.informationLevel || "high"
    });
    await writeJson(blindPath, repaired);
    await writeFile(
      join(blindDir, file.replace(/\.json$/u, ".md")),
      `${createBlindMarkdown({ ...repaired, inputSummary: { ...repaired.inputSummary, caseId: repaired.caseId } })}\n`,
      "utf8"
    );
    const caseSummary = {
      caseId: repaired.caseId,
      source: chosen.source,
      finalTitlePresent: afterValidation.finalTitleLength >= 10,
      titleCandidatesCount: afterValidation.titleCandidatesCount,
      bodyPresent: afterValidation.bodyLength > 0,
      bodyLength: afterValidation.bodyLength,
      valid: afterValidation.valid,
      errors: afterValidation.errors
    };
    cases.push(caseSummary);
    if (!beforeValidation.valid && afterValidation.valid) repairedCases.push(repaired.caseId);
    else if (beforeValidation.valid && afterValidation.valid) preservedCases.push(repaired.caseId);
    else unrecoverableCases.push(repaired.caseId);
  }

  const normalizedBlindCases = [];
  for (const file of blindFiles) {
    normalizedBlindCases.push(await readJson(join(blindDir, file)));
  }
  const packageValidation = validateCommercialReviewPackage(normalizedBlindCases, exportDir);
  const manifest = {
    status: packageValidation.valid ? "OK" : "COMMERCIAL_REVIEW_PACKAGE_INVALID",
    generatedAt: new Date().toISOString(),
    noApiCall: true,
    exportDir,
    caseCount: cases.length,
    repairedCases,
    preservedCases,
    unrecoverableCases,
    packageValidation
  };
  await writeJson(join(exportDir, "manifest.json"), manifest);
  await writeJson(join(exportDir, "cases.json"), cases);
  await writeFile(join(exportDir, "review-sheet.csv"), `${reviewSheet(normalizedBlindCases)}\n`, "utf8");
  return manifest;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await repairCommercialReviewPackage({ dir: text(args.dir) });
    console.log(JSON.stringify({
      status: result.status,
      exportDir: result.exportDir,
      noApiCall: result.noApiCall,
      caseCount: result.caseCount,
      repairedCaseCount: result.repairedCases.length,
      preservedCaseCount: result.preservedCases.length,
      unrecoverableCaseCount: result.unrecoverableCases.length,
      repairedCases: result.repairedCases,
      preservedCases: result.preservedCases,
      unrecoverableCases: result.unrecoverableCases,
      invalidCases: result.packageValidation.invalidCases,
      reviewCheckCommand: `npm.cmd run review:commercial -- --check --dir="${result.exportDir}"`
    }, null, 2));
    process.exitCode = result.packageValidation.valid ? 0 : 1;
  } catch (error) {
    console.error(`commercial-review-repair-error: ${error.message}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
