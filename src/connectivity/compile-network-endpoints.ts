import { sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  IrAttribute,
  IrComponent,
  IrNetworkEndpointCandidate,
  IrNetworkEndpointCandidateKind,
  IrNetworkEndpointCandidateStatus,
  IrPinInstance,
  IrSymbol
} from "../ir/model.js";

export interface NetworkEndpointCompilationSummary {
  readonly endpointComponents: number;
  readonly matching: number;
  readonly mismatching: number;
  readonly missingDeclaration: number;
  readonly conflictingDeclaration: number;
  readonly invalidDeclarationValue: number;
  readonly unresolvedConnection: number;
  readonly invalidPinCount: number;
}

export interface NetworkEndpointCompilationResult {
  readonly candidates: readonly IrNetworkEndpointCandidate[];
  readonly summary: NetworkEndpointCompilationSummary;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function componentKey(
  value: Pick<IrComponent, "pageId" | "id">
): string {
  return `${value.pageId}\n${value.id}`;
}

function pinComponentKey(
  value: Pick<IrPinInstance, "pageId" | "componentId">
): string {
  return `${value.pageId}\n${value.componentId}`;
}

function endpointKind(
  symbolType: number | undefined
): IrNetworkEndpointCandidateKind | undefined {
  if (symbolType === 18) return "NET_FLAG";
  if (symbolType === 19) return "NET_PORT";
  return undefined;
}

function relevantKeys(
  kind: IrNetworkEndpointCandidateKind
): ReadonlySet<string> {
  return new Set(
    kind === "NET_FLAG" ? ["Global Net Name", "Name"] : ["Name"]
  );
}

function declaration(
  attributes: readonly IrAttribute[],
  kind: IrNetworkEndpointCandidateKind
): {
  readonly evidence: readonly IrAttribute[];
  readonly values: readonly string[];
  readonly hasInvalidValue: boolean;
} {
  const keys = relevantKeys(kind);
  const evidence = attributes
    .filter((attribute) => keys.has(attribute.key))
    .sort(
      (left, right) =>
        compareText(left.key, right.key) || compareText(left.id, right.id)
    );
  const values = [
    ...new Set(
      evidence
        .map((attribute) => attribute.value)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
    )
  ].sort(compareText);
  const hasInvalidValue = evidence.some(
    (attribute) =>
      attribute.value !== null &&
      (typeof attribute.value !== "string" || attribute.value.length === 0)
  );
  return { evidence, values, hasInvalidValue };
}

function connectionName(pins: readonly IrPinInstance[]): string | undefined {
  if (pins.length !== 1) return undefined;
  const [pin] = pins;
  if (
    pin?.connectionCandidate.status !== "UNIQUE_EXPLICIT_NET_CANDIDATE" ||
    pin.connectionCandidate.explicitNets.length !== 1
  ) {
    return undefined;
  }
  return pin.connectionCandidate.explicitNets[0]?.netName;
}

function candidateStatus(
  pins: readonly IrPinInstance[],
  declaredValues: readonly string[],
  hasInvalidValue: boolean,
  connectionNetName: string | undefined
): IrNetworkEndpointCandidateStatus {
  if (pins.length !== 1) return "INVALID_ENDPOINT_PIN_COUNT";
  if (hasInvalidValue) return "DECLARATION_VALUE_INVALID";
  if (declaredValues.length > 1) return "DECLARATION_CONFLICT";
  if (declaredValues.length === 0) return "DECLARATION_MISSING";
  if (connectionNetName === undefined) {
    return "CONNECTION_CANDIDATE_UNRESOLVED";
  }
  return declaredValues[0] === connectionNetName
    ? "DECLARATION_MATCHES_CONNECTION_CANDIDATE"
    : "DECLARATION_MISMATCHES_CONNECTION_CANDIDATE";
}

export function compileNetworkEndpointCandidates(
  components: readonly IrComponent[],
  symbols: readonly IrSymbol[],
  pinInstances: readonly IrPinInstance[]
): NetworkEndpointCompilationResult {
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const pinsByComponent = new Map<string, IrPinInstance[]>();
  for (const pin of pinInstances) {
    const key = pinComponentKey(pin);
    const group = pinsByComponent.get(key) ?? [];
    group.push(pin);
    pinsByComponent.set(key, group);
  }
  for (const group of pinsByComponent.values()) {
    group.sort((left, right) =>
      compareText(left.symbolPinId, right.symbolPinId)
    );
  }

  const candidates: IrNetworkEndpointCandidate[] = [];
  const counts: Record<IrNetworkEndpointCandidateStatus, number> = {
    DECLARATION_MATCHES_CONNECTION_CANDIDATE: 0,
    DECLARATION_MISMATCHES_CONNECTION_CANDIDATE: 0,
    DECLARATION_MISSING: 0,
    DECLARATION_CONFLICT: 0,
    DECLARATION_VALUE_INVALID: 0,
    CONNECTION_CANDIDATE_UNRESOLVED: 0,
    INVALID_ENDPOINT_PIN_COUNT: 0
  };

  for (const component of components) {
    const symbolId = component.symbolId;
    if (symbolId === undefined) continue;
    const symbol = symbolsById.get(symbolId);
    if (symbol === undefined) continue;
    const kind = endpointKind(symbol.symbolType);
    if (kind === undefined) continue;
    const pins = pinsByComponent.get(componentKey(component)) ?? [];
    const declared = declaration(component.attributes, kind);
    const connectionNetName = connectionName(pins);
    const status = candidateStatus(
      pins,
      declared.values,
      declared.hasInvalidValue,
      connectionNetName
    );
    counts[status] += 1;
    candidates.push({
      id: sha256CanonicalJson([
        "NETWORK_ENDPOINT_CANDIDATE",
        component.pageId,
        component.id
      ]),
      pageId: component.pageId,
      componentId: component.id,
      symbolId,
      partId: component.partId,
      endpointKind: kind,
      status,
      basis: "SYMBOL_TYPE_ATTRIBUTES_AND_TRANSFORMED_PIN_CONTACTS",
      electricalTruth: "NOT_VERIFIED",
      ...(declared.values.length === 1
        ? { declaredNetNameCandidate: declared.values[0] as string }
        : {}),
      ...(connectionNetName === undefined
        ? {}
        : { connectionNetNameCandidate: connectionNetName }),
      pinInstanceIds: pins.map((pin) => pin.id),
      declarationEvidence: declared.evidence.map((attribute) => ({
        attributeId: attribute.id,
        key: attribute.key,
        value: attribute.value,
        provenance: attribute.provenance
      })),
      provenance: {
        component: component.provenance,
        symbol: symbol.provenance
      }
    });
  }

  candidates.sort(
    (left, right) =>
      compareText(left.pageId, right.pageId) ||
      compareText(left.componentId, right.componentId)
  );
  return {
    candidates,
    summary: {
      endpointComponents: candidates.length,
      matching: counts.DECLARATION_MATCHES_CONNECTION_CANDIDATE,
      mismatching: counts.DECLARATION_MISMATCHES_CONNECTION_CANDIDATE,
      missingDeclaration: counts.DECLARATION_MISSING,
      conflictingDeclaration: counts.DECLARATION_CONFLICT,
      invalidDeclarationValue: counts.DECLARATION_VALUE_INVALID,
      unresolvedConnection: counts.CONNECTION_CANDIDATE_UNRESOLVED,
      invalidPinCount: counts.INVALID_ENDPOINT_PIN_COUNT
    }
  };
}
