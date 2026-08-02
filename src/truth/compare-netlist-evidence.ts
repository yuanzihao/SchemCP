import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  unlink
} from "node:fs/promises";
import path from "node:path";
import { compileProject } from "../application/compile-project.js";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import { enforcesPosixModes } from "../core/filesystem-security.js";
import type { EdaIr } from "../ir/model.js";
import {
  compareNetlistTupleSets,
  compileResolvedCandidateNetlistTuples,
  type CandidateTupleCompilation,
  type NetlistTupleComparison
} from "../validation/netlist-tuples.js";
import { readPrivateNetlist } from "./import-netlist-evidence.js";
import {
  parseJlcEdaProEnet,
  type JlcEdaProEnet
} from "./jlceda-pro-enet.js";

const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const GENERATOR_VERSION = "0.2.0";

export interface NetlistComparisonReport {
  readonly schemaVersion: "0.1.0";
  readonly generator: {
    readonly name: "@yuanzihao/schemcp";
    readonly version: "0.2.0";
  };
  readonly sourceProject: {
    readonly archiveSha256: string;
    readonly reducedStateSha256: string;
    readonly irSha256: string;
  };
  readonly netlist: {
    readonly format: "JLCEDA_PRO_ENET";
    readonly formatVersion: "2.0.0";
    readonly bytes: number;
    readonly sha256: string;
    readonly componentCount: number;
    readonly pinEntryCount: number;
    readonly connectedPinEntryCount: number;
    readonly unconnectedPinEntryCount: number;
    readonly tupleCount: number;
  };
  readonly candidateCompilation: CandidateTupleCompilation;
  readonly comparison: NetlistTupleComparison;
  readonly gates: {
    readonly syntaxAdapter: "JLCEDA_PRO_ENET_V2_COMPONENTS_PARSED";
    readonly sourceAuthenticity: "NOT_VERIFIED";
    readonly projectBinding: "NOT_VERIFIED";
    readonly officialNetlistComparison:
      | "EXACT_SET_MATCH"
      | "DIFFERENCES_FOUND"
      | "DUPLICATE_TUPLES";
    readonly candidateExclusions: "NONE" | "PRESENT";
    readonly electricalTruth: "NOT_VERIFIED";
  };
  readonly reportSha256: string;
}

export interface NetlistComparisonReceipt {
  readonly reportSha256: string;
  readonly reportBytes: number;
  readonly archiveSha256: string;
  readonly irSha256: string;
  readonly netlistSha256: string;
  readonly candidateTupleCount: number;
  readonly truthTupleCount: number;
  readonly matchedTupleCount: number;
  readonly missingInCandidateCount: number;
  readonly unexpectedCandidateCount: number;
  readonly excludedCandidatePinCount: number;
  readonly officialNetlistComparison:
    | "EXACT_SET_MATCH"
    | "DIFFERENCES_FOUND"
    | "DUPLICATE_TUPLES";
  readonly sourceAuthenticity: "NOT_VERIFIED";
  readonly projectBinding: "NOT_VERIFIED";
  readonly electricalTruth: "NOT_VERIFIED";
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

export function buildNetlistComparisonReport(
  ir: EdaIr,
  netlistBytes: Buffer,
  parsed: JlcEdaProEnet = parseJlcEdaProEnet(netlistBytes)
): NetlistComparisonReport {
  const candidateCompilation = compileResolvedCandidateNetlistTuples(
    ir.pinInstances,
    ir.shortRelations,
    ir.networkEndpointCandidates,
    ir.schematicPages
  );
  const comparison = compareNetlistTupleSets(
    candidateCompilation.tuples.map((item) => item.tuple),
    parsed.tuples
  );
  const base = {
    schemaVersion: "0.1.0" as const,
    generator: {
      name: "@yuanzihao/schemcp" as const,
      version: GENERATOR_VERSION as "0.2.0"
    },
    sourceProject: {
      archiveSha256: ir.source.archiveSha256,
      reducedStateSha256: ir.source.reducedStateSha256,
      irSha256: ir.irSha256
    },
    netlist: {
      format: parsed.format,
      formatVersion: parsed.formatVersion,
      bytes: netlistBytes.length,
      sha256: createHash("sha256").update(netlistBytes).digest("hex"),
      componentCount: parsed.componentCount,
      pinEntryCount: parsed.pinEntryCount,
      connectedPinEntryCount: parsed.connectedPinEntryCount,
      unconnectedPinEntryCount: parsed.unconnectedPinEntryCount,
      tupleCount: parsed.tupleCount
    },
    candidateCompilation,
    comparison,
    gates: {
      syntaxAdapter: "JLCEDA_PRO_ENET_V2_COMPONENTS_PARSED" as const,
      sourceAuthenticity: "NOT_VERIFIED" as const,
      projectBinding: "NOT_VERIFIED" as const,
      officialNetlistComparison: comparison.status,
      candidateExclusions:
        candidateCompilation.exclusions.length === 0
          ? ("NONE" as const)
          : ("PRESENT" as const),
      electricalTruth: "NOT_VERIFIED" as const
    }
  };
  return {
    ...base,
    reportSha256: sha256CanonicalJson(base)
  };
}

async function buildReport(
  projectPath: string,
  netlistPath: string
): Promise<NetlistComparisonReport> {
  const [ir, netlist] = await Promise.all([
    compileProject(projectPath),
    readPrivateNetlist(netlistPath)
  ]);
  return buildNetlistComparisonReport(ir, netlist.bytes);
}

function receipt(
  report: NetlistComparisonReport,
  reportBytes: number
): NetlistComparisonReceipt {
  return {
    reportSha256: report.reportSha256,
    reportBytes,
    archiveSha256: report.sourceProject.archiveSha256,
    irSha256: report.sourceProject.irSha256,
    netlistSha256: report.netlist.sha256,
    candidateTupleCount: report.comparison.candidateTupleCount,
    truthTupleCount: report.comparison.truthTupleCount,
    matchedTupleCount: report.comparison.matched.length,
    missingInCandidateCount: report.comparison.missingInCandidate.length,
    unexpectedCandidateCount: report.comparison.unexpectedCandidate.length,
    excludedCandidatePinCount:
      report.candidateCompilation.summary.excludedPinInstances,
    officialNetlistComparison: report.comparison.status,
    sourceAuthenticity: "NOT_VERIFIED",
    projectBinding: "NOT_VERIFIED",
    electricalTruth: "NOT_VERIFIED"
  };
}

async function publishReport(
  projectPath: string,
  netlistPath: string,
  outputPath: string,
  report: NetlistComparisonReport
): Promise<number> {
  let canonicalProject: string;
  let canonicalNetlist: string;
  let canonicalOutput: string;
  try {
    [canonicalProject, canonicalNetlist, canonicalOutput] = await Promise.all([
      realpath(projectPath),
      realpath(netlistPath),
      resolveOutputTarget(outputPath)
    ]);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.OUTPUT_WRITE_FAILED,
      "无法解析网表比较报告的输入或输出路径。",
      { cause: error }
    );
  }
  if (
    canonicalOutput === canonicalProject ||
    canonicalOutput === canonicalNetlist
  ) {
    throw new AppError(
      ERROR_CODES.OUTPUT_PATH_CONFLICT,
      "网表比较报告不能覆盖输入工程或 .enet 文件。"
    );
  }
  if (await exists(canonicalOutput)) {
    throw new AppError(
      ERROR_CODES.OUTPUT_EXISTS,
      "网表比较报告已存在；为保留验证证据，不执行覆盖。"
    );
  }
  const payload = `${canonicalJson(report)}\n`;
  const temporaryPath = path.join(
    path.dirname(canonicalOutput),
    `.${path.basename(canonicalOutput)}.${process.pid}.${randomUUID()}.tmp`
  );
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(payload, "utf8");
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, canonicalOutput);
    } catch (error) {
      if (isFileSystemError(error, "EEXIST")) {
        throw new AppError(
          ERROR_CODES.OUTPUT_EXISTS,
          "网表比较报告在发布期间已存在，未执行覆盖。"
        );
      }
      throw error;
    }
    await unlink(temporaryPath);
    temporaryCreated = false;
    return Buffer.byteLength(payload, "utf8");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ERROR_CODES.OUTPUT_WRITE_FAILED,
      "写入网表比较报告失败。",
      { cause: error }
    );
  } finally {
    if (temporaryCreated) {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

async function readReport(reportPath: string): Promise<{
  readonly payload: string;
  readonly bytes: number;
}> {
  const requestedPath = path.resolve(reportPath);
  let state;
  try {
    state = await lstat(requestedPath);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.NETLIST_COMPARISON_INVALID,
      "无法读取网表比较报告。",
      { cause: error }
    );
  }
  if (
    !state.isFile() ||
    state.isSymbolicLink() ||
    state.size < 1 ||
    state.size > MAX_REPORT_BYTES ||
    (enforcesPosixModes() && (state.mode & 0o077) !== 0)
  ) {
    throw new AppError(
      ERROR_CODES.NETLIST_COMPARISON_INVALID,
      "网表比较报告必须是私有、非空、非符号链接且不超过 64 MiB 的普通文件。"
    );
  }
  let handle;
  try {
    handle = await open(
      requestedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const bytes = await handle.readFile();
    if (bytes.length !== state.size) {
      throw new AppError(
        ERROR_CODES.NETLIST_COMPARISON_INVALID,
        "读取期间网表比较报告大小发生变化。"
      );
    }
    const payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { payload, bytes: bytes.length };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ERROR_CODES.NETLIST_COMPARISON_INVALID,
      "网表比较报告不是可安全读取的 UTF-8 文件。",
      { cause: error }
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeNetlistComparisonReport(
  projectPath: string,
  netlistPath: string,
  outputPath: string
): Promise<NetlistComparisonReceipt> {
  const report = await buildReport(projectPath, netlistPath);
  const reportBytes = await publishReport(
    projectPath,
    netlistPath,
    outputPath,
    report
  );
  return receipt(report, reportBytes);
}

export async function verifyNetlistComparisonReport(
  projectPath: string,
  netlistPath: string,
  reportPath: string
): Promise<
  NetlistComparisonReceipt & {
    readonly ok: true;
    readonly gate: "NETLIST_COMPARISON_RECOMPUTED";
  }
> {
  const [expected, stored] = await Promise.all([
    buildReport(projectPath, netlistPath),
    readReport(reportPath)
  ]);
  const expectedPayload = `${canonicalJson(expected)}\n`;
  if (stored.payload !== expectedPayload) {
    throw new AppError(
      ERROR_CODES.NETLIST_COMPARISON_MISMATCH,
      "网表比较报告与当前工程、.enet 或适配器复算结果不一致。"
    );
  }
  return {
    ok: true,
    gate: "NETLIST_COMPARISON_RECOMPUTED",
    ...receipt(expected, stored.bytes)
  };
}
