#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";
import { compileProject } from "../application/compile-project.js";
import { inspectProject } from "../application/inspect-project.js";
import { writeIrFile } from "../application/write-ir.js";
import { verifyContextPack } from "../context-pack/verify-context-pack.js";
import { writeContextPack } from "../context-pack/write-context-pack.js";
import { AppError, toAppError } from "../core/error.js";
import {
  DOCUMENT_REFERENCE_KINDS,
  type DocumentReferenceBinding,
  type DocumentReferenceKind
} from "../datasheet/model.js";
import {
  importDocumentReference,
  verifyDatasheetStore
} from "../datasheet/store.js";
import {
  buildClaudeCodeMcpConfig,
  buildCodexMcpConfig,
  buildGenericMcpConfig,
  type McpClientKind,
  type McpClientPathMode
} from "../mcp/client-config.js";
import { readSchematicAssemblyManifest } from "../mcp/assembly-manifest.js";
import { MCP_SERVER_VERSION } from "../mcp/contract.js";
import {
  verifyNetlistComparisonReport,
  writeNetlistComparisonReport
} from "../truth/compare-netlist-evidence.js";
import { importNetlistEvidence } from "../truth/import-netlist-evidence.js";
import { verifyNetlistEvidence } from "../truth/verify-netlist-evidence.js";
const USAGE = `用法：
  schemcp inspect <工程.epro2> [--compact]
  schemcp compile <工程.epro2> --output <工程.eda-ir.json> [--compact] [--force]
  schemcp context-pack <工程.epro2> --output <工程.ai-context> [--compact]
  schemcp verify-context-pack <工程.ai-context> [--compact]
  schemcp import-netlist-evidence <工程.epro2> --netlist <用户导出.enet> --output <工程.truth-evidence> [--compact]
  schemcp verify-netlist-evidence <工程.truth-evidence> [--compact]
  schemcp compare-netlist <工程.epro2> --netlist <官方.enet> --output <比较报告.json> [--compact]
  schemcp verify-netlist-comparison <工程.epro2> --netlist <官方.enet> --report <比较报告.json> [--compact]
  schemcp import-datasheet-reference <数据手册.pdf> --store <私有数据表库> --kind <类型> (--part-master-id <ID> | --lcsc-part-id <C-ID> | --manufacturer <制造商> --mpn <料号>) [--title <标题>] [--document-number <文档号>] [--revision <修订>] [--published-date <发布日期>] [--source-url <HTTPS URL>] [--compact]
  schemcp verify-datasheet-store <私有数据表库> [--compact]
  schemcp verify-assembly-manifest <装配.schemcp-assembly.json> [--compact]
  schemcp mcp-config [绝对路径工程.epro2] --client <generic|codex|claude-code> [--portable] [--netlist <绝对路径网表.enet>] [--baseline-project <绝对路径基线工程.epro2>] [--datasheet-store <绝对路径数据表库>]

inspect 只输出脱敏结构摘要。
compile 会把包含工程事实的完整 EDA-IR 写入显式文件，默认拒绝覆盖。
context-pack 会把工程事实写入带哈希的 JSON/JSONL 私有目录，始终拒绝覆盖。
verify-context-pack 会独立校验清单、权限、规范编码和逐文件哈希。
import-netlist-evidence 会保存用户提供的 .enet 及工程哈希，但不会把用户声明升级为已验证来源或工程绑定。
verify-netlist-evidence 会独立校验用户网表证据的权限、固定文件、规范清单和原始字节哈希。
compare-netlist 会严格解析真实 .enet v2，并把候选元组、排除项和精确集合差异写入私有报告。
verify-netlist-comparison 会重新编译工程、解析 .enet 并逐字节复算比较报告。
import-datasheet-reference 会把本地 PDF 转为拒绝覆盖、带哈希的 DocumentReference；POSIX 强制 0700/0600，Windows 明确报告 ACL 未验证；PDF 元数据和文本不证明来源真实性或版面真值。
verify-datasheet-store 会独立校验固定文件、规范 JSON/JSONL、权限、PDF 魔数和逐文件哈希。
verify-assembly-manifest 会独立校验装配清单的严格字段、规范 SHA-256、工程哈希和已确认映射结构；不证明当前工程绑定或物理连接真值。
mcp-config 向 stdout 生成当前安装位置可用的客户端配置；generic 返回客户端无关的版本化 stdio 启动描述，codex 和 claude-code 返回对应配置外壳。省略工程时生成可直接打开对话附件的通用服务配置。--portable 仅用于兼容启动绑定。
所有命令都不会把“执行成功”等同于电气连接真值已通过。`;

function writeError(error: AppError): void {
  const payload = {
    ok: false,
    code: error.code,
    message: error.message,
    ...(error.source === undefined ? {} : { source: error.source }),
    ...(error.details === undefined ? {} : { details: error.details })
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeUsageError(message: string): number {
  process.stderr.write(`${message}\n${USAGE}\n`);
  return 64;
}

async function runInspect(inputPath: string, options: readonly string[]): Promise<number> {
  const unknownOption = options.find((option) => option !== "--compact");
  if (unknownOption !== undefined) {
    return writeUsageError(`未知选项：${unknownOption}`);
  }
  const inspection = await inspectProject(inputPath);
  const spacing = options.includes("--compact") ? 0 : 2;
  process.stdout.write(`${JSON.stringify(inspection, null, spacing)}\n`);
  return 0;
}

interface CompileOptions {
  readonly outputPath: string;
  readonly compact: boolean;
  readonly force: boolean;
}

function parseCompileOptions(options: readonly string[]): CompileOptions | number {
  let outputPath: string | undefined;
  let compact = false;
  let force = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--output") {
      if (outputPath !== undefined) {
        return writeUsageError("--output 只能指定一次。");
      }
      const value = options[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        return writeUsageError("--output 缺少目标文件路径。");
      }
      outputPath = value;
      index += 1;
    } else if (option === "--compact") {
      if (compact) {
        return writeUsageError("--compact 不能重复指定。");
      }
      compact = true;
    } else if (option === "--force") {
      if (force) {
        return writeUsageError("--force 不能重复指定。");
      }
      force = true;
    } else {
      return writeUsageError(`未知选项：${option ?? ""}`);
    }
  }
  if (outputPath === undefined) {
    return writeUsageError("compile 必须通过 --output 指定 IR 文件。");
  }
  return {
    outputPath,
    compact,
    force
  };
}

async function runCompile(inputPath: string, options: readonly string[]): Promise<number> {
  const parsed = parseCompileOptions(options);
  if (typeof parsed === "number") {
    return parsed;
  }
  const ir = await compileProject(inputPath);
  const writeResult = await writeIrFile(inputPath, parsed.outputPath, ir, parsed);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        gate: "P1_IR_COMPILED",
        electricalTruth: ir.source.electricalTruth,
        irSha256: ir.irSha256,
        outputBytes: writeResult.outputBytes,
        summary: ir.summary
      },
      null,
      parsed.compact ? 0 : 2
    )}\n`
  );
  return 0;
}

function parsePrivateDirectoryOptions(
  command: "context-pack",
  options: readonly string[]
): { readonly outputPath: string; readonly compact: boolean } | number {
  let outputPath: string | undefined;
  let compact = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--output") {
      if (outputPath !== undefined) {
        return writeUsageError("--output 只能指定一次。");
      }
      const value = options[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        return writeUsageError("--output 缺少目标目录路径。");
      }
      outputPath = value;
      index += 1;
    } else if (option === "--compact") {
      if (compact) {
        return writeUsageError("--compact 不能重复指定。");
      }
      compact = true;
    } else {
      return writeUsageError(`未知选项：${option ?? ""}`);
    }
  }
  if (outputPath === undefined) {
    return writeUsageError(
      `${command} 必须通过 --output 指定输出目录。`
    );
  }
  return { outputPath, compact };
}

async function runContextPack(
  inputPath: string,
  options: readonly string[]
): Promise<number> {
  const parsed = parsePrivateDirectoryOptions("context-pack", options);
  if (typeof parsed === "number") {
    return parsed;
  }
  const ir = await compileProject(inputPath);
  const result = await writeContextPack(inputPath, parsed.outputPath, ir);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        gate: "AI_CONTEXT_PACK_WRITTEN",
        electricalTruth: ir.source.electricalTruth,
        irSha256: ir.irSha256,
        ...result
      },
      null,
      parsed.compact ? 0 : 2
    )}\n`
  );
  return 0;
}

async function runVerifyContextPack(
  inputPath: string,
  options: readonly string[]
): Promise<number> {
  const unknownOption = options.find((option) => option !== "--compact");
  if (unknownOption !== undefined) {
    return writeUsageError(`未知选项：${unknownOption}`);
  }
  if (options.filter((option) => option === "--compact").length > 1) {
    return writeUsageError("--compact 不能重复指定。");
  }
  const result = await verifyContextPack(inputPath);
  process.stdout.write(
    `${JSON.stringify(
      result,
      null,
      options.includes("--compact") ? 0 : 2
    )}\n`
  );
  return 0;
}

interface ImportNetlistOptions {
  readonly netlistPath: string;
  readonly outputPath: string;
  readonly compact: boolean;
}

function parseImportNetlistOptions(
  options: readonly string[]
): ImportNetlistOptions | number {
  let netlistPath: string | undefined;
  let outputPath: string | undefined;
  let compact = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--netlist" || option === "--output") {
      const current = option === "--netlist" ? netlistPath : outputPath;
      if (current !== undefined) {
        return writeUsageError(`${option} 只能指定一次。`);
      }
      const value = options[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        return writeUsageError(`${option} 缺少文件路径。`);
      }
      if (option === "--netlist") {
        netlistPath = value;
      } else {
        outputPath = value;
      }
      index += 1;
    } else if (option === "--compact") {
      if (compact) {
        return writeUsageError("--compact 不能重复指定。");
      }
      compact = true;
    } else {
      return writeUsageError(`未知选项：${option ?? ""}`);
    }
  }
  if (netlistPath === undefined || outputPath === undefined) {
    return writeUsageError(
      "import-netlist-evidence 必须同时指定 --netlist 和 --output。"
    );
  }
  return { netlistPath, outputPath, compact };
}

async function runImportNetlistEvidence(
  inputPath: string,
  options: readonly string[]
): Promise<number> {
  const parsed = parseImportNetlistOptions(options);
  if (typeof parsed === "number") return parsed;
  const result = await importNetlistEvidence(
    inputPath,
    parsed.netlistPath,
    parsed.outputPath
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        gate: "NETLIST_EVIDENCE_IMPORTED",
        ...result
      },
      null,
      parsed.compact ? 0 : 2
    )}\n`
  );
  return 0;
}

async function runVerifyNetlistEvidence(
  inputPath: string,
  options: readonly string[]
): Promise<number> {
  const unknownOption = options.find((option) => option !== "--compact");
  if (unknownOption !== undefined) {
    return writeUsageError(`未知选项：${unknownOption}`);
  }
  if (options.filter((option) => option === "--compact").length > 1) {
    return writeUsageError("--compact 不能重复指定。");
  }
  const result = await verifyNetlistEvidence(inputPath);
  process.stdout.write(
    `${JSON.stringify(
      result,
      null,
      options.includes("--compact") ? 0 : 2
    )}\n`
  );
  return 0;
}

interface CompareNetlistOptions {
  readonly netlistPath: string;
  readonly reportPath: string;
  readonly compact: boolean;
}

function parseCompareNetlistOptions(
  command: "compare-netlist" | "verify-netlist-comparison",
  options: readonly string[]
): CompareNetlistOptions | number {
  let netlistPath: string | undefined;
  let reportPath: string | undefined;
  let compact = false;
  const reportOption =
    command === "compare-netlist" ? "--output" : "--report";
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--netlist" || option === reportOption) {
      const current = option === "--netlist" ? netlistPath : reportPath;
      if (current !== undefined) {
        return writeUsageError(`${option} 只能指定一次。`);
      }
      const value = options[index + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        return writeUsageError(`${option} 缺少文件路径。`);
      }
      if (option === "--netlist") {
        netlistPath = value;
      } else {
        reportPath = value;
      }
      index += 1;
    } else if (option === "--compact") {
      if (compact) {
        return writeUsageError("--compact 不能重复指定。");
      }
      compact = true;
    } else {
      return writeUsageError(`未知选项：${option ?? ""}`);
    }
  }
  if (netlistPath === undefined || reportPath === undefined) {
    return writeUsageError(
      `${command} 必须同时指定 --netlist 和 ${reportOption}。`
    );
  }
  return { netlistPath, reportPath, compact };
}

async function runCompareNetlist(
  inputPath: string,
  options: readonly string[]
): Promise<number> {
  const parsed = parseCompareNetlistOptions("compare-netlist", options);
  if (typeof parsed === "number") return parsed;
  const result = await writeNetlistComparisonReport(
    inputPath,
    parsed.netlistPath,
    parsed.reportPath
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        gate: "NETLIST_COMPARISON_WRITTEN",
        ...result
      },
      null,
      parsed.compact ? 0 : 2
    )}\n`
  );
  return 0;
}

async function runVerifyNetlistComparison(
  inputPath: string,
  options: readonly string[]
): Promise<number> {
  const parsed = parseCompareNetlistOptions(
    "verify-netlist-comparison",
    options
  );
  if (typeof parsed === "number") return parsed;
  const result = await verifyNetlistComparisonReport(
    inputPath,
    parsed.netlistPath,
    parsed.reportPath
  );
  process.stdout.write(
    `${JSON.stringify(result, null, parsed.compact ? 0 : 2)}\n`
  );
  return 0;
}

interface McpConfigOptions {
  readonly client: McpClientKind;
  readonly pathMode: McpClientPathMode;
  readonly netlistPath?: string;
  readonly baselineProjectPath?: string;
  readonly datasheetStorePath?: string;
}

function parseMcpConfigOptions(
  options: readonly string[]
): McpConfigOptions | number {
  let client: McpClientKind | undefined;
  let netlistPath: string | undefined;
  let baselineProjectPath: string | undefined;
  let datasheetStorePath: string | undefined;
  let portable = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = options[index + 1];
    if (option === "--portable") {
      if (portable) {
        return writeUsageError("--portable 不能重复指定。");
      }
      portable = true;
    } else if (option === "--client") {
      if (
        client !== undefined ||
        (value !== "generic" &&
          value !== "codex" &&
          value !== "claude-code")
      ) {
        return writeUsageError(
          "--client 只能指定一次，并使用 generic、codex 或 claude-code。"
        );
      }
      client = value;
      index += 1;
    } else if (option === "--netlist") {
      if (
        netlistPath !== undefined ||
        value === undefined ||
        value === "" ||
        value.startsWith("--")
      ) {
        return writeUsageError(
          "--netlist 只能指定一次，并提供绝对 .enet 路径。"
        );
      }
      netlistPath = value;
      index += 1;
    } else if (option === "--baseline-project") {
      if (
        baselineProjectPath !== undefined ||
        value === undefined ||
        value === "" ||
        value.startsWith("--")
      ) {
        return writeUsageError(
          "--baseline-project 只能指定一次，并提供绝对 .epro2 路径。"
        );
      }
      baselineProjectPath = value;
      index += 1;
    } else if (option === "--datasheet-store") {
      if (
        datasheetStorePath !== undefined ||
        value === undefined ||
        value === "" ||
        value.startsWith("--")
      ) {
        return writeUsageError(
          "--datasheet-store 只能指定一次，并提供绝对目录路径。"
        );
      }
      datasheetStorePath = value;
      index += 1;
    } else {
      return writeUsageError(`未知选项：${option ?? ""}`);
    }
  }
  if (client === undefined) {
    return writeUsageError(
      "mcp-config 必须指定 --client generic、--client codex 或 --client claude-code。"
    );
  }
  return {
    client,
    pathMode: portable ? "environment" : "arguments",
    ...(netlistPath === undefined ? {} : { netlistPath }),
    ...(baselineProjectPath === undefined
      ? {}
      : { baselineProjectPath }),
    ...(datasheetStorePath === undefined
      ? {}
      : { datasheetStorePath })
  };
}

function runMcpConfig(
  inputPath: string | undefined,
  options: readonly string[]
): number {
  const parsed = parseMcpConfigOptions(options);
  if (typeof parsed === "number") {
    return parsed;
  }
  const serverEntry = fileURLToPath(
    new URL("../mcp/main.js", import.meta.url)
  );
  const configInput = {
    command: process.execPath,
    serverEntry,
    ...(inputPath === undefined ? {} : { projectPath: inputPath }),
    pathMode: parsed.pathMode,
    ...(parsed.netlistPath === undefined
      ? {}
      : { netlistPath: parsed.netlistPath }),
    ...(parsed.baselineProjectPath === undefined
      ? {}
      : { baselineProjectPath: parsed.baselineProjectPath }),
    ...(parsed.datasheetStorePath === undefined
      ? {}
      : { datasheetStorePath: parsed.datasheetStorePath })
  };
  let config: string;
  try {
    config =
      parsed.client === "generic"
        ? buildGenericMcpConfig(configInput)
        : parsed.client === "codex"
          ? buildCodexMcpConfig(configInput)
          : buildClaudeCodeMcpConfig(configInput);
  } catch (error) {
    return writeUsageError(
      error instanceof Error ? error.message : "MCP 配置参数无效。"
    );
  }
  process.stdout.write(config);
  return 0;
}

interface ImportDatasheetOptions {
  readonly storePath: string;
  readonly kind: DocumentReferenceKind;
  readonly binding: DocumentReferenceBinding;
  readonly compact: boolean;
  readonly title?: string;
  readonly documentNumber?: string;
  readonly revision?: string;
  readonly publishedDate?: string;
  readonly sourceUrl?: string;
}

function parseImportDatasheetOptions(
  options: readonly string[]
): ImportDatasheetOptions | number {
  const values = new Map<string, string>();
  let compact = false;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--compact") {
      if (compact) return writeUsageError("--compact 不能重复指定。");
      compact = true;
      continue;
    }
    if (
      ![
        "--store",
        "--kind",
        "--part-master-id",
        "--lcsc-part-id",
        "--manufacturer",
        "--mpn",
        "--title",
        "--document-number",
        "--revision",
        "--published-date",
        "--source-url"
      ].includes(option ?? "")
    ) {
      return writeUsageError(`未知选项：${option ?? ""}`);
    }
    const value = options[index + 1];
    if (
      value === undefined ||
      value === "" ||
      value.startsWith("--") ||
      values.has(option!)
    ) {
      return writeUsageError(`${option ?? ""} 只能指定一次且必须提供值。`);
    }
    values.set(option!, value);
    index += 1;
  }
  const storePath = values.get("--store");
  const kind = values.get("--kind");
  if (
    storePath === undefined ||
    kind === undefined ||
    !DOCUMENT_REFERENCE_KINDS.includes(kind as DocumentReferenceKind)
  ) {
    return writeUsageError(
      `必须指定 --store 和合法 --kind：${DOCUMENT_REFERENCE_KINDS.join("|")}。`
    );
  }
  const partMasterId = values.get("--part-master-id");
  const lcscPartId = values.get("--lcsc-part-id");
  const manufacturer = values.get("--manufacturer");
  const manufacturerPart = values.get("--mpn");
  const identityMethods =
    Number(partMasterId !== undefined) +
    Number(lcscPartId !== undefined) +
    Number(manufacturer !== undefined || manufacturerPart !== undefined);
  if (
    identityMethods !== 1 ||
    ((manufacturer === undefined) !== (manufacturerPart === undefined))
  ) {
    return writeUsageError(
      "必须且只能选择一种绑定：--part-master-id、--lcsc-part-id，或同时指定 --manufacturer 与 --mpn。"
    );
  }
  const binding: DocumentReferenceBinding =
    partMasterId !== undefined
      ? { method: "PART_MASTER_ID", partMasterId }
      : lcscPartId !== undefined
        ? { method: "EXACT_LCSC_PART_ID", lcscPartId }
        : {
            method: "EXACT_MANUFACTURER_AND_MPN",
            manufacturer: manufacturer!,
            manufacturerPart: manufacturerPart!
          };
  return {
    storePath,
    kind: kind as DocumentReferenceKind,
    binding,
    compact,
    ...(values.get("--title") === undefined
      ? {}
      : { title: values.get("--title")! }),
    ...(values.get("--document-number") === undefined
      ? {}
      : { documentNumber: values.get("--document-number")! }),
    ...(values.get("--revision") === undefined
      ? {}
      : { revision: values.get("--revision")! }),
    ...(values.get("--published-date") === undefined
      ? {}
      : { publishedDate: values.get("--published-date")! }),
    ...(values.get("--source-url") === undefined
      ? {}
      : { sourceUrl: values.get("--source-url")! })
  };
}

async function runImportDatasheetReference(
  pdfPath: string,
  options: readonly string[]
): Promise<number> {
  const parsed = parseImportDatasheetOptions(options);
  if (typeof parsed === "number") return parsed;
  const result = await importDocumentReference({
    pdfPath,
    storePath: parsed.storePath,
    kind: parsed.kind,
    binding: parsed.binding,
    ...(parsed.title === undefined ? {} : { title: parsed.title }),
    ...(parsed.documentNumber === undefined
      ? {}
      : { documentNumber: parsed.documentNumber }),
    ...(parsed.revision === undefined
      ? {}
      : { revision: parsed.revision }),
    ...(parsed.publishedDate === undefined
      ? {}
      : { publishedDate: parsed.publishedDate }),
    ...(parsed.sourceUrl === undefined
      ? {}
      : { sourceUrl: parsed.sourceUrl })
  });
  process.stdout.write(
    `${JSON.stringify({ ok: true, ...result }, null, parsed.compact ? 0 : 2)}\n`
  );
  return 0;
}

async function runVerifyDatasheetStore(
  storePath: string,
  options: readonly string[]
): Promise<number> {
  const unknown = options.find((option) => option !== "--compact");
  if (
    unknown !== undefined ||
    options.filter((option) => option === "--compact").length > 1
  ) {
    return writeUsageError(
      unknown === undefined ? "--compact 不能重复指定。" : `未知选项：${unknown}`
    );
  }
  const result = await verifyDatasheetStore(storePath);
  process.stdout.write(
    `${JSON.stringify(result, null, options.includes("--compact") ? 0 : 2)}\n`
  );
  return 0;
}

async function runVerifyAssemblyManifest(
  manifestPath: string,
  options: readonly string[]
): Promise<number> {
  const unknown = options.find((option) => option !== "--compact");
  if (
    unknown !== undefined ||
    options.filter((option) => option === "--compact").length > 1
  ) {
    return writeUsageError(
      unknown === undefined ? "--compact 不能重复指定。" : `未知选项：${unknown}`
    );
  }
  const { manifest, bytes } =
    await readSchematicAssemblyManifest(manifestPath);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        gate: "SCHEMATIC_ASSEMBLY_MANIFEST_VERIFIED",
        schema: manifest.schema,
        schemaVersion: manifest.schemaVersion,
        manifestSha256: manifest.manifestSha256,
        inputBytes: bytes,
        projectCount: manifest.projects.length,
        interconnectCount: manifest.assembly.interconnects.length,
        relationshipTruth: manifest.assembly.relationshipTruth,
        electricalTruth: "NOT_VERIFIED"
      },
      null,
      options.includes("--compact") ? 0 : 2
    )}\n`
  );
  return 0;
}

async function main(): Promise<number> {
  const [command, ...argumentsAfterCommand] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (command === "--version" || command === "-V") {
    process.stdout.write(`${MCP_SERVER_VERSION}\n`);
    return 0;
  }
  if (command === "mcp-config") {
    const first = argumentsAfterCommand[0];
    const inputPath =
      first !== undefined && !first.startsWith("--")
        ? first
        : undefined;
    const options =
      inputPath === undefined
        ? argumentsAfterCommand
        : argumentsAfterCommand.slice(1);
    return runMcpConfig(inputPath, options);
  }
  const [inputPath, ...options] = argumentsAfterCommand;
  if (inputPath === undefined) {
    return writeUsageError("缺少输入工程路径。");
  }
  if (command === "inspect") {
    return await runInspect(inputPath, options);
  }
  if (command === "import-datasheet-reference") {
    return await runImportDatasheetReference(inputPath, options);
  }
  if (command === "verify-datasheet-store") {
    return await runVerifyDatasheetStore(inputPath, options);
  }
  if (command === "verify-assembly-manifest") {
    return await runVerifyAssemblyManifest(inputPath, options);
  }
  if (command === "compile") {
    return await runCompile(inputPath, options);
  }
  if (command === "context-pack") {
    return await runContextPack(inputPath, options);
  }
  if (command === "verify-context-pack") {
    return await runVerifyContextPack(inputPath, options);
  }
  if (command === "import-netlist-evidence") {
    return await runImportNetlistEvidence(inputPath, options);
  }
  if (command === "verify-netlist-evidence") {
    return await runVerifyNetlistEvidence(inputPath, options);
  }
  if (command === "compare-netlist") {
    return await runCompareNetlist(inputPath, options);
  }
  if (command === "verify-netlist-comparison") {
    return await runVerifyNetlistComparison(inputPath, options);
  }
  return writeUsageError(`未知命令：${command}`);
}

try {
  process.exitCode = await main();
} catch (error) {
  const appError = toAppError(error);
  writeError(appError);
  process.exitCode =
    appError.code === "INTERNAL_ERROR"
      ? 70
      : 2;
}
