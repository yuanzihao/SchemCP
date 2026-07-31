import assert from "node:assert/strict";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { parseJlcEdaProEnet } from "../../src/truth/jlceda-pro-enet.js";

function netlist(
  components: Readonly<Record<string, unknown>> = {
    componentA: {
      props: {
        Designator: "U1",
        Value: "fixture"
      },
      pinInfoMap: {
        pinB: { name: "B", number: "2", net: "" },
        pinA: { name: "A", number: "1", net: "GND" }
      }
    }
  }
): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: "2.0.0",
      components,
      designRule: {},
      netClass: {},
      equalLengthNetGroup: {},
      differentialPair: {}
    }),
    "utf8"
  );
}

test("严格解析嘉立创专业版 .enet v2 并只生成有网络的确定元组", () => {
  const parsed = parseJlcEdaProEnet(netlist());
  assert.deepEqual(parsed, {
    schemaVersion: "0.2.0",
    format: "JLCEDA_PRO_ENET",
    formatVersion: "2.0.0",
    componentCount: 1,
    pinEntryCount: 2,
    connectedPinEntryCount: 1,
    unconnectedPinEntryCount: 1,
    tupleCount: 1,
    componentRefs: ["U1"],
    components: [
      {
        key: "componentA",
        designator: "U1",
        properties: {
          Designator: "U1",
          Value: "fixture"
        },
        pins: [
          {
            key: "pinA",
            name: "A",
            number: "1",
            net: "GND",
            properties: {}
          },
          {
            key: "pinB",
            name: "B",
            number: "2",
            net: "",
            properties: {}
          }
        ]
      }
    ],
    tuples: [
      {
        componentRef: "U1",
        pinNumber: "1",
        netName: "GND"
      }
    ]
  });
});

test("兼容真实导出中的引脚 props，并要求 Pin Number 与 number 一致", () => {
  const parsed = parseJlcEdaProEnet(
    netlist({
      componentA: {
        props: { Designator: "U1" },
        pinInfoMap: {
          pinA: {
            name: "A",
            number: "1",
            net: "GND",
            props: { "Pin Number": "1" }
          }
        }
      }
    })
  );
  assert.equal(parsed.tupleCount, 1);

  assert.throws(
    () =>
      parseJlcEdaProEnet(
        netlist({
          componentA: {
            props: { Designator: "U1" },
            pinInfoMap: {
              pinA: {
                name: "A",
                number: "1",
                net: "GND",
                props: { "Pin Number": "2" }
              }
            }
          }
        })
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.JLCEDA_PRO_ENET_INVALID
  );
});

test("拒绝未知版本、重复位号/引脚编号、非法引脚字段和重复 JSON 键", () => {
  const invalidInputs = [
    Buffer.from(
      JSON.stringify({
        version: "3.0.0",
        components: {},
        designRule: {},
        netClass: {},
        equalLengthNetGroup: {},
        differentialPair: {}
      })
    ),
    netlist({
      a: {
        props: { Designator: "U1" },
        pinInfoMap: {}
      },
      b: {
        props: { Designator: "U1" },
        pinInfoMap: {}
      }
    }),
    netlist({
      a: {
        props: { Designator: "U1" },
        pinInfoMap: {
          p1: { name: "A", number: "1", net: "GND" },
          p2: { name: "B", number: "1", net: "VCC" }
        }
      }
    }),
    netlist({
      a: {
        props: { Designator: "U1" },
        pinInfoMap: {
          p: { name: "", number: "1", net: "GND", guessed: true }
        }
      }
    }),
    Buffer.from(
      '{"version":"2.0.0","version":"2.0.0","components":{},"designRule":{},"netClass":{},"equalLengthNetGroup":{},"differentialPair":{}}'
    )
  ];
  for (const input of invalidInputs) {
    assert.throws(
      () => parseJlcEdaProEnet(input),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERROR_CODES.JLCEDA_PRO_ENET_INVALID
    );
  }
});

test("拒绝非法 UTF-8 与超过安全深度的 JSON", () => {
  assert.throws(
    () => parseJlcEdaProEnet(Buffer.from([0xc3, 0x28])),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.JLCEDA_PRO_ENET_INVALID
  );
  const tooDeep = Buffer.from(`${"[".repeat(65)}0${"]".repeat(65)}`);
  assert.throws(
    () => parseJlcEdaProEnet(tooDeep),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.JLCEDA_PRO_ENET_INVALID
  );
});
