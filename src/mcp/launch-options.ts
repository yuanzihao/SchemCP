import { extname, isAbsolute } from "node:path";

export const MCP_LAUNCH_USAGE =
  "用法：schemcp mcp [(--project <绝对路径工程.epro2> | --project-env <环境变量名>)] " +
  "[(--netlist <绝对路径网表.enet> | --netlist-env <环境变量名>)] " +
  "[(--baseline-project <绝对路径基线工程.epro2> | --baseline-project-env <环境变量名>)] " +
  "[(--datasheet-store <绝对路径数据表库> | --datasheet-store-env <环境变量名>)] " +
  "\n" +
  "stdout 仅用于 MCP stdio 协议，诊断写入 stderr。";

export type McpProjectPathSource =
  | { readonly kind: "ARGUMENT" }
  | { readonly kind: "ENVIRONMENT"; readonly variableName: string };

export type McpNetlistPathSource = McpProjectPathSource;
export type McpBaselineProjectPathSource = McpProjectPathSource;
export type McpDatasheetStorePathSource = McpProjectPathSource;

export type McpLaunchResolution =
  | { readonly status: "HELP" }
  | { readonly status: "ERROR"; readonly message: string }
  | {
      readonly status: "READY";
      readonly projectPath?: string;
      readonly projectPathSource?: McpProjectPathSource;
      readonly netlistPath?: string;
      readonly netlistPathSource?: McpNetlistPathSource;
      readonly baselineProjectPath?: string;
      readonly baselineProjectPathSource?: McpBaselineProjectPathSource;
      readonly datasheetStorePath?: string;
      readonly datasheetStorePathSource?: McpDatasheetStorePathSource;
    };

function pathError(
  value: string,
  label: "工程" | "网表" | "基线工程",
  extension: ".epro2" | ".enet"
): string | undefined {
  if (value === "") return `${label}路径不能为空。`;
  if (!isAbsolute(value)) {
    return `MCP ${label}路径必须是绝对路径，避免客户端工作目录差异。`;
  }
  if (extname(value).toLowerCase() !== extension) {
    return `MCP ${label}路径必须指向 ${extension} 文件。`;
  }
  return undefined;
}

function environmentPath(
  variableName: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
  option:
    | "--project-env"
    | "--netlist-env"
    | "--baseline-project-env"
    | "--datasheet-store-env"
):
  | {
      readonly value: string;
      readonly source: McpProjectPathSource;
    }
  | { readonly error: string } {
  if (
    variableName === undefined ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variableName)
  ) {
    return { error: `${option} 必须使用合法的环境变量名。` };
  }
  const value = environment[variableName];
  if (value === undefined || value === "") {
    return { error: `环境变量 ${variableName} 未设置或为空。` };
  }
  return {
    value,
    source: { kind: "ENVIRONMENT", variableName }
  };
}

export function resolveMcpLaunchOptions(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): McpLaunchResolution {
  if (
    args.length === 1 &&
    (args[0] === "--help" || args[0] === "-h")
  ) {
    return { status: "HELP" };
  }
  if (args.length > 8 || args.length % 2 !== 0) {
    return {
      status: "ERROR",
      message:
        "参数必须成对提供，并且可各指定一个工程、网表、基线工程和数据表库来源。"
    };
  }
  let project:
    | { readonly path: string; readonly source: McpProjectPathSource }
    | undefined;
  let netlist:
    | { readonly path: string; readonly source: McpNetlistPathSource }
    | undefined;
  let baselineProject:
    | {
        readonly path: string;
        readonly source: McpBaselineProjectPathSource;
      }
    | undefined;
  let datasheetStore:
    | {
        readonly path: string;
        readonly source: McpDatasheetStorePathSource;
      }
    | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === "--project" || option === "--project-env") {
      if (project !== undefined) {
        return {
          status: "ERROR",
          message: "工程路径来源只能指定一次。"
        };
      }
      if (option === "--project") {
        project = {
          path: value ?? "",
          source: { kind: "ARGUMENT" }
        };
      } else {
        const resolved = environmentPath(value, environment, option);
        if ("error" in resolved) {
          return { status: "ERROR", message: resolved.error };
        }
        project = { path: resolved.value, source: resolved.source };
      }
      continue;
    }
    if (
      option === "--datasheet-store" ||
      option === "--datasheet-store-env"
    ) {
      if (datasheetStore !== undefined) {
        return {
          status: "ERROR",
          message: "数据表库路径来源只能指定一次。"
        };
      }
      if (option === "--datasheet-store") {
        datasheetStore = {
          path: value ?? "",
          source: { kind: "ARGUMENT" }
        };
      } else {
        const resolved = environmentPath(value, environment, option);
        if ("error" in resolved) {
          return { status: "ERROR", message: resolved.error };
        }
        datasheetStore = {
          path: resolved.value,
          source: resolved.source
        };
      }
      continue;
    }
    if (option === "--netlist" || option === "--netlist-env") {
      if (netlist !== undefined) {
        return {
          status: "ERROR",
          message: "网表路径来源只能指定一次。"
        };
      }
      if (option === "--netlist") {
        netlist = {
          path: value ?? "",
          source: { kind: "ARGUMENT" }
        };
      } else {
        const resolved = environmentPath(value, environment, option);
        if ("error" in resolved) {
          return { status: "ERROR", message: resolved.error };
        }
        netlist = { path: resolved.value, source: resolved.source };
      }
      continue;
    }
    if (
      option === "--baseline-project" ||
      option === "--baseline-project-env"
    ) {
      if (baselineProject !== undefined) {
        return {
          status: "ERROR",
          message: "基线工程路径来源只能指定一次。"
        };
      }
      if (option === "--baseline-project") {
        baselineProject = {
          path: value ?? "",
          source: { kind: "ARGUMENT" }
        };
      } else {
        const resolved = environmentPath(value, environment, option);
        if ("error" in resolved) {
          return { status: "ERROR", message: resolved.error };
        }
        baselineProject = {
          path: resolved.value,
          source: resolved.source
        };
      }
      continue;
    }
    return {
      status: "ERROR",
      message: `未知选项：${option ?? ""}`
    };
  }
  if (
    project === undefined &&
    (netlist !== undefined ||
      baselineProject !== undefined ||
      datasheetStore !== undefined)
  ) {
    return {
      status: "ERROR",
      message:
        "网表、基线工程和数据表库的启动绑定必须同时指定启动工程；无工程模式请在会话中调用 open_schematic_project。"
    };
  }
  if (project !== undefined) {
    const projectError = pathError(project.path, "工程", ".epro2");
    if (projectError !== undefined) {
      return { status: "ERROR", message: projectError };
    }
  }
  if (netlist !== undefined) {
    const netlistError = pathError(netlist.path, "网表", ".enet");
    if (netlistError !== undefined) {
      return { status: "ERROR", message: netlistError };
    }
  }
  if (baselineProject !== undefined) {
    const baselineError = pathError(
      baselineProject.path,
      "基线工程",
      ".epro2"
    );
    if (baselineError !== undefined) {
      return { status: "ERROR", message: baselineError };
    }
  }
  if (
    datasheetStore !== undefined &&
    (!isAbsolute(datasheetStore.path) || datasheetStore.path === "")
  ) {
    return {
      status: "ERROR",
      message: "MCP 数据表库路径必须是非空绝对路径。"
    };
  }
  return {
    status: "READY",
    ...(project === undefined
      ? {}
      : {
          projectPath: project.path,
          projectPathSource: project.source
        }),
    ...(netlist === undefined
      ? {}
      : {
          netlistPath: netlist.path,
          netlistPathSource: netlist.source
        }),
    ...(baselineProject === undefined
      ? {}
      : {
          baselineProjectPath: baselineProject.path,
          baselineProjectPathSource: baselineProject.source
        }),
    ...(datasheetStore === undefined
      ? {}
      : {
          datasheetStorePath: datasheetStore.path,
          datasheetStorePathSource: datasheetStore.source
        })
  };
}
