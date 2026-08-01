import assert from "node:assert/strict";
import test from "node:test";
import { parseInstancePath } from "../../src/v3/instance-path.js";

test("解析官方 INSTANCE 顶层与嵌套路径并保留页号前导零", () => {
  assert.deepEqual(parseInstancePath("sch-1_$01"), {
    status: "VALID",
    path: {
      encoding: "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID",
      schematicId: "sch-1",
      blockPath: [],
      terminalPageReference: "01",
      terminalSheetNumber: "01"
    }
  });
  assert.deepEqual(parseInstancePath("sch-1_$5|e100_$1|e55_$6|e15_$08"), {
    status: "VALID",
    path: {
      encoding: "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID",
      schematicId: "sch-1",
      blockPath: [
        {
          pageReference: "5",
          sheetNumber: "5",
          blockSymbolId: "e100"
        },
        {
          pageReference: "1",
          sheetNumber: "1",
          blockSymbolId: "e55"
        },
        {
          pageReference: "6",
          sheetNumber: "6",
          blockSymbolId: "e15"
        }
      ],
      terminalPageReference: "08",
      terminalSheetNumber: "08"
    }
  });
});

test("解析当前真实导出的 pageId~blockId INSTANCE 路径", () => {
  assert.deepEqual(
    parseInstancePath("sch-1_$page-a~e100_$page-b~e55_$page-c"),
    {
      status: "VALID",
      path: {
        encoding: "OBSERVED_PAGE_ID_TILDE_BLOCK_ID",
        schematicId: "sch-1",
        blockPath: [
          {
            pageReference: "page-a",
            pageId: "page-a",
            blockSymbolId: "e100"
          },
          {
            pageReference: "page-b",
            pageId: "page-b",
            blockSymbolId: "e55"
          }
        ],
        terminalPageReference: "page-c",
        terminalPageId: "page-c"
      }
    }
  );
});

test("拒绝不完整、含空标识或非官方分隔结构的 INSTANCE 路径", () => {
  assert.deepEqual(parseInstancePath("sch-1"), {
    status: "INVALID",
    reason: "TOO_FEW_SEGMENTS"
  });
  assert.deepEqual(parseInstancePath("_$1"), {
    status: "INVALID",
    reason: "SCHEMATIC_ID_EMPTY"
  });
  assert.deepEqual(parseInstancePath("sch-1_$x|e1_$2"), {
    status: "INVALID",
    reason: "BLOCK_SEGMENT_INVALID"
  });
  assert.deepEqual(parseInstancePath("sch-1_$1|e1_$x"), {
    status: "INVALID",
    reason: "MIXED_ENCODINGS"
  });
  assert.deepEqual(parseInstancePath("sch-1_$1|e1_$page~e2_$2"), {
    status: "INVALID",
    reason: "MIXED_ENCODINGS"
  });
});
