#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  readFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import {
  MCP_GENERIC_CONFIG_SCHEMA,
  MCP_GENERIC_CONFIG_SCHEMA_VERSION
} from "../mcp/client-config.js";
import { MCP_TOOL_NAMES } from "../mcp/contract.js";

const execFile = promisify(execFileCallback);
const MAX_PACKAGE_BYTES = 6 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 25 * 1024 * 1024;
const SEPARATED_POWER_PIN_NAME_PATTERN =
  /^(?:V(?:CC|DD|SS|BAT|DDA|SSA|REF|CAP|IN|OUT)|A?VCC|A?VDD|A?VSS|GND|AGND|DGND)(?:[_0-9A-Z+-]*)$/i;

interface PackReceipt {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly files: readonly { readonly path: string }[];
  readonly bundled: readonly string[];
}

interface SyntheticAttachmentSet {
  readonly leftProject: string;
  readonly rightProject: string;
  readonly leftNetlist: string;
  readonly rightNetlist: string;
}

interface CommandInvocation {
  readonly command: string;
  readonly prefixArgs: readonly string[];
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(nameText: string, payloadText: string): Buffer {
  const name = Buffer.from(nameText, "utf8");
  const payload = Buffer.from(payloadText, "utf8");
  const checksum = crc32(payload);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0x0800, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(payload.length, 18);
  localHeader.writeUInt32LE(payload.length, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x0800, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(payload.length, 20);
  centralHeader.writeUInt32LE(payload.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt32LE(0, 42);

  const local = Buffer.concat([localHeader, name, payload]);
  const central = Buffer.concat([centralHeader, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

function v3Record(
  outer: Readonly<Record<string, unknown>>,
  inner: Readonly<Record<string, unknown>>
): string {
  return `${JSON.stringify(outer)}||${JSON.stringify(inner)}|`;
}

function syntheticEpru(
  suffix: string,
  designators: readonly string[]
): string {
  const schematicId = `schematic-${suffix}`;
  const pageId = `page-${suffix}`;
  const symbolId = `symbol-${suffix}`;
  const partId = `part-${suffix}`;
  return [
    v3Record(
      { type: "DOCHEAD" },
      { docType: "SCH", client: `client-${suffix}`, uuid: schematicId }
    ),
    v3Record({ type: "META", ticket: 1 }, { name: `Synthetic ${suffix}` }),
    v3Record(
      { type: "DOCHEAD" },
      { docType: "SCH_PAGE", client: `client-${suffix}`, uuid: pageId }
    ),
    v3Record(
      { type: "META", ticket: 2 },
      { title: `Synthetic ${suffix}`, schematic: schematicId }
    ),
    ...designators.flatMap((designator, index) => {
      const componentId = `component-${suffix}-${index}`;
      return [
        v3Record(
          { type: "COMPONENT", id: componentId, ticket: 10 + index * 3 },
          {
            partId,
            x: 100 + index * 50,
            y: 100,
            rotation: 0,
            isMirror: false
          }
        ),
        v3Record(
          { type: "ATTR", id: `designator-${suffix}-${index}`, ticket: 11 + index * 3 },
          { parentId: componentId, key: "Designator", value: designator }
        ),
        v3Record(
          { type: "ATTR", id: `symbol-${suffix}-${index}`, ticket: 12 + index * 3 },
          { parentId: componentId, key: "Symbol", value: symbolId }
        )
      ];
    }),
    v3Record(
      { type: "DOCHEAD" },
      { docType: "SYMBOL", client: `client-${suffix}`, uuid: symbolId }
    ),
    v3Record({ type: "META", ticket: 100 }, { title: "Synthetic Connector" }),
    v3Record({ type: "PART", id: partId, ticket: 101 }, { title: "A" }),
    ...["1", "2", "3", "4"].flatMap((pinNumber, index) => {
      const pinId = `pin-${suffix}-${pinNumber}`;
      return [
        v3Record(
          { type: "PIN", id: pinId, ticket: 110 + index * 2 },
          {
            partId,
            x: 0,
            y: index * 10,
            length: 20,
            rotation: 0
          }
        ),
        v3Record(
          { type: "ATTR", id: `pin-number-${suffix}-${pinNumber}`, ticket: 111 + index * 2 },
          { parentId: pinId, key: "Pin Number", value: pinNumber }
        )
      ];
    })
  ].join("\n");
}

function syntheticEnet(
  components: Readonly<Record<string, unknown>>
): string {
  return JSON.stringify({
    version: "2.0.0",
    components,
    designRule: {},
    netClass: {},
    equalLengthNetGroup: {},
    differentialPair: {}
  });
}

async function createSyntheticAttachments(
  directory: string
): Promise<SyntheticAttachmentSet> {
  const leftProject = path.join(directory, "left.epro2");
  const rightProject = path.join(directory, "right.epro2");
  const leftNetlist = path.join(directory, "left.enet");
  const rightNetlist = path.join(directory, "right.enet");
  await Promise.all([
    writeFile(
      leftProject,
      createStoredZip("left.epru", syntheticEpru("left", ["SRC", "J1"]))
    ),
    writeFile(
      rightProject,
      createStoredZip("right.epru", syntheticEpru("right", ["J2", "TGT"]))
    ),
    writeFile(
      leftNetlist,
      syntheticEnet({
        source: {
          props: { Designator: "SRC" },
          pinInfoMap: {
            one: { name: "OUT", number: "1", net: "LEFT_SIGNAL" }
          }
        },
        connector: {
          props: { Designator: "J1", Footprint: "CONN_4" },
          pinInfoMap: Object.fromEntries(
            ["1", "2", "3", "4"].map((number) => [
              `pin-${number}`,
              {
                name: `P${number}`,
                number,
                net: number === "1" ? "LEFT_SIGNAL" : ""
              }
            ])
          )
        }
      }),
      { mode: 0o600 }
    ),
    writeFile(
      rightNetlist,
      syntheticEnet({
        connector: {
          props: { Designator: "J2", Footprint: "CONN_4" },
          pinInfoMap: Object.fromEntries(
            ["1", "2", "3", "4"].map((number) => [
              `pin-${number}`,
              {
                name: `P${number}`,
                number,
                net: number === "1" ? "RIGHT_SIGNAL" : ""
              }
            ])
          )
        },
        target: {
          props: { Designator: "TGT" },
          pinInfoMap: {
            one: { name: "IN", number: "1", net: "RIGHT_SIGNAL" }
          }
        }
      }),
      { mode: 0o600 }
    )
  ]);
  return { leftProject, rightProject, leftNetlist, rightNetlist };
}

function structured(result: unknown): Record<string, unknown> {
  assert.ok(result !== null && typeof result === "object");
  const value = (result as { readonly structuredContent?: unknown })
    .structuredContent;
  assert.ok(value !== null && typeof value === "object");
  return value as Record<string, unknown>;
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const result = await execFile(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return result.stdout;
}

function resolveNpmInvocation(env: NodeJS.ProcessEnv): CommandInvocation {
  const npmExecPath = env.npm_execpath;
  if (npmExecPath !== undefined && path.isAbsolute(npmExecPath)) {
    return {
      command: process.execPath,
      prefixArgs: [npmExecPath]
    };
  }
  assert.notEqual(
    process.platform,
    "win32",
    "Windows 安装包校验必须通过 npm 脚本提供绝对 npm_execpath"
  );
  return { command: "npm", prefixArgs: [] };
}

function parsePackReceipt(stdout: string): PackReceipt {
  const parsed = JSON.parse(stdout) as unknown;
  assert.equal(Array.isArray(parsed), true, "npm pack --json 必须返回数组");
  assert.equal((parsed as unknown[]).length, 1);
  return (parsed as PackReceipt[])[0] as PackReceipt;
}

function assertPackageContents(receipt: PackReceipt): void {
  assert.equal(receipt.name, "@yuanzihao/schemcp");
  assert.equal(receipt.version, "0.1.0");
  assert.ok(receipt.size > 0 && receipt.size <= MAX_PACKAGE_BYTES);
  assert.ok(
    receipt.unpackedSize > 0 && receipt.unpackedSize <= MAX_UNPACKED_BYTES
  );
  const files = receipt.files.map((item) => item.path);
  for (const required of [
    "dist/src/bin/schemcp.js",
    "dist/src/cli/main.js",
    "dist/src/mcp/main.js",
    "README.md",
    "README.en.md",
    "LICENSE",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "docs/MCP_TOOLS.md",
    "docs/mcp-tools.contract.json",
    "server.json"
  ]) {
    assert.ok(files.includes(required), `安装包缺少 ${required}`);
  }
  assert.equal(
    files.some(
      (file) =>
        file.startsWith("src/") ||
        file.startsWith("test/") ||
        file.startsWith("dist/test/") ||
        file.startsWith("fixtures/") ||
        file === "AGENTS.md" ||
        file === "tsconfig.json"
    ),
    false,
    "安装包不得包含源码测试、夹具或代理规则"
  );
  assert.equal(
    files.some((file) => /(?:^|\/)(?:easyeda|bridge)(?:\/|[-.])/u.test(file)),
    false,
    "安装包不得包含 EasyEDA Bridge 或在线采集实现"
  );
  assert.equal(
    files.some((file) => /(?:^|[-/.])pcb(?:[-/.]|$)/iu.test(file)),
    false,
    "安装包不得包含 PCB 专用模块"
  );
  for (const dependency of [
    "@hono/node-server",
    "@modelcontextprotocol/sdk",
    "yauzl",
    "zod"
  ]) {
    assert.ok(
      receipt.bundled.includes(dependency),
      `安装包缺少生产依赖 ${dependency}`
    );
  }
  assert.equal(receipt.bundled.includes("typescript"), false);
  assert.equal(receipt.bundled.includes("pdfjs-dist"), false);
}

async function assertInstalledPackagePrivacy(
  packageRoot: string,
  forbiddenRoots: readonly string[]
): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const entryPath = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, "安装包自身文件不得是符号链接");
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      assert.equal(entry.isFile(), true, "安装包自身只能包含普通文件和目录");
      const bytes = await readFile(entryPath);
      const machinePathFragments = [
        ...forbiddenRoots,
        ["", "Users", ""].join("/"),
        ["", "private", "tmp", ""].join("/"),
        ["file:", "/", "/", "/"].join(""),
        ["C:", "Users", ""].join("\\")
      ];
      for (const forbidden of machinePathFragments) {
        assert.equal(
          bytes.includes(Buffer.from(forbidden, "utf8")),
          false,
          "安装包不得包含构建机或临时目录绝对路径"
        );
      }
    }
  };
  await visit(packageRoot);
}

async function main(): Promise<void> {
  const projectArgument = process.argv[2];
  const assemblyProjectArgument = process.argv[3];
  if (projectArgument !== undefined) {
    assert.equal(path.isAbsolute(projectArgument), true, "真实工程必须使用绝对路径");
    assert.equal(path.extname(projectArgument).toLowerCase(), ".epro2");
  }
  if (assemblyProjectArgument !== undefined) {
    assert.equal(
      path.isAbsolute(assemblyProjectArgument),
      true,
      "DNP 真实工程必须使用绝对路径"
    );
    assert.equal(path.extname(assemblyProjectArgument).toLowerCase(), ".epro2");
    assert.ok(projectArgument !== undefined, "DNP 真实工程不能脱离主验收工程");
  }

  const root = process.cwd();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "schemcp-package-"));
  const firstPackDirectory = path.join(temporaryRoot, "pack-a");
  const secondPackDirectory = path.join(temporaryRoot, "pack-b");
  const installDirectory = path.join(temporaryRoot, "install");
  const env = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false"
  };
  const npm = resolveNpmInvocation(env);

  try {
    await Promise.all([
      mkdir(firstPackDirectory),
      mkdir(secondPackDirectory),
      mkdir(installDirectory)
    ]);
    const syntheticAttachments = await createSyntheticAttachments(temporaryRoot);
    const firstReceipt = parsePackReceipt(
      await run(
        npm.command,
        [
          ...npm.prefixArgs,
          "pack",
          "--json",
          "--pack-destination",
          firstPackDirectory
        ],
        root,
        env
      )
    );
    const secondReceipt = parsePackReceipt(
      await run(
        npm.command,
        [
          ...npm.prefixArgs,
          "pack",
          "--json",
          "--pack-destination",
          secondPackDirectory
        ],
        root,
        env
      )
    );
    assertPackageContents(firstReceipt);
    assertPackageContents(secondReceipt);

    const firstTarball = path.join(firstPackDirectory, firstReceipt.filename);
    const secondTarball = path.join(secondPackDirectory, secondReceipt.filename);
    const [firstBytes, secondBytes] = await Promise.all([
      readFile(firstTarball),
      readFile(secondTarball)
    ]);
    assert.deepEqual(firstBytes, secondBytes, "连续两次 npm pack 必须逐字节一致");
    const tarballSha256 = createHash("sha256").update(firstBytes).digest("hex");

    await run(
      npm.command,
      [
        ...npm.prefixArgs,
        "install",
        "--offline",
        "--ignore-scripts",
        firstTarball
      ],
      installDirectory,
      env
    );
    const packageRoot = path.join(
      installDirectory,
      "node_modules",
      "@yuanzihao",
      "schemcp"
    );
    await assertInstalledPackagePrivacy(packageRoot, [root, temporaryRoot]);
    const executable = path.join(
      packageRoot,
      "dist",
      "src",
      "bin",
      "schemcp.js"
    );
    const executableArgs = [executable];
    const version = (
      await run(
        process.execPath,
        [...executableArgs, "--version"],
        installDirectory,
        env
      )
    ).trim();
    assert.equal(version, "0.1.0");

    const generic = JSON.parse(
      await run(
        process.execPath,
        [...executableArgs, "mcp-config", "--client", "generic"],
        installDirectory,
        env
      )
    ) as {
      readonly schema: string;
      readonly schemaVersion: string;
      readonly server: {
        readonly id: string;
        readonly transport: string;
        readonly command: string;
        readonly args: readonly string[];
      };
      readonly enabledTools: readonly string[];
    };
    assert.equal(generic.schema, MCP_GENERIC_CONFIG_SCHEMA);
    assert.equal(generic.schemaVersion, MCP_GENERIC_CONFIG_SCHEMA_VERSION);
    assert.equal(generic.server.id, "schemcp");
    assert.equal(generic.server.transport, "stdio");
    assert.deepEqual(generic.enabledTools, MCP_TOOL_NAMES);
    await Promise.all(
      ["codex", "claude-code"].map(async (client) => {
        const output = await run(
          process.execPath,
          [...executableArgs, "mcp-config", "--client", client],
          installDirectory,
          env
        );
        assert.ok(output.trim().length > 0);
      })
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: executableArgs,
      cwd: installDirectory,
      env: {
        ...getDefaultEnvironment(),
        NODE_OPTIONS: "--max-old-space-size=512"
      },
      stderr: "pipe"
    });
    const client = new Client({
      name: "schemcp-installed-package-verifier",
      version: "1.0.0"
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name),
        [...MCP_TOOL_NAMES]
      );
      assert.equal(tools.tools.some((tool) => tool.name.includes("pcb")), false);
      assert.equal(
        tools.tools.every(
          (tool) =>
            tool.inputSchema.type === "object" &&
            tool.outputSchema?.type === "object" &&
            (
              tool.outputSchema.properties?.ok as
                | { readonly type?: unknown }
                | undefined
            )?.type === "boolean"
        ),
        true,
        "安装态 tools/list 必须公开完整输入与结果 Schema"
      );
      if (projectArgument === undefined) {
        const leftOpened = structured(
          await client.callTool({
            name: "open_schematic_project",
            arguments: { projectPath: syntheticAttachments.leftProject }
          })
        );
        const leftHandle = (
          leftOpened.project as { readonly projectHandle: string }
        ).projectHandle;
        const rightOpened = structured(
          await client.callTool({
            name: "open_schematic_project",
            arguments: { projectPath: syntheticAttachments.rightProject }
          })
        );
        const rightHandle = (
          rightOpened.project as { readonly projectHandle: string }
        ).projectHandle;

        const components = structured(
          await client.callTool({
            name: "list_components",
            arguments: { projectHandle: leftHandle, limit: 10 }
          })
        );
        assert.deepEqual(
          new Set(
            (
              components.page as {
                readonly items: readonly { readonly designator: string }[];
              }
            ).items.map((item) => item.designator)
          ),
          new Set(["J1", "SRC"])
        );
        const pins = structured(
          await client.callTool({
            name: "get_component_pins",
            arguments: {
              projectHandle: leftHandle,
              designator: "J1",
              limit: 10
            }
          })
        );
        assert.equal(
          (
            pins.lookup as {
              readonly status: string;
              readonly pins: { readonly total: number };
            }
          ).status,
          "FOUND"
        );
        assert.equal(
          (
            pins.lookup as {
              readonly pins: { readonly total: number };
            }
          ).pins.total,
          4
        );

        for (const [projectHandle, netlistPath] of [
          [leftHandle, syntheticAttachments.leftNetlist],
          [rightHandle, syntheticAttachments.rightNetlist]
        ] as const) {
          const attached = structured(
            await client.callTool({
              name: "attach_schematic_netlist",
              arguments: { projectHandle, netlistPath }
            })
          );
          assert.equal(attached.disposition, "ATTACHED_NEW");
        }

        const created = structured(
          await client.callTool({
            name: "create_schematic_assembly",
            arguments: { projectHandles: [leftHandle, rightHandle] }
          })
        );
        const assemblyHandle = (
          created.assembly as { readonly assemblyHandle: string }
        ).assemblyHandle;
        const candidates = structured(
          await client.callTool({
            name: "list_interconnect_candidates",
            arguments: { assemblyHandle, limit: 50 }
          })
        );
        const connectorCandidate = (
          candidates.page as {
            readonly items: readonly {
              readonly candidateId: string;
              readonly left: { readonly designator?: string };
              readonly right: { readonly designator?: string };
            }[];
          }
        ).items.find((candidate) => {
          const designators = new Set([
            candidate.left.designator,
            candidate.right.designator
          ]);
          return designators.has("J1") && designators.has("J2");
        });
        assert.ok(connectorCandidate, "合成装配必须产生 J1/J2 互连候选");
        const confirmed = structured(
          await client.callTool({
            name: "confirm_schematic_interconnect",
            arguments: {
              assemblyHandle,
              candidateId: connectorCandidate.candidateId,
              mapping: { kind: "SAME_PIN_NUMBER" }
            }
          })
        );
        assert.equal(confirmed.disposition, "CONFIRMED");
        const connections = structured(
          await client.callTool({
            name: "list_assembly_connections",
            arguments: {
              assemblyHandle,
              projectHandle: leftHandle,
              designator: "SRC",
              pinNumber: "1",
              maxInterconnectHops: 1,
              limit: 50
            }
          })
        );
        assert.equal(
          (
            connections.lookup as {
              readonly paths: {
                readonly items: readonly {
                  readonly target: { readonly componentRef: string };
                }[];
              };
            }
          ).paths.items.some(
            (item) => item.target.componentRef === "TGT"
          ),
          true
        );

        const manifestResult = structured(
          await client.callTool({
            name: "get_schematic_assembly_manifest",
            arguments: { assemblyHandle }
          })
        );
        const manifest = manifestResult.manifest as Readonly<
          Record<string, unknown>
        >;
        const tamperedManifestPath = path.join(
          temporaryRoot,
          "tampered.schemcp-assembly.json"
        );
        await writeFile(
          tamperedManifestPath,
          JSON.stringify({
            ...manifest,
            manifestSha256: "0".repeat(64)
          }),
          { mode: 0o600 }
        );
        const tampered = structured(
          await client.callTool({
            name: "open_schematic_assembly_manifest",
            arguments: { manifestPath: tamperedManifestPath }
          })
        );
        assert.equal(tampered.ok, false);
        assert.equal(
          (tampered.error as { readonly code: string }).code,
          "MCP_ASSEMBLY_MANIFEST_INVALID"
        );
      } else {
        const opened = structured(
          await client.callTool({
            name: "open_schematic_project",
            arguments: { projectPath: projectArgument }
          })
        );
        assert.equal(opened.ok, true);
        const contexts = structured(
          await client.callTool({
            name: "list_instance_contexts",
            arguments: { limit: 50 }
          })
        );
        const resolvedContext = (
          contexts.page as {
            readonly items: readonly {
              readonly id: string;
              readonly occurrenceCount: number;
              readonly resolutionStatus: string;
            }[];
          }
        ).items.find(
          (context) => context.resolutionStatus === "RESOLVED_EXACT"
        );
        assert.ok(resolvedContext, "真实工程必须包含已解析 INSTANCE 上下文");
        assert.ok(resolvedContext.occurrenceCount > 0);
        const detail = structured(
          await client.callTool({
            name: "get_instance_context",
            arguments: { contextId: resolvedContext.id, limit: 50 }
          })
        );
        assert.equal(
          (detail.lookup as { readonly status: string }).status,
          "FOUND"
        );
        const buses = structured(
          await client.callTool({
            name: "list_buses",
            arguments: { view: "BUSES", limit: 50 }
          })
        );
        const busPage = buses.page as {
          readonly total: number;
          readonly items: readonly {
            readonly id: string;
            readonly entryCount: number;
          }[];
        };
        assert.ok(busPage.total > 0, "真实工程必须包含显式 BUS");
        const busWithEntries = busPage.items.find(
          (bus) => bus.entryCount > 0
        );
        assert.ok(busWithEntries, "真实工程必须包含带入口的显式 BUS");
        const busEntries = structured(
          await client.callTool({
            name: "list_buses",
            arguments: {
              view: "ENTRIES",
              busId: busWithEntries.id,
              limit: 50
            }
          })
        );
        const entryPage = busEntries.page as {
          readonly total: number;
          readonly items: readonly { readonly order: number }[];
        };
        assert.equal(entryPage.total, busWithEntries.entryCount);
        assert.deepEqual(
          entryPage.items.map((entry) => entry.order),
          [...entryPage.items]
            .map((entry) => entry.order)
            .sort((left, right) => left - right)
        );
        const components = structured(
          await client.callTool({
            name: "list_components",
            arguments: {
              instanceContextId: resolvedContext.id,
              limit: 50
            }
          })
        );
        const componentPage = components.page as {
          readonly total: number;
          readonly items: readonly {
            readonly id: string;
            readonly occurrence?: { readonly instanceContextId: string };
          }[];
        };
        assert.equal(componentPage.total, resolvedContext.occurrenceCount);
        const selected = componentPage.items[0];
        assert.ok(selected);
        assert.equal(
          selected.occurrence?.instanceContextId,
          resolvedContext.id
        );
        for (const tool of ["get_component", "get_component_pins"] as const) {
          const result = structured(
            await client.callTool({
              name: tool,
              arguments: {
                componentId: selected.id,
                instanceContextId: resolvedContext.id,
                ...(tool === "get_component_pins" ? { limit: 50 } : {})
              }
            })
          );
          assert.equal(
            (result.lookup as { readonly status: string }).status,
            "FOUND"
          );
        }

        const completeComponents: {
          readonly id: string;
          readonly pageId: string;
          readonly pinCompleteness: {
            readonly status: string;
            readonly units: readonly unknown[];
            readonly instantiatedPinCount: number;
          };
        }[] = [];
        let completeCursor: string | undefined;
        do {
          const completeResult = structured(
            await client.callTool({
              name: "list_components",
              arguments: {
                pinCompletenessStatus: "COMPLETE",
                limit: 50,
                ...(completeCursor === undefined
                  ? {}
                  : { cursor: completeCursor })
              }
            })
          );
          const page = completeResult.page as {
            readonly items: typeof completeComponents;
            readonly nextCursor?: string;
          };
          completeComponents.push(...page.items);
          completeCursor = page.nextCursor;
        } while (completeCursor !== undefined);
        const multiUnit = completeComponents.find(
          (component) => component.pinCompleteness.units.length > 1
        );
        assert.ok(multiUnit, "真实工程必须包含完整的多单元逻辑器件");
        const multiUnitPinItems: {
          readonly partId: string;
          readonly name?: string;
        }[] = [];
        let multiUnitPinCursor: string | undefined;
        let multiUnitPinTotal = 0;
        do {
          const multiUnitPins = structured(
            await client.callTool({
              name: "get_component_pins",
              arguments: {
                componentId: multiUnit.id,
                pageId: multiUnit.pageId,
                limit: 50,
                ...(multiUnitPinCursor === undefined
                  ? {}
                  : { cursor: multiUnitPinCursor })
              }
            })
          );
          const multiUnitLookup = multiUnitPins.lookup as {
            readonly status: string;
            readonly pins: {
              readonly total: number;
              readonly items: typeof multiUnitPinItems;
              readonly nextCursor?: string;
            };
          };
          assert.equal(multiUnitLookup.status, "FOUND");
          multiUnitPinTotal = multiUnitLookup.pins.total;
          multiUnitPinItems.push(...multiUnitLookup.pins.items);
          multiUnitPinCursor = multiUnitLookup.pins.nextCursor;
        } while (multiUnitPinCursor !== undefined);
        assert.equal(
          multiUnitPinTotal,
          multiUnit.pinCompleteness.instantiatedPinCount
        );
        const pinsByPart = new Map<string, typeof multiUnitPinItems>();
        for (const pin of multiUnitPinItems) {
          const pins = pinsByPart.get(pin.partId) ?? [];
          pins.push(pin);
          pinsByPart.set(pin.partId, pins);
        }
        assert.equal(
          [...pinsByPart.values()].some(
            (pins) =>
              pins.length > 0 &&
              pins.every(
                (pin) =>
                  pin.name !== undefined &&
                  SEPARATED_POWER_PIN_NAME_PATTERN.test(pin.name.trim())
              )
          ),
          true,
          "真实多单元器件必须包含可追溯的分离电源单元"
        );

        if (assemblyProjectArgument !== undefined) {
          const assemblyOpened = structured(
            await client.callTool({
              name: "open_schematic_project",
              arguments: { projectPath: assemblyProjectArgument }
            })
          );
          assert.equal(assemblyOpened.ok, true);
          const dnpResult = structured(
            await client.callTool({
              name: "list_components",
              arguments: { assemblyStatus: "DNP", limit: 50 }
            })
          );
          const dnpPage = dnpResult.page as {
            readonly total: number;
            readonly items: readonly {
              readonly id: string;
              readonly pageId: string;
              readonly assembly: {
                readonly status: string;
                readonly reason: string;
                readonly values: readonly unknown[];
              };
            }[];
          };
          assert.ok(dnpPage.total > 0, "真实工程必须包含显式 DNP 器件");
          const selectedDnp = dnpPage.items[0];
          assert.ok(selectedDnp);
          assert.equal(selectedDnp.assembly.status, "DNP");
          assert.equal(
            selectedDnp.assembly.reason,
            "EXPLICIT_ADD_INTO_BOM_NO"
          );
          assert.deepEqual(selectedDnp.assembly.values, ["no"]);
          const dnpDetail = structured(
            await client.callTool({
              name: "get_component",
              arguments: {
                componentId: selectedDnp.id,
                pageId: selectedDnp.pageId
              }
            })
          );
          assert.equal(
            (
              dnpDetail.lookup as {
                readonly status: string;
                readonly component: {
                  readonly assembly: { readonly status: string };
                };
              }
            ).component.assembly.status,
            "DNP"
          );
        }
      }
    } finally {
      await client.close();
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        gate: "INSTALLED_PACKAGE_VERIFIED",
        package: "@yuanzihao/schemcp",
        version: "0.1.0",
        tarballSha256,
        packageBytes: firstReceipt.size,
        unpackedBytes: firstReceipt.unpackedSize,
        deterministicPack: true,
        offlineInstall: true,
        toolCount: MCP_TOOL_NAMES.length,
        pcbToolCount: 0,
        projectQuery: projectArgument === undefined ? "SYNTHETIC_VERIFIED" : "VERIFIED",
        realHierarchyQuery:
          projectArgument === undefined ? "NOT_REQUESTED" : "VERIFIED",
        realBusQuery:
          projectArgument === undefined ? "NOT_REQUESTED" : "VERIFIED",
        realMultiUnitPinQuery:
          projectArgument === undefined ? "NOT_REQUESTED" : "VERIFIED",
        realSeparatedPowerUnitQuery:
          projectArgument === undefined ? "NOT_REQUESTED" : "VERIFIED",
        realAssemblyQuery:
          assemblyProjectArgument === undefined ? "NOT_REQUESTED" : "VERIFIED",
        syntheticNetlistBinding:
          projectArgument === undefined ? "VERIFIED" : "NOT_REQUESTED",
        syntheticAssemblyTamper:
          projectArgument === undefined ? "VERIFIED" : "NOT_REQUESTED"
      })}\n`
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      gate: "INSTALLED_PACKAGE_VERIFICATION_FAILED",
      message: error instanceof Error ? error.message : "未知安装包验证错误"
    })}\n`
  );
  process.exitCode = 2;
}
