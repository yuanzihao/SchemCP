import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildClaudeCodeMcpConfig,
  buildCodexMcpConfig,
  buildGenericMcpConfig,
  MCP_CLIENT_PATH_ENV,
  MCP_GENERIC_CONFIG_SCHEMA,
  MCP_GENERIC_CONFIG_SCHEMA_VERSION
} from "../../src/mcp/client-config.js";
import {
  MCP_PROCESS_ENV,
  MCP_TOOL_NAMES
} from "../../src/mcp/contract.js";

const INPUT = {
  command: "/opt/node/bin/node",
  serverEntry: "/opt/schemcp/dist/src/mcp/main.js",
  projectPath: "/private/projects/board.epro2"
} as const;

interface GenericConfig {
  readonly schema: string;
  readonly schemaVersion: string;
  readonly server: {
    readonly id: string;
    readonly transport: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
  };
  readonly enabledTools: readonly string[];
}

test("生成唯一版本化 stdio MCP 描述", () => {
  const config = JSON.parse(buildGenericMcpConfig(INPUT)) as GenericConfig;
  assert.equal(config.schema, MCP_GENERIC_CONFIG_SCHEMA);
  assert.equal(config.schemaVersion, MCP_GENERIC_CONFIG_SCHEMA_VERSION);
  assert.equal(config.server.id, "schemcp");
  assert.equal(config.server.transport, "stdio");
  assert.equal(config.server.command, INPUT.command);
  assert.deepEqual(config.server.args, [
    INPUT.serverEntry,
    "--project",
    INPUT.projectPath
  ]);
  assert.deepEqual(config.server.env, {
    NODE_OPTIONS: MCP_PROCESS_ENV.nodeOptions
  });
  assert.deepEqual(config.enabledTools, MCP_TOOL_NAMES);
  assert.equal("profile" in config, false);
  assert.equal(config.server.args.includes("--profile"), false);
});

test("Codex 与 Claude Code 适配器复用同一通用描述", () => {
  const generic = JSON.parse(buildGenericMcpConfig(INPUT)) as GenericConfig;
  const claude = JSON.parse(buildClaudeCodeMcpConfig(INPUT)) as {
    readonly mcpServers: {
      readonly schemcp: {
        readonly type: string;
        readonly command: string;
        readonly args: readonly string[];
        readonly env: Readonly<Record<string, string>>;
      };
    };
  };
  assert.deepEqual(claude.mcpServers.schemcp, {
    type: generic.server.transport,
    command: generic.server.command,
    args: generic.server.args,
    env: generic.server.env
  });

  const codex = buildCodexMcpConfig(INPUT);
  assert.match(codex, /^\[mcp_servers\.schemcp\]$/mu);
  for (const toolName of MCP_TOOL_NAMES) {
    assert.match(codex, new RegExp(JSON.stringify(toolName), "u"));
  }
  assert.doesNotMatch(codex, /list_pcb_|list_footprint_|--profile/u);
});

test("无工程配置支持在会话中打开用户附件", () => {
  const input = {
    command: INPUT.command,
    serverEntry: INPUT.serverEntry
  };
  const generic = JSON.parse(buildGenericMcpConfig(input)) as GenericConfig;
  assert.deepEqual(generic.server.args, [INPUT.serverEntry]);
  assert.ok(generic.enabledTools.includes("open_schematic_project"));

  const claude = JSON.parse(buildClaudeCodeMcpConfig(input)) as {
    readonly mcpServers: {
      readonly schemcp: { readonly args: readonly string[] };
    };
  };
  assert.deepEqual(claude.mcpServers.schemcp.args, [INPUT.serverEntry]);
});

test("portable 配置只通过命名环境变量传递私有路径", () => {
  const input = {
    ...INPUT,
    pathMode: "environment" as const,
    netlistPath: "/private/projects/board.enet",
    baselineProjectPath: "/private/projects/baseline.epro2",
    datasheetStorePath: "/private/projects/datasheets"
  };
  const generic = JSON.parse(buildGenericMcpConfig(input)) as GenericConfig;
  assert.deepEqual(generic.server.args, [
    INPUT.serverEntry,
    "--project-env",
    MCP_CLIENT_PATH_ENV.project,
    "--netlist-env",
    MCP_CLIENT_PATH_ENV.netlist,
    "--baseline-project-env",
    MCP_CLIENT_PATH_ENV.baselineProject,
    "--datasheet-store-env",
    MCP_CLIENT_PATH_ENV.datasheetStore
  ]);
  assert.equal(
    generic.server.env[MCP_CLIENT_PATH_ENV.project],
    INPUT.projectPath
  );
  assert.equal(
    generic.server.env[MCP_CLIENT_PATH_ENV.netlist],
    input.netlistPath
  );
});

test("配置生成拒绝相对路径和错误扩展名", () => {
  assert.throws(
    () => buildClaudeCodeMcpConfig({ ...INPUT, projectPath: "board.epro2" }),
    /绝对路径/u
  );
  assert.throws(
    () =>
      buildCodexMcpConfig({
        ...INPUT,
        projectPath: "/private/projects/board.enet"
      }),
    /\.epro2/u
  );
  assert.throws(
    () =>
      buildClaudeCodeMcpConfig({
        ...INPUT,
        netlistPath: "/private/projects/board.json"
      }),
    /\.enet/u
  );
});

test("mcp-config CLI 输出无 profile 的 generic 描述", () => {
  const cliEntry = fileURLToPath(
    new URL("../../src/cli/main.js", import.meta.url)
  );
  const result = spawnSync(
    process.execPath,
    [cliEntry, "mcp-config", "--client", "generic"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const config = JSON.parse(result.stdout) as GenericConfig;
  assert.deepEqual(config.server.args, [
    fileURLToPath(new URL("../../src/mcp/main.js", import.meta.url))
  ]);
  assert.deepEqual(config.enabledTools, MCP_TOOL_NAMES);
  assert.equal(result.stdout.includes("profile"), false);
});

test("mcp-config CLI 拒绝已经删除的 --profile 参数", () => {
  const cliEntry = fileURLToPath(
    new URL("../../src/cli/main.js", import.meta.url)
  );
  const result = spawnSync(
    process.execPath,
    [
      cliEntry,
      "mcp-config",
      "--client",
      "generic",
      "--profile",
      "schematic"
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 64);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /未知选项：--profile/u);
});
