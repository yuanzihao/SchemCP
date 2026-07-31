import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { readUtf8Lines } from "../../src/v3/read-lines.js";

test("跨数据块读取 UTF-8 与 CRLF 行", async () => {
  const stream = Readable.from([Buffer.from("第一"), Buffer.from("行\r\n第二行\n")]);
  const lines = [];
  for await (const line of readUtf8Lines(stream, { entry: "epru-1", maxLineBytes: 64 })) {
    lines.push(line);
  }

  assert.deepEqual(
    lines.map((line) => line.text),
    ["第一行", "第二行"]
  );
  assert.deepEqual(
    lines.map((line) => line.line),
    [1, 2]
  );
});
test("拒绝超长日志行", async () => {
  const stream = Readable.from([Buffer.from("12345")]);
  await assert.rejects(
    async () => {
      for await (const _line of readUtf8Lines(stream, {
        entry: "epru-1",
        maxLineBytes: 4
      })) {
        // 生成器在产出前应失败。
      }
    },
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.V3_LINE_TOO_LARGE
  );
});

test("拒绝非法 UTF-8", async () => {
  const stream = Readable.from([Buffer.from([0xc3, 0x28, 0x0a])]);
  await assert.rejects(
    async () => {
      for await (const _line of readUtf8Lines(stream, {
        entry: "epru-1",
        maxLineBytes: 64
      })) {
        // 生成器在解码时应失败。
      }
    },
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.V3_INVALID_UTF8
  );
});
