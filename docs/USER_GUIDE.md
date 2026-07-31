# SchemCP 用户指南

## 1. 安装

需要 Node.js 22 或更高版本。npm 发布后可直接运行：

```bash
npx -y @yuanzihao/schemcp
```

本地安装包：

```bash
npm install --global ./yuanzihao-schemcp-0.1.0.tgz
schemcp --version
```

## 2. 接入 AI 客户端

Codex：

```bash
codex mcp add schemcp -- npx -y @yuanzihao/schemcp
codex mcp list
```

Claude Code：

```bash
claude mcp add --transport stdio schemcp -- npx -y @yuanzihao/schemcp
claude mcp list
```

Pi 核心目前不内置 MCP。经审查后安装第三方适配器，并让它读取项目根目录的标准 `.mcp.json`：

```bash
pi install npm:pi-mcp-adapter@2.16.0
```

```json
{
  "mcpServers": {
    "schemcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@yuanzihao/schemcp"],
      "env": { "NODE_OPTIONS": "--max-old-space-size=512" }
    }
  }
}
```

适配器以当前用户权限执行，且不是 SchemCP 的依赖；安装前必须复核其来源与版本。

Cursor、Cline 或其他支持 stdio MCP 的客户端使用通用描述：

```json
{
  "id": "schemcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@yuanzihao/schemcp"],
  "env": { "NODE_OPTIONS": "--max-old-space-size=512" }
}
```

## 3. 直接发送工程文件

SchemCP 默认无工程启动。用户在对话中附加 `.epro2` 后，让模型把客户端给出的精确绝对路径传给 `open_schematic_project` 即可，不需要预先打开嘉立创 EDA、Chrome、Bridge 或插件。

推荐提示词：

```text
请使用 schemcp 打开我附加的 .epro2。先列出工程和原理图层级，再按页查询器件、完整引脚、网络证据、制造商、MPN、立创商城 C-ID 和工程中的数据手册链接。没有 .enet 时，请把工程事实和几何候选分开表述。
```

建议查询顺序：

1. `open_schematic_project`
2. `list_schematic_projects`
3. `list_design_hierarchy`
4. `list_components`
5. `get_component` 与 `get_component_pins`
6. `get_component_pin_connectivity`

## 4. 何时提供 `.enet`

普通器件阅读不要求 `.enet`。需要精确的引脚—网络端点或跨板连接查询时，在嘉立创 EDA 专业版中从“导出 → 网表文件”导出 `.enet`，再调用 `attach_schematic_netlist` 绑定到对应 `projectHandle`。

用户提供的 `.enet` 不会被声称为官方在线真值；SchemCP 仍会返回来源和工程绑定未验证状态。

## 5. 多工程关联

核心板和扩展板应分别打开，再创建独立装配。不要因为三个工程同时在工作区就假定它们同时物理安装。

1. 打开 2～4 个工程；
2. 可选地分别绑定 `.enet`；
3. `create_schematic_assembly`；
4. `list_interconnect_candidates`；
5. 用户核对连接器后调用 `confirm_schematic_interconnect`；
6. `list_assembly_connections` 查询跨工程路径。

## 6. 数据手册

工程中的 Datasheet HTTPS 属性会随组件查询返回。需要可离线检索 PDF 内容时，可建立私有数据表库：

```bash
schemcp import-datasheet-reference chip.pdf \
  --store ./private-datasheets \
  --kind DATASHEET \
  --manufacturer STMicroelectronics \
  --mpn STM32F407VGT6

schemcp verify-datasheet-store ./private-datasheets
```

数据表库不得提交 Git。PDF 文本提取不等同于版面真值，来源仍由用户声明。

## 7. 常见问题

- `MCP_PROJECT_NOT_OPEN`：服务正常但尚未打开附件，调用 `open_schematic_project`。
- `NOT_BOUND`：查询需要 `.enet`、基线工程或数据表库，但当前未绑定。
- 相对路径被拒绝：必须使用客户端提供的绝对附件路径。
- 重复位号歧义：增加页面 ID 或组件 ID。
- 连接结论为候选：未绑定 `.enet`，或文件来源/工程绑定仍未验证。
- 工具列表包含 PCB：当前客户端连接的不是 SchemCP 0.1.0 公共服务，应检查实际命令和旧进程。

详细工具契约见 [MCP_SERVICE.md](MCP_SERVICE.md)，真值说明见 [TRUTH_VALIDATION.md](TRUTH_VALIDATION.md)。
