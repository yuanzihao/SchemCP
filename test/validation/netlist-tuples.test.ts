import assert from "node:assert/strict";
import test from "node:test";
import type {
  IrNetworkEndpointCandidate,
  IrPinConnectionCandidateStatus,
  IrPinInstance,
  IrSchematicPage,
  IrShortRelationCandidate
} from "../../src/ir/model.js";
import {
  compareNetlistTupleSets,
  compileCandidateNetlistTuples,
  compileResolvedCandidateNetlistTuples,
  type NetlistTuple
} from "../../src/validation/netlist-tuples.js";

function pin(
  id: string,
  options: {
    readonly designator?: string;
    readonly number?: string;
    readonly status?: IrPinConnectionCandidateStatus;
    readonly netNames?: readonly string[];
    readonly endpointKind?: IrPinInstance["endpointKind"];
    readonly pageId?: string;
    readonly unlabeledWireIds?: readonly string[];
  } = {}
): IrPinInstance {
  const status = options.status ?? "UNIQUE_EXPLICIT_NET_CANDIDATE";
  const netNames = options.netNames ?? ["NET-A"];
  return {
    id,
    pageId: options.pageId ?? "page-a",
    componentId: `component-${id}`,
    symbolId: "symbol-a",
    symbolPinId: `symbol-pin-${id}`,
    partId: "part-a",
    endpointKind: options.endpointKind ?? "PART_SYMBOL_PIN",
    symbolType: options.endpointKind === "NET_FLAG_PIN" ? 18 : 2,
    ...(options.designator === undefined
      ? { designator: `U${id}` }
      : { designator: options.designator }),
    ...(options.number === undefined
      ? { number: id }
      : { number: options.number }),
    instanceAttributes: [],
    connectionPoint: { x: 10, y: 20 },
    connectionCandidate: {
      status,
      basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
      electricalTruth: "NOT_VERIFIED",
      explicitNets: netNames.map((netName, index) => ({
        netName,
        wireIds: [`wire-${index}`],
        segmentIds: [`segment-${index}`]
      })),
      unlabeledWireIds: options.unlabeledWireIds ?? []
    },
    provenance: {
      component: {
        documentId: "page-a",
        documentType: "SCH_PAGE",
        recordType: "COMPONENT",
        recordId: `component-${id}`,
        ticket: 1,
        client: "client-a",
        entry: "fixture.epru",
        line: 1
      },
      symbol: {
        documentId: "symbol-a",
        documentType: "SYMBOL",
        recordType: "META",
        ticket: 1,
        client: "client-a",
        entry: "fixture.epru",
        line: 2
      },
      symbolPin: {
        documentId: "symbol-a",
        documentType: "SYMBOL",
        recordType: "PIN",
        recordId: `symbol-pin-${id}`,
        ticket: 1,
        client: "client-a",
        entry: "fixture.epru",
        line: 2
      }
    }
  };
}

function shortRelation(
  id: string,
  firstNet: string,
  secondNet: string
): IrShortRelationCandidate {
  const source = pin(`short-${id}`).provenance;
  const firstPin = pin(`short-${id}-1`, { netNames: [firstNet] });
  const secondPin = pin(`short-${id}-2`, { netNames: [secondNet] });
  return {
    id,
    pageId: "page-a",
    componentId: `short-${id}`,
    symbolId: "short-symbol",
    partId: "part-a",
    status: "READY_EXPLICIT_NET_PAIR_CANDIDATE",
    basis: "SHORT_SYMBOL_TYPE_AND_TRANSFORMED_PIN_CONTACTS",
    electricalTruth: "NOT_VERIFIED",
    explicitNetNames: [firstNet, secondNet],
    pins: [
      {
        pinInstanceId: firstPin.id,
        symbolPinId: firstPin.symbolPinId,
        number: "1",
        connectionCandidate: firstPin.connectionCandidate
      },
      {
        pinInstanceId: secondPin.id,
        symbolPinId: secondPin.symbolPinId,
        number: "2",
        connectionCandidate: secondPin.connectionCandidate
      }
    ],
    provenance: {
      component: source.component,
      symbol: source.symbol
    }
  };
}

function netFlagEndpoint(
  id: string,
  netName: string
): IrNetworkEndpointCandidate {
  const source = pin(`flag-${id}`).provenance;
  return {
    id,
    pageId: "page-a",
    componentId: `flag-${id}`,
    symbolId: "flag-symbol",
    partId: "part-a",
    endpointKind: "NET_FLAG",
    status: "DECLARATION_MATCHES_CONNECTION_CANDIDATE",
    basis: "SYMBOL_TYPE_ATTRIBUTES_AND_TRANSFORMED_PIN_CONTACTS",
    electricalTruth: "NOT_VERIFIED",
    declaredNetNameCandidate: netName,
    connectionNetNameCandidate: netName,
    pinInstanceIds: [],
    declarationEvidence: [],
    provenance: {
      component: source.component,
      symbol: source.symbol
    }
  };
}

function schematicPage(
  id: string,
  schematicId: string,
  creationTicket: number
): IrSchematicPage {
  return {
    id,
    schematicId,
    creationTicket,
    attributes: [],
    provenance: {
      documentId: id,
      documentType: "SCH_PAGE",
      recordType: "META",
      recordId: "META",
      ticket: creationTicket + 100,
      client: "client-a",
      entry: "fixture.epru",
      line: 1
    },
    extensions: { easyeda: {} }
  };
}

test("只把具备位号、引脚编号和唯一显式网络的实例编译为规范元组", () => {
  const inconsistent = pin("6", { netNames: ["A", "B"] });
  const result = compileCandidateNetlistTuples([
    pin("1"),
    pin("2", { designator: "" }),
    pin("8", { designator: "", endpointKind: "NET_FLAG_PIN" }),
    pin("3", { number: "" }),
    pin("4", {
      status: "CONFLICTING_EXPLICIT_NET_CANDIDATES",
      netNames: ["A", "B"]
    }),
    pin("5", {
      status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
      netNames: []
    }),
    inconsistent,
    pin("7", { status: "UNRESOLVED_NO_WIRE", netNames: [] }),
    pin("9", { status: "DECLARED_NO_CONNECT", netNames: [] })
  ]);

  assert.deepEqual(result.tuples, [
    {
      tuple: {
        componentRef: "U1",
        pinNumber: "1",
        netName: "NET-A"
      },
      evidence: {
        pinInstanceId: "1",
        pageId: "page-a",
        componentId: "component-1",
        symbolPinId: "symbol-pin-1",
        wireIds: ["wire-0"],
        segmentIds: ["segment-0"]
      }
    }
  ]);
  assert.deepEqual(result.summary, {
    pinInstances: 9,
    eligibleTuples: 1,
    excludedPinInstances: 8,
    missingComponentRef: 1,
    nonComponentEndpoint: 1,
    missingPinNumber: 1,
    conflictingExplicitNetCandidates: 1,
    unresolvedWireWithoutExplicitNet: 1,
    declaredNoConnect: 1,
    unresolvedNoWire: 1,
    inconsistentCandidateState: 1
  });
});

test("Short Symbol 分量按 NetFlag 数量优先并以字节序打破平局", () => {
  const result = compileResolvedCandidateNetlistTuples(
    [
      pin("1", { netNames: ["LOCAL_A"] }),
      pin("2", { netNames: ["GLOBAL"] }),
      pin("3", { netNames: ["LOCAL_B"] }),
      pin("4", { netNames: ["UNCHANGED"] })
    ],
    [
      shortRelation("short-a", "LOCAL_A", "GLOBAL"),
      shortRelation("short-b", "GLOBAL", "LOCAL_B")
    ],
    [
      netFlagEndpoint("global-1", "GLOBAL"),
      netFlagEndpoint("global-2", "GLOBAL"),
      netFlagEndpoint("local", "LOCAL_A")
    ],
    []
  );

  assert.deepEqual(
    result.tuples.map((candidate) => candidate.tuple.netName),
    ["GLOBAL", "GLOBAL", "GLOBAL", "UNCHANGED"]
  );
  assert.deepEqual(result.tuples[0]?.evidence.networkResolution, {
    basis:
      "SHORT_SYMBOL_RELATIONS_NET_FLAG_COUNT_EXPLICIT_THEN_BYTEWISE_NAME",
    originalNetName: "LOCAL_A",
    canonicalNetName: "GLOBAL",
    aliases: [
      { netName: "GLOBAL", netFlagEndpointCount: 2, automatic: false },
      { netName: "LOCAL_A", netFlagEndpointCount: 1, automatic: false },
      { netName: "LOCAL_B", netFlagEndpointCount: 0, automatic: false }
    ],
    shortRelationIds: ["short-a", "short-b"]
  });
  assert.equal(
    result.tuples[3]?.evidence.networkResolution,
    undefined
  );

  const lexical = compileResolvedCandidateNetlistTuples(
    [pin("5", { netNames: ["Z_NET"] })],
    [shortRelation("short-c", "Z_NET", "A_NET")],
    [],
    []
  );
  assert.equal(lexical.tuples[0]?.tuple.netName, "A_NET");
});

test("无标签导线仅在完整唯一的页面创建序和 e 数字 ID 下生成自动网名", () => {
  const result = compileResolvedCandidateNetlistTuples(
    [
      pin("1", {
        pageId: "page-later",
        status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
        netNames: [],
        unlabeledWireIds: ["e1484"]
      }),
      pin("2", {
        pageId: "page-earlier",
        status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
        netNames: [],
        unlabeledWireIds: ["e7"]
      }),
      pin("3", {
        pageId: "page-later",
        status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
        netNames: [],
        endpointKind: "NET_FLAG_PIN",
        unlabeledWireIds: ["e9"]
      })
    ],
    [],
    [],
    [
      schematicPage("page-later", "schematic-a", 200),
      schematicPage("page-earlier", "schematic-a", 100)
    ]
  );
  assert.deepEqual(
    result.tuples.map((candidate) => candidate.tuple),
    [
      { componentRef: "U1", pinNumber: "1", netName: "$2N1484" },
      { componentRef: "U2", pinNumber: "2", netName: "$1N7" }
    ]
  );
  assert.deepEqual(
    result.tuples[0]?.evidence.automaticNetResolution,
    {
      basis: "UNLABELED_WIRE_PAGE_CREATION_RANK_AND_WIRE_ID",
      pageCreationTicket: 200,
      pageCreationRank: 2,
      wireId: "e1484",
      generatedNetName: "$2N1484"
    }
  );
  assert.equal(result.summary.eligibleTuples, 2);
  assert.equal(result.summary.unresolvedWireWithoutExplicitNet, 1);
});

test("Short Symbol 在显式网与自动网之间优先保留显式名称", () => {
  const baseRelation = shortRelation(
    "short-auto",
    "EXPLICIT_NET",
    "placeholder"
  );
  const unresolvedPin = pin("short-auto-unlabeled", {
    pageId: "page-later",
    status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
    netNames: [],
    unlabeledWireIds: ["e72082"]
  });
  const relation: IrShortRelationCandidate = {
    ...baseRelation,
    pageId: "page-later",
    status: "UNRESOLVED_PIN_CONNECTION_CANDIDATE",
    explicitNetNames: ["EXPLICIT_NET"],
    pins: [
      baseRelation.pins[0] as IrShortRelationCandidate["pins"][number],
      {
        pinInstanceId: unresolvedPin.id,
        symbolPinId: unresolvedPin.symbolPinId,
        number: "1",
        connectionCandidate: unresolvedPin.connectionCandidate
      }
    ]
  };
  const result = compileResolvedCandidateNetlistTuples(
    [
      pin("1", {
        pageId: "page-later",
        status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
        netNames: [],
        unlabeledWireIds: ["e72082"]
      })
    ],
    [relation],
    [],
    [
      schematicPage("page-earlier", "schematic-a", 100),
      schematicPage("page-later", "schematic-a", 200)
    ]
  );
  assert.equal(result.tuples[0]?.tuple.netName, "EXPLICIT_NET");
  assert.equal(
    result.tuples[0]?.evidence.networkResolution?.originalNetName,
    "$2N72082"
  );
});

test("缺少 creationTicket 的单页原理图仍可确定自动网名页号为 1", () => {
  const pageWithCreationTicket = schematicPage(
    "page-sort-order",
    "schematic-a",
    100
  );
  const {
    creationTicket: _omittedCreationTicket,
    ...pageWithoutCreationTicket
  } = pageWithCreationTicket;
  const result = compileResolvedCandidateNetlistTuples(
    [
      pin("1", {
        pageId: "page-sort-order",
        status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
        netNames: [],
        unlabeledWireIds: ["e8040"]
      })
    ],
    [],
    [],
    [
      {
        ...pageWithoutCreationTicket,
        sortOrder: 7
      }
    ]
  );

  assert.deepEqual(result.tuples[0]?.tuple, {
    componentRef: "U1",
    pinNumber: "1",
    netName: "$1N8040"
  });
  assert.deepEqual(
    result.tuples[0]?.evidence.automaticNetResolution,
    {
      basis: "UNLABELED_WIRE_SINGLE_PAGE_AND_WIRE_ID",
      pageNumber: 1,
      wireId: "e8040",
      generatedNetName: "$1N8040"
    }
  );
});

test("差异报告同时给出官方网表缺失项和候选多余项", () => {
  const candidate: NetlistTuple[] = [
    { componentRef: "U1", pinNumber: "1", netName: "GND" },
    { componentRef: "U1", pinNumber: "2", netName: "VCC" }
  ];
  const truth: NetlistTuple[] = [
    { componentRef: "U1", pinNumber: "1", netName: "GND" },
    { componentRef: "U1", pinNumber: "2", netName: "3V3" }
  ];

  const result = compareNetlistTupleSets(candidate, truth);
  assert.equal(result.status, "DIFFERENCES_FOUND");
  assert.equal(result.exactSetMatch, false);
  assert.deepEqual(result.matched, [
    { componentRef: "U1", pinNumber: "1", netName: "GND" }
  ]);
  assert.deepEqual(result.missingInCandidate, [
    { componentRef: "U1", pinNumber: "2", netName: "3V3" }
  ]);
  assert.deepEqual(result.unexpectedCandidate, [
    { componentRef: "U1", pinNumber: "2", netName: "VCC" }
  ]);
});

test("完全一致的无重复集合才通过精确集合门禁", () => {
  const tuples: NetlistTuple[] = [
    { componentRef: "R1", pinNumber: "1", netName: "A" },
    { componentRef: "R1", pinNumber: "2", netName: "B" }
  ];
  const exact = compareNetlistTupleSets([...tuples].reverse(), tuples);
  assert.equal(exact.status, "EXACT_SET_MATCH");
  assert.equal(exact.exactSetMatch, true);

  const duplicate = compareNetlistTupleSets(
    [tuples[0]!, tuples[0]!, tuples[1]!],
    tuples
  );
  assert.equal(duplicate.status, "DUPLICATE_TUPLES");
  assert.equal(duplicate.exactSetMatch, false);
  assert.deepEqual(duplicate.candidateDuplicates, [
    { tuple: tuples[0], occurrences: 2 }
  ]);
});
