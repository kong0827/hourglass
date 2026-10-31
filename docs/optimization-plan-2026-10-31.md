# DevStudio 全面优化方案（2026-10-31）

> 面向：后续负责落地的 AI / 开发者。本文是**只读审查**的结论，没有改任何代码。
> 范围：页面与信息架构、交互、视觉与无障碍、功能重叠、正确性与安全、前端性能、后端与数据库性能、部署配置、代码结构。
> 行号基于 2026-10-31 工作区（含未提交改动）。**每条动手前先用 grep 确认行号仍然对得上。**

---

## 0. 给实施者的约束（必读）

1. 技术栈不变：Java 8 / Spring Boot 2.7 / MyBatis / MySQL 8；前端**零框架、零构建**（可用原生 ES Module + `import()`，不引入 webpack / vite / React）。
2. SQL 迁移只**新增**编号脚本（从 `sql/17_*.sql` 开始），必须幂等（可重复执行）。**不要修改 `sql/09_task_flow.sql`**（有外部改动）。
3. 改了 `static/` 下任何前端资源，必须同步提升 `static/sw.js` 的 `CACHE_NAME`（当前 `devstudio-shell-v46`），或者先完成 [F-LOAD-3] 的版本号统一。
4. 改了表结构、或者改了"任务挂了哪些子表"，要同步检查 `BackupService`（备份格式当前是 v5）和级联删除清单（见 [BE-ARCH-3]）。
5. README「几个刻意的设计」中的口径（工时封顶 8h、计时归属于人、完成后接力、日历按实际结束日铺开、回顾三区互斥、历史回顾靠日志还原、任务清单是快照）**不要改动**。本文与这些口径冲突的地方，已经单独标成「需决策」。
6. 不要替用户 commit、push 或部署。所有改动的验证方式是：`mvn -o -DskipTests package` 通过，并在无头浏览器里预览，确认没有 JS 异常。
7. 每条带有 `位置 / 现状 / 建议 / 验收`。优先级：**P0** 是 bug、安全问题，或收益最大的小改动；**P1** 明显改善；**P2** 锦上添花。工作量：S 不超过半天，M 为 1–2 天，L 为 3 天以上。

---

## 1. 总体结论

| 维度 | 一句话判断 |
| --- | --- |
| 信息架构 | 一级入口 16 个，偏多；"洞察"下 4 页各算各的数，口径对不上；"项目"和"需求"两页高度重合。 |
| 交互 | 浏览器后退无效；全局搜索在多数视图会被强制跳回看板；计时状态离开看板就看不到；同一类组件（菜单、弹窗、筛选）有 2–3 套实现。 |
| 正确性 | 发现 5 个 P0 级问题：周报成员工时口径错、测试推送会刷重复站内信、普通成员可以彻底删除任务、公开分享按黑名单清字段且令牌可预测、任务清单 CSV 有公式注入。 |
| 前端性能 | 2.5 MB 的富文本编辑器全站同步加载；每条 SSE 推送都会让所有标签页全量重拉、重绘看板和当前视图，后台标签页和发起者本人也不例外。 |
| 后端性能 | 看板、列表、日历、统计都是先全量 `selectAll`，再在 Java 里过滤；拖拽一次要给整列重新编号；多张子表缺少 `workspace_id` 索引；单线程调度器同时承担 SSE 心跳和慢任务。 |
| 部署 | 没有 gzip；静态资源 `cache.period: 0`；AI 接口读超时 120s，而 Nginx 只等 60s。 |
| 工程 | 没有 `src/test`；`app.js` 单文件 11166 行、483 KB；`docs/` 下混着 60 多张截图。 |

**导航收敛目标（16 → 10 个一级入口）：**

```
工作：我的任务(首页) · 看板 · 列表 · 日历 · 甘特图 · 项目(含需求) · 分支
洞察：周回顾 · 分析(趋势 / 完成记录 / 流程体检)
管理：设置(tabs，含回收站、用户管理)        个人设置：头像菜单进入
```

---

## 2. 建议执行批次

| 批次 | 内容 | 说明 |
| --- | --- | --- |
| **第 1 批：止血**（约 2 天） | BUG-1~5、F-LOAD-1、F-LOAD-2、OPS-1、OPS-2、BE-RT-1、DB-1~4、UX-1、A11Y-1 | 全是 S 级。修 bug、补安全、改配置、加索引、做懒加载。风险低，收益最大。 |
| **第 2 批：减负** | F-NET-1~4、F-RENDER-1~3、BE-RT-2~4、BE-Q-2、BE-Q-5、OPS-3~5、BUG-6~12 | 推送 / 轮询收敛，加 ETag，做静默刷新，补齐 N+1 和校验。 |
| **第 3 批：统一组件** | UX-2~6、IA-4、IA-5、CODE-1~4 | 统一 FilterBar、任务菜单、弹窗、下载工具。 |
| **第 4 批：结构性改造** | IA-1~3、IA-6、BE-Q-1、BE-Q-3、BE-ARCH-1~3、CODE-5 | 洞察页合并、项目页合并、看板 SQL 化、TaskService 拆分、app.js 模块化。**先补 TEST-1 再动。** |

---

## 3. 信息架构与功能重叠（可合并 / 可删减）

### IA-1 洞察四页合并为「周回顾」+「分析」 `P1·L`
- **位置**：`index.html:724-958`；`app.js:6933-6936`、`8612-8621`、`8727-8731`、`8788-8798`；后端 `ReviewService` / `StatsService` / `TaskCompletionService` / `FlowHealthService` / `EstimateService`
- **现状**：周回顾、任务清单、统计报表、流程体检 4 页各自计算"完成数 / 工时 / 逾期"。仅"平均每项"就有两种定义：任务清单用"当月总时长 ÷ n"，报表用"累计工时 ÷ 当前已完成数"。报表里的"当前计数"就是看板列计数，和看板重复。后端没有共用的聚合层：`StatsService` 自己算逾期，没有复用 `TaskCalc.dueKind`。
- **建议**：
  1. 前端：保留「周回顾」作为个人例行复盘页；新建「分析」页，下设 3 个 tab：**趋势与分布**（原报表 + 清单的统计）、**完成记录**（原清单表 + CSV）、**流程体检**。页面顶部统一一个周期选择器（本周 / 本月 / 近 N 周），删掉报表中的"当前计数"块。
  2. 后端：新建 `MetricsService`，在一次请求里加载"任务 + 工时 + 列"，提供 `completedBetween(range)`、`overdue()`、`minutesBy(user|task, range)`。五个服务都改为读这一层；逾期统一调用 `TaskCalc.dueKind`；"完成数"统一以快照表 `task_completion_record` 为准。
- **验收**：同一周期内，三个 tab 和周回顾上的完成数、总工时完全一致；导航少 3 个入口，旧 hash（如 `#/stats`）重定向到新页面对应的 tab。

### IA-2 「项目」与「需求」合并为一个「项目」页 `P1·M`
- **位置**：`index.html:499-538`、`540-661`；`app.js:6396-6575`、`7184+`；后端 `Requirement`（项目，`/api/reqs`）与 `RequirementDoc`（需求，`/api/req-docs`）
- **现状**：两页都按项目分组，截图中信息几乎一样；项目卡上没有"查看该项目任务"的入口；右侧常驻一个编辑表单。代码命名混乱：`Requirement` 表示项目，`RequirementDoc` 表示需求，前端还混用 req 和 reqDoc。
- **建议**：项目行可以展开，展开后显示：需求文档列表、任务进度条、「在看板中查看」按钮（设置 `state.reqs=[id]` 后跳转到看板）。新建 / 编辑改为弹窗，去掉常驻表单。后端新增 `/api/projects` 作为 `/api/reqs` 的别名；DTO 和注释统一用「项目 / 需求」两个词。**表名不改。**
- **验收**：导航中只剩「项目」入口；从项目页一键跳到看板时，筛选已经带上该项目。

### IA-3 「我的任务」重新定位为首页收件箱 `P1·M`
- **位置**：`index.html:275-313`；`app.js:6619-6790`（`loadMine` 在 `:6666` 只传了 `{scope}`）
- **现状**：它是跨空间的表格，但没有排序、没有分组、没有行内操作，顶栏搜索在这里也不生效。在单个空间内，它就是功能更弱的列表；唯一独有的价值是"跨空间"。
- **建议**：按 **逾期 / 今天 / 本周 / 以后** 分组；每行提供完成、开始/停止计时、改期三个操作；接入统一的 FilterBar（UX-3），并把搜索词 `q` 传给后端；删掉页内重复的"范围"下拉。后端 `selectMyTasks` 配合 BE-Q-4 一起改。
- **验收**：不切换空间，就能在这一页完成、计时、改期其他空间的任务。

### IA-4 日历接入筛选，否则并入甘特 `P1·M`
- **位置**：`app.js:3462-3477`（`loadCalendar` 只传 `{year, month}`）、副标题在 `app.js:302-319`
- **现状**：日历忽略所有筛选条件，共享空间里会显示所有人的任务。副标题写的是"按截止日期排布"，和实际规则（按 `[开始日, 实际结束日]` 铺开）不符。
- **建议**：接入统一筛选，至少要有"负责人 = 我"；修正副标题。已完成的条目默认折叠成"+n 已完成"（对应截图里格子被塞满的问题）。如果不打算维护日历，就把它降级为甘特的"月"tab，从导航中移除。
- **验收**：选"负责人 = 我"后，日历只显示自己的任务。

### IA-5 设置改成 tabs，回收站和用户管理并入 `P1·M`
- **位置**：`index.html:997-1181`（7 个区块排成一长页）、快捷键面板在 `:1165-1177`、`views.css:291`（窗口宽度小于 1280px 时锚点导航被隐藏）；回收站 `index.html:961-966`；用户管理 `:969`
- **建议**：设置页改为 6 个 tab：
  - 空间：信息、成员、邀请
  - 工作流：看板列、分类
  - 集成：通知
  - 数据：备份、CSV、清空、**回收站**
  - 活动
  - 账号：仅管理员可见，即原来的**用户管理**

  个人设置保持独立页面，从头像菜单进入。快捷键面板移出设置页（见 UX-7）。顺带把两处几乎一样的 scroll-spy 代码删掉（`app.js:9240-9256`、`10300-10314`），改成 tab 后已经不需要。
- **验收**：一级导航少掉「回收站」「用户管理」两项，旧 hash 能正常跳到对应的 tab。

### IA-6 后端重复与可删减项 `P1·M`
| 项 | 位置 | 处理 |
| --- | --- | --- |
| 9 条工时求和 SQL 大同小异 | `TimeLogMapper.java/.xml`：`sumByWorkspaceUser`、`sumSinceByWorkspaceUser`、`sumByWorkspace`、`sumSinceByWorkspace`、`sumBetweenByWorkspace`、`sumByWorkspaceGroupByUser`、`sumByTaskId`、`sumByTaskByWorkspace`、`sumByTaskIds` | 合并成两条：`sumMinutes(ws, userId?, from?, to?)` 和 `sumMinutesGroupBy(ws, by, taskIds?, from?, to?)`，用 `<if>` 拼条件。逐个迁移调用方后，删掉旧方法。BUG-1 的根源就在这里。 |
| `mergeTaskExtras` 与 `mergeGanttExtras` 几乎重复 | `TaskService.java:1074-1143` 与 `:311-358` | 合并成 `mergeExtras(ws, Collection<Task>)`，**按传入任务的 id 集合**查询。甘特那份目前不搜附件名，合并后搜索行为也能统一。 |
| `TrashService` 只是一层转发 | `service/TrashService.java` | 拆分 TaskService 时一起并入 `TaskTrashService`。 |
| `NotifyController` 与 `NotificationCenterController` 名字太像 | `controller/` | 不用合并。把前者改名为 `PushChannelController`，在类注释里写清分工：`NotificationService` 负责调度和外推，`AppNotificationService` 负责站内信存储，`SseService` 负责实时刷新。 |

### IA-7 页面上的小重复 `P2·S`
- **分支页**：顶部 4 个状态格子的计数和 4 列列头的计数完全一样（`index.html:679-683`）。→ 删掉顶部的 `br-flow`。
- **周回顾**：自动总结把下面的列表又写了一遍，而且"复制总结"和"复制周报"是两个按钮。→ 总结默认折叠成一行；两个复制按钮合并成一个下拉（纯文本 / AI 周报）。
- **周回顾工时卡**：三格分别是"全空间累计 / 我的累计 / 本周·全空间"，口径混乱（`app.js:6933-6936`）。→ 只保留"本周·我的"和"本周·全空间"，累计数挪到分析页。
- **统计报表**：`scope-tag "仅我"` 紧挨着分段控件里的"仅我"（`index.html:855-899`）。→ 删掉 `scope-tag`。
- **我的任务**：页内又写了一遍"我的任务"标题，和顶栏重复。→ 以顶栏为唯一标题，页内工具栏只放控件。
- **名称不一致**：导航"报表"对应页面标题"统计报表"，导航"周回顾"对应"工作回顾"（`app.js:302-319`、`index.html:117`）。→ 每个页面只用一个名字。
- **导航红点**：项目角标显示的是项目总数，却用了危险红色；"我的任务"显示的是总数（`app.js:1300-1307`、`6693-6697`、`8092-8097`）。→ 删掉项目角标；"我的任务"只统计逾期 + 今日到期；其余角标改成中性灰。

---

## 4. 交互

### UX-1 浏览器后退无效 `P0·S`
- **位置**：`app.js:347-353`（`syncViewHash` 用的是 `history.replaceState`）、`:354`（`popstate` 监听实际上不会被触发）
- **建议**：视图发生变化时改用 `pushState`，视图没变时不重复 push；保留现有的 `file://` 降级逻辑。
- **验收**：依次切换看板 → 甘特 → 设置，按 3 次后退，能依次回到上一个视图。

### UX-2 全局搜索作用于当前视图 `P0·M`
- **位置**：`app.js:1332-1349`（在看板 / 列表 / 我的任务以外的视图搜索，会被强制跳回看板并弹出 toast）、`:6666`（我的任务不传 `q`）、需求页和分支页还各有一个页内搜索框（`index.html:540-721`）
- **建议**：支持过滤的视图（看板、列表、我的任务、甘特、日历），搜索就过滤当前视图；不支持的视图，搜索框弹出命令面板式的下拉结果（任务 / 项目 / 需求，点击跳转）。删掉页内搜索框，统一由顶栏搜索代理。甘特里专门为了绕开搜索跳转而写的 `ganttSetQuery` 一并删掉。
- **验收**：在任意视图搜索都不会跳页；同一屏幕上只有一个搜索框。

### UX-3 统一 FilterBar 组件 `P1·M`
- **位置**：看板 / 列表的筛选在 `app.js:1163-1452`；甘特另写了一套 8 类筛选 UI（`:5538-5593`）；筛选参数的构造重复了 3 份：`boardParams` `:448-465`、`ganttTaskParams` `:3851-3870`、`currentFilterParams` `:1460-1473`
- **建议**：抽出一个 `FilterBar(container, {fields, onChange})`，看板、列表、甘特、日历、我的任务共用。参数统一从一张字段表 `FILTER_KEYS` 生成；`ganttTaskParams` 改为 `boardParams({...overrides})`。保存的视图本来就共用 `/api/views`，不需要改。
- **验收**：新增一个筛选维度时，只需要改字段表一处。

### UX-4 统一任务菜单，补上计时入口 `P1·S`
- **位置**：卡片菜单 `app.js:2138-2192`、列表行菜单 `:3403-3443`（行菜单少了完成、改期、复制链接；两个菜单都没有"开始计时"）
- **建议**：统一成 `taskMenu(task, ctx)`，菜单项为：打开、完成、改期、开始/停止计时、复制链接、移动到、移到回收站。同时删掉重复入口：看板列头的"+"和列底的"添加任务"重复，保留列底的（它支持录入语法）（`app.js:746-756`、`772`）；任务抽屉底部的"删除"和 ⋯ 菜单重复，只保留菜单里的（`index.html:1583`）。

### UX-5 计时状态全局可见 `P0·M`
- **位置**：计时控件只在看板卡片上渲染（`app.js:584`、`648`，逻辑在 `:2033-2100`）
- **现状**：计时是跨空间的，但离开看板就看不到，很容易忘了停。这和"计时是人的属性"这一设计口径相矛盾。
- **建议**：顶栏常驻一个计时胶囊，显示任务名、实时时长和停止按钮，点击打开该任务；列表和我的任务的行上也显示计时标记；增加快捷键 `S`，用于开始/停止当前焦点任务的计时。`toggleTaskDone`（`:2103-2135`）现在依赖看板缓存 `taskById` 取任务，要改成接收任务对象，或者按 id 请求，这样我的任务里才能直接完成跨空间任务。
- **验收**：在任意视图都能看到正在计时的任务并一键停止。

### UX-6 弹窗、提示框、加载与错误状态统一 `P1·S`
- **位置**：
  - 标准弹窗 `UI.openModal` 在 `ui.js:84-143`，有焦点陷阱、焦点恢复、点遮罩关闭；但需求、AI、分支的 5 个弹窗直接 `classList.add("open")`（`app.js:7385`、`7390`、`7442`、`7495`、`7551`、`7575`、`7631`、`8306`、`8311`），这三项都没有。
  - 批量加标签用的是 `window.prompt`（`app.js:3326`）。
  - 周回顾、任务清单、统计报表加载出错时，只有一块显示错误，其余块一直停在骨架屏（`app.js:6820`、`8582-8598`、`8700-8714`）。
- **建议**：
  1. 所有弹窗都改用 `UI.openModal` / `UI.closeModal`，结构统一为 `sheet-head` / `sheet-foot`；`MODALS` 白名单改为查询 `.modal` 自动收集。
  2. 新增 `UI.showPrompt`，替换 `window.prompt`。
  3. 页面级出错时，用 `UI.errorState` + `bindRetry` 替换掉所有骨架屏。

### UX-7 快捷键可发现 `P1·S`
- **位置**：帮助只在设置页底部（`app.js:9919-9939`）；数字键 `1` 对应 P0，有歧义（`:10951`）；↑/↓ 处理疑似写了两份（`:722-733` 与 `:10996`，删除前先确认后一处是否还能执行到）
- **建议**：按 `?` 弹出帮助（同时写明录入语法，目前录入语法只写在 placeholder 里）；增加 `g b` / `g l` / `g m` 等跳转视图的快捷键；数字键和优先级的映射改成 `0-3 → P0-P3`，或者在帮助里写明；按 `N` 新建时，在当前视图打开并预填上下文（日历预填日期、项目页预填项目、甘特预填开始日），不要强制切回看板（`:10873-11035`）。

### UX-8 其他交互问题 `P2·S`
- **甘特工具栏约 18 个控件**（`index.html:390-496`）：缩放 / 刻度 / 适配合并成一个分段控件加一个"适配"按钮；刷新、撤销（保留 Ctrl+Z）、导出、分析、分享收进 ⋯ 菜单；`:484` 的长段提示改成首次使用时的 tooltip。（按 P1 处理）
- **"已选摘要" chip 一点就清空全部筛选**（`app.js:1376-1388`）：改为点击后展开，每一项单独带 ×。
- **跨空间打开任务需要整页重载**（`app.js:6591-6618`）：允许不切换空间，直接按 `wsId` 打开任务抽屉。
- **删除项目会级联删除需求文档，但确认框里没说**（`app.js:6487-6498`）：确认文案写明会删除的文档数量。（按 P1 处理）
- **注意**：列表最多显示 500 条时，界面**已经有**"仅显示前 500 项"的提示（`app.js:3137`），这一项不用改。

---

## 5. 视觉、移动端与无障碍

### A11Y-1 次要文字对比度不达标 `P0·S`
- **位置**：`tokens.css:18`，`--text-3:#98A2B3`，在白底上约 2.6:1，大量用于 11–12px 的副标题、提示和 `nav-sec`；P3 色条也共用这个色值。
- **建议**：改成约 `#667085`（对比度约 4.8:1）；P3 色条单独定义一个 token，不再和文字色共用。暗色主题（`:118`）同样检查一遍。

### A11Y-2 焦点状态与只在 hover 时出现的操作 `P1·S`
- **位置**：`--ring-focus` 只是 3px、透明度 .16 的淡蓝色；`views.css:599`、`763` 的焦点样式只是把边框换个颜色；卡片上的操作只在 hover 时显示（`components.css:290`、`325`）。
- **建议**：全局加 `:focus-visible{outline:2px solid var(--primary);outline-offset:2px}`；加 `.card:focus-within .card-act{opacity:1}`，让键盘用户也能看到卡片操作。

### VIS-1 视觉细节 `P2·S`
- 顶栏标题在多张截图里被上边缘截掉（`index.html:155-222`）：检查 topbar 的高度、line-height，以及标题和副标题的纵向排布。（按 P1 处理）
- 卡片上的优先级同时用了色条、圆点、文字三种表达（`app.js:684`、`690`）：去掉圆点；文字只在 P0 和 P1 时显示；进度为 0 或未设置时隐藏进度条。
- `layout.css:290` 引用了未定义的 `--dur-mid`，tokens 里只有 `fast / base / slow`：改成 `--dur-base`。
- 我的任务表格在宽屏下被拉得很宽：用 `colgroup` 固定列宽，并给表格设 `max-width`。

### MOB-1 移动端布局 `P1·L`
- **位置**：`layout.css:244-281`，窗口宽度小于 1280px 时只弹一条提示，筛选栏改为横向滚动。
- **建议**：宽度小于 768px 时：侧栏改为底部 tab（我的任务 / 看板 / 日历 / 周回顾 / 更多）；任务抽屉全屏显示；看板改为单列横滑；甘特图只读。触屏拖拽相关的 `touchmove passive:false` 见 F-MEM-1。

---

## 6. 正确性与安全（Bug）

### BUG-1 周报把本周干了活但没完成任务的在册成员，算进「已离开成员」 `P0·S`
- **位置**：`ReviewService.java:111-126`、`:155-167`
- **现状**：成员贡献列表只遍历"本周有完成任务的人"（`memberCount`）；工时用的是 `sumByWorkspaceGroupByUser(ws)`，**没有日期范围**，取的是全量累计；`orphan = 全空间工时 − 列表中成员的工时`。
- **影响**：本周在计时、但没完成任务的在册成员，工时被并进"已离开成员 / 未在册"；列表上显示的成员工时也不是本周的值。
- **建议**：成员全集取空间成员表；工时按本周起止时间查询；`orphan` 只统计 `user_id` 已经不在成员表中的工时。成员显示名直接用 `memberMapper.selectByWorkspace` 已经 JOIN 出来的字段，删掉循环里的 `userMapper.selectById`，顺带解决这里的 N+1。
- **验收**：构造一个本周只计时、不完成任务的成员，他出现在成员列表里，并且工时是本周值。

### BUG-2 测试推送会给所有所有者刷重复的站内汇总 `P0·S`
- **位置**：`NotificationService.java:300-406`（`push(force=true)` → `pushDigestInApp`，以 `refTaskId=null` 写站内信）、`AppNotificationService.java:38`（只有 `refTaskId != null` 时才做 6 小时去重）
- **建议**：`/api/notify/test` 只走外部渠道，并且只发给当前操作人；站内信的去重 key 改成 `(user, type, refTaskId 或日期)`。
- **验收**：连续点 5 次"测试"，所有者的站内信中不再新增汇总。

### BUG-3 普通成员可以彻底删除任务；权限规则各控制器不一致 `P0·S`
- **位置**：`TaskController.java:134-139`（`purge` 只做了 `resolve`，没有校验角色）。其余几处：
  - `ColumnController:49-78`、`CategoryController:58-59`：增改成员可做，只有删除需要所有者。
  - `RequirementController:57-61`、`BranchController:99`：删除带级联，但任何成员都能调。
  - `BackupController:33-37`：导出成员可用，导入仅所有者。
  - `GanttController:112-120`：基线的拍摄和清除成员可用，分享仅所有者。
- **建议**：先写一张权限矩阵，放进 `docs/api.md`。最低要求：**彻底删除、删除项目、删除分支、清除基线、导出全量备份**改为仅所有者可用。实现上新增 `@RequireRole(OWNER)`，或者一个 `requireOwner(ws)` helper（与 BE-ARCH-2 一起做）。
- **验收**：用 `tools/check-member-perm.mjs` 跑一遍成员身份，上述接口都返回 403。

### BUG-4 公开甘特分享按黑名单清字段，令牌可预测 `P0·S`
- **位置**：`GanttService.java:458-494`（在 `allWithExtras` 的结果上逐个字段置空）、`:438`（`Ids.gen("S")`；`Ids.java` 用的是时间戳 + 8 位 `ThreadLocalRandom`，而共享空间的 ID 也用 `S` 前缀）
- **影响**：以后给 Task 新增的字段，会自动泄露到公开链接；令牌可以被预测，也可能和空间 ID 的格式混淆。
- **建议**：改为白名单 DTO `PublicGanttTask`，只包含 id、标题、起止日期、进度、依赖、里程碑标记；令牌用 `SecureRandom` 生成 32 字节，再做 base64url 编码，并新增一个专用的生成方法。查询结果按 `LOAD_MAX_TASKS` 封顶，并缓存 60 秒（见 OPS-4）。
- **验收**：给 Task 实体新增一个字段后，分享接口的响应里不会出现它。

### BUG-5 任务清单 CSV 存在公式注入 `P0·S`
- **位置**：`app.js:8663-8690`（`exportCompCSV` 只转义了引号）；对比 `ganttCsvCell`（`:4730-4741`）已经做了防护。
- **建议**：并入 CODE-1 的统一 `toCsv()`：以 `= + - @ \t \r` 开头的单元格，前面加 `'`。
- **验收**：标题为 `=1+1` 的任务导出后，用 Excel 打开显示为文本。

### BUG-6「任务清单是快照」与彻底删除的行为冲突 `需决策·S`
- **位置**：`TaskService.java:795`（`deleteChildren` 会调用 `completionService.remove`，代码注释写明这是有意的：为了避免 ID 复用时，归档写到旧记录上）
- **冲突**：README 写的是"任务后来被删，历史统计都不受影响"，但回收站 30 天自动清理后，任务清单的历史条目会消失。
- **两种方案，选其一**：
  - **A（推荐）**：purge 时保留快照；同时**禁止复用已经删除的任务 ID**，与 BUG-8 一起做：服务端不接受客户端传入的 id，或者复用前先查快照表。只在清空空间、覆盖导入时才清快照。
  - **B**：保持现状，同时修改 README 的口径描述。

### BUG-7 周报中两个「进行中」数字不一致 `P1·S`
- **位置**：`ReviewService.java:243`（`doing` 只算 `COL_DOING` 一列）与 `:181-191`（`progressTasks` 把所有既非完成也非待处理的列都算上）
- **建议**：统一为"非 backlog 且非 done"。有自定义列时，两个数字应该相等。

### BUG-8 任务保存时缺少校验 `P1·S`
- **位置**：`TaskService.java:915-924`、`:993-1000`；`create` 在 `:412` 接受客户端传入的 id
- **现状**：
  - `ownerUserId` 只校验了用户存在，没校验是不是本空间成员。
  - `blockedByTaskId` 不校验存在性，也不校验是否同一空间。
  - `remindTarget` 没有白名单；`BackupService:498` 有 `oneOf` 校验，这里没有。
  - 客户端可以传入保留 id `CFG`：它会和配置审计日志混在一起，清理时还会连带删除空间的配置日志。
- **建议**：`ownerUserId` 用 `requireMember` 校验；`blockedByTaskId` 要求同一空间、不是自身、未删除；`remindTarget` 复用 `oneOf`；`Ids.sanitize` 拒绝保留字。

### BUG-9 AI 批量建任务可能只成功一部分 `P1·S`
- **位置**：`AiReqDocService.java:305` 起的 `applyTasks`：逐条调用 `taskService.create`，每条外面包着 try/catch，没有加事务。
- **建议**：给 apply 方法加 `@Transactional`（AI 调用本来就在 apply 之前完成，不在事务里），任意一条失败就整体回滚。或者保留部分成功的行为，但返回值里写明 `created` / `failed`，并用 draftId 做幂等，避免重试时重复创建。

### BUG-10 甘特资源负载里，估时和实际工时按不同的人员维度统计 `P1·S`
- **位置**：`GanttService.java:286-390`（估时按负责人文本归属，实际工时按账号的 displayName 归属）
- **建议**：两边都优先按 `ownerUserId` 匹配，匹配不到再回退到负责人文本。修完后同一个人不应拆成两行。

### BUG-11 覆盖导入不处理需求文档和分支 `P1·M`
- **位置**：`BackupService.java:278-295`（清掉了项目，但没清 `requirement_doc` 和 `dev_branch`）、`:471-488`
- **建议**：二选一。① 备份格式升到 v6，把需求文档和分支纳入备份。② 导入时把 `requirement_doc.req_id` 按 `reqIdMap` 重新映射，映射不上的置空。

### BUG-12 其他口径和日志问题 `P2·S`
- **估时准确度阈值不一致**：`EstimateService.java:39` 是 `ACCURATE_LOW=0.85`，`:208` 是 `f<=0.87`，系数在 0.85–0.87 之间时会同时得到"准确"和"偏高"两个结论。→ 两处共用一个常量。另外文案写的是"你的估时"，统计的却是全空间数据：要么按用户过滤，要么把文案改成"团队估时"。
- **通知开关**：外部推送关闭时，站内汇总也一起不发，但任务级的站内提醒不受这个开关影响（`NotificationService.java:162-164`、`203`、`230-238`）。→ 站内和外部各用一个开关。另外 `logRemindSkipped` 往任务时间线写了一条 `actor=null` 的记录，改成只写应用日志。
- **配置审计漏写**：`ActivityService` 的注释说会记录"成员移除、数据清空、导入"，但实际只有 3 处调用（`BoardColumnService:97`、`CategoryService:91`、`RequirementService:133`）。→ 在 `WorkspaceService.removeMember:376`、`wipeData`、`BackupService.importData` 补上调用；catch 里加 `log.warn`。
- **已删除任务仍能查到时间线**：`requireOwned`（`TaskService.java:780`）不排除已删除任务，`logs()` 用的就是它。→ 统一成 `requireTask(ws, id, Deleted.EXCLUDE|INCLUDE|ONLY)`。
- **HTTP 状态码不统一**：越权返回 HTTP 200 + `code=403`，未登录返回 HTTP 401（`SecurityConfig.java`）。→ 统一一种约定。
- **缺事务**：`GanttService` 的 `revokeShare` 和依赖的增删改等多条语句的写操作没有 `@Transactional`。→ 补上。

---

## 7. 前端性能

> 实测体积：`app.js` 482,771 B（gzip 后 136 KB）；`vendor/suneditor/suneditor.min.js` **2,552,952 B**（gzip 后 648 KB）；`index.html` 100 KB；CSS 合计约 148 KB。

### F-LOAD-1 SunEditor 改为按需加载 `P0·S`
- **位置**：`index.html:13`（CSS）、`:1755`（JS，同步加载）；`sw.js:24-25`（还被放进预缓存）；唯一使用处是 `app.js:7248-7250` 的 `initEditor()`
- **建议**：删掉这两处静态引用；新增 `loadSunEditor()`，动态插入 `<link>` 和 `<script>`，返回 Promise 并缓存结果；在 `initEditor` 前先 `await`；鼠标悬停到需求导航时可以提前预取。从 SW 的预缓存清单里移除，改为运行时缓存。之后可以看看能否换成只含所需插件的构建版本。
- **验收**：首屏网络面板里没有 suneditor；需求编辑页仍然正常。

### F-LOAD-2 CSS 的 @import 链与无关样式 `P1·S`
- **位置**：`css/app.css:5-11`（7 个 `@import`，要多一次往返才能发现）；`login.html`、`join.html`、`share.html` 也加载了完整的 views、gantt 样式
- **建议**：`index.html` 直接写 7 个 `<link>`；`login.html` 和 `join.html` 只引 tokens、base、auth；`share.html` 只引 tokens、base、gantt 和分享页样式。

### F-LOAD-3 静态资源版本号与 SW 缓存策略 `P0·S-M`
- **位置**：`application.yml:24-25`（`cache.period: 0`）；`sw.js:61-77`（所有静态资源都是网络优先）；资源 URL 不带版本号，只能靠手动提升 `CACHE_NAME`
- **建议**：
  1. 定义一个 `ASSET_VER` 常量；`index.html` 里的资源引用都带上 `?v=ASSET_VER`，`sw.js` 的 `CACHE_NAME` 也用这个值；在 `tools/` 加一个小脚本，检查这两处是否一致。
  2. 静态资源改为 stale-while-revalidate（先返回缓存、后台再更新），HTML 导航请求仍然网络优先。
  3. 新的 SW 激活后通过 `postMessage` 通知页面，页面弹提示"有新版本，点击刷新"，避免旧前端调用新接口。
  4. 服务端缓存头见 OPS-1。

### F-NET-1 SSE 推送收敛：后台标签页、发起者回声、按实体刷新 `P0·M`
- **位置**：`app.js:10769-10791`（每次 `changed` 事件 → `refreshBoardPreserving` + `loadReqs` + `refreshActiveView` + `loadUnread`）；`app.js:513`（`loadBoard` 每次都连带请求 `/api/my-running-timer`）；服务端 `ChangeBroadcastFilter.java:79-82` 会把事件也推回给发起者
- **现状**：一次拖拽 = 发起者主动刷新一次 + 收到回声再刷新一次 = 2 次看板请求 + 2 次项目请求。后台标签页同样会刷新。`:10785` 处的 `lastRefresh < 300` 判断放在 300ms 防抖之后，基本永远不会命中。
- **建议**：
  1. `document.hidden` 为真时只记录 `pendingRefresh=true`，等 `visibilitychange` 时再补一次刷新。
  2. 每个标签页生成一个 `clientId`；`api.js` 的写请求带上 `X-Client-Id` 请求头；服务端把它写进事件载荷的字段 `c`；前端收到 `c===myClientId` 的事件直接忽略。
  3. 载荷里加上实体类型（task / req / reqdoc / branch / column / timer），前端只刷新相关的数据。
  4. 去掉 `loadBoard` 里对计时接口的链式请求，只在 timer 事件到来时刷新计时状态。
- **验收**：单人拖一张卡，network 面板里只有 1 次 `/api/board`。

### F-NET-2 SSE 健康时停掉轮询，合并多个定时器 `P1·M`
- **位置**：`app.js:10829-10840`（每 30s 一次，SSE 健康时降到 60s，但仍然全量刷新）、`:2090`（计时状态每 60s）、`:11142`（未读数每 60s）、`:10811`（看门狗每 5s）、`:10841-10847`（切回标签页时不节流）；SSE 重连成功（`onopen` `:10800`）后不补拉数据
- **建议**：合并成一个调度器，统一判断"标签页是否隐藏、是否有弹窗、是否在拖拽"；SSE 健康时不做数据轮询；重连时如果断开超过 5 秒，就补拉一次；切回标签页的刷新至少间隔 10 秒；计时状态和未读数改为由 SSE 事件驱动。

### F-NET-3 请求竞态、取消与超时 `P1·S`
- **位置**：`api.js:34-65`（没有 AbortController，也没有超时）；`loadMine` `:6661`、`loadTrash` `:9085`、`loadStats` `:8701`、`loadFlowHealth` `:8845` 连自增序号保护都没有
- **建议**：`request(method, url, body, {key, signal, timeout})`：key 相同时自动取消上一个请求；默认超时 15 秒；`AbortError` 静默处理，不弹 toast。顺带把 `api.js:73-81` 那种"临时清空全局 `CURRENT_WORKSPACE` 来跳过 workspace 参数"的写法，改成显式的 `{global:true}` 选项。

### F-NET-4 启动请求与筛选防抖 `P1·M`
- **位置**：启动流程 `app.js:11104-11139`、`:10074-10109`：确定当前空间之前，就已经发出了看板等请求，依赖服务端的回退逻辑；而前后端的回退规则不一致，前端取 `allWorkspaces[0]`，后端取个人空间。首屏有 11 个以上请求。筛选 `:1325-1330`、`:1390-1392`：筛选一变就重新请求看板，即使当前不在看板视图。
- **建议**：启动时先确定空间：从 localStorage 读上次的空间，首包就带上，等 `/api/auth/me` 返回后再校验，然后并发发出其余请求。中期可以加一个 `/api/bootstrap`，一次返回 me、workspaces、categories、columns、views、running-timer、unread。筛选变化做 150ms 合并，看板不可见时只置脏（见 F-RENDER-1）。
- **注意**：批量修改目前是 N 个并发的 PUT（`app.js:3226-3247`）：短期限制并发数为 4；中期新增 `/api/tasks/bulk-update`（参照已有的 `bulk-move`）。

### F-RENDER-1 看板：不可见时不渲染、首屏只渲染一次、增量更新 `P0·M`
- **位置**：`app.js:708-810`（`render()` 整体重建 innerHTML）；`:511`、`:514`、`:533`、`:7284`、`:8095`、`:10532` 都会触发 render，只有分支那一处判断了当前视图
- **现状**：首屏阶段看板最多渲染 5 次；在甘特等视图时，看板仍在后台反复重建。
- **建议**：
  1. 加一个 `boardDirty` 标记：不在看板视图时只置脏，`showView("board")` 时再渲染。
  2. 首屏用 `Promise.all` 等分类、需求文档、分支、计时状态都返回后，只渲染一次。
  3. 按 `data-id` 做增量更新：用 `id + updatedAt + 计时状态` 作为指纹，只替换发生变化的卡片，再调整顺序；列头计数单独更新。
  4. `render` 开头调用 `UI.hideTip()`，避免锚点元素被删除后 tooltip 残留（`ui.js:258-276`）。

### F-RENDER-2 甘特：后台刷新不清空选中、只渲染一次 `P0·M`
- **位置**：`app.js:3872-3958`（`loadGantt` 清空多选 `sel` 等状态，`:3893`；之后按每页 500 条串行拉取，最多 6 页，每到一页都完整 `renderGantt()` 一次，包括关键路径计算）
- **建议**：后台刷新改用 `loadGantt({silent:true})`：保留 `sel` 和滚动位置，等全部分页到齐后再渲染一次；关键路径按依赖和日期的哈希缓存，只有这两样变了才重新计算；如果 SSE 载荷里带了 taskId，就只更新对应的那一行。

### F-RENDER-3 其余视图：静默刷新，保留滚动位置 `P1·S`
- **位置**：列表 `:3126`、日历 `:3465`、我的任务 `:6663`、回收站 `:9086`、统计 `:8703`、流程体检 `:8848`、任务清单 `:8587`：这些函数一进来就先换成骨架屏，而 SSE 推送和轮询都会调用它们
- **建议**：所有 `load*` 都支持 `opts.silent`：只有首次加载或用户主动操作时才显示骨架屏；后台刷新等数据回来后直接替换，并保存、恢复 `scrollTop`。

### F-RENDER-4 拖拽和滚动时的布局抖动 `P2·S`
- **看板拖拽**：`app.js:1584-1587`、`1633-1684`：`updateDrag` 每帧执行两次，每次都对所有卡片调用 `getBoundingClientRect`，同时又写 DOM，读写交错。→ pointermove 里只记录坐标，计算放到 rAF 里；拖拽开始或换列时缓存每张卡片的 midY，用二分查找定位插入点；`beforeId` 变化时才移动插入线。
- **甘特拖拽**：`:5683-5870` 每次 move 都要测量 2–3 次滚动容器的矩形。→ 拖拽开始时缓存一次，之后只修正 scrollLeft 的偏移。
- **需求目录、设置页的 scroll-spy**：`:7829-7844`、`:9244`、`:10302` 在 scroll 事件里直接测量，没有用 rAF。→ 改用 `IntersectionObserver`。
- **大列表**：列表最多 500 行、我的任务、回收站都没有虚拟化。→ 把甘特现成的 `ganttWindowRange`（`:5327-5384`）抽成通用的 `virtualList`；回收站改为每页 50 条。

### F-MEM-1 事件监听 `P2·S`
- 整体比较规范：`openPop` 和甘特的三种拖拽都会成对地添加、移除监听。
- 问题：看板拖拽的 4 个 document 级 pointer 监听在所有视图都常驻（`app.js:1780-1784`），其中 `touchmove` 用的是 `passive:false`，会影响整页的滚动性能。→ 改成 pointerdown 命中卡片时再动态挂上，拖拽结束后卸掉。

---

## 8. 后端与数据库性能

### DB-1 子表缺少 workspace 维度的索引 `P0·S`
- **位置**：`sql/01_schema.sql:173-183`（subtask 只有 `idx_task(task_id,id)`）、`:206-211`（task_tag 只有主键和 `idx_tag`）、`:226-237`（attachment 只有 `idx_task`）。每次加载看板，`mergeTaskExtras` 都会执行 `WHERE workspace_id=? GROUP BY task_id`，这些查询走不到索引。
- **建议**（新增 `sql/17_perf_index.sql`，用 `information_schema` 判断索引是否已存在，保证幂等）：
```sql
ALTER TABLE subtask    ADD KEY idx_ws_task (workspace_id, task_id, done);
ALTER TABLE attachment ADD KEY idx_ws_task (workspace_id, task_id);
-- task_tag 先确认是否有 workspace_id 列；有就加 (workspace_id, task_id)
```

### DB-2 time_log 查询对列使用函数，导致索引失效 `P1·S`
- **位置**：`TimeLogMapper.xml:70-74`（`DATE(started_at)=?`）、`:83-112`（区间求和）；现有索引只有 `(task_id,ended_at)`、`(workspace_id,ended_at)`、`(user_id,ended_at)`
- **建议**：
```sql
ALTER TABLE time_log ADD KEY idx_ws_started (workspace_id, started_at),
                     ADD KEY idx_user_started (user_id, started_at);
```
  同时把条件改写成 `started_at >= #{d} AND started_at < #{d} + INTERVAL 1 DAY`。

### DB-3 通知、日志、提醒扫描缺少索引 `P1·S`
```sql
ALTER TABLE app_notification ADD KEY idx_ws_ref (workspace_id, ref_task_id),
                             ADD KEY idx_user_ref_type (user_id, ref_task_id, type, created_at);
ALTER TABLE task_log ADD KEY idx_ws_created (workspace_id, created_at);  -- 现有 idx_ws_action_time 中间夹着 action，用不上
ALTER TABLE task ADD KEY idx_remind_scan (remind_sent, remind_at);       -- 配合 BE-RT-3；列名以实际表结构为准
```
- **位置**：`AppNotificationMapper.xml:252-259`、`TaskLogMapper.xml:198-205`

### DB-4 需求文档列表每次都读 MEDIUMTEXT 全文 `P0·M`
- **位置**：`RequirementDocMapper.xml:10-23`（`LEFT(COALESCE(content,''),400)` 依然会把整列读出来；每篇文档还带 2 个关联 COUNT 子查询；没有 LIMIT）；前端 `loadBoard` 每次都会顺带请求这个列表
- **建议**：新增 `content_brief VARCHAR(400)` 列，保存文档时同步维护，列表接口只查这一列；关联 COUNT 改成一次 `GROUP BY req_doc_id`，并加索引 `(workspace_id, req_doc_id, board_column)`；前端只在进入需求视图时才请求这个列表。分支列表也有同样的问题（`DevBranchMapper.xml`：关联 COUNT 子查询，`selectLogs` 没有 LIMIT），一并改成 GROUP BY + `LIMIT 200`。

### DB-5 SQL 写法 `P2·S`
- 甘特搜索用 `LOCATE(LOWER(q),LOWER(col))`（`TaskMapper.xml:249-265`），但 `utf8mb4_unicode_ci` 本身不区分大小写。→ 改为 `LIKE CONCAT('%',?,'%')`；3 个 EXISTS 合并为一个 `IN (… UNION …)`；关键词少于 2 个字时不参与过滤。
- `selectMyTasks`（`TaskMapper.xml:37-53`）的写法是 `IN (子查询)` + `owner_user_id=? OR owner=?` + `FIELD()` 排序，而且没有 LIMIT。→ 显式 JOIN 成员表；把 OR 拆成 `UNION ALL`；默认排除已完成，并加 `LIMIT 200`。

### BE-Q-1 看板接口不再全量加载 `P0·L`
- **位置**：`TaskService.java:167-244`（`board` / `donePage`）、`:1074-1143`（`mergeTaskExtras`）、`:1269-1323`（`buildMeta`）；`TaskMapper.xml:11-15`（`selectAll` 取全部列，没有 LIMIT）
- **现状**：一次看板请求大约执行 9 条整空间查询，包括全部历史已完成任务、整空间的附件（仅用于拼接搜索字段）等，然后在内存里截取已完成列；`donePage` 为了取一页，又把这些全部重来一遍。
- **建议**：未完成的列用一条 SQL（走 `idx_board`）；已完成列单独 `ORDER BY … LIMIT ?`；所有附属数据的聚合都改成 `WHERE task_id IN (可见 id)`，与 IA-6 的 `mergeExtras` 合并；附件名搜索改为只在搜索时由 SQL 处理；meta 缓存见 BE-CACHE-1。列表、日历同样把过滤下推到 SQL：日历用 `idx_ws_due` 加 `BETWEEN`，列表的排序和 LIMIT 下推（`TaskService.java:247-404`）。
- **验收**：已完成任务很多的空间里，看板响应体积和 SQL 条数都不再随历史任务增长；口径与改造前完全一致（用同一份数据对比改造前后的 JSON）。

### BE-Q-2 拖拽排序改为稀疏编号 `P0·M`
- **位置**：`TaskService.java:552-649`（`move` 在事务里 `selectAll` 全空间任务，`:613-620` 逐行更新整列的 sort_order）；`TimeLogService.java:149`（`resumeInColumn` 又执行一次 `selectAll`）；`:655-676`（`bulkMove` 对每个任务都调用一次 `move`）
- **建议**：只查目标列（`WHERE workspace_id=? AND board_column=? AND deleted_at IS NULL ORDER BY sort_order`）；sort_order 改成按 1024 间隔的稀疏编号，插入时取前后两项的中值，只有间隔用完时才重排，重排时用一条 `CASE` 语句批量更新；`resumeInColumn` 直接接收已经查到的数据，不再重查；`bulkMove` 一次性算好所有位置。
- **验收**：拖动一次只更新 1 行（不需要重排时）；同一列两人并发拖拽不会死锁。

### BE-Q-3 统计类服务改为 SQL 聚合 `P1·M`
- **位置**：`StatsService.java:34-101`（最多 26 周 × 全部任务的双重循环）、`ReviewService.java:54-268`（`autoOffset` 要遍历 13 周 × 全部任务）、`EstimateService.java:52-61`、`GanttService.java:348`（拉取整个空间的工时记录，再在 Java 里过滤）、`AiReqDocService.java:68`、`170`、`305`
- **建议**：配合 IA-1 的 `MetricsService`，用 `GROUP BY YEARWEEK(...)` 并只查需要的窄列（可以参考 `FlowHealthMapper.selectTasks`）；甘特的工时按 `task_id IN (…)` 加时间区间查询。

### BE-Q-4 N+1 查询与逐行循环 `P1·S`
| 位置 | 问题 | 改法 |
| --- | --- | --- |
| `TaskService.java:145-163` | 我的任务对每个空间都调用一次整空间的 `mergeTaskExtras` | 按结果中的任务 id，用一次 `IN` 跨空间查询 |
| `ReviewService.java:119-120` | 每个成员都调一次 `userMapper.selectById` | 直接用成员查询 JOIN 出来的字段（与 BUG-1 一起改） |
| `NotificationService.java:283-295`、`408-412` | 每个任务都要对每个成员调一次 `matchMemberByName` | 在循环外构建一次 `Map<name,userId>` |
| `WorkTime.java:86-99` + `TimeLogService.java:227-246` | 有效工时按天逐条查询，跨 30 天要 60 多次 SQL | 一次查询，按 `GROUP BY DATE(started_at)` 返回 Map |
| `RequirementService.list` | 每个项目都调一次 `countByReq` | 改为一次 `GROUP BY req_id` |
| `TaskService.java:1022-1063` | 每个标签都先 `selectByName` 再 insert | 用 `IN` 一次查出，缺少的批量 `INSERT IGNORE` |
| `WorkspaceService.java:300-304` | 删除共享空间时遍历全部用户，逐个更新 | 改为一条 `UPDATE … WHERE last_workspace_id=?` |

### BE-Q-5 大事务拆分 `P1·M`
- **回收站清理**：`TaskService.java:762-807`（`purgeExpired` 把所有到期任务放在一个 `@Transactional` 里，每个任务约执行 13 条语句，还会删除磁盘文件）。→ 每 100 个一批，每批一个事务；子表用 `task_id IN (…)` 批量删除；物理文件放到 `afterCommit` 之后再删。
- **备份导入导出**：`BackupService.java:121-722`：导入在一个事务里逐行插入，每个已完成任务还要调用一次 `archive`；导出把所有表都加载进堆内存。→ 导入时先预加载用户和成员的 Map，按 500 行一批做多值 INSERT（配合 OPS-3 的 `rewriteBatchedStatements`）；导出改用 Jackson `JsonGenerator` 流式输出（当前 `-Xmx320m`，有 OOM 风险）。

### BE-RT-1 调度线程池 `P0·S`
- **位置**：`DevStudioApplication.java:7`（`@EnableScheduling`，全项目都没有配置 TaskScheduler）。SSE 心跳（每 25 秒，`SseService.java:242-254`）、`remindScan`（每 5 分钟）、`dailyPush`、凌晨 4:30 的 purge 都挤在同一个线程上。
- **影响**：只要有一个慢任务（webhook 超时、purge 积压），心跳就会延迟；前端判定 SSE 不健康后转入轮询，引发连锁式的刷新。
- **建议**：`application.yml` 增加 `spring.task.scheduling.pool.size: 4`；外部推送放到 `@Async` 的有界线程池里（核心线程 2，队列 100）。

### BE-RT-2 SSE 广播：异步、合并、精准投递 `P0·M`
- **位置**：`ChangeBroadcastFilter.java:41-100`（每个成功的非 GET 请求，都在请求线程里同步广播；空间 id 只从 `?workspace` 参数读取，读不到时**向所有订阅者广播**）；`SseService.java:179-217`（每次广播都要查一次成员表，再逐个同步 send）
- **建议**：广播投递到一个有界的单线程 Executor；同一空间 200ms 内的多次变更合并为一次；由 Controller 或 Service 显式设置请求属性 `BROADCAST_WS`，Filter 只读这个属性，空间为空时不广播；事件载荷带上 `clientId` 和实体类型（配合 F-NET-1）；成员列表走缓存。

### BE-RT-3 SSE 连接上限与提醒扫描 `P1·S`
- `SseService.java:42` 用的是 `new SseEmitter(0L)`，永不超时，也没有连接数上限。→ 超时设为 30 分钟，让客户端自动重连；每个用户最多 5 条连接，超出时关闭最早的那条；在 onError 和 onTimeout 里统一移除。
- `NotificationService.java:173-192` 每 5 分钟遍历所有空间，每个空间查 2 次；webhook 同步串行发送，读超时 5 秒（`:91-101`）。→ 改成一条跨空间 SQL，查出到期未提醒的任务（配合 DB-3 的索引）；webhook 改为异步发送，超时设为 2–3 秒。

### BE-RT-4 ETag 与版本号 `P0·M`
- **建议**：服务端为每个空间维护一个 `AtomicLong` 版本号（单实例，放内存即可），由广播点递增；`/api/board`（以及 list、gantt）返回 `ETag: W/"ws-{id}-{ver}-{queryHash}"`；收到的 `If-None-Match` 与当前版本一致时，直接返回 304，不查库。前端 `api.js` 为 GET 请求缓存 ETag 并带上 `If-None-Match`。这是用很小的改动挡掉大部分重复负载的办法，建议排在 BE-Q-1 之前做。

### BE-CACHE-1 进程内缓存 `P1·M`
- **现状**：项目里没有任何业务缓存。每个请求的 `resolve` / `requireMember` 都要查 2–3 次（`WorkspaceService.java:127-157`）；`buildMeta` 每次都查分类、标签、项目；`columnName()` / `columnIndexMap` 每次都查列定义（`TaskService.java:1448-1464`，`move` 和 `update` 各调用 2 次）。
- **建议**：引入 Caffeine 2.x（兼容 Java 8，**这是新增依赖，需要用户同意**）。成员关系按 `(userId, wsId)` 缓存，TTL 60 秒，成员或角色变更时主动失效；列定义、分类、标签、项目这些 meta 按空间缓存，用 BE-RT-4 的版本号失效。如果不想加依赖，就用 `ConcurrentHashMap` 加版本号自己实现。

### BE-ARCH-1 拆分 TaskService `P1·L`
- **位置**：`TaskService.java` 共 1487 行，构造器注入了 19 个依赖（`:96-128`）。
- **拆分方案**（Controller 的签名不变）：
  - `TaskQueryService`：查询、过滤、meta
  - `TaskCommandService`：增改、标签
  - `TaskWorkflowService`：移动、重新打开、计时联动、循环任务（`:823-902`）
  - `TaskTrashService`：并入现在的 TrashService
  - `TaskCascade`（见 BE-ARCH-3）
  - `TaskAuditLogger`：差异计算（`:1325`）和写日志（`:1466`）
- **前置条件**：先完成 TEST-1。

### BE-ARCH-2 Controller 鉴权和参数的样板代码 `P1·M`
- **位置**：每个 Controller 都要先调一次 `workspaceService.resolve(userId, workspace)`；`TaskController.java:42-108` 的 board、done、list 三个接口，各自重复声明了 13 个 `@RequestParam`；`GanttController.java:126-146` 又重复了一份。
- **建议**：新增 `@CurrentWorkspace WorkspaceCtx` 参数解析器（实现 `HandlerMethodArgumentResolver`），配合 `@RequireRole(OWNER)` 注解声明所需角色（同时解决 BUG-3）；筛选参数统一收进 `@ModelAttribute BoardQuery`。

### BE-ARCH-3 级联删除清单收口为一处 `P1·M`
- **位置**：`WorkspaceService.java:308-334`（`wipeData`）、`TaskService.java:788-807`（`deleteChildren`）、`BackupService.java:278-295`（导入时的清空）三处各写了一份清单。历次审查记录里已经出过两次"漏清一张表"的问题。
- **建议**：新增 `TaskCascade`，提供 `purgeTask(ws, taskId)` 和 `purgeWorkspaceTaskData(ws, keepAudit)` 两个方法，三处都改为调用它；再配一个测试：扫描 `information_schema` 中所有带 `task_id` 列的表，断言它们都已经登记在 `TaskCascade` 里。

---

## 9. 部署与配置

### OPS-1 gzip 与静态资源缓存头 `P0·S`
- **位置**：`deploy/nginx-devstudio.conf`（没有 gzip，也没有单独的静态资源 location）、`application.yml:24-25`（`cache.period: 0`）
- **建议**：
```nginx
gzip on; gzip_min_length 1024;
gzip_types application/javascript text/css application/json image/svg+xml;
location /api/events { gzip off; ... }   # SSE 不压缩
location ~* ^/vendor/ { expires 365d; add_header Cache-Control "public, immutable"; }
```
  Spring 侧改为 `spring.web.resources.cache.cachecontrol.no-cache: true`，这样可以协商缓存、返回 304，配合 F-LOAD-3 的 `?v=`。vendor 目录改成带版本号的路径（如 `/vendor/suneditor-2.46/`）。
- **验收**：`curl -I -H 'Accept-Encoding: gzip' /js/app.js` 返回 `Content-Encoding: gzip`；再次访问时返回 304。

### OPS-2 AI 接口的超时与并发 `P0·M`
- **位置**：`AiClient.java:46-52`（没有连接池，连接超时 10s、读超时 120s）、`:82-84`（返回 400 时去掉 JSON 模式再重试一次，最长可达约 240s）；Nginx 的 `location /` 是 `proxy_read_timeout 60s`
- **影响**：60 秒时用户已经看到 504，但后端线程还要再等 1–3 分钟；用户一重试，线程就继续堆积。
- **建议**：用 `Semaphore(2)` 限流，`tryAcquire` 失败时返回 429 并提示"AI 正忙"；总超时预算控制在 55 秒以内（重试也计入），或者为 `/api/ai/` 单独配置 `proxy_read_timeout 180s`。长期改成异步任务：接口返回 jobId，结果通过 SSE 下发。出站 HTTP 改用连接池（`HttpComponentsClientHttpRequestFactory`，AiClient 和 webhook 共用）。**注意：如果使用 HttpComponents 需要新增依赖，先征得用户同意。**

### OPS-3 连接池与 JDBC 参数 `P1·S`
- **位置**：`application.yml:30-33`（Hikari 最大连接数 8；Tomcat 默认 200 个线程）
```yaml
server.tomcat.threads.max: 64
server.tomcat.accept-count: 100
spring.datasource.hikari.maximum-pool-size: 10
spring.datasource.hikari.connection-timeout: 3000
# JDBC URL 追加：&cachePrepStmts=true&prepStmtCacheSize=250&prepStmtCacheSqlLimit=2048&useServerPrepStmts=true&rewriteBatchedStatements=true
```

### OPS-4 Nginx 的 SSE 配置与公开接口限流 `P1·S`
- `/api/events` 补上 `proxy_http_version 1.1; proxy_set_header Connection "";`
- 公开分享接口 `/api/share/` 加限流：`limit_req_zone $binary_remote_addr zone=share:1m rate=2r/s;` 加 `limit_req zone=share burst=10;`。服务端按 token 加空间版本号缓存序列化结果 60 秒（`GanttService.java:459-492`）。
- 开启 HTTP/2，这是 CODE-5 模块化之后的前提（需要 HTTPS，属于用户负责的部署层）。

### OPS-5 JVM 参数 `P1·S`
- **位置**：`deploy/devstudio.service:14`（`-Xms128m -Xmx320m`）
- **建议**：`-Xms320m -Xmx320m -XX:MaxMetaspaceSize=128m -Xss512k -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log/devstudio -XX:+ExitOnOutOfMemoryError`。GC 按核数选择：单核用 `-XX:+UseSerialGC`，两核及以上用 G1。

---

## 10. 代码结构与可维护性

### CODE-1 下载 / CSV 工具统一 `P1·S`
- **位置**：甘特 `app.js:4684-4741`、任务清单 `:8663-8690`、全量 CSV `:9866-9882`（这里又手写了一遍 workspace 拼接和 401 处理）、`triggerDownload` `:10563-10573`
- **建议**：统一成 `downloadBlob(name, blob)` 和 `toCsv(rows)`（加 BOM、防公式注入、转义引号），再加一个 `API.blob(path)`。完成后 BUG-5 自然消除。

### CODE-2 死代码 `P2·S`
- `app.js:7198` 的 `sanitizeHTML` 没有任何调用方。它的写法本身也不安全：在游离的 div 上设置 innerHTML，`<img onerror>` 仍然会执行。→ 直接删除；今后确实需要客户端净化时，用 `DOMParser` 加白名单。
- `app.js:2307` 的 `parseTags`、`:1389` 的 `closePopsSoon` 只有定义，没有调用。→ 删除。
- `ui.js:8` 的 `var esc = window.esc`，值是 undefined 且未使用。→ 删除。
- `index.html:321` 的 `btnListBulk` 永远隐藏（`app.js:3200`）。→ 删除。
- `app.js:100-110`：`fmtTs` 和 `fmtDateTime` 实现完全相同。→ 合并为一个。
- 后端：`GET /api/tags`（`TagController.java:27`）前端没有调用；`ReviewService.java:49-52` 的兼容重载；`SseService.java:26` 说要兼容旧格式，但服务端已经只发新格式。→ 用 grep 确认没有调用方后删除。
- `FlowHealthService.java:41`、`:460` 解析旧格式移动记录的正则：写一次性脚本回填 from/to 列之后再删（M）。

### CODE-3 XSS 防护约定加固 `P2·S`
- **现状**：抽查下来 `esc()` 的使用是一致的，但有几处靠调用方自觉：`UI.showConfirm({msg})` 和 `emptyState({text})` 直接把参数当 HTML 插入（有 15 处以上是调用方手动转义）；`catTag` 把颜色值直接写进 style，依赖服务端的正则校验；`share.js:13` 还有另一份 `esc`。
- **建议**：参数区分 `msg`（纯文本，函数内部转义）和 `msgHTML`（显式声明为 HTML）；前端增加 `safeColor()`，按 `/^#[0-9a-f]{6}$/i` 校验；全项目只保留一个 `esc`，并让它也转义 `'`。

### CODE-4 share.js 与 app.js 的甘特渲染重复 `P2·M`
- **位置**：`share.js:18-31`（日期函数；其中 `fmtMD` 和 app.js 里的同名函数格式不同）、`:75-138`、`:247`（刻度、表头、依赖线），对应 app.js 的 `:4341-4485`
- **建议**：模块化后（CODE-5）抽出 `lib/date.js` 和 `lib/gantt-render.js`（纯字符串生成函数），两边共用。

### CODE-5 app.js 按原生 ES Module 拆分 `P1·L`
- **现状**：整个文件是一个 11166 行的 IIFE，有 149 个顶层 var。有利条件：HTML 里没有内联事件（`onclick=` 出现 0 次）；对外只暴露了 `window.CURRENT_WORKSPACE` 一个全局变量。
- **最大难点**：ES Module 导入的绑定是只读的，而现在大量顶层 `var` 会在别处被重新赋值。必须**先**把这些变量收进可变对象，例如 `export const S = {reqList:[], editingId:null, …}`。
- **步骤**：
  1. 抽出纯函数到 `lib/`：date、format、html、download。
  2. 建 `core/`：state、api（改写成 ESM）、router（VIEWS，`enter: () => import("../views/gantt.js")`）。
  3. 看板、列表、日历首屏同步加载；甘特、需求、分支、设置、用户、个人设置、分析、周回顾改为动态 `import()`。
  4. `<script type="module" src="js/main.js">`，核心模块加 `modulepreload`。
  5. SW 的预缓存清单与 `ASSET_VER` 同步，`tools/` 里加一个检查清单完整性的脚本。
- **目标**：首屏 JS 原始体积小于 150 KB。index.html 中低频视图的标记，等这一步完成后再改成 `<template>` 或由对应模块渲染。
- **不建议**引入框架或构建工具。如果以后模块数超过 40 个，再考虑只用 esbuild 做打包。

### TEST-1 补最小测试集 `P1·M`
- **现状**：没有 `src/test`，只有 `tools/*.java`、`tools/*.mjs` 和 `src/test-manual` 下的手工脚本。
- **建议**：增加 `spring-boot-starter-test`（测试范围依赖，**需征得用户同意**），先覆盖以下内容：
  - `WorkTime`：把 `tools/WorkTimeTest.java` 迁移过来。
  - `TaskCascade` 的表覆盖测试（见 BE-ARCH-3）。
  - BUG-1 / 2 / 3 / 4 各一个回归测试。
  - 看板接口改造前后的 JSON 快照对比。

  这些测试完成之前，不要开始 BE-Q-1、BE-ARCH-1、CODE-5。

### DOC-1 docs 目录整理 `P2·S`
- `docs/` 下混着 60 多张 `_shot_*.png` 截图和 9 份 code-review 记录。→ 截图移到 `docs/screenshots/`，并考虑加入 `.gitignore`，或者用 LFS 管理；code-review 记录合并成一份 `docs/review-log.md`。

---

## 11. 已核实与已排除

- **已逐条复核的结论**：
  - UX-1：`replaceState`。
  - IA-4：日历只传了年和月。
  - VIS-1：`--dur-mid` 未定义。
  - A11Y-1：`#98A2B3`。
  - BUG-1：工时取全量累计，以及 orphan 的算法。
  - BUG-2：`refTaskId=null` 时不做去重。
  - BUG-3：purge 没有角色校验。
  - BUG-4：`ThreadLocalRandom` 和 `S` 前缀。
  - BUG-5：任务清单 CSV 只转义了引号。
  - F-LOAD-1：SunEditor 2.55 MB，同步加载。
  - OPS-1：没有 gzip，`period: 0`。
  - BE-RT-1：没有配置调度线程池。
  - DB-1：子表索引缺失。
  - CODE-2：死函数只有定义，没有调用。
- **已排除的误报**：列表 500 条截断**已经有**提示（`app.js:3137`）。彻底删除时连同完成快照一起删，代码里写明是有意为之，因此改成 BUG-6「需决策」，不再按 bug 处理。
- **未覆盖的部分**：`sql/01-16` 与实体字段是否逐一对齐、`BranchService` 和 `RequirementDocService` 的事务边界、真实数据量下的 EXPLAIN 结果都没有逐行核对。性能影响是按代码结构估算的，**改索引之前，请先在真实库上执行 `EXPLAIN`**。
- **刻意不做的**：不改 README 列出的 7 条设计口径；不引入前端框架或构建工具；不引入 Redis（单实例场景下，进程内的版本号和缓存已经够用）。

---

## 12. 实施进度（2026-10-31）

> 本轮按「第 1 批：止血」为主，附带第 2 批中低风险的 S 项。未 commit/未部署。

**已完成**
- BUG-1 周报成员工时：成员全集取空间成员表，工时按本周区间；`orphan` 只统计非在册账号；去掉成员循环里的 N+1。
- BUG-2 测试推送：只走外部渠道，不再写站内汇总；无关联任务的站内信按 `user+type+6h` 去重。
- BUG-3 权限：彻底删除任务、删除项目、删除分支、清除基线、导出全量备份改为仅空间主；前端同步禁用/拦截入口；`docs/api.md` 增加权限矩阵。
- BUG-4 公开分享：任务改用白名单 DTO（`PublicGanttTask`）；令牌改 `SecureRandom` 32 位 base64url；依赖/基线按可见任务过滤并受 2 万条上限约束。
- BUG-5 任务清单 CSV 复用 `ganttCsvCell`，补公式注入防护。
- F-LOAD-1 SunEditor 改为打开需求时动态加载（预览稿从 3.3 MB 降到 0.79 MB），SW 预缓存移除 vendor；保存时编辑器未就绪会拦截，避免清空正文。
- F-LOAD-2 `index.html` 改 7 个直接 `<link>`；登录/加入页只引 tokens/base/components/auth；分享页只引 tokens/base/layout/components/gantt/share。
- UX-1 视图切换 `pushState`，浏览器后退可回到上一个视图（`file://` 仍降级）。
- A11Y-1 `--text-3` / `--p3` 改为 `#667085`；全局 `:focus-visible` 2px 描边；修复未定义的 `--dur-mid`。
- BE-RT-1 调度线程池 4；OPS-2 AI 并发 2 + 读超时 90s + nginx `/api/ai/` 200s；OPS-1 gzip/静态缓存/分享限流/SSE 配置；OPS-3 连接池与 JDBC 参数；OPS-5 JVM 参数。
- DB-1~4：新增 `sql/17_perf_index.sql`（子表/工时/通知/日志索引、`requirement_doc.content_brief`）；工时查询去掉 `DATE()`；需求与分支列表改一次 GROUP BY + LIMIT；负载工时只查统计区间。
- BUG-7 周报「进行中」统一为"非待处理且非完成"；BUG-8 任务保存补负责人成员校验、前置任务校验、提醒对象白名单、保留 ID 拦截；BUG-10 甘特负载估时/工时统一按 `ownerUserId` 归属。
- BE-RT-3 SSE：单用户最多 5 条连接、30 分钟主动超时；CODE-2 删除 `sanitizeHTML`/`parseTags`/`closePopsSoon`/重复的 `fmtDateTime`/`ui.js` 无用变量。
- BUG-6（已按方案 A）：彻底删除不再清完成快照；`TaskCompletionService.hasSnapshot` 阻止复用仍有历史快照的任务 ID（返回 409）。
- BUG-11（已按 v6）：备份导出/导入新增 `reqDocs` 与 `branches`，跨空间导入时项目/需求/分支/任务 ID 统一重映射；v6 备份覆盖文档与分支（分支操作时间线不迁移），旧备份保留现状。

**未做 / 待决策**
- F-NET-1/2/3、F-RENDER-1~4、BE-RT-2/4、BE-Q-2/5、BE-CACHE-1、IA-1~6、UX-2~8、MOB-1、CODE-1/3/4/5、TEST-1 尚未开始；其中 BE-CACHE-1、TEST-1、OPS-2 的连接池方案涉及新增依赖，需先确认。
- `sql/17` 必须先执行再启动新 jar（需求列表依赖 `content_brief`）；索引脚本建议低峰执行并用 `EXPLAIN` 复核。

**复查后追加修复（同日）**
- 导入体积：nginx 给 `/api/import` 单独放宽到 128 MB（v6 备份含需求正文/图片），避免 413。
- 站内汇总去重键补 `workspace_id`，多空间成员不会只收到第一个空间的汇总。
- v6 导入保留需求文档原始创建/更新时间；需求列表移除静默 500 条上限；同名分支跳过而不是撞唯一键中断导入。
- 浏览器后退：编辑需求未保存时弹确认；带 `?task=` 的历史项不再被 hash 重写吞掉。
- 需求编辑器：连续打开只认最后一次请求；页面隐藏时不创建实例；打开时先显示页面再建编辑器。
- 成员视角隐藏彻底删除/删除项目/删除分支/清除基线/分享入口；CSV 数字（含负数）不再被当成公式加引号；空间主按钮 tooltip 不被角色门控清空。

**第三轮：SSE / 渲染 / 交互（同日）**
- F-NET-1：每个标签页携带 `X-Client-Id`，服务端回传 `c`，发起者忽略自己的 SSE 回声；载荷新增实体类型 `e`（task/timer/req/reqdoc/branch/column/category/workspace/all），前端按实体只刷新相关数据；后台标签页只记 `pending`，切回时补拉。
- BE-RT-2（部分）：SSE 广播改到单线程有界队列，请求线程不再同步查成员、逐个 send；成员查询和慢连接不阻塞业务响应。
- F-NET-2（部分）：SSE 健康时停止 30s 数据轮询（仅保留跨零点检查）；重连间隔超过 5 秒时补拉一次。
- F-RENDER-1：看板不在当前视图时只置 `boardDirty`，切回看板再渲染；渲染前清理 tooltip。
- F-RENDER-2（部分）：`refreshGanttIfOpen` 改静默刷新——保留多选与滚动位置，等全部分页到齐只渲染一次。
- UX-5：顶栏新增常驻计时胶囊（任务名、已计时长、一键停止、点击打开任务），任何视图可见。
- UX-2（部分）：搜索就地作用于看板/列表/我的任务/甘特/日历；我的任务与日历在前端按关键词过滤，不再强制跳看板。
- UX-4：卡片与列表行菜单补齐完成、改期、开始/停止计时、复制链接，两处入口一致。
- BUG-12（部分）：估时结论阈值复用 `ACCURATE_LOW/HIGH`，文案改为“团队估时”（统计口径是全空间）。
- IA-4（部分）：日历副标题改为按 `[开始日期, 实际结束日]` 铺开。

**仍未做（被文档自身前置条件或依赖阻塞）**
- TEST-1：需要新增 `spring-boot-starter-test`（文档要求先补测试再动 BE-Q-1/BE-ARCH-1/CODE-5）。
- IA-1/2/3/5、MOB-1、BE-Q-1/2/3/5、BE-ARCH-1/2/3、CODE-5：L/M 级结构性改造，需测试与真实库 EXPLAIN 验证，建议单独排期。
- BE-RT-4 ETag、BE-CACHE-1（Caffeine）、OPS-2 连接池（HttpComponents）、UX-3 FilterBar、UX-6/7、CODE-1/3/4、BE-Q-4：尚未开始；其中 Caffeine/HttpComponents/测试依赖需用户同意。

**第四轮：TEST-1 与复查修复**
- 新增 `spring-boot-starter-test`（test 范围）与 `src/test/java`：WorkTime（16 个时段/上限用例）、TaskCalc（进度/截止边界）、EstimateService（0.85/1.15 边界与无计时样本）、Ids（分享令牌/ID 白名单）、PublicGanttTask 白名单字段快照；`mvn test` 9 个测试通过。
- 复查修复：SSE 列/分类/工作区事件漏刷看板；后台多实体事件合并为 all；甘特静默刷新失败回滚旧视图；估时 1.15 浮点边界误判（加 1e-9 容差）。
- BE-Q-4（部分）：通知扫描的成员名→账号映射每空间只查一次，去掉逐任务 N+1。
- 看板 SQL 化 / 稀疏排序 / ETag / 大事务等仍待实现；按用户选择，本地只保证编译+预览，SQL/EXPLAIN 由用户在服务器验证。

**第五轮：BE-RT-4 ETag**
- 新增进程内 `WorkspaceVersionService`：写请求成功即递增空间版本，ETag 含启动批次+版本+查询串哈希。
- `/api/board`、`/api/tasks/list`、`/api/gantt` 支持 `If-None-Match` → 304（不查库、不序列化）。
- 前端 `api.js` 为 GET 缓存 ETag 与解析后的数据，命中 304 直接复用（上限 80 条）。
- 注意：版本号在内存中，重启后 `BOOT_ID` 变化会让旧缓存自然失效；多实例部署需要改为共享版本源。

**第六轮：BE-Q-4 收尾 + F-NET-3 超时**
- 项目列表的需求数改一次 `GROUP BY req_id`，去掉逐项目 COUNT。
- 删除共享空间后，用一条 `UPDATE ... CONCAT(prefix,id)` 把所有人的 last_workspace 改回个人空间。
- `api.js` 增加 AbortController 超时：普通请求 20s，AI/导入/导出 180s；超时提示“请求超时，请稍后重试”。

**第七轮：F-RENDER-3 静默刷新**
- 列表、日历、我的任务、回收站、统计、流程体检、任务清单的 `load*` 支持 `{silent:true}`：SSE/轮询刷新不再先换骨架屏；用户主动操作仍显示加载态。
- `refreshActiveView` 统一使用静默刷新；甘特同步走 `loadGantt({silent:true})`。

**第八轮：F-MEM-1**
- 看板拖拽的 `touchmove`（passive:false）不再常驻 document：只在拖拽开始时挂上，`cleanupDrag` 时移除；非拖拽状态不再阻塞移动端滚动。

**第九轮：BUG-12 配置审计**
- 成员退出空间、空间主移除成员补写配置审计日志（ActivityService），与删除列/分类/项目保持一致。

**第十轮：BUG-12 HTTP 状态码统一**
- 全局异常处理改为 HTTP 状态与业务 code 对齐（400/403/404/409/500），响应体仍为 ApiResult；前端 api.js 读取非 2xx JSON 并显示 message，未登录仍由 Security 返回 401。

**第十一轮：CODE-3 颜色白名单**
- 分类/看板列颜色统一经 `safeColor()` 校验（仅接受 `#rrggbb`），非法值回落默认色，避免脏数据进入内联 style。
