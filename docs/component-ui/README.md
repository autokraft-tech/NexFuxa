# NexFuxa Component UI Design System v1.0

状态：**Design Frozen / Runtime Implementation Pending**。冻结日期：2026-10-16。规范版本v1.0；Contract、Valve模板、有限profile、Tokens和实例引用版本为`1.0.0`。

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
| 代表性静态图与素材证据 | [SYMBOL静态示意](SYMBOL.md#6-静态设计稿)、[FACEPLATE静态示意](FACEPLATE.md#5-静态示意)、[PROVENANCE](assets/PROVENANCE.md) |
| 生成/维护流程 | [项目Skill](../../.agents/skills/nexfuxa-component-ui/SKILL.md) |

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

## 实施边界与路线

本次仅冻结规范、迁移文件并建立Skill。共享reducer、新Symbol renderer、Faceplate壳层、Metadata注入、原生控件Prefix写入、服务端保存目标解析/结果回调、Restore出口过滤、Contract持久化验证/打包、报警adapter均未在本次实现。现有六BOOL Widget和只读继承不等于新能力。

| 阶段 | 状态/下一步 | 验收位置 |
| --- | --- | --- |
| A 规范冻结 | 本次完成设计归档；不是运行时交付 | 类型/JSON/向量/静态图/Skill文件检查 |
| B Valve Symbol | 未开始：共享有限状态、许可几何与三布局 | CONTRACT §12、SYMBOL |
| C Valve Faceplate状态 | 未开始：Operation/Configuration与Context | FACEPLATE、CONTRACT §12 |
| D 最小写入 | 未开始：保存写列表、原权限、结果回调、命令禁止恢复 | CONTRACT §6/§10/§12 |
| E 多实例独立读写 | 未开始：不同设备/同设备多窗、关闭/重连/导出兼容 | CONTRACT §12的I/ID/W用例 |
| F 第二Component/生成 | 未开始：真实第二模型、有限profile扩展 | 不虚构Motor或Analog字段，显式更新契约版本 |

后续实现须按原Git workflow独立测试/评审，不自动启动Phase B。浏览器、工业屏幕/触摸、许可几何实际inline隔离、动画销毁、订阅清理、PLC命令帧、旧TRUE在服务重启/重连不恢复、权限与驱动失败、保存导入重启均需运行时验证。静态图/文件路由及现有回归测试不算这些功能已通过。

## 规范变更

普通组件开发只消费本规范。基础状态语义、Contract或全局设计标准的变更必须有明确规范变更任务，更新规范版本及受影响的contract/template/profile/tokens版本、类型、示例、fixtures和兼容性/迁移说明，完成相应检查后评审。旧版本实例固定引用，不自动覆盖；不兼容变更须明确迁移或保留旧实例。仅修正文档笔误且不改变规则时记录修正即可。
