export interface ArchiveLimits {
  readonly maxInputBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxPathDepth: number;
  readonly maxLineBytes: number;
  readonly maxJsonDepth: number;
  readonly maxRecords: number;
  readonly maxDocuments: number;
  readonly maxReducedRecords: number;
  readonly maxReducedSourceBytes: number;
}

const MIB = 1024 * 1024;

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = Object.freeze({
  maxInputBytes: 256 * MIB,
  maxEntries: 10_000,
  maxEntryBytes: 128 * MIB,
  maxTotalUncompressedBytes: 512 * MIB,
  maxCompressionRatio: 200,
  maxPathDepth: 16,
  maxLineBytes: 8 * MIB,
  maxJsonDepth: 256,
  maxRecords: 5_000_000,
  maxDocuments: 100_000,
  maxReducedRecords: 500_000,
  maxReducedSourceBytes: 128 * MIB
});
