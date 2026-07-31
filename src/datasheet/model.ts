export const DOCUMENT_REFERENCE_KINDS = [
  "DATASHEET",
  "ERRATA",
  "REFERENCE_MANUAL",
  "APPLICATION_NOTE",
  "USER_MANUAL",
  "OTHER_TECHNICAL"
] as const;

export type DocumentReferenceKind =
  (typeof DOCUMENT_REFERENCE_KINDS)[number];

export type DocumentReferenceBinding =
  | {
      readonly method: "PART_MASTER_ID";
      readonly partMasterId: string;
    }
  | {
      readonly method: "EXACT_LCSC_PART_ID";
      readonly lcscPartId: string;
    }
  | {
      readonly method: "EXACT_MANUFACTURER_AND_MPN";
      readonly manufacturer: string;
      readonly manufacturerPart: string;
    };

export interface DocumentReferencePage {
  readonly pageNumber: number;
  readonly text: string;
  readonly textSha256: string;
  readonly charCount: number;
  readonly extractionTruth: "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH";
}

export interface DocumentReferenceSection {
  readonly sectionId: string;
  readonly title: string;
  readonly level: number;
  readonly startPage: number;
  readonly endPage: number;
  readonly rangeTruth: "PDF_OUTLINE_PAGE_RANGE_DERIVED";
}

export interface DocumentReferenceFileReceipt {
  readonly path: "document.pdf" | "pages.jsonl" | "sections.jsonl";
  readonly mediaType:
    | "application/pdf"
    | "application/x-ndjson";
  readonly bytes: number;
  readonly records: number;
  readonly sha256: string;
}

export interface DocumentReferenceManifest {
  readonly schemaVersion: "0.1.0";
  readonly documentReferenceId: string;
  readonly generator: {
    readonly name: "@yuanzihao/schemcp";
    readonly version: string;
  };
  readonly document: {
    readonly kind: DocumentReferenceKind;
    readonly binding: DocumentReferenceBinding;
    readonly title?: string;
    readonly documentNumber?: string;
    readonly revision?: string;
    readonly publishedDate?: string;
    readonly sourceUrl?: string;
    readonly assertedMetadataTruth: "USER_ASSERTED_NOT_VERIFIED";
  };
  readonly pdf: {
    readonly sha256: string;
    readonly bytes: number;
    readonly pages: number;
    readonly title?: string;
    readonly author?: string;
    readonly subject?: string;
    readonly metadataTruth: "PDF_METADATA_NOT_SOURCE_AUTHENTICITY";
    readonly sourceAuthenticity: "USER_ASSERTED_NOT_VERIFIED";
  };
  readonly index: {
    readonly pages: number;
    readonly sections: number;
    readonly outline:
      | "AVAILABLE_PDF_OUTLINE"
      | "PDF_OUTLINE_UNAVAILABLE";
    readonly textExtractionTruth:
      "PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH";
  };
  readonly files: readonly DocumentReferenceFileReceipt[];
  readonly payloadBytes: number;
  readonly packageSha256: string;
}

export interface DocumentReferenceImportInput {
  readonly pdfPath: string;
  readonly storePath: string;
  readonly kind: DocumentReferenceKind;
  readonly binding: DocumentReferenceBinding;
  readonly title?: string;
  readonly documentNumber?: string;
  readonly revision?: string;
  readonly publishedDate?: string;
  readonly sourceUrl?: string;
}
