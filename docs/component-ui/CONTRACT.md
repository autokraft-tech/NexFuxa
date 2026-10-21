# Component UI Contract v1.0 — v1.0

状态：**Design Frozen / Runtime Implementation Pending**。`contractVersion/templateVersion=1.0.0`；[类型](contract.ts)、[Valve模板](examples/valve.json)、[两个实例](examples/valve-instances.json)。这些是冻结的设计契约，不是当前FUXA可直接导入的模板包。状态语义以本文§3为准；类型约束以contract.ts为准，示例/fixtures必须满足两者。冲突须显式修订版本，不能由各渲染器任选。


## 1. 五层职责

| 层 | 内容 | 约束 |
| --- | --- | --- |
| PLC 原始值 | Sts/Cmd/Cfg 的真实成员 | 不新增/猜测 PLC 变量 |
| Component 语义 | position/motion/fault/conflict/hmiControl | 一个有限、版本化 reducer，Symbol/Faceplate 共用 |
| UI 显示 | 文本/Token/图标/可选 alarmSummary | 布局不改变设备语义；按钮不得改变实时状态 |
| 控制/配置写入 | command 固定 TRUE、parameter 确认后的实际值 | PLC 决定是否执行；返回结果只表示写请求结果 |
| Metadata/Layout | Label/Description、物理映射、单位/可选范围、尺寸变体 | 不从 Label 推断数组索引、从字段名推断 Auto/Program |

AI 输入为真实 Model + 有限语义 profile + 许可资产/工程 Metadata。结构类型不足以推出物理 Open/Close、报警生命周期或不存在的模式控制；信息不完整时保留 unspecified/unsupported，而非编造字段。

## 2. 精简契约字段

| 字段 | 含义与类型边界 |
| --- | --- |
| contractVersion/templateId/templateVersion | 契约语言/稳定模板名/版本，独立于 Model schemaVersion |
| modelRef | name/version/rootType/sourceCommit；结构来源，不代表在线下载版本 |
| shape | geometry 来源 asset/id/provenance，**不执行旧 SVG script** |
| layouts | defaultVariant + compact/standard/detailed 三个纯布局对象，见 SYMBOL |
| signals | 真实 member、tagNameTemplate、plcType、runtimeType、access、requiredForStatus |
| semantics | kind=nexplcValveSixBool、profileId/version、六输入映射、设备完整性清单required、分维度qualityPolicy、hmiControl 字典 |
| stateDisplay | 每个 PrimaryState 的 full/short 文本、Token、marker、motion |
| commands | signal、固定 TRUE、requiresHmiControl、enabled/capability、沿用项目权限、可选确认 |
| parameters | signal、分组/标签/单位、可选工程范围、类型由 signal 提供、每项保存并确认、writable |
| writeAdapter | 显式 opt-in，仅 commands(enabled+supported) 与 writable parameters；不是开放旧 postValue |
| alarms | none 或显式关联的 fuxaAlarmEvents；none 不阻止 Valve 开发 |
| icons/processValues/faceplate | 能力清单、真实数值、有限 Tab 条件 |
| binding/upgrade | 精确解析、失效不回退；锁定版本、显式迁移、旧模板保留 |

不支持通用Expr、动作完成事务、统一风险审批、groupApply或共享写队列。首版没有通用 DSL，也没有 PLC Command ID/ACK。

<a id="valve-state"></a>

## 3. Valve 有限状态语义

**[已确认的PLC行为]** Extend/Retract 仅在 HMIControlAvailable 时处理，随后每周期无条件清零；Reset 独立处理并清零。无需修改 PLC，无需 HMI 写 FALSE/定时脉冲/自动重试。`Sts.IsManualMode` 等于 HMIControlAvailable。

| 输入 | 共享 hmiControl | Symbol | Faceplate | Extend/Retract | Reset |
| --- | --- | --- | --- | --- | --- |
| 有效 TRUE | available | MAN | HMI Control | 满足目标绑定/连接/项目权限时可发 | 与该位无关 |
| 有效 FALSE | locked | LOCK | HMI Locked | 禁用 | 与该位无关 |
| 未知/无效 | unknown | HMI ? | HMI Control unknown | 禁用 | 不因该位未知而单独禁止；仍需自己的有效绑定/连接/权限 |

LOCK 是 HMI Locked 的紧凑标签，不是另一种设备模式。没有 Auto/Program/Operator 推导，没有 Auto/Manual 切换命令。旧 Widget 的 AUTO/MANUAL 脚本不改；新模板使用新语义版本，不能把旧文案当新事实。

有限 reducer 规则固定在 profile 实现，不由 JSON 执行表达式：

- position：E&R→conflict，E→extended，R→retracted，否则 unknown；必要输入无效则 unknown。
- motion：Eg&Rg→conflict，Eg→extending，Rg→retracting，否则 stopped；必要输入无效则 unknown。
- fault=有效 Error，否则 null；conflict 表示双端位或双运动，未知输入保留 null，不补 false。
- hmiControl 按上表；与 position/motion/fault 独立保存。
- Device/传输明确断线时主状态COMM_LOST，各维度均不得作为实时值；绑定/坏值/超龄仅失效其依赖维度，不一律抹掉整个设备。
- 在线时优先显示已知Fault→已知Conflict→已知运动→已知位置；没有可显示的Fault/Conflict/运动/端位结果且设备数据不齐时，设备绑定错误用BINDING_ERROR、明确超龄用STALE、其余缺值用WAITING；设备维度齐备且都未定位时才为UNKNOWN。
- position只依赖E/R，motion只依赖Eg/Rg，fault只依赖F，hmiControl只依赖H。某对任一值缺失则该对输出unknown；conflict为任一有效对已证实双TRUE则true，两对都有效且无冲突则false，否则null。未知故障不视为false。
- primary能显示已知EXTENDED且fault/motion未知时，必须同时标DATA ?及缺失维度，不称为整体正常；Faceplate完整保留有效端位。仅H缺失时设备primary与设备quality不变，控制徽章为HMI ?，禁Extend/Retract；Reset独立。

新profile采用分维度判定，采用分维度有效性。`required`仅列五个设备状态输入，用于设备完整性提示；`requiredForStatus`也只标记该用途，不表示全局渲染前置。H不在此清单。设备部分有效时quality.status=partial，未知维度明确标注；H独缺只影响控制徽章，不把有效设备状态改成WAITING。无效维度的旧值只能标“最后已知/非实时”。旧已保存六BOOL Widget保持原实现，不自动迁移。E 与 Rg 重叠等过渡组合按移动优先，不新增猜测的 PLC Conflict 字段。两 renderer 消费同一个 RuntimeSnapshot 的 semantic/primary/display/icons。Layout 仅选 full/short 文本，不重算状态。

现有断线失效可复用，重连按各维度重新收齐必要反馈；逐字段 freshness 仅在实际数据提供时使用，不要求首版建立 epoch/一致快照服务。未实现年龄校验应如实说明，不虚构时间戳。首版 reducer 只接受规范 BOOL/当前兼容归一值，无效输入保持未知。第二 Component 验证后增加另一个有限 profile union，不能为预期所有设备先造表达式引擎。

## 4. 三布局与实例选择

`shape` 只指向一份几何；`layouts.variants` 定义三套 viewBox、geometry/status/icon/label/alarm Box、槽数及文字长度策略。三套布局共享同一个 semantics 和 stateDisplay，禁止复制三份状态模板。

选择顺序：当前保存 Gauge 的展示配置 `layout.symbolVariant`（若有）→ `ComponentUiInstance.layout.symbolVariant` → `layouts.defaultVariant`。未指定用 standard；未知值报配置错误，不猜。首版不自动根据数据状态切换布局。若工程按缩放级别切换，必须在项目展示设置中显式配置，并保持实例/订阅/数据不变。

尺寸、位置、方向、图标容量、截断及 full/short 都属 Layout/Metadata；依赖/设备完整性清单、状态优先级、命令写值及控制允许位属于 Component 语义。布局变体不进入 PLC 实例键，两个不同尺寸的图形可以观察同一设备。

## 5. Binding 与真实命名

**[源码确认]** `WidgetBindingResolver` 精确 device.id+tag.name 查询，不创建 Tag/按 ADS 地址猜。Faceplate 复用 `faceplateBinding={deviceId,parameters:{'#1':...}}`；继承到运行副本，禁止写回共享定义。Manual/Fixed/Inherit 优先级保持原样，缺失/歧义/类型错清旧 ID/default，不回退。

| 项目 | V101 | V102 |
| --- | --- | --- |
| 实际 GVL 根/索引 | GVL.g_aValve_HMI[1,1] | GVL.g_aValve_HMI[1,2] |
| Phase 3A #1 | V101 | V102 |
| 状态 Tag 示例 | V101_sts_extended | V102_sts_extended |
| 命令 Tag 示例 | V101_cmd_extend | V102_cmd_extend |
| 配置 Tag 示例 | V101_cfg_extend_time_out | V102_cfg_extend_time_out |

JSON 的 deviceId `d_b6ba9d1c-2b054dc3` 来自仓库 CSV，必须匹配当前项目已有 Device，不是已验证的在线设备。v2 Generator 默认把索引拼入名称；tagPrefix=V101、indices=[1,1] 产生 `V101_1_1_sts_extended`，则 #1=V101_1_1。只有批准 namingTemplate/Preview 后才可使用不含索引的命名；不改现有 Tag 名/ID。

UI signal 与 Widget export 并非同名：Sts.Extended→已有 `_pb_extended`，Sts.IsManualMode→`_pb_isManualMode`。原 Widget 只有六读参数，不能把20成员强塞进去。新原生按钮/输入 adapter 可为 resolver 提供受控 synthetic WidgetPropertyVariable 声明（originalName=write slot、type=boolean/number）；使用相同 profile 模板和 resolve 结果，不扩充旧 Widget exports。配置读值与写目标同名成员，用同一解析计划。

<a id="prefix-write-adapter"></a>

## 6. 最小 Prefix/Inherit 写入适配方案（冻结设计，未实现）

### 6.1 现状与选型

**[源码确认]** `HtmlImageComponent.bindEvents()` 对 Prefix/Inherit 不注册 postValue。`GaugesManager.putEvent/putSignalValue` 通往 `HmiService.putSignalValue`；后者乐观改本地缓存并发送 DEVICE_VALUES 的 set。`server/runtime/index.js` 检查 socket 写权限后直接调用 setDeviceValue，未等待/逐次返回成功。`devices/index.js` 可 await 驱动，但无 active device 时不报结果；ADS `setValue` 捕获异常仅日志，断线/缺 Tag 也不回失败。现状无法兑现“写入中/成功/失败”三种可靠结果。

**[设计建议]** 首版优先给新 Faceplate 的原生按钮/输入增加显式写入适配；仍复用原有解析器、Context、Socket、项目权限和 ADS 连接。保留 HtmlImage 的所有旧 guard，**不**给全部 Prefix Widget 注册 postValue。以后若需要 SVG 交互，仅在相同显式写列表规则下另增 opt-in，不是首版前置。

### 6.2 保存配置与运行解析

模板 commands 与 writable parameters 编译成目标控件的**保存写入列表**（writeKey→signal/profile expression/PLC type/constant或input value）。只读旧控件没有列表，永远走原路径。新按钮/输入只提交 writeKey 和明确用户确认值；不能接收任意 Tag ID、地址、Device、Prefix 或执行函数。

前端从本窗口冻结 Context 复用 resolver，确认目标与当前实例一致；但前端解析结果不当服务端信任依据。`PrefixWriteRequest` 仅有 source/target 的保存 View/Gauge definition IDs、writeKey、value。DOM `__view_instance` 后缀不是保存 ID。Context 同时保留打开该 Faceplate 的源 Symbol 保存引用；无引用不允许使用新写入口。

服务端按请求的 source 引用读取**保存的源 Symbol**，校验其原项目权限；由其已保存 prefixBinding 得到可信 deviceId/parameters，并验证该源配置的 Open Faceplate 目标正是 target View。然后读取保存目标控件的 opt-in 写列表及原项目权限；根据 Fixed/Inherit 优先级取目标固定上下文或源上下文，再以相同 WidgetBindingResolver.resolve 算法精确查找 Tag。先比较写列表/类型/常量或参数约束，后调用现有 devices.setDeviceValue。

服务端复用纯 resolver 时可将其现有算法提取为客户端/服务端共用的小模块；维持 `WidgetBindingResolver` 对外接口和旧测试，不复制一套宽松查找器。无 ADS 地址回退、无新 Tag、无任意客户端 Tag ID。首次范围限定**保存的固定 Prefix 源 Symbol→直接打开的继承 Faceplate**；现有嵌套 Faceplate 只读继承不变。嵌套可写若有实际需求，再扩展可验证的保存来源链，不默许客户端自报上下文。

### 6.3 权限与写结果

沿用项目已有 permission/permissionRoles 及 socket 登录规则，无新角色系统。新入口在服务端对保存源/目标控件按现有 `runtime.checkPermission` 语义检查 show/enabled；不以 UI disabled 替代服务端检查。现有通用 set 的鉴权主要是 socket 层，不宣称它已有逐控件 allowlist。新入口只限制自己的目标列表，不能声称已堵住所有旧任意 set 路径。

在同一 DEVICE_VALUES 通路增加专用显式 message kind（例如 component-write，消息名在实施时确定），使用一次 Socket 回调返回 `PrefixWriteResult`。成功必须等待 ADS `writeValue` 完成；失败含驱动异常、缺 Device/Tag、断线、权限/绑定/类型错误。最小后端补充是让 devices/ADS 的这条调用链返回明确结果或传播错误；旧调用者保留既有行为与日志，不改变旧写动作。前端新适配器不使用旧乐观缓存替代 PLC 反馈。

这是**传输结果回调，不是 PLC ACK/Command ID**。不需要队列、持久事务、动作完成观察器或控制权仲裁。等待回调时本控件只显示“写入中”并防止本次双击；回调成功“命令已发送”或“写入成功”，失败显示原因。连接丢失/回调缺失时按普通网络请求等待超时提示“写入结果未确认”，可归入写入失败提示区；可能已送达，绝不自动重试。发送前必须确认当前socket已连接；新入口不进入离线缓冲，也不启用Socket自动重试，断线时丢弃未发送意图。重连/重开不重放请求。

Extend/Retract 的本地禁用条件只增加真实 hmiControlAvailable=false/unknown；不额外根据 Fault/Conflict 构造 PLC 仲裁，实际动作条件仍由 PLC 负责。Reset 不受该位限制；其自身连接、准确目标与项目权限仍要满足，不能额外要求整个snapshot.quality=good。配置项同样只做显式保存、类型/可选范围校验及现有权限。写入和 Sts 更新是两条独立数据流。

### 6.4 最小修改范围（后续）

| 模块 | 必要增量 |
| --- | --- |
| _helpers/widget-binding.ts / 小型共用解析模块 | 复用纯解析入口，支持 native control 的受控变量声明，旧 API/规则不改 |
| fuxa-view.component.ts / 原生按钮、HtmlInput adapter | 运行副本继承、保存来源引用、显式 click/save intent；不复用 onchange自动写 |
| hmi.service.ts | 新 opt-in 写方法和单次结果回调，不乐观改 Sts |
| server/runtime/index.js | 专用分支，保存配置重新解析、原权限检查、等待结果 |
| server/runtime/devices/index.js 与 adsclient/index.js | 返回实际写入完成/失败、缺设备/断线不能假成功 |
| 编辑器属性/保存结构 | 新控制可见的 opt-in 写列表；旧 Widget 不自动增加写能力 |

没有独立 Command Gateway 服务、新通信连接、PLC 更改或复杂权限扩展；上述只是不可省略的准确目标和写结果边界。具体代码由后续Phase D独立实现PR完成。

## 7. Commands 与 Configuration 示例解释

完整 JSON 有 9 Sts、4 Cmd、7 Cfg。Extend/Retract/Reset enabled=true，write.value=true；前两项 requiresHmiControl=true，Reset=false。LifetimeReset 仍保留真实声明但 capability=unverified、enabled=false，不要求修改 PLC，也不阻止三个核心命令。命令不再有 completion/PLC超时配置。

七配置项均设计为 writable=true、explicitItemSave+confirm；缺工程范围不强制只读。PLC 类型检查必需：BOOL；整数有对应位宽/符号；浮点有有限性及 REAL/LREAL 可表示范围。工程 min/max 为可选、提供则必须执行。默认值 null 不写0；刷新/失焦/切页不写。STRING/ENUM 是后续类型能力，实际可写前需明确编码/长度或枚举表，不发明未知值。

Cfg.MaxLifeTimeCount 可以保存该真实成员的值，但当前 FB 寿命行为未核实，不能承诺其运行效果；LifetimeReset 的禁用与参数保存是不同问题。Sim*Time 不代表仿真模式已启用。写成功只表示驱动写入完成，正常订阅读回可继续显示实际值；不要求首版做强制读回事务、比对容差审批或批次回滚。

## 8. 可选报警扩展

首版 adapter=none，显示 Error 的 Fault 与 Conflict，Fault可有独立静态深色虚线强调框，无 Ack/报警角标，不把未配置桥接当故障。UiAlarm 是未来归一接口，**不要求首版实现**。condition 为 active/returned/unknown，acknowledgement 为 unacknowledged/acknowledged/notRequired/unknown；返回与确认互相独立。activatedAt/returnedAt/acknowledgedAt/acknowledgedBy 可空，空表示来源未知，不编造时间。

suppression/shelving 分别有 active/inactive/unsupported/unknown；携带 since/reason，shelving 另有 until/by。unsupported 不等于已确认未抑制，unknown 不允许显示为正常；shelved 到期由报警服务确定，UI 不自行恢复。Quality 独立于生命周期；坏质量保留最后已知事件并加 STALE。

FUXA 当前模型可提供 ontime/offtime/acktime/toack 等，但 suppress/shelve 未证实，adapter 应报告 unsupported。按实例键索引 AlarmAssociation.instances，缺条目无回退。抑制/搁置事件不参加一般报警边框/闪烁仲裁，仍在状态指示/明细可达；unknown 时保留最后摘要且标不确定，不静默清除。Alarm bridge 是独立后续任务，不能阻塞 Valve UI。

## 9. 版本与 AI 生成边界

规范与设计接口现冻结为v1.0 / 1.0.0，模板、实例、profile与Tokens版本同步。冻结并不触发运行时升级；变更流程见[README](README.md)。现有运行 Widget/Faceplate 不迁移、不覆盖；正式持久化仍需在实施 PR 验证保存/导入/重启，不能把当前可保存 GENERAL 键视为全功能支持。

AI 只能引用实际叶子和有限 profile；不生成 JavaScript/Expr、不发明 Sts.Interlock/Cmd.SetManual、不借 UI Layout 添加 PLC 能力。三布局共模板、实例参数精确绑定、写目标从保存列表获得、未支持能力隐藏。后续第二组件以真实代码加入有限语义类型，不为未来通用性先开发引擎。

## 10. 呈现、恢复与实例边界

### 透明与Fault-only

layouts.symbolBackground=transparent，不绘制画布大小背景rect或通过父Gauge样式填底；保留设备状态fill、文字/徽章局部底色、Label和异常指示。Faceplate背景opaque。普通工艺管线由画面拥有，不能为了衬底在Symbol中重绘管道或加不透明整块底色。

faultEmphasis=staticDashedWhenNoAlarmBorder复用现有alarmBox作为几何区域，不新增告警事件：有效实时Fault=true且没有可见完整报警框时，画2px深色虚线（4 3），保留FAULT文字。Fault=false/unknown/断线时不画实时Fault框，旧值可在诊断标最后已知。没有priority、ack、UNACK、RTN、闪烁或历史事件；PLC Reset是命令，不是确认此框。若完整报警框可见，优先只画报警框，Fault文字/维度仍保留，避免双框混淆。

### 一次性Command的持久化边界

Command.write.delivery=onlineOnceNoRestore明确禁止HMI Restore、离线缓存、重连补发、自动重试，覆盖本模板四个Cmd声明（包括未启用LifetimeReset），不改变逐项Cfg Save规则。命令Tag默认推荐daq.enabled=false、changed=false、restored=false；其中restored=false是必须条件。enabled/changed只控制历史采集，项目已有明确采集用途时不因它们为true就额外禁止命令，但历史数据绝不能作为命令恢复/离线写入来源。已有Tag不能静默修改；restored=true时Preview/设计验证报告错误，实施时显式修正配置后启用新命令路径。不创建/重命名Tag。

源码证据：`device-utils.js:10`中Save if changed控制DAQ保存时机，本身不直接写PLC；restored=true时即使enabled=false仍可能保存。`storage/sqlite/index.js:194`将restored值写入currentstorage；`devices/device.js:185/438`在connect成功后restoreValues并调用setValue；`storage/sqlite/currentstorage.js:78`按Device取出历史行，不按当前Tag的restored开关过滤。因此仅清除浏览器缓存、仅禁changed或仅切restored=false，都不能证明旧TRUE永不重放。

后续Phase D须在现有restoreValues写出前核对当前Tag配置，并排除保存Contract声明的一次性Cmd目标；历史currentValues中有TRUE也必须跳过，不能经普通setValue绕过新写adapter。复用已解析命令目标清单，不增加持久队列/新命令系统；无需清空整个数据库，也不能依赖用户手工删除历史记录作为唯一保护。Tag配置检查用于阻止错误新写入口，restore路径过滤用于阻止旧记录，两者分工不同。本规范冻结阶段不改数据库/运行代码，不能宣称已具备此保护。

### SVG实例ID规则

见 [Symbol实例隔离规则](SYMBOL.md#svg-instance-isolation)。复用SvgUtils.renameIdsInSvg、HtmlImage每实例svgGuid/wModule和ViewRuntimeContext，不另造ID注册中心。保存的是模板/定义ID，运行时DOM ID绝不作PLC实例键或写请求定义ID。静态SVG独立img展示与运行时内联是不同场景；未完成实例化的原始SVG不能直接多次inline后宣称隔离。

## 11. 真实PLC结构与现有能力边界

结构来源：`D:/Will/Documents/source/repos/NexPlc/MySPT_Machine/MainPLC/03_POUs/02_Components/Valves/`，`01_DUT/ST_Valve_HMI/`下Command/Status/Config；FB在`02_FB/FB_Valve.TcPOU`。Model.sourceCommit保留结构提取来源04b27f25dce1b1be335c5f51f539496f195e3708；冻结核对时NexPlc HEAD为11be33e3e37bc0076fc62069571252dee4349dfe。在线下载版本未验证；动作清零及HMI控制行为采用已确认PLC约定，不要求修改PLC。

| 组 | 实际成员及PLC类型 |
| --- | --- |
| Cmd（4） | BOOL Extend / Retract / Reset / LifetimeReset |
| Sts（9） | BOOL Extended / Retracted / Extending / Retracting / Error / IsManualMode；LREAL ExtendTime / RetractTime；UDINT CurrentLifetimeCount |
| Cfg（7） | BOOL HaveExtendedSensor / HaveRetractedSensor；LREAL ExtendTimeOut / RetractTimeOut / SimExtendTime / SimRetractTime；UDINT MaxLifeTimeCount |

Have*Sensor为false时端位可由计时产生；Sim*Time不表示Simulation active。时间ET/1000和配置转换表明单位为秒，但`LREAL_TO_TIME(...)*1000`的小数舍入/现场范围需验证，不阻塞基本UI。CurrentLifetimeCount更新、LifetimeReset消费和MaxLifeTimeCount运行效果未证实；保持LifetimeReset禁用，MaxLifeTimeCount可按类型逐项保存但不承诺运行效果。Error不携带完整事件明细。没有Interlock、Permissive、Bypass、Override、Simulation激活或命令来源字段，不得补造。GVL数组[1,1]/[1,2]是真实根，引用别名V101_HMI不证明ADS可读。

源码基线：NexFuxa cb4ccd9cf4ab47044c6bd8a6e40c4e7032a73440。实施前按当前代码复核以下事实，不能把设计接口当成已有能力：

| 位置 | 已有机制与限制 |
| --- | --- |
| [WidgetBindingResolver](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/client/src/app/_helpers/widget-binding.ts) | 精确Device+Tag；number接受生成器归一的数值，不保证直接导入uint/udint/lreal名称可用。缺失清ID/default，不能自动建Tag |
| [SvgUtils](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/client/src/app/_helpers/svg-utils.ts) / [HtmlImage](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/client/src/app/gauges/controls/html-image/html-image.component.ts) | export-start/end、ID映射、window模块；不是任意脚本沙箱。旧Valve六BOOL读接口，Prefix/Inherit禁止postValue |
| [ViewRuntimeContext](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/client/src/app/_helpers/view-runtime-context.ts) / [FuxaView](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/client/src/app/fuxa-view/fuxa-view.component.ts) | 运行副本、冻结Context、独立窗口/订阅owner；普通Output/Input/Shape尚无相同Inherit能力，不能把计划当实现。_ps_label仍为静态文字，Metadata注入待实现 |
| [HmiService](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/client/src/app/_services/hmi.service.ts) | owner订阅并集；旧set乐观缓存无逐次驱动回调。新写结果与Sts分开，不能复用缓存假成功 |
| [generator.cjs](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/tools/plc-device-model/generator.cjs) / [model.cjs](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/tools/plc-device-model/model.cjs) | legacy v1 Valve和generic v2；ADS、每批最多500候选、1–2维数组；Preview/Apply冲突检查与现有ID复用。不验证在线符号；ENUM非原生通用类型 |
| [project/index.js](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/server/runtime/project/index.js) | GENERAL保存plcDeviceModelInstances / plcTagGeneratorConfigurations / plcTagGeneratorModels；VIEWS保存View/SVG/items。不等于新Contract验证、迁移、资源打包已实现 |
| [alarm.ts](https://github.com/autokraft-tech/NexFuxa/blob/nexfuxa/client/src/app/_models/alarm.ts) | 现有事件时间/确认及类型；Component显式关联、P映射、suppression/shelving仍需adapter，不能猜测 |

## 12. 必须覆盖的后续验收

[64组完整BOOL向量](fixtures/valve-states.json)、[7组缺值向量](fixtures/valve-partial-data.json)和[多实例数据](examples/valve-instances.json)是设计预期，不是新reducer执行记录。它们不得因文件迁移删减。

| ID | 场景 | 必须观察的结果 | 当前证据/后续 |
| --- | --- | --- | --- |
| S01 | 六BOOL全部有效的64组合 | Fault→Conflict→运动→端位→Unknown，独立维度不丢，HMI控制轴不推导Auto | D向量；T/F新reducer与两UI |
| S02 | H=TRUE/FALSE/未知 | MAN或HMI Control / LOCK或HMI Locked / HMI ?；false/未知禁运动，不用该位限制Reset | 用户确认+D；T/F |
| S03 | 分别缺E/R、Eg/Rg、F或H | 只失效依赖维度；缺H仍显示有效位置并禁运动，Reset独立；不把旧值作live | D分维度profile；T/F |
| S04 | 断线重连且反馈值相同 | 失效后各维度收齐必要值才恢复，关闭A不影响B | S既有机制；T/F |
| S05 | 缺Device/Tag、歧义、错类型 | 清旧ID/default，不借另一个实例，相关控件不可写 | S resolver；T/F |
| S06 | 数据源明确提供超龄信息 | STALE，不编造实时；没有age能力不要求新服务 | D可选；T/F |
| W01 | TRUE且按Extend/Retract | 只写相应命令一次TRUE，无FALSE/自动重试 | 用户PLC行为+D；T记录帧/F |
| W02 | FALSE时运动与Reset | 运动禁用；Reset自身目标/连接/权限允许时单次TRUE | D；T/F |
| W03 | Fault或Conflict且按Reset | 不借Fault锁Reset；反馈只由Sts改变 | D；T/F |
| W04 | 驱动成功但Sts未动 | 只显示命令已发送，不显示已到位/PLC ACK | S现状缺结果，D目标；T/F |
| W05 | 驱动异常/断线/缺目标/权限拒绝/回调丢失 | 明确失败或结果未确认，不伪成功、不重发 | D；T/F |
| W06 | 修改请求Tag ID/地址/Prefix或未声明writeKey | 新入口不接受这些任意目标；保存列表/关系/原项目权限生效 | D；T服务端验证 |
| W07 | 双击/另窗口操作/关闭窗口 | 本控件防本次双击；无全局队列/跨窗锁；不撤销/重放PLC请求 | D；T/F |
| P01 | BOOL选择/数值输入、订阅刷新、失焦 | 只本地编辑，不产生写帧；确认Save才写一次 | D；T/F |
| P02 | UINT负值、整数小数/越位宽、NaN/Infinity、超浮点可表示范围 | 类型检查阻止写；有工程min/max也校验 | D；T/F |
| P03 | 无工程范围/默认值/读回容差 | 合法PLC类型可逐项保存；不因为缺审批机制一律只读 | D；T/F |
| P04 | 本行保存失败 | 保留输入与失败原因，无批次/自动回滚/自动重试 | D；T/F |
| P05 | 相同实例不同窗口改同参数 | 各自编辑，无共享草稿/控制仲裁；实际值按PLC订阅展示 | D；T/F |
| I01 | V101/V102同Faceplate、Mapping空 | 读/命令/七Cfg精确命中各自实例 | S只读，D写入；T/F |
| I02 | 不同PLC相同Prefix、不同布局同设备 | 完整deviceId+参数键隔离；布局不改实例键/目标 | D；T/F |
| I03 | Dialog/Card、关闭A/嵌套只读、lazy晚回 | 保留Phase4B.2所有权/清理，不影响B，不复活关闭实例 | S；T/F |
| I04 | 保存/导出/重启/重导入 | 配置/版本/许可保留，runtime值和未发输入不入共享定义，Tag ID不改 | S部分持久化；T/F新配置 |
| U01 | compact/standard/detailed | 同输入同profile同状态/控制语义，仅Box/短文案/槽数不同 | D+静态图；T/F |
| U02 | P3浅底、Label、长中英文、状态/按钮区域 | 深色底描边可辨、可见边框距Label≥4px、文字不叠加 | D静态检查；F真实分辨率 |
| R01 | 旧Widget、Manual/Fixed/Inherit、Variables Mapping | 旧只读不新增写能力、原优先级不变、不覆盖脚本/模板 | S；T/F回归 |


| ID | 场景 | 验收要求 | 修改位置（后续） |
| --- | --- | --- | --- |
| U03 | 普通浅灰/灰工艺背景、管线穿过Symbol bbox | 根画布透明，设备/状态/Label仍可读；Faceplate不透明；三尺寸无整块底板 | 新Symbol呈现，不能覆盖旧Widget |
| V14 | E/R/Eg/Rg/F有效，H缺值/坏值/缺Tag | EXTENDED等有效状态不变；HMI ?、禁Extend/Retract；Reset按自己的有效目标/连接/权限 | 有限profile，不改旧Widget门控 |
| V15 | 分别缺位置对、运动对或Fault | 其他有效维度仍显示；DATA ?提示未知，不补false、不声称整体正常 | 同一snapshot供两UI |
| F01 | adapter=none，Fault true→false，或Fault失效/断线 | 静态深色虚线框只在有效true时出现，无P级/UNACK/Ack/RTN/闪烁；与完整报警框不双画 | 复用alarmBox的Fault样式 |
| ID01 | 同模板3实例、同设备双窗、两个Faceplate | DOM IDs/module keys唯一，defs/use/ARIA引用在本实例内；更新/动画不串值 | 复用renameIdsInSvg与ViewRuntimeContext |
| ID02 | 重初始化/关闭A后B更新、重开A | 不累积后缀/定时器；无全局selector或共享动画状态；B不被清理 | 模块destroy与既有owner |
| W08 | Command Tag Save if changed / To restore设错 | restored=true时新命令路径报告错误、不静默改Tag；默认三项false，enabled/changed若仅用于历史采集不自行导致写PLC | 新写目标校验，沿用解析计划 |
| W09 | 历史currentValues保存Cmd=TRUE，之后关To restore，设备重连/服务重启 | restoreValues写出前排除一次性Cmd且核对当前配置；不补写TRUE或FALSE、不靠清库 | 现有device.js restore路径，不能只检查新adapter |
| W10 | 已离线点击、提交中断线、重连/刷新/重开窗口 | 未发意图不缓冲；结果不明不重试；连接恢复不重放；Sts照常刷新 | 既有socket的新显式入口 |
