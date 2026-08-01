import path from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAMPLE_ID_PATTERN = /^real-[0-9]{2}$/;
const BASELINE_ID_PATTERN = /^v[0-9]+\.[0-9]+-m[0-9]+(?:-[a-z0-9-]+)?$/;

export const REAL_PROJECT_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;
export const REAL_PROJECT_MANIFEST_LIMITS = {
  maxSamples: 32,
  maxPathLength: 4_096,
  maxBytes: 2 * 1024 * 1024
} as const;

export interface RealProjectComparisonBaseline {
  readonly status:
    | "EXACT_SET_MATCH"
    | "DIFFERENCES_FOUND"
    | "DUPLICATE_TUPLES";
  readonly candidateTupleCount: number;
  readonly truthTupleCount: number;
  readonly matched: number;
  readonly missingInCandidate: number;
  readonly unexpectedCandidate: number;
  readonly candidateDuplicates: number;
  readonly truthDuplicates: number;
  readonly excludedCandidatePins: number;
}

export interface RealProjectHierarchyBaseline {
  readonly instanceDocuments: number;
  readonly instanceContexts: number;
  readonly instanceContextsResolved: number;
  readonly instanceContextsUnresolved: number;
  readonly instanceAttributeOverrides: number;
  readonly instanceAttributeOverridesAppliedToComponents: number;
  readonly instanceAttributeOverridesAppliedToPins: number;
  readonly instanceAttributeOverridesUnresolved: number;
  readonly componentOccurrences: number;
}

export interface RealProjectAssemblyBaseline {
  readonly attributeKey: "Add into BOM";
  readonly dnpValue: "no";
  readonly attributeCount: number;
  readonly explicitDnpCount: number;
  readonly requiredDnpDesignators: readonly string[];
}

export interface RealProjectSampleManifest {
  readonly sampleId: string;
  readonly projectPath: string;
  readonly netlistPath: string;
  readonly sourceSha256: string;
  readonly netlistSha256: string;
  readonly expectedDiagnostics: {
    readonly count: number;
    readonly sha256: string;
  };
  readonly comparisonBaseline: RealProjectComparisonBaseline;
  readonly hierarchyBaseline?: RealProjectHierarchyBaseline;
  readonly assemblyBaseline?: RealProjectAssemblyBaseline;
}

export interface RealProjectManifest {
  readonly schemaVersion: typeof REAL_PROJECT_MANIFEST_SCHEMA_VERSION;
  readonly baselineId: string;
  readonly packageAcceptanceSampleId: string;
  readonly samples: readonly RealProjectSampleManifest[];
}

export class RealProjectManifestError extends Error {
  public readonly code = "REAL_PROJECT_MANIFEST_INVALID" as const;

  public constructor(message: string) {
    super(message);
    this.name = "RealProjectManifestError";
  }
}

function invalid(message: string): never {
  throw new RealProjectManifestError(`真实工程清单无效：${message}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  field: string
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid(`${field} 字段集合不符合 ${REAL_PROJECT_MANIFEST_SCHEMA_VERSION} 契约`);
  }
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${field} 必须是非空字符串`);
  }
  return value;
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${field} 必须是非负安全整数`);
  }
  return value as number;
}

function sha256(value: unknown, field: string): string {
  const result = string(value, field);
  if (!SHA256_PATTERN.test(result)) invalid(`${field} 必须是小写 SHA-256`);
  return result;
}

function privatePath(
  value: unknown,
  extension: ".epro2" | ".enet",
  field: string
): string {
  const result = string(value, field);
  if (
    result.length > REAL_PROJECT_MANIFEST_LIMITS.maxPathLength ||
    !path.isAbsolute(result) ||
    path.extname(result).toLocaleLowerCase("en-US") !== extension
  ) {
    invalid(`${field} 必须是绝对 ${extension} 文件路径`);
  }
  return path.normalize(result);
}

function comparison(
  value: unknown,
  field: string
): RealProjectComparisonBaseline {
  const record = object(value, field);
  const keys = [
    "status",
    "candidateTupleCount",
    "truthTupleCount",
    "matched",
    "missingInCandidate",
    "unexpectedCandidate",
    "candidateDuplicates",
    "truthDuplicates",
    "excludedCandidatePins"
  ] as const;
  exactKeys(record, keys, [], field);
  if (
    record.status !== "EXACT_SET_MATCH" &&
    record.status !== "DIFFERENCES_FOUND" &&
    record.status !== "DUPLICATE_TUPLES"
  ) {
    invalid(`${field}.status 不受支持`);
  }
  const status = record.status as RealProjectComparisonBaseline["status"];
  const result = {
    status,
    candidateTupleCount: count(
      record.candidateTupleCount,
      `${field}.candidateTupleCount`
    ),
    truthTupleCount: count(record.truthTupleCount, `${field}.truthTupleCount`),
    matched: count(record.matched, `${field}.matched`),
    missingInCandidate: count(
      record.missingInCandidate,
      `${field}.missingInCandidate`
    ),
    unexpectedCandidate: count(
      record.unexpectedCandidate,
      `${field}.unexpectedCandidate`
    ),
    candidateDuplicates: count(
      record.candidateDuplicates,
      `${field}.candidateDuplicates`
    ),
    truthDuplicates: count(
      record.truthDuplicates,
      `${field}.truthDuplicates`
    ),
    excludedCandidatePins: count(
      record.excludedCandidatePins,
      `${field}.excludedCandidatePins`
    )
  };
  if (
    result.matched > result.candidateTupleCount ||
    result.matched > result.truthTupleCount
  ) {
    invalid(`${field}.matched 超过候选或网表元组总数`);
  }
  if (
    result.status === "EXACT_SET_MATCH" &&
    (result.candidateTupleCount !== result.truthTupleCount ||
      result.matched !== result.truthTupleCount ||
      result.missingInCandidate !== 0 ||
      result.unexpectedCandidate !== 0 ||
      result.candidateDuplicates !== 0 ||
      result.truthDuplicates !== 0)
  ) {
    invalid(`${field} 的精确匹配状态与计数矛盾`);
  }
  return result;
}

function hierarchy(
  value: unknown,
  field: string
): RealProjectHierarchyBaseline {
  const record = object(value, field);
  const keys = [
    "instanceDocuments",
    "instanceContexts",
    "instanceContextsResolved",
    "instanceContextsUnresolved",
    "instanceAttributeOverrides",
    "instanceAttributeOverridesAppliedToComponents",
    "instanceAttributeOverridesAppliedToPins",
    "instanceAttributeOverridesUnresolved",
    "componentOccurrences"
  ] as const;
  exactKeys(record, keys, [], field);
  const result = Object.fromEntries(
    keys.map((key) => [key, count(record[key], `${field}.${key}`)])
  ) as unknown as RealProjectHierarchyBaseline;
  if (
    result.instanceContextsResolved + result.instanceContextsUnresolved !==
      result.instanceContexts ||
    result.instanceAttributeOverridesAppliedToComponents +
        result.instanceAttributeOverridesAppliedToPins +
        result.instanceAttributeOverridesUnresolved !==
      result.instanceAttributeOverrides
  ) {
    invalid(`${field} 的解析分类计数不守恒`);
  }
  return result;
}

function assembly(
  value: unknown,
  field: string
): RealProjectAssemblyBaseline {
  const record = object(value, field);
  exactKeys(
    record,
    [
      "attributeKey",
      "dnpValue",
      "attributeCount",
      "explicitDnpCount",
      "requiredDnpDesignators"
    ],
    [],
    field
  );
  if (record.attributeKey !== "Add into BOM" || record.dnpValue !== "no") {
    invalid(`${field} 只允许当前实测的 Add into BOM=no 编码`);
  }
  if (!Array.isArray(record.requiredDnpDesignators)) {
    invalid(`${field}.requiredDnpDesignators 必须是数组`);
  }
  const requiredDnpDesignators = record.requiredDnpDesignators.map(
    (item, index) => {
      const result = string(item, `${field}.requiredDnpDesignators[${index}]`);
      if (result.length > 64 || result !== result.trim()) {
        invalid(`${field}.requiredDnpDesignators[${index}] 非法`);
      }
      return result;
    }
  );
  if (new Set(requiredDnpDesignators).size !== requiredDnpDesignators.length) {
    invalid(`${field}.requiredDnpDesignators 包含重复项`);
  }
  const attributeCount = count(record.attributeCount, `${field}.attributeCount`);
  const explicitDnpCount = count(
    record.explicitDnpCount,
    `${field}.explicitDnpCount`
  );
  if (
    explicitDnpCount > attributeCount ||
    requiredDnpDesignators.length > explicitDnpCount
  ) {
    invalid(`${field} 的 DNP 计数不守恒`);
  }
  return {
    attributeKey: "Add into BOM",
    dnpValue: "no",
    attributeCount,
    explicitDnpCount,
    requiredDnpDesignators
  };
}

function sample(value: unknown, index: number): RealProjectSampleManifest {
  const field = `samples[${index}]`;
  const record = object(value, field);
  exactKeys(
    record,
    [
      "sampleId",
      "projectPath",
      "netlistPath",
      "sourceSha256",
      "netlistSha256",
      "expectedDiagnostics",
      "comparisonBaseline"
    ],
    ["hierarchyBaseline", "assemblyBaseline"],
    field
  );
  const sampleId = string(record.sampleId, `${field}.sampleId`);
  if (!SAMPLE_ID_PATTERN.test(sampleId)) {
    invalid(`${field}.sampleId 必须匹配 real-NN`);
  }
  const diagnostics = object(
    record.expectedDiagnostics,
    `${field}.expectedDiagnostics`
  );
  exactKeys(
    diagnostics,
    ["count", "sha256"],
    [],
    `${field}.expectedDiagnostics`
  );
  return {
    sampleId,
    projectPath: privatePath(record.projectPath, ".epro2", `${field}.projectPath`),
    netlistPath: privatePath(record.netlistPath, ".enet", `${field}.netlistPath`),
    sourceSha256: sha256(record.sourceSha256, `${field}.sourceSha256`),
    netlistSha256: sha256(record.netlistSha256, `${field}.netlistSha256`),
    expectedDiagnostics: {
      count: count(diagnostics.count, `${field}.expectedDiagnostics.count`),
      sha256: sha256(
        diagnostics.sha256,
        `${field}.expectedDiagnostics.sha256`
      )
    },
    comparisonBaseline: comparison(
      record.comparisonBaseline,
      `${field}.comparisonBaseline`
    ),
    ...(record.hierarchyBaseline === undefined
      ? {}
      : {
          hierarchyBaseline: hierarchy(
            record.hierarchyBaseline,
            `${field}.hierarchyBaseline`
          )
        }),
    ...(record.assemblyBaseline === undefined
      ? {}
      : {
          assemblyBaseline: assembly(
            record.assemblyBaseline,
            `${field}.assemblyBaseline`
          )
        })
  };
}

export function parseRealProjectManifest(value: unknown): RealProjectManifest {
  const root = object(value, "manifest");
  exactKeys(
    root,
    ["schemaVersion", "baselineId", "packageAcceptanceSampleId", "samples"],
    [],
    "manifest"
  );
  if (root.schemaVersion !== REAL_PROJECT_MANIFEST_SCHEMA_VERSION) {
    invalid(`schemaVersion 必须是 ${REAL_PROJECT_MANIFEST_SCHEMA_VERSION}`);
  }
  const baselineId = string(root.baselineId, "baselineId");
  if (!BASELINE_ID_PATTERN.test(baselineId)) {
    invalid("baselineId 格式非法");
  }
  if (
    !Array.isArray(root.samples) ||
    root.samples.length === 0 ||
    root.samples.length > REAL_PROJECT_MANIFEST_LIMITS.maxSamples
  ) {
    invalid(`samples 必须包含 1 到 ${REAL_PROJECT_MANIFEST_LIMITS.maxSamples} 项`);
  }
  const samples = root.samples.map(sample).sort((left, right) =>
    left.sampleId < right.sampleId ? -1 : left.sampleId > right.sampleId ? 1 : 0
  );
  if (
    new Set(samples.map((item) => item.sampleId)).size !== samples.length ||
    new Set(samples.map((item) => item.projectPath)).size !== samples.length ||
    new Set(samples.map((item) => item.netlistPath)).size !== samples.length
  ) {
    invalid("samples 包含重复 ID、工程路径或网表路径");
  }
  const packageAcceptanceSampleId = string(
    root.packageAcceptanceSampleId,
    "packageAcceptanceSampleId"
  );
  const acceptance = samples.find(
    (item) => item.sampleId === packageAcceptanceSampleId
  );
  if (
    acceptance === undefined ||
    acceptance.hierarchyBaseline === undefined ||
    acceptance.hierarchyBaseline.instanceContextsResolved === 0
  ) {
    invalid("packageAcceptanceSampleId 必须引用含已解析层级实例的样本");
  }
  return {
    schemaVersion: REAL_PROJECT_MANIFEST_SCHEMA_VERSION,
    baselineId,
    packageAcceptanceSampleId,
    samples
  };
}
