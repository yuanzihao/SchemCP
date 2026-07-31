import { sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  IrComponent,
  IrPinInstance,
  IrShortRelationCandidate,
  IrShortRelationCandidateStatus,
  IrSymbol
} from "../ir/model.js";

export interface ShortRelationCompilationSummary {
  readonly shortSymbolComponents: number;
  readonly readyExplicitNetPairCandidates: number;
  readonly sameExplicitNetCandidates: number;
  readonly unresolvedPinConnectionCandidates: number;
  readonly conflictingPinConnectionCandidates: number;
  readonly invalidShortPinCounts: number;
}

export interface ShortRelationCompilationResult {
  readonly relations: readonly IrShortRelationCandidate[];
  readonly summary: ShortRelationCompilationSummary;
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

function relationStatus(
  pins: readonly IrPinInstance[],
  explicitNetNames: readonly string[]
): IrShortRelationCandidateStatus {
  if (pins.length !== 2) {
    return "INVALID_SHORT_PIN_COUNT";
  }
  if (
    pins.some(
      (pin) =>
        pin.connectionCandidate.status ===
        "CONFLICTING_EXPLICIT_NET_CANDIDATES"
    )
  ) {
    return "CONFLICTING_PIN_CONNECTION_CANDIDATE";
  }
  if (
    pins.some(
      (pin) =>
        pin.connectionCandidate.status !==
          "UNIQUE_EXPLICIT_NET_CANDIDATE" ||
        pin.connectionCandidate.explicitNets.length !== 1
    )
  ) {
    return "UNRESOLVED_PIN_CONNECTION_CANDIDATE";
  }
  return explicitNetNames.length === 1
    ? "SAME_EXPLICIT_NET_CANDIDATE"
    : "READY_EXPLICIT_NET_PAIR_CANDIDATE";
}

export function compileShortRelations(
  components: readonly IrComponent[],
  symbols: readonly IrSymbol[],
  pinInstances: readonly IrPinInstance[]
): ShortRelationCompilationResult {
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

  const relations: IrShortRelationCandidate[] = [];
  const counts: Record<IrShortRelationCandidateStatus, number> = {
    READY_EXPLICIT_NET_PAIR_CANDIDATE: 0,
    SAME_EXPLICIT_NET_CANDIDATE: 0,
    UNRESOLVED_PIN_CONNECTION_CANDIDATE: 0,
    CONFLICTING_PIN_CONNECTION_CANDIDATE: 0,
    INVALID_SHORT_PIN_COUNT: 0
  };
  const shortComponents = components.filter((component) => {
    if (component.symbolId === undefined) return false;
    return symbolsById.get(component.symbolId)?.symbolType === 22;
  });

  for (const component of shortComponents) {
    const symbolId = component.symbolId;
    if (symbolId === undefined) {
      continue;
    }
    const symbol = symbolsById.get(symbolId);
    if (symbol === undefined) {
      continue;
    }
    const pins = pinsByComponent.get(componentKey(component)) ?? [];
    const explicitNetNames = [
      ...new Set(
        pins.flatMap((pin) =>
          pin.connectionCandidate.explicitNets.map(
            (candidate) => candidate.netName
          )
        )
      )
    ].sort(compareText);
    const status = relationStatus(pins, explicitNetNames);
    counts[status] += 1;
    relations.push({
      id: sha256CanonicalJson([
        "SHORT_RELATION_CANDIDATE",
        component.pageId,
        component.id
      ]),
      pageId: component.pageId,
      componentId: component.id,
      symbolId: symbol.id,
      partId: component.partId,
      status,
      basis: "SHORT_SYMBOL_TYPE_AND_TRANSFORMED_PIN_CONTACTS",
      electricalTruth: "NOT_VERIFIED",
      explicitNetNames,
      pins: pins.map((pin) => ({
        pinInstanceId: pin.id,
        symbolPinId: pin.symbolPinId,
        ...(pin.number === undefined ? {} : { number: pin.number }),
        connectionCandidate: pin.connectionCandidate
      })),
      provenance: {
        component: component.provenance,
        symbol: symbol.provenance
      }
    });
  }

  relations.sort(
    (left, right) =>
      compareText(left.pageId, right.pageId) ||
      compareText(left.componentId, right.componentId)
  );
  return {
    relations,
    summary: {
      shortSymbolComponents: relations.length,
      readyExplicitNetPairCandidates:
        counts.READY_EXPLICIT_NET_PAIR_CANDIDATE,
      sameExplicitNetCandidates: counts.SAME_EXPLICIT_NET_CANDIDATE,
      unresolvedPinConnectionCandidates:
        counts.UNRESOLVED_PIN_CONNECTION_CANDIDATE,
      conflictingPinConnectionCandidates:
        counts.CONFLICTING_PIN_CONNECTION_CANDIDATE,
      invalidShortPinCounts: counts.INVALID_SHORT_PIN_COUNT
    }
  };
}
