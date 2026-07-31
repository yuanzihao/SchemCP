import { createHash } from "node:crypto";
import type { NetlistComparisonReport } from "../truth/compare-netlist-evidence.js";
import type {
  CandidateNetlistTupleEvidence,
  DuplicateNetlistTuple,
  NetlistTuple
} from "../validation/netlist-tuples.js";
import type { JlcEdaProEnet } from "../truth/jlceda-pro-enet.js";
import {
  QueryError,
  QUERY_LIMITS,
  type Page
} from "./index.js";

export type NetlistComparisonTupleKind =
  | "MATCHED"
  | "MISSING_IN_CANDIDATE"
  | "UNEXPECTED_CANDIDATE";

export interface NetlistComparisonTupleItem {
  readonly kind: NetlistComparisonTupleKind;
  readonly tuple: NetlistTuple;
  readonly candidateEvidence?: readonly CandidateNetlistTupleEvidence[];
}

export interface NetlistComparisonTupleListOptions {
  readonly kind?: NetlistComparisonTupleKind | undefined;
  readonly componentRef?: string | undefined;
  readonly pinNumber?: string | undefined;
  readonly netName?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface BoundNetLookupOptions {
  readonly netName: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface BoundElectricalNetListOptions {
  readonly comparisonStatus?: BoundNetComparisonStatus | undefined;
  readonly componentRef?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export type BoundNetComparisonStatus =
  | "EXACT_SET_MATCH"
  | "DIFFERENCES_FOUND"
  | "DUPLICATE_TUPLES";

export interface BoundElectricalNetSummary {
  readonly name: string;
  readonly comparisonStatus: BoundNetComparisonStatus;
  readonly tupleGroups: {
    readonly boundNetlist: number;
    readonly candidate: number;
    readonly matched: number;
    readonly missingInCandidate: number;
    readonly unexpectedCandidate: number;
  };
  readonly distinctComponents: {
    readonly boundNetlist: number;
    readonly candidate: number;
  };
  readonly duplicateGroups: {
    readonly boundNetlist: number;
    readonly candidate: number;
  };
  readonly duplicateOccurrences: {
    readonly boundNetlist: number;
    readonly candidate: number;
  };
  readonly representation: "NET_HYPEREDGE";
  readonly propagation: "NOT_EVALUATED";
  readonly endpointExpansion: "USE_GET_NET";
  readonly basis: "STRICTLY_PARSED_BOUND_ENET_AND_DETERMINISTIC_CANDIDATE_COMPARISON";
}

export type BoundNetLookup =
  | {
      readonly status: "FOUND";
      readonly net: BoundElectricalNetSummary;
      readonly endpoints: Page<NetlistComparisonTupleItem>;
    }
  | {
      readonly status: "NOT_FOUND";
      readonly netName: string;
    };

interface CursorPayload {
  readonly version: 1;
  readonly scope: string;
  readonly offset: number;
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

function validateText(
  value: string | undefined,
  fieldName: string
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > QUERY_LIMITS.maxTextLength
  ) {
    throw new QueryError(
      "QUERY_INVALID_TEXT",
      `${fieldName} 必须为 1 到 ${QUERY_LIMITS.maxTextLength} 个字符。`
    );
  }
  return normalized;
}

function pageSize(value: number | undefined): number {
  const actual = value ?? QUERY_LIMITS.defaultPageSize;
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

function scopeHash(
  reportSha256: string,
  operation:
    | "netlist-comparison-tuples"
    | "bound-electrical-nets"
    | "bound-net",
  filter: Readonly<Record<string, string>>
): string {
  const normalized = Object.entries(filter)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha256")
    .update(`${operation}\n${reportSha256}\n${normalized}`)
    .digest("hex")
    .slice(0, 24);
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string | undefined,
  expectedScope: string
): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<CursorPayload> | null;
    if (
      parsed === null ||
      parsed.version !== 1 ||
      parsed.scope !== expectedScope ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset ?? -1) < 0
    ) {
      throw new Error("cursor mismatch");
    }
    return parsed.offset as number;
  } catch {
    throw new QueryError(
      "QUERY_INVALID_CURSOR",
      "cursor 无效，或不属于当前比较报告和筛选条件。"
    );
  }
}

export class NetlistComparisonQueryIndex {
  private readonly items: readonly NetlistComparisonTupleItem[];
  private readonly itemsByNet: ReadonlyMap<
    string,
    readonly NetlistComparisonTupleItem[]
  >;
  private readonly boundComponentRefsByNet: ReadonlyMap<
    string,
    ReadonlySet<string>
  >;
  private readonly boundDuplicatesByNet: ReadonlyMap<
    string,
    readonly DuplicateNetlistTuple[]
  >;
  private readonly candidateDuplicatesByNet: ReadonlyMap<
    string,
    readonly DuplicateNetlistTuple[]
  >;
  private readonly netSummaries: ReadonlyMap<
    string,
    BoundElectricalNetSummary
  >;
  private readonly boundNetNames: readonly string[];

  public constructor(
    public readonly report: NetlistComparisonReport,
    public readonly netlist?: JlcEdaProEnet
  ) {
    const evidenceByTuple = new Map<
      string,
      CandidateNetlistTupleEvidence[]
    >();
    for (const candidate of report.candidateCompilation.tuples) {
      const key = tupleKey(candidate.tuple);
      const evidence = evidenceByTuple.get(key) ?? [];
      evidence.push(candidate.evidence);
      evidenceByTuple.set(key, evidence);
    }
    this.items = [
      ...report.comparison.matched.map((tuple) => ({
        kind: "MATCHED" as const,
        tuple,
        candidateEvidence: evidenceByTuple.get(tupleKey(tuple)) ?? []
      })),
      ...report.comparison.missingInCandidate.map((tuple) => ({
        kind: "MISSING_IN_CANDIDATE" as const,
        tuple
      })),
      ...report.comparison.unexpectedCandidate.map((tuple) => ({
        kind: "UNEXPECTED_CANDIDATE" as const,
        tuple,
        candidateEvidence: evidenceByTuple.get(tupleKey(tuple)) ?? []
      }))
    ].sort(
      (left, right) =>
        compareText(left.kind, right.kind) ||
        compareTuple(left.tuple, right.tuple)
    );
    const itemsByNet = new Map<string, NetlistComparisonTupleItem[]>();
    const boundComponentRefsByNet = new Map<string, Set<string>>();
    for (const item of this.items) {
      const items = itemsByNet.get(item.tuple.netName) ?? [];
      items.push(item);
      itemsByNet.set(item.tuple.netName, items);
      if (
        item.kind === "MATCHED" ||
        item.kind === "MISSING_IN_CANDIDATE"
      ) {
        const componentRefs =
          boundComponentRefsByNet.get(item.tuple.netName) ??
          new Set<string>();
        componentRefs.add(item.tuple.componentRef);
        boundComponentRefsByNet.set(item.tuple.netName, componentRefs);
      }
    }
    for (const duplicate of report.comparison.truthDuplicates) {
      const componentRefs =
        boundComponentRefsByNet.get(duplicate.tuple.netName) ??
        new Set<string>();
      componentRefs.add(duplicate.tuple.componentRef);
      boundComponentRefsByNet.set(duplicate.tuple.netName, componentRefs);
    }
    this.itemsByNet = itemsByNet;
    this.boundComponentRefsByNet = boundComponentRefsByNet;
    const boundDuplicatesByNet = new Map<
      string,
      DuplicateNetlistTuple[]
    >();
    const candidateDuplicatesByNet = new Map<
      string,
      DuplicateNetlistTuple[]
    >();
    for (const duplicate of report.comparison.truthDuplicates) {
      const duplicates =
        boundDuplicatesByNet.get(duplicate.tuple.netName) ?? [];
      duplicates.push(duplicate);
      boundDuplicatesByNet.set(duplicate.tuple.netName, duplicates);
    }
    for (const duplicate of report.comparison.candidateDuplicates) {
      const duplicates =
        candidateDuplicatesByNet.get(duplicate.tuple.netName) ?? [];
      duplicates.push(duplicate);
      candidateDuplicatesByNet.set(duplicate.tuple.netName, duplicates);
    }
    this.boundDuplicatesByNet = boundDuplicatesByNet;
    this.candidateDuplicatesByNet = candidateDuplicatesByNet;
    const allNetNames = new Set(boundComponentRefsByNet.keys());
    this.netSummaries = new Map(
      [...allNetNames]
        .sort(compareText)
        .map((netName) => [netName, this.summarizeNet(netName)])
    );
    this.boundNetNames = [...boundComponentRefsByNet.keys()].sort(
      compareText
    );
  }

  public getSummary(): Readonly<Record<string, unknown>> {
    return {
      binding: "USER_PROVIDED_NETLIST_BOUND",
      reportSha256: this.report.reportSha256,
      sourceProject: this.report.sourceProject,
      netlist: this.report.netlist,
      counts: {
        candidateTuples: this.report.comparison.candidateTupleCount,
        truthTuples: this.report.comparison.truthTupleCount,
        matched: this.report.comparison.matched.length,
        missingInCandidate:
          this.report.comparison.missingInCandidate.length,
        unexpectedCandidate:
          this.report.comparison.unexpectedCandidate.length,
        excludedCandidatePins:
          this.report.candidateCompilation.summary.excludedPinInstances
      },
      gates: this.report.gates
    };
  }

  public listTuples(
    options: NetlistComparisonTupleListOptions
  ): Page<NetlistComparisonTupleItem> {
    const componentRef = validateText(
      options.componentRef,
      "componentRef"
    );
    const pinNumber = validateText(options.pinNumber, "pinNumber");
    const netName = validateText(options.netName, "netName");
    const filtered = this.items.filter(
      (item) =>
        (options.kind === undefined || item.kind === options.kind) &&
        (componentRef === undefined ||
          item.tuple.componentRef === componentRef) &&
        (pinNumber === undefined ||
          item.tuple.pinNumber === pinNumber) &&
        (netName === undefined || item.tuple.netName === netName)
    );
    const scope = scopeHash(
      this.report.reportSha256,
      "netlist-comparison-tuples",
      {
        kind: options.kind ?? "",
        componentRef: componentRef ?? "",
        pinNumber: pinNumber ?? "",
        netName: netName ?? ""
      }
    );
    const limit = pageSize(options.limit);
    const offset = decodeCursor(options.cursor, scope);
    if (offset > filtered.length) {
      throw new QueryError(
        "QUERY_INVALID_CURSOR",
        "cursor 已超出比较结果范围。"
      );
    }
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      total: filtered.length,
      ...(nextOffset < filtered.length
        ? {
            nextCursor: encodeCursor({
              version: 1,
              scope,
              offset: nextOffset
            })
          }
        : {})
    };
  }

  public listBoundElectricalNets(
    options: BoundElectricalNetListOptions
  ): Page<BoundElectricalNetSummary> {
    const componentRef = validateText(
      options.componentRef,
      "componentRef"
    );
    const filtered = this.boundNetNames
      .filter((netName) => {
        const summary = this.netSummaries.get(netName);
        return (
          summary !== undefined &&
          (options.comparisonStatus === undefined ||
            summary.comparisonStatus === options.comparisonStatus) &&
          (componentRef === undefined ||
            this.boundComponentRefsByNet
              .get(netName)
              ?.has(componentRef) === true)
        );
      })
      .map((netName) => this.netSummaries.get(netName)!)
      .sort((left, right) => compareText(left.name, right.name));
    const scope = scopeHash(
      this.report.reportSha256,
      "bound-electrical-nets",
      {
        comparisonStatus: options.comparisonStatus ?? "",
        componentRef: componentRef ?? ""
      }
    );
    const limit = pageSize(options.limit);
    const offset = decodeCursor(options.cursor, scope);
    if (offset > filtered.length) {
      throw new QueryError(
        "QUERY_INVALID_CURSOR",
        "cursor 已超出绑定电气网络范围。"
      );
    }
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      total: filtered.length,
      ...(nextOffset < filtered.length
        ? {
            nextCursor: encodeCursor({
              version: 1,
              scope,
              offset: nextOffset
            })
          }
        : {})
    };
  }

  public getNet(options: BoundNetLookupOptions): BoundNetLookup {
    const netName = validateText(options.netName, "netName") as string;
    const items = this.itemsByNet.get(netName) ?? [];
    const summary = this.netSummaries.get(netName);
    if (summary === undefined) {
      return { status: "NOT_FOUND", netName };
    }
    const scope = scopeHash(this.report.reportSha256, "bound-net", {
      netName
    });
    const limit = pageSize(options.limit);
    const offset = decodeCursor(options.cursor, scope);
    if (offset > items.length) {
      throw new QueryError(
        "QUERY_INVALID_CURSOR",
        "cursor 已超出网络端点范围。"
      );
    }
    const pageItems = items.slice(offset, offset + limit);
    const nextOffset = offset + pageItems.length;

    return {
      status: "FOUND",
      net: summary,
      endpoints: {
        items: pageItems,
        total: items.length,
        ...(nextOffset < items.length
          ? {
              nextCursor: encodeCursor({
                version: 1,
                scope,
                offset: nextOffset
              })
            }
          : {})
      }
    };
  }

  private summarizeNet(netName: string): BoundElectricalNetSummary {
    const items = this.itemsByNet.get(netName) ?? [];
    const boundNetlistDuplicates =
      this.boundDuplicatesByNet.get(netName) ?? [];
    const candidateDuplicates =
      this.candidateDuplicatesByNet.get(netName) ?? [];
    const matchedItems = items.filter((item) => item.kind === "MATCHED");
    const missingItems = items.filter(
      (item) => item.kind === "MISSING_IN_CANDIDATE"
    );
    const unexpectedItems = items.filter(
      (item) => item.kind === "UNEXPECTED_CANDIDATE"
    );
    const hasDuplicates =
      boundNetlistDuplicates.length > 0 || candidateDuplicates.length > 0;
    const comparisonStatus: BoundNetComparisonStatus = hasDuplicates
      ? "DUPLICATE_TUPLES"
      : missingItems.length > 0 || unexpectedItems.length > 0
        ? "DIFFERENCES_FOUND"
        : "EXACT_SET_MATCH";
    const boundComponentRefs = new Set(
      [...matchedItems, ...missingItems].map(
        (item) => item.tuple.componentRef
      )
    );
    const candidateComponentRefs = new Set(
      [...matchedItems, ...unexpectedItems].map(
        (item) => item.tuple.componentRef
      )
    );
    for (const duplicate of boundNetlistDuplicates) {
      boundComponentRefs.add(duplicate.tuple.componentRef);
    }
    for (const duplicate of candidateDuplicates) {
      candidateComponentRefs.add(duplicate.tuple.componentRef);
    }
    return {
      name: netName,
      comparisonStatus,
      tupleGroups: {
        boundNetlist: matchedItems.length + missingItems.length,
        candidate: matchedItems.length + unexpectedItems.length,
        matched: matchedItems.length,
        missingInCandidate: missingItems.length,
        unexpectedCandidate: unexpectedItems.length
      },
      distinctComponents: {
        boundNetlist: boundComponentRefs.size,
        candidate: candidateComponentRefs.size
      },
      duplicateGroups: {
        boundNetlist: boundNetlistDuplicates.length,
        candidate: candidateDuplicates.length
      },
      duplicateOccurrences: {
        boundNetlist: boundNetlistDuplicates.reduce(
          (total, duplicate) => total + duplicate.occurrences,
          0
        ),
        candidate: candidateDuplicates.reduce(
          (total, duplicate) => total + duplicate.occurrences,
          0
        )
      },
      representation: "NET_HYPEREDGE",
      propagation: "NOT_EVALUATED",
      endpointExpansion: "USE_GET_NET",
      basis:
        "STRICTLY_PARSED_BOUND_ENET_AND_DETERMINISTIC_CANDIDATE_COMPARISON"
    };
  }
}
