# AI Context Pack

AI Context Pack 是 SchemCP 将一个 `.epro2` 原理图工程导出为私有、确定性 JSON/JSONL 目录的辅助格式。它适合离线审计、局部检索和重复验证，不是公开分享格式。

当前契约版本：`1.0.0`

生成器：`@yuanzihao/schemcp` `0.1.0`

## 生成与校验

```bash
schemcp context-pack board.epro2 --output board.ai-context
schemcp verify-context-pack board.ai-context
```

目标目录必须不存在。目录权限为 `0700`，文件权限为 `0600`；写入器通过同级临时目录原子发布，并拒绝覆盖。

## 固定文件

除 `manifest.json` 外，1.0.0 固定包含 20 个 payload：

- `project-summary.json`
- `hierarchy.json`
- `documents.jsonl`
- `variants.json`
- `components.jsonl`
- `schematic-annotations.jsonl`
- `schematic-graphic-primitives.jsonl`
- `schematic-tables.jsonl`
- `component-pins.jsonl`
- `devices.jsonl`
- `symbols.jsonl`
- `symbol-parts.jsonl`
- `symbol-texts.jsonl`
- `symbol-pins.jsonl`
- `wires.jsonl`
- `explicit-nets.jsonl`
- `instance-contexts.jsonl`
- `diagnostics.json`
- `unbound-attributes.jsonl`
- `unmodeled-records.jsonl`

该格式不包含 PCB、Footprint 语义文件。组件自身显式的 Footprint 属性仍可能作为原理图器件元数据出现在组件记录中。

## 清单与确定性

`manifest.json` 保存：

- 原始归档、归并状态和 EDA-IR 的 SHA-256；
- 每个 payload 的媒体类型、字节数、记录数和 SHA-256；
- JSON/JSONL 规范编码；
- 能力与真值边界；
- 整个 payload 集合的规范哈希。

相同输入和版本应生成逐字节相同的 payload 与清单。独立校验器会拒绝额外文件、缺失文件、权限放宽、非规范编码、哈希篡改和越过真值边界的能力声明。

## 真值与隐私

Context Pack 只封装 SchemCP 已建模的原理图事实和明确标注的候选，不会把几何连接升级为官方电气真值。`electricalTruth` 始终保持 `NOT_VERIFIED`。

Context Pack 可能包含位号、器件属性、网络标签、诊断和来源位置，因此不得提交 Git、上传 Issue 或作为普通构建产物发布。
