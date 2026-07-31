import assert from "node:assert/strict";
import test from "node:test";
import type {
  IrAttribute,
  IrDevice,
  IrRecordProvenance,
  JsonObject,
  JsonValue
} from "../../src/ir/model.js";
import {
  compileComponentLibraryBindings,
  type ComponentBeforeLibraryBindings
} from "../../src/v3/component-library-bindings.js";

const SOURCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  ticket: 1,
  client: "client",
  entry: "fixture.epru",
  line: 1
};

function attribute(
  id: string,
  key: "Symbol" | "Footprint",
  value: JsonValue
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
    extensions: { easyeda: { key, value } }
  };
}

function component(
  id: string,
  deviceId: string | undefined,
  attributes: readonly IrAttribute[] = []
): ComponentBeforeLibraryBindings {
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirrored: false,
    ...(deviceId === undefined ? {} : { deviceId }),
    attributes,
    provenance: { ...SOURCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function device(id: string, attributes: JsonObject): IrDevice {
  return {
    id,
    attributes,
    provenance: {
      ...SOURCE,
      documentId: id,
      documentType: "DEVICE",
      recordType: "META"
    },
    extensions: { easyeda: { attributes } }
  };
}

test("组件覆盖优先于 Device 默认值，缺失覆盖时确定性继承", () => {
  const result = compileComponentLibraryBindings(
    [
      component("override", "device-a", [
        attribute("symbol-override", "Symbol", "symbol-instance")
      ]),
      component("inherited", "device-a")
    ],
    [
      device("device-a", {
        Symbol: "symbol-default",
        Footprint: "footprint-default"
      })
    ]
  );
  const byId = new Map(result.components.map((item) => [item.id, item]));
  const override = byId.get("override");
  const inherited = byId.get("inherited");

  assert.equal(override?.symbolId, "symbol-instance");
  assert.equal(override?.symbolBinding.state, "BOUND_COMPONENT_OVERRIDE");
  assert.equal(
    override?.symbolBinding.deviceDefault?.value,
    "symbol-default"
  );
  assert.equal(override?.footprintId, "footprint-default");
  assert.equal(
    override?.footprintBinding.state,
    "BOUND_DEVICE_DEFAULT"
  );
  assert.equal(inherited?.symbolId, "symbol-default");
  assert.equal(inherited?.symbolBinding.state, "BOUND_DEVICE_DEFAULT");
  assert.equal(result.summary.symbolFromComponentOverride, 1);
  assert.equal(result.summary.symbolFromDeviceDefault, 1);
  assert.equal(result.summary.footprintFromDeviceDefault, 2);
});

test("冲突或非法组件覆盖不会静默回退到 Device 默认值", () => {
  const result = compileComponentLibraryBindings(
    [
      component("conflict", "device-a", [
        attribute("symbol-a", "Symbol", "symbol-a"),
        attribute("symbol-b", "Symbol", "symbol-b")
      ]),
      component("invalid", "device-a", [
        attribute("symbol-number", "Symbol", 42)
      ]),
      component("empty", "device-a", [
        attribute("symbol-null", "Symbol", null)
      ])
    ],
    [device("device-a", { Symbol: "symbol-default" })]
  );
  const byId = new Map(result.components.map((item) => [item.id, item]));

  assert.equal(byId.get("conflict")?.symbolId, undefined);
  assert.equal(
    byId.get("conflict")?.symbolBinding.state,
    "UNRESOLVED_COMPONENT_OVERRIDE_CONFLICT"
  );
  assert.equal(byId.get("invalid")?.symbolId, undefined);
  assert.equal(
    byId.get("invalid")?.symbolBinding.state,
    "UNRESOLVED_COMPONENT_OVERRIDE_INVALID"
  );
  assert.equal(byId.get("empty")?.symbolId, undefined);
  assert.equal(
    byId.get("empty")?.symbolBinding.state,
    "UNRESOLVED_COMPONENT_OVERRIDE_EMPTY"
  );
  assert.equal(
    result.summary.states.Symbol.UNRESOLVED_COMPONENT_OVERRIDE_CONFLICT,
    1
  );
  assert.equal(
    result.summary.states.Symbol.UNRESOLVED_COMPONENT_OVERRIDE_EMPTY,
    1
  );
  assert.equal(
    result.summary.states.Symbol.UNRESOLVED_COMPONENT_OVERRIDE_INVALID,
    1
  );
});

test("缺失 Device 引用、目标文档、默认属性和非法默认值保持独立状态", () => {
  const result = compileComponentLibraryBindings(
    [
      component("no-device", undefined),
      component("unknown-device", "missing"),
      component("no-default", "device-empty"),
      component("invalid-default", "device-invalid"),
      component("empty-default", "device-empty-value")
    ],
    [
      device("device-empty", {}),
      device("device-invalid", { Symbol: 42 }),
      device("device-empty-value", { Symbol: "" })
    ]
  );
  const byId = new Map(result.components.map((item) => [item.id, item]));

  assert.equal(
    byId.get("no-device")?.symbolBinding.state,
    "UNRESOLVED_DEVICE_REFERENCE_MISSING"
  );
  assert.equal(
    byId.get("unknown-device")?.symbolBinding.state,
    "UNRESOLVED_DEVICE_NOT_FOUND"
  );
  assert.equal(
    byId.get("no-default")?.symbolBinding.state,
    "UNRESOLVED_DEVICE_DEFAULT_MISSING"
  );
  assert.equal(
    byId.get("invalid-default")?.symbolBinding.state,
    "UNRESOLVED_DEVICE_DEFAULT_INVALID"
  );
  assert.equal(
    byId.get("empty-default")?.symbolBinding.state,
    "UNRESOLVED_DEVICE_DEFAULT_EMPTY"
  );
});
