import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AsyncLocalStorage } from "node:async_hooks";
import * as z from "zod/v4";
import { AppError } from "../core/error.js";
import { FILESYSTEM_SECURITY_CAPABILITIES } from "../core/filesystem-security.js";
import { DOCUMENT_REFERENCE_KINDS } from "../datasheet/model.js";
import type { DatasheetStoreQueryIndex } from "../datasheet/query-index.js";
import {
  EdaIrQueryIndex,
  QueryError,
  QUERY_LIMITS
} from "../query/index.js";
import { ComponentConnectivityQuery } from "../query/component-connectivity.js";
import {
  ResourceGraphQueryIndex,
  RESOURCE_GRAPH_LIMITS
} from "../query/resource-graph.js";
import type { NetlistComparisonQueryIndex } from "../query/netlist-comparison-index.js";
import { UNRESOLVED_COMPONENT_REASONS } from "../query/unresolved-components.js";
import {
  PROJECT_DIFF_CHANGE_TYPES,
  PROJECT_DIFF_ENTITY_KINDS,
  type ProjectVersionDiffIndex
} from "../query/project-version-diff.js";
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  type McpToolName
} from "./contract.js";
import {
  EdaMcpProjectSession,
  MCP_PROJECT_WORKSPACE_LIMITS
} from "./project-session.js";
import {
  MCP_ASSEMBLY_LIMITS,
  SchematicAssemblySession
} from "./assembly-session.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const MCP_TOOL_RESULT_SCHEMA = z
  .object({
    ok: z.boolean().describe("工具调用是否成功")
  })
  .catchall(z.unknown());

export const MCP_LIMITS = {
  maxStructuredResultBytes: 1024 * 1024
} as const;

const PAGE_INPUT = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(QUERY_LIMITS.maxPageSize)
    .optional()
    .describe(`每页数量，默认 ${QUERY_LIMITS.defaultPageSize}，最大 ${QUERY_LIMITS.maxPageSize}`),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe("上一页返回的不透明 nextCursor；改变筛选条件后不可复用")
} as const;

const RESOURCE_GRAPH_INPUT = {
  pageId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选精确原理图页 ID"),
  rootNodeId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选资源图节点 ID；来自前一次查询的 roots 或边端点"),
  rootNetName: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选精确根网络名；同名跨页时应同时提供 pageId"),
  instanceContextId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选精确 INSTANCE 上下文 ID"),
  variantId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选 Variant ID；当前未应用 Variant 时资源边保守降级为未解析"),
  activityStatus: z
    .enum(["ACTIVE", "EXCLUDED_DNP", "ASSEMBLY_UNKNOWN", "ALL"])
    .optional()
    .describe("装配活动筛选；默认 ACTIVE，ALL 包含 DNP 与装配未知证据"),
  maxDepth: z
    .number()
    .int()
    .min(0)
    .max(RESOURCE_GRAPH_LIMITS.maxDepth)
    .optional()
    .describe(
      `图遍历深度，默认 ${RESOURCE_GRAPH_LIMITS.defaultDepth}，最大 ${RESOURCE_GRAPH_LIMITS.maxDepth}`
    ),
  ...PAGE_INPUT
} as const;

const COMPONENT_SELECTOR = {
  componentId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("页内组件 ID；与 designator 二选一"),
  designator: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("精确位号；与 componentId 二选一，重复时返回歧义"),
  pageId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选页面 ID，用于消歧")
} as const;

const COMPONENT_INSTANCE_SELECTOR = {
  ...COMPONENT_SELECTOR,
  instanceContextId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选精确 INSTANCE 上下文 ID；指定后返回该层级实例中的有效组件属性"),
  variantId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("可选当前工程 Variant ID；v0.2 不应用替代料，指定后装配状态保守返回 UNKNOWN")
} as const;

const VARIANT_SELECTOR = {
  variantId: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("变体文档 ID；与 title 二选一"),
  title: z
    .string()
    .min(1)
    .max(QUERY_LIMITS.maxTextLength)
    .optional()
    .describe("精确变体名称；与 variantId 二选一，重复时返回歧义")
} as const;

const PROJECT_HANDLE_INPUT = z
  .string()
  .min(1)
  .max(96)
  .optional()
  .describe(
    "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project"
  );

const WORKSPACE_MANAGEMENT_TOOLS = new Set<McpToolName>([
  "open_schematic_project",
  "attach_schematic_netlist",
  "detach_schematic_netlist",
  "create_schematic_assembly",
  "list_schematic_assemblies",
  "close_schematic_assembly",
  "list_interconnect_candidates",
  "confirm_schematic_interconnect",
  "list_assembly_connections",
  "get_schematic_assembly_manifest",
  "open_schematic_assembly_manifest",
  "list_schematic_projects",
  "select_schematic_project",
  "get_active_schematic_project",
  "close_schematic_project",
  "list_datasheet_references",
  "get_datasheet_section"
]);

export function createMcpResult(
  data: Readonly<Record<string, unknown>>
): CallToolResult {
  const structuredContent = {
    ok: true,
    ...data,
    platformSecurity: FILESYSTEM_SECURITY_CAPABILITIES
  };
  const text = JSON.stringify(structuredContent);
  if (Buffer.byteLength(text, "utf8") > MCP_LIMITS.maxStructuredResultBytes) {
    const boundedError = {
      ok: false,
      error: {
        code: "MCP_TOOL_RESULT_TOO_LARGE",
        message: `查询结果超过 ${MCP_LIMITS.maxStructuredResultBytes} 字节上限；请缩小 limit 或筛选范围。`
      },
      platformSecurity: FILESYSTEM_SECURITY_CAPABILITIES
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(boundedError) }],
      structuredContent: boundedError
    };
  }
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    structuredContent
  };
}

function errorResult(error: unknown): CallToolResult {
  const payload =
    error instanceof QueryError || error instanceof AppError
      ? { code: error.code, message: error.message }
      : {
          code: "MCP_TOOL_INTERNAL_ERROR",
          message: "查询执行失败。"
        };
  const structuredContent = {
    ok: false,
    error: payload,
    platformSecurity: FILESYSTEM_SECURITY_CAPABILITIES
  };
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent)
      }
    ],
    structuredContent
  };
}

function runQuery(
  operation: () => Readonly<Record<string, unknown>>
): CallToolResult {
  try {
    return createMcpResult(operation());
  } catch (error) {
    return errorResult(error);
  }
}

async function runAsyncQuery(
  operation: () => Promise<Readonly<Record<string, unknown>>>
): Promise<CallToolResult> {
  try {
    return createMcpResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}

export function createEdaMcpServer(
  initialIndex?: EdaIrQueryIndex,
  initialNetlistComparison?: NetlistComparisonQueryIndex,
  initialProjectVersionDiff?: ProjectVersionDiffIndex,
  datasheets?: DatasheetStoreQueryIndex
): McpServer {
  const session = new EdaMcpProjectSession(
    initialIndex === undefined
      ? undefined
      : EdaMcpProjectSession.startupEntry(
          initialIndex,
          initialNetlistComparison,
          initialProjectVersionDiff
        )
  );
  const assemblies = new SchematicAssemblySession(session);
  const projectScope = new AsyncLocalStorage<string | undefined>();
  const index = new Proxy({} as EdaIrQueryIndex, {
    get(_target, property) {
      const current = session.requireIndex(projectScope.getStore());
      const value = Reflect.get(current, property, current) as unknown;
      return typeof value === "function"
        ? value.bind(current)
        : value;
    }
  });
  const currentEntry = () => {
    const requestedHandle = projectScope.getStore();
    return requestedHandle === undefined
      ? session.getEntry()
      : session.requireEntry(requestedHandle);
  };
  const currentNetlistComparison = () =>
    currentEntry()?.netlistComparison;
  const currentProjectVersionDiff = () =>
    currentEntry()?.projectVersionDiff;
  const componentConnectivity = () => {
    const entry = currentEntry();
    if (entry === undefined) {
      session.requireEntry(projectScope.getStore());
      throw new Error("unreachable");
    }
    return new ComponentConnectivityQuery(
      entry.index,
      entry.netlistComparison,
      datasheets
    );
  };
  const resourceGraph = () => new ResourceGraphQueryIndex(index.ir);
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION
    },
    {
      instructions:
        "本地优先、只读查询嘉立创 EDA 原理图工程。服务可以无工程启动，也可同时打开多个用户显式提供的 .epro2；不得扫描目录或猜测路径。可选 .enet 只作为用户提供的连接证据，不能升级为官方来源或完整电气真值。所有列表均有界分页；重复位号必须使用页面或组件 ID 消歧。服务不提供 PCB、浏览器 Bridge、在线 EDA 驱动、工程写入或代码生成能力。"
    }
  );

  const registerTool = server.registerTool;
  server.registerTool = ((
    name: string,
    config: Record<string, unknown>,
    handler: (
      args: Record<string, unknown>,
      extra: unknown
    ) => CallToolResult | Promise<CallToolResult>
  ) => {
    const toolName = name as McpToolName;
    const projectScoped = !WORKSPACE_MANAGEMENT_TOOLS.has(toolName);
    const effectiveConfig = {
      ...config,
      ...(projectScoped
        ? {
            inputSchema: {
              ...((config.inputSchema as Record<string, unknown> | undefined) ??
                {}),
              projectHandle: PROJECT_HANDLE_INPUT
            }
          }
        : {}),
      outputSchema: MCP_TOOL_RESULT_SCHEMA
    };
    const effectiveHandler = projectScoped
      ? (
          args: Record<string, unknown>,
          extra: unknown
        ): CallToolResult | Promise<CallToolResult> =>
          projectScope.run(
            typeof args.projectHandle === "string"
              ? args.projectHandle
              : undefined,
            () => handler(args, extra)
          )
      : handler;
    return Reflect.apply(registerTool, server, [
      name,
      effectiveConfig,
      effectiveHandler
    ]);
  }) as typeof server.registerTool;

  server.registerTool(
    "open_schematic_project",
    {
      title: "打开用户提供的原理图工程",
      description:
        `读取客户端已提供的绝对 .epro2 附件路径，执行安全、离线、确定性解析，并加入当前工作区。工作区最多同时保留 ${MCP_PROJECT_WORKSPACE_LIMITS.maxProjects} 个工程；相同内容只激活既有句柄。不得扫描目录或猜测路径；失败时保留全部已打开工程。返回值不回显本地路径。`,
      inputSchema: {
        projectPath: z
          .string()
          .min(1)
          .describe("客户端为用户附件提供的精确绝对 .epro2 路径")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runAsyncQuery(async () => {
        const opened = await session.open(args.projectPath);
        return {
          ...opened,
          nextAction: "CALL_GET_PROJECT_SUMMARY"
        };
      })
  );

  server.registerTool(
    "attach_schematic_netlist",
    {
      title: "为指定工程附加用户网表",
      description:
        "使用客户端提供的精确绝对 .enet 附件路径，为指定已打开工程建立独立网表比较索引。完整解析成功后才原子附加；不扫描目录、不回显路径，也不把用户文件升级为官方来源或已验证工程绑定。",
      inputSchema: {
        projectHandle: z
          .string()
          .min(1)
          .max(96)
          .describe("必须显式指定 list_schematic_projects 返回的工程句柄"),
        netlistPath: z
          .string()
          .min(1)
          .describe("客户端为用户附件提供的精确绝对 .enet 路径")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runAsyncQuery(async () => ({
        ...(await session.attachNetlist(
          args.projectHandle,
          args.netlistPath
        )),
        acquisitionMethod: "USER_PROVIDED_FILE",
        sourceAuthenticity: "NOT_VERIFIED",
        projectBinding: "USER_ASSERTED_NOT_VERIFIED",
        electricalTruth: "NOT_VERIFIED",
        nextAction: "CALL_GET_NETLIST_COMPARISON_SUMMARY"
      }))
  );

  server.registerTool(
    "detach_schematic_netlist",
    {
      title: "解除指定工程的用户网表",
      description:
        "显式释放指定工程的会话网表索引，不影响工程 EDA-IR、其他工程或用户文件。",
      inputSchema: {
        projectHandle: z
          .string()
          .min(1)
          .max(96)
          .describe("必须显式指定 list_schematic_projects 返回的工程句柄")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runAsyncQuery(async () => ({
        ...(await session.detachNetlist(args.projectHandle)),
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "create_schematic_assembly",
    {
      title: "声明相关原理图工程装配",
      description:
        "把 2～4 个已打开工程声明为同一装配关系。该声明只缩小互连候选范围，不证明任何连接器已经物理配对。",
      inputSchema: {
        projectHandles: z
          .array(z.string().min(1).max(96))
          .min(MCP_ASSEMBLY_LIMITS.minProjects)
          .max(MCP_ASSEMBLY_LIMITS.maxProjects)
          .describe("互不重复的已打开工程句柄")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        ...assemblies.create(args.projectHandles),
        relationshipTruth: "USER_ASSERTED_PROJECT_RELATIONSHIP",
        electricalTruth: "NOT_VERIFIED",
        nextAction: "CALL_LIST_INTERCONNECT_CANDIDATES"
      }))
  );

  server.registerTool(
    "list_schematic_assemblies",
    {
      title: "分页列出当前会话装配",
      description:
        "列出仍由已打开工程支撑的用户声明装配及已确认互连；工程关闭后相关装配自动失效。",
      inputSchema: PAGE_INPUT,
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: assemblies.list(args),
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "close_schematic_assembly",
    {
      title: "关闭会话装配",
      description:
        "释放指定装配及其确认互连，只修改 MCP 进程内状态，不修改用户工程或附件。",
      inputSchema: {
        assemblyHandle: z.string().min(1).max(96)
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        ...assemblies.close(args.assemblyHandle)
      }))
  );

  server.registerTool(
    "list_interconnect_candidates",
    {
      title: "分页列出跨工程互连候选",
      description:
        "只在用户声明的装配工程间，按引脚编号集合、数量、名称及显式器件属性生成确定性候选。候选不是已确认物理连接，不会自动参与跨工程路径。",
      inputSchema: {
        assemblyHandle: z.string().min(1).max(96),
        leftProjectHandle: z.string().min(1).max(96).optional(),
        rightProjectHandle: z.string().min(1).max(96).optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: assemblies.listCandidates(args),
        candidateTruth: "CANDIDATE_NOT_CONFIRMED",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "confirm_schematic_interconnect",
    {
      title: "确认跨工程连接器针脚映射",
      description:
        "把指定候选按用户确认的同号针脚或显式针脚对加入会话装配。不会自动镜像、反序或猜测映射。",
      inputSchema: {
        assemblyHandle: z.string().min(1).max(96),
        candidateId: z.string().min(1).max(96),
        mapping: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("SAME_PIN_NUMBER")
          }),
          z.object({
            kind: z.literal("EXPLICIT_PIN_PAIRS"),
            pinPairs: z
              .array(
                z.object({
                  leftPinNumber: z
                    .string()
                    .min(1)
                    .max(QUERY_LIMITS.maxTextLength),
                  rightPinNumber: z
                    .string()
                    .min(1)
                    .max(QUERY_LIMITS.maxTextLength)
                })
              )
              .min(1)
              .max(MCP_ASSEMBLY_LIMITS.maxPinPairs)
          })
        ])
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        ...assemblies.confirm(args),
        relationshipTruth: "USER_CONFIRMED_SESSION_RELATIONSHIP",
        electricalTruth: "NOT_VERIFIED",
        nextAction: "CALL_LIST_ASSEMBLY_CONNECTIONS"
      }))
  );

  server.registerTool(
    "list_assembly_connections",
    {
      title: "分页查询装配内跨工程连接",
      description:
        "从任意组件/引脚出发，只沿工程内同一网络和用户已确认互连针脚查询。不会穿过普通器件传播；每段路径明确区分绑定网表、.epro2 候选和确认互连。",
      inputSchema: {
        assemblyHandle: z.string().min(1).max(96),
        projectHandle: z.string().min(1).max(96),
        ...COMPONENT_SELECTOR,
        pinNumber: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional(),
        maxInterconnectHops: z
          .number()
          .int()
          .min(0)
          .max(MCP_ASSEMBLY_LIMITS.maxInterconnectHops)
          .optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: assemblies.listConnections(args),
        propagation: "NET_AND_CONFIRMED_INTERCONNECT_ONLY",
        sourceAuthenticity: "NOT_VERIFIED",
        projectBinding: "USER_ASSERTED_NOT_VERIFIED",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "get_schematic_assembly_manifest",
    {
      title: "生成私有原理图装配清单",
      description:
        "返回当前会话装配的规范、可校验清单。只包含工程 EDA-IR 哈希、精确组件选择器和用户已确认针脚映射，不包含本地路径、原始工程或未确认候选。",
      inputSchema: {
        assemblyHandle: z.string().min(1).max(96)
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        manifest: assemblies.getManifest(args.assemblyHandle),
        sourceAuthenticity: "NOT_VERIFIED",
        projectBinding: "USER_ASSERTED_NOT_VERIFIED",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "open_schematic_assembly_manifest",
    {
      title: "恢复私有原理图装配清单",
      description:
        "从客户端提供的精确绝对 .schemcp-assembly.json 附件路径恢复装配。只有清单规范哈希有效且当前已打开工程的 EDA-IR 哈希全部精确一致时才原子恢复。",
      inputSchema: {
        manifestPath: z
          .string()
          .min(1)
          .describe(
            "客户端为用户附件提供的精确绝对 .schemcp-assembly.json 路径"
          )
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runAsyncQuery(async () => ({
        ...(await assemblies.openManifest(args.manifestPath)),
        sourceAuthenticity: "USER_PROVIDED_FILE",
        projectBinding: "EXACT_IR_HASH_MATCH",
        relationshipTruth: "USER_CONFIRMED_SESSION_RELATIONSHIP",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "list_schematic_projects",
    {
      title: "分页列出已打开的原理图工程",
      description:
        "返回当前 MCP 工作区内所有工程的脱敏句柄、摘要和活动状态；不回显本地路径。一个工程内部的多个 Schematic/Sheet 请继续通过 list_design_hierarchy 查询。",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(MCP_PROJECT_WORKSPACE_LIMITS.maxPageSize)
          .optional()
          .describe(
            `每页数量，默认 ${MCP_PROJECT_WORKSPACE_LIMITS.defaultPageSize}，最大 ${MCP_PROJECT_WORKSPACE_LIMITS.maxPageSize}`
          ),
        cursor: z
          .string()
          .min(1)
          .optional()
          .describe("上一页返回的不透明 nextCursor；工作区变化后不可复用")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        workspace: session.workspaceStatus(),
        page: session.list({
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor })
        })
      }))
  );

  server.registerTool(
    "select_schematic_project",
    {
      title: "选择活动原理图工程",
      description:
        "按脱敏工程句柄切换默认查询目标；不重新解析工程，也不影响其他已打开工程。后续查询仍可用 projectHandle 显式覆盖。",
      inputSchema: {
        projectHandle: z
          .string()
          .min(1)
          .max(96)
          .describe("list_schematic_projects 返回的精确工程句柄")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        project: session.select(args.projectHandle),
        workspace: session.workspaceStatus(),
        nextAction: "CALL_GET_PROJECT_SUMMARY"
      }))
  );

  server.registerTool(
    "get_active_schematic_project",
    {
      title: "获取当前原理图工程会话",
      description:
        "返回当前会话是否已打开工程及脱敏句柄；不回显本地路径。",
      annotations: READ_ONLY_ANNOTATIONS
    },
    () =>
      createMcpResult({
        project: session.status(),
        workspace: session.workspaceStatus(),
        nextAction:
          session.index === undefined
            ? "CALL_OPEN_SCHEMATIC_PROJECT"
            : "CALL_GET_PROJECT_SUMMARY"
      })
  );

  server.registerTool(
    "close_schematic_project",
    {
      title: "关闭当前原理图工程",
      description:
        "从当前 MCP 工作区关闭指定工程；省略句柄时关闭活动工程。只释放进程内索引，不修改或删除用户文件。",
      inputSchema: {
        projectHandle: z
          .string()
          .min(1)
          .max(96)
          .optional()
          .describe("可选精确工程句柄；省略时关闭当前活动工程")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runAsyncQuery(async () => {
        const closed = await session.close(args.projectHandle);
        assemblies.prune();
        return {
          ...closed,
          project: closed.activeProject
        };
      })
  );

  server.registerTool(
    "get_project_summary",
    {
      title: "获取 EDA 工程能力与摘要",
      description:
        "返回脱敏工程计数、内容哈希和当前事实能力边界。开始分析前应先调用本工具。",
      annotations: READ_ONLY_ANNOTATIONS
    },
    () =>
      runQuery(() => {
        const requestedHandle = projectScope.getStore();
        const entry =
          requestedHandle === undefined
            ? session.getEntry()
            : session.requireEntry(requestedHandle);
        if (entry === undefined) {
          return {
            project: session.status(),
            workspace: session.workspaceStatus(),
            capabilities: {
              schematicProjectOpen: "AVAILABLE_RUNTIME_ATTACHMENT_PATH",
              multiProjectWorkspace: "AVAILABLE_MAX_4",
              multiSchematicHierarchy: "AVAILABLE_EXPLICIT_METADATA",
              electricalTruth: "NOT_VERIFIED",
              signalTrace: "NOT_AVAILABLE"
            },
            nextAction: "CALL_OPEN_SCHEMATIC_PROJECT"
          };
        }
        const netlistComparison = entry.netlistComparison;
        const projectVersionDiff = entry.projectVersionDiff;
        return {
        project: {
          ...session.status(entry.handle),
          schemaVersion: index.ir.schemaVersion,
          irSha256: index.ir.irSha256,
          source: index.ir.source,
          summary: index.ir.summary
        },
        workspace: session.workspaceStatus(),
        capabilities: {
          multiProjectWorkspace: "AVAILABLE_MAX_4",
          multiSchematicHierarchy: "AVAILABLE_EXPLICIT_METADATA",
          designHierarchy: "AVAILABLE_EXPLICIT_METADATA",
          componentInventory: "AVAILABLE",
          schematicAnnotations:
            "AVAILABLE_EXPLICIT_TEXT_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED",
          schematicGraphicPrimitives:
            "AVAILABLE_EXPLICIT_POLY_RECT_ARC_CIRCLE_ELLIPSE_FINITE_GEOMETRY_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED",
          schematicTables:
            "AVAILABLE_EXPLICIT_TABLE_CELLS_LAYOUT_BOUNDS_VALIDATED_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED",
          symbolTexts:
            "AVAILABLE_EXPLICIT_TEXT_EXACT_PART_BINDING_SOURCE_NOT_VERIFIED_INTERPRETATION_NOT_PERFORMED",
          unresolvedComponentInventory:
            "AVAILABLE_DETERMINISTIC_EXPLICIT_ATTRIBUTES",
          partMasterInventory:
            "AVAILABLE_DETERMINISTIC_EXACT_IDENTITY",
          datasheetReferences:
            datasheets === undefined
              ? "AVAILABLE_REQUIRES_OPTIONAL_LOCAL_STORE_BINDING"
              : "AVAILABLE_LOCAL_VERIFIED_STORE_SOURCE_USER_ASSERTED",
          symbolTemplatePins: "AVAILABLE",
          explicitWireNetLabels: "AVAILABLE",
          provenanceEvidence: "AVAILABLE",
          componentLibraryBindings: "AVAILABLE_DETERMINISTIC",
          variantsAndComponentGroups: "AVAILABLE_EXPLICIT_METADATA",
          instancePathSyntax: "AVAILABLE_EXPLICIT_DOCUMENT_UUID",
          instanceSheetResolution: "NOT_VERIFIED",
          instanceAttributeOverrides:
            "AVAILABLE_APPLIED_TO_EXACT_COMPONENT_AND_PIN_TARGETS",
          effectiveAssemblyState:
            "AVAILABLE_EXPLICIT_ADD_INTO_BOM_YES_NO_OTHERWISE_UNKNOWN",
          multiUnitPinCompleteness:
            "AVAILABLE_DETERMINISTIC_SYMBOL_PART_AGGREGATION",
          hiddenSymbolPins:
            "AVAILABLE_ONLY_WHEN_EXPLICIT_PIN_DISPLAY_IS_FALSE",
          componentSemanticRoles:
            "AVAILABLE_VERSIONED_DETERMINISTIC_CANDIDATES",
          componentPowerDomains:
            "AVAILABLE_PAGE_SCOPED_EXPLICIT_PIN_NET_CANDIDATES",
          interfaceCandidates:
            "AVAILABLE_VERSIONED_SIGNAL_SET_RULES_DNP_EXCLUDED_BY_DEFAULT",
          powerTreeCandidates:
            "AVAILABLE_BOUNDED_EXPLICIT_ROLE_EDGES_NOT_VERIFIED",
          externalClockTreeCandidates:
            "AVAILABLE_EXTERNAL_SCHEMATIC_ONLY_INTERNAL_PLL_NOT_INFERRED",
          resetBootPathCandidates:
            "AVAILABLE_BOUNDED_EXTERNAL_PATHS_NOT_VERIFIED",
          mcuPinUsage:
            "AVAILABLE_UNUSED_ONLY_WITH_COMPLETE_MODEL_AND_EXPLICIT_EVIDENCE",
          variantInstanceContextMatching: "AVAILABLE_EXACT_ID_ONLY",
          variantOverrideApplication:
            "NOT_AVAILABLE_SELECTED_VARIANT_RETURNS_UNKNOWN_ASSEMBLY",
          pinConnectionCandidates: "AVAILABLE_NOT_VERIFIED",
          pinNoConnectDeclarations: "AVAILABLE_NOT_VERIFIED",
          networkEndpointCandidates: "AVAILABLE_NOT_VERIFIED",
          shortRelationCandidates: "AVAILABLE_NOT_VERIFIED",
          normalizedCandidateNetlistTuples: "AVAILABLE_NOT_VERIFIED",
          candidateNetlistExclusions: "AVAILABLE_DETERMINISTIC",
          officialNetlistComparison:
            netlistComparison === undefined
              ? "NOT_AVAILABLE_NETLIST_NOT_BOUND"
              : netlistComparison.report.comparison.status,
          boundNetQuery:
            netlistComparison === undefined
              ? "AVAILABLE_REQUIRES_OPTIONAL_NETLIST_BINDING"
              : "AVAILABLE_STRICT_PARSED_ENET_SOURCE_AND_PROJECT_UNVERIFIED",
          boundElectricalNetHypergraph:
            netlistComparison === undefined
              ? "AVAILABLE_REQUIRES_OPTIONAL_NETLIST_BINDING"
              : "AVAILABLE_NET_HYPEREDGES_PROPAGATION_NOT_EVALUATED",
          netlistComparisonQuery:
            netlistComparison === undefined
              ? "AVAILABLE_REQUIRES_OPTIONAL_NETLIST_BINDING"
              : "AVAILABLE_SOURCE_AND_PROJECT_BINDING_NOT_VERIFIED",
          projectVersionDiff:
            projectVersionDiff === undefined
              ? "AVAILABLE_REQUIRES_OPTIONAL_BASELINE_BINDING"
              : "AVAILABLE_PROJECT_CONTINUITY_NOT_VERIFIED",
          pinToNetRelations: "NOT_VERIFIED",
          electricalTruth: "NOT_VERIFIED",
          signalTrace: "NOT_AVAILABLE"
        },
        pagination: {
          defaultPageSize: QUERY_LIMITS.defaultPageSize,
          maxPageSize: QUERY_LIMITS.maxPageSize,
          maxStructuredResultBytes: MCP_LIMITS.maxStructuredResultBytes
        },
        candidateNetlist: index.getCandidateNetlistSummary(),
        unresolvedComponents: index.getUnresolvedComponentSummary(),
        partMasters: index.getPartMasterSummary(),
        datasheets:
          datasheets?.getSummary() ?? {
            binding: "NOT_BOUND",
            sourceAuthenticity: "NOT_VERIFIED"
          },
        projectVersionDiff:
          projectVersionDiff?.summary ?? {
            binding: "NOT_BOUND",
            projectContinuity: "NOT_VERIFIED",
            sourceAuthenticity: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          },
        netlistComparison:
          netlistComparison?.getSummary() ?? {
            binding: "NOT_BOUND",
            officialNetlistComparison: "NOT_PERFORMED",
            sourceAuthenticity: "NOT_VERIFIED",
            projectBinding: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          }
        };
      })
  );

  server.registerTool(
    "get_netlist_comparison_summary",
    {
      title: "获取可选网表比较摘要",
      description:
        "返回 MCP 启动时可选绑定的 .enet 比较计数、哈希和门禁。精确匹配仍不证明来源真实性、运行时工程绑定或完整电气真值。",
      annotations: READ_ONLY_ANNOTATIONS
    },
    () => {
      const netlistComparison = currentNetlistComparison();
      return createMcpResult(
        netlistComparison?.getSummary() ?? {
          binding: "NOT_BOUND",
          officialNetlistComparison: "NOT_PERFORMED",
          sourceAuthenticity: "NOT_VERIFIED",
          projectBinding: "NOT_VERIFIED",
          electricalTruth: "NOT_VERIFIED"
        }
      );
    }
  );

  server.registerTool(
    "list_netlist_comparison_tuples",
    {
      title: "分页查询网表比较元组",
      description:
        "分页查询匹配、官方网表缺失候选或候选多余元组。结果来自可选用户 .enet 绑定，始终保持来源、工程绑定和电气真值未验证。",
      inputSchema: {
        kind: z
          .enum([
            "MATCHED",
            "MISSING_IN_CANDIDATE",
            "UNEXPECTED_CANDIDATE"
          ])
          .optional(),
        componentRef: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确位号"),
        pinNumber: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确引脚编号"),
        netName: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确网络名"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) => {
      const netlistComparison = currentNetlistComparison();
      return netlistComparison === undefined
        ? createMcpResult({
            binding: "NOT_BOUND",
            page: { items: [], total: 0 },
            officialNetlistComparison: "NOT_PERFORMED",
            sourceAuthenticity: "NOT_VERIFIED",
            projectBinding: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          })
        : runQuery(() => ({
            binding: "USER_PROVIDED_NETLIST_BOUND",
            page: netlistComparison!.listTuples(args),
            officialNetlistComparison:
              netlistComparison!.report.comparison.status,
            sourceAuthenticity: "NOT_VERIFIED",
            projectBinding: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          }));
    }
  );

  server.registerTool(
    "list_bound_electrical_nets",
    {
      title: "分页列出绑定网表的电气网络超边",
      description:
        "把启动时绑定并严格解析的 .enet 中每个非空网络保持为一个超边，分页返回唯一端点组计数、涉及元件数、候选对照和重复项状态。可按精确位号或比较状态筛选；不把多端网络展开为两两连接，不跨器件推导传播。",
      inputSchema: {
        comparisonStatus: z
          .enum([
            "EXACT_SET_MATCH",
            "DIFFERENCES_FOUND",
            "DUPLICATE_TUPLES"
          ])
          .optional(),
        componentRef: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确位号；只保留绑定网表中包含该元件的网络"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) => {
      const netlistComparison = currentNetlistComparison();
      return netlistComparison === undefined
        ? createMcpResult({
            binding: "NOT_BOUND",
            page: { items: [], total: 0 },
            representation: "NET_HYPEREDGE",
            propagation: "NOT_EVALUATED",
            sourceAuthenticity: "NOT_VERIFIED",
            projectBinding: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          })
        : runQuery(() => ({
            binding: "USER_PROVIDED_NETLIST_BOUND",
            page: netlistComparison!.listBoundElectricalNets(args),
            representation: "NET_HYPEREDGE",
            propagation: "NOT_EVALUATED",
            sourceAuthenticity: "NOT_VERIFIED",
            projectBinding: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          }));
    }
  );

  server.registerTool(
    "get_net",
    {
      title: "获取绑定网表中的精确网络",
      description:
        "按精确网络名分页返回启动时绑定并严格解析的 .enet 端点、离线候选对照和逐项证据。未绑定 .enet 时不可用；匹配结果不证明用户文件来源真实性、运行时工程绑定或完整电气真值。",
      inputSchema: {
        netName: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .describe("绑定 .enet 中的精确网络名，区分大小写"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) => {
      const netlistComparison = currentNetlistComparison();
      return netlistComparison === undefined
        ? createMcpResult({
            binding: "NOT_BOUND",
            lookup: { status: "NOT_AVAILABLE" },
            sourceAuthenticity: "NOT_VERIFIED",
            projectBinding: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          })
        : runQuery(() => ({
            binding: "USER_PROVIDED_NETLIST_BOUND",
            lookup: netlistComparison!.getNet(args),
            sourceAuthenticity: "NOT_VERIFIED",
            projectBinding: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          }));
    }
  );

  server.registerTool(
    "list_design_hierarchy",
    {
      title: "分页列出工程设计层级",
      description:
        "分页返回工程配置、Board、Schematic、Sheet 和显式 INSTANCE 上下文节点。父子关系只来自归档成员关系、META 引用或已校验 INSTANCE 路径，不根据名称猜测。",
      inputSchema: {
        kind: z
          .enum([
            "PROJECT_CONFIGURATION",
            "BOARD",
            "SCHEMATIC",
            "SHEET",
            "INSTANCE_CONTEXT"
          ])
          .optional(),
        parentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确父节点 ID"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listDesignHierarchy(args),
        relationshipTruth: "EXPLICIT_METADATA_ONLY"
      }))
  );

  server.registerTool(
    "list_instance_contexts",
    {
      title: "分页列出显式层级实例上下文",
      description:
        "兼容官方页号编码和当前导出的页面 ID/Block 编码，分页返回已校验的层级路径、终端页、解析状态和有效组件实例数量。",
      inputSchema: {
        schematicId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 Schematic 文档 ID"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listInstanceContexts(args),
        pathTruth: "EXPLICIT_INSTANCE_DOCUMENT_PATH",
        sheetResolution: "DETERMINISTIC_REFERENCE_RESOLUTION"
      }))
  );

  server.registerTool(
    "get_instance_context",
    {
      title: "获取实例上下文及原始属性覆盖",
      description:
        "通过精确 INSTANCE 文档 ID 获取已校验路径，并分页返回每条 INSTANCE_ATTR 的应用状态与精确目标；未解析项保留稳定原因，不会被猜测应用。",
      inputSchema: {
        contextId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .describe("精确 INSTANCE 文档 UUID"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.getInstanceContext(args)
      }))
  );

  server.registerTool(
    "list_components",
    {
      title: "分页列出组件",
      description:
        "按确定顺序分页列出组件，可按页面、位号、层级实例、装配状态和引脚完整性筛选。Add into BOM=yes/no 分别形成 POPULATED/DNP；缺失、冲突、非法或未应用 Variant 返回 UNKNOWN。",
      inputSchema: {
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("精确页面 ID"),
        designatorContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("不区分大小写的位号子串"),
        instanceContextId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 INSTANCE 上下文 ID"),
        variantId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选当前工程 Variant ID；替代料未应用时装配状态返回 UNKNOWN"),
        assemblyStatus: z
          .enum(["POPULATED", "DNP", "UNKNOWN"])
          .optional()
          .describe("可选有效装配状态"),
        pinCompletenessStatus: z
          .enum(["COMPLETE", "PARTIAL", "UNKNOWN"])
          .optional()
          .describe("可选逻辑器件引脚完整性状态"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listComponents(args)
      }))
  );

  server.registerTool(
    "list_schematic_annotations",
    {
      title: "分页列出原理图页文本注释",
      description:
        "分页返回 SCH_PAGE TEXT 的显式内容、原始未换算位置和来源，可按页面、文本子串或空值状态筛选。工具不把文字解释成设计意图、约束或电气事实。",
      inputSchema: {
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页 ID"),
        textContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选不区分大小写的文本子串"),
        contentState: z
          .enum(["EXPLICIT_TEXT", "EXPLICIT_EMPTY"])
          .optional()
          .describe("可选显式文本状态"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listSchematicAnnotations(args),
        coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
        sourceAuthenticity: "NOT_VERIFIED",
        semanticInterpretation: "NOT_PERFORMED",
        electricalTruth: "NOT_APPLICABLE"
      }))
  );

  server.registerTool(
    "list_schematic_graphic_primitives",
    {
      title: "分页列出原理图与符号图形",
      description:
        "分页返回 SCH_PAGE/SYMBOL 中显式 POLY、RECT、ARC、CIRCLE、ELLIPSE 的原始未换算几何、样式字面值、来源及 Symbol Part 精确绑定状态。只验证有限字段和点数组编码，不解释图形语义、电气含义或渲染结果。",
      inputSchema: {
        documentType: z
          .enum(["SCHEMATIC_PAGE", "SYMBOL"])
          .optional()
          .describe("可选图形所属文档类型"),
        documentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页或 Symbol 文档 ID"),
        kind: z
          .enum(["POLY", "RECT", "ARC", "CIRCLE", "ELLIPSE"])
          .optional()
          .describe("可选图形种类"),
        partId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确非空 Symbol Part ID"),
        partBindingState: z
          .enum([
            "NOT_APPLICABLE",
            "RESOLVED_EXACT",
            "EXPLICIT_EMPTY",
            "PART_NOT_FOUND"
          ])
          .optional()
          .describe("可选 Symbol Part 绑定状态"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listSchematicGraphicPrimitives(args),
        coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
        geometryValidation: "FINITE_FIELDS_AND_POINT_ENCODING_VALIDATED",
        sourceAuthenticity: "NOT_VERIFIED",
        semanticInterpretation: "NOT_PERFORMED",
        electricalTruth: "NOT_APPLICABLE"
      }))
  );

  server.registerTool(
    "list_schematic_tables",
    {
      title: "分页列出原理图结构化表格",
      description:
        "分页返回 SCH_PAGE/SYMBOL TABLE 的尺寸、位置、锁定状态、单元格计数、来源和 Symbol Part 精确绑定状态。可按文档、绑定状态或单元格文字筛选；列表不展开单元格，也不解释文字语义。",
      inputSchema: {
        documentType: z
          .enum(["SCHEMATIC_PAGE", "SYMBOL"])
          .optional()
          .describe("可选表格所属文档类型"),
        documentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页或 Symbol 文档 ID"),
        partBindingState: z
          .enum([
            "NOT_APPLICABLE",
            "RESOLVED_EXACT",
            "EXPLICIT_EMPTY",
            "PART_NOT_FOUND"
          ])
          .optional()
          .describe("可选 Symbol Part 绑定状态"),
        cellTextContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选不区分大小写的单元格文字子串"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listSchematicTables(args),
        coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
        layoutValidation: "INDEX_AND_SPAN_BOUNDS_VALIDATED",
        sourceAuthenticity: "NOT_VERIFIED",
        semanticInterpretation: "NOT_PERFORMED",
        electricalTruth: "NOT_APPLICABLE"
      }))
  );

  server.registerTool(
    "get_schematic_table",
    {
      title: "获取原理图表格及分页单元格",
      description:
        "按所属文档 ID 和表格 ID 获取结构化表格，并分页返回显式单元格。可按文字、空值状态或来源表示筛选；不会把高低电平、模式名称等内容解释成设计或电气结论。",
      inputSchema: {
        documentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .describe("精确原理图页或 Symbol 文档 ID"),
        tableId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .describe("精确 TABLE ID"),
        cellContentState: z
          .enum(["EXPLICIT_TEXT", "EXPLICIT_EMPTY"])
          .optional()
          .describe("可选单元格显式文本状态"),
        cellRepresentation: z
          .enum([
            "V3_INLINE_TABLE_CELL",
            "OFFICIAL_SEPARATE_TABLE_RECORD",
            "BOTH_MATCHING"
          ])
          .optional()
          .describe("可选单元格来源表示"),
        cellTextContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选不区分大小写的单元格文字子串"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.getSchematicTable(args),
        coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
        layoutValidation: "INDEX_AND_SPAN_BOUNDS_VALIDATED",
        sourceAuthenticity: "NOT_VERIFIED",
        semanticInterpretation: "NOT_PERFORMED",
        electricalTruth: "NOT_APPLICABLE"
      }))
  );

  server.registerTool(
    "list_symbol_texts",
    {
      title: "分页列出符号显式文本",
      description:
        "分页返回 SYMBOL TEXT 的显式内容、原始未换算位置、来源和 Part 精确绑定状态。可按 Symbol、Part、文本子串、空值状态或绑定状态筛选；不解释文字语义。",
      inputSchema: {
        symbolId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 Symbol 文档 ID"),
        partId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确非空 Part ID"),
        textContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选不区分大小写的文本子串"),
        contentState: z
          .enum(["EXPLICIT_TEXT", "EXPLICIT_EMPTY"])
          .optional()
          .describe("可选显式文本状态"),
        partBindingState: z
          .enum(["RESOLVED_EXACT", "EXPLICIT_EMPTY", "PART_NOT_FOUND"])
          .optional()
          .describe("可选 Part 绑定状态"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listSymbolTexts(args),
        coordinateSemantics: "EASYEDA_V3_SCHEMATIC_RAW_UNCONVERTED",
        sourceAuthenticity: "NOT_VERIFIED",
        semanticInterpretation: "NOT_PERFORMED",
        electricalTruth: "NOT_APPLICABLE"
      }))
  );

  server.registerTool(
    "list_unresolved_components",
    {
      title: "分页列出未解析元件",
      description:
        "分页返回缺少精确料号身份、身份属性非法/冲突、Device 引用异常或 Symbol/Footprint 绑定未解析的有位号元件。身份仅来自组件显式属性，其次为 Device 显式默认属性；不执行采购目录匹配、近似匹配、替代料推荐或变体应用。",
      inputSchema: {
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确页面 ID"),
        designatorContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选不区分大小写的位号子串"),
        identityMethod: z
          .enum([
            "EXACT_LCSC_PART_ID",
            "EXACT_MANUFACTURER_AND_MPN",
            "UNRESOLVED"
          ])
          .optional()
          .describe("可选身份解析方法"),
        reason: z
          .enum(UNRESOLVED_COMPONENT_REASONS)
          .optional()
          .describe("可选未解析原因"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listUnresolvedComponents(args),
        summary: index.getUnresolvedComponentSummary(),
        identityBasis:
          "EXPLICIT_COMPONENT_ATTRIBUTE_THEN_DEVICE_ATTRIBUTE",
        procurementMatch: "NOT_PERFORMED",
        variantApplication: "NOT_APPLIED"
      }))
  );

  server.registerTool(
    "list_part_masters",
    {
      title: "分页列出物料主数据",
      description:
        "按显式 LCSC C-ID 或显式制造商与 MPN 的精确身份确定性聚合有位号元件。可按身份字段精确筛选；不执行采购目录匹配、数据手册绑定、模糊合并、替代料推荐或变体应用。",
      inputSchema: {
        identityMethod: z
          .enum([
            "EXACT_LCSC_PART_ID",
            "EXACT_MANUFACTURER_AND_MPN"
          ])
          .optional()
          .describe("可选精确身份聚合方法"),
        lcscPartId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 LCSC C-ID"),
        manufacturer: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确制造商"),
        manufacturerPart: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确制造商料号 MPN"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listPartMasters(args),
        summary: index.getPartMasterSummary()
      }))
  );

  server.registerTool(
    "get_part_master",
    {
      title: "获取物料主数据及元件出现位置",
      description:
        "按 list_part_masters 返回的确定性 PartMaster ID 获取主数据，并分页返回关联元件及其身份字段证据。不会执行目录、数据手册或 Variant 绑定。",
      inputSchema: {
        partMasterId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .describe("精确 PartMaster ID"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.getPartMaster(args),
        catalogMatch: "NOT_PERFORMED",
        datasheetBinding: "NOT_PERFORMED",
        variantApplication: "NOT_APPLIED"
      }))
  );

  server.registerTool(
    "list_datasheet_references",
    {
      title: "分页列出本地数据表引用",
      description:
        "分页列出 MCP 启动时绑定并独立校验的本地 DocumentReference。只按精确 PartMaster、LCSC C-ID 或制造商与 MPN 过滤；不联网匹配，不证明 PDF 来源真实性。",
      inputSchema: {
        kind: z.enum(DOCUMENT_REFERENCE_KINDS).optional(),
        partMasterId: z.string().min(1).max(QUERY_LIMITS.maxTextLength).optional(),
        lcscPartId: z.string().min(1).max(QUERY_LIMITS.maxTextLength).optional(),
        manufacturer: z.string().min(1).max(QUERY_LIMITS.maxTextLength).optional(),
        manufacturerPart: z.string().min(1).max(QUERY_LIMITS.maxTextLength).optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      datasheets === undefined
        ? createMcpResult({
            binding: "NOT_BOUND",
            page: { items: [], total: 0 },
            sourceAuthenticity: "NOT_VERIFIED"
          })
        : runQuery(() => ({
            binding: "LOCAL_VERIFIED_DATASHEET_STORE",
            page: datasheets!.listReferences(args),
            sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED",
            electricalTruth: "NOT_APPLICABLE_DEVICE_DOCUMENT_FACTS"
          }))
  );

  server.registerTool(
    "get_datasheet_section",
    {
      title: "读取本地数据表章节或主题",
      description:
        "按 DocumentReference ID 和 PDF 书签章节 ID，或按主题文本，返回有界页文本。工具不接受文件路径；每次读取都会复验不可变证据包。PDF 文本不是版面真值，来源真实性仍未验证。",
      inputSchema: {
        documentReferenceId: z.string().min(1).max(QUERY_LIMITS.maxTextLength),
        sectionId: z.string().min(1).max(QUERY_LIMITS.maxTextLength).optional(),
        topic: z.string().min(1).max(QUERY_LIMITS.maxTextLength).optional(),
        maxPages: z.number().int().min(1).max(10).optional(),
        maxChars: z.number().int().min(256).max(64_000).optional()
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      datasheets === undefined
        ? createMcpResult({
            binding: "NOT_BOUND",
            status: "NOT_AVAILABLE",
            sourceAuthenticity: "NOT_VERIFIED"
          })
        : runAsyncQuery(async () => ({
            binding: "LOCAL_VERIFIED_DATASHEET_STORE",
            lookup: await datasheets!.getSection(args)
          }))
  );

  server.registerTool(
    "get_component",
    {
      title: "获取单个组件",
      description:
        "通过组件 ID 或精确位号获取基础组件，也可指定 instanceContextId 获取层级实例中已应用 INSTANCE_ATTR 后的有效组件。返回显式 DNP/装配证据与多 PART 引脚完整性；替代 Variant 不在 v0.2 中猜测应用。",
      inputSchema: COMPONENT_INSTANCE_SELECTOR,
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.getComponent(args)
      }))
  );

  server.registerTool(
    "get_component_pins",
    {
      title: "获取组件符号引脚",
      description:
        "分页返回逻辑器件已实例化 PART 的合并引脚、隐藏标志、变换连接点及显式网络几何候选；多单元缺失或归属歧义会显式返回 PARTIAL/UNKNOWN，不据此判定未使用引脚。",
      inputSchema: {
        ...COMPONENT_INSTANCE_SELECTOR,
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.getComponentPins(args)
      }))
  );

  server.registerTool(
    "get_component_pin_connectivity",
    {
      title: "获取组件引脚连接上下文",
      description:
        "对任意组件分页返回原理图引脚、可选绑定 .enet 的引脚名称与精确网络、离线候选和资料可用状态。不判断器件是否为主控，不把用户网表或几何候选升级为完整电气真值。",
      inputSchema: {
        ...COMPONENT_SELECTOR,
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: componentConnectivity().getPinConnectivity(args),
        sourceAuthenticity: "NOT_VERIFIED",
        projectBinding: "USER_ASSERTED_NOT_VERIFIED",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "list_direct_component_connections",
    {
      title: "分页列出组件的直接同网连接",
      description:
        "以任意组件为起点，分页列出同一网络超边上的其他组件引脚。有绑定 .enet 时优先使用其端点，否则返回纯 .epro2 候选；不跨电阻、磁珠、收发器、电平转换器、Short、Net Tie 或其他器件传播。",
      inputSchema: {
        ...COMPONENT_SELECTOR,
        pinNumber: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确源引脚编号"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: componentConnectivity().listDirectConnections(args),
        propagation: "DIRECT_SAME_NET_ONLY",
        sourceAuthenticity: "NOT_VERIFIED",
        projectBinding: "USER_ASSERTED_NOT_VERIFIED",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "get_variant",
    {
      title: "获取变体及元件分组",
      description:
        "通过变体 ID 或精确名称查询 Variant，并分页返回显式关联的 COMPONENT_GROUP。GROUP_DATA 即使匹配 INSTANCE 文档 ID 也尚未解析目标图元。",
      inputSchema: {
        ...VARIANT_SELECTOR,
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.getVariant(args)
      }))
  );

  server.registerTool(
    "list_variant_overrides",
    {
      title: "分页列出变体原始属性覆盖",
      description:
        "分页返回 COMPONENT_GROUP.GROUP_DATA 中的显式属性和值及来源，并仅按精确 ID 标注 INSTANCE 文档是否存在。目标尚未解释为最终组件、引脚或 DNP 状态。",
      inputSchema: {
        ...VARIANT_SELECTOR,
        groupId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确元件分组 ID"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.listVariantOverrides(args)
      }))
  );

  server.registerTool(
    "list_explicit_nets",
    {
      title: "分页列出显式网络标签",
      description:
        "聚合导线记录中的显式 NET 标签。结果不等同于完整网络图，也不包含引脚连通关系。",
      inputSchema: {
        nameContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("不区分大小写的网络名子串"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listExplicitNets(args)
      }))
  );

  server.registerTool(
    "list_buses",
    {
      title: "分页列出显式 BUS 或 BUSENTRY",
      description:
        "分页返回显式 BUS 本体或 BUSENTRY 入口。兼容官方独立 BUSENTRY 与当前导出的内嵌 busEntry；保留 NET、order、坐标、旋转、编码和绑定状态，不展开 DATA[7:0] 等名称，也不靠几何猜测独立入口归属。",
      inputSchema: {
        view: z
          .enum(["BUSES", "ENTRIES"])
          .optional()
          .describe("返回 BUS 列表或 BUSENTRY 列表；默认 BUSES"),
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页 ID"),
        busId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 BUS ID；ENTRIES 视图只返回已绑定该 BUS 的入口"),
        netNameContains: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("仅 BUSES 视图：不区分大小写的 NET 子串"),
        busEncoding: z
          .enum([
            "OFFICIAL_DOTS_WITH_SEPARATE_BUSENTRY_RECORDS",
            "OBSERVED_EMBEDDED_BUSENTRY_MAP",
            "HYBRID_DOTS_WITH_EMBEDDED_BUSENTRY_MAP"
          ])
          .optional()
          .describe("仅 BUSES 视图：显式 BUS 编码筛选"),
        entryEncoding: z
          .enum([
            "OFFICIAL_SEPARATE_BUSENTRY_RECORD",
            "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM"
          ])
          .optional()
          .describe("仅 ENTRIES 视图：BUSENTRY 编码筛选"),
        associationStatus: z
          .enum([
            "EMBEDDED_IN_BUS_RECORD",
            "EXPLICIT_PARENT_ID",
            "SEPARATE_RECORD_WITHOUT_EXPLICIT_BUS_ID",
            "EXPLICIT_PARENT_ID_NOT_FOUND"
          ])
          .optional()
          .describe("仅 ENTRIES 视图：入口归属状态筛选"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => {
        const view = args.view ?? "BUSES";
        if (view === "ENTRIES") {
          if (
            args.netNameContains !== undefined ||
            args.busEncoding !== undefined
          ) {
            throw new QueryError(
              "QUERY_INVALID_TEXT",
              "ENTRIES 视图不能使用 NET 或 BUS 编码筛选。"
            );
          }
          return {
            view,
            page: index.listBusEntries({
              pageId: args.pageId,
              busId: args.busId,
              encoding: args.entryEncoding,
              associationStatus: args.associationStatus,
              limit: args.limit,
              cursor: args.cursor
            })
          };
        }
        if (
          args.entryEncoding !== undefined ||
          args.associationStatus !== undefined
        ) {
          throw new QueryError(
            "QUERY_INVALID_TEXT",
            "BUSES 视图不能使用 BUSENTRY 编码或归属状态筛选。"
          );
        }
        return {
          view,
          page: index.listBuses({
            pageId: args.pageId,
            busId: args.busId,
            netNameContains: args.netNameContains,
            encoding: args.busEncoding,
            limit: args.limit,
            cursor: args.cursor
          })
        };
      })
  );

  server.registerTool(
    "list_interfaces",
    {
      title: "分页列出接口候选",
      description:
        "使用版本化确定性规则从显式引脚名称和网络候选识别 SWD/JTAG、UART、I²C、SPI/QSPI、CAN、USB、Ethernet、SDIO、I²S/SAI、模拟和 GPIO 接口。缺失规定信号只返回 PARTIAL_CANDIDATE；DNP 默认排除，可显式查询排除证据。",
      inputSchema: {
        type: z
          .enum([
            "SWD",
            "JTAG",
            "UART",
            "I2C",
            "SPI",
            "QSPI",
            "CAN",
            "USB",
            "ETHERNET",
            "SDIO",
            "I2S_SAI",
            "ANALOG",
            "GPIO_GROUP"
          ])
          .optional()
          .describe("可选接口类型"),
        status: z
          .enum(["CANDIDATE", "PARTIAL_CANDIDATE", "UNRESOLVED"])
          .optional()
          .describe("可选接口识别状态"),
        activityStatus: z
          .enum(["ACTIVE", "EXCLUDED_DNP", "ASSEMBLY_UNKNOWN", "ALL"])
          .optional()
          .describe("装配活动筛选；默认仅 ACTIVE，ALL 同时返回 DNP 排除和装配未知证据"),
        componentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确组件 ID"),
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页 ID"),
        instanceContextId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 INSTANCE 上下文 ID"),
        variantId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选当前工程 Variant ID；未应用 Variant 时接口活动状态保守为 ASSEMBLY_UNKNOWN"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        semanticRuleSetVersion: "schemcp.semantic-rules/1",
        page: index.listInterfaces(args)
      }))
  );

  server.registerTool(
    "get_power_tree",
    {
      title: "获取有界电源树候选",
      description:
        "沿页作用域显式电源网络、明确 POWER_INPUT/LDO/DC-DC 角色和带证据的电源开关、保护或滤波候选传输边进行有界遍历。不会穿过普通器件猜测连通，支持多个根、环路和 DNP/实例/Variant 作用域。",
      inputSchema: RESOURCE_GRAPH_INPUT,
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) => runQuery(() => ({ ...resourceGraph().query("POWER", args) }))
  );

  server.registerTool(
    "get_clock_tree",
    {
      title: "获取外部时钟树候选",
      description:
        "只沿原理图中外部晶振/振荡器、显式身份的时钟缓冲候选和 MCU 外部时钟输入网络进行有界查询；不推断 MCU 内部 PLL、内部时钟树或固件配置。",
      inputSchema: RESOURCE_GRAPH_INPUT,
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) => runQuery(() => ({ ...resourceGraph().query("CLOCK", args) }))
  );

  server.registerTool(
    "get_reset_boot_paths",
    {
      title: "获取复位与启动绑带路径候选",
      description:
        "查询显式 RESET/RST/BOOT/STRAP 网络上的监督器、连接器外部控制、手动复位、MCU 输入和可证明的无源上下拉候选。只返回原理图外部路径，不推断芯片内部启动逻辑或固件行为。",
      inputSchema: RESOURCE_GRAPH_INPUT,
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({ ...resourceGraph().query("RESET_BOOT", args) }))
  );

  server.registerTool(
    "get_mcu_pin_usage",
    {
      title: "获取 MCU 引脚使用状态",
      description:
        "分页返回全部 MCU_MPU 角色候选的完整多单元引脚，以及 USED/EXPLICIT_NC/UNUSED/UNKNOWN/DNP_COMPONENT 状态、细分网表或候选依据、电源域、接口、外部资源角色和稳定未解析原因。只有引脚模型 COMPLETE、基础 Variant、器件已装配，且工程显式 NC 或已绑定 .enet 明确空网络时才确认未使用；其余未连接表象保持 UNKNOWN。",
      inputSchema: {
        componentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 MCU 组件 ID"),
        designator: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 MCU 位号；歧义时需补 pageId"),
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页 ID"),
        instanceContextId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确 INSTANCE 上下文 ID"),
        variantId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选 Variant ID；当前未应用 Variant 时不得确认未使用"),
        status: z
          .enum(["USED", "EXPLICIT_NC", "UNUSED", "UNKNOWN", "DNP_COMPONENT"])
          .optional()
          .describe("可选目标级 MCU 引脚资源状态"),
        usageStatus: z
          .enum([
            "USED_BOUND_NETLIST",
            "USED_CANDIDATE",
            "UNUSED_CONFIRMED",
            "UNKNOWN"
          ])
          .optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({ ...componentConnectivity().getMcuPinUsage(args) }))
  );

  server.registerTool(
    "list_candidate_netlist_tuples",
    {
      title: "分页列出规范化候选网表元组",
      description:
        "分页返回可组成 (位号, 引脚号, 网络名) 的候选元组及图元证据。元组来自显式导线标签和几何接触，尚未与 .enet 或嘉立创EDA API 真值比较，不等同于正式网表。",
      inputSchema: {
        componentRef: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确位号，区分大小写"),
        pinNumber: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确引脚号，保持源值"),
        netName: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确网络名，区分大小写"),
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页 ID"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listCandidateNetlistTuples(args),
        compilation: index.getCandidateNetlistSummary(),
        basis: "EXPLICIT_WIRE_LABEL_AND_GEOMETRIC_PIN_CONTACT_CANDIDATE",
        officialNetlistComparison: "NOT_PERFORMED",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "list_candidate_netlist_exclusions",
    {
      title: "分页列出候选网表排除项",
      description:
        "分页返回没有进入规范化候选网表的引脚实例及确定性原因，用于定位非普通端点、无标签导线、NC、无导线、缺失字段和冲突。排除清单不是官方网表差异报告。",
      inputSchema: {
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确原理图页 ID"),
        componentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确组件 ID"),
        reason: z
          .enum([
            "MISSING_COMPONENT_REF",
            "NON_COMPONENT_ENDPOINT",
            "MISSING_PIN_NUMBER",
            "CONFLICTING_EXPLICIT_NET_CANDIDATES",
            "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
            "DECLARED_NO_CONNECT",
            "UNRESOLVED_NO_WIRE",
            "CANDIDATE_STATE_INCONSISTENT"
          ])
          .optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listCandidateNetlistExclusions(args),
        compilation: index.getCandidateNetlistSummary(),
        officialNetlistComparison: "NOT_PERFORMED",
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "list_network_endpoint_candidates",
    {
      title: "分页列出网络端点声明候选",
      description:
        "比较 NetFlag/NetPort 的声明网络名属性候选与其引脚导线候选。字段语义和连接均未通过官方网表验证，结果只用于一致性诊断。",
      inputSchema: {
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确页面 ID"),
        endpointKind: z.enum(["NET_FLAG", "NET_PORT"]).optional(),
        status: z
          .enum([
            "DECLARATION_MATCHES_CONNECTION_CANDIDATE",
            "DECLARATION_MISMATCHES_CONNECTION_CANDIDATE",
            "DECLARATION_MISSING",
            "DECLARATION_CONFLICT",
            "DECLARATION_VALUE_INVALID",
            "CONNECTION_CANDIDATE_UNRESOLVED",
            "INVALID_ENDPOINT_PIN_COUNT"
          ])
          .optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listNetworkEndpointCandidates(args),
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "list_short_relation_candidates",
    {
      title: "分页列出 Short Symbol 关系候选",
      description:
        "按官方 Short Symbol 类型聚合其两个引脚的显式网络候选。结果保留原始网络名，不代表已通过官方网表验证，也不会执行网络合并。",
      inputSchema: {
        pageId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选精确页面 ID"),
        status: z
          .enum([
            "READY_EXPLICIT_NET_PAIR_CANDIDATE",
            "SAME_EXPLICIT_NET_CANDIDATE",
            "UNRESOLVED_PIN_CONNECTION_CANDIDATE",
            "CONFLICTING_PIN_CONNECTION_CANDIDATE",
            "INVALID_SHORT_PIN_COUNT"
          ])
          .optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listShortRelations(args),
        electricalTruth: "NOT_VERIFIED"
      }))
  );

  server.registerTool(
    "diff_project_versions",
    {
      title: "分页比较当前工程与基线工程",
      description:
        "比较 MCP 启动时绑定的当前工程和可选基线工程，分页返回已建模 IR 实体及显式网络的新增、删除和修改。工具不接收文件路径；来源位置与供应商扩展字段不参与语义差异。两个归档是否属于同一产品版本链尚未验证。",
      inputSchema: {
        entityKind: z
          .enum(PROJECT_DIFF_ENTITY_KINDS)
          .optional()
          .describe("可选实体类型"),
        changeType: z
          .enum(PROJECT_DIFF_CHANGE_TYPES)
          .optional()
          .describe("可选变更类型"),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) => {
      const projectVersionDiff = currentProjectVersionDiff();
      return projectVersionDiff === undefined
        ? createMcpResult({
            binding: "NOT_BOUND",
            page: { items: [], total: 0 },
            projectContinuity: "NOT_VERIFIED",
            sourceAuthenticity: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          })
        : runQuery(() => ({
            binding: "BASELINE_PROJECT_BOUND",
            summary: projectVersionDiff!.summary,
            page: projectVersionDiff!.listChanges(args),
            projectContinuity: "NOT_VERIFIED",
            sourceAuthenticity: "NOT_VERIFIED",
            electricalTruth: "NOT_VERIFIED"
          }));
    }
  );

  server.registerTool(
    "get_diagnostics",
    {
      title: "分页获取编译诊断",
      description:
        "返回 EDA-IR 编译过程中的聚合诊断，可按严重级别筛选。",
      inputSchema: {
        severity: z.enum(["warning", "error"]).optional(),
        ...PAGE_INPUT
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        page: index.listDiagnostics(args)
      }))
  );

  server.registerTool(
    "get_evidence",
    {
      title: "获取对象来源证据",
      description:
        "返回组件、符号引脚、符号文字、原理图表格、原理图图形、导线、BUS/BUSENTRY、原理图注释、Variant 或元件组的原始 V3 日志来源位置；重复局部 ID 会显式返回歧义。",
      inputSchema: {
        objectType: z.enum([
          "component",
          "symbolPin",
          "wire",
          "variant",
          "componentGroup",
          "schematicAnnotation",
          "schematicGraphicPrimitive",
          "schematicTable",
          "symbolText",
          "bus",
          "busEntry"
        ]),
        objectId: z.string().min(1).max(QUERY_LIMITS.maxTextLength),
        documentId: z
          .string()
          .min(1)
          .max(QUERY_LIMITS.maxTextLength)
          .optional()
          .describe("可选所属文档 ID，用于同 ID 对象消歧")
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    (args) =>
      runQuery(() => ({
        lookup: index.getEvidence(args.objectType, args.objectId, args.documentId)
      }))
  );

  return server;
}
