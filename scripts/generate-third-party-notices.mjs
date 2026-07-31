#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createThirdPartyNotices,
  loadProductionPackages
} from "./lib/supply-chain.mjs";

const root = process.cwd();
const outputPath = path.join(root, "THIRD_PARTY_NOTICES.md");
const { packages } = await loadProductionPackages(root);
assert.ok(packages.length > 0, "生产依赖清单不能为空");
const expected = createThirdPartyNotices(packages);

if (process.argv.includes("--check")) {
  const actual = await readFile(outputPath, "utf8").catch(() => undefined);
  assert.equal(
    actual,
    expected,
    "THIRD_PARTY_NOTICES.md 与生产依赖锁文件不一致"
  );
} else {
  await writeFile(outputPath, expected, "utf8");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    gate: process.argv.includes("--check")
      ? "THIRD_PARTY_NOTICES_CURRENT"
      : "THIRD_PARTY_NOTICES_GENERATED",
    packageCount: packages.length
  })}\n`
);
