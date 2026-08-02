import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  IrComponent,
  IrComponentAssembly,
  IrComponentPinCompleteness,
  IrDevice,
  IrEffectiveAttribute,
  IrSchematicPage,
  IrSymbol,
  IrSymbolPart,
  IrSymbolPin,
  JsonValue
} from "../ir/model.js";
import type { ComponentAfterLibraryBindings } from "../v3/component-library-bindings.js";

const ASSEMBLY_ATTRIBUTE_KEY = "Add into BOM" as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueValues(values: readonly JsonValue[]): readonly JsonValue[] {
  return [
    ...new Map(values.map((value) => [canonicalJson(value), value])).values()
  ];
}

export function effectiveComponentAttributes(
  component: Pick<IrComponent, "attributes" | "deviceId">,
  device: IrDevice | undefined,
  overrides: readonly {
    readonly attributes: Readonly<Record<string, JsonValue>>;
    readonly provenance: IrEffectiveAttribute["provenance"][number];
  }[] = []
): readonly IrEffectiveAttribute[] {
  const result = new Map<string, IrEffectiveAttribute>();
  if (device !== undefined) {
    for (const [key, value] of Object.entries(device.attributes)) {
      result.set(key, {
        key,
        values: [value],
        resolution: "DEVICE_DEFAULT",
        provenance: [device.provenance]
      });
    }
  }
  const componentAttributes = new Map<string, typeof component.attributes>();
  for (const attribute of component.attributes) {
    const existing = componentAttributes.get(attribute.key) ?? [];
    componentAttributes.set(attribute.key, [...existing, attribute]);
  }
  for (const [key, attributes] of componentAttributes) {
    const values = uniqueValues(attributes.map((attribute) => attribute.value));
    result.set(key, {
      key,
      values,
      resolution:
        values.length === 1 ? "COMPONENT_EXPLICIT" : "COMPONENT_CONFLICT",
      provenance: attributes.map((attribute) => attribute.provenance)
    });
  }
  for (const override of overrides) {
    for (const [key, value] of Object.entries(override.attributes)) {
      result.set(key, {
        key,
        values: [value],
        resolution: "INSTANCE_OVERRIDE",
        provenance: [override.provenance]
      });
    }
  }
  return [...result.values()].sort((left, right) =>
    compareText(left.key, right.key)
  );
}

export function resolveComponentAssembly(
  attributes: readonly IrEffectiveAttribute[]
): IrComponentAssembly {
  const attribute = attributes.find(
    (candidate) => candidate.key === ASSEMBLY_ATTRIBUTE_KEY
  );
  if (attribute === undefined) {
    return {
      status: "UNKNOWN",
      reason: "ADD_INTO_BOM_MISSING",
      attributeKey: ASSEMBLY_ATTRIBUTE_KEY,
      values: [],
      resolution: "MISSING",
      evidenceClass: "DETERMINISTIC_RULE",
      truthStatus: "NOT_VERIFIED",
      semanticRuleSetVersion: "schemcp.semantic-rules/1",
      provenance: []
    };
  }
  if (
    attribute.resolution === "COMPONENT_CONFLICT" ||
    attribute.values.length !== 1
  ) {
    return {
      status: "UNKNOWN",
      reason: "ADD_INTO_BOM_CONFLICT",
      attributeKey: ASSEMBLY_ATTRIBUTE_KEY,
      values: attribute.values,
      resolution: attribute.resolution,
      evidenceClass: "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      semanticRuleSetVersion: "schemcp.semantic-rules/1",
      provenance: attribute.provenance
    };
  }
  const value = attribute.values[0];
  if (typeof value === "string") {
    const normalized = value.toLocaleLowerCase("en-US");
    if (normalized === "yes" || normalized === "no") {
      return {
        status: normalized === "yes" ? "POPULATED" : "DNP",
        reason:
          normalized === "yes"
            ? "EXPLICIT_ADD_INTO_BOM_YES"
            : "EXPLICIT_ADD_INTO_BOM_NO",
        attributeKey: ASSEMBLY_ATTRIBUTE_KEY,
        values: attribute.values,
        resolution: attribute.resolution,
        evidenceClass: "EXPLICIT_PROJECT_RECORD",
        truthStatus: "NOT_VERIFIED",
        semanticRuleSetVersion: "schemcp.semantic-rules/1",
        provenance: attribute.provenance
      };
    }
  }
  return {
    status: "UNKNOWN",
    reason: "ADD_INTO_BOM_INVALID",
    attributeKey: ASSEMBLY_ATTRIBUTE_KEY,
    values: attribute.values,
    resolution: attribute.resolution,
    evidenceClass: "EXPLICIT_PROJECT_RECORD",
    truthStatus: "NOT_VERIFIED",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: attribute.provenance
  };
}

export function unresolvedVariantAssembly(
  assembly: IrComponentAssembly
): IrComponentAssembly {
  return {
    status: "UNKNOWN",
    reason: "VARIANT_APPLICATION_NOT_SUPPORTED",
    attributeKey: ASSEMBLY_ATTRIBUTE_KEY,
    values: assembly.values,
    resolution: "VARIANT_NOT_APPLIED",
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: "NOT_VERIFIED",
    semanticRuleSetVersion: "schemcp.semantic-rules/1",
    provenance: assembly.provenance
  };
}

interface LogicalGroup {
  readonly components: readonly ComponentAfterLibraryBindings[];
  readonly schematicId?: string;
}

function pinCompleteness(
  group: LogicalGroup,
  allSymbols: readonly IrSymbol[],
  symbolParts: readonly IrSymbolPart[],
  symbolPins: readonly IrSymbolPin[]
): IrComponentPinCompleteness {
  const units = group.components
    .map((component) => ({
      componentId: component.id,
      pageId: component.pageId,
      partId: component.partId
    }))
    .sort(
      (left, right) =>
        compareText(left.pageId, right.pageId) ||
        compareText(left.componentId, right.componentId) ||
        compareText(left.partId, right.partId)
    );
  const logicalComponentId = sha256CanonicalJson([
    group.schematicId ?? "",
    units
  ]);
  const symbolIds = new Set(
    group.components.map((component) => component.symbolId ?? "")
  );
  const devices = new Set(
    group.components.map((component) => component.deviceId ?? "")
  );
  const base = {
    logicalComponentId,
    units,
    evidenceClass: "DETERMINISTIC_RULE" as const,
    truthStatus: "NOT_VERIFIED" as const,
    semanticRuleSetVersion: "schemcp.semantic-rules/1" as const,
    provenance: group.components.map((component) => component.provenance)
  };
  if (symbolIds.has("")) {
    return {
      ...base,
      status: "UNKNOWN",
      reason: "SYMBOL_REFERENCE_MISSING",
      declaredPartIds: [],
      instantiatedPartIds: [...new Set(units.map((unit) => unit.partId))].sort(
        compareText
      ),
      missingPartIds: [],
      duplicatePartIds: [],
      symbolPinCount: 0,
      instantiatedPinCount: 0,
      hiddenPinCount: 0
    };
  }
  if (symbolIds.size !== 1 || devices.size !== 1) {
    return {
      ...base,
      status: "UNKNOWN",
      reason: "LOGICAL_COMPONENT_AMBIGUOUS",
      declaredPartIds: [],
      instantiatedPartIds: [...new Set(units.map((unit) => unit.partId))].sort(
        compareText
      ),
      missingPartIds: [],
      duplicatePartIds: [],
      symbolPinCount: 0,
      instantiatedPinCount: 0,
      hiddenPinCount: 0
    };
  }
  const symbolId = [...symbolIds][0] as string;
  const symbol = allSymbols.find((candidate) => candidate.id === symbolId);
  if (symbol === undefined) {
    return {
      ...base,
      status: "UNKNOWN",
      reason: "SYMBOL_NOT_FOUND",
      declaredPartIds: [],
      instantiatedPartIds: [...new Set(units.map((unit) => unit.partId))].sort(
        compareText
      ),
      missingPartIds: [],
      duplicatePartIds: [],
      symbolPinCount: 0,
      instantiatedPinCount: 0,
      hiddenPinCount: 0
    };
  }
  const declaredPartIds = symbolParts
    .filter((part) => part.symbolId === symbolId)
    .map((part) => part.id)
    .sort(compareText);
  const instantiatedPartIds = [...new Set(units.map((unit) => unit.partId))].sort(
    compareText
  );
  const duplicatePartIds = instantiatedPartIds.filter(
    (partId) => units.filter((unit) => unit.partId === partId).length > 1
  );
  const pins = symbolPins.filter((pin) => pin.symbolId === symbolId);
  const instantiatedPins = pins.filter((pin) =>
    instantiatedPartIds.includes(pin.partId)
  );
  const hiddenPinCount = pins.filter((pin) => pin.display === false).length;
  const common = {
    ...base,
    provenance: [
      ...base.provenance,
      symbol.provenance,
      ...symbolParts
        .filter((part) => part.symbolId === symbolId)
        .map((part) => part.provenance),
      ...pins.map((pin) => pin.provenance)
    ],
    declaredPartIds,
    instantiatedPartIds,
    missingPartIds: declaredPartIds.filter(
      (partId) => !instantiatedPartIds.includes(partId)
    ),
    duplicatePartIds,
    symbolPinCount: pins.length,
    instantiatedPinCount: instantiatedPins.length,
    hiddenPinCount
  };
  if (declaredPartIds.length === 0) {
    return {
      ...common,
      status: "UNKNOWN",
      reason: "SYMBOL_PART_DECLARATION_MISSING"
    };
  }
  if (
    duplicatePartIds.length > 0 ||
    instantiatedPartIds.some((partId) => !declaredPartIds.includes(partId))
  ) {
    return {
      ...common,
      status: "UNKNOWN",
      reason:
        duplicatePartIds.length > 0
          ? "LOGICAL_COMPONENT_AMBIGUOUS"
          : "SYMBOL_PART_NOT_FOUND"
    };
  }
  if (pins.some((pin) => pin.display === undefined)) {
    return {
      ...common,
      status: "UNKNOWN",
      reason: "HIDDEN_PIN_SOURCE_UNRESOLVED"
    };
  }
  if (common.missingPartIds.length > 0) {
    return {
      ...common,
      status: "PARTIAL",
      reason: "SYMBOL_UNIT_MISSING"
    };
  }
  return {
    ...common,
    status: "COMPLETE",
    reason:
      declaredPartIds.length === 1
        ? "SINGLE_SYMBOL_PART_COMPLETE"
        : "ALL_SYMBOL_PARTS_INSTANTIATED"
  };
}

export function compileEffectiveComponentStates(
  components: readonly ComponentAfterLibraryBindings[],
  devices: readonly IrDevice[],
  pages: readonly IrSchematicPage[],
  symbols: readonly IrSymbol[],
  symbolParts: readonly IrSymbolPart[],
  symbolPins: readonly IrSymbolPin[]
): readonly IrComponent[] {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const schematicByPage = new Map(
    pages.map((page) => [page.id, page.schematicId] as const)
  );
  const groups = new Map<string, ComponentAfterLibraryBindings[]>();
  for (const component of components) {
    const schematicId = schematicByPage.get(component.pageId);
    const key =
      component.designator === undefined || schematicId === undefined
        ? `component\n${component.pageId}\n${component.id}`
        : `designator\n${schematicId}\n${component.designator}`;
    const group = groups.get(key) ?? [];
    group.push(component);
    groups.set(key, group);
  }
  const completenessByComponent = new Map<string, IrComponentPinCompleteness>();
  for (const group of groups.values()) {
    const schematicId = schematicByPage.get(group[0]!.pageId);
    const logicalGroup: LogicalGroup =
      schematicId === undefined
        ? { components: group }
        : { components: group, schematicId };
    const completeness = pinCompleteness(
      logicalGroup,
      symbols,
      symbolParts,
      symbolPins
    );
    for (const component of group) {
      completenessByComponent.set(
        `${component.pageId}\n${component.id}`,
        completeness
      );
    }
  }
  return components.map((component): IrComponent => {
    const attributes = effectiveComponentAttributes(
      component,
      component.deviceId === undefined
        ? undefined
        : devicesById.get(component.deviceId)
    );
    const completeness = completenessByComponent.get(
      `${component.pageId}\n${component.id}`
    );
    if (completeness === undefined) {
      throw new Error("组件引脚完整性内部索引断链");
    }
    return {
      ...component,
      assembly: resolveComponentAssembly(attributes),
      pinCompleteness: completeness
    };
  });
}
