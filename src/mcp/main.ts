#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";
import { compileProject } from "../application/compile-project.js";
import { toAppError } from "../core/error.js";
import { DatasheetStoreQueryIndex } from "../datasheet/query-index.js";
import { EdaIrQueryIndex } from "../query/index.js";
import { NetlistComparisonQueryIndex } from "../query/netlist-comparison-index.js";
import {
  ProjectVersionDiffBaseline,
  ProjectVersionDiffIndex
} from "../query/project-version-diff.js";
import { buildNetlistComparisonReport } from "../truth/compare-netlist-evidence.js";
import { readPrivateNetlist } from "../truth/import-netlist-evidence.js";
import { parseJlcEdaProEnet } from "../truth/jlceda-pro-enet.js";
import {
  MCP_LAUNCH_USAGE,
  resolveMcpLaunchOptions,
  type McpLaunchResolution
} from "./launch-options.js";
import { createEdaMcpServer } from "./server.js";

function parseLaunchOptions():
  | Extract<McpLaunchResolution, { readonly status: "READY" }>
  | undefined {
  const resolution = resolveMcpLaunchOptions(
    process.argv.slice(2),
    process.env
  );
  if (resolution.status === "HELP") {
    process.stderr.write(`${MCP_LAUNCH_USAGE}\n`);
    return undefined;
  }
  if (resolution.status === "ERROR") {
    process.stderr.write(
      `${resolution.message}\n${MCP_LAUNCH_USAGE}\n`
    );
    process.exitCode = 64;
    return undefined;
  }
  return resolution;
}

async function compileProjectVersionDiffBaseline(
  projectPath: string
): Promise<ProjectVersionDiffBaseline> {
  const ir = await compileProject(projectPath);
  return new ProjectVersionDiffBaseline(ir);
}

async function main(): Promise<void> {
  const launch = parseLaunchOptions();
  if (launch === undefined) {
    return;
  }
  const baseline =
    launch.baselineProjectPath === undefined
      ? undefined
      : await compileProjectVersionDiffBaseline(launch.baselineProjectPath);
  const [ir, netlist] = await Promise.all([
    launch.projectPath === undefined
      ? Promise.resolve(undefined)
      : compileProject(launch.projectPath),
    launch.netlistPath === undefined
      ? Promise.resolve(undefined)
      : readPrivateNetlist(launch.netlistPath)
  ]);
  const datasheets =
    launch.datasheetStorePath === undefined
      ? undefined
      : await DatasheetStoreQueryIndex.load(launch.datasheetStorePath);
  const parsedNetlist =
    netlist === undefined ? undefined : parseJlcEdaProEnet(netlist.bytes);
  const comparison =
    parsedNetlist === undefined || netlist === undefined || ir === undefined
      ? undefined
      : new NetlistComparisonQueryIndex(
          buildNetlistComparisonReport(ir, netlist.bytes, parsedNetlist),
          parsedNetlist
        );
  const projectVersionDiff =
    baseline === undefined || ir === undefined
      ? undefined
      : new ProjectVersionDiffIndex(baseline, ir);
  const server = createEdaMcpServer(
    ir === undefined ? undefined : new EdaIrQueryIndex(ir),
    comparison,
    projectVersionDiff,
    datasheets
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `${JSON.stringify({
      level: "info",
      event: "MCP_SERVER_READY",
      transport: "stdio",
      binding: ir === undefined ? "NOT_BOUND" : "STARTUP_PROJECT_BOUND",
      electricalTruth: ir?.source.electricalTruth ?? "NOT_VERIFIED",
      ...(ir === undefined ? {} : { irSha256: ir.irSha256 }),
      netlistComparison:
        comparison?.report.comparison.status ?? "NOT_BOUND",
      projectVersionDiff:
        projectVersionDiff?.summary.status ?? "NOT_BOUND",
      datasheetStore:
        datasheets?.getSummary() ?? { binding: "NOT_BOUND" }
    })}\n`
  );
}

try {
  await main();
} catch (error) {
  const appError = toAppError(error);
  process.stderr.write(
    `${JSON.stringify({
      level: "error",
      event: "MCP_SERVER_START_FAILED",
      code: appError.code,
      message: appError.message
    })}\n`
  );
  process.exitCode = appError.code === "INTERNAL_ERROR" ? 70 : 2;
}
