#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  MCP_PROCESS_ENV,
  MCP_SERVER_VERSION,
  MCP_TOOL_NAMES
} from "../mcp/contract.js";

function structured(result: unknown): Record<string, unknown> {
  assert.ok(typeof result === "object" && result !== null);
  const content = (result as { readonly structuredContent?: unknown })
    .structuredContent;
  assert.ok(typeof content === "object" && content !== null);
  return content as Record<string, unknown>;
}

interface Options {
  readonly projectPath: string;
  readonly netlistPath?: string;
  readonly baselineProjectPath?: string;
  readonly datasheetStorePath?: string;
}

function parseOptions(args: readonly string[]): Options | undefined {
  const projectPath = args[0];
  if (projectPath === undefined || args.length % 2 === 0) return undefined;
  let netlistPath: string | undefined;
  let baselineProjectPath: string | undefined;
  let datasheetStorePath: string | undefined;
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) return undefined;
    if (option === "--netlist" && netlistPath === undefined) {
      netlistPath = value;
    } else if (
      option === "--baseline-project" &&
      baselineProjectPath === undefined
    ) {
      baselineProjectPath = value;
    } else if (
      option === "--datasheet-store" &&
      datasheetStorePath === undefined
    ) {
      datasheetStorePath = value;
    } else {
      return undefined;
    }
  }
  return {
    projectPath,
    ...(netlistPath === undefined ? {} : { netlistPath }),
    ...(baselineProjectPath === undefined
      ? {}
      : { baselineProjectPath }),
    ...(datasheetStorePath === undefined
      ? {}
      : { datasheetStorePath })
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options === undefined) {
    process.stderr.write(
      "用法：node dist/src/verification/verify-mcp.js <工程.epro2> [--netlist <网表.enet>] [--baseline-project <基线工程.epro2>] [--datasheet-store <数据表库>]\n"
    );
    process.exitCode = 64;
    return;
  }

  const serverEntry = fileURLToPath(new URL("../mcp/main.js", import.meta.url));
  const runtimeOpen =
    options.netlistPath === undefined &&
    options.baselineProjectPath === undefined &&
    options.datasheetStorePath === undefined;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      serverEntry,
      ...(runtimeOpen ? [] : ["--project", options.projectPath]),
      ...(options.netlistPath === undefined
        ? []
        : ["--netlist", options.netlistPath]),
      ...(options.baselineProjectPath === undefined
        ? []
        : ["--baseline-project", options.baselineProjectPath]),
      ...(options.datasheetStorePath === undefined
        ? []
        : ["--datasheet-store", options.datasheetStorePath])
    ],
    env: {
      ...getDefaultEnvironment(),
      NODE_OPTIONS: MCP_PROCESS_ENV.nodeOptions
    },
    stderr: "pipe"
  });
  const stderrChunks: Buffer[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  const client = new Client({
    name: "schemcp-verifier",
    version: MCP_SERVER_VERSION
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      MCP_TOOL_NAMES
    );
    assert.equal(
      tools.tools.every(
        (tool) =>
          tool.annotations?.readOnlyHint === true &&
          tool.annotations.destructiveHint === false
      ),
      true
    );
    assert.equal(
      tools.tools.some(
        (tool) =>
          tool.name.startsWith("list_pcb_") ||
          tool.name.startsWith("get_pcb_") ||
          tool.name.startsWith("list_footprint_")
      ),
      false
    );

    if (runtimeOpen) {
      const initial = structured(
        await client.callTool({
          name: "get_active_schematic_project",
          arguments: {}
        })
      );
      assert.equal(
        (initial.project as { readonly binding: string }).binding,
        "NOT_BOUND"
      );
      const opened = structured(
        await client.callTool({
          name: "open_schematic_project",
          arguments: { projectPath: options.projectPath }
        })
      );
      assert.equal(opened.ok, true);
      assert.equal(JSON.stringify(opened).includes(options.projectPath), false);
    }

    const summary = structured(
      await client.callTool({ name: "get_project_summary", arguments: {} })
    );
    assert.equal(summary.ok, true);
    const components = structured(
      await client.callTool({
        name: "list_components",
        arguments: { limit: 2 }
      })
    );
    assert.equal(components.ok, true);

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        gate: "MCP_PROTOCOL_VERIFIED",
        serverName: "schemcp",
        serverVersion: MCP_SERVER_VERSION,
        toolCount: tools.tools.length,
        pcbToolCount: 0,
        runtimeOpen,
        electricalTruth: "NOT_VERIFIED"
      })}\n`
    );
  } finally {
    await client.close();
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    if (stderr.includes(options.projectPath)) {
      throw new Error("MCP stderr 不得泄露工程路径。");
    }
  }
}

await main();
