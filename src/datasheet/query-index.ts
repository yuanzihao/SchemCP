import { createHash } from "node:crypto";
import type {
  DocumentReferenceKind,
  DocumentReferenceManifest,
  DocumentReferencePage,
  DocumentReferenceSection
} from "./model.js";
import {
  readDatasheetStore,
  verifyDocumentReferenceBundle
} from "./store.js";
import {
  QUERY_LIMITS,
  QueryError,
  type Page
} from "../query/index.js";

interface StoredReference {
  readonly bundlePath: string;
  readonly manifest: DocumentReferenceManifest;
}

export interface DatasheetReferenceSummary {
  readonly documentReferenceId: string;
  readonly kind: DocumentReferenceKind;
  readonly binding: DocumentReferenceManifest["document"]["binding"];
  readonly title?: string;
  readonly documentNumber?: string;
  readonly revision?: string;
  readonly publishedDate?: string;
  readonly sourceUrl?: string;
  readonly pdf: DocumentReferenceManifest["pdf"];
  readonly index: DocumentReferenceManifest["index"];
  readonly packageSha256: string;
}

export interface DatasheetListInput {
  readonly kind?: DocumentReferenceKind | undefined;
  readonly partMasterId?: string | undefined;
  readonly lcscPartId?: string | undefined;
  readonly manufacturer?: string | undefined;
  readonly manufacturerPart?: string | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export interface DatasheetSectionInput {
  readonly documentReferenceId: string;
  readonly sectionId?: string | undefined;
  readonly topic?: string | undefined;
  readonly maxPages?: number | undefined;
  readonly maxChars?: number | undefined;
}

function summary(
  manifest: DocumentReferenceManifest
): DatasheetReferenceSummary {
  return {
    documentReferenceId: manifest.documentReferenceId,
    kind: manifest.document.kind,
    binding: manifest.document.binding,
    ...(manifest.document.title === undefined
      ? {}
      : { title: manifest.document.title }),
    ...(manifest.document.documentNumber === undefined
      ? {}
      : { documentNumber: manifest.document.documentNumber }),
    ...(manifest.document.revision === undefined
      ? {}
      : { revision: manifest.document.revision }),
    ...(manifest.document.publishedDate === undefined
      ? {}
      : { publishedDate: manifest.document.publishedDate }),
    ...(manifest.document.sourceUrl === undefined
      ? {}
      : { sourceUrl: manifest.document.sourceUrl }),
    pdf: manifest.pdf,
    index: manifest.index,
    packageSha256: manifest.packageSha256
  };
}

function boundedText(value: string | undefined, field: string): void {
  if (
    value !== undefined &&
    (value.length < 1 || value.length > QUERY_LIMITS.maxTextLength)
  ) {
    throw new QueryError(
      "QUERY_INVALID_TEXT",
      `${field} 长度必须是 1～${QUERY_LIMITS.maxTextLength}。`
    );
  }
}

function cursorScope(input: DatasheetListInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: input.kind ?? null,
        partMasterId: input.partMasterId ?? null,
        lcscPartId: input.lcscPartId ?? null,
        manufacturer: input.manufacturer ?? null,
        manufacturerPart: input.manufacturerPart ?? null
      })
    )
    .digest("hex")
    .slice(0, 24);
}

function decodeCursor(cursor: string | undefined, scope: string): number {
  if (cursor === undefined) return 0;
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { readonly version?: unknown; readonly scope?: unknown; readonly offset?: unknown };
    if (
      value.version !== 1 ||
      value.scope !== scope ||
      !Number.isSafeInteger(value.offset) ||
      (value.offset as number) < 0
    ) {
      throw new Error("invalid");
    }
    return value.offset as number;
  } catch {
    throw new QueryError(
      "QUERY_INVALID_CURSOR",
      "cursor 无效、已损坏或与当前筛选条件不匹配。"
    );
  }
}

function encodeCursor(scope: string, offset: number): string {
  return Buffer.from(
    JSON.stringify({ version: 1, scope, offset }),
    "utf8"
  ).toString("base64url");
}

function requestedLimit(limit: number | undefined): number {
  const value = limit ?? QUERY_LIMITS.defaultPageSize;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > QUERY_LIMITS.maxPageSize
  ) {
    throw new QueryError(
      "QUERY_INVALID_LIMIT",
      `limit 必须是 1～${QUERY_LIMITS.maxPageSize} 的整数。`
    );
  }
  return value;
}

function matches(
  manifest: DocumentReferenceManifest,
  input: DatasheetListInput
): boolean {
  if (input.kind !== undefined && manifest.document.kind !== input.kind) {
    return false;
  }
  const binding = manifest.document.binding;
  if (
    input.partMasterId !== undefined &&
    (binding.method !== "PART_MASTER_ID" ||
      binding.partMasterId !== input.partMasterId)
  ) {
    return false;
  }
  if (
    input.lcscPartId !== undefined &&
    (binding.method !== "EXACT_LCSC_PART_ID" ||
      binding.lcscPartId !== input.lcscPartId)
  ) {
    return false;
  }
  if (
    (input.manufacturer !== undefined ||
      input.manufacturerPart !== undefined) &&
    (binding.method !== "EXACT_MANUFACTURER_AND_MPN" ||
      (input.manufacturer !== undefined &&
        binding.manufacturer !== input.manufacturer) ||
      (input.manufacturerPart !== undefined &&
        binding.manufacturerPart !== input.manufacturerPart))
  ) {
    return false;
  }
  return true;
}

function pageExcerpt(
  page: DocumentReferencePage,
  maxChars: number
): {
  readonly pageNumber: number;
  readonly text: string;
  readonly textSha256: string;
  readonly truncated: boolean;
  readonly extractionTruth: "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH";
} {
  return {
    pageNumber: page.pageNumber,
    text: page.text.slice(0, maxChars),
    textSha256: page.textSha256,
    truncated: page.text.length > maxChars,
    extractionTruth: page.extractionTruth
  };
}

export class DatasheetStoreQueryIndex {
  private constructor(
    private readonly references: readonly StoredReference[]
  ) {}

  public static async load(storePath: string): Promise<DatasheetStoreQueryIndex> {
    return new DatasheetStoreQueryIndex(
      await readDatasheetStore(storePath)
    );
  }

  public getSummary(): Readonly<Record<string, unknown>> {
    return {
      binding: "LOCAL_VERIFIED_DATASHEET_STORE",
      documents: this.references.length,
      pages: this.references.reduce(
        (total, item) => total + item.manifest.index.pages,
        0
      ),
      sections: this.references.reduce(
        (total, item) => total + item.manifest.index.sections,
        0
      ),
      sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED",
      electricalTruth: "NOT_APPLICABLE_DEVICE_DOCUMENT_FACTS"
    };
  }

  public listReferences(
    input: DatasheetListInput
  ): Page<DatasheetReferenceSummary> {
    for (const [field, value] of [
      ["partMasterId", input.partMasterId],
      ["lcscPartId", input.lcscPartId],
      ["manufacturer", input.manufacturer],
      ["manufacturerPart", input.manufacturerPart]
    ] as const) {
      boundedText(value, field);
    }
    const filtered = this.references
      .filter((item) => matches(item.manifest, input))
      .map((item) => summary(item.manifest));
    const limit = requestedLimit(input.limit);
    const scope = cursorScope(input);
    const offset = decodeCursor(input.cursor, scope);
    if (offset > filtered.length) {
      throw new QueryError(
        "QUERY_INVALID_CURSOR",
        "cursor 偏移超出当前结果集。"
      );
    }
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      total: filtered.length,
      ...(nextOffset < filtered.length
        ? { nextCursor: encodeCursor(scope, nextOffset) }
        : {})
    };
  }

  public async getSection(
    input: DatasheetSectionInput
  ): Promise<Readonly<Record<string, unknown>>> {
    boundedText(input.documentReferenceId, "documentReferenceId");
    boundedText(input.sectionId, "sectionId");
    boundedText(input.topic, "topic");
    if (
      (input.sectionId === undefined) === (input.topic === undefined)
    ) {
      throw new QueryError(
        "QUERY_INVALID_TEXT",
        "sectionId 与 topic 必须且只能指定一个。"
      );
    }
    const maxPages = input.maxPages ?? 3;
    const maxChars = input.maxChars ?? 12_000;
    if (
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 10 ||
      !Number.isSafeInteger(maxChars) ||
      maxChars < 256 ||
      maxChars > 64_000
    ) {
      throw new QueryError(
        "QUERY_INVALID_LIMIT",
        "maxPages 必须是 1～10，maxChars 必须是 256～64000。"
      );
    }
    const reference = this.references.find(
      (item) =>
        item.manifest.documentReferenceId === input.documentReferenceId
    );
    if (reference === undefined) {
      return {
        status: "NOT_FOUND",
        documentReferenceId: input.documentReferenceId
      };
    }
    const verified = await verifyDocumentReferenceBundle(
      reference.bundlePath
    );
    let selectedPages: readonly DocumentReferencePage[];
    let selectedSection: DocumentReferenceSection | undefined;
    if (input.sectionId !== undefined) {
      selectedSection = verified.sections.find(
        (section) => section.sectionId === input.sectionId
      );
      if (selectedSection === undefined) {
        return {
          status: "NOT_FOUND",
          documentReferenceId: input.documentReferenceId,
          sectionId: input.sectionId
        };
      }
      selectedPages = verified.pages
        .filter(
          (page) =>
            page.pageNumber >= selectedSection!.startPage &&
            page.pageNumber <= selectedSection!.endPage
        )
        .slice(0, maxPages);
    } else {
      const topic = input.topic!.toLocaleLowerCase("en-US");
      selectedPages = verified.pages
        .filter((page) =>
          page.text.toLocaleLowerCase("en-US").includes(topic)
        )
        .slice(0, maxPages);
    }
    let remaining = maxChars;
    const pages: ReturnType<typeof pageExcerpt>[] = [];
    for (const page of selectedPages) {
      if (remaining <= 0) break;
      const excerpt = pageExcerpt(page, remaining);
      pages.push(excerpt);
      remaining -= excerpt.text.length;
    }
    return {
      status: pages.length === 0 ? "NO_TEXT_MATCH" : "FOUND",
      document: summary(reference.manifest),
      ...(selectedSection === undefined
        ? { topic: input.topic }
        : { section: selectedSection }),
      pages,
      returnedChars: maxChars - remaining,
      sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED",
      textExtractionTruth: "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH",
      electricalTruth: "NOT_APPLICABLE_DEVICE_DOCUMENT_FACTS"
    };
  }
}
