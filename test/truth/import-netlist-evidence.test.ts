import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  stat,
  symlink,
  truncate,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { enforcesPosixModes } from "../../src/core/filesystem-security.js";
import { importNetlistEvidence } from "../../src/truth/import-netlist-evidence.js";
import { verifyNetlistEvidence } from "../../src/truth/verify-netlist-evidence.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const EPRU = [
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"PROJECT_CONFIG\",\"client\":\"c\",\"uuid\":\"config-1\"}|",
  "{\"type\":\"META\",\"ticket\":1}||{\"name\":\"Private Project\",\"default_sheet\":\"page-1\"}|",
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"BOARD\",\"client\":\"c\",\"uuid\":\"board-1\"}|",
  "{\"type\":\"META\",\"ticket\":2}||{\"title\":\"Private Board\",\"sort\":1}|",
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"SCH\",\"client\":\"c\",\"uuid\":\"schematic-1\"}|",
  "{\"type\":\"META\",\"ticket\":3}||{\"name\":\"Private Schematic\",\"board\":\"board-1\",\"sort\":1}|",
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"SCH_PAGE\",\"client\":\"c\",\"uuid\":\"page-1\"}|",
  "{\"type\":\"META\",\"ticket\":4}||{\"title\":\"Private Page\",\"schematic\":\"schematic-1\",\"zIndex\":1}|"
].join("\n");
const NETLIST = Buffer.from(
  "(user provided bytes; syntax intentionally not interpreted)\n",
  "utf8"
);

async function fixture(): Promise<{
  readonly directory: string;
  readonly projectPath: string;
  readonly netlistPath: string;
}> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "eda-netlist-evidence-test-")
  );
  const projectPath = path.join(directory, "fixture.epro2");
  const netlistPath = path.join(directory, "export.enet");
  await Promise.all([
    writeFile(
      projectPath,
      createStoredZip([{ name: "fixture.epru", data: EPRU }])
    ),
    writeFile(netlistPath, NETLIST, { mode: 0o600 })
  ]);
  return { directory, projectPath, netlistPath };
}

test("用户提供的 .enet 以未验证来源和工程绑定状态私密归档", async () => {
  const { directory, projectPath, netlistPath } = await fixture();
  const outputPath = path.join(directory, "fixture.truth-evidence");
  const result = await importNetlistEvidence(
    projectPath,
    netlistPath,
    outputPath
  );
  assert.equal(
    await readFile(path.join(outputPath, "official.enet"), "utf8"),
    NETLIST.toString("utf8")
  );
  const manifestPayload = await readFile(
    path.join(outputPath, "evidence.json"),
    "utf8"
  );
  const manifest = JSON.parse(manifestPayload) as {
    readonly schemaVersion: string;
    readonly generator: { readonly version: string };
    readonly sourceProject: {
      readonly archiveSha256: string;
      readonly irSha256: string;
    };
    readonly acquisition: {
      readonly method: string;
      readonly assertedFormat: string;
      readonly sourceAuthenticity: string;
      readonly projectBinding: string;
    };
    readonly netlist: {
      readonly fileName: string;
      readonly bytes: number;
      readonly sha256: string;
    };
    readonly truth: {
      readonly syntaxAdapter: string;
      readonly officialNetlistComparison: string;
      readonly electricalTruth: string;
    };
    readonly evidenceSha256: string;
  };
  assert.equal(manifest.schemaVersion, "0.1.0");
    assert.equal(manifest.generator.version, "0.1.0");
  assert.equal(manifest.sourceProject.archiveSha256, result.archiveSha256);
  assert.equal(manifest.sourceProject.irSha256, result.irSha256);
  assert.equal(manifest.acquisition.method, "USER_PROVIDED_FILE");
  assert.equal(manifest.acquisition.assertedFormat, "JLCEDA_PRO_ENET");
  assert.equal(manifest.acquisition.sourceAuthenticity, "NOT_VERIFIED");
  assert.equal(
    manifest.acquisition.projectBinding,
    "USER_ASSERTED_NOT_VERIFIED"
  );
  assert.equal(manifest.netlist.fileName, "official.enet");
  assert.equal(manifest.netlist.bytes, NETLIST.length);
  assert.equal(manifest.netlist.sha256, result.netlistSha256);
  assert.equal(manifest.truth.syntaxAdapter, "NOT_IMPLEMENTED");
  assert.equal(manifest.truth.officialNetlistComparison, "NOT_PERFORMED");
  assert.equal(manifest.truth.electricalTruth, "NOT_VERIFIED");
  assert.equal(manifest.evidenceSha256, result.evidenceSha256);
  assert.equal(result.sourceAuthenticity, "NOT_VERIFIED");
  assert.equal(result.projectBinding, "USER_ASSERTED_NOT_VERIFIED");
  assert.equal(result.officialNetlistComparison, "NOT_PERFORMED");
  assert.equal(result.electricalTruth, "NOT_VERIFIED");
  if (enforcesPosixModes()) {
    assert.equal((await stat(outputPath)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(path.join(outputPath, "official.enet"))).mode & 0o777,
      0o600
    );
    assert.equal(
      (await stat(path.join(outputPath, "evidence.json"))).mode & 0o777,
      0o600
    );
  }

  const verification = await verifyNetlistEvidence(outputPath);
  assert.equal(verification.ok, true);
  assert.equal(
    verification.gate,
    "NETLIST_EVIDENCE_INTEGRITY_VERIFIED"
  );
  assert.equal(verification.evidenceSha256, result.evidenceSha256);
  assert.equal(verification.manifestSha256, result.manifestSha256);
  assert.equal(verification.archiveSha256, result.archiveSha256);
  assert.equal(verification.netlistSha256, result.netlistSha256);
  assert.equal(verification.sourceAuthenticity, "NOT_VERIFIED");
  assert.equal(
    verification.projectBinding,
    "USER_ASSERTED_NOT_VERIFIED"
  );
  assert.equal(verification.electricalTruth, "NOT_VERIFIED");

  await assert.rejects(
    importNetlistEvidence(projectPath, netlistPath, outputPath),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.OUTPUT_EXISTS
  );
  await assert.rejects(
    importNetlistEvidence(projectPath, netlistPath, netlistPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.OUTPUT_PATH_CONFLICT
  );
});

test("网表证据导入拒绝错误扩展名、符号链接、空文件和超限文件", async () => {
  const { directory, projectPath, netlistPath } = await fixture();
  const wrongExtension = path.join(directory, "export.txt");
  const symbolicNetlist = path.join(directory, "symbolic.enet");
  const emptyNetlist = path.join(directory, "empty.enet");
  const oversizedNetlist = path.join(directory, "oversized.enet");
  await Promise.all([
    writeFile(wrongExtension, NETLIST),
    symlink(netlistPath, symbolicNetlist),
    writeFile(emptyNetlist, ""),
    writeFile(oversizedNetlist, "x")
  ]);
  await truncate(oversizedNetlist, 16 * 1024 * 1024 + 1);

  for (const [inputPath, expectedCode] of [
    [wrongExtension, ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID],
    [symbolicNetlist, ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID],
    [emptyNetlist, ERROR_CODES.NETLIST_EVIDENCE_INPUT_INVALID],
    [oversizedNetlist, ERROR_CODES.EASYEDA_NETLIST_TOO_LARGE]
  ] as const) {
    const outputPath = `${inputPath}.truth-evidence`;
    await assert.rejects(
      importNetlistEvidence(projectPath, inputPath, outputPath),
      (error: unknown) =>
        error instanceof AppError && error.code === expectedCode
    );
    await assert.rejects(stat(outputPath), { code: "ENOENT" });
  }
});

test("独立校验器拒绝篡改、额外文件和公开权限", async () => {
  const { directory, projectPath, netlistPath } = await fixture();
  const tamperedPath = path.join(directory, "tampered.truth-evidence");
  await importNetlistEvidence(projectPath, netlistPath, tamperedPath);
  await writeFile(
    path.join(tamperedPath, "official.enet"),
    Buffer.concat([NETLIST, Buffer.from("tampered\n")]),
    { mode: 0o600 }
  );
  await assert.rejects(
    verifyNetlistEvidence(tamperedPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.NETLIST_EVIDENCE_MISMATCH
  );

  const extraPath = path.join(directory, "extra.truth-evidence");
  await importNetlistEvidence(projectPath, netlistPath, extraPath);
  await writeFile(path.join(extraPath, "not-in-manifest"), "private", {
    mode: 0o600
  });
  await assert.rejects(
    verifyNetlistEvidence(extraPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.NETLIST_EVIDENCE_MISMATCH
  );

  const publicPath = path.join(directory, "public.truth-evidence");
  await importNetlistEvidence(projectPath, netlistPath, publicPath);
  await chmod(publicPath, 0o755);
  if (enforcesPosixModes()) {
    await assert.rejects(
      verifyNetlistEvidence(publicPath),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ERROR_CODES.NETLIST_EVIDENCE_INVALID
    );
  } else {
    await verifyNetlistEvidence(publicPath);
  }
});
