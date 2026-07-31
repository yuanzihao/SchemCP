import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  createSchematicAssemblyManifest,
  projectIdForIr,
  readSchematicAssemblyManifest
} from "../../src/mcp/assembly-manifest.js";

test("装配清单可规范生成、独立校验并拒绝哈希篡改", async () => {
  const firstHash = "1".repeat(64);
  const secondHash = "2".repeat(64);
  const manifest = createSchematicAssemblyManifest({
    schema: "schemcp.schematic-assembly-manifest",
    schemaVersion: "1.0.0",
    generator: {
      name: "@yuanzihao/schemcp",
      version: "0.1.0"
    },
    projects: [
      { projectId: projectIdForIr(firstHash), irSha256: firstHash },
      { projectId: projectIdForIr(secondHash), irSha256: secondHash }
    ],
    assembly: {
      projectIds: [
        projectIdForIr(firstHash),
        projectIdForIr(secondHash)
      ],
      interconnects: [],
      relationshipTruth: "USER_ASSERTED_PROJECT_RELATIONSHIP"
    }
  });
  const directory = await mkdtemp(
    path.join(tmpdir(), "schemcp-assembly-manifest-")
  );
  const manifestPath = path.join(
    directory,
    "fixture.schemcp-assembly.json"
  );
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const verified = await readSchematicAssemblyManifest(manifestPath);
  assert.equal(verified.manifest.manifestSha256, manifest.manifestSha256);

  const cli = spawnSync(
    process.execPath,
    [
      path.resolve("dist/src/cli/main.js"),
      "verify-assembly-manifest",
      manifestPath,
      "--compact"
    ],
    { encoding: "utf8" }
  );
  assert.equal(cli.status, 0, cli.stderr);
  const receipt = JSON.parse(cli.stdout) as {
    readonly gate: string;
    readonly projectCount: number;
  };
  assert.equal(receipt.gate, "SCHEMATIC_ASSEMBLY_MANIFEST_VERIFIED");
  assert.equal(receipt.projectCount, 2);

  const tamperedPath = path.join(
    directory,
    "tampered.schemcp-assembly.json"
  );
  await writeFile(
    tamperedPath,
    JSON.stringify({ ...manifest, manifestSha256: "0".repeat(64) }),
    { mode: 0o600 }
  );
  await assert.rejects(
    readSchematicAssemblyManifest(tamperedPath),
    (error: unknown) => {
      assert.equal(
        (error as { readonly code?: string }).code,
        "MCP_ASSEMBLY_MANIFEST_INVALID"
      );
      return true;
    }
  );

  const symlinkPath = path.join(
    directory,
    "link.schemcp-assembly.json"
  );
  await symlink(manifestPath, symlinkPath);
  await assert.rejects(
    readSchematicAssemblyManifest(symlinkPath),
    (error: unknown) => {
      assert.equal(
        (error as { readonly code?: string }).code,
        "MCP_ASSEMBLY_MANIFEST_INVALID"
      );
      return true;
    }
  );
});
