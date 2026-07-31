import { randomUUID } from "node:crypto";
import { link, lstat, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EdaIr } from "../ir/model.js";
import { AppError, ERROR_CODES } from "../core/error.js";

export interface IrWriteResult {
  readonly outputBytes: number;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function resolveOutputTarget(outputPath: string): Promise<string> {
  const parent = await realpath(path.dirname(path.resolve(outputPath)));
  return path.join(parent, path.basename(outputPath));
}

function isFileExistsError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

/**
 * 将含私有工程事实的完整 IR 写入显式目标文件。
 * 默认通过同目录临时文件 + hard-link 发布，保证不会覆盖既有文件；
 * `force` 仅在调用者明确请求时使用原子 rename 替换。
 */
export async function writeIrFile(
  inputPath: string,
  outputPath: string,
  ir: EdaIr,
  options: {
    readonly compact: boolean;
    readonly force: boolean;
  }
): Promise<IrWriteResult> {
  let canonicalInput: string;
  let canonicalOutput: string;
  try {
    [canonicalInput, canonicalOutput] = await Promise.all([
      realpath(inputPath),
      resolveOutputTarget(outputPath)
    ]);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.OUTPUT_WRITE_FAILED,
      "无法解析 IR 输出目录或输入工程路径。",
      { cause: error }
    );
  }

  const outputAlreadyExists = await exists(canonicalOutput);
  if (outputAlreadyExists) {
    let existingTarget: string;
    try {
      existingTarget = await realpath(canonicalOutput);
    } catch (error) {
      throw new AppError(ERROR_CODES.OUTPUT_WRITE_FAILED, "无法检查既有 IR 输出目标。", {
        cause: error
      });
    }
    if (existingTarget === canonicalInput) {
      throw new AppError(
        ERROR_CODES.OUTPUT_PATH_CONFLICT,
        "IR 输出路径不能指向输入工程文件。"
      );
    }
    if (!options.force) {
      throw new AppError(
        ERROR_CODES.OUTPUT_EXISTS,
        "IR 输出文件已存在；如需替换，必须显式使用 --force。"
      );
    }
  } else if (canonicalOutput === canonicalInput) {
    throw new AppError(
      ERROR_CODES.OUTPUT_PATH_CONFLICT,
      "IR 输出路径不能指向输入工程文件。"
    );
  }

  const payload = `${JSON.stringify(ir, null, options.compact ? 0 : 2)}\n`;
  const temporaryPath = path.join(
    path.dirname(canonicalOutput),
    `.${path.basename(canonicalOutput)}.${process.pid}.${randomUUID()}.tmp`
  );
  let temporaryCreated = false;
  try {
    await writeFile(temporaryPath, payload, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    temporaryCreated = true;
    if (options.force) {
      await rename(temporaryPath, canonicalOutput);
      temporaryCreated = false;
    } else {
      try {
        await link(temporaryPath, canonicalOutput);
      } catch (error) {
        if (isFileExistsError(error)) {
          throw new AppError(
            ERROR_CODES.OUTPUT_EXISTS,
            "IR 输出文件在发布过程中已存在，未执行覆盖。"
          );
        }
        throw error;
      }
      await unlink(temporaryPath);
      temporaryCreated = false;
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(ERROR_CODES.OUTPUT_WRITE_FAILED, "写入 IR 输出文件失败。", {
      cause: error
    });
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath);
      } catch {
        // 临时文件清理由原始错误负责；这里不能覆盖更有价值的失败原因。
      }
    }
  }
  return {
    outputBytes: Buffer.byteLength(payload)
  };
}
