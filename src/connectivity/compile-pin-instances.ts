import { sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  IrAttribute,
  IrComponent,
  IrPinEndpointKind,
  IrPinExplicitNetCandidate,
  IrPinInstance,
  IrPinNoConnectDeclaration,
  IrSymbol,
  IrSymbolPin,
  IrWire,
  IrWireSegment
} from "../ir/model.js";

const GEOMETRY_EPSILON = 1e-9;
const FLOAT_PRECISION = 12;

export interface PinInstanceCompilationSummary {
  readonly componentsWithoutSymbolReference: number;
  readonly componentsWithUnknownSymbol: number;
  readonly componentsWithUnknownSymbolPart: number;
  readonly pinInstances: number;
  readonly uniqueExplicitNetCandidates: number;
  readonly conflictingExplicitNetCandidates: number;
  readonly pinsOnUnlabeledWire: number;
  readonly pinsWithDeclaredNoConnect: number;
  readonly pinsWithDeclaredNoConnectAndWireContact: number;
  readonly pinsWithNoConnectDeclarationConflict: number;
  readonly pinsWithInvalidNoConnectDeclaration: number;
  readonly pinsWithoutWire: number;
  readonly endpointKinds: Readonly<Record<IrPinEndpointKind, number>>;
}

export interface PinInstanceCompilationResult {
  readonly pinInstances: readonly IrPinInstance[];
  readonly unresolvedOverrides: readonly ComponentPinOverrideCandidate[];
  readonly summary: PinInstanceCompilationSummary;
}

export interface ComponentPinOverrideCandidate {
  readonly pageId: string;
  readonly componentId: string;
  readonly symbolPinId: string;
  readonly parentId: string;
  readonly attribute: IrAttribute;
}

interface WireSegmentReference {
  readonly wire: IrWire;
  readonly segment: IrWireSegment;
}

interface ConnectedWireComponent {
  readonly wireIds: readonly string[];
  readonly segmentIds: readonly string[];
  readonly unlabeledWireIds: readonly string[];
  readonly explicitNetNames: readonly string[];
}

function wireKey(pageId: string, wireId: string): string {
  return `${pageId}\n${wireId}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeAngle(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeFloat(value: number): number {
  if (Object.is(value, -0)) {
    return 0;
  }
  const rounded = Number(value.toFixed(FLOAT_PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 真实 .epro2 + 官方 .enet v2 交叉验证的 V3 顺序：先绕符号原点顺时针旋转，
 * 再绕原点 Y 轴镜像，最后平移到组件位置。90 度倍数使用精确变换，
 * 避免三角函数误差。
 */
export function transformSymbolPoint(
  point: { readonly x: number; readonly y: number },
  component: Pick<IrComponent, "position" | "rotation" | "mirrored">
): { readonly x: number; readonly y: number } {
  const angle = normalizeAngle(component.rotation);
  let rotated: { x: number; y: number };
  if (angle === 0) {
    rotated = { x: point.x, y: point.y };
  } else if (angle === 90) {
    rotated = { x: point.y, y: -point.x };
  } else if (angle === 180) {
    rotated = { x: -point.x, y: -point.y };
  } else if (angle === 270) {
    rotated = { x: -point.y, y: point.x };
  } else {
    const radians = (angle * Math.PI) / 180;
    rotated = {
      x: point.x * Math.cos(radians) + point.y * Math.sin(radians),
      y: -point.x * Math.sin(radians) + point.y * Math.cos(radians)
    };
  }
  const transformedX = component.mirrored ? -rotated.x : rotated.x;
  return {
    x: normalizeFloat(transformedX + component.position.x),
    y: normalizeFloat(rotated.y + component.position.y)
  };
}

export function isPointOnSegment(
  point: { readonly x: number; readonly y: number },
  segment: Pick<IrWireSegment, "start" | "end">
): boolean {
  const deltaX = segment.end.x - segment.start.x;
  const deltaY = segment.end.y - segment.start.y;
  const cross =
    (point.x - segment.start.x) * deltaY -
    (point.y - segment.start.y) * deltaX;
  const scale = Math.max(1, Math.abs(deltaX), Math.abs(deltaY));
  if (Math.abs(cross) > GEOMETRY_EPSILON * scale) {
    return false;
  }
  return (
    point.x >= Math.min(segment.start.x, segment.end.x) - GEOMETRY_EPSILON &&
    point.x <= Math.max(segment.start.x, segment.end.x) + GEOMETRY_EPSILON &&
    point.y >= Math.min(segment.start.y, segment.end.y) - GEOMETRY_EPSILON &&
    point.y <= Math.max(segment.start.y, segment.end.y) + GEOMETRY_EPSILON
  );
}

function groupPins(
  pins: readonly IrSymbolPin[]
): ReadonlyMap<string, readonly IrSymbolPin[]> {
  const groups = new Map<string, IrSymbolPin[]>();
  for (const pin of pins) {
    const key = `${pin.symbolId}\n${pin.partId}`;
    const group = groups.get(key) ?? [];
    group.push(pin);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => compareText(left.id, right.id));
  }
  return groups;
}

function groupSegments(
  wires: readonly IrWire[]
): ReadonlyMap<string, readonly WireSegmentReference[]> {
  const groups = new Map<string, WireSegmentReference[]>();
  for (const wire of wires) {
    const group = groups.get(wire.pageId) ?? [];
    for (const segment of wire.segments) {
      group.push({ wire, segment });
    }
    groups.set(wire.pageId, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        compareText(left.wire.id, right.wire.id) ||
        compareText(left.segment.id, right.segment.id)
    );
  }
  return groups;
}

function segmentsElectricallyMeet(
  left: Pick<IrWireSegment, "start" | "end">,
  right: Pick<IrWireSegment, "start" | "end">
): boolean {
  // 两条线仅在内部交叉时不连接；至少一条线的端点落在另一条线上，
  // 才构成端点连接或 T 形结点。
  return (
    isPointOnSegment(left.start, right) ||
    isPointOnSegment(left.end, right) ||
    isPointOnSegment(right.start, left) ||
    isPointOnSegment(right.end, left)
  );
}

function connectedWireComponents(
  wires: readonly IrWire[]
): ReadonlyMap<string, ConnectedWireComponent> {
  const result = new Map<string, ConnectedWireComponent>();
  const byPage = new Map<string, IrWire[]>();
  for (const wire of wires) {
    const group = byPage.get(wire.pageId) ?? [];
    group.push(wire);
    byPage.set(wire.pageId, group);
  }
  for (const pageWires of byPage.values()) {
    pageWires.sort((left, right) => compareText(left.id, right.id));
    const parents = pageWires.map((_, index) => index);
    const find = (value: number): number => {
      let root = value;
      while (parents[root] !== root) root = parents[root] as number;
      while (parents[value] !== value) {
        const next = parents[value] as number;
        parents[value] = root;
        value = next;
      }
      return root;
    };
    const union = (left: number, right: number): void => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) {
        parents[Math.max(leftRoot, rightRoot)] = Math.min(
          leftRoot,
          rightRoot
        );
      }
    };
    for (let leftIndex = 0; leftIndex < pageWires.length; leftIndex += 1) {
      const left = pageWires[leftIndex] as IrWire;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < pageWires.length;
        rightIndex += 1
      ) {
        const right = pageWires[rightIndex] as IrWire;
        if (
          left.segments.some((leftSegment) =>
            right.segments.some((rightSegment) =>
              segmentsElectricallyMeet(leftSegment, rightSegment)
            )
          )
        ) {
          union(leftIndex, rightIndex);
        }
      }
    }
    const groups = new Map<number, IrWire[]>();
    for (let index = 0; index < pageWires.length; index += 1) {
      const root = find(index);
      const group = groups.get(root) ?? [];
      group.push(pageWires[index] as IrWire);
      groups.set(root, group);
    }
    for (const group of groups.values()) {
      const wireIds = group.map((wire) => wire.id).sort(compareText);
      const segmentIds = group
        .flatMap((wire) => wire.segments.map((segment) => segment.id))
        .sort(compareText);
      const unlabeledWireIds = group
        .filter((wire) => wire.explicitNetName === undefined)
        .map((wire) => wire.id)
        .sort(compareText);
      const explicitNetNames = [
        ...new Set(
          group
            .map((wire) => wire.explicitNetName)
            .filter((name): name is string => name !== undefined)
        )
      ].sort(compareText);
      const component = {
        wireIds,
        segmentIds,
        unlabeledWireIds,
        explicitNetNames
      };
      for (const wire of group) {
        result.set(wireKey(wire.pageId, wire.id), component);
      }
    }
  }
  return result;
}

function explicitNetCandidates(
  contacts: readonly WireSegmentReference[],
  connectedByWire: ReadonlyMap<string, ConnectedWireComponent>
): readonly IrPinExplicitNetCandidate[] {
  const groups = new Map<
    string,
    { readonly wireIds: Set<string>; readonly segmentIds: Set<string> }
  >();
  const contactedComponents = new Set<ConnectedWireComponent>();
  for (const contact of contacts) {
    const component = connectedByWire.get(
      wireKey(contact.wire.pageId, contact.wire.id)
    );
    if (component !== undefined) contactedComponents.add(component);
  }
  for (const component of contactedComponents) {
    const directlyContactedWires = contacts
      .map((contact) => contact.wire)
      .filter((wire) => component.wireIds.includes(wire.id));
    const candidates =
      component.explicitNetNames.length === 1
        ? [
            {
              netName: component.explicitNetNames[0] as string,
              wireIds: component.wireIds,
              segmentIds: component.segmentIds
            }
          ]
        : directlyContactedWires
            .filter(
              (
                wire
              ): wire is IrWire & { readonly explicitNetName: string } =>
                wire.explicitNetName !== undefined
            )
            .map((wire) => ({
              netName: wire.explicitNetName,
              wireIds: [wire.id],
              segmentIds: wire.segments.map((segment) => segment.id)
            }));
    for (const candidate of candidates) {
      const netName = candidate.netName;
      const group = groups.get(netName) ?? {
        wireIds: new Set<string>(),
        segmentIds: new Set<string>()
      };
      for (const wireId of candidate.wireIds) group.wireIds.add(wireId);
      for (const segmentId of candidate.segmentIds) {
        group.segmentIds.add(segmentId);
      }
      groups.set(netName, group);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([netName, group]) => ({
      netName,
      wireIds: [...group.wireIds].sort(compareText),
      segmentIds: [...group.segmentIds].sort(compareText)
    }));
}

function noConnectDeclaration(
  attributes: readonly IrAttribute[]
): IrPinNoConnectDeclaration | undefined {
  const evidence = attributes
    .filter((attribute) => attribute.key === "NO_CONNECT")
    .sort((left, right) => compareText(left.id, right.id));
  if (evidence.length === 0) {
    return undefined;
  }
  const values = evidence.map((attribute) => {
    if (attribute.value === true || attribute.value === "yes") return true;
    if (attribute.value === false || attribute.value === "no") return false;
    return undefined;
  });
  const validValues = new Set(
    values.filter((value): value is boolean => value !== undefined)
  );
  let state: IrPinNoConnectDeclaration["state"];
  if (values.some((value) => value === undefined)) {
    state = "INVALID_DECLARATION";
  } else if (validValues.size !== 1) {
    state = "CONFLICTING_DECLARATION";
  } else {
    state = validValues.has(true)
      ? "DECLARED_NO_CONNECT"
      : "DECLARED_CONNECTABLE";
  }
  return {
    state,
    basis: "COMPONENT_PIN_OVERRIDE_NO_CONNECT_ATTRIBUTE",
    evidence
  };
}

export function pinEndpointKind(
  symbolType: number | undefined
): IrPinEndpointKind {
  switch (symbolType) {
    case 2:
      return "PART_SYMBOL_PIN";
    case 17:
      return "BLOCK_SYMBOL_PIN";
    case 18:
      return "NET_FLAG_PIN";
    case 19:
      return "NET_PORT_PIN";
    case 20:
      return "SHEET_SYMBOL_PIN";
    case 21:
      return "NONELECTRICAL_SYMBOL_PIN";
    case 22:
      return "SHORT_SYMBOL_PIN";
    default:
      return "UNKNOWN_SYMBOL_PIN";
  }
}

function emptyEndpointCounts(): Record<IrPinEndpointKind, number> {
  return {
    PART_SYMBOL_PIN: 0,
    BLOCK_SYMBOL_PIN: 0,
    NET_FLAG_PIN: 0,
    NET_PORT_PIN: 0,
    SHEET_SYMBOL_PIN: 0,
    NONELECTRICAL_SYMBOL_PIN: 0,
    SHORT_SYMBOL_PIN: 0,
    UNKNOWN_SYMBOL_PIN: 0
  };
}

export function compilePinInstances(
  components: readonly IrComponent[],
  symbols: readonly IrSymbol[],
  symbolPins: readonly IrSymbolPin[],
  wires: readonly IrWire[],
  componentPinOverrides: readonly ComponentPinOverrideCandidate[] = []
): PinInstanceCompilationResult {
  const pinsBySymbolAndPart = groupPins(symbolPins);
  const segmentsByPage = groupSegments(wires);
  const connectedByWire = connectedWireComponents(wires);
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const pinInstances: IrPinInstance[] = [];
  const overridesByPin = new Map<string, ComponentPinOverrideCandidate[]>();
  for (const override of componentPinOverrides) {
    const key = `${override.pageId}\n${override.componentId}\n${override.symbolPinId}`;
    const group = overridesByPin.get(key) ?? [];
    group.push(override);
    overridesByPin.set(key, group);
  }
  for (const group of overridesByPin.values()) {
    group.sort((left, right) => compareText(left.attribute.id, right.attribute.id));
  }
  const consumedOverrides = new Set<ComponentPinOverrideCandidate>();
  let componentsWithoutSymbolReference = 0;
  let componentsWithUnknownSymbol = 0;
  let componentsWithUnknownSymbolPart = 0;
  let uniqueExplicitNetCandidates = 0;
  let conflictingExplicitNetCandidates = 0;
  let pinsOnUnlabeledWire = 0;
  let pinsWithDeclaredNoConnect = 0;
  let pinsWithDeclaredNoConnectAndWireContact = 0;
  let pinsWithNoConnectDeclarationConflict = 0;
  let pinsWithInvalidNoConnectDeclaration = 0;
  let pinsWithoutWire = 0;
  const endpointKinds = emptyEndpointCounts();

  for (const component of components) {
    if (component.symbolId === undefined) {
      componentsWithoutSymbolReference += 1;
      continue;
    }
    const symbol = symbolsById.get(component.symbolId);
    if (symbol === undefined) {
      componentsWithUnknownSymbol += 1;
      continue;
    }
    const pins = pinsBySymbolAndPart.get(
      `${component.symbolId}\n${component.partId}`
    );
    if (pins === undefined) {
      componentsWithUnknownSymbolPart += 1;
      continue;
    }
    const pageSegments = segmentsByPage.get(component.pageId) ?? [];
    const endpointKind = pinEndpointKind(symbol.symbolType);
    for (const pin of pins) {
      const overrideCandidates =
        overridesByPin.get(
          `${component.pageId}\n${component.id}\n${pin.id}`
        ) ?? [];
      const instanceAttributes = overrideCandidates.map(
        (override) => override.attribute
      );
      for (const override of overrideCandidates) {
        consumedOverrides.add(override);
      }
      const noConnect = noConnectDeclaration(instanceAttributes);
      if (noConnect?.state === "DECLARED_NO_CONNECT") {
        pinsWithDeclaredNoConnect += 1;
      } else if (noConnect?.state === "CONFLICTING_DECLARATION") {
        pinsWithNoConnectDeclarationConflict += 1;
      } else if (noConnect?.state === "INVALID_DECLARATION") {
        pinsWithInvalidNoConnectDeclaration += 1;
      }
      const connectionPoint = transformSymbolPoint(pin.position, component);
      const contacts = pageSegments.filter((reference) =>
        isPointOnSegment(connectionPoint, reference.segment)
      );
      if (
        noConnect?.state === "DECLARED_NO_CONNECT" &&
        contacts.length > 0
      ) {
        pinsWithDeclaredNoConnectAndWireContact += 1;
      }
      const contactedComponents = [
        ...new Set(
          contacts
            .map((contact) =>
              connectedByWire.get(
                wireKey(contact.wire.pageId, contact.wire.id)
              )
            )
            .filter(
              (component): component is ConnectedWireComponent =>
                component !== undefined
            )
        )
      ];
      const explicitNets = explicitNetCandidates(contacts, connectedByWire);
      const unlabeledWireIds = [
        ...new Set(
          contactedComponents.flatMap(
            (component) => component.unlabeledWireIds
          )
        )
      ].sort(compareText);
      let status: IrPinInstance["connectionCandidate"]["status"];
      if (explicitNets.length === 1) {
        status = "UNIQUE_EXPLICIT_NET_CANDIDATE";
        uniqueExplicitNetCandidates += 1;
      } else if (explicitNets.length > 1) {
        status = "CONFLICTING_EXPLICIT_NET_CANDIDATES";
        conflictingExplicitNetCandidates += 1;
      } else if (contacts.length > 0) {
        status = "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET";
        pinsOnUnlabeledWire += 1;
      } else if (noConnect?.state === "DECLARED_NO_CONNECT") {
        status = "DECLARED_NO_CONNECT";
      } else {
        status = "UNRESOLVED_NO_WIRE";
        pinsWithoutWire += 1;
      }
      endpointKinds[endpointKind] += 1;
      pinInstances.push({
        id: sha256CanonicalJson([
          component.pageId,
          component.id,
          component.symbolId,
          pin.id
        ]),
        pageId: component.pageId,
        componentId: component.id,
        symbolId: component.symbolId,
        symbolPinId: pin.id,
        partId: component.partId,
        endpointKind,
        ...(symbol.symbolType === undefined
          ? {}
          : { symbolType: symbol.symbolType }),
        ...(component.designator === undefined
          ? {}
          : { designator: component.designator }),
        ...(pin.name === undefined ? {} : { name: pin.name }),
        ...(pin.number === undefined ? {} : { number: pin.number }),
        ...(pin.electricalType === undefined
          ? {}
          : { electricalType: pin.electricalType }),
        ...(pin.pinShape === undefined ? {} : { pinShape: pin.pinShape }),
        instanceAttributes,
        ...(noConnect === undefined ? {} : { noConnectDeclaration: noConnect }),
        connectionPoint,
        connectionCandidate: {
          status,
          basis:
            status === "DECLARED_NO_CONNECT"
              ? "COMPONENT_PIN_OVERRIDE_NO_CONNECT_ATTRIBUTE"
              : contactedComponents.some((component) =>
                    component.wireIds.some(
                      (wireId) =>
                        !contacts.some(
                          (contact) => contact.wire.id === wireId
                        )
                    )
                  )
                ? "TRANSFORMED_PIN_POINT_ON_CONNECTED_WIRE_COMPONENT"
                : "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
          electricalTruth: "NOT_VERIFIED",
          explicitNets,
          unlabeledWireIds
        },
        provenance: {
          component: component.provenance,
          symbol: symbol.provenance,
          symbolPin: pin.provenance
        }
      });
    }
  }

  pinInstances.sort(
    (left, right) =>
      compareText(left.pageId, right.pageId) ||
      compareText(left.componentId, right.componentId) ||
      compareText(left.symbolPinId, right.symbolPinId)
  );
  return {
    pinInstances,
    unresolvedOverrides: componentPinOverrides.filter(
      (override) => !consumedOverrides.has(override)
    ),
    summary: {
      componentsWithoutSymbolReference,
      componentsWithUnknownSymbol,
      componentsWithUnknownSymbolPart,
      pinInstances: pinInstances.length,
      uniqueExplicitNetCandidates,
      conflictingExplicitNetCandidates,
      pinsOnUnlabeledWire,
      pinsWithDeclaredNoConnect,
      pinsWithDeclaredNoConnectAndWireContact,
      pinsWithNoConnectDeclarationConflict,
      pinsWithInvalidNoConnectDeclaration,
      pinsWithoutWire,
      endpointKinds
    }
  };
}
