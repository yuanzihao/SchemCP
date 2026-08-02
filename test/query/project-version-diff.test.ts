import assert from "node:assert/strict";
import test from "node:test";
import type {
  EdaIr,
  IrComponent,
  IrComponentSemantic,
  IrInterface,
  IrRecordProvenance,
  IrResourceEdge,
  IrSchematicAnnotation,
  IrSchematicTable,
  IrSymbolText,
  IrWire
} from "../../src/ir/model.js";
import { QueryError } from "../../src/query/index.js";
import { ProjectVersionDiffIndex } from "../../src/query/project-version-diff.js";

const PROVENANCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  recordId: "component-a",
  ticket: 1,
  client: "client",
  entry: "epru",
  line: 2
};

function effectiveState(id: string) {
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
      logicalComponentId: `logical-${id}`,
      status: "UNKNOWN" as const,
      reason: "SYMBOL_REFERENCE_MISSING" as const,
      units: [{ componentId: id, pageId: "page-a", partId: "part-a" }],
      declaredPartIds: [],
      instantiatedPartIds: ["part-a"],
      missingPartIds: [],
      duplicatePartIds: [],
      symbolPinCount: 0,
      instantiatedPinCount: 0,
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
  x: number,
  ticket = 1
): IrComponent {
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position: { x, y: 2 },
    rotation: 0,
    mirrored: false,
    designator,
    symbolBinding: {
      key: "Symbol",
      state: "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      componentAttributes: []
    },
    footprintBinding: {
      key: "Footprint",
      state: "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      componentAttributes: []
    },
    ...effectiveState(id),
    attributes: [],
    provenance: { ...PROVENANCE, recordId: id, ticket },
    extensions: { easyeda: { ignoredVendorField: ticket } }
  };
}

function componentSemantic(
  componentId: string,
  primaryRole: IrComponentSemantic["primaryRole"]
): IrComponentSemantic {
  return {
    id: `semantic-${componentId}`,
    componentId,
    pageId: "page-a",
    logicalComponentId: `logical-${componentId}`,
    unitComponentIds: [componentId],
    primaryRole,
    roles: [
      {
        role: primaryRole,
        ruleId: `fixture.${primaryRole.toLocaleLowerCase("en-US")}.v1`,
        evidenceClass: "DETERMINISTIC_RULE",
        truthStatus: primaryRole === "UNKNOWN" ? "UNRESOLVED" : "CANDIDATE",
        semanticRuleSetVersion: "schemcp.semantic-rules/1",
        provenance: [PROVENANCE]
      }
    ],
    powerDomains: [],
    ruleId: "component.semantic.aggregate.v1",
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: primaryRole === "UNKNOWN" ? "UNRESOLVED" : "CANDIDATE",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: [PROVENANCE]
  };
}

function interfaceCandidate(
  id: string,
  status: IrInterface["status"]
): IrInterface {
  return {
    id,
    type: "SWD",
    group: "SWD",
    logicalComponentId: "logical-component-a",
    componentRefs: [{ componentId: "component-a", pageId: "page-a" }],
    status,
    activityStatus: "ACTIVE",
    signals: [],
    requiredSignals: ["SWDIO", "SWCLK"],
    missingSignals: status === "CANDIDATE" ? [] : ["SWCLK"],
    unresolvedReasons: status === "UNRESOLVED" ? ["ASSEMBLY_UNKNOWN"] : [],
    ruleId: "interface.swd.signal-set.v1",
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: status === "UNRESOLVED" ? "UNRESOLVED" : "CANDIDATE",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: [PROVENANCE]
  };
}

function resourceEdge(
  id: string,
  status: IrResourceEdge["status"]
): IrResourceEdge {
  return {
    id,
    resourceType: "POWER",
    kind: "POWER_CONVERSION",
    direction: "DIRECTED",
    from: {
      kind: "NET",
      id: "net-vin",
      pageId: "page-a",
      netName: "VIN"
    },
    to: {
      kind: "NET",
      id: "net-vout",
      pageId: "page-a",
      netName: "VOUT"
    },
    viaComponentRefs: [
      {
        componentId: "component-a",
        pageId: "page-a",
        logicalComponentId: "logical-component-a"
      }
    ],
    pinInstanceIds: ["pin-in", "pin-out"],
    activityStatus: "ACTIVE",
    isolationStatus: "NOT_INDICATED",
    status,
    unresolvedReasons:
      status === "UNRESOLVED" ? ["PIN_COMPLETENESS_NOT_COMPLETE"] : [],
    ruleId: "resource.power.ldo-conversion.v1",
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: status === "CANDIDATE" ? "CANDIDATE" : "UNRESOLVED",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: [PROVENANCE]
  };
}

function wire(id: string, netName: string): IrWire {
  return {
    id,
    pageId: "page-a",
    explicitNetName: netName,
    segments: [
      {
        id: `${id}:segment`,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        provenance: {
          ...PROVENANCE,
          recordType: "LINE",
          recordId: `${id}:segment`
        },
        extensions: { easyeda: {} }
      }
    ],
    attributes: [],
    provenance: {
      ...PROVENANCE,
      recordType: "WIRE",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function annotation(id: string, text: string): IrSchematicAnnotation {
  return {
    id,
    pageId: "page-a",
    text,
    contentState: text === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
    position: { x: 1, y: 2 },
    rotation: 0,
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    basis: "EXPLICIT_SCHEMATIC_TEXT_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      ...PROVENANCE,
      recordType: "TEXT",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function schematicTable(id: string, value: string): IrSchematicTable {
  return {
    id,
    documentId: "page-a",
    documentType: "SCHEMATIC_PAGE",
    partBinding: { state: "NOT_APPLICABLE" },
    position: { x: 1, y: 2 },
    rowSizes: [10],
    columnSizes: [20],
    rowLocked: [false],
    columnLocked: [false],
    lockEncoding: "INTEGER_0_1",
    rotation: 0,
    cells: [
      {
        id: `${id}-cell`,
        value,
        contentState: value === "" ? "EXPLICIT_EMPTY" : "EXPLICIT_TEXT",
        rowIndex: 0,
        columnIndex: 0,
        rowSpan: 1,
        columnSpan: 1,
        representation: "V3_INLINE_TABLE_CELL",
        semanticInterpretation: "NOT_PERFORMED",
        electricalTruth: "NOT_APPLICABLE",
        provenance: [
          {
            ...PROVENANCE,
            recordType: "TABLE",
            recordId: id
          }
        ],
        extensions: { easyeda: {} }
      }
    ],
    coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
    layoutValidation: "INDEX_AND_SPAN_BOUNDS_VALIDATED",
    basis: "EXPLICIT_SCHEMATIC_TABLE_AND_CELL_FIELDS",
    sourceAuthenticity: "NOT_VERIFIED",
    semanticInterpretation: "NOT_PERFORMED",
    electricalTruth: "NOT_APPLICABLE",
    provenance: {
      ...PROVENANCE,
      recordType: "TABLE",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function symbolText(id: string, text: string): IrSymbolText {
  return {
    id,
    symbolId: "symbol-a",
    partId: "part-a",
    partBinding: { state: "RESOLVED_EXACT", targetId: "part-a" },
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
      documentId: "symbol-a",
      documentType: "SYMBOL",
      recordType: "TEXT",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}





























function ir(
  options: {
    readonly components?: readonly IrComponent[];
    readonly wires?: readonly IrWire[];
    readonly schematicAnnotations?: readonly IrSchematicAnnotation[];
    readonly schematicTables?: readonly IrSchematicTable[];
    readonly symbolTexts?: readonly IrSymbolText[];
    readonly componentSemantics?: readonly IrComponentSemantic[];
    readonly interfaces?: readonly IrInterface[];
    readonly resourceEdges?: readonly IrResourceEdge[];
    readonly irSha256?: string;
    readonly archiveSha256?: string;
  } = {}
): EdaIr {
  const components = options.components ?? [];
  const wires = options.wires ?? [];
  const schematicAnnotations = options.schematicAnnotations ?? [];
  const schematicTables = options.schematicTables ?? [];
  const symbolTexts = options.symbolTexts ?? [];
  const componentSemantics = options.componentSemantics ?? [];
  const interfaces = options.interfaces ?? [];
  const resourceEdges = options.resourceEdges ?? [];
  return {
    schema: "schemcp.eda-ir",
    schemaVersion: "1.1.0",
    generator: {
      name: "@yuanzihao/schemcp",
      version: "0.2.0"
    },
    source: {
      format: "EASYEDA_V3_LOG",
      archiveSha256: options.archiveSha256 ?? "a".repeat(64),
      reducedStateSha256: "b".repeat(64),
      electricalTruth: "NOT_VERIFIED"
    },
    documents: [],
    projectConfigurations: [],
    boards: [],
    schematics: [],
    schematicPages: [],
    schematicAnnotations,
    schematicGraphicPrimitives: [],
    schematicTables,
    variants: [],
    componentGroups: [],
    instanceContexts: [],
    componentOccurrences: [],
    components,
    componentSemantics,
    interfaces,
    resourceNodes: [
      ...new Map(
        resourceEdges
          .flatMap((item) => [item.from, item.to])
          .map((item) => [item.id, item])
      ).values()
    ],
    resourceEdges,
    symbols: [],
    symbolParts: [],
    symbolTexts,
    symbolPins: [],
    devices: [],
    wires,
    buses: [],
    busEntries: [],
    pinInstances: [],
    shortRelations: [],
    networkEndpointCandidates: [],
    unboundAttributes: [],
    unmodeledRecords: [],
    diagnostics: [],
    summary: {
      components: components.length,
      componentsWithDesignator: components.filter(
        (item) => item.designator !== undefined
      ).length,
      wires: wires.length,
      wiresWithExplicitNet: wires.filter(
        (item) => item.explicitNetName !== undefined
      ).length,
      schematicAnnotations: schematicAnnotations.length,
      schematicTables: schematicTables.length,
      symbolTexts: symbolTexts.length,
    } as EdaIr["summary"],
    irSha256: options.irSha256 ?? "c".repeat(64)
  };
}

test("工程差异覆盖摘要、组件和显式网络且不把来源位置当作语义变化", () => {
  const baseline = ir({
    components: [component("component-a", "R1", 1, 1)]
  });
  const current = ir({
    components: [
      component("component-a", "R1", 5, 99),
      component("component-b", "R2", 8)
    ],
    wires: [wire("wire-a", "VCC")],
    irSha256: "d".repeat(64),
    archiveSha256: "e".repeat(64)
  });
  const index = new ProjectVersionDiffIndex(baseline, current);

  assert.equal(index.summary.status, "CHANGES_FOUND");
  assert.equal(index.summary.projectContinuity, "NOT_VERIFIED");
  assert.equal(index.summary.electricalTruth, "NOT_VERIFIED");
  assert.equal(index.summary.byEntityKind.COMPONENT.added, 1);
  assert.equal(index.summary.byEntityKind.COMPONENT.modified, 1);
  assert.equal(index.summary.byEntityKind.WIRE.added, 1);
  assert.equal(index.summary.byEntityKind.EXPLICIT_NET.added, 1);

  const modified = index.listChanges({
    entityKind: "COMPONENT",
    changeType: "MODIFIED"
  });
  assert.equal(modified.total, 1);
  assert.equal(modified.items[0]?.entityId, "component-a");
  assert.deepEqual(modified.items[0]?.changedFields, ["position"]);
  assert.equal("beforeValue" in (modified.items[0] ?? {}), false);

  const summaryChanges = index.listChanges({
    entityKind: "SUMMARY_METRIC"
  });
  assert.equal(summaryChanges.total, 4);
  assert.deepEqual(
    summaryChanges.items.map((item) => [
      item.entityId,
      item.beforeValue,
      item.afterValue
    ]),
    [
      ["components", 1, 2],
      ["componentsWithDesignator", 1, 2],
      ["wires", 0, 1],
      ["wiresWithExplicitNet", 0, 1]
    ]
  );
});

test("只有 provenance 和 extensions 变化时保持无语义差异", () => {
  const baseline = ir({
    components: [component("component-a", "R1", 1, 1)]
  });
  const current = ir({
    components: [component("component-a", "R1", 1, 999)],
    irSha256: "d".repeat(64),
    archiveSha256: "e".repeat(64)
  });
  const index = new ProjectVersionDiffIndex(baseline, current);
  assert.equal(index.summary.status, "NO_CHANGES");
  assert.equal(index.listChanges().total, 0);
});

test("同一实体新增可选字段时显式报告字段变化", () => {
  const baselineComponent = component("component-a", "R1", 1);
  const currentComponent: IrComponent = {
    ...baselineComponent,
    deviceId: "device-a"
  };
  const index = new ProjectVersionDiffIndex(
    ir({ components: [baselineComponent] }),
    ir({
      components: [currentComponent],
      irSha256: "d".repeat(64)
    })
  );
  const changes = index.listChanges({
    entityKind: "COMPONENT",
    changeType: "MODIFIED"
  });
  assert.equal(changes.total, 1);
  assert.deepEqual(changes.items[0]?.changedFields, ["deviceId"]);
});

test("工程差异覆盖组件语义、接口候选和资源边", () => {
  const baselineSemantic = componentSemantic("component-a", "UNKNOWN");
  const currentSemantic = componentSemantic("component-a", "MCU_MPU");
  const baselineInterface = interfaceCandidate("interface-a", "PARTIAL_CANDIDATE");
  const currentInterface = interfaceCandidate("interface-a", "CANDIDATE");
  const baselineResource = resourceEdge("resource-a", "UNRESOLVED");
  const currentResource = resourceEdge("resource-a", "CANDIDATE");
  const index = new ProjectVersionDiffIndex(
    ir({
      componentSemantics: [baselineSemantic],
      interfaces: [baselineInterface],
      resourceEdges: [baselineResource]
    }),
    ir({
      componentSemantics: [currentSemantic],
      interfaces: [currentInterface],
      resourceEdges: [currentResource],
      irSha256: "d".repeat(64)
    })
  );
  assert.equal(index.summary.byEntityKind.COMPONENT_SEMANTIC.modified, 1);
  assert.equal(index.summary.byEntityKind.INTERFACE.modified, 1);
  assert.equal(index.summary.byEntityKind.RESOURCE_NODE.unchanged, 2);
  assert.equal(index.summary.byEntityKind.RESOURCE_EDGE.modified, 1);
  assert.deepEqual(
    index.listChanges({ entityKind: "COMPONENT_SEMANTIC" }).items[0]
      ?.changedFields,
    ["primaryRole", "roles", "truthStatus"]
  );
  assert.deepEqual(
    index.listChanges({ entityKind: "INTERFACE" }).items[0]?.changedFields,
    ["missingSignals", "status"]
  );
  assert.deepEqual(
    index.listChanges({ entityKind: "RESOURCE_EDGE" }).items[0]?.changedFields,
    ["status", "truthStatus", "unresolvedReasons"]
  );
});



test("工程差异覆盖显式原理图注释但不比较来源扩展", () => {
  const baselineAnnotation = annotation("annotation-a", "Power input");
  const currentAnnotation = {
    ...annotation("annotation-a", "Power input updated"),
    provenance: {
      ...annotation("annotation-a", "Power input updated").provenance,
      ticket: 99
    },
    extensions: { easyeda: { vendorOnly: true } }
  };
  const index = new ProjectVersionDiffIndex(
    ir({ schematicAnnotations: [baselineAnnotation] }),
    ir({
      schematicAnnotations: [
        currentAnnotation,
        annotation("annotation-b", "UART debug")
      ],
      irSha256: "d".repeat(64)
    })
  );
  assert.equal(
    index.summary.byEntityKind.SCHEMATIC_ANNOTATION.modified,
    1
  );
  assert.equal(index.summary.byEntityKind.SCHEMATIC_ANNOTATION.added, 1);
  const modified = index.listChanges({
    entityKind: "SCHEMATIC_ANNOTATION",
    changeType: "MODIFIED"
  });
  assert.deepEqual(modified.items[0]?.changedFields, ["text"]);
});

test("工程差异把原理图表格元数据与单元格拆成独立实体", () => {
  const baseline = schematicTable("table-a", "BOOT0");
  const current = {
    ...schematicTable("table-a", "BOOT1"),
    position: { x: 5, y: 2 }
  };
  const index = new ProjectVersionDiffIndex(
    ir({ schematicTables: [baseline] }),
    ir({
      schematicTables: [current],
      irSha256: "d".repeat(64)
    })
  );
  assert.equal(index.summary.byEntityKind.SCHEMATIC_TABLE.modified, 1);
  assert.equal(index.summary.byEntityKind.SCHEMATIC_TABLE_CELL.modified, 1);
  const tableChanges = index.listChanges({
    entityKind: "SCHEMATIC_TABLE",
    changeType: "MODIFIED"
  });
  assert.deepEqual(tableChanges.items[0]?.changedFields, ["position"]);
  const cellChanges = index.listChanges({
    entityKind: "SCHEMATIC_TABLE_CELL",
    changeType: "MODIFIED"
  });
  assert.deepEqual(cellChanges.items[0]?.changedFields, ["value"]);
});

test("工程差异覆盖符号显式文字但不比较来源扩展", () => {
  const baseline = symbolText("text-a", "UART_TX");
  const current = {
    ...symbolText("text-a", "UART_TX updated"),
    provenance: {
      ...symbolText("text-a", "UART_TX updated").provenance,
      ticket: 99
    },
    extensions: { easyeda: { vendorOnly: true } }
  };
  const index = new ProjectVersionDiffIndex(
    ir({ symbolTexts: [baseline] }),
    ir({
      symbolTexts: [current, symbolText("text-b", "Power")],
      irSha256: "d".repeat(64)
    })
  );
  assert.equal(index.summary.byEntityKind.SYMBOL_TEXT.modified, 1);
  assert.equal(index.summary.byEntityKind.SYMBOL_TEXT.added, 1);
  const modified = index.listChanges({
    entityKind: "SYMBOL_TEXT",
    changeType: "MODIFIED"
  });
  assert.deepEqual(modified.items[0]?.changedFields, ["text"]);
});



















test("重复局部键按语义排序配对，不会因输入顺序产生伪差异", () => {
  const first = component("duplicate", "R1", 1);
  const second = component("duplicate", "R2", 2);
  const index = new ProjectVersionDiffIndex(
    ir({ components: [first, second] }),
    ir({ components: [second, first], irSha256: "d".repeat(64) })
  );
  assert.equal(index.summary.status, "NO_CHANGES");
  assert.equal(index.summary.byEntityKind.COMPONENT.unchanged, 2);
});

test("差异分页 cursor 与筛选域绑定并限制页大小", () => {
  const index = new ProjectVersionDiffIndex(
    ir(),
    ir({
      components: [
        component("component-a", "R1", 1),
        component("component-b", "R2", 2)
      ]
    })
  );
  const first = index.listChanges({
    entityKind: "COMPONENT",
    limit: 1
  });
  assert.equal(first.total, 2);
  const cursor = first.nextCursor;
  assert.ok(cursor);
  assert.equal(
    index.listChanges({
      entityKind: "COMPONENT",
      limit: 1,
      cursor
    }).items[0]?.entityId,
    "component-b"
  );
  assert.throws(
    () =>
      index.listChanges({
        entityKind: "WIRE",
        limit: 1,
        cursor
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  assert.throws(
    () => index.listChanges({ limit: 51 }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_LIMIT"
  );
});
