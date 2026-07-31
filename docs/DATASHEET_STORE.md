# DocumentReference 本地数据表库

作者：yuanzihao

契约版本：0.1.0（当前由 `@yuanzihao/schemcp` 0.1.0 实现）

## 1. 目标与边界

数据表库把用户明确提供的 PDF 转换为本地、不可变、可独立校验的 `DocumentReference`。它解决“AI 按需读取器件文档局部内容”，不负责联网下载、供应商目录匹配、替代料推荐或证明 PDF 来源真实性。

固定真值边界：

- `sourceAuthenticity=USER_ASSERTED_NOT_VERIFIED`；
- `metadataTruth=PDF_METADATA_NOT_SOURCE_AUTHENTICITY`；
- `textExtractionTruth=PDF_TEXT_EXTRACTION_NOT_LAYOUT_TRUTH`；
- 数据手册属于器件文档事实，不会升级 `.epro2` 的 `electricalTruth`。

## 2. 导入与校验

```bash
schemcp import-datasheet-reference /absolute/path/device.pdf \
  --store /absolute/path/private-datasheets \
  --kind DATASHEET \
  --manufacturer STMicroelectronics \
  --mpn STM32F407VGT6 \
  --title "STM32F405xx/STM32F407xx Datasheet" \
  --document-number DS8626

schemcp verify-datasheet-store \
  /absolute/path/private-datasheets
```

身份绑定必须且只能选择一种：

- `--part-master-id <pm_...>`；
- `--lcsc-part-id <C-ID>`；
- `--manufacturer <制造商> --mpn <制造商料号>`。

导入不执行模糊匹配。用户填写的标题、文档号、修订、发布日期和 HTTPS 来源 URL 均是未核验声明。

## 3. 固定目录契约

每份 PDF 的 ID 是 `doc_<PDF SHA-256>`，相同字节永远得到相同 ID：

```text
private-datasheets/                         0700
  doc_<sha256>/                             0700
    document.pdf                            0600
    manifest.json                           0600
    pages.jsonl                             0600
    sections.jsonl                          0600
```

导入通过同级临时目录原子发布，目标已存在时拒绝覆盖。独立校验器要求：

- 固定文件集且不存在符号链接、额外文件或路径穿越；
- 目录 `0700`、文件 `0600`；
- `manifest.json` 与 JSONL 使用规范 JSON 和 LF；
- PDF 魔数、原始 SHA-256、逐文件字节数和 SHA-256 全部匹配；
- 页码连续、页文本哈希正确、章节范围在 PDF 页数内；
- `packageSha256` 能由 manifest 的其余字段复算。

## 4. PDF 解析限额

- 原始 PDF 最大 64 MiB；
- 最大 5,000 页；
- 单页提取文本最大 1 MiB；
- 全文提取文本最大 64 MiB；
- PDF 书签最多 20,000 项、最大 32 层；
- 加密或受密码保护 PDF 拒绝导入。

页文本来自 PDF.js `getTextContent()`，只用于关键词召回和局部上下文。书签章节只来自 PDF Outline；没有书签时明确记录 `PDF_OUTLINE_UNAVAILABLE`，不会根据字体或文本样式猜标题。

## 5. MCP 绑定

```bash
schemcp mcp \
  --project /absolute/path/project.epro2 \
  --datasheet-store /absolute/path/private-datasheets
```

也可使用 `--datasheet-store-env EDA_DATASHEET_STORE`。启动时会完整校验库，工具调用不接受文件路径：

- `list_datasheet_references`：按文档类型或精确身份分页；
- `get_datasheet_section`：按书签章节 ID 或主题返回最多 10 页、64,000 字符的文本。

每次局部读取都会复验对应证据包，返回值不包含数据表库或 PDF 的本地路径。远程下载、OCR、表格/版面恢复、数字签名和官方来源验证是后续独立能力，不属于 0.1.0。
