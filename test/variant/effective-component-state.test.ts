import assert from "node:assert/strict";
import test from "node:test";
import type {
  IrAttribute,
  IrDevice,
  IrRecordProvenance,
  IrSchematicPage,
  IrSymbol,
  IrSymbolPart,
  IrSymbolPin,
  JsonValue
} from "../../src/ir/model.js";
import type { ComponentAfterLibraryBindings } from "../../src/v3/component-library-bindings.js";
import {
  compileEffectiveComponentStates,
  effectiveComponentAttributes,
  resolveComponentAssembly,
  unresolvedVariantAssembly
} from "../../src/variant/effective-component-state.js";

const PROVENANCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  ticket: 1,
  client: "fixture",
  entry: "epru",
  line: 1
};

function attribute(id: string, key: string, value: JsonValue): IrAttribute {
  return {
    id,
    key,
    value,
    provenance: { ...PROVENANCE, recordType: "ATTR", recordId: id },
    extensions: { easyeda: {} }
  };
}

function component(
  id: string,
  partId: string,
  attributes: readonly IrAttribute[] = []
): ComponentAfterLibraryBindings {
  return {
    id,
    pageId: "page-a",
    partId,
    position: { x: 0, y: 0 },
    rotation: 0,
    mirrored: false,
    designator: "U1",
    deviceId: "device-a",
    symbolId: "symbol-a",
    symbolBinding: {
      key: "Symbol",
      state: "BOUND_DEVICE_DEFAULT",
      targetId: "symbol-a",
      componentAttributes: [],
      deviceDefault: {
        deviceId: "device-a",
        key: "Symbol",
        value: "symbol-a",
        provenance: PROVENANCE
      }
    },
    footprintBinding: {
      key: "Footprint",
      state: "UNRESOLVED_DEVICE_DEFAULT_MISSING",
      componentAttributes: [],
      deviceDefault: {
        deviceId: "device-a",
        key: "Footprint",
        provenance: PROVENANCE
      }
    },
    attributes,
    provenance: { ...PROVENANCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function page(): IrSchematicPage {
  return {
    id: "page-a",
    schematicId: "schematic-a",
    attributes: [],
    provenance: { ...PROVENANCE, recordType: "META" },
    extensions: { easyeda: {} }
  };
}

function symbol(): IrSymbol {
  return {
    id: "symbol-a",
    attributes: [],
    provenance: {
      ...PROVENANCE,
      documentId: "symbol-a",
      documentType: "SYMBOL",
      recordType: "META"
    },
    extensions: { easyeda: {} }
  };
}

function part(id: string): IrSymbolPart {
  return {
    id,
    symbolId: "symbol-a",
    provenance: {
      ...PROVENANCE,
      documentId: "symbol-a",
      documentType: "SYMBOL",
      recordType: "PART",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function pin(id: string, partId: string, display: boolean): IrSymbolPin {
  return {
    id,
    symbolId: "symbol-a",
    partId,
    position: { x: 0, y: 0 },
    length: 10,
    rotation: 0,
    display,
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

const DEVICE: IrDevice = {
  id: "device-a",
  attributes: { "Add into BOM": "yes", Symbol: "symbol-a" },
  provenance: {
    ...PROVENANCE,
    documentId: "device-a",
    documentType: "DEVICE",
    recordType: "META"
  },
  extensions: { easyeda: {} }
};

test("装配状态按 Device、组件、实例覆盖顺序确定，Variant 选择保持保守 UNKNOWN", () => {
  const base = component(
    "component-a",
    "part-a",
    [attribute("bom-no", "Add into BOM", "no")]
  );
  const componentAttributes = effectiveComponentAttributes(base, DEVICE);
  assert.equal(resolveComponentAssembly(componentAttributes).status, "DNP");
  assert.equal(
    resolveComponentAssembly(componentAttributes).semanticRuleSetVersion,
    "schemcp.semantic-rules/1"
  );
  assert.equal(
    resolveComponentAssembly(componentAttributes).reason,
    "EXPLICIT_ADD_INTO_BOM_NO"
  );

  const instanceAttributes = effectiveComponentAttributes(base, DEVICE, [
    {
      attributes: { "Add into BOM": "yes" },
      provenance: { ...PROVENANCE, documentType: "INSTANCE", recordType: "INSTANCE_ATTR" }
    }
  ]);
  const populated = resolveComponentAssembly(instanceAttributes);
  assert.equal(populated.status, "POPULATED");
  assert.equal(populated.resolution, "INSTANCE_OVERRIDE");
  assert.equal(unresolvedVariantAssembly(populated).status, "UNKNOWN");
  assert.equal(
    unresolvedVariantAssembly(populated).reason,
    "VARIANT_APPLICATION_NOT_SUPPORTED"
  );
});

test("Add into BOM 缺失、冲突和非 yes/no 值不会被猜成装配事实", () => {
  assert.equal(resolveComponentAssembly([]).reason, "ADD_INTO_BOM_MISSING");
  const conflicting = effectiveComponentAttributes(
    component("component-a", "part-a", [
      attribute("yes", "Add into BOM", "yes"),
      attribute("no", "Add into BOM", "no")
    ]),
    DEVICE
  );
  assert.equal(resolveComponentAssembly(conflicting).reason, "ADD_INTO_BOM_CONFLICT");
  const invalid = effectiveComponentAttributes(
    component("component-a", "part-a", [
      attribute("invalid", "Add into BOM", true)
    ]),
    DEVICE
  );
  assert.equal(resolveComponentAssembly(invalid).reason, "ADD_INTO_BOM_INVALID");
});

test("多单元完整性合并同位号 PART，并保留隐藏引脚", () => {
  const result = compileEffectiveComponentStates(
    [component("unit-a", "part-a"), component("unit-b", "part-b")],
    [DEVICE],
    [page()],
    [symbol()],
    [part("part-a"), part("part-b")],
    [pin("pin-a", "part-a", true), pin("pin-b", "part-b", false)]
  );
  assert.equal(result[0]?.pinCompleteness.status, "COMPLETE");
  assert.equal(
    result[0]?.pinCompleteness.reason,
    "ALL_SYMBOL_PARTS_INSTANTIATED"
  );
  assert.equal(result[0]?.pinCompleteness.hiddenPinCount, 1);
  assert.equal(
    result[0]?.pinCompleteness.semanticRuleSetVersion,
    "schemcp.semantic-rules/1"
  );
  assert.equal(result[0]?.pinCompleteness.provenance.length, 7);
  assert.deepEqual(result[0]?.pinCompleteness.units, [
    { componentId: "unit-a", pageId: "page-a", partId: "part-a" },
    { componentId: "unit-b", pageId: "page-a", partId: "part-b" }
  ]);
});

test("缺失单元返回 PARTIAL，缺失 display 来源返回 UNKNOWN", () => {
  const partial = compileEffectiveComponentStates(
    [component("unit-a", "part-a")],
    [DEVICE],
    [page()],
    [symbol()],
    [part("part-a"), part("part-b")],
    [pin("pin-a", "part-a", true), pin("pin-b", "part-b", false)]
  );
  assert.equal(partial[0]?.pinCompleteness.status, "PARTIAL");
  assert.deepEqual(partial[0]?.pinCompleteness.missingPartIds, ["part-b"]);

  const pinWithoutDisplay = { ...pin("pin-a", "part-a", true) };
  delete (pinWithoutDisplay as { display?: boolean }).display;
  const unknown = compileEffectiveComponentStates(
    [component("unit-a", "part-a")],
    [DEVICE],
    [page()],
    [symbol()],
    [part("part-a")],
    [pinWithoutDisplay]
  );
  assert.equal(unknown[0]?.pinCompleteness.status, "UNKNOWN");
  assert.equal(
    unknown[0]?.pinCompleteness.reason,
    "HIDDEN_PIN_SOURCE_UNRESOLVED"
  );
});
