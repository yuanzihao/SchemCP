import {
  DEFAULT_ARCHIVE_LIMITS,
  type ArchiveLimits
} from "../archive/limits.js";
import { sha256CanonicalJson } from "../core/canonical-json.js";
import type { V3ReductionSummary } from "../v3/reducer.js";
import { loadReducedProject } from "./load-reduced-project.js";

export interface ProjectInspection {
  readonly schemaVersion: "1.1";
  readonly tool: {
    readonly name: "@yuanzihao/schemcp";
    readonly version: "0.2.0";
  };
  readonly gate: "P1_LOG_REDUCED";
  readonly electricalTruth: "NOT_VERIFIED";
  readonly archive: {
    readonly sha256: string;
    readonly inputBytes: number;
    readonly entries: number;
    readonly compressedBytes: number;
    readonly uncompressedBytes: number;
    readonly epruEntries: number;
  };
  readonly v3: {
    readonly lines: number;
    readonly records: number;
    readonly documents: number;
    readonly maxLineBytes: number;
    readonly documentTypes: Readonly<Record<string, number>>;
    readonly recordTypes: Readonly<Record<string, number>>;
    readonly reduction: V3ReductionSummary;
  };
  readonly diagnostics: readonly [];
  readonly summarySha256: string;
}

export async function inspectProject(
  inputPath: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
): Promise<ProjectInspection> {
  const loaded = await loadReducedProject(inputPath, limits);
  const base = {
    schemaVersion: "1.1" as const,
    tool: {
      name: "@yuanzihao/schemcp" as const,
      version: "0.2.0" as const
    },
    gate: "P1_LOG_REDUCED" as const,
    electricalTruth: "NOT_VERIFIED" as const,
    archive: {
      sha256: loaded.archiveSha256,
      inputBytes: loaded.inputBytes,
      entries: loaded.archive.entryCount,
      compressedBytes: loaded.archive.compressedBytes,
      uncompressedBytes: loaded.archive.uncompressedBytes,
      epruEntries: loaded.archive.epruEntries
    },
    v3: {
      lines: loaded.v3.lines,
      records: loaded.v3.records,
      documents: loaded.v3.documentHeaders,
      maxLineBytes: loaded.v3.maxLineBytes,
      documentTypes: loaded.v3.documentTypes,
      recordTypes: loaded.v3.recordTypes,
      reduction: loaded.reducer.summarize()
    },
    diagnostics: [] as const
  };

  return {
    ...base,
    summarySha256: sha256CanonicalJson(base)
  };
}
