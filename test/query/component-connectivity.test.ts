import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compileProject } from "../../src/application/compile-project.js";
import { ComponentConnectivityQuery } from "../../src/query/component-connectivity.js";
import { EdaIrQueryIndex, QueryError } from "../../src/query/index.js";
import { NetlistComparisonQueryIndex } from "../../src/query/netlist-comparison-index.js";
import { buildNetlistComparisonReport } from "../../src/truth/compare-netlist-evidence.js";
import { parseJlcEdaProEnet } from "../../src/truth/jlceda-pro-enet.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

function record(
  outer: Readonly<Record<string, unknown>>,
  inner: Readonly<Record<string, unknown>>
): string {
  return `${JSON.stringify(outer)}||${JSON.stringify(inner)}|`;
}

function component(
  id: string,
  designator: string | undefined,
  x: number,
  y: number,
  ticket: number
): readonly string[] {
  return [
    record(
      { type: "COMPONENT", id, ticket },
      { partId: "part-a", x, y, rotation: 0, isMirror: false }
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
      { parentId: id, key: "Symbol", value: "symbol-a" }
    )
  ];
}

function pin(
  id: string,
  number: string | undefined,
  y: number,
  ticket: number
): readonly string[] {
  return [
    record(
      { type: "PIN", id, ticket },
      { partId: "part-a", x: 0, y, length: 10, rotation: 0, display: true }
    ),
    ...(number === undefined
      ? []
      : [
          record(
            { type: "ATTR", id: `${id}-number`, ticket: ticket + 1 },
            { parentId: id, key: "Pin Number", value: number }
          ),
          record(
            { type: "ATTR", id: `${id}-name`, ticket: ticket + 2 },
            { parentId: id, key: "Pin Name", value: `PIN_${number}` }
          )
        ])
  ];
}

function wire(
  id: string,
  net: string | undefined,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  ticket: number
): readonly string[] {
  return [
    record({ type: "WIRE", id, ticket }, { locked: false }),
    ...(net === undefined
      ? []
      : [
          record(
            { type: "ATTR", id: `${id}-net`, ticket: ticket + 1 },
            { parentId: id, key: "NET", value: net }
          )
        ]),
    record(
      { type: "LINE", id: `${id}-line`, ticket: ticket + 2 },
      { lineGroup: id, startX, startY, endX, endY }
    )
  ];
}

const PROJECT_LOG = [
  record(
    { type: "DOCHEAD", ticket: 0 },
    { docType: "SCH", client: "test", uuid: "schematic-a" }
  ),
  record({ type: "META", ticket: 1 }, { name: "Connectivity" }),
  record(
    { type: "DOCHEAD", ticket: 2 },
    { docType: "SCH_PAGE", client: "test", uuid: "page-a" }
  ),
  record(
    { type: "META", ticket: 3 },
    { title: "Main", schematic: "schematic-a" }
  ),
  ...component("component-u1", "U1", 10, 20, 10),
  record(
    { type: "ATTR", id: "component-u1-assembly", ticket: 19 },
    { parentId: "component-u1", key: "Add into BOM", value: "yes" }
  ),
  ...component("component-r1", "R1", 20, 20, 20),
  ...component("component-x2", "X2", 40, 20, 30),
  ...component("component-anonymous", undefined, 60, 20, 40),
  ...wire("wire-vcc", "VCC", 10, 20, 20, 20, 50),
  ...wire("wire-unlabeled", undefined, 10, 40, 20, 40, 60),
  ...wire("wire-conflict-a", "NET_A", 10, 50, 20, 50, 70),
  ...wire("wire-conflict-b", "NET_B", 10, 50, 0, 50, 80),
  record(
    { type: "DOCHEAD", ticket: 100 },
    { docType: "SYMBOL", client: "test", uuid: "symbol-a" }
  ),
  record(
    { type: "META", ticket: 101 },
    { title: "STM32 Microcontroller Connectivity Symbol" }
  ),
  record({ type: "PART", id: "part-a", ticket: 102 }, { title: "A" }),
  ...pin("pin-1", "1", 0, 110),
  ...pin("pin-2", "2", 10, 120),
  ...pin("pin-3", "3", 20, 130),
  ...pin("pin-4", "4", 30, 140),
  ...pin("pin-no-number", undefined, 40, 150)
].join("\n");

async function fixture(): Promise<{
  readonly index: EdaIrQueryIndex;
  readonly comparison: NetlistComparisonQueryIndex;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "schemcp-connectivity-"));
  const projectPath = path.join(directory, "fixture.epro2");
  await writeFile(
    projectPath,
    createStoredZip([{ name: "fixture.epru", data: PROJECT_LOG }])
  );
  const ir = await compileProject(projectPath);
  const index = new EdaIrQueryIndex(ir);
  const netlistBytes = Buffer.from(
    JSON.stringify({
      version: "2.0.0",
      components: {
        u1: {
          props: { Designator: "U1" },
          pinInfoMap: {
            one: { name: "POWER", number: "1", net: "VCC" },
            two: { name: "NC", number: "2", net: "" },
            six: { name: "EXTRA", number: "6", net: "EXTRA_NET" }
          }
        },
        r1: {
          props: { Designator: "R1" },
          pinInfoMap: {
            one: { name: "A", number: "1", net: "VCC" },
            two: { name: "B", number: "2", net: "" }
          }
        },
        z9: {
          props: { Designator: "Z9" },
          pinInfoMap: {
            one: { name: "REMOTE", number: "9", net: "VCC" }
          }
        }
      },
      designRule: {},
      netClass: {},
      equalLengthNetGroup: {},
      differentialPair: {}
    })
  );
  const netlist = parseJlcEdaProEnet(netlistBytes);
  const comparison = new NetlistComparisonQueryIndex(
    buildNetlistComparisonReport(ir, netlistBytes, netlist),
    netlist
  );
  return { index, comparison };
}

test("组件连接上下文合并几何候选、绑定网表和网表额外引脚", async () => {
  const { index, comparison } = await fixture();
  const candidateQuery = new ComponentConnectivityQuery(index);
  const candidate = candidateQuery.getPinConnectivity({
    designator: "U1",
    limit: 2
  });
  assert.equal(candidate.status, "FOUND");
  assert.ok("pins" in candidate);
  assert.equal(candidate.netlistBinding, "NOT_BOUND");
  assert.equal(candidate.pins.total, 5);
  assert.ok(candidate.pins.nextCursor);
  const candidateNext = candidateQuery.getPinConnectivity({
    designator: "U1",
    limit: 2,
    cursor: candidate.pins.nextCursor
  });
  assert.ok("pins" in candidateNext);
  assert.equal(candidateNext.pins.items.length, 2);

  const allCandidate = candidateQuery.getPinConnectivity({
    designator: "U1",
    limit: 50
  });
  assert.ok("pins" in allCandidate);
  const candidateStates = new Map(
    allCandidate.pins.items.map((item) => [item.number ?? "missing", item.network.state])
  );
  assert.equal(candidateStates.get("1"), "UNIQUE_EXPLICIT_NET_CANDIDATE");
  assert.equal(candidateStates.get("3"), "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET");
  assert.equal(candidateStates.get("4"), "CONFLICTING_EXPLICIT_NET_CANDIDATES");
  assert.equal(candidateStates.get("missing"), "PIN_NUMBER_MISSING");

  assert.throws(
    () => candidateQuery.getPinConnectivity({ designator: "U1", limit: 0 }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_LIMIT"
  );
  assert.throws(
    () => candidateQuery.getPinConnectivity({ designator: "U1", cursor: "invalid" }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  const foreignCursor = Buffer.from(
    JSON.stringify({ version: 1, scope: "wrong", offset: 1 })
  ).toString("base64url");
  assert.throws(
    () => candidateQuery.getPinConnectivity({ designator: "U1", cursor: foreignCursor }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );

  const boundQuery = new ComponentConnectivityQuery(index, comparison);
  const bound = boundQuery.getPinConnectivity({ designator: "U1", limit: 50 });
  assert.equal(bound.status, "FOUND");
  assert.ok("pins" in bound);
  assert.equal(bound.netlistBinding, "BOUND");
  assert.equal(bound.pins.total, 6);
  const boundByNumber = new Map(bound.pins.items.map((item) => [item.number, item]));
  assert.equal(boundByNumber.get("1")?.network.state, "BOUND_NET");
  assert.equal(boundByNumber.get("1")?.network.netName, "VCC");
  assert.equal(boundByNumber.get("2")?.network.state, "BOUND_UNCONNECTED");
  assert.equal(boundByNumber.get("6")?.pinId.startsWith("enet:"), true);
  assert.equal(boundByNumber.get("6")?.boundNetlistName, "EXTRA");

  const unresolvedComponent = boundQuery.getPinConnectivity({
    designator: "X2",
    limit: 50
  });
  assert.ok("pins" in unresolvedComponent);
  assert.equal(
    unresolvedComponent.pins.items.every(
      (item) => item.network.state === "NETLIST_COMPONENT_NOT_RESOLVED"
    ),
    true
  );
  assert.equal(
    boundQuery.getPinConnectivity({ designator: "UNKNOWN" }).status,
    "NOT_FOUND"
  );
});

test("直接连接查询只返回同一网络端点并隔离筛选游标", async () => {
  const { index, comparison } = await fixture();
  const boundQuery = new ComponentConnectivityQuery(index, comparison);
  const bound = boundQuery.listDirectConnections({
    designator: "U1",
    pinNumber: "1",
    limit: 1
  });
  assert.equal(bound.status, "FOUND");
  assert.ok("connections" in bound);
  assert.equal(bound.evidence, "BOUND_NETLIST");
  assert.equal(bound.connections.total, 2);
  assert.ok(bound.connections.nextCursor);
  const second = boundQuery.listDirectConnections({
    designator: "U1",
    pinNumber: "1",
    limit: 1,
    cursor: bound.connections.nextCursor
  });
  assert.ok("connections" in second);
  assert.equal(second.connections.items.length, 1);
  const all = boundQuery.listDirectConnections({
    designator: "U1",
    pinNumber: "1",
    limit: 50
  });
  assert.ok("connections" in all);
  assert.deepEqual(
    all.connections.items.map((item) => item.target.componentRef),
    ["R1", "Z9"]
  );
  assert.equal(all.connections.items[0]?.target.component?.designator, "R1");
  assert.equal(all.connections.items[1]?.target.component, undefined);
  assert.equal(
    all.connections.items.every(
      (item) =>
        item.propagation === "DIRECT_SAME_NET_ONLY" &&
        item.network.evidence === "BOUND_NETLIST"
    ),
    true
  );

  const noNetlistComponent = boundQuery.listDirectConnections({ designator: "X2" });
  assert.ok("connections" in noNetlistComponent);
  assert.equal(noNetlistComponent.connections.total, 0);
  const anonymous = index.listComponents({ limit: 50 }).items.find(
    (component) => component.designator === undefined
  )!;
  const noDesignator = boundQuery.listDirectConnections({
    componentId: anonymous.id,
    pageId: anonymous.pageId
  });
  assert.ok("connections" in noDesignator);
  assert.equal(noDesignator.evidence, "NOT_AVAILABLE");
  assert.equal(noDesignator.connections.total, 0);

  assert.throws(
    () =>
      boundQuery.listDirectConnections({
        designator: "U1",
        pinNumber: "2",
        cursor: bound.connections.nextCursor
      }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  const beyond = Buffer.from(
    JSON.stringify({
      version: 1,
      scope: Buffer.from(bound.connections.nextCursor!, "base64url").toString("utf8")
        ? JSON.parse(Buffer.from(bound.connections.nextCursor!, "base64url").toString("utf8")).scope
        : "",
      offset: 999
    })
  ).toString("base64url");
  assert.throws(
    () =>
      boundQuery.listDirectConnections({
        designator: "U1",
        pinNumber: "1",
        cursor: beyond
      }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );

  const candidateQuery = new ComponentConnectivityQuery(index);
  const candidate = candidateQuery.listDirectConnections({
    designator: "U1",
    pinNumber: "1",
    limit: 50
  });
  assert.ok("connections" in candidate);
  assert.equal(candidate.evidence, "EPRO2_CANDIDATE");
  assert.equal(candidate.connections.total, 1);
  assert.equal(candidate.connections.items[0]?.target.componentRef, "R1");
  assert.equal(candidate.connections.items[0]?.network.name, "VCC");
  assert.equal(candidate.connections.items[0]?.network.evidence, "EPRO2_CANDIDATE");
  assert.equal(
    candidateQuery.listDirectConnections({ designator: "UNKNOWN" }).status,
    "NOT_FOUND"
  );
});

test("MCU 引脚只有在完整模型和显式 NC 或绑定空网络下确认未使用", async () => {
  const { index, comparison } = await fixture();
  const candidate = new ComponentConnectivityQuery(index).getMcuPinUsage({
    designator: "U1",
    limit: 50
  });
  assert.equal(candidate.mcuCount, 1);
  assert.equal(candidate.netlistBinding, "NOT_BOUND");
  assert.equal(
    candidate.pins.items.find((item) => item.pin.number === "2")?.usageStatus,
    "UNKNOWN"
  );
  assert.equal(
    candidate.pins.items.find((item) => item.pin.number === "2")?.status,
    "UNKNOWN"
  );
  assert.deepEqual(
    candidate.pins.items.find((item) => item.pin.number === "2")
      ?.unresolvedReasons,
    ["NETLIST_NOT_ATTACHED", "NO_EXPLICIT_CONNECTION_EVIDENCE"]
  );
  assert.equal(
    candidate.pins.items.find((item) => item.pin.number === "1")?.usageStatus,
    "USED_CANDIDATE"
  );
  const candidateUsed = candidate.pins.items.find(
    (item) => item.pin.number === "1"
  );
  assert.equal(candidateUsed?.status, "USED");
  assert.ok(candidateUsed?.powerDomains.length);
  assert.equal(
    candidateUsed?.resourceRoles.some(
      (item) =>
        item.resourceType === "MCU_PIN" && item.kind === "MCU_PIN_CONNECTION"
    ),
    true
  );

  const bound = new ComponentConnectivityQuery(
    index,
    comparison
  ).getMcuPinUsage({ designator: "U1", limit: 50 });
  assert.equal(bound.netlistBinding, "BOUND");
  const byNumber = new Map(
    bound.pins.items.map((item) => [item.pin.number, item])
  );
  assert.equal(byNumber.get("1")?.usageStatus, "USED_BOUND_NETLIST");
  assert.equal(byNumber.get("1")?.status, "USED");
  assert.equal(byNumber.get("1")?.evidenceClass, "USER_BOUND_NETLIST");
  assert.equal(byNumber.get("2")?.usageStatus, "UNUSED_CONFIRMED");
  assert.equal(byNumber.get("2")?.status, "UNUSED");
  assert.equal(
    byNumber.get("2")?.usageBasis,
    "USER_BOUND_NETLIST_UNCONNECTED"
  );
  assert.equal(byNumber.get("2")?.truthStatus, "NOT_VERIFIED");
  const unused = new ComponentConnectivityQuery(
    index,
    comparison
  ).getMcuPinUsage({
    designator: "U1",
    usageStatus: "UNUSED_CONFIRMED",
    limit: 1
  });
  assert.equal(unused.pins.total, 1);
  assert.equal(
    new ComponentConnectivityQuery(index, comparison).getMcuPinUsage({
      designator: "U1",
      status: "UNUSED",
      limit: 50
    }).pins.total,
    1
  );

  const dnpIr = {
    ...index.ir,
    components: index.ir.components.map((item) =>
      item.designator === "U1"
        ? {
            ...item,
            assembly: {
              ...item.assembly,
              status: "DNP" as const,
              reason: "EXPLICIT_ADD_INTO_BOM_NO" as const,
              values: ["no"]
            }
          }
        : item
    )
  };
  const dnp = new ComponentConnectivityQuery(
    new EdaIrQueryIndex(dnpIr)
  ).getMcuPinUsage({ designator: "U1", status: "DNP_COMPONENT", limit: 50 });
  assert.equal(dnp.pins.total, candidate.pins.total);
  assert.equal(
    dnp.pins.items.every(
      (item) =>
        item.status === "DNP_COMPONENT" && item.usageStatus === "UNKNOWN"
    ),
    true
  );
  assert.throws(
    () =>
      new ComponentConnectivityQuery(index, comparison).getMcuPinUsage({
        designator: "U1",
        usageStatus: "USED_BOUND_NETLIST",
        cursor: unused.pins.nextCursor ?? "invalid"
      }),
    (error: unknown) =>
      error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
});
