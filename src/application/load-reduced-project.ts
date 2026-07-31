import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import {
  DEFAULT_ARCHIVE_LIMITS,
  type ArchiveLimits
} from "../archive/limits.js";
import {
  walkEpro2Archive,
  type ArchiveInventory
} from "../archive/read-archive.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import { parseV3Line } from "../v3/parse-line.js";
import { readUtf8Lines } from "../v3/read-lines.js";
import {
  V3Reducer,
  type V3DocumentContext
} from "../v3/reducer.js";

export interface ReducedProjectLoad {
  readonly archiveSha256: string;
  readonly inputBytes: number;
  readonly archive: ArchiveInventory;
  readonly v3: {
    readonly lines: number;
    readonly records: number;
    readonly documentHeaders: number;
    readonly maxLineBytes: number;
    readonly documentTypes: Readonly<Record<string, number>>;
    readonly recordTypes: Readonly<Record<string, number>>;
  };
  readonly reducer: V3Reducer;
}

interface V3Accumulator {
  lines: number;
  records: number;
  documentHeaders: number;
  maxLineBytes: number;
  documentTypes: Map<string, number>;
  recordTypes: Map<string, number>;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedRecord(map: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}

async function sha256File(inputPath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(inputPath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function reduceEpruStream(
  stream: Readable,
  logicalEntry: string,
  limits: ArchiveLimits,
  accumulator: V3Accumulator,
  reducer: V3Reducer
): Promise<void> {
  let firstRecord = true;
  let currentDocument: V3DocumentContext | undefined;
  for await (const item of readUtf8Lines(stream, {
    entry: logicalEntry,
    maxLineBytes: limits.maxLineBytes
  })) {
    accumulator.lines += 1;
    accumulator.maxLineBytes = Math.max(accumulator.maxLineBytes, item.bytes);
    if (accumulator.records >= limits.maxRecords) {
      throw new AppError(
        ERROR_CODES.V3_RECORD_LIMIT_EXCEEDED,
        "V3 日志记录数超过安全限额。",
        {
          source: { entry: logicalEntry, line: item.line },
          details: { maxRecords: limits.maxRecords }
        }
      );
    }

    const source = {
      entry: logicalEntry,
      line: item.line
    };
    const record = parseV3Line(item.text, source, {
      maxJsonDepth: limits.maxJsonDepth,
      quarantineMalformedTextRecords: true
    });
    accumulator.records += 1;
    increment(accumulator.recordTypes, record.outer.type);

    if (firstRecord && record.outer.type !== "DOCHEAD") {
      throw new AppError(
        ERROR_CODES.V3_INVALID_RECORD,
        "V3 日志文件首条记录必须是 DOCHEAD。",
        {
          source
        }
      );
    }
    firstRecord = false;

    if (record.outer.type === "DOCHEAD") {
      currentDocument = reducer.enterDocument(record, source);
      accumulator.documentHeaders += 1;
      if (accumulator.documentHeaders > limits.maxDocuments) {
        throw new AppError(
          ERROR_CODES.V3_DOCUMENT_LIMIT_EXCEEDED,
          "V3 文档头数量超过安全限额。",
          {
            source,
            details: { maxDocuments: limits.maxDocuments }
          }
        );
      }
      increment(accumulator.documentTypes, currentDocument.docType);
    } else {
      if (currentDocument === undefined) {
        throw new AppError(
          ERROR_CODES.V3_INVALID_DOCHEAD,
          "V3 普通记录前缺少 DOCHEAD。",
          { source }
        );
      }
      reducer.accept(currentDocument, record, source, item.bytes);
    }
  }
}

export async function loadReducedProject(
  inputPath: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
): Promise<ReducedProjectLoad> {
  let inputStat;
  try {
    inputStat = await stat(inputPath);
  } catch (error) {
    throw new AppError(ERROR_CODES.INPUT_NOT_FOUND, "输入工程文件不存在或不可访问。", {
      cause: error
    });
  }
  if (!inputStat.isFile()) {
    throw new AppError(ERROR_CODES.INPUT_NOT_FILE, "输入路径不是普通文件。");
  }
  if (inputStat.size > limits.maxInputBytes) {
    throw new AppError(ERROR_CODES.ARCHIVE_INPUT_TOO_LARGE, "输入工程文件超过安全限额。", {
      details: {
        maxInputBytes: limits.maxInputBytes,
        observedBytes: inputStat.size
      }
    });
  }

  const accumulator: V3Accumulator = {
    lines: 0,
    records: 0,
    documentHeaders: 0,
    maxLineBytes: 0,
    documentTypes: new Map(),
    recordTypes: new Map()
  };
  const reducer = new V3Reducer({
    maxReducedRecords: limits.maxReducedRecords,
    maxReducedSourceBytes: limits.maxReducedSourceBytes
  });

  const [archiveSha256, archive] = await Promise.all([
    sha256File(inputPath),
    walkEpro2Archive(inputPath, limits, async (stream, logicalEntry) => {
      await reduceEpruStream(stream, logicalEntry, limits, accumulator, reducer);
    })
  ]);

  return {
    archiveSha256,
    inputBytes: inputStat.size,
    archive,
    v3: {
      lines: accumulator.lines,
      records: accumulator.records,
      documentHeaders: accumulator.documentHeaders,
      maxLineBytes: accumulator.maxLineBytes,
      documentTypes: sortedRecord(accumulator.documentTypes),
      recordTypes: sortedRecord(accumulator.recordTypes)
    },
    reducer
  };
}
