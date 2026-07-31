import assert from "node:assert/strict";
import test from "node:test";
import { resolveMcpLaunchOptions } from "../../src/mcp/launch-options.js";

test("MCP 可以无工程启动并等待会话附件", () => {
  assert.deepEqual(resolveMcpLaunchOptions([], {}), {
    status: "READY"
  });
  assert.equal(
    resolveMcpLaunchOptions(
      ["--netlist", "/private/projects/board.enet"],
      {}
    ).status,
    "ERROR"
  );
});

test("MCP 启动参数只接受唯一绝对 .epro2 路径", () => {
  assert.deepEqual(
    resolveMcpLaunchOptions(
      ["--project", "/private/projects/board.epro2"],
      {}
    ),
    {
      status: "READY",
      projectPath: "/private/projects/board.epro2",
      projectPathSource: { kind: "ARGUMENT" }
    }
  );
  assert.deepEqual(resolveMcpLaunchOptions(["--help"], {}), {
    status: "HELP"
  });
  assert.equal(
    resolveMcpLaunchOptions(["--project", "board.epro2"], {}).status,
    "ERROR"
  );
  assert.equal(
    resolveMcpLaunchOptions(
      ["--project", "/private/projects/board.enet"],
      {}
    ).status,
    "ERROR"
  );
  assert.equal(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/a.epro2",
        "--project",
        "/private/projects/b.epro2"
      ],
      {}
    ).status,
    "ERROR"
  );
  assert.equal(
    resolveMcpLaunchOptions(["--profile", "schematic"], {}).status,
    "ERROR"
  );
});

test("MCP 工程路径可由命名环境变量提供且缺失时稳定失败", () => {
  assert.deepEqual(
    resolveMcpLaunchOptions(["--project-env", "EDA_PROJECT_PATH"], {
      EDA_PROJECT_PATH: "/private/projects/board.epro2"
    }),
    {
      status: "READY",
      projectPath: "/private/projects/board.epro2",
      projectPathSource: {
        kind: "ENVIRONMENT",
        variableName: "EDA_PROJECT_PATH"
      }
    }
  );
  const missing = resolveMcpLaunchOptions(
    ["--project-env", "EDA_PROJECT_PATH"],
    {}
  );
  assert.equal(missing.status, "ERROR");
  if (missing.status === "ERROR") {
    assert.match(missing.message, /EDA_PROJECT_PATH/u);
    assert.doesNotMatch(missing.message, /private\/projects/u);
  }
  assert.equal(
    resolveMcpLaunchOptions(["--project-env", "INVALID-NAME"], {}).status,
    "ERROR"
  );
});

test("MCP 可选绑定唯一绝对 .enet，并支持命名环境变量", () => {
  assert.deepEqual(
    resolveMcpLaunchOptions(
      [
        "--netlist",
        "/private/projects/board.enet",
        "--project",
        "/private/projects/board.epro2"
      ],
      {}
    ),
    {
      status: "READY",
      projectPath: "/private/projects/board.epro2",
      projectPathSource: { kind: "ARGUMENT" },
      netlistPath: "/private/projects/board.enet",
      netlistPathSource: { kind: "ARGUMENT" }
    }
  );
  assert.deepEqual(
    resolveMcpLaunchOptions(
      [
        "--project-env",
        "EDA_PROJECT_PATH",
        "--netlist-env",
        "EDA_NETLIST_PATH"
      ],
      {
        EDA_PROJECT_PATH: "/private/projects/board.epro2",
        EDA_NETLIST_PATH: "/private/projects/board.enet"
      }
    ),
    {
      status: "READY",
      projectPath: "/private/projects/board.epro2",
      projectPathSource: {
        kind: "ENVIRONMENT",
        variableName: "EDA_PROJECT_PATH"
      },
      netlistPath: "/private/projects/board.enet",
      netlistPathSource: {
        kind: "ENVIRONMENT",
        variableName: "EDA_NETLIST_PATH"
      }
    }
  );
  assert.equal(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/board.epro2",
        "--netlist",
        "board.enet"
      ],
      {}
    ).status,
    "ERROR"
  );
  assert.equal(
    resolveMcpLaunchOptions(
      ["--netlist", "/private/projects/board.enet"],
      {}
    ).status,
    "ERROR"
  );
  assert.equal(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/board.epro2",
        "--netlist",
        "/private/projects/a.enet",
        "--netlist",
        "/private/projects/b.enet"
      ],
      {}
    ).status,
    "ERROR"
  );
});

test("MCP 可选绑定唯一基线工程，并支持命名环境变量", () => {
  assert.deepEqual(
    resolveMcpLaunchOptions(
      [
        "--baseline-project",
        "/private/projects/baseline.epro2",
        "--project",
        "/private/projects/current.epro2"
      ],
      {}
    ),
    {
      status: "READY",
      projectPath: "/private/projects/current.epro2",
      projectPathSource: { kind: "ARGUMENT" },
      baselineProjectPath: "/private/projects/baseline.epro2",
      baselineProjectPathSource: { kind: "ARGUMENT" }
    }
  );
  assert.deepEqual(
    resolveMcpLaunchOptions(
      [
        "--project-env",
        "EDA_PROJECT_PATH",
        "--baseline-project-env",
        "EDA_BASELINE_PROJECT_PATH"
      ],
      {
        EDA_PROJECT_PATH: "/private/projects/current.epro2",
        EDA_BASELINE_PROJECT_PATH: "/private/projects/baseline.epro2"
      }
    ),
    {
      status: "READY",
      projectPath: "/private/projects/current.epro2",
      projectPathSource: {
        kind: "ENVIRONMENT",
        variableName: "EDA_PROJECT_PATH"
      },
      baselineProjectPath: "/private/projects/baseline.epro2",
      baselineProjectPathSource: {
        kind: "ENVIRONMENT",
        variableName: "EDA_BASELINE_PROJECT_PATH"
      }
    }
  );
  assert.equal(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/current.epro2",
        "--baseline-project",
        "baseline.epro2"
      ],
      {}
    ).status,
    "ERROR"
  );
  assert.equal(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/current.epro2",
        "--baseline-project",
        "/private/projects/a.epro2",
        "--baseline-project-env",
        "EDA_BASELINE_PROJECT_PATH"
      ],
      {
        EDA_BASELINE_PROJECT_PATH: "/private/projects/b.epro2"
      }
    ).status,
    "ERROR"
  );
});

test("MCP 可选绑定唯一绝对数据表库，并支持命名环境变量", () => {
  assert.deepEqual(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/current.epro2",
        "--datasheet-store",
        "/private/projects/datasheets"
      ],
      {}
    ),
    {
      status: "READY",
      projectPath: "/private/projects/current.epro2",
      projectPathSource: { kind: "ARGUMENT" },
      datasheetStorePath: "/private/projects/datasheets",
      datasheetStorePathSource: { kind: "ARGUMENT" }
    }
  );
  assert.equal(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/current.epro2",
        "--datasheet-store",
        "datasheets"
      ],
      {}
    ).status,
    "ERROR"
  );
  assert.deepEqual(
    resolveMcpLaunchOptions(
      [
        "--project",
        "/private/projects/current.epro2",
        "--datasheet-store-env",
        "EDA_DATASHEET_STORE"
      ],
      { EDA_DATASHEET_STORE: "/private/projects/datasheets" }
    ),
    {
      status: "READY",
      projectPath: "/private/projects/current.epro2",
      projectPathSource: { kind: "ARGUMENT" },
      datasheetStorePath: "/private/projects/datasheets",
      datasheetStorePathSource: {
        kind: "ENVIRONMENT",
        variableName: "EDA_DATASHEET_STORE"
      }
    }
  );
});
