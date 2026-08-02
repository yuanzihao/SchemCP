import assert from "node:assert/strict";
import test from "node:test";
import type {
  EdaIr,
  IrAttribute,
  IrBus,
  IrBusEntry,
  IrComponent,
  IrComponentSemantic,
  IrComponentGroup,
  IrInstanceContext,
  IrInterface,
  IrNetworkEndpointCandidate,
  IrRecordProvenance,
  IrSchematicAnnotation,
  IrSchematicGraphicPrimitive,
  IrSchematicTable,
  IrShortRelationCandidate,
  IrSymbol,
  IrSymbolPin,
  IrSymbolText,
  IrVariant,
  IrWire
} from "../../src/ir/model.js";
import { compilePinInstances } from "../../src/connectivity/compile-pin-instances.js";
import {
  EdaIrQueryIndex,
  QueryError
} from "../../src/query/index.js";

const PROVENANCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  ticket: 1,
  client: "client",
  entry: "epru",
  line: 2
};

function effectiveState(id: string, pageId: string) {
  return {
    assembly: {
      status: "UNKNOWN" as const,
      reason: "ADD_INTO_BOM_MISSING" as const,
      attributeKey: "Add into BOM" as const,
      values: [],
      resolution: "MISSING" as const,
      evidenceClass: "DETERMINISTIC_RULE" as const,
      truthStatus: "NOT_VERIFIED" as const,
      semanticRuleSetVersion: "schemcp.semantic-rules/1" as const,
      provenance: []
    },
    pinCompleteness: {
      logicalComponentId: `logical-${pageId}-${id}`,
      status: "COMPLETE" as const,
      reason: "SINGLE_SYMBOL_PART_COMPLETE" as const,
      units: [{ componentId: id, pageId, partId: "part-a" }],
      declaredPartIds: ["part-a"],
      instantiatedPartIds: ["part-a"],
      missingPartIds: [],
      duplicatePartIds: [],
      symbolPinCount: 2,
      instantiatedPinCount: 2,
      hiddenPinCount: 0,
      evidenceClass: "DETERMINISTIC_RULE" as const,
      truthStatus: "NOT_VERIFIED" as const,
      semanticRuleSetVersion: "schemcp.semantic-rules/1" as const,
      provenance: []
    }
  };
}

function component(
  id: string,
  designator: string,
  pageId = "page-a"
): IrComponent {
  return {
    id,
    pageId,
    partId: "part-a",
    position: { x: 1, y: 2 },
    rotation: 0,
    mirrored: false,
    designator,
    symbolId: "symbol-a",
    symbolBinding: {
      key: "Symbol",
      state: "BOUND_COMPONENT_OVERRIDE",
      targetId: "symbol-a",
      componentAttributes: []
    },
    footprintBinding: {
      key: "Footprint",
      state: "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      componentAttributes: []
    },
    ...effectiveState(id, pageId),
    attributes: [],
    provenance: { ...PROVENANCE, documentId: pageId, recordId: id },
    extensions: { easyeda: {} }
  };
}

function schematicAnnotation(
  id: string,
  pageId: string,
  text: string
): IrSchematicAnnotation {
  return {
    id,
    pageId,
    text,
    contentState: text === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
    position: { x: 10, y: -20 },
    rotation: 0,
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    basis: "EXPLICIT_SCHEMATIC_TEXT_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      ...PROVENANCE,
      documentId: pageId,
      recordType: "TEXT",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}











function identityAttribute(
  id: string,
  key: "Supplier Part" | "Manufacturer" | "Manufacturer Part",
  value: string
): IrAttribute {
  return {
    id,
    key,
    value,
    provenance: {
      ...PROVENANCE,
      recordType: "ATTR",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function pin(id: string, number: string): IrSymbolPin {
  return {
    id,
    symbolId: "symbol-a",
    partId: "part-a",
    position: { x: 0, y: 0 },
    length: 10,
    rotation: 0,
    number,
    attributes: [],
    provenance: {
      ...PROVENANCE,
      documentId: "symbol-a",
      documentType: "SYMBOL",
      recordType: "PIN",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function wire(id: string, net: string, pageId: string): IrWire {
  return {
    id,
    pageId,
    explicitNetName: net,
    segments: [
      {
        id: `${id}:segment`,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        provenance: {
          ...PROVENANCE,
          documentId: pageId,
          recordType: "LINE",
          recordId: `${id}:segment`
        },
        extensions: { easyeda: {} }
      }
    ],
    attributes: [],
    provenance: {
      ...PROVENANCE,
      documentId: pageId,
      recordType: "WIRE",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function shortRelation(
  componentId: string,
  status: IrShortRelationCandidate["status"],
  pageId = "page-a"
): IrShortRelationCandidate {
  return {
    id: `short-${componentId}`,
    pageId,
    componentId,
    symbolId: "short-symbol",
    partId: "part-a",
    status,
    basis: "SHORT_SYMBOL_TYPE_AND_TRANSFORMED_PIN_CONTACTS",
    electricalTruth: "NOT_VERIFIED",
    explicitNetNames:
      status === "READY_EXPLICIT_NET_PAIR_CANDIDATE"
        ? ["NET_A", "NET_B"]
        : ["NET_A"],
    pins: [],
    provenance: {
      component: {
        ...PROVENANCE,
        documentId: pageId,
        recordId: componentId
      },
      symbol: {
        ...PROVENANCE,
        documentId: "short-symbol",
        documentType: "SYMBOL",
        recordType: "META"
      }
    }
  };
}

function networkEndpoint(
  componentId: string,
  endpointKind: IrNetworkEndpointCandidate["endpointKind"],
  status: IrNetworkEndpointCandidate["status"]
): IrNetworkEndpointCandidate {
  return {
    id: `endpoint-${componentId}`,
    pageId: "page-a",
    componentId,
    symbolId: `${endpointKind}-symbol`,
    partId: "part-a",
    endpointKind,
    status,
    basis: "SYMBOL_TYPE_ATTRIBUTES_AND_TRANSFORMED_PIN_CONTACTS",
    electricalTruth: "NOT_VERIFIED",
    declaredNetNameCandidate: "DATA",
    connectionNetNameCandidate: "DATA",
    pinInstanceIds: [`${componentId}-pin`],
    declarationEvidence: [],
    provenance: {
      component: { ...PROVENANCE, recordId: componentId },
      symbol: {
        ...PROVENANCE,
        documentId: `${endpointKind}-symbol`,
        documentType: "SYMBOL",
        recordType: "META"
      }
    }
  };
}

function fixture(): EdaIr {
  const components = [
    component("component-2", "R2"),
    component("component-1", "R1"),
    component("component-3", "R1", "page-b")
  ];
  const symbolPins = [pin("pin-2", "2"), pin("pin-1", "1")];
  const symbols: IrSymbol[] = [
    {
      id: "symbol-a",
      symbolType: 2,
      attributes: [],
      provenance: {
        ...PROVENANCE,
        documentId: "symbol-a",
        documentType: "SYMBOL",
        recordType: "META"
      },
      extensions: { easyeda: {} }
    }
  ];
  const wires = [
    wire("wire-1", "VCC", "page-a"),
    wire("wire-2", "VCC", "page-b"),
    wire("wire-3", "GND", "page-a")
  ];
  const pinCompilation = compilePinInstances(
    components,
    symbols,
    symbolPins,
    wires
  );
  const variants: IrVariant[] = [
    {
      id: "variant-2",
      title: "Production",
      schematicId: "schematic-a",
      sortOrder: 2,
      hasUngroupedComponents: true,
      provenance: {
        ...PROVENANCE,
        documentId: "variant-2",
        documentType: "VARIANT",
        recordType: "META"
      },
      extensions: { easyeda: {} }
    },
    {
      id: "variant-1",
      title: "Production",
      schematicId: "schematic-a",
      sortOrder: 1,
      hasUngroupedComponents: false,
      provenance: {
        ...PROVENANCE,
        documentId: "variant-1",
        documentType: "VARIANT",
        recordType: "META"
      },
      extensions: { easyeda: {} }
    }
  ];
  const componentGroups: IrComponentGroup[] = [
    {
      id: "group-indexed",
      title: "Indexed",
      schematicId: "schematic-a",
      sortOrder: 10,
      variantIndexes: [
        {
          variantId: "variant-1",
          sortOrder: 1,
          provenance: {
            ...PROVENANCE,
            documentId: "group-indexed",
            documentType: "COMPONENT_GROUP",
            recordType: "GROUP_INDEX",
            recordId: "variant-1"
          },
          extensions: { easyeda: {} }
        }
      ],
      overrides: [
        {
          targetPrimitiveId: "component-1",
          instancePageId: "page-a",
          attributes: { Designator: "R10" },
          provenance: {
            ...PROVENANCE,
            documentId: "group-indexed",
            documentType: "COMPONENT_GROUP",
            recordType: "GROUP_DATA",
            recordId: "component-1@page-a"
          },
          extensions: { easyeda: {} }
        }
      ],
      provenance: {
        ...PROVENANCE,
        documentId: "group-indexed",
        documentType: "COMPONENT_GROUP",
        recordType: "META"
      },
      extensions: { easyeda: {} }
    },
    {
      id: "group-direct",
      title: "Direct",
      directVariantId: "variant-1",
      schematicId: "schematic-a",
      sortOrder: 2,
      variantIndexes: [],
      overrides: [
        {
          targetPrimitiveId: "component-2",
          instancePageId: "schematic-a_$5|block-a_$1",
          attributes: { DNP: "yes" },
          provenance: {
            ...PROVENANCE,
            documentId: "group-direct",
            documentType: "COMPONENT_GROUP",
            recordType: "GROUP_DATA",
            recordId: "component-2@schematic-a_$5|block-a_$1"
          },
          extensions: { easyeda: {} }
        }
      ],
      provenance: {
        ...PROVENANCE,
        documentId: "group-direct",
        documentType: "COMPONENT_GROUP",
        recordType: "META"
      },
      extensions: { easyeda: {} }
    }
  ];
  const instanceContexts: IrInstanceContext[] = [
    {
      id: "schematic-a_$5|block-a_$1",
      pathEncoding: "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID",
      schematicId: "schematic-a",
      blockPath: [
        {
          pageReference: "5",
          sheetNumber: "5",
          blockSymbolId: "block-a",
          resolutionStatus: "SOURCE_PAGE_NOT_FOUND"
        }
      ],
      terminalPageReference: "1",
      terminalSheetNumber: "1",
      resolutionStatus: "SOURCE_PAGE_NOT_FOUND",
      overrides: [
        {
          targetPrimitiveId: "component-2",
          attributes: { Value: "10k" },
          applicationStatus: "CONTEXT_NOT_RESOLVED",
          provenance: {
            ...PROVENANCE,
            documentId: "schematic-a_$5|block-a_$1",
            documentType: "INSTANCE",
            recordType: "INSTANCE_ATTR",
            recordId: "component-2"
          },
          extensions: { easyeda: {} }
        }
      ],
      provenance: [{ client: "client", entry: "epru", line: 1 }]
    }
  ];
  return {
    schema: "schemcp.eda-ir",
    schemaVersion: "1.1.0",
    generator: {
      name: "@yuanzihao/schemcp",
      version: "0.2.0"
    },
    source: {
      format: "EASYEDA_V3_LOG",
      archiveSha256: "a".repeat(64),
      reducedStateSha256: "b".repeat(64),
      electricalTruth: "NOT_VERIFIED"
    },
    documents: [],
    projectConfigurations: [],
    boards: [],
    schematics: [],
    schematicPages: [],
    schematicAnnotations: [],
    schematicGraphicPrimitives: [],
    schematicTables: [],
    variants,
    componentGroups,
    instanceContexts,
    componentOccurrences: [],
    components,
    componentSemantics: [],
    interfaces: [],
    resourceNodes: [],
    resourceEdges: [],
    symbols,
    symbolParts: [],
    symbolTexts: [],
    symbolPins,
    devices: [],
    wires,
    buses: [],
    busEntries: [],
    pinInstances: pinCompilation.pinInstances,
    shortRelations: [],
    networkEndpointCandidates: [],
    unboundAttributes: [],
    unmodeledRecords: [],
    diagnostics: [
      { code: "WARN_A", severity: "warning", message: "a", count: 1 },
      { code: "ERROR_B", severity: "error", message: "b", count: 2 }
    ],
    summary: {
      documents: 0,
      projectConfigurations: 0,
      boards: 0,
      schematics: 0,
      schematicPages: 0,
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
      variants: variants.length,
      variantsWithMissingSchematic: 0,
      componentGroups: componentGroups.length,
      componentGroupsWithMissingSchematic: 0,
      componentGroupsWithBrokenParent: 0,
      componentGroupsWithMissingDirectVariant: 0,
      componentGroupsWithConflictingMembership: 0,
      componentGroupVariantIndexes: 1,
      componentGroupVariantIndexesWithMissingVariant: 0,
      componentGroupOverrides: 2,
      variantGroupBrokenReferences: 0,
      instanceDocuments: 1,
      instanceContexts: instanceContexts.length,
      instanceDocumentsWithInvalidPath: 0,
      instanceContextsWithMissingSchematic: 0,
      instanceContextsResolved: 0,
      instanceContextsUnresolved: 1,
      instanceAttributeOverrides: 1,
      instanceAttributeOverridesAppliedToComponents: 0,
      instanceAttributeOverridesAppliedToPins: 0,
      instanceAttributeOverridesUnresolved: 1,
      componentOccurrences: 0,
      componentOccurrencesPopulated: 0,
      componentOccurrencesDnp: 0,
      componentOccurrencesAssemblyUnknown: 0,
      components: components.length,
      componentsPopulated: 0,
      componentsDnp: 0,
      componentsAssemblyUnknown: components.length,
      componentsPinCompletenessComplete: components.length,
      componentsPinCompletenessPartial: 0,
      componentsPinCompletenessUnknown: 0,
      componentSemantics: 0,
      componentSemanticsUnknownRole: 0,
      componentPowerDomainCandidates: 0,
      interfaces: 0,
      interfacesCandidate: 0,
      interfacesPartialCandidate: 0,
      interfacesUnresolved: 0,
      interfacesActive: 0,
      interfacesExcludedDnp: 0,
      interfacesAssemblyUnknown: 0,
      resourceNodes: 0,
      resourceEdges: 0,
      resourceEdgesPower: 0,
      resourceEdgesClock: 0,
      resourceEdgesResetBoot: 0,
      resourceEdgesMcuPin: 0,
      resourceEdgesActive: 0,
      resourceEdgesExcludedDnp: 0,
      resourceEdgesAssemblyUnknown: 0,
      componentsWithDesignator: components.length,
      componentsWithDevice: 0,
      componentsWithSymbol: components.length,
      componentsWithSymbolFromComponentOverride: components.length,
      componentsWithSymbolFromDeviceDefault: 0,
      componentsWithFootprint: 0,
      componentsWithFootprintFromComponentOverride: 0,
      componentsWithFootprintFromDeviceDefault: 0,
      symbols: 0,
      symbolParts: 0,
      symbolTexts: 0,
      symbolTextsWithExplicitText: 0,
      symbolTextsWithExplicitEmpty: 0,
      symbolTextsResolvedExact: 0,
      symbolTextsWithExplicitEmptyPart: 0,
      symbolTextsWithPartNotFound: 0,
      symbolPins: symbolPins.length,
      symbolPinsWithNumber: symbolPins.length,
      symbolPinsHidden: 0,
      devices: 0,
      wires: wires.length,
      wiresWithExplicitNet: wires.length,
      wireSegments: wires.length,
      buses: 0,
      busesWithExplicitNet: 0,
      busesWithEmptyEntrySet: 0,
      busSegments: 0,
      busEntries: 0,
      busEntriesEmbedded: 0,
      busEntriesSeparate: 0,
      busEntriesUnbound: 0,
      pinInstances: pinCompilation.summary.pinInstances,
      pinInstancesWithUniqueExplicitNetCandidate:
        pinCompilation.summary.uniqueExplicitNetCandidates,
      pinInstancesWithConflictingExplicitNetCandidates:
        pinCompilation.summary.conflictingExplicitNetCandidates,
      pinInstancesOnUnlabeledWire: pinCompilation.summary.pinsOnUnlabeledWire,
      pinInstancesWithDeclaredNoConnect:
        pinCompilation.summary.pinsWithDeclaredNoConnect,
      pinInstancesWithDeclaredNoConnectAndWireContact:
        pinCompilation.summary.pinsWithDeclaredNoConnectAndWireContact,
      pinInstancesWithNoConnectDeclarationConflict:
        pinCompilation.summary.pinsWithNoConnectDeclarationConflict,
      pinInstancesWithInvalidNoConnectDeclaration:
        pinCompilation.summary.pinsWithInvalidNoConnectDeclaration,
      pinInstancesWithoutWire: pinCompilation.summary.pinsWithoutWire,
      pinInstancesByEndpointKind: pinCompilation.summary.endpointKinds,
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
      unmodeledRecords: 0
    },
    irSha256: "c".repeat(64)
  };
}

function occurrenceFixture(): EdaIr {
  const base = fixture();
  const contextId = "schematic-a_$page-root~block-a_$page-a";
  const overrideProvenance: IrRecordProvenance = {
    ...PROVENANCE,
    documentId: contextId,
    documentType: "INSTANCE",
    recordType: "INSTANCE_ATTR",
    recordId: "component-1"
  };
  return {
    ...base,
    instanceContexts: [
      ...base.instanceContexts,
      {
        id: contextId,
        pathEncoding: "OBSERVED_PAGE_ID_TILDE_BLOCK_ID",
        schematicId: "schematic-a",
        blockPath: [
          {
            pageReference: "page-root",
            blockSymbolId: "block-a",
            sourcePageId: "page-root",
            targetPageId: "page-a",
            resolutionStatus: "RESOLVED_EXACT"
          }
        ],
        terminalPageReference: "page-a",
        terminalPageId: "page-a",
        resolutionStatus: "RESOLVED_EXACT",
        overrides: [
          {
            targetPrimitiveId: "component-1",
            attributes: { Designator: "R101", Value: "10k" },
            applicationStatus: "APPLIED_COMPONENT_OCCURRENCE",
            resolvedTarget: {
              kind: "COMPONENT",
              pageId: "page-a",
              componentId: "component-1"
            },
            provenance: overrideProvenance,
            extensions: { easyeda: {} }
          }
        ],
        provenance: [{ client: "client", entry: "epru", line: 10 }]
      }
    ],
    componentOccurrences: [
      {
        id: "occurrence-1",
        instanceContextId: contextId,
        schematicId: "schematic-a",
        pageId: "page-a",
        componentId: "component-1",
        designator: "R101",
        attributes: [
          {
            key: "Designator",
            values: ["R101"],
            resolution: "INSTANCE_OVERRIDE",
            provenance: [overrideProvenance]
          },
          {
            key: "Value",
            values: ["10k"],
            resolution: "INSTANCE_OVERRIDE",
            provenance: [overrideProvenance]
          }
        ],
        pinOverrides: [
          {
            symbolPinId: "pin-1",
            attributes: { NO_CONNECT: "yes" },
            provenance: {
              ...overrideProvenance,
              recordId: "component-1pin-1"
            }
          }
        ],
        assembly: {
          status: "UNKNOWN",
          reason: "ADD_INTO_BOM_MISSING",
          attributeKey: "Add into BOM",
          values: [],
          resolution: "MISSING",
          evidenceClass: "DETERMINISTIC_RULE",
          truthStatus: "NOT_VERIFIED",
          semanticRuleSetVersion: "schemcp.semantic-rules/1",
          provenance: []
        },
        pinCompleteness: {
          ...base.components[0]!.pinCompleteness,
          logicalComponentId: "occurrence-logical"
        },
        populationStatus: "UNKNOWN",
        pathTruth: "EXPLICIT_INSTANCE_DOCUMENT_RESOLVED",
        electricalTruth: "NOT_VERIFIED"
      }
    ],
    summary: {
      ...base.summary,
      instanceContexts: base.instanceContexts.length + 1,
      instanceContextsResolved: 1,
      componentOccurrences: 1,
      componentOccurrencesAssemblyUnknown: 1
    }
  };
}

function semanticsFixture(): EdaIr {
  const base = fixture();
  const selected = base.components.find((item) => item.id === "component-1")!;
  const second = base.components.find((item) => item.id === "component-2")!;
  const semantic: IrComponentSemantic = {
    id: "semantic-component-1",
    componentId: selected.id,
    pageId: selected.pageId,
    logicalComponentId: selected.pinCompleteness.logicalComponentId,
    unitComponentIds: [selected.id],
    primaryRole: "MCU_MPU",
    roles: [
      {
        role: "MCU_MPU",
        ruleId: "component-role.mcu-mpu.identity.v1",
        evidenceClass: "DETERMINISTIC_RULE",
        truthStatus: "CANDIDATE",
        semanticRuleSetVersion: "schemcp.semantic-rules/1",
        provenance: [selected.provenance]
      }
    ],
    powerDomains: [],
    ruleId: "component.semantic.aggregate.v1",
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: "CANDIDATE",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: [selected.provenance]
  };
  const interfaceBase = {
    group: "SWD",
    signals: [
      {
        signal: "SWDIO",
        pinInstanceIds: ["component-1:pin-1"],
        pinNames: ["SWDIO"],
        explicitNetNames: [],
        provenance: [selected.provenance]
      },
      {
        signal: "SWCLK",
        pinInstanceIds: ["component-1:pin-2"],
        pinNames: ["SWCLK"],
        explicitNetNames: [],
        provenance: [selected.provenance]
      }
    ],
    requiredSignals: ["SWDIO", "SWCLK"],
    missingSignals: [],
    unresolvedReasons: [],
    ruleId: "interface.swd.signal-set.v1",
    evidenceClass: "DETERMINISTIC_RULE" as const,
    truthStatus: "CANDIDATE" as const,
    semanticRuleSetVersion: "schemcp.semantic-rules/1" as const,
    provenance: [selected.provenance]
  };
  const interfaces: IrInterface[] = [
    {
      id: "interface-swd",
      type: "SWD",
      logicalComponentId: selected.pinCompleteness.logicalComponentId,
      componentRefs: [{ componentId: selected.id, pageId: selected.pageId }],
      status: "CANDIDATE",
      activityStatus: "ACTIVE",
      ...interfaceBase
    },
    {
      id: "interface-usb-dnp",
      type: "USB",
      group: "USB:FS",
      logicalComponentId: second.pinCompleteness.logicalComponentId,
      componentRefs: [{ componentId: second.id, pageId: second.pageId }],
      status: "PARTIAL_CANDIDATE",
      activityStatus: "EXCLUDED_DNP",
      signals: [
        {
          signal: "DP",
          pinInstanceIds: ["component-2:pin-1"],
          pinNames: ["USB_DP"],
          explicitNetNames: [],
          provenance: [second.provenance]
        }
      ],
      requiredSignals: ["DP", "DM"],
      missingSignals: ["DM"],
      unresolvedReasons: [],
      ruleId: "interface.usb.signal-set.v1",
      evidenceClass: "DETERMINISTIC_RULE",
      truthStatus: "CANDIDATE",
      semanticRuleSetVersion: "schemcp.semantic-rules/1",
      provenance: [second.provenance]
    }
  ];
  return {
    ...base,
    componentSemantics: [semantic],
    interfaces,
    summary: {
      ...base.summary,
      componentSemantics: 1,
      interfaces: 2,
      interfacesCandidate: 1,
      interfacesPartialCandidate: 1,
      interfacesActive: 1,
      interfacesExcludedDnp: 1
    }
  };
}



function annotationFixture(): EdaIr {
  const base = fixture();
  const schematicAnnotations = [
    schematicAnnotation("annotation-a", "page-a", "Power input notes"),
    schematicAnnotation("annotation-b", "page-a", ""),
    schematicAnnotation("annotation-c", "page-b", "UART debug")
  ];
  return {
    ...base,
    schematicAnnotations,
    summary: {
      ...base.summary,
      schematicAnnotations: schematicAnnotations.length,
      schematicAnnotationsWithExplicitText: 2,
      schematicAnnotationsWithExplicitEmpty: 1
    }
  };
}

function schematicGraphicPrimitive(
  id: string,
  documentId: string,
  documentType: IrSchematicGraphicPrimitive["documentType"],
  kind: "POLY" | "CIRCLE",
  partId?: string
): IrSchematicGraphicPrimitive {
  const symbol = documentType === "SYMBOL";
  return {
    id,
    documentId,
    documentType,
    kind,
    ...(partId === undefined ? {} : { partId }),
    partBinding: symbol
      ? partId === undefined
        ? { state: "EXPLICIT_EMPTY" }
        : { state: "RESOLVED_EXACT", targetId: partId }
      : { state: "NOT_APPLICABLE" },
    locked: false,
    zIndex: 1,
    geometry:
      kind === "POLY"
        ? {
            kind,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 }
            ],
            closed: false,
            pointEncoding: "V3_POINT_OBJECT_ARRAY"
          }
        : {
            kind: "CIRCLE",
            center: { x: 5, y: 5 },
            radius: 2
          },
    style: {
      strokeColor: null,
      strokeStyle: null,
      fillColor: null,
      strokeWidth: null,
      fillStyle: null
    },
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    geometryValidation: "FINITE_FIELDS_AND_POINT_ENCODING_VALIDATED",
    basis: "EXPLICIT_SCHEMATIC_SHAPE_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      ...PROVENANCE,
      documentId,
      documentType: symbol ? "SYMBOL" : "SCH_PAGE",
      recordType: kind,
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function schematicGraphicFixture(): EdaIr {
  const base = fixture();
  const schematicGraphicPrimitives = [
    schematicGraphicPrimitive(
      "graphic-a",
      "page-a",
      "SCHEMATIC_PAGE",
      "POLY"
    ),
    schematicGraphicPrimitive(
      "graphic-b",
      "symbol-a",
      "SYMBOL",
      "CIRCLE",
      "part-a"
    ),
    {
      ...schematicGraphicPrimitive(
        "graphic-c",
        "symbol-b",
        "SYMBOL",
        "POLY",
        "missing-part"
      ),
      partBinding: {
        state: "PART_NOT_FOUND" as const,
        targetId: "missing-part"
      }
    }
  ];
  return {
    ...base,
    schematicGraphicPrimitives,
    summary: {
      ...base.summary,
      schematicGraphicPrimitives: 3,
      schematicGraphicPrimitivesInPages: 1,
      schematicGraphicPrimitivesInSymbols: 2,
      schematicGraphicPolygons: 2,
      schematicGraphicCircles: 1,
      schematicGraphicPrimitivesResolvedExactPart: 1,
      schematicGraphicPrimitivesWithPartNotFound: 1
    }
  };
}

function schematicTable(
  id: string,
  documentId: string,
  documentType: IrSchematicTable["documentType"],
  values: readonly string[]
): IrSchematicTable {
  const symbol = documentType === "SYMBOL";
  return {
    id,
    documentId,
    documentType,
    ...(symbol ? { partId: "part-a" } : {}),
    partBinding: symbol
      ? { state: "RESOLVED_EXACT", targetId: "part-a" }
      : { state: "NOT_APPLICABLE" },
    position: { x: 10, y: 20 },
    rowSizes: [10],
    columnSizes: values.map(() => 20),
    rowLocked: [false],
    columnLocked: values.map(() => false),
    lockEncoding: "INTEGER_0_1",
    rotation: 0,
    cells: values.map((value, columnIndex) => ({
      id: `${id}-cell-${columnIndex}`,
      value,
      contentState: value === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
      rowIndex: 0,
      columnIndex,
      rowSpan: 1,
      columnSpan: 1,
      representation: "V3_INLINE_TABLE_CELL",
      semanticInterpretation: "NOT_PERFORMED",
      electricalTruth: "NOT_APPLICABLE",
      provenance: [
        {
          ...PROVENANCE,
          documentId,
          documentType: symbol ? "SYMBOL" : "SCH_PAGE",
          recordType: "TABLE",
          recordId: id
        }
      ],
      extensions: { easyeda: {} }
    })),
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    layoutValidation: "INDEX_AND_SPAN_BOUNDS_VALIDATED",
    basis: "EXPLICIT_SCHEMATIC_TABLE_AND_CELL_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      ...PROVENANCE,
      documentId,
      documentType: symbol ? "SYMBOL" : "SCH_PAGE",
      recordType: "TABLE",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function schematicTableFixture(): EdaIr {
  const base = fixture();
  const schematicTables = [
    schematicTable(
      "table-a",
      "page-a",
      "SCHEMATIC_PAGE",
      ["BOOT0", "LOW", ""]
    ),
    schematicTable(
      "table-b",
      "symbol-a",
      "SYMBOL",
      ["MS1", "1/16"]
    )
  ];
  return {
    ...base,
    schematicTables,
    summary: {
      ...base.summary,
      schematicTables: 2,
      schematicTablesInPages: 1,
      schematicTablesInSymbols: 1,
      schematicTableCells: 5,
      schematicTableCellsWithExplicitText: 4,
      schematicTableCellsWithExplicitEmpty: 1,
      schematicTableCellsFromInlineRecords: 5,
      schematicTablesResolvedExactPart: 1
    }
  };
}

function symbolText(
  id: string,
  symbolId: string,
  partId: string | undefined,
  text: string,
  state: IrSymbolText["partBinding"]["state"]
): IrSymbolText {
  return {
    id,
    symbolId,
    ...(partId === undefined ? {} : { partId }),
    partBinding: {
      state,
      ...(partId === undefined ? {} : { targetId: partId })
    },
    text,
    contentState: text === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
    position: { x: 1, y: 2 },
    rotation: 0,
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    basis: "EXPLICIT_SYMBOL_TEXT_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      ...PROVENANCE,
      documentId: symbolId,
      documentType: "SYMBOL",
      recordType: "TEXT",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function symbolTextFixture(): EdaIr {
  const base = fixture();
  const symbolTexts = [
    symbolText("text-a", "symbol-a", "part-a", "UART_TX", "RESOLVED_EXACT"),
    symbolText("text-b", "symbol-a", undefined, "", "EXPLICIT_EMPTY"),
    symbolText(
      "text-c",
      "symbol-b",
      "missing-part",
      "Power",
      "PART_NOT_FOUND"
    )
  ];
  return {
    ...base,
    symbolTexts,
    summary: {
      ...base.summary,
      symbolTexts: symbolTexts.length,
      symbolTextsWithExplicitText: 2,
      symbolTextsWithExplicitEmpty: 1,
      symbolTextsResolvedExact: 1,
      symbolTextsWithExplicitEmptyPart: 1,
      symbolTextsWithPartNotFound: 1
    }
  };
}

function busFixture(): EdaIr {
  const base = fixture();
  const buses: readonly IrBus[] = [
    {
      id: "bus-a",
      pageId: "page-a",
      encoding: "OBSERVED_EMBEDDED_BUSENTRY_MAP",
      explicitNetName: "DATA[7:0]",
      segments: [],
      entryIds: ["entry-a", "entry-b"],
      attributes: [],
      memberExpansion: "NOT_PERFORMED",
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      provenance: {
        ...PROVENANCE,
        recordType: "BUS",
        recordId: "bus-a"
      },
      extensions: { easyeda: {} }
    },
    {
      id: "bus-b",
      pageId: "page-b",
      encoding: "OFFICIAL_DOTS_WITH_SEPARATE_BUSENTRY_RECORDS",
      explicitNetName: "CTRL[1:0]",
      segments: [],
      entryIds: [],
      attributes: [],
      memberExpansion: "NOT_PERFORMED",
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      provenance: {
        ...PROVENANCE,
        documentId: "page-b",
        recordType: "BUS",
        recordId: "bus-b"
      },
      extensions: { easyeda: {} }
    }
  ];
  const busEntries: readonly IrBusEntry[] = [
    {
      id: "entry-b",
      pageId: "page-a",
      busId: "bus-a",
      encoding: "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM",
      associationStatus: "EMBEDDED_IN_BUS_RECORD",
      order: 1,
      point: { x: 20, y: 10 },
      rotation: 0,
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      provenance: {
        ...PROVENANCE,
        recordType: "BUS",
        recordId: "bus-a"
      },
      extensions: { easyeda: {} }
    },
    {
      id: "entry-a",
      pageId: "page-a",
      busId: "bus-a",
      encoding: "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM",
      associationStatus: "EMBEDDED_IN_BUS_RECORD",
      order: 0,
      point: { x: 10, y: 10 },
      rotation: 0,
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      provenance: {
        ...PROVENANCE,
        recordType: "BUS",
        recordId: "bus-a"
      },
      extensions: { easyeda: {} }
    },
    {
      id: "entry-unbound",
      pageId: "page-b",
      encoding: "OFFICIAL_SEPARATE_BUSENTRY_RECORD",
      associationStatus: "SEPARATE_RECORD_WITHOUT_EXPLICIT_BUS_ID",
      order: 0,
      busGroupId: 3,
      point: { x: 0, y: 0 },
      rotation: 180,
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      provenance: {
        ...PROVENANCE,
        documentId: "page-b",
        recordType: "BUSENTRY",
        recordId: "entry-unbound"
      },
      extensions: { easyeda: {} }
    }
  ];
  return {
    ...base,
    buses,
    busEntries,
    summary: {
      ...base.summary,
      buses: buses.length,
      busesWithExplicitNet: buses.length,
      busesWithEmptyEntrySet: 1,
      busSegments: 0,
      busEntries: busEntries.length,
      busEntriesEmbedded: 2,
      busEntriesSeparate: 1,
      busEntriesUnbound: 1
    }
  };
}



















test("组件列表具有确定排序、有界分页和筛选域绑定 cursor", () => {
  const index = new EdaIrQueryIndex(fixture());
  const first = index.listComponents({ limit: 1 });
  assert.equal(first.total, 3);
  assert.equal(first.items[0]?.id, "component-1");
  const cursor = first.nextCursor;
  assert.ok(cursor);

  const second = index.listComponents({ limit: 1, cursor });
  assert.equal(second.items[0]?.id, "component-2");

  assert.throws(
    () =>
      index.listComponents({
        limit: 1,
        pageId: "page-a",
        cursor
      }),
    (error) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  assert.throws(
    () => index.listComponents({ limit: 51 }),
    (error) => error instanceof QueryError && error.code === "QUERY_INVALID_LIMIT"
  );
});

test("组件查询公开 DNP 装配状态、完整性筛选并将 Variant 绑定到游标域", () => {
  const base = fixture();
  const components = base.components.map((item, index) => ({
    ...item,
    assembly:
      index === 0
        ? {
            status: "DNP" as const,
            reason: "EXPLICIT_ADD_INTO_BOM_NO" as const,
            attributeKey: "Add into BOM" as const,
            values: ["no"],
            resolution: "COMPONENT_EXPLICIT" as const,
            evidenceClass: "EXPLICIT_PROJECT_RECORD" as const,
            truthStatus: "NOT_VERIFIED" as const,
            semanticRuleSetVersion: "schemcp.semantic-rules/1" as const,
            provenance: [item.provenance]
          }
        : item.assembly
  }));
  const index = new EdaIrQueryIndex({ ...base, components });

  const dnp = index.listComponents({ assemblyStatus: "DNP", limit: 1 });
  assert.equal(dnp.total, 1);
  assert.equal(dnp.items[0]?.assembly.status, "DNP");
  assert.equal(dnp.items[0]?.assembly.reason, "EXPLICIT_ADD_INTO_BOM_NO");

  const complete = index.listComponents({
    pinCompletenessStatus: "COMPLETE"
  });
  assert.equal(complete.total, 3);

  const selectedVariant = index.listComponents({
    variantId: "variant-1",
    assemblyStatus: "UNKNOWN",
    limit: 1
  });
  assert.equal(selectedVariant.total, 3);
  assert.equal(
    selectedVariant.items[0]?.assembly.reason,
    "VARIANT_APPLICATION_NOT_SUPPORTED"
  );
  assert.throws(
    () => index.listComponents({ variantId: "missing-variant" }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_TEXT"
  );
  assert.throws(
    () =>
      index.listComponents({
        variantId: "variant-2",
        assemblyStatus: "UNKNOWN",
        limit: 1,
        cursor: selectedVariant.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("组件详情公开版本化角色语义，接口默认排除 DNP 并绑定 Variant 游标域", () => {
  const index = new EdaIrQueryIndex(semanticsFixture());
  const component = index.getComponent({ componentId: "component-1" });
  assert.equal(component.status, "FOUND");
  if (component.status === "FOUND") {
    assert.equal(component.component.semantic?.primaryRole, "MCU_MPU");
    assert.equal(
      component.component.semantic?.semanticRuleSetVersion,
      "schemcp.semantic-rules/1"
    );
  }

  const active = index.listInterfaces({ limit: 1 });
  assert.equal(active.total, 1);
  assert.equal(active.items[0]?.type, "SWD");
  assert.equal(active.items[0]?.activityStatus, "ACTIVE");

  const excluded = index.listInterfaces({
    activityStatus: "EXCLUDED_DNP",
    status: "PARTIAL_CANDIDATE"
  });
  assert.equal(excluded.total, 1);
  assert.equal(excluded.items[0]?.type, "USB");

  const selectedVariant = index.listInterfaces({
    variantId: "variant-1",
    activityStatus: "ALL",
    limit: 1
  });
  assert.equal(selectedVariant.total, 2);
  assert.equal(selectedVariant.items[0]?.status, "UNRESOLVED");
  assert.equal(
    selectedVariant.items[0]?.activityStatus,
    "ASSEMBLY_UNKNOWN"
  );
  assert.throws(
    () =>
      index.listInterfaces({
        variantId: "variant-2",
        activityStatus: "ALL",
        limit: 1,
        cursor: selectedVariant.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("组件查询按 INSTANCE 上下文返回有效位号、属性和引脚覆盖", () => {
  const index = new EdaIrQueryIndex(occurrenceFixture());
  const contextId = "schematic-a_$page-root~block-a_$page-a";
  const basePage = index.listComponents({ limit: 1 });
  assert.ok(basePage.nextCursor);

  const page = index.listComponents({
    instanceContextId: contextId,
    designatorContains: "r101"
  });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.id, "component-1");
  assert.equal(page.items[0]?.designator, "R101");
  assert.equal(page.items[0]?.occurrence?.id, "occurrence-1");
  assert.equal(page.items[0]?.occurrence?.instanceContextId, contextId);
  assert.throws(
    () =>
      index.listComponents({
        instanceContextId: contextId,
        limit: 1,
        cursor: basePage.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );

  const lookup = index.getComponent({
    designator: "R101",
    instanceContextId: contextId
  });
  assert.equal(lookup.status, "FOUND");
  if (lookup.status !== "FOUND") return;
  assert.deepEqual(
    lookup.attributes.find((attribute) => attribute.key === "Value"),
    {
      key: "Value",
      values: ["10k"],
      resolution: "INSTANCE_OVERRIDE",
      provenance: [
        {
          ...PROVENANCE,
          documentId: contextId,
          documentType: "INSTANCE",
          recordType: "INSTANCE_ATTR",
          recordId: "component-1"
        }
      ]
    }
  );

  const pins = index.getComponentPins({
    componentId: "component-1",
    instanceContextId: contextId
  });
  assert.equal(pins.status, "FOUND");
  if (pins.status === "FOUND" && "pins" in pins) {
    assert.deepEqual(pins.pins.items[0]?.occurrenceOverrides?.[0]?.attributes, {
      NO_CONNECT: "yes"
    });
    assert.equal(pins.pins.items[1]?.occurrenceOverrides, undefined);
  }
});

test("原理图注释查询保持显式文本、分页筛选和来源证据", () => {
  const index = new EdaIrQueryIndex(annotationFixture());
  const first = index.listSchematicAnnotations({
    pageId: "page-a",
    limit: 1
  });
  assert.equal(first.total, 2);
  assert.equal(first.items[0]?.id, "annotation-a");
  assert.equal(first.items[0]?.semanticInterpretation, "NOT_PERFORMED");
  assert.equal(first.items[0]?.electricalTruth, "NOT_APPLICABLE");
  assert.ok(first.nextCursor);
  const second = index.listSchematicAnnotations({
    pageId: "page-a",
    limit: 1,
    cursor: first.nextCursor
  });
  assert.equal(second.items[0]?.contentState, "EXPLICIT_EMPTY");
  assert.equal(
    index.listSchematicAnnotations({ textContains: "uart" }).items[0]?.id,
    "annotation-c"
  );
  assert.equal(
    index.listSchematicAnnotations({ contentState: "EXPLICIT_EMPTY" }).total,
    1
  );
  assert.throws(
    () =>
      index.listSchematicAnnotations({
        pageId: "page-b",
        cursor: first.nextCursor
      }),
    (error) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  assert.equal(
    index.getEvidence(
      "schematicAnnotation",
      "annotation-a",
      "page-a"
    ).status,
    "FOUND"
  );
});

test("原理图图形查询保持几何、Part 绑定、分页筛选和来源证据", () => {
  const index = new EdaIrQueryIndex(schematicGraphicFixture());
  const first = index.listSchematicGraphicPrimitives({
    documentType: "SYMBOL",
    limit: 1
  });
  assert.equal(first.total, 2);
  assert.equal(first.items[0]?.id, "graphic-b");
  assert.equal(first.items[0]?.kind, "CIRCLE");
  assert.equal(first.items[0]?.partBinding.state, "RESOLVED_EXACT");
  assert.equal(
    first.items[0]?.geometryValidation,
    "FINITE_FIELDS_AND_POINT_ENCODING_VALIDATED"
  );
  assert.ok(first.nextCursor);
  assert.equal(
    index.listSchematicGraphicPrimitives({
      kind: "POLY",
      partBindingState: "PART_NOT_FOUND"
    }).items[0]?.id,
    "graphic-c"
  );
  assert.equal(
    index.listSchematicGraphicPrimitives({ documentId: "page-a" }).total,
    1
  );
  assert.throws(
    () =>
      index.listSchematicGraphicPrimitives({
        documentType: "SCHEMATIC_PAGE",
        cursor: first.nextCursor
      }),
    (error) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  assert.equal(
    index.getEvidence(
      "schematicGraphicPrimitive",
      "graphic-a",
      "page-a"
    ).status,
    "FOUND"
  );
});

test("原理图表格查询分离列表元数据与有界单元格详情", () => {
  const index = new EdaIrQueryIndex(schematicTableFixture());
  const pageTables = index.listSchematicTables({
    documentType: "SCHEMATIC_PAGE",
    cellTextContains: "boot"
  });
  assert.equal(pageTables.total, 1);
  assert.equal(pageTables.items[0]?.id, "table-a");
  assert.equal(pageTables.items[0]?.cellCount, 3);
  assert.equal(pageTables.items[0]?.explicitEmptyCellCount, 1);
  assert.equal(
    pageTables.items[0]?.semanticInterpretation,
    "NOT_PERFORMED"
  );
  assert.equal(pageTables.items[0]?.electricalTruth, "NOT_APPLICABLE");
  assert.equal(
    index.listSchematicTables({ partBindingState: "RESOLVED_EXACT" }).total,
    1
  );

  const first = index.getSchematicTable({
    documentId: "page-a",
    tableId: "table-a",
    limit: 1
  });
  assert.equal(first.status, "FOUND");
  if (first.status !== "FOUND") {
    return;
  }
  assert.equal(first.cells.total, 3);
  assert.equal(first.cells.items[0]?.value, "BOOT0");
  assert.ok(first.cells.nextCursor);
  const second = index.getSchematicTable({
    documentId: "page-a",
    tableId: "table-a",
    limit: 1,
    cursor: first.cells.nextCursor
  });
  assert.equal(second.status, "FOUND");
  if (second.status === "FOUND") {
    assert.equal(second.cells.items[0]?.value, "LOW");
  }
  const explicitEmpty = index.getSchematicTable({
    documentId: "page-a",
    tableId: "table-a",
    cellContentState: "EXPLICIT_EMPTY"
  });
  assert.equal(explicitEmpty.status, "FOUND");
  if (explicitEmpty.status === "FOUND") {
    assert.equal(explicitEmpty.cells.total, 1);
  }
  assert.throws(
    () =>
      index.getSchematicTable({
        documentId: "page-a",
        tableId: "table-a",
        cellTextContains: "boot",
        cursor: first.cells.nextCursor
      }),
    (error) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  assert.deepEqual(
    index.getSchematicTable({
      documentId: "page-a",
      tableId: "missing"
    }),
    { status: "NOT_FOUND" }
  );
  assert.equal(
    index.getEvidence("schematicTable", "table-a", "page-a").status,
    "FOUND"
  );
});

test("符号文本查询保持 Part 绑定、分页筛选和来源证据", () => {
  const index = new EdaIrQueryIndex(symbolTextFixture());
  const first = index.listSymbolTexts({
    symbolId: "symbol-a",
    limit: 1
  });
  assert.equal(first.total, 2);
  assert.equal(first.items[0]?.id, "text-b");
  assert.equal(first.items[0]?.partBinding.state, "EXPLICIT_EMPTY");
  assert.ok(first.nextCursor);
  const second = index.listSymbolTexts({
    symbolId: "symbol-a",
    limit: 1,
    cursor: first.nextCursor
  });
  assert.equal(second.items[0]?.id, "text-a");
  assert.equal(second.items[0]?.partBinding.state, "RESOLVED_EXACT");
  assert.equal(
    index.listSymbolTexts({ textContains: "uart" }).items[0]?.id,
    "text-a"
  );
  assert.equal(
    index.listSymbolTexts({ partBindingState: "PART_NOT_FOUND" }).total,
    1
  );
  assert.throws(
    () =>
      index.listSymbolTexts({
        symbolId: "symbol-b",
        cursor: first.nextCursor
      }),
    (error) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  assert.equal(
    index.getEvidence("symbolText", "text-a", "symbol-a").status,
    "FOUND"
  );
});























test("未解析元件清单支持确定分页、原因筛选和筛选域绑定 cursor", () => {
  const index = new EdaIrQueryIndex(fixture());
  const first = index.listUnresolvedComponents({ limit: 1 });
  assert.equal(first.total, 3);
  assert.equal(first.items[0]?.id, "component-1");
  assert.deepEqual(first.items[0]?.reasons, [
    "MISSING_EXACT_PART_IDENTITY",
    "FOOTPRINT_BINDING_UNRESOLVED"
  ]);
  assert.ok(first.nextCursor);

  const second = index.listUnresolvedComponents({
    limit: 1,
    cursor: first.nextCursor
  });
  assert.equal(second.items[0]?.id, "component-2");
  assert.equal(
    index.listUnresolvedComponents({
      identityMethod: "UNRESOLVED",
      reason: "FOOTPRINT_BINDING_UNRESOLVED"
    }).total,
    3
  );
  assert.deepEqual(index.getUnresolvedComponentSummary(), {
    population: "DESIGNATED_COMPONENTS_ONLY",
    designatedComponents: 3,
    resolvedComponents: 0,
    unresolvedComponents: 3,
    identityMethods: {
      EXACT_LCSC_PART_ID: 0,
      EXACT_MANUFACTURER_AND_MPN: 0,
      UNRESOLVED: 3
    },
    reasonCounts: {
      MISSING_EXACT_PART_IDENTITY: 3,
      INVALID_LCSC_PART_ID: 0,
      INVALID_MANUFACTURER: 0,
      INVALID_MANUFACTURER_PART: 0,
      CONFLICTING_LCSC_PART_ID: 0,
      CONFLICTING_MANUFACTURER: 0,
      CONFLICTING_MANUFACTURER_PART: 0,
      DEVICE_REFERENCE_NOT_FOUND: 0,
      DEVICE_REFERENCE_AMBIGUOUS: 0,
      SYMBOL_BINDING_UNRESOLVED: 0,
      FOOTPRINT_BINDING_UNRESOLVED: 3
    },
    procurementMatch: "NOT_PERFORMED",
    variantApplication: "NOT_APPLIED"
  });

  assert.throws(
    () =>
      index.listUnresolvedComponents({
        reason: "MISSING_EXACT_PART_IDENTITY",
        limit: 1,
        cursor: first.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("物料主数据支持精确筛选、关联元件分页和筛选域绑定 cursor", () => {
  const ir = fixture();
  const withIdentity = ir.components.map((item, index) => ({
    ...item,
    attributes:
      index < 2
        ? [
            identityAttribute(
              `supplier-${index}`,
              "Supplier Part",
              "C123456"
            )
          ]
        : [
            identityAttribute(
              "manufacturer-2",
              "Manufacturer",
              "STMicroelectronics"
            ),
            identityAttribute(
              "manufacturer-part-2",
              "Manufacturer Part",
              "STM32F407VGT6"
            )
          ]
  }));
  const index = new EdaIrQueryIndex({
    ...ir,
    components: withIdentity
  });
  const first = index.listPartMasters({ limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.items[0]?.identity.method, "EXACT_LCSC_PART_ID");
  assert.equal(first.items[0]?.componentCount, 2);
  assert.ok(first.nextCursor);

  const exactLcsc = index.listPartMasters({
    lcscPartId: "C123456"
  });
  assert.equal(exactLcsc.total, 1);
  const partMasterId = exactLcsc.items[0]?.id;
  assert.ok(partMasterId);
  const detail = index.getPartMaster({
    partMasterId,
    limit: 1
  });
  assert.equal(detail.status, "FOUND");
  if (detail.status === "FOUND") {
    assert.equal(detail.components.total, 2);
    assert.equal(detail.components.items.length, 1);
    assert.ok(detail.components.nextCursor);
  }
  assert.deepEqual(index.getPartMasterSummary(), {
    population: "DESIGNATED_COMPONENTS_ONLY",
    partMasters: 2,
    linkedDesignatedComponents: 3,
    unlinkedDesignatedComponents: 0,
    identityMethods: {
      EXACT_LCSC_PART_ID: 2,
      EXACT_MANUFACTURER_AND_MPN: 1
    },
    identityBasis:
      "EXPLICIT_COMPONENT_ATTRIBUTE_THEN_DEVICE_ATTRIBUTE",
    catalogMatch: "NOT_PERFORMED",
    datasheetBinding: "NOT_PERFORMED",
    variantApplication: "NOT_APPLIED"
  });

  assert.throws(
    () =>
      index.listPartMasters({
        identityMethod: "EXACT_MANUFACTURER_AND_MPN",
        limit: 1,
        cursor: first.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("工程层级查询按显式父引用分页且 cursor 与筛选域绑定", () => {
  const ir = fixture();
  const index = new EdaIrQueryIndex({
    ...ir,
    projectConfigurations: [
      {
        documentId: "config-a",
        defaultSheetId: "page-a",
        provenance: { ...PROVENANCE, documentId: "config-a" },
        extensions: { easyeda: {} }
      }
    ],
    boards: [
      {
        id: "board-a",
        title: "Board",
        sortOrder: 1,
        provenance: { ...PROVENANCE, documentId: "board-a" },
        extensions: { easyeda: {} }
      }
    ],
    schematics: [
      {
        id: "schematic-a",
        boardId: "board-a",
        title: "Schematic",
        provenance: { ...PROVENANCE, documentId: "schematic-a" },
        extensions: { easyeda: {} }
      }
    ],
    schematicPages: [
      {
        id: "page-a",
        schematicId: "schematic-a",
        title: "Main",
        sortOrder: 1,
        attributes: [],
        provenance: { ...PROVENANCE, documentId: "page-a" },
        extensions: { easyeda: {} }
      },
      {
        id: "page-b",
        schematicId: "schematic-a",
        title: "Power",
        sortOrder: 2,
        attributes: [],
        provenance: { ...PROVENANCE, documentId: "page-b" },
        extensions: { easyeda: {} }
      }
    ]
  });
  const first = index.listDesignHierarchy({
    kind: "SHEET",
    parentId: "schematic-a",
    limit: 1
  });
  assert.equal(first.total, 2);
  assert.equal(first.items[0]?.id, "page-a");
  assert.equal(
    first.items[0]?.relationshipBasis,
    "EXPLICIT_SCHEMATIC_REFERENCE"
  );
  assert.ok(first.nextCursor);
  const instances = index.listDesignHierarchy({
    kind: "INSTANCE_CONTEXT",
    parentId: "schematic-a"
  });
  assert.equal(instances.total, 1);
  assert.equal(
    instances.items[0]?.relationshipBasis,
    "EXPLICIT_INSTANCE_DOCUMENT_PATH"
  );
  assert.equal(
    instances.items[0]?.resolutionStatus,
    "SOURCE_PAGE_NOT_FOUND"
  );
  assert.throws(
    () =>
      index.listDesignHierarchy({
        kind: "SHEET",
        parentId: "other-schematic",
        limit: 1,
        cursor: first.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("变体查询保留显式分组依据、分页和名称歧义", () => {
  const index = new EdaIrQueryIndex(fixture());
  const ambiguous = index.getVariant({ title: "Production" });
  assert.equal(ambiguous.status, "AMBIGUOUS");
  if (ambiguous.status === "AMBIGUOUS") {
    assert.equal(ambiguous.total, 2);
  }

  const first = index.getVariant({ variantId: "variant-1", limit: 1 });
  assert.equal(first.status, "FOUND");
  if (first.status !== "FOUND") return;
  assert.equal(first.groups.total, 2);
  assert.equal(first.groups.items[0]?.id, "group-indexed");
  assert.deepEqual(first.groups.items[0]?.membershipBasis, ["GROUP_INDEX"]);
  assert.equal(first.groups.items[0]?.variantSortOrder, 1);
  assert.equal(
    first.overrideSemantics,
    "EXPLICIT_GROUP_DATA_NOT_APPLIED"
  );
  assert.ok(first.groups.nextCursor !== undefined);

  const second = index.getVariant({
    variantId: "variant-1",
    limit: 1,
    cursor: first.groups.nextCursor
  });
  assert.equal(second.status, "FOUND");
  if (second.status === "FOUND") {
    assert.equal(second.groups.items[0]?.id, "group-direct");
    assert.deepEqual(second.groups.items[0]?.membershipBasis, [
      "DIRECT_VARIANT_BELONG"
    ]);
  }
  assert.throws(
    () =>
      index.getVariant({
        variantId: "variant-2",
        cursor: first.groups.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("变体覆盖仅精确匹配 INSTANCE 文档 ID 且不应用目标属性", () => {
  const index = new EdaIrQueryIndex(fixture());
  const lookup = index.listVariantOverrides({
    variantId: "variant-1",
    groupId: "group-direct",
    limit: 1
  });
  assert.equal(lookup.status, "FOUND");
  if (lookup.status !== "FOUND") return;
  assert.equal(lookup.overrides.total, 1);
  assert.deepEqual(lookup.overrides.items[0]?.attributes, { DNP: "yes" });
  assert.equal(
    lookup.overrides.items[0]?.applicationStatus,
    "NOT_APPLIED_TARGET_RESOLUTION_UNVERIFIED"
  );
  assert.equal(
    lookup.overrides.items[0]?.instanceContextMatch,
    "MATCHED_EXPLICIT_INSTANCE_DOCUMENT_ID"
  );
  assert.equal(lookup.applicationTruth, "TARGET_RESOLUTION_NOT_VERIFIED");
  const unmatched = index.listVariantOverrides({
    variantId: "variant-1",
    groupId: "group-indexed"
  });
  assert.equal(unmatched.status, "FOUND");
  if (unmatched.status === "FOUND") {
    assert.equal(
      unmatched.overrides.items[0]?.instanceContextMatch,
      "INSTANCE_DOCUMENT_NOT_FOUND"
    );
  }
  assert.throws(
    () => index.listVariantOverrides({ variantId: "variant-1", title: "x" }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_TEXT"
  );
});

test("INSTANCE 上下文按显式 Schematic 分页并返回稳定解析状态", () => {
  const index = new EdaIrQueryIndex(fixture());
  const contexts = index.listInstanceContexts({
    schematicId: "schematic-a",
    limit: 1
  });
  assert.equal(contexts.total, 1);
  assert.deepEqual(contexts.items[0], {
    id: "schematic-a_$5|block-a_$1",
    pathEncoding: "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID",
    schematicId: "schematic-a",
    blockPath: [
      {
        pageReference: "5",
        sheetNumber: "5",
        blockSymbolId: "block-a",
        resolutionStatus: "SOURCE_PAGE_NOT_FOUND"
      }
    ],
    terminalPageReference: "1",
    terminalSheetNumber: "1",
    resolutionStatus: "SOURCE_PAGE_NOT_FOUND",
    overrideCount: 1,
    occurrenceCount: 0,
    pathBasis: "OFFICIAL_INSTANCE_DOCUMENT_UUID"
  });

  const lookup = index.getInstanceContext({
    contextId: "schematic-a_$5|block-a_$1",
    limit: 1
  });
  assert.equal(lookup.status, "FOUND");
  if (lookup.status !== "FOUND") return;
  assert.equal(lookup.overrides.total, 1);
  assert.deepEqual(lookup.overrides.items[0]?.attributes, { Value: "10k" });
  assert.equal(
    lookup.overrides.items[0]?.applicationStatus,
    "CONTEXT_NOT_RESOLVED"
  );
  assert.equal(lookup.targetResolution, "SOURCE_PAGE_NOT_FOUND");
  assert.equal(
    index.getInstanceContext({ contextId: "missing" }).status,
    "NOT_FOUND"
  );
});

test("重复位号不会被静默选中，页 ID 可以完成消歧", () => {
  const index = new EdaIrQueryIndex(fixture());
  const ambiguous = index.getComponent({ designator: "R1" });
  assert.equal(ambiguous.status, "AMBIGUOUS");
  if (ambiguous.status === "AMBIGUOUS") {
    assert.equal(ambiguous.total, 2);
  }

  const found = index.getComponent({ designator: "R1", pageId: "page-b" });
  assert.equal(found.status, "FOUND");
  if (found.status === "FOUND") {
    assert.equal(found.component.id, "component-3");
    assert.equal(
      found.component.symbolBinding.state,
      "BOUND_COMPONENT_OVERRIDE"
    );
    assert.equal(
      found.component.footprintBinding.state,
      "UNRESOLVED_DEVICE_REFERENCE_MISSING"
    );
  }
});

test("组件引脚返回实例化几何候选但保持电气真值未验证", () => {
  const index = new EdaIrQueryIndex(fixture());
  const result = index.getComponentPins({ componentId: "component-1" });
  assert.equal(result.status, "FOUND");
  if (result.status === "FOUND" && "pins" in result) {
    assert.equal(result.connectionTruth, "NOT_VERIFIED");
    assert.deepEqual(
      result.pins.items.map((item) => [
        item.number,
        item.connectionCandidate.status
      ]),
      [
        ["1", "UNRESOLVED_NO_WIRE"],
        ["2", "UNRESOLVED_NO_WIRE"]
      ]
    );
    assert.equal(result.pins.items[0]?.endpointKind, "PART_SYMBOL_PIN");
  }
});

test("完整多单元逻辑器件查询合并各 PART 的引脚且保留所属组件", () => {
  const base = fixture();
  const unitA = base.components[0]!;
  const unitB = base.components[1]!;
  const units = [
    { componentId: unitA.id, pageId: unitA.pageId, partId: "part-a" },
    { componentId: unitB.id, pageId: unitB.pageId, partId: "part-b" }
  ];
  const components = base.components.map((item) =>
    item.id === unitA.id || item.id === unitB.id
      ? {
          ...item,
          partId: item.id === unitA.id ? "part-a" : "part-b",
          pinCompleteness: {
            ...item.pinCompleteness,
            logicalComponentId: "logical-u1",
            status: "COMPLETE" as const,
            reason: "ALL_SYMBOL_PARTS_INSTANTIATED" as const,
            units,
            declaredPartIds: ["part-a", "part-b"],
            instantiatedPartIds: ["part-a", "part-b"]
          }
        }
      : item
  );
  const index = new EdaIrQueryIndex({ ...base, components });
  const result = index.getComponentPins({ componentId: unitA.id });
  assert.equal(result.status, "FOUND");
  if (result.status === "FOUND" && "pins" in result) {
    assert.equal(result.pins.total, 4);
    assert.deepEqual(
      [...new Set(result.pins.items.map((item) => item.componentId))].sort(),
      [unitA.id, unitB.id].sort()
    );
  }
});

test("组件引脚查询保留显式 NO_CONNECT 声明和属性证据", () => {
  const ir = fixture();
  const first = ir.pinInstances[0]!;
  const evidence = {
    id: "nc-attribute",
    key: "NO_CONNECT",
    value: "yes",
    provenance: {
      ...PROVENANCE,
      recordType: "ATTR",
      recordId: "nc-attribute"
    },
    extensions: {
      easyeda: {
        parentId: `${first.componentId}-${first.symbolPinId}`,
        key: "NO_CONNECT",
        value: "yes"
      }
    }
  } as const;
  const index = new EdaIrQueryIndex({
    ...ir,
    pinInstances: [
      {
        ...first,
        instanceAttributes: [evidence],
        noConnectDeclaration: {
          state: "DECLARED_NO_CONNECT",
          basis: "COMPONENT_PIN_OVERRIDE_NO_CONNECT_ATTRIBUTE",
          evidence: [evidence]
        },
        connectionCandidate: {
          ...first.connectionCandidate,
          status: "DECLARED_NO_CONNECT"
        }
      },
      ...ir.pinInstances.slice(1)
    ]
  });
  const result = index.getComponentPins({ componentId: first.componentId });
  assert.equal(result.status, "FOUND");
  if (result.status === "FOUND" && "pins" in result) {
    assert.equal(
      result.pins.items[0]?.noConnectDeclaration?.state,
      "DECLARED_NO_CONNECT"
    );
    assert.equal(result.pins.items[0]?.instanceAttributes[0]?.key, "NO_CONNECT");
  }
});

test("显式网络按名称聚合但保持导线标签边界", () => {
  const index = new EdaIrQueryIndex(fixture());
  const result = index.listExplicitNets();
  assert.deepEqual(
    result.items.map((item) => [
      item.name,
      item.wireCount,
      item.pageIds,
      item.connectionStatus
    ]),
    [
      ["GND", 1, ["page-a"], "EXPLICIT_WIRE_LABEL_ONLY"],
      ["VCC", 2, ["page-a", "page-b"], "EXPLICIT_WIRE_LABEL_ONLY"]
    ]
  );
});

test("BUS 与 BUSENTRY 分页保留显式顺序、编码并绑定工程筛选域", () => {
  const ir = busFixture();
  const index = new EdaIrQueryIndex(ir);
  const buses = index.listBuses({ netNameContains: "data", limit: 1 });
  assert.equal(buses.total, 1);
  assert.equal(buses.items[0]?.id, "bus-a");
  assert.equal(buses.items[0]?.explicitNetName, "DATA[7:0]");
  assert.equal(buses.items[0]?.memberExpansion, "NOT_PERFORMED");

  const entries = index.listBusEntries({ busId: "bus-a", limit: 1 });
  assert.equal(entries.total, 2);
  assert.equal(entries.items[0]?.id, "entry-a");
  assert.equal(entries.items[0]?.order, 0);
  assert.ok(entries.nextCursor);
  const next = index.listBusEntries({
    busId: "bus-a",
    limit: 1,
    cursor: entries.nextCursor
  });
  assert.equal(next.items[0]?.id, "entry-b");
  assert.equal(
    index.listBusEntries({
      associationStatus: "SEPARATE_RECORD_WITHOUT_EXPLICIT_BUS_ID"
    }).items[0]?.id,
    "entry-unbound"
  );
  assert.equal(index.getEvidence("bus", "bus-a", "page-a").status, "FOUND");
  assert.equal(
    index.getEvidence("busEntry", "entry-unbound", "page-b").status,
    "FOUND"
  );

  const otherProject = new EdaIrQueryIndex({
    ...ir,
    irSha256: "d".repeat(64)
  });
  assert.throws(
    () =>
      otherProject.listBusEntries({
        busId: "bus-a",
        limit: 1,
        cursor: entries.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("候选网表元组与排除项保持确定分页、筛选域和未验证边界", () => {
  const ir = fixture();
  const first = ir.pinInstances[0]!;
  const second = ir.pinInstances[1]!;
  const candidatePin = {
    ...first,
    connectionCandidate: {
      status: "UNIQUE_EXPLICIT_NET_CANDIDATE" as const,
      basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT" as const,
      electricalTruth: "NOT_VERIFIED" as const,
      explicitNets: [
        {
          netName: "CANDIDATE_NET",
          wireIds: ["wire-candidate"],
          segmentIds: ["segment-candidate"]
        }
      ],
      unlabeledWireIds: []
    }
  };
  const excludedPin = {
    ...second,
    connectionCandidate: {
      status: "DECLARED_NO_CONNECT" as const,
      basis: "COMPONENT_PIN_OVERRIDE_NO_CONNECT_ATTRIBUTE" as const,
      electricalTruth: "NOT_VERIFIED" as const,
      explicitNets: [],
      unlabeledWireIds: []
    }
  };
  const index = new EdaIrQueryIndex({
    ...ir,
    pinInstances: [candidatePin, excludedPin]
  });

  assert.deepEqual(index.getCandidateNetlistSummary(), {
    pinInstances: 2,
    eligibleTuples: 1,
    excludedPinInstances: 1,
    missingComponentRef: 0,
    nonComponentEndpoint: 0,
    missingPinNumber: 0,
    conflictingExplicitNetCandidates: 0,
    unresolvedWireWithoutExplicitNet: 0,
    declaredNoConnect: 1,
    unresolvedNoWire: 0,
    inconsistentCandidateState: 0
  });
  const tuples = index.listCandidateNetlistTuples({
    componentRef: candidatePin.designator,
    pinNumber: candidatePin.number,
    netName: "CANDIDATE_NET",
    pageId: candidatePin.pageId,
    limit: 1
  });
  assert.equal(tuples.total, 1);
  assert.deepEqual(tuples.items[0]?.tuple, {
    componentRef: candidatePin.designator,
    pinNumber: candidatePin.number,
    netName: "CANDIDATE_NET"
  });
  assert.equal(tuples.items[0]?.evidence.pinInstanceId, candidatePin.id);

  const exclusions = index.listCandidateNetlistExclusions({
    reason: "DECLARED_NO_CONNECT",
    componentId: excludedPin.componentId,
    pageId: excludedPin.pageId,
    limit: 1
  });
  assert.equal(exclusions.total, 1);
  assert.equal(exclusions.items[0]?.pinInstanceId, excludedPin.id);
  assert.equal(exclusions.items[0]?.reason, "DECLARED_NO_CONNECT");

  const unfiltered = index.listCandidateNetlistExclusions({ limit: 1 });
  assert.throws(
    () =>
      index.listCandidateNetlistExclusions({
        reason: "UNRESOLVED_NO_WIRE",
        limit: 1,
        cursor: unfiltered.nextCursor ?? "invalid"
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("Short 关系候选具有有界分页且 cursor 与状态筛选绑定", () => {
  const ir = fixture();
  const index = new EdaIrQueryIndex({
    ...ir,
    shortRelations: [
      shortRelation("short-a", "READY_EXPLICIT_NET_PAIR_CANDIDATE"),
      shortRelation("short-b", "UNRESOLVED_PIN_CONNECTION_CANDIDATE")
    ]
  });
  const first = index.listShortRelations({ limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.items[0]?.electricalTruth, "NOT_VERIFIED");
  assert.ok(first.nextCursor);
  assert.throws(
    () =>
      index.listShortRelations({
        limit: 1,
        cursor: first.nextCursor,
        status: "UNRESOLVED_PIN_CONNECTION_CANDIDATE"
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("网络端点候选分页 cursor 与端点类型筛选绑定", () => {
  const ir = fixture();
  const index = new EdaIrQueryIndex({
    ...ir,
    networkEndpointCandidates: [
      networkEndpoint(
        "flag-a",
        "NET_FLAG",
        "DECLARATION_MATCHES_CONNECTION_CANDIDATE"
      ),
      networkEndpoint(
        "port-a",
        "NET_PORT",
        "DECLARATION_MATCHES_CONNECTION_CANDIDATE"
      )
    ]
  });
  const first = index.listNetworkEndpointCandidates({ limit: 1 });
  assert.equal(first.total, 2);
  assert.ok(first.nextCursor);
  assert.throws(
    () =>
      index.listNetworkEndpointCandidates({
        limit: 1,
        cursor: first.nextCursor,
        endpointKind: "NET_PORT"
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});

test("证据查询可以通过所属文档精确定位页内对象", () => {
  const index = new EdaIrQueryIndex(fixture());
  const found = index.getEvidence("component", "component-1", "page-a");
  assert.equal(found.status, "FOUND");
  if (found.status === "FOUND") {
    assert.equal(found.evidence.provenance.line, 2);
  }
  assert.equal(index.getEvidence("component", "missing").status, "NOT_FOUND");
  assert.equal(index.getEvidence("variant", "variant-1").status, "FOUND");
  assert.equal(
    index.getEvidence("componentGroup", "group-direct").status,
    "FOUND"
  );
});

test("重复局部 ID 的来源证据显式返回歧义", () => {
  const ir = fixture();
  const duplicated = {
    ...ir,
    components: [...ir.components, component("component-1", "R9", "page-c")]
  };
  const index = new EdaIrQueryIndex(duplicated);
  const ambiguous = index.getEvidence("component", "component-1");
  assert.equal(ambiguous.status, "AMBIGUOUS");
  if (ambiguous.status === "AMBIGUOUS") {
    assert.equal(ambiguous.total, 2);
  }
  assert.equal(
    index.getEvidence("component", "component-1", "page-c").status,
    "FOUND"
  );
});
