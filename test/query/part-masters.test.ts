import assert from "node:assert/strict";
import test from "node:test";
import type {
  ComponentPropertyResolution,
  PartIdentityMethod,
  UnresolvedComponentReason,
  UnresolvedComponentSummary
} from "../../src/query/unresolved-components.js";
import { buildPartMasterInventory } from "../../src/query/part-masters.js";

function field(
  key: ComponentPropertyResolution["key"],
  value?: string
): ComponentPropertyResolution {
  return value === undefined
    ? { key, state: "MISSING", evidence: [] }
    : {
        key,
        state: "RESOLVED_COMPONENT_ATTRIBUTE",
        value,
        evidence: []
      };
}

function component(
  id: string,
  designator: string,
  identity: {
    readonly method: PartIdentityMethod;
    readonly lcscPartId?: string;
    readonly manufacturer?: string;
    readonly manufacturerPart?: string;
  },
  options: {
    readonly pageId?: string;
    readonly reasons?: readonly UnresolvedComponentReason[];
  } = {}
): UnresolvedComponentSummary {
  const pageId = options.pageId ?? "page-a";
  return {
    id,
    pageId,
    designator,
    identity: {
      ...identity,
      fields: {
        lcscPartId: field("Supplier Part", identity.lcscPartId),
        manufacturer: field("Manufacturer", identity.manufacturer),
        manufacturerPart: field(
          "Manufacturer Part",
          identity.manufacturerPart
        )
      }
    },
    symbolBindingState: "BOUND_COMPONENT_OVERRIDE",
    footprintBindingState: "BOUND_COMPONENT_OVERRIDE",
    reasons: options.reasons ?? [],
    provenance: {
      documentId: pageId,
      documentType: "SCH_PAGE",
      recordType: "COMPONENT",
      recordId: id,
      ticket: 1,
      client: "client",
      entry: "fixture.epru",
      line: 1
    }
  };
}

test("PartMaster 按精确身份确定性聚合，并排除未解析身份", () => {
  const inventory = buildPartMasterInventory([
    component(
      "component-b",
      "U2",
      {
        method: "EXACT_LCSC_PART_ID",
        lcscPartId: "C100",
        manufacturer: "Vendor B",
        manufacturerPart: "Part B"
      },
      {
        pageId: "page-b",
        reasons: ["FOOTPRINT_BINDING_UNRESOLVED"]
      }
    ),
    component("component-a", "U1", {
      method: "EXACT_LCSC_PART_ID",
      lcscPartId: "C100",
      manufacturer: "Vendor A",
      manufacturerPart: "Part A"
    }),
    component("component-c", "U3", {
      method: "EXACT_MANUFACTURER_AND_MPN",
      manufacturer: "STMicroelectronics",
      manufacturerPart: "STM32F407VGT6"
    }),
    component("component-unresolved", "R1", {
      method: "UNRESOLVED"
    })
  ]);

  assert.deepEqual(inventory.summary, {
    population: "DESIGNATED_COMPONENTS_ONLY",
    partMasters: 2,
    linkedDesignatedComponents: 3,
    unlinkedDesignatedComponents: 1,
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
  const lcsc = inventory.items[0];
  assert.equal(lcsc?.identity.method, "EXACT_LCSC_PART_ID");
  assert.equal(lcsc?.componentCount, 2);
  assert.equal(lcsc?.pageCount, 2);
  assert.equal(lcsc?.componentsWithIssues, 1);
  assert.deepEqual(
    lcsc?.components.map((item) => item.id),
    ["component-a", "component-b"]
  );
  assert.match(lcsc?.id ?? "", /^pm_[a-f0-9]{64}$/u);
});

test("PartMaster ID 和顺序不依赖输入顺序", () => {
  const first = component("component-a", "U1", {
    method: "EXACT_LCSC_PART_ID",
    lcscPartId: "C200"
  });
  const second = component("component-b", "U2", {
    method: "EXACT_MANUFACTURER_AND_MPN",
    manufacturer: "Vendor",
    manufacturerPart: "MPN"
  });

  const forward = buildPartMasterInventory([first, second]);
  const reverse = buildPartMasterInventory([second, first]);

  assert.deepEqual(
    forward.items.map(({ id, identity }) => ({ id, identity })),
    reverse.items.map(({ id, identity }) => ({ id, identity }))
  );
});
