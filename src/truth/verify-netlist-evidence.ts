import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import { enforcesPosixModes } from "../core/filesystem-security.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_NETLIST_BYTES = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface NetlistEvidenceVerificationResult {
  readonly ok: true;
  readonly gate: "NETLIST_EVIDENCE_INTEGRITY_VERIFIED";
  readonly evidenceSha256: string;
  readonly manifestSha256: string;
  readonly archiveSha256: string;
  readonly irSha256: string;
  readonly netlistSha256: string;
  readonly netlistBytes: number;
  readonly files: 2;
  readonly acquisitionMethod: "USER_PROVIDED_FILE";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly projectBinding: "USER_ASSERTED_NOT_VERIFIED";
  readonly officialNetlistComparison: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_VERIFIED";
}

interface ParsedManifest {
  readonly schemaVersion: "0.1.0";
  readonly generator: {
    readonly name: "@yuanzihao/schemcp";
    readonly version: "0.1.0";
  };
  readonly sourceProject: {
    readonly archiveSha256: string;
    readonly reducedStateSha256: string;
    readonly irSha256: string;
  };
  readonly acquisition: {
    readonly method: "USER_PROVIDED_FILE";
    readonly assertedFormat: "JLCEDA_PRO_ENET";
    readonly sourceAuthenticity: "NOT_VERIFIED";
    readonly projectBinding: "USER_ASSERTED_NOT_VERIFIED";
  };
  readonly netlist: {
    readonly fileName: "official.enet";
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly truth: {
    readonly syntaxAdapter: "NOT_IMPLEMENTED";
    readonly officialNetlistComparison: "NOT_PERFORMED";
    readonly electricalTruth: "NOT_VERIFIED";
  };
  readonly evidenceSha256: string;
}

function fail(
  code:
    | typeof ERROR_CODES.NETLIST_EVIDENCE_INVALID
    | typeof ERROR_CODES.NETLIST_EVIDENCE_MISMATCH,
  message: string
): never {
  throw new AppError(code, message);
}

function object(
  value: unknown,
  field: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(ERROR_CODES.NETLIST_EVIDENCE_INVALID, `${field} 必须是对象。`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  field: string
): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      `${field} 字段集合不符合网表证据契约。`
    );
  }
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  field: string
): T {
  if (value !== expected) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      `${field} 必须是 ${expected}。`
    );
  }
  return expected;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      `${field} 必须是小写 SHA-256。`
    );
  }
  return value;
}

function byteCount(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_NETLIST_BYTES
  ) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      "netlist.bytes 必须是安全范围内的正整数。"
    );
  }
  return value as number;
}

function parseManifest(value: unknown): ParsedManifest {
  const root = object(value, "evidence");
  exactKeys(
    root,
    [
      "schemaVersion",
      "generator",
      "sourceProject",
      "acquisition",
      "netlist",
      "truth",
      "evidenceSha256"
    ],
    "evidence"
  );
  const generator = object(root.generator, "generator");
  exactKeys(generator, ["name", "version"], "generator");
  const sourceProject = object(root.sourceProject, "sourceProject");
  exactKeys(
    sourceProject,
    ["archiveSha256", "reducedStateSha256", "irSha256"],
    "sourceProject"
  );
  const acquisition = object(root.acquisition, "acquisition");
  exactKeys(
    acquisition,
    [
      "method",
      "assertedFormat",
      "sourceAuthenticity",
      "projectBinding"
    ],
    "acquisition"
  );
  const netlist = object(root.netlist, "netlist");
  exactKeys(netlist, ["fileName", "bytes", "sha256"], "netlist");
  const truth = object(root.truth, "truth");
  exactKeys(
    truth,
    [
      "syntaxAdapter",
      "officialNetlistComparison",
      "electricalTruth"
    ],
    "truth"
  );
  return {
    schemaVersion: literal(root.schemaVersion, "0.1.0", "schemaVersion"),
    generator: {
      name: literal(
        generator.name,
        "@yuanzihao/schemcp",
        "generator.name"
      ),
      version: literal(generator.version, "0.1.0", "generator.version")
    },
    sourceProject: {
      archiveSha256: sha256(
        sourceProject.archiveSha256,
        "sourceProject.archiveSha256"
      ),
      reducedStateSha256: sha256(
        sourceProject.reducedStateSha256,
        "sourceProject.reducedStateSha256"
      ),
      irSha256: sha256(
        sourceProject.irSha256,
        "sourceProject.irSha256"
      )
    },
    acquisition: {
      method: literal(
        acquisition.method,
        "USER_PROVIDED_FILE",
        "acquisition.method"
      ),
      assertedFormat: literal(
        acquisition.assertedFormat,
        "JLCEDA_PRO_ENET",
        "acquisition.assertedFormat"
      ),
      sourceAuthenticity: literal(
        acquisition.sourceAuthenticity,
        "NOT_VERIFIED",
        "acquisition.sourceAuthenticity"
      ),
      projectBinding: literal(
        acquisition.projectBinding,
        "USER_ASSERTED_NOT_VERIFIED",
        "acquisition.projectBinding"
      )
    },
    netlist: {
      fileName: literal(
        netlist.fileName,
        "official.enet",
        "netlist.fileName"
      ),
      bytes: byteCount(netlist.bytes),
      sha256: sha256(netlist.sha256, "netlist.sha256")
    },
    truth: {
      syntaxAdapter: literal(
        truth.syntaxAdapter,
        "NOT_IMPLEMENTED",
        "truth.syntaxAdapter"
      ),
      officialNetlistComparison: literal(
        truth.officialNetlistComparison,
        "NOT_PERFORMED",
        "truth.officialNetlistComparison"
      ),
      electricalTruth: literal(
        truth.electricalTruth,
        "NOT_VERIFIED",
        "truth.electricalTruth"
      )
    },
    evidenceSha256: sha256(root.evidenceSha256, "evidenceSha256")
  };
}

async function inspectNetlist(
  filePath: string
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_NETLIST_BYTES) {
      fail(
        ERROR_CODES.NETLIST_EVIDENCE_INVALID,
        "official.enet 超过安全限额。"
      );
    }
    hash.update(buffer);
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function verifyNetlistEvidence(
  directoryPath: string
): Promise<NetlistEvidenceVerificationResult> {
  const directory = path.resolve(directoryPath);
  const directoryState = await lstat(directory).catch(() => undefined);
  if (
    directoryState === undefined ||
    !directoryState.isDirectory() ||
    directoryState.isSymbolicLink() ||
    (enforcesPosixModes() && (directoryState.mode & 0o077) !== 0)
  ) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      "网表证据路径必须是私有实际目录。"
    );
  }
  const entries = (await readdir(directory).catch(() => [] as string[])).sort();
  if (
    entries.length !== 2 ||
    entries[0] !== "evidence.json" ||
    entries[1] !== "official.enet"
  ) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_MISMATCH,
      "网表证据目录包含缺失或未登记的额外文件。"
    );
  }
  const manifestPath = path.join(directory, "evidence.json");
  const netlistPath = path.join(directory, "official.enet");
  const [manifestState, netlistState] = await Promise.all([
    lstat(manifestPath).catch(() => undefined),
    lstat(netlistPath).catch(() => undefined)
  ]);
  if (
    manifestState === undefined ||
    !manifestState.isFile() ||
    manifestState.isSymbolicLink() ||
    manifestState.size < 1 ||
    manifestState.size > MAX_MANIFEST_BYTES ||
    (enforcesPosixModes() && (manifestState.mode & 0o077) !== 0) ||
    netlistState === undefined ||
    !netlistState.isFile() ||
    netlistState.isSymbolicLink() ||
    netlistState.size < 1 ||
    netlistState.size > MAX_NETLIST_BYTES ||
    (enforcesPosixModes() && (netlistState.mode & 0o077) !== 0)
  ) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      "网表证据文件缺失、不是私有普通文件或超过安全限额。"
    );
  }
  const manifestBytes = await readFile(manifestPath).catch(() => undefined);
  if (manifestBytes === undefined) {
    fail(ERROR_CODES.NETLIST_EVIDENCE_INVALID, "evidence.json 无法读取。");
  }
  let manifestPayload: string;
  try {
    manifestPayload = new TextDecoder("utf-8", { fatal: true }).decode(
      manifestBytes
    );
  } catch {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      "evidence.json 包含非法 UTF-8。"
    );
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestPayload) as unknown;
  } catch {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      "evidence.json 不是有效 JSON。"
    );
  }
  const manifest = parseManifest(rawManifest);
  if (`${canonicalJson(manifest)}\n` !== manifestPayload) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_INVALID,
      "evidence.json 不是规范 JSON + LF 编码。"
    );
  }
  const { evidenceSha256, ...base } = manifest;
  if (sha256CanonicalJson(base) !== evidenceSha256) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_MISMATCH,
      "证据总哈希与 evidence.json 内容不一致。"
    );
  }
  const actualNetlist = await inspectNetlist(netlistPath);
  if (
    actualNetlist.bytes !== manifest.netlist.bytes ||
    actualNetlist.sha256 !== manifest.netlist.sha256
  ) {
    fail(
      ERROR_CODES.NETLIST_EVIDENCE_MISMATCH,
      "official.enet 的大小或 SHA-256 与证据不一致。"
    );
  }
  return {
    ok: true,
    gate: "NETLIST_EVIDENCE_INTEGRITY_VERIFIED",
    evidenceSha256,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    archiveSha256: manifest.sourceProject.archiveSha256,
    irSha256: manifest.sourceProject.irSha256,
    netlistSha256: manifest.netlist.sha256,
    netlistBytes: manifest.netlist.bytes,
    files: 2,
    acquisitionMethod: manifest.acquisition.method,
    sourceAuthenticity: manifest.acquisition.sourceAuthenticity,
    projectBinding: manifest.acquisition.projectBinding,
    officialNetlistComparison: manifest.truth.officialNetlistComparison,
    electricalTruth: manifest.truth.electricalTruth
  };
}
