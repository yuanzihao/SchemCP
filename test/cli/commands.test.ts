import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { canonicalJson } from "../../src/core/canonical-json.js";
import {
  createSchematicAssemblyManifest,
  projectIdForIr
} from "../../src/mcp/assembly-manifest.js";
import { createStoredZip } from "../helpers/zip-fixture.js";

const execFile = promisify(execFileCallback);
const cli = path.resolve("dist/src/cli/main.js");

function record(
  outer: Readonly<Record<string, unknown>>,
  inner: Readonly<Record<string, unknown>>
): string {
  return `${JSON.stringify(outer)}||${JSON.stringify(inner)}|`;
}

const EPRU = [
  record(
    { type: "DOCHEAD" },
    { docType: "SCH", client: "c", uuid: "schematic" }
  ),
  record({ type: "META", ticket: 1 }, { name: "Synthetic" }),
  record(
    { type: "DOCHEAD" },
    { docType: "SCH_PAGE", client: "c", uuid: "page" }
  ),
  record(
    { type: "META", ticket: 2 },
    { title: "Main", schematic: "schematic" }
  )
].join("\n");

function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CliResult> {
  try {
    const result = await execFile(process.execPath, [cli, ...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      readonly code?: number;
      readonly stdout?: string;
      readonly stderr?: string;
    };
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

test("辅助 CLI 的全部公开读写/校验入口形成可复算纵切", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "schemcp-cli-all-"));
  const project = path.join(root, "fixture.epro2");
  const netlist = path.join(root, "fixture.enet");
  const ir = path.join(root, "fixture.eda-ir.json");
  const context = path.join(root, "fixture.ai-context");
  const evidence = path.join(root, "fixture.truth-evidence");
  const comparison = path.join(root, "fixture.netlist-comparison.json");
  const pdf = path.join(root, "fixture.pdf");
  const store = path.join(root, "store");
  const assembly = path.join(root, "fixture.schemcp-assembly.json");
  await Promise.all([
    writeFile(project, createStoredZip([{ name: "fixture.epru", data: EPRU }])),
    writeFile(
      netlist,
      JSON.stringify({
        version: "2.0.0",
        components: {},
        designRule: {},
        netClass: {},
        equalLengthNetGroup: {},
        differentialPair: {}
      }),
      { mode: 0o600 }
    ),
    writeFile(pdf, minimalPdf("Synthetic datasheet"))
  ]);
  const manifest = createSchematicAssemblyManifest({
    schema: "schemcp.schematic-assembly-manifest",
    schemaVersion: "1.0.0",
    generator: { name: "@yuanzihao/schemcp", version: "0.2.0" },
    projects: ["a", "b"].map((value) => {
      const irSha256 = value.repeat(64);
      return { projectId: projectIdForIr(irSha256), irSha256 };
    }),
    assembly: {
      projectIds: ["a", "b"].map((value) =>
        projectIdForIr(value.repeat(64))
      ),
      interconnects: [],
      relationshipTruth: "USER_ASSERTED_PROJECT_RELATIONSHIP"
    }
  });
  await writeFile(assembly, `${canonicalJson(manifest)}\n`, { mode: 0o600 });

  const commands: readonly (readonly string[])[] = [
    ["inspect", project, "--compact"],
    ["compile", project, "--output", ir, "--compact"],
    ["context-pack", project, "--output", context, "--compact"],
    ["verify-context-pack", context, "--compact"],
    ["import-netlist-evidence", project, "--netlist", netlist, "--output", evidence, "--compact"],
    ["verify-netlist-evidence", evidence, "--compact"],
    ["compare-netlist", project, "--netlist", netlist, "--output", comparison, "--compact"],
    ["verify-netlist-comparison", project, "--netlist", netlist, "--report", comparison, "--compact"],
    [
      "import-datasheet-reference",
      pdf,
      "--store",
      store,
      "--kind",
      "DATASHEET",
      "--manufacturer",
      "Acme",
      "--mpn",
      "MCU-1",
      "--title",
      "Synthetic",
      "--document-number",
      "DS-1",
      "--revision",
      "A",
      "--published-date",
      "2026-07-31",
      "--source-url",
      "https://example.com/device.pdf",
      "--compact"
    ],
    ["verify-datasheet-store", store, "--compact"],
    ["verify-assembly-manifest", assembly, "--compact"]
  ];
  for (const args of commands) {
    const result = await runCli(args);
    assert.equal(result.code, 0, `${args[0]}: ${result.stderr}`);
    assert.notEqual(
      (JSON.parse(result.stdout) as { readonly ok?: boolean }).ok,
      false
    );
  }
});

test("辅助 CLI 对每类重复、缺失和未知选项返回 usage 错误", async () => {
  const invalidCommands: readonly (readonly string[])[] = [
    ["inspect", "x.epro2", "--unknown"],
    ["compile", "x.epro2"],
    ["compile", "x.epro2", "--output"],
    ["compile", "x.epro2", "--output", "a", "--output", "b"],
    ["compile", "x.epro2", "--output", "a", "--compact", "--compact"],
    ["compile", "x.epro2", "--output", "a", "--force", "--force"],
    ["context-pack", "x.epro2"],
    ["context-pack", "x.epro2", "--output", "a", "--output", "b"],
    ["verify-context-pack", "x", "--compact", "--compact"],
    ["import-netlist-evidence", "x.epro2", "--netlist", "x.enet"],
    ["import-netlist-evidence", "x.epro2", "--netlist", "a", "--netlist", "b", "--output", "x"],
    ["verify-netlist-evidence", "x", "--bad"],
    ["compare-netlist", "x.epro2", "--netlist", "x.enet"],
    ["verify-netlist-comparison", "x.epro2", "--netlist", "x.enet"],
    ["mcp-config"],
    ["mcp-config", "--client", "invalid"],
    ["mcp-config", "--client", "generic", "--portable", "--portable"],
    ["mcp-config", "--client", "generic", "--netlist"],
    ["mcp-config", "--client", "generic", "--baseline-project"],
    ["mcp-config", "--client", "generic", "--datasheet-store"],
    ["mcp-config", "relative.epro2", "--client", "generic"],
    ["import-datasheet-reference", "x.pdf", "--kind", "DATASHEET"],
    ["import-datasheet-reference", "x.pdf", "--store", "s", "--kind", "BAD"],
    ["import-datasheet-reference", "x.pdf", "--store", "s", "--kind", "DATASHEET", "--lcsc-part-id", "C1", "--part-master-id", "pm_1"],
    ["import-datasheet-reference", "x.pdf", "--store", "s", "--kind", "DATASHEET", "--manufacturer", "Acme"],
    ["verify-datasheet-store", "x", "--compact", "--compact"],
    ["verify-assembly-manifest", "x", "--bad"],
    ["unknown"],
    []
  ];
  for (const args of invalidCommands) {
    const result = await runCli(args);
    if (args.length === 0) {
      assert.equal(result.code, 0);
      assert.match(result.stdout, /用法/u);
    } else {
      assert.equal(result.code, 64, `${args.join(" ")}: ${result.stderr}`);
      assert.match(result.stderr, /用法/u);
    }
  }
});
