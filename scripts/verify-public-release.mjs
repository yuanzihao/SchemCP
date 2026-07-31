#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(root, relativePath), "utf8"));

async function verifyPublicTree(directory, relative = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", "coverage"].includes(entry.name)) {
      continue;
    }
    const relativePath = path.posix.join(relative, entry.name);
    const absolutePath = path.join(directory, entry.name);
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `公共工作树不得包含符号链接：${relativePath}`
    );
    if (entry.isDirectory()) {
      await verifyPublicTree(absolutePath, relativePath);
      continue;
    }
    assert.equal(entry.isFile(), true, `公共工作树包含非普通文件：${relativePath}`);
    assert.doesNotMatch(
      relativePath,
      /\.(?:epro2|enet|pdf|schemcp-assembly\.json|netlist-comparison\.json)$/iu,
      `公共工作树不得包含私有 EDA 或数据表产物：${relativePath}`
    );
    const bytes = await readFile(absolutePath);
    const text = bytes.toString("utf8");
    const forbiddenFragments = [
      ["file:", "/", "/", "/"].join(""),
      ["", "Users", ""].join("/"),
      ["", "private", "tmp", ""].join("/"),
      ["C:", "Users", ""].join("\\")
    ];
    for (const fragment of forbiddenFragments) {
      assert.equal(
        text.includes(fragment),
        false,
        `公共工作树包含本机绝对路径：${relativePath}`
      );
    }
  }
}

const packageJson = await readJson("package.json");
const serverJson = await readJson("server.json");
const mcpContract = await readJson("docs/mcp-tools.contract.json");

await verifyPublicTree(root);

assert.equal(packageJson.private, undefined, "package.json 不得声明 private");
assert.equal(packageJson.license, "Apache-2.0");
assert.equal(packageJson.name, "@yuanzihao/schemcp");
assert.equal(packageJson.mcpName, "io.github.yuanzihao/schemcp");
assert.equal(packageJson.version, serverJson.version);
assert.equal(packageJson.mcpName, serverJson.name);
assert.equal(serverJson.packages.length, 1);
assert.deepEqual(serverJson.packages[0], {
  registryType: "npm",
  identifier: packageJson.name,
  version: packageJson.version,
  transport: { type: "stdio" }
});
assert.equal(
  packageJson.bin.schemcp,
  "./dist/src/bin/schemcp.js",
  "默认包入口必须通过一键 MCP 路由器启动"
);
assert.deepEqual(
  Object.keys(packageJson.bin),
  ["schemcp"],
  "首次公开发布只允许一个稳定可执行入口"
);
assert.equal(packageJson.publishConfig.access, "public");
assert.equal(packageJson.publishConfig.provenance, true);

for (const relativePath of [
  "LICENSE",
  "README.md",
  "README.en.md",
  "AGENTS.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/MCP_TOOLS.md",
  "docs/mcp-tools.contract.json",
  "server.json",
  "dist/src/bin/schemcp.js",
  "dist/src/cli/main.js",
  "dist/src/mcp/main.js"
]) {
  await access(path.join(root, relativePath));
}

assert.equal(mcpContract.schema, "schemcp.mcp-tools-contract");
assert.equal(mcpContract.schemaVersion, "1.0.0");
assert.equal(mcpContract.server.id, "schemcp");
assert.equal(mcpContract.server.package, packageJson.name);
assert.equal(mcpContract.server.version, packageJson.version);
assert.equal(mcpContract.transport, "stdio");
assert.equal(mcpContract.toolCount, 48);
assert.equal(mcpContract.tools.length, 48);
assert.equal(
  mcpContract.tools.every(
    (tool) =>
      tool.inputSchema?.type === "object" &&
      tool.outputSchema?.type === "object" &&
      tool.outputSchema?.properties?.ok?.type === "boolean" &&
      tool.outputSchema?.required?.includes("ok")
  ),
  true,
  "48 个工具必须同时公开输入和结果 Schema"
);
assert.equal(
  mcpContract.tools.some((tool) => /pcb|bridge/iu.test(tool.name)),
  false
);

const chineseReadme = await readFile(
  path.join(root, "README.md"),
  "utf8"
);
const englishReadme = await readFile(
  path.join(root, "README.en.md"),
  "utf8"
);
for (const readme of [chineseReadme, englishReadme]) {
  assert.match(readme, /npx -y @yuanzihao\/schemcp/u);
  assert.match(readme, /Apache-2\.0/u);
  assert.doesNotMatch(readme, /file:\/\/|\/Users\/|[A-Z]:\\/u);
}

if (!process.argv.includes("--quiet")) {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      gate: "PUBLIC_RELEASE_METADATA_VERIFIED",
      package: packageJson.name,
      version: packageJson.version,
      mcpName: packageJson.mcpName,
      transport: "stdio",
      license: packageJson.license
    })}\n`
  );
}
