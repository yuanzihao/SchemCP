import {
  DEFAULT_ARCHIVE_LIMITS,
  type ArchiveLimits
} from "../archive/limits.js";
import type { EdaIr } from "../ir/model.js";
import { compileV3ToEdaIr } from "../v3/compile-ir.js";
import { loadReducedProject } from "./load-reduced-project.js";

export async function compileProject(
  inputPath: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS
): Promise<EdaIr> {
  const loaded = await loadReducedProject(inputPath, limits);
  return compileV3ToEdaIr(loaded.reducer, loaded.archiveSha256);
}
