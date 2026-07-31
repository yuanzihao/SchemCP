import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import {
  parseJlcEdaProBom,
  readPrivateBom
} from "../../src/truth/jlceda-pro-bom.js";

const HEADER =
  "No.\tQuantity\tComment\tDesignator\tFootprint\tValue\tManufacturer Part\tManufacturer\tSupplier Part\tSupplier";

function bom(...rows: readonly string[]): Buffer {
  return Buffer.from(`\ufeff${[HEADER, ...rows].join("\r\n")}`, "utf16le");
}

test("严格解析嘉立创专业版 UTF-16LE Tab 分隔 BOM", () => {
  const parsed = parseJlcEdaProBom(
    bom(
      "1\t2\t10k\tR1,R2\tR0603\t10k\tRC0603\tVendor\tC1\tLCSC",
      "2\t1\tMCU\tU1\tLQFP64\tSTM32\tSTM32F407\tST\tC2\tLCSC"
    )
  );
  assert.equal(parsed.schemaVersion, "0.1.0");
  assert.equal(parsed.format, "JLCEDA_PRO_BOM_UTF16LE_TSV");
  assert.equal(parsed.lineItemCount, 2);
  assert.equal(parsed.quantityTotal, 3);
  assert.equal(parsed.designatorCount, 3);
  assert.match(parsed.sha256, /^[0-9a-f]{64}$/u);
  assert.match(parsed.designatorTableSha256, /^[0-9a-f]{64}$/u);
  assert.match(parsed.rowTableSha256, /^[0-9a-f]{64}$/u);
  assert.equal(parsed.sourceAuthenticity, "NOT_VERIFIED");
  assert.equal(parsed.projectBinding, "NOT_VERIFIED");
});

test("拒绝 BOM 编码、表头、数量和位号一致性错误", () => {
  const invalidInputs = [
    Buffer.from(`${HEADER}\n1\t1\t10k\tR1\tR0603\t10k\tP\tM\tS\tL`, "utf8"),
    bom("1\t1\t10k\tR1\tR0603\t10k\tP\tM\tS"),
    bom("1\t2\t10k\tR1\tR0603\t10k\tP\tM\tS\tL"),
    bom(
      "1\t1\t10k\tR1\tR0603\t10k\tP\tM\tS\tL",
      "2\t1\t20k\tR1\tR0603\t20k\tP\tM\tS\tL"
    )
  ];
  for (const input of invalidInputs) {
    assert.throws(
      () => parseJlcEdaProBom(input),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERROR_CODES.JLCEDA_PRO_BOM_INVALID
    );
  }
});

test("BOM 私有读取器拒绝错误扩展名和符号链接", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-bom-test-"));
  const source = path.join(directory, "source.csv");
  const symbolic = path.join(directory, "symbolic.csv");
  await writeFile(
    source,
    bom("1\t1\t10k\tR1\tR0603\t10k\tP\tM\tS\tL"),
    { mode: 0o600 }
  );
  await symlink(source, symbolic);
  for (const input of [path.join(directory, "source.txt"), symbolic]) {
    await assert.rejects(
      readPrivateBom(input),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERROR_CODES.JLCEDA_PRO_BOM_INVALID
    );
  }
});
