import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { MCP_TOOL_NAMES } from "../../src/mcp/contract.js";

const execFileAsync = promisify(execFile);
const entry = "dist/src/bin/schemcp.js";

test("单一 schemcp 入口无参数时启动默认原理图 MCP", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-public-entry-test",
    version: "1.0.0"
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      [...MCP_TOOL_NAMES]
    );
    assert.equal(
      tools.tools.some((tool) => tool.name.includes("pcb")),
      false
    );
  } finally {
    await client.close();
  }
});

test("单一 schemcp 入口保留显式 mcp 与辅助 CLI 路由", async () => {
  const help = await execFileAsync(process.execPath, [entry, "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /schemcp inspect/u);

  const version = await execFileAsync(process.execPath, [entry, "--version"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(version.stderr, "");
  assert.equal(version.stdout, "0.1.0\n");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, "mcp"],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-explicit-mcp-entry-test",
    version: "1.0.0"
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, MCP_TOOL_NAMES.length);
  } finally {
    await client.close();
  }
});
