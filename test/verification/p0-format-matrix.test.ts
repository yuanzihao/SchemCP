import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { compileProject } from "../../src/application/compile-project.js";
import {
  canonicalJson,
  sha256CanonicalJson
} from "../../src/core/canonical-json.js";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { buildNetlistComparisonReport } from "../../src/truth/compare-netlist-evidence.js";
import { parseJlcEdaProBom } from "../../src/truth/jlceda-pro-bom.js";
import { parseJlcEdaProEnet } from "../../src/truth/jlceda-pro-enet.js";
import {
  parseP0FormatMatrix,
  verifyP0FormatMatrix,
  type P0FormatMatrix
} from "../../src/verification/p0-format-matrix.js";
import {
  createGoldenManifest
} from "../../src/verification/golden-manifest.js";
import { parseP0ReferenceScreenshot } from "../../src/verification/reference-screenshot.js";
import { createPngFixture } from "../helpers/png-fixture.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const execFile = promisify(execFileCallback);
const PRIVATE_TITLE = "PRIVATE_MATRIX_TITLE";
const PNG_1X1 = createPngFixture();
const EPRU = [
  '{"type":"DOCHEAD"}||{"docType":"SCH","client":"c","uuid":"schematic-1"}|',
  '{"type":"META","ticket":1}||{"name":"Private Schematic"}|',
  '{"type":"DOCHEAD"}||{"docType":"SCH_PAGE","client":"c","uuid":"page-1"}|',
  `{"type":"META","ticket":2}||{"title":"${PRIVATE_TITLE}","schematic":"schematic-1"}|`
].join("\n");

function enet(): string {
  return JSON.stringify({
    version: "2.0.0",
    components: {},
    designRule: {},
    netClass: {},
    equalLengthNetGroup: {},
    differentialPair: {}
  });
}

function bom(): Buffer {
  return Buffer.from(
    [
      "\ufeffNo.\tQuantity\tComment\tDesignator\tFootprint\tValue\tManufacturer Part\tManufacturer\tSupplier Part\tSupplier",
      "1\t1\t10k\tR1\tR0603\t10k\tRC0603\tVendor\tC1\tLCSC"
    ].join("\r\n"),
    "utf16le"
  );
}

async function fixture(): Promise<{
  readonly directory: string;
  readonly projectPath: string;
  readonly netlistPath: string;
  readonly bomPath: string;
  readonly screenshotPath: string;
  readonly goldenDirectory: string;
  readonly matrixPath: string;
  readonly bindingsPath: string;
  readonly matrix: P0FormatMatrix;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-p0-matrix-test-"));
  const projectPath = path.join(directory, "private-project.epro2");
  const netlistPath = path.join(directory, "private-netlist.enet");
  const bomPath = path.join(directory, "private-bom.csv");
  const screenshotPath = path.join(directory, "private-sheet.png");
  const goldenDirectory = path.join(directory, "golden");
  const matrixPath = path.join(directory, "matrix.json");
  const bindingsPath = path.join(directory, "bindings.json");
  await mkdir(goldenDirectory);
  await Promise.all([
    writeFile(
      projectPath,
      createStoredZip([{ name: "fixture.epru", data: EPRU }])
    ),
    writeFile(netlistPath, enet(), { mode: 0o600 }),
    writeFile(bomPath, bom(), { mode: 0o600 }),
    writeFile(screenshotPath, PNG_1X1, { mode: 0o600 })
  ]);
  const ir = await compileProject(projectPath);
  const golden = createGoldenManifest("golden-synthetic-matrix", ir);
  const goldenManifestSha256 = sha256CanonicalJson(golden);
  await writeFile(
    path.join(goldenDirectory, "golden-synthetic-matrix.json"),
    `${JSON.stringify(golden, null, 2)}\n`
  );
  const parsedNetlist = parseJlcEdaProEnet(Buffer.from(enet()));
  const report = buildNetlistComparisonReport(
    ir,
    Buffer.from(enet()),
    parsedNetlist
  );
  const parsedBom = parseJlcEdaProBom(bom());
  const parsedScreenshot = parseP0ReferenceScreenshot(PNG_1X1);
  const matrix = parseP0FormatMatrix({
    schemaVersion: "0.2.0",
    matrixId: "p0-synthetic-matrix",
    requiredFeatures: [
      "SINGLE_PAGE",
      "MULTI_PAGE",
      "HIERARCHICAL_SCHEMATIC",
      "MULTI_UNIT_COMPONENT",
      "BUS",
      "GLOBAL_NET",
      "CUSTOM_SYMBOL",
      "CUSTOM_DEVICE",
      "VARIANT",
      "DNP",
      "NET_TIE",
      "ZERO_OHM",
      "FERRITE_BEAD",
      "MULTI_POWER_DOMAIN",
      "STM32_MINIMUM_SYSTEM",
      "USB",
      "CAN",
      "ETHERNET",
      "SD_CARD"
    ],
    entries: [
      {
        fixtureId: "golden-synthetic-matrix",
        goldenManifestFile: "golden-synthetic-matrix.json",
        goldenManifestSha256,
        featureEvidence: [
          {
            feature: "SINGLE_PAGE",
            assertion: {
              kind: "SUMMARY_VALUE",
              metric: "schematicPages",
              condition: "EXACT",
              expected: 1
            }
          }
        ],
        expectedComparison: {
          netlistSha256: report.netlist.sha256,
          reportSha256: report.reportSha256,
          formatVersion: "2.0.0",
          componentCount: 0,
          pinEntryCount: 0,
          connectedPinEntryCount: 0,
          unconnectedPinEntryCount: 0,
          candidateTupleCount: 0,
          truthTupleCount: 0,
          matchedTupleCount: 0,
          missingInCandidateCount: 0,
          unexpectedCandidateCount: 0,
          excludedCandidatePinCount: 0,
          officialNetlistComparison: "EXACT_SET_MATCH",
          sourceAuthenticity: "NOT_VERIFIED",
          projectBinding: "NOT_VERIFIED",
          electricalTruth: "NOT_VERIFIED"
        },
        expectedArtifacts: {
          bom: {
            format: parsedBom.format,
            sha256: parsedBom.sha256,
            bytes: parsedBom.bytes,
            lineItemCount: parsedBom.lineItemCount,
            quantityTotal: parsedBom.quantityTotal,
            designatorCount: parsedBom.designatorCount,
            designatorTableSha256: parsedBom.designatorTableSha256,
            rowTableSha256: parsedBom.rowTableSha256,
            sourceAuthenticity: parsedBom.sourceAuthenticity,
            projectBinding: parsedBom.projectBinding
          },
          referenceScreenshots: [
            {
              evidenceId: "sheet-01",
              ...parsedScreenshot,
              acquisitionMethod: "USER_CAPTURED_GUI"
            }
          ],
          expectedTables: {
            componentTable: {
              source: "JLCEDA_PRO_ENET_V2_COMPONENTS",
              rowCount: parsedNetlist.componentRefs.length,
              sha256: sha256CanonicalJson(parsedNetlist.componentRefs)
            },
            pinNetworkTable: {
              source: "JLCEDA_PRO_ENET_V2_CONNECTED_PINS",
              rowCount: parsedNetlist.tuples.length,
              sha256: sha256CanonicalJson(parsedNetlist.tuples)
            }
          }
        }
      }
    ]
  });
  await Promise.all([
    writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`),
    writeFile(
      bindingsPath,
      `${JSON.stringify(
        {
          schemaVersion: "0.2.0",
          matrixId: matrix.matrixId,
          entries: [
            {
              fixtureId: "golden-synthetic-matrix",
              projectPath,
              netlistPath,
              bomPath,
              referenceScreenshots: [
                {
                  evidenceId: "sheet-01",
                  path: screenshotPath
                }
              ]
            }
          ]
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    )
  ]);
  return {
    directory,
    projectPath,
    netlistPath,
    bomPath,
    screenshotPath,
    goldenDirectory,
    matrixPath,
    bindingsPath,
    matrix
  };
}

test("P0 格式矩阵联合验证黄金 IR、网表比较和机器特性证据", async () => {
  const {
    projectPath,
    netlistPath,
    bomPath,
    screenshotPath,
    matrixPath,
    goldenDirectory,
    bindingsPath
  } = await fixture();
  const result = await verifyP0FormatMatrix(
    matrixPath,
    goldenDirectory,
    bindingsPath
  );
  assert.equal(result.ok, true);
  assert.equal(result.gate, "P0_FORMAT_MATRIX_ENTRIES_VERIFIED");
  assert.equal(result.entryCount, 1);
  assert.equal(result.verifiedEntryCount, 1);
  assert.equal(result.requiredFeatureCoverage.covered, 1);
  assert.equal(result.requiredFeatureCoverage.total, 19);
  assert.deepEqual(result.requiredFeatureCoverage.coveredFeatures, [
    "SINGLE_PAGE"
  ]);
  assert.equal(result.requiredFeatureCoverage.gaps.includes("MULTI_PAGE"), true);
  assert.equal(result.p0ExitCriteria, "NOT_MET_ENTRY_COUNT");
  assert.equal(result.results[0]?.officialNetlistComparison, "EXACT_SET_MATCH");
  assert.equal(result.results[0]?.bomLineItemCount, 1);
  assert.equal(result.results[0]?.bomDesignatorCount, 1);
  assert.equal(result.results[0]?.referenceScreenshotCount, 1);
  assert.equal(result.electricalTruth, "NOT_VERIFIED");
  assert.equal(canonicalJson(result).includes(PRIVATE_TITLE), false);

  const cli = await execFile(
    process.execPath,
    [
      path.resolve("dist/src/verification/verify-p0-format-matrix.js"),
      matrixPath,
      goldenDirectory,
      bindingsPath
    ],
    { encoding: "utf8" }
  );
  assert.equal(JSON.parse(cli.stdout).ok, true);
  assert.equal(cli.stdout.includes(projectPath), false);
  assert.equal(cli.stdout.includes(netlistPath), false);
  assert.equal(cli.stdout.includes(bomPath), false);
  assert.equal(cli.stdout.includes(screenshotPath), false);
  assert.equal(cli.stdout.includes(PRIVATE_TITLE), false);
});

test("P0 格式矩阵差异只输出匿名字段，不泄露私有路径或工程事实", async () => {
  const {
    projectPath,
    netlistPath,
    bomPath,
    screenshotPath,
    goldenDirectory,
    matrixPath,
    bindingsPath,
    matrix
  } = await fixture();
  const mismatched: P0FormatMatrix = {
    ...matrix,
    entries: [
      {
        ...matrix.entries[0]!,
        expectedComparison: {
          ...matrix.entries[0]!.expectedComparison,
          truthTupleCount: 1,
          missingInCandidateCount: 1
        }
      }
    ]
  };
  await writeFile(matrixPath, `${JSON.stringify(mismatched, null, 2)}\n`);
  const cliPath = path.resolve(
    "dist/src/verification/verify-p0-format-matrix.js"
  );
  const failure = await execFile(
    process.execPath,
    [cliPath, matrixPath, goldenDirectory, bindingsPath],
    { encoding: "utf8" }
  ).catch(
    (error: unknown) =>
      error as {
        readonly code: number;
        readonly stdout: string;
        readonly stderr: string;
      }
  );
  assert.equal("code" in failure ? failure.code : 0, 1);
  const stderr = "stderr" in failure ? failure.stderr : "";
  const receipt = JSON.parse(stderr) as {
    readonly gate: string;
    readonly mismatchCount: number;
  };
  assert.equal(receipt.gate, "P0_FORMAT_MATRIX_MISMATCH");
  assert.equal(receipt.mismatchCount, 2);
  assert.equal(stderr.includes(projectPath), false);
  assert.equal(stderr.includes(netlistPath), false);
  assert.equal(stderr.includes(bomPath), false);
  assert.equal(stderr.includes(screenshotPath), false);
  assert.equal(stderr.includes(PRIVATE_TITLE), false);
  assert.equal(stderr.includes(matrixPath), false);
  assert.equal(stderr.includes(bindingsPath), false);
});

test("P0 格式矩阵拒绝重复键、路径绑定和伪造特性证据", async () => {
  const { directory, matrix } = await fixture();
  const duplicatePath = path.join(directory, "duplicate.json");
  await writeFile(
    duplicatePath,
    `{"schemaVersion":"0.2.0","schemaVersion":"0.2.0","matrixId":"p0-x","requiredFeatures":[],"entries":[]}`
  );
  const cliPath = path.resolve(
    "dist/src/verification/verify-p0-format-matrix.js"
  );
  const duplicate = await execFile(
    process.execPath,
    [cliPath, duplicatePath, directory, duplicatePath],
    { encoding: "utf8" }
  ).catch(
    (error: unknown) =>
      error as { readonly code: number; readonly stderr: string }
  );
  assert.equal("code" in duplicate ? duplicate.code : 0, 2);
  assert.equal(
    JSON.parse("stderr" in duplicate ? duplicate.stderr : "{}").code,
    ERROR_CODES.P0_FORMAT_MATRIX_INVALID
  );

  assert.throws(
    () =>
      parseP0FormatMatrix({
        ...matrix,
        entries: [
          {
            ...matrix.entries[0]!,
            featureEvidence: [
              {
                feature: "USB",
                assertion: {
                  kind: "SUMMARY_VALUE",
                  metric: "schematicPages",
                  condition: "MINIMUM",
                  expected: 1
                }
              }
            ]
          }
        ]
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.P0_FORMAT_MATRIX_INVALID
  );
});
