import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_ARCHIVE_LIMITS } from "../../src/archive/limits.js";
import { inspectProject } from "../../src/application/inspect-project.js";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const EPRU = [
  "{\"type\":\"DOCHEAD\",\"ticket\":1}||{\"docType\":\"SCH_PAGE\",\"client\":\"c\",\"uuid\":\"u\"}|",
  "{\"type\":\"META\",\"ticket\":2}||{\"name\":\"fixture\"}|",
  "{\"type\":\"ATTR\",\"id\":\"a\",\"ticket\":3}||\"\"|"
].join("\n");

async function writeFixture(
  entries: readonly { readonly name: string; readonly data: string | Buffer }[]
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "schemcp-test-"));
  const archivePath = path.join(directory, "fixture.epro2");
  await writeFile(archivePath, createStoredZip(entries));
  return archivePath;
}

test("生成脱敏、确定且明确未验证电气真值的摘要", async () => {
  const archivePath = await writeFixture([
    { name: "project2.json", data: "{}" },
    { name: "工程.epru", data: EPRU }
  ]);

  const first = await inspectProject(archivePath);
  const second = await inspectProject(archivePath);

  assert.deepEqual(first, second);
  assert.equal(first.gate, "P1_LOG_REDUCED");
  assert.equal(first.electricalTruth, "NOT_VERIFIED");
  assert.equal(first.archive.entries, 2);
  assert.equal(first.archive.epruEntries, 1);
  assert.equal(first.v3.lines, 3);
  assert.equal(first.v3.records, 3);
  assert.equal(first.v3.documents, 1);
  assert.deepEqual(first.v3.documentTypes, { SCH_PAGE: 1 });
  assert.deepEqual(first.v3.recordTypes, { ATTR: 1, DOCHEAD: 1, META: 1 });
  assert.equal(first.v3.reduction.documents, 1);
  assert.equal(first.v3.reduction.inputRecords, 2);
  assert.equal(first.v3.reduction.selectedRecords, 2);
  assert.equal(first.v3.reduction.activeRecords, 1);
  assert.equal(first.v3.reduction.tombstoneRecords, 1);
  assert.match(first.v3.reduction.stateSha256, /^[a-f0-9]{64}$/);
  assert.match(first.archive.sha256, /^[a-f0-9]{64}$/);
  assert.match(first.summarySha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes("工程.epru"), false);
  assert.equal(JSON.stringify(first).includes(archivePath), false);
});

test("拒绝路径穿越条目", async () => {
  const archivePath = await writeFixture([
    { name: "../escape.epru", data: EPRU }
  ]);

  await assert.rejects(
    inspectProject(archivePath),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.ARCHIVE_INVALID_ENTRY_PATH
  );
});

test("拒绝重复规范化路径", async () => {
  const archivePath = await writeFixture([
    { name: "same.epru", data: EPRU },
    { name: "same.epru", data: EPRU }
  ]);

  await assert.rejects(
    inspectProject(archivePath),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.ARCHIVE_DUPLICATE_ENTRY
  );
});

test("拒绝缺少 V3 日志的归档", async () => {
  const archivePath = await writeFixture([{ name: "project2.json", data: "{}" }]);

  await assert.rejects(
    inspectProject(archivePath),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.ARCHIVE_EPRU_NOT_FOUND
  );
});

test("归档和日志限额可以按部署策略收紧", async () => {
  const archivePath = await writeFixture([{ name: "fixture.epru", data: EPRU }]);

  await assert.rejects(
    inspectProject(archivePath, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxLineBytes: 16
    }),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.V3_LINE_TOO_LARGE
  );
});

test("拒绝超过单条目大小限额的归档", async () => {
  const archivePath = await writeFixture([{ name: "fixture.epru", data: EPRU }]);

  await assert.rejects(
    inspectProject(archivePath, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxEntryBytes: Buffer.byteLength(EPRU) - 1
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.ARCHIVE_ENTRY_TOO_LARGE
  );
});

test("拒绝超过累计解压大小限额的归档", async () => {
  const archivePath = await writeFixture([
    { name: "project2.json", data: "{}" },
    { name: "fixture.epru", data: EPRU }
  ]);

  await assert.rejects(
    inspectProject(archivePath, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxTotalUncompressedBytes: Buffer.byteLength(EPRU)
    }),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.ARCHIVE_TOTAL_SIZE_EXCEEDED
  );
});

test("拒绝超过压缩比策略的归档", async () => {
  const archivePath = await writeFixture([{ name: "fixture.epru", data: EPRU }]);

  await assert.rejects(
    inspectProject(archivePath, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxCompressionRatio: 0.5
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.ARCHIVE_COMPRESSION_RATIO_EXCEEDED
  );
});

test("拒绝超过条目数限额的归档", async () => {
  const archivePath = await writeFixture([
    { name: "project2.json", data: "{}" },
    { name: "fixture.epru", data: EPRU }
  ]);

  await assert.rejects(
    inspectProject(archivePath, {
      ...DEFAULT_ARCHIVE_LIMITS,
      maxEntries: 1
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.ARCHIVE_ENTRY_LIMIT_EXCEEDED
  );
});
