import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { enforcesPosixModes } from "../../src/core/filesystem-security.js";
import { AppError, ERROR_CODES } from "../../src/core/error.js";
import {
  extractPdf,
  normalizePdfJsFactoryDirectory
} from "../../src/datasheet/pdf-extractor.js";
import { DatasheetStoreQueryIndex } from "../../src/datasheet/query-index.js";
import {
  importDocumentReference,
  verifyDocumentReferenceBundle,
  verifyDatasheetStore
} from "../../src/datasheet/store.js";
import { QueryError } from "../../src/query/index.js";

function minimalPdf(text: string): Buffer {
  const escaped = text.replace(/[()\\]/gu, (value) => `\\${value}`);
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
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
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    output += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

function outlinedPdf(firstText: string, secondText: string): Buffer {
  const streamA = `BT /F1 12 Tf 72 720 Td (${firstText}) Tj ET`;
  const streamB = `BT /F1 12 Tf 72 720 Td (${secondText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(streamA, "ascii")} >>\nstream\n${streamA}\nendstream`,
    `<< /Length ${Buffer.byteLength(streamB, "ascii")} >>\nstream\n${streamB}\nendstream`,
    "<< /Type /Outlines /First 9 0 R /Last 10 0 R /Count 2 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Title (Overview) /Parent 7 0 R /Next 10 0 R /Dest [3 0 R /Fit] >>",
    "<< /Title (Electrical) /Parent 7 0 R /Prev 9 0 R /Dest [4 0 R /Fit] >>",
    "<< /Title (Synthetic Datasheet) /Author (yuanzihao) /Subject (Verification) >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    output += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 11 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

test("PDF.js 字体目录在 Windows 上使用正斜杠并保留尾随斜杠", () => {
  assert.equal(
    normalizePdfJsFactoryDirectory(
      "D:\\a\\SchemCP\\dist\\src\\vendor\\pdfjs\\standard_fonts\\",
      "\\"
    ),
    "D:/a/SchemCP/dist/src/vendor/pdfjs/standard_fonts/"
  );
  assert.equal(
    normalizePdfJsFactoryDirectory(
      "/opt/schemcp/dist/src/vendor/pdfjs/standard_fonts",
      "/"
    ),
    "/opt/schemcp/dist/src/vendor/pdfjs/standard_fonts/"
  );
});

async function fixture(): Promise<{
  readonly storePath: string;
  readonly documentReferenceId: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-datasheet-"));
  const pdfPath = path.join(directory, "stm32f407.pdf");
  const storePath = path.join(directory, "store");
  await writeFile(
    pdfPath,
    minimalPdf("STM32F407 supply voltage 3.3 V maximum clock 168 MHz")
  );
  const imported = await importDocumentReference({
    pdfPath,
    storePath,
    kind: "DATASHEET",
    binding: {
      method: "EXACT_MANUFACTURER_AND_MPN",
      manufacturer: "STMicroelectronics",
      manufacturerPart: "STM32F407VGT6"
    },
    title: "STM32F405xx STM32F407xx datasheet",
    sourceUrl: "https://www.st.com/example.pdf"
  });
  return {
    storePath,
    documentReferenceId: imported.documentReferenceId
  };
}

test("导入 PDF 形成私有不可变 DocumentReference 并可独立校验", async () => {
  const { storePath, documentReferenceId } = await fixture();
  const verified = await verifyDatasheetStore(storePath);
  assert.equal(verified.ok, true);
  assert.equal(verified.documents, 1);
  assert.equal(verified.pages, 1);
  assert.match(documentReferenceId, /^doc_[a-f0-9]{64}$/u);
  const manifestPath = path.join(
    storePath,
    documentReferenceId,
    "manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    readonly pdf: { readonly sourceAuthenticity: string };
    readonly index: { readonly textExtractionTruth: string };
  };
  assert.equal(
    manifest.pdf.sourceAuthenticity,
    "USER_ASSERTED_NOT_VERIFIED"
  );
  assert.equal(
    manifest.index.textExtractionTruth,
    "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH"
  );
});

test("DocumentReference 拒绝覆盖且权限变更会被校验器发现", async () => {
  const { storePath, documentReferenceId } = await fixture();
  const pdfPath = path.join(
    storePath,
    documentReferenceId,
    "document.pdf"
  );
  await assert.rejects(
    importDocumentReference({
      pdfPath,
      storePath,
      kind: "DATASHEET",
      binding: {
        method: "EXACT_MANUFACTURER_AND_MPN",
        manufacturer: "STMicroelectronics",
        manufacturerPart: "STM32F407VGT6"
      }
    }),
    /拒绝覆盖/u
  );
  await chmod(pdfPath, 0o644);
  if (enforcesPosixModes()) {
    await assert.rejects(
      verifyDatasheetStore(storePath),
      /0600/u
    );
  } else {
    await verifyDatasheetStore(storePath);
  }
});

test("DocumentReference 页索引字节篡改会被独立校验器拒绝", async () => {
  const { storePath, documentReferenceId } = await fixture();
  const pagesPath = path.join(
    storePath,
    documentReferenceId,
    "pages.jsonl"
  );
  await writeFile(pagesPath, "\n", { flag: "a" });
  await assert.rejects(
    verifyDatasheetStore(storePath),
    /pages\.jsonl/u
  );
});

test("数据表查询只按精确身份分页，并返回有界主题文本", async () => {
  const { storePath, documentReferenceId } = await fixture();
  const index = await DatasheetStoreQueryIndex.load(storePath);
  const page = index.listReferences({
    manufacturer: "STMicroelectronics",
    manufacturerPart: "STM32F407VGT6",
    limit: 1
  });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.documentReferenceId, documentReferenceId);
  assert.equal(
    index.listReferences({ manufacturerPart: "STM32F407" }).total,
    0
  );
  const lookup = await index.getSection({
    documentReferenceId,
    topic: "168 MHz",
    maxPages: 1,
    maxChars: 512
  });
  assert.equal(lookup.status, "FOUND");
  assert.match(JSON.stringify(lookup), /168 MHz/u);
  assert.doesNotMatch(JSON.stringify(lookup), new RegExp(storePath, "u"));
});

test("PDF 文本提取保留两页、元数据和书签范围但不冒充版面真值", async () => {
  const extracted = await extractPdf(
    new Uint8Array(outlinedPdf("Overview text", "Electrical limits 3.3 V"))
  );
  assert.equal(extracted.pageCount, 2);
  assert.equal(extracted.pages[0]?.text, "Overview text");
  assert.equal(extracted.pages[1]?.text, "Electrical limits 3.3 V");
  assert.deepEqual(extracted.metadata, {
    title: "Synthetic Datasheet",
    author: "yuanzihao",
    subject: "Verification"
  });
  assert.equal(extracted.outline, "AVAILABLE_PDF_OUTLINE");
  assert.deepEqual(
    extracted.sections.map((section) => [
      section.title,
      section.startPage,
      section.endPage
    ]),
    [
      ["Overview", 1, 1],
      ["Electrical", 2, 2]
    ]
  );

  await assert.rejects(extractPdf(new Uint8Array()), (error: unknown) =>
    error instanceof AppError &&
    error.code === ERROR_CODES.DATASHEET_INPUT_INVALID
  );
  await assert.rejects(
    extractPdf(new Uint8Array(Buffer.from("%PDF-broken", "ascii"))),
    /PDF 解析失败/u
  );
});

test("数据表索引覆盖三种精确绑定、游标隔离和章节查询边界", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-datasheet-index-"));
  const storePath = path.join(directory, "store");
  const inputs = [
    {
      file: "part-master.pdf",
      bytes: outlinedPdf("A".repeat(300), "Power section"),
      kind: "DATASHEET" as const,
      binding: {
        method: "PART_MASTER_ID" as const,
        partMasterId: `pm_${"1".repeat(24)}`
      }
    },
    {
      file: "lcsc.pdf",
      bytes: minimalPdf("LCSC device reference"),
      kind: "APPLICATION_NOTE" as const,
      binding: {
        method: "EXACT_LCSC_PART_ID" as const,
        lcscPartId: "C12345"
      }
    },
    {
      file: "manufacturer.pdf",
      bytes: minimalPdf("Manufacturer device reference"),
      kind: "REFERENCE_MANUAL" as const,
      binding: {
        method: "EXACT_MANUFACTURER_AND_MPN" as const,
        manufacturer: "Acme",
        manufacturerPart: "MCU-1"
      }
    }
  ];
  const imported: string[] = [];
  for (const input of inputs) {
    const pdfPath = path.join(directory, input.file);
    await writeFile(pdfPath, input.bytes);
    const result = await importDocumentReference({
      pdfPath,
      storePath,
      kind: input.kind,
      binding: input.binding
    });
    imported.push(result.documentReferenceId);
  }

  const index = await DatasheetStoreQueryIndex.load(storePath);
  assert.deepEqual(index.getSummary(), {
    binding: "LOCAL_VERIFIED_DATASHEET_STORE",
    documents: 3,
    pages: 4,
    sections: 2,
    sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED",
    electricalTruth: "NOT_APPLICABLE_DEVICE_DOCUMENT_FACTS"
  });
  const first = index.listReferences({ limit: 1 });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = index.listReferences({ limit: 1, cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.equal(
    index.listReferences({ partMasterId: `pm_${"1".repeat(24)}` }).total,
    1
  );
  assert.equal(index.listReferences({ lcscPartId: "C12345" }).total, 1);
  assert.equal(index.listReferences({ kind: "REFERENCE_MANUAL" }).total, 1);
  await assert.rejects(
    async () => index.listReferences({ kind: "DATASHEET", cursor: first.nextCursor }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_CURSOR"
  );
  assert.throws(
    () => index.listReferences({ limit: 0 }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_LIMIT"
  );
  assert.throws(
    () => index.listReferences({ manufacturer: "x".repeat(1025) }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_TEXT"
  );

  const verified = await verifyDocumentReferenceBundle(
    path.join(storePath, imported[0] as string)
  );
  const sectionId = verified.sections[0]?.sectionId;
  assert.ok(sectionId);
  const bySection = await index.getSection({
    documentReferenceId: imported[0] as string,
    sectionId,
    maxPages: 1,
    maxChars: 256
  });
  assert.equal(bySection.status, "FOUND");
  assert.equal(
    typeof (bySection.pages as readonly { readonly truncated: boolean }[])[0]
      ?.truncated,
    "boolean"
  );
  assert.equal(
    (
      await index.getSection({
        documentReferenceId: "doc_missing",
        topic: "power"
      })
    ).status,
    "NOT_FOUND"
  );
  assert.equal(
    (
      await index.getSection({
        documentReferenceId: imported[0] as string,
        sectionId: "sec_000000000000000000000000"
      })
    ).status,
    "NOT_FOUND"
  );
  assert.equal(
    (
      await index.getSection({
        documentReferenceId: imported[0] as string,
        topic: "no such topic"
      })
    ).status,
    "NO_TEXT_MATCH"
  );
  await assert.rejects(
    index.getSection({
      documentReferenceId: imported[0] as string,
      sectionId,
      topic: "power"
    }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_TEXT"
  );
  await assert.rejects(
    index.getSection({
      documentReferenceId: imported[0] as string,
      topic: "power",
      maxPages: 11
    }),
    (error: unknown) => error instanceof QueryError && error.code === "QUERY_INVALID_LIMIT"
  );
});

test("数据表导入拒绝非法身份、元数据、URL 和非 PDF 输入", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eda-datasheet-invalid-"));
  const pdfPath = path.join(directory, "input.pdf");
  const storePath = path.join(directory, "store");
  await writeFile(pdfPath, minimalPdf("fixture"));

  await assert.rejects(
    importDocumentReference({
      pdfPath,
      storePath,
      kind: "DATASHEET",
      binding: { method: "EXACT_LCSC_PART_ID", lcscPartId: "C0" }
    }),
    /LCSC C-ID/u
  );
  await assert.rejects(
    importDocumentReference({
      pdfPath,
      storePath,
      kind: "DATASHEET",
      binding: {
        method: "EXACT_MANUFACTURER_AND_MPN",
        manufacturer: " Acme",
        manufacturerPart: "MCU"
      }
    }),
    /manufacturer/u
  );
  await assert.rejects(
    importDocumentReference({
      pdfPath,
      storePath,
      kind: "DATASHEET",
      binding: { method: "PART_MASTER_ID", partMasterId: `pm_${"1".repeat(24)}` },
      sourceUrl: "http://example.com/device.pdf"
    }),
    /HTTPS/u
  );
  const notPdf = path.join(directory, "not-pdf.pdf");
  await writeFile(notPdf, "plain text");
  await assert.rejects(
    importDocumentReference({
      pdfPath: notPdf,
      storePath,
      kind: "DATASHEET",
      binding: { method: "PART_MASTER_ID", partMasterId: `pm_${"1".repeat(24)}` }
    }),
    /PDF/u
  );
});
