import assert from "node:assert/strict";
import test from "node:test";
import { compileShortRelations } from "../../src/connectivity/compile-short-relations.js";
import type {
  IrComponent,
  IrPinConnectionCandidateStatus,
  IrPinInstance,
  IrRecordProvenance,
  IrSymbol
} from "../../src/ir/model.js";

const SOURCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  ticket: 1,
  client: "client-a",
  entry: "fixture.epru",
  line: 1
};

const SHORT_SYMBOL: IrSymbol = {
  id: "short-symbol",
  symbolType: 22,
  attributes: [],
  provenance: {
    ...SOURCE,
    documentId: "short-symbol",
    documentType: "SYMBOL",
    recordType: "META"
  },
  extensions: { easyeda: {} }
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
      status: "COMPLETE" as const,
      reason: "SINGLE_SYMBOL_PART_COMPLETE" as const,
      units: [{ componentId: id, pageId: "page-a", partId: "part-a" }],
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

function component(id: string): IrComponent {
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirrored: false,
    symbolId: SHORT_SYMBOL.id,
    symbolBinding: {
      key: "Symbol",
      state: "BOUND_COMPONENT_OVERRIDE",
      targetId: SHORT_SYMBOL.id,
      componentAttributes: []
    },
    footprintBinding: {
      key: "Footprint",
      state: "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      componentAttributes: []
    },
    ...effectiveState(id),
    attributes: [],
    provenance: { ...SOURCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function pin(
  componentId: string,
  index: number,
  status: IrPinConnectionCandidateStatus,
  netNames: readonly string[]
): IrPinInstance {
  return {
    id: `${componentId}-pin-${index}`,
    pageId: "page-a",
    componentId,
    symbolId: SHORT_SYMBOL.id,
    symbolPinId: `symbol-pin-${index}`,
    partId: "part-a",
    endpointKind: "SHORT_SYMBOL_PIN",
    symbolType: 22,
    number: String(index),
    instanceAttributes: [],
    connectionPoint: { x: index, y: 0 },
    connectionCandidate: {
      status,
      basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
      electricalTruth: "NOT_VERIFIED",
      explicitNets: netNames.map((netName, netIndex) => ({
        netName,
        wireIds: [`${componentId}-wire-${netIndex}`],
        segmentIds: [`${componentId}-segment-${netIndex}`]
      })),
      unlabeledWireIds: []
    },
    provenance: {
      component: { ...SOURCE, recordId: componentId },
      symbol: SHORT_SYMBOL.provenance,
      symbolPin: {
        ...SOURCE,
        documentId: SHORT_SYMBOL.id,
        documentType: "SYMBOL",
        recordType: "PIN",
        recordId: `symbol-pin-${index}`
      }
    }
  };
}

test("Short Symbol 关系候选区分可配对、同网、未解析、冲突和非法引脚数", () => {
  const components = [
    component("ready"),
    component("same"),
    component("unresolved"),
    component("conflict"),
    component("invalid")
  ];
  const pins = [
    pin("ready", 1, "UNIQUE_EXPLICIT_NET_CANDIDATE", ["NET_A"]),
    pin("ready", 2, "UNIQUE_EXPLICIT_NET_CANDIDATE", ["NET_B"]),
    pin("same", 1, "UNIQUE_EXPLICIT_NET_CANDIDATE", ["GND"]),
    pin("same", 2, "UNIQUE_EXPLICIT_NET_CANDIDATE", ["GND"]),
    pin("unresolved", 1, "UNIQUE_EXPLICIT_NET_CANDIDATE", ["DATA"]),
    pin("unresolved", 2, "UNRESOLVED_NO_WIRE", []),
    pin("conflict", 1, "CONFLICTING_EXPLICIT_NET_CANDIDATES", [
      "LEFT",
      "RIGHT"
    ]),
    pin("conflict", 2, "UNIQUE_EXPLICIT_NET_CANDIDATE", ["OUT"]),
    pin("invalid", 1, "UNIQUE_EXPLICIT_NET_CANDIDATE", ["ONLY"])
  ];

  const result = compileShortRelations(
    components,
    [SHORT_SYMBOL],
    pins.reverse()
  );
  assert.deepEqual(result.summary, {
    shortSymbolComponents: 5,
    readyExplicitNetPairCandidates: 1,
    sameExplicitNetCandidates: 1,
    unresolvedPinConnectionCandidates: 1,
    conflictingPinConnectionCandidates: 1,
    invalidShortPinCounts: 1
  });
  assert.deepEqual(
    result.relations.map((relation) => [
      relation.componentId,
      relation.status,
      relation.explicitNetNames
    ]),
    [
      [
        "conflict",
        "CONFLICTING_PIN_CONNECTION_CANDIDATE",
        ["LEFT", "OUT", "RIGHT"]
      ],
      ["invalid", "INVALID_SHORT_PIN_COUNT", ["ONLY"]],
      ["ready", "READY_EXPLICIT_NET_PAIR_CANDIDATE", ["NET_A", "NET_B"]],
      ["same", "SAME_EXPLICIT_NET_CANDIDATE", ["GND"]],
      [
        "unresolved",
        "UNRESOLVED_PIN_CONNECTION_CANDIDATE",
        ["DATA"]
      ]
    ]
  );
  assert.equal(result.relations[2]?.electricalTruth, "NOT_VERIFIED");
  assert.equal(
    result.relations[2]?.basis,
    "SHORT_SYMBOL_TYPE_AND_TRANSFORMED_PIN_CONTACTS"
  );
});
