import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { AppError, type ErrorCode } from "./error.js";
import { assertNoWindowsReparsePointAncestors } from "./filesystem-security.js";

export interface StrictJsonFileOptions {
  readonly errorCode: ErrorCode;
  readonly label: string;
  readonly maxBytes: number;
  readonly maxDepth: number;
}

export interface StrictJsonFileResult {
  readonly value: unknown;
  readonly bytes: number;
}

function invalid(
  options: StrictJsonFileOptions,
  message: string,
  cause?: unknown
): never {
  throw new AppError(options.errorCode, `${options.label}${message}`, {
    ...(cause === undefined ? {} : { cause })
  });
}

function assertJsonStructure(
  text: string,
  options: StrictJsonFileOptions
): void {
  const stack: Array<
    | { readonly type: "array" }
    | { readonly type: "object"; readonly keys: Set<string> }
  > = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < text.length) {
        const current = text[index];
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === '"') {
          break;
        }
        index += 1;
      }
      if (index >= text.length) {
        invalid(options, "包含未闭合的 JSON 字符串。");
      }
      const end = index + 1;
      let next = end;
      while (next < text.length && /\s/u.test(text[next] ?? "")) {
        next += 1;
      }
      const parent = stack[stack.length - 1];
      if (parent?.type === "object" && text[next] === ":") {
        let key: unknown;
        try {
          key = JSON.parse(text.slice(start, end)) as unknown;
        } catch (error) {
          invalid(options, "包含非法 JSON 对象键。", error);
        }
        if (typeof key !== "string" || parent.keys.has(key)) {
          invalid(options, "包含重复或非法 JSON 对象键。");
        }
        parent.keys.add(key);
      }
      index = end;
      continue;
    }
    if (character === "{") {
      stack.push({ type: "object", keys: new Set<string>() });
    } else if (character === "[") {
      stack.push({ type: "array" });
    } else if (character === "}" || character === "]") {
      stack.pop();
    }
    if (stack.length > options.maxDepth) {
      invalid(options, "JSON 嵌套深度超过安全限额。");
    }
    index += 1;
  }
}

export async function readStrictJsonFile(
  inputPath: string,
  options: StrictJsonFileOptions
): Promise<StrictJsonFileResult> {
  await assertNoWindowsReparsePointAncestors(inputPath, (message, cause) =>
    invalid(options, `路径不安全：${message}`, cause)
  );
  let metadata;
  try {
    metadata = await lstat(inputPath);
  } catch (error) {
    invalid(options, "无法读取输入文件。", error);
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > options.maxBytes
  ) {
    invalid(
      options,
      `必须是非空、非符号链接且不超过 ${options.maxBytes} 字节的普通文件。`
    );
  }

  let handle;
  try {
    handle = await open(
      inputPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    const openedMetadata = await handle.stat();
    if (
      !openedMetadata.isFile() ||
      openedMetadata.dev !== metadata.dev ||
      openedMetadata.ino !== metadata.ino ||
      openedMetadata.size !== metadata.size
    ) {
      invalid(options, "在打开期间发生变化。");
    }

    const buffer = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const finalMetadata = await handle.stat();
    if (
      offset !== metadata.size ||
      finalMetadata.dev !== metadata.dev ||
      finalMetadata.ino !== metadata.ino ||
      finalMetadata.size !== metadata.size ||
      finalMetadata.mtimeMs !== openedMetadata.mtimeMs
    ) {
      invalid(options, "读取长度或文件状态在读取期间发生变化。");
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (error) {
      invalid(options, "不是有效 UTF-8。", error);
    }
    assertJsonStructure(text, options);
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch (error) {
      invalid(options, "不是有效 JSON。", error);
    }
    return { value, bytes: buffer.byteLength };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return invalid(options, "不是安全、有效的 JSON 输入。", error);
  } finally {
    await handle?.close();
  }
}
