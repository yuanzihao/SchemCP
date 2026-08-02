# SchemCP MCP 工具参考

> 本文档由运行中的 SchemCP `tools/list` 契约确定性生成，请勿手工编辑。

- 契约：`schemcp.mcp-tools-contract 1.1.0`
- 服务：`schemcp`
- 包：`@yuanzihao/schemcp@0.2.0`
- 运输：`stdio`
- 工具数：`54`
- JSON 快照 SHA-256：`5bafd6539c7573863f92458385bb5dcb3a7c491057eacd0f28f1e1ecfbe2a1d3`

每个工具的结果至少包含 `ok:boolean` 与平台安全能力状态；工具专用字段作为受版本化公共契约约束的扩展属性返回。失败时 `ok=false`，并返回稳定的 `error.code`。

## 1. `open_schematic_project`

**打开用户提供的原理图工程**

读取客户端已提供的绝对 .epro2 附件路径，执行安全、离线、确定性解析，并加入当前工作区。工作区最多同时保留 4 个工程；相同内容只激活既有句柄。不得扫描目录或猜测路径；失败时保留全部已打开工程。返回值不回显本地路径。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "projectPath": {
      "description": "客户端为用户附件提供的精确绝对 .epro2 路径",
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "projectPath"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 2. `attach_schematic_netlist`

**为指定工程附加用户网表**

使用客户端提供的精确绝对 .enet 附件路径，为指定已打开工程建立独立网表比较索引。完整解析成功后才原子附加；不扫描目录、不回显路径，也不把用户文件升级为官方来源或已验证工程绑定。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "netlistPath": {
      "description": "客户端为用户附件提供的精确绝对 .enet 路径",
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "必须显式指定 list_schematic_projects 返回的工程句柄",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "projectHandle",
    "netlistPath"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 3. `detach_schematic_netlist`

**解除指定工程的用户网表**

显式释放指定工程的会话网表索引，不影响工程 EDA-IR、其他工程或用户文件。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "projectHandle": {
      "description": "必须显式指定 list_schematic_projects 返回的工程句柄",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "projectHandle"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 4. `create_schematic_assembly`

**声明相关原理图工程装配**

把 2～4 个已打开工程声明为同一装配关系。该声明只缩小互连候选范围，不证明任何连接器已经物理配对。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "projectHandles": {
      "description": "互不重复的已打开工程句柄",
      "items": {
        "maxLength": 96,
        "minLength": 1,
        "type": "string"
      },
      "maxItems": 4,
      "minItems": 2,
      "type": "array"
    }
  },
  "required": [
    "projectHandles"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 5. `list_schematic_assemblies`

**分页列出当前会话装配**

列出仍由已打开工程支撑的用户声明装配及已确认互连；工程关闭后相关装配自动失效。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 6. `close_schematic_assembly`

**关闭会话装配**

释放指定装配及其确认互连，只修改 MCP 进程内状态，不修改用户工程或附件。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "assemblyHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "assemblyHandle"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 7. `list_interconnect_candidates`

**分页列出跨工程互连候选**

只在用户声明的装配工程间，按引脚编号集合、数量、名称及显式器件属性生成确定性候选。候选不是已确认物理连接，不会自动参与跨工程路径。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "assemblyHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "leftProjectHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "rightProjectHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "assemblyHandle"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 8. `confirm_schematic_interconnect`

**确认跨工程连接器针脚映射**

把指定候选按用户确认的同号针脚或显式针脚对加入会话装配。不会自动镜像、反序或猜测映射。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "assemblyHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "candidateId": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "mapping": {
      "oneOf": [
        {
          "properties": {
            "kind": {
              "const": "SAME_PIN_NUMBER",
              "type": "string"
            }
          },
          "required": [
            "kind"
          ],
          "type": "object"
        },
        {
          "properties": {
            "kind": {
              "const": "EXPLICIT_PIN_PAIRS",
              "type": "string"
            },
            "pinPairs": {
              "items": {
                "properties": {
                  "leftPinNumber": {
                    "maxLength": 128,
                    "minLength": 1,
                    "type": "string"
                  },
                  "rightPinNumber": {
                    "maxLength": 128,
                    "minLength": 1,
                    "type": "string"
                  }
                },
                "required": [
                  "leftPinNumber",
                  "rightPinNumber"
                ],
                "type": "object"
              },
              "maxItems": 1024,
              "minItems": 1,
              "type": "array"
            }
          },
          "required": [
            "kind",
            "pinPairs"
          ],
          "type": "object"
        }
      ]
    }
  },
  "required": [
    "assemblyHandle",
    "candidateId",
    "mapping"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 9. `list_assembly_connections`

**分页查询装配内跨工程连接**

从任意组件/引脚出发，只沿工程内同一网络和用户已确认互连针脚查询。不会穿过普通器件传播；每段路径明确区分绑定网表、.epro2 候选和确认互连。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "assemblyHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "componentId": {
      "description": "页内组件 ID；与 designator 二选一",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "designator": {
      "description": "精确位号；与 componentId 二选一，重复时返回歧义",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "maxInterconnectHops": {
      "maximum": 4,
      "minimum": 0,
      "type": "integer"
    },
    "pageId": {
      "description": "可选页面 ID，用于消歧",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pinNumber": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "assemblyHandle",
    "projectHandle"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 10. `get_schematic_assembly_manifest`

**生成私有原理图装配清单**

返回当前会话装配的规范、可校验清单。只包含工程 EDA-IR 哈希、精确组件选择器和用户已确认针脚映射，不包含本地路径、原始工程或未确认候选。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "assemblyHandle": {
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "assemblyHandle"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 11. `open_schematic_assembly_manifest`

**恢复私有原理图装配清单**

从客户端提供的精确绝对 .schemcp-assembly.json 附件路径恢复装配。只有清单规范哈希有效且当前已打开工程的 EDA-IR 哈希全部精确一致时才原子恢复。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "manifestPath": {
      "description": "客户端为用户附件提供的精确绝对 .schemcp-assembly.json 路径",
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "manifestPath"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 12. `list_schematic_projects`

**分页列出已打开的原理图工程**

返回当前 MCP 工作区内所有工程的脱敏句柄、摘要和活动状态；不回显本地路径。一个工程内部的多个 Schematic/Sheet 请继续通过 list_design_hierarchy 查询。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；工作区变化后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 4，最大 4",
      "maximum": 4,
      "minimum": 1,
      "type": "integer"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 13. `select_schematic_project`

**选择活动原理图工程**

按脱敏工程句柄切换默认查询目标；不重新解析工程，也不影响其他已打开工程。后续查询仍可用 projectHandle 显式覆盖。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "projectHandle": {
      "description": "list_schematic_projects 返回的精确工程句柄",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "projectHandle"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 14. `get_active_schematic_project`

**获取当前原理图工程会话**

返回当前会话是否已打开工程及脱敏句柄；不回显本地路径。

输入 Schema：

```json
{
  "properties": {},
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 15. `close_schematic_project`

**关闭当前原理图工程**

从当前 MCP 工作区关闭指定工程；省略句柄时关闭活动工程。只释放进程内索引，不修改或删除用户文件。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "projectHandle": {
      "description": "可选精确工程句柄；省略时关闭当前活动工程",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 16. `get_project_summary`

**获取 EDA 工程能力与摘要**

返回脱敏工程计数、内容哈希和当前事实能力边界。开始分析前应先调用本工具。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 17. `get_netlist_comparison_summary`

**获取可选网表比较摘要**

返回 MCP 启动时可选绑定的 .enet 比较计数、哈希和门禁。精确匹配仍不证明来源真实性、运行时工程绑定或完整电气真值。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 18. `list_netlist_comparison_tuples`

**分页查询网表比较元组**

分页查询匹配、官方网表缺失候选或候选多余元组。结果来自可选用户 .enet 绑定，始终保持来源、工程绑定和电气真值未验证。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentRef": {
      "description": "可选精确位号",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "kind": {
      "enum": [
        "MATCHED",
        "MISSING_IN_CANDIDATE",
        "UNEXPECTED_CANDIDATE"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "netName": {
      "description": "可选精确网络名",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pinNumber": {
      "description": "可选精确引脚编号",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 19. `list_bound_electrical_nets`

**分页列出绑定网表的电气网络超边**

把启动时绑定并严格解析的 .enet 中每个非空网络保持为一个超边，分页返回唯一端点组计数、涉及元件数、候选对照和重复项状态。可按精确位号或比较状态筛选；不把多端网络展开为两两连接，不跨器件推导传播。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "comparisonStatus": {
      "enum": [
        "EXACT_SET_MATCH",
        "DIFFERENCES_FOUND",
        "DUPLICATE_TUPLES"
      ],
      "type": "string"
    },
    "componentRef": {
      "description": "可选精确位号；只保留绑定网表中包含该元件的网络",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 20. `get_net`

**获取绑定网表中的精确网络**

按精确网络名分页返回启动时绑定并严格解析的 .enet 端点、离线候选对照和逐项证据。未绑定 .enet 时不可用；匹配结果不证明用户文件来源真实性、运行时工程绑定或完整电气真值。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "netName": {
      "description": "绑定 .enet 中的精确网络名，区分大小写",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "netName"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 21. `list_design_hierarchy`

**分页列出工程设计层级**

分页返回工程配置、Board、Schematic、Sheet 和显式 INSTANCE 上下文节点。父子关系只来自归档成员关系、META 引用或已校验 INSTANCE 路径，不根据名称猜测。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "kind": {
      "enum": [
        "PROJECT_CONFIGURATION",
        "BOARD",
        "SCHEMATIC",
        "SHEET",
        "INSTANCE_CONTEXT"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "parentId": {
      "description": "可选精确父节点 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 22. `list_instance_contexts`

**分页列出显式层级实例上下文**

兼容官方页号编码和当前导出的页面 ID/Block 编码，分页返回已校验的层级路径、终端页、解析状态和有效组件实例数量。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "schematicId": {
      "description": "可选精确 Schematic 文档 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 23. `get_instance_context`

**获取实例上下文及原始属性覆盖**

通过精确 INSTANCE 文档 ID 获取已校验路径，并分页返回每条 INSTANCE_ATTR 的应用状态与精确目标；未解析项保留稳定原因，不会被猜测应用。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "contextId": {
      "description": "精确 INSTANCE 文档 UUID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "contextId"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 24. `list_components`

**分页列出组件**

按确定顺序分页列出组件，可按页面、位号、层级实例、装配状态和引脚完整性筛选。Add into BOM=yes/no 分别形成 POPULATED/DNP；缺失、冲突、非法或未应用 Variant 返回 UNKNOWN。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "assemblyStatus": {
      "description": "可选有效装配状态",
      "enum": [
        "POPULATED",
        "DNP",
        "UNKNOWN"
      ],
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "designatorContains": {
      "description": "不区分大小写的位号子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "精确页面 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pinCompletenessStatus": {
      "description": "可选逻辑器件引脚完整性状态",
      "enum": [
        "COMPLETE",
        "PARTIAL",
        "UNKNOWN"
      ],
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "可选当前工程 Variant ID；替代料未应用时装配状态返回 UNKNOWN",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 25. `list_schematic_annotations`

**分页列出原理图页文本注释**

分页返回 SCH_PAGE TEXT 的显式内容、原始未换算位置和来源，可按页面、文本子串或空值状态筛选。工具不把文字解释成设计意图、约束或电气事实。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "contentState": {
      "description": "可选显式文本状态",
      "enum": [
        "EXPLICIT_TEXT",
        "EXPLICIT_EMPTY"
      ],
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "textContains": {
      "description": "可选不区分大小写的文本子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 26. `list_schematic_graphic_primitives`

**分页列出原理图与符号图形**

分页返回 SCH_PAGE/SYMBOL 中显式 POLY、RECT、ARC、CIRCLE、ELLIPSE 的原始未换算几何、样式字面值、来源及 Symbol Part 精确绑定状态。只验证有限字段和点数组编码，不解释图形语义、电气含义或渲染结果。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "documentId": {
      "description": "可选精确原理图页或 Symbol 文档 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "documentType": {
      "description": "可选图形所属文档类型",
      "enum": [
        "SCHEMATIC_PAGE",
        "SYMBOL"
      ],
      "type": "string"
    },
    "kind": {
      "description": "可选图形种类",
      "enum": [
        "POLY",
        "RECT",
        "ARC",
        "CIRCLE",
        "ELLIPSE"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "partBindingState": {
      "description": "可选 Symbol Part 绑定状态",
      "enum": [
        "NOT_APPLICABLE",
        "RESOLVED_EXACT",
        "EXPLICIT_EMPTY",
        "PART_NOT_FOUND"
      ],
      "type": "string"
    },
    "partId": {
      "description": "可选精确非空 Symbol Part ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 27. `list_schematic_tables`

**分页列出原理图结构化表格**

分页返回 SCH_PAGE/SYMBOL TABLE 的尺寸、位置、锁定状态、单元格计数、来源和 Symbol Part 精确绑定状态。可按文档、绑定状态或单元格文字筛选；列表不展开单元格，也不解释文字语义。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cellTextContains": {
      "description": "可选不区分大小写的单元格文字子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "documentId": {
      "description": "可选精确原理图页或 Symbol 文档 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "documentType": {
      "description": "可选表格所属文档类型",
      "enum": [
        "SCHEMATIC_PAGE",
        "SYMBOL"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "partBindingState": {
      "description": "可选 Symbol Part 绑定状态",
      "enum": [
        "NOT_APPLICABLE",
        "RESOLVED_EXACT",
        "EXPLICIT_EMPTY",
        "PART_NOT_FOUND"
      ],
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 28. `get_schematic_table`

**获取原理图表格及分页单元格**

按所属文档 ID 和表格 ID 获取结构化表格，并分页返回显式单元格。可按文字、空值状态或来源表示筛选；不会把高低电平、模式名称等内容解释成设计或电气结论。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cellContentState": {
      "description": "可选单元格显式文本状态",
      "enum": [
        "EXPLICIT_TEXT",
        "EXPLICIT_EMPTY"
      ],
      "type": "string"
    },
    "cellRepresentation": {
      "description": "可选单元格来源表示",
      "enum": [
        "V3_INLINE_TABLE_CELL",
        "OFFICIAL_SEPARATE_TABLE_RECORD",
        "BOTH_MATCHING"
      ],
      "type": "string"
    },
    "cellTextContains": {
      "description": "可选不区分大小写的单元格文字子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "documentId": {
      "description": "精确原理图页或 Symbol 文档 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "tableId": {
      "description": "精确 TABLE ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "documentId",
    "tableId"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 29. `list_symbol_texts`

**分页列出符号显式文本**

分页返回 SYMBOL TEXT 的显式内容、原始未换算位置、来源和 Part 精确绑定状态。可按 Symbol、Part、文本子串、空值状态或绑定状态筛选；不解释文字语义。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "contentState": {
      "description": "可选显式文本状态",
      "enum": [
        "EXPLICIT_TEXT",
        "EXPLICIT_EMPTY"
      ],
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "partBindingState": {
      "description": "可选 Part 绑定状态",
      "enum": [
        "RESOLVED_EXACT",
        "EXPLICIT_EMPTY",
        "PART_NOT_FOUND"
      ],
      "type": "string"
    },
    "partId": {
      "description": "可选精确非空 Part ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "symbolId": {
      "description": "可选精确 Symbol 文档 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "textContains": {
      "description": "可选不区分大小写的文本子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 30. `list_unresolved_components`

**分页列出未解析元件**

分页返回缺少精确料号身份、身份属性非法/冲突、Device 引用异常或 Symbol/Footprint 绑定未解析的有位号元件。身份仅来自组件显式属性，其次为 Device 显式默认属性；不执行采购目录匹配、近似匹配、替代料推荐或变体应用。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "designatorContains": {
      "description": "可选不区分大小写的位号子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "identityMethod": {
      "description": "可选身份解析方法",
      "enum": [
        "EXACT_LCSC_PART_ID",
        "EXACT_MANUFACTURER_AND_MPN",
        "UNRESOLVED"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确页面 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "reason": {
      "description": "可选未解析原因",
      "enum": [
        "MISSING_EXACT_PART_IDENTITY",
        "INVALID_LCSC_PART_ID",
        "INVALID_MANUFACTURER",
        "INVALID_MANUFACTURER_PART",
        "CONFLICTING_LCSC_PART_ID",
        "CONFLICTING_MANUFACTURER",
        "CONFLICTING_MANUFACTURER_PART",
        "DEVICE_REFERENCE_NOT_FOUND",
        "DEVICE_REFERENCE_AMBIGUOUS",
        "SYMBOL_BINDING_UNRESOLVED",
        "FOOTPRINT_BINDING_UNRESOLVED"
      ],
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 31. `list_part_masters`

**分页列出物料主数据**

按显式 LCSC C-ID 或显式制造商与 MPN 的精确身份确定性聚合有位号元件。可按身份字段精确筛选；不执行采购目录匹配、数据手册绑定、模糊合并、替代料推荐或变体应用。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "identityMethod": {
      "description": "可选精确身份聚合方法",
      "enum": [
        "EXACT_LCSC_PART_ID",
        "EXACT_MANUFACTURER_AND_MPN"
      ],
      "type": "string"
    },
    "lcscPartId": {
      "description": "可选精确 LCSC C-ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "manufacturer": {
      "description": "可选精确制造商",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "manufacturerPart": {
      "description": "可选精确制造商料号 MPN",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 32. `get_part_master`

**获取物料主数据及元件出现位置**

按 list_part_masters 返回的确定性 PartMaster ID 获取主数据，并分页返回关联元件及其身份字段证据。不会执行目录、数据手册或 Variant 绑定。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "partMasterId": {
      "description": "精确 PartMaster ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "partMasterId"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 33. `list_datasheet_references`

**分页列出本地数据表引用**

分页列出 MCP 启动时绑定并独立校验的本地 DocumentReference。只按精确 PartMaster、LCSC C-ID 或制造商与 MPN 过滤；不联网匹配，不证明 PDF 来源真实性。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "kind": {
      "enum": [
        "DATASHEET",
        "ERRATA",
        "REFERENCE_MANUAL",
        "APPLICATION_NOTE",
        "USER_MANUAL",
        "OTHER_TECHNICAL"
      ],
      "type": "string"
    },
    "lcscPartId": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "manufacturer": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "manufacturerPart": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "partMasterId": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 34. `get_datasheet_section`

**读取本地数据表章节或主题**

按 DocumentReference ID 和 PDF 书签章节 ID，或按主题文本，返回有界页文本。工具不接受文件路径；每次读取都会复验不可变证据包。PDF 文本不是版面真值，来源真实性仍未验证。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "documentReferenceId": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "maxChars": {
      "maximum": 64000,
      "minimum": 256,
      "type": "integer"
    },
    "maxPages": {
      "maximum": 10,
      "minimum": 1,
      "type": "integer"
    },
    "sectionId": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "topic": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "documentReferenceId"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 35. `get_component`

**获取单个组件**

通过组件 ID 或精确位号获取基础组件，也可指定 instanceContextId 获取层级实例中已应用 INSTANCE_ATTR 后的有效组件。返回显式 DNP/装配证据与多 PART 引脚完整性；替代 Variant 不在 v0.2 中猜测应用。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentId": {
      "description": "页内组件 ID；与 designator 二选一",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "designator": {
      "description": "精确位号；与 componentId 二选一，重复时返回歧义",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID；指定后返回该层级实例中的有效组件属性",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pageId": {
      "description": "可选页面 ID，用于消歧",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "可选当前工程 Variant ID；v0.2 不应用替代料，指定后装配状态保守返回 UNKNOWN",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 36. `get_component_pins`

**获取组件符号引脚**

分页返回逻辑器件已实例化 PART 的合并引脚、隐藏标志、变换连接点及显式网络几何候选；多单元缺失或归属歧义会显式返回 PARTIAL/UNKNOWN，不据此判定未使用引脚。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentId": {
      "description": "页内组件 ID；与 designator 二选一",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "designator": {
      "description": "精确位号；与 componentId 二选一，重复时返回歧义",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID；指定后返回该层级实例中的有效组件属性",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选页面 ID，用于消歧",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "可选当前工程 Variant ID；v0.2 不应用替代料，指定后装配状态保守返回 UNKNOWN",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 37. `get_component_pin_connectivity`

**获取组件引脚连接上下文**

对任意组件分页返回原理图引脚、可选绑定 .enet 的引脚名称与精确网络、离线候选和资料可用状态。不判断器件是否为主控，不把用户网表或几何候选升级为完整电气真值。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentId": {
      "description": "页内组件 ID；与 designator 二选一",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "designator": {
      "description": "精确位号；与 componentId 二选一，重复时返回歧义",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选页面 ID，用于消歧",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 38. `list_direct_component_connections`

**分页列出组件的直接同网连接**

以任意组件为起点，分页列出同一网络超边上的其他组件引脚。有绑定 .enet 时优先使用其端点，否则返回纯 .epro2 候选；不跨电阻、磁珠、收发器、电平转换器、Short、Net Tie 或其他器件传播。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentId": {
      "description": "页内组件 ID；与 designator 二选一",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "designator": {
      "description": "精确位号；与 componentId 二选一，重复时返回歧义",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选页面 ID，用于消歧",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pinNumber": {
      "description": "可选精确源引脚编号",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 39. `get_variant`

**获取变体及元件分组**

通过变体 ID 或精确名称查询 Variant，并分页返回显式关联的 COMPONENT_GROUP。GROUP_DATA 即使匹配 INSTANCE 文档 ID 也尚未解析目标图元。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "title": {
      "description": "精确变体名称；与 variantId 二选一，重复时返回歧义",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "变体文档 ID；与 title 二选一",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 40. `list_variant_overrides`

**分页列出变体原始属性覆盖**

分页返回 COMPONENT_GROUP.GROUP_DATA 中的显式属性和值及来源，并仅按精确 ID 标注 INSTANCE 文档是否存在。目标尚未解释为最终组件、引脚或 DNP 状态。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "groupId": {
      "description": "可选精确元件分组 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "title": {
      "description": "精确变体名称；与 variantId 二选一，重复时返回歧义",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "变体文档 ID；与 title 二选一",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 41. `list_explicit_nets`

**分页列出显式网络标签**

聚合导线记录中的显式 NET 标签。结果不等同于完整网络图，也不包含引脚连通关系。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "nameContains": {
      "description": "不区分大小写的网络名子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 42. `list_buses`

**分页列出显式 BUS 或 BUSENTRY**

分页返回显式 BUS 本体或 BUSENTRY 入口。兼容官方独立 BUSENTRY 与当前导出的内嵌 busEntry；保留 NET、order、坐标、旋转、编码和绑定状态，不展开 DATA[7:0] 等名称，也不靠几何猜测独立入口归属。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "associationStatus": {
      "description": "仅 ENTRIES 视图：入口归属状态筛选",
      "enum": [
        "EMBEDDED_IN_BUS_RECORD",
        "EXPLICIT_PARENT_ID",
        "SEPARATE_RECORD_WITHOUT_EXPLICIT_BUS_ID",
        "EXPLICIT_PARENT_ID_NOT_FOUND"
      ],
      "type": "string"
    },
    "busEncoding": {
      "description": "仅 BUSES 视图：显式 BUS 编码筛选",
      "enum": [
        "OFFICIAL_DOTS_WITH_SEPARATE_BUSENTRY_RECORDS",
        "OBSERVED_EMBEDDED_BUSENTRY_MAP",
        "HYBRID_DOTS_WITH_EMBEDDED_BUSENTRY_MAP"
      ],
      "type": "string"
    },
    "busId": {
      "description": "可选精确 BUS ID；ENTRIES 视图只返回已绑定该 BUS 的入口",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "entryEncoding": {
      "description": "仅 ENTRIES 视图：BUSENTRY 编码筛选",
      "enum": [
        "OFFICIAL_SEPARATE_BUSENTRY_RECORD",
        "OBSERVED_EMBEDDED_BUSENTRY_MAP_ITEM"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "netNameContains": {
      "description": "仅 BUSES 视图：不区分大小写的 NET 子串",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "view": {
      "description": "返回 BUS 列表或 BUSENTRY 列表；默认 BUSES",
      "enum": [
        "BUSES",
        "ENTRIES"
      ],
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 43. `list_interfaces`

**分页列出接口候选**

使用版本化确定性规则从显式引脚名称和网络候选识别 SWD/JTAG、UART、I²C、SPI/QSPI、CAN、USB、Ethernet、SDIO、I²S/SAI、模拟和 GPIO 接口。缺失规定信号只返回 PARTIAL_CANDIDATE；DNP 默认排除，可显式查询排除证据。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "activityStatus": {
      "description": "装配活动筛选；默认仅 ACTIVE，ALL 同时返回 DNP 排除和装配未知证据",
      "enum": [
        "ACTIVE",
        "EXCLUDED_DNP",
        "ASSEMBLY_UNKNOWN",
        "ALL"
      ],
      "type": "string"
    },
    "componentId": {
      "description": "可选精确组件 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "status": {
      "description": "可选接口识别状态",
      "enum": [
        "CANDIDATE",
        "PARTIAL_CANDIDATE",
        "UNRESOLVED"
      ],
      "type": "string"
    },
    "type": {
      "description": "可选接口类型",
      "enum": [
        "SWD",
        "JTAG",
        "UART",
        "I2C",
        "SPI",
        "QSPI",
        "CAN",
        "USB",
        "ETHERNET",
        "SDIO",
        "I2S_SAI",
        "ANALOG",
        "GPIO_GROUP"
      ],
      "type": "string"
    },
    "variantId": {
      "description": "可选当前工程 Variant ID；未应用 Variant 时接口活动状态保守为 ASSEMBLY_UNKNOWN",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 44. `get_power_tree`

**获取有界电源树候选**

沿页作用域显式电源网络、明确 POWER_INPUT/LDO/DC-DC 角色和带证据的电源开关、保护或滤波候选传输边进行有界遍历。不会穿过普通器件猜测连通，支持多个根、环路和 DNP/实例/Variant 作用域。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "activityStatus": {
      "description": "装配活动筛选；默认 ACTIVE，ALL 包含 DNP 与装配未知证据",
      "enum": [
        "ACTIVE",
        "EXCLUDED_DNP",
        "ASSEMBLY_UNKNOWN",
        "ALL"
      ],
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "maxDepth": {
      "description": "图遍历深度，默认 4，最大 8",
      "maximum": 8,
      "minimum": 0,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "rootNetName": {
      "description": "可选精确根网络名；同名跨页时应同时提供 pageId",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "rootNodeId": {
      "description": "可选资源图节点 ID；来自前一次查询的 roots 或边端点",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "可选 Variant ID；当前未应用 Variant 时资源边保守降级为未解析",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 45. `get_clock_tree`

**获取外部时钟树候选**

只沿原理图中外部晶振/振荡器、显式身份的时钟缓冲候选和 MCU 外部时钟输入网络进行有界查询；不推断 MCU 内部 PLL、内部时钟树或固件配置。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "activityStatus": {
      "description": "装配活动筛选；默认 ACTIVE，ALL 包含 DNP 与装配未知证据",
      "enum": [
        "ACTIVE",
        "EXCLUDED_DNP",
        "ASSEMBLY_UNKNOWN",
        "ALL"
      ],
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "maxDepth": {
      "description": "图遍历深度，默认 4，最大 8",
      "maximum": 8,
      "minimum": 0,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "rootNetName": {
      "description": "可选精确根网络名；同名跨页时应同时提供 pageId",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "rootNodeId": {
      "description": "可选资源图节点 ID；来自前一次查询的 roots 或边端点",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "可选 Variant ID；当前未应用 Variant 时资源边保守降级为未解析",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 46. `get_reset_boot_paths`

**获取复位与启动绑带路径候选**

查询显式 RESET/RST/BOOT/STRAP 网络上的监督器、连接器外部控制、手动复位、MCU 输入和可证明的无源上下拉候选。只返回原理图外部路径，不推断芯片内部启动逻辑或固件行为。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "activityStatus": {
      "description": "装配活动筛选；默认 ACTIVE，ALL 包含 DNP 与装配未知证据",
      "enum": [
        "ACTIVE",
        "EXCLUDED_DNP",
        "ASSEMBLY_UNKNOWN",
        "ALL"
      ],
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "maxDepth": {
      "description": "图遍历深度，默认 4，最大 8",
      "maximum": 8,
      "minimum": 0,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "rootNetName": {
      "description": "可选精确根网络名；同名跨页时应同时提供 pageId",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "rootNodeId": {
      "description": "可选资源图节点 ID；来自前一次查询的 roots 或边端点",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "variantId": {
      "description": "可选 Variant ID；当前未应用 Variant 时资源边保守降级为未解析",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 47. `get_mcu_pin_usage`

**获取 MCU 引脚使用状态**

分页返回全部 MCU_MPU 角色候选的完整多单元引脚，以及 USED/EXPLICIT_NC/UNUSED/UNKNOWN/DNP_COMPONENT 状态、细分网表或候选依据、电源域、接口、外部资源角色和稳定未解析原因。只有引脚模型 COMPLETE、基础 Variant、器件已装配，且工程显式 NC 或已绑定 .enet 明确空网络时才确认未使用；其余未连接表象保持 UNKNOWN。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentId": {
      "description": "可选精确 MCU 组件 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "designator": {
      "description": "可选精确 MCU 位号；歧义时需补 pageId",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "instanceContextId": {
      "description": "可选精确 INSTANCE 上下文 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "status": {
      "description": "可选目标级 MCU 引脚资源状态",
      "enum": [
        "USED",
        "EXPLICIT_NC",
        "UNUSED",
        "UNKNOWN",
        "DNP_COMPONENT"
      ],
      "type": "string"
    },
    "usageStatus": {
      "enum": [
        "USED_BOUND_NETLIST",
        "USED_CANDIDATE",
        "UNUSED_CONFIRMED",
        "UNKNOWN"
      ],
      "type": "string"
    },
    "variantId": {
      "description": "可选 Variant ID；当前未应用 Variant 时不得确认未使用",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 48. `list_candidate_netlist_tuples`

**分页列出规范化候选网表元组**

分页返回可组成 (位号, 引脚号, 网络名) 的候选元组及图元证据。元组来自显式导线标签和几何接触，尚未与 .enet 或嘉立创EDA API 真值比较，不等同于正式网表。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentRef": {
      "description": "可选精确位号，区分大小写",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "netName": {
      "description": "可选精确网络名，区分大小写",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "pinNumber": {
      "description": "可选精确引脚号，保持源值",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 49. `list_candidate_netlist_exclusions`

**分页列出候选网表排除项**

分页返回没有进入规范化候选网表的引脚实例及确定性原因，用于定位非普通端点、无标签导线、NC、无导线、缺失字段和冲突。排除清单不是官方网表差异报告。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "componentId": {
      "description": "可选精确组件 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确原理图页 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "reason": {
      "enum": [
        "MISSING_COMPONENT_REF",
        "NON_COMPONENT_ENDPOINT",
        "MISSING_PIN_NUMBER",
        "CONFLICTING_EXPLICIT_NET_CANDIDATES",
        "UNRESOLVED_WIRE_WITHOUT_EXPLICIT_NET",
        "DECLARED_NO_CONNECT",
        "UNRESOLVED_NO_WIRE",
        "CANDIDATE_STATE_INCONSISTENT"
      ],
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 50. `list_network_endpoint_candidates`

**分页列出网络端点声明候选**

比较 NetFlag/NetPort 的声明网络名属性候选与其引脚导线候选。字段语义和连接均未通过官方网表验证，结果只用于一致性诊断。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "endpointKind": {
      "enum": [
        "NET_FLAG",
        "NET_PORT"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确页面 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "status": {
      "enum": [
        "DECLARATION_MATCHES_CONNECTION_CANDIDATE",
        "DECLARATION_MISMATCHES_CONNECTION_CANDIDATE",
        "DECLARATION_MISSING",
        "DECLARATION_CONFLICT",
        "DECLARATION_VALUE_INVALID",
        "CONNECTION_CANDIDATE_UNRESOLVED",
        "INVALID_ENDPOINT_PIN_COUNT"
      ],
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 51. `list_short_relation_candidates`

**分页列出 Short Symbol 关系候选**

按官方 Short Symbol 类型聚合其两个引脚的显式网络候选。结果保留原始网络名，不代表已通过官方网表验证，也不会执行网络合并。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "pageId": {
      "description": "可选精确页面 ID",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "status": {
      "enum": [
        "READY_EXPLICIT_NET_PAIR_CANDIDATE",
        "SAME_EXPLICIT_NET_CANDIDATE",
        "UNRESOLVED_PIN_CONNECTION_CANDIDATE",
        "CONFLICTING_PIN_CONNECTION_CANDIDATE",
        "INVALID_SHORT_PIN_COUNT"
      ],
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 52. `diff_project_versions`

**分页比较当前工程与基线工程**

比较 MCP 启动时绑定的当前工程和可选基线工程，分页返回已建模 IR 实体及显式网络的新增、删除和修改。工具不接收文件路径；来源位置与供应商扩展字段不参与语义差异。两个归档是否属于同一产品版本链尚未验证。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "changeType": {
      "description": "可选变更类型",
      "enum": [
        "ADDED",
        "REMOVED",
        "MODIFIED"
      ],
      "type": "string"
    },
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "entityKind": {
      "description": "可选实体类型",
      "enum": [
        "SUMMARY_METRIC",
        "DOCUMENT",
        "PROJECT_CONFIGURATION",
        "BOARD",
        "SCHEMATIC",
        "SCHEMATIC_PAGE",
        "SCHEMATIC_ANNOTATION",
        "SCHEMATIC_GRAPHIC_PRIMITIVE",
        "SCHEMATIC_TABLE",
        "SCHEMATIC_TABLE_CELL",
        "VARIANT",
        "COMPONENT_GROUP",
        "INSTANCE_CONTEXT",
        "COMPONENT",
        "COMPONENT_SEMANTIC",
        "INTERFACE",
        "RESOURCE_NODE",
        "RESOURCE_EDGE",
        "SYMBOL",
        "SYMBOL_PART",
        "SYMBOL_TEXT",
        "SYMBOL_PIN",
        "DEVICE",
        "WIRE",
        "PIN_INSTANCE",
        "SHORT_RELATION",
        "NETWORK_ENDPOINT",
        "EXPLICIT_NET"
      ],
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 53. `get_diagnostics`

**分页获取编译诊断**

返回 EDA-IR 编译过程中的聚合诊断，可按严重级别筛选。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "cursor": {
      "description": "上一页返回的不透明 nextCursor；改变筛选条件后不可复用",
      "minLength": 1,
      "type": "string"
    },
    "limit": {
      "description": "每页数量，默认 20，最大 50",
      "maximum": 50,
      "minimum": 1,
      "type": "integer"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    },
    "severity": {
      "enum": [
        "warning",
        "error"
      ],
      "type": "string"
    }
  },
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```

## 54. `get_evidence`

**获取对象来源证据**

返回组件、符号引脚、符号文字、原理图表格、原理图图形、导线、BUS/BUSENTRY、原理图注释、Variant 或元件组的原始 V3 日志来源位置；重复局部 ID 会显式返回歧义。

输入 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "documentId": {
      "description": "可选所属文档 ID，用于同 ID 对象消歧",
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "objectId": {
      "maxLength": 128,
      "minLength": 1,
      "type": "string"
    },
    "objectType": {
      "enum": [
        "component",
        "symbolPin",
        "wire",
        "variant",
        "componentGroup",
        "schematicAnnotation",
        "schematicGraphicPrimitive",
        "schematicTable",
        "symbolText",
        "bus",
        "busEntry"
      ],
      "type": "string"
    },
    "projectHandle": {
      "description": "可选工程句柄；省略时查询当前活动工程。句柄来自 open/list/get_active_schematic_project",
      "maxLength": 96,
      "minLength": 1,
      "type": "string"
    }
  },
  "required": [
    "objectType",
    "objectId"
  ],
  "type": "object"
}
```

结果 Schema：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "additionalProperties": {},
  "properties": {
    "ok": {
      "description": "工具调用是否成功",
      "type": "boolean"
    }
  },
  "required": [
    "ok"
  ],
  "type": "object"
}
```
