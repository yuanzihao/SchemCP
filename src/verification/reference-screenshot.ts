import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { AppError, ERROR_CODES } from "../core/error.js";

const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = 100_000;
const MAX_DIMENSION = 32_768;
const MAX_PIXELS = 268_435_456;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

export interface P0ReferenceScreenshot {
  readonly format: "PNG";
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

function invalid(message: string, cause?: unknown): never {
  throw new AppError(ERROR_CODES.P0_FORMAT_MATRIX_INVALID, message, {
    ...(cause === undefined ? {} : { cause })
  });
}

const CRC32_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        (value & 1) === 1
          ? (0xedb88320 ^ (value >>> 1)) >>> 0
          : value >>> 1;
    }
    return value >>> 0;
  })
);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkType(bytes: Buffer, offset: number): string {
  const typeBytes = bytes.subarray(offset, offset + 4);
  if (
    typeBytes.length !== 4 ||
    typeBytes.some(
      (byte) =>
        !(
          (byte >= 0x41 && byte <= 0x5a) ||
          (byte >= 0x61 && byte <= 0x7a)
        )
    )
  ) {
    invalid("参考截图包含非法 PNG chunk 类型。");
  }
  return typeBytes.toString("ascii");
}

export function parseP0ReferenceScreenshot(
  bytes: Buffer
): P0ReferenceScreenshot {
  if (
    bytes.length < 45 ||
    bytes.length > MAX_SCREENSHOT_BYTES ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    invalid("参考截图必须是非空且不超过 16 MiB 的 PNG。");
  }
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let width = 0;
  let height = 0;
  let seenHeader = false;
  let seenImageData = false;
  let seenEnd = false;
  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > MAX_CHUNKS || offset + 12 > bytes.length) {
      invalid("参考截图 PNG chunk 数量或边界非法。");
    }
    const length = bytes.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const endOffset = crcOffset + 4;
    if (endOffset > bytes.length) {
      invalid("参考截图 PNG chunk 越过文件边界。");
    }
    const type = chunkType(bytes, typeOffset);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(bytes.subarray(typeOffset, crcOffset));
    if (expectedCrc !== actualCrc) {
      invalid("参考截图 PNG chunk CRC 校验失败。");
    }
    if (chunkCount === 1) {
      if (type !== "IHDR" || length !== 13) {
        invalid("参考截图 PNG 首个 chunk 必须是 13-byte IHDR。");
      }
      width = bytes.readUInt32BE(dataOffset);
      height = bytes.readUInt32BE(dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8]!;
      const colorType = bytes[dataOffset + 9]!;
      const compression = bytes[dataOffset + 10]!;
      const filter = bytes[dataOffset + 11]!;
      const interlace = bytes[dataOffset + 12]!;
      if (
        width < 1 ||
        height < 1 ||
        width > MAX_DIMENSION ||
        height > MAX_DIMENSION ||
        width * height > MAX_PIXELS ||
        ![1, 2, 4, 8, 16].includes(bitDepth) ||
        ![0, 2, 3, 4, 6].includes(colorType) ||
        compression !== 0 ||
        filter !== 0 ||
        ![0, 1].includes(interlace)
      ) {
        invalid("参考截图 PNG IHDR 参数不在安全支持范围。");
      }
      seenHeader = true;
    } else if (type === "IHDR") {
      invalid("参考截图 PNG 不能包含重复 IHDR。");
    }
    if (type === "IDAT") seenImageData = true;
    if (type === "IEND") {
      if (length !== 0 || endOffset !== bytes.length) {
        invalid("参考截图 PNG IEND 必须为空且位于文件末尾。");
      }
      seenEnd = true;
    } else if (seenEnd) {
      invalid("参考截图 PNG 在 IEND 后包含额外 chunk。");
    }
    offset = endOffset;
  }
  if (!seenHeader || !seenImageData || !seenEnd) {
    invalid("参考截图 PNG 缺少 IHDR、IDAT 或 IEND。");
  }
  return {
    format: "PNG",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width,
    height
  };
}

export async function readP0ReferenceScreenshot(
  inputPath: string
): Promise<P0ReferenceScreenshot> {
  const requestedPath = path.resolve(inputPath);
  if (path.extname(requestedPath).toLowerCase() !== ".png") {
    invalid("参考截图必须使用 .png 扩展名。");
  }
  let state;
  try {
    state = await lstat(requestedPath);
  } catch (error) {
    invalid("无法读取参考截图。", error);
  }
  if (
    !state.isFile() ||
    state.isSymbolicLink() ||
    state.size < 45 ||
    state.size > MAX_SCREENSHOT_BYTES
  ) {
    invalid("参考截图必须是非符号链接且不超过 16 MiB 的普通 PNG 文件。");
  }
  let handle;
  try {
    handle = await open(
      requestedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const openedState = await handle.stat();
    if (!openedState.isFile() || openedState.size !== state.size) {
      invalid("参考截图在打开期间发生变化。");
    }
    const bytes = await handle.readFile();
    const finalState = await handle.stat();
    if (bytes.length !== state.size || finalState.size !== state.size) {
      invalid("参考截图在读取期间发生变化。");
    }
    return parseP0ReferenceScreenshot(bytes);
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalid("无法安全读取参考截图。", error);
  } finally {
    await handle?.close();
  }
  invalid("无法安全读取参考截图。");
}
