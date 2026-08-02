import { sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  IrComponent,
  IrComponentSemantic,
  IrInterfaceActivityStatus,
  IrPinInstance,
  IrRecordProvenance,
  IrResourceEdge,
  IrResourceEdgeKind,
  IrResourceNode,
  IrResourceType
} from "../ir/model.js";
import { SEMANTIC_RULE_SET_VERSION } from "../semantics/compile-semantics.js";

export interface ResourceCompilationResult {
  readonly resourceNodes: readonly IrResourceNode[];
  readonly resourceEdges: readonly IrResourceEdge[];
}

interface LogicalResourceGroup {
  readonly logicalComponentId: string;
  readonly components: readonly IrComponent[];
  readonly semantics: readonly IrComponentSemantic[];
  readonly pins: readonly IrPinInstance[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function provenanceKey(item: IrRecordProvenance): string {
  return [
    item.documentId,
    item.documentType,
    item.recordType,
    item.recordId ?? "",
    String(item.ticket),
    item.client,
    item.entry,
    String(item.line)
  ].join("\n");
}

function uniqueProvenance(
  values: readonly IrRecordProvenance[]
): readonly IrRecordProvenance[] {
  return [
    ...new Map(values.map((value) => [provenanceKey(value), value])).values()
  ].sort((left, right) => compareText(provenanceKey(left), provenanceKey(right)));
}

function groups(
  components: readonly IrComponent[],
  semantics: readonly IrComponentSemantic[],
  pins: readonly IrPinInstance[]
): readonly LogicalResourceGroup[] {
  const semanticsByLogicalId = new Map<string, IrComponentSemantic[]>();
  for (const semantic of semantics) {
    const items = semanticsByLogicalId.get(semantic.logicalComponentId) ?? [];
    items.push(semantic);
    semanticsByLogicalId.set(semantic.logicalComponentId, items);
  }
  return [...semanticsByLogicalId.entries()]
    .map(([logicalComponentId, groupSemantics]) => {
      const componentKeys = new Set(
        groupSemantics.map((item) => `${item.pageId}\n${item.componentId}`)
      );
      return {
        logicalComponentId,
        components: components
          .filter((item) => componentKeys.has(`${item.pageId}\n${item.id}`))
          .sort(
            (left, right) =>
              compareText(left.pageId, right.pageId) ||
              compareText(left.id, right.id)
          ),
        semantics: [...groupSemantics].sort(
          (left, right) =>
            compareText(left.pageId, right.pageId) ||
            compareText(left.componentId, right.componentId)
        ),
        pins: pins
          .filter((item) =>
            componentKeys.has(`${item.pageId}\n${item.componentId}`)
          )
          .sort(
            (left, right) =>
              compareText(left.pageId, right.pageId) ||
              compareText(left.componentId, right.componentId) ||
              compareText(left.number ?? "", right.number ?? "") ||
              compareText(left.id, right.id)
          )
      };
    })
    .sort((left, right) =>
      compareText(left.logicalComponentId, right.logicalComponentId)
    );
}

function activityStatus(group: LogicalResourceGroup): IrInterfaceActivityStatus {
  const statuses = new Set(group.components.map((item) => item.assembly.status));
  if (statuses.size === 1 && statuses.has("DNP")) return "EXCLUDED_DNP";
  if (statuses.size === 1 && statuses.has("POPULATED")) return "ACTIVE";
  return "ASSEMBLY_UNKNOWN";
}

function resourceStatus(
  group: LogicalResourceGroup,
  activity: IrInterfaceActivityStatus
): IrResourceEdge["status"] {
  return activity === "ASSEMBLY_UNKNOWN" ||
    group.components.some((item) => item.pinCompleteness.status !== "COMPLETE")
    ? "UNRESOLVED"
    : "CANDIDATE";
}

function unresolvedReasons(
  group: LogicalResourceGroup,
  activity: IrInterfaceActivityStatus
): IrResourceEdge["unresolvedReasons"] {
  return [
    ...(activity === "ASSEMBLY_UNKNOWN"
      ? (["ASSEMBLY_STATUS_UNKNOWN"] as const)
      : []),
    ...(group.components.some(
      (item) => item.pinCompleteness.status !== "COMPLETE"
    )
      ? (["PIN_COMPLETENESS_NOT_COMPLETE"] as const)
      : [])
  ];
}

function netEndpoint(pageId: string, netName: string): IrResourceNode {
  return {
    kind: "NET",
    id: sha256CanonicalJson(["resource-net", pageId, netName]),
    pageId,
    netName
  };
}

function componentEndpoint(
  group: LogicalResourceGroup,
  component: IrComponent
): IrResourceNode {
  return {
    kind: "COMPONENT",
    id: sha256CanonicalJson([
      "resource-component",
      component.pageId,
      component.id,
      group.logicalComponentId
    ]),
    pageId: component.pageId,
    componentId: component.id,
    logicalComponentId: group.logicalComponentId
  };
}

function connectedNet(pin: IrPinInstance): IrResourceNode | undefined {
  if (pin.connectionCandidate.status !== "UNIQUE_EXPLICIT_NET_CANDIDATE") {
    return undefined;
  }
  const net = pin.connectionCandidate.explicitNets[0];
  return net === undefined ? undefined : netEndpoint(pin.pageId, net.netName);
}

function pinText(pin: IrPinInstance, net?: IrResourceNode): string {
  return `${pin.name ?? ""}\n${net?.kind === "NET" ? net.netName : ""}`
    .toLocaleUpperCase("en-US")
    .replaceAll("D+", "DP")
    .replaceAll("D-", "DM");
}

function isPowerText(value: string): boolean {
  return /(?:^|[^A-Z0-9])(?:GND|AGND|DGND|PGND|VSS|VSSA|VDD|VDDA|VCC|AVCC|VBAT|VBUS|VIN|VOUT|VREF|[0-9]+V[0-9]*)(?:[^A-Z0-9]|$)/u.test(
    value
  );
}

function isClockText(value: string): boolean {
  return /(?:OSC|XTAL|XIN|XOUT|HSE|LSE|CLK|CLOCK)/u.test(value);
}

function isClockInput(value: string): boolean {
  return /(?:OSC[_/]?IN|XTAL[_/]?IN|XIN|HSE[_/]?IN|LSE[_/]?IN|CLK[_/]?IN|REF[_/]?CLK)/u.test(
    value
  );
}

function isClockOutput(value: string): boolean {
  return /(?:CLK|CLOCK)[_/]?(?:OUT|O)[0-9]*|(?:OUT|O)[_/]?(?:CLK|CLOCK)[0-9]*/u.test(
    value
  );
}

function isResetText(value: string): boolean {
  return /(?:^|[^A-Z0-9])(?:N?RESET|N?RST|POR)(?:[^A-Z0-9]|$)/u.test(value);
}

function isBootText(value: string): boolean {
  return /(?:^|[^A-Z0-9])(?:BOOT[0-9]*|STRAP)(?:[^A-Z0-9]|$)/u.test(value);
}

function edge(
  group: LogicalResourceGroup,
  options: {
    readonly resourceType: IrResourceType;
    readonly kind: IrResourceEdgeKind;
    readonly direction: IrResourceEdge["direction"];
    readonly from: IrResourceNode;
    readonly to: IrResourceNode;
    readonly pins: readonly IrPinInstance[];
    readonly viaComponents?: readonly IrComponent[];
    readonly ruleId: string;
  }
): IrResourceEdge {
  const activity = activityStatus(group);
  const status = resourceStatus(group, activity);
  const viaComponents = options.viaComponents ?? group.components;
  return {
    id: sha256CanonicalJson([
      "resource-edge",
      options.resourceType,
      options.kind,
      options.direction,
      options.from.id,
      options.to.id,
      viaComponents.map((item) => [item.pageId, item.id]),
      options.pins.map((item) => item.id),
      SEMANTIC_RULE_SET_VERSION
    ]),
    resourceType: options.resourceType,
    kind: options.kind,
    direction: options.direction,
    from: options.from,
    to: options.to,
    viaComponentRefs: viaComponents.map((item) => ({
      componentId: item.id,
      pageId: item.pageId,
      logicalComponentId: group.logicalComponentId
    })),
    pinInstanceIds: options.pins.map((item) => item.id).sort(compareText),
    activityStatus: activity,
    isolationStatus: group.semantics.some((item) =>
      item.roles.some((role) => role.role === "ISOLATOR_CANDIDATE")
    )
      ? "ISOLATION_CANDIDATE"
      : "NOT_INDICATED",
    status,
    unresolvedReasons: unresolvedReasons(group, activity),
    ruleId: options.ruleId,
    evidenceClass: "DETERMINISTIC_RULE",
    truthStatus: status === "UNRESOLVED" ? "UNRESOLVED" : "CANDIDATE",
    semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
    provenance: uniqueProvenance([
      ...viaComponents.map((item) => item.provenance),
      ...options.pins.flatMap((item) => [
        item.provenance.component,
        item.provenance.symbolPin
      ])
    ])
  };
}

function powerEdges(group: LogicalResourceGroup): readonly IrResourceEdge[] {
  const roles = new Set(group.semantics.flatMap((item) => item.roles.map((role) => role.role)));
  const domains = [
    ...new Map(
      group.semantics
        .flatMap((item) => item.powerDomains)
        .map((domain) => [domain.id, domain])
    ).values()
  ];
  const pinById = new Map(group.pins.map((pin) => [pin.id, pin]));
  const domainPins = (domain: (typeof domains)[number]) =>
    domain.pinInstanceIds.flatMap((id) => {
      const pin = pinById.get(id);
      return pin === undefined ? [] : [pin];
    });
  const nonGround = domains.filter((item) => item.relationship !== "GROUND");
  const inputs = nonGround.filter((item) => item.relationship === "INPUT");
  const outputs = nonGround.filter((item) => item.relationship === "OUTPUT");
  const result: IrResourceEdge[] = [];

  if (roles.has("POWER_INPUT")) {
    for (const domain of inputs.length > 0 ? inputs : nonGround) {
      const pins = domainPins(domain);
      const component = group.components.find((item) =>
        pins.some((pin) => pin.componentId === item.id && pin.pageId === item.pageId)
      );
      if (component === undefined) continue;
      result.push(
        edge(group, {
          resourceType: "POWER",
          kind: "POWER_SOURCE_ENTRY",
          direction: "DIRECTED",
          from: componentEndpoint(group, component),
          to: netEndpoint(domain.pageId, domain.netName),
          pins,
          ruleId: "resource.power.source-entry.v1"
        })
      );
    }
  }

  if (roles.has("LDO") || roles.has("DC_DC")) {
    for (const input of inputs) {
      for (const output of outputs) {
        if (input.pageId !== output.pageId || input.netName === output.netName) {
          continue;
        }
        result.push(
          edge(group, {
            resourceType: "POWER",
            kind: "POWER_CONVERSION",
            direction: "DIRECTED",
            from: netEndpoint(input.pageId, input.netName),
            to: netEndpoint(output.pageId, output.netName),
            pins: [...domainPins(input), ...domainPins(output)],
            ruleId: roles.has("LDO")
              ? "resource.power.ldo-conversion.v1"
              : "resource.power.dc-dc-conversion.v1"
          })
        );
      }
    }
  }

  if (roles.has("POWER_SWITCH_CANDIDATE")) {
    for (const input of inputs) {
      for (const output of outputs) {
        if (input.pageId !== output.pageId || input.netName === output.netName) {
          continue;
        }
        result.push(
          edge(group, {
            resourceType: "POWER",
            kind: "POWER_SWITCH_TRANSFER_CANDIDATE",
            direction: "DIRECTED",
            from: netEndpoint(input.pageId, input.netName),
            to: netEndpoint(output.pageId, output.netName),
            pins: [...domainPins(input), ...domainPins(output)],
            ruleId: "resource.power.switch-transfer.v1"
          })
        );
      }
    }
  }

  if (roles.has("FILTER_CANDIDATE") || roles.has("PROTECTION_CANDIDATE")) {
    const unique = [
      ...new Map(
        nonGround.map((item) => [`${item.pageId}\n${item.netName}`, item])
      ).values()
    ];
    if (unique.length === 2 && unique[0]?.pageId === unique[1]?.pageId) {
      const left = unique[0];
      const right = unique[1];
      if (left !== undefined && right !== undefined) {
        result.push(
          edge(group, {
            resourceType: "POWER",
            kind: "POWER_TRANSFER_CANDIDATE",
            direction: "BIDIRECTIONAL",
            from: netEndpoint(left.pageId, left.netName),
            to: netEndpoint(right.pageId, right.netName),
            pins: [...domainPins(left), ...domainPins(right)],
            ruleId: "resource.power.protection-filter-transfer.v1"
          })
        );
      }
    }
  }

  const isTransfer =
    roles.has("POWER_INPUT") ||
    roles.has("LDO") ||
    roles.has("DC_DC") ||
    roles.has("POWER_SWITCH_CANDIDATE") ||
    roles.has("FILTER_CANDIDATE") ||
    roles.has("PROTECTION_CANDIDATE") ||
    roles.has("PASSIVE") ||
    roles.has("CONNECTOR") ||
    roles.has("BOOT_STRAP");
  if (!isTransfer) {
    for (const domain of nonGround) {
      const pins = domainPins(domain);
      const component = group.components.find((item) =>
        pins.some((pin) => pin.componentId === item.id && pin.pageId === item.pageId)
      );
      if (component === undefined) continue;
      result.push(
        edge(group, {
          resourceType: "POWER",
          kind: "POWER_LOAD",
          direction: "DIRECTED",
          from: netEndpoint(domain.pageId, domain.netName),
          to: componentEndpoint(group, component),
          pins,
          ruleId: "resource.power.explicit-load.v1"
        })
      );
    }
  }
  return result;
}

function signalEdges(group: LogicalResourceGroup): readonly IrResourceEdge[] {
  const roles = new Set(group.semantics.flatMap((item) => item.roles.map((role) => role.role)));
  const result: IrResourceEdge[] = [];
  for (const pin of group.pins) {
    const net = connectedNet(pin);
    if (net === undefined) continue;
    const component = group.components.find(
      (item) => item.id === pin.componentId && item.pageId === pin.pageId
    );
    if (component === undefined) continue;
    const componentNode = componentEndpoint(group, component);
    const text = pinText(pin, net);
    if (roles.has("CRYSTAL_OSCILLATOR") && isClockText(text)) {
      result.push(
        edge(group, {
          resourceType: "CLOCK",
          kind: "CLOCK_SOURCE_OUTPUT",
          direction: "DIRECTED",
          from: componentNode,
          to: net,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.clock.external-source.v1"
        })
      );
    }
    if (roles.has("CLOCK_BUFFER_CANDIDATE") && isClockInput(text)) {
      result.push(
        edge(group, {
          resourceType: "CLOCK",
          kind: "CLOCK_BUFFER_INPUT",
          direction: "DIRECTED",
          from: net,
          to: componentNode,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.clock.buffer-input.v1"
        })
      );
    }
    if (roles.has("CLOCK_BUFFER_CANDIDATE") && isClockOutput(text)) {
      result.push(
        edge(group, {
          resourceType: "CLOCK",
          kind: "CLOCK_BUFFER_OUTPUT",
          direction: "DIRECTED",
          from: componentNode,
          to: net,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.clock.buffer-output.v1"
        })
      );
    }
    if (roles.has("MCU_MPU") && isClockInput(text)) {
      result.push(
        edge(group, {
          resourceType: "CLOCK",
          kind: "CLOCK_SINK_INPUT",
          direction: "DIRECTED",
          from: net,
          to: componentNode,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.clock.mcu-external-input.v1"
        })
      );
    }
    if (roles.has("RESET_SUPERVISOR") && isResetText(text)) {
      result.push(
        edge(group, {
          resourceType: "RESET_BOOT",
          kind: "RESET_SOURCE_OUTPUT",
          direction: "DIRECTED",
          from: componentNode,
          to: net,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.reset.supervisor-output.v1"
        })
      );
    }
    if (roles.has("CONNECTOR") && isResetText(text)) {
      result.push(
        edge(group, {
          resourceType: "RESET_BOOT",
          kind: "RESET_EXTERNAL_SOURCE_CANDIDATE",
          direction: "DIRECTED",
          from: componentNode,
          to: net,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.reset.external-connector-source.v1"
        })
      );
    }
    if (roles.has("MCU_MPU") && isResetText(text)) {
      result.push(
        edge(group, {
          resourceType: "RESET_BOOT",
          kind: "RESET_SINK_INPUT",
          direction: "DIRECTED",
          from: net,
          to: componentNode,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.reset.mcu-input.v1"
        })
      );
    }
    if (roles.has("MCU_MPU") && isBootText(text)) {
      result.push(
        edge(group, {
          resourceType: "RESET_BOOT",
          kind: "BOOT_STRAP_INPUT",
          direction: "DIRECTED",
          from: net,
          to: componentNode,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.boot.mcu-strap-input.v1"
        })
      );
    }
    if (roles.has("MCU_MPU")) {
      result.push(
        edge(group, {
          resourceType: "MCU_PIN",
          kind: "MCU_PIN_CONNECTION",
          direction: "DIRECTED",
          from: componentNode,
          to: net,
          pins: [pin],
          viaComponents: [component],
          ruleId: "resource.mcu-pin.explicit-connection.v1"
        })
      );
    }
  }
  return result;
}

function biasEdges(group: LogicalResourceGroup): readonly IrResourceEdge[] {
  const roles = new Set(group.semantics.flatMap((item) => item.roles.map((role) => role.role)));
  const manualResetControl = group.components.some((item) =>
    /^(?:SW|S|K|KEY|BTN)[0-9A-Z_-]*$/u.test(
      item.designator?.toLocaleUpperCase("en-US") ?? ""
    )
  );
  const connected = group.pins.flatMap((pin) => {
    const net = connectedNet(pin);
    return net === undefined ? [] : [{ pin, net, text: pinText(pin, net) }];
  });
  const hasManualReset =
    manualResetControl && connected.some((item) => isResetText(item.text));
  if (
    !roles.has("PASSIVE") &&
    !roles.has("BOOT_STRAP") &&
    !hasManualReset
  ) {
    return [];
  }
  const uniqueNets = [
    ...new Map(connected.map((item) => [item.net.id, item.net])).values()
  ];
  if (uniqueNets.length !== 2) return [];
  const target = connected.find(
    (item) => isResetText(item.text) || isBootText(item.text)
  );
  if (target === undefined) return [];
  if (hasManualReset && isResetText(target.text)) {
    const component = group.components.find(
      (item) => item.id === target.pin.componentId && item.pageId === target.pin.pageId
    );
    if (component === undefined) return [];
    return [
      edge(group, {
        resourceType: "RESET_BOOT",
        kind: "RESET_MANUAL_SOURCE_CANDIDATE",
        direction: "DIRECTED",
        from: componentEndpoint(group, component),
        to: target.net,
        pins: connected.map((item) => item.pin),
        viaComponents: [component],
        ruleId: "resource.reset.manual-control-source.v1"
      })
    ];
  }
  const bias = connected.find(
    (item) => item.net.id !== target.net.id && isPowerText(item.text)
  );
  if (bias === undefined) return [];
  const boot = connected.some((item) => isBootText(item.text));
  return [
    edge(group, {
      resourceType: "RESET_BOOT",
      kind: boot ? "BOOT_BIAS_CANDIDATE" : "RESET_BIAS_CANDIDATE",
      direction: "BIDIRECTIONAL",
      from: bias.net,
      to: target.net,
      pins: connected.map((item) => item.pin),
      ruleId: boot
        ? "resource.boot.passive-bias.v1"
        : "resource.reset.passive-bias.v1"
    })
  ];
}

export function compileResources(
  components: readonly IrComponent[],
  semantics: readonly IrComponentSemantic[],
  pins: readonly IrPinInstance[]
): ResourceCompilationResult {
  const resourceEdges = groups(components, semantics, pins)
    .flatMap((group) => [
      ...powerEdges(group),
      ...signalEdges(group),
      ...biasEdges(group)
    ])
    .sort(
      (left, right) =>
        compareText(left.resourceType, right.resourceType) ||
        compareText(left.kind, right.kind) ||
        compareText(left.from.id, right.from.id) ||
        compareText(left.to.id, right.to.id) ||
        compareText(left.id, right.id)
    );
  const uniqueEdges = [
    ...new Map(resourceEdges.map((item) => [item.id, item])).values()
  ];
  const resourceNodes = [
    ...new Map(
      uniqueEdges
        .flatMap((item) => [item.from, item.to])
        .map((item) => [item.id, item])
    ).values()
  ].sort((left, right) => compareText(left.id, right.id));
  return { resourceNodes, resourceEdges: uniqueEdges };
}
