import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import {
  createSchematicAssemblyManifest,
  projectIdForIr
} from "../../src/mcp/assembly-manifest.js";
import { SchematicAssemblySession } from "../../src/mcp/assembly-session.js";
import { EdaMcpProjectSession } from "../../src/mcp/project-session.js";
import { QueryError } from "../../src/query/index.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

function record(
  outer: Readonly<Record<string, unknown>>,
  inner: Readonly<Record<string, unknown>>
): string {
  return `${JSON.stringify(outer)}||${JSON.stringify(inner)}|`;
}

function projectLog(
  suffix: string,
  connectorDesignator: string,
  connectorPins: readonly string[] = ["1", "2", "3", "4"]
): string {
  const component = (
    id: string,
    designator: string | undefined,
    symbol: string,
    ticket: number,
    attributes: Readonly<Record<string, string>> = {}
  ) => [
    record(
      { type: "COMPONENT", id, ticket },
      { partId: symbol === "symbol-four" ? "part-four" : "part-one", x: ticket, y: 0, rotation: 0, isMirror: false }
    ),
    ...(designator === undefined
      ? []
      : [
          record(
            { type: "ATTR", id: `${id}-designator`, ticket: ticket + 1 },
            { parentId: id, key: "Designator", value: designator }
          )
        ]),
    record(
      { type: "ATTR", id: `${id}-symbol`, ticket: ticket + 2 },
      { parentId: id, key: "Symbol", value: symbol }
    ),
    ...Object.entries(attributes).map(([key, value], index) =>
      record(
        { type: "ATTR", id: `${id}-attr-${index}`, ticket: ticket + 3 + index },
        { parentId: id, key, value }
      )
    )
  ];
  const symbolPins = (
    symbol: string,
    part: string,
    numbers: readonly string[],
    ticket: number
  ) => numbers.flatMap((number, index) => {
    const pinId = `${symbol}-pin-${number}`;
    return [
      record(
        { type: "PIN", id: pinId, ticket: ticket + index * 3 },
        { partId: part, x: index * 10, y: 0, length: 10, rotation: 0 }
      ),
      record(
        { type: "ATTR", id: `${pinId}-number`, ticket: ticket + index * 3 + 1 },
        { parentId: pinId, key: "Pin Number", value: number }
      ),
      record(
        { type: "ATTR", id: `${pinId}-name`, ticket: ticket + index * 3 + 2 },
        { parentId: pinId, key: "Pin Name", value: `PIN_${number}` }
      )
    ];
  });
  return [
    record(
      { type: "DOCHEAD", ticket: 0 },
      { docType: "SCH", client: suffix, uuid: `schematic-${suffix}` }
    ),
    record({ type: "META", ticket: 1 }, { name: `Schematic ${suffix}` }),
    record(
      { type: "DOCHEAD", ticket: 2 },
      { docType: "SCH_PAGE", client: suffix, uuid: `page-${suffix}` }
    ),
    record(
      { type: "META", ticket: 3 },
      { title: `Page ${suffix}`, schematic: `schematic-${suffix}` }
    ),
    ...component(
      `connector-${suffix}`,
      connectorDesignator,
      "symbol-four",
      10,
      {
        "Supplier Part": "C900001",
        "Manufacturer Part": "CONN-4",
        Footprint: "CONN_4"
      }
    ),
    ...component(`source-${suffix}`, "SRC", "symbol-one", 30),
    ...component(`anonymous-${suffix}`, undefined, "symbol-one", 40),
    record(
      { type: "DOCHEAD", ticket: 100 },
      { docType: "SYMBOL", client: suffix, uuid: "symbol-four" }
    ),
    record({ type: "META", ticket: 101 }, { title: "Connector" }),
    record({ type: "PART", id: "part-four", ticket: 102 }, { title: "A" }),
    ...symbolPins("symbol-four", "part-four", connectorPins, 110),
    record(
      { type: "DOCHEAD", ticket: 200 },
      { docType: "SYMBOL", client: suffix, uuid: "symbol-one" }
    ),
    record({ type: "META", ticket: 201 }, { title: "Endpoint" }),
    record({ type: "PART", id: "part-one", ticket: 202 }, { title: "A" }),
    ...symbolPins("symbol-one", "part-one", ["1"], 210)
  ].join("\n");
}

async function writeProject(
  parent: string,
  suffix: string,
  designator: string,
  pins?: readonly string[]
): Promise<string> {
  const projectPath = path.join(parent, `${suffix}.epro2`);
  await writeFile(
    projectPath,
    createStoredZip([
      { name: `${suffix}.epru`, data: projectLog(suffix, designator, pins) }
    ])
  );
  return projectPath;
}

async function writeNetlist(
  parent: string,
  suffix: string,
  connectorDesignator: string,
  connectorPins: readonly string[] = ["1", "2", "3", "4"]
): Promise<string> {
  const netlistPath = path.join(parent, `${suffix}.enet`);
  await writeFile(
    netlistPath,
    JSON.stringify({
      version: "2.0.0",
      components: {
        source: {
          props: { Designator: "SRC" },
          pinInfoMap: {
            one: { name: "OUT", number: "1", net: `NET_${suffix}` }
          }
        },
        connector: {
          props: {
            Designator: connectorDesignator,
            "Supplier Part": "C900001",
            "Manufacturer Part": "CONN-4",
            Footprint: "CONN_4"
          },
          pinInfoMap: Object.fromEntries(
            connectorPins.map((number) => [
              `pin-${number}`,
              {
                name: `PIN_${number}`,
                number,
                net: number === "1" ? `NET_${suffix}` : ""
              }
            ])
          )
        },
        external: {
          props: { Designator: `EXT_${suffix}` },
          pinInfoMap: {
            one: { name: "IN", number: "9", net: `NET_${suffix}` }
          }
        }
      },
      designRule: {},
      netClass: {},
      equalLengthNetGroup: {},
      differentialPair: {}
    }),
    { mode: 0o600 }
  );
  return netlistPath;
}

function appError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

function queryError(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof QueryError && error.code === code;
}

test("装配会话严格校验成员、分页、候选和显式针脚映射", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "schemcp-assembly-session-"));
  const projects = new EdaMcpProjectSession();
  const inputs = await Promise.all([
    writeProject(directory, "a", "J1"),
    writeProject(directory, "b", "J1"),
    writeProject(directory, "c", "J3", ["1", "2", "3", "5"]),
    writeProject(directory, "d", "J4")
  ]);
  const opened = [];
  for (const input of inputs) opened.push(await projects.open(input));
  const handles = opened.map((item) => item.project.projectHandle as string);
  await projects.attachNetlist(handles[0]!, await writeNetlist(directory, "a", "J1"));
  await projects.attachNetlist(handles[1]!, await writeNetlist(directory, "b", "J1"));
  await projects.attachNetlist(
    handles[2]!,
    await writeNetlist(directory, "c", "J3", ["1", "2", "3", "5"])
  );

  const assemblies = new SchematicAssemblySession(projects);
  assert.throws(
    () => assemblies.create([handles[0]!]),
    appError(ERROR_CODES.MCP_ASSEMBLY_INVALID)
  );
  assert.throws(
    () => assemblies.create([handles[0]!, handles[0]!]),
    appError(ERROR_CODES.MCP_ASSEMBLY_INVALID)
  );
  assert.throws(
    () => assemblies.create([handles[0]!, "missing"]),
    appError(ERROR_CODES.MCP_PROJECT_HANDLE_INVALID)
  );

  const created = assemblies.create([handles[1]!, handles[0]!]);
  assert.equal(created.disposition, "CREATED");
  assert.deepEqual(created.assembly.projectHandles, [handles[0]!, handles[1]!].sort());
  assert.equal(
    assemblies.create([handles[0]!, handles[1]!]).disposition,
    "ALREADY_EXISTS"
  );

  const second = assemblies.create([handles[0]!, handles[2]!]);
  const firstPage = assemblies.list({ limit: 1 });
  assert.equal(firstPage.total, 2);
  assert.ok(firstPage.nextCursor);
  assert.equal(assemblies.list({ limit: 1, cursor: firstPage.nextCursor }).items.length, 1);
  assert.throws(() => assemblies.list({ limit: 0 }), queryError("QUERY_INVALID_LIMIT"));
  assert.throws(
    () => assemblies.list({ cursor: "not-a-cursor" }),
    queryError("QUERY_INVALID_CURSOR")
  );
  const beyond = Buffer.from(
    JSON.stringify({ version: 1, revision: 2, scope: "assemblies", offset: 999 })
  ).toString("base64url");
  assert.throws(
    () => assemblies.list({ cursor: beyond }),
    queryError("QUERY_INVALID_CURSOR")
  );

  assert.throws(
    () => assemblies.listCandidates({ assemblyHandle: "missing" }),
    appError(ERROR_CODES.MCP_ASSEMBLY_INVALID)
  );
  const candidatePage = assemblies.listCandidates({
    assemblyHandle: created.assembly.assemblyHandle,
    limit: 1
  });
  assert.equal(candidatePage.total, 1);
  const candidate = candidatePage.items[0]!;
  assert.deepEqual(candidate.pinNumbers, ["1", "2", "3", "4"]);
  assert.deepEqual(
    candidate.evidence.map((item) => item.kind),
    [
      "EXACT_PIN_NUMBER_SET",
      "SAME_PIN_COUNT",
      "EXACT_DESIGNATOR",
      "EXACT_LCSC_PART_ID",
      "EXACT_MANUFACTURER_PART",
      "EXACT_FOOTPRINT",
      "PIN_NAME_MATCHES"
    ]
  );
  assert.equal(
    assemblies.listCandidates({
      assemblyHandle: second.assembly.assemblyHandle
    }).total,
    0
  );
  assert.throws(
    () =>
      assemblies.confirm({
        assemblyHandle: created.assembly.assemblyHandle,
        candidateId: "missing",
        mapping: { kind: "SAME_PIN_NUMBER" }
      }),
    appError(ERROR_CODES.MCP_INTERCONNECT_INVALID)
  );
  for (const pinPairs of [
    [],
    [{ leftPinNumber: "9", rightPinNumber: "1" }],
    [
      { leftPinNumber: "1", rightPinNumber: "1" },
      { leftPinNumber: "1", rightPinNumber: "2" }
    ]
  ]) {
    assert.throws(
      () =>
        assemblies.confirm({
          assemblyHandle: created.assembly.assemblyHandle,
          candidateId: candidate.candidateId,
          mapping: { kind: "EXPLICIT_PIN_PAIRS", pinPairs }
        }),
      appError(ERROR_CODES.MCP_INTERCONNECT_INVALID)
    );
  }
  const explicit = assemblies.confirm({
    assemblyHandle: created.assembly.assemblyHandle,
    candidateId: candidate.candidateId,
    mapping: {
      kind: "EXPLICIT_PIN_PAIRS",
      pinPairs: [
        { leftPinNumber: "1", rightPinNumber: "2" },
        { leftPinNumber: "2", rightPinNumber: "1" }
      ]
    }
  });
  assert.equal(explicit.disposition, "CONFIRMED");
  assert.equal(explicit.interconnect.mappingMethod, "USER_CONFIRMED_EXPLICIT_PIN_PAIRS");
  assert.equal(
    assemblies.confirm({
      assemblyHandle: created.assembly.assemblyHandle,
      candidateId: candidate.candidateId,
      mapping: {
        kind: "EXPLICIT_PIN_PAIRS",
        pinPairs: [
          { leftPinNumber: "1", rightPinNumber: "2" },
          { leftPinNumber: "2", rightPinNumber: "1" }
        ]
      }
    }).disposition,
    "ALREADY_CONFIRMED"
  );

  assert.equal(assemblies.close("missing").disposition, "NOT_FOUND");
  assert.equal(assemblies.close(second.assembly.assemblyHandle).disposition, "CLOSED");
  assert.throws(
    () => assemblies.list({ cursor: firstPage.nextCursor }),
    queryError("QUERY_INVALID_CURSOR")
  );
});

test("装配连接只沿同网和用户确认映射，并可精确恢复私有清单", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "schemcp-assembly-walk-"));
  const projects = new EdaMcpProjectSession();
  const left = await projects.open(await writeProject(directory, "left", "J1"));
  const right = await projects.open(await writeProject(directory, "right", "J2"));
  const leftHandle = left.project.projectHandle!;
  const rightHandle = right.project.projectHandle!;
  await projects.attachNetlist(leftHandle, await writeNetlist(directory, "left", "J1"));
  await projects.attachNetlist(rightHandle, await writeNetlist(directory, "right", "J2"));
  const assemblies = new SchematicAssemblySession(projects);
  const created = assemblies.create([leftHandle, rightHandle]).assembly;
  const candidate = assemblies.listCandidates({
    assemblyHandle: created.assemblyHandle
  }).items[0]!;

  assert.throws(
    () =>
      assemblies.listConnections({
        assemblyHandle: created.assemblyHandle,
        projectHandle: "missing",
        designator: "SRC"
      }),
    appError(ERROR_CODES.MCP_ASSEMBLY_INVALID)
  );
  for (const maxInterconnectHops of [-1, 5, 1.5]) {
    assert.throws(
      () =>
        assemblies.listConnections({
          assemblyHandle: created.assemblyHandle,
          projectHandle: leftHandle,
          designator: "SRC",
          maxInterconnectHops
        }),
      appError(ERROR_CODES.MCP_ASSEMBLY_INVALID)
    );
  }
  assert.equal(
    assemblies.listConnections({
      assemblyHandle: created.assemblyHandle,
      projectHandle: leftHandle,
      designator: "UNKNOWN"
    }).status,
    "NOT_FOUND"
  );
  const anonymous = projects.requireEntry(leftHandle).index.listComponents({
    limit: 50
  }).items.find((component) => component.designator === undefined)!;
  const anonymousConnections = assemblies.listConnections({
    assemblyHandle: created.assemblyHandle,
    projectHandle: leftHandle,
    componentId: anonymous.id,
    pageId: anonymous.pageId
  });
  assert.equal(anonymousConnections.status, "FOUND");
  assert.equal("paths" in anonymousConnections ? anonymousConnections.paths.total : -1, 0);

  const before = assemblies.listConnections({
    assemblyHandle: created.assemblyHandle,
    projectHandle: leftHandle,
    designator: "SRC",
    pinNumber: "1",
    maxInterconnectHops: 1
  });
  assert.equal(before.status, "FOUND");
  assert.equal(
    "paths" in before && before.paths.items.some((path) => path.target.componentRef === "EXT_right"),
    false
  );

  assemblies.confirm({
    assemblyHandle: created.assemblyHandle,
    candidateId: candidate.candidateId,
    mapping: { kind: "SAME_PIN_NUMBER" }
  });
  const after = assemblies.listConnections({
    assemblyHandle: created.assemblyHandle,
    projectHandle: leftHandle,
    designator: "SRC",
    pinNumber: "1",
    maxInterconnectHops: 1,
    limit: 1
  });
  assert.equal(after.status, "FOUND");
  assert.ok("paths" in after && after.paths.nextCursor);
  const target = "paths" in after
    ? after.paths.items.find((path) => path.target.componentRef === "EXT_right")
    : undefined;
  // limit=1 按稳定顺序返回本地端点；完整页用于断言跨工程路径。
  assert.equal(target, undefined);
  const all = assemblies.listConnections({
    assemblyHandle: created.assemblyHandle,
    projectHandle: leftHandle,
    designator: "SRC",
    pinNumber: "1",
    maxInterconnectHops: 1,
    limit: 50
  });
  assert.ok("paths" in all);
  const crossPath = "paths" in all
    ? all.paths.items.find((path) => path.target.componentRef === "EXT_right")
    : undefined;
  assert.ok(crossPath);
  assert.deepEqual(
    crossPath.segments.map((segment) => segment.kind),
    ["BOUND_NETLIST", "CONFIRMED_INTERCONNECT", "BOUND_NETLIST"]
  );
  assert.throws(
    () =>
      assemblies.listConnections({
        assemblyHandle: created.assemblyHandle,
        projectHandle: leftHandle,
        designator: "SRC",
        pinNumber: "1",
        maxInterconnectHops: 1,
        cursor: "invalid"
      }),
    queryError("QUERY_INVALID_CURSOR")
  );

  const manifest = assemblies.getManifest(created.assemblyHandle);
  const manifestPath = path.join(directory, "assembly.schemcp-assembly.json");
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  assert.equal(assemblies.close(created.assemblyHandle).disposition, "CLOSED");
  const restored = await assemblies.openManifest(manifestPath);
  assert.equal(restored.disposition, "RESTORED");
  assert.equal((await assemblies.openManifest(manifestPath)).disposition, "ALREADY_RESTORED");

  const unknownHash = "f".repeat(64);
  const knownHash = projects.requireEntry(leftHandle).index.ir.irSha256;
  const unknownProjectManifest = createSchematicAssemblyManifest({
    schema: "schemcp.schematic-assembly-manifest",
    schemaVersion: "1.0.0",
    generator: { name: "@yuanzihao/schemcp", version: "0.1.0" },
    projects: [
      { projectId: projectIdForIr(knownHash), irSha256: knownHash },
      { projectId: projectIdForIr(unknownHash), irSha256: unknownHash }
    ],
    assembly: {
      projectIds: [projectIdForIr(knownHash), projectIdForIr(unknownHash)].sort(),
      interconnects: [],
      relationshipTruth: "USER_ASSERTED_PROJECT_RELATIONSHIP"
    }
  });
  const unknownPath = path.join(directory, "unknown.schemcp-assembly.json");
  await writeFile(unknownPath, JSON.stringify(unknownProjectManifest), { mode: 0o600 });
  await assert.rejects(
    assemblies.openManifest(unknownPath),
    appError(ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID)
  );

  await projects.close(rightHandle);
  assemblies.prune();
  assert.equal(assemblies.list({}).total, 0);
  assert.throws(
    () => assemblies.getManifest(created.assemblyHandle),
    appError(ERROR_CODES.MCP_ASSEMBLY_INVALID)
  );
});
