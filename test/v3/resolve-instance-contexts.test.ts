import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveInstanceContexts,
  type RawInstanceContext
} from "../../src/hierarchy/resolve-instance-contexts.js";
import type {
  IrComponent,
  IrRecordProvenance,
  IrSchematicPage,
  IrSymbol
} from "../../src/ir/model.js";

const PROVENANCE: IrRecordProvenance = {
  documentId: "page-root",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  ticket: 1,
  client: "client",
  entry: "epru",
  line: 1
};

function page(id: string, sortOrder: number): IrSchematicPage {
  return {
    id,
    schematicId: "schematic-a",
    sortOrder,
    attributes: [],
    provenance: { ...PROVENANCE, documentId: id, recordType: "META" },
    extensions: { easyeda: {} }
  };
}

function component(
  id: string,
  pageId: string,
  symbolId: string,
  designator: string
): IrComponent {
  return {
    id,
    pageId,
    partId: "part-a",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirrored: false,
    designator,
    symbolId,
    symbolBinding: {
      key: "Symbol",
      state: "BOUND_COMPONENT_OVERRIDE",
      targetId: symbolId,
      componentAttributes: []
    },
    footprintBinding: {
      key: "Footprint",
      state: "UNRESOLVED_DEVICE_REFERENCE_MISSING",
      componentAttributes: []
    },
    attributes: [],
    provenance: {
      ...PROVENANCE,
      documentId: pageId,
      recordId: id
    },
    extensions: { easyeda: {} }
  };
}

function symbol(id: string, symbolType: number): IrSymbol {
  return {
    id,
    symbolType,
    attributes: [],
    provenance: {
      ...PROVENANCE,
      documentId: id,
      documentType: "SYMBOL",
      recordType: "META"
    },
    extensions: { easyeda: {} }
  };
}

test("官方页号 INSTANCE 编码解析到精确页面并应用组件覆盖", () => {
  const context: RawInstanceContext = {
    id: "schematic-a_$5|block-a_$01",
    pathEncoding: "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID",
    schematicId: "schematic-a",
    blockPath: [
      {
        pageReference: "5",
        sheetNumber: "5",
        blockSymbolId: "block-a"
      }
    ],
    terminalPageReference: "01",
    terminalSheetNumber: "01",
    overrides: [
      {
        targetPrimitiveId: "component-a",
        attributes: { Designator: "U1A" },
        provenance: {
          ...PROVENANCE,
          documentId: "schematic-a_$5|block-a_$01",
          documentType: "INSTANCE",
          recordType: "INSTANCE_ATTR",
          recordId: "component-a"
        },
        extensions: { easyeda: {} }
      }
    ],
    provenance: [{ client: "client", entry: "epru", line: 1 }]
  };
  const result = resolveInstanceContexts([context], {
    schematics: [
      {
        id: "schematic-a",
        provenance: {
          ...PROVENANCE,
          documentId: "schematic-a",
          documentType: "SCHEMATIC",
          recordType: "META"
        },
        extensions: { easyeda: {} }
      }
    ],
    pages: [page("page-root", 5), page("page-child", 1)],
    components: [
      component("block-a", "page-root", "block-symbol", "B1"),
      component("component-a", "page-child", "part-symbol", "U1")
    ],
    symbols: [symbol("block-symbol", 17), symbol("part-symbol", 2)],
    pinInstances: [],
    devices: []
  });

  assert.equal(result.contexts[0]?.resolutionStatus, "RESOLVED_EXACT");
  assert.equal(result.contexts[0]?.blockPath[0]?.sourcePageId, "page-root");
  assert.equal(result.contexts[0]?.terminalPageId, "page-child");
  assert.equal(
    result.contexts[0]?.overrides[0]?.applicationStatus,
    "APPLIED_COMPONENT_OCCURRENCE"
  );
  assert.equal(result.occurrences[0]?.designator, "U1A");
  assert.deepEqual(result.summary, {
    resolvedContexts: 1,
    unresolvedContexts: 0,
    appliedComponentOverrides: 1,
    appliedPinOverrides: 0,
    unresolvedOverrides: 0,
    componentOccurrences: 1,
    statusCounts: { RESOLVED_EXACT: 1 }
  });
});
