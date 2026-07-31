# 发布 SchemCP

本文供维护者发布 `@yuanzihao/schemcp` 和 MCP Registry 元数据。首次公开版本为 `0.1.0`。

## 发布前提

- `package.json.version`、`server.json.version` 和 Git Tag 一致；
- npm 包名为 `@yuanzihao/schemcp`，访问级别为 public；
- MCP Registry 名为 `io.github.yuanzihao/schemcp`；
- npm 账号已确认拥有 `@yuanzihao` scope 的公开发布权限；
- GitHub Release environment 已启用必要保护；
- 工作树不包含真实工程、网表、数据手册、路径或凭据。

## 本地门禁

```bash
npm ci
npm run check
npm run test:coverage
npm run verify:mcp-reference
npm run verify:third-party-notices
npm run verify:public-release
npm run verify:package
npm audit --omit=dev
```

`verify:package` 会生成两次安装包并逐字节比较，然后在全新目录离线安装，执行版本、配置生成和 MCP 协议验收。若要单独验收已有 tarball，可执行：

```bash
npm run verify:npx-tarball -- /absolute/path/yuanzihao-schemcp-0.1.0.tgz
```

验收应确认：单一 `schemcp` bin、stdio 初始化、48 个原理图工具及输入/结果 Schema、0 个 PCB 工具、合成 `.epro2` 器件与引脚查询、工程级 `.enet` 绑定、用户确认装配、篡改清单拒绝、通用/Codex/Claude Code 配置生成，以及包内不存在源码测试、私有夹具和本机路径。压缩包不得超过 6 MiB，解包后不得超过 25 MiB。

手动触发 `Build release candidate` 工作流只生成候选 npm tarball、SHA-256、SPDX/CycloneDX SBOM、第三方许可证清单和验证收据，不执行任何外部发布。候选产物应先完成人工检查。

## 发布流程

1. 合并经过 Linux、macOS、Windows CI 的 `main`；
2. 在真实 Windows 主机完成一次私有工程安装态验收，只保留脱敏哈希和计数；
3. 手动运行 release-candidate 工作流并审查 tarball、SHA-256、SBOM、许可证和验证收据；
4. 创建与版本一致、指向已验证 `main` 提交的签名 Tag，例如 `v0.1.0`；
5. 首次发布时，在受保护的 `release` 环境中临时配置一次性、细粒度 npm token，执行 `npm publish <tarball> --access public --provenance`；不得把 token 写入仓库、日志或普通环境变量；
6. 确认 `@yuanzihao/schemcp@0.1.0` 已可公开解析后，在 npm 配置精确绑定仓库、工作流和 `release` 环境的 Trusted Publisher，然后立即撤销并删除首次发布 token；
7. 后续版本只允许使用 GitHub OIDC 与兼容的 Node/npm 通过 Trusted Publishing 发布，不再配置 npm token；
8. npm 版本可解析后，使用候选工作流已校验的官方 `mcp-publisher` v1.7.9（Linux amd64 归档 SHA-256 `ab128162b0616090b47cf245afe0a23f3ef08936fdce19074f5ba0a4469281ac`）发布 `server.json`；升级版本时必须同步固定新版本和官方哈希；
9. 创建 GitHub Release，附上 npm tarball、SHA-256、SPDX/CycloneDX SBOM、第三方许可证清单、验证收据和变更记录；
10. 在全新机器或容器执行真实 `npx -y @yuanzihao/schemcp@0.1.0` 握手，并完成 Codex、Claude Code、Pi 各一次真实工具调用。

仓库中的发布工作流在得到维护者对 npm、MCP Registry 和 GitHub Release 三类外部写入的明确授权前，保持为无发布副作用的候选构建流程。

在 npm 与 Registry 均可查询、全新环境 `npx` 行为通过之前，不得宣称公共发布完成。
