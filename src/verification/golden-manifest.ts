import { open } from "node:fs/promises";
import type {
  EdaIr,
  EdaIrSummary,
  IrDiagnostic,
  IrPinEndpointKind
} from "../ir/model.js";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";

export const GOLDEN_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;
export const DEFAULT_GOLDEN_MANIFEST_MAX_BYTES = 1024 * 1024;
export const DEFAULT_GOLDEN_MANIFEST_MAX_JSON_DEPTH = 32;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FIXTURE_ID_PATTERN = /^golden-[a-z0-9](?:[a-z0-9-]{0,47})$/;
const MACHINE_TOKEN_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ENDPOINT_KINDS = [
  "PART_SYMBOL_PIN",
  "BLOCK_SYMBOL_PIN",
  "NET_FLAG_PIN",
  "NET_PORT_PIN",
  "SHEET_SYMBOL_PIN",
  "NONELECTRICAL_SYMBOL_PIN",
  "SHORT_SYMBOL_PIN",
  "UNKNOWN_SYMBOL_PIN"
] as const satisfies readonly IrPinEndpointKind[];
const SUMMARY_KEYS = [
  "documents",
  "projectConfigurations",
  "boards",
  "schematics",
  "schematicPages",
  "schematicAnnotations",
  "schematicAnnotationsWithExplicitText",
  "schematicAnnotationsWithExplicitEmpty",
  "schematicGraphicPrimitives",
  "schematicGraphicPrimitivesInPages",
  "schematicGraphicPrimitivesInSymbols",
  "schematicGraphicPolygons",
  "schematicGraphicRectangles",
  "schematicGraphicArcs",
  "schematicGraphicCircles",
  "schematicGraphicEllipses",
  "schematicGraphicPrimitivesResolvedExactPart",
  "schematicGraphicPrimitivesWithExplicitEmptyPart",
  "schematicGraphicPrimitivesWithPartNotFound",
  "schematicTables",
  "schematicTablesInPages",
  "schematicTablesInSymbols",
  "schematicTableCells",
  "schematicTableCellsWithExplicitText",
  "schematicTableCellsWithExplicitEmpty",
  "schematicTableCellsFromInlineRecords",
  "schematicTableCellsFromSeparateRecords",
  "schematicTableCellsFromBothMatching",
  "schematicTablesResolvedExactPart",
  "schematicTablesWithExplicitEmptyPart",
  "schematicTablesWithPartNotFound",
  "schematicsWithMissingBoard",
  "schematicPagesWithMissingSchematic",
  "projectConfigurationsWithMissingDefaultSheet",
  "hierarchyBrokenReferences",
  "variants",
  "variantsWithMissingSchematic",
  "componentGroups",
  "componentGroupsWithMissingSchematic",
  "componentGroupsWithBrokenParent",
  "componentGroupsWithMissingDirectVariant",
  "componentGroupsWithConflictingMembership",
  "componentGroupVariantIndexes",
  "componentGroupVariantIndexesWithMissingVariant",
  "componentGroupOverrides",
  "variantGroupBrokenReferences",
  "instanceDocuments",
  "instanceContexts",
  "instanceDocumentsWithInvalidPath",
  "instanceContextsWithMissingSchematic",
  "instanceAttributeOverrides",
  "components",
  "componentsWithDesignator",
  "componentsWithDevice",
  "componentsWithSymbol",
  "componentsWithSymbolFromComponentOverride",
  "componentsWithSymbolFromDeviceDefault",
  "componentsWithFootprint",
  "componentsWithFootprintFromComponentOverride",
  "componentsWithFootprintFromDeviceDefault",
  "symbols",
  "symbolParts",
  "symbolTexts",
  "symbolTextsWithExplicitText",
  "symbolTextsWithExplicitEmpty",
  "symbolTextsResolvedExact",
  "symbolTextsWithExplicitEmptyPart",
  "symbolTextsWithPartNotFound",
  "symbolPins",
  "symbolPinsWithNumber",
  "devices",
  "wires",
  "wiresWithExplicitNet",
  "wireSegments",
  "pinInstances",
  "pinInstancesWithUniqueExplicitNetCandidate",
  "pinInstancesWithConflictingExplicitNetCandidates",
  "pinInstancesOnUnlabeledWire",
  "pinInstancesWithDeclaredNoConnect",
  "pinInstancesWithDeclaredNoConnectAndWireContact",
  "pinInstancesWithNoConnectDeclarationConflict",
  "pinInstancesWithInvalidNoConnectDeclaration",
  "pinInstancesWithoutWire",
  "pinInstancesByEndpointKind",
  "shortRelations",
  "shortRelationsReadyExplicitNetPairCandidate",
  "shortRelationsSameExplicitNetCandidate",
  "shortRelationsUnresolvedPinConnectionCandidate",
  "shortRelationsConflictingPinConnectionCandidate",
  "shortRelationsInvalidPinCount",
  "networkEndpointCandidates",
  "networkEndpointCandidatesMatching",
  "networkEndpointCandidatesMismatching",
  "networkEndpointCandidatesMissingDeclaration",
  "networkEndpointCandidatesConflictingDeclaration",
  "networkEndpointCandidatesInvalidDeclarationValue",
  "networkEndpointCandidatesUnresolvedConnection",
  "networkEndpointCandidatesInvalidPinCount",
  "unboundAttributes",
  "unmodeledRecords"
] as const satisfies readonly (keyof EdaIrSummary)[];

export const GOLDEN_ERROR_CODES = {
  MANIFEST_TOO_LARGE: "GOLDEN_MANIFEST_TOO_LARGE",
  MANIFEST_JSON_DEPTH_EXCEEDED: "GOLDEN_MANIFEST_JSON_DEPTH_EXCEEDED",
  MANIFEST_INVALID: "GOLDEN_MANIFEST_INVALID",
  SOURCE_MISMATCH: "GOLDEN_SOURCE_MISMATCH",
  BASELINE_MISMATCH: "GOLDEN_BASELINE_MISMATCH"
} as const;

export type GoldenErrorCode =
  (typeof GOLDEN_ERROR_CODES)[keyof typeof GOLDEN_ERROR_CODES];

export class GoldenVerificationError extends Error {
  public readonly code: GoldenErrorCode;

  public constructor(code: GoldenErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GoldenVerificationError";
    this.code = code;
  }
}

export interface GoldenDiagnostic {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly count: number;
  readonly documentType?: string;
  readonly recordType?: string;
}

export interface GoldenExpected {
  readonly irSchemaVersion: string;
  readonly generatorName: string;
  readonly generatorVersion: string;
  readonly reducedStateSha256: string;
  readonly irSha256: string;
  readonly summary: EdaIrSummary;
  readonly diagnostics: readonly GoldenDiagnostic[];
}

export interface GoldenManifest {
  readonly schemaVersion: typeof GOLDEN_MANIFEST_SCHEMA_VERSION;
  readonly fixtureId: string;
  readonly sourceSha256: string;
  readonly expected: GoldenExpected;
}

export interface GoldenMismatch {
  readonly field: string;
  readonly expected: string | number;
  readonly actual: string | number;
}

export interface GoldenVerificationResult {
  readonly ok: boolean;
  readonly fixtureId: string;
  readonly manifestSha256: string;
  readonly sourceSha256: string;
  readonly irSha256: string;
  readonly electricalTruth: "NOT_VERIFIED";
  readonly mismatchCount: number;
  readonly mismatches: readonly GoldenMismatch[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failInvalid(reason: string): never {
  throw new GoldenVerificationError(
    GOLDEN_ERROR_CODES.MANIFEST_INVALID,
    `黄金样本清单无效：${reason}`
  );
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  field: string
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length > 0 || missing.length > 0) {
    failInvalid(`${field} 字段集合不符合 ${GOLDEN_MANIFEST_SCHEMA_VERSION} 契约`);
  }
}

function requiredObject(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) {
    failInvalid(`${field} 必须是对象`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    failInvalid(`${field} 必须是非空字符串`);
  }
  return value;
}

function requiredSha256(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!SHA256_PATTERN.test(text)) {
    failInvalid(`${field} 必须是小写 SHA-256`);
  }
  return text;
}

function requiredMachineToken(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!MACHINE_TOKEN_PATTERN.test(text)) {
    failInvalid(`${field} 必须是大写机器令牌`);
  }
  return text;
}

function requiredVersion(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!VERSION_PATTERN.test(text)) {
    failInvalid(`${field} 必须是稳定的三段版本号`);
  }
  return text;
}

function requiredCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    failInvalid(`${field} 必须是非负安全整数`);
  }
  return value as number;
}

function parseEndpointCounts(value: unknown): Record<IrPinEndpointKind, number> {
  const record = requiredObject(value, "expected.summary.pinInstancesByEndpointKind");
  assertExactKeys(
    record,
    ENDPOINT_KINDS,
    "expected.summary.pinInstancesByEndpointKind"
  );
  return Object.fromEntries(
    ENDPOINT_KINDS.map((kind) => [
      kind,
      requiredCount(
        record[kind],
        `expected.summary.pinInstancesByEndpointKind.${kind}`
      )
    ])
  ) as Record<IrPinEndpointKind, number>;
}

function parseSummary(value: unknown): EdaIrSummary {
  const record = requiredObject(value, "expected.summary");
  assertExactKeys(record, SUMMARY_KEYS, "expected.summary");
  const summary: Record<string, unknown> = {};
  for (const key of SUMMARY_KEYS) {
    summary[key] =
      key === "pinInstancesByEndpointKind"
        ? parseEndpointCounts(record[key])
        : requiredCount(record[key], `expected.summary.${key}`);
  }
  const parsed = summary as unknown as EdaIrSummary;
  if (
    parsed.schematicGraphicPrimitivesInPages +
      parsed.schematicGraphicPrimitivesInSymbols !==
      parsed.schematicGraphicPrimitives ||
    parsed.schematicGraphicPolygons +
      parsed.schematicGraphicRectangles +
      parsed.schematicGraphicArcs +
      parsed.schematicGraphicCircles +
      parsed.schematicGraphicEllipses !==
      parsed.schematicGraphicPrimitives ||
    parsed.schematicGraphicPrimitivesResolvedExactPart +
      parsed.schematicGraphicPrimitivesWithExplicitEmptyPart +
      parsed.schematicGraphicPrimitivesWithPartNotFound !==
      parsed.schematicGraphicPrimitivesInSymbols
  ) {
    failInvalid("expected.summary 原理图图形分类总数不守恒");
  }
  if (
    parsed.variantsWithMissingSchematic +
      parsed.componentGroupsWithMissingSchematic +
      parsed.componentGroupsWithBrokenParent +
      parsed.componentGroupsWithMissingDirectVariant +
      parsed.componentGroupsWithConflictingMembership +
      parsed.componentGroupVariantIndexesWithMissingVariant !==
    parsed.variantGroupBrokenReferences
  ) {
    failInvalid("expected.summary Variant/元件组断链总数不守恒");
  }
  if (
    parsed.variantsWithMissingSchematic > parsed.variants ||
    parsed.componentGroupsWithMissingSchematic > parsed.componentGroups ||
    parsed.componentGroupsWithBrokenParent > parsed.componentGroups ||
    parsed.componentGroupsWithMissingDirectVariant > parsed.componentGroups ||
    parsed.componentGroupsWithConflictingMembership > parsed.componentGroups ||
    parsed.componentGroupVariantIndexesWithMissingVariant >
      parsed.componentGroupVariantIndexes
  ) {
    failInvalid("expected.summary Variant/元件组断链计数超过对象总数");
  }
  if (
    parsed.instanceContexts + parsed.instanceDocumentsWithInvalidPath !==
    parsed.instanceDocuments
  ) {
    failInvalid("expected.summary INSTANCE 文档分类总数不守恒");
  }
  if (
    parsed.instanceContextsWithMissingSchematic > parsed.instanceContexts
  ) {
    failInvalid("expected.summary INSTANCE 缺失 Schematic 数超过上下文总数");
  }
  if (
    parsed.componentsWithSymbolFromComponentOverride +
      parsed.componentsWithSymbolFromDeviceDefault !==
    parsed.componentsWithSymbol
  ) {
    failInvalid("expected.summary 组件 Symbol 有效绑定来源总数不守恒");
  }
  if (
    parsed.componentsWithFootprintFromComponentOverride +
      parsed.componentsWithFootprintFromDeviceDefault !==
    parsed.componentsWithFootprint
  ) {
    failInvalid("expected.summary 组件 Footprint 有效绑定来源总数不守恒");
  }
  const endpointTotal = ENDPOINT_KINDS.reduce(
    (total, kind) => total + parsed.pinInstancesByEndpointKind[kind],
    0
  );
  if (endpointTotal !== parsed.pinInstances) {
    failInvalid("expected.summary 引脚端点分类总数与 pinInstances 不守恒");
  }
  if (
    parsed.pinInstancesWithDeclaredNoConnectAndWireContact >
    parsed.pinInstancesWithDeclaredNoConnect
  ) {
    failInvalid(
      "expected.summary 接触导线的显式 NO_CONNECT 数不能超过显式 NO_CONNECT 总数"
    );
  }
  const connectionStatusTotal =
    parsed.pinInstancesWithUniqueExplicitNetCandidate +
    parsed.pinInstancesWithConflictingExplicitNetCandidates +
    parsed.pinInstancesOnUnlabeledWire +
    (parsed.pinInstancesWithDeclaredNoConnect -
      parsed.pinInstancesWithDeclaredNoConnectAndWireContact) +
    parsed.pinInstancesWithoutWire;
  if (connectionStatusTotal !== parsed.pinInstances) {
    failInvalid("expected.summary 引脚连接状态分类总数与 pinInstances 不守恒");
  }
  const shortStatusTotal =
    parsed.shortRelationsReadyExplicitNetPairCandidate +
    parsed.shortRelationsSameExplicitNetCandidate +
    parsed.shortRelationsUnresolvedPinConnectionCandidate +
    parsed.shortRelationsConflictingPinConnectionCandidate +
    parsed.shortRelationsInvalidPinCount;
  if (shortStatusTotal !== parsed.shortRelations) {
    failInvalid("expected.summary Short 状态分类总数不守恒");
  }
  const endpointStatusTotal =
    parsed.networkEndpointCandidatesMatching +
    parsed.networkEndpointCandidatesMismatching +
    parsed.networkEndpointCandidatesMissingDeclaration +
    parsed.networkEndpointCandidatesConflictingDeclaration +
    parsed.networkEndpointCandidatesInvalidDeclarationValue +
    parsed.networkEndpointCandidatesUnresolvedConnection +
    parsed.networkEndpointCandidatesInvalidPinCount;
  if (endpointStatusTotal !== parsed.networkEndpointCandidates) {
    failInvalid("expected.summary 网络端点状态分类总数不守恒");
  }
  return parsed;
}

function parseDiagnostic(value: unknown, index: number): GoldenDiagnostic {
  const field = `expected.diagnostics[${index}]`;
  const record = requiredObject(value, field);
  const allowed = ["code", "severity", "count", "documentType", "recordType"];
  const required = ["code", "severity", "count"];
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !(key in record));
  if (unknown.length > 0 || missing.length > 0) {
    failInvalid(`${field} 字段集合不符合契约`);
  }
  const severity = record.severity;
  if (severity !== "warning" && severity !== "error") {
    failInvalid(`${field}.severity 必须是 warning 或 error`);
  }
  const documentType =
    record.documentType === undefined
      ? undefined
      : requiredMachineToken(record.documentType, `${field}.documentType`);
  const recordType =
    record.recordType === undefined
      ? undefined
      : requiredMachineToken(record.recordType, `${field}.recordType`);
  return {
    code: requiredMachineToken(record.code, `${field}.code`),
    severity,
    count: requiredCount(record.count, `${field}.count`),
    ...(documentType === undefined ? {} : { documentType }),
    ...(recordType === undefined ? {} : { recordType })
  };
}

function assertJsonDepth(
  text: string,
  maximumDepth = DEFAULT_GOLDEN_MANIFEST_MAX_JSON_DEPTH
): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
      if (depth > maximumDepth) {
        throw new GoldenVerificationError(
          GOLDEN_ERROR_CODES.MANIFEST_JSON_DEPTH_EXCEEDED,
          "黄金样本清单 JSON 嵌套深度超过安全限额。"
        );
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }
  }
}

export function parseGoldenManifest(value: unknown): GoldenManifest {
  const root = requiredObject(value, "manifest");
  assertExactKeys(
    root,
    ["schemaVersion", "fixtureId", "sourceSha256", "expected"],
    "manifest"
  );
  if (root.schemaVersion !== GOLDEN_MANIFEST_SCHEMA_VERSION) {
    failInvalid(
      `schemaVersion 必须是 ${GOLDEN_MANIFEST_SCHEMA_VERSION}`
    );
  }
  const fixtureId = requiredString(root.fixtureId, "fixtureId");
  if (!FIXTURE_ID_PATTERN.test(fixtureId)) {
    failInvalid("fixtureId 必须使用 golden- 前缀和小写字母、数字或连字符");
  }
  const expected = requiredObject(root.expected, "expected");
  assertExactKeys(
    expected,
    [
      "irSchemaVersion",
      "generatorName",
      "generatorVersion",
      "reducedStateSha256",
      "irSha256",
      "summary",
      "diagnostics"
    ],
    "expected"
  );
  if (!Array.isArray(expected.diagnostics)) {
    failInvalid("expected.diagnostics 必须是数组");
  }
  const manifest: GoldenManifest = {
    schemaVersion: GOLDEN_MANIFEST_SCHEMA_VERSION,
    fixtureId,
    sourceSha256: requiredSha256(root.sourceSha256, "sourceSha256"),
    expected: {
      irSchemaVersion: requiredVersion(
        expected.irSchemaVersion,
        "expected.irSchemaVersion"
      ),
      generatorName:
        requiredString(expected.generatorName, "expected.generatorName") ===
        "@yuanzihao/schemcp"
          ? "@yuanzihao/schemcp"
          : failInvalid("expected.generatorName 与本编译器不一致"),
      generatorVersion: requiredVersion(
        expected.generatorVersion,
        "expected.generatorVersion"
      ),
      reducedStateSha256: requiredSha256(
        expected.reducedStateSha256,
        "expected.reducedStateSha256"
      ),
      irSha256: requiredSha256(expected.irSha256, "expected.irSha256"),
      summary: parseSummary(expected.summary),
      diagnostics: expected.diagnostics.map((item, index) =>
        parseDiagnostic(item, index)
      )
    }
  };
  const normalizedDiagnostics = normalizeDiagnostics(
    manifest.expected.diagnostics
  );
  if (
    canonicalJson(normalizedDiagnostics) !==
    canonicalJson(manifest.expected.diagnostics)
  ) {
    failInvalid("expected.diagnostics 必须按稳定规则排序且不得重复");
  }
  return manifest;
}

export async function readGoldenManifest(
  manifestPath: string,
  maximumBytes = DEFAULT_GOLDEN_MANIFEST_MAX_BYTES
): Promise<GoldenManifest> {
  const handle = await open(manifestPath, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      failInvalid("输入不是普通文件");
    }
    if (metadata.size > maximumBytes) {
      throw new GoldenVerificationError(
        GOLDEN_ERROR_CODES.MANIFEST_TOO_LARGE,
        "黄金样本清单超过安全大小限额。"
      );
    }
    const buffer = Buffer.alloc(metadata.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) {
      failInvalid("读取长度与文件元数据不一致");
    }
    const text = buffer.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buffer)) {
      failInvalid("文件不是有效 UTF-8");
    }
    assertJsonDepth(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new GoldenVerificationError(
        GOLDEN_ERROR_CODES.MANIFEST_INVALID,
        "黄金样本清单不是有效 JSON。",
        { cause: error }
      );
    }
    return parseGoldenManifest(parsed);
  } finally {
    await handle.close();
  }
}

export function normalizeDiagnostics(
  diagnostics: readonly (IrDiagnostic | GoldenDiagnostic)[]
): readonly GoldenDiagnostic[] {
  const byKey = new Map<string, GoldenDiagnostic>();
  for (const diagnostic of diagnostics) {
    const normalized: GoldenDiagnostic = {
      code: diagnostic.code,
      severity: diagnostic.severity,
      count: diagnostic.count,
      ...(diagnostic.documentType === undefined
        ? {}
        : { documentType: diagnostic.documentType }),
      ...(diagnostic.recordType === undefined
        ? {}
        : { recordType: diagnostic.recordType })
    };
    const key = canonicalJson({
      code: normalized.code,
      severity: normalized.severity,
      documentType: normalized.documentType ?? null,
      recordType: normalized.recordType ?? null
    });
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing === undefined
        ? normalized
        : { ...normalized, count: existing.count + normalized.count }
    );
  }
  return [...byKey.values()].sort((left, right) => {
    const leftKey = canonicalJson(left);
    const rightKey = canonicalJson(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function createGoldenManifest(
  fixtureId: string,
  ir: EdaIr
): GoldenManifest {
  return parseGoldenManifest({
    schemaVersion: GOLDEN_MANIFEST_SCHEMA_VERSION,
    fixtureId,
    sourceSha256: ir.source.archiveSha256,
    expected: {
      irSchemaVersion: ir.schemaVersion,
      generatorName: ir.generator.name,
      generatorVersion: ir.generator.version,
      reducedStateSha256: ir.source.reducedStateSha256,
      irSha256: ir.irSha256,
      summary: ir.summary,
      diagnostics: normalizeDiagnostics(ir.diagnostics)
    }
  });
}

function appendMismatch(
  mismatches: GoldenMismatch[],
  field: string,
  expected: string | number,
  actual: string | number
): void {
  mismatches.push({ field, expected, actual });
}

export function verifyGoldenIr(
  manifest: GoldenManifest,
  ir: EdaIr
): GoldenVerificationResult {
  const mismatches: GoldenMismatch[] = [];
  if (manifest.sourceSha256 !== ir.source.archiveSha256) {
    appendMismatch(
      mismatches,
      "sourceSha256",
      manifest.sourceSha256,
      ir.source.archiveSha256
    );
  }
  const scalarExpectations = [
    ["expected.irSchemaVersion", manifest.expected.irSchemaVersion, ir.schemaVersion],
    ["expected.generatorName", manifest.expected.generatorName, ir.generator.name],
    [
      "expected.generatorVersion",
      manifest.expected.generatorVersion,
      ir.generator.version
    ],
    [
      "expected.reducedStateSha256",
      manifest.expected.reducedStateSha256,
      ir.source.reducedStateSha256
    ],
    ["expected.irSha256", manifest.expected.irSha256, ir.irSha256]
  ] as const;
  for (const [field, expected, actual] of scalarExpectations) {
    if (expected !== actual) {
      appendMismatch(mismatches, field, expected, actual);
    }
  }
  for (const key of SUMMARY_KEYS) {
    if (key === "pinInstancesByEndpointKind") {
      for (const kind of ENDPOINT_KINDS) {
        const expected = manifest.expected.summary[key][kind];
        const actual = ir.summary[key][kind];
        if (expected !== actual) {
          appendMismatch(
            mismatches,
            `expected.summary.${key}.${kind}`,
            expected,
            actual
          );
        }
      }
    } else {
      const expected = manifest.expected.summary[key];
      const actual = ir.summary[key];
      if (expected !== actual) {
        appendMismatch(
          mismatches,
          `expected.summary.${key}`,
          expected,
          actual
        );
      }
    }
  }
  const expectedDiagnostics = normalizeDiagnostics(manifest.expected.diagnostics);
  const actualDiagnostics = normalizeDiagnostics(ir.diagnostics);
  if (canonicalJson(expectedDiagnostics) !== canonicalJson(actualDiagnostics)) {
    appendMismatch(
      mismatches,
      "expected.diagnostics",
      sha256CanonicalJson(expectedDiagnostics),
      sha256CanonicalJson(actualDiagnostics)
    );
  }
  return {
    ok: mismatches.length === 0,
    fixtureId: manifest.fixtureId,
    manifestSha256: sha256CanonicalJson(manifest),
    sourceSha256: ir.source.archiveSha256,
    irSha256: ir.irSha256,
    electricalTruth: "NOT_VERIFIED",
    mismatchCount: mismatches.length,
    mismatches
  };
}
