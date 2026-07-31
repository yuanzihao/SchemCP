#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { MCP_TOOL_NAMES } from "../dist/src/mcp/contract.js";

const argument = process.argv[2];
if (argument === undefined) {
  process.stderr.write(
    "用法：npm run verify:npx-tarball -- <绝对路径安装包.tgz>\n"
  );
  process.exitCode = 64;
} else {
  const tarballPath = path.resolve(argument);
  assert.equal(
    path.isAbsolute(argument),
    true,
    "安装包必须使用绝对路径"
  );
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "schemcp-npx-")
  );
  const npmCache = path.join(temporaryRoot, "npm-cache");
  const transport = new StdioClientTransport({
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: [
      "--yes",
      "--offline",
      "--package",
      tarballPath,
      "--",
      "schemcp"
    ],
    cwd: temporaryRoot,
    env: {
      ...getDefaultEnvironment(),
      NODE_OPTIONS: "--max-old-space-size=512",
      npm_config_cache: npmCache,
      npm_config_audit: "false",
      npm_config_fund: "false"
    },
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-npx-tarball-verifier",
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
    const summary = await client.callTool({
      name: "get_project_summary",
      arguments: {}
    });
    assert.equal(summary.isError, undefined);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        gate: "NPX_TARBALL_MCP_VERIFIED",
        command: "npx -y @yuanzihao/schemcp",
        transport: "stdio",
        toolCount: tools.tools.length,
        pcbToolCount: 0,
        initialProjectBinding: "NOT_BOUND"
      })}\n`
    );
  } finally {
    await client.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
