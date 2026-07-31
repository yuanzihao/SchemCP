import { createHash } from "node:crypto";
import type { DatasheetStoreQueryIndex } from "../datasheet/query-index.js";
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
  selector: ComponentSelector
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
