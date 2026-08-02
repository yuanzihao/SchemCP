import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseRealProjectManifest,
  REAL_PROJECT_COMPONENT_ROLES,
  REAL_PROJECT_INTERFACE_MATRIX_KEYS,
  REAL_PROJECT_INTERFACE_TYPES,
  REAL_PROJECT_RESOURCE_EDGE_KINDS,
  REAL_PROJECT_RESOURCE_TYPES,
  RealProjectManifestError
} from "../../src/verification/real-project-manifest.js";

const HASH = "a".repeat(64);

function semanticBaseline(): Readonly<Record<string, unknown>> {
  return {
    componentSemantics: 5,
    componentSemanticsUnknownRole: 4,
    componentPowerDomainCandidates: 2,
    roles: Object.fromEntries(
      REAL_PROJECT_COMPONENT_ROLES.map((role) => [
        role,
        role === "MCU_MPU" ? 1 : role === "UNKNOWN" ? 4 : 0
      ])
    ),
    interfaces: 1,
    interfacesByType: Object.fromEntries(
      REAL_PROJECT_INTERFACE_TYPES.map((type) => [
        type,
        Object.fromEntries(
          REAL_PROJECT_INTERFACE_MATRIX_KEYS.map((key) => [
            key,
            type === "SWD" && key === "candidateActive" ? 1 : 0
          ])
        )
      ])
    ),
    requiredMcuActiveInterfaceTypes: ["SWD"]
  };
}

function resourceBaseline(): Readonly<Record<string, unknown>> {
  const nonzeroKinds = new Map<string, number>([
    ["POWER_CONVERSION", 1],
    ["POWER_LOAD", 1],
    ["CLOCK_SOURCE_OUTPUT", 1],
    ["CLOCK_SINK_INPUT", 1],
    ["RESET_SINK_INPUT", 1],
    ["BOOT_BIAS_CANDIDATE", 1],
    ["MCU_PIN_CONNECTION", 1]
  ]);
  return {
    resourceEdges: 7,
    byType: Object.fromEntries(
      REAL_PROJECT_RESOURCE_TYPES.map((type) => [
        type,
        type === "POWER" || type === "CLOCK" || type === "RESET_BOOT" ? 2 : 1
      ])
    ),
    byKind: Object.fromEntries(
      REAL_PROJECT_RESOURCE_EDGE_KINDS.map((kind) => [
        kind,
        nonzeroKinds.get(kind) ?? 0
      ])
    ),
    byStatus: { candidate: 7, unresolved: 0 },
    byActivity: { active: 7, excludedDnp: 0, assemblyUnknown: 0 },
    mcuPinUsage: {
      mcuCount: 1,
      pins: 2,
      usedBoundNetlist: 1,
      usedCandidate: 0,
      unusedConfirmed: 1,
      unknown: 0,
      byResourceStatus: {
        used: 1,
        explicitNc: 0,
        unused: 1,
        unknown: 0,
        dnpComponent: 0
      }
    },
    requiredKinds: [
      "POWER_CONVERSION",
      "CLOCK_SOURCE_OUTPUT",
      "CLOCK_SINK_INPUT",
      "RESET_SINK_INPUT",
      "MCU_PIN_CONNECTION"
    ]
  };
}

function sample(sampleId: string): Readonly<Record<string, unknown>> {
  return {
    sampleId,
    projectPath: path.join(tmpdir(), `${sampleId}.epro2`),
    netlistPath: path.join(tmpdir(), `${sampleId}.enet`),
    sourceSha256: HASH,
    netlistSha256: "b".repeat(64),
    expectedDiagnostics: { count: 2, sha256: "c".repeat(64) },
    comparisonBaseline: {
      status: "DIFFERENCES_FOUND",
      candidateTupleCount: 10,
      truthTupleCount: 12,
      matched: 9,
      missingInCandidate: 3,
      unexpectedCandidate: 1,
      candidateDuplicates: 0,
      truthDuplicates: 0,
      excludedCandidatePins: 2
    },
    semanticBaseline: semanticBaseline(),
    resourceBaseline: resourceBaseline(),
    hierarchyBaseline: {
      instanceDocuments: 1,
      instanceContexts: 1,
      instanceContextsResolved: 1,
      instanceContextsUnresolved: 0,
      instanceAttributeOverrides: 2,
      instanceAttributeOverridesAppliedToComponents: 1,
      instanceAttributeOverridesAppliedToPins: 0,
      instanceAttributeOverridesUnresolved: 1,
      componentOccurrences: 3
    },
    assemblyBaseline: {
      attributeKey: "Add into BOM",
      dnpValue: "no",
      attributeCount: 4,
      explicitDnpCount: 3,
      requiredDnpDesignators: ["C1", "C2"],
      components: 5,
      componentsPopulated: 1,
      componentsDnp: 3,
      componentsAssemblyUnknown: 1,
      logicalComponents: 4,
      logicalComponentsComplete: 3,
      logicalComponentsPartial: 0,
      logicalComponentsUnknown: 1,
      completeMultiUnitLogicalComponents: 1,
      symbolPins: 12,
      symbolPinsHidden: 1
    },
    busBaseline: {
      buses: 2,
      busesWithExplicitNet: 2,
      busesObservedEmbedded: 1,
      busesOfficialSeparate: 1,
      busesHybrid: 0,
      busesWithEmptyEntrySet: 1,
      busSegments: 2,
      busEntries: 3,
      busEntriesEmbedded: 2,
      busEntriesSeparate: 1,
      busEntriesUnbound: 1
    }
  };
}

function manifest(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "1.5.0",
    baselineId: "v0.2-m5",
    packageAcceptanceSampleId: "real-02",
    packageAssemblyAcceptanceSampleId: "real-01",
    packageSemanticAcceptanceSampleId: "real-02",
    packageResourceAcceptanceSampleId: "real-02",
    packageMcuPinAcceptanceSampleId: "real-02",
    samples: [sample("real-02"), sample("real-01")]
  };
}

test("真实工程私有清单严格解析、排序并保留里程碑基线", () => {
  const parsed = parseRealProjectManifest(manifest());
  assert.equal(parsed.baselineId, "v0.2-m5");
  assert.deepEqual(
    parsed.samples.map((item) => item.sampleId),
    ["real-01", "real-02"]
  );
  assert.equal(
    parsed.samples[0]?.assemblyBaseline?.requiredDnpDesignators.length,
    2
  );
  assert.equal(parsed.samples[0]?.busBaseline?.busEntries, 3);
  assert.equal(parsed.samples[0]?.semanticBaseline.roles.MCU_MPU, 1);
  assert.equal(parsed.samples[0]?.resourceBaseline.byType.POWER, 2);
});

test("真实工程清单拒绝未知字段、重复样本和不守恒计数", () => {
  const broken = sample("real-02");
  assert.throws(
    () => parseRealProjectManifest({ ...manifest(), privateNote: "x" }),
    (error: unknown) => error instanceof RealProjectManifestError
  );
  assert.throws(
    () =>
      parseRealProjectManifest({
        ...manifest(),
        samples: [
          {
            ...broken,
            resourceBaseline: {
              ...(broken.resourceBaseline as Record<string, unknown>),
              resourceEdges: 8
            }
          }
        ]
      }),
    (error: unknown) => error instanceof RealProjectManifestError
  );
  assert.throws(
    () =>
      parseRealProjectManifest({
        ...manifest(),
        samples: [sample("real-01"), sample("real-01")]
      }),
    (error: unknown) => error instanceof RealProjectManifestError
  );
  assert.throws(
    () =>
      parseRealProjectManifest({
        ...manifest(),
        samples: [
          {
            ...broken,
            hierarchyBaseline: {
              ...(broken.hierarchyBaseline as Record<string, unknown>),
              instanceContextsUnresolved: 1
            }
          }
        ]
      }),
    (error: unknown) => error instanceof RealProjectManifestError
  );
  assert.throws(
    () =>
      parseRealProjectManifest({
        ...manifest(),
        samples: [
          {
            ...broken,
            busBaseline: {
              ...(broken.busBaseline as Record<string, unknown>),
              busEntriesSeparate: 2
            }
          }
        ]
      }),
    (error: unknown) => error instanceof RealProjectManifestError
  );
  assert.throws(
    () =>
      parseRealProjectManifest({
        ...manifest(),
        samples: [
          {
            ...broken,
            semanticBaseline: {
              ...(broken.semanticBaseline as Record<string, unknown>),
              interfaces: 2
            }
          }
        ]
      }),
    (error: unknown) => error instanceof RealProjectManifestError
  );
});
