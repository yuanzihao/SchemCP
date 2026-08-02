import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { MCP_TOOL_NAMES } from "../../src/mcp/contract.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

function record(
  outer: Readonly<Record<string, unknown>>,
  inner: Readonly<Record<string, unknown>>
): string {
  return `${JSON.stringify(outer)}||${JSON.stringify(inner)}|`;
}

const EPRU = [
  record(
    { type: "DOCHEAD", ticket: 0 },
    { docType: "SCH", client: "client-a", uuid: "schematic-a" }
  ),
  record({ type: "META", ticket: 1 }, { name: "Fixture Schematic" }),
  record(
    { type: "DOCHEAD", ticket: 1 },
    { docType: "SCH_PAGE", client: "client-a", uuid: "page-a" }
  ),
  record(
    { type: "META", ticket: 2 },
    { title: "Main", schematic: "schematic-a" }
  ),
  record(
    { type: "COMPONENT", id: "component-a", ticket: 3 },
    {
      partId: "part-a",
      x: 10,
      y: 20,
      rotation: 0,
      isMirror: false
    }
  ),
  record(
    { type: "ATTR", id: "attr-designator", ticket: 4 },
    { parentId: "component-a", key: "Designator", value: "U1" }
  ),
  record(
    { type: "ATTR", id: "attr-symbol", ticket: 5 },
    { parentId: "component-a", key: "Symbol", value: "symbol-a" }
  ),
  record(
    { type: "ATTR", id: "attr-supplier-part", ticket: 5 },
    { parentId: "component-a", key: "Supplier Part", value: "C123456" }
  ),
  record(
    { type: "ATTR", id: "attr-manufacturer", ticket: 5 },
    { parentId: "component-a", key: "Manufacturer", value: "Acme" }
  ),
  record(
    { type: "ATTR", id: "attr-mpn", ticket: 5 },
    {
      parentId: "component-a",
      key: "Manufacturer Part",
      value: "MCU-123"
    }
  ),
  record(
    { type: "ATTR", id: "attr-datasheet", ticket: 5 },
    {
      parentId: "component-a",
      key: "Datasheet",
      value: "https://example.com/MCU-123.pdf"
    }
  ),
  record(
    { type: "ATTR", id: "attr-frequency", ticket: 5 },
    { parentId: "component-a", key: "Frequency", value: "168MHz" }
  ),
  record(
    { type: "ATTR", id: "attr-add-into-bom", ticket: 5 },
    { parentId: "component-a", key: "Add into BOM", value: "yes" }
  ),
  record({ type: "WIRE", id: "wire-a", ticket: 6 }, { locked: false }),
  record(
    { type: "ATTR", id: "attr-net", ticket: 7 },
    { parentId: "wire-a", key: "NET", value: "VCC" }
  ),
  record(
    { type: "LINE", id: "line-a", ticket: 8 },
    {
      lineGroup: "wire-a",
      startX: 10,
      startY: 20,
      endX: 20,
      endY: 20
    }
  ),
  record(
    { type: "TEXT", id: "annotation-a", ticket: 9 },
    {
      x: 30,
      y: 40,
      rotation: 0,
      value: "Power input notes",
      align: "LEFT_BOTTOM"
    }
  ),
  record(
    { type: "TABLE", id: "table-a", ticket: 9 },
    {
      startX: 50,
      startY: 60,
      rowSizes: [10],
      colSizes: [20, 20],
      rowLocked: [0],
      colLocked: [0, 0],
      rotation: 0,
      tableCell: [
        {
          id: "table-cell-a",
          value: "BOOT0",
          rowIndex: 0,
          columnIndex: 0,
          rowSpan: 1,
          colSpan: 1
        },
        {
          id: "table-cell-b",
          value: "LOW",
          rowIndex: 0,
          columnIndex: 1,
          rowSpan: 1,
          colSpan: 1
        }
      ]
    }
  ),
  record(
    { type: "POLY", id: "page-poly-a", ticket: 9 },
    {
      groupId: "",
      locked: false,
      zIndex: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ],
      closed: false,
      strokeColor: null,
      strokeStyle: "SOLID",
      fillColor: null,
      strokeWidth: null,
      fillStyle: null
    }
  ),
  record(
    { type: "BUS", id: "bus-a", ticket: 9 },
    {
      groupId: "",
      locked: false,
      zIndex: 2,
      busEntry: {
        "bus-entry-b": {
          order: 1,
          pointX: 40,
          pointY: 50,
          rotation: 0
        },
        "bus-entry-a": {
          order: 0,
          pointX: 30,
          pointY: 50,
          rotation: 0
        }
      }
    }
  ),
  record(
    { type: "ATTR", id: "attr-bus-net", ticket: 9 },
    { parentId: "bus-a", key: "NET", value: "DATA[1:0]" }
  ),
  record(
    { type: "DOCHEAD", ticket: 10 },
    { docType: "SYMBOL", client: "client-a", uuid: "symbol-a" }
  ),
  record({ type: "META", ticket: 11 }, { title: "MCU" }),
  record({ type: "PART", id: "part-a", ticket: 12 }, { title: "A" }),
  record(
    { type: "TEXT", id: "symbol-text-a", ticket: 13 },
    {
      partId: "part-a",
      x: 5,
      y: 6,
      rotation: 0,
      value: "UART_TX"
    }
  ),
  record(
    { type: "CIRCLE", id: "symbol-circle-a", ticket: 13 },
    {
      partId: "part-a",
      groupId: "",
      locked: false,
      zIndex: 1,
      centerX: 5,
      centerY: 6,
      radius: 2,
      strokeColor: null,
      strokeStyle: null,
      fillColor: null,
      strokeWidth: null,
      fillStyle: null
    }
  ),
  record(
    { type: "PIN", id: "pin-a", ticket: 13 },
    {
      partId: "part-a",
      x: 0,
      y: 0,
      length: 20,
      rotation: 0,
      display: true
    }
  ),
  record(
    { type: "ATTR", id: "attr-pin-number", ticket: 14 },
    { parentId: "pin-a", key: "Pin Number", value: "1" }
  ),
  record(
    { type: "ATTR", id: "attr-pin-name", ticket: 14 },
    { parentId: "pin-a", key: "Pin Name", value: "USB_DP" }
  ),
  record(
    { type: "DOCHEAD" },
    { docType: "VARIANT", client: "client-a", uuid: "variant-a" }
  ),
  record(
    { type: "META", ticket: 15 },
    {
      title: "Production",
      description: "Fixture",
      zIndex: 1,
      notGrouped: false
    }
  ),
  record(
    { type: "DOCHEAD" },
    {
      docType: "COMPONENT_GROUP",
      client: "client-a",
      uuid: "group-a"
    }
  ),
  record(
    { type: "META", ticket: 16 },
    {
      title: "DNP",
      parent: "",
      belong: "variant-a",
      zIndex: 1,
      schematicId: ""
    }
  ),
  record(
    {
      type: "GROUP_DATA",
      id: "component-a@schematic-a_$page-a",
      ticket: 17
    },
    { DNP: "yes" }
  ),
  record(
    { type: "DOCHEAD", ticket: 18 },
    {
      docType: "INSTANCE",
      client: "client-a",
      uuid: "schematic-a_$page-a"
    }
  ),
  record(
    { type: "INSTANCE_ATTR", id: "component-a", ticket: 19 },
    { Value: "fixture" }
  ),
  record(
    { type: "DOCHEAD" },
    { docType: "FOOTPRINT", client: "client-a", uuid: "footprint-a" }
  ),
  record({ type: "META", ticket: 20 }, { title: "Fixture Footprint" }),
  record(
    {
      type: "NET",
      id: JSON.stringify(["NET", "LOCAL"]),
      ticket: 20
    },
    {
      netType: null,
      specialColor: null,
      retLine: false,
      differentialName: null,
      isPositiveNet: false,
      equalLengthGroupName: null
    }
  ),
  record(
    {
      type: "LAYER",
      id: JSON.stringify(["LAYER", 11]),
      ticket: 20
    },
    {
      layerId: 11,
      layerType: "OUTLINE",
      layerName: "Footprint Outline",
      use: true,
      show: true,
      locked: false
    }
  ),
  record(
    {
      type: "LAYER_PHYS",
      id: JSON.stringify(["LAYER_PHYS", 11]),
      ticket: 20
    },
    {
      material: null,
      thickness: 10,
      permittivity: null,
      lossTangent: null,
      isKeepIsland: true,
      zIndex: 1
    }
  ),
  record(
    { type: "PAD", id: "pad-a", ticket: 21 },
    { centerX: 0, centerY: 0, layerId: 12, num: "1" }
  ),
  record(
    { type: "FILL", id: "footprint-fill-a", ticket: 21 },
    {
      layerId: 11,
      netName: "",
      width: 1,
      fillStyle: "SOLID",
      path: [["R", 0, 0, 10, 10, 0, 0]]
    }
  ),
  record(
    {
      type: "PRIMITIVE",
      id: JSON.stringify(["PRIMITIVE", "PAD"]),
      ticket: 21
    },
    { display: true, pick: false }
  ),
  record(
    { type: "STRING", id: "footprint-text-a", ticket: 21 },
    {
      layerId: 3,
      positionX: 10,
      positionY: 20,
      text: "REF**",
      angle: 0
    }
  ),
  record(
    { type: "DOCHEAD" },
    { docType: "PCB", client: "client-a", uuid: "pcb-a" }
  ),
  record({ type: "META", ticket: 22 }, { title: "Fixture PCB" }),
  record(
    { type: "NET", id: "USB_P", ticket: 22 },
    {
      netType: "High Speed",
      specialColor: "#666666",
      hideRetLine: 1,
      differentialName: "USB",
      isPositiveNet: 1,
      equalLengthGroupName: "USB_GROUP"
    }
  ),
  record(
    { type: "PRIMITIVE", id: "VIA", ticket: 22 },
    { display: 1, pick: 0 }
  ),
  record(
    { type: "STRING", id: "pcb-text-a", ticket: 22 },
    {
      layerId: 71,
      x: 110,
      y: 220,
      text: "CAUTION",
      angle: 90
    }
  ),
  record(
    { type: "COMPONENT", id: "pcb-component-a", ticket: 23 },
    { x: 100, y: 200, angle: 90, layerId: 1 }
  ),
  record(
    { type: "ATTR", id: "pcb-attr-designator", ticket: 24 },
    {
      parentId: "pcb-component-a",
      key: "Designator",
      value: "U1"
    }
  ),
  record(
    { type: "ATTR", id: "pcb-attr-footprint", ticket: 25 },
    {
      parentId: "pcb-component-a",
      key: "Footprint",
      value: "footprint-a"
    }
  ),
  record(
    {
      type: "PAD_NET",
      id: JSON.stringify(["PAD_NET", "pcb-component-a", "1", "pad-a"]),
      ticket: 26
    },
    { padNet: "VCC", padLen: 10, partitionId: null }
  ),
  record(
    { type: "LINE", id: "pcb-track-a", ticket: 27 },
    {
      partitionId: null,
      groupId: null,
      locked: 0,
      zIndex: 1,
      netName: "VCC",
      layerId: 1,
      startX: 100,
      startY: 200,
      endX: 300,
      endY: 200,
      width: 8
    }
  ),
  record(
    { type: "VIA", id: "pcb-via-a", ticket: 28 },
    {
      partitionId: null,
      groupId: null,
      locked: 0,
      zIndex: 2,
      netName: "VCC",
      ruleName: "Default",
      centerX: 300,
      centerY: 200,
      holeDiameter: 12,
      viaDiameter: 24,
      viaType: "SUTURE",
      topSolderExpansion: 0,
      bottomSolderExpansion: 0,
      unusedInnerLayers: []
    }
  ),
  record(
    { type: "TEARDROP", id: "pcb-teardrop-a", ticket: 29 },
    {
      partitionId: "",
      netName: "VCC",
      layerId: 11,
      path: ["L", 100, 200, 120, 200, 100, 200],
      groupId: 0,
      refs: [
        "pcb-track-a",
        "pcb-via-a",
        "pcb-component-apad-a"
      ]
    }
  ),
  record(
    {
      type: "LAYER",
      id: JSON.stringify(["LAYER", 11]),
      ticket: 30
    },
    {
      layerId: 11,
      layerType: "OUTLINE",
      layerName: "Board Outline",
      use: true,
      show: true,
      locked: false
    }
  ),
  record(
    {
      type: "LAYER_PHYS",
      id: JSON.stringify(["LAYER_PHYS", 11]),
      ticket: 30
    },
    {
      material: "COPPER",
      thickness: 1,
      permittivity: 0,
      lossTangent: 0,
      isKeepIsland: 0,
      zIndex: 1
    }
  ),
  record(
    { type: "RULE", id: "pcb-rule-clearance", ticket: 30 },
    {
      ruleType: "CLEARANCE",
      ruleName: "Default",
      ruleState: 0,
      ruleContext: { min: 6 }
    }
  ),
  record(
    { type: "RULE_SELECTOR", id: "pcb-rule-selector-vcc", ticket: 30 },
    {
      ruleSelect: ["NET", "VCC"],
      ruleOrder: 1,
      ruleKeyValue: { CLEARANCE: "Default" }
    }
  ),
  record(
    { type: "RULE_TEMPLATE", ticket: 30 },
    { name: "Board Default" }
  ),
  record(
    { type: "POLY", id: "pcb-outline-a", ticket: 31 },
    {
      partitionId: null,
      groupId: 0,
      locked: false,
      zIndex: 3,
      netName: "",
      layerId: 11,
      width: 0.5,
      path: ["R", 0, 0, 100, 50, 0, 0],
      polyType: "SOLID"
    }
  )
].join("\n");

async function writeProjectFixture(epru = EPRU): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-mcp-test-"));
  const projectPath = path.join(directory, "fixture.epro2");
  await writeFile(
    projectPath,
    createStoredZip([{ name: "fixture.epru", data: epru }])
  );
  return projectPath;
}

function assemblyProjectEpru(
  suffix: string,
  designators: readonly string[]
): string {
  return [
    EPRU,
    record(
      { type: "DOCHEAD", ticket: 200 },
      {
        docType: "SCH_PAGE",
        client: `client-${suffix}`,
        uuid: `assembly-page-${suffix}`
      }
    ),
    record(
      { type: "META", ticket: 201 },
      { title: `Assembly ${suffix}`, schematic: "schematic-a" }
    ),
    ...designators.flatMap((designator, index) => {
      const componentId = `assembly-component-${suffix}-${index}`;
      return [
        record(
          {
            type: "COMPONENT",
            id: componentId,
            ticket: 202 + index * 3
          },
          {
            partId: "part-a",
            x: 100 + index * 20,
            y: 100,
            rotation: 0,
            isMirror: false
          }
        ),
        record(
          {
            type: "ATTR",
            id: `assembly-designator-${suffix}-${index}`,
            ticket: 203 + index * 3
          },
          {
            parentId: componentId,
            key: "Designator",
            value: designator
          }
        ),
        record(
          {
            type: "ATTR",
            id: `assembly-symbol-${suffix}-${index}`,
            ticket: 204 + index * 3
          },
          {
            parentId: componentId,
            key: "Symbol",
            value: "symbol-a"
          }
        )
      ];
    })
  ].join("\n");
}

async function writeNetlistFixture(
  directory: string,
  fileName: string,
  components: Readonly<Record<string, unknown>>
): Promise<string> {
  const netlistPath = path.join(directory, fileName);
  await writeFile(
    netlistPath,
    JSON.stringify({
      version: "2.0.0",
      components,
      designRule: {},
      netClass: {},
      equalLengthNetGroup: {},
      differentialPair: {}
    }),
    { mode: 0o600 }
  );
  return netlistPath;
}

const SECOND_SCHEMATIC = [
  record(
    { type: "DOCHEAD", ticket: 100 },
    {
      docType: "SCH",
      client: "client-secondary",
      uuid: "schematic-secondary"
    }
  ),
  record(
    { type: "META", ticket: 101 },
    { name: "Fixture Secondary Schematic" }
  ),
  record(
    { type: "DOCHEAD", ticket: 102 },
    {
      docType: "SCH_PAGE",
      client: "client-secondary",
      uuid: "page-secondary"
    }
  ),
  record(
    { type: "META", ticket: 103 },
    { title: "Secondary", schematic: "schematic-secondary" }
  ),
  record(
    { type: "COMPONENT", id: "component-secondary", ticket: 104 },
    {
      partId: "part-a",
      x: 40,
      y: 50,
      rotation: 0,
      isMirror: false
    }
  ),
  record(
    { type: "ATTR", id: "attr-designator-secondary", ticket: 105 },
    {
      parentId: "component-secondary",
      key: "Designator",
      value: "U2"
    }
  ),
  record(
    { type: "ATTR", id: "attr-symbol-secondary", ticket: 106 },
    {
      parentId: "component-secondary",
      key: "Symbol",
      value: "symbol-a"
    }
  )
].join("\n");

test("MCP 默认通过 stdio 使用原理图档并隐藏全部 PCB 工具", async () => {
  const projectPath = await writeProjectFixture();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/mcp/main.js", "--project", projectPath],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-schematic-profile-test",
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
    for (const tool of tools.tools) {
      assert.equal(tool.outputSchema?.type, "object");
      assert.equal(
        (
          tool.outputSchema?.properties?.ok as
            | { readonly type?: unknown }
            | undefined
        )?.type,
        "boolean"
      );
      assert.ok(tool.outputSchema?.required?.includes("ok"));
    }
    await assert.rejects(client.listPrompts(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { readonly code?: number }).code, -32601);
      return true;
    });
  } finally {
    await client.close();
  }
});

function structured(result: unknown): Record<string, unknown> {
  assert.ok(typeof result === "object" && result !== null);
  const content = (result as { readonly structuredContent?: unknown })
    .structuredContent;
  assert.ok(typeof content === "object" && content !== null);
  return content as Record<string, unknown>;
}

test("MCP 无工程启动后可直接打开对话附件并安全关闭", async () => {
  const projectPath = await writeProjectFixture();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/mcp/main.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-runtime-open-test",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      [...MCP_TOOL_NAMES]
    );

    const initial = structured(
      await client.callTool({
        name: "get_project_summary",
        arguments: {}
      })
    );
    assert.equal(
      (initial.project as { readonly binding: string }).binding,
      "NOT_BOUND"
    );
    assert.equal(
      (
        initial.platformSecurity as {
          readonly privatePermissionCapability: string;
        }
      ).privatePermissionCapability,
      process.platform === "win32"
        ? "WINDOWS_ACL_NOT_VERIFIED"
        : "POSIX_MODE_ENFORCED"
    );

    const unavailable = structured(
      await client.callTool({
        name: "list_components",
        arguments: {}
      })
    );
    assert.equal(unavailable.ok, false);
    assert.equal(
      (unavailable.error as { readonly code: string }).code,
      "MCP_PROJECT_NOT_OPEN"
    );

    const opened = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: { projectPath }
      })
    );
    const openedProject = opened.project as {
      readonly binding: string;
      readonly projectHandle: string;
    };
    assert.equal(openedProject.binding, "RUNTIME_PROJECT_BOUND");
    assert.match(openedProject.projectHandle, /^schematic_[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(opened).includes(projectPath), false);

    const failedSwitch = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: {
          projectPath: "/private/does-not-exist/invalid.epro2"
        }
      })
    );
    assert.equal(failedSwitch.ok, false);
    assert.equal(
      (failedSwitch.error as { readonly code: string }).code,
      "INPUT_NOT_FOUND"
    );
    const stillActive = structured(
      await client.callTool({
        name: "get_active_schematic_project",
        arguments: {}
      })
    );
    assert.equal(
      (
        stillActive.project as {
          readonly projectHandle: string;
        }
      ).projectHandle,
      openedProject.projectHandle
    );

    const summary = structured(
      await client.callTool({
        name: "get_project_summary",
        arguments: {}
      })
    );
    assert.equal(
      (
        summary.project as {
          readonly summary: { readonly components: number };
        }
      ).summary.components,
      1
    );

    const buses = structured(
      await client.callTool({
        name: "list_buses",
        arguments: { view: "BUSES", netNameContains: "data" }
      })
    );
    const busItems = (
      buses.page as {
        readonly items: readonly {
          readonly id: string;
          readonly explicitNetName: string;
          readonly entryCount: number;
          readonly memberExpansion: string;
        }[];
      }
    ).items;
    assert.equal(busItems.length, 1);
    assert.equal(busItems[0]?.explicitNetName, "DATA[1:0]");
    assert.equal(busItems[0]?.entryCount, 2);
    assert.equal(busItems[0]?.memberExpansion, "NOT_PERFORMED");
    const busEntries = structured(
      await client.callTool({
        name: "list_buses",
        arguments: {
          view: "ENTRIES",
          busId: busItems[0]?.id,
          limit: 2
        }
      })
    );
    assert.deepEqual(
      (
        busEntries.page as {
          readonly items: readonly {
            readonly id: string;
            readonly order: number;
          }[];
        }
      ).items.map((entry) => [entry.id, entry.order]),
      [
        ["bus-entry-a", 0],
        ["bus-entry-b", 1]
      ]
    );

    const interfaces = structured(
      await client.callTool({
        name: "list_interfaces",
        arguments: { type: "USB", status: "PARTIAL_CANDIDATE" }
      })
    );
    assert.equal(
      interfaces.semanticRuleSetVersion,
      "schemcp.semantic-rules/1"
    );
    const interfaceItems = (
      interfaces.page as {
        readonly items: readonly {
          readonly type: string;
          readonly activityStatus: string;
          readonly missingSignals: readonly string[];
        }[];
      }
    ).items;
    assert.equal(interfaceItems.length, 1);
    assert.equal(interfaceItems[0]?.type, "USB");
    assert.equal(interfaceItems[0]?.activityStatus, "ACTIVE");
    assert.deepEqual(interfaceItems[0]?.missingSignals, ["DM"]);

    const powerTree = structured(
      await client.callTool({
        name: "get_power_tree",
        arguments: { maxDepth: 8, limit: 50 }
      })
    );
    assert.equal(powerTree.resourceType, "POWER");
    assert.equal(powerTree.semanticRuleSetVersion, "schemcp.semantic-rules/1");
    assert.equal(
      (powerTree.edges as { readonly total: number }).total > 0,
      true
    );
    assert.equal(powerTree.electricalTruth, "NOT_VERIFIED");

    const clockTree = structured(
      await client.callTool({
        name: "get_clock_tree",
        arguments: { maxDepth: 8, limit: 50 }
      })
    );
    assert.equal(clockTree.resourceType, "CLOCK");
    assert.equal((clockTree.edges as { readonly total: number }).total, 0);

    const resetBootPaths = structured(
      await client.callTool({
        name: "get_reset_boot_paths",
        arguments: { maxDepth: 8, limit: 50 }
      })
    );
    assert.equal(resetBootPaths.resourceType, "RESET_BOOT");
    assert.equal(
      (resetBootPaths.edges as { readonly total: number }).total,
      0
    );

    const mcuPinUsage = structured(
      await client.callTool({
        name: "get_mcu_pin_usage",
        arguments: { designator: "U1", limit: 50 }
      })
    );
    assert.equal(mcuPinUsage.mcuCount, 1);
    assert.equal(mcuPinUsage.netlistBinding, "NOT_BOUND");
    const mcuPins = mcuPinUsage.pins as {
      readonly total: number;
      readonly items: readonly {
        readonly usageStatus: string;
        readonly truthStatus: string;
      }[];
    };
    assert.equal(mcuPins.total, 1);
    assert.equal(mcuPins.items[0]?.usageStatus, "USED_CANDIDATE");
    assert.equal(mcuPins.items[0]?.truthStatus, "CANDIDATE");

    const contexts = structured(
      await client.callTool({
        name: "list_instance_contexts",
        arguments: {}
      })
    );
    const contextItems = (
      contexts.page as {
        readonly items: readonly {
          readonly id: string;
          readonly resolutionStatus: string;
          readonly occurrenceCount: number;
        }[];
      }
    ).items;
    assert.equal(contextItems.length, 1);
    assert.equal(contextItems[0]?.resolutionStatus, "RESOLVED_EXACT");
    assert.equal(contextItems[0]?.occurrenceCount, 1);
    const instanceContextId = contextItems[0]?.id;
    assert.ok(instanceContextId);

    const occurrenceComponents = structured(
      await client.callTool({
        name: "list_components",
        arguments: { instanceContextId }
      })
    );
    const occurrenceItems = (
      occurrenceComponents.page as {
        readonly items: readonly {
          readonly designator: string;
          readonly occurrence: { readonly instanceContextId: string };
        }[];
      }
    ).items;
    assert.equal(occurrenceItems.length, 1);
    assert.equal(occurrenceItems[0]?.designator, "U1");
    assert.equal(
      occurrenceItems[0]?.occurrence.instanceContextId,
      instanceContextId
    );

    const effectiveComponent = structured(
      await client.callTool({
        name: "get_component",
        arguments: { designator: "U1", instanceContextId }
      })
    );
    const effectiveLookup = effectiveComponent.lookup as {
      readonly status: string;
      readonly attributes: readonly {
        readonly key: string;
        readonly resolution: string;
      }[];
    };
    assert.equal(effectiveLookup.status, "FOUND");
    assert.equal(
      effectiveLookup.attributes.find((attribute) => attribute.key === "Value")
        ?.resolution,
      "INSTANCE_OVERRIDE"
    );

    const closed = structured(
      await client.callTool({
        name: "close_schematic_project",
        arguments: {}
      })
    );
    assert.equal(
      (closed.project as { readonly binding: string }).binding,
      "NOT_BOUND"
    );
  } finally {
    await client.close();
  }
});

test("MCP 可为运行时工程原子附加和解除独立 .enet", async () => {
  const projectPath = await writeProjectFixture();
  const netlistPath = path.join(path.dirname(projectPath), "runtime.enet");
  await writeFile(
    netlistPath,
    JSON.stringify({
      version: "2.0.0",
      components: {
        componentA: {
          props: {
            Designator: "U1",
            Manufacturer: "Acme"
          },
          pinInfoMap: {
            pinA: {
              name: "POWER",
              number: "1",
              net: "VCC",
              props: { "Pin Number": "1" }
            }
          }
        },
        componentB: {
          props: {
            Designator: "R1",
            Value: "10k"
          },
          pinInfoMap: {
            pinA: {
              name: "1",
              number: "1",
              net: "VCC"
            },
            pinB: {
              name: "2",
              number: "2",
              net: ""
            }
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
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/mcp/main.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-runtime-enet-test",
    version: "1.0.0"
  });
  try {
    await client.connect(transport);
    const opened = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: { projectPath }
      })
    );
    const projectHandle = (
      opened.project as { readonly projectHandle: string }
    ).projectHandle;
    const attached = structured(
      await client.callTool({
        name: "attach_schematic_netlist",
        arguments: { projectHandle, netlistPath }
      })
    );
    assert.equal(attached.disposition, "ATTACHED_NEW");
    assert.equal(attached.projectBinding, "USER_ASSERTED_NOT_VERIFIED");
    assert.equal(JSON.stringify(attached).includes(netlistPath), false);

    const repeated = structured(
      await client.callTool({
        name: "attach_schematic_netlist",
        arguments: { projectHandle, netlistPath }
      })
    );
    assert.equal(repeated.disposition, "ALREADY_ATTACHED");

    const comparison = structured(
      await client.callTool({
        name: "get_netlist_comparison_summary",
        arguments: { projectHandle }
      })
    );
    assert.equal(comparison.binding, "USER_PROVIDED_NETLIST_BOUND");

    const connectivity = structured(
      await client.callTool({
        name: "get_component_pin_connectivity",
        arguments: {
          projectHandle,
          designator: "U1",
          limit: 10
        }
      })
    );
    const connectivityLookup = connectivity.lookup as {
      readonly status: string;
      readonly netlistBinding: string;
      readonly localDocumentReferenceCount: number;
      readonly pins: {
        readonly total: number;
        readonly items: readonly {
          readonly number: string;
          readonly boundNetlistName: string;
          readonly network: {
            readonly evidence: string;
            readonly netName: string;
          };
        }[];
      };
    };
    assert.equal(connectivityLookup.status, "FOUND");
    assert.equal(connectivityLookup.netlistBinding, "BOUND");
    assert.equal(connectivityLookup.pins.total, 1);
    assert.equal(connectivityLookup.pins.items[0]?.number, "1");
    assert.equal(
      connectivityLookup.pins.items[0]?.boundNetlistName,
      "POWER"
    );
    assert.equal(
      connectivityLookup.pins.items[0]?.network.evidence,
      "BOUND_NETLIST"
    );
    assert.equal(
      connectivityLookup.pins.items[0]?.network.netName,
      "VCC"
    );

    const direct = structured(
      await client.callTool({
        name: "list_direct_component_connections",
        arguments: {
          projectHandle,
          designator: "U1",
          pinNumber: "1",
          limit: 10
        }
      })
    );
    const directLookup = direct.lookup as {
      readonly status: string;
      readonly evidence: string;
      readonly connections: {
        readonly total: number;
        readonly items: readonly {
          readonly target: {
            readonly componentRef: string;
            readonly pinNumber: string;
          };
          readonly propagation: string;
        }[];
      };
    };
    assert.equal(directLookup.status, "FOUND");
    assert.equal(directLookup.evidence, "BOUND_NETLIST");
    assert.equal(directLookup.connections.total, 1);
    assert.equal(
      directLookup.connections.items[0]?.target.componentRef,
      "R1"
    );
    assert.equal(
      directLookup.connections.items[0]?.target.pinNumber,
      "1"
    );
    assert.equal(
      directLookup.connections.items[0]?.propagation,
      "DIRECT_SAME_NET_ONLY"
    );

    const detached = structured(
      await client.callTool({
        name: "detach_schematic_netlist",
        arguments: { projectHandle }
      })
    );
    assert.equal(detached.disposition, "DETACHED");
    assert.equal(
      (
        detached.project as {
          readonly netlistComparison: string;
        }
      ).netlistComparison,
      "NOT_BOUND"
    );
  } finally {
    await client.close();
  }
});

test("MCP 工作区可并存多个工程，并保留单工程内多个原理图层级", async () => {
  const firstProjectPath = await writeProjectFixture(
    `${EPRU}\n${SECOND_SCHEMATIC}`
  );
  const secondProjectPath = await writeProjectFixture(
    EPRU.replaceAll("-a", "-b")
      .replaceAll("U1", "U9")
      .replace("Fixture Schematic", "Another Fixture Schematic")
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/mcp/main.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-multi-project-test",
    version: "1.0.0"
  });

  try {
    await client.connect(transport);
    const toolList = await client.listTools();
    const componentTool = toolList.tools.find(
      (tool) => tool.name === "list_components"
    );
    assert.ok(componentTool);
    assert.ok(
      "projectHandle" in
        ((componentTool.inputSchema.properties ?? {}) as Record<
          string,
          unknown
        >)
    );

    const firstOpened = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: { projectPath: firstProjectPath }
      })
    );
    const firstHandle = (
      firstOpened.project as { readonly projectHandle: string }
    ).projectHandle;
    const duplicateOpened = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: { projectPath: firstProjectPath }
      })
    );
    assert.equal(duplicateOpened.disposition, "ALREADY_OPEN");
    assert.equal(
      (
        duplicateOpened.workspace as {
          readonly projectCount: number;
        }
      ).projectCount,
      1
    );

    const secondOpened = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: { projectPath: secondProjectPath }
      })
    );
    const secondHandle = (
      secondOpened.project as { readonly projectHandle: string }
    ).projectHandle;
    assert.notEqual(firstHandle, secondHandle);

    const workspace = structured(
      await client.callTool({
        name: "list_schematic_projects",
        arguments: { limit: 4 }
      })
    );
    const workspacePage = workspace.page as {
      readonly total: number;
      readonly items: readonly {
        readonly projectHandle: string;
        readonly active: boolean;
      }[];
    };
    assert.equal(workspacePage.total, 2);
    assert.deepEqual(
      new Set(workspacePage.items.map((item) => item.projectHandle)),
      new Set([firstHandle, secondHandle])
    );
    assert.equal(
      workspacePage.items.find(
        (item) => item.projectHandle === secondHandle
      )?.active,
      true
    );
    const cursorPage = structured(
      await client.callTool({
        name: "list_schematic_projects",
        arguments: { limit: 1 }
      })
    );
    const staleCursor = (
      cursorPage.page as { readonly nextCursor: string }
    ).nextCursor;
    assert.ok(staleCursor);

    const firstComponents = structured(
      await client.callTool({
        name: "list_components",
        arguments: { projectHandle: firstHandle, limit: 10 }
      })
    );
    const secondComponents = structured(
      await client.callTool({
        name: "list_components",
        arguments: { projectHandle: secondHandle, limit: 10 }
      })
    );
    assert.deepEqual(
      (
        firstComponents.page as {
          readonly items: readonly { readonly designator: string }[];
        }
      ).items.map((item) => item.designator),
      ["U1", "U2"]
    );
    assert.deepEqual(
      (
        secondComponents.page as {
          readonly items: readonly { readonly designator: string }[];
        }
      ).items.map((item) => item.designator),
      ["U9"]
    );

    const firstHierarchy = structured(
      await client.callTool({
        name: "list_design_hierarchy",
        arguments: {
          projectHandle: firstHandle,
          kind: "SCHEMATIC",
          limit: 10
        }
      })
    );
    assert.equal(
      (firstHierarchy.page as { readonly total: number }).total,
      2
    );

    const selected = structured(
      await client.callTool({
        name: "select_schematic_project",
        arguments: { projectHandle: firstHandle }
      })
    );
    assert.equal(
      (selected.project as { readonly active: boolean }).active,
      true
    );
    const activeSummary = structured(
      await client.callTool({
        name: "get_project_summary",
        arguments: {}
      })
    );
    assert.equal(
      (
        activeSummary.project as {
          readonly projectHandle: string;
          readonly summary: { readonly schematicPages: number };
        }
      ).projectHandle,
      firstHandle
    );
    assert.equal(
      (
        activeSummary.project as {
          readonly summary: { readonly schematicPages: number };
        }
      ).summary.schematicPages,
      2
    );

    const closedFirst = structured(
      await client.callTool({
        name: "close_schematic_project",
        arguments: { projectHandle: firstHandle }
      })
    );
    assert.equal(closedFirst.closedProjectHandle, firstHandle);
    assert.equal(
      (
        closedFirst.workspace as {
          readonly projectCount: number;
          readonly activeProjectHandle: string;
        }
      ).projectCount,
      1
    );
    assert.equal(
      (
        closedFirst.workspace as {
          readonly activeProjectHandle: string;
        }
      ).activeProjectHandle,
      secondHandle
    );
    const stalePage = structured(
      await client.callTool({
        name: "list_schematic_projects",
        arguments: { limit: 1, cursor: staleCursor }
      })
    );
    assert.equal(stalePage.ok, false);
    assert.equal(
      (stalePage.error as { readonly code: string }).code,
      "MCP_WORKSPACE_CURSOR_INVALID"
    );
  } finally {
    await client.close();
  }
});

test("MCP 只沿用户确认互连组合两个相关工程", async () => {
  const leftProject = await writeProjectFixture(
    assemblyProjectEpru("left", ["SRC", "J1"])
  );
  const rightProject = await writeProjectFixture(
    assemblyProjectEpru("right", ["J2", "TGT"])
  );
  const leftNetlist = await writeNetlistFixture(
    path.dirname(leftProject),
    "left.enet",
    {
      source: {
        props: { Designator: "SRC" },
        pinInfoMap: {
          one: { name: "OUT", number: "1", net: "LEFT_SIGNAL" }
        }
      },
      connector: {
        props: { Designator: "J1", Footprint: "CONN_4" },
        pinInfoMap: {
          one: { name: "A", number: "1", net: "LEFT_SIGNAL" },
          two: { name: "B", number: "2", net: "" },
          three: { name: "C", number: "3", net: "" },
          four: { name: "D", number: "4", net: "" }
        }
      }
    }
  );
  const rightNetlist = await writeNetlistFixture(
    path.dirname(rightProject),
    "right.enet",
    {
      connector: {
        props: { Designator: "J2", Footprint: "CONN_4" },
        pinInfoMap: {
          one: { name: "A", number: "1", net: "RIGHT_SIGNAL" },
          two: { name: "B", number: "2", net: "" },
          three: { name: "C", number: "3", net: "" },
          four: { name: "D", number: "4", net: "" }
        }
      },
      target: {
        props: { Designator: "TGT" },
        pinInfoMap: {
          one: { name: "IN", number: "9", net: "RIGHT_SIGNAL" }
        }
      }
    }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/src/mcp/main.js"],
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const client = new Client({
    name: "schemcp-assembly-test",
    version: "1.0.0"
  });
  try {
    await client.connect(transport);
    const leftOpened = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: { projectPath: leftProject }
      })
    );
    const leftHandle = (
      leftOpened.project as { readonly projectHandle: string }
    ).projectHandle;
    const rightOpened = structured(
      await client.callTool({
        name: "open_schematic_project",
        arguments: { projectPath: rightProject }
      })
    );
    const rightHandle = (
      rightOpened.project as { readonly projectHandle: string }
    ).projectHandle;
    await client.callTool({
      name: "attach_schematic_netlist",
      arguments: { projectHandle: leftHandle, netlistPath: leftNetlist }
    });
    await client.callTool({
      name: "attach_schematic_netlist",
      arguments: { projectHandle: rightHandle, netlistPath: rightNetlist }
    });

    const created = structured(
      await client.callTool({
        name: "create_schematic_assembly",
        arguments: { projectHandles: [leftHandle, rightHandle] }
      })
    );
    const assemblyHandle = (
      created.assembly as { readonly assemblyHandle: string }
    ).assemblyHandle;
    assert.equal(
      created.relationshipTruth,
      "USER_ASSERTED_PROJECT_RELATIONSHIP"
    );

    const before = structured(
      await client.callTool({
        name: "list_assembly_connections",
        arguments: {
          assemblyHandle,
          projectHandle: leftHandle,
          designator: "SRC",
          pinNumber: "1",
          limit: 50
        }
      })
    );
    const beforePaths = (
      before.lookup as {
        readonly paths: {
          readonly items: readonly {
            readonly target: { readonly componentRef: string };
          }[];
        };
      }
    ).paths.items;
    assert.equal(
      beforePaths.some((path) => path.target.componentRef === "TGT"),
      false
    );

    const candidateResult = structured(
      await client.callTool({
        name: "list_interconnect_candidates",
        arguments: { assemblyHandle, limit: 50 }
      })
    );
    const candidates = (
      candidateResult.page as {
        readonly items: readonly {
          readonly candidateId: string;
          readonly left: { readonly designator?: string };
          readonly right: { readonly designator?: string };
          readonly state: string;
        }[];
      }
    ).items;
    const connectorCandidate = candidates.find(
      (candidate) =>
        new Set([
          candidate.left.designator,
          candidate.right.designator
        ]).has("J1") &&
        new Set([
          candidate.left.designator,
          candidate.right.designator
        ]).has("J2")
    );
    assert.ok(connectorCandidate);
    assert.equal(connectorCandidate.state, "CANDIDATE_NOT_CONFIRMED");

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
    assert.equal(
      confirmed.relationshipTruth,
      "USER_CONFIRMED_SESSION_RELATIONSHIP"
    );

    const after = structured(
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
    const afterPaths = (
      after.lookup as {
        readonly paths: {
          readonly items: readonly {
            readonly target: { readonly componentRef: string };
            readonly segments: readonly { readonly kind: string }[];
          }[];
        };
      }
    ).paths.items;
    const targetPath = afterPaths.find(
      (path) => path.target.componentRef === "TGT"
    );
    assert.ok(targetPath);
    assert.deepEqual(
      targetPath.segments.map((segment) => segment.kind),
      ["BOUND_NETLIST", "CONFIRMED_INTERCONNECT", "BOUND_NETLIST"]
    );

    const manifestResult = structured(
      await client.callTool({
        name: "get_schematic_assembly_manifest",
        arguments: { assemblyHandle }
      })
    );
    const manifest = manifestResult.manifest as {
      readonly schema: string;
      readonly manifestSha256: string;
      readonly projects: readonly unknown[];
      readonly assembly: {
        readonly interconnects: readonly unknown[];
      };
    };
    assert.equal(manifest.schema, "schemcp.schematic-assembly-manifest");
    assert.match(manifest.manifestSha256, /^[0-9a-f]{64}$/u);
    assert.equal(manifest.projects.length, 2);
    assert.equal(manifest.assembly.interconnects.length, 1);
    const serializedManifest = JSON.stringify(manifest);
    assert.equal(serializedManifest.includes(leftProject), false);
    assert.equal(serializedManifest.includes(rightProject), false);
    assert.equal(serializedManifest.includes(leftNetlist), false);
    assert.equal(serializedManifest.includes(rightNetlist), false);

    const manifestPath = path.join(
      path.dirname(leftProject),
      "fixture.schemcp-assembly.json"
    );
    await writeFile(manifestPath, serializedManifest, { mode: 0o600 });
    const closed = structured(
      await client.callTool({
        name: "close_schematic_assembly",
        arguments: { assemblyHandle }
      })
    );
    assert.equal(closed.disposition, "CLOSED");
    const restored = structured(
      await client.callTool({
        name: "open_schematic_assembly_manifest",
        arguments: { manifestPath }
      })
    );
    assert.equal(restored.disposition, "RESTORED");
    assert.equal(restored.projectBinding, "EXACT_IR_HASH_MATCH");

    const restoredConnections = structured(
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
    const restoredPaths = (
      restoredConnections.lookup as {
        readonly paths: {
          readonly items: readonly {
            readonly target: { readonly componentRef: string };
          }[];
        };
      }
    ).paths.items;
    assert.equal(
      restoredPaths.some((item) => item.target.componentRef === "TGT"),
      true
    );

    const tamperedPath = path.join(
      path.dirname(leftProject),
      "tampered.schemcp-assembly.json"
    );
    await writeFile(
      tamperedPath,
      JSON.stringify({
        ...manifest,
        manifestSha256: "0".repeat(64)
      }),
      { mode: 0o600 }
    );
    const tampered = structured(
      await client.callTool({
        name: "open_schematic_assembly_manifest",
        arguments: { manifestPath: tamperedPath }
      })
    );
    assert.equal(tampered.ok, false);
    assert.equal(
      (tampered.error as { readonly code: string }).code,
      "MCP_ASSEMBLY_MANIFEST_INVALID"
    );

    await client.callTool({
      name: "close_schematic_project",
      arguments: { projectHandle: rightHandle }
    });
    const missingProject = structured(
      await client.callTool({
        name: "open_schematic_assembly_manifest",
        arguments: { manifestPath }
      })
    );
    assert.equal(missingProject.ok, false);
    assert.equal(
      (missingProject.error as { readonly code: string }).code,
      "MCP_ASSEMBLY_MANIFEST_INVALID"
    );
  } finally {
    await client.close();
  }
});
