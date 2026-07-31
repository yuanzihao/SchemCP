# Changelog

本项目遵循语义化版本；0.x 阶段仍可能调整公开 MCP Schema。

## [Unreleased]

### Changed

- 明确项目只维护嘉立创 EDA 专业版 `.epro2` 原理图解析，其他 EDA 原理图格式暂无支持计划；第三方工程建议先导入嘉立创 EDA 专业版并人工核对后再解析。

### Planned

- 完善原理图层级实例、Variant/DNP 和显式总线语义；
- 在不提交私有工程的前提下继续扩大格式回归覆盖。

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
