export interface ContextPackFileReceipt {
  readonly path: string;
  readonly mediaType: "application/json" | "application/x-ndjson";
  readonly bytes: number;
  readonly records: number;
  readonly sha256: string;
}

export interface ContextPackManifest {
  readonly schemaVersion: "1.1.0";
  readonly generator: {
    readonly name: "@yuanzihao/schemcp";
    readonly version: "0.2.0";
  };
  readonly source: {
    readonly format: "EASYEDA_V3_LOG";
    readonly archiveSha256: string;
    readonly reducedStateSha256: string;
    readonly irSha256: string;
    readonly electricalTruth: "NOT_VERIFIED";
  };
  readonly encoding: {
    readonly json: "CANONICAL_JSON_LF";
    readonly jsonl: "ONE_CANONICAL_JSON_VALUE_PER_LF_LINE";
  };
  readonly capabilities: {
    readonly projectStructure: "AVAILABLE_DETERMINISTIC";
    readonly componentInventory: "AVAILABLE_DETERMINISTIC";
    readonly explicitWireNetLabels: "AVAILABLE_NOT_FULL_NET_GRAPH";
    readonly pinConnectionCandidates: "AVAILABLE_NOT_VERIFIED";
    readonly variantsAndInstanceContexts: "AVAILABLE_EXPLICIT_METADATA";
    readonly explicitBuses: "AVAILABLE_EXPLICIT_NO_AUTOMATIC_RANGE_EXPANSION";
    readonly componentSemantics: "AVAILABLE_VERSIONED_DETERMINISTIC_RULES";
    readonly interfaces: "AVAILABLE_CANDIDATES_NOT_VERIFIED";
    readonly powerDomains: "AVAILABLE_EXPLICIT_NET_CANDIDATES_NOT_VERIFIED";
    readonly resourceGraphs: "AVAILABLE_BOUNDED_CANDIDATES_NOT_VERIFIED";
    readonly mcuPinResources: "AVAILABLE_CONSERVATIVE_STATUS_NOT_VERIFIED";
    readonly resourceEvidence: "AVAILABLE_WITH_STABLE_UNRESOLVED_REASONS";
    readonly schematicAnnotations: "AVAILABLE_EXPLICIT_TEXT_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED";
    readonly schematicGraphicPrimitives: "AVAILABLE_EXPLICIT_POLY_RECT_ARC_CIRCLE_ELLIPSE_FINITE_GEOMETRY_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED";
    readonly schematicTables: "AVAILABLE_EXPLICIT_TABLE_CELLS_LAYOUT_BOUNDS_VALIDATED_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED";
    readonly symbolTexts: "AVAILABLE_EXPLICIT_TEXT_EXACT_PART_BINDING_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED";
    readonly electricalTruth: "NOT_VERIFIED";
    readonly inferredBoardResources: "NOT_INCLUDED";
    readonly datasheets: "NOT_INCLUDED";
  };
  readonly files: readonly ContextPackFileReceipt[];
  readonly payloadBytes: number;
  readonly packageSha256: string;
}

export interface ContextPackWriteResult {
  readonly packageSha256: string;
  readonly manifestSha256: string;
  readonly payloadBytes: number;
  readonly outputBytes: number;
  readonly files: number;
  readonly records: number;
}
