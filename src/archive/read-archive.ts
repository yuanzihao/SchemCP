import path from "node:path";
import type { Readable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { AppError, ERROR_CODES } from "../core/error.js";
import type { ArchiveLimits } from "./limits.js";

export interface ArchiveInventory {
  readonly entryCount: number;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly epruEntries: number;
}
function openZip(archivePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        autoClose: true,
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true
      },
      (error, zipFile) => {
        if (error !== null) {
          reject(
            new AppError(ERROR_CODES.ARCHIVE_INVALID, "输入文件不是可读取的 ZIP 归档。", {
              cause: error
            })
          );
          return;
        }
        if (zipFile === undefined) {
          reject(new AppError(ERROR_CODES.ARCHIVE_INVALID, "ZIP 读取器未返回归档句柄。"));
          return;
        }
        resolve(zipFile);
      }
    );
  });
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error !== null) {
        reject(
          new AppError(ERROR_CODES.ARCHIVE_INVALID, "无法读取 ZIP 归档条目。", {
            cause: error
          })
        );
        return;
      }
      if (stream === undefined) {
        reject(new AppError(ERROR_CODES.ARCHIVE_INVALID, "ZIP 读取器未返回条目数据流。"));
        return;
      }
      resolve(stream);
    });
  });
}

function validateEntryPath(fileName: string, maxDepth: number): string {
  const normalizedUnicode = fileName.normalize("NFC");
  const withoutDirectorySuffix = normalizedUnicode.endsWith("/")
    ? normalizedUnicode.slice(0, -1)
    : normalizedUnicode;

  const segments = withoutDirectorySuffix.split("/");
  const invalid =
    withoutDirectorySuffix.length === 0 ||
    withoutDirectorySuffix.startsWith("/") ||
    /^[A-Za-z]:/.test(withoutDirectorySuffix) ||
    normalizedUnicode.includes("\\") ||
    normalizedUnicode.includes("\0") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    segments.length > maxDepth;

  if (invalid) {
    throw new AppError(
      ERROR_CODES.ARCHIVE_INVALID_ENTRY_PATH,
      "ZIP 归档包含不安全或过深的条目路径。"
    );
  }

  const normalizedPath = path.posix.normalize(withoutDirectorySuffix);
  if (normalizedPath !== withoutDirectorySuffix) {
    throw new AppError(
      ERROR_CODES.ARCHIVE_INVALID_ENTRY_PATH,
      "ZIP 归档条目路径规范化后发生变化。"
    );
  }

  return normalizedPath;
}

function mapZipError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "";
  const code =
    message.includes("invalid relative path") || message.includes("absolute path")
      ? ERROR_CODES.ARCHIVE_INVALID_ENTRY_PATH
      : ERROR_CODES.ARCHIVE_INVALID;
  return new AppError(code, "ZIP 归档结构无效。", { cause: error });
}

export async function walkEpro2Archive(
  archivePath: string,
  limits: ArchiveLimits,
  onEpru: (stream: Readable, logicalEntry: string) => Promise<void>
): Promise<ArchiveInventory> {
  const zipFile = await openZip(archivePath);
  if (zipFile.entryCount > limits.maxEntries) {
    zipFile.close();
    throw new AppError(
      ERROR_CODES.ARCHIVE_ENTRY_LIMIT_EXCEEDED,
      "ZIP 归档条目数超过安全限额。",
      {
        details: {
          maxEntries: limits.maxEntries,
          observedEntries: zipFile.entryCount
        }
      }
    );
  }

  return await new Promise<ArchiveInventory>((resolve, reject) => {
    const seenPaths = new Set<string>();
    let settled = false;
    let entryCount = 0;
    let compressedBytes = 0;
    let uncompressedBytes = 0;
    let epruEntries = 0;

    const finishWithError = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      reject(mapZipError(error));
    };

    zipFile.once("error", finishWithError);
    zipFile.once("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      if (epruEntries === 0) {
        reject(
          new AppError(
            ERROR_CODES.ARCHIVE_EPRU_NOT_FOUND,
            "ZIP 归档中未找到嘉立创 EDA V3 日志文件。"
          )
        );
        return;
      }
      resolve({
        entryCount,
        compressedBytes,
        uncompressedBytes,
        epruEntries
      });
    });

    zipFile.on("entry", (entry: Entry) => {
      void (async () => {
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw new AppError(
            ERROR_CODES.ARCHIVE_ENTRY_LIMIT_EXCEEDED,
            "ZIP 归档条目数超过安全限额。",
            {
              details: {
                maxEntries: limits.maxEntries,
                observedEntriesAtLeast: entryCount
              }
            }
          );
        }

        const normalizedPath = validateEntryPath(entry.fileName, limits.maxPathDepth);
        if (seenPaths.has(normalizedPath)) {
          throw new AppError(
            ERROR_CODES.ARCHIVE_DUPLICATE_ENTRY,
            "ZIP 归档包含重复的规范化条目路径。"
          );
        }
        seenPaths.add(normalizedPath);

        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          throw new AppError(
            ERROR_CODES.ARCHIVE_ENCRYPTED_ENTRY,
            "不支持加密的 ZIP 归档条目。"
          );
        }

        compressedBytes += entry.compressedSize;
        uncompressedBytes += entry.uncompressedSize;
        if (entry.uncompressedSize > limits.maxEntryBytes) {
          throw new AppError(
            ERROR_CODES.ARCHIVE_ENTRY_TOO_LARGE,
            "ZIP 归档单条目超过安全限额。",
            {
              details: {
                maxEntryBytes: limits.maxEntryBytes,
                observedBytes: entry.uncompressedSize
              }
            }
          );
        }
        if (uncompressedBytes > limits.maxTotalUncompressedBytes) {
          throw new AppError(
            ERROR_CODES.ARCHIVE_TOTAL_SIZE_EXCEEDED,
            "ZIP 归档累计解压大小超过安全限额。",
            {
              details: {
                maxTotalUncompressedBytes: limits.maxTotalUncompressedBytes,
                observedBytesAtLeast: uncompressedBytes
              }
            }
          );
        }

        const isDirectory = entry.fileName.endsWith("/");
        if (!isDirectory && entry.uncompressedSize > 0) {
          const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
          if (ratio > limits.maxCompressionRatio) {
            throw new AppError(
              ERROR_CODES.ARCHIVE_COMPRESSION_RATIO_EXCEEDED,
              "ZIP 归档条目的压缩比超过安全限额。",
              {
                details: {
                  maxCompressionRatio: limits.maxCompressionRatio,
                  observedRatio: ratio
                }
              }
            );
          }
        }

        if (!isDirectory && normalizedPath.toLowerCase().endsWith(".epru")) {
          epruEntries += 1;
          const stream = await openEntryStream(zipFile, entry);
          await onEpru(stream, `epru-${epruEntries}`);
        }

        if (!settled) {
          zipFile.readEntry();
        }
      })().catch(finishWithError);
    });

    zipFile.readEntry();
  });
}
