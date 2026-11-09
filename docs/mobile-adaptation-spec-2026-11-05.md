# 沙漏（Hourglass）移动端改造方案 · 开发执行文档

> 版本：2026-11-05 v1
> 适用对象：接手实现的 AI / 工程师
> 配套原型：Ardot《Hourglass 移动端原型 v1》（fileId 744051571112339，18 屏）
> 前置阅读：`docs/ui-redesign-spec.md`（令牌体系）、`docs/接口契约.md`（接口约定）

---

## 0. 执行约束（先看这 7 条，违反任一条都要停下来问）

1. **不新建前端工程、不引入框架、不加构建工具。** 现有前端是零构建的原生 ES Module，必须保持：`<script type="module" src="js/main.js">` 直接跑。
2. **不改桌面端的默认渲染分支。** 所有移动端改动必须挂在 `isMobile()` 判断或 `body[data-layout="mobile"]` 选择器下。默认分支（else）保持今天的字节级行为。
3. **不复制业务函数。** `dueState` / `filterParams` / `task-actions.js` / `WorkTime.effectiveMinutes` / `TaskCalc.progressOf` 只允许调用，不允许复制一份改。移动端和桌面端必须共用同一份口径。
4. **不动后端写接口、不改 SQL 工时口径。** L4 只新增 3 个只读接口。
5. **一个阶段一个提交，能单独回滚。** 见 §9 的批次划分。
6. **改任何 `static/` 下的文件，必须同步把 `sw.js` 的 `CACHE_NAME` 加 1**（当前 `hourglass-shell-v86`），新文件必须加进 `SHELL` 数组，否则离线会白屏。
7. **不要从 `index.html` 删除 `#sideNav`。** `router.js` 在模块求值时就执行 `$("sideNav").addEventListener(...)`，删了直接抛错白屏。移动端只隐藏它。

---

## 1. 现状基线（实测，用于对照）

| 文件 | 规模 | 说明 |
|---|---|---|
| `static/index.html` | 1400+ 行 | 单页壳：侧栏 → 顶栏 → 筛选栏 → `<main id="views">` 里 19 个 `<section class="view" id="view-xxx">` |
| `static/css/app.css` | 20 行 | **只有 `@import`，顺序即层叠顺序**：tokens → base → layout → components → views → gantt → auth |
| `static/css/layout.css` | 414 行 | 布局骨架；**第 347–414 行是现有 MOB-1 段**，本次要替换 |
| `static/css/views.css` | 1570 行 | 各视图样式，**在 layout.css 之后加载**（覆盖顺序坑） |
| `static/js/main.js` | 入口 | 同步 import 首屏模块 + `boot()` |
| `static/js/core/router.js` | 路由 | `VIEWS` 表 + `showView()`；hash 形如 `#/board`；深链 `?task=<id>` 由 `hashParam("task")` 解析 |
| `static/js/core/view-loader.js` | 懒加载 | `loadView(name)` 内部 `import("../views/" + name + ".js")` |
| `static/js/core/dom.js` | 节点缓存 | **模块加载时** 缓存 62 个节点（`$("id")`），新增节点不要往这里加 |
| `static/js/views/gantt.js` | 118 KB | 最大单文件，手机端不应下载 |
| `static/sw.js` | — | `CACHE_NAME = "hourglass-shell-v86"`，`SHELL` 逐条列出所有 js/css |

### 现有 MOB-1 的 5 个问题（本次要解决的正是这些）

1. `.sidebar` 被 `position:fixed` 改成底部条（`layout.css:353`），品牌区/空间切换/设置/退出全被 `display:none` 干掉 → 手机上无法切空间、无法进设置。
2. 底部只有一个 `#mobMore` 弹菜单（`router.js` 的 `openMobMore()`）承载 14 个视图，长到要滚动。
3. `.list-row{min-width:880px}`（`layout.css:398`）→ 任务列表在手机上必须左右甩才能看全一行。
4. 看板靠 `scroll-snap` 横滑多列，一屏只能看一列的一半，且列头不吸顶。
5. 顶栏把搜索框、新建、帮助、主题、铃铛全塞在一行，360px 下按钮被压到 28px 点击区。

---

### 1.3 锚点速查（已逐条核对代码；行号会漂移，以标识内容为准）

| 用途 | 文件:行 | 定位标识 |
|---|---|---|
| 路由表 | `js/core/router.js:41` | `var VIEWS = {` |
| 视图切换 | `js/core/router.js:71` | `function showView(name)` |
| hash 解析 | `js/core/router.js:90` | `function viewFromHash()` |
| 底部「更多」旧实现 | `js/core/router.js:~185` | `function openMobMore()`（L1 后废弃，保留代码不删） |
| 刷新当前视图 | `js/core/router.js:~140` | `function refreshActiveView()` |
| 懒加载入口 | `js/core/view-loader.js` | `export function loadView(name)` |
| 看板渲染 | `js/views/board.js:258` | `function render(opts)` |
| 看板列常量 | `js/lib/format.js` | `COLUMNS`（`{id, name, color…}` 数组，`state.js`/`board.js` 都从它 import） |
| 看板列数据 | `js/views/board.js:293` | `state.board.columns[c.id]` |
| 卡片计时按钮 | `js/views/board.js:198 / 740` | `data-timer-toggle` |
| 卡片更多菜单 | `js/views/board.js:228 / 736` | `data-card-menu` |
| 我的任务渲染 | `js/views/mine.js` | `renderMine(data, append)` |
| 我的任务分组 | `js/views/mine.js:116` | `mineGroupOf(t)` |
| 行点击打开任务 | `js/views/mine.js:317` | `openTaskById(id)` |
| 列表行渲染 | `js/views/list.js:389` | `listBody.innerHTML = viewRows…` |
| 抽屉打开 | `js/core/task-drawer.js:105 / 363` | `function openDrawer()` |
| 抽屉对外入口 | `js/core/task-drawer.js:1141` | `openTaskDrawer` / `tryCloseTaskDrawer` |
| 通知面板 | `js/core/app.js:202-207` | `$("btnAlert")` + `UI.openPop($("alertPanel")…)` |
| 状态组件 | `js/core/ui.js:359 / 372 / 389` | `emptyState` / `errorState` / `skeletonRows` |
| 截止文案 | `js/core/state.js:83 / 92` | `dueState(t)` / `dueText(t)` |
| SW 版本 | `static/sw.js:4` | `CACHE_NAME = "hourglass-shell-v86"` |

---

## 2. 断点与令牌

### 2.1 三档断点（唯一真源）

| 档位 | 宽度 | `body[data-layout]` | 形态 |
|---|---|---|---|
| 手机 | ≤ 639px | `mobile` | 底部 5 Tab + 单列内容 |
| 平板 | 640–1023px | `tablet` | 侧栏收成 64px rail + 双列卡片 |
| 桌面 | ≥ 1024px | `desktop` | 现状不变 |

> 旧的 `max-width:767px` 一律作废。`layout.css` 里其余 `max-width:1279px / 767px` 的桌面收缩规则**保留不动**，只删 MOB-1 段。

### 2.2 新增样式文件

新建 `static/css/mobile.css`，并在 `app.css` **最后一行**追加：

```css
@import url("mobile.css");
```

理由：`views.css` 会覆盖 `layout.css`，而 `mobile.css` 必须压过所有人。即使如此，**每条手机规则仍要写全 `[data-layout="mobile"]` 前缀**（权重 0,2,0 起），不要依赖导入顺序。

```css
/* ============ mobile.css 骨架 ============ */
[data-layout="mobile"]{
  --content-pad: 16px;
  --radius-card: 14px;
  --tabbar-h: 62px;
  --safe-b: env(safe-area-inset-bottom, 0px);
}
[data-layout="mobile"] .view{ padding: 0 16px calc(var(--tabbar-h) + var(--safe-b) + 12px); }
[data-layout="mobile"] .view-page{ padding: 0; }   /* 覆盖 views.css 的 desktop padding */
```

---

## 3. L1 · 骨架改造（必须先做，独立可交付）

### 3.1 新增底部 Tab DOM

在 `index.html` 的 `<div class="main">` **之后**、`</body>` 之前插入（同级，不要放进 `.main`，否则被 `.view` 裁剪）：

```html
<nav class="tabbar" id="tabBar" aria-label="主导航（移动端）" hidden>
  <div class="tabbar-pill">
    <button class="tab" type="button" data-tab="mine"     aria-label="我的任务">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="14" rx="4"/><path d="M6.9 10.2 9.2 12.5 13.2 8.1"/></svg>
      <span>任务</span>
    </button>
    <button class="tab" type="button" data-tab="board"    aria-label="看板">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="3.6" width="3.8" height="12.8" rx="1.4"/><rect x="8.2" y="3.6" width="3.8" height="8.6" rx="1.4"/><rect x="13.4" y="3.6" width="3.6" height="11" rx="1.4"/></svg>
      <span>看板</span>
    </button>
    <button class="tab" type="button" data-tab="projects" aria-label="项目">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 6.4a1.8 1.8 0 0 1 1.8-1.8h3.2l1.6 1.9h6a1.8 1.8 0 0 1 1.8 1.8v6.9a1.8 1.8 0 0 1-1.8 1.8H4.6a1.8 1.8 0 0 1-1.8-1.8Z"/></svg>
      <span>项目</span>
    </button>
    <button class="tab" type="button" data-tab="messages" aria-label="消息">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2a4.7 4.7 0 0 1 4.7 4.7v3l1.1 2.2H4.2l1.1-2.2v-3A4.7 4.7 0 0 1 10 3.2Z"/><path d="M8.1 16.1a2.1 2.1 0 0 0 3.8 0"/></svg>
      <span>消息</span>
      <i class="tab-dot" id="tabMsgDot" hidden></i>
    </button>
    <button class="tab" type="button" data-tab="me"       aria-label="我的">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3.1"/><path d="M3.9 16.5c.6-3.2 2.6-4.9 6.1-4.9s5.5 1.7 6.1 4.9"/></svg>
      <span>我的</span>
    </button>
  </div>
</nav>
```

样式（`mobile.css`），严格按原型：胶囊容器 62px 高、radius 36、内 padding 4；激活项实心 `--primary` + 白字：

```css
[data-layout="mobile"] .tabbar{
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 110;
  display: flex; justify-content: center;
  padding: 12px 21px calc(21px + var(--safe-b));
  background: linear-gradient(to top, var(--bg-app) 62%, transparent);
}
[data-layout="mobile"] .tabbar-pill{
  display: flex; width: 100%; height: var(--tabbar-h);
  padding: 4px; gap: 0;
  background: var(--surface); border: 1px solid var(--border); border-radius: 36px;
  box-shadow: var(--shadow-md);
}
[data-layout="mobile"] .tabbar .tab{
  flex: 1 1 0; min-width: 0; height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; border: 0; border-radius: 26px; background: transparent;
  color: var(--text-3); font-size: 10px; font-weight: 600;
}
[data-layout="mobile"] .tabbar .tab.on{ background: var(--primary); color: #fff; }
[data-layout="mobile"] .tabbar .tab.on svg{ stroke: #fff; }
[data-layout="mobile"] .tab-dot{ position: absolute; top: 9px; right: 18px; width: 7px; height: 7px; border-radius: 50%; background: var(--danger); }
```

### 3.2 新增 `js/core/layout.js`（整份照抄）

```js
/* core/layout · 三档断点 → body[data-layout]
   只负责"当前是什么档位"，不碰业务渲染。视图自己监听 ds:layout 决定是否重渲染。 */

var MQ_MOBILE = "(max-width: 639px)";
var MQ_TABLET = "(min-width: 640px) and (max-width: 1023px)";
var mqMobile = window.matchMedia(MQ_MOBILE);
var mqTablet = window.matchMedia(MQ_TABLET);

/** 唯一判定出口。不要读 dataset，dataset 只是给 CSS 用的镜像。 */
export function isMobile(){ return mqMobile.matches; }
export function isTablet(){ return mqTablet.matches; }
export function layoutMode(){
  return mqMobile.matches ? "mobile" : (mqTablet.matches ? "tablet" : "desktop");
}

var last = null;
function apply(){
  var next = layoutMode();
  if (next === last) return;
  last = next;
  document.body.dataset.layout = next;

  /* 与现有 body.side-rail 互斥：手机档位下强制清掉 rail，否则 rail 逻辑会和底部 Tab 打架 */
  if (next === "mobile") document.body.classList.remove("side-rail");

  var tabbar = document.getElementById("tabBar");
  if (tabbar) tabbar.hidden = next !== "mobile";

  window.dispatchEvent(new CustomEvent("ds:layout", { detail: { layout: next } }));
}

export function initLayout(){
  apply();
  window.addEventListener("resize", apply, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", apply, { passive: true });
  mqMobile.addEventListener("change", apply);
  mqTablet.addEventListener("change", apply);
}
```

### 3.3 接入入口

`js/main.js` 顶部（**必须是第一个 import，早于任何视图模块求值**）：

```js
import { initLayout, isMobile } from "./core/layout.js";
```

`boot()` 内、`autoRail()` **之前**调用：

```js
initLayout();
```

⚠️ `autoRail()` 里的 `if(w < 1440) add('side-rail')` 保持不变——它在 desktop 档位才有视觉意义，mobile 档位已被 `apply()` 清掉。

### 3.4 删除旧的 MOB-1 段

删除 `css/layout.css` 第 347–414 行整段（从 `/* ===================== MOB-1：<768px 移动端 ===================== */` 到文件末尾）。**同时删除 `layout.css` 里 `.mob-more{display:none;}` 这条单独规则（348 行）**，因为要保留 `#mobMore` 给平板档位用。

迁移原则：MOB-1 里这 6 条是有效的，改写成 `[data-layout="mobile"]` 前缀后搬进 `mobile.css`：

- `.topbar{height:52px}`
- `.view{padding}`（已由 §2.2 覆盖）
- `.drawer{width:100%;top:0;bottom:0}`
- `.toast-layer{bottom:calc(var(--tabbar-h) + 24px)}`
- `.filterbar{overflow-x:auto}`
- `.board-col{width:calc(100vw - 32px)}` ← **这条要删**，L2 会换掉看板在手机上的形态

### 3.5 Tab 与视图的映射（写进 `router.js`）

在 `showView()` 里 `document.body.dataset.view = name;` 之后追加一行 `syncTab(name);`，并在同文件加入：

```js
var TAB_OF = {
  mine: "mine",
  board: "board", list: "board", calendar: "board", gantt: "board", branches: "board",
  projects: "projects", requirements: "projects", demands: "projects",
  portfolio: "projects", project: "projects",
  // messages 是 L4 新视图；未上线前点它打开现有通知面板
  settings: "me", profile: "me", review: "me", analysis: "me", phase: "me",
  report: "me", workload: "me", risks: "me"
};
function syncTab(name){
  var bar = document.getElementById("tabBar");
  if (!bar) return;
  var want = TAB_OF[name] || "mine";
  bar.querySelectorAll("[data-tab]").forEach(function(b){
    var on = b.dataset.tab === want;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
}
```

Tab 点击（放在 `layout.js` 或新建 `core/tabbar.js`，**不要塞进 `dom.js`**）：

```js
document.getElementById("tabBar").addEventListener("click", function(e){
  var b = e.target.closest("[data-tab]");
  if (!b) return;
  var tab = b.dataset.tab;
  if (tab === "messages") {                  // 过渡实现：直接点现有铃铛，复用 app.js:202 的处理
    var bell = document.getElementById("btnAlert");
    if (bell) bell.click();                  // 内部走 UI.openPop($("alertPanel"), …)
    return;
  }
  showView(tab === "me" ? (localStorage.getItem("ds.view") === "profile" ? "profile" : "mine") : tab);
});
```

> `me` 的直接落点：**先落「我的任务」**，因为原型里「我的」是个人中心，但底部 tab 的「任务」已经是我的任务。为避免两个 tab 同屏，`me` 打开 `profile`（个人设置页），`mine` 打开我的任务。请按此实现，并在 PR 描述里说明这处与原型命名差异。

### 3.6 切视图保持滚动位置（原型要求）

`showView()` 开头保存、结尾恢复：

```js
var scrollMemo = Object.create(null);
function saveScroll(){
  var cur = document.querySelector(".view.on");
  if (cur) scrollMemo[cur.id] = cur.scrollTop || 0;
}
function restoreScroll(name){
  var el = document.getElementById("view-" + name);
  if (el) el.scrollTop = scrollMemo["view-" + name] || 0;
}
// showView() 第一行加 saveScroll()
// showView() 里 .view 的 .on 切换完成之后加 restoreScroll(name)
```

### 3.7 顶栏在手机档位的降级

`mobile.css` 里（只做视觉与收纳，不改 DOM）：

```css
[data-layout="mobile"] .topbar{ height: 52px; padding: 0 12px; gap: 8px; }
[data-layout="mobile"] .tb-sub,
[data-layout="mobile"] .gs-kbd,
[data-layout="mobile"] .narrow-hint,
[data-layout="mobile"] .app-foot{ display: none !important; }
[data-layout="mobile"] #btnHelp,
[data-layout="mobile"] a[href="help.html"],
[data-layout="mobile"] #btnTheme{ display: none; }   /* 收进「我的」页 */
[data-layout="mobile"] .global-search{ flex: 1 1 96px; }
[data-layout="mobile"] .timer-pill{ max-width: 132px; }
[data-layout="mobile"] .timer-pill .tp-name{ max-width: 56px; }
```

「新建」按钮 → 圆形 FAB（实现取 48px，比原稿 44px 点击区更大；右下、Tab 上方），选择器 `#btnNew`，样式只改形态不改菜单逻辑（`#newMenu` 已经存在）。

### 3.8 L1 验收（逐条可断言）

1. `1440 / 1024 / 768 / 390` 四个宽度下 `document.body.dataset.layout` 分别为 `desktop / desktop / tablet / mobile`。
2. `≤639` 时 `#tabBar` 可见、`.sidebar` 不可见，且页面无横向滚动（`document.scrollingElement.scrollWidth === clientWidth`）。
3. 点 Tab 顺序切换 5 次，`body.dataset.view` 与 `#tabBar .tab.on` 始终一致。
4. 从「看板」滚到中部 → 切「任务」→ 切回「看板」，`#view-board.scrollTop` 与切走前一致（误差 ≤ 4px）。
5. `≥1024` 下把窗口拉窄再拉宽，桌面布局、`side-rail` 折叠行为、筛选栏全部与改动前一致（录屏比对）。

---

## 4. L2 · 视图改造

### 4.1 策略：先同文件分支，拆分留作可选

**L2a（本期必须）**：在 4 个视图的渲染入口第一行加分支，同文件内多写一个 `renderMobile*` 函数。**保持现有静态 import 不变**，风险最低。

**L2b（可选，只做收益不做必须）**：拆 `board.mobile.js` 等 partner 文件 + `view-loader` 按断点选择。收益是手机端不下载 `gantt.js(118KB)` / `settings.js(72KB)` / `phase.js(53KB)`。做 L2b 必须同时改 `router.js` 顶部 4 个静态 import 和 `main.js` 顶部 3 个，改为 `withView()` 懒加载——**这是一次结构性改动，不要和 L2a 放同一个 PR**。

L2b 的 `view-loader` 改法（供参考，本期可不做）：

```js
var suffix = isMobile() ? ".mobile" : "";
var p = import("../views/" + name + suffix + ".js").catch(function(){
  return import("../views/" + name + ".js");   // partner 不存在时回退
});
```

### 4.2 定位入口函数（以下均已核对，直接改这 4 个函数的第一行）

```bash
grep -n "function render"        js/views/board.js     # render(opts)            @258
grep -n "function renderMine"    js/views/mine.js      # renderMine(d, append)   @156
grep -n "function renderListItems" js/views/list.js    # renderListItems(items)  @361
grep -n "function renderCalendar" js/views/calendar.js # renderCalendar()        @68
```

统一加分支（示例，board）：

```js
import { isMobile } from "../core/layout.js";

function render(opts){
  if (isMobile()) return renderMobile(opts);
  /* ↓↓↓ 以下桌面逻辑一行不改 ↓↓↓ */
  ...
}
```

### 4.3 四个视图的手机版结构规格

> 数据一律复用现有函数，不要新请求接口。以下字段名以 `state.js` / 接口返回为准。

#### 4.3.1 我的任务（`mine.js` → `renderMobileMine(data, append)`）

- 容器：单列，`gap:16px`。层级 = 分组头（`已逾期 / 今天 / 本周`，颜色分别 `--danger-fg / --text / --text`）+ 任务卡列表。
- 分组规则**直接复用现有 `mineGroupOf(t)`**（`mine.js` 已有），不要重写。
- 卡片结构（3 行，高度约 104px）：
  1. 标签行：`优先级 chip` + `状态 chip`（列名色取自 `COLUMNS` 的 color）+ 占位 + 26×26 计时按钮（沿用现有属性 **`data-timer-toggle="<taskId>"`**，事件委托已存在于 `board.js:740`）
  2. 标题：14.5px / 600 / 行高 21，超 2 行截断（`-webkit-line-clamp:2`）
  3. 元信息行：`项目 · 模块`（11.5px `--text-3`）+ 右侧截止文案（复用 `dueText(t)`，逾期时 `--danger-fg`）
- 点击卡片整卡 → 打开详情：**沿用 `mine.js` 现有的行点击委托**（约 317 行 `openTaskById(id)`），不要新加 `data-task-id` 这类属性；更多操作沿用 `data-card-menu="<taskId>"`（`board.js:228`）。
- 卡片左滑 → 完成（`toggleTaskDone`）；右滑 → 打开状态选择（复用 `openCardMenu`）。

#### 4.3.2 看板（`board.js` → `renderMobileBoard(opts)`）

**这是本次改动最大的地方。** 手机档位不并排列，改为：

1. 顶部状态分段器：横向滚动，每段 = `列名 + 数量`，激活段白底 + `--text` 600，容器底色 `--surface-sunken`、radius 14、padding 3。列定义来自 **`js/lib/format.js` 的 `COLUMNS`**，每列数据在 **`state.board.columns[colId]`**（结构 `{items, matched, total, allTotal, hasMore}`，见 `board.js:293`）。
2. 下方单列纵向卡片流，卡片复用 4.3.1 的结构，额外多一行：`标签组`（分类 / 需求编号）。
3. 列头吸顶：分段器用 `position:sticky; top:0`（实现修正：顶栏在文档流中不固定、`.view` 内部滚动，`top:52px` 会在吸顶时留缝，故取 0）。
4. 空列：`UI.emptyState({title:"这一列还没有任务", desc:"从下面新建，或把别的列拖过来"})`。
5. 换列手势：分段器点击切换（**不做横向 swipe 换列**，避免和卡片左滑冲突）。
6. 拖卡换列：只在 `mobile` 下用长按进入拖动（`gestures.attachLongPress`），松开时按落点在分段器上的列落位；L2 可以先不做，留 TODO。

> 原型 03（列横滑）**本期不实现**，作为下期可选项。理由：单列纵流已验证可覆盖同一批信息，且不需要 `touch-action` 打架。

#### 4.3.3 任务列表（`list.js` → `renderListItems(items)` @361）

- 用 `viewRows` 同一个数据源，但每行渲染成 4.3.1 的卡片，**不再输出 `<table>` 语义**。
- 去掉 `.list-row{min-width:880px}`：`mobile.css` 里 `[data-layout="mobile"] .list-row{min-width:0}`，并把 `listHead`（复选框表头）隐藏。
- 多选：长按卡片进入多选模式，替代桌面端的表头勾选（L2 可先只保留长按 → 完成）。
- 分页「加载更多」保持原按钮。

#### 4.3.4 日历（`calendar.js`）

- 月视图在手机上降级为**周列表**：一列 7 天，每天一个小节（日期 + 星期 + 该天任务条数），任务条为单行圆角条（`开始–结束` 用 `fmtFull`/现有格式化函数）。
- 保留「上一周 / 下一周」两个按钮，`data-cal-nav` 复用现有事件。
- 网格 `grid-template-columns` 在 mobile 下强制单列（已有 `@media(max-width:1279px){.cal-layout{grid-template-columns:1fr}}`，补 `[data-layout="mobile"]` 版本）。

### 4.4 其余 13 个视图：只做 CSS 收窄，不改 JS

必须验证这 13 个视图在 390px 宽下无横向滚动、无被裁的固定宽度：`gantt`（允许横向滚动，但要有提示条）、`projects`、`phase`、`demands`、`requirements`、`branches`、`review`、`analysis`、`portfolio`、`project`、`workload`、`risks`、`report`、`settings`、`profile`。

通用规则：

```css
[data-layout="mobile"] .view-page{ max-width:100%; }
[data-layout="mobile"] .set-layout,
[data-layout="mobile"] .proj-layout,
[data-layout="mobile"] .cal-layout{ grid-template-columns:1fr; }
[data-layout="mobile"] .set-anchor{ display:none; }
[data-layout="mobile"] .form-grid,
[data-layout="mobile"] .field-row{ grid-template-columns:1fr; flex-direction:column; }
[data-layout="mobile"] .gantt-wrap{ overflow-x:auto; -webkit-overflow-scrolling:touch; }
```

### 4.5 L2 验收

1. 390px 下「我的任务 / 看板 / 列表 / 日历」四屏均**无横向滚动**；看板的分段器可横向滚动但页面本身不滚。
2. 看板在手机上首屏可见 ≥ 2 张完整卡片，切换分段后卡片集合变化正确（与桌面端同列任务数一致）。
3. 任意任务卡点击后打开详情，标题、项目、截止文案与桌面端一致（同一任务的文案逐字相同）。
4. 列表页在手机上不再出现 `<thead>`，且分页数量与桌面端同页一致。
5. 其余 13 个视图逐屏截图存档到 `docs/images/_shot_mobile-<view>.png`，无横向滚动。

---

## 5. L3 · 交互

### 5.1 新增 `js/core/gestures.js`

```js
/* 只在 mobile 档位挂载；桌面端调用直接 return，保证零影响 */
export function attachSwipe(el, { threshold = 56, onSwipeLeft, onSwipeRight } = {}){}
export function attachLongPress(el, { delay = 480, tolerance = 10, onLongPress } = {}){}
export function attachPullToRefresh(scroller, { threshold = 64, onRefresh } = {}){}
```

实现要求：

- 用 `pointerdown / pointermove / pointerup`，`pointerType === "mouse"` 时直接忽略。
- 元素上设 `touch-action: pan-y`（横向手势自己接管，纵向交给浏览器）。
- 事件委托挂一次：`document.getElementById("views").addEventListener("pointerdown", ...)`，用 `e.target.closest("[data-task-id]")` 找目标，**不要给每张卡单独绑**（列表 200 行会卡）。
- `onSwipeLeft` 触发后露出操作区（完成 / 计时），点击其它位置收起。实现形式（2026-11-06 回写）：我的任务/列表用 `.swiped` 类展开卡片内操作条；看板卡片无操作条，左滑直接完成（已完成卡片改为打开菜单，避免误撤销），右滑打开快捷菜单；未采用 `translateX(-72px)` 侧露方案。

### 5.2 任务详情：复用抽屉，不新建页面

**这是与原型稿的一处刻意偏离，必须按这里实现。**

原型 04 画的是独立全屏详情页；但代码里 `core/task-drawer.js` + `#taskDrawer` 已经承载了完整的表单、子任务、附件、评论、工时与保存逻辑（`taskPayloadWith`、`buildFormControls`、`saveTask` 等）。**另写一个详情页 = 两套保存路径 = 必出数据不一致。**

因此手机端做法：

```css
[data-layout="mobile"] .drawer{
  width: 100%; top: 12px; bottom: 0; left: 0; right: 0;
  border-left: 0; border-radius: 20px 20px 0 0; z-index: 200;
}
[data-layout="mobile"] .drawer-head{ height: 52px; padding: 0 16px; position: sticky; top: 0; }
[data-layout="mobile"] .drawer-body{ padding: 16px 16px 96px; }
[data-layout="mobile"] .drawer-foot{
  position: sticky; bottom: 0; height: 72px; padding: 0 16px;
  background: var(--surface); box-shadow: 0 -6px 16px -6px rgba(16,24,40,.08);
}
```

DOM 只需加两处（`index.html` 的 `#taskDrawer` 内）：

1. 顶部拖拽把手：`<div class="sheet-grab" aria-hidden="true"></div>`（38×4，`--border-strong`，居中）。
2. 状态切换按钮放进 `.drawer-foot` 左侧（44×44），点击复用现有 `#iCol` 的列选择逻辑。

深链：`#/board?task=123` 现有行为不变（`hashParam("task")` → `openTaskById`），手机端打开的是全屏抽屉，天然满足「刷新/分享可恢复」。

### 5.3 新建任务：同一个抽屉的矮版

原型 05 是半屏面板。实现上**不要新写表单**——`#taskDrawer` 已经有全字段。做法：

```css
[data-layout="mobile"] .drawer.is-create{
  top: auto; height: 78vh; border-radius: 24px 24px 0 0;
}
```

在 `openTaskDrawer(...)`（`task-drawer.js:1141` 导出）的**新建分支末尾**——也就是 `openDrawer()` 调用处（约 `task-drawer.js:363`）——加类 `is-create` 并聚焦标题；该函数另一条编辑分支在打开时 `classList.remove("is-create")`。这样"半屏新建"和"全屏详情"共用同一份 DOM 与校验。

> 现有调用方已在用这个入口，例如空看板里的 `openTaskDrawer("backlog")`（`board.js` 空态重试），**参数是初始列 id**，不要改成对象或其他签名。

### 5.4 下拉刷新

挂到 `.view.on` 容器上，`onRefresh` = `router.js` 已有的 `refreshActiveView()`。**不新写刷新逻辑。**

### 5.5 L3 验收

1. 390px 下点任务卡 → 抽屉全屏、底部操作条固定可见、滚动正文时操作条不动。
2. 新建任务 → 面板高度 78vh、标题输入自动聚焦；取消后再次打开详情，高度恢复全屏。
3. 卡片左滑露出操作区、点「完成」后该卡从当前分组消失且桌面端刷新后状态一致（同一任务）。
4. 详情页下拉不会误触发刷新（抽屉内滚动手势不传给 `.view`）。
5. 桌面端点卡片仍打开 680px 侧抽屉，宽度/位置与改动前一致。

---

## 6. L4 · 后端（3 个只读接口）

统一约定：路径前缀 `/api`（部署上下文 `/hourglass` 由前端 `api.js` 处理）、全部 `GET`、全部按 `workspace` 隔离、失败一律 **HTTP 200 + `code!=0`**（沿用 `GlobalExceptionHandler` 约定）。

### 6.1 `GET /api/mobile/team-overview`

| 参数 | 必填 | 说明 |
|---|---|---|
| `workspace` | 是 | 空间 id |
| `from` `to` | 否 | `yyyy-MM-dd`；团队视图的统计区间（本周 = 周一~周日，本月 = 1 日~月末，近 30 天 = 今天往前 30 天）。缺省为「最近 7 天」。 |

区间只作用于**统计类**指标：`doneRate` / `doneCount` / `planCount` / `deltaWeek`。`overdue`、`blocked` 与 `pending` 是「此刻」的待办快照，不随区间变化——前端在卡片上明确标注「截止此刻」，避免用户以为切了区间这些数字也该变。`deltaWeek` 是环比：与**前一等长周期**比较（区间 30 天则对比再往前 30 天），字段名沿用历史。

```json
{
  "code": 0,
  "data": {
    "health": { "doneRate": 0.68, "doneCount": 34, "planCount": 50, "overdue": 9, "blocked": 3, "deltaWeek": 0.06 },
    "pending": { "review": 2, "accept": 1, "merge": 1 },
    "risks": [
      { "taskId": "t_1", "title": "次席代码校验", "ownerName": "李睿", "reason": "逾期 5 天 · 阻塞下游 2 个任务", "level": "high" },
      { "taskId": "t_2", "title": "资金上场小程序", "ownerName": "王倩", "reason": "3 人排队等联调环境，已卡 2 天", "level": "mid" }
    ]
  }
}
```

口径复用（**不要新算**）：
- `doneRate` = 完成数 / 计划数，完成判定用 `TaskCalc.progressOf` 与列配置 `isDone`，与 `task_completion_record` 对齐。
- `overdue` 用 `state.js` 同款 `dueState` 语义（服务端已有等价实现，优先找现成的逾期统计）。
- `blocked` 取 `task.blocked = true`（若字段名不同以实体为准）。

### 6.2 `GET /api/mobile/workload`

| 参数 | 必填 | 说明 |
|---|---|---|
| `workspace` | 是 | 空间 id |
| `from` `to` | 否 | `yyyy-MM-dd`，与 6.1 同一区间；缺省为截至今天的最近 7 天。响应里的 `rangeFrom`/`rangeTo` 是服务端截断后的实际区间（上限 92 天）。 |

```json
{ "code":0, "data": { "capacityMinutesPerDay":480, "workdays":5,
  "rangeFrom":"2026-11-01", "rangeTo":"2026-11-30", "rangeWorkdays":21,
  "members": [
  { "userId":"u1","name":"李睿","role":"后端","percent":0.3,"plannedMinutes":10080,"actualMinutes":3072,"overload":false }
]}}
```

- `percent` = `actualMinutes / plannedMinutes`；`actualMinutes` = **区间内**计时，`plannedMinutes` = `capacityMinutesPerDay × rangeWorkdays`（区间内周一~周五天数）。切到「本月」时容量随之变成 21 个工作日 = 168h，不会拿一周容量去比一个月的投入。
- 阈值口径**沿用现有状态**（前端渲染规则，服务端只给数值）：`>100%` 红、`90–100%` 黄、其余蓝。

### 6.3 `GET /api/mobile/risks?workspace=&type=blocked|overdue`

```json
{ "code":0, "data": { "blocked":[{ "taskId":"t_1","title":"…","ownerName":"王倩","dayCount":2,"reason":"等联调环境","lastNudgedAt":"2026-11-05T10:12:00" }],
                       "overdue":[{ "taskId":"t_3","title":"…","ownerName":"李睿","dayCount":5,"due":"2026-10-31","priority":"P0" }] } }
```

### 6.4 权限

- 三个接口都要求调用者是**该空间成员**；`workload` 与 `risks` 额外要求管理角色（实现口径 ∈ `owner | admin`，即 `ProjectAccessService.isPrivileged`；本系统无 projectLead 角色）。
- 无权限时返回 `{ "code": 4030, "msg": "当前角色无权查看该数据" }`（沿用现有业务码风格），前端据此渲染「无权限态」。
- **复用现有空间角色校验工具**，不要新写一套判断。

### 6.5 其它后端改动（很小）

- `GET /api/workspaces` 返回体确认是否含当前用户在该空间的 `role`；若没有，在 DTO 增加 `role` 字段（只读，不改权限逻辑）。前端需要它来决定默认落点。

### 6.6 L4 验收

1. 用 `demo` 账号（`du00`）请求三个接口，`code=0` 且数值与线上页面同周期的数字一致。
2. 用非成员账号请求，返回 `code=4030`，前端呈现无权限态而不是空白。
3. 断网请求，前端走 `errorState`（有「重试」），不是白屏。

---

## 7. 角色规则（已与产品确认）

### 7.1 默认落点与记忆

```js
/* 默认：owner/admin → team；其余 → mine（实现口径：本系统无 projectLead 角色，
   管理角色 = ProjectAccessService.isPrivileged = owner|admin，前后端一致） */
/* 记忆：只记当前空间，key = "ds.mode." + workspaceId，值 "mine" | "team" */
function defaultMode(role){
  return (role === "owner" || role === "admin") ? "team" : "mine";
}
function currentMode(wsId, role){
  try { return localStorage.getItem("ds.mode." + wsId) || defaultMode(role); }
  catch(e){ return defaultMode(role); }
}
```

- 切换只写 `localStorage`，**不落库**（跨设备不共享，符合"只记当前空间"）。
- 切空间时重读 `currentMode(新空间)`，不允许跨空间串台。

### 7.2 手机端放开的审批动作（产品已定）

| 类型 | 查看 | 通过 / 合并 | 打回 | 备注 |
|---|---|---|---|---|
| 需求评审 | ✓ | ✓ | ✓ | 通过需二次确认（影响任务数 > 0 时弹确认） |
| 分支合并 | ✓ | ✓ | ✓ | 合并前校验目标分支状态 |
| 任务验收 | ✓ | ✗ | ✗ | 手机只读，改状态回桌面端 |

> 这条要落成代码里的常量表，不要在 JSX/模板里散写：

```js
export var MOBILE_APPROVALS = {
  review: { view:true, approve:true, reject:true, confirmOnApprove:true },
  merge:  { view:true, approve:true, reject:true, confirmOnApprove:false },
  accept: { view:true, approve:false, reject:false }
};
```

---

## 8. 状态兜底（4 态统一）

`js/core/ui.js` 里已有 `emptyState / errorState / skeletonRows`，新增一个：

```js
function noPermState(opts){
  /* opts: { title, desc, roleLabel, adminName, onApply } */
  /* 结构对照原型 17：72×72 圆角图标底 + 标题 + 说明 + 主按钮 + 管理员小字 */
}
```

使用位置：

| 场景 | 用哪个 |
|---|---|
| 看板空列、我的任务无待办、列表筛选无结果 | `emptyState`（必须含"下一步动作"按钮） |
| 首屏加载 | `skeletonRows(n)`（已有） |
| 接口失败 / 断网 | `errorState(msg)` + 重试（已有） |
| 角色无权（workload / risks / team-overview） | `noPermState`（新增） |

**禁止**：任何一处直接 `innerHTML = ""` 留白，或 toast 一句"请联系管理员"就结束。

---

## 9. 提交批次（每批一个 PR，按序合并）

| # | 范围 | 主要文件 | 完成定义 | 估时 |
|---|---|---|---|---|
| PR1 | L1 骨架 | `index.html`、`css/mobile.css`(新)、`css/app.css`、`css/layout.css`、`js/core/layout.js`(新)、`js/main.js`、`js/core/router.js`、`sw.js` | §3.8 五条全过；桌面端零差异 | 2.5d |
| PR2 | L2a 我的任务 + 列表 | `js/views/mine.js`、`list.js`、`css/mobile.css` | §4.5 第 1/3/4 条 | 2d |
| PR3 | L2a 看板 + 日历 | `js/views/board.js`、`calendar.js`、`css/mobile.css` | §4.5 第 2 条；看板分段器可用 | 2.5d |
| PR4 | L3 交互 | `css/mobile.css`、`js/core/gestures.js`(新)、`task-actions.js`、`index.html`(抽屉两处 DOM) | §5.5 五条全过 | 2.5d |
| PR5 | L4 后端 + 团队模式 | `controller/service/mapper`(新增只读)、`js/views/mine.js`(加模式切换)、`js/core/api.js` | §6.6 三条；角色默认落点正确 | 2.5d |
| PR6 | 打磨 | 暗色映射、13 个视图收窄、截图归档 | §4.5 第 5 条；暗色下无低对比文字 | 2d |

**每批提交前自检（缺一不可）**

```bash
# 1) 语法
node --check js/core/layout.js
node --check js/core/gestures.js
node --check js/views/board.js     # 逐个改过的文件都跑

# 2) 预览稿（注意 gen-preview 的 </body> 用 lastIndexOf 替换）
node tools/preview/gen-preview.js

# 3) 构建（仅 PR5 需要）
JAVA_HOME=/d/jdk8 mvn -B -DskipTests clean package

# 4) 手机视口截图（新建 tools/shots/shot-mobile.mjs，复用现有 shot-*.mjs 的 CDP 方式）
node tools/shots/shot-mobile.mjs            # 375×812、deviceScaleFactor 2、touch emulation
```

`tools/shots/shot-mobile.mjs` 最小骨架：

```js
// 复用 tools/shots/shot-*.mjs 的 CDP 连接方式，仅改两处：
// Emulation.setDeviceMetricsOverride({ width:375, height:812, deviceScaleFactor:2, mobile:true })
// Emulation.setTouchEmulationEnabled({ enabled:true, maxTouchPoints:5 })
```

---

## 10. 坑位清单（这些已经踩过，直接按结论写）

1. **`#sideNav` 不能删**（§0 第 7 条）。只 `display:none`。
2. **`dom.js` 在模块求值时缓存节点**。新增的 `#tabBar` 不要在 `dom.js` 里加导出，否则首次加载顺序不对会拿到 null。用 `document.getElementById` 局部取。
3. **`views.css` 在 `layout.css` 之后加载**，会把 `layout` 的宽度/内边距改回去。所有手机覆盖写进 `mobile.css`（最后 import）且带 `[data-layout="mobile"]`。
4. **`sw.js`**：`CACHE_NAME` 必须 +1（`hourglass-shell-v86` → `v87`），`mobile.css`、`gestures.js` 等新文件必须进 `SHELL`，否则老用户离线会白屏且不会自动恢复。
5. **`tools/preview/gen-preview.js`** 里替换 `</body>` 必须用 `lastIndexOf`（历史坑），新增模块要能被它收集。
6. **z-index 打架**：`#tabBar` = 110，`drawer` 手机档位 = 200，`toast-layer` 实现取 230（高于抽屉：抽屉内保存/失败的反馈必须可见，原建议 150 会把提示压在抽屉后面）；抽屉内菜单 `.menu` = 260。
7. **`touch-action`**：看板卡片设 `pan-y`，否则横向手势和浏览器回退手势互相抢。
8. **暗色模式**：`tokens.css` 已有 `html[data-theme="dark"]`，新增卡片/底部栏必须用语义令牌（`--surface`、`--border`、`--primary`），**禁止写死 hex**，否则暗色下会瞎。

---

## 11. 桌面端回归清单（每个 PR 都跑一遍）

1. 1440px 下侧栏展开/收起、`Ctrl+B`、鼠标悬停 rail 气泡正常。
2. 看板多列并排、拖卡换列、列折叠、列宽拖拽正常。
3. 列表表格列宽、排序、勾选全选、批量条正常。
4. 甘特图拖条改期、缩放、导出正常。
5. 任务抽屉 680px 居中、保存、子任务、附件上传、评论正常。
6. 顶栏搜索（`Ctrl/⌘+K`）、新建菜单、通知面板、主题切换、快捷键帮助正常。
7. 筛选栏所有 chip 与「更多筛选」弹层正常。
8. 日历月/周切换、新建、拖拽正常。
9. 需求文档树展开、富文本编辑器（SunEditor）工具栏正常。
10. SSE 实时更新（另一浏览器改状态，本端 3 秒内同步）。
11. 离线（DevTools → Offline）能打开壳并提示「离线（只读）」。
12. 平板 768px 下侧栏为 rail、内容双列、无横向滚动。

---

## 12. 附录：与原型稿的 3 处刻意偏离（评审时不要当成 bug）

| 原型 | 实现 | 原因 |
|---|---|---|
| 04 独立全屏任务详情页 | 复用 `#taskDrawer` 全屏化 | 避免两套保存路径导致数据不一致；表单/校验/附件逻辑无法低成本复制 |
| 03 看板列横滑（兼容方案） | 本期不做，只做 02 状态分段 | 横向手势与卡片左滑冲突；单列纵流已覆盖同一批信息 |
| 05 新建任务半屏面板 | 同一个抽屉加 `is-create` 类变矮 | 同上：表单只有一份 |
| 底部 Tab「我的」= 个人中心 | `profile` 页 | 原型里「我的」承担个人数据 + 团队入口；代码侧 `profile` 已存在，不新建 |

---

## 附：本文档对应的原型文件

- Ardot：fileId `744051571112339`（18 屏，含团队/管理者视角、暗色、无权限态）
- PDF：`桌面/工作台/Hourglass-移动端原型-v1.pdf`
- 交互与规则卡在原型画板底部与第 15、18 格

有任何一条与现网代码对不上（函数名、字段名、行号），**以代码为准并在 PR 描述里记一笔**，不要为了贴合文档去改代码结构。
