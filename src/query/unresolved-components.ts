import type {
  IrAttribute,
  IrComponent,
  IrDevice,
  IrRecordProvenance,
  JsonValue
} from "../ir/model.js";

const MAX_IDENTITY_TEXT_LENGTH = 128;
const LCSC_PART_ID_PATTERN = /^C[1-9][0-9]{0,19}$/u;

export const UNRESOLVED_COMPONENT_REASONS = [
  "MISSING_EXACT_PART_IDENTITY",
  "INVALID_LCSC_PART_ID",
  "INVALID_MANUFACTURER",
  "INVALID_MANUFACTURER_PART",
  "CONFLICTING_LCSC_PART_ID",
  "CONFLICTING_MANUFACTURER",
  "CONFLICTING_MANUFACTURER_PART",
  "DEVICE_REFERENCE_NOT_FOUND",
  "DEVICE_REFERENCE_AMBIGUOUS",
  "SYMBOL_BINDING_UNRESOLVED",
  "FOOTPRINT_BINDING_UNRESOLVED"
] as const;

export type UnresolvedComponentReason =
  (typeof UNRESOLVED_COMPONENT_REASONS)[number];

export type PartIdentityMethod =
  | "EXACT_LCSC_PART_ID"
  | "EXACT_MANUFACTURER_AND_MPN"
  | "UNRESOLVED";

export type ComponentPropertyState =
  | "RESOLVED_COMPONENT_ATTRIBUTE"
  | "RESOLVED_DEVICE_ATTRIBUTE"
  | "MISSING"
  | "EMPTY"
  | "INVALID"
  | "CONFLICT";

export interface ComponentPropertyEvidence {
  readonly source: "COMPONENT_ATTRIBUTE" | "DEVICE_ATTRIBUTE";
  readonly key: string;
  readonly attributeId?: string;
  readonly provenance: IrRecordProvenance;
}

export interface ComponentPropertyResolution {
  readonly key: "Supplier Part" | "Manufacturer" | "Manufacturer Part";
  readonly state: ComponentPropertyState;
  readonly value?: string;
  readonly evidence: readonly ComponentPropertyEvidence[];
}

export interface UnresolvedComponentSummary {
  readonly id: string;
  readonly pageId: string;
  readonly designator: string;
  readonly deviceId?: string;
  readonly identity: {
    readonly method: PartIdentityMethod;
    readonly lcscPartId?: string;
    readonly manufacturer?: string;
    readonly manufacturerPart?: string;
    readonly fields: {
      readonly lcscPartId: ComponentPropertyResolution;
      readonly manufacturer: ComponentPropertyResolution;
      readonly manufacturerPart: ComponentPropertyResolution;
    };
  };
  readonly symbolBindingState: IrComponent["symbolBinding"]["state"];
  readonly footprintBindingState: IrComponent["footprintBinding"]["state"];
  readonly reasons: readonly UnresolvedComponentReason[];
  readonly provenance: IrRecordProvenance;
}

export interface UnresolvedComponentInventorySummary {
  readonly population: "DESIGNATED_COMPONENTS_ONLY";
  readonly designatedComponents: number;
  readonly resolvedComponents: number;
  readonly unresolvedComponents: number;
  readonly identityMethods: Readonly<Record<PartIdentityMethod, number>>;
  readonly reasonCounts: Readonly<Record<UnresolvedComponentReason, number>>;
  readonly procurementMatch: "NOT_PERFORMED";
  readonly variantApplication: "NOT_APPLIED";
}

export interface UnresolvedComponentInventory {
  readonly items: readonly UnresolvedComponentSummary[];
  readonly summary: UnresolvedComponentInventorySummary;
}

export interface DesignatedComponentIdentityInventory {
  readonly items: readonly UnresolvedComponentSummary[];
  readonly summary: UnresolvedComponentInventorySummary;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function emptyReasonCounts(): Record<UnresolvedComponentReason, number> {
  return Object.fromEntries(
    UNRESOLVED_COMPONENT_REASONS.map((reason) => [reason, 0])
  ) as Record<UnresolvedComponentReason, number>;
}

function boundedText(value: JsonValue): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_IDENTITY_TEXT_LENGTH ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function componentEvidence(
  key: ComponentPropertyResolution["key"],
  attributes: readonly IrAttribute[]
): readonly ComponentPropertyEvidence[] {
  return attributes
    .map((attribute) => ({
      source: "COMPONENT_ATTRIBUTE" as const,
      key,
      attributeId: attribute.id,
      provenance: attribute.provenance
    }))
    .sort((left, right) =>
      compareText(left.attributeId, right.attributeId)
    );
}

function resolveComponentLayer(
  key: ComponentPropertyResolution["key"],
  attributes: readonly IrAttribute[]
): ComponentPropertyResolution | undefined {
  const relevant = attributes.filter((attribute) => attribute.key === key);
  if (relevant.length === 0) return undefined;
  const evidence = componentEvidence(key, relevant);
  const normalized = relevant.map((attribute) => {
    if (attribute.value === null || attribute.value === "") return null;
    return boundedText(attribute.value) ?? undefined;
  });
  if (normalized.some((value) => value === undefined)) {
    return { key, state: "INVALID", evidence };
  }
  const unique = [...new Set(normalized)];
  if (unique.length > 1) {
    return { key, state: "CONFLICT", evidence };
  }
  const selected = unique[0];
  if (selected === null || selected === undefined) {
    return { key, state: "EMPTY", evidence };
  }
  return {
    key,
    state: "RESOLVED_COMPONENT_ATTRIBUTE",
    value: selected,
    evidence
  };
}

function resolveDeviceLayer(
  key: ComponentPropertyResolution["key"],
  device: IrDevice | undefined
): ComponentPropertyResolution {
  if (device === undefined || !Object.hasOwn(device.attributes, key)) {
    return { key, state: "MISSING", evidence: [] };
  }
  const evidence = [
    {
      source: "DEVICE_ATTRIBUTE" as const,
      key,
      provenance: device.provenance
    }
  ];
  const raw = device.attributes[key];
  if (raw === undefined) {
    return { key, state: "INVALID", evidence };
  }
  if (raw === null || raw === "") {
    return { key, state: "EMPTY", evidence };
  }
  const value = boundedText(raw);
  if (value === undefined) {
    return { key, state: "INVALID", evidence };
  }
  return {
    key,
    state: "RESOLVED_DEVICE_ATTRIBUTE",
    value,
    evidence
  };
}

function resolveProperty(
  component: IrComponent,
  device: IrDevice | undefined,
  key: ComponentPropertyResolution["key"]
): ComponentPropertyResolution {
  return (
    resolveComponentLayer(key, component.attributes) ??
    resolveDeviceLayer(key, device)
  );
}

function isResolved(
  field: ComponentPropertyResolution
): field is ComponentPropertyResolution & { readonly value: string } {
  return (
    field.state === "RESOLVED_COMPONENT_ATTRIBUTE" ||
    field.state === "RESOLVED_DEVICE_ATTRIBUTE"
  );
}

function fieldConflictReason(
  field: ComponentPropertyResolution,
  reason: UnresolvedComponentReason,
  reasons: Set<UnresolvedComponentReason>
): void {
  if (field.state === "CONFLICT") reasons.add(reason);
}

function resolveComponent(
  component: IrComponent & { readonly designator: string },
  devices: readonly IrDevice[]
): UnresolvedComponentSummary {
  const device = devices.length === 1 ? devices[0] : undefined;
  const lcscPartId = resolveProperty(component, device, "Supplier Part");
  const manufacturer = resolveProperty(component, device, "Manufacturer");
  const manufacturerPart = resolveProperty(
    component,
    device,
    "Manufacturer Part"
  );
  const validLcscPartId =
    isResolved(lcscPartId) && LCSC_PART_ID_PATTERN.test(lcscPartId.value)
      ? lcscPartId.value
      : undefined;
  const resolvedManufacturer = isResolved(manufacturer)
    ? manufacturer.value
    : undefined;
  const resolvedManufacturerPart = isResolved(manufacturerPart)
    ? manufacturerPart.value
    : undefined;
  const identityMethod: PartIdentityMethod =
    validLcscPartId !== undefined
      ? "EXACT_LCSC_PART_ID"
      : resolvedManufacturer !== undefined &&
          resolvedManufacturerPart !== undefined
        ? "EXACT_MANUFACTURER_AND_MPN"
        : "UNRESOLVED";

  const reasons = new Set<UnresolvedComponentReason>();
  if (identityMethod === "UNRESOLVED") {
    reasons.add("MISSING_EXACT_PART_IDENTITY");
  }
  if (
    isResolved(lcscPartId) &&
    !LCSC_PART_ID_PATTERN.test(lcscPartId.value)
  ) {
    reasons.add("INVALID_LCSC_PART_ID");
  }
  if (manufacturer.state === "INVALID") {
    reasons.add("INVALID_MANUFACTURER");
  }
  if (manufacturerPart.state === "INVALID") {
    reasons.add("INVALID_MANUFACTURER_PART");
  }
  fieldConflictReason(
    lcscPartId,
    "CONFLICTING_LCSC_PART_ID",
    reasons
  );
  fieldConflictReason(
    manufacturer,
    "CONFLICTING_MANUFACTURER",
    reasons
  );
  fieldConflictReason(
    manufacturerPart,
    "CONFLICTING_MANUFACTURER_PART",
    reasons
  );
  if (component.deviceId !== undefined && devices.length === 0) {
    reasons.add("DEVICE_REFERENCE_NOT_FOUND");
  }
  if (devices.length > 1) {
    reasons.add("DEVICE_REFERENCE_AMBIGUOUS");
  }
  if (!component.symbolBinding.state.startsWith("BOUND_")) {
    reasons.add("SYMBOL_BINDING_UNRESOLVED");
  }
  if (!component.footprintBinding.state.startsWith("BOUND_")) {
    reasons.add("FOOTPRINT_BINDING_UNRESOLVED");
  }
  const orderedReasons = UNRESOLVED_COMPONENT_REASONS.filter((reason) =>
    reasons.has(reason)
  );

  return {
    id: component.id,
    pageId: component.pageId,
    designator: component.designator,
    ...(component.deviceId === undefined
      ? {}
      : { deviceId: component.deviceId }),
    identity: {
      method: identityMethod,
      ...(validLcscPartId === undefined
        ? {}
        : { lcscPartId: validLcscPartId }),
      ...(resolvedManufacturer === undefined
        ? {}
        : { manufacturer: resolvedManufacturer }),
      ...(resolvedManufacturerPart === undefined
        ? {}
        : { manufacturerPart: resolvedManufacturerPart }),
      fields: {
        lcscPartId,
        manufacturer,
        manufacturerPart
      }
    },
    symbolBindingState: component.symbolBinding.state,
    footprintBindingState: component.footprintBinding.state,
    reasons: orderedReasons,
    provenance: component.provenance
  };
}

export function buildDesignatedComponentIdentityInventory(
  components: readonly IrComponent[],
  devices: readonly IrDevice[]
): DesignatedComponentIdentityInventory {
  const devicesById = new Map<string, IrDevice[]>();
  for (const device of devices) {
    const bucket = devicesById.get(device.id);
    if (bucket === undefined) devicesById.set(device.id, [device]);
    else bucket.push(device);
  }
  const designated = components
    .filter(
      (component): component is IrComponent & { readonly designator: string } =>
        component.designator !== undefined
    )
    .map((component) =>
      resolveComponent(
        component,
        component.deviceId === undefined
          ? []
          : (devicesById.get(component.deviceId) ?? [])
      )
    )
    .sort(
      (left, right) =>
        compareText(left.pageId, right.pageId) ||
        compareText(left.designator, right.designator) ||
        compareText(left.id, right.id)
    );
  const unresolved = designated.filter((item) => item.reasons.length > 0);
  const reasonCounts = emptyReasonCounts();
  for (const item of unresolved) {
    for (const reason of item.reasons) reasonCounts[reason] += 1;
  }
  const identityMethods: Record<PartIdentityMethod, number> = {
    EXACT_LCSC_PART_ID: 0,
    EXACT_MANUFACTURER_AND_MPN: 0,
    UNRESOLVED: 0
  };
  for (const item of designated) {
    identityMethods[item.identity.method] += 1;
  }
  return {
    items: designated,
    summary: {
      population: "DESIGNATED_COMPONENTS_ONLY",
      designatedComponents: designated.length,
      resolvedComponents: designated.length - unresolved.length,
      unresolvedComponents: unresolved.length,
      identityMethods,
      reasonCounts,
      procurementMatch: "NOT_PERFORMED",
      variantApplication: "NOT_APPLIED"
    }
  };
}

export function buildUnresolvedComponentInventory(
  components: readonly IrComponent[],
  devices: readonly IrDevice[]
): UnresolvedComponentInventory {
  const inventory = buildDesignatedComponentIdentityInventory(
    components,
    devices
  );
  return {
    items: inventory.items.filter((item) => item.reasons.length > 0),
    summary: inventory.summary
  };
}
