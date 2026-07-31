import { AppError, ERROR_CODES } from "../core/error.js";
import {
  V3_QUARANTINED_MALFORMED_TEXT_STATE,
  V3_QUARANTINED_RECORD_STATE_FIELD,
  type V3InnerRecord,
  type V3OuterRecord,
  type V3Record,
  type V3RecordSource
} from "./record.js";

class JsonDepthExceededError extends Error {}
class JsonCompositeNotClosedError extends Error {}

function findCompositeJsonEnd(text: string, start: number, maxDepth: number): number {
  const opening = text[start];
  if (opening !== "{" && opening !== "[") {
    throw new Error("JSON 值必须以对象或数组开始。");
  }

  const stack: string[] = [opening];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{" || character === "[") {
      if (stack.length >= maxDepth) {
        throw new JsonDepthExceededError();
      }
      stack.push(character);
      continue;
    }

    if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) {
        throw new Error("JSON 括号不匹配。");
      }
      if (stack.length === 0) {
        return index + 1;
      }
    }
  }

  throw new JsonCompositeNotClosedError("JSON 值未闭合。");
}

function findStringJsonEnd(text: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "\"") {
      return index + 1;
    }
  }
  throw new Error("JSON 字符串未闭合。");
}

function findJsonEnd(text: string, start: number, maxDepth: number): number {
  const opening = text[start];
  if (opening === "{" || opening === "[") {
    return findCompositeJsonEnd(text, start, maxDepth);
  }
  if (opening === "\"") {
    return findStringJsonEnd(text, start);
  }
  throw new Error("仅支持对象、数组或字符串形式的原子数据。");
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string, source: V3RecordSource, cause?: unknown): never {
  throw new AppError(ERROR_CODES.V3_INVALID_RECORD, message, {
    ...(cause === undefined ? {} : { cause }),
    source
  });
}

export function parseV3Line(
  line: string,
  source: V3RecordSource,
  options: {
    readonly maxJsonDepth?: number;
    readonly quarantineMalformedTextRecords?: boolean;
  } = {}
): V3Record {
  if (line.length === 0) {
    fail("V3 日志记录不能为空。", source);
  }

  try {
    const maxJsonDepth = options.maxJsonDepth ?? 256;
    if (!Number.isSafeInteger(maxJsonDepth) || maxJsonDepth < 1) {
      fail("JSON 嵌套深度限额必须是正安全整数。", source);
    }
    const outerEnd = findJsonEnd(line, 0, maxJsonDepth);
    if (line.slice(outerEnd, outerEnd + 2) !== "||") {
      fail("V3 日志缺少双 JSON 分隔符 `||`。", source);
    }

    const outerValue: unknown = JSON.parse(line.slice(0, outerEnd));
    if (!isObject(outerValue) || typeof outerValue.type !== "string" || outerValue.type === "") {
      fail("V3 外层记录必须是包含非空 `type` 的对象。", source);
    }
    const innerStart = outerEnd + 2;
    let innerValue: unknown;
    if (line.slice(innerStart).trim() === "|") {
      // 现场工程会把空字符串墓碑压缩成 `外层 JSON|||`。
      innerValue = "";
    } else {
      try {
        const innerEnd = findJsonEnd(line, innerStart, maxJsonDepth);
        const trailing = line.slice(innerEnd).trim();
        if (trailing !== "" && trailing !== "|") {
          fail("V3 日志包含非法尾随内容。", source);
        }
        innerValue = JSON.parse(line.slice(innerStart, innerEnd));
      } catch (error) {
        if (
          error instanceof JsonCompositeNotClosedError &&
          options.quarantineMalformedTextRecords === true &&
          outerValue.type === "TEXT"
        ) {
          // 真实导出工程偶见被截断的非电气 TEXT 注释。只保留一个固定隔离标记，
          // 不猜测或恢复原始文本；结构和电气记录仍保持严格失败。
          innerValue = {
            [V3_QUARANTINED_RECORD_STATE_FIELD]:
              V3_QUARANTINED_MALFORMED_TEXT_STATE
          };
        } else {
          throw error;
        }
      }
    }

    if (!isObject(innerValue) && innerValue !== "") {
      fail("V3 内层记录必须是对象或表示删除的空字符串。", source);
    }

    return {
      outer: outerValue as V3OuterRecord,
      inner: innerValue as V3InnerRecord
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof JsonDepthExceededError) {
      throw new AppError(
        ERROR_CODES.V3_JSON_DEPTH_EXCEEDED,
        "V3 JSON 嵌套深度超过安全限额。",
        { source }
      );
    }
    fail("V3 日志记录不是合法的双 JSON 格式。", source, error);
  }
}
