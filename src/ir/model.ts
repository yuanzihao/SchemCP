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
  readonly pageReference: string;
  readonly blockSymbolId: string;
  readonly sheetNumber?: string;
  readonly sourcePageId?: string;
  readonly targetPageId?: string;
  readonly resolutionStatus:
    | "RESOLVED_EXACT"
    | "SOURCE_PAGE_NOT_FOUND"
    | "SOURCE_PAGE_AMBIGUOUS"
    | "SOURCE_PAGE_SCHEMATIC_MISMATCH"
    | "BLOCK_COMPONENT_NOT_FOUND"
    | "BLOCK_COMPONENT_AMBIGUOUS"
    | "BLOCK_SYMBOL_REFERENCE_UNRESOLVED"
    | "BLOCK_SYMBOL_TYPE_MISMATCH"
    | "TARGET_PAGE_NOT_FOUND"
    | "TARGET_PAGE_AMBIGUOUS"
    | "TARGET_PAGE_SCHEMATIC_MISMATCH"
    | "PAGE_CYCLE_DETECTED";
}

export type IrInstanceAttributeApplicationStatus =
  | "APPLIED_COMPONENT_OCCURRENCE"
  | "APPLIED_PIN_OCCURRENCE"
  | "CONTEXT_NOT_RESOLVED"
  | "TARGET_NOT_FOUND"
  | "TARGET_PIN_NOT_FOUND"
  | "TARGET_AMBIGUOUS";

export interface IrInstanceAttributeOverride {
  readonly targetPrimitiveId: string;
  readonly attributes: JsonObject;
  readonly applicationStatus: IrInstanceAttributeApplicationStatus;
  readonly resolvedTarget?:
    | {
        readonly kind: "COMPONENT";
        readonly pageId: string;
        readonly componentId: string;
      }
    | {
        readonly kind: "PIN";
        readonly pageId: string;
        readonly componentId: string;
        readonly symbolPinId: string;
      };
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrInstanceContext {
  readonly id: string;
  readonly pathEncoding:
    | "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
    | "OBSERVED_PAGE_ID_TILDE_BLOCK_ID";
  readonly schematicId: string;
  readonly blockPath: readonly IrInstanceBlockPathSegment[];
  readonly terminalPageReference: string;
  readonly terminalSheetNumber?: string;
  readonly terminalPageId?: string;
  readonly resolutionStatus:
    | "RESOLVED_EXACT"
    | "SCHEMATIC_NOT_FOUND"
    | "SOURCE_PAGE_NOT_FOUND"
    | "SOURCE_PAGE_AMBIGUOUS"
    | "SOURCE_PAGE_SCHEMATIC_MISMATCH"
    | "BLOCK_COMPONENT_NOT_FOUND"
    | "BLOCK_COMPONENT_AMBIGUOUS"
    | "BLOCK_SYMBOL_REFERENCE_UNRESOLVED"
    | "BLOCK_SYMBOL_TYPE_MISMATCH"
    | "TERMINAL_PAGE_NOT_FOUND"
    | "TERMINAL_PAGE_AMBIGUOUS"
    | "TERMINAL_PAGE_SCHEMATIC_MISMATCH"
    | "PAGE_CYCLE_DETECTED";
  readonly overrides: readonly IrInstanceAttributeOverride[];
  readonly provenance: readonly IrDocumentHeaderProvenance[];
}

export interface IrEffectiveAttribute {
  readonly key: string;
  readonly values: readonly JsonValue[];
  readonly resolution:
    | "DEVICE_DEFAULT"
    | "COMPONENT_EXPLICIT"
    | "COMPONENT_CONFLICT"
    | "INSTANCE_OVERRIDE";
  readonly provenance: readonly IrRecordProvenance[];
}

export type IrComponentAssemblyStatus = "POPULATED" | "DNP" | "UNKNOWN";

export type IrComponentAssemblyReason =
  | "EXPLICIT_ADD_INTO_BOM_YES"
  | "EXPLICIT_ADD_INTO_BOM_NO"
  | "ADD_INTO_BOM_MISSING"
  | "ADD_INTO_BOM_CONFLICT"
  | "ADD_INTO_BOM_INVALID"
  | "VARIANT_APPLICATION_NOT_SUPPORTED";

export interface IrComponentAssembly {
  readonly status: IrComponentAssemblyStatus;
  readonly reason: IrComponentAssemblyReason;
  readonly attributeKey: "Add into BOM";
  readonly values: readonly JsonValue[];
  readonly resolution:
    | IrEffectiveAttribute["resolution"]
    | "MISSING"
    | "VARIANT_NOT_APPLIED";
  readonly evidenceClass: "EXPLICIT_PROJECT_RECORD" | "DETERMINISTIC_RULE";
  readonly truthStatus: "NOT_VERIFIED";
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
}

export type IrComponentPinCompletenessStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "UNKNOWN";

export type IrComponentPinCompletenessReason =
  | "SINGLE_SYMBOL_PART_COMPLETE"
  | "ALL_SYMBOL_PARTS_INSTANTIATED"
  | "SYMBOL_UNIT_MISSING"
  | "SYMBOL_REFERENCE_MISSING"
  | "SYMBOL_NOT_FOUND"
  | "SYMBOL_PART_DECLARATION_MISSING"
  | "SYMBOL_PART_NOT_FOUND"
  | "LOGICAL_COMPONENT_AMBIGUOUS"
  | "INSTANCE_UNIT_CONTEXT_INCOMPLETE"
  | "HIDDEN_PIN_SOURCE_UNRESOLVED";

export interface IrComponentUnitReference {
  readonly componentId: string;
  readonly pageId: string;
  readonly partId: string;
}

export interface IrComponentPinCompleteness {
  readonly logicalComponentId: string;
  readonly status: IrComponentPinCompletenessStatus;
  readonly reason: IrComponentPinCompletenessReason;
  readonly units: readonly IrComponentUnitReference[];
  readonly declaredPartIds: readonly string[];
  readonly instantiatedPartIds: readonly string[];
  readonly missingPartIds: readonly string[];
  readonly duplicatePartIds: readonly string[];
  readonly symbolPinCount: number;
  readonly instantiatedPinCount: number;
  readonly hiddenPinCount: number;
  readonly evidenceClass: "DETERMINISTIC_RULE";
  readonly truthStatus: "NOT_VERIFIED";
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
}

export interface IrComponentOccurrencePinOverride {
  readonly symbolPinId: string;
  readonly attributes: JsonObject;
  readonly provenance: IrRecordProvenance;
}

export interface IrComponentOccurrence {
  readonly id: string;
  readonly instanceContextId: string;
  readonly schematicId: string;
  readonly pageId: string;
  readonly componentId: string;
  readonly designator?: string;
  readonly attributes: readonly IrEffectiveAttribute[];
  readonly pinOverrides: readonly IrComponentOccurrencePinOverride[];
  readonly assembly: IrComponentAssembly;
  readonly pinCompleteness: IrComponentPinCompleteness;
  readonly populationStatus: IrComponentAssemblyStatus;
  readonly pathTruth: "EXPLICIT_INSTANCE_DOCUMENT_RESOLVED";
  readonly electricalTruth: "NOT_VERIFIED";
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
  readonly assembly: IrComponentAssembly;
  readonly pinCompleteness: IrComponentPinCompleteness;
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
  readonly display?: boolean;
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

export type IrBusEncoding =
  | "OFFICIAL_DOTS_WITH_SEPARATE_BUSENTRY_RECORDS"
  | "OBSERVED_EMBEDDED_BUSENTRY_MAP"
  | "HYBRID_DOTS_WITH_EMBEDDED_BUSENTRY_MAP";

export type IrBusEntryEncoding =
  | "OFFICIAL_SEPARATE_BUSENTRY_RECORD"
  | "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM";

export interface IrBusSegment {
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

export interface IrBusEntry {
  readonly id: string;
  readonly pageId: string;
  readonly busId?: string;
  readonly encoding: IrBusEntryEncoding;
  readonly associationStatus:
    | "EMBEDDED_IN_BUS_RECORD"
    | "EXPLICIT_PARENT_ID"
    | "SEPARATE_RECORD_WITHOUT_EXPLICIT_BUS_ID"
    | "EXPLICIT_PARENT_ID_NOT_FOUND";
  readonly order: number;
  readonly busGroupId?: number;
  readonly point: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
  readonly evidenceClass: "EXPLICIT_PROJECT_RECORD";
  readonly truthStatus: "NOT_VERIFIED";
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrEasyEdaExtension;
}

export interface IrBus {
  readonly id: string;
  readonly pageId: string;
  readonly encoding: IrBusEncoding;
  readonly explicitNetName?: string;
  readonly segments: readonly IrBusSegment[];
  readonly entryIds: readonly string[];
  readonly attributes: readonly IrAttribute[];
  readonly memberExpansion: "NOT_PERFORMED";
  readonly evidenceClass: "EXPLICIT_PROJECT_RECORD";
  readonly truthStatus: "NOT_VERIFIED";
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
  readonly display?: boolean;
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

export type IrSemanticTruthStatus = "NOT_VERIFIED" | "CANDIDATE" | "UNRESOLVED";

export type IrComponentRole =
  | "MCU_MPU"
  | "POWER_INPUT"
  | "LDO"
  | "DC_DC"
  | "POWER_SWITCH_CANDIDATE"
  | "REFERENCE_SOURCE"
  | "CRYSTAL_OSCILLATOR"
  | "CLOCK_BUFFER_CANDIDATE"
  | "MEMORY"
  | "TRANSCEIVER"
  | "ISOLATOR_CANDIDATE"
  | "CONNECTOR"
  | "PROTECTION_CANDIDATE"
  | "FILTER_CANDIDATE"
  | "RESET_SUPERVISOR"
  | "BOOT_STRAP"
  | "PASSIVE"
  | "UNKNOWN";

export interface IrComponentRoleCandidate {
  readonly role: IrComponentRole;
  readonly ruleId: string;
  readonly evidenceClass: "DETERMINISTIC_RULE";
  readonly truthStatus: IrSemanticTruthStatus;
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
}

export interface IrComponentPowerDomainCandidate {
  readonly id: string;
  readonly name: string;
  readonly pageId: string;
  readonly netName: string;
  readonly relationship: "INPUT" | "OUTPUT" | "GROUND" | "RELATED";
  readonly pinInstanceIds: readonly string[];
  readonly isolationStatus: "NOT_INDICATED" | "ISOLATION_CANDIDATE";
  readonly ruleId: "power-domain.explicit-pin-net.v1";
  readonly evidenceClass: "DETERMINISTIC_RULE";
  readonly truthStatus: "CANDIDATE";
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
}

export interface IrComponentSemantic {
  readonly id: string;
  readonly componentId: string;
  readonly pageId: string;
  readonly logicalComponentId: string;
  readonly unitComponentIds: readonly string[];
  readonly primaryRole: IrComponentRole;
  readonly roles: readonly IrComponentRoleCandidate[];
  readonly powerDomains: readonly IrComponentPowerDomainCandidate[];
  readonly ruleId: "component.semantic.aggregate.v1";
  readonly evidenceClass: "DETERMINISTIC_RULE";
  readonly truthStatus: IrSemanticTruthStatus;
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
}

export type IrInterfaceType =
  | "SWD"
  | "JTAG"
  | "UART"
  | "I2C"
  | "SPI"
  | "QSPI"
  | "CAN"
  | "USB"
  | "ETHERNET"
  | "SDIO"
  | "I2S_SAI"
  | "ANALOG"
  | "GPIO_GROUP";

export type IrInterfaceStatus =
  | "CANDIDATE"
  | "PARTIAL_CANDIDATE"
  | "UNRESOLVED";

export type IrInterfaceActivityStatus =
  | "ACTIVE"
  | "EXCLUDED_DNP"
  | "ASSEMBLY_UNKNOWN";

export interface IrInterfaceSignal {
  readonly signal: string;
  readonly pinInstanceIds: readonly string[];
  readonly pinNames: readonly string[];
  readonly explicitNetNames: readonly string[];
  readonly provenance: readonly IrRecordProvenance[];
}

export interface IrInterface {
  readonly id: string;
  readonly type: IrInterfaceType;
  readonly group: string;
  readonly logicalComponentId: string;
  readonly componentRefs: readonly {
    readonly componentId: string;
    readonly pageId: string;
  }[];
  readonly status: IrInterfaceStatus;
  readonly activityStatus: IrInterfaceActivityStatus;
  readonly signals: readonly IrInterfaceSignal[];
  readonly requiredSignals: readonly string[];
  readonly missingSignals: readonly string[];
  readonly unresolvedReasons: readonly (
    | "DUPLICATE_SIGNAL_ASSIGNMENT"
    | "PIN_COMPLETENESS_UNKNOWN"
    | "CONNECTION_CANDIDATE_UNRESOLVED"
    | "ASSEMBLY_UNKNOWN"
  )[];
  readonly ruleId: string;
  readonly evidenceClass: "DETERMINISTIC_RULE";
  readonly truthStatus: IrSemanticTruthStatus;
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
}

export type IrResourceType = "POWER" | "CLOCK" | "RESET_BOOT" | "MCU_PIN";

export type IrResourceEdgeKind =
  | "POWER_SOURCE_ENTRY"
  | "POWER_CONVERSION"
  | "POWER_SWITCH_TRANSFER_CANDIDATE"
  | "POWER_TRANSFER_CANDIDATE"
  | "POWER_LOAD"
  | "CLOCK_SOURCE_OUTPUT"
  | "CLOCK_BUFFER_INPUT"
  | "CLOCK_BUFFER_OUTPUT"
  | "CLOCK_SINK_INPUT"
  | "RESET_SOURCE_OUTPUT"
  | "RESET_EXTERNAL_SOURCE_CANDIDATE"
  | "RESET_MANUAL_SOURCE_CANDIDATE"
  | "RESET_SINK_INPUT"
  | "RESET_BIAS_CANDIDATE"
  | "BOOT_STRAP_INPUT"
  | "BOOT_BIAS_CANDIDATE"
  | "MCU_PIN_CONNECTION";

export type IrResourceNode =
  | {
      readonly kind: "NET";
      readonly id: string;
      readonly pageId: string;
      readonly netName: string;
    }
  | {
      readonly kind: "COMPONENT";
      readonly id: string;
      readonly pageId: string;
      readonly componentId: string;
      readonly logicalComponentId: string;
    };

export type IrResourceUnresolvedReason =
  | "ASSEMBLY_STATUS_UNKNOWN"
  | "PIN_COMPLETENESS_NOT_COMPLETE";

export interface IrResourceEdge {
  readonly id: string;
  readonly resourceType: IrResourceType;
  readonly kind: IrResourceEdgeKind;
  readonly direction: "DIRECTED" | "BIDIRECTIONAL";
  readonly from: IrResourceNode;
  readonly to: IrResourceNode;
  readonly viaComponentRefs: readonly {
    readonly componentId: string;
    readonly pageId: string;
    readonly logicalComponentId: string;
  }[];
  readonly pinInstanceIds: readonly string[];
  readonly activityStatus: IrInterfaceActivityStatus;
  readonly isolationStatus: "NOT_INDICATED" | "ISOLATION_CANDIDATE";
  readonly status: "CANDIDATE" | "UNRESOLVED";
  readonly unresolvedReasons: readonly IrResourceUnresolvedReason[];
  readonly ruleId: string;
  readonly evidenceClass: "DETERMINISTIC_RULE";
  readonly truthStatus: IrSemanticTruthStatus;
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
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
  readonly instanceContextsResolved: number;
  readonly instanceContextsUnresolved: number;
  readonly instanceAttributeOverrides: number;
  readonly instanceAttributeOverridesAppliedToComponents: number;
  readonly instanceAttributeOverridesAppliedToPins: number;
  readonly instanceAttributeOverridesUnresolved: number;
  readonly componentOccurrences: number;
  readonly componentOccurrencesPopulated: number;
  readonly componentOccurrencesDnp: number;
  readonly componentOccurrencesAssemblyUnknown: number;
  readonly components: number;
  readonly componentsPopulated: number;
  readonly componentsDnp: number;
  readonly componentsAssemblyUnknown: number;
  readonly componentsPinCompletenessComplete: number;
  readonly componentsPinCompletenessPartial: number;
  readonly componentsPinCompletenessUnknown: number;
  readonly componentSemantics: number;
  readonly componentSemanticsUnknownRole: number;
  readonly componentPowerDomainCandidates: number;
  readonly interfaces: number;
  readonly interfacesCandidate: number;
  readonly interfacesPartialCandidate: number;
  readonly interfacesUnresolved: number;
  readonly interfacesActive: number;
  readonly interfacesExcludedDnp: number;
  readonly interfacesAssemblyUnknown: number;
  readonly resourceNodes: number;
  readonly resourceEdges: number;
  readonly resourceEdgesPower: number;
  readonly resourceEdgesClock: number;
  readonly resourceEdgesResetBoot: number;
  readonly resourceEdgesMcuPin: number;
  readonly resourceEdgesActive: number;
  readonly resourceEdgesExcludedDnp: number;
  readonly resourceEdgesAssemblyUnknown: number;
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
  readonly symbolPinsHidden: number;
  readonly devices: number;
  readonly wires: number;
  readonly wiresWithExplicitNet: number;
  readonly wireSegments: number;
  readonly buses: number;
  readonly busesWithExplicitNet: number;
  readonly busesWithEmptyEntrySet: number;
  readonly busSegments: number;
  readonly busEntries: number;
  readonly busEntriesEmbedded: number;
  readonly busEntriesSeparate: number;
  readonly busEntriesUnbound: number;
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
  readonly schemaVersion: "1.1.0";
  readonly generator: {
    readonly name: "@yuanzihao/schemcp";
    readonly version: "0.2.0";
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
  readonly componentOccurrences: readonly IrComponentOccurrence[];
  readonly components: readonly IrComponent[];
  readonly componentSemantics: readonly IrComponentSemantic[];
  readonly interfaces: readonly IrInterface[];
  readonly resourceNodes: readonly IrResourceNode[];
  readonly resourceEdges: readonly IrResourceEdge[];
  readonly symbols: readonly IrSymbol[];
  readonly symbolParts: readonly IrSymbolPart[];
  readonly symbolTexts: readonly IrSymbolText[];
  readonly symbolPins: readonly IrSymbolPin[];
  readonly devices: readonly IrDevice[];
  readonly wires: readonly IrWire[];
  readonly buses: readonly IrBus[];
  readonly busEntries: readonly IrBusEntry[];
  readonly pinInstances: readonly IrPinInstance[];
  readonly shortRelations: readonly IrShortRelationCandidate[];
  readonly networkEndpointCandidates: readonly IrNetworkEndpointCandidate[];
  readonly unboundAttributes: readonly IrUnboundAttribute[];
  readonly unmodeledRecords: readonly IrUnmodeledRecord[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly summary: EdaIrSummary;
  readonly irSha256: string;
}
