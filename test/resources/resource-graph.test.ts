import assert from "node:assert/strict";
import test from "node:test";
import type {
  EdaIr,
  IrComponent,
  IrComponentPowerDomainCandidate,
  IrComponentRole,
  IrComponentSemantic,
  IrPinInstance,
  IrRecordProvenance
} from "../../src/ir/model.js";
import { ResourceGraphQueryIndex } from "../../src/query/resource-graph.js";
import { compileResources } from "../../src/resources/compile-resources.js";

const PROVENANCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  ticket: 1,
  client: "fixture",
  entry: "fixture.epru",
  line: 1
};

function component(id: string, designator: string): IrComponent {
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position: { x: 0, y: 0 },
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
    assembly: {
      status: "POPULATED",
      reason: "EXPLICIT_ADD_INTO_BOM_YES",
      attributeKey: "Add into BOM",
      values: ["yes"],
      resolution: "COMPONENT_EXPLICIT",
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      semanticRuleSetVersion: "schemcp.semantic-rules/1",
      provenance: [PROVENANCE]
    },
    pinCompleteness: {
      logicalComponentId: `logical-${id}`,
      status: "COMPLETE",
      reason: "SINGLE_SYMBOL_PART_COMPLETE",
      units: [{ componentId: id, pageId: "page-a", partId: "part-a" }],
      declaredPartIds: ["part-a"],
      instantiatedPartIds: ["part-a"],
      missingPartIds: [],
      duplicatePartIds: [],
      symbolPinCount: 1,
      instantiatedPinCount: 1,
      hiddenPinCount: 0,
      evidenceClass: "DETERMINISTIC_RULE",
      truthStatus: "NOT_VERIFIED",
      semanticRuleSetVersion: "schemcp.semantic-rules/1",
      provenance: [PROVENANCE]
    },
    attributes: [],
    provenance: { ...PROVENANCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function pin(
  componentId: string,
  id: string,
  name: string,
  netName: string
): IrPinInstance {
  return {
    id,
    pageId: "page-a",
    componentId,
    symbolId: `symbol-${componentId}`,
    symbolPinId: `symbol-pin-${id}`,
    partId: "part-a",
    display: true,
    endpointKind: "PART_SYMBOL_PIN",
    name,
    number: id,
    instanceAttributes: [],
    connectionPoint: { x: 0, y: 0 },
    connectionCandidate: {
      status: "UNIQUE_EXPLICIT_NET_CANDIDATE",
      basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
      electricalTruth: "NOT_VERIFIED",
      explicitNets: [
        { netName, wireIds: [`wire-${id}`], segmentIds: [`segment-${id}`] }
      ],
      unlabeledWireIds: []
    },
    provenance: {
      component: { ...PROVENANCE, recordId: componentId },
      symbol: {
        ...PROVENANCE,
        documentId: `symbol-${componentId}`,
        documentType: "SYMBOL",
        recordType: "META"
      },
      symbolPin: {
        ...PROVENANCE,
        documentId: `symbol-${componentId}`,
        documentType: "SYMBOL",
        recordType: "PIN",
        recordId: `symbol-pin-${id}`
      }
    }
  };
}

function domain(
  componentId: string,
  id: string,
  netName: string,
  relationship: IrComponentPowerDomainCandidate["relationship"],
  pinInstanceId: string
): IrComponentPowerDomainCandidate {
  return {
    id,
    name: netName,
    pageId: "page-a",
    netName,
    relationship,
    pinInstanceIds: [pinInstanceId],
    isolationStatus: "NOT_INDICATED",
    ruleId: "power-domain.explicit-pin-net.v1",
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: "CANDIDATE",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: [{ ...PROVENANCE, recordId: componentId }]
  };
}

function semantic(
  componentId: string,
  role: IrComponentRole,
  powerDomains: readonly IrComponentPowerDomainCandidate[] = []
): IrComponentSemantic {
  return {
    id: `semantic-${componentId}`,
    componentId,
    pageId: "page-a",
    logicalComponentId: `logical-${componentId}`,
    unitComponentIds: [componentId],
    primaryRole: role,
    roles: [
      {
        role,
        ruleId: `fixture.${role.toLocaleLowerCase("en-US")}.v1`,
        evidenceClass: "DETERMINISTIC_RULE",
        truthStatus: role === "UNKNOWN" ? "UNRESOLVED" : "CANDIDATE",
        semanticRuleSetVersion: "schemcp.semantic-rules/1",
        provenance: [PROVENANCE]
      }
    ],
    powerDomains,
    ruleId: "component.semantic.aggregate.v1",
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: role === "UNKNOWN" ? "UNRESOLVED" : "CANDIDATE",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: [PROVENANCE]
  };
}

test("资源编译器只沿明确角色和显式网络生成电源、外部时钟及复位启动边", () => {
  const components = [
    component("input", "J1"),
    component("ldo", "U1"),
    component("power-switch", "U3"),
    component("mcu", "U2"),
    component("clock", "Y1"),
    component("clock-buffer", "U4"),
    component("external-reset", "J2"),
    component("manual-reset", "SW1"),
    component("isolator", "U6"),
    component("boot-bias", "R1"),
    component("reset-bias", "R2")
  ];
  const pins = [
    pin("input", "p1", "VIN", "+12V"),
    pin("ldo", "p2", "VIN", "+12V"),
    pin("ldo", "p3", "VOUT", "+3V3"),
    pin("power-switch", "p14", "VIN", "+3V3"),
    pin("power-switch", "p15", "VOUT", "+3V3_SW"),
    pin("mcu", "p4", "VDD", "+3V3"),
    pin("mcu", "p5", "OSC_IN", "HSE_CLK"),
    pin("mcu", "p6", "NRST", "NRST"),
    pin("mcu", "p7", "BOOT0", "BOOT0"),
    pin("mcu", "p8", "PA9/USART1_TX", "USART1_TX"),
    pin("clock", "p9", "OSC_OUT", "HSE_CLK"),
    pin("clock-buffer", "p16", "CLK_IN", "HSE_CLK"),
    pin("clock-buffer", "p17", "CLK_OUT0", "CLK_A"),
    pin("clock-buffer", "p18", "CLK_OUT1", "CLK_B"),
    pin("external-reset", "p19", "NRST", "NRST"),
    pin("manual-reset", "p20", "NRST", "NRST"),
    pin("manual-reset", "p21", "GND", "GND"),
    pin("isolator", "p22", "VDD", "+3V3"),
    pin("isolator", "p23", "VDD", "+3V3_ISO"),
    pin("boot-bias", "p10", "BOOT0", "BOOT0"),
    pin("boot-bias", "p11", "GND", "GND"),
    pin("reset-bias", "p12", "NRST", "NRST"),
    pin("reset-bias", "p13", "VDD", "+3V3")
  ];
  const semantics = [
    semantic("input", "POWER_INPUT", [
      domain("input", "d1", "+12V", "INPUT", "p1")
    ]),
    semantic("ldo", "LDO", [
      domain("ldo", "d2", "+12V", "INPUT", "p2"),
      domain("ldo", "d3", "+3V3", "OUTPUT", "p3")
    ]),
    semantic("power-switch", "POWER_SWITCH_CANDIDATE", [
      domain("power-switch", "d5", "+3V3", "INPUT", "p14"),
      domain("power-switch", "d6", "+3V3_SW", "OUTPUT", "p15")
    ]),
    semantic("mcu", "MCU_MPU", [
      domain("mcu", "d4", "+3V3", "RELATED", "p4")
    ]),
    semantic("clock", "CRYSTAL_OSCILLATOR"),
    semantic("clock-buffer", "CLOCK_BUFFER_CANDIDATE"),
    semantic("external-reset", "CONNECTOR"),
    semantic("manual-reset", "UNKNOWN"),
    semantic("isolator", "ISOLATOR_CANDIDATE", [
      domain("isolator", "d7", "+3V3", "RELATED", "p22"),
      domain("isolator", "d8", "+3V3_ISO", "RELATED", "p23")
    ]),
    semantic("boot-bias", "BOOT_STRAP"),
    semantic("reset-bias", "PASSIVE")
  ];
  const compiled = compileResources(components, semantics, pins);
  const edges = compiled.resourceEdges;
  assert.equal(
    compiled.resourceNodes.length,
    new Set(edges.flatMap((item) => [item.from.id, item.to.id])).size
  );
  assert.equal(edges.every((item) => item.unresolvedReasons.length === 0), true);
  assert.equal(
    edges.filter((item) => item.viaComponentRefs[0]?.componentId === "isolator")
      .every((item) => item.isolationStatus === "ISOLATION_CANDIDATE"),
    true
  );
  const unknownAssemblyComponents = components.map((item) =>
    item.id === "input"
      ? {
          ...item,
          assembly: {
            ...item.assembly,
            status: "UNKNOWN" as const,
            reason: "ADD_INTO_BOM_MISSING" as const,
            values: [],
            resolution: "MISSING" as const,
            evidenceClass: "DETERMINISTIC_RULE" as const
          }
        }
      : item
  );
  assert.equal(
    compileResources(unknownAssemblyComponents, semantics, pins).resourceEdges.some(
      (item) =>
        item.status === "UNRESOLVED" &&
        item.unresolvedReasons.includes("ASSEMBLY_STATUS_UNKNOWN")
    ),
    true
  );
  const dnpComponents = components.map((item) =>
    item.id === "ldo"
      ? {
          ...item,
          assembly: {
            ...item.assembly,
            status: "DNP" as const,
            reason: "EXPLICIT_ADD_INTO_BOM_NO" as const,
            values: ["no"]
          }
        }
      : item
  );
  const dnpCompilation = compileResources(dnpComponents, semantics, pins);
  const dnpIr = {
    resourceNodes: dnpCompilation.resourceNodes,
    resourceEdges: dnpCompilation.resourceEdges,
    componentOccurrences: [],
    irSha256: "d".repeat(64)
  } as unknown as EdaIr;
  const dnpQuery = new ResourceGraphQueryIndex(dnpIr);
  assert.equal(
    dnpQuery
      .query("POWER", { maxDepth: 8, limit: 50 })
      .edges.items.some((item) => item.edge.kind === "POWER_CONVERSION"),
    false
  );
  assert.equal(
    dnpQuery.query("POWER", {
      activityStatus: "EXCLUDED_DNP",
      maxDepth: 8,
      limit: 50
    }).edges.items.some(
      (item) =>
        item.edge.kind === "POWER_CONVERSION" &&
        item.edge.activityStatus === "EXCLUDED_DNP"
    ),
    true
  );
  const kinds = new Set(edges.map((item) => item.kind));
  for (const kind of [
    "POWER_SOURCE_ENTRY",
    "POWER_CONVERSION",
    "POWER_SWITCH_TRANSFER_CANDIDATE",
    "POWER_LOAD",
    "CLOCK_SOURCE_OUTPUT",
    "CLOCK_BUFFER_INPUT",
    "CLOCK_BUFFER_OUTPUT",
    "CLOCK_SINK_INPUT",
    "RESET_SINK_INPUT",
    "RESET_EXTERNAL_SOURCE_CANDIDATE",
    "RESET_MANUAL_SOURCE_CANDIDATE",
    "RESET_BIAS_CANDIDATE",
    "BOOT_STRAP_INPUT",
    "BOOT_BIAS_CANDIDATE",
    "MCU_PIN_CONNECTION"
  ]) {
    assert.equal(kinds.has(kind as never), true, `缺少 ${kind}`);
  }
  assert.equal(
    edges.every(
      (item) =>
        item.semanticRuleSetVersion === "schemcp.semantic-rules/1" &&
        item.provenance.length > 0
    ),
    true
  );

  const ir = {
    resourceEdges: edges,
    componentOccurrences: [],
    irSha256: "a".repeat(64)
  } as unknown as EdaIr;
  const query = new ResourceGraphQueryIndex(ir);
  const power = query.query("POWER", { maxDepth: 8, limit: 50 });
  assert.equal(power.edges.total, 6);
  assert.equal(power.cycleDetected, false);
  assert.equal(power.truncatedByDepth, false);
  assert.equal(power.truncationReason, "NONE");
  assert.equal(
    power.edges.items.every(
      (item) =>
        item.rootNodeIds.length > 0 &&
        item.rootNodeIds.every((id) => power.roots.some((root) => root.id === id))
    ),
    true
  );
  const clock = query.query("CLOCK", { maxDepth: 8, limit: 50 });
  assert.equal(clock.edges.total, 5);
  assert.equal(clock.nodeCount, 6);
  const shallow = query.query("POWER", { maxDepth: 1, limit: 50 });
  assert.equal(shallow.truncatedByDepth, true);
  assert.equal(shallow.truncationReason, "MAX_DEPTH_REACHED");
  assert.throws(
    () => query.query("POWER", { maxDepth: 9 }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "QUERY_INVALID_LIMIT"
  );
  const first = query.query("POWER", { maxDepth: 8, limit: 1 });
  assert.ok(first.edges.nextCursor);
  assert.throws(
    () =>
      query.query("POWER", {
        maxDepth: 7,
        limit: 1,
        cursor: first.edges.nextCursor
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "QUERY_INVALID_CURSOR"
  );

  const conversion = edges.find((item) => item.kind === "POWER_CONVERSION");
  assert.ok(conversion);
  const isolatedConversion = {
    ...conversion,
    id: "isolated-power-conversion",
    direction: "BIDIRECTIONAL" as const,
    from: { ...conversion.from, id: "isolated-power-input" },
    to: { ...conversion.to, id: "isolated-power-output" }
  };
  const disconnectedIr = {
    ...ir,
    resourceEdges: [...edges, isolatedConversion]
  } as EdaIr;
  const disconnected = new ResourceGraphQueryIndex(disconnectedIr).query(
    "POWER",
    { maxDepth: 8, limit: 50 }
  );
  assert.equal(disconnected.edges.total, 7);
  assert.equal(
    disconnected.edges.items.some(
      (item) => item.edge.id === "isolated-power-conversion"
    ),
    true
  );
  const isolatedTraversal = disconnected.edges.items.find(
    (item) => item.edge.id === "isolated-power-conversion"
  );
  assert.ok(isolatedTraversal);
  assert.equal(isolatedTraversal.rootNodeIds.length, 1);
  const isolatedRootId = isolatedTraversal.rootNodeIds[0];
  assert.ok(isolatedRootId);
  assert.equal(
    disconnected.roots.some(
      (root) =>
        root.id === isolatedRootId &&
        (root.id === "isolated-power-input" ||
          root.id === "isolated-power-output")
    ),
    true
  );
  assert.equal(
    disconnected.edges.items
      .filter((item) => item.edge.id !== "isolated-power-conversion")
      .some((item) => item.rootNodeIds.includes(isolatedRootId)),
    false
  );
});
