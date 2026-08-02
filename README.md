# SchemCP

> 面向 AI 编程工具的本地优先原理图上下文服务。

[English](README.en.md)

SchemCP 是一个本地优先、只读、确定性、可审计的嘉立创 EDA 专业版原理图 MCP 服务。它直接解析用户提供的 `.epro2` 工程，不要求启动浏览器、EasyEDA Bridge、嘉立创插件 API 或 PCB 编辑器。

> **格式定位**：SchemCP 目前只维护嘉立创 EDA 专业版 `.epro2` 原理图工程解析，其他 EDA 软件的原理图格式暂无支持计划。对于 Altium Designer、KiCad、OrCAD 等工程，建议先导入嘉立创 EDA 专业版，人工核对层级、器件、引脚和网络，再导出 `.epro2` 交给 SchemCP。SchemCP 不读取原始第三方格式，也不验证导入转换是否完整。

## 名称由来

**SchemCP = Schematic + MCP**

SchemCP 是面向 MCP 客户端的原理图上下文服务。名称可以理解为 `Sche[m] + MCP → SchemCP`，共享了字母 `M`。

当前版本：`0.1.0`

MCP Registry 名称：`io.github.yuanzihao/schemcp`

npm 包：`@yuanzihao/schemcp`

许可证：Apache-2.0

> `@yuanzihao/schemcp@0.1.0` 已发布到 npm，可直接通过下方 `npx` 命令启动。版本与完整性信息以 [npm 官方页面](https://www.npmjs.com/package/@yuanzihao/schemcp) 为准。

## 为什么使用 SchemCP

- **离线原理图解析**：输入是本地 `.epro2`，普通查询不依赖在线服务。
- **稳定中间表示**：公开 EDA-IR 固定标识为 `schemcp.eda-ir` 1.1.0，并对确定性内容计算哈希。
- **附件优先**：MCP 可以无工程启动，用户在对话中提供文件后再显式打开。
- **多工程工作区**：一个会话最多打开 4 个工程，并可建立用户声明的装配关系。
- **精确器件上下文**：兼容两种 INSTANCE 路径编码，查询基础组件或指定层级实例中的有效位号、属性、引脚覆盖和网络证据。
- **显式总线事实**：兼容官方独立 `BUSENTRY` 与当前导出的内嵌 `busEntry`，保留 `NET`、成员顺序和坐标，不自动展开总线名称。
- **有效装配状态**：按 Device 默认值、组件属性、层级实例覆盖的固定顺序解析 `Add into BOM`；仅显式 `yes/no` 返回 `POPULATED/DNP`，其余保持 `UNKNOWN`。
- **完整逻辑器件引脚**：按同一原理图中的位号、Symbol 和 `PART` 合并多单元器件及分离电源单元；缺失、重复或来源不完整时返回 `PARTIAL/UNKNOWN`，并保留显式隐藏引脚。
- **版本化组件语义**：`schemcp.semantic-rules/1` 以确定性规则给出 MCU/MPU、电源、存储器、收发器、连接器、保护/滤波等角色候选及页内电源域候选；每项都保留规则、证据和 `CANDIDATE/UNRESOLVED` 边界。
- **实际连接接口候选**：`list_interfaces` 识别 SWD/JTAG、UART、I²C、SPI/QSPI、CAN、USB、Ethernet、SDIO、I²S/SAI、模拟和 GPIO；未接线复用功能不会形成接口，缺少信号只返回 `PARTIAL_CANDIDATE`，DNP 默认排除但可查询证据。
- **可选 `.enet`**：用户可按工程附加网表，以精确核对引脚—网络端点。
- **事实边界明确**：工程事实、器件事实和工程推断分开返回，不把几何候选冒充完整电气真值。
- **只读且有界**：工具使用分页、稳定错误码和输入限额；不会修改原理图或生成代码。

当前产品范围只包括嘉立创 EDA 专业版原理图。公共 MCP 契约不暴露 PCB 工具，也不依赖 Chrome、Bridge 或在线 API。

SchemCP 是独立的社区开源项目，与嘉立创、立创商城、JLCEDA 或 EasyEDA 官方无隶属、授权或背书关系。相关商标归各自权利人所有。

## 当前支持范围

### 操作系统

| 平台 | 0.1.0 支持状态 | 发布门禁 |
| --- | --- | --- |
| Linux x64 | 支持 | 全量测试、覆盖率、两次确定性打包、离线安装和 MCP 协议验收 |
| macOS arm64/x64 | 支持 | 全量测试、两次确定性打包、离线安装和 MCP 协议验收 |
| Windows x64 | 兼容实现，真实主机验收待补 | 全量测试、两次确定性打包、离线安装和合成工程/网表/装配协议验收已通过；当前不声称真实 Windows 私有工程验收完成 |

Linux 与 macOS 对私有目录和文件强制检查 `0700/0600`。Windows 不把 `chmod` 结果冒充 POSIX 权限保证：服务仍强制绝对规范路径、排他创建、普通文件、符号链接与链接型 reparse point 拒绝，并在每个 MCP 结果的 `platformSecurity` 中明确返回 `WINDOWS_ACL_NOT_VERIFIED`。需要受管 ACL 的组织应在部署层配置 Windows 目录 ACL。

### 输入格式与能力

| 能力 | 0.1.0 状态 |
| --- | --- |
| 嘉立创 EDA 专业版 `.epro2` 原理图离线解析 | 支持 |
| 用户提供的 `.enet` 按工程绑定 | 支持，真实性与工程绑定保持未验证 |
| 器件、引脚、显式网络标签、几何候选查询 | 支持 |
| 组件角色、电源域和实际连接接口候选 | 支持，确定性规则推断且电气真值未验证 |
| 用户确认的多工程连接器映射 | 支持 |
| Altium、KiCad、OrCAD 等其他 EDA 原理图工程 | 不支持，暂无解析计划；建议先导入嘉立创 EDA 专业版并核对后导出 `.epro2` |
| PCB、在线 Bridge、插件 API、工程写入、代码生成 | 不支持 |

## 一条命令启动

需要 Node.js 22 或更高版本。

任意支持本地 stdio MCP 的客户端都可以直接使用已发布版本：

```bash
npx -y @yuanzihao/schemcp
```

该命令无参数时直接启动 MCP stdio 服务。stdout 只承载 MCP 协议消息，诊断写入 stderr。

查看辅助 CLI：

```bash
npx -y @yuanzihao/schemcp --help
```

显式启动 MCP 也可以写成：

```bash
npx -y @yuanzihao/schemcp mcp
```

## 接入客户端

### Codex

```bash
codex mcp add schemcp -- npx -y @yuanzihao/schemcp
codex mcp list
```

项目级配置也可以写入 `.codex/config.toml`：

```toml
[mcp_servers.schemcp]
command = "npx"
args = ["-y", "@yuanzihao/schemcp"]
required = true
startup_timeout_sec = 30
tool_timeout_sec = 30

[mcp_servers.schemcp.env]
NODE_OPTIONS = "--max-old-space-size=512"
```

### Claude Code

```bash
claude mcp add --transport stdio schemcp -- npx -y @yuanzihao/schemcp
claude mcp list
```

共享到项目的 `.mcp.json`：

```json
{
  "mcpServers": {
    "schemcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yuanzihao/schemcp"],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=512"
      }
    }
  }
}
```

### Pi

Pi 核心目前不内置 MCP。SchemCP 仍保持标准 stdio 服务，不为 Pi 增加专用协议；需要先安装并审查第三方 MCP 扩展。`0.1.0` 发布验收使用的是 Pi `0.83.0` 与 [`pi-mcp-adapter`](https://pi.dev/packages/pi-mcp-adapter) `2.16.0`：

```bash
pi install npm:pi-mcp-adapter@2.16.0
```

然后在项目根目录创建标准 `.mcp.json`：

```json
{
  "mcpServers": {
    "schemcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yuanzihao/schemcp"],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=512"
      }
    }
  }
}
```

Pi 扩展以当前用户权限执行，安装前应复核其来源与版本。该适配器不属于 SchemCP 的运行依赖或核心协议；若 Pi 未来原生支持 stdio MCP，可以直接移除适配层。

### Cursor、Cline 和其他客户端

SchemCP 不为每个客户端建立协议分支。将下面的标准 stdio 描述映射到客户端的 MCP 配置即可：

```json
{
  "id": "schemcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@yuanzihao/schemcp"],
  "env": {
    "NODE_OPTIONS": "--max-old-space-size=512"
  }
}
```

安装包还可以生成当前安装位置对应的三种配置：

```bash
schemcp mcp-config --client generic
schemcp mcp-config --client codex
schemcp mcp-config --client claude-code
```

## 第一次使用

1. 准备嘉立创 EDA 专业版 `.epro2` 原理图工程；其他 EDA 工程应先导入嘉立创 EDA 专业版并人工核对转换结果。
2. 在 MCP 客户端中附加或选择这个 `.epro2` 文件。
3. 将客户端提供的精确绝对路径传给 `open_schematic_project`。
4. 调用 `list_schematic_projects` 获取 `projectHandle`。
5. 调用 `list_design_hierarchy` 和 `list_instance_contexts` 获取 Sheet 与 INSTANCE；需要层级实例有效属性时，把返回的 `instanceContextId` 传给 `list_components`、`get_component` 或 `get_component_pins`。
6. 工程含 BUS 时，先用 `list_buses` 的 `BUSES` 视图定位总线，再用 `ENTRIES` 视图按显式 `order` 分页读取入口；不要自行展开 `DATA[7:0]`。
7. 需要严格引脚—网络核对时，再用 `attach_schematic_netlist` 为对应工程附加 `.enet`。

推荐给模型的首条提示：

```text
请使用 schemcp 打开我提供的 .epro2 附件，先调用
list_schematic_projects 和 list_design_hierarchy，再按页查询器件、引脚和显式 BUS。
如果没有 .enet，请把精确工程事实与几何网络候选分开表述。
```

`.enet` 不是普通离线解析的前置条件。未附加 `.enet` 时仍能查询器件、符号、引脚、导线和显式网络标签；涉及严格电气连接的结论会保持 `electricalTruth=NOT_VERIFIED`。

## 多工程装配

SchemCP 支持用户明确声明的 2～4 工程装配：

1. 分别调用 `open_schematic_project`；
2. 可选地按 `projectHandle` 调用 `attach_schematic_netlist`；
3. 调用 `create_schematic_assembly`；
4. 用 `list_interconnect_candidates` 查看确定性候选证据；
5. 只有用户确认针脚映射后，调用 `confirm_schematic_interconnect`；
6. 用 `list_assembly_connections` 查询“工程内网络 + 已确认跨工程映射”路径。

候选不会自动形成跨工程连接。服务不猜测镜像、反序或插接方向，也不会穿过电阻、磁珠、0Ω、电平转换器、收发器、Short 或 Net Tie 自动传播。

## 辅助 CLI

```bash
# 脱敏检查工程结构
schemcp inspect board.epro2

# 显式输出完整 EDA-IR；默认拒绝覆盖
schemcp compile board.epro2 --output board.eda-ir.json

# 独立校验装配清单
schemcp verify-assembly-manifest assembly.schemcp-assembly.json

# 生成客户端配置
schemcp mcp-config --client generic
```

完整参数见：

```bash
schemcp --help
```

## 本地开发

```bash
git clone https://github.com/yuanzihao/SchemCP.git
cd SchemCP
npm ci
npm run check
npm test
npm run verify:public-release
```

从源码启动：

```bash
npm run build
node dist/src/bin/schemcp.js
```

生成本地安装包：

```bash
npm pack
npm install --global ./yuanzihao-schemcp-0.1.0.tgz
schemcp
```

## 文档与安全

- [MCP 接口说明](docs/MCP_SERVICE.md)
- [50 个 MCP 工具与 JSON Schema](docs/MCP_TOOLS.md)
- [用户指南](docs/USER_GUIDE.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [变更记录](CHANGELOG.md)

请勿在 Issue、日志或测试夹具中提交真实 `.epro2`、`.enet`、Datasheet、网络名清单、绝对路径或私有装配清单。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

Copyright 2026 yuanzihao

本项目使用 [Apache License 2.0](LICENSE)。
