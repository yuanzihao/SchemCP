import assert from "node:assert/strict";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import type { V3Record } from "../../src/v3/record.js";
import { V3Reducer } from "../../src/v3/reducer.js";

const LIMITS = {
  maxReducedRecords: 100,
  maxReducedSourceBytes: 1024 * 1024
} as const;

function header(client: string, docType = "SCH_PAGE"): V3Record {
  return {
    outer: { type: "DOCHEAD" },
    inner: { uuid: "document-1", docType, client }
  };
}

function dataRecord(
  ticket: number,
  value: unknown,
  options: { readonly type?: string; readonly id?: string } = {}
): V3Record {
  return {
    outer: {
      type: options.type ?? "META",
      ticket,
      ...(options.id === undefined ? {} : { id: options.id })
    },
    inner: value === "" ? "" : { value }
  };
}

function source(line: number) {
  return { entry: "epru-1", line } as const;
}

test("较大 ticket 胜出且状态哈希不受输入顺序影响", () => {
  const forward = new V3Reducer(LIMITS);
  const forwardContext = forward.enterDocument(header("client-a"), source(1));
  forward.accept(forwardContext, dataRecord(1, "old"), source(2), 10);
  forward.accept(forwardContext, dataRecord(2, "new"), source(3), 10);

  const reverse = new V3Reducer(LIMITS);
  const reverseContext = reverse.enterDocument(header("client-a"), source(1));
  reverse.accept(reverseContext, dataRecord(2, "new"), source(2), 10);
  reverse.accept(reverseContext, dataRecord(1, "old"), source(3), 10);

  assert.deepEqual(forward.getSelectedRecord("document-1", "META")?.record.inner, {
    value: "new"
  });
  assert.equal(forward.summarize().replacedByHigherTicket, 1);
  assert.equal(reverse.summarize().ignoredOlderTicket, 1);
  assert.equal(forward.summarize().stateSha256, reverse.summarize().stateSha256);
});

test("同 ticket 时较小 client 胜出", () => {
  const reducer = new V3Reducer(LIMITS);
  const clientB = reducer.enterDocument(header("client-b"), source(1));
  reducer.accept(clientB, dataRecord(7, "b"), source(2), 10);
  const clientA = reducer.enterDocument(header("client-a"), source(3));
  reducer.accept(clientA, dataRecord(7, "a"), source(4), 10);

  assert.deepEqual(reducer.getSelectedRecord("document-1", "META")?.record.inner, {
    value: "a"
  });
  assert.equal(reducer.summarize().replacedByClientTieBreak, 1);

  const reverse = new V3Reducer(LIMITS);
  const reverseClientA = reverse.enterDocument(header("client-a"), source(1));
  reverse.accept(reverseClientA, dataRecord(7, "a"), source(2), 10);
  const reverseClientB = reverse.enterDocument(header("client-b"), source(3));
  reverse.accept(reverseClientB, dataRecord(7, "b"), source(4), 10);
  assert.equal(reverse.summarize().ignoredByClientTieBreak, 1);
  assert.equal(reducer.summarize().stateSha256, reverse.summarize().stateSha256);
});

test("墓碑和更高 ticket 恢复记录都参与最终状态", () => {
  const reducer = new V3Reducer(LIMITS);
  const context = reducer.enterDocument(header("client-a"), source(1));
  reducer.accept(context, dataRecord(1, "initial", { id: "x" }), source(2), 20);
  reducer.accept(context, dataRecord(2, "", { id: "x" }), source(3), 10);
  reducer.accept(context, dataRecord(3, "restored", { id: "x" }), source(4), 20);

  assert.deepEqual(reducer.getSelectedRecord("document-1", "META", "x")?.record.inner, {
    value: "restored"
  });
  const summary = reducer.summarize();
  assert.equal(summary.inputTombstones, 1);
  assert.equal(summary.activeRecords, 1);
  assert.equal(summary.tombstoneRecords, 0);
});

test("DELETE_DOC 的最终 isDelete 决定文档状态", () => {
  const reducer = new V3Reducer(LIMITS);
  const context = reducer.enterDocument(header("client-a"), source(1));
  reducer.accept(
    context,
    {
      outer: { type: "DELETE_DOC", ticket: 1 },
      inner: { isDelete: true }
    },
    source(2),
    20
  );
  reducer.accept(
    context,
    {
      outer: { type: "DELETE_DOC", ticket: 2 },
      inner: { isDelete: false }
    },
    source(3),
    20
  );

  assert.equal(reducer.summarize().activeDocuments, 1);
  assert.equal(reducer.summarize().deletedDocuments, 0);
});

test("最终 DELETE_DOC.isDelete=true 标记文档删除", () => {
  const reducer = new V3Reducer(LIMITS);
  const context = reducer.enterDocument(header("client-a"), source(1));
  reducer.accept(
    context,
    {
      outer: { type: "DELETE_DOC", ticket: 1 },
      inner: { isDelete: true }
    },
    source(2),
    20
  );

  assert.equal(reducer.summarize().activeDocuments, 0);
  assert.equal(reducer.summarize().deletedDocuments, 1);
});

test("同 ticket、同 client、不同内容属于不可裁决冲突", () => {
  const reducer = new V3Reducer(LIMITS);
  const context = reducer.enterDocument(header("client-a"), source(1));
  reducer.accept(context, dataRecord(1, "left"), source(2), 10);

  assert.throws(
    () => reducer.accept(context, dataRecord(1, "right"), source(3), 10),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.V3_AMBIGUOUS_CONFLICT
  );
});

test("完全相同的重复记录不会改变选中状态", () => {
  const reducer = new V3Reducer(LIMITS);
  const context = reducer.enterDocument(header("client-a"), source(1));
  const record = dataRecord(1, "same");
  reducer.accept(context, record, source(2), 10);
  reducer.accept(context, record, source(3), 10);

  assert.equal(reducer.summarize().identicalDuplicates, 1);
  assert.equal(reducer.summarize().selectedRecords, 1);
});

test("同一文档 UUID 的文档类型冲突必须失败", () => {
  const reducer = new V3Reducer(LIMITS);
  reducer.enterDocument(header("client-a", "SCH_PAGE"), source(1));

  assert.throws(
    () => reducer.enterDocument(header("client-b", "PCB"), source(2)),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.V3_DOCUMENT_TYPE_CONFLICT
  );
});

test("非法 ticket 和归并状态限额使用稳定错误码", () => {
  const reducer = new V3Reducer({
    maxReducedRecords: 1,
    maxReducedSourceBytes: 100
  });
  const context = reducer.enterDocument(header("client-a"), source(1));

  assert.throws(
    () => reducer.accept(context, dataRecord(Number.NaN, "bad"), source(2), 10),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.V3_INVALID_TICKET
  );

  reducer.accept(context, dataRecord(1, "first"), source(3), 10);
  assert.throws(
    () => reducer.accept(context, dataRecord(1, "second", { id: "another" }), source(4), 10),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.V3_REDUCED_STATE_LIMIT_EXCEEDED
  );
});

test("归并后的源数据字节数受独立限额保护", () => {
  const reducer = new V3Reducer({
    maxReducedRecords: 10,
    maxReducedSourceBytes: 9
  });
  const context = reducer.enterDocument(header("client-a"), source(1));

  assert.throws(
    () => reducer.accept(context, dataRecord(1, "too-large"), source(2), 10),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.V3_REDUCED_STATE_LIMIT_EXCEEDED
  );
});
