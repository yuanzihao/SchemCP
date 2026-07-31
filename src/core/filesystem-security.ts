import { lstat } from "node:fs/promises";
import path from "node:path";

export type FilesystemPermissionCapability =
  | "POSIX_MODE_ENFORCED"
  | "WINDOWS_ACL_NOT_VERIFIED";

export interface FilesystemSecurityCapabilities {
  readonly platform: NodeJS.Platform;
  readonly canonicalPathValidation: "ENFORCED";
  readonly symbolicLinkTargetRejection: "ENFORCED";
  readonly windowsReparsePointAncestorRejection:
    | "ENFORCED"
    | "NOT_APPLICABLE";
  readonly privatePermissionCapability: FilesystemPermissionCapability;
}

export function filesystemSecurityCapabilities(
  platform: NodeJS.Platform = process.platform
): FilesystemSecurityCapabilities {
  const windows = platform === "win32";
  return {
    platform,
    canonicalPathValidation: "ENFORCED",
    symbolicLinkTargetRejection: "ENFORCED",
    windowsReparsePointAncestorRejection: windows
      ? "ENFORCED"
      : "NOT_APPLICABLE",
    privatePermissionCapability: windows
      ? "WINDOWS_ACL_NOT_VERIFIED"
      : "POSIX_MODE_ENFORCED"
  };
}

export const FILESYSTEM_SECURITY_CAPABILITIES =
  filesystemSecurityCapabilities();

export function enforcesPosixModes(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform !== "win32";
}

export function hasPathTraversalSegments(inputPath: string): boolean {
  return inputPath
    .split(/[\\/]+/u)
    .some((segment) => segment === "." || segment === "..");
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Windows 上逐级拒绝符号链接、junction 等由 lstat 暴露为链接的
 * reparse point。POSIX 继续由各入口的目标 lstat + O_NOFOLLOW 门禁负责，
 * 避免把 macOS 的 /var -> /private/var 系统别名误判为用户输入链接。
 */
export async function assertNoWindowsReparsePointAncestors(
  inputPath: string,
  onRejected: (message: string, cause?: unknown) => never,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform !== "win32") return;
  const absolute = path.resolve(inputPath);
  const parsed = path.parse(absolute);
  const relative = absolute.slice(parsed.root.length);
  let current = parsed.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let state;
    try {
      state = await lstat(current);
    } catch (error) {
      if (isMissing(error)) return;
      onRejected("无法检查 Windows 路径中的 reparse point。", error);
    }
    if (state.isSymbolicLink()) {
      onRejected("Windows 路径不得包含符号链接、junction 或其他链接型 reparse point。");
    }
  }
}
