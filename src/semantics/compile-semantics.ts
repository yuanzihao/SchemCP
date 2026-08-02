import { sha256CanonicalJson } from "../core/canonical-json.js";
import type {
  IrComponent,
  IrComponentPowerDomainCandidate,
  IrComponentRole,
  IrComponentRoleCandidate,
  IrComponentSemantic,
  IrDevice,
  IrInterface,
  IrInterfaceActivityStatus,
  IrInterfaceSignal,
  IrInterfaceStatus,
  IrInterfaceType,
  IrPinInstance,
  IrRecordProvenance,
  IrSymbol
} from "../ir/model.js";

export const SEMANTIC_RULE_SET_VERSION = "schemcp.semantic-rules/1" as const;

export interface SemanticCompilationResult {
  readonly componentSemantics: readonly IrComponentSemantic[];
  readonly interfaces: readonly IrInterface[];
}

interface LogicalComponentGroup {
  readonly logicalComponentId: string;
  readonly components: readonly IrComponent[];
  readonly pins: readonly IrPinInstance[];
}

interface InterfaceSignalMatch {
  readonly type: IrInterfaceType;
  readonly group: string;
  readonly signal: string;
  readonly pin: IrPinInstance;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function provenanceKey(item: IrRecordProvenance): string {
  return [
    item.documentId,
    item.documentType,
    item.recordType,
    item.recordId ?? "",
    String(item.ticket),
    item.client,
    item.entry,
    String(item.line)
  ].join("\n");
}

function uniqueProvenance(
  values: readonly IrRecordProvenance[]
): readonly IrRecordProvenance[] {
  return [
    ...new Map(values.map((value) => [provenanceKey(value), value])).values()
  ].sort((left, right) => compareText(provenanceKey(left), provenanceKey(right)));
}

function logicalGroups(
  components: readonly IrComponent[],
  pins: readonly IrPinInstance[]
): readonly LogicalComponentGroup[] {
  const componentsByLogicalId = new Map<string, IrComponent[]>();
  for (const component of components) {
    const group =
      componentsByLogicalId.get(component.pinCompleteness.logicalComponentId) ??
      [];
    group.push(component);
    componentsByLogicalId.set(component.pinCompleteness.logicalComponentId, group);
  }
  return [...componentsByLogicalId.entries()]
    .map(([logicalComponentId, groupComponents]) => {
      const componentKeys = new Set(
        groupComponents.map((component) => `${component.pageId}\n${component.id}`)
      );
      return {
        logicalComponentId,
        components: [...groupComponents].sort(
          (left, right) =>
            compareText(left.pageId, right.pageId) ||
            compareText(left.id, right.id)
        ),
        pins: pins
          .filter((pin) => componentKeys.has(`${pin.pageId}\n${pin.componentId}`))
          .sort(
            (left, right) =>
              compareText(left.pageId, right.pageId) ||
              compareText(left.componentId, right.componentId) ||
              compareText(left.partId, right.partId) ||
              compareText(left.number ?? "", right.number ?? "") ||
              compareText(left.id, right.id)
          )
      };
    })
    .sort((left, right) =>
      compareText(left.logicalComponentId, right.logicalComponentId)
    );
}

function groupCorpus(
  group: LogicalComponentGroup,
  devicesById: ReadonlyMap<string, IrDevice>,
  symbolsById: ReadonlyMap<string, IrSymbol>
): string {
  const values: string[] = [];
  for (const component of group.components) {
    if (component.designator !== undefined) values.push(component.designator);
    const device =
      component.deviceId === undefined
        ? undefined
        : devicesById.get(component.deviceId);
    const symbol =
      component.symbolId === undefined
        ? undefined
        : symbolsById.get(component.symbolId);
    if (device?.title !== undefined) values.push(device.title);
    if (symbol?.title !== undefined) values.push(symbol.title);
    for (const attribute of component.attributes) {
      if (typeof attribute.value === "string") {
        values.push(attribute.key, attribute.value);
      }
    }
    if (device !== undefined) {
      for (const [key, value] of Object.entries(device.attributes)) {
        if (typeof value === "string") values.push(key, value);
      }
    }
  }
  return values.join("\n").toLocaleUpperCase("en-US");
}

function groupProvenance(
  group: LogicalComponentGroup,
  devicesById: ReadonlyMap<string, IrDevice>,
  symbolsById: ReadonlyMap<string, IrSymbol>
): readonly IrRecordProvenance[] {
  return uniqueProvenance([
    ...group.components.flatMap((component) => [
      component.provenance,
      ...component.attributes.map((attribute) => attribute.provenance),
      ...(component.deviceId === undefined
        ? []
        : [devicesById.get(component.deviceId)?.provenance].filter(
            (item): item is IrRecordProvenance => item !== undefined
          )),
      ...(component.symbolId === undefined
        ? []
        : [symbolsById.get(component.symbolId)?.provenance].filter(
            (item): item is IrRecordProvenance => item !== undefined
          ))
    ])
  ]);
}

function designatorPrefix(group: LogicalComponentGroup): string {
  const designator = group.components.find(
    (component) => component.designator !== undefined
  )?.designator;
  return designator?.match(/^[A-Za-z]+/u)?.[0]?.toLocaleUpperCase("en-US") ?? "";
}

function pinTokens(group: LogicalComponentGroup): readonly string[] {
  return group.pins.flatMap((pin) => [
    ...(pin.name === undefined ? [] : [pin.name]),
    ...pin.connectionCandidate.explicitNets.map((net) => net.netName)
  ]).map((value) => value.toLocaleUpperCase("en-US"));
}

const ROLE_PRIORITY = [
  "MCU_MPU",
  "POWER_INPUT",
  "LDO",
  "DC_DC",
  "POWER_SWITCH_CANDIDATE",
  "REFERENCE_SOURCE",
  "CRYSTAL_OSCILLATOR",
  "CLOCK_BUFFER_CANDIDATE",
  "MEMORY",
  "TRANSCEIVER",
  "ISOLATOR_CANDIDATE",
  "CONNECTOR",
  "RESET_SUPERVISOR",
  "BOOT_STRAP",
  "PROTECTION_CANDIDATE",
  "FILTER_CANDIDATE",
  "PASSIVE",
  "UNKNOWN"
] as const satisfies readonly IrComponentRole[];

function roleCandidates(
  group: LogicalComponentGroup,
  corpus: string,
  provenance: readonly IrRecordProvenance[]
): readonly IrComponentRoleCandidate[] {
  const prefix = designatorPrefix(group);
  const tokens = pinTokens(group);
  const pinCorpus = tokens.join("\n");
  const hasPowerInputToken = tokens.some((token) =>
    /(?:^|[_/])(?:VIN|VBUS|VBAT|DCIN|POWER_IN)(?:$|[_/])/u.test(token)
  );
  const hasBootToken = tokens.some((token) =>
    /(?:^|[_/])BOOT[0-9]*(?:$|[_/])/u.test(token)
  );
  const hasRegulatorInput = /(?:^|[_/])(?:VIN|IN)(?:$|[_/])/mu.test(pinCorpus);
  const hasRegulatorOutput = /(?:^|[_/])(?:VOUT|OUT)(?:$|[_/])/mu.test(pinCorpus);
  const hasGround = /(?:^|[_/])(?:GND|AGND|PGND|VSS)(?:$|[_/])/mu.test(pinCorpus);
  const hasSwitchNode = /(?:^|[_/])(?:SW|LX|SWITCH)(?:$|[_/])/mu.test(pinCorpus);
  const hasFeedback = /(?:^|[_/])(?:FB|VFB)(?:$|[_/])/mu.test(pinCorpus);
  const ldoIdentity = /(?:^|[^A-Z0-9])LDO(?:[^A-Z0-9]|$)|LOW[ -]?DROPOUT/u.test(corpus);
  const ldoStructure =
    prefix === "U" &&
    group.pins.length >= 3 &&
    group.pins.length <= 12 &&
    hasRegulatorInput &&
    hasRegulatorOutput &&
    hasGround &&
    !hasSwitchNode;
  const dcDcIdentity = /DC[ -]?DC|STEP[ -]?(?:DOWN|UP)|\bBUCK\b|\bBOOST\b/u.test(corpus);
  const dcDcStructure =
    prefix === "U" &&
    hasSwitchNode &&
    hasFeedback &&
    hasGround &&
    (hasRegulatorInput || hasRegulatorOutput);
  const tests: readonly {
    readonly role: Exclude<IrComponentRole, "UNKNOWN">;
    readonly ruleId: string;
    readonly matched: boolean;
  }[] = [
    {
      role: "MCU_MPU",
      ruleId: "component-role.mcu-mpu.identity.v1",
      matched:
        /(?:^|[^A-Z0-9])(?:STM32|GD32|CH32|ESP32|NRF5[0-9]|RP2040|RP2350|MICROCONTROLLER|MICROPROCESSOR|CORTEX[- ]?[AMR]|\bMCU\b|\bMPU\b)/u.test(
          corpus
        )
    },
    {
      role: "POWER_INPUT",
      ruleId: "component-role.power-input.explicit-pin.v1",
      matched:
        hasPowerInputToken &&
        (/^(?:J|CN|CON|P)$/u.test(prefix) ||
          /POWER[ _-]?INPUT|DC[ _-]?JACK/u.test(corpus))
    },
    {
      role: "LDO",
      ruleId: ldoIdentity
        ? "component-role.ldo.identity.v1"
        : "component-role.ldo.pin-structure.v1",
      matched: ldoIdentity || ldoStructure
    },
    {
      role: "DC_DC",
      ruleId: dcDcIdentity
        ? "component-role.dc-dc.identity.v1"
        : "component-role.dc-dc.pin-structure.v1",
      matched: dcDcIdentity || dcDcStructure
    },
    {
      role: "POWER_SWITCH_CANDIDATE",
      ruleId: "component-role.power-switch.identity.v1",
      matched:
        /LOAD[ _-]?SWITCH|POWER[ _-]?(?:DISTRIBUTION[ _-]?)?SWITCH|HIGH[ _-]?SIDE[ _-]?SWITCH|(?:^|[^A-Z0-9])EFUSE(?:[^A-Z0-9]|$)|HOT[ _-]?SWAP/u.test(
          corpus
        )
    },
    {
      role: "REFERENCE_SOURCE",
      ruleId: "component-role.reference.identity.v1",
      matched: /VOLTAGE[ _-]?REFERENCE|PRECISION[ _-]?REFERENCE/u.test(corpus)
    },
    {
      role: "CRYSTAL_OSCILLATOR",
      ruleId: "component-role.clock-source.designator-identity.v1",
      matched:
        /CRYSTAL|OSCILLATOR|RESONATOR/u.test(corpus) ||
        (/^(?:Y|X)$/u.test(prefix) && group.pins.length > 0 && group.pins.length <= 4)
    },
    {
      role: "CLOCK_BUFFER_CANDIDATE",
      ruleId: "component-role.clock-buffer.identity.v1",
      matched:
        /CLOCK[ _-]?(?:BUFFER|DISTRIBUTOR|DISTRIBUTION|FANOUT)|FANOUT[ _-]?BUFFER/u.test(
          corpus
        )
    },
    {
      role: "MEMORY",
      ruleId: "component-role.memory.identity.v1",
      matched: /(?:^|[^A-Z0-9])(?:FLASH|EEPROM|SRAM|SDRAM|PSRAM|FRAM|DDR[2345]?|W25Q|AT24C)(?:[^A-Z0-9]|$)/u.test(
        corpus
      )
    },
    {
      role: "TRANSCEIVER",
      ruleId: "component-role.transceiver.identity.v1",
      matched: /TRANSCEIVER|RS[ -]?(?:232|485|422)|CAN[ _-]?PHY|USB[ _-]?PHY|ETHERNET[ _-]?PHY/u.test(
        corpus
      )
    },
    {
      role: "ISOLATOR_CANDIDATE",
      ruleId: "component-role.isolator.identity.v1",
      matched:
        /DIGITAL[ _-]?ISOLATOR|GALVANIC[ _-]?ISOLAT(?:OR|ION)|ISOLATED[ _-]?(?:TRANSCEIVER|INTERFACE|DC[ _-]?DC)/u.test(
          corpus
        )
    },
    {
      role: "CONNECTOR",
      ruleId: "component-role.connector.designator-identity.v1",
      matched:
        /CONNECTOR|HEADER|SOCKET|TERMINAL[ _-]?BLOCK|DC[ _-]?JACK/u.test(corpus) ||
        /^(?:J|CN|CON)$/u.test(prefix)
    },
    {
      role: "PROTECTION_CANDIDATE",
      ruleId: "component-role.protection.designator-identity.v1",
      matched:
        /TVS|ESD|SURGE|OVERVOLTAGE[ _-]?PROTECTION/u.test(corpus) ||
        /^(?:TVS|ESD|F)$/u.test(prefix)
    },
    {
      role: "FILTER_CANDIDATE",
      ruleId: "component-role.filter.designator-identity.v1",
      matched:
        /FERRITE|COMMON[ _-]?MODE|EMI[ _-]?FILTER|LOW[ _-]?PASS|FILTER/u.test(corpus) ||
        /^(?:FB|FL)$/u.test(prefix)
    },
    {
      role: "RESET_SUPERVISOR",
      ruleId: "component-role.reset-supervisor.identity.v1",
      matched: /RESET[ _-]?(?:SUPERVISOR|MONITOR)|VOLTAGE[ _-]?SUPERVISOR/u.test(corpus)
    },
    {
      role: "BOOT_STRAP",
      ruleId: "component-role.boot-strap.explicit-net.v1",
      matched: prefix === "R" && hasBootToken
    },
    {
      role: "PASSIVE",
      ruleId: "component-role.passive.designator.v1",
      matched: /^(?:R|C|L|FB)$/u.test(prefix)
    }
  ];
  const matched = tests
    .filter((candidate) => candidate.matched)
    .map(
      (candidate): IrComponentRoleCandidate => {
        const usesPinEvidence =
          candidate.ruleId.includes(".pin-structure.") ||
          candidate.ruleId.includes(".explicit-pin.") ||
          candidate.ruleId.includes(".explicit-net.");
        return {
          role: candidate.role,
          ruleId: candidate.ruleId,
          evidenceClass: "DETERMINISTIC_RULE",
          truthStatus: "CANDIDATE",
          semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
          provenance: usesPinEvidence
            ? uniqueProvenance([
                ...provenance,
                ...group.pins.flatMap((pin) => [
                  pin.provenance.component,
                  pin.provenance.symbolPin
                ])
              ])
            : provenance
        };
      }
    );
  if (matched.length > 0) {
    return matched.sort(
      (left, right) =>
        ROLE_PRIORITY.indexOf(left.role) - ROLE_PRIORITY.indexOf(right.role)
    );
  }
  return [
    {
      role: "UNKNOWN",
      ruleId: "component-role.unresolved.v1",
      evidenceClass: "DETERMINISTIC_RULE",
      truthStatus: "UNRESOLVED",
      semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
      provenance
    }
  ];
}

function powerRelationship(
  pinName: string | undefined,
  roles: readonly IrComponentRoleCandidate[]
): IrComponentPowerDomainCandidate["relationship"] {
  const normalized = pinName?.toLocaleUpperCase("en-US") ?? "";
  if (/(?:^|[_/])(?:GND|AGND|DGND|VSS|VSSA)(?:$|[_/])/u.test(normalized)) {
    return "GROUND";
  }
  if (
    /(?:^|[_/])(?:VIN|VBUS|VBAT|DCIN|IN)(?:$|[_/])/u.test(normalized) ||
    roles.some((role) => role.role === "POWER_INPUT")
  ) {
    return "INPUT";
  }
  if (
    /(?:^|[_/])(?:VOUT|OUT|SW)(?:$|[_/])/u.test(normalized) &&
    roles.some(
      (role) =>
        role.role === "LDO" ||
        role.role === "DC_DC" ||
        role.role === "POWER_SWITCH_CANDIDATE"
    )
  ) {
    return "OUTPUT";
  }
  return "RELATED";
}

function isPowerNet(pin: IrPinInstance, netName: string): boolean {
  const text = `${pin.name ?? ""}\n${netName}`.toLocaleUpperCase("en-US");
  return /(?:^|[^A-Z0-9])(?:GND|AGND|DGND|VSS|VSSA|VDD|VDDA|VCC|AVCC|VBAT|VBUS|VIN|VOUT|VREF|[0-9]+V[0-9]*)(?:[^A-Z0-9]|$)/u.test(
    text
  );
}

function powerDomains(
  group: LogicalComponentGroup,
  roles: readonly IrComponentRoleCandidate[]
): readonly IrComponentPowerDomainCandidate[] {
  const domains = new Map<
    string,
    {
      pageId: string;
      netName: string;
      relationship: IrComponentPowerDomainCandidate["relationship"];
      pins: IrPinInstance[];
    }
  >();
  for (const pin of group.pins) {
    if (pin.connectionCandidate.status !== "UNIQUE_EXPLICIT_NET_CANDIDATE") {
      continue;
    }
    const net = pin.connectionCandidate.explicitNets[0];
    if (net === undefined || !isPowerNet(pin, net.netName)) continue;
    const relationship = powerRelationship(pin.name, roles);
    const key = `${pin.pageId}\n${net.netName}\n${relationship}`;
    const domain = domains.get(key) ?? {
      pageId: pin.pageId,
      netName: net.netName,
      relationship,
      pins: []
    };
    domain.pins.push(pin);
    domains.set(key, domain);
  }
  return [...domains.values()]
    .map(
      (domain): IrComponentPowerDomainCandidate => ({
        id: sha256CanonicalJson([
          "power-domain",
          domain.pageId,
          domain.netName,
          domain.relationship,
          group.logicalComponentId
        ]),
        name: domain.netName,
        pageId: domain.pageId,
        netName: domain.netName,
        relationship: domain.relationship,
        pinInstanceIds: domain.pins.map((pin) => pin.id).sort(compareText),
        isolationStatus: roles.some(
          (role) => role.role === "ISOLATOR_CANDIDATE"
        )
          ? "ISOLATION_CANDIDATE"
          : "NOT_INDICATED",
        ruleId: "power-domain.explicit-pin-net.v1",
        evidenceClass: "DETERMINISTIC_RULE",
        truthStatus: "CANDIDATE",
        semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
        provenance: uniqueProvenance(
          domain.pins.flatMap((pin) => [
            pin.provenance.component,
            pin.provenance.symbolPin
          ])
        )
      })
    )
    .sort(
      (left, right) =>
        compareText(left.pageId, right.pageId) ||
        compareText(left.netName, right.netName) ||
        compareText(left.relationship, right.relationship)
    );
}

function semanticForGroup(
  group: LogicalComponentGroup,
  devicesById: ReadonlyMap<string, IrDevice>,
  symbolsById: ReadonlyMap<string, IrSymbol>
): readonly IrComponentSemantic[] {
  const provenance = groupProvenance(group, devicesById, symbolsById);
  const roles = roleCandidates(
    group,
    groupCorpus(group, devicesById, symbolsById),
    provenance
  );
  const primaryRole = roles[0]?.role ?? "UNKNOWN";
  const domains = powerDomains(group, roles);
  const semanticProvenance = uniqueProvenance([
    ...roles.flatMap((role) => role.provenance),
    ...domains.flatMap((domain) => domain.provenance)
  ]);
  const unitComponentIds = group.components.map((component) => component.id);
  return group.components.map(
    (component): IrComponentSemantic => ({
      id: sha256CanonicalJson([
        "component-semantic",
        component.pageId,
        component.id,
        SEMANTIC_RULE_SET_VERSION
      ]),
      componentId: component.id,
      pageId: component.pageId,
      logicalComponentId: group.logicalComponentId,
      unitComponentIds,
      primaryRole,
      roles,
      powerDomains: domains,
      ruleId: "component.semantic.aggregate.v1",
      evidenceClass: "DETERMINISTIC_RULE",
      truthStatus: primaryRole === "UNKNOWN" ? "UNRESOLVED" : "CANDIDATE",
      semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
      provenance: semanticProvenance
    })
  );
}

function normalizedAliases(pin: IrPinInstance): readonly string[] {
  if (
    pin.connectionCandidate.status === "UNRESOLVED_NO_WIRE" ||
    pin.connectionCandidate.status === "DECLARED_NO_CONNECT"
  ) {
    return [];
  }
  const values = [
    ...(pin.name === undefined ? [] : [pin.name]),
    ...pin.connectionCandidate.explicitNets.map((net) => net.netName)
  ];
  return [
    ...new Set(
      values.flatMap((value) =>
        value
          .toLocaleUpperCase("en-US")
          .replaceAll("D+", "DP")
          .replaceAll("D-", "DM")
          .split(/[\s/,;|]+/u)
          .map((token) => token.replace(/^[^A-Z0-9]+|[^A-Z0-9_+-]+$/gu, ""))
          .filter((token) => token.length > 0)
      )
    )
  ].sort(compareText);
}

function matchAlias(alias: string, pin: IrPinInstance): readonly InterfaceSignalMatch[] {
  const matches: InterfaceSignalMatch[] = [];
  const add = (type: IrInterfaceType, group: string, signal: string): void => {
    matches.push({ type, group, signal, pin });
  };
  if (alias === "SWDIO" || alias.endsWith("_SWDIO")) add("SWD", "SWD", "SWDIO");
  if (alias === "SWCLK" || alias.endsWith("_SWCLK")) add("SWD", "SWD", "SWCLK");
  if (alias === "SWO" || alias.endsWith("_SWO")) add("SWD", "SWD", "SWO");

  const jtag = alias.match(/(?:^|_)(?:J?T)(MS|CK|DI|DO|RST)$/u);
  if (jtag !== null) {
    const signal = ({ MS: "TMS", CK: "TCK", DI: "TDI", DO: "TDO", RST: "TRST" } as const)[
      jtag[1] as "MS" | "CK" | "DI" | "DO" | "RST"
    ];
    add("JTAG", "JTAG", signal);
  }

  const uart = alias.match(/(?:^|_)(?:USART|UART|LPUART)([0-9]*)_(TX|RX|CTS|RTS|CK)$/u);
  if (uart !== null) add("UART", `UART:${uart[1] || "DEFAULT"}`, uart[2] as string);

  const i2c = alias.match(/(?:^|_)I2C([0-9]*)_(SCL|SDA|SMBA)$/u);
  if (i2c !== null) add("I2C", `I2C:${i2c[1] || "DEFAULT"}`, i2c[2] as string);
  if (alias === "SCL" || alias === "SDA") add("I2C", "I2C:DEFAULT", alias);

  const qspi = alias.match(/(?:^|_)(?:QUADSPI|QSPI|OSPI)([0-9]*)_(CLK|N?CS|IO[0-7]|D[0-7])$/u);
  if (qspi !== null) {
    const signal = qspi[2] === "NCS" ? "CS" : qspi[2] === "CLK" ? "CLK" : (qspi[2] as string).replace(/^D/u, "IO");
    add("QSPI", `QSPI:${qspi[1] || "DEFAULT"}`, signal);
  }

  const spi = alias.match(/(?:^|_)SPI([0-9]*)_(SCK|SCLK|MOSI|MISO|NSS|CS)$/u);
  if (spi !== null) {
    const signal = spi[2] === "SCLK" ? "SCK" : spi[2] === "NSS" ? "CS" : (spi[2] as string);
    add("SPI", `SPI:${spi[1] || "DEFAULT"}`, signal);
  }

  const can = alias.match(/(?:^|_)(?:FDCAN|CAN)([0-9]*)_(TX|RX|H|L)$/u);
  if (can !== null) add("CAN", `CAN:${can[1] || "DEFAULT"}`, can[2] as string);
  if (alias === "CANH" || alias === "CANL") add("CAN", "CAN:DEFAULT", alias.slice(-1));

  const usb = alias.match(/(?:^|_)USB(?:_OTG)?(?:_(FS|HS))?_(DP|DM|VBUS|ID)$/u);
  if (usb !== null) add("USB", `USB:${usb[1] || "DEFAULT"}`, usb[2] as string);

  const ethernet = alias.match(/(?:^|_)(RMII|MII)_(TXD[0-3]|RXD[0-3]|TX_EN|CRS_DV|RX_DV|MDC|MDIO|REF_CLK|TX_CLK|RX_CLK)$/u);
  if (ethernet !== null) add("ETHERNET", `ETHERNET:${ethernet[1]}`, ethernet[2] as string);

  const sdio = alias.match(/(?:^|_)(?:SDIO|SDMMC)([0-9]*)_(CK|CLK|CMD|D[0-7])$/u);
  if (sdio !== null) add("SDIO", `SDIO:${sdio[1] || "DEFAULT"}`, sdio[2] === "CLK" ? "CK" : (sdio[2] as string));

  const audio = alias.match(/(?:^|_)(I2S|SAI)([0-9]*)(?:_[AB])?_(M?CK|SCK|BCK|WS|LRCK|SD|SDI|SDO)$/u);
  if (audio !== null) {
    const raw = audio[3] as string;
    const signal = /^(?:M?CK|SCK|BCK)$/u.test(raw) ? "CK" : /^(?:WS|LRCK)$/u.test(raw) ? "WS" : "SD";
    add("I2S_SAI", `${audio[1]}:${audio[2] || "DEFAULT"}`, signal);
  }

  const analog = alias.match(/(?:^|_)(ADC|DAC)([0-9]*)_(IN|OUT)([0-9]+)$/u);
  if (analog !== null) add("ANALOG", `${analog[1]}:${analog[2] || "DEFAULT"}`, `${analog[3]}${analog[4]}`);

  const gpio = alias.match(/^P([A-K])([0-9]{1,2})$/u);
  if (gpio !== null) add("GPIO_GROUP", `GPIO:${gpio[1]}`, alias);
  return matches;
}

function interfaceMatches(group: LogicalComponentGroup): readonly InterfaceSignalMatch[] {
  const matches = group.pins.flatMap((pin) =>
    normalizedAliases(pin).flatMap((alias) => matchAlias(alias, pin))
  );
  return [
    ...new Map(
      matches.map((match) => [
        `${match.type}\n${match.group}\n${match.signal}\n${match.pin.id}`,
        match
      ])
    ).values()
  ].sort(
    (left, right) =>
      compareText(left.type, right.type) ||
      compareText(left.group, right.group) ||
      compareText(left.signal, right.signal) ||
      compareText(left.pin.id, right.pin.id)
  );
}

function requiredSignals(
  type: IrInterfaceType,
  signals: ReadonlySet<string>
): readonly string[] {
  switch (type) {
    case "SWD":
      return ["SWDIO", "SWCLK"];
    case "JTAG":
      return ["TMS", "TCK", "TDI", "TDO"];
    case "UART":
      return ["TX", "RX"];
    case "I2C":
      return ["SCL", "SDA"];
    case "SPI":
      return ["SCK", "MOSI", "MISO"];
    case "QSPI":
      return ["CLK", "CS", "IO0", "IO1", "IO2", "IO3"];
    case "CAN":
      return signals.has("H") || signals.has("L") ? ["H", "L"] : ["TX", "RX"];
    case "USB":
      return ["DP", "DM"];
    case "ETHERNET":
      return ["TXD0", "TXD1", "RXD0", "RXD1", "TX_EN", "CRS_DV", "REF_CLK"];
    case "SDIO":
      return ["CK", "CMD", "D0"];
    case "I2S_SAI":
      return ["CK", "WS", "SD"];
    case "ANALOG":
    case "GPIO_GROUP":
      return [];
  }
}

function activityStatus(group: LogicalComponentGroup): IrInterfaceActivityStatus {
  const statuses = new Set(group.components.map((component) => component.assembly.status));
  if (statuses.size === 1 && statuses.has("DNP")) return "EXCLUDED_DNP";
  if (statuses.size === 1 && statuses.has("POPULATED")) return "ACTIVE";
  return "ASSEMBLY_UNKNOWN";
}

function compileInterfaces(group: LogicalComponentGroup): readonly IrInterface[] {
  const matches = interfaceMatches(group);
  const grouped = new Map<string, InterfaceSignalMatch[]>();
  for (const match of matches) {
    const key = `${match.type}\n${match.group}`;
    const items = grouped.get(key) ?? [];
    items.push(match);
    grouped.set(key, items);
  }
  return [...grouped.entries()]
    .map(([key, items]): IrInterface => {
      const [type, interfaceGroup] = key.split("\n") as [IrInterfaceType, string];
      const bySignal = new Map<string, InterfaceSignalMatch[]>();
      for (const item of items) {
        const signalItems = bySignal.get(item.signal) ?? [];
        signalItems.push(item);
        bySignal.set(item.signal, signalItems);
      }
      const signals: readonly IrInterfaceSignal[] = [...bySignal.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([signal, signalItems]) => ({
          signal,
          pinInstanceIds: signalItems.map((item) => item.pin.id).sort(compareText),
          pinNames: [
            ...new Set(
              signalItems.flatMap((item) =>
                item.pin.name === undefined ? [] : [item.pin.name]
              )
            )
          ].sort(compareText),
          explicitNetNames: [
            ...new Set(
              signalItems.flatMap((item) =>
                item.pin.connectionCandidate.explicitNets.map((net) => net.netName)
              )
            )
          ].sort(compareText),
          provenance: uniqueProvenance(
            signalItems.flatMap((item) => [
              item.pin.provenance.component,
              item.pin.provenance.symbolPin
            ])
          )
        }));
      const observed = new Set(signals.map((signal) => signal.signal));
      const required = requiredSignals(type, observed);
      const missing = required.filter((signal) => !observed.has(signal));
      const completeness = group.components[0]?.pinCompleteness.status ?? "UNKNOWN";
      const activity = activityStatus(group);
      const duplicate = signals.some((signal) => signal.pinInstanceIds.length > 1);
      const connectionUnresolved = items.some(
        (item) =>
          item.pin.connectionCandidate.status !==
          "UNIQUE_EXPLICIT_NET_CANDIDATE"
      );
      const unresolvedReasons = [
        ...(duplicate ? (["DUPLICATE_SIGNAL_ASSIGNMENT"] as const) : []),
        ...(completeness === "UNKNOWN" ? (["PIN_COMPLETENESS_UNKNOWN"] as const) : []),
        ...(connectionUnresolved
          ? (["CONNECTION_CANDIDATE_UNRESOLVED"] as const)
          : []),
        ...(activity === "ASSEMBLY_UNKNOWN" ? (["ASSEMBLY_UNKNOWN"] as const) : [])
      ];
      let status: IrInterfaceStatus;
      if (unresolvedReasons.length > 0) status = "UNRESOLVED";
      else if (missing.length > 0) status = "PARTIAL_CANDIDATE";
      else status = "CANDIDATE";
      const provenance = uniqueProvenance(
        items.flatMap((item) => [
          item.pin.provenance.component,
          item.pin.provenance.symbol,
          item.pin.provenance.symbolPin
        ])
      );
      return {
        id: sha256CanonicalJson([
          "interface",
          group.logicalComponentId,
          type,
          interfaceGroup,
          SEMANTIC_RULE_SET_VERSION
        ]),
        type,
        group: interfaceGroup,
        logicalComponentId: group.logicalComponentId,
        componentRefs: group.components.map((component) => ({
          componentId: component.id,
          pageId: component.pageId
        })),
        status,
        activityStatus: activity,
        signals,
        requiredSignals: required,
        missingSignals: missing,
        unresolvedReasons,
        ruleId: `interface.${type.toLocaleLowerCase("en-US").replace("_", "-")}.signal-set.v1`,
        evidenceClass: "DETERMINISTIC_RULE",
        truthStatus: status === "UNRESOLVED" ? "UNRESOLVED" : "CANDIDATE",
        semanticRuleSetVersion: SEMANTIC_RULE_SET_VERSION,
        provenance
      };
    })
    .sort(
      (left, right) =>
        compareText(left.type, right.type) ||
        compareText(left.group, right.group) ||
        compareText(left.id, right.id)
    );
}

export function compileSemantics(
  components: readonly IrComponent[],
  devices: readonly IrDevice[],
  symbols: readonly IrSymbol[],
  pins: readonly IrPinInstance[]
): SemanticCompilationResult {
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const groups = logicalGroups(components, pins);
  return {
    componentSemantics: groups
      .flatMap((group) => semanticForGroup(group, devicesById, symbolsById))
      .sort(
        (left, right) =>
          compareText(left.pageId, right.pageId) ||
          compareText(left.componentId, right.componentId)
      ),
    interfaces: groups.flatMap(compileInterfaces).sort(
      (left, right) =>
        compareText(left.type, right.type) ||
        compareText(left.group, right.group) ||
        compareText(left.id, right.id)
    )
  };
}
