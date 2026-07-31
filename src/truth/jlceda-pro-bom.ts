import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";

const MAX_BOM_BYTES = 16 * 1024 * 1024;
const MAX_LINE_ITEMS = 100_000;
const MAX_DESIGNATORS = 1_000_000;
const MAX_FIELD_LENGTH = 1024 * 1024;
const HEADER = [
  "No.",
  "Quantity",
  "Comment",
  "Designator",
  "Footprint",
  "Value",
  "Manufacturer Part",
  "Manufacturer",
  "Supplier Part",
  "Supplier"
] as const;

export interface JlcEdaProBom {
  readonly schemaVersion: "0.1.0";
  readonly format: "JLCEDA_PRO_BOM_UTF16LE_TSV";
  readonly bytes: number;
  readonly sha256: string;
  readonly lineItemCount: number;
  readonly quantityTotal: number;
  readonly designatorCount: number;
  readonly designatorTableSha256: string;
  readonly rowTableSha256: string;
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly projectBinding: "NOT_VERIFIED";
}

interface BomRow {
  readonly number: number;
  readonly quantity: number;
  readonly comment: string;
  readonly designators: readonly string[];
  readonly footprint: string;
  readonly value: string;
  readonly manufacturerPart: string;
  readonly manufacturer: string;
  readonly supplierPart: string;
  readonly supplier: string;
}

function invalid(message: string, cause?: unknown): never {
  throw new AppError(ERROR_CODES.JLCEDA_PRO_BOM_INVALID, message, {
    ...(cause === undefined ? {} : { cause })
  });
}

function boundedField(value: string, field: string): string {
  if (value.length > MAX_FIELD_LENGTH || value.includes("\u0000")) {
    invalid(`${field} 超过安全限额或包含 NUL。`);
  }
  return value;
}

function positiveInteger(value: string, field: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    invalid(`${field} 必须是正整数。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    invalid(`${field} 超过安全整数范围。`);
  }
  return parsed;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 嘉立创专业版当前“导出 BOM → CSV”实际产生 UTF-16LE、Tab 分隔文件。
 * 这里按已观察格式严格读取，格式变化必须显式增加适配器，不能宽松猜测。
 */
export function parseJlcEdaProBom(bytes: Uint8Array): JlcEdaProBom {
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_BOM_BYTES) {
    invalid("BOM 必须非空且不超过 16 MiB。");
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xfe) {
    invalid("BOM 必须带 UTF-16LE BOM 标记。");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  } catch (error) {
    invalid("BOM 不是有效 UTF-16LE。", error);
  }
  if (text.startsWith("\ufeff")) text = text.slice(1);
  text = text.replaceAll("\r\n", "\n");
  if (text.includes("\r")) {
    invalid("BOM 只能使用 CRLF 或 LF 行结束符。");
  }
  if (text.endsWith("\n")) text = text.slice(0, -1);
  const lines = text.split("\n");
  if (lines.length < 2 || lines.length - 1 > MAX_LINE_ITEMS) {
    invalid("BOM 必须包含表头和 1 到 100000 条物料行。");
  }
  if (lines.some((line) => line.length === 0)) {
    invalid("BOM 不允许空行。");
  }
  const header = lines[0]!.split("\t");
  if (
    header.length !== HEADER.length ||
    header.some((field, index) => field !== HEADER[index])
  ) {
    invalid("BOM 表头不符合嘉立创专业版导出契约。");
  }

  const rows: BomRow[] = [];
  const allDesignators = new Set<string>();
  let quantityTotal = 0;
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const fields = lines[lineIndex]!.split("\t");
    if (fields.length !== HEADER.length) {
      invalid(`BOM 第 ${lineIndex + 1} 行字段数不符合导出契约。`);
    }
    const number = positiveInteger(fields[0]!, `BOM 第 ${lineIndex + 1} 行序号`);
    if (number !== lineIndex) {
      invalid("BOM 序号必须从 1 开始连续递增。");
    }
    const quantity = positiveInteger(
      fields[1]!,
      `BOM 第 ${lineIndex + 1} 行数量`
    );
    const designatorField = boundedField(
      fields[3]!,
      `BOM 第 ${lineIndex + 1} 行位号`
    );
    const designators = designatorField.split(",");
    if (
      designators.length !== quantity ||
      designators.some(
        (designator) =>
          designator.length < 1 ||
          designator.length > 4096 ||
          designator !== designator.trim()
      )
    ) {
      invalid("BOM 数量必须与非空、无外围空白的位号数量一致。");
    }
    for (const designator of designators) {
      if (allDesignators.has(designator)) {
        invalid("BOM 包含跨物料行重复位号。");
      }
      allDesignators.add(designator);
      if (allDesignators.size > MAX_DESIGNATORS) {
        invalid("BOM 位号总数超过安全限额。");
      }
    }
    quantityTotal += quantity;
    if (!Number.isSafeInteger(quantityTotal) || quantityTotal > MAX_DESIGNATORS) {
      invalid("BOM 数量总和超过安全限额。");
    }
    rows.push({
      number,
      quantity,
      comment: boundedField(fields[2]!, `BOM 第 ${lineIndex + 1} 行备注`),
      designators,
      footprint: boundedField(fields[4]!, `BOM 第 ${lineIndex + 1} 行封装`),
      value: boundedField(fields[5]!, `BOM 第 ${lineIndex + 1} 行值`),
      manufacturerPart: boundedField(
        fields[6]!,
        `BOM 第 ${lineIndex + 1} 行制造商编号`
      ),
      manufacturer: boundedField(
        fields[7]!,
        `BOM 第 ${lineIndex + 1} 行制造商`
      ),
      supplierPart: boundedField(
        fields[8]!,
        `BOM 第 ${lineIndex + 1} 行供应商编号`
      ),
      supplier: boundedField(
        fields[9]!,
        `BOM 第 ${lineIndex + 1} 行供应商`
      )
    });
  }
  const sortedDesignators = [...allDesignators].sort(compareText);
  return {
    schemaVersion: "0.1.0",
    format: "JLCEDA_PRO_BOM_UTF16LE_TSV",
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    lineItemCount: rows.length,
    quantityTotal,
    designatorCount: allDesignators.size,
    designatorTableSha256: sha256CanonicalJson(sortedDesignators),
    rowTableSha256: sha256CanonicalJson(rows),
    sourceAuthenticity: "NOT_VERIFIED",
    projectBinding: "NOT_VERIFIED"
  };
}

export async function readPrivateBom(inputPath: string): Promise<{
  readonly canonicalPath: string;
  readonly bytes: Buffer;
  readonly parsed: JlcEdaProBom;
}> {
  const requestedPath = path.resolve(inputPath);
  if (path.extname(requestedPath).toLowerCase() !== ".csv") {
    invalid("BOM 证据输入必须使用 .csv 扩展名。");
  }
  let state;
  try {
    state = await lstat(requestedPath);
  } catch (error) {
    invalid("无法读取 BOM 证据文件。", error);
  }
  if (
    !state.isFile() ||
    state.isSymbolicLink() ||
    state.size < 2 ||
    state.size > MAX_BOM_BYTES
  ) {
    invalid("BOM 必须是非空、非符号链接且不超过 16 MiB 的普通文件。");
  }
  let handle;
  try {
    handle = await open(
      requestedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const openedState = await handle.stat();
    if (!openedState.isFile() || openedState.size !== state.size) {
      invalid("BOM 文件在打开期间发生变化。");
    }
    const bytes = await handle.readFile();
    const finalState = await handle.stat();
    if (bytes.length !== state.size || finalState.size !== state.size) {
      invalid("BOM 文件在读取期间发生变化。");
    }
    return {
      canonicalPath: requestedPath,
      bytes,
      parsed: parseJlcEdaProBom(bytes)
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalid("无法安全读取 BOM 证据文件。", error);
  } finally {
    await handle?.close();
  }
  invalid("无法安全读取 BOM 证据文件。");
}
