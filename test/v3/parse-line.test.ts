import assert from "node:assert/strict";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { parseV3Line } from "../../src/v3/parse-line.js";
import { isQuarantinedMalformedTextInner } from "../../src/v3/record.js";

const SOURCE = { entry: "epru-1", line: 7 } as const;

test("按 JSON 边界解析字符串中的双竖线", () => {
  const record = parseV3Line(
    "{\"type\":\"TEXT\",\"ticket\":2,\"note\":\"outer||value\"}||{\"text\":\"inner||value\"}|",
    SOURCE
  );

  assert.equal(record.outer.type, "TEXT");
  assert.equal(record.outer.ticket, 2);
  assert.deepEqual(record.inner, { text: "inner||value" });
});

test("识别空字符串删除记录", () => {
  const record = parseV3Line("{\"type\":\"ATTR\",\"id\":\"a\",\"ticket\":3}||\"\"|", SOURCE);
  assert.equal(record.inner, "");
});

test("识别真实工程中的紧凑墓碑记录", () => {
  const record = parseV3Line("{\"type\":\"PAD_NET\",\"id\":\"a\",\"ticket\":4}|||", SOURCE);
  assert.equal(record.inner, "");
});

test("拒绝非法尾随内容并保留来源", () => {
  assert.throws(
    () => parseV3Line("{\"type\":\"META\"}||{\"name\":\"x\"}|unexpected", SOURCE),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, ERROR_CODES.V3_INVALID_RECORD);
      assert.deepEqual(error.source, SOURCE);
      return true;
    }
  );
});

test("拒绝缺少 type 的外层记录", () => {
  assert.throws(
    () => parseV3Line("{\"ticket\":1}||{\"name\":\"x\"}|", SOURCE),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.V3_INVALID_RECORD
  );
});

test("拒绝超过配置深度的嵌套 JSON", () => {
  assert.throws(
    () =>
      parseV3Line(
        "{\"type\":\"META\"}||{\"a\":{\"b\":{\"c\":1}}}|",
        SOURCE,
        { maxJsonDepth: 2 }
      ),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.V3_JSON_DEPTH_EXCEEDED
  );
});

test("默认仍拒绝被截断的 TEXT 内层 JSON", () => {
  assert.throws(
    () =>
      parseV3Line(
        "{\"type\":\"TEXT\",\"id\":\"t1\",\"ticket\":2}||{\"value\":\"truncated",
        SOURCE
      ),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.V3_INVALID_RECORD
  );
});

test("显式兼容模式只隔离被截断的 TEXT 内层 JSON", () => {
  const record = parseV3Line(
    "{\"type\":\"TEXT\",\"id\":\"t1\",\"ticket\":2}||{\"value\":\"truncated",
    SOURCE,
    { quarantineMalformedTextRecords: true }
  );

  assert.equal(record.outer.type, "TEXT");
  assert.equal(isQuarantinedMalformedTextInner(record.inner), true);
});

test("TEXT 隔离模式仍拒绝被截断的电气记录", () => {
  assert.throws(
    () =>
      parseV3Line(
        "{\"type\":\"WIRE\",\"id\":\"w1\",\"ticket\":2}||{\"locked\":false",
        SOURCE,
        { quarantineMalformedTextRecords: true }
      ),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.V3_INVALID_RECORD
  );
});
