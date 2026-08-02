import assert from "node:assert/strict";
import test from "node:test";
import { QueryError } from "../../src/query/index.js";
import { NetlistComparisonQueryIndex } from "../../src/query/netlist-comparison-index.js";
import type { NetlistComparisonReport } from "../../src/truth/compare-netlist-evidence.js";

const matched = {
  componentRef: "U1",
  pinNumber: "1",
  netName: "VCC"
} as const;
const missing = {
  componentRef: "U2",
  pinNumber: "1",
  netName: "GND"
} as const;
const unexpected = {
  componentRef: "U3",
  pinNumber: "1",
  netName: "UNEXPECTED"
} as const;

const REPORT: NetlistComparisonReport = {
  schemaVersion: "0.1.0",
  generator: {
    name: "@yuanzihao/schemcp",
      version: "0.2.0"
  },
  sourceProject: {
    archiveSha256: "a".repeat(64),
    reducedStateSha256: "b".repeat(64),
    irSha256: "c".repeat(64)
  },
  netlist: {
    format: "JLCEDA_PRO_ENET",
    formatVersion: "2.0.0",
    bytes: 123,
    sha256: "d".repeat(64),
    componentCount: 2,
    pinEntryCount: 2,
    connectedPinEntryCount: 2,
    unconnectedPinEntryCount: 0,
    tupleCount: 2
  },
  candidateCompilation: {
    tuples: [
      {
        tuple: matched,
        evidence: {
          pinInstanceId: "pin-1",
          pageId: "page-1",
          componentId: "component-1",
          symbolPinId: "symbol-pin-1",
          wireIds: ["wire-1"],
          segmentIds: ["segment-1"]
        }
      },
      {
        tuple: unexpected,
        evidence: {
          pinInstanceId: "pin-3",
          pageId: "page-1",
          componentId: "component-3",
          symbolPinId: "symbol-pin-3",
          wireIds: ["wire-3"],
          segmentIds: ["segment-3"]
        }
      }
    ],
    exclusions: [],
    summary: {
      pinInstances: 2,
      eligibleTuples: 2,
      excludedPinInstances: 0,
      missingComponentRef: 0,
      nonComponentEndpoint: 0,
      missingPinNumber: 0,
      conflictingExplicitNetCandidates: 0,
      unresolvedWireWithoutExplicitNet: 0,
      declaredNoConnect: 0,
      unresolvedNoWire: 0,
      inconsistentCandidateState: 0
    }
  },
  comparison: {
    schemaVersion: "0.1.0",
    status: "DIFFERENCES_FOUND",
    exactSetMatch: false,
    candidateTupleCount: 2,
    truthTupleCount: 2,
    matched: [matched],
    missingInCandidate: [missing],
    unexpectedCandidate: [unexpected],
    candidateDuplicates: [],
    truthDuplicates: []
  },
  gates: {
    syntaxAdapter: "JLCEDA_PRO_ENET_V2_COMPONENTS_PARSED",
    sourceAuthenticity: "NOT_VERIFIED",
    projectBinding: "NOT_VERIFIED",
    officialNetlistComparison: "DIFFERENCES_FOUND",
    candidateExclusions: "NONE",
    electricalTruth: "NOT_VERIFIED"
  },
  reportSha256: "e".repeat(64)
};

test("网表比较索引分页返回三类元组并保留候选证据", () => {
  const index = new NetlistComparisonQueryIndex(REPORT);
  const first = index.listTuples({ limit: 1 });
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor !== undefined);
  const second = index.listTuples({
    limit: 2,
    cursor: first.nextCursor
  });
  assert.equal(second.items.length, 2);
  const all = [...first.items, ...second.items];
  assert.deepEqual(
    all.map((item) => item.kind).sort(),
    ["MATCHED", "MISSING_IN_CANDIDATE", "UNEXPECTED_CANDIDATE"]
  );
  assert.equal(
    all.find((item) => item.kind === "MATCHED")?.candidateEvidence?.[0]
      ?.pinInstanceId,
    "pin-1"
  );
  assert.equal(
    all.find((item) => item.kind === "MISSING_IN_CANDIDATE")
      ?.candidateEvidence,
    undefined
  );
});

test("网表比较索引按精确字段筛选，并拒绝跨筛选 cursor", () => {
  const index = new NetlistComparisonQueryIndex(REPORT);
  assert.deepEqual(
    index.listTuples({
      kind: "MISSING_IN_CANDIDATE",
      componentRef: "U2",
      netName: "GND"
    }).items.map((item) => item.tuple),
    [missing]
  );
  const first = index.listTuples({ limit: 1 });
  assert.throws(
    () =>
      index.listTuples({
        kind: "MATCHED",
        cursor: first.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError &&
      error.code === "QUERY_INVALID_CURSOR"
  );
});

test("网表比较摘要只暴露脱敏哈希、计数和未验证门禁", () => {
  const summary = new NetlistComparisonQueryIndex(REPORT).getSummary();
  assert.equal(summary.binding, "USER_PROVIDED_NETLIST_BOUND");
  assert.deepEqual(summary.counts, {
    candidateTuples: 2,
    truthTuples: 2,
    matched: 1,
    missingInCandidate: 1,
    unexpectedCandidate: 1,
    excludedCandidatePins: 0
  });
  assert.equal(
    (summary.gates as { readonly electricalTruth: string })
      .electricalTruth,
    "NOT_VERIFIED"
  );
});

test("精确网络查询返回绑定网表端点、候选对照与逐项证据", () => {
  const index = new NetlistComparisonQueryIndex(REPORT);
  const exact = index.getNet({ netName: "VCC" });
  assert.equal(exact.status, "FOUND");
  if (exact.status !== "FOUND") return;
  assert.deepEqual(exact.net, {
    name: "VCC",
    comparisonStatus: "EXACT_SET_MATCH",
    tupleGroups: {
      boundNetlist: 1,
      candidate: 1,
      matched: 1,
      missingInCandidate: 0,
      unexpectedCandidate: 0
    },
    distinctComponents: {
      boundNetlist: 1,
      candidate: 1
    },
    duplicateGroups: {
      boundNetlist: 0,
      candidate: 0
    },
    duplicateOccurrences: {
      boundNetlist: 0,
      candidate: 0
    },
    representation: "NET_HYPEREDGE",
    propagation: "NOT_EVALUATED",
    endpointExpansion: "USE_GET_NET",
    basis:
      "STRICTLY_PARSED_BOUND_ENET_AND_DETERMINISTIC_CANDIDATE_COMPARISON"
  });
  assert.equal(exact.endpoints.total, 1);
  assert.equal(exact.endpoints.items[0]?.kind, "MATCHED");
  assert.equal(
    exact.endpoints.items[0]?.candidateEvidence?.[0]?.pinInstanceId,
    "pin-1"
  );

  const difference = index.getNet({ netName: "GND" });
  assert.equal(difference.status, "FOUND");
  if (difference.status === "FOUND") {
    assert.equal(difference.net.comparisonStatus, "DIFFERENCES_FOUND");
    assert.equal(difference.net.tupleGroups.missingInCandidate, 1);
    assert.equal(difference.endpoints.items[0]?.kind, "MISSING_IN_CANDIDATE");
  }
  assert.deepEqual(index.getNet({ netName: "ABSENT" }), {
    status: "NOT_FOUND",
    netName: "ABSENT"
  });
  assert.deepEqual(index.getNet({ netName: "UNEXPECTED" }), {
    status: "NOT_FOUND",
    netName: "UNEXPECTED"
  });
});

test("网络查询 cursor 与普通比较列表隔离，并显式报告重复元组", () => {
  const index = new NetlistComparisonQueryIndex(REPORT);
  const comparisonPage = index.listTuples({ limit: 1 });
  assert.throws(
    () =>
      index.getNet({
        netName: "VCC",
        cursor: comparisonPage.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError &&
      error.code === "QUERY_INVALID_CURSOR"
  );

  const duplicateReport: NetlistComparisonReport = {
    ...REPORT,
    comparison: {
      ...REPORT.comparison,
      status: "DUPLICATE_TUPLES",
      candidateDuplicates: [{ tuple: matched, occurrences: 2 }],
      truthDuplicates: [{ tuple: matched, occurrences: 3 }]
    }
  };
  const duplicate = new NetlistComparisonQueryIndex(duplicateReport).getNet({
    netName: "VCC"
  });
  assert.equal(duplicate.status, "FOUND");
  if (duplicate.status !== "FOUND") return;
  assert.equal(duplicate.net.comparisonStatus, "DUPLICATE_TUPLES");
  assert.deepEqual(duplicate.net.duplicateGroups, {
    boundNetlist: 1,
    candidate: 1
  });
  assert.deepEqual(duplicate.net.duplicateOccurrences, {
    boundNetlist: 3,
    candidate: 2
  });
});

test("绑定电气网络按超边枚举、精确位号筛选并隔离游标", () => {
  const index = new NetlistComparisonQueryIndex(REPORT);
  const first = index.listBoundElectricalNets({ limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor !== undefined);
  const second = index.listBoundElectricalNets({
    limit: 1,
    cursor: first.nextCursor
  });
  assert.equal(second.items.length, 1);
  assert.deepEqual(
    [...first.items, ...second.items].map((item) => item.name),
    ["GND", "VCC"]
  );
  assert.equal(
    first.items[0]?.representation,
    "NET_HYPEREDGE"
  );
  assert.equal(first.items[0]?.propagation, "NOT_EVALUATED");
  assert.equal(first.items[0]?.endpointExpansion, "USE_GET_NET");

  const incident = index.listBoundElectricalNets({
    componentRef: "U1"
  });
  assert.equal(incident.total, 1);
  assert.equal(incident.items[0]?.name, "VCC");
  assert.deepEqual(incident.items[0]?.distinctComponents, {
    boundNetlist: 1,
    candidate: 1
  });

  const differences = index.listBoundElectricalNets({
    comparisonStatus: "DIFFERENCES_FOUND"
  });
  assert.deepEqual(
    differences.items.map((item) => item.name),
    ["GND"]
  );
  assert.throws(
    () =>
      index.listBoundElectricalNets({
        componentRef: "U1",
        cursor: first.nextCursor
      }),
    (error: unknown) =>
      error instanceof QueryError &&
      error.code === "QUERY_INVALID_CURSOR"
  );
});

test("绑定电气网络不把仅候选网络冒充 .enet 超边，并显式保留重复状态", () => {
  const duplicateReport: NetlistComparisonReport = {
    ...REPORT,
    comparison: {
      ...REPORT.comparison,
      status: "DUPLICATE_TUPLES",
      candidateDuplicates: [{ tuple: unexpected, occurrences: 2 }],
      truthDuplicates: [{ tuple: matched, occurrences: 3 }]
    }
  };
  const index = new NetlistComparisonQueryIndex(duplicateReport);
  const nets = index.listBoundElectricalNets({});
  assert.deepEqual(
    nets.items.map((item) => item.name),
    ["GND", "VCC"]
  );
  assert.equal(
    nets.items.some((item) => item.name === "UNEXPECTED"),
    false
  );
  const duplicate = index.listBoundElectricalNets({
    comparisonStatus: "DUPLICATE_TUPLES"
  });
  assert.equal(duplicate.total, 1);
  assert.equal(duplicate.items[0]?.name, "VCC");
  assert.deepEqual(duplicate.items[0]?.duplicateOccurrences, {
    boundNetlist: 3,
    candidate: 0
  });
});
