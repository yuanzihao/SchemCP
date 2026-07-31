import { isAbsolute } from "node:path";
import { z } from "zod";
import { sha256CanonicalJson } from "../core/canonical-json.js";
import { AppError, ERROR_CODES } from "../core/error.js";
import { hasPathTraversalSegments } from "../core/filesystem-security.js";
import { readStrictJsonFile } from "../core/strict-json-file.js";
import { MCP_SERVER_VERSION } from "./contract.js";

export const SCHEMATIC_ASSEMBLY_MANIFEST_SCHEMA =
  "schemcp.schematic-assembly-manifest" as const;
export const SCHEMATIC_ASSEMBLY_MANIFEST_VERSION = "1.0.0" as const;
export const SCHEMATIC_ASSEMBLY_MANIFEST_SUFFIX =
  ".schemcp-assembly.json" as const;
export const SCHEMATIC_ASSEMBLY_MANIFEST_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 16
} as const;

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/u);
const IDENTIFIER = z.string().min(1).max(1024);
const PIN_NUMBER = z.string().min(1).max(1024);

const manifestProjectSchema = z
  .object({
    projectId: z.string().regex(/^project_[0-9a-f]{64}$/u),
    irSha256: SHA256
  })
  .strict();

const manifestEndpointSchema = z
  .object({
    projectId: z.string().regex(/^project_[0-9a-f]{64}$/u),
    componentId: IDENTIFIER,
    pageId: IDENTIFIER,
    designator: z.string().min(1).max(1024).optional()
  })
  .strict();

const manifestPinPairSchema = z
  .object({
    leftPinNumber: PIN_NUMBER,
    rightPinNumber: PIN_NUMBER
  })
  .strict();

const manifestInterconnectSchema = z
  .object({
    interconnectId: z.string().regex(/^interconnect_[0-9a-f]{64}$/u),
    candidateId: z
      .string()
      .regex(/^interconnect_candidate_[0-9a-f]{64}$/u),
    left: manifestEndpointSchema,
    right: manifestEndpointSchema,
    pinPairs: z.array(manifestPinPairSchema).min(1).max(1024),
    mappingMethod: z.enum([
      "USER_CONFIRMED_SAME_PIN_NUMBER",
      "USER_CONFIRMED_EXPLICIT_PIN_PAIRS"
    ]),
    relationshipTruth: z.literal("USER_CONFIRMED_SESSION_RELATIONSHIP")
  })
  .strict();

const manifestBaseSchema = z
  .object({
    schema: z.literal(SCHEMATIC_ASSEMBLY_MANIFEST_SCHEMA),
    schemaVersion: z.literal(SCHEMATIC_ASSEMBLY_MANIFEST_VERSION),
    generator: z
      .object({
        name: z.literal("@yuanzihao/schemcp"),
        version: z.literal(MCP_SERVER_VERSION)
      })
      .strict(),
    projects: z.array(manifestProjectSchema).min(2).max(4),
    assembly: z
      .object({
        projectIds: z
          .array(z.string().regex(/^project_[0-9a-f]{64}$/u))
          .min(2)
          .max(4),
        interconnects: z.array(manifestInterconnectSchema).max(32),
        relationshipTruth: z.literal(
          "USER_ASSERTED_PROJECT_RELATIONSHIP"
        )
      })
      .strict()
  })
  .strict();

const manifestSchema = manifestBaseSchema
  .extend({
    manifestSha256: SHA256
  })
  .strict();

export type SchematicAssemblyManifestBase = z.infer<
  typeof manifestBaseSchema
>;
export type SchematicAssemblyManifest = z.infer<typeof manifestSchema>;
export type SchematicAssemblyManifestProject = z.infer<
  typeof manifestProjectSchema
>;
export type SchematicAssemblyManifestInterconnect = z.infer<
  typeof manifestInterconnectSchema
>;

function invalid(message: string, cause?: unknown): never {
  throw new AppError(
    ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
    `原理图装配清单${message}`,
    cause === undefined ? {} : { cause }
  );
}

function assertUnique(items: readonly string[], label: string): void {
  if (new Set(items).size !== items.length) {
    invalid(`${label}包含重复项。`);
  }
}

export function projectIdForIr(irSha256: string): string {
  return `project_${irSha256}`;
}

export function createSchematicAssemblyManifest(
  base: SchematicAssemblyManifestBase
): SchematicAssemblyManifest {
  const parsed = validateBase(base);
  return {
    ...parsed,
    manifestSha256: sha256CanonicalJson(parsed)
  };
}

function validateBase(value: unknown): SchematicAssemblyManifestBase {
  const result = manifestBaseSchema.safeParse(value);
  if (!result.success) {
    invalid("结构或字段不符合 schemcp.schematic-assembly-manifest 1.0.0。", result.error);
  }
  const base = result.data;
  const sortedProjects = [...base.projects].sort((left, right) =>
    left.projectId < right.projectId
      ? -1
      : left.projectId > right.projectId
        ? 1
        : 0
  );
  if (
    base.projects.some(
      (project, index) => project.projectId !== sortedProjects[index]?.projectId
    )
  ) {
    invalid("projects 必须按 projectId 稳定排序。");
  }
  assertUnique(
    base.projects.map((project) => project.projectId),
    " projects "
  );
  for (const project of base.projects) {
    if (project.projectId !== projectIdForIr(project.irSha256)) {
      invalid(" projectId 与 irSha256 不一致。");
    }
  }
  assertUnique(base.assembly.projectIds, " assembly.projectIds ");
  const projectIds = base.projects.map((project) => project.projectId);
  if (
    base.assembly.projectIds.length !== projectIds.length ||
    base.assembly.projectIds.some(
      (projectId, index) => projectId !== projectIds[index]
    )
  ) {
    invalid(" assembly.projectIds 必须与 projects 精确一致并稳定排序。");
  }
  const allowedProjects = new Set(projectIds);
  assertUnique(
    base.assembly.interconnects.map((item) => item.interconnectId),
    " interconnects "
  );
  for (const interconnect of base.assembly.interconnects) {
    if (
      !allowedProjects.has(interconnect.left.projectId) ||
      !allowedProjects.has(interconnect.right.projectId) ||
      interconnect.left.projectId === interconnect.right.projectId
    ) {
      invalid("互连端点必须引用两个不同的清单成员工程。");
    }
    assertUnique(
      interconnect.pinPairs.map((pair) => pair.leftPinNumber),
      "互连左侧针脚映射 "
    );
    assertUnique(
      interconnect.pinPairs.map((pair) => pair.rightPinNumber),
      "互连右侧针脚映射 "
    );
  }
  return base;
}

export function verifySchematicAssemblyManifest(
  value: unknown
): SchematicAssemblyManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    invalid("结构或字段不符合 schemcp.schematic-assembly-manifest 1.0.0。", result.error);
  }
  const manifest = result.data;
  const { manifestSha256, ...base } = manifest;
  const validatedBase = validateBase(base);
  if (sha256CanonicalJson(validatedBase) !== manifestSha256) {
    invalid("规范 SHA-256 不匹配。");
  }
  return manifest;
}

export async function readSchematicAssemblyManifest(
  inputPath: string,
  options: { readonly requireAbsolute?: boolean } = {}
): Promise<{
  readonly manifest: SchematicAssemblyManifest;
  readonly bytes: number;
}> {
  if (
    inputPath === "" ||
    (options.requireAbsolute === true && !isAbsolute(inputPath)) ||
    hasPathTraversalSegments(inputPath) ||
    !inputPath.toLowerCase().endsWith(SCHEMATIC_ASSEMBLY_MANIFEST_SUFFIX)
  ) {
    invalid(
      `路径必须是${options.requireAbsolute === true ? "客户端提供的非空绝对" : "非空"} ${SCHEMATIC_ASSEMBLY_MANIFEST_SUFFIX} 文件路径。`
    );
  }
  const result = await readStrictJsonFile(inputPath, {
    errorCode: ERROR_CODES.MCP_ASSEMBLY_MANIFEST_INVALID,
    label: "原理图装配清单",
    maxBytes: SCHEMATIC_ASSEMBLY_MANIFEST_LIMITS.maxBytes,
    maxDepth: SCHEMATIC_ASSEMBLY_MANIFEST_LIMITS.maxDepth
  });
  return {
    manifest: verifySchematicAssemblyManifest(result.value),
    bytes: result.bytes
  };
}
