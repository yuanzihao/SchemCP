# AGENTS.md

本文件说明 AI 编程代理和贡献者在 SchemCP 仓库中的协作边界。它是公开的工程约束，不包含私有样本、内部路线历史或本机配置。

## 项目定位

SchemCP = Schematic + MCP。

SchemCP 是面向 AI 编程工具的本地优先原理图上下文服务。当前及可预见的维护范围只读取嘉立创 EDA 专业版导出的 `.epro2` 原理图工程，并通过只读 stdio MCP 与辅助 CLI 提供确定性查询。其他 EDA 软件的原理图解析暂无计划，不应建立格式适配器、兼容承诺或路线图占位。

用户持有 Altium Designer、KiCad、OrCAD 等其他格式时，建议先导入嘉立创 EDA 专业版，人工核对转换后的层级、器件、引脚和网络，再导出 `.epro2`。SchemCP 只负责解析导出结果，不读取原始第三方格式，也不证明格式迁移完整。

稳定公共标识：

- 产品与仓库：`SchemCP`
- npm 包：`@yuanzihao/schemcp`
- CLI 与 MCP 服务 ID：`schemcp`
- MCP Registry：`io.github.yuanzihao/schemcp`
- 作者：`yuanzihao`
- 许可证：Apache-2.0

## 当前范围

允许开发：

- `.epro2` 安全归档读取与 V3 日志归并；
- 原理图层级、器件、符号、引脚、导线、显式网络标签、Variant 与诊断；
- 用户提供 `.enet` 的工程级只读绑定与对照；
- 用户声明并确认映射的多工程原理图装配；
- 本地数据手册引用、MCP 查询、CLI、测试与发布门禁。

不在当前范围：

- Altium Designer、KiCad、OrCAD 或其他 EDA 原理图格式解析器；
- PCB、封装几何、布线、叠层、规则、铺铜或制造分析；
- Chrome、EasyEDA Bridge 或插件 API 作为运行前置条件；
- 修改 EDA 工程、自动布线、生成固件或无边界信号传播；
- PDF/截图视觉识别作为结构化工程事实入口。

组件上的显式 Footprint 属性可以作为原理图器件元数据保留，但不得扩展为 PCB 或封装语义模型。

## 事实与真值边界

系统必须区分：

- 工程事实：确定性解析器或用户明确提供的附件产生；
- 器件事实：器件库或数据手册产生，并保留来源；
- 工程推断：规则或模型产生，必须明确标记并携带证据。

没有已绑定 `.enet` 时，几何连接只能作为候选。即使绑定用户提供的 `.enet`，也必须保持 `sourceAuthenticity=NOT_VERIFIED`、`projectBinding=USER_ASSERTED_NOT_VERIFIED` 和 `electricalTruth=NOT_VERIFIED`，不得冒充官方在线真值。

跨工程连接只能沿工程内同一网络和用户确认的连接器针脚映射移动。候选不得自动生效，不得猜测镜像、反序或插接方向，也不得穿过普通器件继续传播。

## 安全与隐私

所有工程和附件都视为不可信输入：

- 拒绝路径穿越、符号链接、非普通文件和错误扩展名；
- 限制归档条目、解压大小、压缩比、日志行、JSON 深度和结果大小；
- 不执行归档内容，不扫描目录，不猜测附件路径；
- stdout 仅用于 MCP 协议，诊断写入 stderr；
- 完整 IR、网表、数据手册和装配清单默认是私有产物。

禁止提交真实 `.epro2`、`.enet`、数据手册、UUID、网络名、位号清单、绝对路径、凭据或私有装配清单。仓库测试只使用人工构造的最小夹具；真实工程只允许在本机做不入库验收。

## 架构与代码规则

- 内层模型不得依赖 CLI、MCP、HTTP、浏览器或 EDA 在线 API；
- V3 双 JSON 日志必须按 JSON 边界解析，禁止使用 `split("||")`；
- 未识别记录必须可见，不得静默丢弃或由 AI 修复；
- 输出排序、哈希和打包必须确定；
- 预期失败使用稳定错误码；
- MCP 查询必须只读、有界、可分页并绑定游标筛选域；
- 修改代码时同步更新中英文公开文档和行为测试。

## 验收与提交

提交前至少运行：

```bash
npm ci
npm run check
npm run test:coverage
npm run verify:mcp-reference
npm run verify:third-party-notices
npm run verify:public-release
npm run verify:package
```

涉及安装或 MCP 契约时，还要验证确定性 `npm pack`、全新目录离线安装、stdio 初始化、`tools/list` 和真实工具调用。成功启动进程不等于 MCP 可用。

每个提交只包含一个可说明、可回滚、已验证的里程碑。分支默认使用 `codex/` 前缀，不覆盖无关的用户改动。
