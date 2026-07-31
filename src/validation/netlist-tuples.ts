import type {
  IrNetworkEndpointCandidate,
  IrPinConnectionCandidateStatus,
  IrPinInstance,
  IrSchematicPage,
  IrShortRelationCandidate
} from "../ir/model.js";

export interface NetlistTuple {
  readonly componentRef: string;
  readonly pinNumber: string;
  readonly netName: string;
}

export interface CandidateNetlistTupleEvidence {
  readonly pinInstanceId: string;
  readonly pageId: string;
  readonly componentId: string;
  readonly symbolPinId: string;
  readonly wireIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly automaticNetResolution?:
    | {
        readonly basis: "UNLABELED_WIRE_PAGE_CREATION_RANK_AND_WIRE_ID";
        readonly pageCreationTicket: number;
        readonly pageCreationRank: number;
        readonly wireId: string;
        readonly generatedNetName: string;
      }
    | {
        readonly basis: "UNLABELED_WIRE_SINGLE_PAGE_AND_WIRE_ID";
        readonly pageNumber: 1;
        readonly wireId: string;
        readonly generatedNetName: string;
      };
  readonly networkResolution?: {
    readonly basis: "SHORT_SYMBOL_RELATIONS_NET_FLAG_COUNT_EXPLICIT_THEN_BYTEWISE_NAME";
    readonly originalNetName: string;
    readonly canonicalNetName: string;
    readonly aliases: readonly {
      readonly netName: string;
      readonly netFlagEndpointCount: number;
      readonly automatic: boolean;
    }[];
    readonly shortRelationIds: readonly string[];
  };
}

export interface CandidateNetlistTuple {
  readonly tuple: NetlistTuple;
  readonly evidence: CandidateNetlistTupleEvidence;
}

export type CandidateTupleExclusionReason =
  | "MISSING_COMPONENT_REF"
  | "NON_COMPONENT_ENDPOINT"
  | "MISSING_PIN_NUMBER"
  | "CONFLICTING_EXPLICIT_NET_CANDIDATES"
  | "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET"
  | "DECLARED_NO_CONNECT"
  | "UNRESOLVED_NO_WIRE"
  | "CANDIDATE_STATE_INCONSISTENT";

export interface CandidateTupleExclusion {
  readonly pinInstanceId: string;
  readonly pageId: string;
  readonly componentId: string;
  readonly symbolPinId: string;
  readonly reason: CandidateTupleExclusionReason;
  readonly candidateStatus: IrPinConnectionCandidateStatus;
}

export interface CandidateTupleCompilation {
  readonly tuples: readonly CandidateNetlistTuple[];
  readonly exclusions: readonly CandidateTupleExclusion[];
  readonly summary: {
    readonly pinInstances: number;
    readonly eligibleTuples: number;
    readonly excludedPinInstances: number;
    readonly missingComponentRef: number;
    readonly nonComponentEndpoint: number;
    readonly missingPinNumber: number;
    readonly conflictingExplicitNetCandidates: number;
    readonly unresolvedWireWithoutExplicitNet: number;
    readonly declaredNoConnect: number;
    readonly unresolvedNoWire: number;
    readonly inconsistentCandidateState: number;
  };
}

export interface DuplicateNetlistTuple {
  readonly tuple: NetlistTuple;
  readonly occurrences: number;
}

export type NetlistTupleComparisonStatus =
  | "EXACT_SET_MATCH"
  | "DIFFERENCES_FOUND"
  | "DUPLICATE_TUPLES";

export interface NetlistTupleComparison {
  readonly schemaVersion: "0.1.0";
  readonly status: NetlistTupleComparisonStatus;
  readonly exactSetMatch: boolean;
  readonly candidateTupleCount: number;
  readonly truthTupleCount: number;
  readonly matched: readonly NetlistTuple[];
  readonly missingInCandidate: readonly NetlistTuple[];
  readonly unexpectedCandidate: readonly NetlistTuple[];
  readonly candidateDuplicates: readonly DuplicateNetlistTuple[];
  readonly truthDuplicates: readonly DuplicateNetlistTuple[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTuple(left: NetlistTuple, right: NetlistTuple): number {
  return (
    compareText(left.componentRef, right.componentRef) ||
    compareText(left.pinNumber, right.pinNumber) ||
    compareText(left.netName, right.netName)
  );
}

function tupleKey(tuple: NetlistTuple): string {
  return JSON.stringify([
    tuple.componentRef,
    tuple.pinNumber,
    tuple.netName
  ]);
}

function exclusion(
  pin: IrPinInstance,
  reason: CandidateTupleExclusionReason
): CandidateTupleExclusion {
  return {
    pinInstanceId: pin.id,
    pageId: pin.pageId,
    componentId: pin.componentId,
    symbolPinId: pin.symbolPinId,
    reason,
    candidateStatus: pin.connectionCandidate.status
  };
}

function unresolvedReason(
  status: IrPinConnectionCandidateStatus
): CandidateTupleExclusionReason {
  switch (status) {
    case "CONFLICTING_EXPLICIT_NET_CANDIDATES":
      return "CONFLICTING_EXPLICIT_NET_CANDIDATES";
    case "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET":
      return "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET";
    case "DECLARED_NO_CONNECT":
      return "DECLARED_NO_CONNECT";
    case "UNRESOLVED_NO_WIRE":
      return "UNRESOLVED_NO_WIRE";
    case "UNIQUE_EXPLICIT_NET_CANDIDATE":
      return "CANDIDATE_STATE_INCONSISTENT";
  }
}

export function compileCandidateNetlistTuples(
  pinInstances: readonly IrPinInstance[]
): CandidateTupleCompilation {
  const tuples: CandidateNetlistTuple[] = [];
  const exclusions: CandidateTupleExclusion[] = [];

  for (const pin of pinInstances) {
    if (pin.connectionCandidate.status !== "UNIQUE_EXPLICIT_NET_CANDIDATE") {
      exclusions.push(
        exclusion(pin, unresolvedReason(pin.connectionCandidate.status))
      );
      continue;
    }
    if (
      pin.endpointKind !== "PART_SYMBOL_PIN" &&
      pin.endpointKind !== "UNKNOWN_SYMBOL_PIN"
    ) {
      exclusions.push(exclusion(pin, "NON_COMPONENT_ENDPOINT"));
      continue;
    }
    if (pin.designator === undefined || pin.designator.length === 0) {
      exclusions.push(exclusion(pin, "MISSING_COMPONENT_REF"));
      continue;
    }
    if (pin.number === undefined || pin.number.length === 0) {
      exclusions.push(exclusion(pin, "MISSING_PIN_NUMBER"));
      continue;
    }
    const [candidate] = pin.connectionCandidate.explicitNets;
    if (
      candidate === undefined ||
      pin.connectionCandidate.explicitNets.length !== 1
    ) {
      exclusions.push(exclusion(pin, "CANDIDATE_STATE_INCONSISTENT"));
      continue;
    }
    tuples.push({
      tuple: {
        componentRef: pin.designator,
        pinNumber: pin.number,
        netName: candidate.netName
      },
      evidence: {
        pinInstanceId: pin.id,
        pageId: pin.pageId,
        componentId: pin.componentId,
        symbolPinId: pin.symbolPinId,
        wireIds: candidate.wireIds,
        segmentIds: candidate.segmentIds
      }
    });
  }

  tuples.sort(
    (left, right) =>
      compareTuple(left.tuple, right.tuple) ||
      compareText(left.evidence.pinInstanceId, right.evidence.pinInstanceId)
  );
  exclusions.sort(
    (left, right) =>
      compareText(left.pageId, right.pageId) ||
      compareText(left.componentId, right.componentId) ||
      compareText(left.symbolPinId, right.symbolPinId) ||
      compareText(left.reason, right.reason)
  );

  const count = (reason: CandidateTupleExclusionReason): number =>
    exclusions.filter((item) => item.reason === reason).length;
  return {
    tuples,
    exclusions,
    summary: {
      pinInstances: pinInstances.length,
      eligibleTuples: tuples.length,
      excludedPinInstances: exclusions.length,
      missingComponentRef: count("MISSING_COMPONENT_REF"),
      nonComponentEndpoint: count("NON_COMPONENT_ENDPOINT"),
      missingPinNumber: count("MISSING_PIN_NUMBER"),
      conflictingExplicitNetCandidates: count(
        "CONFLICTING_EXPLICIT_NET_CANDIDATES"
      ),
      unresolvedWireWithoutExplicitNet: count(
        "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET"
      ),
      declaredNoConnect: count("DECLARED_NO_CONNECT"),
      unresolvedNoWire: count("UNRESOLVED_NO_WIRE"),
      inconsistentCandidateState: count("CANDIDATE_STATE_INCONSISTENT")
    }
  };
}

interface ResolvedNetAlias {
  readonly canonicalNetName: string;
  readonly aliases: readonly {
    readonly netName: string;
    readonly netFlagEndpointCount: number;
    readonly automatic: boolean;
  }[];
  readonly shortRelationIds: readonly string[];
}

type AutomaticNetPageIndex =
  | {
      readonly basis: "UNLABELED_WIRE_PAGE_CREATION_RANK_AND_WIRE_ID";
      readonly index: number;
      readonly pageCreationTicket: number;
    }
  | {
      readonly basis: "UNLABELED_WIRE_SINGLE_PAGE_AND_WIRE_ID";
      readonly index: 1;
    };

/**
 * 按 Short Symbol 关系合并候选网络名。
 *
 * 嘉立创专业版真实 `.enet` 对照确认：短接分量优先采用 NetFlag 端点数量更多的
 * 网络名，其次优先显式名称，最后按确定的字节序选择。这里只解析工程结构，
 * 不读取官方网表来决定名称，因此比较结果仍可独立复算。
 */
export function compileResolvedCandidateNetlistTuples(
  pinInstances: readonly IrPinInstance[],
  shortRelations: readonly IrShortRelationCandidate[],
  networkEndpointCandidates: readonly IrNetworkEndpointCandidate[],
  schematicPages: readonly IrSchematicPage[]
): CandidateTupleCompilation {
  const base = compileCandidateNetlistTuples(pinInstances);
  const pagesBySchematic = new Map<string, IrSchematicPage[]>();
  for (const page of schematicPages) {
    if (page.schematicId === undefined || page.creationTicket === undefined) {
      continue;
    }
    const pages = pagesBySchematic.get(page.schematicId) ?? [];
    pages.push(page);
    pagesBySchematic.set(page.schematicId, pages);
  }
  const automaticNetPageIndexes = new Map<string, AutomaticNetPageIndex>();
  for (const pages of pagesBySchematic.values()) {
    const expectedPageCount = schematicPages.filter(
      (candidate) =>
        candidate.schematicId !== undefined &&
        candidate.schematicId === pages[0]?.schematicId
    ).length;
    const tickets = new Set(pages.map((page) => page.creationTicket));
    if (
      pages.length !== expectedPageCount ||
      tickets.size !== pages.length
    ) {
      continue;
    }
    pages.sort(
      (left, right) =>
        (left.creationTicket as number) -
          (right.creationTicket as number) ||
        compareText(left.id, right.id)
    );
    pages.forEach((page, index) => {
      automaticNetPageIndexes.set(page.id, {
        basis: "UNLABELED_WIRE_PAGE_CREATION_RANK_AND_WIRE_ID",
        pageCreationTicket: page.creationTicket as number,
        index: index + 1
      });
    });
  }
  for (const page of schematicPages) {
    if (
      page.schematicId !== undefined &&
      !automaticNetPageIndexes.has(page.id) &&
      schematicPages.filter(
        (candidate) => candidate.schematicId === page.schematicId
      ).length === 1
    ) {
      automaticNetPageIndexes.set(page.id, {
        basis: "UNLABELED_WIRE_SINGLE_PAGE_AND_WIRE_ID",
        index: 1
      });
    }
  }
  const automaticNet = (
    pageId: string,
    wireIds: readonly string[]
  ):
    | {
        readonly pageIndex: AutomaticNetPageIndex;
        readonly wireId: string;
        readonly generatedNetName: string;
      }
    | undefined => {
    if (wireIds.length !== 1) return undefined;
    const pageIndex = automaticNetPageIndexes.get(pageId);
    const wireId = wireIds[0] as string;
    const match = /^e([1-9][0-9]*)$/.exec(wireId);
    if (pageIndex === undefined || match === null) return undefined;
    return {
      pageIndex,
      wireId,
      generatedNetName: `$${pageIndex.index}N${match[1] as string}`
    };
  };
  const automaticTuples: CandidateNetlistTuple[] = [];
  const automaticPinIds = new Set<string>();
  for (const pin of pinInstances) {
    if (
      pin.connectionCandidate.status !==
        "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET" ||
      pin.endpointKind !== "PART_SYMBOL_PIN" ||
      pin.designator === undefined ||
      pin.designator.length === 0 ||
      pin.number === undefined ||
      pin.number.length === 0 ||
      pin.connectionCandidate.unlabeledWireIds.length !== 1
    ) {
      continue;
    }
    const automatic = automaticNet(
      pin.pageId,
      pin.connectionCandidate.unlabeledWireIds
    );
    if (automatic === undefined) continue;
    automaticTuples.push({
      tuple: {
        componentRef: pin.designator,
        pinNumber: pin.number,
        netName: automatic.generatedNetName
      },
      evidence: {
        pinInstanceId: pin.id,
        pageId: pin.pageId,
        componentId: pin.componentId,
        symbolPinId: pin.symbolPinId,
        wireIds: [automatic.wireId],
        segmentIds: [],
        automaticNetResolution:
          automatic.pageIndex.basis ===
          "UNLABELED_WIRE_PAGE_CREATION_RANK_AND_WIRE_ID"
            ? {
                basis: automatic.pageIndex.basis,
                pageCreationTicket:
                  automatic.pageIndex.pageCreationTicket,
                pageCreationRank: automatic.pageIndex.index,
                wireId: automatic.wireId,
                generatedNetName: automatic.generatedNetName
              }
            : {
                basis: automatic.pageIndex.basis,
                pageNumber: 1,
                wireId: automatic.wireId,
                generatedNetName: automatic.generatedNetName
              }
      }
    });
    automaticPinIds.add(pin.id);
  }
  const unresolvedExclusions = base.exclusions.filter(
    (item) => !automaticPinIds.has(item.pinInstanceId)
  );
  const unresolvedCount = unresolvedExclusions.filter(
    (item) => item.reason === "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET"
  ).length;
  const enrichedBase: CandidateTupleCompilation = {
    tuples: [...base.tuples, ...automaticTuples],
    exclusions: unresolvedExclusions,
    summary: {
      ...base.summary,
      eligibleTuples: base.summary.eligibleTuples + automaticTuples.length,
      excludedPinInstances:
        base.summary.excludedPinInstances - automaticTuples.length,
      unresolvedWireWithoutExplicitNet: unresolvedCount
    }
  };
  const parents = new Map<string, string>();
  const find = (netName: string): string => {
    if (!parents.has(netName)) parents.set(netName, netName);
    let root = netName;
    while (parents.get(root) !== root) {
      root = parents.get(root) as string;
    }
    let current = netName;
    while (parents.get(current) !== current) {
      const next = parents.get(current) as string;
      parents.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const lower = compareText(leftRoot, rightRoot) <= 0 ? leftRoot : rightRoot;
    const higher = lower === leftRoot ? rightRoot : leftRoot;
    parents.set(higher, lower);
  };
  const resolvedRelations: {
    readonly id: string;
    readonly netNames: readonly [string, string];
  }[] = [];
  for (const relation of shortRelations) {
    if (relation.pins.length !== 2) continue;
    const netNames = relation.pins.map((pin) => {
      const connection = pin.connectionCandidate;
      if (
        connection.status === "UNIQUE_EXPLICIT_NET_CANDIDATE" &&
        connection.explicitNets.length === 1
      ) {
        return connection.explicitNets[0]?.netName;
      }
      if (
        connection.status === "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET"
      ) {
        return automaticNet(
          relation.pageId,
          connection.unlabeledWireIds
        )?.generatedNetName;
      }
      return undefined;
    });
    if (
      netNames[0] === undefined ||
      netNames[1] === undefined ||
      netNames[0] === netNames[1]
    ) {
      continue;
    }
    const pair = [netNames[0], netNames[1]] as const;
    resolvedRelations.push({ id: relation.id, netNames: pair });
    union(pair[0], pair[1]);
  }
  const flagCounts = new Map<string, number>();
  for (const endpoint of networkEndpointCandidates) {
    if (
      endpoint.endpointKind === "NET_FLAG" &&
      endpoint.connectionNetNameCandidate !== undefined
    ) {
      flagCounts.set(
        endpoint.connectionNetNameCandidate,
        (flagCounts.get(endpoint.connectionNetNameCandidate) ?? 0) + 1
      );
    }
  }
  const groups = new Map<string, string[]>();
  for (const netName of parents.keys()) {
    const root = find(netName);
    const group = groups.get(root) ?? [];
    group.push(netName);
    groups.set(root, group);
  }
  const resolvedByNet = new Map<string, ResolvedNetAlias>();
  for (const group of groups.values()) {
    const aliases = group
      .map((netName) => ({
        netName,
        netFlagEndpointCount: flagCounts.get(netName) ?? 0,
        automatic: /^\$[1-9][0-9]*N[1-9][0-9]*$/.test(netName)
      }))
      .sort(
        (left, right) =>
          right.netFlagEndpointCount - left.netFlagEndpointCount ||
          Number(left.automatic) - Number(right.automatic) ||
          compareText(left.netName, right.netName)
      );
    const canonicalNetName = aliases[0]?.netName;
    if (canonicalNetName === undefined) continue;
    const names = new Set(aliases.map((alias) => alias.netName));
    const shortRelationIds = resolvedRelations
      .filter((relation) =>
        relation.netNames.some((netName) => names.has(netName))
      )
      .map((relation) => relation.id)
      .sort(compareText);
    const resolved = { canonicalNetName, aliases, shortRelationIds };
    for (const alias of aliases) {
      resolvedByNet.set(alias.netName, resolved);
    }
  }
  const tuples = enrichedBase.tuples
    .map((candidate) => {
      const originalNetName = candidate.tuple.netName;
      const resolved = resolvedByNet.get(originalNetName);
      if (resolved === undefined) return candidate;
      return {
        tuple: {
          ...candidate.tuple,
          netName: resolved.canonicalNetName
        },
        evidence: {
          ...candidate.evidence,
          networkResolution: {
            basis:
              "SHORT_SYMBOL_RELATIONS_NET_FLAG_COUNT_EXPLICIT_THEN_BYTEWISE_NAME" as const,
            originalNetName,
            canonicalNetName: resolved.canonicalNetName,
            aliases: resolved.aliases,
            shortRelationIds: resolved.shortRelationIds
          }
        }
      };
    })
    .sort(
      (left, right) =>
        compareTuple(left.tuple, right.tuple) ||
        compareText(left.evidence.pinInstanceId, right.evidence.pinInstanceId)
    );
  return {
    ...enrichedBase,
    tuples
  };
}

function groupTuples(
  tuples: readonly NetlistTuple[]
): ReadonlyMap<string, { readonly tuple: NetlistTuple; occurrences: number }> {
  const groups = new Map<
    string,
    { readonly tuple: NetlistTuple; occurrences: number }
  >();
  for (const tuple of tuples) {
    const key = tupleKey(tuple);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { tuple, occurrences: 1 });
    } else {
      existing.occurrences += 1;
    }
  }
  return groups;
}

function duplicates(
  groups: ReadonlyMap<
    string,
    { readonly tuple: NetlistTuple; readonly occurrences: number }
  >
): readonly DuplicateNetlistTuple[] {
  return [...groups.values()]
    .filter((item) => item.occurrences > 1)
    .map((item) => ({
      tuple: item.tuple,
      occurrences: item.occurrences
    }))
    .sort((left, right) => compareTuple(left.tuple, right.tuple));
}

/**
 * 对两个规范化元组集合做精确、区分方向的比较。
 *
 * 本函数只证明给定集合之间的关系；调用者仍必须独立证明官方网表来源、
 * 解析完整性、组件/引脚覆盖范围和 exclusions 均满足阶段门禁。
 */
export function compareNetlistTupleSets(
  candidateTuples: readonly NetlistTuple[],
  truthTuples: readonly NetlistTuple[]
): NetlistTupleComparison {
  const candidateGroups = groupTuples(candidateTuples);
  const truthGroups = groupTuples(truthTuples);
  const matched: NetlistTuple[] = [];
  const missingInCandidate: NetlistTuple[] = [];
  const unexpectedCandidate: NetlistTuple[] = [];

  for (const [key, item] of truthGroups) {
    if (candidateGroups.has(key)) {
      matched.push(item.tuple);
    } else {
      missingInCandidate.push(item.tuple);
    }
  }
  for (const [key, item] of candidateGroups) {
    if (!truthGroups.has(key)) {
      unexpectedCandidate.push(item.tuple);
    }
  }
  matched.sort(compareTuple);
  missingInCandidate.sort(compareTuple);
  unexpectedCandidate.sort(compareTuple);

  const candidateDuplicates = duplicates(candidateGroups);
  const truthDuplicates = duplicates(truthGroups);
  const hasDuplicates =
    candidateDuplicates.length > 0 || truthDuplicates.length > 0;
  const hasDifferences =
    missingInCandidate.length > 0 || unexpectedCandidate.length > 0;
  const status: NetlistTupleComparisonStatus = hasDuplicates
    ? "DUPLICATE_TUPLES"
    : hasDifferences
      ? "DIFFERENCES_FOUND"
      : "EXACT_SET_MATCH";

  return {
    schemaVersion: "0.1.0",
    status,
    exactSetMatch: status === "EXACT_SET_MATCH",
    candidateTupleCount: candidateTuples.length,
    truthTupleCount: truthTuples.length,
    matched,
    missingInCandidate,
    unexpectedCandidate,
    candidateDuplicates,
    truthDuplicates
  };
}
