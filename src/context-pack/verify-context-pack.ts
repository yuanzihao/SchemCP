import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import { enforcesPosixModes } from "../core/filesystem-security.js";
import type {
  ContextPackFileReceipt,
  ContextPackManifest
} from "./model.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FILES = 64;
const MAX_PAYLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const EXPECTED_FILES = [
  ["project-summary.json", "application/json"],
  ["hierarchy.json", "application/json"],
  ["documents.jsonl", "application/x-ndjson"],
  ["variants.json", "application/json"],
  ["components.jsonl", "application/x-ndjson"],
  ["schematic-annotations.jsonl", "application/x-ndjson"],
  ["schematic-graphic-primitives.jsonl", "application/x-ndjson"],
  ["schematic-tables.jsonl", "application/x-ndjson"],
  ["component-pins.jsonl", "application/x-ndjson"],
  ["devices.jsonl", "application/x-ndjson"],
  ["symbols.jsonl", "application/x-ndjson"],
  ["symbol-parts.jsonl", "application/x-ndjson"],
  ["symbol-texts.jsonl", "application/x-ndjson"],
  ["symbol-pins.jsonl", "application/x-ndjson"],
  ["wires.jsonl", "application/x-ndjson"],
  ["explicit-nets.jsonl", "application/x-ndjson"],
  ["instance-contexts.jsonl", "application/x-ndjson"],
  ["diagnostics.json", "application/json"],
  ["unbound-attributes.jsonl", "application/x-ndjson"],
  ["unmodeled-records.jsonl", "application/x-ndjson"]
] as const;

export interface ContextPackVerificationResult {
  readonly ok: true;
  readonly gate: "AI_CONTEXT_PACK_VERIFIED";
  readonly packageSha256: string;
  readonly manifestSha256: string;
  readonly payloadBytes: number;
  readonly files: number;
  readonly records: number;
  readonly electricalTruth: "NOT_VERIFIED";
}

function fail(
  code:
    | typeof ERROR_CODES.CONTEXT_PACK_INVALID
    | typeof ERROR_CODES.CONTEXT_PACK_MISMATCH,
  message: string
): never {
  throw new AppError(code, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  field: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `${field} 字段集合不符合上下文包 1.0.0 契约。`
    );
  }
}

function safeCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(ERROR_CODES.CONTEXT_PACK_INVALID, `${field} 必须是非负安全整数。`);
  }
  return value as number;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(ERROR_CODES.CONTEXT_PACK_INVALID, `${field} 必须是小写 SHA-256。`);
  }
  return value;
}

function parseFile(value: unknown, index: number): ContextPackFileReceipt {
  if (!isObject(value)) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `files[${index}] 必须是对象。`
    );
  }
  exactKeys(
    value,
    ["path", "mediaType", "bytes", "records", "sha256"],
    `files[${index}]`
  );
  if (
    typeof value.path !== "string" ||
    !SAFE_FILE_NAME_PATTERN.test(value.path)
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `files[${index}].path 不是安全的单层文件名。`
    );
  }
  if (
    value.mediaType !== "application/json" &&
    value.mediaType !== "application/x-ndjson"
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `files[${index}].mediaType 不受支持。`
    );
  }
  return {
    path: value.path,
    mediaType: value.mediaType,
    bytes: safeCount(value.bytes, `files[${index}].bytes`),
    records: safeCount(value.records, `files[${index}].records`),
    sha256: sha256(value.sha256, `files[${index}].sha256`)
  };
}

function parseManifest(value: unknown): ContextPackManifest {
  if (!isObject(value)) {
    fail(ERROR_CODES.CONTEXT_PACK_INVALID, "manifest.json 必须是对象。");
  }
  exactKeys(
    value,
    [
      "schemaVersion",
      "generator",
      "source",
      "encoding",
      "capabilities",
      "files",
      "payloadBytes",
      "packageSha256"
    ],
    "manifest"
  );
  if (value.schemaVersion !== "1.0.0") {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.schemaVersion 必须是 1.0.0。"
    );
  }
  if (!isObject(value.generator) || !isObject(value.source)) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.generator/source 必须是对象。"
    );
  }
  if (!isObject(value.encoding) || !isObject(value.capabilities)) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.encoding/capabilities 必须是对象。"
    );
  }
  const capabilityValues = value.capabilities;
  exactKeys(value.generator, ["name", "version"], "manifest.generator");
  exactKeys(
    value.source,
    [
      "format",
      "archiveSha256",
      "reducedStateSha256",
      "irSha256",
      "electricalTruth"
    ],
    "manifest.source"
  );
  exactKeys(value.encoding, ["json", "jsonl"], "manifest.encoding");
  exactKeys(
    capabilityValues,
    [
      "projectStructure",
      "componentInventory",
      "explicitWireNetLabels",
      "pinConnectionCandidates",
      "variantsAndInstanceContexts",
      "schematicAnnotations",
      "schematicGraphicPrimitives",
      "schematicTables",
      "symbolTexts",
      "electricalTruth",
      "inferredBoardResources",
      "datasheets"
    ],
    "manifest.capabilities"
  );
  if (
    value.generator.name !== "@yuanzihao/schemcp" ||
    value.generator.version !== "0.1.0" ||
    value.source.format !== "EASYEDA_V3_LOG" ||
    value.source.electricalTruth !== "NOT_VERIFIED" ||
    value.encoding.json !== "CANONICAL_JSON_LF" ||
    value.encoding.jsonl !== "ONE_CANONICAL_JSON_VALUE_PER_LF_LINE"
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest 固定格式、生成器或真值边界不符合 1.0.0 契约。"
    );
  }
  for (const field of [
    "archiveSha256",
    "reducedStateSha256",
    "irSha256"
  ] as const) {
    sha256(value.source[field], `manifest.source.${field}`);
  }
  if (!Array.isArray(value.files) || value.files.length > MAX_FILES) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `manifest.files 必须是不超过 ${MAX_FILES} 项的数组。`
    );
  }
  const files = value.files.map(parseFile);
  const names = new Set(files.map((file) => file.path));
  if (names.size !== files.length || names.has("manifest.json")) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.files 包含重复文件或递归列出 manifest.json。"
    );
  }
  if (
    files.length !== EXPECTED_FILES.length ||
    files.some(
      (file, index) =>
        file.path !== EXPECTED_FILES[index]?.[0] ||
        file.mediaType !== EXPECTED_FILES[index]?.[1]
    )
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.files 不符合上下文包 1.0.0 的固定文件清单或顺序。"
    );
  }
  if (
    files.some(
      (file) =>
        file.bytes > MAX_PAYLOAD_BYTES ||
        (file.mediaType === "application/json" &&
          (file.records !== 1 || file.bytes === 0))
    )
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.files 包含超限文件或非法 JSON 记录数。"
    );
  }
  const payloadBytes = safeCount(
    value.payloadBytes,
    "manifest.payloadBytes"
  );
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `manifest.payloadBytes 超过 ${MAX_PAYLOAD_BYTES} 字节上限。`
    );
  }
  if (
    files.reduce((total, file) => total + file.bytes, 0) !== payloadBytes
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.payloadBytes 与文件收据字节数之和不一致。"
    );
  }
  const packageSha256 = sha256(
    value.packageSha256,
    "manifest.packageSha256"
  );
  const capabilities = {
    projectStructure: "AVAILABLE_DETERMINISTIC" as const,
    componentInventory: "AVAILABLE_DETERMINISTIC" as const,
    explicitWireNetLabels: "AVAILABLE_NOT_FULL_NET_GRAPH" as const,
    pinConnectionCandidates: "AVAILABLE_NOT_VERIFIED" as const,
    variantsAndInstanceContexts: "AVAILABLE_EXPLICIT_METADATA" as const,
    schematicAnnotations:
      "AVAILABLE_EXPLICIT_TEXT_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED" as const,
    schematicGraphicPrimitives:
      "AVAILABLE_EXPLICIT_POLY_RECT_ARC_CIRCLE_ELLIPSE_FINITE_GEOMETRY_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED" as const,
    schematicTables:
      "AVAILABLE_EXPLICIT_TABLE_CELLS_LAYOUT_BOUNDS_VALIDATED_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED" as const,
    symbolTexts:
      "AVAILABLE_EXPLICIT_TEXT_EXACT_PART_BINDING_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED" as const,
    electricalTruth: "NOT_VERIFIED" as const,
    inferredBoardResources: "NOT_INCLUDED" as const,
    datasheets: "NOT_INCLUDED" as const
  };
  if (
    Object.entries(capabilities).some(
      ([key, expected]) => capabilityValues[key] !== expected
    )
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.capabilities 包含越过当前真值门禁的能力声明。"
    );
  }
  return {
    schemaVersion: "1.0.0",
    generator: {
      name: "@yuanzihao/schemcp",
      version: "0.1.0"
    },
    source: {
      format: "EASYEDA_V3_LOG",
      archiveSha256: value.source.archiveSha256 as string,
      reducedStateSha256: value.source.reducedStateSha256 as string,
      irSha256: value.source.irSha256 as string,
      electricalTruth: "NOT_VERIFIED"
    },
    encoding: {
      json: "CANONICAL_JSON_LF",
      jsonl: "ONE_CANONICAL_JSON_VALUE_PER_LF_LINE"
    },
    capabilities,
    files,
    payloadBytes,
    packageSha256
  };
}

function parseCanonicalRecord(
  chunks: readonly Buffer[],
  bytes: number,
  fileName: string
): void {
  if (bytes === 0) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `上下文包文件 ${fileName} 包含空记录。`
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, bytes)
    );
  } catch {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `上下文包文件 ${fileName} 包含非法 UTF-8。`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `上下文包文件 ${fileName} 包含非法 JSON 记录。`
    );
  }
  if (canonicalJson(value) !== text) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `上下文包文件 ${fileName} 不是规范 JSON 编码。`
    );
  }
}

async function inspectPayload(
  filePath: string,
  fileName: string,
  mediaType: ContextPackFileReceipt["mediaType"]
): Promise<{
  readonly bytes: number;
  readonly records: number;
  readonly sha256: string;
}> {
  const hash = createHash("sha256");
  let bytes = 0;
  let records = 0;
  let recordBytes = 0;
  let recordChunks: Buffer[] = [];
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
    let offset = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 0x0a) continue;
      const segment = buffer.subarray(offset, index);
      recordChunks.push(segment);
      recordBytes += segment.length;
      if (recordBytes > MAX_RECORD_BYTES) {
        fail(
          ERROR_CODES.CONTEXT_PACK_INVALID,
          `上下文包文件 ${fileName} 的单条记录超过 ${MAX_RECORD_BYTES} 字节。`
        );
      }
      parseCanonicalRecord(recordChunks, recordBytes, fileName);
      records += 1;
      recordChunks = [];
      recordBytes = 0;
      offset = index + 1;
    }
    if (offset < buffer.length) {
      const remainder = buffer.subarray(offset);
      recordChunks.push(remainder);
      recordBytes += remainder.length;
      if (recordBytes > MAX_RECORD_BYTES) {
        fail(
          ERROR_CODES.CONTEXT_PACK_INVALID,
          `上下文包文件 ${fileName} 的单条记录超过 ${MAX_RECORD_BYTES} 字节。`
        );
      }
    }
  }
  if (recordBytes !== 0 || recordChunks.length !== 0) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `上下文包文件 ${fileName} 的最后一条记录缺少 LF。`
    );
  }
  if (
    mediaType === "application/json" &&
    records !== 1
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `上下文包 JSON 文件 ${fileName} 必须恰好包含一条记录。`
    );
  }
  return { bytes, records, sha256: hash.digest("hex") };
}

export async function verifyContextPack(
  directoryPath: string
): Promise<ContextPackVerificationResult> {
  const directory = path.resolve(directoryPath);
  const directoryState = await lstat(directory).catch(() => undefined);
  if (
    directoryState === undefined ||
    !directoryState.isDirectory() ||
    directoryState.isSymbolicLink()
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "上下文包路径必须是实际目录，不能是符号链接。"
    );
  }
  if (enforcesPosixModes() && (directoryState.mode & 0o077) !== 0) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "上下文包目录向组或其他用户开放，拒绝读取私有工程事实。"
    );
  }

  const manifestPath = path.join(directory, "manifest.json");
  const manifestState = await lstat(manifestPath).catch(() => undefined);
  if (
    manifestState === undefined ||
    !manifestState.isFile() ||
    manifestState.isSymbolicLink() ||
    manifestState.size > MAX_MANIFEST_BYTES ||
    (enforcesPosixModes() && (manifestState.mode & 0o077) !== 0)
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      `manifest.json 缺失、不是私有普通文件或超过 ${MAX_MANIFEST_BYTES} 字节。`
    );
  }
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.json 无法作为私有普通文件读取。"
    );
  }
  let manifestPayload: string;
  try {
    manifestPayload = new TextDecoder("utf-8", { fatal: true }).decode(
      manifestBytes
    );
  } catch {
    fail(ERROR_CODES.CONTEXT_PACK_INVALID, "manifest.json 包含非法 UTF-8。");
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestPayload) as unknown;
  } catch {
    fail(ERROR_CODES.CONTEXT_PACK_INVALID, "manifest.json 不是有效 JSON。");
  }
  const manifest = parseManifest(rawManifest);
  if (`${canonicalJson(manifest)}\n` !== manifestPayload) {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "manifest.json 不是规范 JSON + LF 编码。"
    );
  }
  const { packageSha256, ...base } = manifest;
  if (sha256CanonicalJson(base) !== packageSha256) {
    fail(
      ERROR_CODES.CONTEXT_PACK_MISMATCH,
      "上下文包总哈希与 manifest 内容不一致。"
    );
  }

  let entries: string[];
  try {
    entries = (await readdir(directory)).sort();
  } catch {
    fail(
      ERROR_CODES.CONTEXT_PACK_INVALID,
      "上下文包目录无法安全枚举。"
    );
  }
  const expectedEntries = [
    "manifest.json",
    ...manifest.files.map((file) => file.path)
  ].sort();
  if (
    entries.length !== expectedEntries.length ||
    entries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    fail(
      ERROR_CODES.CONTEXT_PACK_MISMATCH,
      "上下文包包含缺失或未登记的额外文件。"
    );
  }

  let payloadBytes = 0;
  let records = 0;
  for (const expected of manifest.files) {
    const filePath = path.join(directory, expected.path);
    const fileState = await lstat(filePath).catch(() => undefined);
    if (
      fileState === undefined ||
      !fileState.isFile() ||
      fileState.isSymbolicLink() ||
      (enforcesPosixModes() && (fileState.mode & 0o077) !== 0)
    ) {
      fail(
        ERROR_CODES.CONTEXT_PACK_INVALID,
        `上下文包文件 ${expected.path} 不是私有普通文件。`
      );
    }
    let actual: Awaited<ReturnType<typeof inspectPayload>>;
    try {
      actual = await inspectPayload(
        filePath,
        expected.path,
        expected.mediaType
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail(
        ERROR_CODES.CONTEXT_PACK_INVALID,
        `上下文包文件 ${expected.path} 无法安全读取。`
      );
    }
    if (
      actual.bytes !== expected.bytes ||
      actual.records !== expected.records ||
      actual.sha256 !== expected.sha256
    ) {
      fail(
        ERROR_CODES.CONTEXT_PACK_MISMATCH,
        `上下文包文件 ${expected.path} 的大小、记录数或哈希不一致。`
      );
    }
    payloadBytes += actual.bytes;
    records += actual.records;
  }
  if (payloadBytes !== manifest.payloadBytes) {
    fail(
      ERROR_CODES.CONTEXT_PACK_MISMATCH,
      "上下文包文件字节总数与 manifest.payloadBytes 不一致。"
    );
  }
  return {
    ok: true,
    gate: "AI_CONTEXT_PACK_VERIFIED",
    packageSha256: manifest.packageSha256,
    manifestSha256: createHash("sha256")
      .update(manifestPayload)
      .digest("hex"),
    payloadBytes,
    files: manifest.files.length + 1,
    records,
    electricalTruth: "NOT_VERIFIED"
  };
}
