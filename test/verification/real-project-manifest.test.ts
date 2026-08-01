import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseRealProjectManifest,
  RealProjectManifestError
} from "../../src/verification/real-project-manifest.js";

const HASH = "a".repeat(64);

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
      requiredDnpDesignators: ["C1", "C2"]
    }
  };
}

function manifest(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: "1.0.0",
    baselineId: "v0.2-m1",
    packageAcceptanceSampleId: "real-02",
    samples: [sample("real-02"), sample("real-01")]
  };
}

test("真实工程私有清单严格解析、排序并保留里程碑基线", () => {
  const parsed = parseRealProjectManifest(manifest());
  assert.equal(parsed.baselineId, "v0.2-m1");
  assert.deepEqual(
    parsed.samples.map((item) => item.sampleId),
    ["real-01", "real-02"]
  );
  assert.equal(
    parsed.samples[0]?.assemblyBaseline?.requiredDnpDesignators.length,
    2
  );
});

test("真实工程清单拒绝未知字段、重复样本和不守恒计数", () => {
  assert.throws(
    () => parseRealProjectManifest({ ...manifest(), privateNote: "x" }),
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
  const broken = sample("real-02");
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
});
