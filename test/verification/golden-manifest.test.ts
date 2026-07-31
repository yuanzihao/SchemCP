import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { compileProject } from "../../src/application/compile-project.js";
import { canonicalJson } from "../../src/core/canonical-json.js";
import {
  createGoldenManifest,
  GOLDEN_ERROR_CODES,
  GoldenVerificationError,
  normalizeDiagnostics,
  readGoldenManifest,
  verifyGoldenIr
} from "../../src/verification/golden-manifest.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const execFile = promisify(execFileCallback);
const PRIVATE_PAGE = "private-golden-page";
const PRIVATE_NET = "PRIVATE_GOLDEN_NET";
const EPRU = [
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"SCH_PAGE\",\"client\":\"c\",\"uuid\":\"page\"}|",
  `{\"type\":\"META\",\"ticket\":1}||{\"title\":\"${PRIVATE_PAGE}\"}|`,
  "{\"type\":\"WIRE\",\"id\":\"w1\",\"ticket\":2}||{\"locked\":false}|",
  `{\"type\":\"ATTR\",\"id\":\"a1\",\"ticket\":3}||{\"parentId\":\"w1\",\"key\":\"NET\",\"value\":\"${PRIVATE_NET}\"}|`,
  "{\"type\":\"LINE\",\"id\":\"l1\",\"ticket\":4}||{\"lineGroup\":\"w1\",\"startX\":0,\"startY\":0,\"endX\":1,\"endY\":0}|"
].join("\n");

async function createFixture(): Promise<{
  readonly directory: string;
  readonly archivePath: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-golden-test-"));
  const archivePath = path.join(directory, "secret-project.epro2");
  await writeFile(
    archivePath,
    createStoredZip([{ name: "fixture.epru", data: EPRU }])
  );
  return { directory, archivePath };
}

test("诊断排序不依赖系统区域设置或 ICU 排序规则", () => {
  const diagnostics = normalizeDiagnostics([
    {
      code: "IR_RECORD_TYPE_NOT_MODELED",
      severity: "warning",
      count: 2,
      documentType: "SCH_PAGE",
      recordType: "CIRCLE"
    },
    {
      code: "IR_RECORD_TYPE_NOT_MODELED",
      severity: "warning",
      count: 2,
      documentType: "SCH",
      recordType: "RULE"
    }
  ]);
  assert.deepEqual(
    diagnostics.map((item) => item.documentType),
    ["SCH", "SCH_PAGE"]
  );
});

test("黄金样本清单只保留脱敏基线并能验证确定性 IR", async () => {
  const { archivePath } = await createFixture();
  const ir = await compileProject(archivePath);
  const manifest = createGoldenManifest("golden-synthetic-001", ir);
  const serialized = canonicalJson(manifest);

  assert.equal(serialized.includes(PRIVATE_PAGE), false);
  assert.equal(serialized.includes(PRIVATE_NET), false);
  assert.equal(serialized.includes(archivePath), false);
  assert.deepEqual(verifyGoldenIr(manifest, ir), {
    ok: true,
    fixtureId: "golden-synthetic-001",
    manifestSha256: verifyGoldenIr(manifest, ir).manifestSha256,
    sourceSha256: ir.source.archiveSha256,
    irSha256: ir.irSha256,
    electricalTruth: "NOT_VERIFIED",
    mismatchCount: 0,
    mismatches: []
  });
});

test("黄金样本 CLI 成功与差异结果均不泄露输入路径或工程事实", async () => {
  const { directory, archivePath } = await createFixture();
  const ir = await compileProject(archivePath);
  const manifest = createGoldenManifest("golden-synthetic-002", ir);
  const manifestPath = path.join(directory, "baseline.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const cliPath = path.resolve("dist/src/verification/verify-golden.js");

  const success = await execFile(
    process.execPath,
    [cliPath, manifestPath, archivePath],
    { encoding: "utf8" }
  );
  assert.equal(JSON.parse(success.stdout).ok, true);
  assert.equal(success.stdout.includes(archivePath), false);
  assert.equal(success.stdout.includes(manifestPath), false);
  assert.equal(success.stdout.includes(PRIVATE_PAGE), false);
  assert.equal(success.stdout.includes(PRIVATE_NET), false);

  const mismatched = {
    ...manifest,
    expected: {
      ...manifest.expected,
      summary: {
        ...manifest.expected.summary,
        documents: manifest.expected.summary.documents + 1
      }
    }
  };
  await writeFile(manifestPath, `${JSON.stringify(mismatched, null, 2)}\n`);
  const failure = await execFile(
    process.execPath,
    [cliPath, manifestPath, archivePath],
    { encoding: "utf8" }
  ).catch(
    (error: unknown) =>
      error as { readonly code: number; readonly stdout: string; readonly stderr: string }
  );
  assert.equal("code" in failure ? failure.code : 0, 1);
  const stderr = "stderr" in failure ? failure.stderr : "";
  assert.equal(JSON.parse(stderr).code, GOLDEN_ERROR_CODES.BASELINE_MISMATCH);
  assert.equal(stderr.includes(archivePath), false);
  assert.equal(stderr.includes(manifestPath), false);
  assert.equal(stderr.includes(PRIVATE_PAGE), false);
  assert.equal(stderr.includes(PRIVATE_NET), false);

  const wrongSource = {
    ...manifest,
    sourceSha256: "0".repeat(64)
  };
  await writeFile(manifestPath, `${JSON.stringify(wrongSource, null, 2)}\n`);
  const sourceFailure = await execFile(
    process.execPath,
    [cliPath, manifestPath, archivePath],
    { encoding: "utf8" }
  ).catch(
    (error: unknown) =>
      error as { readonly code: number; readonly stdout: string; readonly stderr: string }
  );
  assert.equal("code" in sourceFailure ? sourceFailure.code : 0, 1);
  const sourceStderr = "stderr" in sourceFailure ? sourceFailure.stderr : "";
  assert.equal(
    JSON.parse(sourceStderr).code,
    GOLDEN_ERROR_CODES.SOURCE_MISMATCH
  );
  assert.equal(sourceStderr.includes(archivePath), false);
  assert.equal(sourceStderr.includes(manifestPath), false);
});

test("黄金样本清单拒绝超限、过深 JSON、未知字段和非规范诊断顺序", async () => {
  const { directory, archivePath } = await createFixture();
  const ir = await compileProject(archivePath);
  const manifest = createGoldenManifest("golden-synthetic-003", ir);
  const oversizedPath = path.join(directory, "oversized.json");
  await writeFile(oversizedPath, "{}".padEnd(1025, " "));
  await assert.rejects(
    readGoldenManifest(oversizedPath, 1024),
    (error: unknown) =>
      error instanceof GoldenVerificationError &&
      error.code === GOLDEN_ERROR_CODES.MANIFEST_TOO_LARGE
  );

  const tooDeepPath = path.join(directory, "too-deep.json");
  await writeFile(tooDeepPath, `${"[".repeat(33)}0${"]".repeat(33)}`);
  await assert.rejects(
    readGoldenManifest(tooDeepPath),
    (error: unknown) =>
      error instanceof GoldenVerificationError &&
      error.code === GOLDEN_ERROR_CODES.MANIFEST_JSON_DEPTH_EXCEEDED
  );

  const unknownPath = path.join(directory, "unknown.json");
  await writeFile(
    unknownPath,
    JSON.stringify({ ...manifest, sourcePath: archivePath })
  );
  await assert.rejects(
    readGoldenManifest(unknownPath),
    (error: unknown) =>
      error instanceof GoldenVerificationError &&
      error.code === GOLDEN_ERROR_CODES.MANIFEST_INVALID
  );

  const diagnosticsPath = path.join(directory, "diagnostics.json");
  await writeFile(
    diagnosticsPath,
    JSON.stringify({
      ...manifest,
      expected: {
        ...manifest.expected,
        diagnostics: [
          { code: "Z_CODE", severity: "warning", count: 1 },
          { code: "A_CODE", severity: "warning", count: 1 }
        ]
      }
    })
  );
  await assert.rejects(
    readGoldenManifest(diagnosticsPath),
    (error: unknown) =>
      error instanceof GoldenVerificationError &&
      error.code === GOLDEN_ERROR_CODES.MANIFEST_INVALID
  );
});
