# MCP 服务参考

SchemCP `0.2.0` 提供只读 stdio MCP 服务。服务可无工程启动，只有 `open_schematic_project` 可以读取客户端明确提供的 `.epro2` 绝对附件路径。它不会扫描目录、驱动浏览器或修改工程。

服务只维护嘉立创 EDA 专业版 `.epro2` 原理图解析，其他 EDA 原理图格式暂无支持计划。第三方 EDA 工程应先导入嘉立创 EDA 专业版并由用户核对，再导出 `.epro2`；服务不读取原始第三方格式，也不验证转换完整性。

## 启动

```bash
npx -y @yuanzihao/schemcp
```

无参数和显式 `mcp` 子命令等价。stdout 仅承载 MCP 协议消息，日志与诊断写入 stderr。公共契约固定为 54 个原理图工具、0 个 PCB 工具，不存在 `--profile` 或内部全量档。

## 工具分组

| 分组 | 工具 |
| --- | --- |
| 工程会话 | `open_schematic_project`、`list_schematic_projects`、`select_schematic_project`、`get_active_schematic_project`、`close_schematic_project` |
| 摘要与层级 | `get_project_summary`、`list_design_hierarchy`、`list_instance_contexts`、`get_instance_context` |
| 器件与引脚 | `list_components`、`get_component`、`get_component_pins`、`get_component_pin_connectivity`、`list_direct_component_connections`、`list_unresolved_components` |
| 原理图内容 | `list_schematic_annotations`、`list_schematic_graphic_primitives`、`list_schematic_tables`、`get_schematic_table`、`list_symbol_texts` |
| 网络与候选 | `list_explicit_nets`、`list_buses`、`list_candidate_netlist_tuples`、`list_candidate_netlist_exclusions`、`list_network_endpoint_candidates`、`list_short_relation_candidates` |
| 组件语义与接口 | 组件查询中的 `semantic`、`list_interfaces` |
| P2 资源 | `get_power_tree`、`get_clock_tree`、`get_reset_boot_paths`、`get_mcu_pin_usage` |
| `.enet` | `attach_schematic_netlist`、`detach_schematic_netlist`、`get_netlist_comparison_summary`、`list_netlist_comparison_tuples`、`list_bound_electrical_nets`、`get_net` |
| 器件资料 | `list_part_masters`、`get_part_master`、`list_datasheet_references`、`get_datasheet_section` |
| Variant 与差异 | `get_variant`、`list_variant_overrides`、`diff_project_versions` |
| 多工程装配 | `create_schematic_assembly`、`list_schematic_assemblies`、`close_schematic_assembly`、`list_interconnect_candidates`、`confirm_schematic_interconnect`、`list_assembly_connections` |
| 装配清单 | `get_schematic_assembly_manifest`、`open_schematic_assembly_manifest` |
| 审计 | `get_diagnostics`、`get_evidence` |

所有列表工具均有页大小上限。游标绑定工程、查询种类和筛选条件，不能跨查询复用。重复位号不会被静默选择，调用方应提供页面或组件 ID 消歧。

`list_components` 可按 `assemblyStatus` 和 `pinCompletenessStatus` 筛选。装配状态只把有效 `Add into BOM=yes/no` 映射为 `POPULATED/DNP`，并保留 Device 默认值、组件属性或层级实例覆盖的来源；缺失、冲突、非法值以及尚未应用的 Variant 一律返回 `UNKNOWN`。`get_component_pins` 只在 Symbol `PART` 集合可证明完整时合并同位号多单元器件，显式 `display=false` 引脚不会被丢弃。

组件查询中的 `semantic` 使用 `schemcp.semantic-rules/1` 返回角色和页内电源域候选。`list_interfaces` 只从存在导线接触的引脚名称与显式网络候选识别接口：无导线或显式 NC 不产生接口，只有未命名导线或连接冲突时返回 `UNRESOLVED`。DNP 默认不出现在活动接口结果中，使用 `activityStatus=EXCLUDED_DNP` 可审计排除证据。所有结果都是确定性工程推断，不是数据手册事实或已验证电气真值。

`get_power_tree` 只沿明确电源角色和带证据的转换、电源开关或保护/滤波传输候选边遍历，不穿过普通器件猜测连通。`get_clock_tree` 只覆盖原理图外部晶振/振荡器、时钟缓冲候选和 MCU 外部输入，不推断 MCU 内部 PLL、时钟树或固件配置。`get_reset_boot_paths` 只描述显式复位监督、连接器外部控制、手动复位、启动和绑带网络。三种图查询 `maxDepth<=8`、每页最多 50 项，并明确返回多个根、环路和深度截断状态。

`get_mcu_pin_usage` 聚合完整多单元及隐藏引脚，并为每个引脚返回目标级 `USED/EXPLICIT_NC/UNUSED/UNKNOWN/DNP_COMPONENT`、细分 `usageStatus`、电源域、接口、外部时钟/复位/启动资源角色及稳定未解析原因。只有基础 Variant、`POPULATED`、引脚完整性 `COMPLETE`，且工程显式 NC 或绑定 `.enet` 明确空网络时才确认未使用；有明确连接候选时返回 `USED`，证据不足保持 `UNKNOWN`。

## 工程与附件

同一进程最多打开 4 个工程。相同内容按哈希去重；打开失败不会替换现有活动工程；关闭工程不会删除用户文件，并会使相关装配和游标失效。

附件路径必须来自客户端且是精确绝对路径。推荐在对话中上传文件，再让模型调用 `open_schematic_project`，无需在启动 MCP 时预先打开工程。

## `.enet` 与直接连接

`attach_schematic_netlist` 必须同时指定 `projectHandle` 和绝对 `.enet` 路径。网表索引按工程隔离，成功解析和比较后才原子切换。同内容重复绑定幂等，不同内容需要先解除。

`get_component_pin_connectivity` 返回组件身份、物理引脚号、引脚名、精确网表网络或几何候选以及比较状态。`list_direct_component_connections` 只返回同网直接端点，不穿过任何普通器件。

## 多工程装配

装配只表示用户声明 2～4 个已打开工程相关。`list_interconnect_candidates` 使用引脚数量、编号集合、引脚名、器件标题、制造商、MPN、LCSC C-ID、组件属性和位号等确定性证据生成候选，但不输出伪概率，也不自动确认。

`confirm_schematic_interconnect` 只接受同脚号确认或完整显式针脚对。确认关系标记为 `USER_CONFIRMED_SESSION_RELATIONSHIP`。`list_assembly_connections` 只能沿工程内网络和已确认互连移动，并为每段标注 `BOUND_NETLIST`、`EPRO2_CANDIDATE` 或 `CONFIRMED_INTERCONNECT`。

## 客户端配置

```bash
schemcp mcp-config --client generic
schemcp mcp-config --client codex
schemcp mcp-config --client claude-code
```

`generic` 返回版本化 `schemcp.mcp-stdio-client-config`，Codex TOML 和 Claude Code JSON 只是同一描述的适配器。Cursor、Cline、VS Code 等客户端应映射 generic 描述，不需要修改 SchemCP 核心协议。Pi 核心当前不内置 MCP，需要经过审查的第三方扩展读取同一 stdio 描述；该扩展不属于 SchemCP 依赖或协议。

## 协议验收

行为验收至少包括：初始化、`tools/list` 精确工具集、无工程状态、运行时打开附件、一个真实查询、非法参数、结果超限和断连。仅看到进程启动或 MCP 配置条目不代表服务可用。
