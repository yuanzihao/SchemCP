import { createHash } from "node:crypto";
import type {
  PartIdentityMethod,
  UnresolvedComponentSummary
} from "./unresolved-components.js";

export type ResolvedPartIdentityMethod = Exclude<
  PartIdentityMethod,
  "UNRESOLVED"
>;

export type PartMasterIdentity =
  | {
      readonly method: "EXACT_LCSC_PART_ID";
      readonly lcscPartId: string;
    }
  | {
      readonly method: "EXACT_MANUFACTURER_AND_MPN";
      readonly manufacturer: string;
      readonly manufacturerPart: string;
    };

export interface PartMasterSummary {
  readonly id: string;
  readonly identity: PartMasterIdentity;
  readonly componentCount: number;
  readonly pageCount: number;
  readonly componentsWithIssues: number;
  readonly identityBasis:
    "EXPLICIT_COMPONENT_ATTRIBUTE_THEN_DEVICE_ATTRIBUTE";
  readonly catalogMatch: "NOT_PERFORMED";
  readonly datasheetBinding: "NOT_PERFORMED";
  readonly variantApplication: "NOT_APPLIED";
}

export interface PartMasterRecord extends PartMasterSummary {
  readonly components: readonly UnresolvedComponentSummary[];
}

export interface PartMasterInventorySummary {
  readonly population: "DESIGNATED_COMPONENTS_ONLY";
  readonly partMasters: number;
  readonly linkedDesignatedComponents: number;
  readonly unlinkedDesignatedComponents: number;
  readonly identityMethods: Readonly<
    Record<ResolvedPartIdentityMethod, number>
  >;
  readonly identityBasis:
    "EXPLICIT_COMPONENT_ATTRIBUTE_THEN_DEVICE_ATTRIBUTE";
  readonly catalogMatch: "NOT_PERFORMED";
  readonly datasheetBinding: "NOT_PERFORMED";
  readonly variantApplication: "NOT_APPLIED";
}

export interface PartMasterInventory {
  readonly items: readonly PartMasterRecord[];
  readonly summary: PartMasterInventorySummary;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalIdentity(
  component: UnresolvedComponentSummary
): PartMasterIdentity | undefined {
  if (
    component.identity.method === "EXACT_LCSC_PART_ID" &&
    component.identity.lcscPartId !== undefined
  ) {
    return {
      method: "EXACT_LCSC_PART_ID",
      lcscPartId: component.identity.lcscPartId
    };
  }
  if (
    component.identity.method === "EXACT_MANUFACTURER_AND_MPN" &&
    component.identity.manufacturer !== undefined &&
    component.identity.manufacturerPart !== undefined
  ) {
    return {
      method: "EXACT_MANUFACTURER_AND_MPN",
      manufacturer: component.identity.manufacturer,
      manufacturerPart: component.identity.manufacturerPart
    };
  }
  return undefined;
}

function canonicalKey(identity: PartMasterIdentity): string {
  return identity.method === "EXACT_LCSC_PART_ID"
    ? `lcsc\0${identity.lcscPartId}`
    : `manufacturer-mpn\0${identity.manufacturer}\0${identity.manufacturerPart}`;
}

function stableId(identity: PartMasterIdentity): string {
  return `pm_${createHash("sha256").update(canonicalKey(identity)).digest("hex")}`;
}

function compareIdentity(
  left: PartMasterIdentity,
  right: PartMasterIdentity
): number {
  const methodOrder: Readonly<Record<ResolvedPartIdentityMethod, number>> = {
    EXACT_LCSC_PART_ID: 0,
    EXACT_MANUFACTURER_AND_MPN: 1
  };
  return (
    methodOrder[left.method] - methodOrder[right.method] ||
    compareText(canonicalKey(left), canonicalKey(right))
  );
}

export function buildPartMasterInventory(
  designatedComponents: readonly UnresolvedComponentSummary[]
): PartMasterInventory {
  const groups = new Map<
    string,
    {
      readonly identity: PartMasterIdentity;
      readonly components: UnresolvedComponentSummary[];
    }
  >();
  let linkedDesignatedComponents = 0;
  const identityMethods: Record<ResolvedPartIdentityMethod, number> = {
    EXACT_LCSC_PART_ID: 0,
    EXACT_MANUFACTURER_AND_MPN: 0
  };

  for (const component of designatedComponents) {
    const identity = canonicalIdentity(component);
    if (identity === undefined) continue;
    linkedDesignatedComponents += 1;
    identityMethods[identity.method] += 1;
    const key = canonicalKey(identity);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { identity, components: [component] });
    } else {
      existing.components.push(component);
    }
  }

  const items = [...groups.values()]
    .sort((left, right) => compareIdentity(left.identity, right.identity))
    .map(({ identity, components }): PartMasterRecord => {
      const orderedComponents = [...components].sort(
        (left, right) =>
          compareText(left.pageId, right.pageId) ||
          compareText(left.designator, right.designator) ||
          compareText(left.id, right.id)
      );
      return {
        id: stableId(identity),
        identity,
        componentCount: orderedComponents.length,
        pageCount: new Set(
          orderedComponents.map((component) => component.pageId)
        ).size,
        componentsWithIssues: orderedComponents.filter(
          (component) => component.reasons.length > 0
        ).length,
        identityBasis:
          "EXPLICIT_COMPONENT_ATTRIBUTE_THEN_DEVICE_ATTRIBUTE",
        catalogMatch: "NOT_PERFORMED",
        datasheetBinding: "NOT_PERFORMED",
        variantApplication: "NOT_APPLIED",
        components: orderedComponents
      };
    });

  return {
    items,
    summary: {
      population: "DESIGNATED_COMPONENTS_ONLY",
      partMasters: items.length,
      linkedDesignatedComponents,
      unlinkedDesignatedComponents:
        designatedComponents.length - linkedDesignatedComponents,
      identityMethods,
      identityBasis:
        "EXPLICIT_COMPONENT_ATTRIBUTE_THEN_DEVICE_ATTRIBUTE",
      catalogMatch: "NOT_PERFORMED",
      datasheetBinding: "NOT_PERFORMED",
      variantApplication: "NOT_APPLIED"
    }
  };
}
