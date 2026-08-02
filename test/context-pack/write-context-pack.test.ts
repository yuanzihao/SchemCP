import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { compileProject } from "../../src/application/compile-project.js";
import type { ContextPackManifest } from "../../src/context-pack/model.js";
import { verifyContextPack } from "../../src/context-pack/verify-context-pack.js";
import { writeContextPack } from "../../src/context-pack/write-context-pack.js";
import {
  canonicalJson,
  sha256CanonicalJson
} from "../../src/core/canonical-json.js";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import { enforcesPosixModes } from "../../src/core/filesystem-security.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const execFile = promisify(execFileCallback);
const EPRU = [
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"SCH_PAGE\",\"client\":\"c\",\"uuid\":\"private-page-id\"}|",
  "{\"type\":\"META\",\"ticket\":1}||{\"title\":\"private-page-title\"}|",
  "{\"type\":\"COMPONENT\",\"id\":\"c1\",\"ticket\":2}||{\"partId\":\"\",\"x\":1,\"y\":2,\"rotation\":0,\"isMirror\":false}|",
  "{\"type\":\"ATTR\",\"id\":\"a1\",\"ticket\":3}||{\"parentId\":\"c1\",\"key\":\"Designator\",\"value\":\"U1\"}|",
  "{\"type\":\"TEXT\",\"id\":\"t1\",\"ticket\":4}||{\"x\":3,\"y\":4,\"rotation\":0,\"value\":\"private-design-note\"}|",
  "{\"type\":\"TABLE\",\"id\":\"table-1\",\"ticket\":4}||{\"startX\":5,\"startY\":6,\"rowSizes\":[10],\"colSizes\":[20],\"rowLocked\":[0],\"colLocked\":[0],\"rotation\":0,\"tableCell\":[{\"id\":\"table-cell-1\",\"value\":\"private-table-value\",\"rowIndex\":0,\"columnIndex\":0,\"rowSpan\":1,\"colSpan\":1}]}|",
  "{\"type\":\"POLY\",\"id\":\"private-page-poly\",\"ticket\":4}||{\"groupId\":\"\",\"locked\":false,\"zIndex\":1,\"points\":[{\"x\":0,\"y\":0},{\"x\":10,\"y\":10}],\"closed\":false,\"strokeColor\":null,\"strokeStyle\":\"SOLID\",\"fillColor\":null,\"strokeWidth\":null,\"fillStyle\":null}|",
  "{\"type\":\"WIRE\",\"id\":\"w1\",\"ticket\":4}||{\"locked\":false}|",
  "{\"type\":\"ATTR\",\"id\":\"a2\",\"ticket\":5}||{\"parentId\":\"w1\",\"key\":\"NET\",\"value\":\"PRIVATE_NET\"}|",
  "{\"type\":\"LINE\",\"id\":\"l1\",\"ticket\":6}||{\"lineGroup\":\"w1\",\"startX\":0,\"startY\":0,\"endX\":1,\"endY\":0}|",
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"SYMBOL\",\"client\":\"c\",\"uuid\":\"private-symbol-id\"}|",
  "{\"type\":\"META\",\"ticket\":7}||{\"title\":\"private-symbol-title\"}|",
  "{\"type\":\"PART\",\"id\":\"private-part-id\",\"ticket\":8}||{\"title\":\"A\"}|",
  "{\"type\":\"TEXT\",\"id\":\"private-symbol-text-id\",\"ticket\":9}||{\"partId\":\"private-part-id\",\"x\":1,\"y\":2,\"rotation\":0,\"value\":\"private-symbol-text\"}|",
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"FOOTPRINT\",\"client\":\"c\",\"uuid\":\"private-footprint-id\"}|",
  "{\"type\":\"META\",\"ticket\":10}||{\"title\":\"private-footprint-title\"}|",
  "{\"type\":\"LAYER\",\"id\":\"[\\\"LAYER\\\",11]\",\"ticket\":11}||{\"layerId\":11,\"layerType\":\"OUTLINE\",\"layerName\":\"private-footprint-outline\"}|",
  "{\"type\":\"LAYER_PHYS\",\"id\":\"[\\\"LAYER_PHYS\\\",11]\",\"ticket\":11}||{\"material\":null,\"thickness\":10,\"permittivity\":null,\"lossTangent\":null,\"isKeepIsland\":true,\"zIndex\":1}|",
  "{\"type\":\"FILL\",\"id\":\"private-footprint-fill\",\"ticket\":12}||{\"layerId\":11,\"netName\":\"\",\"width\":1,\"fillStyle\":\"SOLID\",\"path\":[[\"R\",0,0,20,10,0,0]]}|",
  "{\"type\":\"PRIMITIVE\",\"id\":\"[\\\"PRIMITIVE\\\",\\\"PAD\\\"]\",\"ticket\":13}||{\"display\":true,\"pick\":false}|",
  "{\"type\":\"DOCHEAD\"}||{\"docType\":\"PCB\",\"client\":\"c\",\"uuid\":\"private-pcb-id\"}|",
  "{\"type\":\"META\",\"ticket\":10}||{\"title\":\"private-pcb-title\"}|",
  "{\"type\":\"STRING\",\"id\":\"private-pcb-text-id\",\"ticket\":11}||{\"layerId\":3,\"positionX\":10,\"positionY\":20,\"angle\":0,\"text\":\"private-pcb-text\"}|",
  "{\"type\":\"LAYER\",\"id\":\"[\\\"LAYER\\\",11]\",\"ticket\":12}||{\"layerId\":11,\"layerType\":\"OUTLINE\",\"layerName\":\"private-outline-layer\"}|",
  "{\"type\":\"LAYER_PHYS\",\"id\":\"[\\\"LAYER_PHYS\\\",11]\",\"ticket\":12}||{\"material\":\"COPPER\",\"thickness\":1,\"permittivity\":0,\"lossTangent\":0,\"isKeepIsland\":false,\"zIndex\":1}|",
  "{\"type\":\"RULE\",\"id\":\"private-clearance-rule\",\"ticket\":12}||{\"ruleType\":\"CLEARANCE\",\"ruleName\":\"private-default\",\"ruleState\":0,\"ruleContext\":{\"min\":6}}|",
  "{\"type\":\"RULE_SELECTOR\",\"id\":\"private-vcc-selector\",\"ticket\":12}||{\"ruleSelect\":[\"NET\",\"PRIVATE_NET\"],\"ruleOrder\":1,\"ruleKeyValue\":{\"CLEARANCE\":\"private-default\"}}|",
  "{\"type\":\"RULE_TEMPLATE\",\"ticket\":12}||{\"name\":\"private-board-default\"}|",
  "{\"type\":\"POLY\",\"id\":\"private-outline-poly\",\"ticket\":13}||{\"layerId\":11,\"netName\":\"\",\"width\":0.5,\"path\":[\"R\",0,0,100,50,0,0]}|",
  "{\"type\":\"PRIMITIVE\",\"id\":\"VIA\",\"ticket\":14}||{\"display\":1,\"pick\":0}|",
  "{\"type\":\"LINE\",\"id\":\"private-teardrop-line\",\"ticket\":15}||{\"netName\":\"PRIVATE_NET\",\"layerId\":1,\"startX\":0,\"startY\":0,\"endX\":10,\"endY\":0,\"width\":1}|",
  "{\"type\":\"TEARDROP\",\"id\":\"private-teardrop\",\"ticket\":16}||{\"partitionId\":\"\",\"netName\":\"PRIVATE_NET\",\"layerId\":1,\"path\":[\"L\",0,0,5,0,0,0],\"groupId\":0,\"refs\":[\"private-teardrop-line\"]}|"
].join("\n");

async function createFixture(): Promise<{
  readonly directory: string;
  readonly archivePath: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-context-pack-test-"));
  const archivePath = path.join(directory, "fixture.epro2");
  await writeFile(
    archivePath,
    createStoredZip([{ name: "fixture.epru", data: EPRU }])
  );
  return { directory, archivePath };
}

async function readManifest(directory: string): Promise<ContextPackManifest> {
  return JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8")
  ) as ContextPackManifest;
}

async function writeSignedManifest(
  directory: string,
  transform: (manifest: ContextPackManifest) => unknown
): Promise<void> {
  const manifest = await readManifest(directory);
  const transformed = transform(manifest) as Record<string, unknown>;
  const { packageSha256: _ignored, ...base } = transformed;
  await writeFile(
    path.join(directory, "manifest.json"),
    `${canonicalJson({
      ...base,
      packageSha256: sha256CanonicalJson(base)
    })}\n`,
    { mode: 0o600 }
  );
}

async function cloneContextPack(
  source: string,
  parent: string,
  name: string
): Promise<string> {
  const destination = path.join(parent, name);
  await cp(source, destination, { recursive: true });
  if (enforcesPosixModes()) {
    await chmod(destination, 0o700);
    for (const entry of await readdir(destination)) {
      await chmod(path.join(destination, entry), 0o600);
    }
  }
  return destination;
}

async function expectContextPackError(
  directory: string,
  code: string
): Promise<void> {
  await assert.rejects(
    verifyContextPack(directory),
    (error: unknown) => error instanceof AppError && error.code === code
  );
}

test("上下文包以确定性纯原理图清单、逐文件哈希和私有权限发布", async () => {
  const { directory, archivePath } = await createFixture();
  const firstPath = path.join(directory, "first.ai-context");
  const secondPath = path.join(directory, "second.ai-context");
  const ir = await compileProject(archivePath);

  const first = await writeContextPack(archivePath, firstPath, ir);
  const second = await writeContextPack(archivePath, secondPath, ir);
  const firstManifestText = await readFile(
    path.join(firstPath, "manifest.json"),
    "utf8"
  );
  const secondManifestText = await readFile(
    path.join(secondPath, "manifest.json"),
    "utf8"
  );
  const manifest = JSON.parse(firstManifestText) as ContextPackManifest;

  assert.equal(first.packageSha256, second.packageSha256);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(firstManifestText, secondManifestText);
  assert.equal(manifest.schemaVersion, "1.1.0");
  assert.equal(manifest.generator.version, "0.2.0");
  assert.equal(manifest.source.electricalTruth, "NOT_VERIFIED");
  assert.equal(manifest.files.length, 32);
  assert.equal(first.files, 33);
  assert.equal(
    manifest.files.some((file) =>
      /(?:^|[-.])(pcb|footprint)(?:[-.]|$)/u.test(file.path)
    ),
    false
  );

  const components = await readFile(
    path.join(firstPath, "components.jsonl"),
    "utf8"
  );
  const annotations = await readFile(
    path.join(firstPath, "schematic-annotations.jsonl"),
    "utf8"
  );
  const schematicGraphics = await readFile(
    path.join(firstPath, "schematic-graphic-primitives.jsonl"),
    "utf8"
  );
  const schematicTables = await readFile(
    path.join(firstPath, "schematic-tables.jsonl"),
    "utf8"
  );
  const buses = await readFile(path.join(firstPath, "buses.jsonl"), "utf8");
  const componentSemantics = await readFile(
    path.join(firstPath, "component-semantics.jsonl"),
    "utf8"
  );
  const interfaces = await readFile(
    path.join(firstPath, "interfaces.jsonl"),
    "utf8"
  );
  const resourceEdges = await readFile(
    path.join(firstPath, "resource-edges.jsonl"),
    "utf8"
  );
  const resourceNodes = await readFile(
    path.join(firstPath, "resource-nodes.jsonl"),
    "utf8"
  );
  const mcuPinResources = await readFile(
    path.join(firstPath, "mcu-pin-resources.jsonl"),
    "utf8"
  );

  assert.equal(components.includes("private-page-title"), false);
  assert.equal(annotations.includes("private-design-note"), true);
  assert.equal(schematicGraphics.includes("private-page-poly"), true);
  assert.equal(schematicTables.includes("private-table-value"), true);
  assert.equal(buses.endsWith("\n") || buses === "", true);
  assert.equal(componentSemantics.endsWith("\n") || componentSemantics === "", true);
  assert.equal(interfaces.endsWith("\n") || interfaces === "", true);
  assert.equal(resourceEdges.endsWith("\n") || resourceEdges === "", true);
  assert.equal(resourceNodes.endsWith("\n") || resourceNodes === "", true);
  assert.equal(
    mcuPinResources.endsWith("\n") || mcuPinResources === "",
    true
  );

  const mode = (await stat(path.join(firstPath, "manifest.json"))).mode & 0o777;
  if (enforcesPosixModes()) {
    assert.equal(mode, 0o600);
  }
});

test("上下文包拒绝覆盖既有目录且不遗留临时目录", async () => {
  const { directory, archivePath } = await createFixture();
  const outputPath = path.join(directory, "fixture.ai-context");
  const ir = await compileProject(archivePath);
  await writeContextPack(archivePath, outputPath, ir);

  await assert.rejects(
    writeContextPack(archivePath, outputPath, ir),
    (error: unknown) =>
      error instanceof AppError && error.code === ERROR_CODES.OUTPUT_EXISTS
  );
  assert.equal(
    (await readdir(directory)).some((entry) => entry.endsWith(".tmp")),
    false
  );
});

test("独立校验器验证权限、固定能力、规范编码和逐文件哈希", async () => {
  const { directory, archivePath } = await createFixture();
  const outputPath = path.join(directory, "verified.ai-context");
  const ir = await compileProject(archivePath);
  const written = await writeContextPack(archivePath, outputPath, ir);

  const verified = await verifyContextPack(outputPath);
  assert.equal(verified.ok, true);
  assert.equal(verified.gate, "AI_CONTEXT_PACK_VERIFIED");
  assert.equal(verified.packageSha256, written.packageSha256);
  assert.equal(verified.manifestSha256, written.manifestSha256);
  assert.equal(verified.payloadBytes, written.payloadBytes);
  assert.equal(verified.files, written.files);
  assert.equal(verified.records, written.records);
  assert.equal(verified.electricalTruth, "NOT_VERIFIED");

  const componentsPath = path.join(outputPath, "components.jsonl");
  await writeFile(
    componentsPath,
    `${await readFile(componentsPath, "utf8")}{}\n`,
    { mode: 0o600 }
  );
  await assert.rejects(
    verifyContextPack(outputPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.CONTEXT_PACK_MISMATCH
  );
});

test("独立校验器拒绝额外文件和越过真值门禁的能力声明", async () => {
  const { directory, archivePath } = await createFixture();
  const extraPath = path.join(directory, "extra.ai-context");
  const capabilityPath = path.join(directory, "capability.ai-context");
  const ir = await compileProject(archivePath);
  await writeContextPack(archivePath, extraPath, ir);
  await writeFile(path.join(extraPath, "rogue.json"), "{}\n", {
    mode: 0o600
  });
  await assert.rejects(
    verifyContextPack(extraPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.CONTEXT_PACK_MISMATCH
  );

  await writeContextPack(archivePath, capabilityPath, ir);
  const manifestPath = path.join(capabilityPath, "manifest.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8")
  ) as ContextPackManifest;
  const invalidManifest = {
    ...manifest,
    capabilities: {
      ...manifest.capabilities,
      electricalTruth: "VERIFIED"
    }
  };
  await writeFile(
    manifestPath,
    `${canonicalJson(invalidManifest)}\n`,
    { mode: 0o600 }
  );
  await assert.rejects(
    verifyContextPack(capabilityPath),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === ERROR_CODES.CONTEXT_PACK_INVALID
  );
});

test("独立校验器拒绝不安全目录、manifest 文件和非规范编码", async () => {
  const { directory, archivePath } = await createFixture();
  const baseline = path.join(directory, "baseline.ai-context");
  const ir = await compileProject(archivePath);
  await writeContextPack(archivePath, baseline, ir);

  await expectContextPackError(
    path.join(directory, "missing.ai-context"),
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  const plainFile = path.join(directory, "plain-file");
  await writeFile(plainFile, "not a directory", { mode: 0o600 });
  await expectContextPackError(plainFile, ERROR_CODES.CONTEXT_PACK_INVALID);

  const directoryLink = path.join(directory, "directory-link");
  await symlink(baseline, directoryLink, "dir");
  await expectContextPackError(
    directoryLink,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  if (enforcesPosixModes()) {
    const publicDirectory = await cloneContextPack(
      baseline,
      directory,
      "public-directory.ai-context"
    );
    await chmod(publicDirectory, 0o755);
    await expectContextPackError(
      publicDirectory,
      ERROR_CODES.CONTEXT_PACK_INVALID
    );
  }

  const missingManifest = await cloneContextPack(
    baseline,
    directory,
    "missing-manifest.ai-context"
  );
  await rm(path.join(missingManifest, "manifest.json"));
  await expectContextPackError(
    missingManifest,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  const manifestDirectory = await cloneContextPack(
    baseline,
    directory,
    "manifest-directory.ai-context"
  );
  await rm(path.join(manifestDirectory, "manifest.json"));
  await mkdir(path.join(manifestDirectory, "manifest.json"), { mode: 0o700 });
  await expectContextPackError(
    manifestDirectory,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  const manifestLink = await cloneContextPack(
    baseline,
    directory,
    "manifest-link.ai-context"
  );
  await rm(path.join(manifestLink, "manifest.json"));
  await symlink(
    path.join(baseline, "manifest.json"),
    path.join(manifestLink, "manifest.json")
  );
  await expectContextPackError(
    manifestLink,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  if (enforcesPosixModes()) {
    const publicManifest = await cloneContextPack(
      baseline,
      directory,
      "public-manifest.ai-context"
    );
    await chmod(path.join(publicManifest, "manifest.json"), 0o644);
    await expectContextPackError(
      publicManifest,
      ERROR_CODES.CONTEXT_PACK_INVALID
    );
  }

  const oversizedManifest = await cloneContextPack(
    baseline,
    directory,
    "oversized-manifest.ai-context"
  );
  await writeFile(
    path.join(oversizedManifest, "manifest.json"),
    Buffer.alloc(1024 * 1024 + 1, 0x20),
    { mode: 0o600 }
  );
  await expectContextPackError(
    oversizedManifest,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  const invalidUtf8 = await cloneContextPack(
    baseline,
    directory,
    "invalid-utf8-manifest.ai-context"
  );
  await writeFile(
    path.join(invalidUtf8, "manifest.json"),
    Buffer.from([0xff, 0xfe]),
    { mode: 0o600 }
  );
  await expectContextPackError(invalidUtf8, ERROR_CODES.CONTEXT_PACK_INVALID);

  const invalidJson = await cloneContextPack(
    baseline,
    directory,
    "invalid-json-manifest.ai-context"
  );
  await writeFile(path.join(invalidJson, "manifest.json"), "{\n", {
    mode: 0o600
  });
  await expectContextPackError(invalidJson, ERROR_CODES.CONTEXT_PACK_INVALID);

  const nonCanonical = await cloneContextPack(
    baseline,
    directory,
    "noncanonical-manifest.ai-context"
  );
  const manifest = await readManifest(nonCanonical);
  await writeFile(
    path.join(nonCanonical, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );
  await expectContextPackError(
    nonCanonical,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );
});

test("独立校验器严格拒绝非法 manifest 字段、清单与哈希", async () => {
  const { directory, archivePath } = await createFixture();
  const baseline = path.join(directory, "baseline.ai-context");
  const ir = await compileProject(archivePath);
  await writeContextPack(archivePath, baseline, ir);

  const cases: readonly {
    readonly name: string;
    readonly transform: (manifest: ContextPackManifest) => unknown;
    readonly code?: string;
  }[] = [
    {
      name: "manifest-array",
      transform: () => []
    },
    {
      name: "extra-root-field",
      transform: (manifest) => ({ ...manifest, extra: true })
    },
    {
      name: "wrong-schema-version",
      transform: (manifest) => ({ ...manifest, schemaVersion: "2.0.0" })
    },
    {
      name: "invalid-generator",
      transform: (manifest) => ({ ...manifest, generator: null })
    },
    {
      name: "invalid-encoding",
      transform: (manifest) => ({ ...manifest, encoding: [] })
    },
    {
      name: "wrong-generator-name",
      transform: (manifest) => ({
        ...manifest,
        generator: { ...manifest.generator, name: "schemcp" }
      })
    },
    {
      name: "invalid-source-hash",
      transform: (manifest) => ({
        ...manifest,
        source: { ...manifest.source, irSha256: "ABC" }
      })
    },
    {
      name: "files-not-array",
      transform: (manifest) => ({ ...manifest, files: null })
    },
    {
      name: "file-not-object",
      transform: (manifest) => ({ ...manifest, files: [null] })
    },
    {
      name: "file-extra-field",
      transform: (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0], extra: true }, ...manifest.files.slice(1)]
      })
    },
    {
      name: "unsafe-file-name",
      transform: (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0], path: "../escape.json" }, ...manifest.files.slice(1)]
      })
    },
    {
      name: "unsupported-media-type",
      transform: (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0], mediaType: "text/plain" }, ...manifest.files.slice(1)]
      })
    },
    {
      name: "negative-byte-count",
      transform: (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0], bytes: -1 }, ...manifest.files.slice(1)]
      })
    },
    {
      name: "invalid-file-hash",
      transform: (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0], sha256: "0" }, ...manifest.files.slice(1)]
      })
    },
    {
      name: "recursive-manifest-entry",
      transform: (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0], path: "manifest.json" }, ...manifest.files.slice(1)]
      })
    },
    {
      name: "wrong-fixed-order",
      transform: (manifest) => ({
        ...manifest,
        files: [manifest.files[1], manifest.files[0], ...manifest.files.slice(2)]
      })
    },
    {
      name: "invalid-json-record-count",
      transform: (manifest) => ({
        ...manifest,
        files: [{ ...manifest.files[0], records: 2 }, ...manifest.files.slice(1)]
      })
    },
    {
      name: "payload-sum-mismatch",
      transform: (manifest) => ({ ...manifest, payloadBytes: manifest.payloadBytes + 1 })
    },
    {
      name: "payload-over-limit",
      transform: (manifest) => ({ ...manifest, payloadBytes: 1024 * 1024 * 1024 + 1 })
    },
    {
      name: "invalid-package-hash",
      transform: (manifest) => ({ ...manifest, packageSha256: "invalid" })
    },
    {
      name: "invalid-capability",
      transform: (manifest) => ({
        ...manifest,
        capabilities: { ...manifest.capabilities, datasheets: "AVAILABLE" }
      })
    }
  ];

  for (const item of cases) {
    const candidate = await cloneContextPack(
      baseline,
      directory,
      `${item.name}.ai-context`
    );
    if (item.name === "invalid-package-hash") {
      const transformed = item.transform(await readManifest(candidate));
      await writeFile(
        path.join(candidate, "manifest.json"),
        `${canonicalJson(transformed)}\n`,
        { mode: 0o600 }
      );
    } else {
      await writeSignedManifest(candidate, item.transform);
    }
    await expectContextPackError(
      candidate,
      item.code ?? ERROR_CODES.CONTEXT_PACK_INVALID
    );
  }

  const mismatchedHash = await cloneContextPack(
    baseline,
    directory,
    "mismatched-package-hash.ai-context"
  );
  const mismatchedManifest = await readManifest(mismatchedHash);
  await writeFile(
    path.join(mismatchedHash, "manifest.json"),
    `${canonicalJson({ ...mismatchedManifest, packageSha256: "0".repeat(64) })}\n`,
    { mode: 0o600 }
  );
  await expectContextPackError(
    mismatchedHash,
    ERROR_CODES.CONTEXT_PACK_MISMATCH
  );
});

test("独立校验器拒绝 payload 符号链接、权限放宽和非法 JSON/JSONL", async () => {
  const { directory, archivePath } = await createFixture();
  const baseline = path.join(directory, "baseline.ai-context");
  const ir = await compileProject(archivePath);
  await writeContextPack(archivePath, baseline, ir);

  const missingPayload = await cloneContextPack(
    baseline,
    directory,
    "missing-payload.ai-context"
  );
  await rm(path.join(missingPayload, "components.jsonl"));
  await expectContextPackError(
    missingPayload,
    ERROR_CODES.CONTEXT_PACK_MISMATCH
  );

  const payloadDirectory = await cloneContextPack(
    baseline,
    directory,
    "payload-directory.ai-context"
  );
  await rm(path.join(payloadDirectory, "components.jsonl"));
  await mkdir(path.join(payloadDirectory, "components.jsonl"), { mode: 0o700 });
  await expectContextPackError(
    payloadDirectory,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  const payloadLink = await cloneContextPack(
    baseline,
    directory,
    "payload-link.ai-context"
  );
  await rm(path.join(payloadLink, "components.jsonl"));
  await symlink(
    path.join(baseline, "components.jsonl"),
    path.join(payloadLink, "components.jsonl")
  );
  await expectContextPackError(
    payloadLink,
    ERROR_CODES.CONTEXT_PACK_INVALID
  );

  if (enforcesPosixModes()) {
    const publicPayload = await cloneContextPack(
      baseline,
      directory,
      "public-payload.ai-context"
    );
    await chmod(path.join(publicPayload, "components.jsonl"), 0o644);
    await expectContextPackError(
      publicPayload,
      ERROR_CODES.CONTEXT_PACK_INVALID
    );
  }

  const payloadCases: readonly {
    readonly name: string;
    readonly file: string;
    readonly contents: Buffer | string;
  }[] = [
    {
      name: "invalid-utf8",
      file: "components.jsonl",
      contents: Buffer.from([0xff, 0x0a])
    },
    {
      name: "invalid-json",
      file: "components.jsonl",
      contents: "{\n"
    },
    {
      name: "noncanonical-jsonl",
      file: "components.jsonl",
      contents: "{ \"a\": 1 }\n"
    },
    {
      name: "missing-lf",
      file: "components.jsonl",
      contents: "{}"
    },
    {
      name: "empty-record",
      file: "components.jsonl",
      contents: "\n"
    },
    {
      name: "json-multiple-records",
      file: "project-summary.json",
      contents: "{}\n{}\n"
    }
  ];

  for (const item of payloadCases) {
    const candidate = await cloneContextPack(
      baseline,
      directory,
      `${item.name}.ai-context`
    );
    const filePath = path.join(candidate, item.file);
    await writeFile(filePath, item.contents, { mode: 0o600 });
    const bytes = await readFile(filePath);
    await writeSignedManifest(candidate, (manifest) => {
      const correctedFiles = manifest.files.map((file) =>
        file.path === item.file
          ? {
              ...file,
              bytes: bytes.length,
              records: item.name === "json-multiple-records" ? 2 : 1,
              sha256: createHash("sha256").update(bytes).digest("hex")
            }
          : file
      );
      return {
        ...manifest,
        files: correctedFiles,
        payloadBytes: correctedFiles.reduce((sum, file) => sum + file.bytes, 0)
      };
    });
    await expectContextPackError(
      candidate,
      ERROR_CODES.CONTEXT_PACK_INVALID
    );
  }
});

test("context-pack CLI 只返回脱敏收据，私有事实仅写入显式目录", async () => {
  const { directory, archivePath } = await createFixture();
  const outputPath = path.join(directory, "cli.ai-context");
  const cliPath = path.resolve("dist/src/cli/main.js");

  const missingOutput = await execFile(
    process.execPath,
    [cliPath, "context-pack", archivePath],
    { encoding: "utf8" }
  ).catch(
    (error: unknown) =>
      error as { readonly code: number; readonly stderr: string }
  );
  assert.equal("code" in missingOutput ? missingOutput.code : 0, 64);

  const { stdout } = await execFile(
    process.execPath,
    [
      cliPath,
      "context-pack",
      archivePath,
      "--output",
      outputPath,
      "--compact"
    ],
    { encoding: "utf8" }
  );
  const receipt = JSON.parse(stdout) as {
    readonly ok: boolean;
    readonly gate: string;
    readonly electricalTruth: string;
    readonly packageSha256: string;
    readonly files: number;
  };
  assert.equal(receipt.ok, true);
  assert.equal(receipt.gate, "AI_CONTEXT_PACK_WRITTEN");
  assert.equal(receipt.electricalTruth, "NOT_VERIFIED");
  assert.match(receipt.packageSha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.files, 33);
  assert.equal(stdout.includes(archivePath), false);
  assert.equal(stdout.includes(outputPath), false);
  assert.equal(stdout.includes("private-page-title"), false);
  assert.equal(stdout.includes("PRIVATE_NET"), false);

  const manifest = await readManifest(outputPath);
  assert.equal(manifest.source.irSha256.length, 64);
  assert.equal(
    (await readFile(path.join(outputPath, "hierarchy.json"), "utf8")).includes(
      "private-page-title"
    ),
    true
  );

  const verified = await execFile(
    process.execPath,
    [
      cliPath,
      "verify-context-pack",
      outputPath,
      "--compact"
    ],
    { encoding: "utf8" }
  );
  const verification = JSON.parse(verified.stdout) as {
    readonly ok: boolean;
    readonly gate: string;
    readonly packageSha256: string;
    readonly electricalTruth: string;
  };
  assert.equal(verification.ok, true);
  assert.equal(verification.gate, "AI_CONTEXT_PACK_VERIFIED");
  assert.equal(verification.packageSha256, receipt.packageSha256);
  assert.equal(verification.electricalTruth, "NOT_VERIFIED");
  assert.equal(verified.stdout.includes(archivePath), false);
  assert.equal(verified.stdout.includes(outputPath), false);
  assert.equal(verified.stdout.includes("private-page-title"), false);
  assert.equal(verified.stdout.includes("PRIVATE_NET"), false);
});
