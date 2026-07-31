import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AppError, ERROR_CODES } from "../core/error.js";
import type {
  DocumentReferencePage,
  DocumentReferenceSection
} from "./model.js";

export const PDF_LIMITS = {
  maxBytes: 64 * 1024 * 1024,
  maxPages: 5000,
  maxPageTextBytes: 1024 * 1024,
  maxTotalTextBytes: 64 * 1024 * 1024,
  maxOutlineEntries: 20_000,
  maxOutlineDepth: 32
} as const;

interface OutlineNode {
  readonly title: string;
  readonly dest: string | readonly unknown[] | null;
  readonly items: readonly OutlineNode[];
}

interface PdfPageProxy {
  getTextContent(options: {
    readonly disableNormalization: boolean;
  }): Promise<{ readonly items: readonly unknown[] }>;
  cleanup(): void;
}

interface PdfDocumentProxy {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  getMetadata(): Promise<{
    readonly info: Readonly<Record<string, unknown>>;
  }>;
  getOutline(): Promise<readonly OutlineNode[] | null>;
  getDestination(name: string): Promise<readonly unknown[] | null>;
  getPageIndex(reference: object): Promise<number>;
}

interface PdfLoadingTask {
  readonly promise: Promise<PdfDocumentProxy>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  readonly getDocument: (
    options: Readonly<Record<string, unknown>>
  ) => PdfLoadingTask;
}

const PDFJS_MODULE_PATH = "../vendor/pdfjs/pdf.mjs";

class TextOnlyDomMatrix {
  public a = 1;
  public b = 0;
  public c = 0;
  public d = 1;
  public e = 0;
  public f = 0;

  public constructor(initial?: unknown) {
    if (
      Array.isArray(initial) &&
      initial.length >= 6 &&
      initial.slice(0, 6).every((value) => typeof value === "number")
    ) {
      const values = initial as [
        number,
        number,
        number,
        number,
        number,
        number
      ];
      [this.a, this.b, this.c, this.d, this.e, this.f] =
        values;
    }
  }

  private values(): readonly number[] {
    return [this.a, this.b, this.c, this.d, this.e, this.f];
  }

  private assign(values: readonly number[]): this {
    const tuple = values as [
      number,
      number,
      number,
      number,
      number,
      number
    ];
    [
      this.a,
      this.b,
      this.c,
      this.d,
      this.e,
      this.f
    ] = tuple;
    return this;
  }

  private static multiply(
    left: readonly number[],
    right: readonly number[]
  ): readonly number[] {
    const [a1, b1, c1, d1, e1, f1] = left as [
      number,
      number,
      number,
      number,
      number,
      number
    ];
    const [a2, b2, c2, d2, e2, f2] = right as [
      number,
      number,
      number,
      number,
      number,
      number
    ];
    return [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1
    ];
  }

  public multiplySelf(other: TextOnlyDomMatrix): this {
    return this.assign(
      TextOnlyDomMatrix.multiply(this.values(), other.values())
    );
  }

  public preMultiplySelf(other: TextOnlyDomMatrix): this {
    return this.assign(
      TextOnlyDomMatrix.multiply(other.values(), this.values())
    );
  }

  public translate(x = 0, y = 0): TextOnlyDomMatrix {
    return new TextOnlyDomMatrix(this.values()).multiplySelf(
      new TextOnlyDomMatrix([1, 0, 0, 1, x, y])
    );
  }

  public scale(x = 1, y = x): TextOnlyDomMatrix {
    return new TextOnlyDomMatrix(this.values()).multiplySelf(
      new TextOnlyDomMatrix([x, 0, 0, y, 0, 0])
    );
  }

  public invertSelf(): this {
    const determinant = this.a * this.d - this.b * this.c;
    if (determinant === 0) {
      return this.assign([
        Number.NaN,
        Number.NaN,
        Number.NaN,
        Number.NaN,
        Number.NaN,
        Number.NaN
      ]);
    }
    return this.assign([
      this.d / determinant,
      -this.b / determinant,
      -this.c / determinant,
      this.a / determinant,
      (this.c * this.f - this.d * this.e) / determinant,
      (this.b * this.e - this.a * this.f) / determinant
    ]);
  }
}

class TextOnlyPath2D {
  public addPath(): never {
    throw new Error("文本解析模式不支持 PDF 渲染。");
  }
}

function installTextOnlyPdfGlobals(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.DOMMatrix ??= TextOnlyDomMatrix;
  globals.Path2D ??= TextOnlyPath2D;
}

interface PdfTextItem {
  readonly str: string;
  readonly hasEOL: boolean;
}

export interface PdfExtraction {
  readonly pageCount: number;
  readonly metadata: {
    readonly title?: string;
    readonly author?: string;
    readonly subject?: string;
  };
  readonly pages: readonly DocumentReferencePage[];
  readonly sections: readonly DocumentReferenceSection[];
  readonly outline:
    | "AVAILABLE_PDF_OUTLINE"
    | "PDF_OUTLINE_UNAVAILABLE";
}

function fail(message: string, cause?: unknown): never {
  throw new AppError(
    ERROR_CODES.DATASHEET_INPUT_INVALID,
    message,
    cause === undefined ? {} : { cause }
  );
}

function optionalMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFC").trim();
  return normalized === "" ? undefined : normalized.slice(0, 1024);
}

function normalizedPageText(items: readonly unknown[]): string {
  const chunks: string[] = [];
  for (const item of items) {
    if (
      item !== null &&
      typeof item === "object" &&
      "str" in item &&
      typeof (item as PdfTextItem).str === "string"
    ) {
      const text = (item as PdfTextItem).str
        .normalize("NFC")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
      if (text !== "") chunks.push(text);
      if ((item as PdfTextItem).hasEOL) chunks.push("\n");
      else chunks.push(" ");
    }
  }
  return chunks
    .join("")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

async function resolveDestinationPage(
  document: PdfDocumentProxy,
  destination: string | readonly unknown[] | null
): Promise<number | undefined> {
  if (destination === null) return undefined;
  const explicit =
    typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;
  if (explicit === null || explicit.length === 0) return undefined;
  const first = explicit[0];
  if (typeof first === "number" && Number.isSafeInteger(first)) {
    return first + 1;
  }
  if (first !== null && typeof first === "object") {
    try {
      return (await document.getPageIndex(
        first
      )) + 1;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function extractSections(
  document: PdfDocumentProxy,
  pageCount: number
): Promise<readonly DocumentReferenceSection[]> {
  const outline = (await document.getOutline()) as
    | readonly OutlineNode[]
    | null;
  if (outline === null || outline.length === 0) return [];
  const flat: Array<{
    readonly title: string;
    readonly level: number;
    readonly startPage: number;
  }> = [];
  let visited = 0;
  const visit = async (
    nodes: readonly OutlineNode[],
    level: number
  ): Promise<void> => {
    if (level > PDF_LIMITS.maxOutlineDepth) {
      fail("PDF 书签层级超过安全上限。");
    }
    for (const node of nodes) {
      visited += 1;
      if (visited > PDF_LIMITS.maxOutlineEntries) {
        fail("PDF 书签数量超过安全上限。");
      }
      const startPage = await resolveDestinationPage(
        document,
        node.dest
      );
      const title = optionalMetadata(node.title);
      if (
        title !== undefined &&
        startPage !== undefined &&
        startPage >= 1 &&
        startPage <= pageCount
      ) {
        flat.push({ title, level, startPage });
      }
      await visit(node.items ?? [], level + 1);
    }
  };
  await visit(outline, 1);
  return flat.map((entry, index) => {
    const next = flat
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.level <= entry.level &&
          candidate.startPage >= entry.startPage
      );
    const endPage = Math.max(
      entry.startPage,
      (next?.startPage ?? pageCount + 1) - 1
    );
    const identity = `${index + 1}\u0000${entry.level}\u0000${entry.startPage}\u0000${entry.title}`;
    return {
      sectionId: `sec_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
      title: entry.title,
      level: entry.level,
      startPage: entry.startPage,
      endPage,
      rangeTruth: "PDF_OUTLINE_PAGE_RANGE_DERIVED"
    };
  });
}

export async function extractPdf(
  bytes: Uint8Array
): Promise<PdfExtraction> {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > PDF_LIMITS.maxBytes ||
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
  ) {
    fail("输入必须是非空且不超过 64 MiB 的 PDF 文件。");
  }
  installTextOnlyPdfGlobals();
  const pdfjs = (await import(PDFJS_MODULE_PATH)) as PdfJsModule;
  const loading = pdfjs.getDocument({
    data: bytes,
    stopAtErrors: true,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    standardFontDataUrl: fileURLToPath(
      new URL("../vendor/pdfjs/standard_fonts/", import.meta.url)
    )
  });
  try {
    const document = await loading.promise;
    if (document.numPages < 1 || document.numPages > PDF_LIMITS.maxPages) {
      fail("PDF 页数超过安全上限或为空。");
    }
    const pages: DocumentReferencePage[] = [];
    let totalTextBytes = 0;
    for (
      let pageNumber = 1;
      pageNumber <= document.numPages;
      pageNumber += 1
    ) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        disableNormalization: false
      });
      const text = normalizedPageText(content.items);
      const textBytes = Buffer.byteLength(text, "utf8");
      if (textBytes > PDF_LIMITS.maxPageTextBytes) {
        fail(`PDF 第 ${pageNumber} 页提取文本超过安全上限。`);
      }
      totalTextBytes += textBytes;
      if (totalTextBytes > PDF_LIMITS.maxTotalTextBytes) {
        fail("PDF 提取文本总量超过安全上限。");
      }
      pages.push({
        pageNumber,
        text,
        textSha256: createHash("sha256").update(text).digest("hex"),
        charCount: text.length,
        extractionTruth: "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH"
      });
      page.cleanup();
    }
    const metadataResult = await document.getMetadata();
    const info = metadataResult.info as Readonly<Record<string, unknown>>;
    const title = optionalMetadata(info.Title);
    const author = optionalMetadata(info.Author);
    const subject = optionalMetadata(info.Subject);
    const metadata: PdfExtraction["metadata"] = {
      ...(title === undefined ? {} : { title }),
      ...(author === undefined ? {} : { author }),
      ...(subject === undefined ? {} : { subject })
    };
    const sections = await extractSections(document, document.numPages);
    return {
      pageCount: pages.length,
      metadata,
      pages,
      sections,
      outline:
        sections.length === 0
          ? "PDF_OUTLINE_UNAVAILABLE"
          : "AVAILABLE_PDF_OUTLINE"
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    fail(
      error instanceof Error && /password/iu.test(error.message)
        ? "加密或受密码保护的 PDF 不受支持。"
        : "PDF 解析失败，未生成 DocumentReference。",
      error
    );
  } finally {
    await loading.destroy().catch(() => undefined);
  }
}
