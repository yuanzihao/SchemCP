import { sha256CanonicalJson } from "../core/canonical-json.js";
import { compileNetworkEndpointCandidates } from "../connectivity/compile-network-endpoints.js";
import {
  compilePinInstances,
  type ComponentPinOverrideCandidate
} from "../connectivity/compile-pin-instances.js";
import { compileShortRelations } from "../connectivity/compile-short-relations.js";
import {
  resolveInstanceContexts,
  type RawInstanceContext
} from "../hierarchy/resolve-instance-contexts.js";
import { compileEffectiveComponentStates } from "../variant/effective-component-state.js";
import {
  compileComponentLibraryBindings,
  type ComponentBeforeLibraryBindings
} from "./component-library-bindings.js";
import type {
  EdaIr,
  IrAttribute,
  IrBoard,
  IrBus,
  IrBusEntry,
  IrBusSegment,
  IrComponentGroup,
  IrComponentGroupOverride,
  IrComponentGroupVariantIndex,
  IrDevice,
  IrDiagnostic,
  IrDocument,
  IrEasyEdaExtension,
  IrProjectConfiguration,
  IrRecordProvenance,
  IrSchematic,
  IrSchematicAnnotation,
  IrSchematicGraphicGeometry,
  IrSchematicGraphicKind,
  IrSchematicGraphicPoint,
  IrSchematicGraphicPrimitive,
  IrSchematicGraphicStyleValue,
  IrSchematicPage,
  IrSchematicTable,
  IrSchematicTableCell,
  IrSchematicTableCellRepresentation,
  IrSchematicTableLockEncoding,
  IrSymbol,
  IrSymbolPart,
  IrSymbolText,
  IrSymbolPin,
  IrUnboundAttribute,
  IrUnmodeledRecord,
  IrVariant,
  IrWire,
  IrWireSegment,
  JsonObject,
  JsonValue
} from "../ir/model.js";
import { parseInstancePath } from "./instance-path.js";
import { isQuarantinedMalformedTextInner } from "./record.js";
import type {
  ReducedV3DocumentSnapshot,
  ReducedV3Record,
  V3Reducer
} from "./reducer.js";

interface DiagnosticAccumulator {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly documentType?: string;
  readonly recordType?: string;
  count: number;
}

interface CompilableAttribute {
  readonly attribute: IrAttribute;
  readonly parentId: string;
}

const MODELED_DOCUMENT_TYPES = new Set([
  "CONFIG",
  "PROJECT_CONFIG",
  "BOARD",
  "SCH",
  "SCH_PAGE",
  "SYMBOL",
  "DEVICE",
  "VARIANT",
  "COMPONENT_GROUP",
  "INSTANCE"
]);

const MAX_EXPLICIT_TEXT_LENGTH = 64 * 1024;
const MAX_STYLE_TEXT_LENGTH = 4 * 1024;
const MAX_SCHEMATIC_TABLE_ROWS = 256;
const MAX_SCHEMATIC_TABLE_COLUMNS = 256;
const MAX_SCHEMATIC_TABLE_CELLS = 16 * 1024;
const MAX_SCHEMATIC_GRAPHIC_POINTS = 64 * 1024;
const MAX_BUS_ENTRIES_PER_BUS = 1_024;
const SCHEMATIC_GRAPHIC_KINDS = new Set<IrSchematicGraphicKind>([
  "POLY",
  "RECT",
  "ARC",
  "CIRCLE",
  "ELLIPSE"
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  if (typeof value === "object") {
    return Object.values(value as Readonly<Record<string, unknown>>).every((item) =>
      isJsonValue(item)
    );
  }
  return false;
}

function isObjectRecord(
  value: unknown
): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asJsonObject(value: Readonly<Record<string, unknown>>): JsonObject {
  if (!isJsonValue(value)) {
    throw new TypeError("V3 JSON 记录包含非 JSON 值。");
  }
  return value;
}

function extension(inner: Readonly<Record<string, unknown>>): IrEasyEdaExtension {
  return {
    easyeda: asJsonObject(inner)
  };
}

function sourceOf(
  document: ReducedV3DocumentSnapshot,
  selected: ReducedV3Record
): IrRecordProvenance {
  const ticket = selected.record.outer.ticket;
  if (!Number.isSafeInteger(ticket) || (ticket as number) < 0) {
    throw new TypeError("归并状态包含非法 ticket。");
  }
  return {
    documentId: document.uuid,
    documentType: document.docType,
    recordType: selected.record.outer.type,
    ...(selected.record.outer.id === undefined
      ? {}
      : { recordId: selected.record.outer.id }),
    ticket: ticket as number,
    client: selected.client,
    entry: selected.source.entry,
    line: selected.source.line
  };
}

function recordId(selected: ReducedV3Record): string | undefined {
  const id = selected.record.outer.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

function activeRecords(document: ReducedV3DocumentSnapshot): readonly ReducedV3Record[] {
  return document.records.filter(
    (selected) =>
      selected.record.inner !== "" && selected.record.outer.type !== "DELETE_DOC"
  );
}

function recordsOfType(
  records: readonly ReducedV3Record[],
  type: string
): readonly ReducedV3Record[] {
  return records.filter((selected) => selected.record.outer.type === type);
}

function innerOf(
  selected: ReducedV3Record
): Readonly<Record<string, unknown>> | undefined {
  return selected.record.inner === "" ? undefined : selected.record.inner;
}

function numberAlias(
  object: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): number | undefined {
  const values = keys
    .map((key) => object[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0 || values.some((value) => value !== values[0])) {
    return undefined;
  }
  return values[0];
}

function stringField(
  object: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNonEmptyString(
  object: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = stringField(object, key);
  return value === undefined || value === "" ? undefined : value;
}

function optionalNonEmptyStringAlias(
  object: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  onConflict: () => void
): string | undefined {
  const values = keys
    .map((key) => object[key])
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0
    );
  if (values.length === 0) return undefined;
  const unique = [...new Set(values)];
  if (unique.length !== 1) {
    onConflict();
    return undefined;
  }
  return unique[0];
}

function optionalFiniteNumberAlias(
  object: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  onConflict: () => void
): number | undefined {
  const values = keys
    .map((key) => object[key])
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    );
  if (values.length === 0) return undefined;
  const unique = [...new Set(values)];
  if (unique.length !== 1) {
    onConflict();
    return undefined;
  }
  return unique[0];
}

function indexAttributes(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  onInvalid: (selected: ReducedV3Record) => void
): ReadonlyMap<string, readonly CompilableAttribute[]> {
  const byParent = new Map<string, CompilableAttribute[]>();
  for (const selected of recordsOfType(records, "ATTR")) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    if (
      inner === undefined ||
      id === undefined ||
      typeof inner.parentId !== "string" ||
      typeof inner.key !== "string" ||
      !Object.hasOwn(inner, "value") ||
      !isJsonValue(inner.value)
    ) {
      onInvalid(selected);
      continue;
    }
    const item = {
      parentId: inner.parentId,
      attribute: {
        id,
        key: inner.key,
        value: inner.value,
        provenance: sourceOf(document, selected),
        extensions: extension(inner)
      }
    };
    const bucket = byParent.get(item.parentId);
    if (bucket === undefined) {
      byParent.set(item.parentId, [item]);
    } else {
      bucket.push(item);
    }
  }
  for (const bucket of byParent.values()) {
    bucket.sort((left, right) => compareText(left.attribute.id, right.attribute.id));
  }
  return byParent;
}

function attributesFor(
  byParent: ReadonlyMap<string, readonly CompilableAttribute[]>,
  parentId: string
): readonly IrAttribute[] {
  return (byParent.get(parentId) ?? []).map((item) => item.attribute);
}

function uniqueAttributeString(
  attributes: readonly IrAttribute[],
  key: string,
  onConflict: () => void
): string | undefined {
  const values = attributes
    .filter((attribute) => attribute.key === key && typeof attribute.value === "string")
    .map((attribute) => attribute.value as string)
    .filter((value) => value !== "");
  if (values.length === 0) {
    return undefined;
  }
  const unique = [...new Set(values)];
  if (unique.length !== 1) {
    onConflict();
    return undefined;
  }
  return unique[0];
}

function diagnosticsResult(
  diagnostics: ReadonlyMap<string, DiagnosticAccumulator>
): readonly IrDiagnostic[] {
  return [...diagnostics.values()]
    .sort((left, right) => {
      const codeOrder = compareText(left.code, right.code);
      if (codeOrder !== 0) return codeOrder;
      const documentOrder = compareText(left.documentType ?? "", right.documentType ?? "");
      if (documentOrder !== 0) return documentOrder;
      return compareText(left.recordType ?? "", right.recordType ?? "");
    })
    .map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      count: diagnostic.count,
      ...(diagnostic.documentType === undefined
        ? {}
        : { documentType: diagnostic.documentType }),
      ...(diagnostic.recordType === undefined ? {} : { recordType: diagnostic.recordType })
    }));
}

function addDiagnostic(
  diagnostics: Map<string, DiagnosticAccumulator>,
  input: Omit<DiagnosticAccumulator, "count">,
  count = 1
): void {
  const key = JSON.stringify([
    input.code,
    input.severity,
    input.message,
    input.documentType ?? null,
    input.recordType ?? null
  ]);
  const existing = diagnostics.get(key);
  if (existing === undefined) {
    diagnostics.set(key, { ...input, count });
  } else {
    existing.count += count;
  }
}

function unmodeled(
  target: IrUnmodeledRecord[],
  document: ReducedV3DocumentSnapshot,
  selected: ReducedV3Record
): void {
  target.push({
    provenance: sourceOf(document, selected)
  });
}

function schematicGraphicStyleValue(
  value: unknown
): value is IrSchematicGraphicStyleValue {
  return (
    value === null ||
    (typeof value === "string" && value.length <= MAX_STYLE_TEXT_LENGTH) ||
    (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}

function finitePoint(value: unknown): IrSchematicGraphicPoint | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const point = value as Readonly<Record<string, unknown>>;
  const x = numberAlias(point, ["x"]);
  const y = numberAlias(point, ["y"]);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function schematicGraphicGeometry(
  kind: IrSchematicGraphicKind,
  inner: Readonly<Record<string, unknown>>
): IrSchematicGraphicGeometry | undefined {
  if (kind === "POLY") {
    if (
      !Array.isArray(inner.points) ||
      inner.points.length < 2 ||
      inner.points.length > MAX_SCHEMATIC_GRAPHIC_POINTS ||
      typeof inner.closed !== "boolean"
    ) {
      return undefined;
    }
    if (inner.points.every((value) => typeof value === "number")) {
      if (
        inner.points.length % 2 !== 0 ||
        inner.points.some((value) => !Number.isFinite(value))
      ) {
        return undefined;
      }
      const points: IrSchematicGraphicPoint[] = [];
      for (let index = 0; index < inner.points.length; index += 2) {
        points.push({
          x: inner.points[index] as number,
          y: inner.points[index + 1] as number
        });
      }
      return {
        kind,
        points,
        closed: inner.closed,
        pointEncoding: "OFFICIAL_FLAT_XY_ARRAY"
      };
    }
    const points = inner.points.map(finitePoint);
    if (points.some((point) => point === undefined)) {
      return undefined;
    }
    return {
      kind,
      points: points as readonly IrSchematicGraphicPoint[],
      closed: inner.closed,
      pointEncoding: "V3_POINT_OBJECT_ARRAY"
    };
  }
  if (kind === "RECT") {
    const dotX1 = numberAlias(inner, ["dotX1"]);
    const dotY1 = numberAlias(inner, ["dotY1"]);
    const dotX2 = numberAlias(inner, ["dotX2"]);
    const dotY2 = numberAlias(inner, ["dotY2"]);
    const radiusX = numberAlias(inner, ["radiusX"]);
    const radiusY = numberAlias(inner, ["radiusY"]);
    const rotation = numberAlias(inner, ["rotation"]);
    if (
      dotX1 === undefined ||
      dotY1 === undefined ||
      dotX2 === undefined ||
      dotY2 === undefined ||
      radiusX === undefined ||
      radiusX < 0 ||
      radiusY === undefined ||
      radiusY < 0 ||
      rotation === undefined
    ) {
      return undefined;
    }
    return {
      kind,
      point1: { x: dotX1, y: dotY1 },
      point2: { x: dotX2, y: dotY2 },
      radiusX,
      radiusY,
      rotation
    };
  }
  if (kind === "ARC") {
    const startX = numberAlias(inner, ["startX"]);
    const startY = numberAlias(inner, ["startY"]);
    const referX = numberAlias(inner, ["referX"]);
    const referY = numberAlias(inner, ["referY"]);
    const endX = numberAlias(inner, ["endX"]);
    const endY = numberAlias(inner, ["endY"]);
    if (
      startX === undefined ||
      startY === undefined ||
      referX === undefined ||
      referY === undefined ||
      endX === undefined ||
      endY === undefined
    ) {
      return undefined;
    }
    return {
      kind,
      start: { x: startX, y: startY },
      reference: { x: referX, y: referY },
      end: { x: endX, y: endY }
    };
  }
  const centerX = numberAlias(inner, ["centerX"]);
  const centerY = numberAlias(inner, ["centerY"]);
  if (centerX === undefined || centerY === undefined) {
    return undefined;
  }
  if (kind === "CIRCLE") {
    const radius = numberAlias(inner, ["radius"]);
    return radius === undefined || radius < 0
      ? undefined
      : {
          kind,
          center: { x: centerX, y: centerY },
          radius
        };
  }
  const radiusX = numberAlias(inner, ["radiusX"]);
  const radiusY = numberAlias(inner, ["radiusY"]);
  const rotation = numberAlias(inner, ["rotation"]);
  return radiusX === undefined ||
    radiusY === undefined ||
    rotation === undefined
    ? undefined
    : {
        kind,
        center: { x: centerX, y: centerY },
        radiusX,
        radiusY,
        rotation,
        radiusEncoding:
          radiusX < 0 || radiusY < 0
            ? "V3_SIGNED_RADII"
            : "OFFICIAL_NONNEGATIVE_RADII"
      };
}

function compileSchematicGraphicPrimitives(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  partIds: ReadonlySet<string>,
  state: CompilerState
): void {
  const documentType =
    document.docType === "SYMBOL" ? "SYMBOL" : "SCHEMATIC_PAGE";
  for (const selected of records) {
    if (!SCHEMATIC_GRAPHIC_KINDS.has(selected.record.outer.type as IrSchematicGraphicKind)) {
      continue;
    }
    const kind = selected.record.outer.type as IrSchematicGraphicKind;
    const inner = innerOf(selected);
    const id = recordId(selected);
    const partId =
      inner === undefined || documentType !== "SYMBOL"
        ? undefined
        : stringField(inner, "partId");
    const geometry =
      inner === undefined ? undefined : schematicGraphicGeometry(kind, inner);
    const strokeColor = inner?.strokeColor;
    const strokeStyle = inner?.strokeStyle;
    const fillColor = inner?.fillColor;
    const strokeWidth = inner?.strokeWidth;
    const fillStyle = inner?.fillStyle;
    if (
      inner === undefined ||
      id === undefined ||
      (documentType === "SYMBOL" && partId === undefined) ||
      typeof inner.locked !== "boolean" ||
      numberAlias(inner, ["zIndex"]) === undefined ||
      geometry === undefined ||
      !Object.hasOwn(inner, "strokeColor") ||
      (strokeColor !== null &&
        (typeof strokeColor !== "string" ||
          strokeColor.length > MAX_STYLE_TEXT_LENGTH)) ||
      !Object.hasOwn(inner, "strokeStyle") ||
      !schematicGraphicStyleValue(strokeStyle) ||
      !Object.hasOwn(inner, "fillColor") ||
      (fillColor !== null &&
        (typeof fillColor !== "string" ||
          fillColor.length > MAX_STYLE_TEXT_LENGTH)) ||
      !Object.hasOwn(inner, "strokeWidth") ||
      (strokeWidth !== null &&
        (typeof strokeWidth !== "number" ||
          !Number.isFinite(strokeWidth) ||
          strokeWidth < 0)) ||
      !Object.hasOwn(inner, "fillStyle") ||
      !schematicGraphicStyleValue(fillStyle)
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SCHEMATIC_GRAPHIC",
        severity: "error",
        message:
          "SCH_PAGE/SYMBOL 形状缺少 id、显式样式、有限几何、锁定状态、zIndex 或有效 Symbol partId，未进入图形模型。",
        documentType: document.docType,
        recordType: kind
      });
      continue;
    }
    const partBinding =
      documentType === "SCHEMATIC_PAGE"
        ? { state: "NOT_APPLICABLE" as const }
        : partId === ""
          ? { state: "EXPLICIT_EMPTY" as const }
          : partIds.has(partId as string)
            ? {
                state: "RESOLVED_EXACT" as const,
                targetId: partId as string
              }
            : {
                state: "PART_NOT_FOUND" as const,
                targetId: partId as string
              };
    if (partBinding.state === "PART_NOT_FOUND") {
      addDiagnostic(state.diagnostics, {
        code: "IR_SCHEMATIC_GRAPHIC_PART_NOT_FOUND",
        severity: "warning",
        message:
          "SYMBOL 形状的显式 partId 无法绑定到同一符号的 PART，已保留图形与断链状态。",
        documentType: document.docType,
        recordType: kind
      });
    }
    state.schematicGraphicPrimitives.push({
      id,
      documentId: document.uuid,
      documentType,
      kind,
      ...(partId === undefined || partId === "" ? {} : { partId }),
      partBinding,
      locked: inner.locked,
      zIndex: inner.zIndex as number,
      geometry,
      style: {
        strokeColor: strokeColor as string | null,
        strokeStyle: strokeStyle as IrSchematicGraphicStyleValue,
        fillColor: fillColor as string | null,
        strokeWidth: strokeWidth as number | null,
        fillStyle: fillStyle as IrSchematicGraphicStyleValue
      },
      coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
      geometryValidation: "FINITE_FIELDS_AND_POINT_ENCODING_VALIDATED",
      basis: "EXPLICIT_SCHEMATIC_SHAPE_FIELDS",
      sourceAuthenticity: "NOT_VERIFIED",
      semanticInterpretation: "NOT_PERFORMED",
      electricalTruth: "NOT_APPLICABLE",
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }
}

interface ParsedSchematicTableCell {
  readonly id: string;
  readonly value: string;
  readonly contentState: "EXPLICIT_TEXT" | "EXPLICIT_EMPTY";
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly rowSpan: number;
  readonly columnSpan: number;
  readonly semanticValue: JsonObject;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

function positiveFiniteVector(
  value: unknown,
  maximumLength: number
): readonly number[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.some(
      (item) =>
        typeof item !== "number" || !Number.isFinite(item) || item <= 0
    )
  ) {
    return undefined;
  }
  return value as readonly number[];
}

function tableLockVector(
  value: unknown,
  expectedLength: number
):
  | {
      readonly values: readonly boolean[];
      readonly encodings: ReadonlySet<"BOOLEAN" | "INTEGER_0_1">;
    }
  | undefined {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    return undefined;
  }
  const values: boolean[] = [];
  const encodings = new Set<"BOOLEAN" | "INTEGER_0_1">();
  for (const item of value) {
    if (typeof item === "boolean") {
      values.push(item);
      encodings.add("BOOLEAN");
    } else if (item === 0 || item === 1) {
      values.push(item === 1);
      encodings.add("INTEGER_0_1");
    } else {
      return undefined;
    }
  }
  return { values, encodings };
}

function tableLockEncoding(
  ...vectors: readonly {
    readonly encodings: ReadonlySet<"BOOLEAN" | "INTEGER_0_1">;
  }[]
): IrSchematicTableLockEncoding {
  const encodings = new Set<"BOOLEAN" | "INTEGER_0_1">();
  for (const vector of vectors) {
    for (const encoding of vector.encodings) {
      encodings.add(encoding);
    }
  }
  return encodings.size === 1
    ? ([...encodings][0] as IrSchematicTableLockEncoding)
    : "MIXED_BOOLEAN_AND_INTEGER_0_1";
}

function tableCellSemanticValue(
  raw: Readonly<Record<string, unknown>>,
  id: string
): JsonObject | undefined {
  const normalized: Record<string, unknown> = { ...raw, id };
  delete normalized.tableId;
  return isJsonValue(normalized) ? asJsonObject(normalized) : undefined;
}

function parseSchematicTableCell(
  document: ReducedV3DocumentSnapshot,
  raw: unknown,
  options: {
    readonly record: ReducedV3Record;
    readonly explicitId?: string;
    readonly rowCount: number;
    readonly columnCount: number;
  }
): ParsedSchematicTableCell | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const inner = raw as Readonly<Record<string, unknown>>;
  const innerId = stringField(inner, "id");
  if (
    options.explicitId !== undefined &&
    innerId !== undefined &&
    innerId !== options.explicitId
  ) {
    return undefined;
  }
  const id = options.explicitId ?? innerId;
  const value = stringField(inner, "value");
  const rowIndex = numberAlias(inner, ["rowIndex"]);
  const columnIndex = numberAlias(inner, ["columnIndex"]);
  const rowSpan = numberAlias(inner, ["rowSpan"]);
  const columnSpan = numberAlias(inner, ["colSpan"]);
  const semanticValue = id === undefined ? undefined : tableCellSemanticValue(inner, id);
  if (
    id === undefined ||
    value === undefined ||
    value.length > MAX_EXPLICIT_TEXT_LENGTH ||
    rowIndex === undefined ||
    !Number.isSafeInteger(rowIndex) ||
    rowIndex < 0 ||
    columnIndex === undefined ||
    !Number.isSafeInteger(columnIndex) ||
    columnIndex < 0 ||
    rowSpan === undefined ||
    !Number.isSafeInteger(rowSpan) ||
    rowSpan < 1 ||
    columnSpan === undefined ||
    !Number.isSafeInteger(columnSpan) ||
    columnSpan < 1 ||
    rowIndex + rowSpan > options.rowCount ||
    columnIndex + columnSpan > options.columnCount ||
    semanticValue === undefined
  ) {
    return undefined;
  }
  return {
    id,
    value,
    contentState: value === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
    rowIndex,
    columnIndex,
    rowSpan,
    columnSpan,
    semanticValue,
    provenance: sourceOf(document, options.record),
    extensions: extension(inner)
  };
}

function hasUniqueTableCells(
  cells: readonly ParsedSchematicTableCell[]
): boolean {
  const ids = new Set<string>();
  const positions = new Set<string>();
  for (const cell of cells) {
    const position = `${cell.rowIndex}:${cell.columnIndex}`;
    if (ids.has(cell.id) || positions.has(position)) {
      return false;
    }
    ids.add(cell.id);
    positions.add(position);
  }
  return true;
}

function materializeTableCell(
  cell: ParsedSchematicTableCell,
  representation: IrSchematicTableCellRepresentation,
  provenance: readonly IrRecordProvenance[] = [cell.provenance]
): IrSchematicTableCell {
  return {
    id: cell.id,
    value: cell.value,
    contentState: cell.contentState,
    rowIndex: cell.rowIndex,
    columnIndex: cell.columnIndex,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    representation,
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance,
    extensions: cell.extensions
  };
}

function compileSchematicTables(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  partIds: ReadonlySet<string>,
  state: CompilerState
): void {
  const allRecords = [
    ...recordsOfType(records, "TABLE"),
    ...recordsOfType(records, "TABLE_CELL")
  ];
  const headerRecords: ReducedV3Record[] = [];
  const separateCellsByTable = new Map<string, ReducedV3Record[]>();
  const invalidSeparateRecords: ReducedV3Record[] = [];

  for (const selected of allRecords) {
    const inner = innerOf(selected);
    const tableId =
      inner === undefined ? undefined : stringField(inner, "tableId");
    const isSeparate =
      selected.record.outer.type === "TABLE_CELL" ||
      (inner !== undefined && Object.hasOwn(inner, "tableId"));
    if (!isSeparate) {
      headerRecords.push(selected);
      continue;
    }
    if (inner === undefined || tableId === undefined || tableId === "") {
      invalidSeparateRecords.push(selected);
      continue;
    }
    const items = separateCellsByTable.get(tableId) ?? [];
    items.push(selected);
    separateCellsByTable.set(tableId, items);
  }

  for (const selected of invalidSeparateRecords) {
    unmodeled(state.unmodeledRecords, document, selected);
    addDiagnostic(state.diagnostics, {
      code: "IR_INVALID_SCHEMATIC_TABLE_CELL",
      severity: "error",
      message:
        "独立表格单元格缺少对象数据或非空 tableId，未进入原理图表格模型。",
      documentType: document.docType,
      recordType: selected.record.outer.type
    });
  }

  const knownTableIds = new Set(
    headerRecords
      .map((selected) => recordId(selected))
      .filter((id): id is string => id !== undefined)
  );

  for (const selected of headerRecords) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    const x =
      inner === undefined ? undefined : numberAlias(inner, ["startX"]);
    const y =
      inner === undefined ? undefined : numberAlias(inner, ["startY"]);
    const rowSizes =
      inner === undefined
        ? undefined
        : positiveFiniteVector(inner.rowSizes, MAX_SCHEMATIC_TABLE_ROWS);
    const columnSizes =
      inner === undefined
        ? undefined
        : positiveFiniteVector(
            inner.colSizes,
            MAX_SCHEMATIC_TABLE_COLUMNS
          );
    const rowLocked =
      rowSizes === undefined || inner === undefined
        ? undefined
        : tableLockVector(inner.rowLocked, rowSizes.length);
    const columnLocked =
      columnSizes === undefined || inner === undefined
        ? undefined
        : tableLockVector(inner.colLocked, columnSizes.length);
    const rotation =
      inner === undefined ? undefined : numberAlias(inner, ["rotation"]);
    const partId =
      inner === undefined ? undefined : stringField(inner, "partId");
    const symbolPartInvalid =
      document.docType === "SYMBOL" && partId === undefined;
    const inlineRaw =
      inner === undefined || !Object.hasOwn(inner, "tableCell")
        ? []
        : inner.tableCell;
    if (
      inner === undefined ||
      id === undefined ||
      x === undefined ||
      y === undefined ||
      rowSizes === undefined ||
      columnSizes === undefined ||
      rowLocked === undefined ||
      columnLocked === undefined ||
      rotation === undefined ||
      symbolPartInvalid ||
      !Array.isArray(inlineRaw) ||
      inlineRaw.length > MAX_SCHEMATIC_TABLE_CELLS
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      for (const cellRecord of separateCellsByTable.get(id ?? "") ?? []) {
        unmodeled(state.unmodeledRecords, document, cellRecord);
      }
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SCHEMATIC_TABLE",
        severity: "error",
        message:
          "TABLE 缺少 id、有限位置/旋转、合法尺寸/锁定向量、Symbol partId，或单元格超过安全上限，未进入原理图表格模型。",
        documentType: document.docType,
        recordType: "TABLE"
      });
      continue;
    }

    const inlineCells = inlineRaw.map((raw) =>
      parseSchematicTableCell(document, raw, {
        record: selected,
        rowCount: rowSizes.length,
        columnCount: columnSizes.length
      })
    );
    const separateRecords = separateCellsByTable.get(id) ?? [];
    const separateCells = separateRecords.map((cellRecord) => {
      const explicitId = recordId(cellRecord);
      return parseSchematicTableCell(document, innerOf(cellRecord), {
        record: cellRecord,
        ...(explicitId === undefined ? {} : { explicitId }),
        rowCount: rowSizes.length,
        columnCount: columnSizes.length
      });
    });
    const invalidCells =
      inlineCells.some((cell) => cell === undefined) ||
      separateCells.some((cell) => cell === undefined);
    const validInlineCells = inlineCells.filter(
      (cell): cell is ParsedSchematicTableCell => cell !== undefined
    );
    const validSeparateCells = separateCells.filter(
      (cell): cell is ParsedSchematicTableCell => cell !== undefined
    );
    const totalCellCount = Math.max(
      validInlineCells.length,
      validSeparateCells.length
    );
    const duplicateCells =
      !hasUniqueTableCells(validInlineCells) ||
      !hasUniqueTableCells(validSeparateCells);
    const bothPresent =
      validInlineCells.length > 0 && validSeparateCells.length > 0;
    const inlineById = new Map(validInlineCells.map((cell) => [cell.id, cell]));
    const separateById = new Map(
      validSeparateCells.map((cell) => [cell.id, cell])
    );
    const representationsMatch =
      !bothPresent ||
      (inlineById.size === separateById.size &&
        [...inlineById].every(([cellId, cell]) => {
          const separate = separateById.get(cellId);
          return (
            separate !== undefined &&
            sha256CanonicalJson(cell.semanticValue) ===
              sha256CanonicalJson(separate.semanticValue)
          );
        }));

    if (
      invalidCells ||
      duplicateCells ||
      totalCellCount > MAX_SCHEMATIC_TABLE_CELLS ||
      !representationsMatch
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      for (const cellRecord of separateRecords) {
        unmodeled(state.unmodeledRecords, document, cellRecord);
      }
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SCHEMATIC_TABLE_CELL",
        severity: "error",
        message:
          "TABLE 单元格缺少合法字段、越界、重复，或内联/独立表示不一致，整张表未进入原理图表格模型。",
        documentType: document.docType,
        recordType: "TABLE"
      });
      continue;
    }

    const cells = (
      bothPresent
        ? validInlineCells.map((cell) => {
            const separate = separateById.get(cell.id)!;
            return materializeTableCell(cell, "BOTH_MATCHING", [
              cell.provenance,
              separate.provenance
            ]);
          })
        : validInlineCells.length > 0
          ? validInlineCells.map((cell) =>
              materializeTableCell(cell, "V3_INLINE_TABLE_CELL")
            )
          : validSeparateCells.map((cell) =>
              materializeTableCell(
                cell,
                "OFFICIAL_SEPARATE_TABLE_RECORD"
              )
            )
    ).sort(
      (left, right) =>
        left.rowIndex - right.rowIndex ||
        left.columnIndex - right.columnIndex ||
        compareText(left.id, right.id)
    );
    const partBinding =
      document.docType === "SCH_PAGE"
        ? { state: "NOT_APPLICABLE" as const }
        : partId === ""
          ? { state: "EXPLICIT_EMPTY" as const }
          : partIds.has(partId!)
            ? {
                state: "RESOLVED_EXACT" as const,
                targetId: partId!
              }
            : {
                state: "PART_NOT_FOUND" as const,
                targetId: partId!
              };
    if (partBinding.state === "PART_NOT_FOUND") {
      addDiagnostic(state.diagnostics, {
        code: "IR_SCHEMATIC_TABLE_PART_NOT_FOUND",
        severity: "warning",
        message:
          "符号 TABLE 的显式 partId 无法绑定同一符号的 PART，已保留表格与断链状态。",
        documentType: document.docType,
        recordType: "TABLE"
      });
    }
    const table: IrSchematicTable = {
      id,
      documentId: document.uuid,
      documentType:
        document.docType === "SCH_PAGE" ? "SCHEMATIC_PAGE" : "SYMBOL",
      ...(document.docType === "SYMBOL" && partId !== ""
        ? { partId: partId! }
        : {}),
      partBinding,
      position: { x, y },
      rowSizes,
      columnSizes,
      rowLocked: rowLocked.values,
      columnLocked: columnLocked.values,
      lockEncoding: tableLockEncoding(rowLocked, columnLocked),
      rotation,
      cells,
      coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
      layoutValidation: "INDEX_AND_SPAN_BOUNDS_VALIDATED",
      basis: "EXPLICIT_SCHEMATIC_TABLE_AND_CELL_FIELDS",
      sourceAuthenticity: "NOT_VERIFIED",
      semanticInterpretation: "NOT_PERFORMED",
      electricalTruth: "NOT_APPLICABLE",
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    };
    state.schematicTables.push(table);
  }

  for (const [tableId, cellRecords] of separateCellsByTable) {
    if (knownTableIds.has(tableId)) {
      continue;
    }
    for (const selected of cellRecords) {
      unmodeled(state.unmodeledRecords, document, selected);
    }
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_SCHEMATIC_TABLE_CELL_TABLE_NOT_FOUND",
        severity: "error",
        message:
          "独立表格单元格的 tableId 无法绑定同一文档的 TABLE，已保留为未建模记录。",
        documentType: document.docType,
        recordType: "TABLE"
      },
      cellRecords.length
    );
  }
}

function pointSegmentsFromDots(
  document: ReducedV3DocumentSnapshot,
  primitive: ReducedV3Record,
  primitiveId: string,
  inner: Readonly<Record<string, unknown>>,
  onInvalid: () => void,
  representation: "WIRE_DOTS" | "BUS_DOTS"
): readonly IrWireSegment[] {
  if (!Object.hasOwn(inner, "dots")) {
    return [];
  }
  if (!Array.isArray(inner.dots)) {
    onInvalid();
    return [];
  }
  const result: IrWireSegment[] = [];
  for (const [pathIndex, path] of inner.dots.entries()) {
    if (
      !Array.isArray(path) ||
      path.length < 4 ||
      path.length % 2 !== 0 ||
      path.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
    ) {
      onInvalid();
      continue;
    }
    for (let index = 0; index + 3 < path.length; index += 2) {
      result.push({
        id: `${primitiveId}:dots:${pathIndex}:${index / 2}`,
        start: {
          x: path[index] as number,
          y: path[index + 1] as number
        },
        end: {
          x: path[index + 2] as number,
          y: path[index + 3] as number
        },
        provenance: sourceOf(document, primitive),
        extensions: {
          easyeda: {
            representation,
            pathIndex,
            segmentIndex: index / 2
          }
        }
      });
    }
  }
  return result;
}

interface ValidBusEntryFields {
  readonly order: number;
  readonly busGroupId?: number;
  readonly point: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
}

function busEntryFields(
  inner: Readonly<Record<string, unknown>>,
  requireBusGroupId: boolean
): ValidBusEntryFields | undefined {
  const order = inner.order;
  const busGroupId = inner.busGroupId;
  const pointX = inner.pointX;
  const pointY = inner.pointY;
  const rotation = inner.rotation;
  if (
    !Number.isSafeInteger(order) ||
    (order as number) < 0 ||
    typeof pointX !== "number" ||
    !Number.isFinite(pointX) ||
    typeof pointY !== "number" ||
    !Number.isFinite(pointY) ||
    typeof rotation !== "number" ||
    !Number.isFinite(rotation) ||
    (requireBusGroupId &&
      (!Number.isSafeInteger(busGroupId) || (busGroupId as number) < 0)) ||
    (!requireBusGroupId &&
      busGroupId !== undefined &&
      (!Number.isSafeInteger(busGroupId) || (busGroupId as number) < 0))
  ) {
    return undefined;
  }
  return {
    order: order as number,
    ...(busGroupId === undefined
      ? {}
      : { busGroupId: busGroupId as number }),
    point: { x: pointX, y: pointY },
    rotation
  };
}

function compareBusEntry(left: IrBusEntry, right: IrBusEntry): number {
  return (
    compareText(left.pageId, right.pageId) ||
    compareText(left.busId ?? "", right.busId ?? "") ||
    left.order - right.order ||
    compareText(left.id, right.id) ||
    compareText(left.encoding, right.encoding)
  );
}

function compilePage(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const invalidAttributes: ReducedV3Record[] = [];
  const attributesByParent = indexAttributes(document, records, (selected) => {
    invalidAttributes.push(selected);
    addDiagnostic(state.diagnostics, {
      code: "IR_INVALID_ATTRIBUTE",
      severity: "error",
      message: "ATTR 缺少可验证的 id、parentId、key 或 JSON value，未编入语义对象。",
      documentType: document.docType,
      recordType: "ATTR"
    });
  });
  for (const selected of invalidAttributes) {
    unmodeled(state.unmodeledRecords, document, selected);
  }

  const metaRecords = recordsOfType(records, "META");
  const meta = metaRecords[0];
  const metaInner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || metaInner === undefined) {
    addDiagnostic(state.diagnostics, {
      code: "IR_SCHEMATIC_PAGE_META_MISSING",
      severity: "error",
      message: "原理图页缺少 META，无法建立页面语义对象。",
      documentType: document.docType,
      recordType: "META"
    });
  } else {
    const schematicId = optionalNonEmptyString(metaInner, "schematic");
    const creationTicket = meta.record.outer.firstTicket;
    const validCreationTicket =
      creationTicket === undefined ||
      (Number.isSafeInteger(creationTicket) && creationTicket >= 0);
    if (!validCreationTicket) {
      addDiagnostic(state.diagnostics, {
        code: "IR_SCHEMATIC_PAGE_CREATION_TICKET_INVALID",
        severity: "error",
        message:
          "原理图页 META.firstTicket 不是非负安全整数，未用于页面创建顺序。",
        documentType: document.docType,
        recordType: "META"
      });
    }
    const metaConflict = (field: string): (() => void) => () => {
      addDiagnostic(state.diagnostics, {
        code: "IR_METADATA_ALIAS_CONFLICT",
        severity: "error",
        message: `原理图页 META 的 ${field} 兼容字段值冲突，未选择任一值。`,
        documentType: document.docType,
        recordType: "META"
      });
    };
    const title = optionalNonEmptyStringAlias(
      metaInner,
      ["name", "title"],
      metaConflict("title")
    );
    const description = optionalNonEmptyString(metaInner, "description");
    const sourceDocumentId = optionalNonEmptyString(metaInner, "source");
    const version = optionalNonEmptyString(metaInner, "version");
    const sortOrder = optionalFiniteNumberAlias(
      metaInner,
      ["sort", "zIndex"],
      metaConflict("sortOrder")
    );
    state.schematicPages.push({
      id: document.uuid,
      ...(schematicId === undefined ? {} : { schematicId }),
      ...(validCreationTicket && creationTicket !== undefined
        ? { creationTicket }
        : {}),
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(sourceDocumentId === undefined ? {} : { sourceDocumentId }),
      ...(version === undefined ? {} : { version }),
      ...(sortOrder === undefined ? {} : { sortOrder }),
      attributes: attributesFor(attributesByParent, ""),
      provenance: sourceOf(document, meta),
      extensions: extension(metaInner)
    });
  }
  for (const extraMeta of metaRecords.slice(1)) {
    unmodeled(state.unmodeledRecords, document, extraMeta);
    addDiagnostic(state.diagnostics, {
      code: "IR_DUPLICATE_PAGE_META",
      severity: "error",
      message: "原理图页出现多个活动 META，额外记录未参与页面语义。",
      documentType: document.docType,
      recordType: "META"
    });
  }

  for (const selected of recordsOfType(records, "TEXT")) {
    const inner = innerOf(selected);
    if (isQuarantinedMalformedTextInner(inner)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_MALFORMED_TEXT_RECORD_QUARANTINED",
        severity: "error",
        message:
          "原理图 TEXT 的内层 JSON 被截断，已隔离且未尝试恢复；结构与电气事实不受该文本记录参与。",
        documentType: document.docType,
        recordType: "TEXT"
      });
      continue;
    }
    const id = recordId(selected);
    const text = inner === undefined ? undefined : stringField(inner, "value");
    const x =
      inner === undefined ? undefined : numberAlias(inner, ["x", "positionX"]);
    const y =
      inner === undefined ? undefined : numberAlias(inner, ["y", "positionY"]);
    const rotation =
      inner === undefined ? undefined : numberAlias(inner, ["rotation"]);
    if (
      inner === undefined ||
      id === undefined ||
      text === undefined ||
      text.length > MAX_EXPLICIT_TEXT_LENGTH ||
      x === undefined ||
      y === undefined ||
      rotation === undefined
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SCHEMATIC_ANNOTATION",
        severity: "error",
        message:
          "原理图页 TEXT 缺少 id、有限位置/旋转、字符串 value，或文本超过安全上限，未进入注释模型。",
        documentType: document.docType,
        recordType: "TEXT"
      });
      continue;
    }
    state.schematicAnnotations.push({
      id,
      pageId: document.uuid,
      text,
      contentState: text === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
      position: { x, y },
      rotation,
      coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
      basis: "EXPLICIT_SCHEMATIC_TEXT_FIELDS",
      sourceAuthenticity: "NOT_VERIFIED",
      semanticInterpretation: "NOT_PERFORMED",
      electricalTruth: "NOT_APPLICABLE",
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }

  compileSchematicTables(document, records, new Set(), state);
  compileSchematicGraphicPrimitives(document, records, new Set(), state);

  const componentIds: string[] = [];
  for (const selected of recordsOfType(records, "COMPONENT")) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    if (inner === undefined || id === undefined) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_COMPONENT",
        severity: "error",
        message: "COMPONENT 缺少 id 或对象数据。",
        documentType: document.docType,
        recordType: "COMPONENT"
      });
      continue;
    }
    const x = numberAlias(inner, ["x", "positionX"]);
    const y = numberAlias(inner, ["y", "positionY"]);
    const rotation = numberAlias(inner, ["rotation"]);
    const partId = stringField(inner, "partId");
    if (
      x === undefined ||
      y === undefined ||
      rotation === undefined ||
      partId === undefined ||
      typeof inner.isMirror !== "boolean"
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_COMPONENT",
        severity: "error",
        message: "COMPONENT 缺少位置、旋转、镜像或 partId。",
        documentType: document.docType,
        recordType: "COMPONENT"
      });
      continue;
    }
    componentIds.push(id);
    const attributes = attributesFor(attributesByParent, id);
    const conflict = (key: string): (() => void) => () => {
      addDiagnostic(state.diagnostics, {
        code: "IR_ATTRIBUTE_CONFLICT",
        severity: "error",
        message: `同一对象存在不同的 ${key} 属性值，未选择任一值。`,
        documentType: document.docType,
        recordType: "ATTR"
      });
    };
    const designator = uniqueAttributeString(attributes, "Designator", conflict("Designator"));
    const deviceId = uniqueAttributeString(attributes, "Device", conflict("Device"));
    state.components.push({
      id,
      pageId: document.uuid,
      partId,
      position: { x, y },
      rotation,
      mirrored: inner.isMirror,
      ...(designator === undefined ? {} : { designator }),
      ...(deviceId === undefined ? {} : { deviceId }),
      attributes,
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }

  const lineGroups = new Map<string, ReducedV3Record[]>();
  const unboundLines: ReducedV3Record[] = [];
  for (const selected of recordsOfType(records, "LINE")) {
    const inner = innerOf(selected);
    const lineGroup = inner === undefined ? undefined : stringField(inner, "lineGroup");
    if (lineGroup === undefined || lineGroup === "") {
      unboundLines.push(selected);
      continue;
    }
    const bucket = lineGroups.get(lineGroup);
    if (bucket === undefined) lineGroups.set(lineGroup, [selected]);
    else bucket.push(selected);
  }

  const wireIds = new Set<string>();
  for (const selected of recordsOfType(records, "WIRE")) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    if (inner === undefined || id === undefined) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_WIRE",
        severity: "error",
        message: "WIRE 缺少 id 或对象数据。",
        documentType: document.docType,
        recordType: "WIRE"
      });
      continue;
    }
    wireIds.add(id);
    const attributes = attributesFor(attributesByParent, id);
    const explicitNetName = uniqueAttributeString(attributes, "NET", () => {
      addDiagnostic(state.diagnostics, {
        code: "IR_ATTRIBUTE_CONFLICT",
        severity: "error",
        message: "同一导线存在不同 NET 属性值，未选择任一网络名。",
        documentType: document.docType,
        recordType: "ATTR"
      });
    });
    if (explicitNetName === undefined) {
      addDiagnostic(state.diagnostics, {
        code: "IR_WIRE_EXPLICIT_NET_MISSING",
        severity: "warning",
        message: "导线没有唯一的显式 NET 属性；当前阶段不会用几何关系猜测网络名。",
        documentType: document.docType,
        recordType: "WIRE"
      });
    }
    const segments = pointSegmentsFromDots(
      document,
      selected,
      id,
      inner,
      () => {
        addDiagnostic(state.diagnostics, {
          code: "IR_INVALID_WIRE_DOTS",
          severity: "error",
          message: "WIRE.dots 包含非法路径，相关路径未编译。",
          documentType: document.docType,
          recordType: "WIRE"
        });
      },
      "WIRE_DOTS"
    );
    const childSegments: IrWireSegment[] = [];
    for (const line of lineGroups.get(id) ?? []) {
      const lineInner = innerOf(line);
      const lineId = recordId(line);
      const startX = lineInner === undefined ? undefined : numberAlias(lineInner, ["startX"]);
      const startY = lineInner === undefined ? undefined : numberAlias(lineInner, ["startY"]);
      const endX = lineInner === undefined ? undefined : numberAlias(lineInner, ["endX"]);
      const endY = lineInner === undefined ? undefined : numberAlias(lineInner, ["endY"]);
      if (
        lineInner === undefined ||
        lineId === undefined ||
        startX === undefined ||
        startY === undefined ||
        endX === undefined ||
        endY === undefined
      ) {
        unmodeled(state.unmodeledRecords, document, line);
        addDiagnostic(state.diagnostics, {
          code: "IR_INVALID_WIRE_LINE",
          severity: "error",
          message: "LINE 缺少 id 或有效起止坐标，未编入导线段。",
          documentType: document.docType,
          recordType: "LINE"
        });
        continue;
      }
      childSegments.push({
        id: lineId,
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        provenance: sourceOf(document, line),
        extensions: extension(lineInner)
      });
    }
    state.wires.push({
      id,
      pageId: document.uuid,
      ...(explicitNetName === undefined ? {} : { explicitNetName }),
      segments: [...segments, ...childSegments].sort((left, right) =>
        compareText(left.id, right.id)
      ),
      attributes,
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }

  for (const [lineGroup, lines] of lineGroups) {
    if (!wireIds.has(lineGroup)) {
      unboundLines.push(...lines);
    }
  }
  for (const line of unboundLines) {
    unmodeled(state.unmodeledRecords, document, line);
  }
  if (unboundLines.length > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_WIRE_LINE_PARENT_MISSING",
        severity: "error",
        message: "LINE 无法关联到活动 WIRE，未编入导线段。",
        documentType: document.docType,
        recordType: "LINE"
      },
      unboundLines.length
    );
  }

  const busIds = new Set<string>();
  const busEntryIdsByBus = new Map<string, string[]>();
  for (const selected of recordsOfType(records, "BUS")) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    if (inner === undefined || id === undefined) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_BUS",
        severity: "error",
        message: "BUS 缺少 id 或对象数据，未进入显式总线模型。",
        documentType: document.docType,
        recordType: "BUS"
      });
      continue;
    }
    const hasDots = Object.hasOwn(inner, "dots");
    const hasEmbeddedEntries = Object.hasOwn(inner, "busEntry");
    if (
      (!hasDots && !hasEmbeddedEntries) ||
      (hasEmbeddedEntries && !isObjectRecord(inner.busEntry))
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_BUS",
        severity: "error",
        message:
          "BUS 既没有官方 dots，也没有有效的内嵌 busEntry 对象，未进入显式总线模型。",
        documentType: document.docType,
        recordType: "BUS"
      });
      continue;
    }
    const embeddedEntries = hasEmbeddedEntries
      ? Object.entries(inner.busEntry as Readonly<Record<string, unknown>>)
      : [];
    if (embeddedEntries.length > MAX_BUS_ENTRIES_PER_BUS) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_BUS_ENTRY_LIMIT_EXCEEDED",
        severity: "error",
        message: `单条 BUS 的内嵌入口超过 ${MAX_BUS_ENTRIES_PER_BUS} 项安全上限，整条记录未进入模型。`,
        documentType: document.docType,
        recordType: "BUS"
      });
      continue;
    }

    busIds.add(id);
    const attributes = attributesFor(attributesByParent, id);
    const explicitNetName = uniqueAttributeString(attributes, "NET", () => {
      addDiagnostic(state.diagnostics, {
        code: "IR_ATTRIBUTE_CONFLICT",
        severity: "error",
        message: "同一总线存在不同 NET 属性值，未选择任一网络名。",
        documentType: document.docType,
        recordType: "ATTR"
      });
    });
    if (explicitNetName === undefined) {
      addDiagnostic(state.diagnostics, {
        code: "IR_BUS_EXPLICIT_NET_MISSING",
        severity: "warning",
        message:
          "总线没有唯一的显式 NET 属性；不会展开名称或猜测成员网络。",
        documentType: document.docType,
        recordType: "BUS"
      });
    }
    const segments: readonly IrBusSegment[] = hasDots
      ? pointSegmentsFromDots(
          document,
          selected,
          id,
          inner,
          () => {
            addDiagnostic(state.diagnostics, {
              code: "IR_INVALID_BUS_DOTS",
              severity: "error",
              message: "BUS.dots 包含非法路径，相关路径未编译。",
              documentType: document.docType,
              recordType: "BUS"
            });
          },
          "BUS_DOTS"
        )
      : [];
    const entryIds: string[] = [];
    const validEmbeddedEntries: IrBusEntry[] = [];
    for (const [entryId, rawEntry] of embeddedEntries) {
      const fields = isObjectRecord(rawEntry)
        ? busEntryFields(rawEntry, false)
        : undefined;
      if (entryId === "" || fields === undefined || !isObjectRecord(rawEntry)) {
        addDiagnostic(state.diagnostics, {
          code: "IR_INVALID_EMBEDDED_BUS_ENTRY",
          severity: "error",
          message:
            "BUS.busEntry 成员缺少非空 ID、有效 order、坐标或旋转；该入口未进入模型。",
          documentType: document.docType,
          recordType: "BUS"
        });
        continue;
      }
      entryIds.push(entryId);
      validEmbeddedEntries.push({
        id: entryId,
        pageId: document.uuid,
        busId: id,
        encoding: "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM",
        associationStatus: "EMBEDDED_IN_BUS_RECORD",
        ...fields,
        evidenceClass: "EXPLICIT_PROJECT_RECORD",
        truthStatus: "NOT_VERIFIED",
        provenance: sourceOf(document, selected),
        extensions: extension(rawEntry)
      });
    }
    validEmbeddedEntries.sort(compareBusEntry);
    entryIds.splice(
      0,
      entryIds.length,
      ...validEmbeddedEntries.map((entry) => entry.id)
    );
    const duplicateOrderCount =
      validEmbeddedEntries.length -
      new Set(validEmbeddedEntries.map((entry) => entry.order)).size;
    if (duplicateOrderCount > 0) {
      addDiagnostic(
        state.diagnostics,
        {
          code: "IR_BUS_ENTRY_ORDER_DUPLICATE",
          severity: "warning",
          message:
            "同一 BUS 的多个入口使用相同 order；已保留全部入口并用显式 ID 稳定排序。",
          documentType: document.docType,
          recordType: "BUS"
        },
        duplicateOrderCount
      );
    }
    state.busEntries.push(...validEmbeddedEntries);
    busEntryIdsByBus.set(id, entryIds);
    state.buses.push({
      id,
      pageId: document.uuid,
      encoding:
        hasDots && hasEmbeddedEntries
          ? "HYBRID_DOTS_WITH_EMBEDDED_BUSENTRY_MAP"
          : hasEmbeddedEntries
            ? "OBSERVED_EMBEDDED_BUSENTRY_MAP"
            : "OFFICIAL_DOTS_WITH_SEPARATE_BUSENTRY_RECORDS",
      ...(explicitNetName === undefined ? {} : { explicitNetName }),
      segments,
      entryIds,
      attributes,
      memberExpansion: "NOT_PERFORMED",
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }

  for (const selected of recordsOfType(records, "BUSENTRY")) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    const fields = inner === undefined ? undefined : busEntryFields(inner, true);
    if (inner === undefined || id === undefined || fields === undefined) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SEPARATE_BUS_ENTRY",
        severity: "error",
        message:
          "独立 BUSENTRY 缺少 id、busGroupId、order、有限坐标或旋转，未进入模型。",
        documentType: document.docType,
        recordType: "BUSENTRY"
      });
      continue;
    }
    const explicitParentId = optionalNonEmptyString(inner, "parentId");
    const resolvedBusId =
      explicitParentId !== undefined && busIds.has(explicitParentId)
        ? explicitParentId
        : undefined;
    const associationStatus =
      resolvedBusId !== undefined
        ? ("EXPLICIT_PARENT_ID" as const)
        : explicitParentId === undefined
          ? ("SEPARATE_RECORD_WITHOUT_EXPLICIT_BUS_ID" as const)
          : ("EXPLICIT_PARENT_ID_NOT_FOUND" as const);
    if (associationStatus === "EXPLICIT_PARENT_ID_NOT_FOUND") {
      addDiagnostic(state.diagnostics, {
        code: "IR_BUSENTRY_PARENT_NOT_FOUND",
        severity: "warning",
        message:
          "独立 BUSENTRY 的显式 parentId 未命中同页 BUS；入口保持未绑定，不用几何猜测归属。",
        documentType: document.docType,
        recordType: "BUSENTRY"
      });
    }
    if (resolvedBusId !== undefined) {
      busEntryIdsByBus.get(resolvedBusId)?.push(id);
    }
    state.busEntries.push({
      id,
      pageId: document.uuid,
      ...(resolvedBusId === undefined ? {} : { busId: resolvedBusId }),
      encoding: "OFFICIAL_SEPARATE_BUSENTRY_RECORD",
      associationStatus,
      ...fields,
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }
  for (const [busId, entryIds] of busEntryIdsByBus) {
    const orderedIds = state.busEntries
      .filter(
        (entry) =>
          entry.pageId === document.uuid && entry.busId === busId
      )
      .sort(compareBusEntry)
      .map((entry) => entry.id);
    entryIds.splice(0, entryIds.length, ...orderedIds);
  }

  const sortedComponentIds = componentIds.sort(
    (left, right) => right.length - left.length || compareText(left, right)
  );
  const componentIdSet = new Set(sortedComponentIds);
  const componentIdLengths = [...new Set(sortedComponentIds.map((id) => id.length))].sort(
    (left, right) => right - left
  );
  for (const [parentId, items] of attributesByParent) {
    if (
      parentId === "" ||
      componentIdSet.has(parentId) ||
      wireIds.has(parentId) ||
      busIds.has(parentId)
    ) {
      continue;
    }
    const matchingComponents = componentIdLengths
      .filter((length) => length < parentId.length)
      .map((length) => parentId.slice(0, length))
      .filter((candidate) => componentIdSet.has(candidate));
    if (matchingComponents.length === 1) {
      const componentId = matchingComponents[0]!;
      const rawPinId = parentId.slice(componentId.length);
      const symbolPinId = rawPinId.startsWith("-")
        ? rawPinId.slice(1)
        : rawPinId;
      if (symbolPinId !== "") {
        for (const item of items) {
          state.componentPinOverrides.push({
            pageId: document.uuid,
            componentId,
            symbolPinId,
            parentId,
            attribute: item.attribute
          });
        }
        continue;
      }
    }
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_ATTRIBUTE_PARENT_UNRESOLVED",
        severity: "warning",
        message: "属性 parentId 无法绑定到当前已建模对象，已作为未绑定事实保留。",
        documentType: document.docType,
        recordType: "ATTR"
      },
      items.length
    );
    for (const item of items) {
      state.unboundAttributes.push({
        documentId: document.uuid,
        parentId,
        reason: "UNKNOWN_PARENT",
        attribute: item.attribute
      });
    }
  }

  const modeledTypes = new Set([
    "META",
    "TEXT",
    "TABLE",
    "TABLE_CELL",
    "COMPONENT",
    "ATTR",
    "WIRE",
    "LINE",
    "BUS",
    "BUSENTRY",
    "POLY",
    "RECT",
    "ARC",
    "CIRCLE",
    "ELLIPSE"
  ]);
  for (const selected of records) {
    if (!modeledTypes.has(selected.record.outer.type)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_RECORD_TYPE_NOT_MODELED",
        severity: "warning",
        message: "该记录类型尚未建立语义模型，已保留完整来源。",
        documentType: document.docType,
        recordType: selected.record.outer.type
      });
    }
  }
}

function compileSymbol(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const invalidAttributes: ReducedV3Record[] = [];
  const attributesByParent = indexAttributes(document, records, (selected) => {
    invalidAttributes.push(selected);
    addDiagnostic(state.diagnostics, {
      code: "IR_INVALID_ATTRIBUTE",
      severity: "error",
      message: "ATTR 缺少可验证的 id、parentId、key 或 JSON value，未编入语义对象。",
      documentType: document.docType,
      recordType: "ATTR"
    });
  });
  for (const selected of invalidAttributes) {
    unmodeled(state.unmodeledRecords, document, selected);
  }

  const metaRecords = recordsOfType(records, "META");
  const meta = metaRecords[0];
  const metaInner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || metaInner === undefined) {
    addDiagnostic(state.diagnostics, {
      code: "IR_SYMBOL_META_MISSING",
      severity: "error",
      message: "符号文档缺少 META，无法建立符号语义对象。",
      documentType: document.docType,
      recordType: "META"
    });
  } else {
    const symbolType =
      typeof metaInner.docType === "number" && Number.isFinite(metaInner.docType)
        ? metaInner.docType
        : undefined;
    const title = optionalNonEmptyString(metaInner, "title");
    const description = optionalNonEmptyString(metaInner, "description");
    state.symbols.push({
      id: document.uuid,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(symbolType === undefined ? {} : { symbolType }),
      attributes: attributesFor(attributesByParent, ""),
      provenance: sourceOf(document, meta),
      extensions: extension(metaInner)
    });
  }
  for (const extraMeta of metaRecords.slice(1)) {
    unmodeled(state.unmodeledRecords, document, extraMeta);
  }

  const partIds = new Set<string>();
  const pinIds = new Set<string>();
  for (const selected of recordsOfType(records, "PART")) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    if (inner === undefined || id === undefined) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SYMBOL_PART",
        severity: "error",
        message: "PART 缺少 id 或对象数据。",
        documentType: document.docType,
        recordType: "PART"
      });
      continue;
    }
    partIds.add(id);
    const title = optionalNonEmptyString(inner, "title");
    state.symbolParts.push({
      id,
      symbolId: document.uuid,
      ...(title === undefined ? {} : { title }),
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }

  compileSchematicTables(document, records, partIds, state);
  compileSchematicGraphicPrimitives(document, records, partIds, state);

  for (const selected of recordsOfType(records, "TEXT")) {
    const inner = innerOf(selected);
    if (isQuarantinedMalformedTextInner(inner)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_MALFORMED_TEXT_RECORD_QUARANTINED",
        severity: "error",
        message:
          "符号 TEXT 的内层 JSON 被截断，已隔离且未尝试恢复；结构与电气事实不受该文本记录参与。",
        documentType: document.docType,
        recordType: "TEXT"
      });
      continue;
    }
    const id = recordId(selected);
    const text = inner === undefined ? undefined : stringField(inner, "value");
    const x =
      inner === undefined ? undefined : numberAlias(inner, ["x", "positionX"]);
    const y =
      inner === undefined ? undefined : numberAlias(inner, ["y", "positionY"]);
    const rotation =
      inner === undefined ? undefined : numberAlias(inner, ["rotation"]);
    const partId =
      inner === undefined ? undefined : stringField(inner, "partId");
    if (
      inner === undefined ||
      id === undefined ||
      text === undefined ||
      text.length > MAX_EXPLICIT_TEXT_LENGTH ||
      x === undefined ||
      y === undefined ||
      rotation === undefined ||
      partId === undefined
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SYMBOL_TEXT",
        severity: "error",
        message:
          "符号 TEXT 缺少 id、partId、有限位置/旋转、字符串 value，或文本超过安全上限，未进入符号文本模型。",
        documentType: document.docType,
        recordType: "TEXT"
      });
      continue;
    }
    const partBinding =
      partId === ""
        ? { state: "EXPLICIT_EMPTY" as const }
        : partIds.has(partId)
          ? {
              state: "RESOLVED_EXACT" as const,
              targetId: partId
            }
          : {
              state: "PART_NOT_FOUND" as const,
              targetId: partId
            };
    if (partBinding.state === "PART_NOT_FOUND") {
      addDiagnostic(state.diagnostics, {
        code: "IR_SYMBOL_TEXT_PART_NOT_FOUND",
        severity: "warning",
        message:
          "符号 TEXT 的显式 partId 无法绑定到同一符号的 PART，已保留文本与断链状态。",
        documentType: document.docType,
        recordType: "TEXT"
      });
    }
    state.symbolTexts.push({
      id,
      symbolId: document.uuid,
      ...(partId === "" ? {} : { partId }),
      partBinding,
      text,
      contentState: text === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
      position: { x, y },
      rotation,
      coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
      basis: "EXPLICIT_SYMBOL_TEXT_FIELDS",
      sourceAuthenticity: "NOT_VERIFIED",
      semanticInterpretation: "NOT_PERFORMED",
      electricalTruth: "NOT_APPLICABLE",
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }

  for (const selected of recordsOfType(records, "PIN")) {
    const inner = innerOf(selected);
    const id = recordId(selected);
    if (inner === undefined || id === undefined) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SYMBOL_PIN",
        severity: "error",
        message: "PIN 缺少 id 或对象数据。",
        documentType: document.docType,
        recordType: "PIN"
      });
      continue;
    }
    const x = numberAlias(inner, ["x", "positionX"]);
    const y = numberAlias(inner, ["y", "positionY"]);
    const length = numberAlias(inner, ["length"]);
    const rotation = numberAlias(inner, ["rotation"]);
    const partId = stringField(inner, "partId");
    if (
      x === undefined ||
      y === undefined ||
      length === undefined ||
      rotation === undefined ||
      partId === undefined
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INVALID_SYMBOL_PIN",
        severity: "error",
        message: "PIN 缺少位置、长度、旋转或 partId。",
        documentType: document.docType,
        recordType: "PIN"
      });
      continue;
    }
    pinIds.add(id);
    const attributes = attributesFor(attributesByParent, id);
    const conflict = (key: string): (() => void) => () => {
      addDiagnostic(state.diagnostics, {
        code: "IR_ATTRIBUTE_CONFLICT",
        severity: "error",
        message: `同一引脚存在不同的 ${key} 属性值，未选择任一值。`,
        documentType: document.docType,
        recordType: "ATTR"
      });
    };
    const name = uniqueAttributeString(attributes, "Pin Name", conflict("Pin Name"));
    const number = uniqueAttributeString(attributes, "Pin Number", conflict("Pin Number"));
    const attrElectricalType = uniqueAttributeString(
      attributes,
      "Pin Type",
      conflict("Pin Type")
    );
    const electricalType =
      typeof inner.electric === "number" || typeof inner.electric === "string"
        ? inner.electric
        : attrElectricalType;
    const pinShape =
      typeof inner.pinShape === "number" || typeof inner.pinShape === "string"
        ? inner.pinShape
        : undefined;
    const display =
      typeof inner.display === "boolean" ? inner.display : undefined;
    if (number === undefined) {
      addDiagnostic(state.diagnostics, {
        code: "IR_PIN_NUMBER_MISSING",
        severity: "warning",
        message: "符号引脚没有唯一的 Pin Number，不能生成可靠引脚编号。",
        documentType: document.docType,
        recordType: "PIN"
      });
    }
    state.symbolPins.push({
      id,
      symbolId: document.uuid,
      partId,
      position: { x, y },
      length,
      rotation,
      ...(display === undefined ? {} : { display }),
      ...(name === undefined ? {} : { name }),
      ...(number === undefined ? {} : { number }),
      ...(electricalType === undefined ? {} : { electricalType }),
      ...(pinShape === undefined ? {} : { pinShape }),
      attributes,
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }

  for (const [parentId, items] of attributesByParent) {
    if (parentId === "" || pinIds.has(parentId)) continue;
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_ATTRIBUTE_PARENT_UNRESOLVED",
        severity: "warning",
        message: "属性 parentId 无法绑定到当前已建模对象，已作为未绑定事实保留。",
        documentType: document.docType,
        recordType: "ATTR"
      },
      items.length
    );
    for (const item of items) {
      state.unboundAttributes.push({
        documentId: document.uuid,
        parentId,
        reason: "UNKNOWN_PARENT",
        attribute: item.attribute
      });
    }
  }

  const modeledTypes = new Set([
    "META",
    "PART",
    "TEXT",
    "TABLE",
    "TABLE_CELL",
    "PIN",
    "ATTR",
    "POLY",
    "RECT",
    "ARC",
    "CIRCLE",
    "ELLIPSE"
  ]);
  for (const selected of records) {
    if (!modeledTypes.has(selected.record.outer.type)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_RECORD_TYPE_NOT_MODELED",
        severity: "warning",
        message: "该记录类型尚未建立语义模型，已保留完整来源。",
        documentType: document.docType,
        recordType: selected.record.outer.type
      });
    }
  }
}

function metadataConflict(
  state: CompilerState,
  document: ReducedV3DocumentSnapshot,
  field: string
): () => void {
  return () => {
    addDiagnostic(state.diagnostics, {
      code: "IR_METADATA_ALIAS_CONFLICT",
      severity: "error",
      message: `${document.docType} META 的 ${field} 兼容字段值冲突，未选择任一值。`,
      documentType: document.docType,
      recordType: "META"
    });
  };
}

function singletonMeta(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): ReducedV3Record | undefined {
  const metaRecords = recordsOfType(records, "META");
  const meta = metaRecords[0];
  if (meta === undefined || innerOf(meta) === undefined) {
    addDiagnostic(state.diagnostics, {
      code: "IR_DESIGN_METADATA_MISSING",
      severity: "error",
      message: `${document.docType} 文档缺少 META，无法建立工程层级对象。`,
      documentType: document.docType,
      recordType: "META"
    });
  }
  for (const extraMeta of metaRecords.slice(1)) {
    unmodeled(state.unmodeledRecords, document, extraMeta);
    addDiagnostic(state.diagnostics, {
      code: "IR_DUPLICATE_DESIGN_METADATA",
      severity: "error",
      message: `${document.docType} 文档存在多个活动 META，额外记录未参与层级对象。`,
      documentType: document.docType,
      recordType: "META"
    });
  }
  const modeled = new Set(meta === undefined ? [] : [meta]);
  for (const selected of records) {
    if (!modeled.has(selected)) {
      if (metaRecords.slice(1).includes(selected)) continue;
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_RECORD_TYPE_NOT_MODELED",
        severity: "warning",
        message: "工程层级文档中的额外记录尚未建立语义模型，已保留完整来源。",
        documentType: document.docType,
        recordType: selected.record.outer.type
      });
    }
  }
  return meta;
}

function compileProjectConfiguration(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const meta = singletonMeta(document, records, state);
  const inner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || inner === undefined) return;
  const title = optionalNonEmptyStringAlias(
    inner,
    ["name", "title"],
    metadataConflict(state, document, "title")
  );
  const defaultSheetId = optionalNonEmptyString(inner, "default_sheet");
  if (Object.hasOwn(inner, "defaultSheet")) {
    addDiagnostic(state.diagnostics, {
      code: "IR_PROJECT_CONFIG_COMPAT_FIELD_UNVERIFIED",
      severity: "warning",
      message:
        "CONFIG.defaultSheet 的关系语义未获官方格式证明，仅保留在 extensions.easyeda，不解释为默认原理图页。",
      documentType: document.docType,
      recordType: "META"
    });
  }
  state.projectConfigurations.push({
    documentId: document.uuid,
    ...(title === undefined ? {} : { title }),
    ...(defaultSheetId === undefined ? {} : { defaultSheetId }),
    provenance: sourceOf(document, meta),
    extensions: extension(inner)
  });
}

function compileBoard(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const meta = singletonMeta(document, records, state);
  const inner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || inner === undefined) return;
  const title = optionalNonEmptyStringAlias(
    inner,
    ["title", "name"],
    metadataConflict(state, document, "title")
  );
  const sortOrder = optionalFiniteNumberAlias(
    inner,
    ["sort", "zIndex"],
    metadataConflict(state, document, "sortOrder")
  );
  state.boards.push({
    id: document.uuid,
    ...(title === undefined ? {} : { title }),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    provenance: sourceOf(document, meta),
    extensions: extension(inner)
  });
}

function compileSchematic(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const meta = singletonMeta(document, records, state);
  const inner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || inner === undefined) return;
  const title = optionalNonEmptyStringAlias(
    inner,
    ["name", "title"],
    metadataConflict(state, document, "title")
  );
  const boardId = optionalNonEmptyString(inner, "board");
  const sourceDocumentId = optionalNonEmptyString(inner, "source");
  const version = optionalNonEmptyString(inner, "version");
  const sortOrder = optionalFiniteNumberAlias(
    inner,
    ["sort", "zIndex"],
    metadataConflict(state, document, "sortOrder")
  );
  state.schematics.push({
    id: document.uuid,
    ...(boardId === undefined ? {} : { boardId }),
    ...(title === undefined ? {} : { title }),
    ...(sourceDocumentId === undefined ? {} : { sourceDocumentId }),
    ...(version === undefined ? {} : { version }),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    provenance: sourceOf(document, meta),
    extensions: extension(inner)
  });
}

function compileDevice(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const metaRecords = recordsOfType(records, "META");
  const meta = metaRecords[0];
  const inner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || inner === undefined) {
    addDiagnostic(state.diagnostics, {
      code: "IR_DEVICE_META_MISSING",
      severity: "error",
      message: "器件文档缺少 META，无法建立器件语义对象。",
      documentType: document.docType,
      recordType: "META"
    });
  } else {
    const attributes =
      inner.attributes !== null &&
      typeof inner.attributes === "object" &&
      !Array.isArray(inner.attributes) &&
      isJsonValue(inner.attributes)
        ? (inner.attributes as JsonObject)
        : {};
    const title = optionalNonEmptyString(inner, "title");
    state.devices.push({
      id: document.uuid,
      ...(title === undefined ? {} : { title }),
      attributes,
      provenance: sourceOf(document, meta),
      extensions: extension(inner)
    });
  }
  const modeled = new Set(meta === undefined ? [] : [meta]);
  for (const selected of records) {
    if (!modeled.has(selected)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_RECORD_TYPE_NOT_MODELED",
        severity: "warning",
        message: "器件文档中的额外记录尚未建立语义模型，已保留完整来源。",
        documentType: document.docType,
        recordType: selected.record.outer.type
      });
    }
  }
}

function compileVariant(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const metaRecords = recordsOfType(records, "META");
  const meta = metaRecords[0];
  const inner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || inner === undefined) {
    addDiagnostic(state.diagnostics, {
      code: "IR_VARIANT_META_MISSING",
      severity: "error",
      message: "变体文档缺少 META，无法建立变体语义对象。",
      documentType: document.docType,
      recordType: "META"
    });
  } else {
    const title = optionalNonEmptyString(inner, "title");
    const description = optionalNonEmptyString(inner, "description");
    const schematicId = optionalNonEmptyString(inner, "schematicId");
    const sortOrder = numberAlias(inner, ["zIndex"]);
    const hasUngroupedComponents =
      typeof inner.notGrouped === "boolean" ? inner.notGrouped : undefined;
    const invalidFieldCount = [
      ["title", "string"],
      ["description", "string"],
      ["schematicId", "string"],
      ["zIndex", "number"],
      ["notGrouped", "boolean"]
    ].filter(([key, expected]) => {
      if (!Object.hasOwn(inner, key as string)) return false;
      const value = inner[key as string];
      return (
        (expected === "number" &&
          (typeof value !== "number" || !Number.isFinite(value))) ||
        (expected !== "number" && typeof value !== expected)
      );
    }).length;
    if (invalidFieldCount > 0) {
      addDiagnostic(
        state.diagnostics,
        {
          code: "IR_VARIANT_META_FIELD_INVALID",
          severity: "error",
          message: "变体 META 包含类型不符合官方格式的字段，非法字段未进入规范属性。",
          documentType: document.docType,
          recordType: "META"
        },
        invalidFieldCount
      );
    }
    state.variants.push({
      id: document.uuid,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(schematicId === undefined ? {} : { schematicId }),
      ...(sortOrder === undefined ? {} : { sortOrder }),
      ...(hasUngroupedComponents === undefined
        ? {}
        : { hasUngroupedComponents }),
      provenance: sourceOf(document, meta),
      extensions: extension(inner)
    });
  }
  const modeled = new Set(meta === undefined ? [] : [meta]);
  for (const selected of records) {
    if (!modeled.has(selected)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code:
          selected.record.outer.type === "META"
            ? "IR_DUPLICATE_VARIANT_META"
            : "IR_RECORD_TYPE_NOT_MODELED",
        severity: selected.record.outer.type === "META" ? "error" : "warning",
        message:
          selected.record.outer.type === "META"
            ? "变体文档出现多个活动 META，额外记录未参与语义。"
            : "变体文档中的额外记录尚未建立语义模型，已保留完整来源。",
        documentType: document.docType,
        recordType: selected.record.outer.type
      });
    }
  }
}

function compileComponentGroup(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const metaRecords = recordsOfType(records, "META");
  const meta = metaRecords[0];
  const inner = meta === undefined ? undefined : innerOf(meta);
  if (meta === undefined || inner === undefined) {
    addDiagnostic(state.diagnostics, {
      code: "IR_COMPONENT_GROUP_META_MISSING",
      severity: "error",
      message: "元件分组文档缺少 META，无法建立分组语义对象。",
      documentType: document.docType,
      recordType: "META"
    });
    for (const selected of records) {
      unmodeled(state.unmodeledRecords, document, selected);
    }
    return;
  }

  const title = optionalNonEmptyString(inner, "title");
  const parentGroupId = optionalNonEmptyString(inner, "parent");
  const directVariantId = optionalNonEmptyString(inner, "belong");
  const schematicId = optionalNonEmptyString(inner, "schematicId");
  const sortOrder = numberAlias(inner, ["zIndex"]);
  const invalidMetaFieldCount = [
    ["title", "string"],
    ["parent", "string"],
    ["belong", "string"],
    ["schematicId", "string"],
    ["zIndex", "number"]
  ].filter(([key, expected]) => {
    if (!Object.hasOwn(inner, key as string)) return false;
    const value = inner[key as string];
    return (
      (expected === "number" &&
        (typeof value !== "number" || !Number.isFinite(value))) ||
      (expected !== "number" && typeof value !== expected)
    );
  }).length;
  if (invalidMetaFieldCount > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_GROUP_META_FIELD_INVALID",
        severity: "error",
        message: "元件分组 META 包含类型不符合官方格式的字段，非法字段未进入规范属性。",
        documentType: document.docType,
        recordType: "META"
      },
      invalidMetaFieldCount
    );
  }

  const variantIndexes: IrComponentGroupVariantIndex[] = [];
  const overrides: IrComponentGroupOverride[] = [];
  const modeled = new Set<ReducedV3Record>([meta]);
  for (const selected of recordsOfType(records, "GROUP_INDEX")) {
    modeled.add(selected);
    const indexInner = innerOf(selected);
    const variantId = recordId(selected);
    const indexSortOrder =
      indexInner === undefined ? undefined : numberAlias(indexInner, ["zIndex"]);
    if (
      indexInner === undefined ||
      variantId === undefined ||
      indexSortOrder === undefined
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_COMPONENT_GROUP_INDEX_INVALID",
        severity: "error",
        message: "GROUP_INDEX 缺少变体 ID 或有限 zIndex，未进入分组语义。",
        documentType: document.docType,
        recordType: "GROUP_INDEX"
      });
      continue;
    }
    variantIndexes.push({
      variantId,
      sortOrder: indexSortOrder,
      provenance: sourceOf(document, selected),
      extensions: extension(indexInner)
    });
  }
  for (const selected of recordsOfType(records, "GROUP_DATA")) {
    modeled.add(selected);
    const dataInner = innerOf(selected);
    const compoundId = recordId(selected);
    const idParts = compoundId?.split("@");
    if (
      dataInner === undefined ||
      idParts === undefined ||
      idParts.length !== 2 ||
      idParts[0] === "" ||
      idParts[1] === ""
    ) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_COMPONENT_GROUP_DATA_INVALID",
        severity: "error",
        message: "GROUP_DATA 缺少可验证的 图元ID@实例页ID 或对象属性，未进入分组语义。",
        documentType: document.docType,
        recordType: "GROUP_DATA"
      });
      continue;
    }
    overrides.push({
      targetPrimitiveId: idParts[0] as string,
      instancePageId: idParts[1] as string,
      attributes: asJsonObject(dataInner),
      provenance: sourceOf(document, selected),
      extensions: extension(dataInner)
    });
  }

  variantIndexes.sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      compareText(left.variantId, right.variantId)
  );
  overrides.sort(
    (left, right) =>
      compareText(left.instancePageId, right.instancePageId) ||
      compareText(left.targetPrimitiveId, right.targetPrimitiveId)
  );
  state.componentGroups.push({
    id: document.uuid,
    ...(title === undefined ? {} : { title }),
    ...(parentGroupId === undefined ? {} : { parentGroupId }),
    ...(directVariantId === undefined ? {} : { directVariantId }),
    ...(schematicId === undefined ? {} : { schematicId }),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    variantIndexes,
    overrides,
    provenance: sourceOf(document, meta),
    extensions: extension(inner)
  });

  for (const selected of records) {
    if (!modeled.has(selected)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code:
          selected.record.outer.type === "META"
            ? "IR_DUPLICATE_COMPONENT_GROUP_META"
            : "IR_RECORD_TYPE_NOT_MODELED",
        severity: selected.record.outer.type === "META" ? "error" : "warning",
        message:
          selected.record.outer.type === "META"
            ? "元件分组文档出现多个活动 META，额外记录未参与语义。"
            : "元件分组文档中的额外记录尚未建立语义模型，已保留完整来源。",
        documentType: document.docType,
        recordType: selected.record.outer.type
      });
    }
  }
}

function compileInstance(
  document: ReducedV3DocumentSnapshot,
  records: readonly ReducedV3Record[],
  state: CompilerState
): void {
  const parsed = parseInstancePath(document.uuid);
  if (parsed.status === "INVALID") {
    for (const selected of records) {
      unmodeled(state.unmodeledRecords, document, selected);
    }
    addDiagnostic(state.diagnostics, {
      code: "IR_INSTANCE_PATH_INVALID",
      severity: "error",
      message:
        "INSTANCE 文档 UUID 既不符合官方页号/Block 编码，也不符合当前导出的页面 ID/Block 编码，记录未进入实例语义。",
      documentType: document.docType
    });
    return;
  }

  const overrides: RawInstanceContext["overrides"][number][] = [];
  const modeled = new Set<ReducedV3Record>();
  for (const selected of recordsOfType(records, "INSTANCE_ATTR")) {
    modeled.add(selected);
    const inner = innerOf(selected);
    const targetPrimitiveId = recordId(selected);
    if (inner === undefined || targetPrimitiveId === undefined) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_INSTANCE_ATTRIBUTE_INVALID",
        severity: "error",
        message:
          "INSTANCE_ATTR 缺少非空目标图元 ID 或对象属性，未进入实例覆盖语义。",
        documentType: document.docType,
        recordType: "INSTANCE_ATTR"
      });
      continue;
    }
    overrides.push({
      targetPrimitiveId,
      attributes: asJsonObject(inner),
      provenance: sourceOf(document, selected),
      extensions: extension(inner)
    });
  }
  overrides.sort((left, right) =>
    compareText(left.targetPrimitiveId, right.targetPrimitiveId)
  );

  state.instanceContexts.push({
    id: document.uuid,
    pathEncoding: parsed.path.encoding,
    schematicId: parsed.path.schematicId,
    blockPath: parsed.path.blockPath,
    terminalPageReference: parsed.path.terminalPageReference,
    ...(parsed.path.terminalSheetNumber === undefined
      ? {}
      : { terminalSheetNumber: parsed.path.terminalSheetNumber }),
    ...(parsed.path.terminalPageId === undefined
      ? {}
      : { terminalPageId: parsed.path.terminalPageId }),
    overrides,
    provenance: document.headers.map((header) => ({
      client: header.client,
      entry: header.source.entry,
      line: header.source.line
    }))
  });

  for (const selected of records) {
    if (!modeled.has(selected)) {
      unmodeled(state.unmodeledRecords, document, selected);
      addDiagnostic(state.diagnostics, {
        code: "IR_RECORD_TYPE_NOT_MODELED",
        severity: "warning",
        message:
          "INSTANCE 文档中的额外记录尚未建立语义模型，已保留完整来源。",
        documentType: document.docType,
        recordType: selected.record.outer.type
      });
    }
  }
}

interface CompilerState {
  readonly projectConfigurations: IrProjectConfiguration[];
  readonly boards: IrBoard[];
  readonly schematics: IrSchematic[];
  readonly schematicPages: IrSchematicPage[];
  readonly schematicAnnotations: IrSchematicAnnotation[];
  readonly schematicGraphicPrimitives: IrSchematicGraphicPrimitive[];
  readonly schematicTables: IrSchematicTable[];
  readonly variants: IrVariant[];
  readonly componentGroups: IrComponentGroup[];
  readonly instanceContexts: RawInstanceContext[];
  readonly components: ComponentBeforeLibraryBindings[];
  readonly symbols: IrSymbol[];
  readonly symbolParts: IrSymbolPart[];
  readonly symbolTexts: IrSymbolText[];
  readonly symbolPins: IrSymbolPin[];
  readonly devices: IrDevice[];
  readonly wires: IrWire[];
  readonly buses: IrBus[];
  readonly busEntries: IrBusEntry[];
  readonly componentPinOverrides: ComponentPinOverrideCandidate[];
  readonly unboundAttributes: IrUnboundAttribute[];
  readonly unmodeledRecords: IrUnmodeledRecord[];
  readonly diagnostics: Map<string, DiagnosticAccumulator>;
}

function sortById<T extends { readonly id: string }>(values: T[]): readonly T[] {
  return values.sort((left, right) => compareText(left.id, right.id));
}

function countComponentGroupsWithBrokenParent(
  groups: readonly IrComponentGroup[]
): number {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const memo = new Map<string, boolean>();
  const isBroken = (groupId: string, visiting: Set<string>): boolean => {
    const cached = memo.get(groupId);
    if (cached !== undefined) return cached;
    if (visiting.has(groupId)) return true;
    const group = byId.get(groupId);
    if (group === undefined) return true;
    if (group.parentGroupId === undefined) {
      memo.set(groupId, false);
      return false;
    }
    visiting.add(groupId);
    const broken = isBroken(group.parentGroupId, visiting);
    visiting.delete(groupId);
    memo.set(groupId, broken);
    return broken;
  };
  return groups.filter((group) => isBroken(group.id, new Set())).length;
}

export function compileV3ToEdaIr(
  reducer: V3Reducer,
  archiveSha256: string
): EdaIr {
  const documents: IrDocument[] = [];
  const state: CompilerState = {
    projectConfigurations: [],
    boards: [],
    schematics: [],
    schematicPages: [],
    schematicAnnotations: [],
    schematicGraphicPrimitives: [],
    schematicTables: [],
    variants: [],
    componentGroups: [],
    instanceContexts: [],
    components: [],
    symbols: [],
    symbolParts: [],
    symbolTexts: [],
    symbolPins: [],
    devices: [],
    wires: [],
    buses: [],
    busEntries: [],
    componentPinOverrides: [],
    unboundAttributes: [],
    unmodeledRecords: [],
    diagnostics: new Map()
  };

  for (const document of reducer.getSnapshot()) {
    if (document.deleted) continue;
    documents.push({
      id: document.uuid,
      type: document.docType,
      provenance: document.headers.map((header) => ({
        client: header.client,
        entry: header.source.entry,
        line: header.source.line
      }))
    });
    const records = activeRecords(document);
    if (!MODELED_DOCUMENT_TYPES.has(document.docType)) {
      for (const selected of records) {
        unmodeled(state.unmodeledRecords, document, selected);
      }
      addDiagnostic(
        state.diagnostics,
        {
          code: "IR_DOCUMENT_TYPE_NOT_MODELED",
          severity: "warning",
          message: "该文档类型尚未建立语义模型，活动记录仅保留来源清单。",
          documentType: document.docType
        },
        records.length
      );
      continue;
    }
    if (
      document.docType === "CONFIG" ||
      document.docType === "PROJECT_CONFIG"
    ) {
      compileProjectConfiguration(document, records, state);
    } else if (document.docType === "BOARD") {
      compileBoard(document, records, state);
    } else if (document.docType === "SCH") {
      compileSchematic(document, records, state);
    } else if (document.docType === "SCH_PAGE") {
      compilePage(document, records, state);
    } else if (document.docType === "SYMBOL") {
      compileSymbol(document, records, state);
    } else if (document.docType === "DEVICE") {
      compileDevice(document, records, state);
    } else if (document.docType === "VARIANT") {
      compileVariant(document, records, state);
    } else if (document.docType === "COMPONENT_GROUP") {
      compileComponentGroup(document, records, state);
    } else {
      compileInstance(document, records, state);
    }
  }

  const projectConfigurations = state.projectConfigurations.sort((left, right) =>
    compareText(left.documentId, right.documentId)
  );
  const boards = sortById(state.boards);
  const schematics = sortById(state.schematics);
  const schematicPages = sortById(state.schematicPages);
  const schematicAnnotations = state.schematicAnnotations.sort(
    (left, right) =>
      compareText(left.pageId, right.pageId) ||
      compareText(left.id, right.id)
  );
  const schematicGraphicPrimitives =
    state.schematicGraphicPrimitives.sort(
      (left, right) =>
        compareText(left.documentType, right.documentType) ||
        compareText(left.documentId, right.documentId) ||
        compareText(left.partId ?? "", right.partId ?? "") ||
        compareText(left.kind, right.kind) ||
        compareText(left.id, right.id)
    );
  const schematicTables = state.schematicTables.sort(
    (left, right) =>
      compareText(left.documentType, right.documentType) ||
      compareText(left.documentId, right.documentId) ||
      compareText(left.partId ?? "", right.partId ?? "") ||
      compareText(left.id, right.id)
  );
  const variants = sortById(state.variants);
  const componentGroups = sortById(state.componentGroups);
  const rawInstanceContexts = sortById(state.instanceContexts);
  const boardIds = new Set(boards.map((board) => board.id));
  const schematicIds = new Set(
    schematics.map((schematic) => schematic.id)
  );
  const schematicPageIds = new Set(
    schematicPages.map((page) => page.id)
  );
  const variantIds = new Set(variants.map((variant) => variant.id));
  const instanceDocuments = documents.filter(
    (document) => document.type === "INSTANCE"
  ).length;
  const instanceDocumentsWithInvalidPath =
    instanceDocuments - rawInstanceContexts.length;
  const instanceContextsWithMissingSchematic = rawInstanceContexts.filter(
    (context) => !schematicIds.has(context.schematicId)
  ).length;
  const instanceAttributeOverrides = rawInstanceContexts.reduce(
    (total, context) => total + context.overrides.length,
    0
  );
  const schematicsWithMissingBoard = schematics.filter(
    (schematic) =>
      schematic.boardId !== undefined && !boardIds.has(schematic.boardId)
  ).length;
  const schematicPagesWithMissingSchematic = schematicPages.filter(
    (page) =>
      page.schematicId !== undefined &&
      !schematicIds.has(page.schematicId)
  ).length;
  const projectConfigurationsWithMissingDefaultSheet =
    projectConfigurations.filter(
      (configuration) =>
        configuration.defaultSheetId !== undefined &&
        !schematicPageIds.has(configuration.defaultSheetId)
    ).length;
  const variantsWithMissingSchematic = variants.filter(
    (variant) =>
      variant.schematicId !== undefined &&
      !schematicIds.has(variant.schematicId)
  ).length;
  const componentGroupsWithMissingSchematic = componentGroups.filter(
    (group) =>
      group.schematicId !== undefined &&
      !schematicIds.has(group.schematicId)
  ).length;
  const componentGroupsWithBrokenParent =
    countComponentGroupsWithBrokenParent(componentGroups);
  const componentGroupsWithMissingDirectVariant = componentGroups.filter(
    (group) =>
      group.directVariantId !== undefined &&
      !variantIds.has(group.directVariantId)
  ).length;
  const componentGroupsWithConflictingMembership = componentGroups.filter(
    (group) =>
      group.parentGroupId !== undefined &&
      group.directVariantId !== undefined
  ).length;
  const componentGroupVariantIndexes = componentGroups.reduce(
    (total, group) => total + group.variantIndexes.length,
    0
  );
  const componentGroupVariantIndexesWithMissingVariant =
    componentGroups.reduce(
      (total, group) =>
        total +
        group.variantIndexes.filter(
          (index) => !variantIds.has(index.variantId)
        ).length,
      0
    );
  const componentGroupOverrides = componentGroups.reduce(
    (total, group) => total + group.overrides.length,
    0
  );
  if (schematicsWithMissingBoard > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_SCHEMATIC_BOARD_REFERENCE_NOT_FOUND",
        severity: "error",
        message: "原理图 META 引用的 Board 文档不存在。",
        documentType: "SCH",
        recordType: "META"
      },
      schematicsWithMissingBoard
    );
  }
  if (schematicPagesWithMissingSchematic > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_SCHEMATIC_PAGE_REFERENCE_NOT_FOUND",
        severity: "error",
        message: "原理图页 META 引用的 Schematic 文档不存在。",
        documentType: "SCH_PAGE",
        recordType: "META"
      },
      schematicPagesWithMissingSchematic
    );
  }
  if (projectConfigurationsWithMissingDefaultSheet > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_DEFAULT_SHEET_REFERENCE_NOT_FOUND",
        severity: "error",
        message: "工程配置 META 引用的默认原理图页不存在。",
        documentType: "PROJECT_CONFIG",
        recordType: "META"
      },
      projectConfigurationsWithMissingDefaultSheet
    );
  }
  if (variantsWithMissingSchematic > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_VARIANT_SCHEMATIC_REFERENCE_NOT_FOUND",
        severity: "error",
        message: "变体 META 引用的 Schematic 文档不存在。",
        documentType: "VARIANT",
        recordType: "META"
      },
      variantsWithMissingSchematic
    );
  }
  if (componentGroupsWithMissingSchematic > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_GROUP_SCHEMATIC_REFERENCE_NOT_FOUND",
        severity: "error",
        message: "元件分组 META 引用的 Schematic 文档不存在。",
        documentType: "COMPONENT_GROUP",
        recordType: "META"
      },
      componentGroupsWithMissingSchematic
    );
  }
  if (componentGroupsWithBrokenParent > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_GROUP_PARENT_BROKEN",
        severity: "error",
        message: "元件分组父链包含缺失目标、自引用或循环引用。",
        documentType: "COMPONENT_GROUP",
        recordType: "META"
      },
      componentGroupsWithBrokenParent
    );
  }
  if (componentGroupsWithMissingDirectVariant > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_GROUP_DIRECT_VARIANT_NOT_FOUND",
        severity: "error",
        message: "元件分组 belong 引用的直接变体不存在。",
        documentType: "COMPONENT_GROUP",
        recordType: "META"
      },
      componentGroupsWithMissingDirectVariant
    );
  }
  if (componentGroupsWithConflictingMembership > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_GROUP_MEMBERSHIP_CONFLICT",
        severity: "error",
        message: "元件分组同时声明 parent 与 belong，违反直接变体分组不参与分组树的官方语义。",
        documentType: "COMPONENT_GROUP",
        recordType: "META"
      },
      componentGroupsWithConflictingMembership
    );
  }
  if (componentGroupVariantIndexesWithMissingVariant > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_GROUP_INDEX_VARIANT_NOT_FOUND",
        severity: "error",
        message: "元件分组 GROUP_INDEX 引用的变体不存在。",
        documentType: "COMPONENT_GROUP",
        recordType: "GROUP_INDEX"
      },
      componentGroupVariantIndexesWithMissingVariant
    );
  }
  if (instanceContextsWithMissingSchematic > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_INSTANCE_SCHEMATIC_REFERENCE_NOT_FOUND",
        severity: "error",
        message: "INSTANCE 路径首段引用的 Schematic 文档不存在。",
        documentType: "INSTANCE"
      },
      instanceContextsWithMissingSchematic
    );
  }
  const hierarchyBrokenReferences =
    schematicsWithMissingBoard +
    schematicPagesWithMissingSchematic +
    projectConfigurationsWithMissingDefaultSheet;
  const variantGroupBrokenReferences =
    variantsWithMissingSchematic +
    componentGroupsWithMissingSchematic +
    componentGroupsWithBrokenParent +
    componentGroupsWithMissingDirectVariant +
    componentGroupsWithConflictingMembership +
    componentGroupVariantIndexesWithMissingVariant;

  const componentInputs = state.components.sort((left, right) => {
    const pageOrder = compareText(left.pageId, right.pageId);
    return pageOrder !== 0 ? pageOrder : compareText(left.id, right.id);
  });
  const devices = sortById(state.devices);
  const componentBindingCompilation = compileComponentLibraryBindings(
    componentInputs,
    devices
  );
  const boundComponents = componentBindingCompilation.components;
  const componentBindingSummary = componentBindingCompilation.summary;
  const componentDeviceReferencesNotFound = boundComponents.filter(
    (component) =>
      component.symbolBinding.state === "UNRESOLVED_DEVICE_NOT_FOUND" ||
      component.footprintBinding.state === "UNRESOLVED_DEVICE_NOT_FOUND"
  ).length;
  if (componentDeviceReferencesNotFound > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_DEVICE_REFERENCE_NOT_FOUND",
        severity: "error",
        message: "组件引用的 Device 文档不存在，无法解析器件默认绑定。",
        documentType: "SCH_PAGE",
        recordType: "ATTR"
      },
      componentDeviceReferencesNotFound
    );
  }
  for (const [key, counts] of Object.entries(
    componentBindingSummary.states
  ) as [
    "Symbol" | "Footprint",
    (typeof componentBindingSummary.states)["Symbol"]
  ][]) {
    if (counts.UNRESOLVED_COMPONENT_OVERRIDE_CONFLICT > 0) {
      addDiagnostic(
        state.diagnostics,
        {
          code: `IR_COMPONENT_${key.toUpperCase()}_OVERRIDE_CONFLICT`,
          severity: "error",
          message: `组件具有互相冲突的 ${key} 覆盖属性，未回退到 Device 默认值。`,
          documentType: "SCH_PAGE",
          recordType: "ATTR"
        },
        counts.UNRESOLVED_COMPONENT_OVERRIDE_CONFLICT
      );
    }
    if (counts.UNRESOLVED_COMPONENT_OVERRIDE_INVALID > 0) {
      addDiagnostic(
        state.diagnostics,
        {
          code: `IR_COMPONENT_${key.toUpperCase()}_OVERRIDE_INVALID`,
          severity: "error",
          message: `组件 ${key} 覆盖属性不是唯一非空字符串，未回退到 Device 默认值。`,
          documentType: "SCH_PAGE",
          recordType: "ATTR"
        },
        counts.UNRESOLVED_COMPONENT_OVERRIDE_INVALID
      );
    }
    if (counts.UNRESOLVED_DEVICE_DEFAULT_INVALID > 0) {
      addDiagnostic(
        state.diagnostics,
        {
          code: `IR_DEVICE_${key.toUpperCase()}_DEFAULT_INVALID`,
          severity: "error",
          message: `Device 的 ${key} 默认属性不是非空字符串，不能作为组件有效绑定。`,
          documentType: "DEVICE",
          recordType: "META"
        },
        counts.UNRESOLVED_DEVICE_DEFAULT_INVALID
      );
    }
  }
  const symbols = sortById(state.symbols);
  const symbolParts = state.symbolParts.sort((left, right) => {
    const symbolOrder = compareText(left.symbolId, right.symbolId);
    return symbolOrder !== 0 ? symbolOrder : compareText(left.id, right.id);
  });
  const symbolTexts = state.symbolTexts.sort(
    (left, right) =>
      compareText(left.symbolId, right.symbolId) ||
      compareText(left.partId ?? "", right.partId ?? "") ||
      compareText(left.id, right.id)
  );
  const symbolPins = state.symbolPins.sort((left, right) => {
    const symbolOrder = compareText(left.symbolId, right.symbolId);
    return symbolOrder !== 0 ? symbolOrder : compareText(left.id, right.id);
  });
  const components = compileEffectiveComponentStates(
    boundComponents,
    devices,
    schematicPages,
    symbols,
    symbolParts,
    symbolPins
  );
  const wires = state.wires.sort((left, right) => {
    const pageOrder = compareText(left.pageId, right.pageId);
    return pageOrder !== 0 ? pageOrder : compareText(left.id, right.id);
  });
  const buses = state.buses.sort(
    (left, right) =>
      compareText(left.pageId, right.pageId) || compareText(left.id, right.id)
  );
  const busEntries = state.busEntries.sort(compareBusEntry);
  const pinInstanceCompilation = compilePinInstances(
    components,
    symbols,
    symbolPins,
    wires,
    state.componentPinOverrides
  );
  const pinInstances = pinInstanceCompilation.pinInstances;
  const pinSummary = pinInstanceCompilation.summary;
  const instanceResolution = resolveInstanceContexts(rawInstanceContexts, {
    schematics,
    pages: schematicPages,
    components,
    symbols,
    pinInstances,
    devices
  });
  const instanceContexts = instanceResolution.contexts;
  const componentOccurrences = instanceResolution.occurrences;
  const instanceResolutionSummary = instanceResolution.summary;
  if (instanceResolutionSummary.unresolvedContexts > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_INSTANCE_PATH_RESOLUTION_FAILED",
        severity: "error",
        message:
          "INSTANCE 路径中的页面、Block 组件或 Block Symbol 引用未能完整闭环；上下文保留稳定失败状态。",
        documentType: "INSTANCE"
      },
      instanceResolutionSummary.unresolvedContexts
    );
  }
  if (instanceResolutionSummary.unresolvedOverrides > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_INSTANCE_ATTRIBUTE_TARGET_UNRESOLVED",
        severity: "warning",
        message:
          "INSTANCE_ATTR 目标未能唯一绑定到终端页组件或符号引脚；原始覆盖与稳定失败状态均已保留。",
        documentType: "INSTANCE",
        recordType: "INSTANCE_ATTR"
      },
      instanceResolutionSummary.unresolvedOverrides
    );
  }
  if (pinInstanceCompilation.unresolvedOverrides.length > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_PIN_OVERRIDE_UNRESOLVED",
        severity: "warning",
        message: "器件引脚覆盖属性无法绑定到已实例化的符号引脚，已作为未绑定事实保留。",
        documentType: "SCH_PAGE",
        recordType: "ATTR"
      },
      pinInstanceCompilation.unresolvedOverrides.length
    );
    for (const override of pinInstanceCompilation.unresolvedOverrides) {
      state.unboundAttributes.push({
        documentId: override.pageId,
        parentId: override.parentId,
        reason: "COMPONENT_PIN_OVERRIDE_UNRESOLVED",
        attribute: override.attribute
      });
    }
  }
  if (pinSummary.componentsWithoutSymbolReference > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_SYMBOL_REFERENCE_MISSING",
        severity: "warning",
        message: "组件没有唯一 Symbol 引用，不能实例化符号引脚。",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      pinSummary.componentsWithoutSymbolReference
    );
  }
  if (pinSummary.componentsWithUnknownSymbol > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_SYMBOL_NOT_FOUND",
        severity: "warning",
        message: "组件引用的 Symbol 未在活动符号文档中找到。",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      pinSummary.componentsWithUnknownSymbol
    );
  }
  if (pinSummary.componentsWithUnknownSymbolPart > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_COMPONENT_SYMBOL_PART_NOT_FOUND",
        severity: "warning",
        message: "组件引用的 Symbol 中没有匹配的 PART，不能实例化该组件引脚。",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      pinSummary.componentsWithUnknownSymbolPart
    );
  }
  if (pinSummary.conflictingExplicitNetCandidates > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_PIN_NET_CANDIDATE_CONFLICT",
        severity: "error",
        message: "引脚连接点同时落在不同显式 NET 的导线上，候选连接存在冲突。",
        documentType: "SCH_PAGE",
        recordType: "WIRE"
      },
      pinSummary.conflictingExplicitNetCandidates
    );
  }
  if (pinSummary.pinsOnUnlabeledWire > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_PIN_ON_UNLABELED_WIRE",
        severity: "warning",
        message: "引脚连接点落在缺少唯一显式 NET 的导线上，未生成网络候选。",
        documentType: "SCH_PAGE",
        recordType: "WIRE"
      },
      pinSummary.pinsOnUnlabeledWire
    );
  }
  if (pinSummary.pinsWithDeclaredNoConnectAndWireContact > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_NO_CONNECT_WITH_WIRE_CONTACT",
        severity: "error",
        message: "引脚同时具有显式 NO_CONNECT 声明并接触已建模导线，事实存在冲突。",
        documentType: "SCH_PAGE",
        recordType: "ATTR"
      },
      pinSummary.pinsWithDeclaredNoConnectAndWireContact
    );
  }
  if (pinSummary.pinsWithNoConnectDeclarationConflict > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_NO_CONNECT_DECLARATION_CONFLICT",
        severity: "error",
        message: "同一组件引脚具有互相冲突的 NO_CONNECT 声明。",
        documentType: "SCH_PAGE",
        recordType: "ATTR"
      },
      pinSummary.pinsWithNoConnectDeclarationConflict
    );
  }
  if (pinSummary.pinsWithInvalidNoConnectDeclaration > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_NO_CONNECT_DECLARATION_INVALID",
        severity: "error",
        message: "组件引脚 NO_CONNECT 声明不是受支持的 yes/no 或布尔值。",
        documentType: "SCH_PAGE",
        recordType: "ATTR"
      },
      pinSummary.pinsWithInvalidNoConnectDeclaration
    );
  }
  if (pinSummary.pinsWithoutWire > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_PIN_WITHOUT_WIRE_CANDIDATE",
        severity: "warning",
        message: "引脚连接点没有落在已建模导线段上；可能是未连接、隐藏连接或未支持特性。",
        documentType: "SCH_PAGE",
        recordType: "PIN"
      },
      pinSummary.pinsWithoutWire
    );
  }
  const shortRelationCompilation = compileShortRelations(
    components,
    symbols,
    pinInstances
  );
  const shortRelations = shortRelationCompilation.relations;
  const shortSummary = shortRelationCompilation.summary;
  if (shortSummary.invalidShortPinCounts > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_SHORT_RELATION_INVALID_PIN_COUNT",
        severity: "error",
        message: "Short Symbol 实例没有恰好两个已实例化引脚，不能建立短接关系候选。",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      shortSummary.invalidShortPinCounts
    );
  }
  if (shortSummary.conflictingPinConnectionCandidates > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_SHORT_RELATION_PIN_CONFLICT",
        severity: "error",
        message: "Short Symbol 至少一个引脚具有多个显式网络候选，不能建立唯一短接关系。",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      shortSummary.conflictingPinConnectionCandidates
    );
  }
  if (shortSummary.unresolvedPinConnectionCandidates > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_SHORT_RELATION_UNRESOLVED_PIN",
        severity: "warning",
        message: "Short Symbol 至少一个引脚没有唯一显式网络候选，短接关系仍未解析。",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      shortSummary.unresolvedPinConnectionCandidates
    );
  }
  if (shortSummary.sameExplicitNetCandidates > 0) {
    addDiagnostic(
      state.diagnostics,
      {
        code: "IR_SHORT_RELATION_SAME_NET",
        severity: "warning",
        message: "Short Symbol 两端得到相同显式网络候选，关系被保留但不产生跨网络合并。",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      shortSummary.sameExplicitNetCandidates
    );
  }
  const networkEndpointCompilation = compileNetworkEndpointCandidates(
    components,
    symbols,
    pinInstances
  );
  const networkEndpointCandidates = networkEndpointCompilation.candidates;
  const endpointSummary = networkEndpointCompilation.summary;
  const endpointDiagnostic = (
    code: string,
    severity: "warning" | "error",
    message: string,
    count: number
  ): void => {
    if (count === 0) return;
    addDiagnostic(
      state.diagnostics,
      {
        code,
        severity,
        message,
        documentType: "SCH_PAGE",
        recordType: "COMPONENT"
      },
      count
    );
  };
  endpointDiagnostic(
    "IR_NETWORK_ENDPOINT_DECLARATION_MISMATCH",
    "error",
    "NetFlag/NetPort 的声明网络名候选与引脚导线候选不一致。",
    endpointSummary.mismatching
  );
  endpointDiagnostic(
    "IR_NETWORK_ENDPOINT_DECLARATION_MISSING",
    "warning",
    "NetFlag/NetPort 没有可用的声明网络名属性，保留导线候选但不推断声明值。",
    endpointSummary.missingDeclaration
  );
  endpointDiagnostic(
    "IR_NETWORK_ENDPOINT_DECLARATION_CONFLICT",
    "error",
    "NetFlag/NetPort 存在多个不同的声明网络名候选，未选择任一值。",
    endpointSummary.conflictingDeclaration
  );
  endpointDiagnostic(
    "IR_NETWORK_ENDPOINT_DECLARATION_INVALID",
    "error",
    "NetFlag/NetPort 的声明网络名属性包含非字符串或空字符串值。",
    endpointSummary.invalidDeclarationValue
  );
  endpointDiagnostic(
    "IR_NETWORK_ENDPOINT_CONNECTION_UNRESOLVED",
    "warning",
    "NetFlag/NetPort 的引脚没有唯一显式网络候选，无法执行声明一致性检查。",
    endpointSummary.unresolvedConnection
  );
  endpointDiagnostic(
    "IR_NETWORK_ENDPOINT_INVALID_PIN_COUNT",
    "error",
    "NetFlag/NetPort 实例没有恰好一个已实例化引脚。",
    endpointSummary.invalidPinCount
  );
  const unboundAttributes = state.unboundAttributes.sort((left, right) => {
    const documentOrder = compareText(left.documentId, right.documentId);
    if (documentOrder !== 0) return documentOrder;
    const parentOrder = compareText(left.parentId ?? "", right.parentId ?? "");
    if (parentOrder !== 0) return parentOrder;
    return compareText(left.attribute.id, right.attribute.id);
  });
  const unmodeledRecords = state.unmodeledRecords.sort((left, right) => {
    const documentOrder = compareText(
      left.provenance.documentId,
      right.provenance.documentId
    );
    if (documentOrder !== 0) return documentOrder;
    const typeOrder = compareText(
      left.provenance.recordType,
      right.provenance.recordType
    );
    if (typeOrder !== 0) return typeOrder;
    return compareText(
      left.provenance.recordId ?? "",
      right.provenance.recordId ?? ""
    );
  });
  const summary = {
    documents: documents.length,
    projectConfigurations: projectConfigurations.length,
    boards: boards.length,
    schematics: schematics.length,
    schematicPages: schematicPages.length,
    schematicAnnotations: schematicAnnotations.length,
    schematicAnnotationsWithExplicitText: schematicAnnotations.filter(
      (annotation) => annotation.contentState === "EXPLICIT_TEXT"
    ).length,
    schematicAnnotationsWithExplicitEmpty: schematicAnnotations.filter(
      (annotation) => annotation.contentState === "EXPLICIT_EMPTY"
    ).length,
    schematicGraphicPrimitives: schematicGraphicPrimitives.length,
    schematicGraphicPrimitivesInPages: schematicGraphicPrimitives.filter(
      (primitive) => primitive.documentType === "SCHEMATIC_PAGE"
    ).length,
    schematicGraphicPrimitivesInSymbols: schematicGraphicPrimitives.filter(
      (primitive) => primitive.documentType === "SYMBOL"
    ).length,
    schematicGraphicPolygons: schematicGraphicPrimitives.filter(
      (primitive) => primitive.kind === "POLY"
    ).length,
    schematicGraphicRectangles: schematicGraphicPrimitives.filter(
      (primitive) => primitive.kind === "RECT"
    ).length,
    schematicGraphicArcs: schematicGraphicPrimitives.filter(
      (primitive) => primitive.kind === "ARC"
    ).length,
    schematicGraphicCircles: schematicGraphicPrimitives.filter(
      (primitive) => primitive.kind === "CIRCLE"
    ).length,
    schematicGraphicEllipses: schematicGraphicPrimitives.filter(
      (primitive) => primitive.kind === "ELLIPSE"
    ).length,
    schematicGraphicPrimitivesResolvedExactPart:
      schematicGraphicPrimitives.filter(
        (primitive) => primitive.partBinding.state === "RESOLVED_EXACT"
      ).length,
    schematicGraphicPrimitivesWithExplicitEmptyPart:
      schematicGraphicPrimitives.filter(
        (primitive) => primitive.partBinding.state === "EXPLICIT_EMPTY"
      ).length,
    schematicGraphicPrimitivesWithPartNotFound:
      schematicGraphicPrimitives.filter(
        (primitive) => primitive.partBinding.state === "PART_NOT_FOUND"
      ).length,
    schematicTables: schematicTables.length,
    schematicTablesInPages: schematicTables.filter(
      (table) => table.documentType === "SCHEMATIC_PAGE"
    ).length,
    schematicTablesInSymbols: schematicTables.filter(
      (table) => table.documentType === "SYMBOL"
    ).length,
    schematicTableCells: schematicTables.reduce(
      (total, table) => total + table.cells.length,
      0
    ),
    schematicTableCellsWithExplicitText: schematicTables.reduce(
      (total, table) =>
        total +
        table.cells.filter((cell) => cell.contentState === "EXPLICIT_TEXT")
          .length,
      0
    ),
    schematicTableCellsWithExplicitEmpty: schematicTables.reduce(
      (total, table) =>
        total +
        table.cells.filter((cell) => cell.contentState === "EXPLICIT_EMPTY")
          .length,
      0
    ),
    schematicTableCellsFromInlineRecords: schematicTables.reduce(
      (total, table) =>
        total +
        table.cells.filter(
          (cell) => cell.representation === "V3_INLINE_TABLE_CELL"
        ).length,
      0
    ),
    schematicTableCellsFromSeparateRecords: schematicTables.reduce(
      (total, table) =>
        total +
        table.cells.filter(
          (cell) =>
            cell.representation === "OFFICIAL_SEPARATE_TABLE_RECORD"
        ).length,
      0
    ),
    schematicTableCellsFromBothMatching: schematicTables.reduce(
      (total, table) =>
        total +
        table.cells.filter(
          (cell) => cell.representation === "BOTH_MATCHING"
        ).length,
      0
    ),
    schematicTablesResolvedExactPart: schematicTables.filter(
      (table) => table.partBinding.state === "RESOLVED_EXACT"
    ).length,
    schematicTablesWithExplicitEmptyPart: schematicTables.filter(
      (table) => table.partBinding.state === "EXPLICIT_EMPTY"
    ).length,
    schematicTablesWithPartNotFound: schematicTables.filter(
      (table) => table.partBinding.state === "PART_NOT_FOUND"
    ).length,
    schematicsWithMissingBoard,
    schematicPagesWithMissingSchematic,
    projectConfigurationsWithMissingDefaultSheet,
    hierarchyBrokenReferences,
    variants: variants.length,
    variantsWithMissingSchematic,
    componentGroups: componentGroups.length,
    componentGroupsWithMissingSchematic,
    componentGroupsWithBrokenParent,
    componentGroupsWithMissingDirectVariant,
    componentGroupsWithConflictingMembership,
    componentGroupVariantIndexes,
    componentGroupVariantIndexesWithMissingVariant,
    componentGroupOverrides,
    variantGroupBrokenReferences,
    instanceDocuments,
    instanceContexts: instanceContexts.length,
    instanceDocumentsWithInvalidPath,
    instanceContextsWithMissingSchematic,
    instanceContextsResolved: instanceResolutionSummary.resolvedContexts,
    instanceContextsUnresolved: instanceResolutionSummary.unresolvedContexts,
    instanceAttributeOverrides,
    instanceAttributeOverridesAppliedToComponents:
      instanceResolutionSummary.appliedComponentOverrides,
    instanceAttributeOverridesAppliedToPins:
      instanceResolutionSummary.appliedPinOverrides,
    instanceAttributeOverridesUnresolved:
      instanceResolutionSummary.unresolvedOverrides,
    componentOccurrences: componentOccurrences.length,
    componentOccurrencesPopulated: componentOccurrences.filter(
      (item) => item.assembly.status === "POPULATED"
    ).length,
    componentOccurrencesDnp: componentOccurrences.filter(
      (item) => item.assembly.status === "DNP"
    ).length,
    componentOccurrencesAssemblyUnknown: componentOccurrences.filter(
      (item) => item.assembly.status === "UNKNOWN"
    ).length,
    components: components.length,
    componentsPopulated: components.filter(
      (item) => item.assembly.status === "POPULATED"
    ).length,
    componentsDnp: components.filter((item) => item.assembly.status === "DNP")
      .length,
    componentsAssemblyUnknown: components.filter(
      (item) => item.assembly.status === "UNKNOWN"
    ).length,
    componentsPinCompletenessComplete: components.filter(
      (item) => item.pinCompleteness.status === "COMPLETE"
    ).length,
    componentsPinCompletenessPartial: components.filter(
      (item) => item.pinCompleteness.status === "PARTIAL"
    ).length,
    componentsPinCompletenessUnknown: components.filter(
      (item) => item.pinCompleteness.status === "UNKNOWN"
    ).length,
    componentsWithDesignator: components.filter((item) => item.designator !== undefined)
      .length,
    componentsWithDevice: components.filter((item) => item.deviceId !== undefined).length,
    componentsWithSymbol: components.filter((item) => item.symbolId !== undefined).length,
    componentsWithSymbolFromComponentOverride:
      componentBindingSummary.symbolFromComponentOverride,
    componentsWithSymbolFromDeviceDefault:
      componentBindingSummary.symbolFromDeviceDefault,
    componentsWithFootprint: components.filter(
      (item) => item.footprintId !== undefined
    ).length,
    componentsWithFootprintFromComponentOverride:
      componentBindingSummary.footprintFromComponentOverride,
    componentsWithFootprintFromDeviceDefault:
      componentBindingSummary.footprintFromDeviceDefault,
    symbols: symbols.length,
    symbolParts: symbolParts.length,
    symbolTexts: symbolTexts.length,
    symbolTextsWithExplicitText: symbolTexts.filter(
      (item) => item.contentState === "EXPLICIT_TEXT"
    ).length,
    symbolTextsWithExplicitEmpty: symbolTexts.filter(
      (item) => item.contentState === "EXPLICIT_EMPTY"
    ).length,
    symbolTextsResolvedExact: symbolTexts.filter(
      (item) => item.partBinding.state === "RESOLVED_EXACT"
    ).length,
    symbolTextsWithExplicitEmptyPart: symbolTexts.filter(
      (item) => item.partBinding.state === "EXPLICIT_EMPTY"
    ).length,
    symbolTextsWithPartNotFound: symbolTexts.filter(
      (item) => item.partBinding.state === "PART_NOT_FOUND"
    ).length,
    symbolPins: symbolPins.length,
    symbolPinsWithNumber: symbolPins.filter((item) => item.number !== undefined).length,
    symbolPinsHidden: symbolPins.filter((item) => item.display === false).length,
    devices: devices.length,
    wires: wires.length,
    wiresWithExplicitNet: wires.filter((item) => item.explicitNetName !== undefined).length,
    wireSegments: wires.reduce((total, wire) => total + wire.segments.length, 0),
    buses: buses.length,
    busesWithExplicitNet: buses.filter(
      (item) => item.explicitNetName !== undefined
    ).length,
    busesWithEmptyEntrySet: buses.filter(
      (item) => item.entryIds.length === 0
    ).length,
    busSegments: buses.reduce(
      (total, bus) => total + bus.segments.length,
      0
    ),
    busEntries: busEntries.length,
    busEntriesEmbedded: busEntries.filter(
      (item) => item.encoding === "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM"
    ).length,
    busEntriesSeparate: busEntries.filter(
      (item) => item.encoding === "OFFICIAL_SEPARATE_BUSENTRY_RECORD"
    ).length,
    busEntriesUnbound: busEntries.filter(
      (item) => item.busId === undefined
    ).length,
    pinInstances: pinSummary.pinInstances,
    pinInstancesWithUniqueExplicitNetCandidate:
      pinSummary.uniqueExplicitNetCandidates,
    pinInstancesWithConflictingExplicitNetCandidates:
      pinSummary.conflictingExplicitNetCandidates,
    pinInstancesOnUnlabeledWire: pinSummary.pinsOnUnlabeledWire,
    pinInstancesWithDeclaredNoConnect: pinSummary.pinsWithDeclaredNoConnect,
    pinInstancesWithDeclaredNoConnectAndWireContact:
      pinSummary.pinsWithDeclaredNoConnectAndWireContact,
    pinInstancesWithNoConnectDeclarationConflict:
      pinSummary.pinsWithNoConnectDeclarationConflict,
    pinInstancesWithInvalidNoConnectDeclaration:
      pinSummary.pinsWithInvalidNoConnectDeclaration,
    pinInstancesWithoutWire: pinSummary.pinsWithoutWire,
    pinInstancesByEndpointKind: pinSummary.endpointKinds,
    shortRelations: shortSummary.shortSymbolComponents,
    shortRelationsReadyExplicitNetPairCandidate:
      shortSummary.readyExplicitNetPairCandidates,
    shortRelationsSameExplicitNetCandidate:
      shortSummary.sameExplicitNetCandidates,
    shortRelationsUnresolvedPinConnectionCandidate:
      shortSummary.unresolvedPinConnectionCandidates,
    shortRelationsConflictingPinConnectionCandidate:
      shortSummary.conflictingPinConnectionCandidates,
    shortRelationsInvalidPinCount: shortSummary.invalidShortPinCounts,
    networkEndpointCandidates: endpointSummary.endpointComponents,
    networkEndpointCandidatesMatching: endpointSummary.matching,
    networkEndpointCandidatesMismatching: endpointSummary.mismatching,
    networkEndpointCandidatesMissingDeclaration:
      endpointSummary.missingDeclaration,
    networkEndpointCandidatesConflictingDeclaration:
      endpointSummary.conflictingDeclaration,
    networkEndpointCandidatesInvalidDeclarationValue:
      endpointSummary.invalidDeclarationValue,
    networkEndpointCandidatesUnresolvedConnection:
      endpointSummary.unresolvedConnection,
    networkEndpointCandidatesInvalidPinCount: endpointSummary.invalidPinCount,
    unboundAttributes: unboundAttributes.length,
    unmodeledRecords: unmodeledRecords.length
  };
  const base = {
    schema: "schemcp.eda-ir" as const,
    schemaVersion: "1.1.0" as const,
    generator: {
      name: "@yuanzihao/schemcp" as const,
      version: "0.1.0" as const
    },
    source: {
      format: "EASYEDA_V3_LOG" as const,
      archiveSha256,
      reducedStateSha256: reducer.summarize().stateSha256,
      electricalTruth: "NOT_VERIFIED" as const
    },
    documents: sortById(documents),
    projectConfigurations,
    boards,
    schematics,
    schematicPages,
    schematicAnnotations,
    schematicGraphicPrimitives,
    schematicTables,
    variants,
    componentGroups,
    instanceContexts,
    componentOccurrences,
    components,
    symbols,
    symbolParts,
    symbolTexts,
    symbolPins,
    devices,
    wires,
    buses,
    busEntries,
    pinInstances,
    shortRelations,
    networkEndpointCandidates,
    unboundAttributes,
    unmodeledRecords,
    diagnostics: diagnosticsResult(state.diagnostics),
    summary
  };
  return {
    ...base,
    irSha256: sha256CanonicalJson(base)
  };
}
