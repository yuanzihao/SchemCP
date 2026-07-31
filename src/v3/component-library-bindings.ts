import type {
  IrAttribute,
  IrComponent,
  IrComponentDeviceDefaultEvidence,
  IrComponentLibraryBinding,
  IrComponentLibraryBindingKey,
  IrDevice
} from "../ir/model.js";

export type ComponentBeforeLibraryBindings = Omit<
  IrComponent,
  | "symbolId"
  | "footprintId"
  | "symbolBinding"
  | "footprintBinding"
>;

export interface ComponentLibraryBindingCompilationSummary {
  readonly symbolFromComponentOverride: number;
  readonly symbolFromDeviceDefault: number;
  readonly footprintFromComponentOverride: number;
  readonly footprintFromDeviceDefault: number;
  readonly states: Readonly<
    Record<
      IrComponentLibraryBindingKey,
      Readonly<Record<IrComponentLibraryBinding["state"], number>>
    >
  >;
}

export interface ComponentLibraryBindingCompilationResult {
  readonly components: readonly IrComponent[];
  readonly summary: ComponentLibraryBindingCompilationSummary;
}

const BINDING_STATES = [
  "BOUND_COMPONENT_OVERRIDE",
  "BOUND_DEVICE_DEFAULT",
  "UNRESOLVED_COMPONENT_OVERRIDE_CONFLICT",
  "UNRESOLVED_COMPONENT_OVERRIDE_EMPTY",
  "UNRESOLVED_COMPONENT_OVERRIDE_INVALID",
  "UNRESOLVED_DEVICE_REFERENCE_MISSING",
  "UNRESOLVED_DEVICE_NOT_FOUND",
  "UNRESOLVED_DEVICE_DEFAULT_MISSING",
  "UNRESOLVED_DEVICE_DEFAULT_EMPTY",
  "UNRESOLVED_DEVICE_DEFAULT_INVALID"
] as const satisfies readonly IrComponentLibraryBinding["state"][];

function emptyStateCounts(): Record<
  IrComponentLibraryBinding["state"],
  number
> {
  return Object.fromEntries(
    BINDING_STATES.map((state) => [state, 0])
  ) as Record<IrComponentLibraryBinding["state"], number>;
}

function relevantAttributes(
  component: ComponentBeforeLibraryBindings,
  key: IrComponentLibraryBindingKey
): readonly IrAttribute[] {
  return component.attributes.filter((attribute) => attribute.key === key);
}

function deviceDefaultEvidence(
  component: ComponentBeforeLibraryBindings,
  device: IrDevice | undefined,
  key: IrComponentLibraryBindingKey
): IrComponentDeviceDefaultEvidence | undefined {
  if (component.deviceId === undefined || device === undefined) {
    return undefined;
  }
  return {
    deviceId: component.deviceId,
    key,
    ...(Object.hasOwn(device.attributes, key)
      ? { value: device.attributes[key] }
      : {}),
    provenance: device.provenance
  };
}

function resolveBinding(
  component: ComponentBeforeLibraryBindings,
  device: IrDevice | undefined,
  key: IrComponentLibraryBindingKey
): IrComponentLibraryBinding {
  const componentAttributes = relevantAttributes(component, key);
  const deviceDefault = deviceDefaultEvidence(component, device, key);
  if (componentAttributes.length > 0) {
    const values = componentAttributes.map((attribute) => attribute.value);
    if (values.some((value) => value !== null && typeof value !== "string")) {
      return {
        key,
        state: "UNRESOLVED_COMPONENT_OVERRIDE_INVALID",
        componentAttributes,
        ...(deviceDefault === undefined ? {} : { deviceDefault })
      };
    }
    const uniqueValues = [
      ...new Set(
        values.map((value) =>
          value === null || value === "" ? null : (value as string)
        )
      )
    ];
    if (uniqueValues.length !== 1) {
      return {
        key,
        state: "UNRESOLVED_COMPONENT_OVERRIDE_CONFLICT",
        componentAttributes,
        ...(deviceDefault === undefined ? {} : { deviceDefault })
      };
    }
    const selectedValue = uniqueValues[0];
    if (selectedValue === null || selectedValue === undefined) {
      return {
        key,
        state: "UNRESOLVED_COMPONENT_OVERRIDE_EMPTY",
        componentAttributes,
        ...(deviceDefault === undefined ? {} : { deviceDefault })
      };
    }
    return {
      key,
      state: "BOUND_COMPONENT_OVERRIDE",
      targetId: selectedValue,
      componentAttributes,
      ...(deviceDefault === undefined ? {} : { deviceDefault })
    };
  }
  if (component.deviceId === undefined) {
    return {
      key,
      state: "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      componentAttributes
    };
  }
  if (device === undefined) {
    return {
      key,
      state: "UNRESOLVED_DEVICE_NOT_FOUND",
      componentAttributes
    };
  }
  if (!Object.hasOwn(device.attributes, key)) {
    return {
      key,
      state: "UNRESOLVED_DEVICE_DEFAULT_MISSING",
      componentAttributes,
      ...(deviceDefault === undefined ? {} : { deviceDefault })
    };
  }
  const value = device.attributes[key];
  if (value === null || value === "") {
    return {
      key,
      state: "UNRESOLVED_DEVICE_DEFAULT_EMPTY",
      componentAttributes,
      ...(deviceDefault === undefined ? {} : { deviceDefault })
    };
  }
  if (typeof value !== "string") {
    return {
      key,
      state: "UNRESOLVED_DEVICE_DEFAULT_INVALID",
      componentAttributes,
      ...(deviceDefault === undefined ? {} : { deviceDefault })
    };
  }
  return {
    key,
    state: "BOUND_DEVICE_DEFAULT",
    targetId: value,
    componentAttributes,
    ...(deviceDefault === undefined ? {} : { deviceDefault })
  };
}

export function compileComponentLibraryBindings(
  components: readonly ComponentBeforeLibraryBindings[],
  devices: readonly IrDevice[]
): ComponentLibraryBindingCompilationResult {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const stateCounts = {
    Symbol: emptyStateCounts(),
    Footprint: emptyStateCounts()
  };
  const resolved = components.map((component): IrComponent => {
    const device =
      component.deviceId === undefined
        ? undefined
        : devicesById.get(component.deviceId);
    const symbolBinding = resolveBinding(component, device, "Symbol");
    const footprintBinding = resolveBinding(component, device, "Footprint");
    stateCounts.Symbol[symbolBinding.state] += 1;
    stateCounts.Footprint[footprintBinding.state] += 1;
    return {
      ...component,
      ...(symbolBinding.targetId === undefined
        ? {}
        : { symbolId: symbolBinding.targetId }),
      ...(footprintBinding.targetId === undefined
        ? {}
        : { footprintId: footprintBinding.targetId }),
      symbolBinding,
      footprintBinding
    };
  });
  return {
    components: resolved,
    summary: {
      symbolFromComponentOverride:
        stateCounts.Symbol.BOUND_COMPONENT_OVERRIDE,
      symbolFromDeviceDefault: stateCounts.Symbol.BOUND_DEVICE_DEFAULT,
      footprintFromComponentOverride:
        stateCounts.Footprint.BOUND_COMPONENT_OVERRIDE,
      footprintFromDeviceDefault:
        stateCounts.Footprint.BOUND_DEVICE_DEFAULT,
      states: stateCounts
    }
  };
}
