#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.cwd();
const checkOnly = process.argv.includes("--check");
const contractPath = path.join(root, "docs", "mcp-tools.contract.json");
const referencePath = path.join(root, "docs", "MCP_TOOLS.md");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, nested]) => [key, canonicalize(nested)])
  );
}

function serialize(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function jsonBlock(value) {
  return `\n\`\`\`json\n${JSON.stringify(canonicalize(value), null, 2)}\n\`\`\`\n`;
}

async function readPackageVersion() {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  );
  return packageJson.version;
}

async function listRuntimeContract() {
  const executable = path.join(root, "dist", "src", "bin", "schemcp.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable],
    cwd: root,
    env: {
      ...getDefaultEnvironment(),
      NODE_OPTIONS: "--max-old-space-size=512"
    },
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-public-contract-generator",
    version: "1.0.0"
  });
  try {
    await client.connect(transport);
    return await client.listTools();
  } finally {
    await client.close();
  }
}

function assertPublicContract(tools, expectedNames) {
  assert.equal(tools.length, 48, "公共 MCP 必须固定为 48 个工具");
  assert.deepEqual(
    tools.map((tool) => tool.name),
    expectedNames,
    "tools/list 顺序和名称必须与公共契约一致"
  );
  for (const tool of tools) {
    assert.equal(tool.inputSchema?.type, "object", `${tool.name} 缺少输入 Schema`);
    assert.equal(tool.outputSchema?.type, "object", `${tool.name} 缺少结果 Schema`);
    assert.equal(
      tool.outputSchema?.properties?.ok?.type,
      "boolean",
      `${tool.name} 的结果 Schema 必须声明 ok:boolean`
    );
    assert.ok(
      tool.outputSchema?.required?.includes("ok"),
      `${tool.name} 的结果 Schema 必须要求 ok`
    );
    assert.doesNotMatch(tool.name, /pcb|bridge/iu);
  }
}

function createSnapshot(tools, version) {
  return {
    schema: "schemcp.mcp-tools-contract",
    schemaVersion: "1.1.0",
    server: {
      id: "schemcp",
      package: "@yuanzihao/schemcp",
      version
    },
    transport: "stdio",
    toolCount: tools.length,
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations
    }))
  };
}

function createMarkdown(snapshot, snapshotSha256) {
  const lines = [
    "# SchemCP MCP 工具参考",
    "",
    "> 本文档由运行中的 SchemCP `tools/list` 契约确定性生成，请勿手工编辑。",
    "",
    `- 契约：\`${snapshot.schema} ${snapshot.schemaVersion}\``,
    `- 服务：\`${snapshot.server.id}\``,
    `- 包：\`${snapshot.server.package}@${snapshot.server.version}\``,
    `- 运输：\`${snapshot.transport}\``,
    `- 工具数：\`${snapshot.toolCount}\``,
    `- JSON 快照 SHA-256：\`${snapshotSha256}\``,
    "",
    "每个工具的结果至少包含 `ok:boolean` 与平台安全能力状态；工具专用字段作为受版本化公共契约约束的扩展属性返回。失败时 `ok=false`，并返回稳定的 `error.code`。",
    ""
  ];

  for (const [index, tool] of snapshot.tools.entries()) {
    lines.push(
      `## ${index + 1}. \`${tool.name}\``,
      "",
      tool.title ? `**${tool.title}**` : "",
      "",
      tool.description ?? "",
      "",
      "输入 Schema：",
      jsonBlock(tool.inputSchema).trimEnd(),
      "",
      "结果 Schema：",
      jsonBlock(tool.outputSchema).trimEnd(),
      ""
    );
  }
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

async function verifyExactFile(filePath, expected) {
  const actual = await readFile(filePath, "utf8").catch(() => undefined);
  assert.equal(
    actual,
    expected,
    `${path.relative(root, filePath)} 与运行时 MCP 契约不一致；请运行 npm run generate:mcp-reference`
  );
}

const [{ tools }, { MCP_TOOL_NAMES }, version] = await Promise.all([
  listRuntimeContract(),
  import("../dist/src/mcp/contract.js"),
  readPackageVersion()
]);
assertPublicContract(tools, [...MCP_TOOL_NAMES]);
const snapshot = createSnapshot(tools, version);
const snapshotText = serialize(snapshot);
const snapshotSha256 = createHash("sha256")
  .update(snapshotText, "utf8")
  .digest("hex");
const referenceText = createMarkdown(snapshot, snapshotSha256);

if (checkOnly) {
  await Promise.all([
    verifyExactFile(contractPath, snapshotText),
    verifyExactFile(referencePath, referenceText)
  ]);
} else {
  await Promise.all([
    writeFile(contractPath, snapshotText, "utf8"),
    writeFile(referencePath, referenceText, "utf8")
  ]);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    gate: checkOnly
      ? "MCP_PUBLIC_CONTRACT_CURRENT"
      : "MCP_PUBLIC_CONTRACT_GENERATED",
    toolCount: snapshot.toolCount,
    snapshotSha256
  })}\n`
);
