#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { compileProject } from "../application/compile-project.js";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  EdaIr,
  EdaIrSummary,
  IrComponentRole,
  IrInterface,
  IrInterfaceType,
  IrResourceEdgeKind,
  IrResourceType
} from "../ir/model.js";
import { ComponentConnectivityQuery } from "../query/component-connectivity.js";
import { EdaIrQueryIndex } from "../query/index.js";
import { NetlistComparisonQueryIndex } from "../query/netlist-comparison-index.js";
import { buildNetlistComparisonReport } from "../truth/compare-netlist-evidence.js";
import { readPrivateNetlist } from "../truth/import-netlist-evidence.js";
import { parseJlcEdaProEnet } from "../truth/jlceda-pro-enet.js";
import {
  parseRealProjectManifest,
  REAL_PROJECT_COMPONENT_ROLES,
  REAL_PROJECT_INTERFACE_MATRIX_KEYS,
  REAL_PROJECT_INTERFACE_TYPES,
  REAL_PROJECT_MANIFEST_LIMITS,
  REAL_PROJECT_RESOURCE_EDGE_KINDS,
  REAL_PROJECT_RESOURCE_TYPES,
  type RealProjectAssemblyBaseline,
  type RealProjectBusBaseline,
  type RealProjectComparisonBaseline,
  type RealProjectHierarchyBaseline,
  type RealProjectInterfaceMatrix,
  type RealProjectSemanticBaseline,
  type RealProjectResourceBaseline,
  type RealProjectSampleManifest
} from "./real-project-manifest.js";

const execFile = promisify(execFileCallback);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type HierarchySummary = Pick<
  EdaIrSummary,
  | "instanceDocuments"
  | "instanceContexts"
  | "instanceContextsResolved"
  | "instanceContextsUnresolved"
  | "instanceAttributeOverrides"
  | "instanceAttributeOverridesAppliedToComponents"
  | "instanceAttributeOverridesAppliedToPins"
  | "instanceAttributeOverridesUnresolved"
  | "componentOccurrences"
>;

interface SampleReceipt {
  readonly sampleId: string;
  readonly sourceSha256: string;
  readonly netlistSha256: string;
  readonly reducedStateSha256: string;
  readonly irSha256: string;
  readonly diagnostics: {
    readonly baselineCount: number;
    readonly actualCount: number;
    readonly changed: boolean;
  };
  readonly hierarchy: HierarchySummary;
  readonly assembly: {
    readonly addIntoBomAttributes: number;
    readonly explicitDnpAttributes: number;
    readonly requiredDnpVerified: number;
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
  };
  readonly bus: RealProjectBusBaseline;
  readonly semantics: RealProjectSemanticBaseline;
  readonly resources: RealProjectResourceBaseline;
  readonly comparison: {
    readonly status: string;
    readonly candidateTupleCount: number;
    readonly truthTupleCount: number;
    readonly matched: number;
    readonly missingInCandidate: number;
    readonly unexpectedCandidate: number;
    readonly candidateDuplicates: number;
    readonly truthDuplicates: number;
    readonly excludedCandidatePins: number;
  };
}

class RealProjectVerificationError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RealProjectVerificationError";
  }
}

function fail(code: string, message: string): never {
  throw new RealProjectVerificationError(code, message);
}

function equalCount(
  actual: number,
  expected: number,
  field: string
): void {
  if (actual !== expected) {
    fail("REAL_PROJECT_BASELINE_MISMATCH", `${field} 与冻结基线不一致`);
  }
}

function hierarchySummary(summary: EdaIrSummary): HierarchySummary {
  return {
    instanceDocuments: summary.instanceDocuments,
    instanceContexts: summary.instanceContexts,
    instanceContextsResolved: summary.instanceContextsResolved,
    instanceContextsUnresolved: summary.instanceContextsUnresolved,
    instanceAttributeOverrides: summary.instanceAttributeOverrides,
    instanceAttributeOverridesAppliedToComponents:
      summary.instanceAttributeOverridesAppliedToComponents,
    instanceAttributeOverridesAppliedToPins:
      summary.instanceAttributeOverridesAppliedToPins,
    instanceAttributeOverridesUnresolved:
      summary.instanceAttributeOverridesUnresolved,
    componentOccurrences: summary.componentOccurrences
  };
}

function verifyHierarchy(
  actual: HierarchySummary,
  expected: RealProjectHierarchyBaseline,
  sampleId: string
): void {
  for (const key of Object.keys(expected) as (keyof HierarchySummary)[]) {
    equalCount(actual[key], expected[key], `${sampleId}.hierarchy.${key}`);
  }
}

function assemblyEvidence(
  ir: EdaIr,
  baseline: RealProjectAssemblyBaseline | undefined,
  sampleId: string
): SampleReceipt["assembly"] {
  const attributes = ir.components.flatMap((component) =>
    component.attributes
      .filter((attribute) => attribute.key === "Add into BOM")
      .map((attribute) => ({ component, attribute }))
  );
  const explicitDnpAttributes = attributes.filter(
    ({ attribute }) =>
      typeof attribute.value === "string" &&
      attribute.value.toLocaleLowerCase("en-US") === "no"
  );
  const dnpComponents = ir.components.filter(
    (component) => component.assembly.status === "DNP"
  );
  const logicalComponents = [
    ...new Map(
      ir.components.map((component) => [
        component.pinCompleteness.logicalComponentId,
        component.pinCompleteness
      ])
    ).values()
  ];
  const actual = {
    addIntoBomAttributes: attributes.length,
    explicitDnpAttributes: explicitDnpAttributes.length,
    requiredDnpVerified: 0,
    components: ir.components.length,
    componentsPopulated: ir.components.filter(
      (component) => component.assembly.status === "POPULATED"
    ).length,
    componentsDnp: dnpComponents.length,
    componentsAssemblyUnknown: ir.components.filter(
      (component) => component.assembly.status === "UNKNOWN"
    ).length,
    logicalComponents: logicalComponents.length,
    logicalComponentsComplete: logicalComponents.filter(
      (item) => item.status === "COMPLETE"
    ).length,
    logicalComponentsPartial: logicalComponents.filter(
      (item) => item.status === "PARTIAL"
    ).length,
    logicalComponentsUnknown: logicalComponents.filter(
      (item) => item.status === "UNKNOWN"
    ).length,
    completeMultiUnitLogicalComponents: logicalComponents.filter(
      (item) => item.status === "COMPLETE" && item.units.length > 1
    ).length,
    symbolPins: ir.symbolPins.length,
    symbolPinsHidden: ir.symbolPins.filter((pin) => pin.display === false).length
  };
  if (baseline === undefined) return actual;
  equalCount(
    actual.addIntoBomAttributes,
    baseline.attributeCount,
    `${sampleId}.assembly.attributeCount`
  );
  equalCount(
    actual.explicitDnpAttributes,
    baseline.explicitDnpCount,
    `${sampleId}.assembly.explicitDnpCount`
  );
  for (const key of [
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
  ] as const) {
    equalCount(actual[key], baseline[key], `${sampleId}.assembly.${key}`);
  }
  let requiredDnpVerified = 0;
  for (const designator of baseline.requiredDnpDesignators) {
    const matches = dnpComponents.filter(
      (component) => component.designator === designator
    );
    equalCount(
      matches.length,
      1,
      `${sampleId}.assembly.requiredDnpDesignator`
    );
    requiredDnpVerified += 1;
  }
  return {
    ...actual,
    requiredDnpVerified
  };
}

function busEvidence(
  ir: EdaIr,
  baseline: RealProjectBusBaseline | undefined,
  sampleId: string
): RealProjectBusBaseline {
  const actual: RealProjectBusBaseline = {
    buses: ir.buses.length,
    busesWithExplicitNet: ir.buses.filter(
      (bus) => bus.explicitNetName !== undefined
    ).length,
    busesObservedEmbedded: ir.buses.filter(
      (bus) => bus.encoding === "OBSERVED_EMBEDDED_BUSENTRY_MAP"
    ).length,
    busesOfficialSeparate: ir.buses.filter(
      (bus) =>
        bus.encoding === "OFFICIAL_DOTS_WITH_SEPARATE_BUSENTRY_RECORDS"
    ).length,
    busesHybrid: ir.buses.filter(
      (bus) => bus.encoding === "HYBRID_DOTS_WITH_EMBEDDED_BUSENTRY_MAP"
    ).length,
    busesWithEmptyEntrySet: ir.buses.filter(
      (bus) => bus.entryIds.length === 0
    ).length,
    busSegments: ir.buses.reduce(
      (total, bus) => total + bus.segments.length,
      0
    ),
    busEntries: ir.busEntries.length,
    busEntriesEmbedded: ir.busEntries.filter(
      (entry) => entry.encoding === "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM"
    ).length,
    busEntriesSeparate: ir.busEntries.filter(
      (entry) => entry.encoding === "OFFICIAL_SEPARATE_BUSENTRY_RECORD"
    ).length,
    busEntriesUnbound: ir.busEntries.filter(
      (entry) => entry.busId === undefined
    ).length
  };
  if (baseline !== undefined) {
    for (const key of Object.keys(baseline) as (keyof RealProjectBusBaseline)[]) {
      equalCount(actual[key], baseline[key], `${sampleId}.bus.${key}`);
    }
  }
  return actual;
}

function interfaceMatrixKey(
  item: IrInterface
): (typeof REAL_PROJECT_INTERFACE_MATRIX_KEYS)[number] {
  const status =
    item.status === "CANDIDATE"
      ? "candidate"
      : item.status === "PARTIAL_CANDIDATE"
        ? "partialCandidate"
        : "unresolved";
  const activity =
    item.activityStatus === "ACTIVE"
      ? "Active"
      : item.activityStatus === "EXCLUDED_DNP"
        ? "ExcludedDnp"
        : "AssemblyUnknown";
  return `${status}${activity}` as (typeof REAL_PROJECT_INTERFACE_MATRIX_KEYS)[number];
}

function emptyInterfaceMatrix(): Record<
  (typeof REAL_PROJECT_INTERFACE_MATRIX_KEYS)[number],
  number
> {
  return Object.fromEntries(
    REAL_PROJECT_INTERFACE_MATRIX_KEYS.map((key) => [key, 0])
  ) as Record<(typeof REAL_PROJECT_INTERFACE_MATRIX_KEYS)[number], number>;
}

function semanticEvidence(
  ir: EdaIr,
  baseline: RealProjectSemanticBaseline,
  sampleId: string
): RealProjectSemanticBaseline {
  const roles = Object.fromEntries(
    REAL_PROJECT_COMPONENT_ROLES.map((role) => [role, 0])
  ) as Record<IrComponentRole, number>;
  for (const semantic of ir.componentSemantics) {
    roles[semantic.primaryRole] += 1;
  }
  const interfacesByType = Object.fromEntries(
    REAL_PROJECT_INTERFACE_TYPES.map((type) => [type, emptyInterfaceMatrix()])
  ) as Record<IrInterfaceType, Record<keyof RealProjectInterfaceMatrix, number>>;
  for (const item of ir.interfaces) {
    interfacesByType[item.type][interfaceMatrixKey(item)] += 1;
  }
  const actual: RealProjectSemanticBaseline = {
    componentSemantics: ir.summary.componentSemantics,
    componentSemanticsUnknownRole: ir.summary.componentSemanticsUnknownRole,
    componentPowerDomainCandidates:
      ir.summary.componentPowerDomainCandidates,
    roles,
    interfaces: ir.summary.interfaces,
    interfacesByType
  };
  for (const key of [
    "componentSemantics",
    "componentSemanticsUnknownRole",
    "componentPowerDomainCandidates",
    "interfaces"
  ] as const) {
    equalCount(actual[key], baseline[key], `${sampleId}.semantics.${key}`);
  }
  for (const role of REAL_PROJECT_COMPONENT_ROLES) {
    equalCount(
      actual.roles[role],
      baseline.roles[role],
      `${sampleId}.semantics.roles.${role}`
    );
  }
  for (const type of REAL_PROJECT_INTERFACE_TYPES) {
    for (const key of REAL_PROJECT_INTERFACE_MATRIX_KEYS) {
      equalCount(
        actual.interfacesByType[type][key],
        baseline.interfacesByType[type][key],
        `${sampleId}.semantics.interfacesByType.${type}.${key}`
      );
    }
  }
  return actual;
}

function resourceEvidence(
  ir: EdaIr,
  report: ReturnType<typeof buildNetlistComparisonReport>,
  parsedNetlist: ReturnType<typeof parseJlcEdaProEnet>,
  baseline: RealProjectResourceBaseline,
  sampleId: string
): RealProjectResourceBaseline {
  const byType = Object.fromEntries(
    REAL_PROJECT_RESOURCE_TYPES.map((type) => [type, 0])
  ) as Record<IrResourceType, number>;
  const byKind = Object.fromEntries(
    REAL_PROJECT_RESOURCE_EDGE_KINDS.map((kind) => [kind, 0])
  ) as Record<IrResourceEdgeKind, number>;
  const byStatus = { candidate: 0, unresolved: 0 };
  const byActivity = { active: 0, excludedDnp: 0, assemblyUnknown: 0 };
  for (const edge of ir.resourceEdges) {
    byType[edge.resourceType] += 1;
    byKind[edge.kind] += 1;
    if (edge.status === "CANDIDATE") byStatus.candidate += 1;
    else byStatus.unresolved += 1;
    if (edge.activityStatus === "ACTIVE") byActivity.active += 1;
    else if (edge.activityStatus === "EXCLUDED_DNP") byActivity.excludedDnp += 1;
    else byActivity.assemblyUnknown += 1;
  }
  const connectivity = new ComponentConnectivityQuery(
    new EdaIrQueryIndex(ir),
    new NetlistComparisonQueryIndex(report, parsedNetlist)
  );
  const usageItems: {
    readonly status: string;
    readonly usageStatus: string;
  }[] = [];
  let cursor: string | undefined;
  let mcuCount = 0;
  let pinTotal = 0;
  do {
    const result = connectivity.getMcuPinUsage({
      limit: 50,
      ...(cursor === undefined ? {} : { cursor })
    });
    mcuCount = result.mcuCount;
    pinTotal = result.pins.total;
    usageItems.push(...result.pins.items);
    cursor = result.pins.nextCursor;
  } while (cursor !== undefined);
  const actual: RealProjectResourceBaseline = {
    resourceEdges: ir.resourceEdges.length,
    byType,
    byKind,
    byStatus,
    byActivity,
    mcuPinUsage: {
      mcuCount,
      pins: pinTotal,
      usedBoundNetlist: usageItems.filter(
        (item) => item.usageStatus === "USED_BOUND_NETLIST"
      ).length,
      usedCandidate: usageItems.filter(
        (item) => item.usageStatus === "USED_CANDIDATE"
      ).length,
      unusedConfirmed: usageItems.filter(
        (item) => item.usageStatus === "UNUSED_CONFIRMED"
      ).length,
      unknown: usageItems.filter((item) => item.usageStatus === "UNKNOWN").length,
      byResourceStatus: {
        used: usageItems.filter((item) => item.status === "USED").length,
        explicitNc: usageItems.filter((item) => item.status === "EXPLICIT_NC")
          .length,
        unused: usageItems.filter((item) => item.status === "UNUSED").length,
        unknown: usageItems.filter((item) => item.status === "UNKNOWN").length,
        dnpComponent: usageItems.filter(
          (item) => item.status === "DNP_COMPONENT"
        ).length
      }
    },
    ...(baseline.requiredKinds === undefined
      ? {}
      : { requiredKinds: baseline.requiredKinds })
  };
  equalCount(
    actual.resourceEdges,
    baseline.resourceEdges,
    `${sampleId}.resources.resourceEdges`
  );
  for (const type of REAL_PROJECT_RESOURCE_TYPES) {
    equalCount(actual.byType[type], baseline.byType[type], `${sampleId}.resources.byType.${type}`);
  }
  for (const kind of REAL_PROJECT_RESOURCE_EDGE_KINDS) {
    equalCount(actual.byKind[kind], baseline.byKind[kind], `${sampleId}.resources.byKind.${kind}`);
  }
  for (const key of ["candidate", "unresolved"] as const) {
    equalCount(actual.byStatus[key], baseline.byStatus[key], `${sampleId}.resources.byStatus.${key}`);
  }
  for (const key of ["active", "excludedDnp", "assemblyUnknown"] as const) {
    equalCount(actual.byActivity[key], baseline.byActivity[key], `${sampleId}.resources.byActivity.${key}`);
  }
  for (const key of [
    "mcuCount",
    "pins",
    "usedBoundNetlist",
    "usedCandidate",
    "unusedConfirmed",
    "unknown"
  ] as const) {
    equalCount(
      actual.mcuPinUsage[key],
      baseline.mcuPinUsage[key],
      `${sampleId}.resources.mcuPinUsage.${key}`
    );
  }
  for (const key of [
    "used",
    "explicitNc",
    "unused",
    "unknown",
    "dnpComponent"
  ] as const) {
    equalCount(
      actual.mcuPinUsage.byResourceStatus[key],
      baseline.mcuPinUsage.byResourceStatus[key],
      `${sampleId}.resources.mcuPinUsage.byResourceStatus.${key}`
    );
  }
  return actual;
}

function verifyComparison(
  actual: SampleReceipt["comparison"],
  baseline: RealProjectComparisonBaseline,
  sampleId: string
): void {
  equalCount(
    actual.truthTupleCount,
    baseline.truthTupleCount,
    `${sampleId}.comparison.truthTupleCount`
  );
  if (baseline.status === "EXACT_SET_MATCH") {
    if (
      actual.status !== "EXACT_SET_MATCH" ||
      actual.candidateTupleCount !== baseline.candidateTupleCount ||
      actual.matched !== baseline.matched ||
      actual.missingInCandidate !== 0 ||
      actual.unexpectedCandidate !== 0 ||
      actual.candidateDuplicates !== 0 ||
      actual.truthDuplicates !== 0
    ) {
      fail(
        "REAL_PROJECT_NETLIST_REGRESSION",
        `${sampleId} 不再保持精确集合匹配`
      );
    }
    return;
  }
  if (
    actual.matched < baseline.matched ||
    actual.missingInCandidate > baseline.missingInCandidate ||
    actual.unexpectedCandidate > baseline.unexpectedCandidate ||
    actual.candidateDuplicates > baseline.candidateDuplicates ||
    actual.truthDuplicates > baseline.truthDuplicates ||
    actual.excludedCandidatePins > baseline.excludedCandidatePins
  ) {
    fail(
      "REAL_PROJECT_NETLIST_REGRESSION",
      `${sampleId} 的网表匹配数量下降或差异扩大`
    );
  }
}

async function verifySample(
  sample: RealProjectSampleManifest
): Promise<SampleReceipt> {
  const [firstIr, netlist] = await Promise.all([
    compileProject(sample.projectPath),
    readPrivateNetlist(sample.netlistPath)
  ]);
  const secondIr = await compileProject(sample.projectPath);
  if (
    firstIr.irSha256 !== secondIr.irSha256 ||
    firstIr.source.reducedStateSha256 !== secondIr.source.reducedStateSha256
  ) {
    fail(
      "REAL_PROJECT_NON_DETERMINISTIC",
      `${sample.sampleId} 连续编译结果不一致`
    );
  }
  if (firstIr.source.archiveSha256 !== sample.sourceSha256) {
    fail("REAL_PROJECT_INPUT_CHANGED", `${sample.sampleId} 工程输入哈希变化`);
  }
  const parsedNetlist = parseJlcEdaProEnet(netlist.bytes);
  const report = buildNetlistComparisonReport(firstIr, netlist.bytes, parsedNetlist);
  if (report.netlist.sha256 !== sample.netlistSha256) {
    fail("REAL_PROJECT_INPUT_CHANGED", `${sample.sampleId} 网表输入哈希变化`);
  }
  const diagnosticsSha256 = sha256CanonicalJson(firstIr.diagnostics);
  if (
    firstIr.diagnostics.length !== sample.expectedDiagnostics.count ||
    diagnosticsSha256 !== sample.expectedDiagnostics.sha256
  ) {
    fail(
      "REAL_PROJECT_DIAGNOSTIC_DELTA",
      `${sample.sampleId} 诊断集合相对冻结基线发生变化`
    );
  }
  const hierarchy = hierarchySummary(firstIr.summary);
  if (sample.hierarchyBaseline !== undefined) {
    verifyHierarchy(hierarchy, sample.hierarchyBaseline, sample.sampleId);
  }
  const comparison = {
    status: report.comparison.status,
    candidateTupleCount: report.comparison.candidateTupleCount,
    truthTupleCount: report.comparison.truthTupleCount,
    matched: report.comparison.matched.length,
    missingInCandidate: report.comparison.missingInCandidate.length,
    unexpectedCandidate: report.comparison.unexpectedCandidate.length,
    candidateDuplicates: report.comparison.candidateDuplicates.length,
    truthDuplicates: report.comparison.truthDuplicates.length,
    excludedCandidatePins:
      report.candidateCompilation.summary.excludedPinInstances
  };
  verifyComparison(comparison, sample.comparisonBaseline, sample.sampleId);
  return {
    sampleId: sample.sampleId,
    sourceSha256: firstIr.source.archiveSha256,
    netlistSha256: report.netlist.sha256,
    reducedStateSha256: firstIr.source.reducedStateSha256,
    irSha256: firstIr.irSha256,
    diagnostics: {
      baselineCount: sample.expectedDiagnostics.count,
      actualCount: firstIr.diagnostics.length,
      changed: false
    },
    hierarchy,
    assembly: assemblyEvidence(
      firstIr,
      sample.assemblyBaseline,
      sample.sampleId
    ),
    bus: busEvidence(firstIr, sample.busBaseline, sample.sampleId),
    semantics: semanticEvidence(
      firstIr,
      sample.semanticBaseline,
      sample.sampleId
    ),
    resources: resourceEvidence(
      firstIr,
      report,
      parsedNetlist,
      sample.resourceBaseline,
      sample.sampleId
    ),
    comparison
  };
}

async function readManifest(manifestPath: string): Promise<unknown> {
  if (!path.isAbsolute(manifestPath) || path.extname(manifestPath) !== ".json") {
    fail(
      "REAL_PROJECT_MANIFEST_PATH_INVALID",
      "SCHEMCP_REAL_PROJECT_MANIFEST 必须是绝对 JSON 路径"
    );
  }
  const metadata = await lstat(manifestPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size === 0 ||
    metadata.size > REAL_PROJECT_MANIFEST_LIMITS.maxBytes
  ) {
    fail("REAL_PROJECT_MANIFEST_PATH_INVALID", "真实工程清单不是安全普通文件");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    fail("REAL_PROJECT_MANIFEST_INVALID", "真实工程清单不是有效 JSON");
  }
  return value;
}

async function sourceSnapshot(root: string): Promise<string> {
  const result = await execFile(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
  );
  const names = result.stdout
    .toString("utf8")
    .split("\0")
    .filter((name) => name.length > 0)
    .sort();
  if (names.length === 0) {
    fail("REAL_PROJECT_SOURCE_SNAPSHOT_INVALID", "候选源码文件集合为空");
  }
  const entries: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[] = [];
  for (const name of names) {
    const absolute = path.resolve(root, name);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      fail("REAL_PROJECT_SOURCE_SNAPSHOT_INVALID", "候选源码路径越界");
    }
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail("REAL_PROJECT_SOURCE_SNAPSHOT_INVALID", "候选源码包含非普通文件");
    }
    const bytes = await readFile(absolute);
    entries.push({
      path: name.replaceAll(path.sep, "/"),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }
  return sha256CanonicalJson(entries);
}

function parsePackageReceipt(stdout: string): {
  readonly tarballSha256: string;
  readonly packageBytes: number;
  readonly realHierarchyQuery: string;
  readonly realBusQuery: string;
  readonly realMultiUnitPinQuery: string;
  readonly realSeparatedPowerUnitQuery: string;
  readonly realAssemblyQuery: string;
  readonly realSemanticQuery: string;
  readonly realDnpInterfaceQuery: string;
  readonly realPowerTreeQuery: string;
  readonly realClockTreeQuery: string;
  readonly realResetBootQuery: string;
  readonly realMcuPinUsageQuery: string;
} {
  const lines = stdout.trim().split(/\r?\n/u);
  const last = lines[lines.length - 1];
  let value: unknown;
  try {
    value = JSON.parse(last ?? "") as unknown;
  } catch {
    fail("REAL_PROJECT_PACKAGE_GATE_FAILED", "候选包验证未返回规范回执");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("REAL_PROJECT_PACKAGE_GATE_FAILED", "候选包验证回执类型非法");
  }
  const record = value as Record<string, unknown>;
  if (
    record.ok !== true ||
    typeof record.tarballSha256 !== "string" ||
    !SHA256_PATTERN.test(record.tarballSha256) ||
    !Number.isSafeInteger(record.packageBytes) ||
    record.realHierarchyQuery !== "VERIFIED" ||
    record.realBusQuery !== "VERIFIED" ||
    record.realMultiUnitPinQuery !== "VERIFIED" ||
    record.realSeparatedPowerUnitQuery !== "VERIFIED" ||
    record.realAssemblyQuery !== "VERIFIED" ||
    record.realSemanticQuery !== "VERIFIED" ||
    record.realDnpInterfaceQuery !== "VERIFIED" ||
    record.realPowerTreeQuery !== "VERIFIED" ||
    record.realClockTreeQuery !== "VERIFIED" ||
    record.realResetBootQuery !== "VERIFIED" ||
    record.realMcuPinUsageQuery !== "VERIFIED"
  ) {
    fail("REAL_PROJECT_PACKAGE_GATE_FAILED", "候选包真实层级调用未通过");
  }
  return {
    tarballSha256: record.tarballSha256,
    packageBytes: record.packageBytes as number,
    realHierarchyQuery: record.realHierarchyQuery,
    realBusQuery: record.realBusQuery,
    realMultiUnitPinQuery: record.realMultiUnitPinQuery,
    realSeparatedPowerUnitQuery: record.realSeparatedPowerUnitQuery,
    realAssemblyQuery: record.realAssemblyQuery,
    realSemanticQuery: record.realSemanticQuery,
    realDnpInterfaceQuery: record.realDnpInterfaceQuery,
    realPowerTreeQuery: record.realPowerTreeQuery,
    realClockTreeQuery: record.realClockTreeQuery,
    realResetBootQuery: record.realResetBootQuery,
    realMcuPinUsageQuery: record.realMcuPinUsageQuery
  };
}

async function verifyInstalledPackage(
  root: string,
  projectPath: string,
  assemblyProjectPath: string,
  semanticProjectPath: string,
  requiredMcuActiveInterfaceTypes: readonly IrInterfaceType[],
  resourceProjectPath: string,
  mcuPinProjectPath: string,
  mcuPinNetlistPath: string,
  npmCache: string
): Promise<ReturnType<typeof parsePackageReceipt>> {
  try {
    const result = await execFile(
      process.execPath,
      [
        "dist/src/verification/verify-package.js",
        projectPath,
        assemblyProjectPath,
        semanticProjectPath,
        JSON.stringify(requiredMcuActiveInterfaceTypes),
        resourceProjectPath,
        mcuPinProjectPath,
        mcuPinNetlistPath
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          npm_config_cache: npmCache,
          npm_config_audit: "false",
          npm_config_fund: "false"
        },
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024
      }
    );
    return parsePackageReceipt(result.stdout);
  } catch (error) {
    if (error instanceof RealProjectVerificationError) throw error;
    fail("REAL_PROJECT_PACKAGE_GATE_FAILED", "候选包安装态真实工程验证失败");
  }
}

async function writeReceipt(
  receiptPath: string,
  value: Readonly<Record<string, unknown>>
): Promise<string> {
  if (!path.isAbsolute(receiptPath) || path.extname(receiptPath) !== ".json") {
    fail("REAL_PROJECT_RECEIPT_PATH_INVALID", "真实工程回执路径必须是绝对 JSON 路径");
  }
  try {
    const current = await lstat(receiptPath);
    if (!current.isFile() || current.isSymbolicLink()) {
      fail("REAL_PROJECT_RECEIPT_PATH_INVALID", "既有真实工程回执不是普通文件");
    }
  } catch (error) {
    if (
      error instanceof RealProjectVerificationError ||
      !(
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
  const receiptSha256 = sha256CanonicalJson(value);
  const output = canonicalJson({ ...value, receiptSha256 });
  const temporary = path.join(
    path.dirname(receiptPath),
    `.${path.basename(receiptPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${output}\n`, "utf8");
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, receiptPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return receiptSha256;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const manifestPath = process.env.SCHEMCP_REAL_PROJECT_MANIFEST;
  if (manifestPath === undefined) {
    fail(
      "REAL_PROJECT_MANIFEST_NOT_CONFIGURED",
      "缺少 SCHEMCP_REAL_PROJECT_MANIFEST"
    );
  }
  const manifest = parseRealProjectManifest(await readManifest(manifestPath));
  const sourceSnapshotSha256 = await sourceSnapshot(root);
  const sampleReceipts: SampleReceipt[] = [];
  for (const sample of manifest.samples) {
    sampleReceipts.push(await verifySample(sample));
  }
  const acceptance = manifest.samples.find(
    (sample) => sample.sampleId === manifest.packageAcceptanceSampleId
  );
  if (acceptance === undefined) {
    fail("REAL_PROJECT_MANIFEST_INVALID", "候选包验收样本缺失");
  }
  const assemblyAcceptance = manifest.samples.find(
    (sample) =>
      sample.sampleId === manifest.packageAssemblyAcceptanceSampleId
  );
  if (assemblyAcceptance === undefined) {
    fail("REAL_PROJECT_MANIFEST_INVALID", "候选包 DNP 验收样本缺失");
  }
  const semanticAcceptance = manifest.samples.find(
    (sample) =>
      sample.sampleId === manifest.packageSemanticAcceptanceSampleId
  );
  const requiredMcuActiveInterfaceTypes =
    semanticAcceptance?.semanticBaseline.requiredMcuActiveInterfaceTypes;
  if (
    semanticAcceptance === undefined ||
    requiredMcuActiveInterfaceTypes === undefined
  ) {
    fail("REAL_PROJECT_MANIFEST_INVALID", "候选包语义验收样本缺失");
  }
  const resourceAcceptance = manifest.samples.find(
    (sample) => sample.sampleId === manifest.packageResourceAcceptanceSampleId
  );
  if (resourceAcceptance === undefined) {
    fail("REAL_PROJECT_MANIFEST_INVALID", "候选包 P2 资源验收样本缺失");
  }
  const mcuPinAcceptance = manifest.samples.find(
    (sample) => sample.sampleId === manifest.packageMcuPinAcceptanceSampleId
  );
  if (mcuPinAcceptance === undefined) {
    fail("REAL_PROJECT_MANIFEST_INVALID", "候选包 MCU 引脚验收样本缺失");
  }
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "schemcp-real-projects-")
  );
  let packageReceipt: Awaited<ReturnType<typeof verifyInstalledPackage>>;
  try {
    packageReceipt = await verifyInstalledPackage(
      root,
      acceptance.projectPath,
      assemblyAcceptance.projectPath,
      semanticAcceptance.projectPath,
      requiredMcuActiveInterfaceTypes,
      resourceAcceptance.projectPath,
      mcuPinAcceptance.projectPath,
      mcuPinAcceptance.netlistPath,
      path.join(temporaryRoot, "npm-cache")
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  const finalSourceSnapshotSha256 = await sourceSnapshot(root);
  if (finalSourceSnapshotSha256 !== sourceSnapshotSha256) {
    fail(
      "REAL_PROJECT_SOURCE_CHANGED_DURING_GATE",
      "真实工程门禁期间候选源码发生变化"
    );
  }
  const receiptPath =
    process.env.SCHEMCP_REAL_PROJECT_RECEIPT ??
    path.join(
      path.dirname(manifestPath),
      `${path.basename(manifestPath, ".json")}.receipt.json`
    );
  const receiptSha256 = await writeReceipt(receiptPath, {
    schemaVersion: "1.5.0",
    gate: "REAL_PROJECTS_VERIFIED",
    baselineId: manifest.baselineId,
    sourceSnapshotSha256,
    candidatePackage: packageReceipt,
    sampleReceipts
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      gate: "REAL_PROJECTS_VERIFIED",
      baselineId: manifest.baselineId,
      sourceSnapshotSha256,
      candidateTarballSha256: packageReceipt.tarballSha256,
      receiptSha256,
      samples: sampleReceipts.length,
      exactNetlistMatches: sampleReceipts.filter(
        (item) => item.comparison.status === "EXACT_SET_MATCH"
      ).length,
      resolvedInstanceContexts: sampleReceipts.reduce(
        (total, item) => total + item.hierarchy.instanceContextsResolved,
        0
      ),
      explicitDnpEvidence: sampleReceipts.reduce(
        (total, item) => total + item.assembly.explicitDnpAttributes,
        0
      ),
      explicitBuses: sampleReceipts.reduce(
        (total, item) => total + item.bus.buses,
        0
      ),
      explicitBusEntries: sampleReceipts.reduce(
        (total, item) => total + item.bus.busEntries,
        0
      ),
      componentSemantics: sampleReceipts.reduce(
        (total, item) => total + item.semantics.componentSemantics,
        0
      ),
      interfaces: sampleReceipts.reduce(
        (total, item) => total + item.semantics.interfaces,
        0
      ),
      resourceEdges: sampleReceipts.reduce(
        (total, item) => total + item.resources.resourceEdges,
        0
      ),
      mcuPins: sampleReceipts.reduce(
        (total, item) => total + item.resources.mcuPinUsage.pins,
        0
      ),
      unusedMcuPinsConfirmed: sampleReceipts.reduce(
        (total, item) => total + item.resources.mcuPinUsage.unusedConfirmed,
        0
      ),
      privatePathsDisclosed: false
    })}\n`
  );
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof RealProjectVerificationError ||
    (error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string")
      ? error.code
      : "REAL_PROJECT_VERIFICATION_INTERNAL_ERROR";
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      gate: "REAL_PROJECTS_VERIFICATION_FAILED",
      error: { code },
      privatePathsDisclosed: false
    })}\n`
  );
  process.exitCode = 2;
}
