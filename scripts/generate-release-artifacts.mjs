#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  canonicalJson,
  loadProductionPackages,
  normalizeCycloneDx,
  normalizeSpdx,
  sha256
} from "./lib/supply-chain.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const outputArgument = argument("--output");
const tarballArgument = argument("--tarball");
assert.ok(outputArgument, "必须显式提供 --output 发布产物目录");
assert.ok(tarballArgument, "必须显式提供 --tarball npm 安装包路径");
const outputDirectory = path.resolve(outputArgument);
const tarballPath = path.resolve(tarballArgument);
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8")
);
const contractBytes = await readFile(
  path.join(root, "docs", "mcp-tools.contract.json")
);
const tarballBytes = await readFile(tarballPath);
const { lockSha256, packages } = await loadProductionPackages(root);

async function npmSbom(format) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await execFile(
    command,
    ["sbom", `--sbom-format=${format}`],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );
  return JSON.parse(result.stdout);
}

const [rawCycloneDx, rawSpdx] = await Promise.all([
  npmSbom("cyclonedx"),
  npmSbom("spdx")
]);
const cycloneDx = canonicalJson(normalizeCycloneDx(rawCycloneDx, lockSha256));
const spdx = canonicalJson(normalizeSpdx(rawSpdx, lockSha256));
assert.equal(cycloneDx.includes(root), false, "CycloneDX 不得包含本机路径");
assert.equal(spdx.includes(root), false, "SPDX 不得包含本机路径");

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const cycloneDxPath = path.join(outputDirectory, "sbom.cdx.json");
const spdxPath = path.join(outputDirectory, "sbom.spdx.json");
const noticesPath = path.join(outputDirectory, "THIRD_PARTY_NOTICES.md");
await Promise.all([
  writeFile(cycloneDxPath, cycloneDx, { encoding: "utf8", flag: "wx", mode: 0o600 }),
  writeFile(spdxPath, spdx, { encoding: "utf8", flag: "wx", mode: 0o600 }),
  copyFile(path.join(root, "THIRD_PARTY_NOTICES.md"), noticesPath)
]);

const receipt = {
  schema: "schemcp.release-verification-receipt",
  schemaVersion: "1.0.0",
  package: packageJson.name,
  version: packageJson.version,
  npmTarball: {
    fileName: path.basename(tarballPath),
    bytes: tarballBytes.byteLength,
    sha256: sha256(tarballBytes)
  },
  publicMcpContract: {
    toolCount: 48,
    sha256: sha256(contractBytes)
  },
  supplyChain: {
    packageLockSha256: lockSha256,
    productionPackageCount: packages.length,
    cycloneDxSha256: sha256(cycloneDx),
    spdxSha256: sha256(spdx)
  },
  gates: {
    deterministicPack: "VERIFIED_BY_RELEASE_WORKFLOW",
    installedPackage: "VERIFIED_BY_RELEASE_WORKFLOW",
    sourceAuthenticity: "NOT_APPLICABLE",
    electricalTruth: "NOT_APPLICABLE"
  }
};
const receiptText = canonicalJson(receipt);
await writeFile(
  path.join(outputDirectory, "verification-receipt.json"),
  receiptText,
  { encoding: "utf8", flag: "wx", mode: 0o600 }
);
await writeFile(
  path.join(outputDirectory, `${path.basename(tarballPath)}.sha256`),
  `${receipt.npmTarball.sha256}  ${path.basename(tarballPath)}\n`,
  { encoding: "utf8", flag: "wx", mode: 0o600 }
);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    gate: "RELEASE_ARTIFACTS_GENERATED",
    package: receipt.package,
    version: receipt.version,
    npmTarballSha256: receipt.npmTarball.sha256,
    productionPackageCount: packages.length
  })}\n`
);
