#!/usr/bin/env node

import process from "node:process";
import { AppError, toAppError } from "../core/error.js";
import { verifyP0FormatMatrix } from "./p0-format-matrix.js";

function writeJson(
  stream: NodeJS.WritableStream,
  value: unknown
): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const [matrixPath, goldenDirectory, bindingsPath, ...extra] =
    process.argv.slice(2);
  if (
    matrixPath === undefined ||
    goldenDirectory === undefined ||
    bindingsPath === undefined ||
    extra.length > 0
  ) {
    process.stderr.write(
      "用法：verify-p0-format-matrix <公开矩阵.json> <黄金清单目录> <私有绑定.json>\n"
    );
    process.exitCode = 64;
    return;
  }
  try {
    const result = await verifyP0FormatMatrix(
      matrixPath,
      goldenDirectory,
      bindingsPath
    );
    writeJson(result.ok ? process.stdout : process.stderr, result);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const appError =
      error instanceof AppError ? error : toAppError(error);
    writeJson(process.stderr, {
      ok: false,
      code: appError.code,
      message: appError.message
    });
    process.exitCode = 2;
  }
}

await main();
