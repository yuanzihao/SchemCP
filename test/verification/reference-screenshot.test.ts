import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import {
  parseP0ReferenceScreenshot,
  readP0ReferenceScreenshot
} from "../../src/verification/reference-screenshot.js";
import { createPngFixture } from "../helpers/png-fixture.js";

test("严格校验参考截图 PNG 结构、CRC 和尺寸", () => {
  const png = createPngFixture(3, 2);
  const parsed = parseP0ReferenceScreenshot(png);
  assert.deepEqual(parsed, {
    format: "PNG",
    bytes: png.length,
    sha256: parsed.sha256,
    width: 3,
    height: 2
  });
  assert.match(parsed.sha256, /^[0-9a-f]{64}$/u);
});

test("拒绝伪装成 PNG 的 JPEG 和损坏的 chunk CRC", () => {
  const corrupt = Buffer.from(createPngFixture());
  corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 0xff;
  for (const input of [Buffer.from([0xff, 0xd8, 0xff]), corrupt]) {
    assert.throws(
      () => parseP0ReferenceScreenshot(input),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERROR_CODES.P0_FORMAT_MATRIX_INVALID
    );
  }
});

test("参考截图私有读取器拒绝错误扩展名和符号链接", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-png-test-"));
  const source = path.join(directory, "source.png");
  const symbolic = path.join(directory, "symbolic.png");
  await writeFile(source, createPngFixture(), { mode: 0o600 });
  await symlink(source, symbolic);
  for (const input of [path.join(directory, "source.jpg"), symbolic]) {
    await assert.rejects(
      readP0ReferenceScreenshot(input),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERROR_CODES.P0_FORMAT_MATRIX_INVALID
    );
  }
});
