# UI Style Guide v1.0

**[冻结规范] 本文件全部精确数值由 NexFuxa 自定。** 思想依据见本文末参考资料，禁止称为 PlantPAx/ISA 的强制色值或尺寸。机器可读源为 [tokens.json](tokens.json)，文字与该文件冲突时必须显式修订规范版本，不允许渲染器各自选择。

## 1. 视觉原则

状态先于装饰；灰阶为正常基调，鲜明色只强调报警。设备必须能在静态、灰度、色觉差异环境下通过文字/形状辨识。主画面关注工艺，Faceplate 关注操作和诊断。标签、单位、质量及异常不因紧凑布局而失去。对只读用户也要显示被禁止操作的原因，界面不替代 PLC 联锁。

## 2. 主题与 Tokens

| Token | 值 | 用途 |
| --- | --- | --- |
| canvas / surface / surfaceInset | #E6E8EB / #F7F8FA / #EEF0F3 | 工艺背景、Faceplate、分组底色 |
| text / textMuted | #20262E / #56616F | 主信息/次信息；不可用控件保持文字可读 |
| line / lineSubtle | #7B8794 / #C8CDD4 | 设备轮廓、分隔线；后者不独立表达关键信息 |
| live / focus | #304F75 / #245C9F | 实时值/键盘焦点；不代表设备运行或安全 |
| stateIdle / stateActive / transition | #7B8794 / #F7F8FA / #D7E4F0 | 收回/伸出示例填充、过渡底色；真实 open/close 按物理配置映射 |
| fault / quality | #20262E / #56616F | Fault/Conflict 黑底白字；质量灰斜线+文字，避免伪造报警优先级 |
| alarmP1 / alarmP2 | #B4232C / #9B4700 | 紧急/高，白字 |
| alarmP3 / alarmP4 | #E5C100 / #70529B | 中/低，P3 深字、P4 白字 |

P1 最紧急，P4 最低。此命名与 FUXA highhigh/high/low/info 的映射须工程配置，不按名字猜。R1 的紫/黄/橙/红层级是参考，以上更深色值及 P 编号是自主选择。项目报警理念需要同时规定响应时间与操作责任；本规范不替工程进行报警合理化。

字体：`Segoe UI, Microsoft YaHei, Noto Sans CJK SC, Arial, sans-serif`。Caption 12、Symbol Label 14、正文/按钮 16、组标题 18、Header 20、PV 24 CSS px，行高 1.4。Caption 不用于核心状态和危险动作。数值用 tabular-nums；单位与值一起呈现，未知值用 `—` 加原因，不用 0。中英文标签按实际测量宽度布局，禁止以字符数代替像素测量。

间距 4/8/12/16/24/32；基础轮廓 2px，报警色线 3px；P3 另加同路径5px深色底描边（外露约1px），焦点 2px + 2px offset；2–4px 圆角，禁止拟真渐变/高光。按钮高 44px、最小宽 88px、间距 8px；输入高 40px；20px 功能图标、16px 紧凑状态图标。不能用红色普通 Stop 按钮冒充报警或急停。

对比验收目标：正文 4.5:1，核心轮廓与焦点 3:1；这是 NexFuxa 可访问性目标，未宣称完整 WCAG/ISA 认证。disabled 控件用锁/原因表达，不能仅降到无法阅读的透明度。

## 3. 报警生命周期与仲裁

首版没有完整报警适配器时显示 `FAULT`，可画独立静态深色虚线故障强调框，不画假报警框、不显示未配置报警服务错误，不阻止 Valve Symbol/Faceplate 开发。`Error` 不自带 ack。未来 adapter 的 UiAlarm 提供 condition(active/returned/unknown)、acknowledgement、activatedAt/returnedAt/acknowledgedAt/acknowledgedBy、suppression/shelving 元数据及 quality；时间未知为null，服务不支持抑制/搁置时为unsupported，不能冒充inactive。事件按完整实例键显式关联，不按名称包含 V101 猜。

| 报警状态 | 边框与图标 | 文字与动作 |
| --- | --- | --- |
| 无活动、无待确认 | 不绘制报警外框；设备轮廓仍存在 | 不显示“安全/无故障”保证 |
| 活动且待确认 | 实线严重性色外框，叠加 1Hz 强调；图标带 `!` | `P2 ACTIVE · UNACK`；Ack 仅在有权限/有效服务时可用 |
| 活动且已确认 | 实线严重性色外框，无闪烁 | `P2 ACTIVE · ACK`；确认不等于复位 |
| 已恢复但待确认 | 虚线严重性色外框，1Hz 强调；回转箭头 `RTN` | `P2 RETURNED · UNACK`；保留直到确认 |
| 已恢复且已确认 | 移除当前报警外框，保留历史 | 不自动删除审计记录 |
| 报警数据质量坏 | 上次已知报警带 STALE 标签、停止闪烁；质量提示覆盖 | 不推断已恢复；Ack 禁用 |
| Suppressed / Shelved | 不参加普通报警外框/闪烁仲裁，独立 SUP / SHLV 提示和明细 | 已搁置/抑制不等于恢复/确认，保留原活动与确认状态；与设备 BYP 区分 |
| 抑制/搁置状态 unknown | 保留最后已知摘要并标不确定，停止闪烁 | 不推断解除；unsupported 表示服务无能力 |

颜色选择只针对质量有效、未被抑制/搁置的事件：有活动报警时用最高活动严重性；没有活动但有待确认时用最高恢复待确认严重性。并列用未确认优先、最早 activatedAt（未知时间排后）、稳定 id 排序。闪烁条件是**任一有效可显示事件待确认**，与颜色的选择分开；低级报警待确认不能把已确认的高级活动报警外框降级。角标显示被选中的优先级和 `+N` 总数，标题可同时提示 UNACK 数；列表可见每个事件原始状态。故障/通信质量与报警并存，质量异常不抹掉最后已知报警。

只有一层报警强调可闪烁，设备/整屏/文字不得反复消失。1Hz 周期中轮廓始终可见，粗线/光强调变化，不在 50% 时间内隐藏异常。动画关闭、浏览器后台或 prefers-reduced-motion 时用静态 `UNACK`、双轮廓和图标替代；是否启用闪烁是项目设置，不能改变 PLC 状态。

## 4. 图标语义和扩展

图标以单色线条+短词为基础；静态示意用统一徽章表达语义。MAN/LOCK/IL等徽章使用相同高度、字重和对齐，不用颜色暗示安全。长文本 HMI Locked 在 Faceplate 完整显示，Symbol 用 LOCK，Tooltip/可访问名称给出全称。禁止直接复制 Rockwell 字库。正式图标库需版本化、唯一语义、SVG title/accessible name，并经设备操作员辨识验证。相同三角/锁形不得在不同页面表示相反含义。

| 维度 | 默认短词 | 显示条件/互斥性 |
| --- | --- | --- |
| 当前 Valve HMI control | MAN / LOCK | TRUE=MAN（HMI Control），FALSE=LOCK（HMI Locked），未知 HMI ?；常驻，独立于来源，不显示 AUTO* |
| 其他设备 Operation mode | AUTO / MAN | 仅真实模型明确支持时显示；不能套用到当前 Valve |
| Command source | OPR / PRG / EXT / LOC | 支持时常驻一个当前所有者，未知 `SRC ?`；请求来源可多个，当前所有者至多一个。LOC 是已绑定的本地硬件来源，不等于 MAN |
| Interlock | IL | 仅联锁触发时；显示是状态，不提供绕过动作 |
| Permissive | PERM | 仅启动条件不满足时；不可与 IL 混成一个布尔值 |
| Bypass | BYP | 激活时；独立于 Override 和报警抑制 |
| Override | OVR | 激活时；不是 MAN 的别名 |
| Simulation | SIM | 有真实激活反馈时；不能由 SimExtendTime 或无传感器配置推导 |
| Communication / data quality | COM / DATA / TAG ? | 异常常驻，明确设备断线/数据等待/绑定缺失原因 |
| Unknown supported capability | 对应短词 + ? | 功能已配置但数据无效；不可当 false 隐藏 |
| Not supported | 不占槽 | Faceplate Diagnostics 可列“未配置”，不造 Tag、不禁用不存在按钮 |

P3 黄色 #E5C100 与浅底对比不足以单独构成重要边界：必须加 `alarmEdge=#20262E` 的5px底描边，再叠3px黄色线，角标用深字，保留P3文本/形状。其他级别仍用3px色线。设备主体按 geometryBox 居中；报警可见边缘与Label实测文字框至少4px，禁止边框压字。三布局具体Box由Contract统一定义。

排序和溢出规则见 SYMBOL。模式/来源之间不能互相推导，图标和解释 Tooltip 必须支持键盘与触摸详情。

## 5. 动画、响应式与高密度

默认设备不连续旋转或流动。过渡状态可以 1200ms 一次的方向箭头脉动；文本 EXTENDING/RETRACTING 永久可见，**不能根据时间推算连续位置百分比**。只有有真实位置反馈才做对应位移，只有转速/运行反馈才能支持可选旋转。Fault/Conflict或运动所需数据无效时停止设备动画，保留真实维度信息，不“补完”动作；仅H缺失不停止由有效运动反馈驱动的显示。

工艺图使用明确变体，不无限缩小字号。144×152与560×680是参考默认，不限制所有组件只用这个尺寸。中英文正文允许换行；状态词按short/full布局选择，不改变语义。状态与操作区用组标题、分隔线及16px空白区分，设备主状态不用按钮充当。

低于 Compact 的设计尺寸时切换概览点位/报警聚合，由工程定义；完整状态在 Faceplate 可达。建议评审屏幕 1920×1080、1366×768、1024×768，DPR 1/2，浏览器 100%/125%/200%；必须检查点击目标不重叠、标签不被管道遮盖。手机仅用于被批准的监视/操作场景，不能把桌面控制缩成小按钮。

静态参考图使用同一套 Tokens；暗色主题、声音、夜间模式不属于本次首版，后续独立对比度/报警评审。

## 6. 背景与故障强调

Symbol画布默认透明，工艺背景和管线可透过；禁止整块canvas/surface背景rect、根background样式或父Gauge不透明填底。设备主体状态fill、徽章/故障文字局部底色仍保留，不把设备几何全部改成透明线框。Label与管线尽量错位，必要时只给文字区域局部浅色托底，不能恢复整个符号底板。工程画面应使用低饱和普通工艺背景，不能靠鲜艳背景承担状态语义。Faceplate继续不透明surface背景。

Fault-only默认静态2px深色虚线框（4 3），复用alarmBox；与FAULT文字共同强调。它没有严重性、闪烁或ack/RTN生命周期，不显示P1/P2/UNACK。完整报警框可见时替代此外框，Fault维度/文字不消失。Fault未知或设备断线不画实时故障框，最后已知故障仅作明确标记的诊断信息。

位置、运动、Fault、HMI Control各自按依赖判断，缺H只显示HMI ?并禁运动命令，不抹掉有效位置。部分设备数据缺失时标DATA ?，不能把unknown当FALSE或整体正常。

## 7. 设计依据与适用限制

本规范借鉴 High Performance HMI 的低饱和背景、文字/形状冗余、异常强调与状态/操作分区；图标槽、水平Tabs、精确数值及P编号均由NexFuxa确定。未复制Rockwell商业图形或字库，不宣称ISA/WCAG认证。

| 资料 | 阅读范围与用途 |
| --- | --- |
| [PlantPAx Display and Library Guidelines, RM200K, June 2026](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/proces-rm200_-en-p.pdf) | p15–22：来源、报警横幅/Tab及严重性；不能直接映射FUXA事件类型 |
| [Process HMI Style Guide, WP023A, May 2019](https://literature.rockwellautomation.com/idc/groups/literature/documents/wp/proces-wp023_-en-p.pdf) | §8.3、8.6–8.8、9、10：背景、状态和动态显示；指导白皮书，不是ISA全文 |
| [Display Elements, RM014F, April 2023, Library 4.0](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/proces-rm014_-en-p.pdf) | p22–28、32–34、411–422；印刷p411对应PDF p415。Label/质量/报警分层和Faceplate是参考，不规定统一底部图标槽或第二页Configuration |
| [ISA101委员会公开概述](https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa101) | HMI生命周期；未获取付费标准全文，不宣称逐条符合 |

设备有限状态的唯一规范定义见[Contract §3](CONTRACT.md#3-valve-有限状态语义)；本文件只定义显示语言。
