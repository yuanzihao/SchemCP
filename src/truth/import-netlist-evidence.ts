import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";
import { compileProject } from "../application/compile-project.js";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import {
  assertNoWindowsReparsePointAncestors,
  enforcesPosixModes,
  hasPathTraversalSegments
} from "../core/filesystem-security.js";
import type { EdaIr } from "../ir/model.js";

const MAX_NETLIST_BYTES = 16 * 1024 * 1024;

export interface ImportedNetlistEvidenceResult {
  readonly archiveSha256: string;
  readonly irSha256: string;
  readonly netlistSha256: string;
  readonly manifestSha256: string;
  readonly evidenceSha256: string;
  readonly netlistBytes: number;
  readonly outputBytes: number;
  readonly files: 2;
  readonly acquisitionMethod: "USER_PROVIDED_FILE";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly projectBinding: "USER_ASSERTED_NOT_VERIFIED";
  readonly officialNetlistComparison: "NOT_PERFORMED";
  readonly electricalTruth: "NOT_VERIFIED";
}

interface ImportedNetlistEvidenceManifest {
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

function isFileSystemError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return false;
    throw error;
  }
}

async function resolveOutputTarget(outputPath: string): Promise<string> {
  const parent = await realpath(path.dirname(path.resolve(outputPath)));
  return path.join(parent, path.basename(outputPath));
}

export async function readPrivateNetlist(
  inputPath: string,
  options: { readonly requireAbsolute?: boolean } = {}
): Promise<{
  readonly canonicalPath: string;
  readonly bytes: Buffer;
}> {
  if (
    inputPath === "" ||
    (options.requireAbsolute === true && !path.isAbsolute(inputPath)) ||
    hasPathTraversalSegments(inputPath) ||
    path.extname(inputPath).toLowerCase() !== ".enet"
  ) {
    throw new AppError(
      ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID,
      "网表证据输入必须使用 .enet 扩展名。"
    );
  }
  const requestedPath = path.resolve(inputPath);
  await assertNoWindowsReparsePointAncestors(
    requestedPath,
    (message, cause) => {
      throw new AppError(
        ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID,
        message,
        cause === undefined ? {} : { cause }
      );
    }
  );
  let state;
  try {
    state = await lstat(requestedPath);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID,
      "无法读取用户提供的 .enet 文件。",
      { cause: error }
    );
  }
  if (
    !state.isFile() ||
    state.isSymbolicLink() ||
    state.size < 1 ||
    state.size > MAX_NETLIST_BYTES
  ) {
    throw new AppError(
      state.size > MAX_NETLIST_BYTES
        ? ERROR_CODES.EASYEDA_NETLIST_TOO_LARGE
        : ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID,
      "用户提供的 .enet 必须是非空、非符号链接且不超过 16 MiB 的普通文件。"
    );
  }
  let handle;
  try {
    handle = await open(
      requestedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const openedState = await handle.stat();
    if (
      !openedState.isFile() ||
      openedState.size !== state.size ||
      openedState.size < 1 ||
      openedState.size > MAX_NETLIST_BYTES
    ) {
      throw new AppError(
        ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID,
        "读取期间 .enet 文件状态发生变化。"
      );
    }
    const bytes = await handle.readFile();
    if (bytes.length !== openedState.size) {
      throw new AppError(
        ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID,
        "读取期间 .enet 文件大小发生变化。"
      );
    }
    return {
      canonicalPath: await realpath(requestedPath),
      bytes
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID,
      "无法安全读取用户提供的 .enet 文件。",
      { cause: error }
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function createManifest(
  ir: EdaIr,
  netlist: Buffer
): ImportedNetlistEvidenceManifest {
  const base = {
    schemaVersion: "0.1.0" as const,
    generator: {
      name: "@yuanzihao/schemcp" as const,
      version: "0.1.0" as const
    },
    sourceProject: {
      archiveSha256: ir.source.archiveSha256,
      reducedStateSha256: ir.source.reducedStateSha256,
      irSha256: ir.irSha256
    },
    acquisition: {
      method: "USER_PROVIDED_FILE" as const,
      assertedFormat: "JLCEDA_PRO_ENET" as const,
      sourceAuthenticity: "NOT_VERIFIED" as const,
      projectBinding: "USER_ASSERTED_NOT_VERIFIED" as const
    },
    netlist: {
      fileName: "official.enet" as const,
      bytes: netlist.length,
      sha256: createHash("sha256").update(netlist).digest("hex")
    },
    truth: {
      syntaxAdapter: "NOT_IMPLEMENTED" as const,
      officialNetlistComparison: "NOT_PERFORMED" as const,
      electricalTruth: "NOT_VERIFIED" as const
    }
  };
  return {
    ...base,
    evidenceSha256: sha256CanonicalJson(base)
  };
}

async function writePrivateFile(
  targetPath: string,
  data: string | Uint8Array
): Promise<number> {
  const handle = await open(targetPath, "wx", 0o600);
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  return typeof data === "string"
    ? Buffer.byteLength(data, "utf8")
    : data.byteLength;
}

async function publishEvidence(
  projectPath: string,
  netlistPath: string,
  outputPath: string,
  manifest: ImportedNetlistEvidenceManifest,
  netlist: Buffer
): Promise<{
  readonly manifestSha256: string;
  readonly outputBytes: number;
}> {
  let canonicalProject: string;
  let canonicalOutput: string;
  try {
    [canonicalProject, canonicalOutput] = await Promise.all([
      realpath(projectPath),
      resolveOutputTarget(outputPath)
    ]);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.OUTPUT_WRITE_FAILED,
      "无法解析网表证据输出目录或输入工程路径。",
      { cause: error }
    );
  }
  if (
    canonicalOutput === canonicalProject ||
    canonicalOutput === netlistPath
  ) {
    throw new AppError(
      ERROR_CODES.OUTPUT_PATH_CONFLICT,
      "网表证据输出路径不能覆盖输入工程或 .enet 文件。"
    );
  }
  if (await exists(canonicalOutput)) {
    throw new AppError(
      ERROR_CODES.OUTPUT_EXISTS,
      "网表证据输出目录已存在；为避免破坏来源证据，不执行覆盖。"
    );
  }
  const temporaryPath = path.join(
    path.dirname(canonicalOutput),
    `.${path.basename(canonicalOutput)}.${process.pid}.${randomUUID()}.tmp`
  );
  let temporaryCreated = false;
  try {
    await mkdir(temporaryPath, { mode: 0o700 });
    temporaryCreated = true;
    const netlistBytes = await writePrivateFile(
      path.join(temporaryPath, "official.enet"),
      netlist
    );
    const manifestPayload = `${canonicalJson(manifest)}\n`;
    const manifestBytes = await writePrivateFile(
      path.join(temporaryPath, "evidence.json"),
      manifestPayload
    );
    if (
      enforcesPosixModes() &&
      ((await stat(temporaryPath)).mode & 0o777) !== 0o700
    ) {
      throw new AppError(
        ERROR_CODES.OUTPUT_WRITE_FAILED,
        "网表证据目录权限不符合 0700 要求。"
      );
    }
    await rename(temporaryPath, canonicalOutput);
    temporaryCreated = false;
    return {
      manifestSha256: createHash("sha256")
        .update(manifestPayload)
        .digest("hex"),
      outputBytes: netlistBytes + manifestBytes
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ERROR_CODES.OUTPUT_WRITE_FAILED,
      "写入网表证据目录失败。",
      { cause: error }
    );
  } finally {
    if (temporaryCreated) {
      await rm(temporaryPath, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }
}

export async function importNetlistEvidence(
  projectPath: string,
  netlistPath: string,
  outputPath: string
): Promise<ImportedNetlistEvidenceResult> {
  const [ir, input] = await Promise.all([
    compileProject(projectPath),
    readPrivateNetlist(netlistPath)
  ]);
  const manifest = createManifest(ir, input.bytes);
  const publication = await publishEvidence(
    projectPath,
    input.canonicalPath,
    outputPath,
    manifest,
    input.bytes
  );
  return {
    archiveSha256: ir.source.archiveSha256,
    irSha256: ir.irSha256,
    netlistSha256: manifest.netlist.sha256,
    manifestSha256: publication.manifestSha256,
    evidenceSha256: manifest.evidenceSha256,
    netlistBytes: manifest.netlist.bytes,
    outputBytes: publication.outputBytes,
    files: 2,
    acquisitionMethod: "USER_PROVIDED_FILE",
    sourceAuthenticity: "NOT_VERIFIED",
    projectBinding: "USER_ASSERTED_NOT_VERIFIED",
    officialNetlistComparison: "NOT_PERFORMED",
    electricalTruth: "NOT_VERIFIED"
  };
}
