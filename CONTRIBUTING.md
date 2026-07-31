# 为 SchemCP 贡献 / Contributing to SchemCP

感谢你帮助改进 SchemCP。项目当前只接受原理图离线解析、查询、安全、文档和 MCP 集成相关贡献；PCB、Chrome、EasyEDA Bridge、在线 API、工程写入和代码生成不在当前范围内。

Thank you for improving SchemCP. The active scope is offline schematic parsing, queries, security, documentation, and MCP integration. PCB features, Chrome, EasyEDA Bridge, online APIs, design mutation, and code generation are currently out of scope.

## 开始之前 / Before you start

- 缺陷请先搜索已有 Issue；较大的行为或架构变更请先创建讨论 Issue。
- 不要提交真实用户工程、网表、数据手册、UUID、网络名、绝对路径或凭据。
- 代码和提交需要保持确定性、只读边界和稳定错误码。
- 仓库自身的包与文档元数据维护者为 `yuanzihao`；贡献者应保留自己的 Git 身份。

- Search existing issues before reporting a bug. Open a design issue before a large behavioral or architectural change.
- Never commit real user projects, netlists, datasheets, UUIDs, net names, absolute paths, or credentials.
- Preserve deterministic behavior, read-only boundaries, and stable error codes.
- Repository package and documentation metadata identify `yuanzihao` as the maintainer; contributors keep their own Git identities.

## 开发流程 / Development workflow

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run check
npm test
npm run verify:public-release
```

每个解析行为至少覆盖正常输入、边界输入、恶意输入和重复执行一致性。只允许使用人工构造、已脱敏的最小夹具进入 Git。

Every parser change should cover normal, boundary, malicious, and deterministic-repeat cases. Only synthetic, minimized, and sanitized fixtures may be committed.

## Pull Request

PR 描述应包含：

- 问题与范围；
- 事实边界是否变化；
- 测试命令和结果；
- 是否影响 npm 包、MCP Schema 或公开文档；
- 不包含私有 EDA 数据的确认。

Pull requests should state the problem and scope, truth-boundary impact, verification commands and results, public package or schema impact, and confirmation that no private EDA data is included.

提交应保持单一、可回滚、已验证。推荐使用清晰的 Conventional Commit 风格，例如：

```text
feat: add bounded schematic query
fix: reject ambiguous component selectors
docs: clarify enet evidence boundary
```

提交贡献即表示你同意按照本项目的 Apache-2.0 许可证提供该贡献。

By submitting a contribution, you agree that it is licensed under Apache-2.0.
