import { extname, isAbsolute } from "node:path";
import {
  MCP_PROCESS_ENV,
  MCP_TOOL_NAMES
} from "./contract.js";

export type McpClientKind = "generic" | "codex" | "claude-code";
export type McpClientPathMode = "arguments" | "environment";

export const MCP_GENERIC_CONFIG_SCHEMA =
  "schemcp.mcp-stdio-client-config";
export const MCP_GENERIC_CONFIG_SCHEMA_VERSION = "1.0.0";

export const MCP_CLIENT_PATH_ENV = {
  project: "EDA_PROJECT_PATH",
  netlist: "EDA_NETLIST_PATH",
  baselineProject: "EDA_BASELINE_PROJECT_PATH",
  datasheetStore: "EDA_DATASHEET_STORE"
} as const;

export interface McpClientConfigInput {
  readonly command: string;
  readonly serverEntry: string;
  readonly projectPath?: string;
  readonly netlistPath?: string;
  readonly baselineProjectPath?: string;
  readonly datasheetStorePath?: string;
  readonly pathMode?: McpClientPathMode;
}

export interface McpStdioLaunchDescriptor {
  readonly id: "schemcp";
  readonly transport: "stdio";
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface GenericMcpClientConfig {
  readonly schema: typeof MCP_GENERIC_CONFIG_SCHEMA;
  readonly schemaVersion: typeof MCP_GENERIC_CONFIG_SCHEMA_VERSION;
  readonly server: McpStdioLaunchDescriptor;
  readonly enabledTools: readonly string[];
}

function assertAbsolutePath(label: string, value: string): void {
  if (!isAbsolute(value)) {
    throw new Error(`${label} 必须是绝对路径。`);
  }
}

function validateInput(input: McpClientConfigInput): void {
  assertAbsolutePath("Node.js 命令", input.command);
  assertAbsolutePath("MCP 服务入口", input.serverEntry);
  if (input.projectPath !== undefined) {
    assertAbsolutePath("EDA 工程", input.projectPath);
    if (extname(input.projectPath).toLowerCase() !== ".epro2") {
      throw new Error("EDA 工程必须是 .epro2 文件。");
    }
  } else if (
    input.netlistPath !== undefined ||
    input.baselineProjectPath !== undefined ||
    input.datasheetStorePath !== undefined ||
    input.pathMode === "environment"
  ) {
    throw new Error(
      "无启动工程时不能配置 portable、网表、基线工程或数据表库启动绑定。"
    );
  }
  if (input.netlistPath !== undefined) {
    assertAbsolutePath("EDA 网表", input.netlistPath);
    if (extname(input.netlistPath).toLowerCase() !== ".enet") {
      throw new Error("EDA 网表必须是 .enet 文件。");
    }
  }
  if (input.baselineProjectPath !== undefined) {
    assertAbsolutePath("EDA 基线工程", input.baselineProjectPath);
    if (extname(input.baselineProjectPath).toLowerCase() !== ".epro2") {
      throw new Error("EDA 基线工程必须是 .epro2 文件。");
    }
  }
  if (input.datasheetStorePath !== undefined) {
    assertAbsolutePath("数据表库", input.datasheetStorePath);
  }
}

function serverArgs(input: McpClientConfigInput): readonly string[] {
  const environmentMode = input.pathMode === "environment";
  return [
    input.serverEntry,
    ...(input.projectPath === undefined
      ? []
      : [
          environmentMode ? "--project-env" : "--project",
          environmentMode
            ? MCP_CLIENT_PATH_ENV.project
            : input.projectPath
        ]),
    ...(input.netlistPath === undefined
      ? []
      : [
          environmentMode ? "--netlist-env" : "--netlist",
          environmentMode
            ? MCP_CLIENT_PATH_ENV.netlist
            : input.netlistPath
        ]),
    ...(input.baselineProjectPath === undefined
      ? []
      : [
          environmentMode
            ? "--baseline-project-env"
            : "--baseline-project",
          environmentMode
            ? MCP_CLIENT_PATH_ENV.baselineProject
            : input.baselineProjectPath
        ]),
    ...(input.datasheetStorePath === undefined
      ? []
      : [
          environmentMode
            ? "--datasheet-store-env"
            : "--datasheet-store",
          environmentMode
            ? MCP_CLIENT_PATH_ENV.datasheetStore
            : input.datasheetStorePath
        ])
  ];
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function clientEnvironment(
  input: McpClientConfigInput
): Readonly<Record<string, string>> {
  return {
    NODE_OPTIONS: MCP_PROCESS_ENV.nodeOptions,
    ...(input.pathMode !== "environment" ||
    input.projectPath === undefined
      ? {}
      : {
          [MCP_CLIENT_PATH_ENV.project]: input.projectPath,
          ...(input.netlistPath === undefined
            ? {}
            : { [MCP_CLIENT_PATH_ENV.netlist]: input.netlistPath }),
          ...(input.baselineProjectPath === undefined
            ? {}
            : {
                [MCP_CLIENT_PATH_ENV.baselineProject]:
                  input.baselineProjectPath
              }),
          ...(input.datasheetStorePath === undefined
            ? {}
            : {
                [MCP_CLIENT_PATH_ENV.datasheetStore]:
                  input.datasheetStorePath
              })
        })
  };
}

export function buildCodexMcpConfig(
  input: McpClientConfigInput
): string {
  const generic = buildGenericMcpConfigObject(input);
  const enabledTools = generic.enabledTools.map(
    (toolName) => `  ${tomlString(toolName)},`
  ).join("\n");
  const environment = Object.entries(generic.server.env).map(
    ([name, value]) => `${name} = ${tomlString(value)}`
  );
  return [
    "[mcp_servers.schemcp]",
    `command = ${tomlString(generic.server.command)}`,
    "args = [",
    ...generic.server.args.map(
      (argument) => `  ${tomlString(argument)},`
    ),
    "]",
    "required = true",
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 30",
    'default_tools_approval_mode = "writes"',
    "enabled_tools = [",
    enabledTools,
    "]",
    "",
    "[mcp_servers.schemcp.env]",
    ...environment,
    ""
  ].join("\n");
}

export function buildClaudeCodeMcpConfig(
  input: McpClientConfigInput
): string {
  const generic = buildGenericMcpConfigObject(input);
  return `${JSON.stringify(
    {
      mcpServers: {
        "schemcp": {
          type: generic.server.transport,
          command: generic.server.command,
          args: generic.server.args,
          env: generic.server.env
        }
      }
    },
    null,
    2
  )}\n`;
}

export function buildGenericMcpConfigObject(
  input: McpClientConfigInput
): GenericMcpClientConfig {
  validateInput(input);
  return {
    schema: MCP_GENERIC_CONFIG_SCHEMA,
    schemaVersion: MCP_GENERIC_CONFIG_SCHEMA_VERSION,
    server: {
      id: "schemcp",
      transport: "stdio",
      command: input.command,
      args: serverArgs(input),
      env: clientEnvironment(input)
    },
    enabledTools: MCP_TOOL_NAMES
  };
}

export function buildGenericMcpConfig(
  input: McpClientConfigInput
): string {
  return `${JSON.stringify(
    buildGenericMcpConfigObject(input),
    null,
    2
  )}\n`;
}
