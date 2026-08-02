import assert from "node:assert/strict";
import test from "node:test";
import { compileV3ToEdaIr } from "../../src/v3/compile-ir.js";
import type { V3Record } from "../../src/v3/record.js";
import {
  V3Reducer,
  type V3DocumentContext
} from "../../src/v3/reducer.js";

const LIMITS = {
  maxReducedRecords: 1_000,
  maxReducedSourceBytes: 1024 * 1024
} as const;
const ARCHIVE_SHA = "a".repeat(64);

function source(line: number) {
  return { entry: "epru-1", line } as const;
}

function enter(
  reducer: V3Reducer,
  uuid: string,
  docType: string,
  line: number
): V3DocumentContext {
  return reducer.enterDocument(
    {
      outer: { type: "DOCHEAD" },
      inner: { uuid, docType, client: "client-a" }
    },
    source(line)
  );
}

function accept(
  reducer: V3Reducer,
  context: V3DocumentContext,
  line: number,
  type: string,
  id: string | undefined,
  inner: Readonly<Record<string, unknown>>
): void {
  const record: V3Record = {
    outer: {
      type,
      ...(id === undefined ? {} : { id }),
      ticket: line
    },
    inner
  };
  reducer.accept(context, record, source(line), 100);
}

function attribute(
  reducer: V3Reducer,
  context: V3DocumentContext,
  line: number,
  id: string,
  parentId: string,
  key: string,
  value: unknown
): void {
  accept(reducer, context, line, "ATTR", id, {
    parentId,
    key,
    value,
    x: null,
    y: null
  });
}

function createFixture(): V3Reducer {
  const reducer = new V3Reducer(LIMITS);
  const configuration = enter(reducer, "config-1", "PROJECT_CONFIG", 50);
  accept(reducer, configuration, 51, "META", undefined, {
    name: "Fixture Project",
    default_sheet: "page-1"
  });
  const board = enter(reducer, "board-1", "BOARD", 52);
  accept(reducer, board, 53, "META", undefined, {
    title: "Fixture Board",
    sort: 1
  });
  const schematic = enter(reducer, "schematic-1", "SCH", 54);
  accept(reducer, schematic, 55, "META", undefined, {
    name: "Fixture Schematic",
    board: "board-1",
    sort: 2
  });
  const variant = enter(reducer, "variant-1", "VARIANT", 56);
  accept(reducer, variant, 57, "META", undefined, {
    title: "Default",
    description: "Production variant",
    schematicId: "schematic-1",
    zIndex: 1,
    notGrouped: false
  });
  const indexedGroup = enter(
    reducer,
    "component-group-indexed",
    "COMPONENT_GROUP",
    58
  );
  accept(reducer, indexedGroup, 59, "META", undefined, {
    title: "Power",
    parent: "",
    belong: "",
    zIndex: 2,
    schematicId: "schematic-1"
  });
  accept(reducer, indexedGroup, 60, "GROUP_INDEX", "variant-1", {
    zIndex: 3
  });
  accept(
    reducer,
    indexedGroup,
    61,
    "GROUP_DATA",
    "component-1@schematic-1_$1",
    {
      Designator: "U1A"
    }
  );
  const directGroup = enter(
    reducer,
    "component-group-direct",
    "COMPONENT_GROUP",
    62
  );
  accept(reducer, directGroup, 63, "META", undefined, {
    title: "Do Not Populate",
    parent: "",
    belong: "variant-1",
    zIndex: 4,
    schematicId: "schematic-1"
  });
  accept(
    reducer,
    directGroup,
    64,
    "GROUP_DATA",
    "component-1@schematic-1_$1",
    {
      DNP: "yes"
    }
  );
  const instance = enter(
    reducer,
    "schematic-1_$5|block-a_$01",
    "INSTANCE",
    65
  );
  accept(reducer, instance, 66, "INSTANCE_ATTR", "component-1", {
    Designator: "U1A"
  });
  accept(reducer, instance, 67, "INSTANCE_ATTR", "component-1pin-1", {
    NO_CONNECT: "yes"
  });
  const page = enter(reducer, "page-1", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, {
    title: "Main",
    schematic: "schematic-1",
    zIndex: 1
  });
  accept(reducer, page, 3, "COMPONENT", "component-1", {
    partId: "part-a",
    x: 10,
    y: 20,
    rotation: 90,
    isMirror: false,
    futureField: "preserved"
  });
  attribute(reducer, page, 4, "attr-c1", "component-1", "Designator", "U1");
  attribute(reducer, page, 5, "attr-c2", "component-1", "Device", "device-1");
  attribute(reducer, page, 7, "attr-c4", "component-1", "Footprint", "footprint-1");
  accept(reducer, page, 8, "WIRE", "wire-1", {
    locked: false,
    zIndex: 2
  });
  attribute(reducer, page, 9, "attr-w1", "wire-1", "NET", "VCC");
  accept(reducer, page, 10, "LINE", "line-1", {
    lineGroup: "wire-1",
    startX: 0,
    startY: 0,
    endX: 10,
    endY: 0
  });
  accept(reducer, page, 11, "TEXT", "text-1", {
    value: "not-modeled"
  });
  attribute(
    reducer,
    page,
    12,
    "pin-override",
    "component-1-pin-1",
    "NO_CONNECT",
    "yes"
  );
  attribute(
    reducer,
    page,
    13,
    "pin-override-official",
    "component-1pin-1",
    "NO_CONNECT",
    "yes"
  );

  const symbol = enter(reducer, "symbol-1", "SYMBOL", 20);
  accept(reducer, symbol, 21, "META", undefined, {
    title: "MCU",
    description: "fixture",
    docType: 2
  });
  accept(reducer, symbol, 22, "PART", "part-a", {
    title: "A",
    BBOX: [0, 0, 10, 10]
  });
  accept(reducer, symbol, 23, "PIN", "pin-1", {
    partId: "part-a",
    x: 1,
    y: 2,
    length: 20,
    rotation: 0,
    display: false,
    pinShape: "NONE"
  });
  attribute(reducer, symbol, 24, "pin-name", "pin-1", "Pin Name", "PA0");
  attribute(reducer, symbol, 25, "pin-number", "pin-1", "Pin Number", "1");
  attribute(reducer, symbol, 26, "pin-type", "pin-1", "Pin Type", "BI");

  const device = enter(reducer, "device-1", "DEVICE", 30);
  accept(reducer, device, 31, "META", undefined, {
    title: "STM32",
    attributes: {
      Manufacturer: "ST",
      "Manufacturer Part": "STM32",
      Symbol: "symbol-1",
      Footprint: "footprint-default"
    }
  });

  const pcb = enter(reducer, "pcb-1", "PCB", 40);
  accept(reducer, pcb, 41, "PAD", "pad-1", {
    x: 1,
    y: 2
  });
  return reducer;
}

test("将原理图、符号、引脚、器件和显式导线编译为可追溯 EDA-IR", () => {
  const reducer = createFixture();
  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);

  assert.equal(ir.schema, "schemcp.eda-ir");
  assert.equal(ir.schemaVersion, "1.1.0");
  assert.equal(ir.source.archiveSha256, ARCHIVE_SHA);
  assert.equal(ir.source.electricalTruth, "NOT_VERIFIED");
  assert.deepEqual(ir.summary, {
    documents: 11,
    projectConfigurations: 1,
    boards: 1,
    schematics: 1,
    schematicPages: 1,
    schematicAnnotations: 0,
    schematicAnnotationsWithExplicitText: 0,
    schematicAnnotationsWithExplicitEmpty: 0,
    schematicGraphicPrimitives: 0,
    schematicGraphicPrimitivesInPages: 0,
    schematicGraphicPrimitivesInSymbols: 0,
    schematicGraphicPolygons: 0,
    schematicGraphicRectangles: 0,
    schematicGraphicArcs: 0,
    schematicGraphicCircles: 0,
    schematicGraphicEllipses: 0,
    schematicGraphicPrimitivesResolvedExactPart: 0,
    schematicGraphicPrimitivesWithExplicitEmptyPart: 0,
    schematicGraphicPrimitivesWithPartNotFound: 0,
    schematicTables: 0,
    schematicTablesInPages: 0,
    schematicTablesInSymbols: 0,
    schematicTableCells: 0,
    schematicTableCellsWithExplicitText: 0,
    schematicTableCellsWithExplicitEmpty: 0,
    schematicTableCellsFromInlineRecords: 0,
    schematicTableCellsFromSeparateRecords: 0,
    schematicTableCellsFromBothMatching: 0,
    schematicTablesResolvedExactPart: 0,
    schematicTablesWithExplicitEmptyPart: 0,
    schematicTablesWithPartNotFound: 0,
    schematicsWithMissingBoard: 0,
    schematicPagesWithMissingSchematic: 0,
    projectConfigurationsWithMissingDefaultSheet: 0,
    hierarchyBrokenReferences: 0,
    variants: 1,
    variantsWithMissingSchematic: 0,
    componentGroups: 2,
    componentGroupsWithMissingSchematic: 0,
    componentGroupsWithBrokenParent: 0,
    componentGroupsWithMissingDirectVariant: 0,
    componentGroupsWithConflictingMembership: 0,
    componentGroupVariantIndexes: 1,
    componentGroupVariantIndexesWithMissingVariant: 0,
    componentGroupOverrides: 2,
    variantGroupBrokenReferences: 0,
    instanceDocuments: 1,
    instanceContexts: 1,
    instanceDocumentsWithInvalidPath: 0,
    instanceContextsWithMissingSchematic: 0,
    instanceContextsResolved: 0,
    instanceContextsUnresolved: 1,
    instanceAttributeOverrides: 2,
    instanceAttributeOverridesAppliedToComponents: 0,
    instanceAttributeOverridesAppliedToPins: 0,
    instanceAttributeOverridesUnresolved: 2,
    componentOccurrences: 0,
    componentOccurrencesPopulated: 0,
    componentOccurrencesDnp: 0,
    componentOccurrencesAssemblyUnknown: 0,
    components: 1,
    componentsPopulated: 0,
    componentsDnp: 0,
    componentsAssemblyUnknown: 1,
    componentsPinCompletenessComplete: 1,
    componentsPinCompletenessPartial: 0,
    componentsPinCompletenessUnknown: 0,
    componentSemantics: 1,
    componentSemanticsUnknownRole: 0,
    componentPowerDomainCandidates: 0,
    interfaces: 0,
    interfacesCandidate: 0,
    interfacesPartialCandidate: 0,
    interfacesUnresolved: 0,
    interfacesActive: 0,
    interfacesExcludedDnp: 0,
    interfacesAssemblyUnknown: 0,
    componentsWithDesignator: 1,
    componentsWithDevice: 1,
    componentsWithSymbol: 1,
    componentsWithSymbolFromComponentOverride: 0,
    componentsWithSymbolFromDeviceDefault: 1,
    componentsWithFootprint: 1,
    componentsWithFootprintFromComponentOverride: 1,
    componentsWithFootprintFromDeviceDefault: 0,
    symbols: 1,
    symbolParts: 1,
    symbolTexts: 0,
    symbolTextsWithExplicitText: 0,
    symbolTextsWithExplicitEmpty: 0,
    symbolTextsResolvedExact: 0,
    symbolTextsWithExplicitEmptyPart: 0,
    symbolTextsWithPartNotFound: 0,
    symbolPins: 1,
    symbolPinsWithNumber: 1,
    symbolPinsHidden: 1,
    devices: 1,
    wires: 1,
    wiresWithExplicitNet: 1,
    wireSegments: 1,
    buses: 0,
    busesWithExplicitNet: 0,
    busesWithEmptyEntrySet: 0,
    busSegments: 0,
    busEntries: 0,
    busEntriesEmbedded: 0,
    busEntriesSeparate: 0,
    busEntriesUnbound: 0,
    pinInstances: 1,
    pinInstancesWithUniqueExplicitNetCandidate: 0,
    pinInstancesWithConflictingExplicitNetCandidates: 0,
    pinInstancesOnUnlabeledWire: 0,
    pinInstancesWithDeclaredNoConnect: 1,
    pinInstancesWithDeclaredNoConnectAndWireContact: 0,
    pinInstancesWithNoConnectDeclarationConflict: 0,
    pinInstancesWithInvalidNoConnectDeclaration: 0,
    pinInstancesWithoutWire: 0,
    pinInstancesByEndpointKind: {
      PART_SYMBOL_PIN: 1,
      BLOCK_SYMBOL_PIN: 0,
      NET_FLAG_PIN: 0,
      NET_PORT_PIN: 0,
      SHEET_SYMBOL_PIN: 0,
      NONELECTRICAL_SYMBOL_PIN: 0,
      SHORT_SYMBOL_PIN: 0,
      UNKNOWN_SYMBOL_PIN: 0
    },
    shortRelations: 0,
    shortRelationsReadyExplicitNetPairCandidate: 0,
    shortRelationsSameExplicitNetCandidate: 0,
    shortRelationsUnresolvedPinConnectionCandidate: 0,
    shortRelationsConflictingPinConnectionCandidate: 0,
    shortRelationsInvalidPinCount: 0,
    networkEndpointCandidates: 0,
    networkEndpointCandidatesMatching: 0,
    networkEndpointCandidatesMismatching: 0,
    networkEndpointCandidatesMissingDeclaration: 0,
    networkEndpointCandidatesConflictingDeclaration: 0,
    networkEndpointCandidatesInvalidDeclarationValue: 0,
    networkEndpointCandidatesUnresolvedConnection: 0,
    networkEndpointCandidatesInvalidPinCount: 0,
    unboundAttributes: 0,
    unmodeledRecords: 2
  });

  assert.equal(ir.projectConfigurations[0]?.defaultSheetId, "page-1");
  assert.equal(ir.boards[0]?.title, "Fixture Board");
  assert.equal(ir.schematics[0]?.boardId, "board-1");
  assert.equal(ir.schematicPages[0]?.schematicId, "schematic-1");
  assert.equal(ir.variants[0]?.title, "Default");
  assert.equal(ir.variants[0]?.schematicId, "schematic-1");
  assert.equal(ir.variants[0]?.hasUngroupedComponents, false);
  assert.deepEqual(
    ir.componentGroups.map((group) => ({
      id: group.id,
      directVariantId: group.directVariantId,
      indexes: group.variantIndexes.map((index) => index.variantId),
      overrides: group.overrides.map((override) => ({
        targetPrimitiveId: override.targetPrimitiveId,
        instancePageId: override.instancePageId,
        attributes: override.attributes
      }))
    })),
    [
      {
        id: "component-group-direct",
        directVariantId: "variant-1",
        indexes: [],
        overrides: [
          {
            targetPrimitiveId: "component-1",
            instancePageId: "schematic-1_$1",
            attributes: { DNP: "yes" }
          }
        ]
      },
      {
        id: "component-group-indexed",
        directVariantId: undefined,
        indexes: ["variant-1"],
        overrides: [
          {
            targetPrimitiveId: "component-1",
            instancePageId: "schematic-1_$1",
            attributes: { Designator: "U1A" }
          }
        ]
      }
    ]
  );
  assert.deepEqual(ir.instanceContexts, [
    {
      id: "schematic-1_$5|block-a_$01",
      pathEncoding: "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID",
      schematicId: "schematic-1",
      blockPath: [
        {
          pageReference: "5",
          sheetNumber: "5",
          blockSymbolId: "block-a",
          targetPageId: "page-1",
          resolutionStatus: "SOURCE_PAGE_NOT_FOUND"
        }
      ],
      terminalPageReference: "01",
      terminalSheetNumber: "01",
      terminalPageId: "page-1",
      resolutionStatus: "SOURCE_PAGE_NOT_FOUND",
      overrides: [
        {
          targetPrimitiveId: "component-1",
          attributes: { Designator: "U1A" },
          applicationStatus: "CONTEXT_NOT_RESOLVED",
          provenance: {
            documentId: "schematic-1_$5|block-a_$01",
            documentType: "INSTANCE",
            recordType: "INSTANCE_ATTR",
            recordId: "component-1",
            ticket: 66,
            client: "client-a",
            entry: "epru-1",
            line: 66
          },
          extensions: { easyeda: { Designator: "U1A" } }
        },
        {
          targetPrimitiveId: "component-1pin-1",
          attributes: { NO_CONNECT: "yes" },
          applicationStatus: "CONTEXT_NOT_RESOLVED",
          provenance: {
            documentId: "schematic-1_$5|block-a_$01",
            documentType: "INSTANCE",
            recordType: "INSTANCE_ATTR",
            recordId: "component-1pin-1",
            ticket: 67,
            client: "client-a",
            entry: "epru-1",
            line: 67
          },
          extensions: { easyeda: { NO_CONNECT: "yes" } }
        }
      ],
      provenance: [{ client: "client-a", entry: "epru-1", line: 65 }]
    }
  ]);
  assert.equal(ir.schematicPages[0]?.sortOrder, 1);

  const component = ir.components[0];
  assert.ok(component);
  assert.equal(component.designator, "U1");
  assert.equal(component.deviceId, "device-1");
  assert.equal(component.symbolId, "symbol-1");
  assert.equal(component.footprintId, "footprint-1");
  assert.equal(component.symbolBinding.state, "BOUND_DEVICE_DEFAULT");
  assert.equal(component.symbolBinding.deviceDefault?.value, "symbol-1");
  assert.equal(component.footprintBinding.state, "BOUND_COMPONENT_OVERRIDE");
  assert.equal(component.pinCompleteness.status, "COMPLETE");
  assert.equal(component.pinCompleteness.hiddenPinCount, 1);
  assert.equal(
    component.footprintBinding.deviceDefault?.value,
    "footprint-default"
  );
  assert.deepEqual(component.position, { x: 10, y: 20 });
  assert.equal(component.extensions.easyeda.futureField, "preserved");
  assert.deepEqual(component.provenance, {
    documentId: "page-1",
    documentType: "SCH_PAGE",
    recordType: "COMPONENT",
    recordId: "component-1",
    ticket: 3,
    client: "client-a",
    entry: "epru-1",
    line: 3
  });

  const pin = ir.symbolPins[0];
  assert.ok(pin);
  assert.equal(pin.name, "PA0");
  assert.equal(pin.number, "1");
  assert.equal(pin.electricalType, "BI");
  assert.equal(pin.display, false);

  const wire = ir.wires[0];
  assert.ok(wire);
  assert.equal(wire.explicitNetName, "VCC");
  assert.deepEqual(wire.segments[0]?.start, { x: 0, y: 0 });
  assert.deepEqual(wire.segments[0]?.end, { x: 10, y: 0 });

  assert.equal(
    ir.pinInstances[0]?.connectionCandidate.status,
    "DECLARED_NO_CONNECT"
  );
  assert.equal(
    ir.pinInstances[0]?.noConnectDeclaration?.state,
    "DECLARED_NO_CONNECT"
  );
  assert.deepEqual(
    ir.pinInstances[0]?.instanceAttributes.map((attribute) => attribute.key),
    ["NO_CONNECT", "NO_CONNECT"]
  );
  assert.equal(ir.pinInstances[0]?.endpointKind, "PART_SYMBOL_PIN");
  assert.equal(ir.pinInstances[0]?.display, false);
  assert.match(ir.irSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(ir, compileV3ToEdaIr(reducer, ARCHIVE_SHA));
});



test("原理图页 TEXT 只保留显式内容与原始位置，不执行语义解释", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-annotations", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, {
    name: "Annotations",
    schematic: "schematic-a"
  });
  accept(reducer, page, 3, "TEXT", "annotation-observed", {
    x: 10.5,
    y: -20,
    rotation: 0,
    value: "Power input notes",
    align: "LEFT_BOTTOM",
    color: "#ffffff"
  });
  accept(reducer, page, 4, "TEXT", "annotation-official-empty", {
    positionX: 30,
    positionY: 40,
    rotation: 90,
    value: "",
    vAlign: 1,
    hAlign: 2
  });
  accept(reducer, page, 5, "TEXT", "annotation-invalid", {
    x: 1,
    y: 2,
    rotation: 0,
    value: 123
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.schemaVersion, "1.1.0");
  assert.equal(ir.generator.version, "0.1.0");
  assert.equal(ir.summary.schematicAnnotations, 2);
  assert.equal(ir.summary.schematicAnnotationsWithExplicitText, 1);
  assert.equal(ir.summary.schematicAnnotationsWithExplicitEmpty, 1);
  assert.deepEqual(ir.schematicAnnotations[0], {
    id: "annotation-observed",
    pageId: "page-annotations",
    text: "Power input notes",
    contentState: "EXPLICIT_TEXT",
    position: { x: 10.5, y: -20 },
    rotation: 0,
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    basis: "EXPLICIT_SCHEMATIC_TEXT_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      documentId: "page-annotations",
      documentType: "SCH_PAGE",
      recordType: "TEXT",
      recordId: "annotation-observed",
      ticket: 3,
      client: "client-a",
      entry: "epru-1",
      line: 3
    },
    extensions: {
      easyeda: {
        x: 10.5,
        y: -20,
        rotation: 0,
        value: "Power input notes",
        align: "LEFT_BOTTOM",
        color: "#ffffff"
      }
    }
  });
  assert.equal(ir.schematicAnnotations[1]?.contentState, "EXPLICIT_EMPTY");
  assert.deepEqual(ir.schematicAnnotations[1]?.position, { x: 30, y: 40 });
  assert.equal(
    ir.diagnostics.find(
      (diagnostic) => diagnostic.code === "IR_INVALID_SCHEMATIC_ANNOTATION"
    )?.count,
    1
  );
  assert.deepEqual(
    ir.unmodeledRecords
      .filter((record) => record.provenance.recordType === "TEXT")
      .map((record) => record.provenance.recordId),
    ["annotation-invalid"]
  );
});

test("符号 TEXT 保留显式内容并严格绑定同文档 PART", () => {
  const reducer = new V3Reducer(LIMITS);
  const symbol = enter(reducer, "symbol-texts", "SYMBOL", 1);
  accept(reducer, symbol, 2, "META", undefined, { title: "Fixture" });
  accept(reducer, symbol, 3, "PART", "part-a", { title: "A" });
  accept(reducer, symbol, 4, "TEXT", "text-resolved", {
    partId: "part-a",
    x: 10,
    y: 20,
    rotation: 0,
    value: "UART_TX",
    fontSize: 12
  });
  accept(reducer, symbol, 5, "TEXT", "text-empty", {
    partId: "",
    positionX: 30,
    positionY: 40,
    rotation: 90,
    value: ""
  });
  accept(reducer, symbol, 6, "TEXT", "text-missing-part", {
    partId: "part-missing",
    x: 50,
    y: 60,
    rotation: 180,
    value: "Power"
  });
  accept(reducer, symbol, 7, "TEXT", "text-invalid", {
    partId: "part-a",
    x: 1,
    y: 2,
    rotation: 0,
    value: 123
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.schemaVersion, "1.1.0");
  assert.equal(ir.generator.version, "0.1.0");
  assert.equal(ir.summary.symbolTexts, 3);
  assert.equal(ir.summary.symbolTextsWithExplicitText, 2);
  assert.equal(ir.summary.symbolTextsWithExplicitEmpty, 1);
  assert.equal(ir.summary.symbolTextsResolvedExact, 1);
  assert.equal(ir.summary.symbolTextsWithExplicitEmptyPart, 1);
  assert.equal(ir.summary.symbolTextsWithPartNotFound, 1);
  assert.deepEqual(ir.symbolTexts[0], {
    id: "text-empty",
    symbolId: "symbol-texts",
    partBinding: { state: "EXPLICIT_EMPTY" },
    text: "",
    contentState: "EXPLICIT_EMPTY",
    position: { x: 30, y: 40 },
    rotation: 90,
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    basis: "EXPLICIT_SYMBOL_TEXT_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      documentId: "symbol-texts",
      documentType: "SYMBOL",
      recordType: "TEXT",
      recordId: "text-empty",
      ticket: 5,
      client: "client-a",
      entry: "epru-1",
      line: 5
    },
    extensions: {
      easyeda: {
        partId: "",
        positionX: 30,
        positionY: 40,
        rotation: 90,
        value: ""
      }
    }
  });
  assert.equal(ir.symbolTexts[1]?.partBinding.state, "RESOLVED_EXACT");
  assert.equal(ir.symbolTexts[2]?.partBinding.state, "PART_NOT_FOUND");
  assert.equal(
    ir.diagnostics.find(
      (item) => item.code === "IR_INVALID_SYMBOL_TEXT"
    )?.count,
    1
  );
  assert.equal(
    ir.diagnostics.find(
      (item) => item.code === "IR_SYMBOL_TEXT_PART_NOT_FOUND"
    )?.count,
    1
  );
  assert.deepEqual(
    ir.unmodeledRecords
      .filter(
        (record) =>
          record.provenance.documentType === "SYMBOL" &&
          record.provenance.recordType === "TEXT"
      )
      .map((record) => record.provenance.recordId),
    ["text-invalid"]
  );
});



























test("CONFIG 兼容字段保留但不冒充官方默认页，并拒绝其他断链引用", () => {
  const reducer = new V3Reducer(LIMITS);
  const configuration = enter(reducer, "config-observed", "CONFIG", 1);
  accept(reducer, configuration, 2, "META", undefined, {
    defaultSheet: "missing-page"
  });
  const board = enter(reducer, "board-observed", "BOARD", 3);
  accept(reducer, board, 4, "META", undefined, {
    title: "Board",
    zIndex: 1
  });
  const schematic = enter(reducer, "schematic-observed", "SCH", 5);
  accept(reducer, schematic, 6, "META", undefined, {
    title: "Schematic",
    board: "missing-board",
    zIndex: null
  });
  const page = enter(reducer, "page-observed", "SCH_PAGE", 7);
  accept(reducer, page, 8, "META", undefined, {
    title: "Page",
    schematic: "missing-schematic",
    zIndex: 2
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);

  assert.equal(ir.projectConfigurations[0]?.defaultSheetId, undefined);
  assert.equal(
    ir.projectConfigurations[0]?.extensions.easyeda.defaultSheet,
    "missing-page"
  );
  assert.equal(ir.boards[0]?.sortOrder, 1);
  assert.equal(ir.schematics[0]?.title, "Schematic");
  assert.equal(ir.schematicPages[0]?.sortOrder, 2);
  assert.equal(ir.summary.hierarchyBrokenReferences, 2);
  assert.deepEqual(
    ir.diagnostics
      .filter((diagnostic) => diagnostic.code.endsWith("REFERENCE_NOT_FOUND"))
      .map((diagnostic) => diagnostic.code),
    [
      "IR_SCHEMATIC_BOARD_REFERENCE_NOT_FOUND",
      "IR_SCHEMATIC_PAGE_REFERENCE_NOT_FOUND"
    ]
  );
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_PROJECT_CONFIG_COMPAT_FIELD_UNVERIFIED"
    ),
    true
  );
});

test("兼容官方 WIRE.dots 表示并保留每段来源", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-dots", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Dots" });
  accept(reducer, page, 3, "WIRE", "wire-dots", {
    dots: [
      [0, 0, 10, 0, 10, 20],
      [30, 30, 40, 30]
    ]
  });
  attribute(reducer, page, 4, "net", "wire-dots", "NET", "DATA");

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.wires[0]?.segments.length, 3);
  assert.deepEqual(
    ir.wires[0]?.segments.map((segment) => segment.id),
    ["wire-dots:dots:0:0", "wire-dots:dots:0:1", "wire-dots:dots:1:0"]
  );
  assert.equal(
    ir.wires[0]?.segments.every(
      (segment) => segment.provenance.recordId === "wire-dots"
    ),
    true
  );
});

test("同时建模官方独立 BUSENTRY 与当前导出的内嵌 busEntry", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-bus", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Bus" });
  accept(reducer, page, 3, "BUS", "bus-observed", {
    groupId: "",
    locked: false,
    zIndex: 1,
    busEntry: {
      "entry-observed-b": {
        order: 1,
        pointX: 20,
        pointY: 30,
        rotation: 90,
        futureField: "preserved"
      },
      "entry-observed-a": {
        order: 0,
        pointX: 10,
        pointY: 30,
        rotation: 90
      }
    }
  });
  attribute(
    reducer,
    page,
    4,
    "net-observed",
    "bus-observed",
    "NET",
    "DATA[7:0]"
  );
  accept(reducer, page, 5, "BUS", "bus-official", {
    groupId: "",
    locked: false,
    zIndex: 2,
    dots: [[0, 0, 0, 20, 20, 20]]
  });
  attribute(
    reducer,
    page,
    6,
    "net-official",
    "bus-official",
    "NET",
    "CTRL[1:0]"
  );
  accept(reducer, page, 7, "BUSENTRY", "entry-official-bound", {
    parentId: "bus-official",
    busGroupId: 0,
    order: 0,
    pointX: 0,
    pointY: 10,
    rotation: 180
  });
  accept(reducer, page, 8, "BUSENTRY", "entry-official-unbound", {
    busGroupId: 1,
    order: 1,
    pointX: 0,
    pointY: 20,
    rotation: 180
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);

  assert.equal(ir.summary.buses, 2);
  assert.equal(ir.summary.busesWithExplicitNet, 2);
  assert.equal(ir.summary.busSegments, 2);
  assert.equal(ir.summary.busEntries, 4);
  assert.equal(ir.summary.busEntriesEmbedded, 2);
  assert.equal(ir.summary.busEntriesSeparate, 2);
  assert.equal(ir.summary.busEntriesUnbound, 1);
  assert.equal(ir.unboundAttributes.length, 0);
  const observed = ir.buses.find((bus) => bus.id === "bus-observed");
  assert.equal(observed?.encoding, "OBSERVED_EMBEDDED_BUSENTRY_MAP");
  assert.equal(observed?.explicitNetName, "DATA[7:0]");
  assert.equal(observed?.memberExpansion, "NOT_PERFORMED");
  assert.deepEqual(observed?.entryIds, [
    "entry-observed-a",
    "entry-observed-b"
  ]);
  assert.equal(
    ir.busEntries.find((entry) => entry.id === "entry-observed-b")
      ?.extensions.easyeda.futureField,
    "preserved"
  );
  const official = ir.buses.find((bus) => bus.id === "bus-official");
  assert.equal(
    official?.encoding,
    "OFFICIAL_DOTS_WITH_SEPARATE_BUSENTRY_RECORDS"
  );
  assert.equal(official?.segments.length, 2);
  assert.deepEqual(official?.entryIds, ["entry-official-bound"]);
  assert.equal(
    ir.busEntries.find((entry) => entry.id === "entry-official-unbound")
      ?.associationStatus,
    "SEPARATE_RECORD_WITHOUT_EXPLICIT_BUS_ID"
  );
});

test("空 BUS 成员表可见，损坏入口和重复 order 使用稳定诊断", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-bus-invalid", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Bus invalid" });
  accept(reducer, page, 3, "BUS", "bus-empty", {
    busEntry: {}
  });
  attribute(reducer, page, 4, "net-empty", "bus-empty", "NET", "EMPTY[]");
  accept(reducer, page, 5, "BUS", "bus-partial", {
    busEntry: {
      "entry-a": {
        order: 0,
        pointX: 1,
        pointY: 2,
        rotation: 0
      },
      "entry-b": {
        order: 0,
        pointX: 3,
        pointY: 4,
        rotation: 0
      },
      "entry-invalid": {
        order: 2,
        pointX: 5,
        rotation: 0
      }
    }
  });
  attribute(
    reducer,
    page,
    6,
    "net-partial",
    "bus-partial",
    "NET",
    "PARTIAL[1:0]"
  );
  accept(reducer, page, 7, "BUS", "bus-invalid", {
    busEntry: []
  });
  accept(reducer, page, 8, "BUSENTRY", "entry-invalid-separate", {
    order: 0,
    pointX: 0,
    pointY: 0,
    rotation: 0
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);

  assert.equal(ir.summary.buses, 2);
  assert.equal(ir.summary.busesWithEmptyEntrySet, 1);
  assert.equal(ir.summary.busEntries, 2);
  assert.equal(ir.summary.unmodeledRecords, 2);
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_INVALID_EMBEDDED_BUS_ENTRY" &&
        diagnostic.count === 1
    ),
    true
  );
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_BUS_ENTRY_ORDER_DUPLICATE" &&
        diagnostic.count === 1
    ),
    true
  );
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) => diagnostic.code === "IR_INVALID_SEPARATE_BUS_ENTRY"
    ),
    true
  );
});

test("冲突派生属性不会被静默选择", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-conflict", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Conflict" });
  accept(reducer, page, 3, "COMPONENT", "component", {
    partId: "",
    positionX: 1,
    positionY: 2,
    rotation: 0,
    isMirror: false
  });
  attribute(reducer, page, 4, "designator-a", "component", "Designator", "U1");
  attribute(reducer, page, 5, "designator-b", "component", "Designator", "U2");

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.components[0]?.designator, undefined);
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_ATTRIBUTE_CONFLICT" && diagnostic.count === 1
    ),
    true
  );
});

test("Variant 与元件组断链、循环和非法覆盖使用稳定诊断而不猜测", () => {
  const reducer = new V3Reducer(LIMITS);
  const variant = enter(reducer, "variant-broken", "VARIANT", 1);
  accept(reducer, variant, 2, "META", undefined, {
    title: "Broken",
    schematicId: "missing-schematic",
    zIndex: 1,
    notGrouped: true
  });
  const groupA = enter(reducer, "group-a", "COMPONENT_GROUP", 3);
  accept(reducer, groupA, 4, "META", undefined, {
    title: "A",
    parent: "group-b",
    belong: "missing-variant",
    schematicId: "missing-schematic",
    zIndex: 1
  });
  accept(reducer, groupA, 5, "GROUP_INDEX", "missing-variant", {
    zIndex: 1
  });
  accept(reducer, groupA, 6, "GROUP_DATA", "invalid-compound-id", {
    DNP: "yes"
  });
  const groupB = enter(reducer, "group-b", "COMPONENT_GROUP", 7);
  accept(reducer, groupB, 8, "META", undefined, {
    title: "B",
    parent: "group-a",
    belong: "",
    schematicId: "",
    zIndex: 2
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);

  assert.equal(ir.summary.variantsWithMissingSchematic, 1);
  assert.equal(ir.summary.componentGroupsWithMissingSchematic, 1);
  assert.equal(ir.summary.componentGroupsWithBrokenParent, 2);
  assert.equal(ir.summary.componentGroupsWithMissingDirectVariant, 1);
  assert.equal(ir.summary.componentGroupsWithConflictingMembership, 1);
  assert.equal(
    ir.summary.componentGroupVariantIndexesWithMissingVariant,
    1
  );
  assert.equal(ir.summary.componentGroupOverrides, 0);
  assert.equal(ir.summary.variantGroupBrokenReferences, 7);
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_COMPONENT_GROUP_DATA_INVALID" &&
        diagnostic.count === 1
    ),
    true
  );
  assert.equal(
    ir.unmodeledRecords.filter(
      (record) => record.provenance.recordType === "GROUP_DATA"
    ).length,
    1
  );
});

test("非法 INSTANCE 路径、属性和缺失 Schematic 使用稳定诊断且不猜页映射", () => {
  const reducer = new V3Reducer(LIMITS);
  const missingSchematic = enter(
    reducer,
    "missing-schematic_$02",
    "INSTANCE",
    1
  );
  accept(reducer, missingSchematic, 2, "INSTANCE_ATTR", "component-a", {
    Value: "10k"
  });
  accept(reducer, missingSchematic, 3, "INSTANCE_ATTR", undefined, {
    Value: "invalid"
  });
  accept(reducer, missingSchematic, 4, "UNKNOWN", "unknown", {
    future: true
  });
  const invalidPath = enter(reducer, "schematic-a_bad", "INSTANCE", 5);
  accept(reducer, invalidPath, 6, "INSTANCE_ATTR", "component-b", {
    Value: "1k"
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);

  assert.equal(ir.summary.instanceDocuments, 2);
  assert.equal(ir.summary.instanceContexts, 1);
  assert.equal(ir.summary.instanceDocumentsWithInvalidPath, 1);
  assert.equal(ir.summary.instanceContextsWithMissingSchematic, 1);
  assert.equal(ir.summary.instanceAttributeOverrides, 1);
  assert.equal(ir.instanceContexts[0]?.terminalSheetNumber, "02");
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_INSTANCE_PATH_INVALID" &&
        diagnostic.count === 1
    ),
    true
  );
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_INSTANCE_ATTRIBUTE_INVALID" &&
        diagnostic.count === 1
    ),
    true
  );
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_INSTANCE_SCHEMATIC_REFERENCE_NOT_FOUND" &&
        diagnostic.count === 1
    ),
    true
  );
  assert.equal(
    ir.unmodeledRecords.filter(
      (record) => record.provenance.documentType === "INSTANCE"
    ).length,
    3
  );
});

test("最终删除的文档和墓碑不会进入活动 EDA-IR", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "deleted-page", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Deleted" });
  reducer.accept(
    page,
    {
      outer: { type: "TEXT", id: "deleted-text", ticket: 3 },
      inner: ""
    },
    source(3),
    10
  );
  accept(reducer, page, 4, "DELETE_DOC", undefined, { isDelete: true });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.summary.documents, 0);
  assert.equal(ir.summary.schematicPages, 0);
  assert.equal(ir.summary.unmodeledRecords, 0);
  assert.deepEqual(ir.documents, []);
});

test("编译原理图页与符号中的 V3 内联结构化表格", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-table", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, {
    title: "Configuration"
  });
  accept(reducer, page, 3, "TABLE", "table-page", {
    startX: 10,
    startY: 20,
    rowSizes: [12, 12],
    colSizes: [30, 40],
    rowLocked: [0, 1],
    colLocked: [false, true],
    rotation: 0,
    tableCell: [
      {
        id: "cell-a",
        value: "BOOT0",
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 1,
        colSpan: 1,
        futureStyle: { color: "#fff" }
      },
      {
        id: "cell-b",
        value: "",
        rowIndex: 0,
        columnIndex: 1,
        rowSpan: 2,
        colSpan: 1
      }
    ]
  });

  const symbol = enter(reducer, "symbol-table", "SYMBOL", 10);
  accept(reducer, symbol, 11, "META", undefined, { title: "Switch" });
  accept(reducer, symbol, 12, "PART", "part-a", { title: "A" });
  accept(reducer, symbol, 13, "TABLE", "table-symbol", {
    partId: "part-a",
    startX: 1,
    startY: 2,
    rowSizes: [10],
    colSizes: [20],
    rowLocked: [false],
    colLocked: [false],
    rotation: 90,
    tableCell: [
      {
        id: "cell-symbol",
        value: "ON",
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 1,
        colSpan: 1
      }
    ]
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.summary.schematicTables, 2);
  assert.equal(ir.summary.schematicTablesInPages, 1);
  assert.equal(ir.summary.schematicTablesInSymbols, 1);
  assert.equal(ir.summary.schematicTableCells, 3);
  assert.equal(ir.summary.schematicTableCellsWithExplicitText, 2);
  assert.equal(ir.summary.schematicTableCellsWithExplicitEmpty, 1);
  assert.equal(ir.summary.schematicTableCellsFromInlineRecords, 3);
  assert.equal(ir.summary.schematicTablesResolvedExactPart, 1);
  assert.equal(ir.schematicTables[0]?.lockEncoding, "MIXED_BOOLEAN_AND_INTEGER_0_1");
  assert.deepEqual(ir.schematicTables[0]?.cells[0], {
    id: "cell-a",
    value: "BOOT0",
    contentState: "EXPLICIT_TEXT",
    rowIndex: 0,
    columnIndex: 0,
    rowSpan: 1,
    columnSpan: 1,
    representation: "V3_INLINE_TABLE_CELL",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: [
      {
        documentId: "page-table",
        documentType: "SCH_PAGE",
        recordType: "TABLE",
        recordId: "table-page",
        ticket: 3,
        client: "client-a",
        entry: "epru-1",
        line: 3
      }
    ],
    extensions: {
      easyeda: {
        id: "cell-a",
        value: "BOOT0",
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 1,
        colSpan: 1,
        futureStyle: { color: "#fff" }
      }
    }
  });
  assert.deepEqual(ir.schematicTables[1]?.partBinding, {
    state: "RESOLVED_EXACT",
    targetId: "part-a"
  });
});

test("兼容官方独立 TABLE 单元格与内联/独立双表示一致", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-table", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Tables" });
  accept(reducer, page, 3, "TABLE", "table-official", {
    startX: 0,
    startY: 0,
    rowSizes: [10],
    colSizes: [20],
    rowLocked: [0],
    colLocked: [0],
    rotation: 0
  });
  accept(reducer, page, 4, "TABLE", "official-cell", {
    tableId: "table-official",
    value: "separate",
    rowIndex: 0,
    columnIndex: 0,
    rowSpan: 1,
    colSpan: 1
  });
  accept(reducer, page, 5, "TABLE", "table-both", {
    startX: 10,
    startY: 20,
    rowSizes: [10],
    colSizes: [20],
    rowLocked: [0],
    colLocked: [0],
    rotation: 0,
    tableCell: [
      {
        id: "both-cell",
        value: "matching",
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 1,
        colSpan: 1
      }
    ]
  });
  accept(reducer, page, 6, "TABLE_CELL", "both-cell", {
    tableId: "table-both",
    value: "matching",
    rowIndex: 0,
    columnIndex: 0,
    rowSpan: 1,
    colSpan: 1
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.summary.schematicTables, 2);
  assert.equal(ir.summary.schematicTableCellsFromSeparateRecords, 1);
  assert.equal(ir.summary.schematicTableCellsFromBothMatching, 1);
  assert.equal(
    ir.schematicTables[0]?.cells[0]?.representation,
    "BOTH_MATCHING"
  );
  assert.equal(ir.schematicTables[0]?.cells[0]?.provenance.length, 2);
  assert.equal(
    ir.schematicTables[1]?.cells[0]?.representation,
    "OFFICIAL_SEPARATE_TABLE_RECORD"
  );
});

test("拒绝越界、重复或双表示冲突的 TABLE 单元格并保留来源", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-table", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Invalid" });
  accept(reducer, page, 3, "TABLE", "table-conflict", {
    startX: 0,
    startY: 0,
    rowSizes: [10],
    colSizes: [20],
    rowLocked: [0],
    colLocked: [0],
    rotation: 0,
    tableCell: [
      {
        id: "cell-a",
        value: "inline",
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 1,
        colSpan: 1
      }
    ]
  });
  accept(reducer, page, 4, "TABLE_CELL", "cell-a", {
    tableId: "table-conflict",
    value: "conflict",
    rowIndex: 0,
    columnIndex: 0,
    rowSpan: 1,
    colSpan: 1
  });
  accept(reducer, page, 5, "TABLE_CELL", "orphan", {
    tableId: "missing-table",
    value: "orphan",
    rowIndex: 0,
    columnIndex: 0,
    rowSpan: 1,
    colSpan: 1
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.summary.schematicTables, 0);
  assert.equal(ir.summary.unmodeledRecords, 3);
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_INVALID_SCHEMATIC_TABLE_CELL"
    ),
    true
  );
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_SCHEMATIC_TABLE_CELL_TABLE_NOT_FOUND"
    ),
    true
  );
});

test("编译 SCH_PAGE/SYMBOL 五类显式图形并兼容两种 POLY 点编码", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-shapes", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Shapes" });
  accept(reducer, page, 3, "POLY", "page-poly", {
    groupId: "",
    locked: false,
    zIndex: 1,
    points: [0, 0, 10, 0, 10, 10],
    closed: true,
    strokeColor: null,
    strokeStyle: 0,
    fillColor: "",
    strokeWidth: null,
    fillStyle: 1
  });
  accept(reducer, page, 4, "RECT", "page-rect", {
    groupId: "",
    locked: true,
    zIndex: 2,
    dotX1: 1,
    dotY1: 2,
    dotX2: 11,
    dotY2: 22,
    radiusX: 3,
    radiusY: 4,
    rotation: 90,
    strokeColor: "#ff0000",
    strokeStyle: "SHORT_DASH",
    fillColor: null,
    strokeWidth: 0.5,
    fillStyle: null
  });
  accept(reducer, page, 5, "ELLIPSE", "page-ellipse", {
    groupId: "",
    locked: false,
    zIndex: 3,
    centerX: 12,
    centerY: 13,
    radiusX: 4,
    radiusY: 2,
    rotation: 0,
    strokeColor: null,
    strokeStyle: 0,
    fillColor: "",
    strokeWidth: null,
    fillStyle: 0
  });

  const symbol = enter(reducer, "symbol-shapes", "SYMBOL", 10);
  accept(reducer, symbol, 11, "META", undefined, {
    title: "Symbol",
    docType: 0
  });
  accept(reducer, symbol, 12, "PART", "part-a", { title: "A" });
  accept(reducer, symbol, 13, "POLY", "symbol-poly", {
    partId: "part-a",
    groupId: "",
    locked: false,
    zIndex: 1,
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 }
    ],
    closed: false,
    strokeColor: null,
    strokeStyle: null,
    fillColor: null,
    strokeWidth: null,
    fillStyle: null
  });
  accept(reducer, symbol, 14, "CIRCLE", "symbol-circle", {
    partId: "part-a",
    groupId: "",
    locked: false,
    zIndex: 2,
    centerX: 4,
    centerY: 5,
    radius: 6,
    strokeColor: null,
    strokeStyle: null,
    fillColor: null,
    strokeWidth: null,
    fillStyle: null
  });
  accept(reducer, symbol, 15, "ARC", "symbol-arc", {
    partId: "part-a",
    groupId: "",
    locked: false,
    zIndex: 3,
    startX: 0,
    startY: 1,
    referX: 2,
    referY: 3,
    endX: 4,
    endY: 5,
    strokeColor: null,
    strokeStyle: null,
    fillColor: null,
    strokeWidth: null,
    fillStyle: null
  });
  accept(reducer, symbol, 16, "ELLIPSE", "symbol-ellipse", {
    partId: "missing-part",
    groupId: "",
    locked: false,
    zIndex: 4,
    centerX: 7,
    centerY: 8,
    radiusX: 9,
    radiusY: -10,
    rotation: 45,
    strokeColor: null,
    strokeStyle: null,
    fillColor: null,
    strokeWidth: null,
    fillStyle: null
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.schemaVersion, "1.1.0");
  assert.equal(ir.generator.version, "0.1.0");
  assert.equal(ir.summary.schematicGraphicPrimitives, 7);
  assert.equal(ir.summary.schematicGraphicPrimitivesInPages, 3);
  assert.equal(ir.summary.schematicGraphicPrimitivesInSymbols, 4);
  assert.equal(ir.summary.schematicGraphicPolygons, 2);
  assert.equal(ir.summary.schematicGraphicRectangles, 1);
  assert.equal(ir.summary.schematicGraphicArcs, 1);
  assert.equal(ir.summary.schematicGraphicCircles, 1);
  assert.equal(ir.summary.schematicGraphicEllipses, 2);
  assert.equal(ir.summary.schematicGraphicPrimitivesResolvedExactPart, 3);
  assert.equal(ir.summary.schematicGraphicPrimitivesWithPartNotFound, 1);
  const pagePoly = ir.schematicGraphicPrimitives.find(
    (primitive) => primitive.id === "page-poly"
  );
  const symbolPoly = ir.schematicGraphicPrimitives.find(
    (primitive) => primitive.id === "symbol-poly"
  );
  const pageEllipse = ir.schematicGraphicPrimitives.find(
    (primitive) => primitive.id === "page-ellipse"
  );
  assert.equal(pagePoly?.geometry.kind, "POLY");
  assert.equal(
    pagePoly?.geometry.kind === "POLY"
      ? pagePoly.geometry.pointEncoding
      : undefined,
    "OFFICIAL_FLAT_XY_ARRAY"
  );
  assert.equal(
    symbolPoly?.geometry.kind === "POLY"
      ? symbolPoly.geometry.pointEncoding
      : undefined,
    "V3_POINT_OBJECT_ARRAY"
  );
  assert.equal(symbolPoly?.partBinding.state, "RESOLVED_EXACT");
  assert.equal(
    pageEllipse?.geometry.kind === "ELLIPSE"
      ? pageEllipse.geometry.radiusEncoding
      : undefined,
    "OFFICIAL_NONNEGATIVE_RADII"
  );
  const signedEllipse = ir.schematicGraphicPrimitives.find(
    (primitive) => primitive.id === "symbol-ellipse"
  );
  assert.equal(
    signedEllipse?.geometry.kind === "ELLIPSE"
      ? signedEllipse.geometry.radiusY
      : undefined,
    -10
  );
  assert.equal(
    signedEllipse?.geometry.kind === "ELLIPSE"
      ? signedEllipse.geometry.radiusEncoding
      : undefined,
    "V3_SIGNED_RADII"
  );
  assert.equal(
    signedEllipse?.partBinding.state,
    "PART_NOT_FOUND"
  );
  assert.equal(
    ir.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "IR_SCHEMATIC_GRAPHIC_PART_NOT_FOUND"
    ),
    true
  );
});

test("拒绝非法原理图图形并保留来源", () => {
  const reducer = new V3Reducer(LIMITS);
  const page = enter(reducer, "page-invalid-shapes", "SCH_PAGE", 1);
  accept(reducer, page, 2, "META", undefined, { title: "Invalid Shapes" });
  accept(reducer, page, 3, "POLY", "odd-poly", {
    groupId: "",
    locked: false,
    zIndex: 1,
    points: [0, 0, 1],
    closed: false,
    strokeColor: null,
    strokeStyle: null,
    fillColor: null,
    strokeWidth: null,
    fillStyle: null
  });
  accept(reducer, page, 4, "CIRCLE", "negative-circle", {
    groupId: "",
    locked: false,
    zIndex: 2,
    centerX: 0,
    centerY: 0,
    radius: -1,
    strokeColor: null,
    strokeStyle: null,
    fillColor: null,
    strokeWidth: null,
    fillStyle: null
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.summary.schematicGraphicPrimitives, 0);
  assert.equal(ir.summary.unmodeledRecords, 2);
  assert.equal(
    ir.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "IR_INVALID_SCHEMATIC_GRAPHIC" &&
        diagnostic.recordType === "POLY"
    )?.count,
    1
  );
  assert.equal(
    ir.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "IR_INVALID_SCHEMATIC_GRAPHIC" &&
        diagnostic.recordType === "CIRCLE"
    )?.count,
    1
  );
});

test("解析当前导出的层级实例路径并应用组件实例覆盖", () => {
  const reducer = new V3Reducer(LIMITS);
  const schematic = enter(reducer, "sch-hierarchy", "SCH", 1);
  accept(reducer, schematic, 2, "META", undefined, {
    name: "Hierarchy",
    board: ""
  });

  const blockSymbol = enter(reducer, "symbol-block", "SYMBOL", 3);
  accept(reducer, blockSymbol, 4, "META", undefined, {
    title: "Block",
    docType: 17
  });

  const parent = enter(reducer, "page-parent", "SCH_PAGE", 5);
  accept(reducer, parent, 6, "META", undefined, {
    name: "Parent",
    schematic: "sch-hierarchy"
  });
  accept(reducer, parent, 7, "COMPONENT", "block-1", {
    partId: "",
    positionX: 0,
    positionY: 0,
    rotation: 0,
    isMirror: false
  });
  attribute(
    reducer,
    parent,
    8,
    "attr-block-symbol",
    "block-1",
    "Symbol",
    "symbol-block"
  );

  const child = enter(reducer, "page-child", "SCH_PAGE", 9);
  accept(reducer, child, 10, "META", undefined, {
    name: "Child",
    schematic: "sch-hierarchy"
  });
  accept(reducer, child, 11, "COMPONENT", "component-child", {
    partId: "",
    positionX: 10,
    positionY: 20,
    rotation: 0,
    isMirror: false
  });
  attribute(
    reducer,
    child,
    12,
    "attr-child-designator",
    "component-child",
    "Designator",
    "R1"
  );

  const instance = enter(
    reducer,
    "sch-hierarchy_$page-parent~block-1_$page-child",
    "INSTANCE",
    13
  );
  accept(
    reducer,
    instance,
    14,
    "INSTANCE_ATTR",
    "component-child",
    { Designator: "R101", Value: "10k" }
  );
  accept(reducer, instance, 15, "INSTANCE_ATTR", "missing-target", {
    Value: "orphan"
  });

  const ir = compileV3ToEdaIr(reducer, ARCHIVE_SHA);
  assert.equal(ir.summary.instanceContextsResolved, 1);
  assert.equal(ir.summary.instanceContextsUnresolved, 0);
  assert.equal(ir.summary.instanceAttributeOverridesAppliedToComponents, 1);
  assert.equal(ir.summary.instanceAttributeOverridesUnresolved, 1);
  assert.equal(ir.summary.componentOccurrences, 1);
  assert.deepEqual(ir.instanceContexts[0], {
    id: "sch-hierarchy_$page-parent~block-1_$page-child",
    pathEncoding: "OBSERVED_PAGE_ID_TILDE_BLOCK_ID",
    schematicId: "sch-hierarchy",
    blockPath: [
      {
        pageReference: "page-parent",
        blockSymbolId: "block-1",
        sourcePageId: "page-parent",
        targetPageId: "page-child",
        resolutionStatus: "RESOLVED_EXACT"
      }
    ],
    terminalPageReference: "page-child",
    terminalPageId: "page-child",
    resolutionStatus: "RESOLVED_EXACT",
    overrides: ir.instanceContexts[0]?.overrides,
    provenance: [{ client: "client-a", entry: "epru-1", line: 13 }]
  });
  assert.equal(
    ir.instanceContexts[0]?.overrides[0]?.applicationStatus,
    "APPLIED_COMPONENT_OCCURRENCE"
  );
  assert.equal(
    ir.instanceContexts[0]?.overrides[1]?.applicationStatus,
    "TARGET_NOT_FOUND"
  );
  assert.equal(ir.componentOccurrences[0]?.designator, "R101");
  assert.deepEqual(
    ir.componentOccurrences[0]?.attributes.find(
      (attribute) => attribute.key === "Value"
    ),
    {
      key: "Value",
      values: ["10k"],
      resolution: "INSTANCE_OVERRIDE",
      provenance: [ir.instanceContexts[0]?.overrides[0]?.provenance]
    }
  );
});
