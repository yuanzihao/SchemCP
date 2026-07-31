import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { compileProject } from "../../src/application/compile-project.js";
import { loadReducedProject } from "../../src/application/load-reduced-project.js";
import { writeIrFile } from "../../src/application/write-ir.js";
import { DEFAULT_ARCHIVE_LIMITS } from "../../src/archive/limits.js";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { enforcesPosixModes } from "../../src/core/filesystem-security.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const execFile = promisify(execFileCallback);
const EPRU = [
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"SCH_PAGE\",\"client\":\"c\",\"uuid\":\"page\"}|",
  "{\"type\":\"META\",\"ticket\":1}||{\"title\":\"private-page\"}|",
  "{\"type\":\"COMPONENT\",\"id\":\"c1\",\"ticket\":2}||{\"partId\":\"\",\"x\":1,\"y\":2,\"rotation\":0,\"isMirror\":false}|",
  "{\"type\":\"ATTR\",\"id\":\"a1\",\"ticket\":3}||{\"parentId\":\"c1\",\"key\":\"Designator\",\"value\":\"U1\"}|",
  "{\"type\":\"WIRE\",\"id\":\"w1\",\"ticket\":4}||{\"locked\":false}|",
  "{\"type\":\"ATTR\",\"id\":\"a2\",\"ticket\":5}||{\"parentId\":\"w1\",\"key\":\"NET\",\"value\":\"PRIVATE_NET\"}|",
  "{\"type\":\"LINE\",\"id\":\"l1\",\"ticket\":6}||{\"lineGroup\":\"w1\",\"startX\":0,\"startY\":0,\"endX\":1,\"endY\":0}|"
].join("\n");

async function createFixture(): Promise<{
  readonly directory: string;
  readonly archivePath: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-ir-test-"));
  const archivePath = path.join(directory, "fixture.epro2");
  await writeFile(
    archivePath,
    createStoredZip([{ name: "fixture.epru", data: EPRU }])
  );
  return { directory, archivePath };
}

test("完整 IR 只写入显式文件，默认拒绝覆盖且使用私有权限", async () => {
  const { directory, archivePath } = await createFixture();
  const outputPath = path.join(directory, "fixture.eda-ir.json");
  const ir = await compileProject(archivePath);

  const result = await writeIrFile(archivePath, outputPath, ir, {
    compact: false,
    force: false
  });
  const output = await readFile(outputPath, "utf8");
  const parsed = JSON.parse(output) as {
    readonly schematicPages: readonly { readonly title?: string }[];
    readonly wires: readonly { readonly explicitNetName?: string }[];
  };
  assert.equal(result.outputBytes, Buffer.byteLength(output));
  assert.equal(parsed.schematicPages[0]?.title, "private-page");
  assert.equal(parsed.wires[0]?.explicitNetName, "PRIVATE_NET");
  if (enforcesPosixModes()) {
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  }
  assert.equal(
    (await readdir(directory)).some((entry) => entry.endsWith(".tmp")),
    false
  );

  await assert.rejects(
    writeIrFile(archivePath, outputPath, ir, {
      compact: false,
      force: false
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.OUTPUT_EXISTS
  );

  await chmod(outputPath, 0o600);
  await writeIrFile(archivePath, outputPath, ir, {
    compact: true,
    force: true
  });
  assert.equal((await readFile(outputPath, "utf8")).startsWith("{\n"), false);
});

test("工程编译只隔离被截断的非电气 TEXT 并保留显式诊断", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-ir-quarantine-test-"));
  const archivePath = path.join(directory, "fixture.epro2");
  const truncatedTextEpru = [
    "{\"type\":\"DOCHEAD\"}||{\"docType\":\"SCH_PAGE\",\"client\":\"c\",\"uuid\":\"page\"}|",
    "{\"type\":\"META\",\"ticket\":1}||{\"title\":\"fixture\"}|",
    "{\"type\":\"TEXT\",\"id\":\"t1\",\"ticket\":2}||{\"x\":1,\"y\":2,\"rotation\":0,\"value\":\"truncated"
  ].join("\n");
  await writeFile(
    archivePath,
    createStoredZip([{ name: "fixture.epru", data: truncatedTextEpru }])
  );

  const ir = await compileProject(archivePath);

  assert.equal(ir.schematicAnnotations.length, 0);
  assert.equal(
    ir.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "IR_MALFORMED_TEXT_RECORD_QUARANTINED"
    )?.count,
    1
  );
  assert.equal(
    ir.unmodeledRecords.some(
      (record) =>
        record.provenance.recordType === "TEXT" &&
        record.provenance.recordId === "t1"
    ),
    true
  );
});

test("输出路径不能覆盖输入工程，即使显式使用 force", async () => {
  const { archivePath } = await createFixture();
  const ir = await compileProject(archivePath);

  await assert.rejects(
    writeIrFile(archivePath, archivePath, ir, {
      compact: true,
      force: true
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.OUTPUT_PATH_CONFLICT
  );
});

test("工程加载在归档解析前拒绝缺失、目录、超限与非法首记录", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-load-boundary-test-"));
  await assert.rejects(
    loadReducedProject(path.join(directory, "missing.epro2")),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.INPUT_NOT_FOUND
  );
  await assert.rejects(
    loadReducedProject(directory),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.INPUT_NOT_FILE
  );

  const oversized = path.join(directory, "oversized.epro2");
  await writeFile(oversized, Buffer.alloc(2));
  await assert.rejects(
    loadReducedProject(oversized, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxInputBytes: 1
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.ARCHIVE_INPUT_TOO_LARGE
  );

  const invalidFirst = path.join(directory, "invalid-first.epro2");
  await writeFile(
    invalidFirst,
    createStoredZip([
      {
        name: "fixture.epru",
        data: '{"type":"META","ticket":1}||{"title":"invalid"}|'
      }
    ])
  );
  await assert.rejects(
    loadReducedProject(invalidFirst),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.V3_INVALID_RECORD
  );

  const { archivePath } = await createFixture();
  await assert.rejects(
    loadReducedProject(archivePath, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxRecords: 0
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.V3_RECORD_LIMIT_EXCEEDED
  );
  await assert.rejects(
    loadReducedProject(archivePath, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxDocuments: 0
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.V3_DOCUMENT_LIMIT_EXCEEDED
  );
});

test("IR 写入拒绝不可解析路径、输入软链接冲突和目录替换", async () => {
  const { directory, archivePath } = await createFixture();
  const ir = await compileProject(archivePath);
  await assert.rejects(
    writeIrFile(
      path.join(directory, "missing.epro2"),
      path.join(directory, "missing-input.json"),
      ir,
      { compact: true, force: false }
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.OUTPUT_WRITE_FAILED
  );
  await assert.rejects(
    writeIrFile(
      archivePath,
      path.join(directory, "missing-parent", "output.json"),
      ir,
      { compact: true, force: false }
    ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.OUTPUT_WRITE_FAILED
  );

  const inputLink = path.join(directory, "input-link.json");
  await symlink(archivePath, inputLink);
  await assert.rejects(
    writeIrFile(archivePath, inputLink, ir, {
      compact: true,
      force: true
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.OUTPUT_PATH_CONFLICT
  );

  const outputDirectory = path.join(directory, "output-directory.json");
  await mkdir(outputDirectory);
  await assert.rejects(
    writeIrFile(archivePath, outputDirectory, ir, {
      compact: true,
      force: true
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.OUTPUT_WRITE_FAILED
  );
  assert.equal(
    (await readdir(directory)).some((entry) => entry.endsWith(".tmp")),
    false
  );
});

test("compile CLI 只在终端返回脱敏收据", async () => {
  const { directory, archivePath } = await createFixture();
  const outputPath = path.join(directory, "cli.eda-ir.json");
  const cliPath = path.resolve("dist/src/cli/main.js");

  const missingOutput = await execFile(process.execPath, [cliPath, "compile", archivePath], {
    encoding: "utf8"
  }).catch((error: unknown) => error as { readonly code: number; readonly stderr: string });
  assert.equal("code" in missingOutput ? missingOutput.code : 0, 64);

  const { stdout } = await execFile(
    process.execPath,
    [cliPath, "compile", archivePath, "--output", outputPath, "--compact"],
    { encoding: "utf8" }
  );
  const receipt = JSON.parse(stdout) as {
    readonly ok: boolean;
    readonly electricalTruth: string;
    readonly irSha256: string;
  };
  assert.equal(receipt.ok, true);
  assert.equal(receipt.electricalTruth, "NOT_VERIFIED");
  assert.match(receipt.irSha256, /^[a-f0-9]{64}$/);
  assert.equal(stdout.includes("private-page"), false);
  assert.equal(stdout.includes("PRIVATE_NET"), false);
  assert.equal(stdout.includes(outputPath), false);

  const fullIr = await readFile(outputPath, "utf8");
  assert.equal(fullIr.includes("private-page"), true);
  assert.equal(fullIr.includes("PRIVATE_NET"), true);
});
