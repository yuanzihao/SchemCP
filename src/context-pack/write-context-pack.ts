import { createHash, randomUUID } from "node:crypto";
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
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import { enforcesPosixModes } from "../core/filesystem-security.js";
import type { EdaIr } from "../ir/model.js";
import { EdaIrQueryIndex } from "../query/index.js";
import type {
  ContextPackFileReceipt,
  ContextPackManifest,
  ContextPackWriteResult
} from "./model.js";

interface JsonFileDefinition {
  readonly path: string;
  readonly mediaType: "application/json";
  readonly value: unknown;
}

interface JsonlFileDefinition {
  readonly path: string;
  readonly mediaType: "application/x-ndjson";
  readonly values: readonly unknown[];
}

type ContextFileDefinition = JsonFileDefinition | JsonlFileDefinition;

async function exists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function resolveOutputTarget(outputPath: string): Promise<string> {
  const parent = await realpath(path.dirname(path.resolve(outputPath)));
  return path.join(parent, path.basename(outputPath));
}

function allExplicitNets(ir: EdaIr): readonly unknown[] {
  const index = new EdaIrQueryIndex(ir);
  const result: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = index.listExplicitNets({
      limit: 50,
      ...(cursor === undefined ? {} : { cursor })
    });
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return result;
}

function definitions(ir: EdaIr): readonly ContextFileDefinition[] {
  return [
    {
      path: "project-summary.json",
      mediaType: "application/json",
      value: {
        irSchemaVersion: ir.schemaVersion,
        generator: ir.generator,
        source: ir.source,
        irSha256: ir.irSha256,
        summary: ir.summary
      }
    },
    {
      path: "hierarchy.json",
      mediaType: "application/json",
      value: {
        projectConfigurations: ir.projectConfigurations,
        boards: ir.boards,
        schematics: ir.schematics,
        schematicPages: ir.schematicPages
      }
    },
    {
      path: "documents.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.documents
    },
    {
      path: "variants.json",
      mediaType: "application/json",
      value: {
        variants: ir.variants,
        componentGroups: ir.componentGroups,
        applicationTruth: "TARGET_RESOLUTION_NOT_VERIFIED"
      }
    },
    {
      path: "components.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.components
    },
    {
      path: "schematic-annotations.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.schematicAnnotations
    },
    {
      path: "schematic-graphic-primitives.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.schematicGraphicPrimitives
    },
    {
      path: "schematic-tables.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.schematicTables
    },
    {
      path: "component-pins.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.pinInstances
    },
    {
      path: "devices.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.devices
    },
    {
      path: "symbols.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.symbols
    },
    {
      path: "symbol-parts.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.symbolParts
    },
    {
      path: "symbol-texts.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.symbolTexts
    },
    {
      path: "symbol-pins.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.symbolPins
    },
    {
      path: "wires.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.wires
    },
    {
      path: "explicit-nets.jsonl",
      mediaType: "application/x-ndjson",
      values: allExplicitNets(ir)
    },
    {
      path: "instance-contexts.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.instanceContexts
    },
    {
      path: "diagnostics.json",
      mediaType: "application/json",
      value: {
        diagnostics: ir.diagnostics,
        unboundAttributeCount: ir.unboundAttributes.length,
        unmodeledRecordCount: ir.unmodeledRecords.length
      }
    },
    {
      path: "unbound-attributes.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.unboundAttributes
    },
    {
      path: "unmodeled-records.jsonl",
      mediaType: "application/x-ndjson",
      values: ir.unmodeledRecords
    }
  ];
}

async function writeDefinition(
  directory: string,
  definition: ContextFileDefinition
): Promise<ContextPackFileReceipt> {
  const target = path.join(directory, definition.path);
  const handle = await open(target, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  let records = 0;
  const append = async (text: string): Promise<void> => {
    const chunk = Buffer.from(text, "utf8");
    let offset = 0;
    while (offset < chunk.length) {
      const { bytesWritten } = await handle.write(
        chunk,
        offset,
        chunk.length - offset
      );
      if (bytesWritten === 0) {
        throw new Error("上下文包文件写入未取得进展。");
      }
      offset += bytesWritten;
    }
    hash.update(chunk);
    bytes += chunk.length;
  };
  try {
    if (definition.mediaType === "application/json") {
      await append(`${canonicalJson(definition.value)}\n`);
      records = 1;
    } else {
      for (const value of definition.values) {
        await append(`${canonicalJson(value)}\n`);
        records += 1;
      }
    }
  } finally {
    await handle.close();
  }
  return {
    path: definition.path,
    mediaType: definition.mediaType,
    bytes,
    records,
    sha256: hash.digest("hex")
  };
}

function createManifest(
  ir: EdaIr,
  files: readonly ContextPackFileReceipt[]
): ContextPackManifest {
  const payloadBytes = files.reduce((total, file) => total + file.bytes, 0);
  const base = {
    schemaVersion: "1.0.0" as const,
    generator: {
      name: "@yuanzihao/schemcp" as const,
      version: "0.1.0" as const
    },
    source: {
      format: ir.source.format,
      archiveSha256: ir.source.archiveSha256,
      reducedStateSha256: ir.source.reducedStateSha256,
      irSha256: ir.irSha256,
      electricalTruth: ir.source.electricalTruth
    },
    encoding: {
      json: "CANONICAL_JSON_LF" as const,
      jsonl: "ONE_CANONICAL_JSON_VALUE_PER_LF_LINE" as const
    },
    capabilities: {
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
    },
    files,
    payloadBytes
  };
  return {
    ...base,
    packageSha256: sha256CanonicalJson(base)
  };
}

/**
 * 将完整私有工程事实发布成适合局部读取的确定性 AI 上下文目录。
 * 目标目录必须不存在；POSIX 下文件为 0600、目录为 0700，并通过同级临时目录原子发布。
 * Windows 仍使用排他创建和规范路径，但不得把 chmod 结果冒充 ACL 保证。
 */
export async function writeContextPack(
  inputPath: string,
  outputPath: string,
  ir: EdaIr
): Promise<ContextPackWriteResult> {
  let canonicalInput: string;
  let canonicalOutput: string;
  try {
    [canonicalInput, canonicalOutput] = await Promise.all([
      realpath(inputPath),
      resolveOutputTarget(outputPath)
    ]);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.OUTPUT_WRITE_FAILED,
      "无法解析上下文包输出目录或输入工程路径。",
      { cause: error }
    );
  }
  if (canonicalInput === canonicalOutput) {
    throw new AppError(
      ERROR_CODES.OUTPUT_PATH_CONFLICT,
      "上下文包输出路径不能指向输入工程文件。"
    );
  }
  if (await exists(canonicalOutput)) {
    throw new AppError(
      ERROR_CODES.OUTPUT_EXISTS,
      "上下文包输出目录已存在；为避免破坏历史版本，不执行覆盖。"
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
    const files: ContextPackFileReceipt[] = [];
    for (const definition of definitions(ir)) {
      files.push(await writeDefinition(temporaryPath, definition));
    }
    const manifest = createManifest(ir, files);
    const manifestPayload = `${canonicalJson(manifest)}\n`;
    const manifestPath = path.join(temporaryPath, "manifest.json");
    const manifestHandle = await open(manifestPath, "wx", 0o600);
    try {
      await manifestHandle.writeFile(manifestPayload, "utf8");
    } finally {
      await manifestHandle.close();
    }
    const outputDirectoryMode = (await stat(temporaryPath)).mode & 0o777;
    if (enforcesPosixModes() && outputDirectoryMode !== 0o700) {
      throw new AppError(
        ERROR_CODES.OUTPUT_WRITE_FAILED,
        "上下文包目录权限不符合 0700 要求。"
      );
    }
    await rename(temporaryPath, canonicalOutput);
    temporaryCreated = false;
    return {
      packageSha256: manifest.packageSha256,
      manifestSha256: createHash("sha256")
        .update(manifestPayload)
        .digest("hex"),
      payloadBytes: manifest.payloadBytes,
      outputBytes:
        manifest.payloadBytes + Buffer.byteLength(manifestPayload, "utf8"),
      files: manifest.files.length + 1,
      records: manifest.files.reduce(
        (total, file) => total + file.records,
        0
      )
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      ERROR_CODES.OUTPUT_WRITE_FAILED,
      "写入 AI 上下文包失败。",
      { cause: error }
    );
  } finally {
    if (temporaryCreated) {
      try {
        await rm(temporaryPath, { recursive: true, force: true });
      } catch {
        // 临时目录清理不能覆盖原始写入错误。
      }
    }
  }
}
