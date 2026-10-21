# SVG资产来源与许可 — v1.0

设备图形统一来自 **FUXA-SVG-Widgets**，不使用FUXA内置Shape。当前设计没有新绘制等效工业符号，只适配已许可几何的呈现层。所有SVG仅供实现参考，无脚本、无实际写入。

- 本地只读库：`D:/Will/Documents/source/repos/FUXA-SVG-Widgets`。
- 远程：[frangoteam/FUXA-SVG-Widgets](https://github.com/frangoteam/FUXA-SVG-Widgets)。
- 选中资产：`Proc. Engineering/Proc. Eng. Valves/25_Gate Valve (Double Acting Cylinder).svg`。
- 库HEAD：`70e7c4a656d111c0428c77eb4b0409fc3670b8d5`；实际源文件SHA-256：`3706a8b63f5481af2f983f526da2cae297f62ba46b78370627aec8e6554f1e82`。
- 已有允许副本：[custom/widgets/valves/NexPlc_Valve.svg](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/custom/widgets/valves/NexPlc_Valve.svg)，本轮读取valveSymbol组；既有Widget未修改。
- 已比较同库01_Gate Valve（无执行器）、03_Ball Valve（球阀）、24_Gate Valve (Single Acting Cylinder)（单作用端口）和25（双端口）。当前保持25，与已有项目一致；不由Extend/Retract推断真实阀型/Open含义。

三条path的d、执行器矩形尺寸与内部transform/拓扑保留；仅改外层统一缩放/平移、主体状态fill和轮廓样式（含non-scaling-stroke）。设备主体等比居中，状态与Label独立。源脚本不执行，旧Widget脚本不覆盖。

MIT License：Copyright (c) 2019-2025 frangoteam info@frangoteam.org。所有含设备几何的SVG均带完整许可；Configuration是自主表单线框。原库、旧Widget、PLC与应用代码未修改，未复制Rockwell商业资产。

| 图 | 语义与边界 |
| --- | --- |
| valve-normal / valve-compact / valve-detailed | 同一Extended+HMI Locked状态的三布局，LOCK不表示Auto/Program |
| valve-alarm-p3 | 同类P3目标样式，3px黄色叠5px深色底描边，提高浅底边界识别度 |
| faceplate-operation | HMIControlAvailable=TRUE，三个按钮单次TRUE；命令已发送是传输提示示例，不代表动作到位 |
| faceplate-configuration | 逐项Save+确认的目标布局，类型检查必需、工程范围可选，不采用组Apply |

演示数据不是现场值或PLC默认值。静态稿体现目标可操作布局，但尚未集成运行时；不能据此宣称Prefix写入已实现。

背景和组合：独立Symbol去掉画布背景rect，局部状态fill/徽章/Label及MIT仍保留；Faceplate保留不透明底。新增valve-hmi-unknown和valve-fault-only仍复用相同Valve25几何。process-background的底色/管线属于组合工艺画面，三个嵌入Symbol用现有SvgUtils.renameIdsInSvg处理ID，并用同一map补全该静态组合的ARIA引用；未修改运行时或新增命名算法。Fault框不含报警生命周期。
