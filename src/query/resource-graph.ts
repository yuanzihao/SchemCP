import { createHash } from "node:crypto";
import type {
  EdaIr,
  IrComponentOccurrence,
  IrInterfaceActivityStatus,
  IrResourceEdge,
  IrResourceNode,
  IrResourceType
} from "../ir/model.js";
import { SEMANTIC_RULE_SET_VERSION } from "../semantics/compile-semantics.js";
import { QUERY_LIMITS, QueryError, type Page } from "./index.js";

export const RESOURCE_GRAPH_LIMITS = {
  maxDepth: 8,
  defaultDepth: 4
} as const;

export interface ResourceGraphQueryOptions {
  readonly pageId?: string | undefined;
  readonly rootNodeId?: string | undefined;
  readonly rootNetName?: string | undefined;
  readonly instanceContextId?: string | undefined;
  readonly variantId?: string | undefined;
  readonly activityStatus?:
    | IrInterfaceActivityStatus
    | "ALL"
    | undefined;
  readonly maxDepth?: number | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface ResourceTraversalEdge {
  readonly depth: number;
  readonly rootNodeIds: readonly string[];
  readonly edge: IrResourceEdge;
}

export interface ResourceGraphResult {
  readonly resourceType: Exclude<IrResourceType, "MCU_PIN">;
  readonly semanticRuleSetVersion: typeof SEMANTIC_RULE_SET_VERSION;
  readonly roots: readonly IrResourceNode[];
  readonly nodeCount: number;
  readonly cycleDetected: boolean;
  readonly truncatedByDepth: boolean;
  readonly truncationReason: "NONE" | "MAX_DEPTH_REACHED";
  readonly maxDepth: number;
  readonly edges: Page<ResourceTraversalEdge>;
  readonly electricalTruth: "NOT_VERIFIED";
}

interface CursorPayload {
  readonly version: 1;
  readonly scope: string;
  readonly offset: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateText(
  value: string | undefined,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > QUERY_LIMITS.maxTextLength
  ) {
    throw new QueryError(
      "QUERY_INVALID_TEXT",
      `${field} 必须为 1 到 ${QUERY_LIMITS.maxTextLength} 个字符。`
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

function depthLimit(value: number | undefined): number {
  const actual = value ?? RESOURCE_GRAPH_LIMITS.defaultDepth;
  if (
    !Number.isSafeInteger(actual) ||
    actual < 0 ||
    actual > RESOURCE_GRAPH_LIMITS.maxDepth
  ) {
    throw new QueryError(
      "QUERY_INVALID_LIMIT",
      `maxDepth 必须是 0 到 ${RESOURCE_GRAPH_LIMITS.maxDepth} 的整数。`
    );
  }
  return actual;
}

function scopeHash(
  irSha256: string,
  resourceType: string,
  values: Readonly<Record<string, string | number>>
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        irSha256,
        resourceType,
        SEMANTIC_RULE_SET_VERSION,
        Object.entries(values).sort(([left], [right]) => compareText(left, right))
      ])
    )
    .digest("hex")
    .slice(0, 24);
}

function decodeCursor(cursor: string | undefined, scope: string): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<CursorPayload> | null;
    if (
      parsed === null ||
      parsed.version !== 1 ||
      parsed.scope !== scope ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset ?? -1) < 0
    ) {
      throw new Error("cursor mismatch");
    }
    return parsed.offset as number;
  } catch {
    throw new QueryError(
      "QUERY_INVALID_CURSOR",
      "cursor 无效，或不属于当前资源图和筛选条件。"
    );
  }
}

function paginate<T>(
  values: readonly T[],
  limitValue: number | undefined,
  cursor: string | undefined,
  scope: string
): Page<T> {
  const limit = pageSize(limitValue);
  const offset = decodeCursor(cursor, scope);
  if (offset > values.length) {
    throw new QueryError("QUERY_INVALID_CURSOR", "cursor 偏移超出结果范围。");
  }
  const items = values.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    total: values.length,
    ...(nextOffset < values.length
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({ version: 1, scope, offset: nextOffset }),
            "utf8"
          ).toString("base64url")
        }
      : {})
  };
}

function effectiveEdge(
  edge: IrResourceEdge,
  occurrences: readonly IrComponentOccurrence[] | undefined,
  variantId: string | undefined
): IrResourceEdge | undefined {
  let activityStatus = edge.activityStatus;
  let status = edge.status;
  let unresolvedReasons = [...edge.unresolvedReasons];
  if (occurrences !== undefined) {
    const matching = edge.viaComponentRefs.flatMap((reference) => {
      const occurrence = occurrences.find(
        (item) =>
          item.componentId === reference.componentId &&
          item.pageId === reference.pageId
      );
      return occurrence === undefined ? [] : [occurrence];
    });
    if (matching.length === 0) return undefined;
    const statuses = new Set(matching.map((item) => item.assembly.status));
    if (matching.length === edge.viaComponentRefs.length && statuses.size === 1) {
      if (statuses.has("DNP")) activityStatus = "EXCLUDED_DNP";
      else if (statuses.has("POPULATED")) activityStatus = "ACTIVE";
      else activityStatus = "ASSEMBLY_UNKNOWN";
    } else {
      activityStatus = "ASSEMBLY_UNKNOWN";
    }
  }
  if (variantId !== undefined) activityStatus = "ASSEMBLY_UNKNOWN";
  if (activityStatus === "ASSEMBLY_UNKNOWN") {
    status = "UNRESOLVED";
    if (!unresolvedReasons.includes("ASSEMBLY_STATUS_UNKNOWN")) {
      unresolvedReasons = [...unresolvedReasons, "ASSEMBLY_STATUS_UNKNOWN"];
    }
  }
  return {
    ...edge,
    activityStatus,
    status,
    unresolvedReasons,
    truthStatus: status === "UNRESOLVED" ? "UNRESOLVED" : "CANDIDATE"
  };
}

function uniqueEndpoints(edges: readonly IrResourceEdge[]): readonly IrResourceNode[] {
  return [
    ...new Map(
      edges.flatMap((edge) => [edge.from, edge.to]).map((node) => [node.id, node])
    ).values()
  ].sort((left, right) => compareText(left.id, right.id));
}

function derivedRoots(edges: readonly IrResourceEdge[]): readonly IrResourceNode[] {
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  const nodes = new Map<string, IrResourceNode>();
  const undirected = new Map<string, Set<string>>();
  const connect = (left: string, right: string): void => {
    const neighbors = undirected.get(left) ?? new Set<string>();
    neighbors.add(right);
    undirected.set(left, neighbors);
  };
  for (const edge of edges) {
    nodes.set(edge.from.id, edge.from);
    nodes.set(edge.to.id, edge.to);
    connect(edge.from.id, edge.to.id);
    connect(edge.to.id, edge.from.id);
    outgoing.add(edge.from.id);
    incoming.add(edge.to.id);
    if (edge.direction === "BIDIRECTIONAL") {
      outgoing.add(edge.to.id);
      incoming.add(edge.from.id);
    }
  }
  const roots: IrResourceNode[] = [];
  const visited = new Set<string>();
  for (const start of [...nodes.keys()].sort(compareText)) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      component.push(current);
      for (const next of [...(undirected.get(current) ?? [])].sort(compareText)) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    const sources = component
      .filter((id) => outgoing.has(id) && !incoming.has(id))
      .sort(compareText);
    const selected =
      sources.length > 0 ? sources : component.sort(compareText).slice(0, 1);
    for (const id of selected) {
      const node = nodes.get(id);
      if (node !== undefined) roots.push(node);
    }
  }
  return roots.sort((left, right) => compareText(left.id, right.id));
}

function graphHasCycle(
  roots: readonly IrResourceNode[],
  adjacency: ReadonlyMap<
    string,
    readonly { readonly edge: IrResourceEdge; readonly next: string }[]
  >
): boolean {
  const state = new Map<string, "VISITING" | "DONE">();
  const visit = (nodeId: string, parentEdgeId?: string): boolean => {
    state.set(nodeId, "VISITING");
    for (const item of adjacency.get(nodeId) ?? []) {
      if (item.edge.id === parentEdgeId) continue;
      const nextState = state.get(item.next);
      if (nextState === "VISITING") return true;
      if (nextState === undefined && visit(item.next, item.edge.id)) return true;
    }
    state.set(nodeId, "DONE");
    return false;
  };
  return roots.some(
    (root) => state.get(root.id) === undefined && visit(root.id)
  );
}

export class ResourceGraphQueryIndex {
  public constructor(private readonly ir: EdaIr) {}

  public query(
    resourceType: Exclude<IrResourceType, "MCU_PIN">,
    options: ResourceGraphQueryOptions = {}
  ): ResourceGraphResult {
    const pageId = validateText(options.pageId, "pageId");
    const rootNodeId = validateText(options.rootNodeId, "rootNodeId");
    const rootNetName = validateText(options.rootNetName, "rootNetName");
    const instanceContextId = validateText(
      options.instanceContextId,
      "instanceContextId"
    );
    const variantId = validateText(options.variantId, "variantId");
    const maxDepth = depthLimit(options.maxDepth);
    const requestedActivity = options.activityStatus ?? "ACTIVE";
    const occurrences =
      instanceContextId === undefined
        ? undefined
        : this.ir.componentOccurrences.filter(
            (item) => item.instanceContextId === instanceContextId
          );
    const candidates = this.ir.resourceEdges
      .filter(
        (edge) =>
          edge.resourceType === resourceType &&
          (pageId === undefined ||
            edge.from.pageId === pageId ||
            edge.to.pageId === pageId)
      )
      .flatMap((edge) => {
        const effective = effectiveEdge(edge, occurrences, variantId);
        return effective === undefined ? [] : [effective];
      })
      .filter(
        (edge) =>
          requestedActivity === "ALL" ||
          edge.activityStatus === requestedActivity
      );
    const nodes = uniqueEndpoints(candidates);
    let roots =
      rootNodeId !== undefined
        ? nodes.filter((node) => node.id === rootNodeId)
        : rootNetName !== undefined
          ? nodes.filter(
              (node) => node.kind === "NET" && node.netName === rootNetName
            )
          : derivedRoots(candidates);
    if (pageId !== undefined) roots = roots.filter((node) => node.pageId === pageId);

    const adjacency = new Map<string, { edge: IrResourceEdge; next: string }[]>();
    const add = (from: string, edge: IrResourceEdge, next: string): void => {
      const items = adjacency.get(from) ?? [];
      items.push({ edge, next });
      adjacency.set(from, items);
    };
    for (const edge of candidates) {
      add(edge.from.id, edge, edge.to.id);
      if (edge.direction === "BIDIRECTIONAL") add(edge.to.id, edge, edge.from.id);
    }
    for (const items of adjacency.values()) {
      items.sort(
        (left, right) =>
          compareText(left.edge.id, right.edge.id) || compareText(left.next, right.next)
      );
    }

    const queue = roots.map((root) => ({
      rootNodeId: root.id,
      nodeId: root.id,
      depth: 0
    }));
    const bestDepth = new Map(
      queue.map((item) => [`${item.rootNodeId}\n${item.nodeId}`, item.depth])
    );
    const visitedNodeIds = new Set(queue.map((item) => item.nodeId));
    const traversed = new Map<string, ResourceTraversalEdge>();
    let truncatedByDepth = false;
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const outgoing = adjacency.get(current.nodeId) ?? [];
      if (current.depth >= maxDepth) {
        if (outgoing.length > 0) truncatedByDepth = true;
        continue;
      }
      for (const item of outgoing) {
        const depth = current.depth + 1;
        const existingEdge = traversed.get(item.edge.id);
        const rootNodeIds = [
          ...new Set([
            ...(existingEdge?.rootNodeIds ?? []),
            current.rootNodeId
          ])
        ].sort(compareText);
        traversed.set(item.edge.id, {
          depth:
            existingEdge === undefined
              ? depth
              : Math.min(existingEdge.depth, depth),
          rootNodeIds,
          edge: item.edge
        });
        const visitKey = `${current.rootNodeId}\n${item.next}`;
        const knownDepth = bestDepth.get(visitKey);
        if (knownDepth !== undefined) {
          continue;
        }
        bestDepth.set(visitKey, depth);
        visitedNodeIds.add(item.next);
        queue.push({
          rootNodeId: current.rootNodeId,
          nodeId: item.next,
          depth
        });
      }
    }
    const traversal = [...traversed.values()].sort(
      (left, right) =>
        left.depth - right.depth || compareText(left.edge.id, right.edge.id)
    );
    const scope = scopeHash(this.ir.irSha256, resourceType, {
      pageId: pageId ?? "",
      rootNodeId: rootNodeId ?? "",
      rootNetName: rootNetName ?? "",
      instanceContextId: instanceContextId ?? "",
      variantId: variantId ?? "",
      activityStatus: requestedActivity,
      maxDepth
    });
    return {
      resourceType,
      semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
      roots,
      nodeCount: visitedNodeIds.size,
      cycleDetected: graphHasCycle(roots, adjacency),
      truncatedByDepth,
      truncationReason: truncatedByDepth ? "MAX_DEPTH_REACHED" : "NONE",
      maxDepth,
      edges: paginate(traversal, options.limit, options.cursor, scope),
      electricalTruth: "NOT_VERIFIED"
    };
  }
}
