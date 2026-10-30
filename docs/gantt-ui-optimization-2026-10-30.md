# 甘特图 UI 优化开发文档

- 日期：2026-10-30
- 范围：`static/css/gantt.css` + `static/js/app.js`（gantt 段）+ `static/index.html`（仅工具栏微调），**不动后端接口、不动拖拽交互逻辑**
- 现状截图：`docs/_shot_gantt-default.png`（1440 标准）、`docs/_shot_gantt-zoom40.png`（宽松）、`docs/_shot_gantt-1280.png`（窄屏）
- 截图工具：`node tools/shot-gantt.mjs`（本轮新增，改完可直接复跑对比）

---

## 1. 现状诊断

用预览稿（`docs/ui-preview.html`，本轮已重新生成至含甘特图的版本）截了三组图，逐条过完代码后，问题按严重度汇总如下。

### P0 · 观感硬伤（「丑」的主要来源）

| 编号 | 问题 | 现状代码根因 |
|---|---|---|
| **G1** | **短任务（1 天）渲染成"空心圆环/胶囊"**，白底 + 描边，散在网格上像气泡图，完全不像甘特条 | `.gantt-bar` 背景 `var(--surface)`（纯白）+ 1px 边框；1 天任务宽度 = dayW(28px) ≈ 高度(24px)，圆角 7px 后就是一枚空心胶囊 |
| **G2** | **条内层次杂乱**：白色底 + 14% 透明度进度 + 左端 4px 实色竖条，三种元素叠在一起看不懂哪层是进度 | `box-shadow:inset 4px 0 0 var(--bc)` 竖条 + `.gantt-bar-fill{opacity:.14}` 太淡，对比不出"浅底深进度"的两层结构 |
| **G3** | **已完成任务整条 `opacity:.55`**，连边框带填充一起被冲淡，灰蒙蒙一片 | `.gantt-bar.is-done{opacity:.55}` 一刀切半透明 |
| **G4** | **受阻任务（blocked）橙色虚线空心**，与实心条风格割裂 | `is-blocked` 只加了 `border-style:dashed`，底色仍是白，语义色没有落到填充上 |

### P1 · 细节粗糙

| 编号 | 问题 | 现状代码根因 |
|---|---|---|
| **G5** | **今天标线太抢戏**：2px 实蓝线 opacity .6 从上贯穿到底，压在红条上视觉打架；`::before` 的 8px 圆点实际藏在 sticky 表头后面（z-index 20 > 8），是死代码 | `.gantt-today` + `.gantt-today::before` |
| **G6** | **今天只有日期格高亮**（表头那一格淡蓝），正文区整列没有呼应，视线对不齐 | 只有 `.gantt-day.today` 有 `--primary-soft` 底 |
| **G7** | **拖拽把手 hover 时是两团 28% 透明度的实色块**，像污渍不像把手 | `.gantt-handle{background:var(--bc);opacity:.28}` |
| **G8** | **日期字号 10px 偏小**，周末灰底只在表头出现，正文区没有（见 G6 同类问题） | `.gantt-day{font-size:10px}` |
| **G9** | 工具栏「显示已完成」文字用 `--text-3`，对比度不足，几乎看不清 | `index.html` 里复用 `.toolbar-meta`（三级灰） |

### P2 · 可选增强（不阻塞上线）

| 编号 | 问题 / 机会 |
|---|---|
| **G10** | 宽条（≥3 天）内部是空的，信息全靠左列对照；可加条内内联标题 |
| **G11** | 月份标签每月都带年份（"2026年10月 / 2026年11月"），同年可省略；时间轴尾部 `+7` 天 padding 在宽松缩放下右侧留白明显 |
| **G12** | 正文区周末列无底纹，竖条纹只在表头出现，上下不呼应 |
| **G13** | 甘特条是纯 `div + title`，键盘不可达（无 tabindex/role），可及性欠缺 |

**明确不动的**（避免跑偏）：左列 280px 固定宽、行高 46px、拖拽改期的 pointer 事件流、`/api/tasks/list` 接口与数据结构、未排期折叠区。

---

## 2. 优化方案

核心思路一句话：**把"白底描边空心条"改成"语义 soft 实底 + 实色进度两层条"**，颜色全部取自现有 tokens（`--p0-soft`…`--p3-soft`、`--success-soft`、`--warning-soft` 及对应 border），不引入新色值、不用 `color-mix()`（兼容面稳）。

### 2.1 甘特条实底化（G1 + G2 + G3 + G4）· `gantt.css`

现状问题条样式（第 67–86 行）替换为：

```css
.gantt-bar{
  position:absolute;top:11px;height:24px;border-radius:var(--r-xs);   /* 7px → 6px，短条不再接近胶囊 */
  background:var(--bc-soft,var(--primary-soft));                      /* 实底：语义 soft 色 */
  box-shadow:inset 0 0 0 1px var(--bc-bd,var(--primary-border)),var(--shadow-xs);
  overflow:hidden;cursor:grab;touch-action:none;z-index:3;
  transition:box-shadow var(--dur-fast) var(--ease-out),filter var(--dur-fast) var(--ease-out);
}
.gantt-bar:hover{
  filter:brightness(.97);
  box-shadow:inset 0 0 0 1px var(--bc-bd,var(--primary-border)),var(--shadow-md);
}
.gantt-bar-fill{
  position:absolute;left:0;top:0;bottom:0;width:0;
  background:var(--bc,var(--primary));opacity:.32;                    /* .14 → .32，浅底深进度两层分明 */
  pointer-events:none;
}
/* done：去掉整条 opacity:.55，靠 success 语义配色自然弱化 */
.gantt-bar.is-done .gantt-bar-fill{opacity:.22;}
/* blocked：虚线保留（好识别），底色落到 warning-soft */
.gantt-bar.is-blocked{
  outline:1px dashed var(--bc-bd,var(--warning-border));outline-offset:-1px;  /* outline 跟随圆角 */
}
.gantt-bar.dragging{cursor:grabbing;z-index:6;filter:brightness(.95);}
```

要点：
- **删掉** `box-shadow` 里的 `inset 4px 0 0 var(--bc)` 左竖条（G2 根因）。
- **删掉** `border:1px solid`，改用 `inset 0 0 0 1px` 的 box-shadow 描边——不占盒模型宽度，短条不会因 1px 边框挤压变形（G4 里 dashed 用 `outline` 同理，且现代 Chrome 的 outline 跟随 border-radius）。
- `is-done` 不再整体半透明（G3）；已完成列 `progressOf` 本来就返回 100，fill 用更低透明度（.22）呈现"已完成=浅绿满格"即可，边框走 `--success-border`。

### 2.2 配色变量：`app.js` 传三件套 · `ganttRowHTML()`

现在只传 `--bc` 一个变量。改为传 `--bc` / `--bc-soft` / `--bc-bd` 三件套，取色全部映射现有 tokens：

```js
var GANTT_BC = {
  P0:{c:"var(--p0)",soft:"var(--p0-soft)",bd:"var(--danger-border)"},
  P1:{c:"var(--p1)",soft:"var(--p1-soft)",bd:"var(--warning-border)"},
  P2:{c:"var(--p2)",soft:"var(--p2-soft)",bd:"var(--info-border)"},
  P3:{c:"var(--p3)",soft:"var(--p3-soft)",bd:"var(--border-strong)"}
};
var GANTT_DONE    = {c:"var(--success)",soft:"var(--success-soft)",bd:"var(--success-border)"};
var GANTT_BLOCKED = {c:"var(--warning)",soft:"var(--warning-soft)",bd:"var(--warning-border)"};
```

`ganttRowHTML()` 里取色逻辑改为：

```js
var bc = done ? GANTT_DONE : (t.blocked ? GANTT_BLOCKED : (GANTT_BC[t.priority] || GANTT_BC.P2));
```

条的内联 style 追加两个变量（原来只有 `--bc:`）：

```js
' style="left:' + left + 'px;width:' + width + 'px;--bc:' + bc.c +
 ';--bc-soft:' + bc.soft + ';--bc-bd:' + bc.bd + '"'
```

> 注意：`PRIORITY_COLOR`（第 37 行）是全局表，**不要动**，看板/清单还在用；甘特图独立维护 `GANTT_BC`。

### 2.3 今天标线弱化 + 整列呼应（G5 + G6）· `gantt.css` + `renderGantt()`

CSS：

```css
/* 正文区今天整列淡底，垫在条(z:3)之下 */
.gantt-today-col{
  position:absolute;top:0;bottom:0;width:var(--gantt-day-w,28px);
  background:var(--primary-soft);opacity:.45;z-index:1;pointer-events:none;
}
/* 标线：降为 1.5px、更透明；删掉 ::before 圆点（被表头挡住，纯死代码） */
.gantt-today{
  position:absolute;top:0;bottom:0;width:1.5px;background:var(--primary);
  opacity:.45;z-index:8;pointer-events:none;
}
```

`renderGantt()` 生成 `gantt-today` 的同一处，旁边多插一个列高亮层（同一个 `todayOff` 判断里）：

```js
(todayOff >= 0 && todayOff < range.days
  ? '<div class="gantt-today-col" style="left:calc(' + GANTT_LABEL_W + 'px + ' + (todayOff * dayW) + 'px)"></div>' +
    '<div class="gantt-today" style="left:calc(' + GANTT_LABEL_W + 'px + ' + (todayOff * dayW) + 'px)"></div>'
  : '')
```

> DOM 顺序：`today-col` 要放在 `.gantt-body` 之前（或 z-index:1 + position 兜底均可，因为 body 内行的 track 是静态布局、bar 才有 z-index:3，列底垫在最下不会盖条）。实际上两行插在 `.gantt-body` 之后也可以，靠 z-index:1 压到 bars 下面即可——`.gantt-row` 本身没有 z-index，`today-col` z-index:1 不会盖住 bar(z:3)，但会盖住行背景/网格线，这正是想要的。

### 2.4 拖拽把手改竖线提示（G7）· `gantt.css`

现状两团半透明色块替换为"把手竖线"：

```css
.gantt-handle{
  position:absolute;top:0;bottom:0;width:10px;z-index:4;cursor:ew-resize;
}
.gantt-handle::after{
  content:"";position:absolute;top:7px;bottom:7px;width:2px;border-radius:1px;
  background:var(--bc,var(--primary));opacity:0;
  transition:opacity var(--dur-fast) var(--ease-out);
}
.gantt-handle.l{left:0;}   .gantt-handle.l::after{left:3px;}
.gantt-handle.r{right:0;}  .gantt-handle.r::after{right:3px;}
.gantt-bar:hover .gantt-handle::after{opacity:.5;}
@media (hover:none){
  .gantt-handle::after{opacity:.5;}   /* 触屏常显，原来是整块 opacity:.28 */
}
```

（原来是 `.gantt-handle{background:var(--bc);opacity:0}` + hover `.28`，整段替换。）

### 2.5 表头与工具栏小修（G8 + G9）· `gantt.css` + `index.html`

```css
.gantt-day{font-size:10.5px;}   /* 10px → 10.5px */
```

`index.html` 第 385–387 行，「显示已完成」和「缩放」两个 label 里的 `toolbar-meta` 改为 `toolbar-meta strong`（或直接加 `style="color:var(--text-2)"`），从三级灰提到二级灰。

### 2.6 可选增强（P2，单独一批做）

1. **条内内联标题（G10）**：`ganttRowHTML()` 中当 `width >= 110` 时追加
   ```html
   <span class="gantt-bar-label">标题 · P0</span>
   ```
   ```css
   .gantt-bar-label{position:absolute;inset:0;display:flex;align-items:center;
     padding:0 8px;font-size:11px;font-weight:600;color:var(--text-2);
     pointer-events:none;white-space:nowrap;overflow:hidden;}
   ```
2. **月份年份去重（G11）**：`ganttMonthsHTML()` 里仅首个月份段或 1 月带年份，其余显示 "11月"。
3. **尾部留白收紧（G11）**：`ganttDateRange()` 的 `addDays(max, 7)` → `addDays(max, 4)`，`-3` 保持（左侧要给"今天不在最左"留余量）。
4. **键盘可达（G13）**：`gantt-bar` 加 `tabindex="0"` + `role="button"` + `aria-label`（含任务名与起止），focus 态复用 `.dragging` 的视觉；方向键 ±1 天改期作为后续迭代，不在本批。

---

## 3. 视觉规格对照（新 vs 旧）

| 元素 | 旧 | 新 |
|---|---|---|
| 条底色 | `--surface`（白） | 语义 soft（`--p0-soft` / `--success-soft` / `--warning-soft`…） |
| 条描边 | `1px solid var(--bc)` | `inset 0 0 0 1px` 语义 border 色 |
| 左端竖条 | `inset 4px 0 0` 实色 | **删除** |
| 进度填充 | `--bc` @ 14% | `--bc` @ 32%（done @ 22%） |
| 圆角 | 7px | `--r-xs`（6px） |
| 已完成 | 整条 opacity .55 | success 配色 + fill @ 22%，不降透明度 |
| 受阻 | 白底 + 虚线边 | `--warning-soft` 底 + `outline: 1px dashed --warning-border` |
| 今天线 | 2px @ 60% + 死圆点 | 1.5px @ 45%，无圆点，正文区整列 `--primary-soft` @ 45% 呼应 |
| 把手 | hover 显 28% 色块 | hover 显 2px 竖线 @ 50% |
| 日期字号 | 10px | 10.5px |

---

## 4. 实施步骤与验收

按依赖顺序，一批内可完成 2.1–2.5（P0+P1）：

1. `static/css/gantt.css`：按 §2.1 / §2.3 / §2.4 / §2.5 替换样式。
2. `static/js/app.js`：加 `GANTT_BC` 三件套映射 + `ganttRowHTML()` 取色与内联变量改造（§2.2）+ `renderGantt()` 插 `today-col`（§2.3）。
3. `static/index.html`：工具栏两处 label 对比度（§2.5）。
4. **P2 项单独一批**，不与上面混。

**验收清单：**

- [ ] `node tools/gen-preview.js` 重新生成预览稿
- [ ] `node tools/shot-gantt.mjs` 重截三图，与 `docs/_shot_gantt-*.png` 对照：短任务呈实底色块、进度两层可辨、done 为浅绿满格、blocked 橙 soft 底虚线
- [ ] 手工回归拖拽：拖中段改期、拖两端调起止、点击打开任务抽屉、未排期区点击跳转（pointer 逻辑未动，应无回归）
- [ ] 缩放三档（20/28/40）× 显示已完成开关来回切换，`ganttScrollToToday()` 定位正常
- [ ] `sw.js` CACHE_NAME **v34 → v35**（部署前必改）
- [ ] 同步 `docs/ui-redesign-spec.md` 附录（新增 H.9 或 I.x：甘特条实底化口径 + today 双层结构 + 把手竖线），改前端口径必须落附录
- [ ] `docs/api.md` 无接口变更，不动

**风险与兼容：**

- `outline` 跟随圆角需要 Chrome 94+，本项目内网 Chrome 环境满足；若要兜底可退回 `border:1px dashed`（会把 1px 计入盒模型，需同步 `box-sizing` 验证短条不变形——默认已 `border-box`，影响可忽略）。
- 语义 soft 色全部来自 `tokens.css` 既有变量，深色模式当前不存在，无需双份口径。
- `--bc-soft` / `--bc-bd` 缺省兜底已写在 CSS `var()` 第二参数里，漏传不至于白屏。

---

*附：现状截图即本文档开头的三个 `_shot_gantt-*.png`；实施后同文件名覆盖即为前后对照。*
