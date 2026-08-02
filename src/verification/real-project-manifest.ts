import path from "node:path";
import type {
  IrComponentRole,
  IrInterfaceType,
  IrResourceEdgeKind,
  IrResourceType
} from "../ir/model.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAMPLE_ID_PATTERN = /^real-[0-9]{2}$/;
const BASELINE_ID_PATTERN = /^v[0-9]+\.[0-9]+-m[0-9]+(?:-[a-z0-9-]+)?$/;

export const REAL_PROJECT_MANIFEST_SCHEMA_VERSION = "1.5.0" as const;
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
  readonly components: number;
  readonly componentsPopulated: number;
  readonly componentsDnp: number;
  readonly componentsAssemblyUnknown: number;
  readonly logicalComponents: number;
  readonly logicalComponentsComplete: number;
  readonly logicalComponentsPartial: number;
  readonly logicalComponentsUnknown: number;
  readonly completeMultiUnitLogicalComponents: number;
  readonly symbolPins: number;
  readonly symbolPinsHidden: number;
}

export interface RealProjectBusBaseline {
  readonly buses: number;
  readonly busesWithExplicitNet: number;
  readonly busesObservedEmbedded: number;
  readonly busesOfficialSeparate: number;
  readonly busesHybrid: number;
  readonly busesWithEmptyEntrySet: number;
  readonly busSegments: number;
  readonly busEntries: number;
  readonly busEntriesEmbedded: number;
  readonly busEntriesSeparate: number;
  readonly busEntriesUnbound: number;
}

export const REAL_PROJECT_COMPONENT_ROLES = [
  "MCU_MPU",
  "POWER_INPUT",
  "LDO",
  "DC_DC",
  "POWER_SWITCH_CANDIDATE",
  "REFERENCE_SOURCE",
  "CRYSTAL_OSCILLATOR",
  "CLOCK_BUFFER_CANDIDATE",
  "MEMORY",
  "TRANSCEIVER",
  "ISOLATOR_CANDIDATE",
  "CONNECTOR",
  "PROTECTION_CANDIDATE",
  "FILTER_CANDIDATE",
  "RESET_SUPERVISOR",
  "BOOT_STRAP",
  "PASSIVE",
  "UNKNOWN"
] as const satisfies readonly IrComponentRole[];

export const REAL_PROJECT_INTERFACE_TYPES = [
  "SWD",
  "JTAG",
  "UART",
  "I2C",
  "SPI",
  "QSPI",
  "CAN",
  "USB",
  "ETHERNET",
  "SDIO",
  "I2S_SAI",
  "ANALOG",
  "GPIO_GROUP"
] as const satisfies readonly IrInterfaceType[];

export const REAL_PROJECT_INTERFACE_MATRIX_KEYS = [
  "candidateActive",
  "candidateExcludedDnp",
  "candidateAssemblyUnknown",
  "partialCandidateActive",
  "partialCandidateExcludedDnp",
  "partialCandidateAssemblyUnknown",
  "unresolvedActive",
  "unresolvedExcludedDnp",
  "unresolvedAssemblyUnknown"
] as const;

export type RealProjectInterfaceMatrix = Readonly<
  Record<(typeof REAL_PROJECT_INTERFACE_MATRIX_KEYS)[number], number>
>;

export interface RealProjectSemanticBaseline {
  readonly componentSemantics: number;
  readonly componentSemanticsUnknownRole: number;
  readonly componentPowerDomainCandidates: number;
  readonly roles: Readonly<Record<IrComponentRole, number>>;
  readonly interfaces: number;
  readonly interfacesByType: Readonly<
    Record<IrInterfaceType, RealProjectInterfaceMatrix>
  >;
  readonly requiredMcuActiveInterfaceTypes?: readonly IrInterfaceType[];
}

export const REAL_PROJECT_RESOURCE_TYPES = [
  "POWER",
  "CLOCK",
  "RESET_BOOT",
  "MCU_PIN"
] as const satisfies readonly IrResourceType[];

export const REAL_PROJECT_RESOURCE_EDGE_KINDS = [
  "POWER_SOURCE_ENTRY",
  "POWER_CONVERSION",
  "POWER_SWITCH_TRANSFER_CANDIDATE",
  "POWER_TRANSFER_CANDIDATE",
  "POWER_LOAD",
  "CLOCK_SOURCE_OUTPUT",
  "CLOCK_BUFFER_INPUT",
  "CLOCK_BUFFER_OUTPUT",
  "CLOCK_SINK_INPUT",
  "RESET_SOURCE_OUTPUT",
  "RESET_EXTERNAL_SOURCE_CANDIDATE",
  "RESET_MANUAL_SOURCE_CANDIDATE",
  "RESET_SINK_INPUT",
  "RESET_BIAS_CANDIDATE",
  "BOOT_STRAP_INPUT",
  "BOOT_BIAS_CANDIDATE",
  "MCU_PIN_CONNECTION"
] as const satisfies readonly IrResourceEdgeKind[];

export interface RealProjectResourceBaseline {
  readonly resourceEdges: number;
  readonly byType: Readonly<Record<IrResourceType, number>>;
  readonly byKind: Readonly<Record<IrResourceEdgeKind, number>>;
  readonly byStatus: {
    readonly candidate: number;
    readonly unresolved: number;
  };
  readonly byActivity: {
    readonly active: number;
    readonly excludedDnp: number;
    readonly assemblyUnknown: number;
  };
  readonly mcuPinUsage: {
    readonly mcuCount: number;
    readonly pins: number;
    readonly usedBoundNetlist: number;
    readonly usedCandidate: number;
    readonly unusedConfirmed: number;
    readonly unknown: number;
    readonly byResourceStatus: {
      readonly used: number;
      readonly explicitNc: number;
      readonly unused: number;
      readonly unknown: number;
      readonly dnpComponent: number;
    };
  };
  readonly requiredKinds?: readonly IrResourceEdgeKind[];
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
  readonly busBaseline?: RealProjectBusBaseline;
  readonly semanticBaseline: RealProjectSemanticBaseline;
  readonly resourceBaseline: RealProjectResourceBaseline;
}

export interface RealProjectManifest {
  readonly schemaVersion: typeof REAL_PROJECT_MANIFEST_SCHEMA_VERSION;
  readonly baselineId: string;
  readonly packageAcceptanceSampleId: string;
  readonly packageAssemblyAcceptanceSampleId: string;
  readonly packageSemanticAcceptanceSampleId: string;
  readonly packageResourceAcceptanceSampleId: string;
  readonly packageMcuPinAcceptanceSampleId: string;
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
      "requiredDnpDesignators",
      "components",
      "componentsPopulated",
      "componentsDnp",
      "componentsAssemblyUnknown",
      "logicalComponents",
      "logicalComponentsComplete",
      "logicalComponentsPartial",
      "logicalComponentsUnknown",
      "completeMultiUnitLogicalComponents",
      "symbolPins",
      "symbolPinsHidden"
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
  const components = count(record.components, `${field}.components`);
  const componentsPopulated = count(
    record.componentsPopulated,
    `${field}.componentsPopulated`
  );
  const componentsDnp = count(record.componentsDnp, `${field}.componentsDnp`);
  const componentsAssemblyUnknown = count(
    record.componentsAssemblyUnknown,
    `${field}.componentsAssemblyUnknown`
  );
  const logicalComponents = count(
    record.logicalComponents,
    `${field}.logicalComponents`
  );
  const logicalComponentsComplete = count(
    record.logicalComponentsComplete,
    `${field}.logicalComponentsComplete`
  );
  const logicalComponentsPartial = count(
    record.logicalComponentsPartial,
    `${field}.logicalComponentsPartial`
  );
  const logicalComponentsUnknown = count(
    record.logicalComponentsUnknown,
    `${field}.logicalComponentsUnknown`
  );
  const completeMultiUnitLogicalComponents = count(
    record.completeMultiUnitLogicalComponents,
    `${field}.completeMultiUnitLogicalComponents`
  );
  const symbolPins = count(record.symbolPins, `${field}.symbolPins`);
  const symbolPinsHidden = count(
    record.symbolPinsHidden,
    `${field}.symbolPinsHidden`
  );
  if (
    componentsPopulated + componentsDnp + componentsAssemblyUnknown !==
      components ||
    logicalComponentsComplete +
        logicalComponentsPartial +
        logicalComponentsUnknown !==
      logicalComponents ||
    completeMultiUnitLogicalComponents > logicalComponentsComplete ||
    symbolPinsHidden > symbolPins
  ) {
    invalid(`${field} 的装配或引脚完整性分类计数不守恒`);
  }
  return {
    attributeKey: "Add into BOM",
    dnpValue: "no",
    attributeCount,
    explicitDnpCount,
    requiredDnpDesignators,
    components,
    componentsPopulated,
    componentsDnp,
    componentsAssemblyUnknown,
    logicalComponents,
    logicalComponentsComplete,
    logicalComponentsPartial,
    logicalComponentsUnknown,
    completeMultiUnitLogicalComponents,
    symbolPins,
    symbolPinsHidden
  };
}

function bus(value: unknown, field: string): RealProjectBusBaseline {
  const record = object(value, field);
  const keys = [
    "buses",
    "busesWithExplicitNet",
    "busesObservedEmbedded",
    "busesOfficialSeparate",
    "busesHybrid",
    "busesWithEmptyEntrySet",
    "busSegments",
    "busEntries",
    "busEntriesEmbedded",
    "busEntriesSeparate",
    "busEntriesUnbound"
  ] as const;
  exactKeys(record, keys, [], field);
  const result = Object.fromEntries(
    keys.map((key) => [key, count(record[key], `${field}.${key}`)])
  ) as unknown as RealProjectBusBaseline;
  if (
    result.busesWithExplicitNet > result.buses ||
    result.busesWithEmptyEntrySet > result.buses ||
    result.busesObservedEmbedded +
        result.busesOfficialSeparate +
        result.busesHybrid !==
      result.buses ||
    result.busEntriesEmbedded + result.busEntriesSeparate !==
      result.busEntries ||
    result.busEntriesUnbound > result.busEntriesSeparate
  ) {
    invalid(`${field} 的 BUS/BUSENTRY 分类计数不守恒`);
  }
  return result;
}

function semantic(
  value: unknown,
  field: string
): RealProjectSemanticBaseline {
  const record = object(value, field);
  exactKeys(
    record,
    [
      "componentSemantics",
      "componentSemanticsUnknownRole",
      "componentPowerDomainCandidates",
      "roles",
      "interfaces",
      "interfacesByType"
    ],
    ["requiredMcuActiveInterfaceTypes"],
    field
  );
  const componentSemantics = count(
    record.componentSemantics,
    `${field}.componentSemantics`
  );
  const componentSemanticsUnknownRole = count(
    record.componentSemanticsUnknownRole,
    `${field}.componentSemanticsUnknownRole`
  );
  const componentPowerDomainCandidates = count(
    record.componentPowerDomainCandidates,
    `${field}.componentPowerDomainCandidates`
  );
  const rolesRecord = object(record.roles, `${field}.roles`);
  exactKeys(rolesRecord, REAL_PROJECT_COMPONENT_ROLES, [], `${field}.roles`);
  const roles = Object.fromEntries(
    REAL_PROJECT_COMPONENT_ROLES.map((role) => [
      role,
      count(rolesRecord[role], `${field}.roles.${role}`)
    ])
  ) as unknown as Readonly<Record<IrComponentRole, number>>;
  if (
    Object.values(roles).reduce((total, value) => total + value, 0) !==
      componentSemantics ||
    roles.UNKNOWN !== componentSemanticsUnknownRole
  ) {
    invalid(`${field} 的组件角色计数不守恒`);
  }

  const interfaces = count(record.interfaces, `${field}.interfaces`);
  const interfaceRecord = object(
    record.interfacesByType,
    `${field}.interfacesByType`
  );
  exactKeys(
    interfaceRecord,
    REAL_PROJECT_INTERFACE_TYPES,
    [],
    `${field}.interfacesByType`
  );
  const interfacesByType = Object.fromEntries(
    REAL_PROJECT_INTERFACE_TYPES.map((type) => {
      const matrixRecord = object(
        interfaceRecord[type],
        `${field}.interfacesByType.${type}`
      );
      exactKeys(
        matrixRecord,
        REAL_PROJECT_INTERFACE_MATRIX_KEYS,
        [],
        `${field}.interfacesByType.${type}`
      );
      const matrix = Object.fromEntries(
        REAL_PROJECT_INTERFACE_MATRIX_KEYS.map((key) => [
          key,
          count(matrixRecord[key], `${field}.interfacesByType.${type}.${key}`)
        ])
      ) as unknown as RealProjectInterfaceMatrix;
      return [type, matrix];
    })
  ) as unknown as Readonly<Record<IrInterfaceType, RealProjectInterfaceMatrix>>;
  const interfaceTotal = Object.values(interfacesByType).reduce(
    (total, matrix) =>
      total + Object.values(matrix).reduce((sum, value) => sum + value, 0),
    0
  );
  if (interfaceTotal !== interfaces) {
    invalid(`${field} 的接口类型和状态计数不守恒`);
  }

  let requiredMcuActiveInterfaceTypes: readonly IrInterfaceType[] | undefined;
  if (record.requiredMcuActiveInterfaceTypes !== undefined) {
    if (!Array.isArray(record.requiredMcuActiveInterfaceTypes)) {
      invalid(`${field}.requiredMcuActiveInterfaceTypes 必须是数组`);
    }
    requiredMcuActiveInterfaceTypes = record.requiredMcuActiveInterfaceTypes.map(
      (value, index) => {
        if (!REAL_PROJECT_INTERFACE_TYPES.includes(value as IrInterfaceType)) {
          invalid(
            `${field}.requiredMcuActiveInterfaceTypes[${index}] 不受支持`
          );
        }
        return value as IrInterfaceType;
      }
    );
    if (
      requiredMcuActiveInterfaceTypes.length === 0 ||
      new Set(requiredMcuActiveInterfaceTypes).size !==
        requiredMcuActiveInterfaceTypes.length
    ) {
      invalid(`${field}.requiredMcuActiveInterfaceTypes 必须非空且无重复`);
    }
  }
  return {
    componentSemantics,
    componentSemanticsUnknownRole,
    componentPowerDomainCandidates,
    roles,
    interfaces,
    interfacesByType,
    ...(requiredMcuActiveInterfaceTypes === undefined
      ? {}
      : { requiredMcuActiveInterfaceTypes })
  };
}

function resource(
  value: unknown,
  field: string
): RealProjectResourceBaseline {
  const record = object(value, field);
  exactKeys(
    record,
    ["resourceEdges", "byType", "byKind", "byStatus", "byActivity", "mcuPinUsage"],
    ["requiredKinds"],
    field
  );
  const resourceEdges = count(record.resourceEdges, `${field}.resourceEdges`);
  const typeRecord = object(record.byType, `${field}.byType`);
  exactKeys(typeRecord, REAL_PROJECT_RESOURCE_TYPES, [], `${field}.byType`);
  const byType = Object.fromEntries(
    REAL_PROJECT_RESOURCE_TYPES.map((type) => [
      type,
      count(typeRecord[type], `${field}.byType.${type}`)
    ])
  ) as unknown as Readonly<Record<IrResourceType, number>>;
  const kindRecord = object(record.byKind, `${field}.byKind`);
  exactKeys(
    kindRecord,
    REAL_PROJECT_RESOURCE_EDGE_KINDS,
    [],
    `${field}.byKind`
  );
  const byKind = Object.fromEntries(
    REAL_PROJECT_RESOURCE_EDGE_KINDS.map((kind) => [
      kind,
      count(kindRecord[kind], `${field}.byKind.${kind}`)
    ])
  ) as unknown as Readonly<Record<IrResourceEdgeKind, number>>;
  const statusRecord = object(record.byStatus, `${field}.byStatus`);
  exactKeys(statusRecord, ["candidate", "unresolved"], [], `${field}.byStatus`);
  const byStatus = {
    candidate: count(statusRecord.candidate, `${field}.byStatus.candidate`),
    unresolved: count(statusRecord.unresolved, `${field}.byStatus.unresolved`)
  };
  const activityRecord = object(record.byActivity, `${field}.byActivity`);
  exactKeys(
    activityRecord,
    ["active", "excludedDnp", "assemblyUnknown"],
    [],
    `${field}.byActivity`
  );
  const byActivity = {
    active: count(activityRecord.active, `${field}.byActivity.active`),
    excludedDnp: count(
      activityRecord.excludedDnp,
      `${field}.byActivity.excludedDnp`
    ),
    assemblyUnknown: count(
      activityRecord.assemblyUnknown,
      `${field}.byActivity.assemblyUnknown`
    )
  };
  const usageRecord = object(record.mcuPinUsage, `${field}.mcuPinUsage`);
  exactKeys(
    usageRecord,
    [
      "mcuCount",
      "pins",
      "usedBoundNetlist",
      "usedCandidate",
      "unusedConfirmed",
      "unknown",
      "byResourceStatus"
    ],
    [],
    `${field}.mcuPinUsage`
  );
  const resourceStatusRecord = object(
    usageRecord.byResourceStatus,
    `${field}.mcuPinUsage.byResourceStatus`
  );
  exactKeys(
    resourceStatusRecord,
    ["used", "explicitNc", "unused", "unknown", "dnpComponent"],
    [],
    `${field}.mcuPinUsage.byResourceStatus`
  );
  const byResourceStatus = {
    used: count(
      resourceStatusRecord.used,
      `${field}.mcuPinUsage.byResourceStatus.used`
    ),
    explicitNc: count(
      resourceStatusRecord.explicitNc,
      `${field}.mcuPinUsage.byResourceStatus.explicitNc`
    ),
    unused: count(
      resourceStatusRecord.unused,
      `${field}.mcuPinUsage.byResourceStatus.unused`
    ),
    unknown: count(
      resourceStatusRecord.unknown,
      `${field}.mcuPinUsage.byResourceStatus.unknown`
    ),
    dnpComponent: count(
      resourceStatusRecord.dnpComponent,
      `${field}.mcuPinUsage.byResourceStatus.dnpComponent`
    )
  };
  const mcuPinUsage = {
    mcuCount: count(usageRecord.mcuCount, `${field}.mcuPinUsage.mcuCount`),
    pins: count(usageRecord.pins, `${field}.mcuPinUsage.pins`),
    usedBoundNetlist: count(
      usageRecord.usedBoundNetlist,
      `${field}.mcuPinUsage.usedBoundNetlist`
    ),
    usedCandidate: count(
      usageRecord.usedCandidate,
      `${field}.mcuPinUsage.usedCandidate`
    ),
    unusedConfirmed: count(
      usageRecord.unusedConfirmed,
      `${field}.mcuPinUsage.unusedConfirmed`
    ),
    unknown: count(usageRecord.unknown, `${field}.mcuPinUsage.unknown`),
    byResourceStatus
  };
  if (
    Object.values(byType).reduce((total, item) => total + item, 0) !== resourceEdges ||
    Object.values(byKind).reduce((total, item) => total + item, 0) !== resourceEdges ||
    byStatus.candidate + byStatus.unresolved !== resourceEdges ||
    byActivity.active + byActivity.excludedDnp + byActivity.assemblyUnknown !==
      resourceEdges ||
    mcuPinUsage.usedBoundNetlist +
        mcuPinUsage.usedCandidate +
        mcuPinUsage.unusedConfirmed +
        mcuPinUsage.unknown !==
      mcuPinUsage.pins ||
    Object.values(byResourceStatus).reduce((total, item) => total + item, 0) !==
      mcuPinUsage.pins
  ) {
    invalid(`${field} 的资源边或 MCU 引脚分类计数不守恒`);
  }
  let requiredKinds: readonly IrResourceEdgeKind[] | undefined;
  if (record.requiredKinds !== undefined) {
    if (!Array.isArray(record.requiredKinds)) {
      invalid(`${field}.requiredKinds 必须是数组`);
    }
    requiredKinds = record.requiredKinds.map((item, index) => {
      if (!REAL_PROJECT_RESOURCE_EDGE_KINDS.includes(item as IrResourceEdgeKind)) {
        invalid(`${field}.requiredKinds[${index}] 不受支持`);
      }
      return item as IrResourceEdgeKind;
    });
    if (requiredKinds.length === 0 || new Set(requiredKinds).size !== requiredKinds.length) {
      invalid(`${field}.requiredKinds 必须非空且无重复`);
    }
    for (const kind of requiredKinds) {
      if (byKind[kind] === 0) invalid(`${field}.requiredKinds.${kind} 没有对应资源边`);
    }
  }
  return {
    resourceEdges,
    byType,
    byKind,
    byStatus,
    byActivity,
    mcuPinUsage,
    ...(requiredKinds === undefined ? {} : { requiredKinds })
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
      "comparisonBaseline",
      "semanticBaseline",
      "resourceBaseline"
    ],
    ["hierarchyBaseline", "assemblyBaseline", "busBaseline"],
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
    semanticBaseline: semantic(
      record.semanticBaseline,
      `${field}.semanticBaseline`
    ),
    resourceBaseline: resource(
      record.resourceBaseline,
      `${field}.resourceBaseline`
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
        }),
    ...(record.busBaseline === undefined
      ? {}
      : {
          busBaseline: bus(record.busBaseline, `${field}.busBaseline`)
        })
  };
}

export function parseRealProjectManifest(value: unknown): RealProjectManifest {
  const root = object(value, "manifest");
  exactKeys(
    root,
    [
      "schemaVersion",
      "baselineId",
      "packageAcceptanceSampleId",
      "packageAssemblyAcceptanceSampleId",
      "packageSemanticAcceptanceSampleId",
      "packageResourceAcceptanceSampleId",
      "packageMcuPinAcceptanceSampleId",
      "samples"
    ],
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
    acceptance.hierarchyBaseline.instanceContextsResolved === 0 ||
    acceptance.busBaseline === undefined ||
    acceptance.busBaseline.buses === 0
  ) {
    invalid("packageAcceptanceSampleId 必须引用含已解析层级实例和显式 BUS 的样本");
  }
  const packageAssemblyAcceptanceSampleId = string(
    root.packageAssemblyAcceptanceSampleId,
    "packageAssemblyAcceptanceSampleId"
  );
  const assemblyAcceptance = samples.find(
    (item) => item.sampleId === packageAssemblyAcceptanceSampleId
  );
  if (
    assemblyAcceptance?.assemblyBaseline === undefined ||
    assemblyAcceptance.assemblyBaseline.explicitDnpCount === 0
  ) {
    invalid("packageAssemblyAcceptanceSampleId 必须引用含显式 DNP 的样本");
  }
  const packageSemanticAcceptanceSampleId = string(
    root.packageSemanticAcceptanceSampleId,
    "packageSemanticAcceptanceSampleId"
  );
  const semanticAcceptance = samples.find(
    (item) => item.sampleId === packageSemanticAcceptanceSampleId
  );
  if (
    semanticAcceptance === undefined ||
    semanticAcceptance.semanticBaseline.roles.MCU_MPU === 0 ||
    semanticAcceptance.semanticBaseline.requiredMcuActiveInterfaceTypes ===
      undefined
  ) {
    invalid(
      "packageSemanticAcceptanceSampleId 必须引用含 MCU 和实际活动接口断言的样本"
    );
  }
  const packageResourceAcceptanceSampleId = string(
    root.packageResourceAcceptanceSampleId,
    "packageResourceAcceptanceSampleId"
  );
  const resourceAcceptance = samples.find(
    (item) => item.sampleId === packageResourceAcceptanceSampleId
  );
  const requiredKinds = resourceAcceptance?.resourceBaseline.requiredKinds;
  const requiredKindSet = new Set(requiredKinds ?? []);
  const hasResetBootPath = [
    "RESET_SOURCE_OUTPUT",
    "RESET_SINK_INPUT",
    "RESET_BIAS_CANDIDATE",
    "BOOT_STRAP_INPUT",
    "BOOT_BIAS_CANDIDATE"
  ].some((kind) => requiredKindSet.has(kind as IrResourceEdgeKind));
  if (
    resourceAcceptance === undefined ||
    requiredKinds === undefined ||
    resourceAcceptance.resourceBaseline.byType.POWER === 0 ||
    resourceAcceptance.resourceBaseline.byType.CLOCK === 0 ||
    resourceAcceptance.resourceBaseline.byType.RESET_BOOT === 0 ||
    !requiredKindSet.has("POWER_CONVERSION") ||
    !requiredKindSet.has("CLOCK_SOURCE_OUTPUT") ||
    !requiredKindSet.has("CLOCK_SINK_INPUT") ||
    !hasResetBootPath
  ) {
    invalid(
      "packageResourceAcceptanceSampleId 必须覆盖电源转换、外部时钟和复位/启动"
    );
  }
  const packageMcuPinAcceptanceSampleId = string(
    root.packageMcuPinAcceptanceSampleId,
    "packageMcuPinAcceptanceSampleId"
  );
  const mcuPinAcceptance = samples.find(
    (item) => item.sampleId === packageMcuPinAcceptanceSampleId
  );
  const mcuRequiredKinds = new Set(
    mcuPinAcceptance?.resourceBaseline.requiredKinds ?? []
  );
  if (
    mcuPinAcceptance === undefined ||
    !mcuRequiredKinds.has("MCU_PIN_CONNECTION") ||
    mcuPinAcceptance.resourceBaseline.byType.MCU_PIN === 0 ||
    mcuPinAcceptance.resourceBaseline.mcuPinUsage.mcuCount === 0 ||
    mcuPinAcceptance.resourceBaseline.mcuPinUsage.pins === 0 ||
    mcuPinAcceptance.resourceBaseline.mcuPinUsage.unusedConfirmed === 0
  ) {
    invalid(
      "packageMcuPinAcceptanceSampleId 必须覆盖 MCU 引脚和显式未使用引脚"
    );
  }
  return {
    schemaVersion: REAL_PROJECT_MANIFEST_SCHEMA_VERSION,
    baselineId,
    packageAcceptanceSampleId,
    packageAssemblyAcceptanceSampleId,
    packageSemanticAcceptanceSampleId,
    packageResourceAcceptanceSampleId,
    packageMcuPinAcceptanceSampleId,
    samples
  };
}
