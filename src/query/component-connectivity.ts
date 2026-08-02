import { createHash } from "node:crypto";
import type { DatasheetStoreQueryIndex } from "../datasheet/query-index.js";
import type {
  IrComponentPowerDomainCandidate,
  IrRecordProvenance,
  IrResourceEdgeKind,
  IrResourceType,
  IrSemanticTruthStatus
} from "../ir/model.js";
import type {
  JlcEdaProEnet,
  JlcEdaProEnetComponent,
  JlcEdaProEnetPin
} from "../truth/jlceda-pro-enet.js";
import {
  QUERY_LIMITS,
  QueryError,
  type ComponentLookup,
  type ComponentPinSummary,
  type ComponentSummary,
  type EdaIrQueryIndex,
  type Page
} from "./index.js";
import type { NetlistComparisonQueryIndex } from "./netlist-comparison-index.js";

export interface ComponentSelector {
  readonly componentId?: string | undefined;
  readonly designator?: string | undefined;
  readonly pageId?: string | undefined;
}

export type ConnectivityEvidence =
  | "BOUND_NETLIST"
  | "EPRO2_CANDIDATE"
  | "UNRESOLVED";

export interface ComponentPinConnectivity {
  readonly pinId: string;
  readonly number?: string;
  readonly schematicName?: string;
  readonly boundNetlistName?: string;
  readonly instanceAttributes: ComponentPinSummary["instanceAttributes"];
  readonly network: {
    readonly evidence: ConnectivityEvidence;
    readonly state:
      | "BOUND_NET"
      | "BOUND_UNCONNECTED"
      | "UNIQUE_EXPLICIT_NET_CANDIDATE"
      | "CONFLICTING_EXPLICIT_NET_CANDIDATES"
      | "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET"
      | "DECLARED_NO_CONNECT"
      | "UNRESOLVED_NO_WIRE"
      | "PIN_NUMBER_MISSING"
      | "NETLIST_COMPONENT_NOT_RESOLVED";
    readonly netName?: string;
    readonly candidateNetNames: readonly string[];
    readonly electricalTruth: "NOT_VERIFIED";
  };
}

export interface DirectComponentConnection {
  readonly source: {
    readonly componentRef: string;
    readonly pinNumber: string;
    readonly pinName?: string;
  };
  readonly network: {
    readonly name: string;
    readonly evidence: Exclude<ConnectivityEvidence, "UNRESOLVED">;
  };
  readonly target: {
    readonly componentRef: string;
    readonly pinNumber: string;
    readonly pinName?: string;
    readonly component?: ComponentSummary;
  };
  readonly propagation: "DIRECT_SAME_NET_ONLY";
  readonly electricalTruth: "NOT_VERIFIED";
}

export type McuPinUsageStatus =
  | "USED_BOUND_NETLIST"
  | "USED_CANDIDATE"
  | "UNUSED_CONFIRMED"
  | "UNKNOWN";

export type McuPinResourceStatus =
  | "USED"
  | "EXPLICIT_NC"
  | "UNUSED"
  | "UNKNOWN"
  | "DNP_COMPONENT";

export type McuPinUnresolvedReason =
  | "VARIANT_SCOPE_NOT_PROVEN"
  | "ASSEMBLY_STATUS_UNKNOWN"
  | "PIN_COMPLETENESS_NOT_COMPLETE"
  | "NETLIST_NOT_ATTACHED"
  | "PIN_NUMBER_MISSING"
  | "PIN_NOT_PRESENT_IN_BOUND_NETLIST"
  | "NO_EXPLICIT_CONNECTION_EVIDENCE";

export interface McuPinUsageItem {
  readonly logicalComponentId: string;
  readonly component: ComponentSummary;
  readonly pin: ComponentPinSummary;
  readonly status: McuPinResourceStatus;
  readonly usageStatus: McuPinUsageStatus;
  readonly usageBasis:
    | "USER_BOUND_NETLIST_CONNECTED"
    | "USER_BOUND_NETLIST_UNCONNECTED"
    | "EXPLICIT_PROJECT_NO_CONNECT"
    | "EXPLICIT_NET_CONNECTION_CANDIDATE"
    | "INSUFFICIENT_EVIDENCE";
  readonly boundNetlistPinName?: string;
  readonly boundNetName?: string;
  readonly interfaceSignals: readonly {
    readonly type: string;
    readonly group: string;
    readonly signal: string;
  }[];
  readonly powerDomains: readonly IrComponentPowerDomainCandidate[];
  readonly resourceRoles: readonly {
    readonly edgeId: string;
    readonly resourceType: IrResourceType;
    readonly kind: IrResourceEdgeKind;
    readonly activityStatus: string;
    readonly status: "CANDIDATE" | "UNRESOLVED";
    readonly ruleId: string;
    readonly evidenceClass: "DETERMINISTIC_RULE";
    readonly truthStatus: IrSemanticTruthStatus;
  }[];
  readonly unresolvedReasons: readonly McuPinUnresolvedReason[];
  readonly evidenceClass:
    | "EXPLICIT_PROJECT_RECORD"
    | "USER_BOUND_NETLIST"
    | "DETERMINISTIC_RULE";
  readonly truthStatus: IrSemanticTruthStatus;
  readonly semanticRuleSetVersion: "schemcp.semantic-rules/1";
  readonly provenance: readonly IrRecordProvenance[];
}

export interface McuPinUsageQuery extends ComponentSelector {
  readonly instanceContextId?: string | undefined;
  readonly variantId?: string | undefined;
  readonly status?: McuPinResourceStatus | undefined;
  readonly usageStatus?: McuPinUsageStatus | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface McuPinUsageResult {
  readonly mcuCount: number;
  readonly netlistBinding: "BOUND" | "NOT_BOUND";
  readonly unusedAssertionGate:
    "REQUIRES_COMPLETE_PIN_MODEL_BASE_VARIANT_AND_EXPLICIT_NC_OR_BOUND_UNCONNECTED";
  readonly pins: Page<McuPinUsageItem>;
  readonly electricalTruth: "NOT_VERIFIED";
}

interface CursorPayload {
  readonly version: 1;
  readonly scope: string;
  readonly offset: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scopeHash(kind: string, identity: string): string {
  return createHash("sha256")
    .update(`${kind}\n${identity}`)
    .digest("hex")
    .slice(0, 24);
}

function pageSize(limit: number | undefined): number {
  const actual = limit ?? QUERY_LIMITS.defaultPageSize;
  if (
    !Number.isSafeInteger(actual) ||
    actual < 1 ||
    actual > QUERY_LIMITS.maxPageSize
  ) {
    throw new QueryError(
      "QUERY_INVALID_LIMIT",
      `limit 必须是 1 到 ${QUERY_LIMITS.maxPageSize} 的整数。`
    );
  }
  return actual;
}

function decodeCursor(cursor: string | undefined, scope: string): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Partial<CursorPayload>;
    if (
      parsed.version !== 1 ||
      parsed.scope !== scope ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset ?? -1) < 0
    ) {
      throw new Error("cursor mismatch");
    }
    return parsed.offset as number;
  } catch {
    throw new QueryError(
      "QUERY_INVALID_CURSOR",
      "cursor 无效，或不属于当前组件连接查询。"
    );
  }
}

function paginate<T>(
  items: readonly T[],
  limit: number | undefined,
  cursor: string | undefined,
  scope: string
): Page<T> {
  const size = pageSize(limit);
  const offset = decodeCursor(cursor, scope);
  if (offset > items.length) {
    throw new QueryError("QUERY_INVALID_CURSOR", "cursor 已超出查询范围。");
  }
  const page = items.slice(offset, offset + size);
  const nextOffset = offset + page.length;
  return {
    items: page,
    total: items.length,
    ...(nextOffset < items.length
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({ version: 1, scope, offset: nextOffset }),
            "utf8"
          ).toString("base64url")
        }
      : {})
  };
}

function boundComponent(
  netlist: JlcEdaProEnet | undefined,
  designator: string | undefined
): JlcEdaProEnetComponent | undefined {
  return designator === undefined
    ? undefined
    : netlist?.components.find(
        (component) => component.designator === designator
      );
}

function allComponentPins(
  index: EdaIrQueryIndex,
  selector: ComponentSelector & {
    readonly instanceContextId?: string | undefined;
    readonly variantId?: string | undefined;
  }
): readonly ComponentPinSummary[] {
  const items: ComponentPinSummary[] = [];
  let cursor: string | undefined;
  do {
    const lookup = index.getComponentPins({
      ...selector,
      limit: QUERY_LIMITS.maxPageSize,
      ...(cursor === undefined ? {} : { cursor })
    });
    if (lookup.status !== "FOUND" || !("pins" in lookup)) return [];
    items.push(...lookup.pins.items);
    cursor = lookup.pins.nextCursor;
  } while (cursor !== undefined);
  return items;
}

function candidateNetwork(pin: ComponentPinSummary): {
  readonly state: ComponentPinConnectivity["network"]["state"];
  readonly names: readonly string[];
} {
  if (pin.number === undefined) {
    return { state: "PIN_NUMBER_MISSING", names: [] };
  }
  return {
    state: pin.connectionCandidate.status,
    names: pin.connectionCandidate.explicitNets
      .map((net) => net.netName)
      .sort(compareText)
  };
}

function localDocumentReferenceCount(
  datasheets: DatasheetStoreQueryIndex | undefined,
  component: ComponentSummary
): number {
  if (datasheets === undefined || component.identity === undefined) return 0;
  const identity = component.identity;
  if (identity.lcscPartId !== undefined) {
    return datasheets.listReferences({
      lcscPartId: identity.lcscPartId,
      limit: 1
    }).total;
  }
  if (
    identity.manufacturer !== undefined &&
    identity.manufacturerPart !== undefined
  ) {
    return datasheets.listReferences({
      manufacturer: identity.manufacturer,
      manufacturerPart: identity.manufacturerPart,
      limit: 1
    }).total;
  }
  return 0;
}

export class ComponentConnectivityQuery {
  public constructor(
    private readonly index: EdaIrQueryIndex,
    private readonly comparison?: NetlistComparisonQueryIndex,
    private readonly datasheets?: DatasheetStoreQueryIndex
  ) {}

  public getMcuPinUsage(input: McuPinUsageQuery = {}): McuPinUsageResult {
    const semanticByLogicalId = new Map(
      this.index.ir.componentSemantics
        .filter((item) => item.primaryRole === "MCU_MPU")
        .map((item) => [item.logicalComponentId, item])
    );
    let selectedLogicalIds = [...semanticByLogicalId.keys()].sort(compareText);
    if (
      input.componentId !== undefined ||
      input.designator !== undefined ||
      input.pageId !== undefined
    ) {
      const lookup = this.index.getComponent({
        componentId: input.componentId,
        designator: input.designator,
        pageId: input.pageId,
        instanceContextId: input.instanceContextId,
        variantId: input.variantId
      });
      if (lookup.status !== "FOUND") {
        throw new QueryError(
          "QUERY_INVALID_TEXT",
          lookup.status === "AMBIGUOUS"
            ? "MCU 选择器存在歧义，请补充 pageId 或 componentId。"
            : "MCU 选择器未命中组件。"
        );
      }
      const logicalId = lookup.component.semantic?.logicalComponentId;
      if (
        lookup.component.semantic?.primaryRole !== "MCU_MPU" ||
        logicalId === undefined
      ) {
        throw new QueryError("QUERY_INVALID_TEXT", "所选组件不是 MCU_MPU 候选。");
      }
      selectedLogicalIds = [logicalId];
    }

    const interfaceSignalsByPin = new Map<
      string,
      { readonly type: string; readonly group: string; readonly signal: string }[]
    >();
    for (const item of this.index.ir.interfaces) {
      for (const signal of item.signals) {
        for (const pinId of signal.pinInstanceIds) {
          const values = interfaceSignalsByPin.get(pinId) ?? [];
          values.push({ type: item.type, group: item.group, signal: signal.signal });
          interfaceSignalsByPin.set(pinId, values);
        }
      }
    }
    const pinProvenance = new Map(
      this.index.ir.pinInstances.map((pin) => [
        pin.id,
        [pin.provenance.component, pin.provenance.symbolPin] as const
      ])
    );
    const powerDomainsByLogicalId = new Map<
      string,
      IrComponentPowerDomainCandidate[]
    >();
    for (const item of this.index.ir.componentSemantics) {
      const values = powerDomainsByLogicalId.get(item.logicalComponentId) ?? [];
      for (const domain of item.powerDomains) {
        if (!values.some((value) => value.id === domain.id)) values.push(domain);
      }
      powerDomainsByLogicalId.set(item.logicalComponentId, values);
    }
    const resourceRolesByPin = new Map<
      string,
      McuPinUsageItem["resourceRoles"][number][]
    >();
    for (const edge of this.index.ir.resourceEdges) {
      for (const pinId of edge.pinInstanceIds) {
        const values = resourceRolesByPin.get(pinId) ?? [];
        values.push({
          edgeId: edge.id,
          resourceType: edge.resourceType,
          kind: edge.kind,
          activityStatus: edge.activityStatus,
          status: edge.status,
          ruleId: edge.ruleId,
          evidenceClass: edge.evidenceClass,
          truthStatus: edge.truthStatus
        });
        resourceRolesByPin.set(pinId, values);
      }
    }
    const items: McuPinUsageItem[] = [];
    let mcuCount = 0;
    for (const logicalComponentId of selectedLogicalIds) {
      const semantic = semanticByLogicalId.get(logicalComponentId);
      if (semantic === undefined) continue;
      const representative = this.index.ir.components.find(
        (item) =>
          item.id === semantic.componentId && item.pageId === semantic.pageId
      );
      if (representative === undefined) continue;
      const lookup = this.index.getComponent({
        componentId: representative.id,
        pageId: representative.pageId,
        instanceContextId: input.instanceContextId,
        variantId: input.variantId
      });
      if (lookup.status !== "FOUND") continue;
      mcuCount += 1;
      const pins = allComponentPins(this.index, {
        componentId: representative.id,
        pageId: representative.pageId,
        instanceContextId: input.instanceContextId,
        variantId: input.variantId
      });
      const netlistComponent = boundComponent(
        this.comparison?.netlist,
        lookup.component.designator
      );
      const netlistPins = new Map(
        (netlistComponent?.pins ?? []).map((pin) => [pin.number, pin])
      );
      const unusedGateOpen =
        input.variantId === undefined &&
        lookup.component.assembly.status === "POPULATED" &&
        lookup.component.pinCompleteness.status === "COMPLETE";
      for (const pin of pins) {
        const boundPin =
          pin.number === undefined ? undefined : netlistPins.get(pin.number);
        let usageStatus: McuPinUsageStatus = "UNKNOWN";
        let status: McuPinResourceStatus = "UNKNOWN";
        let usageBasis: McuPinUsageItem["usageBasis"] =
          "INSUFFICIENT_EVIDENCE";
        let evidenceClass: McuPinUsageItem["evidenceClass"] =
          "DETERMINISTIC_RULE";
        let truthStatus: IrSemanticTruthStatus = "UNRESOLVED";
        if (lookup.component.assembly.status === "DNP") {
          status = "DNP_COMPONENT";
          evidenceClass = lookup.component.assembly.evidenceClass;
          truthStatus = "NOT_VERIFIED";
        } else if (
          unusedGateOpen &&
          pin.connectionCandidate.status === "DECLARED_NO_CONNECT"
        ) {
          status = "EXPLICIT_NC";
          usageStatus = "UNUSED_CONFIRMED";
          usageBasis = "EXPLICIT_PROJECT_NO_CONNECT";
          evidenceClass = "EXPLICIT_PROJECT_RECORD";
          truthStatus = "NOT_VERIFIED";
        } else if (unusedGateOpen && boundPin?.net === "") {
          status = "UNUSED";
          usageStatus = "UNUSED_CONFIRMED";
          usageBasis = "USER_BOUND_NETLIST_UNCONNECTED";
          evidenceClass = "USER_BOUND_NETLIST";
          truthStatus = "NOT_VERIFIED";
        } else if (boundPin !== undefined && boundPin.net !== "") {
          status = "USED";
          usageStatus = "USED_BOUND_NETLIST";
          usageBasis = "USER_BOUND_NETLIST_CONNECTED";
          evidenceClass = "USER_BOUND_NETLIST";
          truthStatus = "NOT_VERIFIED";
        } else if (
          pin.connectionCandidate.status === "UNIQUE_EXPLICIT_NET_CANDIDATE"
        ) {
          status = "USED";
          usageStatus = "USED_CANDIDATE";
          usageBasis = "EXPLICIT_NET_CONNECTION_CANDIDATE";
          evidenceClass = "DETERMINISTIC_RULE";
          truthStatus = "CANDIDATE";
        }
        const interfaceSignals = [
          ...(interfaceSignalsByPin.get(pin.id) ?? [])
        ].sort(
          (left, right) =>
            compareText(left.type, right.type) ||
            compareText(left.group, right.group) ||
            compareText(left.signal, right.signal)
        );
        const powerDomains = [...(powerDomainsByLogicalId.get(logicalComponentId) ?? [])]
          .filter((item) => item.pinInstanceIds.includes(pin.id))
          .sort((left, right) => compareText(left.id, right.id));
        const resourceRoles = [...(resourceRolesByPin.get(pin.id) ?? [])].sort(
          (left, right) =>
            compareText(left.resourceType, right.resourceType) ||
            compareText(left.kind, right.kind) ||
            compareText(left.edgeId, right.edgeId)
        );
        const unresolvedReasons: McuPinUnresolvedReason[] = [];
        if (status === "UNKNOWN") {
          if (input.variantId !== undefined) {
            unresolvedReasons.push("VARIANT_SCOPE_NOT_PROVEN");
          }
          if (lookup.component.assembly.status === "UNKNOWN") {
            unresolvedReasons.push("ASSEMBLY_STATUS_UNKNOWN");
          }
          if (lookup.component.pinCompleteness.status !== "COMPLETE") {
            unresolvedReasons.push("PIN_COMPLETENESS_NOT_COMPLETE");
          }
          if (this.comparison?.netlist === undefined) {
            unresolvedReasons.push("NETLIST_NOT_ATTACHED");
          }
          if (pin.number === undefined) {
            unresolvedReasons.push("PIN_NUMBER_MISSING");
          } else if (
            this.comparison?.netlist !== undefined &&
            boundPin === undefined
          ) {
            unresolvedReasons.push("PIN_NOT_PRESENT_IN_BOUND_NETLIST");
          }
          if (
            pin.connectionCandidate.status !==
              "UNIQUE_EXPLICIT_NET_CANDIDATE" &&
            pin.connectionCandidate.status !== "DECLARED_NO_CONNECT"
          ) {
            unresolvedReasons.push("NO_EXPLICIT_CONNECTION_EVIDENCE");
          }
        }
        items.push({
          logicalComponentId,
          component: lookup.component,
          pin,
          status,
          usageStatus,
          usageBasis,
          ...(boundPin?.name === undefined
            ? {}
            : { boundNetlistPinName: boundPin.name }),
          ...(boundPin?.net === undefined || boundPin.net === ""
            ? {}
            : { boundNetName: boundPin.net }),
          interfaceSignals,
          powerDomains,
          resourceRoles,
          unresolvedReasons,
          evidenceClass,
          truthStatus,
          semanticRuleSetVersion: "schemcp.semantic-rules/1",
          provenance: pinProvenance.get(pin.id) ?? []
        });
      }
    }
    const filtered = items
      .filter(
        (item) =>
          (input.status === undefined || item.status === input.status) &&
          (input.usageStatus === undefined || item.usageStatus === input.usageStatus)
      )
      .sort(
        (left, right) =>
          compareText(left.logicalComponentId, right.logicalComponentId) ||
          compareText(left.pin.pageId, right.pin.pageId) ||
          compareText(left.pin.partId, right.pin.partId) ||
          compareText(left.pin.number ?? "", right.pin.number ?? "") ||
          compareText(left.pin.id, right.pin.id)
      );
    const scope = scopeHash(
      "mcu-pin-usage",
      JSON.stringify([
        this.index.ir.irSha256,
        this.comparison?.report.reportSha256 ?? "",
        input.componentId ?? "",
        input.designator ?? "",
        input.pageId ?? "",
        input.instanceContextId ?? "",
        input.variantId ?? "",
        input.status ?? "",
        input.usageStatus ?? "",
        "schemcp.semantic-rules/1"
      ])
    );
    return {
      mcuCount,
      netlistBinding:
        this.comparison?.netlist === undefined ? "NOT_BOUND" : "BOUND",
      unusedAssertionGate:
        "REQUIRES_COMPLETE_PIN_MODEL_BASE_VARIANT_AND_EXPLICIT_NC_OR_BOUND_UNCONNECTED",
      pins: paginate(filtered, input.limit, input.cursor, scope),
      electricalTruth: "NOT_VERIFIED"
    };
  }

  public getPinConnectivity(input: ComponentSelector & {
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): ComponentLookup | {
    readonly status: "FOUND";
    readonly component: ComponentSummary;
    readonly engineeringLinks: Extract<
      ComponentLookup,
      { readonly status: "FOUND" }
    >["engineeringLinks"];
    readonly localDocumentReferenceCount: number;
    readonly netlistBinding: "BOUND" | "NOT_BOUND";
    readonly pins: Page<ComponentPinConnectivity>;
  } {
    const componentLookup = this.index.getComponent(input);
    if (componentLookup.status !== "FOUND") return componentLookup;
    const component = componentLookup.component;
    const schematicPins = allComponentPins(this.index, {
      componentId: component.id,
      pageId: component.pageId
    });
    const byNumber = new Map(
      schematicPins.flatMap((pin) =>
        pin.number === undefined ? [] : [[pin.number, pin] as const]
      )
    );
    const netlistComponent = boundComponent(
      this.comparison?.netlist,
      component.designator
    );
    const netlistByNumber = new Map(
      (netlistComponent?.pins ?? []).map((pin) => [pin.number, pin])
    );
    const keys = new Set([
      ...schematicPins.map((pin) =>
        pin.number === undefined
          ? `schematic:${pin.id}`
          : `number:${pin.number}`
      ),
      ...(netlistComponent?.pins ?? []).map((pin) => `number:${pin.number}`)
    ]);
    const merged = [...keys].map((key): ComponentPinConnectivity => {
      const schematicPin =
        key.startsWith("number:")
          ? byNumber.get(key.slice("number:".length))
          : schematicPins.find((pin) => `schematic:${pin.id}` === key);
      const netlistPin =
        schematicPin?.number === undefined
          ? key.startsWith("number:")
            ? netlistByNumber.get(key.slice("number:".length))
            : undefined
          : netlistByNumber.get(schematicPin.number);
      const candidate =
        schematicPin === undefined
          ? { state: "UNRESOLVED_NO_WIRE" as const, names: [] }
          : candidateNetwork(schematicPin);
      const network =
        netlistComponent === undefined && this.comparison !== undefined
          ? {
              evidence: "UNRESOLVED" as const,
              state: "NETLIST_COMPONENT_NOT_RESOLVED" as const,
              candidateNetNames: candidate.names,
              electricalTruth: "NOT_VERIFIED" as const
            }
          : netlistPin !== undefined
            ? {
                evidence: "BOUND_NETLIST" as const,
                state:
                  netlistPin.net === ""
                    ? ("BOUND_UNCONNECTED" as const)
                    : ("BOUND_NET" as const),
                ...(netlistPin.net === "" ? {} : { netName: netlistPin.net }),
                candidateNetNames: candidate.names,
                electricalTruth: "NOT_VERIFIED" as const
              }
            : {
                evidence:
                  candidate.names.length > 0
                    ? ("EPRO2_CANDIDATE" as const)
                    : ("UNRESOLVED" as const),
                state: candidate.state,
                ...(candidate.names.length === 1
                  ? { netName: candidate.names[0] }
                  : {}),
                candidateNetNames: candidate.names,
                electricalTruth: "NOT_VERIFIED" as const
              };
      const pinNumber = schematicPin?.number ?? netlistPin?.number;
      return {
        pinId: schematicPin?.id ?? `enet:${netlistPin?.key ?? key}`,
        ...(pinNumber === undefined ? {} : { number: pinNumber }),
        ...(schematicPin?.name === undefined
          ? {}
          : { schematicName: schematicPin.name }),
        ...(netlistPin?.name === undefined
          ? {}
          : { boundNetlistName: netlistPin.name }),
        instanceAttributes: schematicPin?.instanceAttributes ?? [],
        network
      };
    }).sort(
      (left, right) =>
        compareText(left.number ?? "", right.number ?? "") ||
        compareText(left.pinId, right.pinId)
    );
    const scope = scopeHash(
      "component-pin-connectivity",
      `${this.index.ir.irSha256}\n${this.comparison?.report.reportSha256 ?? ""}\n${component.pageId}\n${component.id}`
    );
    return {
      status: "FOUND",
      component,
      engineeringLinks: componentLookup.engineeringLinks,
      localDocumentReferenceCount: localDocumentReferenceCount(
        this.datasheets,
        component
      ),
      netlistBinding:
        this.comparison?.netlist === undefined ? "NOT_BOUND" : "BOUND",
      pins: paginate(merged, input.limit, input.cursor, scope)
    };
  }

  public listDirectConnections(input: ComponentSelector & {
    readonly pinNumber?: string | undefined;
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  }): ComponentLookup | {
    readonly status: "FOUND";
    readonly component: ComponentSummary;
    readonly evidence: Exclude<ConnectivityEvidence, "UNRESOLVED"> | "NOT_AVAILABLE";
    readonly connections: Page<DirectComponentConnection>;
  } {
    const lookup = this.index.getComponent(input);
    if (lookup.status !== "FOUND") return lookup;
    const component = lookup.component;
    const ref = component.designator;
    if (ref === undefined) {
      return {
        status: "FOUND",
        component,
        evidence: "NOT_AVAILABLE",
        connections: { items: [], total: 0 }
      };
    }
    const connections =
      this.comparison?.netlist === undefined
        ? this.candidateConnections(ref, input.pinNumber)
        : this.boundConnections(
            this.comparison.netlist,
            ref,
            input.pinNumber
          );
    const evidence =
      this.comparison?.netlist === undefined
        ? ("EPRO2_CANDIDATE" as const)
        : ("BOUND_NETLIST" as const);
    const scope = scopeHash(
      "direct-component-connections",
      `${this.index.ir.irSha256}\n${this.comparison?.report.reportSha256 ?? ""}\n${component.pageId}\n${component.id}\n${input.pinNumber ?? ""}`
    );
    return {
      status: "FOUND",
      component,
      evidence,
      connections: paginate(connections, input.limit, input.cursor, scope)
    };
  }

  private boundConnections(
    netlist: JlcEdaProEnet,
    ref: string,
    pinNumber: string | undefined
  ): readonly DirectComponentConnection[] {
    const source = boundComponent(netlist, ref);
    if (source === undefined) return [];
    const items: DirectComponentConnection[] = [];
    for (const sourcePin of source.pins) {
      if (
        sourcePin.net === "" ||
        (pinNumber !== undefined && sourcePin.number !== pinNumber)
      ) {
        continue;
      }
      for (const targetComponent of netlist.components) {
        for (const targetPin of targetComponent.pins) {
          if (
            targetPin.net !== sourcePin.net ||
            (targetComponent.designator === ref &&
              targetPin.number === sourcePin.number)
          ) {
            continue;
          }
          const targetLookup = this.index.getComponent({
            designator: targetComponent.designator
          });
          items.push({
            source: this.endpoint(ref, sourcePin),
            network: {
              name: sourcePin.net,
              evidence: "BOUND_NETLIST"
            },
            target: {
              ...this.endpoint(targetComponent.designator, targetPin),
              ...(targetLookup.status === "FOUND"
                ? { component: targetLookup.component }
                : {})
            },
            propagation: "DIRECT_SAME_NET_ONLY",
            electricalTruth: "NOT_VERIFIED"
          });
        }
      }
    }
    return this.sortConnections(items);
  }

  private candidateConnections(
    ref: string,
    pinNumber: string | undefined
  ): readonly DirectComponentConnection[] {
    const sourceTuples = this.allCandidateTuples({
      componentRef: ref,
      ...(pinNumber === undefined ? {} : { pinNumber })
    });
    const items: DirectComponentConnection[] = [];
    for (const source of sourceTuples) {
      for (const target of this.allCandidateTuples({
        netName: source.tuple.netName
      })) {
        if (
          target.tuple.componentRef === ref &&
          target.tuple.pinNumber === source.tuple.pinNumber
        ) {
          continue;
        }
        const targetLookup = this.index.getComponent({
          designator: target.tuple.componentRef
        });
        items.push({
          source: {
            componentRef: ref,
            pinNumber: source.tuple.pinNumber
          },
          network: {
            name: source.tuple.netName,
            evidence: "EPRO2_CANDIDATE"
          },
          target: {
            componentRef: target.tuple.componentRef,
            pinNumber: target.tuple.pinNumber,
            ...(targetLookup.status === "FOUND"
              ? { component: targetLookup.component }
              : {})
          },
          propagation: "DIRECT_SAME_NET_ONLY",
          electricalTruth: "NOT_VERIFIED"
        });
      }
    }
    return this.sortConnections(items);
  }

  private allCandidateTuples(
    filter: {
      readonly componentRef?: string;
      readonly pinNumber?: string;
      readonly netName?: string;
    }
  ) {
    const items = [];
    let cursor: string | undefined;
    do {
      const page = this.index.listCandidateNetlistTuples({
        ...filter,
        limit: QUERY_LIMITS.maxPageSize,
        ...(cursor === undefined ? {} : { cursor })
      });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return items;
  }

  private endpoint(componentRef: string, pin: JlcEdaProEnetPin) {
    return {
      componentRef,
      pinNumber: pin.number,
      ...(pin.name === "" ? {} : { pinName: pin.name })
    };
  }

  private sortConnections(
    items: readonly DirectComponentConnection[]
  ): readonly DirectComponentConnection[] {
    return [...new Map(
      items.map((item) => [
        JSON.stringify([
          item.source.componentRef,
          item.source.pinNumber,
          item.network.name,
          item.target.componentRef,
          item.target.pinNumber
        ]),
        item
      ])
    ).values()].sort(
      (left, right) =>
        compareText(left.source.pinNumber, right.source.pinNumber) ||
        compareText(left.network.name, right.network.name) ||
        compareText(left.target.componentRef, right.target.componentRef) ||
        compareText(left.target.pinNumber, right.target.pinNumber)
    );
  }
}
