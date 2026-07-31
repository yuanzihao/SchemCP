export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface IrDocumentHeaderProvenance {
  readonly client: string;
  readonly entry: string;
  readonly line: number;
}

export interface IrRecordProvenance {
  readonly documentId: string;
  readonly documentType: string;
  readonly recordType: string;
  readonly recordId?: string;
  readonly ticket: number;
  readonly client: string;
  readonly entry: string;
  readonly line: number;
}

export interface IrEasyEdaExtension {
  readonly easyeda: JsonObject;
}

export interface IrAttribute {
  readonly id: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrDocument {
  readonly id: string;
  readonly type: string;
  readonly provenance: readonly IrDocumentHeaderProvenance[];
}

export interface IrProjectConfiguration {
  readonly documentId: string;
  readonly title?: string;
  readonly defaultSheetId?: string;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrBoard {
  readonly id: string;
  readonly title?: string;
  readonly sortOrder?: number;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrSchematic {
  readonly id: string;
  readonly boardId?: string;
  readonly title?: string;
  readonly sourceDocumentId?: string;
  readonly version?: string;
  readonly sortOrder?: number;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrSchematicPage {
  readonly id: string;
  readonly schematicId?: string;
  readonly creationTicket?: number;
  readonly title?: string;
  readonly description?: string;
  readonly sourceDocumentId?: string;
  readonly version?: string;
  readonly sortOrder?: number;
  readonly attributes: readonly IrAttribute[];
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrSchematicAnnotation {
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
  readonly extensions: IrEasyEdaExtension;
}

export type IrSchematicGraphicDocumentType = "SCHEMATIC_PAGE" | "SYMBOL";
export type IrSchematicGraphicKind =
  | "POLY"
  | "RECT"
  | "ARC"
  | "CIRCLE"
  | "ELLIPSE";
export type IrSchematicGraphicPartBindingState =
  | "NOT_APPLICABLE"
  | "RESOLVED_EXACT"
  | "EXPLICIT_EMPTY"
  | "PART_NOT_FOUND";
export type IrSchematicGraphicPointEncoding =
  | "OFFICIAL_FLAT_XY_ARRAY"
  | "V3_POINT_OBJECT_ARRAY";
export type IrSchematicGraphicRadiusEncoding =
  | "OFFICIAL_NONNEGATIVE_RADII"
  | "V3_SIGNED_RADII";
export type IrSchematicGraphicStyleValue = string | number | null;

export interface IrSchematicGraphicPoint {
  readonly x: number;
  readonly y: number;
}

export type IrSchematicGraphicGeometry =
  | {
      readonly kind: "POLY";
      readonly points: readonly IrSchematicGraphicPoint[];
      readonly closed: boolean;
      readonly pointEncoding: IrSchematicGraphicPointEncoding;
    }
  | {
      readonly kind: "RECT";
      readonly point1: IrSchematicGraphicPoint;
      readonly point2: IrSchematicGraphicPoint;
      readonly radiusX: number;
      readonly radiusY: number;
      readonly rotation: number;
    }
  | {
      readonly kind: "ARC";
      readonly start: IrSchematicGraphicPoint;
      readonly reference: IrSchematicGraphicPoint;
      readonly end: IrSchematicGraphicPoint;
    }
  | {
      readonly kind: "CIRCLE";
      readonly center: IrSchematicGraphicPoint;
      readonly radius: number;
    }
  | {
      readonly kind: "ELLIPSE";
      readonly center: IrSchematicGraphicPoint;
      readonly radiusX: number;
      readonly radiusY: number;
      readonly rotation: number;
      readonly radiusEncoding: IrSchematicGraphicRadiusEncoding;
    };

export interface IrSchematicGraphicPrimitive {
  readonly id: string;
  readonly documentId: string;
  readonly documentType: IrSchematicGraphicDocumentType;
  readonly kind: IrSchematicGraphicKind;
  readonly partId?: string;
  readonly partBinding: {
    readonly state: IrSchematicGraphicPartBindingState;
    readonly targetId?: string;
  };
  readonly locked: boolean;
  readonly zIndex: number;
  readonly geometry: IrSchematicGraphicGeometry;
  readonly style: {
    readonly strokeColor: string | null;
    readonly strokeStyle: IrSchematicGraphicStyleValue;
    readonly fillColor: string | null;
    readonly strokeWidth: number | null;
    readonly fillStyle: IrSchematicGraphicStyleValue;
  };
  readonly coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED";
  readonly geometryValidation: "FINITE_FIELDS_AND_POINT_ENCODING_VALIDATED";
  readonly basis: "EXPLICIT_SCHEMATIC_SHAPE_FIELDS";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly semanticInterpretation: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_APPLICABLE";
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export type IrSchematicTableDocumentType = "SCHEMATIC_PAGE" | "SYMBOL";
export type IrSchematicTablePartBindingState =
  | "NOT_APPLICABLE"
  | "RESOLVED_EXACT"
  | "EXPLICIT_EMPTY"
  | "PART_NOT_FOUND";
export type IrSchematicTableCellRepresentation =
  | "V3_INLINE_TABLE_CELL"
  | "OFFICIAL_SEPARATE_TABLE_RECORD"
  | "BOTH_MATCHING";
export type IrSchematicTableLockEncoding =
  | "BOOLEAN"
  | "INTEGER_0_1"
  | "MIXED_BOOLEAN_AND_INTEGER_0_1";

export interface IrSchematicTableCell {
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
  readonly extensions: IrEasyEdaExtension;
}

export interface IrSchematicTable {
  readonly id: string;
  readonly documentId: string;
  readonly documentType: IrSchematicTableDocumentType;
  readonly partId?: string;
  readonly partBinding: {
    readonly state: IrSchematicTablePartBindingState;
    readonly targetId?: string;
  };
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly rowSizes: readonly number[];
  readonly columnSizes: readonly number[];
  readonly rowLocked: readonly boolean[];
  readonly columnLocked: readonly boolean[];
  readonly lockEncoding: IrSchematicTableLockEncoding;
  readonly rotation: number;
  readonly cells: readonly IrSchematicTableCell[];
  readonly coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED";
  readonly layoutValidation: "INDEX_AND_SPAN_BOUNDS_VALIDATED";
  readonly basis: "EXPLICIT_SCHEMATIC_TABLE_AND_CELL_FIELDS";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly semanticInterpretation: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_APPLICABLE";
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrVariant {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly schematicId?: string;
  readonly sortOrder?: number;
  readonly hasUngroupedComponents?: boolean;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrComponentGroupVariantIndex {
  readonly variantId: string;
  readonly sortOrder: number;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrComponentGroupOverride {
  readonly targetPrimitiveId: string;
  readonly instancePageId: string;
  readonly attributes: JsonObject;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrComponentGroup {
  readonly id: string;
  readonly title?: string;
  readonly parentGroupId?: string;
  readonly directVariantId?: string;
  readonly schematicId?: string;
  readonly sortOrder?: number;
  readonly variantIndexes: readonly IrComponentGroupVariantIndex[];
  readonly overrides: readonly IrComponentGroupOverride[];
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrInstanceBlockPathSegment {
  readonly sheetNumber: string;
  readonly blockSymbolId: string;
}

export interface IrInstanceAttributeOverride {
  readonly targetPrimitiveId: string;
  readonly attributes: JsonObject;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrInstanceContext {
  readonly id: string;
  readonly schematicId: string;
  readonly blockPath: readonly IrInstanceBlockPathSegment[];
  readonly terminalSheetNumber: string;
  readonly overrides: readonly IrInstanceAttributeOverride[];
  readonly provenance: readonly IrDocumentHeaderProvenance[];
}

export type IrComponentLibraryBindingKey = "Symbol" | "Footprint";

export type IrComponentLibraryBindingState =
  | "BOUND_COMPONENT_OVERRIDE"
  | "BOUND_DEVICE_DEFAULT"
  | "UNRESOLVED_COMPONENT_OVERRIDE_CONFLICT"
  | "UNRESOLVED_COMPONENT_OVERRIDE_EMPTY"
  | "UNRESOLVED_COMPONENT_OVERRIDE_INVALID"
  | "UNRESOLVED_DEVICE_REFERENCE_MISSING"
  | "UNRESOLVED_DEVICE_NOT_FOUND"
  | "UNRESOLVED_DEVICE_DEFAULT_MISSING"
  | "UNRESOLVED_DEVICE_DEFAULT_EMPTY"
  | "UNRESOLVED_DEVICE_DEFAULT_INVALID";

export interface IrComponentDeviceDefaultEvidence {
  readonly deviceId: string;
  readonly key: IrComponentLibraryBindingKey;
  readonly value?: JsonValue;
  readonly provenance: IrRecordProvenance;
}

export interface IrComponentLibraryBinding {
  readonly key: IrComponentLibraryBindingKey;
  readonly state: IrComponentLibraryBindingState;
  readonly targetId?: string;
  readonly componentAttributes: readonly IrAttribute[];
  readonly deviceDefault?: IrComponentDeviceDefaultEvidence;
}

export interface IrComponent {
  readonly id: string;
  readonly pageId: string;
  readonly partId: string;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
  readonly mirrored: boolean;
  readonly designator?: string;
  readonly deviceId?: string;
  readonly symbolId?: string;
  readonly footprintId?: string;
  readonly symbolBinding: IrComponentLibraryBinding;
  readonly footprintBinding: IrComponentLibraryBinding;
  readonly attributes: readonly IrAttribute[];
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrSymbol {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly symbolType?: number;
  readonly attributes: readonly IrAttribute[];
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrSymbolPart {
  readonly id: string;
  readonly symbolId: string;
  readonly title?: string;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export type IrSymbolTextPartBindingState =
  | "RESOLVED_EXACT"
  | "EXPLICIT_EMPTY"
  | "PART_NOT_FOUND";

export interface IrSymbolText {
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
  readonly extensions: IrEasyEdaExtension;
}

export interface IrSymbolPin {
  readonly id: string;
  readonly symbolId: string;
  readonly partId: string;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly length: number;
  readonly rotation: number;
  readonly name?: string;
  readonly number?: string;
  readonly electricalType?: string | number;
  readonly pinShape?: string | number;
  readonly attributes: readonly IrAttribute[];
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrDevice {
  readonly id: string;
  readonly title?: string;
  readonly attributes: JsonObject;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrWireSegment {
  readonly id: string;
  readonly start: {
    readonly x: number;
    readonly y: number;
  };
  readonly end: {
    readonly x: number;
    readonly y: number;
  };
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrWire {
  readonly id: string;
  readonly pageId: string;
  readonly explicitNetName?: string;
  readonly segments: readonly IrWireSegment[];
  readonly attributes: readonly IrAttribute[];
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export type IrPinConnectionCandidateStatus =
  | "UNIQUE_EXPLICIT_NET_CANDIDATE"
  | "CONFLICTING_EXPLICIT_NET_CANDIDATES"
  | "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET"
  | "DECLARED_NO_CONNECT"
  | "UNRESOLVED_NO_WIRE";

export interface IrPinExplicitNetCandidate {
  readonly netName: string;
  readonly wireIds: readonly string[];
  readonly segmentIds: readonly string[];
}

export interface IrPinConnectionCandidate {
  readonly status: IrPinConnectionCandidateStatus;
  readonly basis:
    | "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT"
    | "TRANSFORMED_PIN_POINT_ON_CONNECTED_WIRE_COMPONENT"
    | "COMPONENT_PIN_OVERRIDE_NO_CONNECT_ATTRIBUTE";
  readonly electricalTruth: "NOT_VERIFIED";
  readonly explicitNets: readonly IrPinExplicitNetCandidate[];
  readonly unlabeledWireIds: readonly string[];
}

export type IrPinNoConnectDeclarationState =
  | "DECLARED_NO_CONNECT"
  | "DECLARED_CONNECTABLE"
  | "CONFLICTING_DECLARATION"
  | "INVALID_DECLARATION";

export interface IrPinNoConnectDeclaration {
  readonly state: IrPinNoConnectDeclarationState;
  readonly basis: "COMPONENT_PIN_OVERRIDE_NO_CONNECT_ATTRIBUTE";
  readonly evidence: readonly IrAttribute[];
}

export type IrPinEndpointKind =
  | "PART_SYMBOL_PIN"
  | "BLOCK_SYMBOL_PIN"
  | "NET_FLAG_PIN"
  | "NET_PORT_PIN"
  | "SHEET_SYMBOL_PIN"
  | "NONELECTRICAL_SYMBOL_PIN"
  | "SHORT_SYMBOL_PIN"
  | "UNKNOWN_SYMBOL_PIN";

export interface IrPinInstance {
  readonly id: string;
  readonly pageId: string;
  readonly componentId: string;
  readonly symbolId: string;
  readonly symbolPinId: string;
  readonly partId: string;
  readonly endpointKind: IrPinEndpointKind;
  readonly symbolType?: number;
  readonly designator?: string;
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
  readonly provenance: {
    readonly component: IrRecordProvenance;
    readonly symbol: IrRecordProvenance;
    readonly symbolPin: IrRecordProvenance;
  };
}

export type IrShortRelationCandidateStatus =
  | "READY_EXPLICIT_NET_PAIR_CANDIDATE"
  | "SAME_EXPLICIT_NET_CANDIDATE"
  | "UNRESOLVED_PIN_CONNECTION_CANDIDATE"
  | "CONFLICTING_PIN_CONNECTION_CANDIDATE"
  | "INVALID_SHORT_PIN_COUNT";

export interface IrShortRelationPinEvidence {
  readonly pinInstanceId: string;
  readonly symbolPinId: string;
  readonly number?: string;
  readonly connectionCandidate: IrPinConnectionCandidate;
}

export interface IrShortRelationCandidate {
  readonly id: string;
  readonly pageId: string;
  readonly componentId: string;
  readonly symbolId: string;
  readonly partId: string;
  readonly status: IrShortRelationCandidateStatus;
  readonly basis: "SHORT_SYMBOL_TYPE_AND_TRANSFORMED_PIN_CONTACTS";
  readonly electricalTruth: "NOT_VERIFIED";
  readonly explicitNetNames: readonly string[];
  readonly pins: readonly IrShortRelationPinEvidence[];
  readonly provenance: {
    readonly component: IrRecordProvenance;
    readonly symbol: IrRecordProvenance;
  };
}

export type IrNetworkEndpointCandidateKind = "NET_FLAG" | "NET_PORT";

export type IrNetworkEndpointCandidateStatus =
  | "DECLARATION_MATCHES_CONNECTION_CANDIDATE"
  | "DECLARATION_MISMATCHES_CONNECTION_CANDIDATE"
  | "DECLARATION_MISSING"
  | "DECLARATION_CONFLICT"
  | "DECLARATION_VALUE_INVALID"
  | "CONNECTION_CANDIDATE_UNRESOLVED"
  | "INVALID_ENDPOINT_PIN_COUNT";

export interface IrNetworkEndpointDeclarationEvidence {
  readonly attributeId: string;
  readonly key: string;
  readonly value: JsonValue;
  readonly provenance: IrRecordProvenance;
}

export interface IrNetworkEndpointCandidate {
  readonly id: string;
  readonly pageId: string;
  readonly componentId: string;
  readonly symbolId: string;
  readonly partId: string;
  readonly endpointKind: IrNetworkEndpointCandidateKind;
  readonly status: IrNetworkEndpointCandidateStatus;
  readonly basis: "SYMBOL_TYPE_ATTRIBUTES_AND_TRANSFORMED_PIN_CONTACTS";
  readonly electricalTruth: "NOT_VERIFIED";
  readonly declaredNetNameCandidate?: string;
  readonly connectionNetNameCandidate?: string;
  readonly pinInstanceIds: readonly string[];
  readonly declarationEvidence: readonly IrNetworkEndpointDeclarationEvidence[];
  readonly provenance: {
    readonly component: IrRecordProvenance;
    readonly symbol: IrRecordProvenance;
  };
}

export type IrUnboundAttributeReason =
  | "DOCUMENT_ATTRIBUTE"
  | "COMPONENT_PIN_OVERRIDE_UNRESOLVED"
  | "UNKNOWN_PARENT"
  | "INVALID_ATTRIBUTE";

export interface IrUnboundAttribute {
  readonly documentId: string;
  readonly parentId?: string;
  readonly reason: IrUnboundAttributeReason;
  readonly attribute: IrAttribute;
}

export interface IrUnmodeledRecord {
  readonly provenance: IrRecordProvenance;
}

export interface IrDiagnostic {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly count: number;
  readonly documentType?: string;
  readonly recordType?: string;
}

export interface EdaIrSummary {
  readonly documents: number;
  readonly projectConfigurations: number;
  readonly boards: number;
  readonly schematics: number;
  readonly schematicPages: number;
  readonly schematicAnnotations: number;
  readonly schematicAnnotationsWithExplicitText: number;
  readonly schematicAnnotationsWithExplicitEmpty: number;
  readonly schematicGraphicPrimitives: number;
  readonly schematicGraphicPrimitivesInPages: number;
  readonly schematicGraphicPrimitivesInSymbols: number;
  readonly schematicGraphicPolygons: number;
  readonly schematicGraphicRectangles: number;
  readonly schematicGraphicArcs: number;
  readonly schematicGraphicCircles: number;
  readonly schematicGraphicEllipses: number;
  readonly schematicGraphicPrimitivesResolvedExactPart: number;
  readonly schematicGraphicPrimitivesWithExplicitEmptyPart: number;
  readonly schematicGraphicPrimitivesWithPartNotFound: number;
  readonly schematicTables: number;
  readonly schematicTablesInPages: number;
  readonly schematicTablesInSymbols: number;
  readonly schematicTableCells: number;
  readonly schematicTableCellsWithExplicitText: number;
  readonly schematicTableCellsWithExplicitEmpty: number;
  readonly schematicTableCellsFromInlineRecords: number;
  readonly schematicTableCellsFromSeparateRecords: number;
  readonly schematicTableCellsFromBothMatching: number;
  readonly schematicTablesResolvedExactPart: number;
  readonly schematicTablesWithExplicitEmptyPart: number;
  readonly schematicTablesWithPartNotFound: number;
  readonly schematicsWithMissingBoard: number;
  readonly schematicPagesWithMissingSchematic: number;
  readonly projectConfigurationsWithMissingDefaultSheet: number;
  readonly hierarchyBrokenReferences: number;
  readonly variants: number;
  readonly variantsWithMissingSchematic: number;
  readonly componentGroups: number;
  readonly componentGroupsWithMissingSchematic: number;
  readonly componentGroupsWithBrokenParent: number;
  readonly componentGroupsWithMissingDirectVariant: number;
  readonly componentGroupsWithConflictingMembership: number;
  readonly componentGroupVariantIndexes: number;
  readonly componentGroupVariantIndexesWithMissingVariant: number;
  readonly componentGroupOverrides: number;
  readonly variantGroupBrokenReferences: number;
  readonly instanceDocuments: number;
  readonly instanceContexts: number;
  readonly instanceDocumentsWithInvalidPath: number;
  readonly instanceContextsWithMissingSchematic: number;
  readonly instanceAttributeOverrides: number;
  readonly components: number;
  readonly componentsWithDesignator: number;
  readonly componentsWithDevice: number;
  readonly componentsWithSymbol: number;
  readonly componentsWithSymbolFromComponentOverride: number;
  readonly componentsWithSymbolFromDeviceDefault: number;
  readonly componentsWithFootprint: number;
  readonly componentsWithFootprintFromComponentOverride: number;
  readonly componentsWithFootprintFromDeviceDefault: number;
  readonly symbols: number;
  readonly symbolParts: number;
  readonly symbolTexts: number;
  readonly symbolTextsWithExplicitText: number;
  readonly symbolTextsWithExplicitEmpty: number;
  readonly symbolTextsResolvedExact: number;
  readonly symbolTextsWithExplicitEmptyPart: number;
  readonly symbolTextsWithPartNotFound: number;
  readonly symbolPins: number;
  readonly symbolPinsWithNumber: number;
  readonly devices: number;
  readonly wires: number;
  readonly wiresWithExplicitNet: number;
  readonly wireSegments: number;
  readonly pinInstances: number;
  readonly pinInstancesWithUniqueExplicitNetCandidate: number;
  readonly pinInstancesWithConflictingExplicitNetCandidates: number;
  readonly pinInstancesOnUnlabeledWire: number;
  readonly pinInstancesWithDeclaredNoConnect: number;
  readonly pinInstancesWithDeclaredNoConnectAndWireContact: number;
  readonly pinInstancesWithNoConnectDeclarationConflict: number;
  readonly pinInstancesWithInvalidNoConnectDeclaration: number;
  readonly pinInstancesWithoutWire: number;
  readonly pinInstancesByEndpointKind: Readonly<
    Record<IrPinEndpointKind, number>
  >;
  readonly shortRelations: number;
  readonly shortRelationsReadyExplicitNetPairCandidate: number;
  readonly shortRelationsSameExplicitNetCandidate: number;
  readonly shortRelationsUnresolvedPinConnectionCandidate: number;
  readonly shortRelationsConflictingPinConnectionCandidate: number;
  readonly shortRelationsInvalidPinCount: number;
  readonly networkEndpointCandidates: number;
  readonly networkEndpointCandidatesMatching: number;
  readonly networkEndpointCandidatesMismatching: number;
  readonly networkEndpointCandidatesMissingDeclaration: number;
  readonly networkEndpointCandidatesConflictingDeclaration: number;
  readonly networkEndpointCandidatesInvalidDeclarationValue: number;
  readonly networkEndpointCandidatesUnresolvedConnection: number;
  readonly networkEndpointCandidatesInvalidPinCount: number;
  readonly unboundAttributes: number;
  readonly unmodeledRecords: number;
}

export interface EdaIr {
  readonly schema: "schemcp.eda-ir";
  readonly schemaVersion: "1.0.0";
  readonly generator: {
    readonly name: "@yuanzihao/schemcp";
    readonly version: "0.1.0";
  };
  readonly source: {
    readonly format: "EASYEDA_V3_LOG";
    readonly archiveSha256: string;
    readonly reducedStateSha256: string;
    readonly electricalTruth: "NOT_VERIFIED";
  };
  readonly documents: readonly IrDocument[];
  readonly projectConfigurations: readonly IrProjectConfiguration[];
  readonly boards: readonly IrBoard[];
  readonly schematics: readonly IrSchematic[];
  readonly schematicPages: readonly IrSchematicPage[];
  readonly schematicAnnotations: readonly IrSchematicAnnotation[];
  readonly schematicGraphicPrimitives: readonly IrSchematicGraphicPrimitive[];
  readonly schematicTables: readonly IrSchematicTable[];
  readonly variants: readonly IrVariant[];
  readonly componentGroups: readonly IrComponentGroup[];
  readonly instanceContexts: readonly IrInstanceContext[];
  readonly components: readonly IrComponent[];
  readonly symbols: readonly IrSymbol[];
  readonly symbolParts: readonly IrSymbolPart[];
  readonly symbolTexts: readonly IrSymbolText[];
  readonly symbolPins: readonly IrSymbolPin[];
  readonly devices: readonly IrDevice[];
  readonly wires: readonly IrWire[];
  readonly pinInstances: readonly IrPinInstance[];
  readonly shortRelations: readonly IrShortRelationCandidate[];
  readonly networkEndpointCandidates: readonly IrNetworkEndpointCandidate[];
  readonly unboundAttributes: readonly IrUnboundAttribute[];
  readonly unmodeledRecords: readonly IrUnmodeledRecord[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly summary: EdaIrSummary;
  readonly irSha256: string;
}
