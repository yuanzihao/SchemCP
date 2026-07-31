import { constants as fsConstants } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { lstat, open, realpath } from "node:fs/promises";
import { compileProject } from "../application/compile-project.js";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import type { EdaIr, EdaIrSummary } from "../ir/model.js";
import { buildNetlistComparisonReport } from "../truth/compare-netlist-evidence.js";
import { readPrivateNetlist } from "../truth/import-netlist-evidence.js";
import {
  readPrivateBom,
  type JlcEdaProBom
} from "../truth/jlceda-pro-bom.js";
import { parseJlcEdaProEnet } from "../truth/jlceda-pro-enet.js";
import {
  readGoldenManifest,
  verifyGoldenIr
} from "./golden-manifest.js";
import {
  readP0ReferenceScreenshot,
  type P0ReferenceScreenshot
} from "./reference-screenshot.js";

export const P0_FORMAT_MATRIX_SCHEMA_VERSION = "0.2.0" as const;
export const P0_FORMAT_MATRIX_TARGET_MINIMUM = 20;
export const P0_FORMAT_MATRIX_TARGET_MAXIMUM = 50;

export const P0_REQUIRED_FEATURES = [
  "SINGLE_PAGE",
  "MULTI_PAGE",
  "HIERARCHICAL_SCHEMATIC",
  "MULTI_UNIT_COMPONENT",
  "BUS",
  "GLOBAL_NET",
  "CUSTOM_SYMBOL",
  "CUSTOM_DEVICE",
  "VARIANT",
  "DNP",
  "NET_TIE",
  "ZERO_OHM",
  "FERRITE_BEAD",
  "MULTI_POWER_DOMAIN",
  "STM32_MINIMUM_SYSTEM",
  "USB",
  "CAN",
  "ETHERNET",
  "SD_CARD"
] as const;

export const P0_OPTIONAL_FEATURES = [
  "SHORT_SYMBOL",
  "NO_CONNECT"
] as const;

export const P0_FORMAT_FEATURES = [
  ...P0_REQUIRED_FEATURES,
  ...P0_OPTIONAL_FEATURES
] as const;

export type P0FormatFeature = (typeof P0_FORMAT_FEATURES)[number];

const SUMMARY_METRICS = [
  "schematicPages",
  "instanceContexts",
  "symbolParts",
  "symbols",
  "variants",
  "shortRelations",
  "pinInstancesWithDeclaredNoConnect",
  "pinInstancesByEndpointKind.NET_FLAG_PIN"
] as const;

type SummaryMetric = (typeof SUMMARY_METRICS)[number];

const FEATURE_METRIC_RULES = {
  SINGLE_PAGE: ["schematicPages"],
  MULTI_PAGE: ["schematicPages"],
  HIERARCHICAL_SCHEMATIC: ["instanceContexts"],
  MULTI_UNIT_COMPONENT: ["symbolParts", "symbols"],
  GLOBAL_NET: ["pinInstancesByEndpointKind.NET_FLAG_PIN"],
  VARIANT: ["variants"],
  SHORT_SYMBOL: ["shortRelations"],
  NO_CONNECT: ["pinInstancesWithDeclaredNoConnect"]
} as const satisfies Partial<
  Record<P0FormatFeature, readonly SummaryMetric[]>
>;

const MAX_JSON_BYTES = 512 * 1024;
const MAX_JSON_DEPTH = 32;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MATRIX_ID_PATTERN = /^p0-[a-z0-9](?:[a-z0-9-]{0,47})$/u;
const FIXTURE_ID_PATTERN = /^golden-[a-z0-9](?:[a-z0-9-]{0,47})$/u;
const GOLDEN_FILE_PATTERN = /^golden-[a-z0-9](?:[a-z0-9-]{0,47})\.json$/u;
const EVIDENCE_ID_PATTERN = /^sheet-[0-9]{2,3}$/u;

type JsonRecord = Record<string, unknown>;

export interface P0SummaryValueEvidence {
  readonly kind: "SUMMARY_VALUE";
  readonly metric: SummaryMetric;
  readonly condition: "EXACT" | "MINIMUM";
  readonly expected: number;
}

export interface P0SummaryDeltaEvidence {
  readonly kind: "SUMMARY_DELTA_MINIMUM";
  readonly leftMetric: SummaryMetric;
  readonly rightMetric: SummaryMetric;
  readonly minimum: number;
}

export type P0FeatureEvidence =
  | {
      readonly feature: P0FormatFeature;
      readonly assertion:
        | P0SummaryValueEvidence
        | P0SummaryDeltaEvidence;
    };

export interface P0ExpectedComparison {
  readonly netlistSha256: string;
  readonly reportSha256: string;
  readonly formatVersion: "2.0.0";
  readonly componentCount: number;
  readonly pinEntryCount: number;
  readonly connectedPinEntryCount: number;
  readonly unconnectedPinEntryCount: number;
  readonly candidateTupleCount: number;
  readonly truthTupleCount: number;
  readonly matchedTupleCount: number;
  readonly missingInCandidateCount: number;
  readonly unexpectedCandidateCount: number;
  readonly excludedCandidatePinCount: number;
  readonly officialNetlistComparison:
    | "EXACT_SET_MATCH"
    | "DIFFERENCES_FOUND"
    | "DUPLICATE_TUPLES";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly projectBinding: "NOT_VERIFIED";
  readonly electricalTruth: "NOT_VERIFIED";
}

export interface P0FormatMatrixEntry {
  readonly fixtureId: string;
  readonly goldenManifestFile: string;
  readonly goldenManifestSha256: string;
  readonly featureEvidence: readonly P0FeatureEvidence[];
  readonly expectedComparison: P0ExpectedComparison;
  readonly expectedArtifacts: P0ExpectedArtifacts;
}

export interface P0FormatMatrix {
  readonly schemaVersion: typeof P0_FORMAT_MATRIX_SCHEMA_VERSION;
  readonly matrixId: string;
  readonly requiredFeatures: readonly P0FormatFeature[];
  readonly entries: readonly P0FormatMatrixEntry[];
}

export interface P0FormatMatrixBinding {
  readonly fixtureId: string;
  readonly projectPath: string;
  readonly netlistPath: string;
  readonly bomPath: string;
  readonly referenceScreenshots: readonly P0ReferenceScreenshotBinding[];
}

export interface P0ReferenceScreenshotBinding {
  readonly evidenceId: string;
  readonly path: string;
}

export interface P0FormatMatrixBindings {
  readonly schemaVersion: typeof P0_FORMAT_MATRIX_SCHEMA_VERSION;
  readonly matrixId: string;
  readonly entries: readonly P0FormatMatrixBinding[];
}

export interface P0FormatMatrixMismatch {
  readonly field: string;
  readonly expected: string | number;
  readonly actual: string | number;
}

export interface P0FormatMatrixEntryResult {
  readonly fixtureId: string;
  readonly goldenManifestSha256: string;
  readonly sourceSha256: string;
  readonly irSha256: string;
  readonly netlistSha256: string;
  readonly reportSha256: string;
  readonly bomSha256: string;
  readonly bomLineItemCount: number;
  readonly bomDesignatorCount: number;
  readonly referenceScreenshotCount: number;
  readonly componentTableSha256: string;
  readonly pinNetworkTableSha256: string;
  readonly featureEvidenceVerified: number;
  readonly candidateTupleCount: number;
  readonly truthTupleCount: number;
  readonly matchedTupleCount: number;
  readonly missingInCandidateCount: number;
  readonly unexpectedCandidateCount: number;
  readonly officialNetlistComparison:
    | "EXACT_SET_MATCH"
    | "DIFFERENCES_FOUND"
    | "DUPLICATE_TUPLES";
  readonly electricalTruth: "NOT_VERIFIED";
}

export interface P0ExpectedBom {
  readonly format: "JLCEDA_PRO_BOM_UTF16LE_TSV";
  readonly sha256: string;
  readonly bytes: number;
  readonly lineItemCount: number;
  readonly quantityTotal: number;
  readonly designatorCount: number;
  readonly designatorTableSha256: string;
  readonly rowTableSha256: string;
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly projectBinding: "NOT_VERIFIED";
}

export interface P0ExpectedScreenshot {
  readonly evidenceId: string;
  readonly format: "PNG";
  readonly sha256: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly acquisitionMethod: "USER_CAPTURED_GUI";
}

export interface P0ExpectedTable {
  readonly source:
    | "JLCEDA_PRO_ENET_V2_COMPONENTS"
    | "JLCEDA_PRO_ENET_V2_CONNECTED_PINS";
  readonly rowCount: number;
  readonly sha256: string;
}

export interface P0ExpectedArtifacts {
  readonly bom: P0ExpectedBom;
  readonly referenceScreenshots: readonly P0ExpectedScreenshot[];
  readonly expectedTables: {
    readonly componentTable: P0ExpectedTable;
    readonly pinNetworkTable: P0ExpectedTable;
  };
}

export interface P0FormatMatrixVerificationResult {
  readonly ok: boolean;
  readonly gate:
    | "P0_FORMAT_MATRIX_ENTRIES_VERIFIED"
    | "P0_FORMAT_MATRIX_MISMATCH";
  readonly matrixId: string;
  readonly matrixSha256: string;
  readonly entryCount: number;
  readonly verifiedEntryCount: number;
  readonly targetEntryRange: {
    readonly minimum: typeof P0_FORMAT_MATRIX_TARGET_MINIMUM;
    readonly maximum: typeof P0_FORMAT_MATRIX_TARGET_MAXIMUM;
  };
  readonly requiredFeatureCoverage: {
    readonly covered: number;
    readonly total: number;
    readonly coveredFeatures: readonly P0FormatFeature[];
    readonly gaps: readonly P0FormatFeature[];
  };
  readonly p0ExitCriteria:
    | "MET"
    | "NOT_MET_ENTRY_COUNT"
    | "NOT_MET_REQUIRED_FEATURE_GAPS"
    | "NOT_MET_MATRIX_MISMATCH";
  readonly results: readonly P0FormatMatrixEntryResult[];
  readonly mismatchCount: number;
  readonly mismatches: readonly P0FormatMatrixMismatch[];
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly projectBinding: "NOT_VERIFIED";
  readonly electricalTruth: "NOT_VERIFIED";
}

function invalid(message: string, cause?: unknown): never {
  throw new AppError(
    ERROR_CODES.P0_FORMAT_MATRIX_INVALID,
    message,
    cause === undefined ? {} : { cause }
  );
}

function isObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, field: string): JsonRecord {
  if (!isObject(value)) invalid(`${field} 必须是对象。`);
  return value;
}

function exactKeys(
  value: Readonly<JsonRecord>,
  expected: readonly string[],
  field: string
): void {
  const actual = Object.keys(value).sort();
  const normalized = [...expected].sort();
  if (
    actual.length !== normalized.length ||
    actual.some((key, index) => key !== normalized[index])
  ) {
    invalid(`${field} 字段集合不符合 P0 格式矩阵契约。`);
  }
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    invalid(`${field} 必须是非空且不超过安全限额的字符串。`);
  }
  return value;
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${field} 必须是非负安全整数。`);
  }
  return value as number;
}

function positiveCount(value: unknown, field: string): number {
  const parsed = count(value, field);
  if (parsed < 1) invalid(`${field} 必须是正整数。`);
  return parsed;
}

function sha256(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!SHA256_PATTERN.test(parsed)) invalid(`${field} 必须是小写 SHA-256。`);
  return parsed;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(`${field} 不在允许值集合中。`);
  }
  return value as T;
}

function assertJsonStructure(text: string): void {
  const stack: Array<
    | { readonly type: "array" }
    | { readonly type: "object"; readonly keys: Set<string> }
  > = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "\"") {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < text.length) {
        const current = text[index];
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === "\"") {
          break;
        }
        index += 1;
      }
      if (index >= text.length) invalid("P0 格式矩阵包含未闭合字符串。");
      const end = index + 1;
      let next = end;
      while (next < text.length && /\s/u.test(text[next] ?? "")) next += 1;
      const parent = stack[stack.length - 1];
      if (parent?.type === "object" && text[next] === ":") {
        let key: unknown;
        try {
          key = JSON.parse(text.slice(start, end)) as unknown;
        } catch (error) {
          invalid("P0 格式矩阵包含非法对象键。", error);
        }
        if (typeof key !== "string" || parent.keys.has(key)) {
          invalid("P0 格式矩阵包含重复或非法对象键。");
        }
        parent.keys.add(key);
      }
      index = end;
      continue;
    }
    if (character === "{") {
      stack.push({ type: "object", keys: new Set<string>() });
    } else if (character === "[") {
      stack.push({ type: "array" });
    } else if (character === "}" || character === "]") {
      stack.pop();
    }
    if (stack.length > MAX_JSON_DEPTH) {
      invalid("P0 格式矩阵 JSON 嵌套深度超过安全限额。");
    }
    index += 1;
  }
}

async function readStrictJson(inputPath: string): Promise<unknown> {
  let metadata;
  try {
    metadata = await lstat(inputPath);
  } catch (error) {
    invalid("无法读取 P0 格式矩阵输入文件。", error);
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_JSON_BYTES
  ) {
    invalid(
      "P0 格式矩阵输入必须是非空、非符号链接且不超过 512 KiB 的普通文件。"
    );
  }
  let handle;
  try {
    handle = await open(
      inputPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const openedMetadata = await handle.stat();
    if (
      !openedMetadata.isFile() ||
      openedMetadata.size !== metadata.size
    ) {
      invalid("P0 格式矩阵输入在打开期间发生变化。");
    }
    const buffer = Buffer.alloc(metadata.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const finalMetadata = await handle.stat();
    if (
      bytesRead !== metadata.size ||
      finalMetadata.size !== metadata.size
    ) {
      invalid("P0 格式矩阵输入读取长度发生变化。");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    assertJsonStructure(text);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalid("P0 格式矩阵输入不是安全、有效的 UTF-8 JSON。", error);
  } finally {
    await handle?.close();
  }
}

function parseMetric(value: unknown, field: string): SummaryMetric {
  return oneOf(value, SUMMARY_METRICS, field);
}

function assertMetricAllowed(
  feature: P0FormatFeature,
  metric: SummaryMetric,
  field: string
): void {
  const allowed = FEATURE_METRIC_RULES[feature as keyof typeof FEATURE_METRIC_RULES];
  if (allowed === undefined || !(allowed as readonly string[]).includes(metric)) {
    invalid(`${field} 不能用该摘要字段证明指定格式特性。`);
  }
}

function parseFeatureEvidence(
  value: unknown,
  index: number
): P0FeatureEvidence {
  const field = `entries[].featureEvidence[${index}]`;
  const record = object(value, field);
  exactKeys(record, ["feature", "assertion"], field);
  const feature = oneOf(record.feature, P0_FORMAT_FEATURES, `${field}.feature`);
  const assertion = object(record.assertion, `${field}.assertion`);
  const kind = assertion.kind;
  if (kind === "SUMMARY_VALUE") {
    exactKeys(
      assertion,
      ["kind", "metric", "condition", "expected"],
      `${field}.assertion`
    );
    const metric = parseMetric(assertion.metric, `${field}.assertion.metric`);
    assertMetricAllowed(feature, metric, field);
    const condition = oneOf(
      assertion.condition,
      ["EXACT", "MINIMUM"] as const,
      `${field}.assertion.condition`
    );
    const expected = count(assertion.expected, `${field}.assertion.expected`);
    if (condition === "MINIMUM" && expected < 1) {
      invalid(`${field}.assertion.expected 的最小值必须至少为 1。`);
    }
    return {
      feature,
      assertion: { kind, metric, condition, expected }
    };
  }
  if (kind === "SUMMARY_DELTA_MINIMUM") {
    exactKeys(
      assertion,
      ["kind", "leftMetric", "rightMetric", "minimum"],
      `${field}.assertion`
    );
    const leftMetric = parseMetric(
      assertion.leftMetric,
      `${field}.assertion.leftMetric`
    );
    const rightMetric = parseMetric(
      assertion.rightMetric,
      `${field}.assertion.rightMetric`
    );
    assertMetricAllowed(feature, leftMetric, field);
    assertMetricAllowed(feature, rightMetric, field);
    const minimum = count(assertion.minimum, `${field}.assertion.minimum`);
    if (minimum < 1 || leftMetric === rightMetric) {
      invalid(`${field}.assertion 必须比较不同字段且最小差值至少为 1。`);
    }
    return {
      feature,
      assertion: {
        kind,
        leftMetric,
        rightMetric,
        minimum
      }
    };
  }
  invalid(`${field}.assertion.kind 不受支持。`);
}

function parseExpectedComparison(value: unknown): P0ExpectedComparison {
  const record = object(value, "entries[].expectedComparison");
  exactKeys(
    record,
    [
      "netlistSha256",
      "reportSha256",
      "formatVersion",
      "componentCount",
      "pinEntryCount",
      "connectedPinEntryCount",
      "unconnectedPinEntryCount",
      "candidateTupleCount",
      "truthTupleCount",
      "matchedTupleCount",
      "missingInCandidateCount",
      "unexpectedCandidateCount",
      "excludedCandidatePinCount",
      "officialNetlistComparison",
      "sourceAuthenticity",
      "projectBinding",
      "electricalTruth"
    ],
    "entries[].expectedComparison"
  );
  if (record.formatVersion !== "2.0.0") {
    invalid("expectedComparison.formatVersion 必须是 2.0.0。");
  }
  if (
    record.sourceAuthenticity !== "NOT_VERIFIED" ||
    record.projectBinding !== "NOT_VERIFIED" ||
    record.electricalTruth !== "NOT_VERIFIED"
  ) {
    invalid("P0 GUI 网表矩阵不得升级来源、工程绑定或电气真值门禁。");
  }
  const parsed: P0ExpectedComparison = {
    netlistSha256: sha256(
      record.netlistSha256,
      "expectedComparison.netlistSha256"
    ),
    reportSha256: sha256(
      record.reportSha256,
      "expectedComparison.reportSha256"
    ),
    formatVersion: "2.0.0",
    componentCount: count(
      record.componentCount,
      "expectedComparison.componentCount"
    ),
    pinEntryCount: count(
      record.pinEntryCount,
      "expectedComparison.pinEntryCount"
    ),
    connectedPinEntryCount: count(
      record.connectedPinEntryCount,
      "expectedComparison.connectedPinEntryCount"
    ),
    unconnectedPinEntryCount: count(
      record.unconnectedPinEntryCount,
      "expectedComparison.unconnectedPinEntryCount"
    ),
    candidateTupleCount: count(
      record.candidateTupleCount,
      "expectedComparison.candidateTupleCount"
    ),
    truthTupleCount: count(
      record.truthTupleCount,
      "expectedComparison.truthTupleCount"
    ),
    matchedTupleCount: count(
      record.matchedTupleCount,
      "expectedComparison.matchedTupleCount"
    ),
    missingInCandidateCount: count(
      record.missingInCandidateCount,
      "expectedComparison.missingInCandidateCount"
    ),
    unexpectedCandidateCount: count(
      record.unexpectedCandidateCount,
      "expectedComparison.unexpectedCandidateCount"
    ),
    excludedCandidatePinCount: count(
      record.excludedCandidatePinCount,
      "expectedComparison.excludedCandidatePinCount"
    ),
    officialNetlistComparison: oneOf(
      record.officialNetlistComparison,
      ["EXACT_SET_MATCH", "DIFFERENCES_FOUND", "DUPLICATE_TUPLES"] as const,
      "expectedComparison.officialNetlistComparison"
    ),
    sourceAuthenticity: "NOT_VERIFIED",
    projectBinding: "NOT_VERIFIED",
    electricalTruth: "NOT_VERIFIED"
  };
  if (
    parsed.connectedPinEntryCount + parsed.unconnectedPinEntryCount !==
    parsed.pinEntryCount
  ) {
    invalid("expectedComparison 网表引脚分类总数不守恒。");
  }
  if (
    parsed.matchedTupleCount + parsed.missingInCandidateCount !==
      parsed.truthTupleCount ||
    parsed.matchedTupleCount + parsed.unexpectedCandidateCount !==
      parsed.candidateTupleCount
  ) {
    invalid("expectedComparison 双向集合计数不守恒。");
  }
  return parsed;
}

function parseExpectedBom(value: unknown): P0ExpectedBom {
  const field = "entries[].expectedArtifacts.bom";
  const record = object(value, field);
  exactKeys(
    record,
    [
      "format",
      "sha256",
      "bytes",
      "lineItemCount",
      "quantityTotal",
      "designatorCount",
      "designatorTableSha256",
      "rowTableSha256",
      "sourceAuthenticity",
      "projectBinding"
    ],
    field
  );
  if (
    record.format !== "JLCEDA_PRO_BOM_UTF16LE_TSV" ||
    record.sourceAuthenticity !== "NOT_VERIFIED" ||
    record.projectBinding !== "NOT_VERIFIED"
  ) {
    invalid("P0 BOM 必须使用已验证格式适配器并保留两项未验证门禁。");
  }
  const parsed: P0ExpectedBom = {
    format: "JLCEDA_PRO_BOM_UTF16LE_TSV",
    sha256: sha256(record.sha256, `${field}.sha256`),
    bytes: positiveCount(record.bytes, `${field}.bytes`),
    lineItemCount: positiveCount(
      record.lineItemCount,
      `${field}.lineItemCount`
    ),
    quantityTotal: positiveCount(
      record.quantityTotal,
      `${field}.quantityTotal`
    ),
    designatorCount: positiveCount(
      record.designatorCount,
      `${field}.designatorCount`
    ),
    designatorTableSha256: sha256(
      record.designatorTableSha256,
      `${field}.designatorTableSha256`
    ),
    rowTableSha256: sha256(
      record.rowTableSha256,
      `${field}.rowTableSha256`
    ),
    sourceAuthenticity: "NOT_VERIFIED",
    projectBinding: "NOT_VERIFIED"
  };
  if (parsed.quantityTotal !== parsed.designatorCount) {
    invalid("P0 BOM 数量总和必须与唯一位号数一致。");
  }
  return parsed;
}

function parseExpectedScreenshot(
  value: unknown,
  index: number
): P0ExpectedScreenshot {
  const field = `entries[].expectedArtifacts.referenceScreenshots[${index}]`;
  const record = object(value, field);
  exactKeys(
    record,
    [
      "evidenceId",
      "format",
      "sha256",
      "bytes",
      "width",
      "height",
      "acquisitionMethod"
    ],
    field
  );
  const evidenceId = string(record.evidenceId, `${field}.evidenceId`);
  if (!EVIDENCE_ID_PATTERN.test(evidenceId)) {
    invalid(`${field}.evidenceId 必须是匿名 sheet-NN 标识。`);
  }
  if (
    record.format !== "PNG" ||
    record.acquisitionMethod !== "USER_CAPTURED_GUI"
  ) {
    invalid(`${field} 只接受用户界面采集的 PNG 参考截图。`);
  }
  return {
    evidenceId,
    format: "PNG",
    sha256: sha256(record.sha256, `${field}.sha256`),
    bytes: positiveCount(record.bytes, `${field}.bytes`),
    width: positiveCount(record.width, `${field}.width`),
    height: positiveCount(record.height, `${field}.height`),
    acquisitionMethod: "USER_CAPTURED_GUI"
  };
}

function parseExpectedTable(
  value: unknown,
  field: string,
  source: P0ExpectedTable["source"]
): P0ExpectedTable {
  const record = object(value, field);
  exactKeys(record, ["source", "rowCount", "sha256"], field);
  if (record.source !== source) {
    invalid(`${field}.source 与固定预期表来源不一致。`);
  }
  return {
    source,
    rowCount: count(record.rowCount, `${field}.rowCount`),
    sha256: sha256(record.sha256, `${field}.sha256`)
  };
}

function parseExpectedArtifacts(value: unknown): P0ExpectedArtifacts {
  const field = "entries[].expectedArtifacts";
  const record = object(value, field);
  exactKeys(record, ["bom", "referenceScreenshots", "expectedTables"], field);
  if (
    !Array.isArray(record.referenceScreenshots) ||
    record.referenceScreenshots.length < 1 ||
    record.referenceScreenshots.length > 16
  ) {
    invalid("每个 P0 样本必须包含 1 到 16 张参考截图。");
  }
  const referenceScreenshots = record.referenceScreenshots.map(
    (item, index) => parseExpectedScreenshot(item, index)
  );
  const screenshotIds = referenceScreenshots.map((item) => item.evidenceId);
  if (
    new Set(screenshotIds).size !== screenshotIds.length ||
    canonicalJson(screenshotIds) !== canonicalJson([...screenshotIds].sort())
  ) {
    invalid("参考截图必须按唯一 evidenceId 排序。");
  }
  const expectedTables = object(
    record.expectedTables,
    `${field}.expectedTables`
  );
  exactKeys(
    expectedTables,
    ["componentTable", "pinNetworkTable"],
    `${field}.expectedTables`
  );
  return {
    bom: parseExpectedBom(record.bom),
    referenceScreenshots,
    expectedTables: {
      componentTable: parseExpectedTable(
        expectedTables.componentTable,
        `${field}.expectedTables.componentTable`,
        "JLCEDA_PRO_ENET_V2_COMPONENTS"
      ),
      pinNetworkTable: parseExpectedTable(
        expectedTables.pinNetworkTable,
        `${field}.expectedTables.pinNetworkTable`,
        "JLCEDA_PRO_ENET_V2_CONNECTED_PINS"
      )
    }
  };
}

function parseEntry(value: unknown, index: number): P0FormatMatrixEntry {
  const field = `entries[${index}]`;
  const record = object(value, field);
  exactKeys(
    record,
    [
      "fixtureId",
      "goldenManifestFile",
      "goldenManifestSha256",
      "featureEvidence",
      "expectedComparison",
      "expectedArtifacts"
    ],
    field
  );
  const fixtureId = string(record.fixtureId, `${field}.fixtureId`);
  if (!FIXTURE_ID_PATTERN.test(fixtureId)) {
    invalid(`${field}.fixtureId 不符合匿名黄金样本编号规则。`);
  }
  const goldenManifestFile = string(
    record.goldenManifestFile,
    `${field}.goldenManifestFile`
  );
  if (
    !GOLDEN_FILE_PATTERN.test(goldenManifestFile) ||
    goldenManifestFile !== `${fixtureId}.json`
  ) {
    invalid(`${field}.goldenManifestFile 必须与 fixtureId 精确对应。`);
  }
  if (!Array.isArray(record.featureEvidence)) {
    invalid(`${field}.featureEvidence 必须是数组。`);
  }
  const featureEvidence = record.featureEvidence.map((item, evidenceIndex) =>
    parseFeatureEvidence(item, evidenceIndex)
  );
  const features = featureEvidence.map((item) => item.feature);
  if (new Set(features).size !== features.length) {
    invalid(`${field}.featureEvidence 不能重复声明特性。`);
  }
  const sortedFeatures = [...features].sort();
  if (canonicalJson(features) !== canonicalJson(sortedFeatures)) {
    invalid(`${field}.featureEvidence 必须按特性机器令牌排序。`);
  }
  return {
    fixtureId,
    goldenManifestFile,
    goldenManifestSha256: sha256(
      record.goldenManifestSha256,
      `${field}.goldenManifestSha256`
    ),
    featureEvidence,
    expectedComparison: parseExpectedComparison(record.expectedComparison),
    expectedArtifacts: parseExpectedArtifacts(record.expectedArtifacts)
  };
}

export function parseP0FormatMatrix(value: unknown): P0FormatMatrix {
  const root = object(value, "matrix");
  exactKeys(root, ["schemaVersion", "matrixId", "requiredFeatures", "entries"], "matrix");
  if (root.schemaVersion !== P0_FORMAT_MATRIX_SCHEMA_VERSION) {
    invalid(`matrix.schemaVersion 必须是 ${P0_FORMAT_MATRIX_SCHEMA_VERSION}。`);
  }
  const matrixId = string(root.matrixId, "matrix.matrixId");
  if (!MATRIX_ID_PATTERN.test(matrixId)) {
    invalid("matrix.matrixId 必须使用 p0- 前缀和稳定小写机器标识。");
  }
  if (!Array.isArray(root.requiredFeatures)) {
    invalid("matrix.requiredFeatures 必须是数组。");
  }
  const requiredFeatures = root.requiredFeatures.map((item, index) =>
    oneOf(item, P0_FORMAT_FEATURES, `matrix.requiredFeatures[${index}]`)
  );
  if (canonicalJson(requiredFeatures) !== canonicalJson(P0_REQUIRED_FEATURES)) {
    invalid("matrix.requiredFeatures 必须与产品规格的 20 项 P0 特性完全一致。");
  }
  if (!Array.isArray(root.entries)) invalid("matrix.entries 必须是数组。");
  if (
    root.entries.length < 1 ||
    root.entries.length > P0_FORMAT_MATRIX_TARGET_MAXIMUM
  ) {
    invalid(`matrix.entries 必须包含 1 到 ${P0_FORMAT_MATRIX_TARGET_MAXIMUM} 个条目。`);
  }
  const entries = root.entries.map((item, index) => parseEntry(item, index));
  const fixtureIds = entries.map((entry) => entry.fixtureId);
  if (
    new Set(fixtureIds).size !== fixtureIds.length ||
    canonicalJson(fixtureIds) !== canonicalJson([...fixtureIds].sort())
  ) {
    invalid("matrix.entries 必须按唯一 fixtureId 排序。");
  }
  return {
    schemaVersion: P0_FORMAT_MATRIX_SCHEMA_VERSION,
    matrixId,
    requiredFeatures,
    entries
  };
}

function parseBinding(value: unknown, index: number): P0FormatMatrixBinding {
  const field = `bindings.entries[${index}]`;
  const record = object(value, field);
  exactKeys(
    record,
    [
      "fixtureId",
      "projectPath",
      "netlistPath",
      "bomPath",
      "referenceScreenshots"
    ],
    field
  );
  const fixtureId = string(record.fixtureId, `${field}.fixtureId`);
  if (!FIXTURE_ID_PATTERN.test(fixtureId)) {
    invalid(`${field}.fixtureId 不符合匿名黄金样本编号规则。`);
  }
  const projectPath = string(record.projectPath, `${field}.projectPath`);
  const netlistPath = string(record.netlistPath, `${field}.netlistPath`);
  const bomPath = string(record.bomPath, `${field}.bomPath`);
  if (
    !isAbsolute(projectPath) ||
    extname(projectPath).toLowerCase() !== ".epro2"
  ) {
    invalid(`${field}.projectPath 必须是绝对 .epro2 路径。`);
  }
  if (!isAbsolute(netlistPath) || extname(netlistPath).toLowerCase() !== ".enet") {
    invalid(`${field}.netlistPath 必须是绝对 .enet 路径。`);
  }
  if (!isAbsolute(bomPath) || extname(bomPath).toLowerCase() !== ".csv") {
    invalid(`${field}.bomPath 必须是绝对 .csv 路径。`);
  }
  if (
    !Array.isArray(record.referenceScreenshots) ||
    record.referenceScreenshots.length < 1 ||
    record.referenceScreenshots.length > 16
  ) {
    invalid(`${field}.referenceScreenshots 必须包含 1 到 16 个条目。`);
  }
  const referenceScreenshots = record.referenceScreenshots.map(
    (value, screenshotIndex): P0ReferenceScreenshotBinding => {
      const screenshotField = `${field}.referenceScreenshots[${screenshotIndex}]`;
      const screenshot = object(value, screenshotField);
      exactKeys(screenshot, ["evidenceId", "path"], screenshotField);
      const evidenceId = string(
        screenshot.evidenceId,
        `${screenshotField}.evidenceId`
      );
      const screenshotPath = string(
        screenshot.path,
        `${screenshotField}.path`
      );
      if (!EVIDENCE_ID_PATTERN.test(evidenceId)) {
        invalid(`${screenshotField}.evidenceId 必须是匿名 sheet-NN 标识。`);
      }
      if (
        !isAbsolute(screenshotPath) ||
        extname(screenshotPath).toLowerCase() !== ".png"
      ) {
        invalid(`${screenshotField}.path 必须是绝对 .png 路径。`);
      }
      return { evidenceId, path: screenshotPath };
    }
  );
  const evidenceIds = referenceScreenshots.map((item) => item.evidenceId);
  if (
    new Set(evidenceIds).size !== evidenceIds.length ||
    canonicalJson(evidenceIds) !== canonicalJson([...evidenceIds].sort())
  ) {
    invalid(`${field}.referenceScreenshots 必须按唯一 evidenceId 排序。`);
  }
  return {
    fixtureId,
    projectPath,
    netlistPath,
    bomPath,
    referenceScreenshots
  };
}

export function parseP0FormatMatrixBindings(
  value: unknown
): P0FormatMatrixBindings {
  const root = object(value, "bindings");
  exactKeys(root, ["schemaVersion", "matrixId", "entries"], "bindings");
  if (root.schemaVersion !== P0_FORMAT_MATRIX_SCHEMA_VERSION) {
    invalid(`bindings.schemaVersion 必须是 ${P0_FORMAT_MATRIX_SCHEMA_VERSION}。`);
  }
  const matrixId = string(root.matrixId, "bindings.matrixId");
  if (!MATRIX_ID_PATTERN.test(matrixId)) {
    invalid("bindings.matrixId 不符合稳定机器标识规则。");
  }
  if (!Array.isArray(root.entries)) invalid("bindings.entries 必须是数组。");
  if (
    root.entries.length < 1 ||
    root.entries.length > P0_FORMAT_MATRIX_TARGET_MAXIMUM
  ) {
    invalid(`bindings.entries 必须包含 1 到 ${P0_FORMAT_MATRIX_TARGET_MAXIMUM} 个条目。`);
  }
  const entries = root.entries.map((item, index) => parseBinding(item, index));
  const fixtureIds = entries.map((entry) => entry.fixtureId);
  if (
    new Set(fixtureIds).size !== fixtureIds.length ||
    canonicalJson(fixtureIds) !== canonicalJson([...fixtureIds].sort())
  ) {
    invalid("bindings.entries 必须按唯一 fixtureId 排序。");
  }
  return {
    schemaVersion: P0_FORMAT_MATRIX_SCHEMA_VERSION,
    matrixId,
    entries
  };
}

function metricValue(summary: EdaIrSummary, metric: SummaryMetric): number {
  if (metric === "pinInstancesByEndpointKind.NET_FLAG_PIN") {
    return summary.pinInstancesByEndpointKind.NET_FLAG_PIN;
  }
  return summary[metric];
}

function verifyFeatureEvidence(
  fixtureId: string,
  evidence: P0FeatureEvidence,
  ir: EdaIr,
  mismatches: P0FormatMatrixMismatch[]
): boolean {
  const prefix = `${fixtureId}.featureEvidence.${evidence.feature}`;
  if (evidence.assertion.kind === "SUMMARY_VALUE") {
    const actual = metricValue(ir.summary, evidence.assertion.metric);
    const matches =
      evidence.assertion.condition === "EXACT"
        ? actual === evidence.assertion.expected
        : actual >= evidence.assertion.expected;
    if (!matches) {
      mismatches.push({
        field: `${prefix}.${evidence.assertion.metric}`,
        expected:
          evidence.assertion.condition === "EXACT"
            ? evidence.assertion.expected
            : `>=${evidence.assertion.expected}`,
        actual
      });
    }
    return matches;
  }
  const actual =
    metricValue(ir.summary, evidence.assertion.leftMetric) -
    metricValue(ir.summary, evidence.assertion.rightMetric);
  if (actual < evidence.assertion.minimum) {
    mismatches.push({
      field: `${prefix}.delta`,
      expected: `>=${evidence.assertion.minimum}`,
      actual
    });
    return false;
  }
  return true;
}

function appendComparisonMismatch(
  mismatches: P0FormatMatrixMismatch[],
  field: string,
  expected: string | number,
  actual: string | number
): void {
  if (expected !== actual) mismatches.push({ field, expected, actual });
}

function verifyComparison(
  fixtureId: string,
  expected: P0ExpectedComparison,
  report: ReturnType<typeof buildNetlistComparisonReport>,
  mismatches: P0FormatMatrixMismatch[]
): void {
  const values = [
    ["netlistSha256", expected.netlistSha256, report.netlist.sha256],
    ["reportSha256", expected.reportSha256, report.reportSha256],
    ["formatVersion", expected.formatVersion, report.netlist.formatVersion],
    ["componentCount", expected.componentCount, report.netlist.componentCount],
    ["pinEntryCount", expected.pinEntryCount, report.netlist.pinEntryCount],
    [
      "connectedPinEntryCount",
      expected.connectedPinEntryCount,
      report.netlist.connectedPinEntryCount
    ],
    [
      "unconnectedPinEntryCount",
      expected.unconnectedPinEntryCount,
      report.netlist.unconnectedPinEntryCount
    ],
    [
      "candidateTupleCount",
      expected.candidateTupleCount,
      report.comparison.candidateTupleCount
    ],
    [
      "truthTupleCount",
      expected.truthTupleCount,
      report.comparison.truthTupleCount
    ],
    ["matchedTupleCount", expected.matchedTupleCount, report.comparison.matched.length],
    [
      "missingInCandidateCount",
      expected.missingInCandidateCount,
      report.comparison.missingInCandidate.length
    ],
    [
      "unexpectedCandidateCount",
      expected.unexpectedCandidateCount,
      report.comparison.unexpectedCandidate.length
    ],
    [
      "excludedCandidatePinCount",
      expected.excludedCandidatePinCount,
      report.candidateCompilation.summary.excludedPinInstances
    ],
    [
      "officialNetlistComparison",
      expected.officialNetlistComparison,
      report.comparison.status
    ],
    [
      "sourceAuthenticity",
      expected.sourceAuthenticity,
      report.gates.sourceAuthenticity
    ],
    ["projectBinding", expected.projectBinding, report.gates.projectBinding],
    ["electricalTruth", expected.electricalTruth, report.gates.electricalTruth]
  ] as const;
  for (const [field, expectedValue, actualValue] of values) {
    appendComparisonMismatch(
      mismatches,
      `${fixtureId}.expectedComparison.${field}`,
      expectedValue,
      actualValue
    );
  }
}

function verifyBom(
  fixtureId: string,
  expected: P0ExpectedBom,
  actual: JlcEdaProBom,
  mismatches: P0FormatMatrixMismatch[]
): void {
  const values = [
    ["format", expected.format, actual.format],
    ["sha256", expected.sha256, actual.sha256],
    ["bytes", expected.bytes, actual.bytes],
    ["lineItemCount", expected.lineItemCount, actual.lineItemCount],
    ["quantityTotal", expected.quantityTotal, actual.quantityTotal],
    ["designatorCount", expected.designatorCount, actual.designatorCount],
    [
      "designatorTableSha256",
      expected.designatorTableSha256,
      actual.designatorTableSha256
    ],
    ["rowTableSha256", expected.rowTableSha256, actual.rowTableSha256],
    [
      "sourceAuthenticity",
      expected.sourceAuthenticity,
      actual.sourceAuthenticity
    ],
    ["projectBinding", expected.projectBinding, actual.projectBinding]
  ] as const;
  for (const [field, expectedValue, actualValue] of values) {
    appendComparisonMismatch(
      mismatches,
      `${fixtureId}.expectedArtifacts.bom.${field}`,
      expectedValue,
      actualValue
    );
  }
}

function verifyReferenceScreenshot(
  fixtureId: string,
  expected: P0ExpectedScreenshot,
  actual: P0ReferenceScreenshot,
  mismatches: P0FormatMatrixMismatch[]
): void {
  const values = [
    ["format", expected.format, actual.format],
    ["sha256", expected.sha256, actual.sha256],
    ["bytes", expected.bytes, actual.bytes],
    ["width", expected.width, actual.width],
    ["height", expected.height, actual.height]
  ] as const;
  for (const [field, expectedValue, actualValue] of values) {
    appendComparisonMismatch(
      mismatches,
      `${fixtureId}.expectedArtifacts.referenceScreenshots.${expected.evidenceId}.${field}`,
      expectedValue,
      actualValue
    );
  }
}

function verifyExpectedTables(
  fixtureId: string,
  expected: P0ExpectedArtifacts["expectedTables"],
  componentRefs: readonly string[],
  pinNetworkTuples: readonly unknown[],
  mismatches: P0FormatMatrixMismatch[]
): {
  readonly componentTableSha256: string;
  readonly pinNetworkTableSha256: string;
} {
  const componentTableSha256 = sha256CanonicalJson(componentRefs);
  const pinNetworkTableSha256 = sha256CanonicalJson(pinNetworkTuples);
  appendComparisonMismatch(
    mismatches,
    `${fixtureId}.expectedArtifacts.expectedTables.componentTable.rowCount`,
    expected.componentTable.rowCount,
    componentRefs.length
  );
  appendComparisonMismatch(
    mismatches,
    `${fixtureId}.expectedArtifacts.expectedTables.componentTable.sha256`,
    expected.componentTable.sha256,
    componentTableSha256
  );
  appendComparisonMismatch(
    mismatches,
    `${fixtureId}.expectedArtifacts.expectedTables.pinNetworkTable.rowCount`,
    expected.pinNetworkTable.rowCount,
    pinNetworkTuples.length
  );
  appendComparisonMismatch(
    mismatches,
    `${fixtureId}.expectedArtifacts.expectedTables.pinNetworkTable.sha256`,
    expected.pinNetworkTable.sha256,
    pinNetworkTableSha256
  );
  return { componentTableSha256, pinNetworkTableSha256 };
}

function p0ExitCriteria(
  entryCount: number,
  featureGaps: readonly P0FormatFeature[],
  mismatchCount: number
): P0FormatMatrixVerificationResult["p0ExitCriteria"] {
  if (mismatchCount > 0) return "NOT_MET_MATRIX_MISMATCH";
  if (
    entryCount < P0_FORMAT_MATRIX_TARGET_MINIMUM ||
    entryCount > P0_FORMAT_MATRIX_TARGET_MAXIMUM
  ) {
    return "NOT_MET_ENTRY_COUNT";
  }
  return featureGaps.length === 0 ? "MET" : "NOT_MET_REQUIRED_FEATURE_GAPS";
}

export async function verifyP0FormatMatrix(
  matrixPath: string,
  goldenDirectory: string,
  bindingsPath: string
): Promise<P0FormatMatrixVerificationResult> {
  const [matrixValue, bindingsValue, canonicalGoldenDirectory] =
    await Promise.all([
      readStrictJson(matrixPath),
      readStrictJson(bindingsPath),
      realpath(goldenDirectory).catch((error: unknown) =>
        invalid("无法解析黄金样本清单目录。", error)
      )
    ]);
  const matrix = parseP0FormatMatrix(matrixValue);
  const bindings = parseP0FormatMatrixBindings(bindingsValue);
  if (bindings.matrixId !== matrix.matrixId) {
    invalid("私有绑定的 matrixId 与公开格式矩阵不一致。");
  }
  const matrixFixtureIds = matrix.entries.map((entry) => entry.fixtureId);
  const bindingFixtureIds = bindings.entries.map((entry) => entry.fixtureId);
  if (canonicalJson(matrixFixtureIds) !== canonicalJson(bindingFixtureIds)) {
    invalid("私有绑定必须与公开格式矩阵条目一一对应，不能缺失或增加样本。");
  }
  const bindingByFixture = new Map(
    bindings.entries.map((entry) => [entry.fixtureId, entry])
  );
  const mismatches: P0FormatMatrixMismatch[] = [];
  const results: P0FormatMatrixEntryResult[] = [];
  const coveredFeatures = new Set<P0FormatFeature>();

  for (const entry of matrix.entries) {
    const binding = bindingByFixture.get(entry.fixtureId);
    if (binding === undefined) invalid("私有绑定缺少公开矩阵中的样本。");
    const manifestPath = join(
      canonicalGoldenDirectory,
      entry.goldenManifestFile
    );
    const expectedScreenshotIds =
      entry.expectedArtifacts.referenceScreenshots.map(
        (screenshot) => screenshot.evidenceId
      );
    const bindingScreenshotIds = binding.referenceScreenshots.map(
      (screenshot) => screenshot.evidenceId
    );
    if (
      canonicalJson(expectedScreenshotIds) !==
      canonicalJson(bindingScreenshotIds)
    ) {
      invalid("私有截图绑定必须与公开截图 evidenceId 一一对应。");
    }
    const [manifest, ir, netlist, bom, referenceScreenshots] =
      await Promise.all([
        readGoldenManifest(manifestPath),
        compileProject(binding.projectPath),
        readPrivateNetlist(binding.netlistPath),
        readPrivateBom(binding.bomPath),
        Promise.all(
          binding.referenceScreenshots.map((screenshot) =>
            readP0ReferenceScreenshot(screenshot.path)
          )
        )
      ]);
    if (manifest.fixtureId !== entry.fixtureId) {
      invalid("黄金样本清单 fixtureId 与 P0 格式矩阵不一致。");
    }
    const goldenResult = verifyGoldenIr(manifest, ir);
    appendComparisonMismatch(
      mismatches,
      `${entry.fixtureId}.goldenManifestSha256`,
      entry.goldenManifestSha256,
      goldenResult.manifestSha256
    );
    for (const mismatch of goldenResult.mismatches) {
      mismatches.push({
        field: `${entry.fixtureId}.golden.${mismatch.field}`,
        expected: mismatch.expected,
        actual: mismatch.actual
      });
    }
    let verifiedFeatureEvidence = 0;
    for (const evidence of entry.featureEvidence) {
      if (verifyFeatureEvidence(entry.fixtureId, evidence, ir, mismatches)) {
        coveredFeatures.add(evidence.feature);
        verifiedFeatureEvidence += 1;
      }
    }
    const parsedNetlist = parseJlcEdaProEnet(netlist.bytes);
    const report = buildNetlistComparisonReport(
      ir,
      netlist.bytes,
      parsedNetlist
    );
    verifyComparison(
      entry.fixtureId,
      entry.expectedComparison,
      report,
      mismatches
    );
    verifyBom(
      entry.fixtureId,
      entry.expectedArtifacts.bom,
      bom.parsed,
      mismatches
    );
    for (
      let screenshotIndex = 0;
      screenshotIndex < referenceScreenshots.length;
      screenshotIndex += 1
    ) {
      verifyReferenceScreenshot(
        entry.fixtureId,
        entry.expectedArtifacts.referenceScreenshots[screenshotIndex]!,
        referenceScreenshots[screenshotIndex]!,
        mismatches
      );
    }
    const expectedTableResult = verifyExpectedTables(
      entry.fixtureId,
      entry.expectedArtifacts.expectedTables,
      parsedNetlist.componentRefs,
      parsedNetlist.tuples,
      mismatches
    );
    results.push({
      fixtureId: entry.fixtureId,
      goldenManifestSha256: goldenResult.manifestSha256,
      sourceSha256: ir.source.archiveSha256,
      irSha256: ir.irSha256,
      netlistSha256: report.netlist.sha256,
      reportSha256: report.reportSha256,
      bomSha256: bom.parsed.sha256,
      bomLineItemCount: bom.parsed.lineItemCount,
      bomDesignatorCount: bom.parsed.designatorCount,
      referenceScreenshotCount: referenceScreenshots.length,
      componentTableSha256: expectedTableResult.componentTableSha256,
      pinNetworkTableSha256: expectedTableResult.pinNetworkTableSha256,
      featureEvidenceVerified: verifiedFeatureEvidence,
      candidateTupleCount: report.comparison.candidateTupleCount,
      truthTupleCount: report.comparison.truthTupleCount,
      matchedTupleCount: report.comparison.matched.length,
      missingInCandidateCount: report.comparison.missingInCandidate.length,
      unexpectedCandidateCount:
        report.comparison.unexpectedCandidate.length,
      officialNetlistComparison: report.comparison.status,
      electricalTruth: "NOT_VERIFIED"
    });
  }

  const requiredCovered = P0_REQUIRED_FEATURES.filter((feature) =>
    coveredFeatures.has(feature)
  );
  const featureGaps = P0_REQUIRED_FEATURES.filter(
    (feature) => !coveredFeatures.has(feature)
  );
  const mismatchCount = mismatches.length;
  return {
    ok: mismatchCount === 0,
    gate:
      mismatchCount === 0
        ? "P0_FORMAT_MATRIX_ENTRIES_VERIFIED"
        : "P0_FORMAT_MATRIX_MISMATCH",
    matrixId: matrix.matrixId,
    matrixSha256: sha256CanonicalJson(matrix),
    entryCount: matrix.entries.length,
    verifiedEntryCount:
      mismatchCount === 0 ? matrix.entries.length : 0,
    targetEntryRange: {
      minimum: P0_FORMAT_MATRIX_TARGET_MINIMUM,
      maximum: P0_FORMAT_MATRIX_TARGET_MAXIMUM
    },
    requiredFeatureCoverage: {
      covered: requiredCovered.length,
      total: P0_REQUIRED_FEATURES.length,
      coveredFeatures: requiredCovered,
      gaps: featureGaps
    },
    p0ExitCriteria: p0ExitCriteria(
      matrix.entries.length,
      featureGaps,
      mismatchCount
    ),
    results,
    mismatchCount,
    mismatches,
    sourceAuthenticity: "NOT_VERIFIED",
    projectBinding: "NOT_VERIFIED",
    electricalTruth: "NOT_VERIFIED"
  };
}
