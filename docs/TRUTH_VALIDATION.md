# 电气真值与 `.enet`

SchemCP 可以只读取 `.epro2` 工作，但不会把几何连接候选冒充完整电气网表。

## 三类信息

- 工程事实：`.epro2` 中可确定解析的原理图记录；
- 器件事实：工程属性或用户导入的数据手册；
- 工程推断：几何接触、名称关联或模型解释，必须显式标注证据和限制。

`.epro2` 能提供组件、符号、引脚、导线和显式网络标签。对当前已支持编码，SchemCP 会实例化符号引脚，并判断引脚连接点是否落在有界导线段上。这仍是几何候选，不等同于官方完整网表。

## `.enet` 是什么

`.enet` 是嘉立创 EDA 专业版导出的原理图网表文件。它提供组件、物理引脚编号、引脚名和网络，可用于精确的 `(位号, 引脚号, 网络)` 查询与对照。

用户可在嘉立创 EDA 专业版中打开目标原理图，使用“导出 → 网表文件”导出 `.enet`。不同版本的菜单文字可能略有差异。

运行时绑定：

1. 用 `open_schematic_project` 打开 `.epro2`；
2. 取得 `projectHandle`；
3. 用 `attach_schematic_netlist` 提交该工程句柄和客户端提供的 `.enet` 绝对路径；
4. 使用 `get_netlist_comparison_summary`、`get_net`、`get_component_pin_connectivity` 或 `list_direct_component_connections` 查询；
5. 需要更换网表时先调用 `detach_schematic_netlist`。

绑定是工程级、原子且互相隔离的。拒绝相对路径、符号链接、目录、错误扩展名和目录扫描。

## 状态含义

用户提供的文件始终保持：

```text
acquisitionMethod = USER_PROVIDED_FILE
sourceAuthenticity = NOT_VERIFIED
projectBinding = USER_ASSERTED_NOT_VERIFIED
electricalTruth = NOT_VERIFIED
```

这些状态表示 SchemCP 可以验证文件语法、哈希和集合关系，但无法仅凭本地附件证明它由官方在线 API 产生、必然属于当前工程版本，或覆盖所有 EDA 电气语义。

## 连接查询边界

有 `.enet` 时优先返回绑定网表网络；没有时返回 `.epro2` 几何候选及证据等级。直接连接查询只列出同一网络上的端点，不穿过电阻、磁珠、0Ω、收发器、电平转换器、Short 或 Net Tie。

跨工程路径还必须经过用户确认的连接器针脚映射。候选连接器不会自动生效，不自动镜像、反序或猜测物理插接方向。
