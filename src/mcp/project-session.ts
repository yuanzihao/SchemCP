import { lstat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { compileProject } from "../application/compile-project.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import {
  assertNoWindowsReparsePointAncestors,
  hasPathTraversalSegments
} from "../core/filesystem-security.js";
import { EdaIrQueryIndex } from "../query/index.js";
import { NetlistComparisonQueryIndex } from "../query/netlist-comparison-index.js";
import type { ProjectVersionDiffIndex } from "../query/project-version-diff.js";
import { buildNetlistComparisonReport } from "../truth/compare-netlist-evidence.js";
import { readPrivateNetlist } from "../truth/import-netlist-evidence.js";
import {
  parseJlcEdaProEnet,
  type JlcEdaProEnet
} from "../truth/jlceda-pro-enet.js";

export const MCP_PROJECT_WORKSPACE_LIMITS = {
  maxProjects: 4,
  defaultPageSize: 4,
  maxPageSize: 4
} as const;

export type McpProjectBinding =
  | "STARTUP_PROJECT_BOUND"
  | "RUNTIME_PROJECT_BOUND";

export interface McpProjectSessionEntry {
  readonly handle: string;
  readonly binding: McpProjectBinding;
  readonly index: EdaIrQueryIndex;
  readonly netlistComparison?: NetlistComparisonQueryIndex;
  readonly netlist?: JlcEdaProEnet;
  readonly projectVersionDiff?: ProjectVersionDiffIndex;
}

export interface McpProjectSessionStatus {
  readonly binding: "NOT_BOUND" | McpProjectBinding;
  readonly projectHandle?: string;
  readonly active?: boolean;
  readonly irSha256?: string;
  readonly schemaVersion?: string;
  readonly summary?: EdaIrQueryIndex["ir"]["summary"];
  readonly netlistComparison:
    | "NOT_BOUND"
    | NetlistComparisonQueryIndex["report"]["comparison"]["status"];
  readonly projectVersionDiff:
    | "NOT_BOUND"
    | ProjectVersionDiffIndex["summary"]["status"];
  readonly electricalTruth: "NOT_VERIFIED";
}

export interface McpProjectWorkspaceStatus {
  readonly binding: "EMPTY" | "PROJECTS_BOUND";
  readonly projectCount: number;
  readonly activeProjectHandle?: string;
  readonly maxProjects: number;
}

export interface McpProjectWorkspacePage {
  readonly items: readonly McpProjectSessionStatus[];
  readonly total: number;
  readonly nextCursor?: string;
}

export interface McpProjectOpenResult {
  readonly disposition: "OPENED_NEW" | "ALREADY_OPEN";
  readonly project: McpProjectSessionStatus;
  readonly workspace: McpProjectWorkspaceStatus;
}

function projectHandle(irSha256: string): string {
  return `schematic_${irSha256}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeCursor(revision: number, offset: number): string {
  return Buffer.from(
    JSON.stringify({ version: 1, revision, offset }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(cursor: string, revision: number): number {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      Object.keys(value).some(
        (key) => !["version", "revision", "offset"].includes(key)
      )
    ) {
      throw new Error("invalid cursor shape");
    }
    const candidate = value as {
      readonly version?: unknown;
      readonly revision?: unknown;
      readonly offset?: unknown;
    };
    if (
      candidate.version !== 1 ||
      candidate.revision !== revision ||
      !Number.isSafeInteger(candidate.offset) ||
      (candidate.offset as number) < 0
    ) {
      throw new Error("invalid cursor state");
    }
    return candidate.offset as number;
  } catch (error) {
    throw new AppError(
      ERROR_CODES.MCP_WORKSPACE_CURSOR_INVALID,
      "工程工作区游标无效或工作区已发生变化。",
      { cause: error }
    );
  }
}

async function validateProjectPath(inputPath: string): Promise<void> {
  if (
    inputPath === "" ||
    !isAbsolute(inputPath) ||
    hasPathTraversalSegments(inputPath) ||
    extname(inputPath).toLowerCase() !== ".epro2"
  ) {
    throw new AppError(
      ERROR_CODES.MCP_PROJECT_PATH_INVALID,
      "工程路径必须是客户端提供的非空绝对 .epro2 文件路径。"
    );
  }

  await assertNoWindowsReparsePointAncestors(inputPath, (message, cause) => {
    throw new AppError(ERROR_CODES.MCP_PROJECT_PATH_INVALID, message, {
      ...(cause === undefined ? {} : { cause })
    });
  });

  let inputStat;
  try {
    inputStat = await lstat(inputPath);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.INPUT_NOT_FOUND,
      "输入工程文件不存在或不可访问。",
      { cause: error }
    );
  }
  if (inputStat.isSymbolicLink()) {
    throw new AppError(
      ERROR_CODES.MCP_PROJECT_PATH_INVALID,
      "运行时打开工程拒绝符号链接；请直接提供附件对应的普通 .epro2 文件。"
    );
  }
  if (!inputStat.isFile()) {
    throw new AppError(
      ERROR_CODES.INPUT_NOT_FILE,
      "输入路径不是普通文件。"
    );
  }
}

export class EdaMcpProjectSession {
  private readonly entries = new Map<string, McpProjectSessionEntry>();
  private activeHandle: string | undefined;
  private transition: Promise<void> = Promise.resolve();
  private revision = 0;

  public constructor(initial?: McpProjectSessionEntry) {
    if (initial !== undefined) {
      this.entries.set(initial.handle, initial);
      this.activeHandle = initial.handle;
    }
  }

  public static startupEntry(
    index: EdaIrQueryIndex,
    netlistComparison?: NetlistComparisonQueryIndex,
    projectVersionDiff?: ProjectVersionDiffIndex
  ): McpProjectSessionEntry {
    return {
      handle: projectHandle(index.ir.irSha256),
      binding: "STARTUP_PROJECT_BOUND",
      index,
      ...(netlistComparison === undefined ? {} : { netlistComparison }),
      ...(netlistComparison?.netlist === undefined
        ? {}
        : { netlist: netlistComparison.netlist }),
      ...(projectVersionDiff === undefined ? {} : { projectVersionDiff })
    };
  }

  public get projectCount(): number {
    return this.entries.size;
  }

  public get activeProjectHandle(): string | undefined {
    return this.activeHandle;
  }

  public get index(): EdaIrQueryIndex | undefined {
    return this.activeHandle === undefined
      ? undefined
      : this.entries.get(this.activeHandle)?.index;
  }

  public workspaceStatus(): McpProjectWorkspaceStatus {
    return {
      binding: this.entries.size === 0 ? "EMPTY" : "PROJECTS_BOUND",
      projectCount: this.entries.size,
      ...(this.activeHandle === undefined
        ? {}
        : { activeProjectHandle: this.activeHandle }),
      maxProjects: MCP_PROJECT_WORKSPACE_LIMITS.maxProjects
    };
  }

  public getEntry(
    requestedHandle?: string
  ): McpProjectSessionEntry | undefined {
    const handle = requestedHandle ?? this.activeHandle;
    return handle === undefined ? undefined : this.entries.get(handle);
  }

  public requireEntry(requestedHandle?: string): McpProjectSessionEntry {
    const handle = requestedHandle ?? this.activeHandle;
    if (handle === undefined) {
      throw new AppError(
        ERROR_CODES.MCP_PROJECT_NOT_OPEN,
        "当前工作区没有原理图工程。请先把 .epro2 文件提供给客户端，再调用 open_schematic_project。"
      );
    }
    const entry = this.entries.get(handle);
    if (entry === undefined) {
      throw new AppError(
        ERROR_CODES.MCP_PROJECT_HANDLE_INVALID,
        "指定的工程句柄不存在于当前工作区。"
      );
    }
    return entry;
  }

  public requireIndex(requestedHandle?: string): EdaIrQueryIndex {
    return this.requireEntry(requestedHandle).index;
  }

  public status(
    requestedHandle?: string
  ): McpProjectSessionStatus {
    const entry = this.getEntry(requestedHandle);
    if (entry === undefined) {
      return {
        binding: "NOT_BOUND",
        netlistComparison: "NOT_BOUND",
        projectVersionDiff: "NOT_BOUND",
        electricalTruth: "NOT_VERIFIED"
      };
    }
    return {
      binding: entry.binding,
      projectHandle: entry.handle,
      active: entry.handle === this.activeHandle,
      irSha256: entry.index.ir.irSha256,
      schemaVersion: entry.index.ir.schemaVersion,
      summary: entry.index.ir.summary,
      netlistComparison:
        entry.netlistComparison?.report.comparison.status ?? "NOT_BOUND",
      projectVersionDiff:
        entry.projectVersionDiff?.summary.status ?? "NOT_BOUND",
      electricalTruth: "NOT_VERIFIED"
    };
  }

  public list(input: {
    readonly limit?: number;
    readonly cursor?: string;
  }): McpProjectWorkspacePage {
    const limit =
      input.limit ?? MCP_PROJECT_WORKSPACE_LIMITS.defaultPageSize;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MCP_PROJECT_WORKSPACE_LIMITS.maxPageSize
    ) {
      throw new AppError(
        ERROR_CODES.MCP_WORKSPACE_CURSOR_INVALID,
        `工程列表 limit 必须为 1～${MCP_PROJECT_WORKSPACE_LIMITS.maxPageSize}。`
      );
    }
    const offset =
      input.cursor === undefined
        ? 0
        : decodeCursor(input.cursor, this.revision);
    const ordered = [...this.entries.keys()].sort(compareText);
    if (offset > ordered.length) {
      throw new AppError(
        ERROR_CODES.MCP_WORKSPACE_CURSOR_INVALID,
        "工程工作区游标位置超出当前列表。"
      );
    }
    const handles = ordered.slice(offset, offset + limit);
    const nextOffset = offset + handles.length;
    return {
      items: handles.map((handle) => this.status(handle)),
      total: ordered.length,
      ...(nextOffset >= ordered.length
        ? {}
        : { nextCursor: encodeCursor(this.revision, nextOffset) })
    };
  }

  public async open(inputPath: string): Promise<McpProjectOpenResult> {
    const operation = this.transition.then(async () => {
      await validateProjectPath(inputPath);
      const compiled = await compileProject(inputPath);
      const handle = projectHandle(compiled.irSha256);
      const existing = this.entries.get(handle);
      if (existing !== undefined) {
        this.activeHandle = handle;
        return {
          disposition: "ALREADY_OPEN" as const,
          project: this.status(handle),
          workspace: this.workspaceStatus()
        };
      }
      if (this.entries.size >= MCP_PROJECT_WORKSPACE_LIMITS.maxProjects) {
        throw new AppError(
          ERROR_CODES.MCP_PROJECT_LIMIT_EXCEEDED,
          `当前工作区最多同时保留 ${MCP_PROJECT_WORKSPACE_LIMITS.maxProjects} 个工程；请先关闭不再使用的工程。`
        );
      }

      const entry: McpProjectSessionEntry = {
        handle,
        binding: "RUNTIME_PROJECT_BOUND",
        index: new EdaIrQueryIndex(compiled)
      };
      this.entries.set(handle, entry);
      this.activeHandle = handle;
      this.revision += 1;
      return {
        disposition: "OPENED_NEW" as const,
        project: this.status(handle),
        workspace: this.workspaceStatus()
      };
    });
    this.transition = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }

  public async attachNetlist(
    projectHandle: string,
    netlistPath: string
  ): Promise<{
    readonly disposition: "ATTACHED_NEW" | "ALREADY_ATTACHED";
    readonly project: McpProjectSessionStatus;
    readonly netlistSha256: string;
  }> {
    const operation = this.transition.then(async () => {
      const entry = this.requireEntry(projectHandle);
      const input = await readPrivateNetlist(netlistPath, {
        requireAbsolute: true
      });
      const parsed = parseJlcEdaProEnet(input.bytes);
      const comparison = new NetlistComparisonQueryIndex(
        buildNetlistComparisonReport(entry.index.ir, input.bytes, parsed),
        parsed
      );
      const existingSha = entry.netlistComparison?.report.netlist.sha256;
      if (existingSha !== undefined) {
        if (existingSha !== comparison.report.netlist.sha256) {
          throw new AppError(
            ERROR_CODES.MCP_NETLIST_ALREADY_BOUND,
            "指定工程已经绑定另一份 .enet；请先显式解除后再附加。"
          );
        }
        return {
          disposition: "ALREADY_ATTACHED" as const,
          project: this.status(projectHandle),
          netlistSha256: existingSha
        };
      }
      this.entries.set(projectHandle, {
        ...entry,
        netlistComparison: comparison,
        netlist: parsed
      });
      this.revision += 1;
      return {
        disposition: "ATTACHED_NEW" as const,
        project: this.status(projectHandle),
        netlistSha256: comparison.report.netlist.sha256
      };
    });
    this.transition = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }

  public async detachNetlist(projectHandle: string): Promise<{
    readonly disposition: "DETACHED" | "NOT_BOUND";
    readonly project: McpProjectSessionStatus;
  }> {
    const operation = this.transition.then(() => {
      const entry = this.requireEntry(projectHandle);
      if (entry.netlistComparison === undefined) {
        return {
          disposition: "NOT_BOUND" as const,
          project: this.status(projectHandle)
        };
      }
      const {
        netlistComparison: _comparison,
        netlist: _netlist,
        ...withoutNetlist
      } = entry;
      this.entries.set(projectHandle, withoutNetlist);
      this.revision += 1;
      return {
        disposition: "DETACHED" as const,
        project: this.status(projectHandle)
      };
    });
    this.transition = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }

  public select(projectHandle: string): McpProjectSessionStatus {
    const entry = this.requireEntry(projectHandle);
    this.activeHandle = entry.handle;
    return this.status(entry.handle);
  }

  public async close(
    requestedHandle?: string
  ): Promise<{
    readonly closedProjectHandle?: string;
    readonly activeProject: McpProjectSessionStatus;
    readonly workspace: McpProjectWorkspaceStatus;
  }> {
    const operation = this.transition.then(() => {
      const handle = requestedHandle ?? this.activeHandle;
      if (handle === undefined) {
        return {
          activeProject: this.status(),
          workspace: this.workspaceStatus()
        };
      }
      if (!this.entries.has(handle)) {
        throw new AppError(
          ERROR_CODES.MCP_PROJECT_HANDLE_INVALID,
          "指定的工程句柄不存在于当前工作区。"
        );
      }
      this.entries.delete(handle);
      if (handle === this.activeHandle) {
        this.activeHandle = [...this.entries.keys()].sort(compareText)[0];
      }
      this.revision += 1;
      return {
        closedProjectHandle: handle,
        activeProject: this.status(),
        workspace: this.workspaceStatus()
      };
    });
    this.transition = operation.then(
      () => undefined,
      () => undefined
    );
    return await operation;
  }
}
