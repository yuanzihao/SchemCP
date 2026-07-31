import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNoWindowsReparsePointAncestors,
  enforcesPosixModes,
  filesystemSecurityCapabilities,
  hasPathTraversalSegments
} from "../../src/core/filesystem-security.js";

test("平台权限能力不会把 Windows ACL 冒充为 POSIX mode", () => {
  assert.deepEqual(filesystemSecurityCapabilities("linux"), {
    platform: "linux",
    canonicalPathValidation: "ENFORCED",
    symbolicLinkTargetRejection: "ENFORCED",
    windowsReparsePointAncestorRejection: "NOT_APPLICABLE",
    privatePermissionCapability: "POSIX_MODE_ENFORCED"
  });
  assert.deepEqual(filesystemSecurityCapabilities("darwin"), {
    platform: "darwin",
    canonicalPathValidation: "ENFORCED",
    symbolicLinkTargetRejection: "ENFORCED",
    windowsReparsePointAncestorRejection: "NOT_APPLICABLE",
    privatePermissionCapability: "POSIX_MODE_ENFORCED"
  });
  assert.deepEqual(filesystemSecurityCapabilities("win32"), {
    platform: "win32",
    canonicalPathValidation: "ENFORCED",
    symbolicLinkTargetRejection: "ENFORCED",
    windowsReparsePointAncestorRejection: "ENFORCED",
    privatePermissionCapability: "WINDOWS_ACL_NOT_VERIFIED"
  });
  assert.equal(enforcesPosixModes("win32"), false);
  assert.equal(enforcesPosixModes("linux"), true);
});

test("路径语法明确拒绝当前目录和父目录穿越片段", () => {
  assert.equal(hasPathTraversalSegments("/safe/project.epro2"), false);
  assert.equal(hasPathTraversalSegments("/safe/../project.epro2"), true);
  assert.equal(hasPathTraversalSegments("C:\\safe\\.\\project.epro2"), true);
  assert.equal(hasPathTraversalSegments("C:\\safe\\project.epro2"), false);
});

test("Windows reparse point 门禁逐级拒绝链接祖先", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "schemcp-reparse-test-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "target");
  const linked = path.join(root, "linked");
  await mkdir(target);
  await symlink(
    target,
    linked,
    process.platform === "win32" ? "junction" : "dir"
  );

  await assert.rejects(
    assertNoWindowsReparsePointAncestors(
      path.join(linked, "project.epro2"),
      (message) => {
        throw new Error(message);
      },
      "win32"
    ),
    /reparse point/u
  );
  await assert.doesNotReject(
    assertNoWindowsReparsePointAncestors(
      path.join(linked, "project.epro2"),
      (message) => {
        throw new Error(message);
      },
      "linux"
    )
  );
});
