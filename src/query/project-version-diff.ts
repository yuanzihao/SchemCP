import { createHash } from "node:crypto";
import {
  canonicalJson,
  sha256CanonicalJson
} from "../core/canonical-json.js";
import type { EdaIr, JsonValue } from "../ir/model.js";
import {
  QUERY_LIMITS,
  QueryError,
  type Page
} from "./index.js";

export const PROJECT_DIFF_ENTITY_KINDS = [
  "SUMMARY_METRIC",
  "DOCUMENT",
  "PROJECT_CONFIGURATION",
  "BOARD",
  "SCHEMATIC",
  "SCHEMATIC_PAGE",
  "SCHEMATIC_ANNOTATION",
  "SCHEMATIC_GRAPHIC_PRIMITIVE",
  "SCHEMATIC_TABLE",
  "SCHEMATIC_TABLE_CELL",
  "VARIANT",
  "COMPONENT_GROUP",
  "INSTANCE_CONTEXT",
  "COMPONENT",
  "SYMBOL",
  "SYMBOL_PART",
  "SYMBOL_TEXT",
  "SYMBOL_PIN",
  "DEVICE",
  "WIRE",
  "PIN_INSTANCE",
  "SHORT_RELATION",
  "NETWORK_ENDPOINT",
  "EXPLICIT_NET"
] as const;

export const PROJECT_DIFF_CHANGE_TYPES = [
  "ADDED",
  "REMOVED",
  "MODIFIED"
] as const;

export type ProjectDiffEntityKind =
  (typeof PROJECT_DIFF_ENTITY_KINDS)[number];
export type ProjectDiffChangeType =
  (typeof PROJECT_DIFF_CHANGE_TYPES)[number];

interface EntityProjection {
  readonly entityKind: ProjectDiffEntityKind;
  readonly internalKey: string;
  readonly entityId: string;
  readonly parentId?: string;
  readonly label?: string;
  readonly occurrence: number;
  readonly fieldHashes: Readonly<Record<string, string>>;
  readonly summaryValue?: JsonValue;
  readonly sha256: string;
}

export interface ProjectVersionDiffEntry {
  readonly entityKind: ProjectDiffEntityKind;
  readonly changeType: ProjectDiffChangeType;
  readonly entityId: string;
  readonly parentId?: string;
  readonly label?: string;
  readonly occurrence: number;
  readonly changedFields: readonly string[];
  readonly beforeSha256?: string;
  readonly afterSha256?: string;
  readonly beforeValue?: JsonValue;
  readonly afterValue?: JsonValue;
}

export interface ProjectDiffKindSummary {
  readonly baseline: number;
  readonly current: number;
  readonly added: number;
  readonly removed: number;
  readonly modified: number;
  readonly unchanged: number;
}

export interface ProjectVersionDiffSummary {
  readonly status: "NO_CHANGES" | "CHANGES_FOUND";
  readonly basis: "DETERMINISTIC_MODELED_IR";
  readonly coverage: "MODELED_IR_AND_DERIVED_EXPLICIT_NETS";
  readonly baseline: {
    readonly archiveSha256: string;
    readonly irSha256: string;
  };
  readonly current: {
    readonly archiveSha256: string;
    readonly irSha256: string;
  };
  readonly counts: {
    readonly baselineEntities: number;
    readonly currentEntities: number;
    readonly added: number;
    readonly removed: number;
    readonly modified: number;
    readonly unchanged: number;
  };
  readonly byEntityKind: Readonly<
    Record<ProjectDiffEntityKind, ProjectDiffKindSummary>
  >;
  readonly projectContinuity: "NOT_VERIFIED";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly electricalTruth: "NOT_VERIFIED";
}

export interface ProjectVersionDiffListOptions {
  readonly entityKind?: ProjectDiffEntityKind | undefined;
  readonly changeType?: ProjectDiffChangeType | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedLabel(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= QUERY_LIMITS.maxTextLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function semanticProjection(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => semanticProjection(item));
  }
  if (value === null || typeof value !== "object") return value;
  const source = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(source)
      .filter((key) => key !== "provenance" && key !== "extensions")
      .sort(compareText)
      .map((key) => [key, semanticProjection(source[key])])
  );
}

function semanticSha256(value: unknown): string {
  return sha256CanonicalJson(semanticProjection(value));
}

function topLevelFieldHashes(
  value: unknown
): Readonly<Record<string, string>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return { value: semanticSha256(value) };
  }
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => key !== "provenance" && key !== "extensions")
      .sort(compareText)
      .map((key) => [key, semanticSha256(record[key])])
  );
}

function topLevelChangedFields(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): readonly string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        !Object.hasOwn(before, key) ||
        !Object.hasOwn(after, key) ||
        before[key] !== after[key]
    )
    .sort(compareText);
}

interface EntitySource {
  readonly entityKind: ProjectDiffEntityKind;
  readonly entityId: string;
  readonly parentId?: string | undefined;
  readonly label?: string | undefined;
  readonly value: unknown;
}

function explicitNetSources(ir: EdaIr): readonly EntitySource[] {
  const groups = new Map<
    string,
    {
      wireIds: string[];
      segmentIds: string[];
      pageIds: Set<string>;
    }
  >();
  for (const wire of ir.wires) {
    if (wire.explicitNetName === undefined) continue;
    const group = groups.get(wire.explicitNetName) ?? {
      wireIds: [],
      segmentIds: [],
      pageIds: new Set<string>()
    };
    group.wireIds.push(`${wire.pageId}:${wire.id}`);
    group.segmentIds.push(
      ...wire.segments.map((segment) => `${wire.pageId}:${segment.id}`)
    );
    group.pageIds.add(wire.pageId);
    groups.set(wire.explicitNetName, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, group]) => ({
      entityKind: "EXPLICIT_NET",
      entityId: name,
      label: boundedLabel(name),
      value: {
        name,
        wireIds: group.wireIds.sort(compareText),
        segmentIds: group.segmentIds.sort(compareText),
        pageIds: [...group.pageIds].sort(compareText)
      }
    }));
}

function entitySources(ir: EdaIr): readonly EntitySource[] {
  const sources: EntitySource[] = [];
  for (const [metric, value] of Object.entries(ir.summary).sort(([left], [right]) =>
    compareText(left, right)
  )) {
    sources.push({
      entityKind: "SUMMARY_METRIC",
      entityId: metric,
      value
    });
  }
  sources.push(
    ...ir.documents.map((item) => ({
      entityKind: "DOCUMENT" as const,
      entityId: item.id,
      parentId: item.type,
      value: item
    })),
    ...ir.projectConfigurations.map((item) => ({
      entityKind: "PROJECT_CONFIGURATION" as const,
      entityId: item.documentId,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.boards.map((item) => ({
      entityKind: "BOARD" as const,
      entityId: item.id,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.schematics.map((item) => ({
      entityKind: "SCHEMATIC" as const,
      entityId: item.id,
      parentId: item.boardId,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.schematicPages.map((item) => ({
      entityKind: "SCHEMATIC_PAGE" as const,
      entityId: item.id,
      parentId: item.schematicId,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.schematicAnnotations.map((item) => ({
      entityKind: "SCHEMATIC_ANNOTATION" as const,
      entityId: item.id,
      parentId: item.pageId,
      label: boundedLabel(item.text),
      value: item
    })),
    ...ir.schematicGraphicPrimitives.map((item) => ({
      entityKind: "SCHEMATIC_GRAPHIC_PRIMITIVE" as const,
      entityId: item.id,
      parentId: `${item.documentType}\n${item.documentId}\n${item.partId ?? ""}`,
      value: item
    })),
    ...ir.schematicTables.map((item) => {
      const { cells: _cells, ...table } = item;
      void _cells;
      return {
        entityKind: "SCHEMATIC_TABLE" as const,
        entityId: item.id,
        parentId: `${item.documentType}\n${item.documentId}`,
        value: table
      };
    }),
    ...ir.schematicTables.flatMap((table) =>
      table.cells.map((cell) => ({
        entityKind: "SCHEMATIC_TABLE_CELL" as const,
        entityId: cell.id,
        parentId: `${table.documentId}\n${table.id}`,
        label: boundedLabel(cell.value),
        value: cell
      }))
    ),
    ...ir.variants.map((item) => ({
      entityKind: "VARIANT" as const,
      entityId: item.id,
      parentId: item.schematicId,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.componentGroups.map((item) => ({
      entityKind: "COMPONENT_GROUP" as const,
      entityId: item.id,
      parentId: item.schematicId,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.instanceContexts.map((item) => ({
      entityKind: "INSTANCE_CONTEXT" as const,
      entityId: item.id,
      parentId: item.schematicId,
      value: item
    })),
    ...ir.components.map((item) => ({
      entityKind: "COMPONENT" as const,
      entityId: item.id,
      parentId: item.pageId,
      label: boundedLabel(item.designator),
      value: item
    })),
    ...ir.symbols.map((item) => ({
      entityKind: "SYMBOL" as const,
      entityId: item.id,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.symbolParts.map((item) => ({
      entityKind: "SYMBOL_PART" as const,
      entityId: item.id,
      parentId: item.symbolId,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.symbolTexts.map((item) => ({
      entityKind: "SYMBOL_TEXT" as const,
      entityId: item.id,
      parentId: `${item.symbolId}\n${item.partId ?? ""}`,
      label: boundedLabel(item.text),
      value: item
    })),
    ...ir.symbolPins.map((item) => ({
      entityKind: "SYMBOL_PIN" as const,
      entityId: item.id,
      parentId: `${item.symbolId}:${item.partId}`,
      label: boundedLabel(item.number ?? item.name),
      value: item
    })),
    ...ir.devices.map((item) => ({
      entityKind: "DEVICE" as const,
      entityId: item.id,
      label: boundedLabel(item.title),
      value: item
    })),
    ...ir.wires.map((item) => ({
      entityKind: "WIRE" as const,
      entityId: item.id,
      parentId: item.pageId,
      label: boundedLabel(item.explicitNetName),
      value: item
    })),
    ...ir.pinInstances.map((item) => ({
      entityKind: "PIN_INSTANCE" as const,
      entityId: item.id,
      parentId: item.pageId,
      label: boundedLabel(item.number ?? item.name),
      value: item
    })),
    ...ir.shortRelations.map((item) => ({
      entityKind: "SHORT_RELATION" as const,
      entityId: item.id,
      parentId: item.pageId,
      value: item
    })),
    ...ir.networkEndpointCandidates.map((item) => ({
      entityKind: "NETWORK_ENDPOINT" as const,
      entityId: item.id,
      parentId: item.pageId,
      label: boundedLabel(item.declaredNetNameCandidate),
      value: item
    })),
    ...explicitNetSources(ir)
  );
  return sources;
}

function buildProjections(ir: EdaIr): readonly EntityProjection[] {
  const buckets = new Map<string, EntitySource[]>();
  for (const source of entitySources(ir)) {
    const baseKey = canonicalJson([
      source.entityKind,
      source.parentId ?? "",
      source.entityId
    ]);
    const bucket = buckets.get(baseKey);
    if (bucket === undefined) buckets.set(baseKey, [source]);
    else bucket.push(source);
  }
  const projections: EntityProjection[] = [];
  for (const [baseKey, bucket] of [...buckets.entries()].sort(([left], [right]) =>
    compareText(left, right)
  )) {
    const sorted = bucket
      .map((source) => ({
        source,
        sha256: semanticSha256(source.value),
        fieldHashes: topLevelFieldHashes(source.value)
      }))
      .sort((left, right) =>
        compareText(left.sha256, right.sha256)
      );
    sorted.forEach(({ source, sha256, fieldHashes }, occurrence) => {
      projections.push({
        entityKind: source.entityKind,
        internalKey: `${baseKey}:${occurrence}`,
        entityId: source.entityId,
        ...(source.parentId === undefined
          ? {}
          : { parentId: source.parentId }),
        ...(source.label === undefined ? {} : { label: source.label }),
        occurrence,
        fieldHashes,
        ...(source.entityKind === "SUMMARY_METRIC"
          ? { summaryValue: source.value as JsonValue }
          : {}),
        sha256
      });
    });
  }
  return projections;
}

export class ProjectVersionDiffBaseline {
  public readonly archiveSha256: string;
  public readonly irSha256: string;
  public readonly entities: readonly EntityProjection[];

  public constructor(ir: EdaIr) {
    this.archiveSha256 = ir.source.archiveSha256;
    this.irSha256 = ir.irSha256;
    this.entities = buildProjections(ir);
  }
}

function emptyKindSummary(): Record<ProjectDiffEntityKind, ProjectDiffKindSummary> {
  return Object.fromEntries(
    PROJECT_DIFF_ENTITY_KINDS.map((kind) => [
      kind,
      {
        baseline: 0,
        current: 0,
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 0
      }
    ])
  ) as Record<ProjectDiffEntityKind, ProjectDiffKindSummary>;
}

function validateLimit(limit: number | undefined): number {
  const resolved = limit ?? QUERY_LIMITS.defaultPageSize;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1 ||
    resolved > QUERY_LIMITS.maxPageSize
  ) {
    throw new QueryError(
      "QUERY_INVALID_LIMIT",
      `limit 必须是 1 到 ${QUERY_LIMITS.maxPageSize} 的安全整数。`
    );
  }
  return resolved;
}

function scopeHash(options: ProjectVersionDiffListOptions): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        entityKind: options.entityKind ?? "",
        changeType: options.changeType ?? ""
      })
    )
    .digest("hex")
    .slice(0, 24);
}

function encodeCursor(offset: number, scope: string): string {
  return Buffer.from(
    canonicalJson({ offset, scope }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(cursor: string | undefined, scope: string): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { readonly offset?: unknown; readonly scope?: unknown };
    if (
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset as number) < 0 ||
      parsed.scope !== scope
    ) {
      throw new Error("invalid");
    }
    return parsed.offset as number;
  } catch {
    throw new QueryError(
      "QUERY_INVALID_CURSOR",
      "cursor 无效、已损坏或不属于当前筛选条件。"
    );
  }
}

export class ProjectVersionDiffIndex {
  private readonly entries: readonly ProjectVersionDiffEntry[];
  public readonly summary: ProjectVersionDiffSummary;

  public constructor(
    baseline: EdaIr | ProjectVersionDiffBaseline,
    current: EdaIr
  ) {
    const baselineSnapshot =
      baseline instanceof ProjectVersionDiffBaseline
        ? baseline
        : new ProjectVersionDiffBaseline(baseline);
    const baselineEntities = baselineSnapshot.entities;
    const currentEntities = buildProjections(current);
    const baselineByKey = new Map(
      baselineEntities.map((entity) => [entity.internalKey, entity])
    );
    const currentByKey = new Map(
      currentEntities.map((entity) => [entity.internalKey, entity])
    );
    const byEntityKind = emptyKindSummary();
    for (const entity of baselineEntities) {
      const previous = byEntityKind[entity.entityKind];
      byEntityKind[entity.entityKind] = {
        ...previous,
        baseline: previous.baseline + 1
      };
    }
    for (const entity of currentEntities) {
      const previous = byEntityKind[entity.entityKind];
      byEntityKind[entity.entityKind] = {
        ...previous,
        current: previous.current + 1
      };
    }

    const entries: ProjectVersionDiffEntry[] = [];
    const allKeys = [...new Set([
      ...baselineByKey.keys(),
      ...currentByKey.keys()
    ])].sort(compareText);
    let unchanged = 0;
    for (const key of allKeys) {
      const before = baselineByKey.get(key);
      const after = currentByKey.get(key);
      const entity = after ?? before;
      if (entity === undefined) continue;
      const previous = byEntityKind[entity.entityKind];
      if (before === undefined && after !== undefined) {
        byEntityKind[entity.entityKind] = {
          ...previous,
          added: previous.added + 1
        };
        entries.push({
          entityKind: after.entityKind,
          changeType: "ADDED",
          entityId: after.entityId,
          ...(after.parentId === undefined ? {} : { parentId: after.parentId }),
          ...(after.label === undefined ? {} : { label: after.label }),
          occurrence: after.occurrence,
          changedFields: [],
          afterSha256: after.sha256,
          ...(after.entityKind === "SUMMARY_METRIC"
            ? { afterValue: after.summaryValue as JsonValue }
            : {})
        });
        continue;
      }
      if (before !== undefined && after === undefined) {
        byEntityKind[entity.entityKind] = {
          ...previous,
          removed: previous.removed + 1
        };
        entries.push({
          entityKind: before.entityKind,
          changeType: "REMOVED",
          entityId: before.entityId,
          ...(before.parentId === undefined
            ? {}
            : { parentId: before.parentId }),
          ...(before.label === undefined ? {} : { label: before.label }),
          occurrence: before.occurrence,
          changedFields: [],
          beforeSha256: before.sha256,
          ...(before.entityKind === "SUMMARY_METRIC"
            ? { beforeValue: before.summaryValue as JsonValue }
            : {})
        });
        continue;
      }
      if (before === undefined || after === undefined) continue;
      if (before.sha256 === after.sha256) {
        unchanged += 1;
        byEntityKind[entity.entityKind] = {
          ...previous,
          unchanged: previous.unchanged + 1
        };
        continue;
      }
      byEntityKind[entity.entityKind] = {
        ...previous,
        modified: previous.modified + 1
      };
      entries.push({
        entityKind: after.entityKind,
        changeType: "MODIFIED",
        entityId: after.entityId,
        ...(after.parentId === undefined ? {} : { parentId: after.parentId }),
        ...(after.label === undefined ? {} : { label: after.label }),
        occurrence: after.occurrence,
        changedFields: topLevelChangedFields(
          before.fieldHashes,
          after.fieldHashes
        ),
        beforeSha256: before.sha256,
        afterSha256: after.sha256,
        ...(after.entityKind === "SUMMARY_METRIC"
          ? {
              beforeValue: before.summaryValue as JsonValue,
              afterValue: after.summaryValue as JsonValue
            }
          : {})
      });
    }
    this.entries = entries.sort(
      (left, right) =>
        PROJECT_DIFF_ENTITY_KINDS.indexOf(left.entityKind) -
          PROJECT_DIFF_ENTITY_KINDS.indexOf(right.entityKind) ||
        PROJECT_DIFF_CHANGE_TYPES.indexOf(left.changeType) -
          PROJECT_DIFF_CHANGE_TYPES.indexOf(right.changeType) ||
        compareText(left.parentId ?? "", right.parentId ?? "") ||
        compareText(left.entityId, right.entityId) ||
        left.occurrence - right.occurrence
    );
    const added = this.entries.filter(
      (entry) => entry.changeType === "ADDED"
    ).length;
    const removed = this.entries.filter(
      (entry) => entry.changeType === "REMOVED"
    ).length;
    const modified = this.entries.length - added - removed;
    this.summary = {
      status: this.entries.length === 0 ? "NO_CHANGES" : "CHANGES_FOUND",
      basis: "DETERMINISTIC_MODELED_IR",
      coverage: "MODELED_IR_AND_DERIVED_EXPLICIT_NETS",
      baseline: {
        archiveSha256: baselineSnapshot.archiveSha256,
        irSha256: baselineSnapshot.irSha256
      },
      current: {
        archiveSha256: current.source.archiveSha256,
        irSha256: current.irSha256
      },
      counts: {
        baselineEntities: baselineEntities.length,
        currentEntities: currentEntities.length,
        added,
        removed,
        modified,
        unchanged
      },
      byEntityKind,
      projectContinuity: "NOT_VERIFIED",
      sourceAuthenticity: "NOT_VERIFIED",
      electricalTruth: "NOT_VERIFIED"
    };
  }

  public listChanges(
    options: ProjectVersionDiffListOptions = {}
  ): Page<ProjectVersionDiffEntry> {
    const filtered = this.entries
      .filter(
        (entry) =>
          options.entityKind === undefined ||
          entry.entityKind === options.entityKind
      )
      .filter(
        (entry) =>
          options.changeType === undefined ||
          entry.changeType === options.changeType
      );
    const limit = validateLimit(options.limit);
    const scope = scopeHash(options);
    const offset = decodeCursor(options.cursor, scope);
    if (offset > filtered.length) {
      throw new QueryError(
        "QUERY_INVALID_CURSOR",
        "cursor 超出当前结果范围。"
      );
    }
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      total: filtered.length,
      ...(nextOffset < filtered.length
        ? { nextCursor: encodeCursor(nextOffset, scope) }
        : {})
    };
  }
}
