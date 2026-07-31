import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, nested]) => [key, canonicalize(nested)])
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const offset = lockPath.lastIndexOf(marker);
  if (offset < 0) return undefined;
  return lockPath.slice(offset + marker.length);
}

export async function loadProductionPackages(root) {
  const lockText = await readFile(path.join(root, "package-lock.json"), "utf8");
  const lock = JSON.parse(lockText);
  const packages = [];
  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {})) {
    if (
      lockPath === "" ||
      metadata === null ||
      typeof metadata !== "object" ||
      metadata.dev === true ||
      metadata.link === true
    ) {
      continue;
    }
    const name = packageNameFromLockPath(lockPath);
    if (!name || typeof metadata.version !== "string") continue;
    packages.push({
      name,
      version: metadata.version,
      license:
        typeof metadata.license === "string" ? metadata.license : "NOASSERTION",
      source:
        typeof metadata.resolved === "string"
          ? metadata.resolved
          : "NOASSERTION"
    });
  }
  const unique = new Map(
    packages.map((item) => [`${item.name}\n${item.version}`, item])
  );
  return {
    lockSha256: sha256(lockText),
    packages: [...unique.values()].sort((left, right) =>
      left.name === right.name
        ? left.version.localeCompare(right.version, "en")
        : left.name.localeCompare(right.name, "en")
    )
  };
}

export function createThirdPartyNotices(packages) {
  const lines = [
    "# Third-Party Notices",
    "",
    "SchemCP bundles the following production dependencies for offline installation.",
    "This inventory is generated deterministically from `package-lock.json`; consult each linked package for its complete license text and notices.",
    "",
    "| Package | Version | Declared license | Registry source |",
    "| --- | --- | --- | --- |",
    ...packages.map(
      (item) =>
        `| \`${item.name}\` | \`${item.version}\` | \`${item.license}\` | ${item.source === "NOASSERTION" ? "NOASSERTION" : `[npm tarball](${item.source})`} |`
    ),
    "",
    "SchemCP itself is licensed under Apache-2.0. This file is an inventory, not legal advice and not a replacement for upstream license files.",
    ""
  ];
  return lines.join("\n");
}

function deterministicUuid(hex) {
  const chars = hex.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ["8", "9", "a", "b"][Number.parseInt(chars[16] ?? "0", 16) % 4];
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function reproducibleTimestamp() {
  const raw = process.env.SOURCE_DATE_EPOCH ?? "0";
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new Error("SOURCE_DATE_EPOCH 必须是非负整数秒。");
  }
  return new Date(Number(raw) * 1000).toISOString();
}

export function normalizeCycloneDx(raw, lockSha256) {
  const normalized = structuredClone(raw);
  normalized.serialNumber = `urn:uuid:${deterministicUuid(lockSha256)}`;
  normalized.metadata = {
    ...(normalized.metadata ?? {}),
    timestamp: reproducibleTimestamp(),
    tools: [
      {
        vendor: "SchemCP",
        name: "release-artifact-generator",
        version: "1.0.0"
      }
    ]
  };
  return normalized;
}

export function normalizeSpdx(raw, lockSha256) {
  const normalized = structuredClone(raw);
  normalized.documentNamespace =
    `https://github.com/yuanzihao/SchemCP/sbom/spdx/${lockSha256}`;
  normalized.creationInfo = {
    ...(normalized.creationInfo ?? {}),
    created: reproducibleTimestamp(),
    creators: ["Tool: SchemCP-release-artifact-generator-1.0.0"]
  };
  return normalized;
}
