import assert from "node:assert/strict";
import test from "node:test";
import {
  compilePinInstances,
  isPointOnSegment,
  transformSymbolPoint,
  type ComponentPinOverrideCandidate
} from "../../src/connectivity/compile-pin-instances.js";
import type {
  IrAttribute,
  IrComponent,
  IrPinEndpointKind,
  IrRecordProvenance,
  IrSymbol,
  IrSymbolPin,
  IrWire
} from "../../src/ir/model.js";

const COMPONENT_SOURCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  recordId: "component-a",
  ticket: 1,
  client: "client",
  entry: "fixture.epru",
  line: 1
};

const PIN_SOURCE: IrRecordProvenance = {
  documentId: "symbol-a",
  documentType: "SYMBOL",
  recordType: "PIN",
  recordId: "pin-a",
  ticket: 2,
  client: "client",
  entry: "fixture.epru",
  line: 2
};

function component(
  id: string,
  position: { readonly x: number; readonly y: number }
): IrComponent {
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position,
    rotation: 0,
    mirrored: false,
    designator: id,
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
    attributes: [],
    provenance: { ...COMPONENT_SOURCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function pin(): IrSymbolPin {
  return {
    id: "pin-a",
    symbolId: "symbol-a",
    partId: "part-a",
    position: { x: 0, y: 0 },
    length: 20,
    rotation: 0,
    name: "IO",
    number: "1",
    attributes: [],
    provenance: PIN_SOURCE,
    extensions: { easyeda: {} }
  };
}

function symbol(symbolType = 2): IrSymbol {
  return {
    id: "symbol-a",
    symbolType,
    attributes: [],
    provenance: {
      documentId: "symbol-a",
      documentType: "SYMBOL",
      recordType: "META",
      ticket: 1,
      client: "client",
      entry: "fixture.epru",
      line: 1
    },
    extensions: { easyeda: {} }
  };
}

function wire(
  id: string,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  explicitNetName?: string
): IrWire {
  return {
    id,
    pageId: "page-a",
    ...(explicitNetName === undefined ? {} : { explicitNetName }),
    segments: [
      {
        id: `${id}:segment`,
        start,
        end,
        provenance: {
          ...COMPONENT_SOURCE,
          recordType: "LINE",
          recordId: `${id}:segment`
        },
        extensions: { easyeda: {} }
      }
    ],
    attributes: [],
    provenance: {
      ...COMPONENT_SOURCE,
      recordType: "WIRE",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function override(
  componentId: string,
  attributeId: string,
  value: IrAttribute["value"],
  symbolPinId = "pin-a"
): ComponentPinOverrideCandidate {
  return {
    pageId: "page-a",
    componentId,
    symbolPinId,
    parentId: `${componentId}-${symbolPinId}`,
    attribute: {
      id: attributeId,
      key: "NO_CONNECT",
      value,
      provenance: {
        ...COMPONENT_SOURCE,
        recordType: "ATTR",
        recordId: attributeId
      },
      extensions: {
        easyeda: {
          parentId: `${componentId}-${symbolPinId}`,
          key: "NO_CONNECT",
          value
        }
      }
    }
  };
}

test("组件变换严格按顺时针旋转、Y 轴镜像、平移顺序执行", () => {
  assert.deepEqual(
    transformSymbolPoint(
      { x: 10, y: 20 },
      {
        position: { x: 100, y: 200 },
        rotation: 90,
        mirrored: false
      }
    ),
    { x: 120, y: 190 }
  );
  assert.deepEqual(
    transformSymbolPoint(
      { x: 10, y: 20 },
      {
        position: { x: 100, y: 200 },
        rotation: 90,
        mirrored: true
      }
    ),
    { x: 80, y: 190 }
  );
});

test("引脚端点可以命中导线中点，但不会命中仅延长后相交的位置", () => {
  const segment = {
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 }
  };
  assert.equal(isPointOnSegment({ x: 5, y: 0 }, segment), true);
  assert.equal(isPointOnSegment({ x: 11, y: 0 }, segment), false);
  assert.equal(isPointOnSegment({ x: 5, y: 1 }, segment), false);
});

test("同名多段导线合并为一个显式网络候选并保留全部证据", () => {
  const result = compilePinInstances(
    [component("U1", { x: 100, y: 200 })],
    [symbol()],
    [pin()],
    [
      wire("wire-a", { x: 90, y: 200 }, { x: 110, y: 200 }, "DATA"),
      wire("wire-b", { x: 100, y: 190 }, { x: 100, y: 210 }, "DATA"),
      wire("wire-unlabeled", { x: 95, y: 200 }, { x: 105, y: 200 })
    ]
  );
  const instance = result.pinInstances[0];
  assert.equal(
    instance?.connectionCandidate.status,
    "UNIQUE_EXPLICIT_NET_CANDIDATE"
  );
  assert.deepEqual(instance?.connectionCandidate.explicitNets, [
    {
      netName: "DATA",
      wireIds: ["wire-a", "wire-b", "wire-unlabeled"],
      segmentIds: [
        "wire-a:segment",
        "wire-b:segment",
        "wire-unlabeled:segment"
      ]
    }
  ]);
  assert.deepEqual(instance?.connectionCandidate.unlabeledWireIds, [
    "wire-unlabeled"
  ]);
  assert.equal(
    instance?.connectionCandidate.electricalTruth,
    "NOT_VERIFIED"
  );
  assert.equal(instance?.endpointKind, "PART_SYMBOL_PIN");
});

test("无标签导线沿端点连通分量继承唯一网络，但内部交叉线不会被误合并", () => {
  const result = compilePinInstances(
    [component("U1", { x: 0, y: 0 })],
    [symbol()],
    [pin()],
    [
      wire("wire-local", { x: 0, y: 0 }, { x: 10, y: 0 }),
      wire("wire-labeled", { x: 10, y: 0 }, { x: 20, y: 0 }, "DATA"),
      wire("wire-crossing", { x: 5, y: -10 }, { x: 5, y: 10 }, "OTHER")
    ]
  );
  const instance = result.pinInstances[0];
  assert.equal(
    instance?.connectionCandidate.status,
    "UNIQUE_EXPLICIT_NET_CANDIDATE"
  );
  assert.equal(
    instance?.connectionCandidate.basis,
    "TRANSFORMED_PIN_POINT_ON_CONNECTED_WIRE_COMPONENT"
  );
  assert.deepEqual(instance?.connectionCandidate.explicitNets, [
    {
      netName: "DATA",
      wireIds: ["wire-labeled", "wire-local"],
      segmentIds: ["wire-labeled:segment", "wire-local:segment"]
    }
  ]);
  assert.deepEqual(instance?.connectionCandidate.unlabeledWireIds, [
    "wire-local"
  ]);
});

test("导线 ID 仅在页内唯一，跨页同 ID 不能串扰网络候选", () => {
  const firstComponent = component("U1", { x: 0, y: 0 });
  const secondComponent = {
    ...component("U2", { x: 0, y: 0 }),
    pageId: "page-b"
  };
  const firstWire = wire(
    "shared-wire-id",
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    "PAGE_A"
  );
  const secondWire = {
    ...wire(
      "shared-wire-id",
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      "PAGE_B"
    ),
    pageId: "page-b"
  };
  const result = compilePinInstances(
    [firstComponent, secondComponent],
    [symbol()],
    [pin()],
    [firstWire, secondWire]
  );
  assert.deepEqual(
    result.pinInstances.map((instance) => ({
      componentId: instance.componentId,
      nets: instance.connectionCandidate.explicitNets.map(
        (candidate) => candidate.netName
      )
    })),
    [
      { componentId: "U1", nets: ["PAGE_A"] },
      { componentId: "U2", nets: ["PAGE_B"] }
    ]
  );
});

test("不同显式网络在同一引脚点相交时返回冲突而不是静默择一", () => {
  const result = compilePinInstances(
    [component("U1", { x: 0, y: 0 })],
    [symbol()],
    [pin()],
    [
      wire("wire-a", { x: -10, y: 0 }, { x: 10, y: 0 }, "NET_A"),
      wire("wire-b", { x: 0, y: -10 }, { x: 0, y: 10 }, "NET_B")
    ]
  );
  assert.equal(
    result.pinInstances[0]?.connectionCandidate.status,
    "CONFLICTING_EXPLICIT_NET_CANDIDATES"
  );
  assert.deepEqual(
    result.pinInstances[0]?.connectionCandidate.explicitNets.map(
      (candidate) => candidate.netName
    ),
    ["NET_A", "NET_B"]
  );
});

test("无标签导线、无导线和未知 PART 使用不同的机器状态", () => {
  const components = [
    component("U1", { x: 0, y: 0 }),
    component("U2", { x: 20, y: 0 }),
    { ...component("U3", { x: 40, y: 0 }), partId: "missing-part" }
  ];
  const result = compilePinInstances(
    components,
    [symbol()],
    [pin()],
    [wire("wire-a", { x: -5, y: 0 }, { x: 5, y: 0 })]
  );
  assert.equal(
    result.pinInstances.find((item) => item.componentId === "U1")
      ?.connectionCandidate.status,
    "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET"
  );
  assert.equal(
    result.pinInstances.find((item) => item.componentId === "U2")
      ?.connectionCandidate.status,
    "UNRESOLVED_NO_WIRE"
  );
  assert.equal(result.summary.componentsWithUnknownSymbolPart, 1);
});

test("显式 NO_CONNECT 覆盖与无导线、冲突、非法值和导线接触严格区分", () => {
  const components = [
    component("U1", { x: 0, y: 0 }),
    component("U2", { x: 20, y: 0 }),
    component("U3", { x: 40, y: 0 }),
    component("U4", { x: 60, y: 0 }),
    component("U5", { x: 80, y: 0 })
  ];
  const result = compilePinInstances(
    components,
    [symbol()],
    [pin()],
    [wire("wire-u5", { x: 75, y: 0 }, { x: 85, y: 0 }, "DATA")],
    [
      override("U1", "nc-u1", "yes"),
      override("U2", "nc-u2", "no"),
      override("U3", "nc-u3", "true"),
      override("U4", "nc-u4-a", "yes"),
      override("U4", "nc-u4-b", "no"),
      override("U5", "nc-u5", true),
      override("U1", "unknown-pin", "yes", "missing-pin")
    ]
  );

  const byComponent = new Map(
    result.pinInstances.map((instance) => [instance.componentId, instance])
  );
  assert.equal(
    byComponent.get("U1")?.connectionCandidate.status,
    "DECLARED_NO_CONNECT"
  );
  assert.equal(
    byComponent.get("U1")?.connectionCandidate.basis,
    "COMPONENT_PIN_OVERRIDE_NO_CONNECT_ATTRIBUTE"
  );
  assert.equal(
    byComponent.get("U1")?.noConnectDeclaration?.state,
    "DECLARED_NO_CONNECT"
  );
  assert.equal(
    byComponent.get("U2")?.noConnectDeclaration?.state,
    "DECLARED_CONNECTABLE"
  );
  assert.equal(
    byComponent.get("U2")?.connectionCandidate.status,
    "UNRESOLVED_NO_WIRE"
  );
  assert.equal(
    byComponent.get("U3")?.noConnectDeclaration?.state,
    "INVALID_DECLARATION"
  );
  assert.equal(
    byComponent.get("U4")?.noConnectDeclaration?.state,
    "CONFLICTING_DECLARATION"
  );
  assert.equal(
    byComponent.get("U5")?.connectionCandidate.status,
    "UNIQUE_EXPLICIT_NET_CANDIDATE"
  );
  assert.deepEqual(result.summary, {
    componentsWithoutSymbolReference: 0,
    componentsWithUnknownSymbol: 0,
    componentsWithUnknownSymbolPart: 0,
    pinInstances: 5,
    uniqueExplicitNetCandidates: 1,
    conflictingExplicitNetCandidates: 0,
    pinsOnUnlabeledWire: 0,
    pinsWithDeclaredNoConnect: 2,
    pinsWithDeclaredNoConnectAndWireContact: 1,
    pinsWithNoConnectDeclarationConflict: 1,
    pinsWithInvalidNoConnectDeclaration: 1,
    pinsWithoutWire: 3,
    endpointKinds: {
      PART_SYMBOL_PIN: 5,
      BLOCK_SYMBOL_PIN: 0,
      NET_FLAG_PIN: 0,
      NET_PORT_PIN: 0,
      SHEET_SYMBOL_PIN: 0,
      NONELECTRICAL_SYMBOL_PIN: 0,
      SHORT_SYMBOL_PIN: 0,
      UNKNOWN_SYMBOL_PIN: 0
    }
  });
  assert.equal(result.unresolvedOverrides.length, 1);
  assert.equal(result.unresolvedOverrides[0]?.attribute.id, "unknown-pin");
});

test("官方 Symbol 类型被确定映射为不同的引脚端点类型", () => {
  const expected = new Map<number, IrPinEndpointKind>([
    [2, "PART_SYMBOL_PIN"],
    [17, "BLOCK_SYMBOL_PIN"],
    [18, "NET_FLAG_PIN"],
    [19, "NET_PORT_PIN"],
    [20, "SHEET_SYMBOL_PIN"],
    [21, "NONELECTRICAL_SYMBOL_PIN"],
    [22, "SHORT_SYMBOL_PIN"]
  ]);
  for (const [symbolType, endpointKind] of expected) {
    const result = compilePinInstances(
      [component("endpoint", { x: 0, y: 0 })],
      [symbol(symbolType)],
      [pin()],
      []
    );
    assert.equal(result.pinInstances[0]?.endpointKind, endpointKind);
    assert.equal(result.pinInstances[0]?.symbolType, symbolType);
    assert.equal(result.summary.endpointKinds[endpointKind], 1);
  }
});
