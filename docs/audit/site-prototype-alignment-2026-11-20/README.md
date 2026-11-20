# 全站页面 × 2026-11-19 改版原型 · 对齐检查

日期：2026-11-20　范围：43 条路由（页面 + 页签）　对照：`内部资料/uiux-review-20261118/原型-2026-11-19/全站改版原型.html`

## 结论

- 壳层（侧栏、顶栏、面包屑、页头、主按钮、卡片）**全站一致**：H1 统一 19/700，副标 11.5，主按钮 32/12.5/600/r8，卡片 r11 + `#E4E7EC` 边框，43 条路由 0 横向溢出。
- 本轮统一了 6 类可见偏差：我的工作工具栏与筛选片、卡片式工具条高度（44→48）、表格列头规格（36–38/12/600–650 → 34/11/550）、影响链分段控件选中态、投入结构/逾期页的裸筛选条、以及一个跨页副标题被覆盖的时序缺陷。
- 仍有 8 处**能力或交互结构**差异（不是样式漂移），列为「有意保留」，未改动；剩余 3 项打磨项列为残留。

## 方法与判据

- 工具：`tools/e2e/site-consistency-audit.mjs`。真 Chrome 1440×900，登录后逐页、逐页签读取计算样式并截图；产物 `metrics.json` 与 `shots/<route>-1440.png`。
- 判据全部来自原型 CSS：`.toolbar`（48 / 7 9 / r11）、`.sel`（30 / r7 / 12）、`.subtabs`（30 容器 / 24 项 / r6）、`.seg`（30 / 26 按钮 / r7+5）、`.tbl th`（34 / #F9FAFB / 11 / 550 / text-3）、页头 19/700 + 11.5、侧栏 216、导航项 31/12.5/r7。
- 我的工作页对照已批准的 `docs/audit/my-work-redesign-2026-11-20/prototype.html`，并套用全站壳层令牌。

## 全站基线（改造后实测）

| 元素 | 原型 | 站点实测（43 路由） | 结论 |
|---|---|---|---|
| 页头 H1 / 副标 | 19 / 700，11.5 | 全部 19/700、11.5 | 一致 |
| 主按钮 | 32 / 12.5 / 600 / r8，`#2563EB` | 全部 32/12.5/r8 | 一致 |
| 卡片 | r11，`#E4E7EC` 边框 | r11，`#E4E7EC` | 一致 |
| 工具条卡片 | 48 / 7 9 / r11 | 24 处 48（其中 12 处两行卡 `11px 11px 0 0`）；1 处 86（分支两行整卡）；3 处 36 为页头快照/报表行（见 R1/R3） | 一致（例外见残留） |
| 筛选控件 | 30 / r7 / 12 | 我的工作 30/r7、全站 `.sel/.chip` 30/r7 | 一致（本轮统一） |
| 分段控件 | 30 / 26 / r7+5 | `.seg` 30/26/r7+5；影响链 mini 24（原型 `.seg.sm` 24） | 一致 |
| 表格列头 | 34 / #F9FAFB / 11 / 550 | 5 张表 34/11/550；1 张交互矩阵 33/13（R2） | 一致（本轮统一） |
| 子导航 pill | 30 容器 / 24 项 | `.subnav` 30/24 | 一致 |
| 侧栏 / 导航项 | 216 / 31 / 12.5 / r7 | 216 / 31 / 12.5 / r7，选中 `#EFF4FF` + `#1D4ED8` | 一致 |
| 横向溢出 | 0 | 43 路由全部 0 | 一致 |

## 本轮统一（U1–U7）

| ID | 位置 | 证据（改前 → 改后） | 改动 |
|---|---|---|---|
| U1 | `frontend/css/my-work.css:61` | 工具条裸条 34 → 48 卡片（r11、`--surface`、`#E4E7EC`） | `.mw-toolbar` 对齐原型 `.toolbar` |
| U2 | `frontend/css/my-work.css:71` | 筛选片 28 / r999 / 实心蓝 11.5 → 30 / r7 / 12，选中 `--primary-soft` + `--primary-fg` + `--primary-border` | `.mw-chip` 对齐全站 `.chip` 与原型 `.sel.on` |
| U3 | `frontend/css/my-work.css:28-36` | 页签选中用 `--text` → `--primary-fg`；搜索、弹层、图标按钮 6 → 7px | 页签与控件圆角/文字色收敛 |
| U4 | `frontend/css/layout.css:200-222`、`views-analysis-branches.css:1078` | chain / review / requirements / branches / phase / delivery / calendar 工具条 44/6 9 → 48/7 9；gantt 顶行 48；tree 次行 40 → 44；报表 `.analysis-bar` 44/6 9 → 48/7 9 | 卡片工具条统一到原型高度 |
| U5 | `frontend/css/tokens.css:14-15`（深色 `:181`）、`manager.css:108`、`views-projects-settings.css:727`、`views-phase-demands.css:175`、`views-drawer-blocks.css:435` | 表头 36–38 / 12 / 600–650 / sunken / `--head-border` → 34 / 11 / 550 / `--text-3` / `#F9FAFB` / `--border`；新增 `--tbl-head`（深色 `#1A222D`），列表/树列头同步引用 | 表格列头对齐原型 `.tbl th` |
| U6 | `frontend/css/views-workitems.css`（删除 `#chainDir button.on` 覆盖） | 影响链方向切换选中态 soft-blue → `.seg` 白底 + 阴影（与全站、原型一致） | 同一控件全站一种选中语言 |
| U7 | `frontend/css/investment.css:5-14`、`manager.css:718-723` | 投入结构“标题操作行 + 筛选行”裸条 → 48 两行卡；逾期与阻塞筛选行裸条 → 48 卡片，搜索框 32/r10 → 30/r7 | 报表与风险页筛选区对齐卡片工具条 |

附带修复（非样式）：`frontend/js/views/mine.js:1109` 的异步 `render()` 原本无条件写全局 `#pageSub`，会把「逾期与阻塞」等页面的副标题覆盖成「admin · 管理员 · 29 项待处理…」。现仅在 `body[data-view="mine"]` 时写入，已用截图与 E2E 回归。

## 逐页对照

| 路由 | 原型 section / 截图 | 关键实测 | 结论 |
|---|---|---|---|
| mine | 我的工作批准原型 + `p-shell` | 48 卡；chip 30/r7；页签选中 `#1D4ED8`；overflow 0 | 一致（页签形态见 K1） |
| mine@pending / created | 同上 | 同上，工具条随页签显示 | 一致 |
| mine@watched | 同上 | 空态卡片（原因 + 去工作项/去需求池），无工具条 | 一致（空态=原因+动作） |
| board | `p-board` | 48 两行卡 `11px 11px 0 0` | 一致 |
| list | `p-list` | 48 两行卡；列头 34/11 | 一致 |
| tree | `p-tree` | 48 筛选卡 + 44 分组行，同一张两行卡 | 一致 |
| chain | `p-chain` | 48 卡；方向 seg 24 白底 | 一致（修 U6） |
| calendar | `p-calendar` | 48 卡 | 一致 |
| gantt | `p-gantt` | 48 两行卡；表格列头 34/11 | 一致 |
| projects | `p-projects` | 48 `proj-list-head`；卡片/表格切换、显示字段 | 形态差异见 K2 |
| portfolio | `p-portfolio` | 健康度卡 + 卡片/列表图例条 | 形态差异见 K3 |
| phase（版本） | `p-versions` | 48 卡（范围/视图/操作/发布计划）；当前版本卡 | 一致 |
| release | `p-release` | 空态面板（无未完成计划 + 去版本页） | 一致 |
| delivery | `p-delivery` | 内容卡片，无工具条 | 一致 |
| demands（需求池） | `p-demands` | 48 两行卡 | 一致 |
| requirements（文档） | `p-docs` | 48 卡 | 一致 |
| testcases（默认用例） | `p-testcases` | 48 两行卡 | 一致 |
| testcases@cases / defects / plans / coverage / report | `p-testcases` / `p-defects` / `p-testplan` / `p-coverage` / `p-testreport` | 5 个页签均 48 两行卡 | 一致 |
| branches | `p-branches` | 86 两行整卡 + 生命周期 chips 行 | 差异见 K4 |
| analysis（默认统计概览） | `p-report-trend` | 48 卡（周期选择） | 一致 |
| analysis@stats | `p-report-trend` | 48 卡（周期选择） | 一致 |
| analysis@completions | 无独立 section | 48 卡；表头 34/11 | 一致 |
| analysis@flow | `p-report-flow` | 48 卡 | 一致 |
| report（交付报告） | 无对应 section | 文档式布局 | 见 K5 |
| investment | `p-report-invest` | 48 两行卡；表头 34/11 | 一致（修 U7） |
| workload | `p-workload` | 操作行 36 + 3 行裸筛选 | 残留 R1 |
| risks | `p-risks` | 快照行 36 + 48 筛选卡 | 一致（修 U7） |
| messages | `p-messages` | 主从两栏，无工具条 | 一致 |
| review（周回顾） | 无对应 section | 面板式 | 见 K5 |
| profile | `p-profile` | 表单卡片 | 一致 |
| settings（默认空间） | `p-settings` | 左侧纵向分区导航 | 一致 |
| settings@space | `p-settings` | 左侧纵向分区导航 | 一致 |
| settings@members | `p-settings-members` | 账号/成员表头 34/11 | 一致 |
| settings@visibility | `p-settings-access` | 表头 34/11 | 一致 |
| settings@workflow | `p-settings-workflow` | 看板列卡片 + 状态矩阵 33/13 | 结构差异见 K6 |
| settings@integration | `p-settings-notify` | 表单卡片 | 一致 |
| settings@data | `p-settings-data` | 表单卡片 | 一致 |
| settings@platform | `p-settings-platform` | 账号表 34/11 | 一致 |

## 有意保留的差异（K1–K8）

| ID | 差异 | 原因 | 何时反悔 |
|---|---|---|---|
| K1 | 我的工作页签是下划线 42px + 计数 pill，全站子导航是 pill 段 | 该页按 `my-work-redesign` 批准原型实现；个人工作台需要更大点击区与计数常驻 | 若产品要求全站页签视觉完全统一，改为 `.subnav` |
| K2 | 项目列表默认「表格 + 项目集分组」，原型默认「分组卡片 + 范围(全部/我负责) + 按分组/平铺」 | 11-20 已上线并验收；默认视图与范围筛选属交互取舍，不是样式值 | 产品确认后切默认卡片并补范围筛选 |
| K3 | 项目集页增加卡片/列表图例条，健康度分区自成一块 | 站点项目集能力比原型多（健康度、风险口径） | 若收敛为原型单工具栏布局 |
| K4 | 分支页多一行「生命周期」筛选 chips，原型把状态收进工具栏「状态」下拉 | 生命周期是站点既有筛选能力，与分支状态不是同一维度 | 若把 chips 收进工具栏「更多」 |
| K5 | 交付报告、周回顾无原型 section；设置页 H1 固定「设置」，分区由左侧导航表达（原型把分区名提升为 H1） | 保持现有信息架构与面包屑稳定，避免标题闪烁 | 若做设置页头重构 |
| K6 | 设置-工作流纵向堆叠（看板列 → 状态流转），原型为「看板列/状态流转/优先级/分类」页签 + 顶栏保存 | 站点是即改即生效；配置模型与保存语义不同，属功能差异 | 若改为显式保存 + 页签 |
| K7 | 全站右上角常驻「+ 新建」 | 既有全局创建入口，各页主操作仍在页头右端 | 若按原型逐页换成“新建项目/新建分支” |
| K8 | 各页 H1 用域名词（工作项/版本/文档），原型用视图名 | 面包屑可定位到当前域，子导航表达视图 | 若统一为视图名 |

## 残留（R1–R3，建议后续单批）

| ID | 严重度 | 位置 | 证据 | 建议 |
|---|---|---|---|---|
| R1 | P2 | 成员负载工具条 | 操作行 36、项目/公司/角色、搜索/分组/排序、工时区间分 4 行裸条；原型为一张 48 卡（范围/分组/排序/搜索） | 合并为一张两行卡，需同时调整 DOM 与移动端堆叠 |
| R2 | P2 | 设置-工作流状态矩阵 | 表头/首列 33/13、600；原型 `.matrix th` 32/10.5 | 交互矩阵可读性优先，暂不改；若统一需实测 10.5 的可点性 |
| R3 | P2 | 逾期页快照行 | 36 高的「当前快照 + 导出清单/催办」仍在筛选卡之外 | 原型把操作放页头右端；迁移涉及页头动作位，待确认 |

## 未覆盖

- 断点：只走查 1440；我的工作另走 390（E2E）。900 / 1100 / 768 未逐页复测。
- 深色主题：`--tbl-head` 已给深色值（`#1A222D`），未逐页截图验证。
- 原型截图与站点数据量级不同（演示数据）；空/错态只在发生空数据的页面记录。

## 验证记录

- `node tools/e2e/site-consistency-audit.mjs`：43 条路由全部完成；overflow 最大 0；H1/副标/主按钮/工具条/表头实测见上表；截图 `shots/*-1440.png`，度量 `metrics.json`。
- `node tools/e2e/my-work-tabs.mjs`：全部通过。含页头副标题「admin · 管理员 · 29 项待处理 · 1 项今天到期」、390 溢出 0、页签触控 46、chips/刷新 44、范围条 44×3、关注撤销、搜索空态、无控制台错误。
- 本批改动未提交、未部署、未修改 Service Worker 版本（`hourglass-shell-v287`）。
