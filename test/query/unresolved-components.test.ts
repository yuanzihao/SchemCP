import assert from "node:assert/strict";
import test from "node:test";
import type {
  IrAttribute,
  IrComponent,
  IrDevice,
  IrRecordProvenance
} from "../../src/ir/model.js";
import { buildUnresolvedComponentInventory } from "../../src/query/unresolved-components.js";

const PROVENANCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
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

function attribute(id: string, key: string, value: string): IrAttribute {
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

function component(
  id: string,
  options: {
    readonly designator?: string;
    readonly deviceId?: string;
    readonly attributes?: readonly IrAttribute[];
    readonly symbolBound?: boolean;
    readonly footprintBound?: boolean;
  } = {}
): IrComponent {
  const symbolBound = options.symbolBound ?? true;
  const footprintBound = options.footprintBound ?? true;
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position: { x: 1, y: 2 },
    rotation: 0,
    mirrored: false,
    ...(options.designator === undefined
      ? {}
      : { designator: options.designator }),
    ...(options.deviceId === undefined ? {} : { deviceId: options.deviceId }),
    symbolBinding: {
      key: "Symbol",
      state: symbolBound
        ? "BOUND_COMPONENT_OVERRIDE"
        : "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      ...(symbolBound ? { targetId: "symbol-a" } : {}),
      componentAttributes: []
    },
    footprintBinding: {
      key: "Footprint",
      state: footprintBound
        ? "BOUND_COMPONENT_OVERRIDE"
        : "UNRESOLVED_DEVICE_DEFAULT_MISSING",
      ...(footprintBound ? { targetId: "footprint-a" } : {}),
      componentAttributes: []
    },
    ...effectiveState(id),
    attributes: options.attributes ?? [],
    provenance: { ...PROVENANCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function device(
  id: string,
  attributes: Readonly<Record<string, string>>
): IrDevice {
  return {
    id,
    attributes,
    provenance: {
      ...PROVENANCE,
      documentId: id,
      documentType: "DEVICE",
      recordType: "META",
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

test("显式精确料号可解析，且组件属性优先于 Device 默认属性", () => {
  const inventory = buildUnresolvedComponentInventory(
    [
      component("component-lcsc", {
        designator: "U1",
        deviceId: "device-lcsc",
        attributes: [attribute("supplier-part", "Supplier Part", "C123456")]
      }),
      component("component-mpn", {
        designator: "U2",
        deviceId: "device-mpn"
      }),
      component("component-undesignated", {
        deviceId: "device-lcsc"
      })
    ],
    [
      device("device-lcsc", { "Supplier Part": "C999999" }),
      device("device-mpn", {
        Manufacturer: "STMicroelectronics",
        "Manufacturer Part": "STM32F407VGT6"
      })
    ]
  );

  assert.equal(inventory.summary.designatedComponents, 2);
  assert.equal(inventory.summary.resolvedComponents, 2);
  assert.equal(inventory.summary.unresolvedComponents, 0);
  assert.deepEqual(inventory.summary.identityMethods, {
    EXACT_LCSC_PART_ID: 1,
    EXACT_MANUFACTURER_AND_MPN: 1,
    UNRESOLVED: 0
  });
  assert.deepEqual(inventory.items, []);
});

test("缺失、非法和冲突身份不会回退或泄露无界原始值", () => {
  const overlong = "x".repeat(129);
  const inventory = buildUnresolvedComponentInventory(
    [
      component("component-missing", {
        designator: "R1",
        footprintBound: false
      }),
      component("component-invalid", {
        designator: "R2",
        deviceId: "device-valid-default",
        attributes: [
          attribute("invalid-supplier", "Supplier Part", "not-an-lcsc-id"),
          attribute("invalid-mfr", "Manufacturer", overlong)
        ]
      }),
      component("component-conflict", {
        designator: "R3",
        deviceId: "device-valid-default",
        attributes: [
          attribute("supplier-a", "Supplier Part", "C100"),
          attribute("supplier-b", "Supplier Part", "C200")
        ]
      })
    ],
    [device("device-valid-default", { "Supplier Part": "C300" })]
  );

  assert.equal(inventory.summary.unresolvedComponents, 3);
  const byId = new Map(inventory.items.map((item) => [item.id, item]));
  assert.deepEqual(byId.get("component-missing")?.reasons, [
    "MISSING_EXACT_PART_IDENTITY",
    "FOOTPRINT_BINDING_UNRESOLVED"
  ]);
  assert.deepEqual(byId.get("component-invalid")?.reasons, [
    "MISSING_EXACT_PART_IDENTITY",
    "INVALID_LCSC_PART_ID",
    "INVALID_MANUFACTURER"
  ]);
  assert.equal(
    byId.get("component-invalid")?.identity.fields.manufacturer.state,
    "INVALID"
  );
  assert.equal(
    byId.get("component-invalid")?.identity.fields.manufacturer.value,
    undefined
  );
  assert.equal(
    JSON.stringify(byId.get("component-invalid")).includes(overlong),
    false
  );
  assert.deepEqual(byId.get("component-conflict")?.reasons, [
    "MISSING_EXACT_PART_IDENTITY",
    "CONFLICTING_LCSC_PART_ID"
  ]);
  assert.equal(
    byId.get("component-conflict")?.identity.fields.lcscPartId.state,
    "CONFLICT"
  );
});

test("Device 引用缺失和重复会被显式报告", () => {
  const inventory = buildUnresolvedComponentInventory(
    [
      component("component-not-found", {
        designator: "C1",
        deviceId: "missing-device"
      }),
      component("component-ambiguous", {
        designator: "C2",
        deviceId: "duplicate-device"
      })
    ],
    [
      device("duplicate-device", { "Supplier Part": "C10" }),
      device("duplicate-device", { "Supplier Part": "C20" })
    ]
  );

  const byId = new Map(inventory.items.map((item) => [item.id, item]));
  assert.deepEqual(byId.get("component-not-found")?.reasons, [
    "MISSING_EXACT_PART_IDENTITY",
    "DEVICE_REFERENCE_NOT_FOUND"
  ]);
  assert.deepEqual(byId.get("component-ambiguous")?.reasons, [
    "MISSING_EXACT_PART_IDENTITY",
    "DEVICE_REFERENCE_AMBIGUOUS"
  ]);
  assert.equal(
    inventory.summary.reasonCounts.DEVICE_REFERENCE_AMBIGUOUS,
    1
  );
  assert.equal(inventory.summary.procurementMatch, "NOT_PERFORMED");
  assert.equal(inventory.summary.variantApplication, "NOT_APPLIED");
});
