import { createHash } from "node:crypto";
import { AppError, ERROR_CODES } from "../core/error.js";
import {
  QUERY_LIMITS,
  QueryError,
  type ComponentLookup,
  type ComponentPinSummary,
  type ComponentSummary,
  type Page
} from "../query/index.js";
import type {
  JlcEdaProEnetComponent,
  JlcEdaProEnetPin
} from "../truth/jlceda-pro-enet.js";
import type {
  EdaMcpProjectSession,
  McpProjectSessionEntry
} from "./project-session.js";
import {
  createSchematicAssemblyManifest,
  projectIdForIr,
  readSchematicAssemblyManifest,
  type SchematicAssemblyManifest
} from "./assembly-manifest.js";

export const MCP_ASSEMBLY_LIMITS = {
  maxAssemblies: 8,
  minProjects: 2,
  maxProjects: 4,
  maxInterconnects: 32,
  maxPinPairs: 1024,
  maxInterconnectHops: 4,
  minCandidatePins: 4,
  maxCandidatePairs: 20_000
} as const;

export interface AssemblyComponentEndpoint {
  readonly projectHandle: string;
  readonly componentId: string;
  readonly pageId: string;
  readonly designator?: string;
}

export interface AssemblyPinPair {
  readonly leftPinNumber: string;
  readonly rightPinNumber: string;
}

export interface SchematicInterconnect {
  readonly interconnectId: string;
  readonly candidateId: string;
  readonly left: AssemblyComponentEndpoint;
  readonly right: AssemblyComponentEndpoint;
  readonly pinPairs: readonly AssemblyPinPair[];
  readonly mappingMethod:
    | "USER_CONFIRMED_SAME_PIN_NUMBER"
    | "USER_CONFIRMED_EXPLICIT_PIN_PAIRS";
  readonly relationshipTruth: "USER_CONFIRMED_SESSION_RELATIONSHIP";
}

export interface SchematicAssembly {
  readonly assemblyHandle: string;
  readonly projectHandles: readonly string[];
  readonly interconnects: readonly SchematicInterconnect[];
  readonly relationshipTruth: "USER_ASSERTED_PROJECT_RELATIONSHIP";
}

export interface InterconnectCandidateEvidence {
  readonly kind:
    | "EXACT_PIN_NUMBER_SET"
    | "SAME_PIN_COUNT"
    | "EXACT_DESIGNATOR"
    | "EXACT_LCSC_PART_ID"
    | "EXACT_MANUFACTURER_PART"
    | "EXACT_FOOTPRINT"
    | "PIN_NAME_MATCHES";
  readonly count?: number;
}

export interface InterconnectCandidate {
  readonly candidateId: string;
  readonly left: AssemblyComponentEndpoint;
  readonly right: AssemblyComponentEndpoint;
  readonly pinCount: number;
  readonly pinNumbers: readonly string[];
  readonly evidence: readonly InterconnectCandidateEvidence[];
  readonly state: "CANDIDATE_NOT_CONFIRMED";
}

export interface AssemblyConnectionSegment {
  readonly kind:
    | "BOUND_NETLIST"
    | "EPRO2_CANDIDATE"
    | "CONFIRMED_INTERCONNECT";
  readonly projectHandle?: string;
  readonly netName?: string;
  readonly from: {
    readonly projectHandle: string;
    readonly componentRef: string;
    readonly pinNumber: string;
    readonly pinName?: string;
  };
  readonly to: {
    readonly projectHandle: string;
    readonly componentRef: string;
    readonly pinNumber: string;
    readonly pinName?: string;
  };
}

export interface AssemblyConnectionPath {
  readonly target: AssemblyConnectionSegment["to"];
  readonly interconnectHops: number;
  readonly segments: readonly AssemblyConnectionSegment[];
  readonly propagation: "NET_AND_CONFIRMED_INTERCONNECT_ONLY";
  readonly electricalTruth: "NOT_VERIFIED";
}

interface ComponentProfile {
  readonly endpoint: AssemblyComponentEndpoint;
  readonly summary: ComponentSummary;
  readonly pinNumbers: readonly string[];
  readonly pinNames: ReadonlyMap<string, string>;
  readonly attributes: ReadonlyMap<string, string>;
}

interface CursorPayload {
  readonly version: 1;
  readonly revision: number;
  readonly scope: string;
  readonly offset: number;
}

interface ElectricalEndpoint {
  readonly projectHandle: string;
  readonly componentRef: string;
  readonly pinNumber: string;
  readonly pinName?: string;
  readonly netName: string;
  readonly evidence: "BOUND_NETLIST" | "EPRO2_CANDIDATE";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableHash(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function endpointKey(
  projectHandle: string,
  componentRef: string,
  pinNumber: string
): string {
  return `${projectHandle}\n${componentRef}\n${pinNumber}`;
}

function pageSize(limit: number | undefined): number {
  const actual = limit ?? QUERY_LIMITS.defaultPageSize;
  if (
    !Number.isSafeInteger(actual) ||
    actual < 1 ||
    actual > QUERY_LIMITS.maxPageSize
  ) {
    throw new QueryError(
      "QUERY_INVALID_LIMIT",
      `limit 必须是 1 到 ${QUERY_LIMITS.maxPageSize} 的整数。`
    );
  }
  return actual;
}

function paginate<T>(
  items: readonly T[],
  limit: number | undefined,
  cursor: string | undefined,
  revision: number,
  scope: string
): Page<T> {
  const size = pageSize(limit);
  let offset = 0;
  if (cursor !== undefined) {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8")
      ) as Partial<CursorPayload>;
      if (
        parsed.version !== 1 ||
        parsed.revision !== revision ||
        parsed.scope !== scope ||
        !Number.isSafeInteger(parsed.offset) ||
        (parsed.offset ?? -1) < 0
      ) {
        throw new Error("cursor mismatch");
      }
      offset = parsed.offset as number;
    } catch {
      throw new QueryError(
        "QUERY_INVALID_CURSOR",
        "装配查询游标无效，或装配关系已发生变化。"
      );
    }
  }
  if (offset > items.length) {
    throw new QueryError("QUERY_INVALID_CURSOR", "游标已超出装配查询范围。");
  }
  const page = items.slice(offset, offset + size);
  const nextOffset = offset + page.length;
  return {
    items: page,
    total: items.length,
    ...(nextOffset < items.length
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({
              version: 1,
              revision,
              scope,
              offset: nextOffset
            }),
            "utf8"
          ).toString("base64url")
        }
      : {})
  };
}

function allComponents(entry: McpProjectSessionEntry): readonly ComponentSummary[] {
  const items: ComponentSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = entry.index.listComponents({
      limit: QUERY_LIMITS.maxPageSize,
      ...(cursor === undefined ? {} : { cursor })
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return items;
}

function allPins(
  entry: McpProjectSessionEntry,
  component: ComponentSummary
): readonly ComponentPinSummary[] {
  const items: ComponentPinSummary[] = [];
  let cursor: string | undefined;
  do {
    const lookup = entry.index.getComponentPins({
      componentId: component.id,
      pageId: component.pageId,
      limit: QUERY_LIMITS.maxPageSize,
      ...(cursor === undefined ? {} : { cursor })
    });
    if (lookup.status !== "FOUND" || !("pins" in lookup)) return [];
    items.push(...lookup.pins.items);
    cursor = lookup.pins.nextCursor;
  } while (cursor !== undefined);
  return items;
}

function netlistComponent(
  entry: McpProjectSessionEntry,
  designator: string | undefined
): JlcEdaProEnetComponent | undefined {
  return designator === undefined
    ? undefined
    : entry.netlist?.components.find(
        (component) => component.designator === designator
      );
}

function scalarAttributes(
  lookup: Extract<ComponentLookup, { readonly status: "FOUND" }>
): ReadonlyMap<string, string> {
  return new Map(
    lookup.attributes.flatMap((attribute) =>
      attribute.values.length === 1 &&
      typeof attribute.values[0] === "string"
        ? [[attribute.key, attribute.values[0]] as const]
        : []
    )
  );
}

function projectProfiles(
  projectHandle: string,
  entry: McpProjectSessionEntry
): readonly ComponentProfile[] {
  return allComponents(entry).flatMap((component) => {
    const lookup = entry.index.getComponent({
      componentId: component.id,
      pageId: component.pageId
    });
    if (lookup.status !== "FOUND") return [];
    const fromNetlist = netlistComponent(entry, component.designator);
    const pins =
      fromNetlist?.pins ??
      allPins(entry, component).flatMap((pin) =>
        pin.number === undefined
          ? []
          : [
              {
                key: pin.id,
                number: pin.number,
                name: pin.name ?? "",
                net: "",
                properties: {}
              } satisfies JlcEdaProEnetPin
            ]
      );
    const pinNumbers = [...new Set(pins.map((pin) => pin.number))].sort(
      compareText
    );
    if (
      pinNumbers.length < MCP_ASSEMBLY_LIMITS.minCandidatePins ||
      pinNumbers.length > MCP_ASSEMBLY_LIMITS.maxPinPairs
    ) {
      return [];
    }
    const pinNames = new Map(
      pins.flatMap((pin) =>
        pin.name === "" ? [] : [[pin.number, pin.name] as const]
      )
    );
    const attributes = new Map(scalarAttributes(lookup));
    for (const [key, value] of Object.entries(
      fromNetlist?.properties ?? {}
    )) {
      if (!attributes.has(key)) attributes.set(key, value);
    }
    return [
      {
        endpoint: {
          projectHandle,
          componentId: component.id,
          pageId: component.pageId,
          ...(component.designator === undefined
            ? {}
            : { designator: component.designator })
        },
        summary: component,
        pinNumbers,
        pinNames,
        attributes
      }
    ];
  });
}

function exactAttributeEvidence(
  left: ComponentProfile,
  right: ComponentProfile
): readonly InterconnectCandidateEvidence[] {
  const rules = [
    ["Supplier Part", "EXACT_LCSC_PART_ID"],
    ["Manufacturer Part", "EXACT_MANUFACTURER_PART"],
    ["Footprint", "EXACT_FOOTPRINT"]
  ] as const;
  return rules.flatMap(([key, kind]) => {
    const leftValue = left.attributes.get(key);
    const rightValue = right.attributes.get(key);
    return leftValue !== undefined &&
      leftValue !== "" &&
      leftValue === rightValue
      ? [{ kind }]
      : [];
  });
}

function candidateFor(
  left: ComponentProfile,
  right: ComponentProfile
): InterconnectCandidate | undefined {
  if (
    left.pinNumbers.length !== right.pinNumbers.length ||
    left.pinNumbers.some(
      (number, index) => number !== right.pinNumbers[index]
    )
  ) {
    return undefined;
  }
  const matchingNames = left.pinNumbers.filter((number) => {
    const leftName = left.pinNames.get(number);
    const rightName = right.pinNames.get(number);
    return leftName !== undefined && leftName !== "" && leftName === rightName;
  }).length;
  const evidence: InterconnectCandidateEvidence[] = [
    { kind: "EXACT_PIN_NUMBER_SET" },
    { kind: "SAME_PIN_COUNT" },
    ...(left.endpoint.designator !== undefined &&
    left.endpoint.designator === right.endpoint.designator
      ? [{ kind: "EXACT_DESIGNATOR" as const }]
      : []),
    ...exactAttributeEvidence(left, right),
    ...(matchingNames === 0
      ? []
      : [{ kind: "PIN_NAME_MATCHES" as const, count: matchingNames }])
  ];
  const identity = [
    left.endpoint.projectHandle,
    left.endpoint.pageId,
    left.endpoint.componentId,
    right.endpoint.projectHandle,
    right.endpoint.pageId,
    right.endpoint.componentId
  ];
  return {
    candidateId: stableHash("interconnect_candidate", identity),
    left: left.endpoint,
    right: right.endpoint,
    pinCount: left.pinNumbers.length,
    pinNumbers: left.pinNumbers,
    evidence,
    state: "CANDIDATE_NOT_CONFIRMED"
  };
}

function candidateSort(
  left: InterconnectCandidate,
  right: InterconnectCandidate
): number {
  return (
    right.evidence.length - left.evidence.length ||
    right.pinCount - left.pinCount ||
    compareText(left.candidateId, right.candidateId)
  );
}

export class SchematicAssemblySession {
  private readonly assemblies = new Map<string, SchematicAssembly>();
  private revision = 0;

  public constructor(private readonly projects: EdaMcpProjectSession) {}

  public create(projectHandles: readonly string[]): {
    readonly disposition: "CREATED" | "ALREADY_EXISTS";
    readonly assembly: SchematicAssembly;
  } {
    const unique = [...new Set(projectHandles)].sort(compareText);
    if (
      unique.length !== projectHandles.length ||
      unique.length < MCP_ASSEMBLY_LIMITS.minProjects ||
      unique.length > MCP_ASSEMBLY_LIMITS.maxProjects
    ) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_INVALID,
        `装配必须包含 ${MCP_ASSEMBLY_LIMITS.minProjects}～${MCP_ASSEMBLY_LIMITS.maxProjects} 个互不重复的已打开工程。`
      );
    }
    for (const handle of unique) this.projects.requireEntry(handle);
    const assemblyHandle = stableHash("assembly", unique);
    const existing = this.assemblies.get(assemblyHandle);
    if (existing !== undefined) {
      return { disposition: "ALREADY_EXISTS", assembly: existing };
    }
    if (this.assemblies.size >= MCP_ASSEMBLY_LIMITS.maxAssemblies) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_LIMIT_EXCEEDED,
        `当前会话最多保留 ${MCP_ASSEMBLY_LIMITS.maxAssemblies} 个装配。`
      );
    }
    const assembly: SchematicAssembly = {
      assemblyHandle,
      projectHandles: unique,
      interconnects: [],
      relationshipTruth: "USER_ASSERTED_PROJECT_RELATIONSHIP"
    };
    this.assemblies.set(assemblyHandle, assembly);
    this.revision += 1;
    return { disposition: "CREATED", assembly };
  }

  public list(input: {
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): Page<SchematicAssembly> {
    this.prune();
    const items = [...this.assemblies.values()].sort((left, right) =>
      compareText(left.assemblyHandle, right.assemblyHandle)
    );
    return paginate(
      items,
      input.limit,
      input.cursor,
      this.revision,
      "assemblies"
    );
  }

  public close(assemblyHandle: string): {
    readonly disposition: "CLOSED" | "NOT_FOUND";
  } {
    const removed = this.assemblies.delete(assemblyHandle);
    if (removed) this.revision += 1;
    return { disposition: removed ? "CLOSED" : "NOT_FOUND" };
  }

  public prune(): void {
    for (const [handle, assembly] of this.assemblies) {
      if (
        assembly.projectHandles.some(
          (projectHandle) => this.projects.getEntry(projectHandle) === undefined
        )
      ) {
        this.assemblies.delete(handle);
        this.revision += 1;
      }
    }
  }

  public listCandidates(input: {
    readonly assemblyHandle: string;
    readonly leftProjectHandle?: string | undefined;
    readonly rightProjectHandle?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): Page<InterconnectCandidate> {
    const assembly = this.requireAssembly(input.assemblyHandle);
    const candidates = this.candidates(assembly).filter(
      (candidate) =>
        (input.leftProjectHandle === undefined ||
          candidate.left.projectHandle === input.leftProjectHandle) &&
        (input.rightProjectHandle === undefined ||
          candidate.right.projectHandle === input.rightProjectHandle)
    );
    return paginate(
      candidates,
      input.limit,
      input.cursor,
      this.revision,
      `interconnect-candidates\n${assembly.assemblyHandle}\n${input.leftProjectHandle ?? ""}\n${input.rightProjectHandle ?? ""}`
    );
  }

  public confirm(input: {
    readonly assemblyHandle: string;
    readonly candidateId: string;
    readonly mapping:
      | { readonly kind: "SAME_PIN_NUMBER" }
      | {
          readonly kind: "EXPLICIT_PIN_PAIRS";
          readonly pinPairs: readonly AssemblyPinPair[];
        };
  }): {
    readonly disposition: "CONFIRMED" | "ALREADY_CONFIRMED";
    readonly interconnect: SchematicInterconnect;
  } {
    const assembly = this.requireAssembly(input.assemblyHandle);
    const candidate = this
      .candidates(assembly)
      .find((item) => item.candidateId === input.candidateId);
    if (candidate === undefined) {
      throw new AppError(
        ERROR_CODES.MCP_INTERCONNECT_INVALID,
        "候选不存在、已失效或不属于指定装配。"
      );
    }
    const pinPairs =
      input.mapping.kind === "SAME_PIN_NUMBER"
        ? candidate.pinNumbers.map((number) => ({
            leftPinNumber: number,
            rightPinNumber: number
          }))
        : [...input.mapping.pinPairs];
    this.validatePinPairs(candidate, pinPairs);
    const interconnectId = stableHash("interconnect", [
      candidate.candidateId,
      pinPairs
    ]);
    const existing = assembly.interconnects.find(
      (item) => item.interconnectId === interconnectId
    );
    if (existing !== undefined) {
      return { disposition: "ALREADY_CONFIRMED", interconnect: existing };
    }
    if (
      assembly.interconnects.length >=
      MCP_ASSEMBLY_LIMITS.maxInterconnects
    ) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_LIMIT_EXCEEDED,
        `单个装配最多确认 ${MCP_ASSEMBLY_LIMITS.maxInterconnects} 组互连。`
      );
    }
    const interconnect: SchematicInterconnect = {
      interconnectId,
      candidateId: candidate.candidateId,
      left: candidate.left,
      right: candidate.right,
      pinPairs,
      mappingMethod:
        input.mapping.kind === "SAME_PIN_NUMBER"
          ? "USER_CONFIRMED_SAME_PIN_NUMBER"
          : "USER_CONFIRMED_EXPLICIT_PIN_PAIRS",
      relationshipTruth: "USER_CONFIRMED_SESSION_RELATIONSHIP"
    };
    this.assemblies.set(assembly.assemblyHandle, {
      ...assembly,
      interconnects: [...assembly.interconnects, interconnect].sort(
        (left, right) =>
          compareText(left.interconnectId, right.interconnectId)
      )
    });
    this.revision += 1;
    return { disposition: "CONFIRMED", interconnect };
  }

  public listConnections(input: {
    readonly assemblyHandle: string;
    readonly projectHandle: string;
    readonly componentId?: string | undefined;
    readonly designator?: string | undefined;
    readonly pageId?: string | undefined;
    readonly pinNumber?: string | undefined;
    readonly maxInterconnectHops?: number | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): ComponentLookup | {
    readonly status: "FOUND";
    readonly component: ComponentSummary;
    readonly paths: Page<AssemblyConnectionPath>;
  } {
    const assembly = this.requireAssembly(input.assemblyHandle);
    if (!assembly.projectHandles.includes(input.projectHandle)) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_INVALID,
        "起点工程不属于指定装配。"
      );
    }
    const hops = input.maxInterconnectHops ?? 1;
    if (
      !Number.isSafeInteger(hops) ||
      hops < 0 ||
      hops > MCP_ASSEMBLY_LIMITS.maxInterconnectHops
    ) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_INVALID,
        `maxInterconnectHops 必须是 0～${MCP_ASSEMBLY_LIMITS.maxInterconnectHops}。`
      );
    }
    const entry = this.projects.requireEntry(input.projectHandle);
    const lookup = entry.index.getComponent(input);
    if (lookup.status !== "FOUND") return lookup;
    if (lookup.component.designator === undefined) {
      return {
        status: "FOUND",
        component: lookup.component,
        paths: { items: [], total: 0 }
      };
    }
    const paths = this.walk(
      assembly,
      input.projectHandle,
      lookup.component.designator,
      input.pinNumber,
      hops
    );
    return {
      status: "FOUND",
      component: lookup.component,
      paths: paginate(
        paths,
        input.limit,
        input.cursor,
        this.revision,
        `assembly-connections\n${assembly.assemblyHandle}\n${input.projectHandle}\n${lookup.component.pageId}\n${lookup.component.id}\n${input.pinNumber ?? ""}\n${hops}`
      )
    };
  }

  public getManifest(assemblyHandle: string): SchematicAssemblyManifest {
    const assembly = this.requireAssembly(assemblyHandle);
    const projects = assembly.projectHandles
      .map((handle) => {
        const entry = this.projects.requireEntry(handle);
        return {
          projectId: projectIdForIr(entry.index.ir.irSha256),
          irSha256: entry.index.ir.irSha256
        };
      })
      .sort((left, right) => compareText(left.projectId, right.projectId));
    const projectIds = new Map(
      projects.map((project) => [
        `schematic_${project.irSha256}`,
        project.projectId
      ])
    );
    return createSchematicAssemblyManifest({
      schema: "schemcp.schematic-assembly-manifest",
      schemaVersion: "1.0.0",
      generator: {
        name: "@yuanzihao/schemcp",
        version: "0.1.0"
      },
      projects,
      assembly: {
        projectIds: projects.map((project) => project.projectId),
        interconnects: assembly.interconnects.map((interconnect) => ({
          interconnectId: interconnect.interconnectId,
          candidateId: interconnect.candidateId,
          left: {
            projectId: projectIds.get(interconnect.left.projectHandle)!,
            componentId: interconnect.left.componentId,
            pageId: interconnect.left.pageId,
            ...(interconnect.left.designator === undefined
              ? {}
              : { designator: interconnect.left.designator })
          },
          right: {
            projectId: projectIds.get(interconnect.right.projectHandle)!,
            componentId: interconnect.right.componentId,
            pageId: interconnect.right.pageId,
            ...(interconnect.right.designator === undefined
              ? {}
              : { designator: interconnect.right.designator })
          },
          pinPairs: interconnect.pinPairs.map((pair) => ({ ...pair })),
          mappingMethod: interconnect.mappingMethod,
          relationshipTruth: interconnect.relationshipTruth
        })),
        relationshipTruth: assembly.relationshipTruth
      }
    });
  }

  public async openManifest(inputPath: string): Promise<{
    readonly disposition: "RESTORED" | "ALREADY_RESTORED";
    readonly assembly: SchematicAssembly;
    readonly manifestSha256: string;
    readonly inputBytes: number;
  }> {
    const { manifest, bytes } = await readSchematicAssemblyManifest(inputPath, {
      requireAbsolute: true
    });
    const handleByProjectId = new Map<string, string>();
    for (const project of manifest.projects) {
      const handle = `schematic_${project.irSha256}`;
      const entry = this.projects.getEntry(handle);
      if (
        entry === undefined ||
        entry.index.ir.irSha256 !== project.irSha256
      ) {
        throw new AppError(
          ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
          "原理图装配清单引用的 EDA-IR 未全部在当前会话中精确打开。"
        );
      }
      handleByProjectId.set(project.projectId, handle);
    }
    const projectHandles = manifest.assembly.projectIds.map(
      (projectId) => handleByProjectId.get(projectId)!
    );
    const assemblyHandle = stableHash(
      "assembly",
      [...projectHandles].sort(compareText)
    );
    const candidateAssembly: SchematicAssembly = {
      assemblyHandle,
      projectHandles: [...projectHandles].sort(compareText),
      interconnects: [],
      relationshipTruth: "USER_ASSERTED_PROJECT_RELATIONSHIP"
    };
    const candidates = new Map(
      this.candidates(candidateAssembly).map((candidate) => [
        candidate.candidateId,
        candidate
      ])
    );
    const restoredInterconnects: SchematicInterconnect[] = [];
    for (const saved of manifest.assembly.interconnects) {
      const candidate = candidates.get(saved.candidateId);
      if (candidate === undefined) {
        throw new AppError(
          ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
          "原理图装配清单中的互连候选不能由当前 EDA-IR 精确复算。"
        );
      }
      const left = this.restoreEndpoint(saved.left, handleByProjectId);
      const right = this.restoreEndpoint(saved.right, handleByProjectId);
      if (
        JSON.stringify(left) !== JSON.stringify(candidate.left) ||
        JSON.stringify(right) !== JSON.stringify(candidate.right)
      ) {
        throw new AppError(
          ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
          "原理图装配清单中的组件选择器与当前互连候选不一致。"
        );
      }
      this.validatePinPairs(candidate, saved.pinPairs);
      if (
        saved.mappingMethod === "USER_CONFIRMED_SAME_PIN_NUMBER" &&
        (saved.pinPairs.length !== candidate.pinNumbers.length ||
          saved.pinPairs.some(
            (pair, index) =>
              pair.leftPinNumber !== candidate.pinNumbers[index] ||
              pair.rightPinNumber !== candidate.pinNumbers[index]
          ))
      ) {
        throw new AppError(
          ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
          "同号针脚映射与当前候选针脚集合不一致。"
        );
      }
      const interconnectId = stableHash("interconnect", [
        saved.candidateId,
        saved.pinPairs
      ]);
      if (interconnectId !== saved.interconnectId) {
        throw new AppError(
          ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
          "原理图装配清单中的互连 ID 无法复算。"
        );
      }
      restoredInterconnects.push({
        interconnectId,
        candidateId: saved.candidateId,
        left,
        right,
        pinPairs: saved.pinPairs.map((pair) => ({ ...pair })),
        mappingMethod: saved.mappingMethod,
        relationshipTruth: "USER_CONFIRMED_SESSION_RELATIONSHIP"
      });
    }
    const restored: SchematicAssembly = {
      ...candidateAssembly,
      interconnects: restoredInterconnects.sort((left, right) =>
        compareText(left.interconnectId, right.interconnectId)
      )
    };
    const existing = this.assemblies.get(assemblyHandle);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(restored)) {
        throw new AppError(
          ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
          "当前会话已有相同成员但互连内容不同的装配；请先关闭该装配。"
        );
      }
      return {
        disposition: "ALREADY_RESTORED",
        assembly: existing,
        manifestSha256: manifest.manifestSha256,
        inputBytes: bytes
      };
    }
    if (this.assemblies.size >= MCP_ASSEMBLY_LIMITS.maxAssemblies) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_LIMIT_EXCEEDED,
        `当前会话最多保留 ${MCP_ASSEMBLY_LIMITS.maxAssemblies} 个装配。`
      );
    }
    this.assemblies.set(assemblyHandle, restored);
    this.revision += 1;
    return {
      disposition: "RESTORED",
      assembly: restored,
      manifestSha256: manifest.manifestSha256,
      inputBytes: bytes
    };
  }

  private requireAssembly(assemblyHandle: string): SchematicAssembly {
    this.prune();
    const assembly = this.assemblies.get(assemblyHandle);
    if (assembly === undefined) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_INVALID,
        "装配句柄不存在或因工程关闭而失效。"
      );
    }
    return assembly;
  }

  private restoreEndpoint(
    endpoint: {
      readonly projectId: string;
      readonly componentId: string;
      readonly pageId: string;
      readonly designator?: string | undefined;
    },
    handleByProjectId: ReadonlyMap<string, string>
  ): AssemblyComponentEndpoint {
    const projectHandle = handleByProjectId.get(endpoint.projectId);
    if (projectHandle === undefined) {
      throw new AppError(
        ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
        "原理图装配清单中的组件引用了未知工程。"
      );
    }
    return {
      projectHandle,
      componentId: endpoint.componentId,
      pageId: endpoint.pageId,
      ...(endpoint.designator === undefined
        ? {}
        : { designator: endpoint.designator })
    };
  }

  private candidates(
    assembly: SchematicAssembly
  ): readonly InterconnectCandidate[] {
    const profiles = new Map(
      assembly.projectHandles.map((handle) => [
        handle,
        projectProfiles(handle, this.projects.requireEntry(handle))
      ])
    );
    const result: InterconnectCandidate[] = [];
    for (let leftIndex = 0; leftIndex < assembly.projectHandles.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < assembly.projectHandles.length;
        rightIndex += 1
      ) {
        const leftHandle = assembly.projectHandles[leftIndex] as string;
        const rightHandle = assembly.projectHandles[rightIndex] as string;
        for (const left of profiles.get(leftHandle) ?? []) {
          for (const right of profiles.get(rightHandle) ?? []) {
            const candidate = candidateFor(left, right);
            if (candidate !== undefined) result.push(candidate);
            if (result.length > MCP_ASSEMBLY_LIMITS.maxCandidatePairs) {
              throw new AppError(
                ERROR_CODES.MCP_ASSEMBLY_LIMIT_EXCEEDED,
                "互连候选数量超过安全限额；请缩小装配工程集合。"
              );
            }
          }
        }
      }
    }
    return result.sort(candidateSort);
  }

  private validatePinPairs(
    candidate: InterconnectCandidate,
    pinPairs: readonly AssemblyPinPair[]
  ): void {
    if (
      pinPairs.length < 1 ||
      pinPairs.length > MCP_ASSEMBLY_LIMITS.maxPinPairs
    ) {
      throw new AppError(
        ERROR_CODES.MCP_INTERCONNECT_INVALID,
        `针脚映射必须包含 1～${MCP_ASSEMBLY_LIMITS.maxPinPairs} 对。`
      );
    }
    const allowed = new Set(candidate.pinNumbers);
    const left = new Set<string>();
    const right = new Set<string>();
    for (const pair of pinPairs) {
      if (
        !allowed.has(pair.leftPinNumber) ||
        !allowed.has(pair.rightPinNumber) ||
        left.has(pair.leftPinNumber) ||
        right.has(pair.rightPinNumber)
      ) {
        throw new AppError(
          ERROR_CODES.MCP_INTERCONNECT_INVALID,
          "针脚映射包含不存在、重复或多对一的针脚。"
        );
      }
      left.add(pair.leftPinNumber);
      right.add(pair.rightPinNumber);
    }
  }

  private endpointsForProject(
    projectHandle: string
  ): readonly ElectricalEndpoint[] {
    const entry = this.projects.requireEntry(projectHandle);
    if (entry.netlist !== undefined) {
      return entry.netlist.components.flatMap((component) =>
        component.pins.flatMap((pin) =>
          pin.net === ""
            ? []
            : [
                {
                  projectHandle,
                  componentRef: component.designator,
                  pinNumber: pin.number,
                  ...(pin.name === "" ? {} : { pinName: pin.name }),
                  netName: pin.net,
                  evidence: "BOUND_NETLIST" as const
                }
              ]
        )
      );
    }
    const items: ElectricalEndpoint[] = [];
    let cursor: string | undefined;
    do {
      const page = entry.index.listCandidateNetlistTuples({
        limit: QUERY_LIMITS.maxPageSize,
        ...(cursor === undefined ? {} : { cursor })
      });
      items.push(
        ...page.items.map((item) => ({
          projectHandle,
          componentRef: item.tuple.componentRef,
          pinNumber: item.tuple.pinNumber,
          netName: item.tuple.netName,
          evidence: "EPRO2_CANDIDATE" as const
        }))
      );
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return items;
  }

  private walk(
    assembly: SchematicAssembly,
    startProject: string,
    startRef: string,
    startPin: string | undefined,
    maxHops: number
  ): readonly AssemblyConnectionPath[] {
    const endpointsByProject = new Map(
      assembly.projectHandles.map((handle) => [
        handle,
        this.endpointsForProject(handle)
      ])
    );
    const cross = new Map<
      string,
      {
        readonly targetProject: string;
        readonly targetRef: string;
        readonly targetPin: string;
      }[]
    >();
    for (const interconnect of assembly.interconnects) {
      if (
        interconnect.left.designator === undefined ||
        interconnect.right.designator === undefined
      ) {
        continue;
      }
      for (const pair of interconnect.pinPairs) {
        const leftKey = endpointKey(
          interconnect.left.projectHandle,
          interconnect.left.designator,
          pair.leftPinNumber
        );
        const rightKey = endpointKey(
          interconnect.right.projectHandle,
          interconnect.right.designator,
          pair.rightPinNumber
        );
        const leftTargets = cross.get(leftKey) ?? [];
        leftTargets.push({
          targetProject: interconnect.right.projectHandle,
          targetRef: interconnect.right.designator,
          targetPin: pair.rightPinNumber
        });
        cross.set(leftKey, leftTargets);
        const rightTargets = cross.get(rightKey) ?? [];
        rightTargets.push({
          targetProject: interconnect.left.projectHandle,
          targetRef: interconnect.left.designator,
          targetPin: pair.leftPinNumber
        });
        cross.set(rightKey, rightTargets);
      }
    }
    const startEndpoints = (endpointsByProject.get(startProject) ?? []).filter(
      (endpoint) =>
        endpoint.componentRef === startRef &&
        (startPin === undefined || endpoint.pinNumber === startPin)
    );
    const paths: AssemblyConnectionPath[] = [];
    const queue = startEndpoints.map((endpoint) => ({
      endpoint,
      hops: 0,
      segments: [] as AssemblyConnectionSegment[],
      visited: new Set([
        endpointKey(
          endpoint.projectHandle,
          endpoint.componentRef,
          endpoint.pinNumber
        )
      ])
    }));
    while (queue.length > 0) {
      const state = queue.shift()!;
      const peers = (endpointsByProject.get(state.endpoint.projectHandle) ?? [])
        .filter(
          (peer) =>
            peer.netName === state.endpoint.netName &&
            !(
              peer.componentRef === state.endpoint.componentRef &&
              peer.pinNumber === state.endpoint.pinNumber
            )
        );
      for (const peer of peers) {
        const localSegment: AssemblyConnectionSegment = {
          kind: state.endpoint.evidence,
          projectHandle: state.endpoint.projectHandle,
          netName: state.endpoint.netName,
          from: state.endpoint,
          to: peer
        };
        const localPath = [...state.segments, localSegment];
        paths.push({
          target: peer,
          interconnectHops: state.hops,
          segments: localPath,
          propagation: "NET_AND_CONFIRMED_INTERCONNECT_ONLY",
          electricalTruth: "NOT_VERIFIED"
        });
        if (state.hops >= maxHops) continue;
        const mappings =
          cross.get(
            endpointKey(
              peer.projectHandle,
              peer.componentRef,
              peer.pinNumber
            )
          ) ?? [];
        for (const mapping of mappings) {
          const mappedKey = endpointKey(
            mapping.targetProject,
            mapping.targetRef,
            mapping.targetPin
          );
          if (state.visited.has(mappedKey)) continue;
          const targetEndpoint = (
            endpointsByProject.get(mapping.targetProject) ?? []
          ).find(
            (endpoint) =>
              endpoint.componentRef === mapping.targetRef &&
              endpoint.pinNumber === mapping.targetPin
          );
          if (targetEndpoint === undefined) continue;
          const crossSegment: AssemblyConnectionSegment = {
            kind: "CONFIRMED_INTERCONNECT",
            from: peer,
            to: targetEndpoint
          };
          queue.push({
            endpoint: targetEndpoint,
            hops: state.hops + 1,
            segments: [...localPath, crossSegment],
            visited: new Set([...state.visited, mappedKey])
          });
        }
      }
    }
    return [...new Map(
      paths.map((path) => [
        JSON.stringify([
          path.target.projectHandle,
          path.target.componentRef,
          path.target.pinNumber,
          path.segments.map((segment) => segment.kind)
        ]),
        path
      ])
    ).values()].sort(
      (left, right) =>
        left.interconnectHops - right.interconnectHops ||
        compareText(left.target.projectHandle, right.target.projectHandle) ||
        compareText(left.target.componentRef, right.target.componentRef) ||
        compareText(left.target.pinNumber, right.target.pinNumber)
    );
  }
}
