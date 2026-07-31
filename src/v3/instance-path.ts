export interface InstanceBlockPathSegment {
  readonly sheetNumber: string;
  readonly blockSymbolId: string;
}

export interface ParsedInstancePath {
  readonly schematicId: string;
  readonly blockPath: readonly InstanceBlockPathSegment[];
  readonly terminalSheetNumber: string;
}

export type InstancePathParseResult =
  | {
      readonly status: "VALID";
      readonly path: ParsedInstancePath;
    }
  | {
      readonly status: "INVALID";
      readonly reason:
        | "TOO_FEW_SEGMENTS"
        | "SCHEMATIC_ID_EMPTY"
        | "BLOCK_SEGMENT_INVALID"
        | "TERMINAL_SHEET_INVALID";
    };

const BLOCK_SEGMENT_PATTERN = /^\$([0-9]+)\|([^|_]+)$/;
const TERMINAL_SHEET_PATTERN = /^\$([0-9]+)$/;

/**
 * 按嘉立创 EDA Pro INSTANCE 文档 UUID 的官方语法解析层级路径。
 *
 * 这里只解析显式标识符，不把 sheetNumber 推断为 SCH_PAGE，也不根据
 * blockSymbolId 推断 CBB 关系。数字保留为字符串，避免丢失前导零。
 */
export function parseInstancePath(value: string): InstancePathParseResult {
  const segments = value.split("_");
  if (segments.length < 2) {
    return { status: "INVALID", reason: "TOO_FEW_SEGMENTS" };
  }
  const schematicId = segments[0] as string;
  if (schematicId.length === 0) {
    return { status: "INVALID", reason: "SCHEMATIC_ID_EMPTY" };
  }

  const terminalMatch = TERMINAL_SHEET_PATTERN.exec(
    segments[segments.length - 1] as string
  );
  if (terminalMatch === null) {
    return { status: "INVALID", reason: "TERMINAL_SHEET_INVALID" };
  }

  const blockPath: InstanceBlockPathSegment[] = [];
  for (const segment of segments.slice(1, -1)) {
    const match = BLOCK_SEGMENT_PATTERN.exec(segment);
    if (match === null) {
      return { status: "INVALID", reason: "BLOCK_SEGMENT_INVALID" };
    }
    blockPath.push({
      sheetNumber: match[1] as string,
      blockSymbolId: match[2] as string
    });
  }

  return {
    status: "VALID",
    path: {
      schematicId,
      blockPath,
      terminalSheetNumber: terminalMatch[1] as string
    }
  };
}
