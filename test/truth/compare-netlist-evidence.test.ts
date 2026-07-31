import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { enforcesPosixModes } from "../../src/core/filesystem-security.js";
import {
  verifyNetlistComparisonReport,
  writeNetlistComparisonReport
} from "../../src/truth/compare-netlist-evidence.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const EPRU = [
  '{"type":"DOCHEAD"}||{"docType":"PROJECT_CONFIG","client":"c","uuid":"config-1"}|',
  '{"type":"META","ticket":1}||{"name":"Private Project","default_sheet":"page-1"}|',
  '{"type":"DOCHEAD"}||{"docType":"BOARD","client":"c","uuid":"board-1"}|',
  '{"type":"META","ticket":2}||{"title":"Private Board","sort":1}|',
  '{"type":"DOCHEAD"}||{"docType":"SCH","client":"c","uuid":"schematic-1"}|',
  '{"type":"META","ticket":3}||{"name":"Private Schematic","board":"board-1","sort":1}|',
  '{"type":"DOCHEAD"}||{"docType":"SCH_PAGE","client":"c","uuid":"page-1"}|',
  '{"type":"META","ticket":4}||{"title":"Private Page","schematic":"schematic-1","zIndex":1}|'
].join("\n");

function enet(
  components: Readonly<Record<string, unknown>> = {}
): string {
  return JSON.stringify({
    version: "2.0.0",
    components,
    designRule: {},
    netClass: {},
    equalLengthNetGroup: {},
    differentialPair: {}
  });
}

async function fixture(
  components: Readonly<Record<string, unknown>> = {}
): Promise<{
  readonly directory: string;
  readonly projectPath: string;
  readonly netlistPath: string;
}> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "eda-netlist-comparison-test-")
  );
  const projectPath = path.join(directory, "fixture.epro2");
  const netlistPath = path.join(directory, "official.enet");
  await Promise.all([
    writeFile(
      projectPath,
      createStoredZip([{ name: "fixture.epru", data: EPRU }])
    ),
    writeFile(netlistPath, enet(components), { mode: 0o600 })
  ]);
  return { directory, projectPath, netlistPath };
}

test("私有比较报告可由工程和 .enet 逐字节复算", async () => {
  const { directory, projectPath, netlistPath } = await fixture();
  const reportPath = path.join(directory, "comparison.json");
  const written = await writeNetlistComparisonReport(
    projectPath,
    netlistPath,
    reportPath
  );
  assert.equal(written.officialNetlistComparison, "EXACT_SET_MATCH");
  assert.equal(written.candidateTupleCount, 0);
  assert.equal(written.truthTupleCount, 0);
  assert.equal(written.electricalTruth, "NOT_VERIFIED");
  if (enforcesPosixModes()) {
    assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
  }

  const reportPayload = await readFile(reportPath, "utf8");
  assert.equal(reportPayload.endsWith("\n"), true);
  assert.equal(reportPayload.includes(projectPath), false);
  assert.equal(reportPayload.includes(netlistPath), false);
  const verified = await verifyNetlistComparisonReport(
    projectPath,
    netlistPath,
    reportPath
  );
  assert.equal(verified.ok, true);
  assert.equal(verified.gate, "NETLIST_COMPARISON_RECOMPUTED");
  assert.equal(verified.reportSha256, written.reportSha256);

  await assert.rejects(
    writeNetlistComparisonReport(projectPath, netlistPath, reportPath),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.OUTPUT_EXISTS
  );
  await assert.rejects(
    writeNetlistComparisonReport(projectPath, netlistPath, netlistPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.OUTPUT_PATH_CONFLICT
  );
});

test("比较报告保留缺失元组但不会把用户文件升级为电气真值", async () => {
  const { directory, projectPath, netlistPath } = await fixture({
    componentA: {
      props: { Designator: "U1" },
      pinInfoMap: {
        pinA: { name: "A", number: "1", net: "GND" }
      }
    }
  });
  const reportPath = path.join(directory, "comparison.json");
  const result = await writeNetlistComparisonReport(
    projectPath,
    netlistPath,
    reportPath
  );
  assert.equal(result.officialNetlistComparison, "DIFFERENCES_FOUND");
  assert.equal(result.matchedTupleCount, 0);
  assert.equal(result.missingInCandidateCount, 1);
  assert.equal(result.unexpectedCandidateCount, 0);
  assert.equal(result.sourceAuthenticity, "NOT_VERIFIED");
  assert.equal(result.projectBinding, "NOT_VERIFIED");
  assert.equal(result.electricalTruth, "NOT_VERIFIED");
});

test("复算校验拒绝篡改报告和公开权限", async () => {
  const { directory, projectPath, netlistPath } = await fixture();
  const tamperedPath = path.join(directory, "tampered.json");
  await writeNetlistComparisonReport(
    projectPath,
    netlistPath,
    tamperedPath
  );
  const report = JSON.parse(await readFile(tamperedPath, "utf8")) as {
    gates: { electricalTruth: string };
  };
  report.gates.electricalTruth = "VERIFIED";
  await writeFile(tamperedPath, `${JSON.stringify(report)}\n`, {
    mode: 0o600
  });
  await assert.rejects(
    verifyNetlistComparisonReport(projectPath, netlistPath, tamperedPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.NETLIST_COMPARISON_MISMATCH
  );

  const publicPath = path.join(directory, "public.json");
  await writeNetlistComparisonReport(projectPath, netlistPath, publicPath);
  await chmod(publicPath, 0o644);
  if (enforcesPosixModes()) {
    await assert.rejects(
      verifyNetlistComparisonReport(projectPath, netlistPath, publicPath),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERROR_CODES.NETLIST_COMPARISON_INVALID
    );
  } else {
    await verifyNetlistComparisonReport(projectPath, netlistPath, publicPath);
  }
});
