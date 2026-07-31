import { createHash } from "node:crypto";
import { canonicalJson } from "../core/canonical-json.js";
import type {
  EdaIr,
  IrAttribute,
  IrBoard,
  IrComponent,
  IrComponentGroup,
  IrComponentLibraryBinding,
  IrDiagnostic,
  IrInstanceAttributeOverride,
  IrInstanceContext,
  IrNetworkEndpointCandidate,
  IrNetworkEndpointCandidateKind,
  IrNetworkEndpointCandidateStatus,
  IrPinConnectionCandidate,
  IrPinEndpointKind,
  IrPinInstance,
  IrPinNoConnectDeclaration,
  IrProjectConfiguration,
  IrRecordProvenance,
  IrSchematic,
  IrSchematicAnnotation,
  IrSchematicGraphicDocumentType,
  IrSchematicGraphicKind,
  IrSchematicGraphicPartBindingState,
  IrSchematicGraphicPrimitive,
  IrSchematicPage,
  IrSchematicTable,
  IrSchematicTableCell,
  IrSchematicTableCellRepresentation,
  IrSchematicTableDocumentType,
  IrSchematicTablePartBindingState,
  IrShortRelationCandidate,
  IrShortRelationCandidateStatus,
  IrSymbolText,
  IrSymbolTextPartBindingState,
  IrVariant,
  JsonObject,
  JsonValue
} from "../ir/model.js";
import {
  compileCandidateNetlistTuples,
  type CandidateNetlistTuple,
  type CandidateTupleCompilation,
  type CandidateTupleExclusion,
  type CandidateTupleExclusionReason
} from "../validation/netlist-tuples.js";
import {
  buildDesignatedComponentIdentityInventory,
  type PartIdentityMethod,
  type UnresolvedComponentInventorySummary,
  type UnresolvedComponentReason,
  type UnresolvedComponentSummary
} from "./unresolved-components.js";
import {
  buildPartMasterInventory,
  type PartMasterInventorySummary,
  type PartMasterRecord,
  type PartMasterSummary,
  type ResolvedPartIdentityMethod
} from "./part-masters.js";

export const QUERY_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: 50,
  maxTextLength: 128
} as const;

export type QueryErrorCode =
  | "QUERY_INVALID_CURSOR"
  | "QUERY_INVALID_LIMIT"
  | "QUERY_INVALID_TEXT";

export class QueryError extends Error {
  public readonly code: QueryErrorCode;

  public constructor(code: QueryErrorCode, message: string) {
    super(message);
    this.name = "QueryError";
    this.code = code;
  }
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly nextCursor?: string;
}

export interface ComponentSummary {
  readonly id: string;
  readonly pageId: string;
  readonly partId: string;
  readonly designator?: string;
  readonly deviceId?: string;
  readonly symbolId?: string;
  readonly footprintId?: string;
  readonly symbolBinding: IrComponentLibraryBinding;
  readonly footprintBinding: IrComponentLibraryBinding;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
  readonly mirrored: boolean;
  readonly deviceTitle?: string;
  readonly symbolTitle?: string;
  readonly identity?: {
    readonly method: PartIdentityMethod;
    readonly lcscPartId?: string;
    readonly manufacturer?: string;
    readonly manufacturerPart?: string;
    readonly unresolvedReasons: readonly UnresolvedComponentReason[];
  };
  readonly datasheetLinkCount: number;
}

export interface ComponentAttributeSummary {
  readonly key: string;
  readonly values: readonly JsonValue[];
  readonly resolution:
    | "COMPONENT_EXPLICIT"
    | "COMPONENT_CONFLICT"
    | "DEVICE_DEFAULT";
  readonly provenance: readonly IrRecordProvenance[];
}

export interface ComponentEngineeringLinkSummary {
  readonly kind: "DATASHEET";
  readonly url: string;
  readonly source:
    | "COMPONENT_EXPLICIT_ATTRIBUTE"
    | "DEVICE_DEFAULT_ATTRIBUTE";
  readonly sourceAuthenticity: "PROJECT_ATTRIBUTE_NOT_VERIFIED";
}

export interface SchematicAnnotationSummary {
  readonly id: string;
  readonly pageId: string;
  readonly text: string;
  readonly contentState: "EXPLICIT_TEXT" | "EXPLICIT_EMPTY";
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
  readonly coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED";
  readonly basis: "EXPLICIT_SCHEMATIC_TEXT_FIELDS";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly semanticInterpretation: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_APPLICABLE";
  readonly provenance: IrRecordProvenance;
}

export interface SchematicGraphicPrimitiveSummary {
  readonly id: string;
  readonly documentId: string;
  readonly documentType: IrSchematicGraphicDocumentType;
  readonly kind: IrSchematicGraphicKind;
  readonly partId?: string;
  readonly partBinding: IrSchematicGraphicPrimitive["partBinding"];
  readonly locked: boolean;
  readonly zIndex: number;
  readonly geometry: IrSchematicGraphicPrimitive["geometry"];
  readonly style: IrSchematicGraphicPrimitive["style"];
  readonly coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED";
  readonly geometryValidation: "FINITE_FIELDS_AND_POINT_ENCODING_VALIDATED";
  readonly basis: "EXPLICIT_SCHEMATIC_SHAPE_FIELDS";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly semanticInterpretation: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_APPLICABLE";
  readonly provenance: IrRecordProvenance;
}

export interface SchematicTableSummary {
  readonly id: string;
  readonly documentId: string;
  readonly documentType: IrSchematicTableDocumentType;
  readonly partId?: string;
  readonly partBinding: IrSchematicTable["partBinding"];
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly rowSizes: readonly number[];
  readonly columnSizes: readonly number[];
  readonly rowLocked: readonly boolean[];
  readonly columnLocked: readonly boolean[];
  readonly lockEncoding: IrSchematicTable["lockEncoding"];
  readonly rotation: number;
  readonly cellCount: number;
  readonly explicitTextCellCount: number;
  readonly explicitEmptyCellCount: number;
  readonly coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED";
  readonly layoutValidation: "INDEX_AND_SPAN_BOUNDS_VALIDATED";
  readonly basis: "EXPLICIT_SCHEMATIC_TABLE_AND_CELL_FIELDS";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly semanticInterpretation: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_APPLICABLE";
  readonly provenance: IrRecordProvenance;
}

export interface SchematicTableCellSummary {
  readonly id: string;
  readonly value: string;
  readonly contentState: "EXPLICIT_TEXT" | "EXPLICIT_EMPTY";
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly rowSpan: number;
  readonly columnSpan: number;
  readonly representation: IrSchematicTableCellRepresentation;
  readonly semanticInterpretation: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_APPLICABLE";
  readonly provenance: readonly IrRecordProvenance[];
}

export type SchematicTableDetailLookup =
  | {
      readonly status: "FOUND";
      readonly table: SchematicTableSummary;
      readonly cells: Page<SchematicTableCellSummary>;
    }
  | {
      readonly status: "NOT_FOUND";
    };

export interface SymbolTextSummary {
  readonly id: string;
  readonly symbolId: string;
  readonly partId?: string;
  readonly partBinding: {
    readonly state: IrSymbolTextPartBindingState;
    readonly targetId?: string;
  };
  readonly text: string;
  readonly contentState: "EXPLICIT_TEXT" | "EXPLICIT_EMPTY";
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
  readonly coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED";
  readonly basis: "EXPLICIT_SYMBOL_TEXT_FIELDS";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly semanticInterpretation: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_APPLICABLE";
  readonly provenance: IrRecordProvenance;
}

export interface ComponentPinSummary {
  readonly id: string;
  readonly symbolPinId: string;
  readonly symbolId: string;
  readonly partId: string;
  readonly endpointKind: IrPinEndpointKind;
  readonly symbolType?: number;
  readonly name?: string;
  readonly number?: string;
  readonly electricalType?: string | number;
  readonly pinShape?: string | number;
  readonly instanceAttributes: readonly IrAttribute[];
  readonly noConnectDeclaration?: IrPinNoConnectDeclaration;
  readonly connectionPoint: {
    readonly x: number;
    readonly y: number;
  };
  readonly connectionCandidate: IrPinConnectionCandidate;
}

export interface VariantSummary {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly schematicId?: string;
  readonly sortOrder?: number;
  readonly hasUngroupedComponents?: boolean;
  readonly provenance: IrRecordProvenance;
}

export interface VariantGroupSummary {
  readonly id: string;
  readonly title?: string;
  readonly parentGroupId?: string;
  readonly directVariantId?: string;
  readonly schematicId?: string;
  readonly sortOrder?: number;
  readonly variantSortOrder?: number;
  readonly membershipBasis: readonly (
    | "DIRECT_VARIANT_BELONG"
    | "GROUP_INDEX"
  )[];
  readonly overrideCount: number;
  readonly provenance: IrRecordProvenance;
}

export interface VariantOverrideSummary {
  readonly groupId: string;
  readonly groupTitle?: string;
  readonly targetPrimitiveId: string;
  readonly instancePageId: string;
  readonly attributes: JsonObject;
  readonly instanceContextMatch:
    | "MATCHED_EXPLICIT_INSTANCE_DOCUMENT_ID"
    | "INSTANCE_DOCUMENT_NOT_FOUND";
  readonly applicationStatus: "NOT_APPLIED_TARGET_RESOLUTION_UNVERIFIED";
  readonly basis: "COMPONENT_GROUP_GROUP_DATA";
  readonly provenance: IrRecordProvenance;
}

export interface InstanceContextSummary {
  readonly id: string;
  readonly schematicId: string;
  readonly blockPath: readonly {
    readonly sheetNumber: string;
    readonly blockSymbolId: string;
  }[];
  readonly terminalSheetNumber: string;
  readonly overrideCount: number;
  readonly pathBasis: "EXPLICIT_INSTANCE_DOCUMENT_UUID";
  readonly sheetResolution: "NOT_VERIFIED";
}

export interface InstanceAttributeOverrideSummary {
  readonly targetPrimitiveId: string;
  readonly attributes: JsonObject;
  readonly applicationStatus: "NOT_APPLIED_TARGET_RESOLUTION_UNVERIFIED";
  readonly provenance: IrRecordProvenance;
}

export type InstanceContextLookup =
  | {
      readonly status: "FOUND";
      readonly context: InstanceContextSummary;
      readonly overrides: Page<InstanceAttributeOverrideSummary>;
      readonly targetResolution: "NOT_VERIFIED";
    }
  | {
      readonly status: "NOT_FOUND";
    };

export interface ExplicitNetSummary {
  readonly name: string;
  readonly wireCount: number;
  readonly segmentCount: number;
  readonly pageIds: readonly string[];
  readonly connectionStatus: "EXPLICIT_WIRE_LABEL_ONLY";
}

export type DesignHierarchyNodeKind =
  | "PROJECT_CONFIGURATION"
  | "BOARD"
  | "SCHEMATIC"
  | "SHEET";

export interface DesignHierarchyNode {
  readonly kind: DesignHierarchyNodeKind;
  readonly id: string;
  readonly parentId?: string;
  readonly title?: string;
  readonly sortOrder?: number;
  readonly relationshipBasis:
    | "PROJECT_ARCHIVE_MEMBERSHIP"
    | "EXPLICIT_BOARD_REFERENCE"
    | "EXPLICIT_SCHEMATIC_REFERENCE";
  readonly provenance: IrRecordProvenance;
}

export interface ComponentLookupFound {
  readonly status: "FOUND";
  readonly component: ComponentSummary;
  readonly attributes: readonly ComponentAttributeSummary[];
  readonly engineeringLinks: readonly ComponentEngineeringLinkSummary[];
  readonly catalogReference:
    | {
        readonly status: "LINK_DERIVED_FROM_EXPLICIT_LCSC_ID";
        readonly url: string;
        readonly catalogMatch: "NOT_PERFORMED";
      }
    | {
        readonly status: "NOT_AVAILABLE";
      };
}

export interface ComponentLookupNotFound {
  readonly status: "NOT_FOUND";
}

export interface ComponentLookupAmbiguous {
  readonly status: "AMBIGUOUS";
  readonly total: number;
  readonly candidates: readonly ComponentSummary[];
}

export type PartMasterLookup =
  | {
      readonly status: "FOUND";
      readonly partMaster: PartMasterSummary;
      readonly components: Page<UnresolvedComponentSummary>;
    }
  | {
      readonly status: "NOT_FOUND";
    };

export type ComponentLookup =
  | ComponentLookupFound
  | ComponentLookupNotFound
  | ComponentLookupAmbiguous;

export type VariantLookup =
  | {
      readonly status: "FOUND";
      readonly variant: VariantSummary;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly total: number;
      readonly candidates: readonly VariantSummary[];
    };

export type VariantDetailLookup =
  | Exclude<VariantLookup, { readonly status: "FOUND" }>
  | {
      readonly status: "FOUND";
      readonly variant: VariantSummary;
      readonly groups: Page<VariantGroupSummary>;
      readonly overrideSemantics: "EXPLICIT_GROUP_DATA_NOT_APPLIED";
    };

export type VariantOverrideLookup =
  | Exclude<VariantLookup, { readonly status: "FOUND" }>
  | {
      readonly status: "FOUND";
      readonly variant: VariantSummary;
      readonly overrides: Page<VariantOverrideSummary>;
      readonly applicationTruth: "TARGET_RESOLUTION_NOT_VERIFIED";
    };

export interface Evidence {
  readonly objectType:
    | "component"
    | "symbolPin"
    | "wire"
    | "variant"
    | "componentGroup"
    | "schematicAnnotation"
    | "schematicGraphicPrimitive"
    | "schematicTable"
    | "symbolText";
  readonly objectId: string;
  readonly provenance: IrRecordProvenance;
}

export type EvidenceLookup =
  | {
      readonly status: "FOUND";
      readonly evidence: Evidence;
    }
  | {
      readonly status: "NOT_FOUND";
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly total: number;
      readonly candidates: readonly Evidence[];
    };

interface CursorPayload {
  readonly version: 1;
  readonly scope: string;
  readonly offset: number;
}

interface ComponentListOptions {
  readonly pageId?: string | undefined;
  readonly designatorContains?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface SchematicAnnotationListOptions {
  readonly pageId?: string | undefined;
  readonly textContains?: string | undefined;
  readonly contentState?: "EXPLICIT_TEXT" | "EXPLICIT_EMPTY" | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface SchematicGraphicPrimitiveListOptions {
  readonly documentType?: IrSchematicGraphicDocumentType | undefined;
  readonly documentId?: string | undefined;
  readonly kind?: IrSchematicGraphicKind | undefined;
  readonly partId?: string | undefined;
  readonly partBindingState?: IrSchematicGraphicPartBindingState | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface SchematicTableListOptions {
  readonly documentType?: IrSchematicTableDocumentType | undefined;
  readonly documentId?: string | undefined;
  readonly partBindingState?: IrSchematicTablePartBindingState | undefined;
  readonly cellTextContains?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface SchematicTableDetailOptions {
  readonly documentId: string;
  readonly tableId: string;
  readonly cellContentState?:
    | "EXPLICIT_TEXT"
    | "EXPLICIT_EMPTY"
    | undefined;
  readonly cellRepresentation?:
    | IrSchematicTableCellRepresentation
    | undefined;
  readonly cellTextContains?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface SymbolTextListOptions {
  readonly symbolId?: string | undefined;
  readonly partId?: string | undefined;
  readonly textContains?: string | undefined;
  readonly contentState?: "EXPLICIT_TEXT" | "EXPLICIT_EMPTY" | undefined;
  readonly partBindingState?: IrSymbolTextPartBindingState | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface UnresolvedComponentListOptions {
  readonly pageId?: string | undefined;
  readonly designatorContains?: string | undefined;
  readonly identityMethod?: PartIdentityMethod | undefined;
  readonly reason?: UnresolvedComponentReason | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface PartMasterListOptions {
  readonly identityMethod?: ResolvedPartIdentityMethod | undefined;
  readonly lcscPartId?: string | undefined;
  readonly manufacturer?: string | undefined;
  readonly manufacturerPart?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface PartMasterDetailOptions {
  readonly partMasterId: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface ExplicitNetListOptions {
  readonly nameContains?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface DiagnosticListOptions {
  readonly severity?: "warning" | "error" | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface ShortRelationListOptions {
  readonly pageId?: string | undefined;
  readonly status?: IrShortRelationCandidateStatus | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface NetworkEndpointListOptions {
  readonly pageId?: string | undefined;
  readonly endpointKind?: IrNetworkEndpointCandidateKind | undefined;
  readonly status?: IrNetworkEndpointCandidateStatus | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface CandidateNetlistTupleListOptions {
  readonly componentRef?: string | undefined;
  readonly pinNumber?: string | undefined;
  readonly netName?: string | undefined;
  readonly pageId?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface CandidateTupleExclusionListOptions {
  readonly pageId?: string | undefined;
  readonly componentId?: string | undefined;
  readonly reason?: CandidateTupleExclusionReason | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface DesignHierarchyListOptions {
  readonly kind?: DesignHierarchyNodeKind | undefined;
  readonly parentId?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface InstanceContextListOptions {
  readonly schematicId?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface InstanceContextDetailOptions {
  readonly contextId: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface VariantSelector {
  readonly variantId?: string | undefined;
  readonly title?: string | undefined;
}

interface VariantPageOptions extends VariantSelector {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

interface VariantOverrideListOptions extends VariantPageOptions {
  readonly groupId?: string | undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function componentAttributes(
  component: IrComponent,
  device: EdaIr["devices"][number] | undefined
): readonly ComponentAttributeSummary[] {
  const componentByKey = new Map<string, IrAttribute[]>();
  for (const attribute of component.attributes) {
    const existing = componentByKey.get(attribute.key);
    if (existing === undefined) componentByKey.set(attribute.key, [attribute]);
    else existing.push(attribute);
  }
  const keys = new Set([
    ...componentByKey.keys(),
    ...Object.keys(device?.attributes ?? {})
  ]);
  return [...keys].sort(compareText).map((key) => {
    const explicit = componentByKey.get(key);
    if (explicit !== undefined) {
      const values = [
        ...new Map(
          explicit.map((attribute) => [
            canonicalJson(attribute.value),
            attribute.value
          ])
        ).values()
      ];
      return {
        key,
        values,
        resolution:
          values.length === 1
            ? ("COMPONENT_EXPLICIT" as const)
            : ("COMPONENT_CONFLICT" as const),
        provenance: explicit.map((attribute) => attribute.provenance)
      };
    }
    const value = device?.attributes[key];
    if (value === undefined || device === undefined) {
      throw new QueryError(
        "QUERY_INVALID_TEXT",
        "组件属性索引内部断链。"
      );
    }
    return {
      key,
      values: [value],
      resolution: "DEVICE_DEFAULT" as const,
      provenance: [device.provenance]
    };
  });
}

function safeEngineeringUrl(value: JsonValue): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    value !== value.trim()
  ) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hostname !== ""
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function componentEngineeringLinks(
  attributes: readonly ComponentAttributeSummary[]
): readonly ComponentEngineeringLinkSummary[] {
  return attributes
    .filter(
      (attribute) =>
        attribute.key.toLocaleLowerCase("en-US") === "datasheet"
    )
    .flatMap((attribute) =>
      attribute.values.flatMap((value) => {
        const url = safeEngineeringUrl(value);
        return url === undefined
          ? []
          : [
              {
                kind: "DATASHEET" as const,
                url,
                source:
                  attribute.resolution === "DEVICE_DEFAULT"
                    ? ("DEVICE_DEFAULT_ATTRIBUTE" as const)
                    : ("COMPONENT_EXPLICIT_ATTRIBUTE" as const),
                sourceAuthenticity:
                  "PROJECT_ATTRIBUTE_NOT_VERIFIED" as const
              }
            ];
      })
    );
}

function summarizeComponent(
  component: IrComponent,
  ir: EdaIr,
  identities: ReadonlyMap<string, UnresolvedComponentSummary>
): ComponentSummary {
  const identity = identities.get(`${component.pageId}\n${component.id}`);
  const device =
    component.deviceId === undefined
      ? undefined
      : ir.devices.find((item) => item.id === component.deviceId);
  const symbol =
    component.symbolId === undefined
      ? undefined
      : ir.symbols.find((item) => item.id === component.symbolId);
  const attributes = componentAttributes(component, device);
  return {
    id: component.id,
    pageId: component.pageId,
    partId: component.partId,
    ...(component.designator === undefined ? {} : { designator: component.designator }),
    ...(component.deviceId === undefined ? {} : { deviceId: component.deviceId }),
    ...(component.symbolId === undefined ? {} : { symbolId: component.symbolId }),
    ...(component.footprintId === undefined
      ? {}
      : { footprintId: component.footprintId }),
    symbolBinding: component.symbolBinding,
    footprintBinding: component.footprintBinding,
    position: component.position,
    rotation: component.rotation,
    mirrored: component.mirrored,
    ...(device?.title === undefined
      ? {}
      : { deviceTitle: device.title }),
    ...(symbol?.title === undefined
      ? {}
      : { symbolTitle: symbol.title }),
    ...(identity === undefined
      ? {}
      : {
          identity: {
            method: identity.identity.method,
            ...(identity.identity.lcscPartId === undefined
              ? {}
              : { lcscPartId: identity.identity.lcscPartId }),
            ...(identity.identity.manufacturer === undefined
              ? {}
              : { manufacturer: identity.identity.manufacturer }),
            ...(identity.identity.manufacturerPart === undefined
              ? {}
              : {
                  manufacturerPart:
                    identity.identity.manufacturerPart
                }),
            unresolvedReasons: identity.reasons
          }
        }),
    datasheetLinkCount: componentEngineeringLinks(attributes).length
  };
}

function summarizeSchematicAnnotation(
  annotation: IrSchematicAnnotation
): SchematicAnnotationSummary {
  return {
    id: annotation.id,
    pageId: annotation.pageId,
    text: annotation.text,
    contentState: annotation.contentState,
    position: annotation.position,
    rotation: annotation.rotation,
    coordinateSemantics: annotation.coordinateSemantics,
    basis: annotation.basis,
    sourceAuthenticity: annotation.sourceAuthenticity,
    semanticInterpretation: annotation.semanticInterpretation,
    electricalTruth: annotation.electricalTruth,
    provenance: annotation.provenance
  };
}

function summarizeSchematicGraphicPrimitive(
  primitive: IrSchematicGraphicPrimitive
): SchematicGraphicPrimitiveSummary {
  return {
    id: primitive.id,
    documentId: primitive.documentId,
    documentType: primitive.documentType,
    kind: primitive.kind,
    ...(primitive.partId === undefined ? {} : { partId: primitive.partId }),
    partBinding: primitive.partBinding,
    locked: primitive.locked,
    zIndex: primitive.zIndex,
    geometry: primitive.geometry,
    style: primitive.style,
    coordinateSemantics: primitive.coordinateSemantics,
    geometryValidation: primitive.geometryValidation,
    basis: primitive.basis,
    sourceAuthenticity: primitive.sourceAuthenticity,
    semanticInterpretation: primitive.semanticInterpretation,
    electricalTruth: primitive.electricalTruth,
    provenance: primitive.provenance
  };
}

function summarizeSchematicTable(
  table: IrSchematicTable
): SchematicTableSummary {
  return {
    id: table.id,
    documentId: table.documentId,
    documentType: table.documentType,
    ...(table.partId === undefined ? {} : { partId: table.partId }),
    partBinding: table.partBinding,
    position: table.position,
    rowSizes: table.rowSizes,
    columnSizes: table.columnSizes,
    rowLocked: table.rowLocked,
    columnLocked: table.columnLocked,
    lockEncoding: table.lockEncoding,
    rotation: table.rotation,
    cellCount: table.cells.length,
    explicitTextCellCount: table.cells.filter(
      (cell) => cell.contentState === "EXPLICIT_TEXT"
    ).length,
    explicitEmptyCellCount: table.cells.filter(
      (cell) => cell.contentState === "EXPLICIT_EMPTY"
    ).length,
    coordinateSemantics: table.coordinateSemantics,
    layoutValidation: table.layoutValidation,
    basis: table.basis,
    sourceAuthenticity: table.sourceAuthenticity,
    semanticInterpretation: table.semanticInterpretation,
    electricalTruth: table.electricalTruth,
    provenance: table.provenance
  };
}

function summarizeSchematicTableCell(
  cell: IrSchematicTableCell
): SchematicTableCellSummary {
  return {
    id: cell.id,
    value: cell.value,
    contentState: cell.contentState,
    rowIndex: cell.rowIndex,
    columnIndex: cell.columnIndex,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    representation: cell.representation,
    semanticInterpretation: cell.semanticInterpretation,
    electricalTruth: cell.electricalTruth,
    provenance: cell.provenance
  };
}

function summarizeSymbolText(item: IrSymbolText): SymbolTextSummary {
  return {
    id: item.id,
    symbolId: item.symbolId,
    ...(item.partId === undefined ? {} : { partId: item.partId }),
    partBinding: item.partBinding,
    text: item.text,
    contentState: item.contentState,
    position: item.position,
    rotation: item.rotation,
    coordinateSemantics: item.coordinateSemantics,
    basis: item.basis,
    sourceAuthenticity: item.sourceAuthenticity,
    semanticInterpretation: item.semanticInterpretation,
    electricalTruth: item.electricalTruth,
    provenance: item.provenance
  };
}

function summarizePin(pin: IrPinInstance): ComponentPinSummary {
  return {
    id: pin.id,
    symbolPinId: pin.symbolPinId,
    symbolId: pin.symbolId,
    partId: pin.partId,
    endpointKind: pin.endpointKind,
    ...(pin.symbolType === undefined ? {} : { symbolType: pin.symbolType }),
    ...(pin.name === undefined ? {} : { name: pin.name }),
    ...(pin.number === undefined ? {} : { number: pin.number }),
    ...(pin.electricalType === undefined
      ? {}
      : { electricalType: pin.electricalType }),
    ...(pin.pinShape === undefined ? {} : { pinShape: pin.pinShape }),
    instanceAttributes: pin.instanceAttributes,
    ...(pin.noConnectDeclaration === undefined
      ? {}
      : { noConnectDeclaration: pin.noConnectDeclaration }),
    connectionPoint: pin.connectionPoint,
    connectionCandidate: pin.connectionCandidate
  };
}

function summarizeVariant(variant: IrVariant): VariantSummary {
  return {
    id: variant.id,
    ...(variant.title === undefined ? {} : { title: variant.title }),
    ...(variant.description === undefined
      ? {}
      : { description: variant.description }),
    ...(variant.schematicId === undefined
      ? {}
      : { schematicId: variant.schematicId }),
    ...(variant.sortOrder === undefined
      ? {}
      : { sortOrder: variant.sortOrder }),
    ...(variant.hasUngroupedComponents === undefined
      ? {}
      : { hasUngroupedComponents: variant.hasUngroupedComponents }),
    provenance: variant.provenance
  };
}

function summarizeVariantGroup(
  group: IrComponentGroup,
  variantId: string
): VariantGroupSummary {
  const variantIndex = group.variantIndexes.find(
    (index) => index.variantId === variantId
  );
  const membershipBasis = [
    ...(group.directVariantId === variantId
      ? (["DIRECT_VARIANT_BELONG"] as const)
      : []),
    ...(variantIndex === undefined ? [] : (["GROUP_INDEX"] as const))
  ];
  return {
    id: group.id,
    ...(group.title === undefined ? {} : { title: group.title }),
    ...(group.parentGroupId === undefined
      ? {}
      : { parentGroupId: group.parentGroupId }),
    ...(group.directVariantId === undefined
      ? {}
      : { directVariantId: group.directVariantId }),
    ...(group.schematicId === undefined
      ? {}
      : { schematicId: group.schematicId }),
    ...(group.sortOrder === undefined ? {} : { sortOrder: group.sortOrder }),
    ...(variantIndex === undefined
      ? {}
      : { variantSortOrder: variantIndex.sortOrder }),
    membershipBasis,
    overrideCount: group.overrides.length,
    provenance: group.provenance
  };
}

function summarizeInstanceContext(
  context: IrInstanceContext
): InstanceContextSummary {
  return {
    id: context.id,
    schematicId: context.schematicId,
    blockPath: context.blockPath,
    terminalSheetNumber: context.terminalSheetNumber,
    overrideCount: context.overrides.length,
    pathBasis: "EXPLICIT_INSTANCE_DOCUMENT_UUID",
    sheetResolution: "NOT_VERIFIED"
  };
}

function summarizeInstanceOverride(
  override: IrInstanceAttributeOverride
): InstanceAttributeOverrideSummary {
  return {
    targetPrimitiveId: override.targetPrimitiveId,
    attributes: override.attributes,
    applicationStatus: "NOT_APPLIED_TARGET_RESOLUTION_UNVERIFIED",
    provenance: override.provenance
  };
}

function projectConfigurationNode(
  configuration: IrProjectConfiguration
): DesignHierarchyNode {
  return {
    kind: "PROJECT_CONFIGURATION",
    id: configuration.documentId,
    ...(configuration.title === undefined
      ? {}
      : { title: configuration.title }),
    relationshipBasis: "PROJECT_ARCHIVE_MEMBERSHIP",
    provenance: configuration.provenance
  };
}

function boardNode(board: IrBoard): DesignHierarchyNode {
  return {
    kind: "BOARD",
    id: board.id,
    ...(board.title === undefined ? {} : { title: board.title }),
    ...(board.sortOrder === undefined ? {} : { sortOrder: board.sortOrder }),
    relationshipBasis: "PROJECT_ARCHIVE_MEMBERSHIP",
    provenance: board.provenance
  };
}

function schematicNode(schematic: IrSchematic): DesignHierarchyNode {
  return {
    kind: "SCHEMATIC",
    id: schematic.id,
    ...(schematic.boardId === undefined
      ? {}
      : { parentId: schematic.boardId }),
    ...(schematic.title === undefined ? {} : { title: schematic.title }),
    ...(schematic.sortOrder === undefined
      ? {}
      : { sortOrder: schematic.sortOrder }),
    relationshipBasis:
      schematic.boardId === undefined
        ? "PROJECT_ARCHIVE_MEMBERSHIP"
        : "EXPLICIT_BOARD_REFERENCE",
    provenance: schematic.provenance
  };
}

function schematicPageNode(page: IrSchematicPage): DesignHierarchyNode {
  return {
    kind: "SHEET",
    id: page.id,
    ...(page.schematicId === undefined
      ? {}
      : { parentId: page.schematicId }),
    ...(page.title === undefined ? {} : { title: page.title }),
    ...(page.sortOrder === undefined ? {} : { sortOrder: page.sortOrder }),
    relationshipBasis:
      page.schematicId === undefined
        ? "PROJECT_ARCHIVE_MEMBERSHIP"
        : "EXPLICIT_SCHEMATIC_REFERENCE",
    provenance: page.provenance
  };
}

function validateText(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > QUERY_LIMITS.maxTextLength) {
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

function scopeHash(kind: string, filter: Readonly<Record<string, string>>): string {
  const normalized = Object.entries(filter)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha256").update(`${kind}\n${normalized}`).digest("hex").slice(0, 24);
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined, expectedScope: string): number {
  if (cursor === undefined) {
    return 0;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as
      | Partial<CursorPayload>
      | null;
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
      "cursor 无效，或不属于当前工具和筛选条件。"
    );
  }
}

function paginate<T>(
  items: readonly T[],
  limitValue: number | undefined,
  cursor: string | undefined,
  scope: string
): Page<T> {
  const limit = pageSize(limitValue);
  const offset = decodeCursor(cursor, scope);
  if (offset > items.length) {
    throw new QueryError("QUERY_INVALID_CURSOR", "cursor 已超出结果范围。");
  }
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    total: items.length,
    ...(nextOffset < items.length
      ? { nextCursor: encodeCursor({ version: 1, scope, offset: nextOffset }) }
      : {})
  };
}

export class EdaIrQueryIndex {
  private readonly designHierarchy: readonly DesignHierarchyNode[];
  private readonly components: readonly IrComponent[];
  private readonly schematicAnnotations: readonly IrSchematicAnnotation[];
  private readonly schematicGraphicPrimitives:
    readonly IrSchematicGraphicPrimitive[];
  private readonly schematicTables: readonly IrSchematicTable[];
  private readonly schematicTablesByDocumentAndId: ReadonlyMap<
    string,
    IrSchematicTable
  >;
  private readonly symbolTexts: readonly IrSymbolText[];
  private readonly unresolvedComponents: readonly UnresolvedComponentSummary[];
  private readonly componentIdentities: ReadonlyMap<
    string,
    UnresolvedComponentSummary
  >;
  private readonly unresolvedComponentSummary: UnresolvedComponentInventorySummary;
  private readonly partMasters: readonly PartMasterRecord[];
  private readonly partMastersById: ReadonlyMap<string, PartMasterRecord>;
  private readonly partMasterSummary: PartMasterInventorySummary;
  private readonly variants: readonly IrVariant[];
  private readonly componentGroups: readonly IrComponentGroup[];
  private readonly instanceContexts: readonly IrInstanceContext[];
  private readonly instanceContextsById: ReadonlyMap<string, IrInstanceContext>;
  private readonly componentsById: ReadonlyMap<string, readonly IrComponent[]>;
  private readonly componentsByDesignator: ReadonlyMap<string, readonly IrComponent[]>;
  private readonly pinsByComponent: ReadonlyMap<string, readonly IrPinInstance[]>;
  private readonly explicitNets: readonly ExplicitNetSummary[];
  private readonly candidateNetlist: CandidateTupleCompilation;
  private readonly networkEndpointCandidates: readonly IrNetworkEndpointCandidate[];
  private readonly shortRelations: readonly IrShortRelationCandidate[];
  private readonly evidenceByTypeAndId: ReadonlyMap<string, readonly Evidence[]>;

  public constructor(public readonly ir: EdaIr) {
    const kindOrder: Readonly<Record<DesignHierarchyNodeKind, number>> = {
      PROJECT_CONFIGURATION: 0,
      BOARD: 1,
      SCHEMATIC: 2,
      SHEET: 3
    };
    this.designHierarchy = [
      ...ir.projectConfigurations.map(projectConfigurationNode),
      ...ir.boards.map(boardNode),
      ...ir.schematics.map(schematicNode),
      ...ir.schematicPages.map(schematicPageNode)
    ].sort(
      (left, right) =>
        kindOrder[left.kind] - kindOrder[right.kind] ||
        (left.sortOrder ?? Number.POSITIVE_INFINITY) -
          (right.sortOrder ?? Number.POSITIVE_INFINITY) ||
        compareText(left.title ?? "", right.title ?? "") ||
        compareText(left.id, right.id)
    );
    this.components = [...ir.components].sort(
      (left, right) =>
        compareText(left.pageId, right.pageId) ||
        compareText(left.designator ?? "", right.designator ?? "") ||
        compareText(left.id, right.id)
    );
    this.schematicAnnotations = [...ir.schematicAnnotations].sort(
      (left, right) =>
        compareText(left.pageId, right.pageId) ||
        compareText(left.id, right.id)
    );
    this.schematicGraphicPrimitives = [
      ...ir.schematicGraphicPrimitives
    ].sort(
      (left, right) =>
        compareText(left.documentType, right.documentType) ||
        compareText(left.documentId, right.documentId) ||
        compareText(left.partId ?? "", right.partId ?? "") ||
        compareText(left.kind, right.kind) ||
        compareText(left.id, right.id)
    );
    this.schematicTables = [...ir.schematicTables].sort(
      (left, right) =>
        compareText(left.documentType, right.documentType) ||
        compareText(left.documentId, right.documentId) ||
        compareText(left.partId ?? "", right.partId ?? "") ||
        compareText(left.id, right.id)
    );
    this.schematicTablesByDocumentAndId = new Map(
      this.schematicTables.map((table) => [
        `${table.documentId}\n${table.id}`,
        table
      ])
    );
    this.symbolTexts = [...ir.symbolTexts].sort(
      (left, right) =>
        compareText(left.symbolId, right.symbolId) ||
        compareText(left.partId ?? "", right.partId ?? "") ||
        compareText(left.id, right.id)
    );
    const identityInventory = buildDesignatedComponentIdentityInventory(
      this.components,
      ir.devices
    );
    this.componentIdentities = new Map(
      identityInventory.items.map((item) => [
        `${item.pageId}\n${item.id}`,
        item
      ])
    );
    this.unresolvedComponents = identityInventory.items.filter(
      (item) => item.reasons.length > 0
    );
    this.unresolvedComponentSummary = identityInventory.summary;
    const partMasterInventory = buildPartMasterInventory(
      identityInventory.items
    );
    this.partMasters = partMasterInventory.items;
    this.partMastersById = new Map(
      this.partMasters.map((partMaster) => [partMaster.id, partMaster])
    );
    this.partMasterSummary = partMasterInventory.summary;
    this.variants = [...ir.variants].sort(
      (left, right) =>
        (left.sortOrder ?? Number.POSITIVE_INFINITY) -
          (right.sortOrder ?? Number.POSITIVE_INFINITY) ||
        compareText(left.title ?? "", right.title ?? "") ||
        compareText(left.id, right.id)
    );
    this.componentGroups = [...ir.componentGroups].sort(
      (left, right) =>
        (left.sortOrder ?? Number.POSITIVE_INFINITY) -
          (right.sortOrder ?? Number.POSITIVE_INFINITY) ||
        compareText(left.title ?? "", right.title ?? "") ||
        compareText(left.id, right.id)
    );
    this.instanceContexts = [...ir.instanceContexts].sort((left, right) =>
      compareText(left.id, right.id)
    );
    this.instanceContextsById = new Map(
      this.instanceContexts.map((context) => [context.id, context])
    );
    this.componentsById = this.groupComponents((component) => component.id);
    this.componentsByDesignator = this.groupComponents(
      (component) => component.designator
    );
    this.pinsByComponent = this.groupPins();
    this.explicitNets = this.buildExplicitNets();
    this.candidateNetlist = compileCandidateNetlistTuples(ir.pinInstances);
    this.networkEndpointCandidates = [...ir.networkEndpointCandidates].sort(
      (left, right) =>
        compareText(left.pageId, right.pageId) ||
        compareText(left.componentId, right.componentId)
    );
    this.shortRelations = [...ir.shortRelations].sort(
      (left, right) =>
        compareText(left.pageId, right.pageId) ||
        compareText(left.componentId, right.componentId)
    );
    this.evidenceByTypeAndId = this.buildEvidence();
  }

  public listDesignHierarchy(
    options: DesignHierarchyListOptions = {}
  ): Page<DesignHierarchyNode> {
    const parentId = validateText(options.parentId, "parentId");
    const filtered = this.designHierarchy.filter(
      (node) =>
        (options.kind === undefined || node.kind === options.kind) &&
        (parentId === undefined || node.parentId === parentId)
    );
    const scope = scopeHash("design-hierarchy", {
      kind: options.kind ?? "",
      parentId: parentId ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listComponents(options: ComponentListOptions = {}): Page<ComponentSummary> {
    const pageId = validateText(options.pageId, "pageId");
    const designatorContains = validateText(
      options.designatorContains,
      "designatorContains"
    );
    const needle = designatorContains?.toLocaleLowerCase("en-US");
    const filtered = this.components
      .filter((component) => pageId === undefined || component.pageId === pageId)
      .filter(
        (component) =>
          needle === undefined ||
          component.designator?.toLocaleLowerCase("en-US").includes(needle) === true
      )
      .map((component) =>
        summarizeComponent(component, this.ir, this.componentIdentities)
      );
    const scope = scopeHash("components", {
      pageId: pageId ?? "",
      designatorContains: needle ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listSchematicAnnotations(
    options: SchematicAnnotationListOptions = {}
  ): Page<SchematicAnnotationSummary> {
    const pageId = validateText(options.pageId, "pageId");
    const textContains = validateText(options.textContains, "textContains");
    const needle = textContains?.toLocaleLowerCase("en-US");
    const filtered = this.schematicAnnotations
      .filter(
        (annotation) =>
          pageId === undefined || annotation.pageId === pageId
      )
      .filter(
        (annotation) =>
          needle === undefined ||
          annotation.text.toLocaleLowerCase("en-US").includes(needle)
      )
      .filter(
        (annotation) =>
          options.contentState === undefined ||
          annotation.contentState === options.contentState
      )
      .map(summarizeSchematicAnnotation);
    const scope = scopeHash("schematic-annotations", {
      pageId: pageId ?? "",
      textContains: needle ?? "",
      contentState: options.contentState ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listSchematicGraphicPrimitives(
    options: SchematicGraphicPrimitiveListOptions = {}
  ): Page<SchematicGraphicPrimitiveSummary> {
    const documentId = validateText(options.documentId, "documentId");
    const partId = validateText(options.partId, "partId");
    const filtered = this.schematicGraphicPrimitives
      .filter(
        (primitive) =>
          options.documentType === undefined ||
          primitive.documentType === options.documentType
      )
      .filter(
        (primitive) =>
          documentId === undefined || primitive.documentId === documentId
      )
      .filter(
        (primitive) =>
          options.kind === undefined || primitive.kind === options.kind
      )
      .filter(
        (primitive) => partId === undefined || primitive.partId === partId
      )
      .filter(
        (primitive) =>
          options.partBindingState === undefined ||
          primitive.partBinding.state === options.partBindingState
      )
      .map(summarizeSchematicGraphicPrimitive);
    const scope = scopeHash("schematic-graphic-primitives", {
      documentType: options.documentType ?? "",
      documentId: documentId ?? "",
      kind: options.kind ?? "",
      partId: partId ?? "",
      partBindingState: options.partBindingState ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listSchematicTables(
    options: SchematicTableListOptions = {}
  ): Page<SchematicTableSummary> {
    const documentId = validateText(options.documentId, "documentId");
    const cellTextContains = validateText(
      options.cellTextContains,
      "cellTextContains"
    );
    const needle = cellTextContains?.toLocaleLowerCase("en-US");
    const filtered = this.schematicTables
      .filter(
        (table) =>
          options.documentType === undefined ||
          table.documentType === options.documentType
      )
      .filter(
        (table) =>
          documentId === undefined || table.documentId === documentId
      )
      .filter(
        (table) =>
          options.partBindingState === undefined ||
          table.partBinding.state === options.partBindingState
      )
      .filter(
        (table) =>
          needle === undefined ||
          table.cells.some((cell) =>
            cell.value.toLocaleLowerCase("en-US").includes(needle)
          )
      )
      .map(summarizeSchematicTable);
    const scope = scopeHash("schematic-tables", {
      documentType: options.documentType ?? "",
      documentId: documentId ?? "",
      partBindingState: options.partBindingState ?? "",
      cellTextContains: needle ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public getSchematicTable(
    options: SchematicTableDetailOptions
  ): SchematicTableDetailLookup {
    const documentId = validateText(
      options.documentId,
      "documentId"
    ) as string;
    const tableId = validateText(options.tableId, "tableId") as string;
    const table = this.schematicTablesByDocumentAndId.get(
      `${documentId}\n${tableId}`
    );
    if (table === undefined) {
      return { status: "NOT_FOUND" };
    }
    const cellTextContains = validateText(
      options.cellTextContains,
      "cellTextContains"
    );
    const needle = cellTextContains?.toLocaleLowerCase("en-US");
    const cells = table.cells
      .filter(
        (cell) =>
          options.cellContentState === undefined ||
          cell.contentState === options.cellContentState
      )
      .filter(
        (cell) =>
          options.cellRepresentation === undefined ||
          cell.representation === options.cellRepresentation
      )
      .filter(
        (cell) =>
          needle === undefined ||
          cell.value.toLocaleLowerCase("en-US").includes(needle)
      )
      .map(summarizeSchematicTableCell);
    const scope = scopeHash("schematic-table-cells", {
      documentId,
      tableId,
      cellContentState: options.cellContentState ?? "",
      cellRepresentation: options.cellRepresentation ?? "",
      cellTextContains: needle ?? ""
    });
    return {
      status: "FOUND",
      table: summarizeSchematicTable(table),
      cells: paginate(cells, options.limit, options.cursor, scope)
    };
  }

  public listSymbolTexts(
    options: SymbolTextListOptions = {}
  ): Page<SymbolTextSummary> {
    const symbolId = validateText(options.symbolId, "symbolId");
    const partId = validateText(options.partId, "partId");
    const textContains = validateText(options.textContains, "textContains");
    const needle = textContains?.toLocaleLowerCase("en-US");
    const filtered = this.symbolTexts
      .filter(
        (item) => symbolId === undefined || item.symbolId === symbolId
      )
      .filter((item) => partId === undefined || item.partId === partId)
      .filter(
        (item) =>
          needle === undefined ||
          item.text.toLocaleLowerCase("en-US").includes(needle)
      )
      .filter(
        (item) =>
          options.contentState === undefined ||
          item.contentState === options.contentState
      )
      .filter(
        (item) =>
          options.partBindingState === undefined ||
          item.partBinding.state === options.partBindingState
      )
      .map(summarizeSymbolText);
    const scope = scopeHash("symbol-texts", {
      symbolId: symbolId ?? "",
      partId: partId ?? "",
      textContains: needle ?? "",
      contentState: options.contentState ?? "",
      partBindingState: options.partBindingState ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listUnresolvedComponents(
    options: UnresolvedComponentListOptions = {}
  ): Page<UnresolvedComponentSummary> {
    const pageId = validateText(options.pageId, "pageId");
    const designatorContains = validateText(
      options.designatorContains,
      "designatorContains"
    );
    const needle = designatorContains?.toLocaleLowerCase("en-US");
    const filtered = this.unresolvedComponents
      .filter((item) => pageId === undefined || item.pageId === pageId)
      .filter(
        (item) =>
          needle === undefined ||
          item.designator.toLocaleLowerCase("en-US").includes(needle)
      )
      .filter(
        (item) =>
          options.identityMethod === undefined ||
          item.identity.method === options.identityMethod
      )
      .filter(
        (item) =>
          options.reason === undefined ||
          item.reasons.includes(options.reason)
      );
    const scope = scopeHash("unresolved-components", {
      pageId: pageId ?? "",
      designatorContains: needle ?? "",
      identityMethod: options.identityMethod ?? "",
      reason: options.reason ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public getUnresolvedComponentSummary(): UnresolvedComponentInventorySummary {
    return this.unresolvedComponentSummary;
  }

  public listPartMasters(
    options: PartMasterListOptions = {}
  ): Page<PartMasterSummary> {
    const lcscPartId = validateText(options.lcscPartId, "lcscPartId");
    const manufacturer = validateText(options.manufacturer, "manufacturer");
    const manufacturerPart = validateText(
      options.manufacturerPart,
      "manufacturerPart"
    );
    const filtered = this.partMasters
      .filter(
        (partMaster) =>
          options.identityMethod === undefined ||
          partMaster.identity.method === options.identityMethod
      )
      .filter(
        (partMaster) =>
          lcscPartId === undefined ||
          (partMaster.identity.method === "EXACT_LCSC_PART_ID" &&
            partMaster.identity.lcscPartId === lcscPartId)
      )
      .filter(
        (partMaster) =>
          manufacturer === undefined ||
          (partMaster.identity.method ===
            "EXACT_MANUFACTURER_AND_MPN" &&
            partMaster.identity.manufacturer === manufacturer)
      )
      .filter(
        (partMaster) =>
          manufacturerPart === undefined ||
          (partMaster.identity.method ===
            "EXACT_MANUFACTURER_AND_MPN" &&
            partMaster.identity.manufacturerPart === manufacturerPart)
      )
      .map(({ components: _components, ...summary }) => summary);
    const scope = scopeHash("part-masters", {
      identityMethod: options.identityMethod ?? "",
      lcscPartId: lcscPartId ?? "",
      manufacturer: manufacturer ?? "",
      manufacturerPart: manufacturerPart ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public getPartMaster(
    options: PartMasterDetailOptions
  ): PartMasterLookup {
    const partMasterId = validateText(
      options.partMasterId,
      "partMasterId"
    ) as string;
    const record = this.partMastersById.get(partMasterId);
    if (record === undefined) return { status: "NOT_FOUND" };
    const { components, ...partMaster } = record;
    const scope = scopeHash("part-master-components", { partMasterId });
    return {
      status: "FOUND",
      partMaster,
      components: paginate(
        components,
        options.limit,
        options.cursor,
        scope
      )
    };
  }

  public getPartMasterSummary(): PartMasterInventorySummary {
    return this.partMasterSummary;
  }

  public listInstanceContexts(
    options: InstanceContextListOptions = {}
  ): Page<InstanceContextSummary> {
    const schematicId = validateText(options.schematicId, "schematicId");
    const filtered = this.instanceContexts
      .filter(
        (context) =>
          schematicId === undefined || context.schematicId === schematicId
      )
      .map(summarizeInstanceContext);
    const scope = scopeHash("instance-contexts", {
      schematicId: schematicId ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public getInstanceContext(
    options: InstanceContextDetailOptions
  ): InstanceContextLookup {
    const contextId = validateText(options.contextId, "contextId") as string;
    const context = this.instanceContextsById.get(contextId);
    if (context === undefined) {
      return { status: "NOT_FOUND" };
    }
    const scope = scopeHash("instance-context-overrides", { contextId });
    return {
      status: "FOUND",
      context: summarizeInstanceContext(context),
      overrides: paginate(
        context.overrides.map(summarizeInstanceOverride),
        options.limit,
        options.cursor,
        scope
      ),
      targetResolution: "NOT_VERIFIED"
    };
  }

  public getComponent(query: {
    readonly componentId?: string | undefined;
    readonly designator?: string | undefined;
    readonly pageId?: string | undefined;
  }): ComponentLookup {
    const componentId = validateText(query.componentId, "componentId");
    const designator = validateText(query.designator, "designator");
    const pageId = validateText(query.pageId, "pageId");
    if ((componentId === undefined) === (designator === undefined)) {
      throw new QueryError(
        "QUERY_INVALID_TEXT",
        "必须且只能指定 componentId 或 designator 之一。"
      );
    }
    const candidates = [
      ...(componentId === undefined
        ? (this.componentsByDesignator.get(designator as string) ?? [])
        : (this.componentsById.get(componentId) ?? []))
    ].filter((component) => pageId === undefined || component.pageId === pageId);
    if (candidates.length === 0) {
      return { status: "NOT_FOUND" };
    }
    if (candidates.length > 1) {
      return {
        status: "AMBIGUOUS",
        total: candidates.length,
        candidates: candidates
          .slice(0, QUERY_LIMITS.maxPageSize)
          .map((component) =>
            summarizeComponent(
              component,
              this.ir,
              this.componentIdentities
            )
          )
      };
    }
    const selected = candidates[0] as IrComponent;
    const device =
      selected.deviceId === undefined
        ? undefined
        : this.ir.devices.find((item) => item.id === selected.deviceId);
    const attributes = componentAttributes(selected, device);
    const summary = summarizeComponent(
      selected,
      this.ir,
      this.componentIdentities
    );
    return {
      status: "FOUND",
      component: summary,
      attributes,
      engineeringLinks: componentEngineeringLinks(attributes),
      catalogReference:
        summary.identity?.lcscPartId === undefined
          ? { status: "NOT_AVAILABLE" }
          : {
              status: "LINK_DERIVED_FROM_EXPLICIT_LCSC_ID",
              url: `https://www.lcsc.com/product-detail/${summary.identity.lcscPartId}.html`,
              catalogMatch: "NOT_PERFORMED"
            }
    };
  }

  public getVariant(query: VariantPageOptions): VariantDetailLookup {
    const lookup = this.lookupVariant(query);
    if (lookup.status !== "FOUND") return lookup;
    const groups = this.groupsForVariant(lookup.variant.id).map((group) =>
      summarizeVariantGroup(group, lookup.variant.id)
    );
    const scope = scopeHash("variant-groups", {
      variantId: lookup.variant.id
    });
    return {
      status: "FOUND",
      variant: lookup.variant,
      groups: paginate(groups, query.limit, query.cursor, scope),
      overrideSemantics: "EXPLICIT_GROUP_DATA_NOT_APPLIED"
    };
  }

  public listVariantOverrides(
    query: VariantOverrideListOptions
  ): VariantOverrideLookup {
    const lookup = this.lookupVariant(query);
    if (lookup.status !== "FOUND") return lookup;
    const groupId = validateText(query.groupId, "groupId");
    const groups = this.groupsForVariant(lookup.variant.id).filter(
      (group) => groupId === undefined || group.id === groupId
    );
    const overrides = groups
      .flatMap((group) =>
        group.overrides.map(
          (override): VariantOverrideSummary => ({
            groupId: group.id,
            ...(group.title === undefined ? {} : { groupTitle: group.title }),
            targetPrimitiveId: override.targetPrimitiveId,
            instancePageId: override.instancePageId,
            attributes: override.attributes,
            instanceContextMatch: this.instanceContextsById.has(
              override.instancePageId
            )
              ? "MATCHED_EXPLICIT_INSTANCE_DOCUMENT_ID"
              : "INSTANCE_DOCUMENT_NOT_FOUND",
            applicationStatus: "NOT_APPLIED_TARGET_RESOLUTION_UNVERIFIED",
            basis: "COMPONENT_GROUP_GROUP_DATA",
            provenance: override.provenance
          })
        )
      )
      .sort(
        (left, right) =>
          compareText(left.groupId, right.groupId) ||
          compareText(left.instancePageId, right.instancePageId) ||
          compareText(left.targetPrimitiveId, right.targetPrimitiveId)
      );
    const scope = scopeHash("variant-overrides", {
      variantId: lookup.variant.id,
      groupId: groupId ?? ""
    });
    return {
      status: "FOUND",
      variant: lookup.variant,
      overrides: paginate(overrides, query.limit, query.cursor, scope),
      applicationTruth: "TARGET_RESOLUTION_NOT_VERIFIED"
    };
  }

  public getComponentPins(query: {
    readonly componentId?: string | undefined;
    readonly designator?: string | undefined;
    readonly pageId?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): ComponentLookup | {
    readonly status: "FOUND";
    readonly component: ComponentSummary;
    readonly pins: Page<ComponentPinSummary>;
    readonly connectionTruth: "NOT_VERIFIED";
  } {
    const lookup = this.getComponent(query);
    if (lookup.status !== "FOUND") {
      return lookup;
    }
    const component = this.findComponent(lookup.component.id, lookup.component.pageId);
    if (component === undefined) {
      return {
        status: "FOUND",
        component: lookup.component,
        pins: { items: [], total: 0 },
        connectionTruth: "NOT_VERIFIED"
      };
    }
    const pins = (
      this.pinsByComponent.get(`${component.pageId}\n${component.id}`) ?? []
    ).map(summarizePin);
    const scope = scopeHash("component-pins", {
      pageId: component.pageId,
      componentId: component.id
    });
    return {
      status: "FOUND",
      component: lookup.component,
      pins: paginate(pins, query.limit, query.cursor, scope),
      connectionTruth: "NOT_VERIFIED"
    };
  }

  public listExplicitNets(options: ExplicitNetListOptions = {}): Page<ExplicitNetSummary> {
    const nameContains = validateText(options.nameContains, "nameContains");
    const needle = nameContains?.toLocaleLowerCase("en-US");
    const filtered = this.explicitNets.filter(
      (net) =>
        needle === undefined || net.name.toLocaleLowerCase("en-US").includes(needle)
    );
    const scope = scopeHash("explicit-nets", { nameContains: needle ?? "" });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public getCandidateNetlistSummary(): CandidateTupleCompilation["summary"] {
    return this.candidateNetlist.summary;
  }

  public listCandidateNetlistTuples(
    options: CandidateNetlistTupleListOptions = {}
  ): Page<CandidateNetlistTuple> {
    const componentRef = validateText(options.componentRef, "componentRef");
    const pinNumber = validateText(options.pinNumber, "pinNumber");
    const netName = validateText(options.netName, "netName");
    const pageId = validateText(options.pageId, "pageId");
    const filtered = this.candidateNetlist.tuples.filter(
      (candidate) =>
        (componentRef === undefined ||
          candidate.tuple.componentRef === componentRef) &&
        (pinNumber === undefined ||
          candidate.tuple.pinNumber === pinNumber) &&
        (netName === undefined || candidate.tuple.netName === netName) &&
        (pageId === undefined || candidate.evidence.pageId === pageId)
    );
    const scope = scopeHash("candidate-netlist-tuples", {
      componentRef: componentRef ?? "",
      pinNumber: pinNumber ?? "",
      netName: netName ?? "",
      pageId: pageId ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listCandidateNetlistExclusions(
    options: CandidateTupleExclusionListOptions = {}
  ): Page<CandidateTupleExclusion> {
    const pageId = validateText(options.pageId, "pageId");
    const componentId = validateText(options.componentId, "componentId");
    const filtered = this.candidateNetlist.exclusions.filter(
      (candidate) =>
        (pageId === undefined || candidate.pageId === pageId) &&
        (componentId === undefined ||
          candidate.componentId === componentId) &&
        (options.reason === undefined ||
          candidate.reason === options.reason)
    );
    const scope = scopeHash("candidate-netlist-exclusions", {
      pageId: pageId ?? "",
      componentId: componentId ?? "",
      reason: options.reason ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listDiagnostics(options: DiagnosticListOptions = {}): Page<IrDiagnostic> {
    const filtered = this.ir.diagnostics.filter(
      (diagnostic) =>
        options.severity === undefined || diagnostic.severity === options.severity
    );
    const scope = scopeHash("diagnostics", {
      severity: options.severity ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listShortRelations(
    options: ShortRelationListOptions = {}
  ): Page<IrShortRelationCandidate> {
    const pageId = validateText(options.pageId, "pageId");
    const filtered = this.shortRelations.filter(
      (relation) =>
        (pageId === undefined || relation.pageId === pageId) &&
        (options.status === undefined || relation.status === options.status)
    );
    const scope = scopeHash("short-relations", {
      pageId: pageId ?? "",
      status: options.status ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public listNetworkEndpointCandidates(
    options: NetworkEndpointListOptions = {}
  ): Page<IrNetworkEndpointCandidate> {
    const pageId = validateText(options.pageId, "pageId");
    const filtered = this.networkEndpointCandidates.filter(
      (candidate) =>
        (pageId === undefined || candidate.pageId === pageId) &&
        (options.endpointKind === undefined ||
          candidate.endpointKind === options.endpointKind) &&
        (options.status === undefined || candidate.status === options.status)
    );
    const scope = scopeHash("network-endpoint-candidates", {
      pageId: pageId ?? "",
      endpointKind: options.endpointKind ?? "",
      status: options.status ?? ""
    });
    return paginate(filtered, options.limit, options.cursor, scope);
  }

  public getEvidence(
    objectType: Evidence["objectType"],
    objectId: string,
    documentId?: string | undefined
  ): EvidenceLookup {
    const normalizedObjectId = validateText(objectId, "objectId") as string;
    const normalizedDocumentId = validateText(documentId, "documentId");
    const candidates = [
      ...(this.evidenceByTypeAndId.get(`${objectType}\n${normalizedObjectId}`) ?? [])
    ].filter(
      (evidence) =>
        normalizedDocumentId === undefined ||
        evidence.provenance.documentId === normalizedDocumentId
    );
    if (candidates.length === 0) {
      return { status: "NOT_FOUND" };
    }
    if (candidates.length > 1) {
      return {
        status: "AMBIGUOUS",
        total: candidates.length,
        candidates: candidates.slice(0, QUERY_LIMITS.maxPageSize)
      };
    }
    return {
      status: "FOUND",
      evidence: candidates[0] as Evidence
    };
  }

  private groupComponents(
    keyFor: (component: IrComponent) => string | undefined
  ): ReadonlyMap<string, readonly IrComponent[]> {
    const groups = new Map<string, IrComponent[]>();
    for (const component of this.components) {
      const key = keyFor(component);
      if (key !== undefined) {
        const group = groups.get(key) ?? [];
        group.push(component);
        groups.set(key, group);
      }
    }
    return groups;
  }

  private lookupVariant(query: VariantSelector): VariantLookup {
    const variantId = validateText(query.variantId, "variantId");
    const title = validateText(query.title, "title");
    if ((variantId === undefined) === (title === undefined)) {
      throw new QueryError(
        "QUERY_INVALID_TEXT",
        "必须且只能指定 variantId 或 title 之一。"
      );
    }
    const candidates = this.variants.filter((variant) =>
      variantId === undefined
        ? variant.title === title
        : variant.id === variantId
    );
    if (candidates.length === 0) return { status: "NOT_FOUND" };
    if (candidates.length > 1) {
      return {
        status: "AMBIGUOUS",
        total: candidates.length,
        candidates: candidates
          .slice(0, QUERY_LIMITS.maxPageSize)
          .map(summarizeVariant)
      };
    }
    return {
      status: "FOUND",
      variant: summarizeVariant(candidates[0] as IrVariant)
    };
  }

  private groupsForVariant(variantId: string): readonly IrComponentGroup[] {
    return this.componentGroups
      .filter(
        (group) =>
          group.directVariantId === variantId ||
          group.variantIndexes.some((index) => index.variantId === variantId)
      )
      .sort((left, right) => {
        const leftVariantOrder = left.variantIndexes.find(
          (index) => index.variantId === variantId
        )?.sortOrder;
        const rightVariantOrder = right.variantIndexes.find(
          (index) => index.variantId === variantId
        )?.sortOrder;
        return (
          (leftVariantOrder ?? left.sortOrder ?? Number.POSITIVE_INFINITY) -
            (rightVariantOrder ??
              right.sortOrder ??
              Number.POSITIVE_INFINITY) ||
          compareText(left.title ?? "", right.title ?? "") ||
          compareText(left.id, right.id)
        );
      });
  }

  private groupPins(): ReadonlyMap<string, readonly IrPinInstance[]> {
    const groups = new Map<string, IrPinInstance[]>();
    for (const pin of this.ir.pinInstances) {
      const key = `${pin.pageId}\n${pin.componentId}`;
      const group = groups.get(key) ?? [];
      group.push(pin);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.sort(
        (left, right) =>
          compareText(left.number ?? "", right.number ?? "") ||
          compareText(left.name ?? "", right.name ?? "") ||
          compareText(left.symbolPinId, right.symbolPinId)
      );
    }
    return groups;
  }

  private buildExplicitNets(): readonly ExplicitNetSummary[] {
    const groups = new Map<
      string,
      { wireCount: number; segmentCount: number; pageIds: Set<string> }
    >();
    for (const wire of this.ir.wires) {
      if (wire.explicitNetName === undefined) {
        continue;
      }
      const group = groups.get(wire.explicitNetName) ?? {
        wireCount: 0,
        segmentCount: 0,
        pageIds: new Set<string>()
      };
      group.wireCount += 1;
      group.segmentCount += wire.segments.length;
      group.pageIds.add(wire.pageId);
      groups.set(wire.explicitNetName, group);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, group]) => ({
        name,
        wireCount: group.wireCount,
        segmentCount: group.segmentCount,
        pageIds: [...group.pageIds].sort(compareText),
        connectionStatus: "EXPLICIT_WIRE_LABEL_ONLY" as const
      }));
  }

  private buildEvidence(): ReadonlyMap<string, readonly Evidence[]> {
    const evidence = new Map<string, Evidence[]>();
    const add = (item: Evidence): void => {
      const key = `${item.objectType}\n${item.objectId}`;
      const group = evidence.get(key) ?? [];
      group.push(item);
      evidence.set(key, group);
    };
    for (const component of this.ir.components) {
      add({
        objectType: "component",
        objectId: component.id,
        provenance: component.provenance
      });
    }
    for (const annotation of this.schematicAnnotations) {
      add({
        objectType: "schematicAnnotation",
        objectId: annotation.id,
        provenance: annotation.provenance
      });
    }
    for (const primitive of this.schematicGraphicPrimitives) {
      add({
        objectType: "schematicGraphicPrimitive",
        objectId: primitive.id,
        provenance: primitive.provenance
      });
    }
    for (const table of this.schematicTables) {
      add({
        objectType: "schematicTable",
        objectId: table.id,
        provenance: table.provenance
      });
    }
    for (const item of this.symbolTexts) {
      add({
        objectType: "symbolText",
        objectId: item.id,
        provenance: item.provenance
      });
    }
    for (const variant of this.ir.variants) {
      add({
        objectType: "variant",
        objectId: variant.id,
        provenance: variant.provenance
      });
    }
    for (const group of this.ir.componentGroups) {
      add({
        objectType: "componentGroup",
        objectId: group.id,
        provenance: group.provenance
      });
    }
    for (const pin of this.ir.symbolPins) {
      add({
        objectType: "symbolPin",
        objectId: pin.id,
        provenance: pin.provenance
      });
    }
    for (const wire of this.ir.wires) {
      add({
        objectType: "wire",
        objectId: wire.id,
        provenance: wire.provenance
      });
    }
    for (const group of evidence.values()) {
      group.sort((left, right) =>
        compareText(left.provenance.documentId, right.provenance.documentId)
      );
    }
    return evidence;
  }

  private findComponent(id: string, pageId: string): IrComponent | undefined {
    return this.componentsById
      .get(id)
      ?.find((component) => component.pageId === pageId);
  }
}
