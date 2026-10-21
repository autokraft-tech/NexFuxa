# NexFuxa Component UI Design System v1.0

状态：**Design Frozen / Read-only Valve Symbol Implemented**。冻结日期：2026-10-16。规范版本v1.0；Contract、Valve模板、有限profile、Tokens和实例引用版本为`1.0.0`。

本目录是Component UI唯一权威规范，覆盖新建/修改Symbol、Faceplate及组件生成、状态、绑定和配置页面。冻结自本地最终设计，不是旧归档包；它不是当前FUXA可直接导入/运行的组件包。已有Widget/Faceplate、PLC和旧工程不自动迁移。

## 按任务读取

| 任务/权威范围 | 文件 |
| --- | --- |
| 视觉语言、报警样式及字体间距 | [STYLE_GUIDE](STYLE_GUIDE.md)、[Tokens](tokens.json) |
| Symbol几何、三尺寸、ID隔离及资源释放 | [SYMBOL](SYMBOL.md) |
| Faceplate页面、交互及逐项Save | [FACEPLATE](FACEPLATE.md) |
| 唯一有限状态语义、绑定/写入和能力边界 | [CONTRACT](CONTRACT.md) |
| 类型/字段形状 | [contract.ts](contract.ts) |
| 实际Valve设计输入 | [模板](examples/valve.json)、[多实例](examples/valve-instances.json) |
| 设计预期向量 | [64组完整输入](fixtures/valve-states.json)、[7组缺值输入](fixtures/valve-partial-data.json) |
| 代表性静态图与素材证据 | [SYMBOL静态示意](SYMBOL.md#symbol-examples)、[FACEPLATE静态示意](FACEPLATE.md#faceplate-examples)、[PROVENANCE](assets/PROVENANCE.md) |
| 生成/维护流程 | [项目Skill](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/.agents/skills/nexfuxa-component-ui/SKILL.md) |

许可/素材工作流以[SVG_REUSE_POLICY](../SVG_REUSE_POLICY.md)为准。素材库为本地`D:/Will/Documents/source/repos/FUXA-SVG-Widgets` / [frangoteam/FUXA-SVG-Widgets](https://github.com/frangoteam/FUXA-SVG-Widgets)，当前Valve25保持选定，不用编辑器内置Shape重新比较。

精确色值/尺寸是NexFuxa标准，不是厂商/ISA强制值。[源码确认]表示既有代码事实；[冻结规范]及必须表示目标要求；[尚待验证]表示无实现或现场证据。不得由冻结推断功能已实现。状态只在CONTRACT定义；展示规范引用它。发现文字、类型、Tokens与示例冲突时停止相关生成并修正规范，不自行选择一份。

## 长期决策

| 决策 | 固定边界与原因 |
| --- | --- |
| 声明式Contract+有限profile | 两UI共享snapshot，避免逻辑漂移；不建立通用Expr/命令平台。第二设备须读取真实Model后扩展有限类型 |
| 许可几何复用 | Valve25保留几何与MIT；不改源库或为了便利重绘等效设备；Extend不推断Open |
| 一模板三布局 | 布局只影响展示，不影响PLC实例键/状态/目标；Symbol透明、Faceplate不透明 |
| PLC主导动作 | Extend/Retract/Reset单次TRUE、PLC清零；无FALSE脉冲/PLC ACK/动作事务/重试/恢复。HMI控制与设备状态正交，Reset独立 |
| 写入最小适配 | 复用Prefix/Inherit/连接/权限，新控件显式opt-in；保存源/目标重新解析，旧postValue guard保留 |
| 每项配置保存 | Save+确认，PLC类型检查必需，工程min/max可选；不引入组事务、共享草稿或自动回滚 |
| 报警可选 | Fault静态虚线框无报警生命周期；完整adapter独立实施，未配置不阻塞Valve |
| 版本与兼容 | 固定模板版本，旧Manual/Fixed/Inherit及Widget保持；升级显式迁移，禁止静默覆盖 |

现场仍需确定设备型式/Extend物理含义、厂内报警理念和屏幕尺寸。未提供时采用Extend/Retract、Fault-only、standard；不把PLC改造或复杂审批作为基本UI前置。

<a id="implementation-status"></a>

## 实施边界与路线

当前运行时已实现只读 Valve Symbol：有限状态 reducer、许可几何、三布局、Label/Description/方向、Prefix/Inherit 只读绑定和实例清理。使用入口与资产说明见[Valve guide](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/custom/widgets/valves/README.md#nexfuxa-valve-symbol)。这不表示新 native Faceplate、命令、配置写入或报警 adapter 已实现；旧六BOOL Widget仍保持原契约。

| 能力 | 当前实现边界 | 验证/后续依据 |
| --- | --- | --- |
| 冻结设计、类型、Tokens、模板与Skill | 已归档，语义保持v1.0 / 1.0.0 | 本目录权威文件 |
| 只读Valve Symbol | 已实现有限状态、三布局、许可几何、动画/质量及实例清理 | `client/test/valve-symbol.test.cjs`、`client/test/valve-symbol-e2e.py`；CONTRACT §12、SYMBOL |
| 既有Faceplate Prefix继承与多实例 | 已实现旧Widget只读继承、Dialog/Card隔离和owner清理 | `client/test/faceplate-binding.test.cjs`、`client/test/faceplate-e2e.py`；不等于新native Faceplate |
| Native Faceplate状态页 | 尚未实现Operation/Configuration壳层与共享snapshot接入 | FACEPLATE、CONTRACT §12 |
| 新Component写入 | 尚未实现保存目标解析、权限/结果回调、一次性Cmd Restore出口过滤与配置保存 | CONTRACT §6/§10/§12；不得由只读运行时推断可写 |
| 第二Component与生成、完整报警adapter | 后续独立工作；须真实模型与明确版本变更 | 不虚构Motor/Analog字段或报警能力 |

后续实现须按原Git workflow独立测试/评审。现有回归覆盖只读Symbol状态、浏览器、实例关闭/重连及保存重载；它们不证明真实PLC通信、工业屏幕/触摸验收或未实现的写入链已经通过。现场命令帧、旧TRUE不恢复、权限/驱动失败及新Contract完整持久化仍需对应实现和验证。临时测试执行结果放在忽略的`_reports/`或PR中，不沉淀为本目录阶段报告。

## 规范变更

普通组件开发只消费本规范。基础状态语义、Contract或全局设计标准的变更必须有明确规范变更任务，更新规范版本及受影响的contract/template/profile/tokens版本、类型、示例、fixtures和兼容性/迁移说明，完成相应检查后评审。旧版本实例固定引用，不自动覆盖；不兼容变更须明确迁移或保留旧实例。仅修正文档笔误且不改变规则时记录修正即可。
