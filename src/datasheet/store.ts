import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import { enforcesPosixModes } from "../core/filesystem-security.js";
import {
  DOCUMENT_REFERENCE_KINDS,
  type DocumentReferenceFileReceipt,
  type DocumentReferenceImportInput,
  type DocumentReferenceManifest,
  type DocumentReferencePage,
  type DocumentReferenceSection
} from "./model.js";
import { extractPdf, PDF_LIMITS } from "./pdf-extractor.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const DOC_ID = /^doc_[a-f0-9]{64}$/u;
const EXPECTED_FILES = [
  "document.pdf",
  "manifest.json",
  "pages.jsonl",
  "sections.jsonl"
] as const;

export interface DocumentReferenceImportResult {
  readonly gate: "DOCUMENT_REFERENCE_IMPORTED";
  readonly documentReferenceId: string;
  readonly pdfSha256: string;
  readonly packageSha256: string;
  readonly pages: number;
  readonly sections: number;
  readonly outline: DocumentReferenceManifest["index"]["outline"];
  readonly sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED";
}

export interface DatasheetStoreVerificationResult {
  readonly ok: true;
  readonly gate: "DATASHEET_STORE_VERIFIED";
  readonly documents: number;
  readonly pages: number;
  readonly sections: number;
  readonly packageSha256: string;
  readonly sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED";
}

function fail(
  code:
    | typeof ERROR_CODES.DATASHEET_INPUT_INVALID
    | typeof ERROR_CODES.DATASHEET_STORE_INVALID
    | typeof ERROR_CODES.DATASHEET_STORE_MISMATCH
    | typeof ERROR_CODES.OUTPUT_EXISTS,
  message: string,
  cause?: unknown
): never {
  throw new AppError(
    code,
    message,
    cause === undefined ? {} : { cause }
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidStoredText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.normalize("NFC") === value &&
    value.trim() === value &&
    value.length >= 1 &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validateText(value: string, field: string): void {
  if (
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    value === "" ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(
      ERROR_CODES.DATASHEET_INPUT_INVALID,
      `${field} 必须是 1～1024 字符的规范非控制文本。`
    );
  }
}

function validateImportInput(input: DocumentReferenceImportInput): void {
  if (!DOCUMENT_REFERENCE_KINDS.includes(input.kind)) {
    fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "文档类型不受支持。");
  }
  if (input.binding.method === "PART_MASTER_ID") {
    if (!/^pm_[a-f0-9]{24,64}$/u.test(input.binding.partMasterId)) {
      fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "PartMaster ID 非法。");
    }
  } else if (input.binding.method === "EXACT_LCSC_PART_ID") {
    if (!/^C[1-9][0-9]{0,15}$/u.test(input.binding.lcscPartId)) {
      fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "LCSC C-ID 非法。");
    }
  } else {
    validateText(input.binding.manufacturer, "manufacturer");
    validateText(input.binding.manufacturerPart, "manufacturerPart");
  }
  for (const [field, value] of [
    ["title", input.title],
    ["documentNumber", input.documentNumber],
    ["revision", input.revision],
    ["publishedDate", input.publishedDate]
  ] as const) {
    if (value !== undefined) validateText(value, field);
  }
  if (input.sourceUrl !== undefined) {
    if (input.sourceUrl.length > 2048) {
      fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "sourceUrl 超过 2048 字符上限。");
    }
    let url: URL;
    try {
      url = new URL(input.sourceUrl);
    } catch {
      fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "sourceUrl 必须是 HTTPS URL。");
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "sourceUrl 必须是无凭据 HTTPS URL。");
    }
  }
}

async function ensureStore(
  storePath: string,
  createIfMissing: boolean
): Promise<string> {
  const resolved = path.resolve(storePath);
  try {
    const info = await lstat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, "数据表库必须是非符号链接目录。");
    }
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      if (!createIfMissing) {
        fail(ERROR_CODES.DATASHEET_STORE_INVALID, "数据表库目录不存在。");
      }
      await mkdir(resolved, { mode: 0o700 });
    } else {
      throw error;
    }
  }
  const canonical = await realpath(resolved);
  if (
    enforcesPosixModes() &&
    ((await stat(canonical)).mode & 0o777) !== 0o700
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "数据表库目录权限必须是 0700。");
  }
  return canonical;
}

async function fileReceipt(
  directory: string,
  filePath: DocumentReferenceFileReceipt["path"],
  mediaType: DocumentReferenceFileReceipt["mediaType"],
  records: number
): Promise<DocumentReferenceFileReceipt> {
  const bytes = await readFile(path.join(directory, filePath));
  return {
    path: filePath,
    mediaType,
    bytes: bytes.byteLength,
    records,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function writePrivate(
  target: string,
  bytes: Uint8Array | string
): Promise<void> {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

function jsonl(values: readonly unknown[]): string {
  return values.map((value) => `${canonicalJson(value)}\n`).join("");
}

export async function importDocumentReference(
  input: DocumentReferenceImportInput
): Promise<DocumentReferenceImportResult> {
  validateImportInput(input);
  const source = await lstat(input.pdfPath).catch((error: unknown) => {
    fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "无法读取 PDF 输入文件。", error);
  });
  if (
    source.isSymbolicLink() ||
    !source.isFile() ||
    source.size < 5 ||
    source.size > PDF_LIMITS.maxBytes
  ) {
    fail(ERROR_CODES.DATASHEET_INPUT_INVALID, "PDF 必须是安全上限内的普通文件且不能是符号链接。");
  }
  const pdfBytes = await readFile(input.pdfPath);
  const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const documentReferenceId = `doc_${pdfSha256}`;
  const extraction = await extractPdf(new Uint8Array(pdfBytes));
  const store = await ensureStore(input.storePath, true);
  const target = path.join(store, documentReferenceId);
  try {
    await lstat(target);
    fail(ERROR_CODES.OUTPUT_EXISTS, "相同 PDF 的 DocumentReference 已存在，拒绝覆盖。");
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const temporary = path.join(
    store,
    `.${documentReferenceId}.${process.pid}.${randomUUID()}.tmp`
  );
  await mkdir(temporary, { mode: 0o700 });
  try {
    await writePrivate(
      path.join(temporary, "document.pdf"),
      pdfBytes
    );
    await writePrivate(
      path.join(temporary, "pages.jsonl"),
      jsonl(extraction.pages)
    );
    await writePrivate(
      path.join(temporary, "sections.jsonl"),
      jsonl(extraction.sections)
    );
    const files = await Promise.all([
      fileReceipt(temporary, "document.pdf", "application/pdf", 1),
      fileReceipt(
        temporary,
        "pages.jsonl",
        "application/x-ndjson",
        extraction.pages.length
      ),
      fileReceipt(
        temporary,
        "sections.jsonl",
        "application/x-ndjson",
        extraction.sections.length
      )
    ]);
    const document = {
      kind: input.kind,
      binding: input.binding,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.documentNumber === undefined
        ? {}
        : { documentNumber: input.documentNumber }),
      ...(input.revision === undefined
        ? {}
        : { revision: input.revision }),
      ...(input.publishedDate === undefined
        ? {}
        : { publishedDate: input.publishedDate }),
      ...(input.sourceUrl === undefined
        ? {}
        : { sourceUrl: input.sourceUrl }),
      assertedMetadataTruth: "USER_ASSERTED_NOT_VERIFIED" as const
    };
    const base = {
      schemaVersion: "0.1.0" as const,
      documentReferenceId,
      generator: {
        name: "@yuanzihao/schemcp" as const,
        version: "0.1.0"
      },
      document,
      pdf: {
        sha256: pdfSha256,
        bytes: pdfBytes.byteLength,
        pages: extraction.pageCount,
        ...extraction.metadata,
        metadataTruth: "PDF_METADATA_NOT_SOURCE_AUTHENTICITY" as const,
        sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED" as const
      },
      index: {
        pages: extraction.pages.length,
        sections: extraction.sections.length,
        outline: extraction.outline,
        textExtractionTruth:
          "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH" as const
      },
      files,
      payloadBytes: files.reduce((sum, file) => sum + file.bytes, 0)
    };
    const manifest: DocumentReferenceManifest = {
      ...base,
      packageSha256: sha256CanonicalJson(base)
    };
    await writePrivate(
      path.join(temporary, "manifest.json"),
      `${canonicalJson(manifest)}\n`
    );
    await rename(temporary, target);
    return {
      gate: "DOCUMENT_REFERENCE_IMPORTED",
      documentReferenceId,
      pdfSha256,
      packageSha256: manifest.packageSha256,
      pages: extraction.pages.length,
      sections: extraction.sections.length,
      outline: extraction.outline,
      sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED"
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function parseCanonicalJson(text: string, label: string): unknown {
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, `${label} 不是单行规范 JSON。`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, `${label} JSON 无效。`, error);
  }
  if (`${canonicalJson(value)}\n` !== text) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, `${label} 不是规范 JSON 编码。`);
  }
  return value;
}

function parseCanonicalJsonl(text: string, label: string): readonly unknown[] {
  if (text === "") return [];
  if (!text.endsWith("\n")) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, `${label} 必须以 LF 结束。`);
  }
  return text
    .slice(0, -1)
    .split("\n")
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        fail(ERROR_CODES.DATASHEET_STORE_INVALID, `${label} 第 ${index + 1} 行 JSON 无效。`, error);
      }
      if (canonicalJson(value) !== line) {
        fail(ERROR_CODES.DATASHEET_STORE_INVALID, `${label} 第 ${index + 1} 行不是规范 JSON。`);
      }
      return value;
    });
}

function parseManifest(value: unknown, bundleName: string): DocumentReferenceManifest {
  if (!isObject(value)) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "manifest.json 必须是对象。");
  }
  const expectedRootKeys = [
    "document",
    "documentReferenceId",
    "files",
    "generator",
    "index",
    "packageSha256",
    "payloadBytes",
    "pdf",
    "schemaVersion"
  ];
  if (
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(expectedRootKeys) ||
    value.schemaVersion !== "0.1.0" ||
    value.documentReferenceId !== bundleName ||
    !DOC_ID.test(bundleName) ||
    !isObject(value.generator) ||
    value.generator.name !== "@yuanzihao/schemcp" ||
    value.generator.version !== "0.1.0" ||
    !isObject(value.document) ||
    !isObject(value.pdf) ||
    !isObject(value.index) ||
    !Array.isArray(value.files) ||
    value.files.length !== 3 ||
    !Number.isSafeInteger(value.payloadBytes) ||
    (value.payloadBytes as number) < 0 ||
    typeof value.packageSha256 !== "string" ||
    !SHA256.test(value.packageSha256)
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference manifest 固定字段无效。");
  }
  const withoutPackage = { ...value };
  delete withoutPackage.packageSha256;
  if (sha256CanonicalJson(withoutPackage) !== value.packageSha256) {
    fail(ERROR_CODES.DATASHEET_STORE_MISMATCH, "DocumentReference packageSha256 不匹配。");
  }
  const expectedReceipts = [
    ["document.pdf", "application/pdf"],
    ["pages.jsonl", "application/x-ndjson"],
    ["sections.jsonl", "application/x-ndjson"]
  ] as const;
  let payloadBytes = 0;
  value.files.forEach((receipt, index) => {
    const expected = expectedReceipts[index];
    if (
      !isObject(receipt) ||
      JSON.stringify(Object.keys(receipt).sort()) !==
        JSON.stringify(["bytes", "mediaType", "path", "records", "sha256"]) ||
      receipt.path !== expected?.[0] ||
      receipt.mediaType !== expected?.[1] ||
      !Number.isSafeInteger(receipt.bytes) ||
      (receipt.bytes as number) < 0 ||
      !Number.isSafeInteger(receipt.records) ||
      (receipt.records as number) < 0 ||
      typeof receipt.sha256 !== "string" ||
      !SHA256.test(receipt.sha256)
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference 文件收据无效。");
    }
    payloadBytes += receipt.bytes as number;
  });
  if (payloadBytes !== value.payloadBytes) {
    fail(ERROR_CODES.DATASHEET_STORE_MISMATCH, "DocumentReference payloadBytes 不匹配。");
  }
  if (
    value.document.assertedMetadataTruth !== "USER_ASSERTED_NOT_VERIFIED" ||
    typeof value.document.kind !== "string" ||
    !DOCUMENT_REFERENCE_KINDS.includes(
      value.document.kind as DocumentReferenceManifest["document"]["kind"]
    ) ||
    !isObject(value.document.binding) ||
    value.pdf.metadataTruth !== "PDF_METADATA_NOT_SOURCE_AUTHENTICITY" ||
    value.pdf.sourceAuthenticity !== "USER_ASSERTED_NOT_VERIFIED" ||
    typeof value.pdf.sha256 !== "string" ||
    !SHA256.test(value.pdf.sha256) ||
    !Number.isSafeInteger(value.pdf.bytes) ||
    (value.pdf.bytes as number) < 5 ||
    !Number.isSafeInteger(value.pdf.pages) ||
    (value.pdf.pages as number) < 1 ||
    value.index.textExtractionTruth !==
      "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH" ||
    (value.index.outline !== "AVAILABLE_PDF_OUTLINE" &&
      value.index.outline !== "PDF_OUTLINE_UNAVAILABLE") ||
    !Number.isSafeInteger(value.index.pages) ||
    (value.index.pages as number) < 1 ||
    !Number.isSafeInteger(value.index.sections) ||
    (value.index.sections as number) < 0
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference 文档、PDF 或索引边界字段无效。");
  }
  const documentAllowedKeys = new Set([
    "assertedMetadataTruth",
    "binding",
    "documentNumber",
    "kind",
    "publishedDate",
    "revision",
    "sourceUrl",
    "title"
  ]);
  const pdfAllowedKeys = new Set([
    "author",
    "bytes",
    "metadataTruth",
    "pages",
    "sha256",
    "sourceAuthenticity",
    "subject",
    "title"
  ]);
  if (
    JSON.stringify(Object.keys(value.generator).sort()) !==
      JSON.stringify(["name", "version"]) ||
    Object.keys(value.document).some(
      (key) => !documentAllowedKeys.has(key)
    ) ||
    Object.keys(value.pdf).some((key) => !pdfAllowedKeys.has(key)) ||
    JSON.stringify(Object.keys(value.index).sort()) !==
      JSON.stringify([
        "outline",
        "pages",
        "sections",
        "textExtractionTruth"
      ])
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference 嵌套字段集合无效。");
  }
  for (const field of [
    "title",
    "documentNumber",
    "revision",
    "publishedDate"
  ] as const) {
    const fieldValue = value.document[field];
    if (
      fieldValue !== undefined &&
      !isValidStoredText(fieldValue)
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, `DocumentReference ${field} 无效。`);
    }
  }
  if (value.document.sourceUrl !== undefined) {
    if (
      typeof value.document.sourceUrl !== "string" ||
      value.document.sourceUrl.length > 2048
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference sourceUrl 无效。");
    }
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(value.document.sourceUrl);
    } catch {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference sourceUrl 无效。");
    }
    if (
      sourceUrl.protocol !== "https:" ||
      sourceUrl.username !== "" ||
      sourceUrl.password !== ""
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference sourceUrl 必须是无凭据 HTTPS URL。");
    }
  }
  for (const field of ["title", "author", "subject"] as const) {
    const fieldValue = value.pdf[field];
    if (
      fieldValue !== undefined &&
      !isValidStoredText(fieldValue)
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, `DocumentReference PDF ${field} 无效。`);
    }
  }
  const binding = value.document.binding;
  const bindingValid =
    (binding.method === "PART_MASTER_ID" &&
      Object.keys(binding).length === 2 &&
      typeof binding.partMasterId === "string" &&
      /^pm_[a-f0-9]{24,64}$/u.test(binding.partMasterId)) ||
    (binding.method === "EXACT_LCSC_PART_ID" &&
      Object.keys(binding).length === 2 &&
      typeof binding.lcscPartId === "string" &&
      /^C[1-9][0-9]{0,15}$/u.test(binding.lcscPartId)) ||
    (binding.method === "EXACT_MANUFACTURER_AND_MPN" &&
      Object.keys(binding).length === 3 &&
      typeof binding.manufacturer === "string" &&
      typeof binding.manufacturerPart === "string" &&
      isValidStoredText(binding.manufacturer) &&
      isValidStoredText(binding.manufacturerPart));
  if (!bindingValid) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference 精确身份绑定无效。");
  }
  return value as unknown as DocumentReferenceManifest;
}

function validatePages(values: readonly unknown[]): readonly DocumentReferencePage[] {
  return values.map((value, index) => {
    if (
      !isObject(value) ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify([
          "charCount",
          "extractionTruth",
          "pageNumber",
          "text",
          "textSha256"
        ]) ||
      value.pageNumber !== index + 1 ||
      typeof value.text !== "string" ||
      value.text.normalize("NFC") !== value.text ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.text) ||
      value.charCount !== value.text.length ||
      value.extractionTruth !== "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH" ||
      typeof value.textSha256 !== "string" ||
      !SHA256.test(value.textSha256) ||
      createHash("sha256").update(value.text).digest("hex") !==
        value.textSha256
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, `pages.jsonl 第 ${index + 1} 条记录无效。`);
    }
    return value as unknown as DocumentReferencePage;
  });
}

function validateSections(
  values: readonly unknown[],
  pageCount: number
): readonly DocumentReferenceSection[] {
  const ids = new Set<string>();
  const sections = values.map((value, index) => {
    const expectedId =
      isObject(value) &&
      typeof value.level === "number" &&
      typeof value.startPage === "number" &&
      typeof value.title === "string"
        ? `sec_${createHash("sha256")
            .update(
              `${index + 1}\u0000${value.level}\u0000${value.startPage}\u0000${value.title}`
            )
            .digest("hex")
            .slice(0, 24)}`
        : "";
    if (
      !isObject(value) ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify([
          "endPage",
          "level",
          "rangeTruth",
          "sectionId",
          "startPage",
          "title"
        ]) ||
      typeof value.sectionId !== "string" ||
      !/^sec_[a-f0-9]{24}$/u.test(value.sectionId) ||
      value.sectionId !== expectedId ||
      ids.has(value.sectionId) ||
      !isValidStoredText(value.title) ||
      !Number.isSafeInteger(value.level) ||
      (value.level as number) < 1 ||
      !Number.isSafeInteger(value.startPage) ||
      (value.startPage as number) < 1 ||
      !Number.isSafeInteger(value.endPage) ||
      (value.endPage as number) < (value.startPage as number) ||
      (value.endPage as number) > pageCount ||
      value.rangeTruth !== "PDF_OUTLINE_PAGE_RANGE_DERIVED"
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, `sections.jsonl 第 ${index + 1} 条记录无效。`);
    }
    ids.add(value.sectionId);
    return value as unknown as DocumentReferenceSection;
  });
  sections.forEach((section, index) => {
    const next = sections
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.level <= section.level &&
          candidate.startPage >= section.startPage
      );
    const expectedEndPage = Math.max(
      section.startPage,
      (next?.startPage ?? pageCount + 1) - 1
    );
    if (section.endPage !== expectedEndPage) {
      fail(ERROR_CODES.DATASHEET_STORE_MISMATCH, `sections.jsonl 第 ${index + 1} 条范围不可复算。`);
    }
  });
  return sections;
}

export async function verifyDocumentReferenceBundle(
  bundlePath: string
): Promise<{
  readonly manifest: DocumentReferenceManifest;
  readonly pages: readonly DocumentReferencePage[];
  readonly sections: readonly DocumentReferenceSection[];
}> {
  const bundleInfo = await lstat(bundlePath);
  if (
    !bundleInfo.isDirectory() ||
    bundleInfo.isSymbolicLink() ||
    (enforcesPosixModes() && (bundleInfo.mode & 0o777) !== 0o700)
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference 目录必须是 0700 非符号链接目录。");
  }
  const names = (await readdir(bundlePath)).sort();
  if (
    names.length !== EXPECTED_FILES.length ||
    names.some((name, index) => name !== EXPECTED_FILES[index])
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_INVALID, "DocumentReference 文件清单不符合固定契约。");
  }
  for (const name of names) {
    const info = await lstat(path.join(bundlePath, name));
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (enforcesPosixModes() && (info.mode & 0o777) !== 0o600)
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, `${name} 必须是 0600 普通文件。`);
    }
  }
  const manifestText = await readFile(path.join(bundlePath, "manifest.json"), "utf8");
  const manifest = parseManifest(
    parseCanonicalJson(manifestText, "manifest.json"),
    path.basename(bundlePath)
  );
  const pages = validatePages(parseCanonicalJsonl(
    await readFile(path.join(bundlePath, "pages.jsonl"), "utf8"),
    "pages.jsonl"
  ));
  const sections = validateSections(parseCanonicalJsonl(
    await readFile(path.join(bundlePath, "sections.jsonl"), "utf8"),
    "sections.jsonl"
  ), pages.length);
  if (
    manifest.index.pages !== pages.length ||
    manifest.index.sections !== sections.length ||
    manifest.pdf.pages !== pages.length
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_MISMATCH, "DocumentReference 记录数与 manifest 不一致。");
  }
  if (
    manifest.files[0]?.bytes !== manifest.pdf.bytes ||
    manifest.files[0]?.records !== 1 ||
    manifest.files[1]?.records !== pages.length ||
    manifest.files[2]?.records !== sections.length
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_MISMATCH, "DocumentReference PDF 或记录数收据不一致。");
  }
  for (const receipt of manifest.files) {
    const file = await readFile(path.join(bundlePath, receipt.path));
    if (
      file.byteLength !== receipt.bytes ||
      createHash("sha256").update(file).digest("hex") !== receipt.sha256
    ) {
      fail(ERROR_CODES.DATASHEET_STORE_MISMATCH, `${receipt.path} 收据不匹配。`);
    }
  }
  const pdf = await readFile(path.join(bundlePath, "document.pdf"));
  if (
    createHash("sha256").update(pdf).digest("hex") !== manifest.pdf.sha256 ||
    `doc_${manifest.pdf.sha256}` !== manifest.documentReferenceId ||
    Buffer.from(pdf.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    fail(ERROR_CODES.DATASHEET_STORE_MISMATCH, "PDF 哈希、魔数或 DocumentReference ID 不匹配。");
  }
  return { manifest, pages, sections };
}

export async function readDatasheetStore(
  storePath: string
): Promise<readonly {
  readonly bundlePath: string;
  readonly manifest: DocumentReferenceManifest;
}[]> {
  const store = await ensureStore(storePath, false);
  const names = (await readdir(store)).sort();
  const results: Array<{
    readonly bundlePath: string;
    readonly manifest: DocumentReferenceManifest;
  }> = [];
  for (const name of names) {
    if (!DOC_ID.test(name)) {
      fail(ERROR_CODES.DATASHEET_STORE_INVALID, `数据表库包含未知条目：${name}`);
    }
    const result = await verifyDocumentReferenceBundle(path.join(store, name));
    results.push({
      bundlePath: path.join(store, name),
      manifest: result.manifest
    });
  }
  return results;
}

export async function verifyDatasheetStore(
  storePath: string
): Promise<DatasheetStoreVerificationResult> {
  const references = await readDatasheetStore(storePath);
  return {
    ok: true,
    gate: "DATASHEET_STORE_VERIFIED",
    documents: references.length,
    pages: references.reduce((sum, item) => sum + item.manifest.index.pages, 0),
    sections: references.reduce((sum, item) => sum + item.manifest.index.sections, 0),
    packageSha256: sha256CanonicalJson(
      references.map((item) => ({
        documentReferenceId: item.manifest.documentReferenceId,
        packageSha256: item.manifest.packageSha256
      }))
    ),
    sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED"
  };
}
