import { AppError, ERROR_CODES } from "../core/error.js";
import type { NetlistTuple } from "../validation/netlist-tuples.js";

const MAX_ENET_BYTES = 16 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_COMPONENTS = 100_000;
const MAX_PINS = 2_000_000;
const MAX_PROPERTIES_PER_COMPONENT = 4_096;
const MAX_AUXILIARY_ENTRIES = 1_000_000;
const MAX_KEY_LENGTH = 4_096;
const MAX_VALUE_LENGTH = 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export interface JlcEdaProEnet {
  readonly schemaVersion: "0.2.0";
  readonly format: "JLCEDA_PRO_ENET";
  readonly formatVersion: "2.0.0";
  readonly componentCount: number;
  readonly pinEntryCount: number;
  readonly connectedPinEntryCount: number;
  readonly unconnectedPinEntryCount: number;
  readonly tupleCount: number;
  readonly componentRefs: readonly string[];
  readonly components: readonly JlcEdaProEnetComponent[];
  readonly tuples: readonly NetlistTuple[];
}

export interface JlcEdaProEnetPin {
  readonly key: string;
  readonly name: string;
  readonly number: string;
  readonly net: string;
  readonly properties: Readonly<Record<string, string>>;
}

export interface JlcEdaProEnetComponent {
  readonly key: string;
  readonly designator: string;
  readonly properties: Readonly<Record<string, string>>;
  readonly pins: readonly JlcEdaProEnetPin[];
}

function invalid(message: string, cause?: unknown): never {
  throw new AppError(ERROR_CODES.JLCEDA_PRO_ENET_INVALID, message, {
    ...(cause === undefined ? {} : { cause })
  });
}

function record(value: unknown, field: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${field} 必须是 JSON 对象。`);
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  expected: readonly string[],
  field: string
): void {
  const actual = Object.keys(value).sort();
  const normalizedExpected = [...expected].sort();
  if (
    actual.length !== normalizedExpected.length ||
    actual.some((key, index) => key !== normalizedExpected[index])
  ) {
    invalid(`${field} 字段集合不符合嘉立创 EDA 专业版 .enet v2 契约。`);
  }
}

function boundedString(
  value: unknown,
  field: string,
  options: { readonly allowEmpty: boolean } = { allowEmpty: false }
): string {
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && value.length === 0) ||
    value.length > MAX_VALUE_LENGTH
  ) {
    invalid(
      `${field} 必须是${options.allowEmpty ? "" : "非空"}且不超过安全限额的字符串。`
    );
  }
  return value;
}

function assertBoundedKey(value: string, field: string): void {
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) {
    invalid(`${field} 键名为空或超过安全限额。`);
  }
}

/**
 * JSON.parse 会静默覆盖重复键。这里在解析前扫描每个对象的键集合，
 * 同时限制嵌套深度，避免把不确定输入悄悄归一化成另一份网表。
 */
function assertJsonStructure(text: string): void {
  const stack: Array<
    | { readonly type: "array" }
    | { readonly type: "object"; readonly keys: Set<string> }
  > = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < text.length) {
        const current = text[index];
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === '"') {
          break;
        }
        index += 1;
      }
      if (index >= text.length) {
        invalid(".enet 包含未闭合的 JSON 字符串。");
      }
      const end = index + 1;
      let next = end;
      while (next < text.length && /\s/u.test(text[next] ?? "")) next += 1;
      const parent = stack[stack.length - 1];
      if (parent?.type === "object" && text[next] === ":") {
        let key: unknown;
        try {
          key = JSON.parse(text.slice(start, end)) as unknown;
        } catch (error) {
          invalid(".enet 包含非法 JSON 对象键。", error);
        }
        if (typeof key !== "string") {
          invalid(".enet JSON 对象键必须是字符串。");
        }
        if (parent.keys.has(key)) {
          invalid(".enet 包含重复 JSON 对象键，拒绝静默覆盖。");
        }
        parent.keys.add(key);
      }
      index = end;
      continue;
    }
    if (character === "{") {
      stack.push({ type: "object", keys: new Set<string>() });
    } else if (character === "[") {
      stack.push({ type: "array" });
    } else if (character === "}" || character === "]") {
      stack.pop();
    }
    if (stack.length > MAX_JSON_DEPTH) {
      invalid(".enet JSON 嵌套深度超过安全限额。");
    }
    index += 1;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTuple(left: NetlistTuple, right: NetlistTuple): number {
  return (
    compareText(left.componentRef, right.componentRef) ||
    compareText(left.pinNumber, right.pinNumber) ||
    compareText(left.netName, right.netName)
  );
}

function validateAuxiliaryObject(
  value: unknown,
  field: string
): JsonRecord {
  const parsed = record(value, field);
  if (Object.keys(parsed).length > MAX_AUXILIARY_ENTRIES) {
    invalid(`${field} 条目数超过安全限额。`);
  }
  return parsed;
}

export function parseJlcEdaProEnet(bytes: Uint8Array): JlcEdaProEnet {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ENET_BYTES) {
    invalid(".enet 必须非空且不超过 16 MiB。");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    invalid(".enet 不是有效 UTF-8。", error);
  }
  assertJsonStructure(text);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    invalid(".enet 不是有效 JSON。", error);
  }
  const root = record(value, "enet");
  exactKeys(
    root,
    [
      "version",
      "components",
      "designRule",
      "netClass",
      "equalLengthNetGroup",
      "differentialPair"
    ],
    "enet"
  );
  if (root.version !== "2.0.0") {
    invalid("只接受经真实工程确认的嘉立创 EDA 专业版 .enet v2.0.0。");
  }
  validateAuxiliaryObject(root.designRule, "enet.designRule");
  validateAuxiliaryObject(root.netClass, "enet.netClass");
  validateAuxiliaryObject(
    root.equalLengthNetGroup,
    "enet.equalLengthNetGroup"
  );
  validateAuxiliaryObject(root.differentialPair, "enet.differentialPair");

  const components = record(root.components, "enet.components");
  const componentEntries = Object.entries(components);
  if (componentEntries.length > MAX_COMPONENTS) {
    invalid("enet.components 条目数超过安全限额。");
  }
  const designators = new Set<string>();
  const parsedComponents: JlcEdaProEnetComponent[] = [];
  const tuples: NetlistTuple[] = [];
  let pinEntryCount = 0;
  let connectedPinEntryCount = 0;

  for (const [componentKey, rawComponent] of componentEntries) {
    assertBoundedKey(componentKey, "enet.components");
    const component = record(
      rawComponent,
      `enet.components.${componentKey}`
    );
    exactKeys(
      component,
      ["props", "pinInfoMap"],
      `enet.components.${componentKey}`
    );
    const props = record(
      component.props,
      `enet.components.${componentKey}.props`
    );
    const propertyEntries = Object.entries(props);
    if (propertyEntries.length > MAX_PROPERTIES_PER_COMPONENT) {
      invalid(`enet.components.${componentKey}.props 属性数超过安全限额。`);
    }
    for (const [propertyName, propertyValue] of propertyEntries) {
      assertBoundedKey(
        propertyName,
        `enet.components.${componentKey}.props`
      );
      boundedString(
        propertyValue,
        `enet.components.${componentKey}.props.${propertyName}`,
        { allowEmpty: true }
      );
    }
    const designator = boundedString(
      props.Designator,
      `enet.components.${componentKey}.props.Designator`
    );
    if (designators.has(designator)) {
      invalid("enet.components 包含重复位号，无法建立唯一引脚真值。");
    }
    designators.add(designator);

    const pinInfoMap = record(
      component.pinInfoMap,
      `enet.components.${componentKey}.pinInfoMap`
    );
    const pinNumbers = new Set<string>();
    const parsedPins: JlcEdaProEnetPin[] = [];
    for (const [pinKey, rawPin] of Object.entries(pinInfoMap)) {
      pinEntryCount += 1;
      if (pinEntryCount > MAX_PINS) {
        invalid("enet.components 引脚总数超过安全限额。");
      }
      assertBoundedKey(
        pinKey,
        `enet.components.${componentKey}.pinInfoMap`
      );
      const pin = record(
        rawPin,
        `enet.components.${componentKey}.pinInfoMap.${pinKey}`
      );
      const pinField = `enet.components.${componentKey}.pinInfoMap.${pinKey}`;
      if (Object.hasOwn(pin, "props")) {
        exactKeys(pin, ["name", "number", "net", "props"], pinField);
      } else {
        exactKeys(pin, ["name", "number", "net"], pinField);
      }
      const pinName = boundedString(
        pin.name,
        `${pinField}.name`,
        { allowEmpty: true }
      );
      const pinNumber = boundedString(
        pin.number,
        `${pinField}.number`
      );
      if (Object.hasOwn(pin, "props")) {
        const pinProps = record(pin.props, `${pinField}.props`);
        exactKeys(pinProps, ["Pin Number"], `${pinField}.props`);
        const propertyPinNumber = boundedString(
          pinProps["Pin Number"],
          `${pinField}.props.Pin Number`
        );
        if (propertyPinNumber !== pinNumber) {
          invalid(
            `${pinField}.props.Pin Number 与显式 number 不一致，拒绝静默选择。`
          );
        }
      }
      if (pinNumbers.has(pinNumber)) {
        invalid(
          `enet.components.${componentKey}.pinInfoMap 包含重复引脚编号，无法建立唯一引脚真值。`
        );
      }
      pinNumbers.add(pinNumber);
      const netName = boundedString(
        pin.net,
        `${pinField}.net`,
        { allowEmpty: true }
      );
      if (netName.length > 0) {
        connectedPinEntryCount += 1;
        tuples.push({
          componentRef: designator,
          pinNumber,
          netName
        });
      }
      parsedPins.push({
        key: pinKey,
        name: pinName,
        number: pinNumber,
        net: netName,
        properties: Object.hasOwn(pin, "props")
          ? { "Pin Number": pinNumber }
          : {}
      });
    }
    parsedPins.sort((left, right) => compareText(left.number, right.number));
    parsedComponents.push({
      key: componentKey,
      designator,
      properties: Object.fromEntries(
        propertyEntries
          .map(([key, value]) => [key, value as string] as const)
          .sort(([left], [right]) => compareText(left, right))
      ),
      pins: parsedPins
    });
  }
  const componentRefs = [...designators].sort(compareText);
  parsedComponents.sort((left, right) =>
    compareText(left.designator, right.designator)
  );
  tuples.sort(compareTuple);
  return {
    schemaVersion: "0.2.0",
    format: "JLCEDA_PRO_ENET",
    formatVersion: "2.0.0",
    componentCount: componentEntries.length,
    pinEntryCount,
    connectedPinEntryCount,
    unconnectedPinEntryCount: pinEntryCount - connectedPinEntryCount,
    tupleCount: tuples.length,
    componentRefs,
    components: parsedComponents,
    tuples
  };
}
