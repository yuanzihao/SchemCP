import type { Readable } from "node:stream";
import { AppError, ERROR_CODES } from "../core/error.js";

function decodeLine(bytes: Buffer, entry: string, line: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new AppError(ERROR_CODES.V3_INVALID_UTF8, "V3 日志包含非法 UTF-8。", {
      cause: error,
      source: { entry, line }
    });
  }
}
export async function* readUtf8Lines(
  readable: Readable,
  options: {
    readonly entry: string;
    readonly maxLineBytes: number;
  }
): AsyncGenerator<{ readonly line: number; readonly text: string; readonly bytes: number }> {
  let parts: Buffer[] = [];
  let pendingBytes = 0;
  let lineNumber = 0;

  const append = (part: Buffer): void => {
    if (part.length === 0) {
      return;
    }
    pendingBytes += part.length;
    if (pendingBytes > options.maxLineBytes) {
      throw new AppError(ERROR_CODES.V3_LINE_TOO_LARGE, "V3 日志单行超过安全限额。", {
        source: { entry: options.entry, line: lineNumber + 1 },
        details: {
          maxLineBytes: options.maxLineBytes,
          observedBytesAtLeast: pendingBytes
        }
      });
    }
    parts.push(part);
  };

  const takeLine = (): { readonly line: number; readonly text: string; readonly bytes: number } => {
    lineNumber += 1;
    const raw = Buffer.concat(parts, pendingBytes);
    parts = [];
    pendingBytes = 0;
    const withoutCarriageReturn =
      raw.length > 0 && raw[raw.length - 1] === 0x0d ? raw.subarray(0, raw.length - 1) : raw;
    return {
      line: lineNumber,
      text: decodeLine(withoutCarriageReturn, options.entry, lineNumber),
      bytes: raw.length
    };
  };

  for await (const value of readable) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      if (newline === -1) {
        append(chunk.subarray(start));
        break;
      }
      append(chunk.subarray(start, newline));
      yield takeLine();
      start = newline + 1;
    }
  }

  if (pendingBytes > 0) {
    yield takeLine();
  }
}
