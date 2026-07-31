#!/usr/bin/env node

import process from "node:process";
import { compileProject } from "../application/compile-project.js";
import { toAppError } from "../core/error.js";
import {
  GOLDEN_ERROR_CODES,
  GoldenVerificationError,
  readGoldenManifest,
  verifyGoldenIr
} from "./golden-manifest.js";

function writeJson(
  stream: NodeJS.WritableStream,
  value: unknown
): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const [manifestPath, projectPath, ...extra] = process.argv.slice(2);
  if (
    manifestPath === undefined ||
    projectPath === undefined ||
    extra.length > 0
  ) {
    process.stderr.write(
      "用法：node dist/src/verification/verify-golden.js <清单.json> <工程.epro2>\n"
    );
    process.exitCode = 64;
    return;
  }

  try {
    const manifest = await readGoldenManifest(manifestPath);
    const ir = await compileProject(projectPath);
    const result = verifyGoldenIr(manifest, ir);
    if (!result.ok) {
      writeJson(process.stderr, {
        ...result,
        code:
          result.sourceSha256 === manifest.sourceSha256
            ? GOLDEN_ERROR_CODES.BASELINE_MISMATCH
            : GOLDEN_ERROR_CODES.SOURCE_MISMATCH
      });
      process.exitCode = 1;
      return;
    }
    writeJson(process.stdout, result);
  } catch (error: unknown) {
    if (error instanceof GoldenVerificationError) {
      writeJson(process.stderr, {
        ok: false,
        code: error.code,
        message: error.message
      });
      process.exitCode = 2;
      return;
    }
    const appError = toAppError(error);
    writeJson(process.stderr, {
      ok: false,
      code: appError.code,
      message: appError.message
    });
    process.exitCode = 2;
  }
}

await main();
