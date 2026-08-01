import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  IrComponent,
  IrComponentOccurrence,
  IrDevice,
  IrDocumentHeaderProvenance,
  IrEffectiveAttribute,
  IrInstanceAttributeOverride,
  IrInstanceBlockPathSegment,
  IrInstanceContext,
  IrPinInstance,
  IrRecordProvenance,
  IrSchematic,
  IrSchematicPage,
  IrSymbol,
  JsonObject,
  JsonValue
} from "../ir/model.js";
import type {
  InstanceBlockPathSegment,
  InstancePathEncoding
} from "../v3/instance-path.js";

export interface RawInstanceAttributeOverride {
  readonly targetPrimitiveId: string;
  readonly attributes: JsonObject;
  readonly provenance: IrRecordProvenance;
  readonly extensions: IrInstanceAttributeOverride["extensions"];
}

export interface RawInstanceContext {
  readonly id: string;
  readonly pathEncoding: InstancePathEncoding;
  readonly schematicId: string;
  readonly blockPath: readonly InstanceBlockPathSegment[];
  readonly terminalPageReference: string;
  readonly terminalSheetNumber?: string;
  readonly terminalPageId?: string;
  readonly overrides: readonly RawInstanceAttributeOverride[];
  readonly provenance: readonly IrDocumentHeaderProvenance[];
}

export interface InstanceContextResolutionSummary {
  readonly resolvedContexts: number;
  readonly unresolvedContexts: number;
  readonly appliedComponentOverrides: number;
  readonly appliedPinOverrides: number;
  readonly unresolvedOverrides: number;
  readonly componentOccurrences: number;
  readonly statusCounts: Readonly<Record<string, number>>;
}

export interface InstanceContextResolutionResult {
  readonly contexts: readonly IrInstanceContext[];
  readonly occurrences: readonly IrComponentOccurrence[];
  readonly summary: InstanceContextResolutionSummary;
}

interface PageResolution {
  readonly status:
    | "RESOLVED_EXACT"
    | "NOT_FOUND"
    | "AMBIGUOUS"
    | "SCHEMATIC_MISMATCH";
  readonly pageId?: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function resolvePage(
  reference: string,
  encoding: InstancePathEncoding,
  expectedSchematicId: string | undefined,
  pages: readonly IrSchematicPage[]
): PageResolution {
  // 官方 INSTANCE 文档把 `$N` 定义为原理图页号；V3 SCH_PAGE META 的
  // `sort` 是同一导出格式中唯一明确、稳定的页序号字段。现场导出的
  // `$pageId` 则保持为显式 ID，两个命名空间不能混用或互相兜底。
  const officialSheetNumber =
    encoding === "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
      ? Number(reference)
      : undefined;
  const rawCandidates =
    encoding === "OBSERVED_PAGE_ID_TILDE_BLOCK_ID"
      ? pages.filter((page) => page.id === reference)
      : officialSheetNumber !== undefined &&
          Number.isSafeInteger(officialSheetNumber)
        ? pages.filter((page) => page.sortOrder === officialSheetNumber)
        : [];
  if (rawCandidates.length === 0) return { status: "NOT_FOUND" };
  const candidates =
    expectedSchematicId === undefined
      ? rawCandidates
      : rawCandidates.filter(
          (page) => page.schematicId === expectedSchematicId
        );
  if (candidates.length === 0) return { status: "SCHEMATIC_MISMATCH" };
  if (candidates.length > 1) return { status: "AMBIGUOUS" };
  return {
    status: "RESOLVED_EXACT",
    pageId: (candidates[0] as IrSchematicPage).id
  };
}

function contextPageStatus(
  resolution: PageResolution,
  terminal: boolean
): IrInstanceContext["resolutionStatus"] | undefined {
  if (resolution.status === "RESOLVED_EXACT") return undefined;
  if (terminal) {
    if (resolution.status === "NOT_FOUND") return "TERMINAL_PAGE_NOT_FOUND";
    if (resolution.status === "AMBIGUOUS") {
      return "TERMINAL_PAGE_AMBIGUOUS";
    }
    return "TERMINAL_PAGE_SCHEMATIC_MISMATCH";
  }
  if (resolution.status === "NOT_FOUND") return "SOURCE_PAGE_NOT_FOUND";
  if (resolution.status === "AMBIGUOUS") return "SOURCE_PAGE_AMBIGUOUS";
  return "SOURCE_PAGE_SCHEMATIC_MISMATCH";
}

function segmentPageStatus(
  resolution: PageResolution,
  target: boolean
): IrInstanceBlockPathSegment["resolutionStatus"] {
  if (resolution.status === "RESOLVED_EXACT") return "RESOLVED_EXACT";
  if (target) {
    if (resolution.status === "NOT_FOUND") return "TARGET_PAGE_NOT_FOUND";
    if (resolution.status === "AMBIGUOUS") return "TARGET_PAGE_AMBIGUOUS";
    return "TARGET_PAGE_SCHEMATIC_MISMATCH";
  }
  if (resolution.status === "NOT_FOUND") return "SOURCE_PAGE_NOT_FOUND";
  if (resolution.status === "AMBIGUOUS") return "SOURCE_PAGE_AMBIGUOUS";
  return "SOURCE_PAGE_SCHEMATIC_MISMATCH";
}

function uniqueValues(values: readonly JsonValue[]): readonly JsonValue[] {
  return [
    ...new Map(values.map((value) => [canonicalJson(value), value])).values()
  ];
}

function effectiveAttributes(
  component: IrComponent,
  device: IrDevice | undefined,
  overrides: readonly IrInstanceAttributeOverride[]
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

function resolveContext(
  raw: RawInstanceContext,
  inputs: {
    readonly schematics: readonly IrSchematic[];
    readonly pages: readonly IrSchematicPage[];
    readonly components: readonly IrComponent[];
    readonly symbols: readonly IrSymbol[];
    readonly pinInstances: readonly IrPinInstance[];
  }
): IrInstanceContext {
  if (!inputs.schematics.some((schematic) => schematic.id === raw.schematicId)) {
    return {
      ...raw,
      blockPath: raw.blockPath.map((segment) => ({
        pageReference: segment.pageReference,
        blockSymbolId: segment.blockSymbolId,
        ...(segment.sheetNumber === undefined
          ? {}
          : { sheetNumber: segment.sheetNumber }),
        resolutionStatus: "SOURCE_PAGE_NOT_FOUND" as const
      })),
      resolutionStatus: "SCHEMATIC_NOT_FOUND",
      overrides: raw.overrides.map((override) => ({
        ...override,
        applicationStatus: "CONTEXT_NOT_RESOLVED" as const
      }))
    };
  }

  const officialEncoding =
    raw.pathEncoding === "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID";
  const sourcePages = raw.blockPath.map((segment, index) =>
    resolvePage(
      segment.pageReference,
      raw.pathEncoding,
      officialEncoding || index === 0 ? raw.schematicId : undefined,
      inputs.pages
    )
  );
  const terminal = resolvePage(
    raw.terminalPageReference,
    raw.pathEncoding,
    officialEncoding || raw.blockPath.length === 0
      ? raw.schematicId
      : undefined,
    inputs.pages
  );
  let contextStatus = contextPageStatus(terminal, true);
  for (const sourcePage of sourcePages) {
    contextStatus ??= contextPageStatus(sourcePage, false);
  }

  const resolvedPageIds = [
    ...sourcePages.flatMap((page) =>
      page.pageId === undefined ? [] : [page.pageId]
    ),
    ...(terminal.pageId === undefined ? [] : [terminal.pageId])
  ];
  if (new Set(resolvedPageIds).size !== resolvedPageIds.length) {
    contextStatus = "PAGE_CYCLE_DETECTED";
  }

  const blockPath: IrInstanceBlockPathSegment[] = raw.blockPath.map(
    (rawSegment, index) => {
      const source = sourcePages[index] as PageResolution;
      const target =
        index + 1 < sourcePages.length
          ? (sourcePages[index + 1] as PageResolution)
          : terminal;
      let status = segmentPageStatus(source, false);
      if (status === "RESOLVED_EXACT") {
        status = segmentPageStatus(target, true);
      }
      if (
        status === "RESOLVED_EXACT" &&
        source.pageId !== undefined
      ) {
        const components = inputs.components.filter(
          (component) =>
            component.pageId === source.pageId &&
            component.id === rawSegment.blockSymbolId
        );
        if (components.length === 0) {
          status = "BLOCK_COMPONENT_NOT_FOUND";
        } else if (components.length > 1) {
          status = "BLOCK_COMPONENT_AMBIGUOUS";
        } else {
          const component = components[0] as IrComponent;
          const symbol = inputs.symbols.find(
            (candidate) => candidate.id === component.symbolId
          );
          if (component.symbolId === undefined || symbol === undefined) {
            status = "BLOCK_SYMBOL_REFERENCE_UNRESOLVED";
          } else if (symbol.symbolType !== 17) {
            status = "BLOCK_SYMBOL_TYPE_MISMATCH";
          }
        }
      }
      if (contextStatus === "PAGE_CYCLE_DETECTED") {
        status = "PAGE_CYCLE_DETECTED";
      }
      if (contextStatus === undefined && status !== "RESOLVED_EXACT") {
        if (status === "TARGET_PAGE_NOT_FOUND") {
          contextStatus =
            index + 1 === raw.blockPath.length
              ? "TERMINAL_PAGE_NOT_FOUND"
              : "SOURCE_PAGE_NOT_FOUND";
        } else if (status === "TARGET_PAGE_AMBIGUOUS") {
          contextStatus =
            index + 1 === raw.blockPath.length
              ? "TERMINAL_PAGE_AMBIGUOUS"
              : "SOURCE_PAGE_AMBIGUOUS";
        } else if (status === "TARGET_PAGE_SCHEMATIC_MISMATCH") {
          contextStatus =
            index + 1 === raw.blockPath.length
              ? "TERMINAL_PAGE_SCHEMATIC_MISMATCH"
              : "SOURCE_PAGE_SCHEMATIC_MISMATCH";
        } else {
          contextStatus = status;
        }
      }
      return {
        pageReference: rawSegment.pageReference,
        blockSymbolId: rawSegment.blockSymbolId,
        ...(rawSegment.sheetNumber === undefined
          ? {}
          : { sheetNumber: rawSegment.sheetNumber }),
        ...(source.pageId === undefined ? {} : { sourcePageId: source.pageId }),
        ...(target.pageId === undefined ? {} : { targetPageId: target.pageId }),
        resolutionStatus: status
      };
    }
  );

  const resolutionStatus = contextStatus ?? "RESOLVED_EXACT";
  const terminalPageId = terminal.pageId;
  const overrides: IrInstanceAttributeOverride[] = raw.overrides.map(
    (override) => {
      if (resolutionStatus !== "RESOLVED_EXACT" || terminalPageId === undefined) {
        return {
          ...override,
          applicationStatus: "CONTEXT_NOT_RESOLVED"
        };
      }
      const components = inputs.components.filter(
        (component) =>
          component.pageId === terminalPageId &&
          component.id === override.targetPrimitiveId
      );
      const pins = inputs.pinInstances.filter(
        (pin) =>
          pin.pageId === terminalPageId &&
          `${pin.componentId}${pin.symbolPinId}` === override.targetPrimitiveId
      );
      if (components.length + pins.length > 1) {
        return { ...override, applicationStatus: "TARGET_AMBIGUOUS" };
      }
      if (components.length === 1) {
        const component = components[0] as IrComponent;
        return {
          ...override,
          applicationStatus: "APPLIED_COMPONENT_OCCURRENCE",
          resolvedTarget: {
            kind: "COMPONENT",
            pageId: terminalPageId,
            componentId: component.id
          }
        };
      }
      if (pins.length === 1) {
        const pin = pins[0] as IrPinInstance;
        return {
          ...override,
          applicationStatus: "APPLIED_PIN_OCCURRENCE",
          resolvedTarget: {
            kind: "PIN",
            pageId: terminalPageId,
            componentId: pin.componentId,
            symbolPinId: pin.symbolPinId
          }
        };
      }
      const hasComponentPrefix = inputs.components.some(
        (component) =>
          component.pageId === terminalPageId &&
          override.targetPrimitiveId.startsWith(component.id)
      );
      return {
        ...override,
        applicationStatus: hasComponentPrefix
          ? "TARGET_PIN_NOT_FOUND"
          : "TARGET_NOT_FOUND"
      };
    }
  );

  return {
    id: raw.id,
    pathEncoding: raw.pathEncoding,
    schematicId: raw.schematicId,
    blockPath,
    terminalPageReference: raw.terminalPageReference,
    ...(raw.terminalSheetNumber === undefined
      ? {}
      : { terminalSheetNumber: raw.terminalSheetNumber }),
    ...(terminalPageId === undefined ? {} : { terminalPageId }),
    resolutionStatus,
    overrides,
    provenance: raw.provenance
  };
}

function buildOccurrences(
  contexts: readonly IrInstanceContext[],
  components: readonly IrComponent[],
  devices: readonly IrDevice[]
): readonly IrComponentOccurrence[] {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const occurrences: IrComponentOccurrence[] = [];
  for (const context of contexts) {
    if (
      context.resolutionStatus !== "RESOLVED_EXACT" ||
      context.terminalPageId === undefined
    ) {
      continue;
    }
    for (const component of components.filter(
      (candidate) => candidate.pageId === context.terminalPageId
    )) {
      const componentOverrides = context.overrides.filter(
        (override) =>
          override.applicationStatus === "APPLIED_COMPONENT_OCCURRENCE" &&
          override.resolvedTarget?.kind === "COMPONENT" &&
          override.resolvedTarget.componentId === component.id
      );
      const pinOverrides = context.overrides
        .filter(
          (override) =>
            override.applicationStatus === "APPLIED_PIN_OCCURRENCE" &&
            override.resolvedTarget?.kind === "PIN" &&
            override.resolvedTarget.componentId === component.id
        )
        .map((override) => ({
          symbolPinId:
            override.resolvedTarget?.kind === "PIN"
              ? override.resolvedTarget.symbolPinId
              : "",
          attributes: override.attributes,
          provenance: override.provenance
        }))
        .sort((left, right) => compareText(left.symbolPinId, right.symbolPinId));
      const attributes = effectiveAttributes(
        component,
        component.deviceId === undefined
          ? undefined
          : devicesById.get(component.deviceId),
        componentOverrides
      );
      const effectiveDesignator = attributes.find(
        (attribute) =>
          attribute.key === "Designator" &&
          attribute.values.length === 1 &&
          typeof attribute.values[0] === "string" &&
          attribute.values[0].length > 0
      )?.values[0];
      occurrences.push({
        id: sha256CanonicalJson([
          context.id,
          context.terminalPageId,
          component.id
        ]),
        instanceContextId: context.id,
        schematicId: context.schematicId,
        pageId: context.terminalPageId,
        componentId: component.id,
        ...(typeof effectiveDesignator === "string"
          ? { designator: effectiveDesignator }
          : component.designator === undefined
            ? {}
            : { designator: component.designator }),
        attributes,
        pinOverrides,
        populationStatus: "BASE_DESIGN",
        pathTruth: "EXPLICIT_INSTANCE_DOCUMENT_RESOLVED",
        electricalTruth: "NOT_VERIFIED"
      });
    }
  }
  return occurrences.sort(
    (left, right) =>
      compareText(left.instanceContextId, right.instanceContextId) ||
      compareText(left.designator ?? "", right.designator ?? "") ||
      compareText(left.componentId, right.componentId)
  );
}

export function resolveInstanceContexts(
  rawContexts: readonly RawInstanceContext[],
  inputs: {
    readonly schematics: readonly IrSchematic[];
    readonly pages: readonly IrSchematicPage[];
    readonly components: readonly IrComponent[];
    readonly symbols: readonly IrSymbol[];
    readonly pinInstances: readonly IrPinInstance[];
    readonly devices: readonly IrDevice[];
  }
): InstanceContextResolutionResult {
  const contexts = rawContexts
    .map((context) => resolveContext(context, inputs))
    .sort((left, right) => compareText(left.id, right.id));
  const occurrences = buildOccurrences(
    contexts,
    inputs.components,
    inputs.devices
  );
  const overrides = contexts.flatMap((context) => context.overrides);
  const statusCounts = new Map<string, number>();
  for (const context of contexts) increment(statusCounts, context.resolutionStatus);
  return {
    contexts,
    occurrences,
    summary: {
      resolvedContexts: contexts.filter(
        (context) => context.resolutionStatus === "RESOLVED_EXACT"
      ).length,
      unresolvedContexts: contexts.filter(
        (context) => context.resolutionStatus !== "RESOLVED_EXACT"
      ).length,
      appliedComponentOverrides: overrides.filter(
        (override) =>
          override.applicationStatus === "APPLIED_COMPONENT_OCCURRENCE"
      ).length,
      appliedPinOverrides: overrides.filter(
        (override) => override.applicationStatus === "APPLIED_PIN_OCCURRENCE"
      ).length,
      unresolvedOverrides: overrides.filter(
        (override) =>
          override.applicationStatus !== "APPLIED_COMPONENT_OCCURRENCE" &&
          override.applicationStatus !== "APPLIED_PIN_OCCURRENCE"
      ).length,
      componentOccurrences: occurrences.length,
      statusCounts: Object.fromEntries(
        [...statusCounts.entries()].sort(([left], [right]) =>
          compareText(left, right)
        )
      )
    }
  };
}
