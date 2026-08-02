# Changelog

本项目遵循语义化版本；0.x 阶段仍可能调整公开 MCP Schema。

## [Unreleased]

### Added

- 兼容官方页号/Block 与当前页面 ID/Block 两种 INSTANCE 路径编码，并确定性校验页面、Block Component、Block Symbol、循环和歧义；
- 将 `INSTANCE_ATTR` 精确应用到有效组件实例或引脚实例，未解析目标保留稳定原因；
- `list_design_hierarchy`、`list_components`、`get_component` 和 `get_component_pins` 支持层级实例上下文查询；
- 新增仓库外私有清单驱动的 `verify:real-projects`，冻结真实工程输入、网表差异、诊断和安装态 MCP 调用门禁。
- 新增 `IrBus`、`IrBusEntry` 和 `list_buses`，兼容官方独立 `BUSENTRY` 与当前导出的内嵌 `busEntry`，保留显式顺序、坐标、来源和未绑定状态。
- 新增有效装配状态模型，按 Device、组件、层级实例覆盖顺序解析 `Add into BOM=yes/no`，并在组件查询中公开 `POPULATED/DNP/UNKNOWN`、证据和稳定原因。
- 新增多单元逻辑器件引脚完整性模型，按 Symbol `PART` 聚合分离单元和电源单元，保留显式隐藏引脚，并以 `COMPLETE/PARTIAL/UNKNOWN` 阻止不完整数据被误判为未使用引脚。
- `list_components`、`get_component` 和 `get_component_pins` 新增 Variant、装配状态和引脚完整性作用域；选择尚未应用的 Variant 时装配状态保守返回 `UNKNOWN`。
- 真实工程安装态门禁增加 DNP 与完整多单元引脚聚合调用，私有清单契约升级为 1.2.0。
- 新增 `IrComponentSemantic`、版本化 `schemcp.semantic-rules/1` 组件角色候选和页内电源域候选；组件查询直接携带规则、证据和真值状态。
- 新增 `IrInterface` 与 `list_interfaces`，覆盖 SWD/JTAG、UART、I²C、SPI/QSPI、CAN、USB、Ethernet、SDIO、I²S/SAI、模拟和 GPIO，并以实际导线候选阻止未接线复用功能误报。
- 接口候选支持 `CANDIDATE/PARTIAL_CANDIDATE/UNRESOLVED`、DNP 默认排除、层级/Variant 作用域和规则版本绑定游标；工程版本差异同步覆盖组件语义及接口实体。
- 真实工程私有清单契约升级为 1.3.0，增加匿名角色/接口矩阵及安装态 MCU 接口、DNP 接口排除调用。
- 新增显式 `IrResourceNode` 与 `IrResourceEdge` 资源图，确定性编译明确电源入口/转换/开关/负载/保护滤波传输候选、外部时钟源/缓冲/输入、复位监督/外部控制/手动复位、启动绑带以及 MCU 引脚连接边，并保留稳定未解析原因。
- 新增 `get_power_tree`、`get_clock_tree`、`get_reset_boot_paths` 和 `get_mcu_pin_usage`，图深度最大 8、每页最大 50 项，游标绑定工程、实例、Variant、筛选条件和规则版本。
- MCU 引脚输出 `USED/EXPLICIT_NC/UNUSED/UNKNOWN/DNP_COMPONENT`、细分网表/候选依据、电源域、接口及外部资源角色；未使用只在完整引脚模型、基础 Variant、已装配器件和显式 NC 或用户绑定 `.enet` 空网络共同满足时确认。
- Context Pack 升级为 1.1.0，增加 BUS、BUSENTRY、组件语义、接口、电源域、资源节点、分类型资源图、MCU 引脚资源及未解析证据文件；公共 MCP 扩展为 54 个只读工具。
- 真实工程私有清单契约升级为 1.5.0，增加按资源类型、边类型、状态、装配活动、绑定网表 MCU 引脚使用情况及目标级五态输出冻结的匿名基线。

### Changed

- 明确项目只维护嘉立创 EDA 专业版 `.epro2` 原理图解析，其他 EDA 原理图格式暂无支持计划；第三方工程建议先导入嘉立创 EDA 专业版并人工核对后再解析。

### Release status

- `0.2.0` 当前为未发布 RC；发布标签、GitHub Release 与 npm 发布需要明确授权；
- Windows x64 真实主机上的候选包安装与真实工程 MCP 调用仍是正式发布阻断项。

## [0.1.0] - 2026-07-31

### Added

- `npx -y @yuanzihao/schemcp` 无参数直接启动标准 stdio MCP；
- 安全、确定性的 `.epro2` 归档读取、V3 日志归并与原理图 EDA-IR；
- 原理图层级、器件身份、LCSC C-ID、Datasheet 链接、引脚、网络候选和诊断查询；
- 用户提供 `.enet` 的工程级绑定、精确同网端点与网表差异查询；
- 最多 4 个工程的 MCP 工作区，以及用户确认针脚映射后的跨工程装配查询；
- 本地 DocumentReference 数据手册引用与私有 AI Context Pack；
- Codex、Claude Code 和客户端无关 stdio 配置生成；
- MCP Registry `server.json` 与 npm `mcpName`；
- Apache-2.0 许可证、中英文 README、贡献、安全和行为准则；
- 公共发布元数据校验、跨平台 GitHub CI、确定性打包和安装态 MCP 验收。

### Changed

- `@yuanzihao/schemcp@0.1.0` 已公开发布，可通过 `npx -y @yuanzihao/schemcp` 启动；
- `schemcp` 是唯一公开可执行入口；首次公开版本不保留旧命令兼容层。
