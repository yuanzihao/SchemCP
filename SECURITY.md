# 安全策略 / Security Policy

## 支持版本 / Supported versions

公开发布后，只维护最新次版本。0.x 阶段的接口仍可能变化；安全修复会优先进入最新版本。

After public release, only the latest minor release is supported. APIs may still change during the 0.x series; security fixes target the latest release first.

## 私下报告漏洞 / Private vulnerability reporting

请勿为以下问题创建公开 Issue：

- ZIP 路径穿越、资源耗尽或解析器绕过；
- 任意文件读取、符号链接绕过或路径泄露；
- MCP stdout 协议污染；
- 私有工程、网表、数据手册或装配清单泄露；
- 发布包、依赖或工作流供应链问题。

Do not open a public issue for archive traversal, resource exhaustion, parser bypass, arbitrary file access, symlink bypass, path disclosure, MCP stdout contamination, private design-data exposure, or supply-chain vulnerabilities.

GitHub 仓库公开后，请使用仓库的 **Security → Report a vulnerability** 私有报告入口。公开前如果尚未提供受控的私密渠道，请不要发送敏感样本，也不要通过公开 Issue、讨论区或日志附件报告漏洞。

Once the GitHub repository is public, use **Security → Report a vulnerability**. Before publication, do not send sensitive samples unless a controlled private channel has been provided. Never attach sensitive samples to a public issue, discussion, or log.

报告请包含影响版本、攻击前提、最小复现、实际影响和建议修复方向。请先使用人工构造样本；只有维护者明确同意并提供安全传输方式后，才发送真实工程。

Include affected versions, prerequisites, a minimal reproduction, impact, and possible remediation. Start with a synthetic fixture. Send a real project only after the maintainer explicitly provides a private transfer method.

## 响应目标 / Response targets

- 3 个工作日内确认收到；
- 7 个工作日内给出初步分级；
- 修复发布前协商披露时间。

- Acknowledge within three business days.
- Provide an initial severity assessment within seven business days.
- Coordinate disclosure timing before a fix is released.
