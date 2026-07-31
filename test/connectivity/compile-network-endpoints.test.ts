import assert from "node:assert/strict";
import test from "node:test";
import { compileNetworkEndpointCandidates } from "../../src/connectivity/compile-network-endpoints.js";
import type {
  IrAttribute,
  IrComponent,
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

function attribute(
  id: string,
  key: string,
  value: IrAttribute["value"]
): IrAttribute {
  return {
    id,
    key,
    value,
    provenance: {
      ...SOURCE,
      recordType: "ATTR",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function symbol(id: string, symbolType: 18 | 19): IrSymbol {
  return {
    id,
    symbolType,
    attributes: [],
    provenance: {
      ...SOURCE,
      documentId: id,
      documentType: "SYMBOL",
      recordType: "META"
    },
    extensions: { easyeda: {} }
  };
}

function component(
  id: string,
  symbolId: string,
  attributes: readonly IrAttribute[]
): IrComponent {
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirrored: false,
    symbolId,
    symbolBinding: {
      key: "Symbol",
      state: "BOUND_COMPONENT_OVERRIDE",
      targetId: symbolId,
      componentAttributes: []
    },
    footprintBinding: {
      key: "Footprint",
      state: "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      componentAttributes: []
    },
    attributes,
    provenance: { ...SOURCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function pin(
  componentId: string,
  endpointKind: "NET_FLAG_PIN" | "NET_PORT_PIN",
  netName?: string
): IrPinInstance {
  const symbolId =
    endpointKind === "NET_FLAG_PIN" ? "net-flag-symbol" : "net-port-symbol";
  return {
    id: `${componentId}-pin`,
    pageId: "page-a",
    componentId,
    symbolId,
    symbolPinId: "pin-a",
    partId: "part-a",
    endpointKind,
    symbolType: endpointKind === "NET_FLAG_PIN" ? 18 : 19,
    instanceAttributes: [],
    connectionPoint: { x: 0, y: 0 },
    connectionCandidate:
      netName === undefined
        ? {
            status: "UNRESOLVED_NO_WIRE",
            basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
            electricalTruth: "NOT_VERIFIED",
            explicitNets: [],
            unlabeledWireIds: []
          }
        : {
            status: "UNIQUE_EXPLICIT_NET_CANDIDATE",
            basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
            electricalTruth: "NOT_VERIFIED",
            explicitNets: [
              {
                netName,
                wireIds: [`${componentId}-wire`],
                segmentIds: [`${componentId}-segment`]
              }
            ],
            unlabeledWireIds: []
          },
    provenance: {
      component: { ...SOURCE, recordId: componentId },
      symbol: {
        ...SOURCE,
        documentId: symbolId,
        documentType: "SYMBOL",
        recordType: "META"
      },
      symbolPin: {
        ...SOURCE,
        documentId: symbolId,
        documentType: "SYMBOL",
        recordType: "PIN",
        recordId: "pin-a"
      }
    }
  };
}

test("NetFlag/NetPort 声明候选区分匹配、差异、缺失、冲突、非法值和未解析连接", () => {
  const flag = symbol("net-flag-symbol", 18);
  const port = symbol("net-port-symbol", 19);
  const components = [
    component("match", flag.id, [
      attribute("global-null", "Global Net Name", null),
      attribute("name-match", "Name", "VCC")
    ]),
    component("mismatch", port.id, [
      attribute("name-mismatch", "Name", "DECLARED")
    ]),
    component("missing", flag.id, []),
    component("conflict", flag.id, [
      attribute("global-a", "Global Net Name", "A"),
      attribute("name-b", "Name", "B")
    ]),
    component("invalid", port.id, [attribute("name-number", "Name", 42)]),
    component("unresolved", port.id, [
      attribute("name-unresolved", "Name", "DATA")
    ]),
    component("pin-count", flag.id, [
      attribute("name-pin-count", "Name", "CLK")
    ])
  ];
  const pins = [
    pin("match", "NET_FLAG_PIN", "VCC"),
    pin("mismatch", "NET_PORT_PIN", "WIRE"),
    pin("missing", "NET_FLAG_PIN", "GND"),
    pin("conflict", "NET_FLAG_PIN", "A"),
    pin("invalid", "NET_PORT_PIN", "N"),
    pin("unresolved", "NET_PORT_PIN")
  ];

  const result = compileNetworkEndpointCandidates(
    components,
    [flag, port],
    pins.reverse()
  );
  assert.deepEqual(result.summary, {
    endpointComponents: 7,
    matching: 1,
    mismatching: 1,
    missingDeclaration: 1,
    conflictingDeclaration: 1,
    invalidDeclarationValue: 1,
    unresolvedConnection: 1,
    invalidPinCount: 1
  });
  assert.deepEqual(
    result.candidates.map((candidate) => [
      candidate.componentId,
      candidate.status
    ]),
    [
      ["conflict", "DECLARATION_CONFLICT"],
      ["invalid", "DECLARATION_VALUE_INVALID"],
      ["match", "DECLARATION_MATCHES_CONNECTION_CANDIDATE"],
      ["mismatch", "DECLARATION_MISMATCHES_CONNECTION_CANDIDATE"],
      ["missing", "DECLARATION_MISSING"],
      ["pin-count", "INVALID_ENDPOINT_PIN_COUNT"],
      ["unresolved", "CONNECTION_CANDIDATE_UNRESOLVED"]
    ]
  );
  const match = result.candidates.find(
    (candidate) => candidate.componentId === "match"
  );
  assert.equal(match?.declaredNetNameCandidate, "VCC");
  assert.equal(match?.connectionNetNameCandidate, "VCC");
  assert.equal(match?.declarationEvidence.length, 2);
  assert.equal(match?.electricalTruth, "NOT_VERIFIED");
});
