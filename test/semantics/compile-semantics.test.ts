import assert from "node:assert/strict";
import test from "node:test";
import type {
  IrComponent,
  IrDevice,
  IrPinInstance,
  IrRecordProvenance,
  IrSymbol
} from "../../src/ir/model.js";
import {
  compileSemantics,
  SEMANTIC_RULE_SET_VERSION
} from "../../src/semantics/compile-semantics.js";

const PROVENANCE: IrRecordProvenance = {
  documentId: "page-a",
  documentType: "SCH_PAGE",
  recordType: "COMPONENT",
  ticket: 1,
  client: "fixture",
  entry: "epru",
  line: 1
};

function component(
  id: string,
  designator: string,
  assembly: IrComponent["assembly"]["status"] = "POPULATED",
  completeness: IrComponent["pinCompleteness"]["status"] = "COMPLETE"
): IrComponent {
  return {
    id,
    pageId: "page-a",
    partId: "part-a",
    position: { x: 0, y: 0 },
    rotation: 0,
    mirrored: false,
    designator,
    deviceId: `device-${id}`,
    symbolId: `symbol-${id}`,
    symbolBinding: {
      key: "Symbol",
      state: "BOUND_COMPONENT_OVERRIDE",
      targetId: `symbol-${id}`,
      componentAttributes: []
    },
    footprintBinding: {
      key: "Footprint",
      state: "UNRESOLVED_DEVICE_DEFAULT_MISSING",
      componentAttributes: []
    },
    assembly: {
      status: assembly,
      reason:
        assembly === "POPULATED"
          ? "EXPLICIT_ADD_INTO_BOM_YES"
          : assembly === "DNP"
            ? "EXPLICIT_ADD_INTO_BOM_NO"
            : "ADD_INTO_BOM_MISSING",
      attributeKey: "Add into BOM",
      values:
        assembly === "POPULATED" ? ["yes"] : assembly === "DNP" ? ["no"] : [],
      resolution: assembly === "UNKNOWN" ? "MISSING" : "COMPONENT_EXPLICIT",
      evidenceClass:
        assembly === "UNKNOWN" ? "DETERMINISTIC_RULE" : "EXPLICIT_PROJECT_RECORD",
      truthStatus: "NOT_VERIFIED",
      semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
      provenance: assembly === "UNKNOWN" ? [] : [PROVENANCE]
    },
    pinCompleteness: {
      logicalComponentId: `logical-${id}`,
      status: completeness,
      reason:
        completeness === "COMPLETE"
          ? "SINGLE_SYMBOL_PART_COMPLETE"
          : completeness === "PARTIAL"
            ? "SYMBOL_UNIT_MISSING"
            : "HIDDEN_PIN_SOURCE_UNRESOLVED",
      units: [{ componentId: id, pageId: "page-a", partId: "part-a" }],
      declaredPartIds: ["part-a"],
      instantiatedPartIds: ["part-a"],
      missingPartIds: completeness === "PARTIAL" ? ["part-b"] : [],
      duplicatePartIds: [],
      symbolPinCount: 1,
      instantiatedPinCount: 1,
      hiddenPinCount: 0,
      evidenceClass: "DETERMINISTIC_RULE",
      truthStatus: "NOT_VERIFIED",
      semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
      provenance: [PROVENANCE]
    },
    attributes: [],
    provenance: { ...PROVENANCE, recordId: id },
    extensions: { easyeda: {} }
  };
}

function device(componentId: string, title: string): IrDevice {
  return {
    id: `device-${componentId}`,
    title,
    attributes: {},
    provenance: {
      ...PROVENANCE,
      documentId: `device-${componentId}`,
      documentType: "DEVICE",
      recordType: "META"
    },
    extensions: { easyeda: {} }
  };
}

function symbol(componentId: string): IrSymbol {
  return {
    id: `symbol-${componentId}`,
    title: `Symbol ${componentId}`,
    attributes: [],
    provenance: {
      ...PROVENANCE,
      documentId: `symbol-${componentId}`,
      documentType: "SYMBOL",
      recordType: "META"
    },
    extensions: { easyeda: {} }
  };
}

function pin(
  componentId: string,
  id: string,
  name: string,
  netName?: string
): IrPinInstance {
  return {
    id,
    pageId: "page-a",
    componentId,
    symbolId: `symbol-${componentId}`,
    symbolPinId: `symbol-pin-${id}`,
    partId: "part-a",
    display: true,
    endpointKind: "PART_SYMBOL_PIN",
    name,
    number: id,
    instanceAttributes: [],
    connectionPoint: { x: 0, y: 0 },
    connectionCandidate:
      netName === undefined
        ? {
            status: "UNRESOLVED_NO_WIRE",
            basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
            electricalTruth: "NOT_VERIFIED",
            explicitNets: [],
            unlabeledWireIds: []
          }
        : {
            status: "UNIQUE_EXPLICIT_NET_CANDIDATE",
            basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT",
            electricalTruth: "NOT_VERIFIED",
            explicitNets: [
              { netName, wireIds: [`wire-${id}`], segmentIds: [`segment-${id}`] }
            ],
            unlabeledWireIds: []
          },
    provenance: {
      component: { ...PROVENANCE, recordId: componentId },
      symbol: {
        ...PROVENANCE,
        documentId: `symbol-${componentId}`,
        documentType: "SYMBOL",
        recordType: "META"
      },
      symbolPin: {
        ...PROVENANCE,
        documentId: `symbol-${componentId}`,
        documentType: "SYMBOL",
        recordType: "PIN",
        recordId: `symbol-pin-${id}`
      }
    }
  };
}

test("STM32 显式引脚别名形成完整与部分接口候选并带版本化证据", () => {
  const mcu = component("mcu", "U1");
  const result = compileSemantics(
    [mcu],
    [device("mcu", "STM32F407VGT6 Microcontroller")],
    [symbol("mcu")],
    [
      pin("mcu", "1", "PA13/JTMS/SWDIO", "SWDIO"),
      pin("mcu", "2", "PA14/JTCK/SWCLK", "SWCLK"),
      pin("mcu", "3", "PA9/USART1_TX", "USART1_TX"),
      pin("mcu", "4", "PA10/USART1_RX", "USART1_RX"),
      pin("mcu", "5", "PB6/I2C1_SCL", "I2C1_SCL"),
      pin("mcu", "6", "PB7/I2C1_SDA", "I2C1_SDA"),
      pin("mcu", "7", "PA12/USB_OTG_FS_DP", "USB_OTG_FS_DP"),
      pin("mcu", "8", "VDD", "+3V3")
    ]
  );
  assert.equal(result.componentSemantics[0]?.primaryRole, "MCU_MPU");
  assert.equal(
    result.componentSemantics[0]?.semanticRuleSetVersion,
    SEMANTIC_RULE_SET_VERSION
  );
  assert.equal(result.componentSemantics[0]?.powerDomains[0]?.netName, "+3V3");

  const byType = new Map(result.interfaces.map((item) => [item.type, item]));
  assert.equal(byType.get("SWD")?.status, "CANDIDATE");
  assert.equal(byType.get("UART")?.status, "CANDIDATE");
  assert.equal(byType.get("I2C")?.status, "CANDIDATE");
  assert.equal(byType.get("JTAG")?.status, "PARTIAL_CANDIDATE");
  assert.deepEqual(byType.get("JTAG")?.missingSignals, ["TDI", "TDO"]);
  assert.equal(byType.get("USB")?.status, "PARTIAL_CANDIDATE");
  assert.deepEqual(byType.get("USB")?.missingSignals, ["DM"]);
  assert.equal(byType.get("SWD")?.activityStatus, "ACTIVE");
  assert.equal(byType.get("SWD")?.truthStatus, "CANDIDATE");
});

test("DNP 接口保留为排除证据，引脚来源不完整时接口保持 UNRESOLVED", () => {
  const dnp = component("can", "U2", "DNP");
  const unknown = component("usb", "U3", "POPULATED", "UNKNOWN");
  const result = compileSemantics(
    [dnp, unknown],
    [
      device("can", "CAN Transceiver"),
      device("usb", "USB PHY Transceiver")
    ],
    [symbol("can"), symbol("usb")],
    [
      pin("can", "1", "CANH", "CANH"),
      pin("can", "2", "CANL", "CANL"),
      pin("usb", "3", "USB_DP", "USB_DP"),
      pin("usb", "4", "USB_DM", "USB_DM")
    ]
  );
  const can = result.interfaces.find((item) => item.type === "CAN");
  assert.equal(can?.status, "CANDIDATE");
  assert.equal(can?.activityStatus, "EXCLUDED_DNP");
  const usb = result.interfaces.find((item) => item.type === "USB");
  assert.equal(usb?.status, "UNRESOLVED");
  assert.deepEqual(usb?.unresolvedReasons, ["PIN_COMPLETENESS_UNKNOWN"]);
  assert.equal(usb?.truthStatus, "UNRESOLVED");
});

test("同一接口信号绑定多个引脚时不静默择一", () => {
  const mcu = component("mcu", "U1");
  const result = compileSemantics(
    [mcu],
    [device("mcu", "STM32 Microcontroller")],
    [symbol("mcu")],
    [
      pin("mcu", "1", "PA9/USART1_TX", "USART1_TX_A"),
      pin("mcu", "2", "PB6/USART1_TX", "USART1_TX_B"),
      pin("mcu", "3", "PA10/USART1_RX", "USART1_RX")
    ]
  );
  const uart = result.interfaces.find((item) => item.type === "UART");
  assert.equal(uart?.status, "UNRESOLVED");
  assert.deepEqual(uart?.unresolvedReasons, ["DUPLICATE_SIGNAL_ASSIGNMENT"]);
});

test("未接线的复用功能名不形成接口，未命名导线只形成未解析接口", () => {
  const mcu = component("mcu", "U1");
  const noWire = compileSemantics(
    [mcu],
    [device("mcu", "STM32 Microcontroller")],
    [symbol("mcu")],
    [
      pin("mcu", "1", "PA9/USART1_TX"),
      pin("mcu", "2", "PA10/USART1_RX")
    ]
  );
  assert.equal(noWire.interfaces.length, 0);

  const unresolvedWirePins = [
    pin("mcu", "1", "PA9/USART1_TX"),
    pin("mcu", "2", "PA10/USART1_RX")
  ].map((item, index) => ({
    ...item,
    connectionCandidate: {
      status: "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET" as const,
      basis: "TRANSFORMED_PIN_POINT_ON_WIRE_SEGMENT" as const,
      electricalTruth: "NOT_VERIFIED" as const,
      explicitNets: [],
      unlabeledWireIds: [`wire-${index + 1}`]
    }
  }));
  const unresolvedWire = compileSemantics(
    [mcu],
    [device("mcu", "STM32 Microcontroller")],
    [symbol("mcu")],
    unresolvedWirePins
  );
  const uart = unresolvedWire.interfaces.find((item) => item.type === "UART");
  assert.equal(uart?.status, "UNRESOLVED");
  assert.deepEqual(uart?.unresolvedReasons, [
    "CONNECTION_CANDIDATE_UNRESOLVED"
  ]);
  assert.equal(uart?.truthStatus, "UNRESOLVED");
});

test("稳压器角色可由显式引脚结构确定性识别", () => {
  const ldo = component("regulator-a", "U2");
  const buck = component("regulator-b", "U3");
  const result = compileSemantics(
    [ldo, buck],
    [
      device("regulator-a", "Power Device"),
      device("regulator-b", "Power Device")
    ],
    [symbol("regulator-a"), symbol("regulator-b")],
    [
      pin("regulator-a", "1", "VIN", "+5V"),
      pin("regulator-a", "2", "VOUT", "+3V3"),
      pin("regulator-a", "3", "GND", "GND"),
      pin("regulator-b", "4", "VIN", "+12V"),
      pin("regulator-b", "5", "SW", "SW_NODE"),
      pin("regulator-b", "6", "FB", "REG_FB"),
      pin("regulator-b", "7", "GND", "GND")
    ]
  );
  const byComponent = new Map(
    result.componentSemantics.map((item) => [item.componentId, item])
  );
  assert.equal(byComponent.get("regulator-a")?.primaryRole, "LDO");
  assert.equal(
    byComponent.get("regulator-a")?.roles[0]?.ruleId,
    "component-role.ldo.pin-structure.v1"
  );
  assert.equal(byComponent.get("regulator-b")?.primaryRole, "DC_DC");
  assert.equal(
    byComponent.get("regulator-b")?.roles[0]?.ruleId,
    "component-role.dc-dc.pin-structure.v1"
  );
});

test("显式器件身份形成电源开关和时钟缓冲候选而不依赖模型猜测", () => {
  const powerSwitch = component("power-switch", "U4");
  const clockBuffer = component("clock-buffer", "U5");
  const isolator = component("isolator", "U6");
  const result = compileSemantics(
    [powerSwitch, clockBuffer, isolator],
    [
      device("power-switch", "High-side load switch"),
      device("clock-buffer", "Low-jitter clock fanout buffer"),
      device("isolator", "Galvanic digital isolator")
    ],
    [symbol("power-switch"), symbol("clock-buffer"), symbol("isolator")],
    [
      pin("power-switch", "1", "VIN", "+3V3"),
      pin("power-switch", "2", "VOUT", "+3V3_SW"),
      pin("clock-buffer", "3", "CLK_IN", "REF_CLK"),
      pin("clock-buffer", "4", "CLK_OUT0", "CLK_A"),
      pin("clock-buffer", "5", "CLK_OUT1", "CLK_B"),
      pin("isolator", "6", "VDD", "+3V3"),
      pin("isolator", "7", "VDD", "+3V3_ISO")
    ]
  );
  const byComponent = new Map(
    result.componentSemantics.map((item) => [item.componentId, item])
  );
  assert.equal(
    byComponent.get("power-switch")?.primaryRole,
    "POWER_SWITCH_CANDIDATE"
  );
  assert.equal(
    byComponent.get("clock-buffer")?.primaryRole,
    "CLOCK_BUFFER_CANDIDATE"
  );
  assert.equal(byComponent.get("isolator")?.primaryRole, "ISOLATOR_CANDIDATE");
  assert.equal(
    byComponent
      .get("isolator")
      ?.powerDomains.every(
        (item) => item.isolationStatus === "ISOLATION_CANDIDATE"
      ),
    true
  );
});
