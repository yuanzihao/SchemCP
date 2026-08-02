export interface InstanceBlockPathSegment {
  readonly pageReference: string;
  readonly blockSymbolId: string;
  readonly sheetNumber?: string;
  readonly pageId?: string;
}

export type InstancePathEncoding =
  | "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
  | "OBSERVED_PAGE_ID_TILDE_BLOCK_ID";

export interface ParsedInstancePath {
  readonly encoding: InstancePathEncoding;
  readonly schematicId: string;
  readonly blockPath: readonly InstanceBlockPathSegment[];
  readonly terminalPageReference: string;
  readonly terminalSheetNumber?: string;
  readonly terminalPageId?: string;
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
        | "TOO_MANY_SEGMENTS"
        | "SCHEMATIC_ID_EMPTY"
        | "BLOCK_SEGMENT_INVALID"
        | "TERMINAL_PAGE_REFERENCE_INVALID"
        | "MIXED_ENCODINGS";
    };

const MAX_INSTANCE_PATH_SEGMENTS = 18;
const OFFICIAL_BLOCK_SEGMENT_PATTERN = /^\$([0-9]+)\|([^|_~]+)$/;
const OBSERVED_BLOCK_SEGMENT_PATTERN = /^\$([^|_~]+)~([^|_~]+)$/;
const TERMINAL_REFERENCE_PATTERN = /^\$([^|_~]+)$/;

/**
 * 解析嘉立创 EDA Pro INSTANCE 文档 UUID 的两种现场编码：
 *
 * - 官方文档编码：`$sheetNumber|blockSymbolId`；
 * - 当前真实导出编码：`$pageId~blockSymbolId`。
 *
 * 这里只做语法解析。页面、Block 组件和 Symbol 类型的引用解析由后续
 * 层级编译阶段完成；两种编码不得在同一路径中混用。
 */
export function parseInstancePath(value: string): InstancePathParseResult {
  const segments = value.split("_");
  if (segments.length < 2) {
    return { status: "INVALID", reason: "TOO_FEW_SEGMENTS" };
  }
  if (segments.length > MAX_INSTANCE_PATH_SEGMENTS) {
    return { status: "INVALID", reason: "TOO_MANY_SEGMENTS" };
  }
  const schematicId = segments[0] as string;
  if (schematicId.length === 0) {
    return { status: "INVALID", reason: "SCHEMATIC_ID_EMPTY" };
  }

  const terminalMatch = TERMINAL_REFERENCE_PATTERN.exec(
    segments[segments.length - 1] as string
  );
  if (terminalMatch === null) {
    return {
      status: "INVALID",
      reason: "TERMINAL_PAGE_REFERENCE_INVALID"
    };
  }

  const rawBlockSegments = segments.slice(1, -1);
  const officialMatches = rawBlockSegments.map((segment) =>
    OFFICIAL_BLOCK_SEGMENT_PATTERN.exec(segment)
  );
  const observedMatches = rawBlockSegments.map((segment) =>
    OBSERVED_BLOCK_SEGMENT_PATTERN.exec(segment)
  );
  const allOfficial = officialMatches.every((match) => match !== null);
  const allObserved = observedMatches.every((match) => match !== null);
  const terminalReference = terminalMatch[1] as string;
  const terminalIsOfficial = /^[0-9]+$/.test(terminalReference);

  if (rawBlockSegments.length > 0 && !allOfficial && !allObserved) {
    const hasOfficial = officialMatches.some((match) => match !== null);
    const hasObserved = observedMatches.some((match) => match !== null);
    return {
      status: "INVALID",
      reason:
        hasOfficial && hasObserved
          ? "MIXED_ENCODINGS"
          : "BLOCK_SEGMENT_INVALID"
    };
  }

  const encoding: InstancePathEncoding =
    rawBlockSegments.length === 0
      ? terminalIsOfficial
        ? "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
        : "OBSERVED_PAGE_ID_TILDE_BLOCK_ID"
      : allOfficial
        ? "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
        : "OBSERVED_PAGE_ID_TILDE_BLOCK_ID";
  if (
    (encoding === "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID") !==
    terminalIsOfficial
  ) {
    return { status: "INVALID", reason: "MIXED_ENCODINGS" };
  }

  const selectedMatches =
    encoding === "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
      ? officialMatches
      : observedMatches;
  const blockPath: InstanceBlockPathSegment[] = selectedMatches.map(
    (match) => {
      if (match === null) {
        throw new Error("INSTANCE 路径解析器内部状态不一致。");
      }
      const pageReference = match[1] as string;
      return {
        pageReference,
        blockSymbolId: match[2] as string,
        ...(encoding === "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
          ? { sheetNumber: pageReference }
          : { pageId: pageReference })
      };
    }
  );

  return {
    status: "VALID",
    path: {
      encoding,
      schematicId,
      blockPath,
      terminalPageReference: terminalReference,
      ...(encoding === "OFFICIAL_SHEET_NUMBER_PIPE_BLOCK_ID"
        ? { terminalSheetNumber: terminalReference }
        : { terminalPageId: terminalReference })
    }
  };
}
