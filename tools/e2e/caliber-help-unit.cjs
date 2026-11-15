/* 指标口径提示：共享模块行为 + 各页面接线一致性 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

/* ---------- 1. lib/caliber-help.js 运行时行为 ---------- */
function loadModule(){
  let clickHandler = null;
  const pops = [], closes = { count:0 }, created = [];
  const UI = {
    closeAllPops(){ closes.count++; },
    openPop(el, anchor, opts){ pops.push({ el, anchor, opts }); }
  };
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const document = {
    addEventListener(type, fn){ if(type === 'click') clickHandler = fn; },
    createElement(){ const el = { className:'', innerHTML:'', removed:false, remove(){ this.removed = true; } }; created.push(el); return el; }
  };
  const context = vm.createContext({ document, window:{ innerWidth:1200 }, UI, esc, console });
  const source = read('frontend/js/lib/caliber-help.js')
    .replace(/^import .*;\s*$/gm, '')
    .replaceAll('export ', '');
  vm.runInContext(source, context);
  return { context, pops, closes, created, getClick: () => clickHandler };
}

const m = loadModule();
const c = m.context;

const KNOWN = {
  "project.actual": {
    title:'实际投入',
    rows:[["包含什么", "已结束计时 + 补记", "ok"], ["开发 / 测试", "测试窗口内计入测试", "info"]],
    note:'进行中的计时不计。'
  }
};
c.registerHelp(KNOWN);
c.registerHelp(null);
assert.equal(typeof c.caliberMarkHTML, 'function');
assert.equal(typeof c.initCaliberHelp, 'function');

/* mark 形态：普通 ?、警示 !、属性转义、标签可自定义 */
const plain = c.caliberMarkHTML('project.actual', false, '查看「实际投入」口径');
assert.match(plain, /^<button class="caliber-mark" type="button"/);
assert.match(plain, /data-caliber-help="project\.actual"/);
assert.match(plain, /aria-label="查看「实际投入」口径"/);
assert.match(plain, /title="查看「实际投入」口径"/);
assert.match(plain, />\?<\/button>$/);
const warn = c.caliberMarkHTML('project.span', true);
assert.match(warn, /class="caliber-mark warn"/);
assert.match(warn, />!<\/button>$/);
assert.match(warn, /查看口径说明/);
assert.match(c.caliberMarkHTML('k"ey', false, 'a"b'), /data-caliber-help="k&quot;ey"/);
assert.match(c.caliberMarkHTML('k"ey', false, 'a"b'), /aria-label="a&quot;b"/);

/* 弹层正文：标题、行、备注；标题转义 */
const body = c.helpBodyHTML(KNOWN["project.actual"]);
assert.match(body, /<div class="menu-title">实际投入<\/div>/);
assert.match(body, /<span class="mini-tag ok">包含什么<\/span><span class="type-help-desc">已结束计时 \+ 补记<\/span>/);
assert.match(body, /<div class="caliber-note">进行中的计时不计。<\/div>/);
assert.match(c.helpBodyHTML({ title:'a<b', rows:[] }), /<div class="menu-title">a&lt;b<\/div>/);
assert.equal(c.helpBodyHTML(null), '');

/* openHelp：按锚点半屏位置左右展开，宽度 300–460；再次打开前先关旧弹层 */
const leftAnchor = { getBoundingClientRect: () => ({ left:100 }) };
const rightAnchor = { getBoundingClientRect: () => ({ left:900 }) };
c.openHelp(leftAnchor, KNOWN["project.actual"]);
c.openHelp(rightAnchor, KNOWN["project.actual"]);
assert.equal(m.pops.length, 2);
assert.equal(m.pops[0].opts.align, 'left');
assert.equal(m.pops[1].opts.align, 'right');
assert.equal(m.pops[0].opts.width, 460);
assert.equal(m.closes.count, 1, '第二次打开前关闭已有弹层');
assert.match(m.pops[0].el.className, /menu popover type-help-pop caliber-pop/);
m.pops[1].opts.onClose();
assert.equal(m.pops[1].el.removed, true);

/* 窄屏：宽度不低于 300，也不超过屏宽 */
m.context.window.innerWidth = 320;
c.openHelp(leftAnchor, KNOWN["project.actual"]);
assert.equal(m.pops.at(-1).opts.width, 304);
m.context.window.innerWidth = 200;
c.openHelp(leftAnchor, KNOWN["project.actual"]);
assert.equal(m.pops.at(-1).opts.width, 300);

/* 点击代理：只绑定一次，命中已登记 key 才开弹层并阻止冒泡 */
c.initCaliberHelp();
c.initCaliberHelp();
const click = m.getClick();
assert.equal(typeof click, 'function');
const before = m.pops.length, closeBefore = m.closes.count;
const event = (key) => {
  const mark = { dataset:{ caliberHelp:key }, getBoundingClientRect: () => ({ left:100 }) };
  const e = { target:{ closest: sel => sel === '[data-caliber-help]' ? mark : null },
    prevented:false, stopped:false, preventDefault(){ this.prevented = true; }, stopPropagation(){ this.stopped = true; } };
  click(e);
  return e;
};
let ev = event('project.actual');
assert.equal(m.pops.length, before + 1);
assert.equal(ev.prevented, true);
assert.equal(ev.stopped, true);
ev = event('not.registered');
assert.equal(m.pops.length, before + 1, '未登记 key 不弹层');
ev = event('project.actual');
assert.equal(m.closes.count, closeBefore + 2, '代理复用同一弹层通道');

/* ---------- 2. 页面接线：使用到的 key 必须全部登记 ---------- */
function collectDefs(){
  const keys = new Set();
  const sources = {
    'frontend/js/views/project.js':['registerHelp({', '\n});'],
    'frontend/js/views/review.js':['registerHelp({', '\n});'],
    'frontend/js/views/gantt.js':['registerHelp({', '\n});'],
    'frontend/js/core/task-drawer.js':['registerHelp({', '\n});'],
    'frontend/js/views/investment.js':['var HELP = {', '\n};'],
    'frontend/js/views/version.js':['registerHelp({', '\n});'],
    'frontend/js/views/projects.js':['registerHelp({', '\n});'],
    'frontend/js/views/workload.js':['registerHelp({', '\n});'],
    'frontend/js/views/mine.js':['registerHelp({', '\n});'],
    'frontend/js/views/list.js':['registerHelp({', '\n});']
  };
  for(const [file, [marker, closer]] of Object.entries(sources)){
    const src = read(file);
    const start = src.indexOf(marker);
    assert.ok(start > -1, file + ' 应有 ' + marker);
    const from = start + marker.length;
    const end = src.indexOf(closer, from);
    assert.ok(end > from, file + ' 口径登记块应有结尾');
    const block = src.slice(from, end);
    for(const match of block.matchAll(/^\s{2}(?:"([\w.]+)"|([A-Za-z_$][\w$]*))\s*:\s*\{\s*$/gm)){
      keys.add(match[1] || match[2]);
    }
  }
  return keys;
}
const defs = collectDefs();
for(const key of ['project.span','project.estimate','project.actual','project.variance','review.onTime','gantt.load','drawer.actual',
  'crossPeriod','headcount','actual','dev','test','estimate','days','compose','trend','pivot','versionWarn',
  'version.actual','version.estimate','version.remaining','version.variance','version.onTime',
  'version.commit.scope','version.commit.done','version.commit.added','version.commit.removed','version.workSplit',
  'projects.progress','workload.remaining','workload.load','mine.doneRate','mine.load','mine.stats','mine.testQueue',
  'list.progress','list.work','share']){
  assert.ok(defs.has(key), '未登记口径 ' + key);
}

const used = new Set();
const frontendFiles = [];
(function walk(dir){
  for(const name of fs.readdirSync(dir)){
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if(stat.isDirectory()){ walk(full); continue; }
    if(!/\.(js|html)$/.test(name)) continue;
    const rel = path.relative(root, full).replaceAll(path.sep, '/');
    if(rel === 'frontend/js/lib/caliber-help.js') continue;
    frontendFiles.push(rel);
  }
})(path.join(root, 'frontend'));
for(const file of frontendFiles){
  const src = read(file);
  for(const match of src.matchAll(/data-caliber-help="([^"]+)"/g)) used.add(match[1]);
  /* 其余是用 caliberMarkHTML 动态拼出的 key：字面量入参直接收集，变量入参再看具体调用点 */
  for(const match of src.matchAll(/caliberMarkHTML\("([\w.]+)"/g)) used.add(match[1]);
  if(file === 'frontend/js/views/review.js' || file === 'frontend/js/views/investment.js'){
    for(const match of src.matchAll(/\bhelp\s*:\s*"([\w.]+)"/g)) used.add(match[1]);
  }
  if(file === 'frontend/js/views/project.js'){
    for(const match of src.matchAll(/\bmetric\([^;]*?\{key:"(project\.[\w.]+)"/g)) used.add(match[1]);
  }
}
assert.deepEqual([...used].filter(key => !defs.has(key)), [], '有 ? / ! 指向未登记的口径');
for(const key of ['drawer.actual','gantt.load','review.onTime','project.span','project.estimate','project.actual','project.variance']){
  assert.ok(used.has(key), '页面应实际使用 ' + key);
}

/* ---------- 3. 各页面接线形态 ---------- */
const project = read('frontend/js/views/project.js');
assert.match(project, /'<div class="manager-kpi-wrap">'\s*\+ '<button class="manager-kpi" type="button" data-project-metric="' \+ kind \+ '">'/);
assert.match(project, /var mark = help \? caliberMarkHTML\(help\.key, !!help\.warn, "查看「" \+ label \+ "」口径"\) : "";/);
assert.equal((project.match(/\bmetric\("工作项跨度"/g) || []).length, 1);
assert.match(project, /metric\("工作项跨度"[\s\S]{0,300}?"all", \{key:"project\.span", warn:true\}\)/);
assert.match(project, /metric\("预估工时合计"[\s\S]{0,300}?"estimate", \{key:"project\.estimate"\}\)/);
assert.match(project, /metric\("实际投入"[\s\S]{0,300}?"actual", \{key:"project\.actual"\}\)/);
assert.match(project, /metric\("工时偏差[^"]*"[\s\S]{0,300}?"variance", \{key:"project\.variance", warn:true\}\)/);
assert.match(project, /不是项目计划/);
assert.match(project, /不能拿卡片上的总实际与总预估直接算这个百分比/);

const review = read('frontend/js/views/review.js');
assert.match(review, /help:"review\.onTime"/);
assert.match(review, /全部没截止日/);
assert.match(review, /'<div class="stat-wrap">' \+ card \+ caliberMarkHTML\(x\.help, false, "查看「" \+ x\.k \+ "」口径"\) \+ '<\/div>'/);

const gantt = read('frontend/js/views/gantt.js');
const index = read('frontend/index.html');
assert.match(gantt, /"gantt\.load": \{/);
assert.match(gantt, /每周容量 5×8 ?= ?40 ?小时|每周容量/);
assert.match(index, /<strong>成员负载<\/strong>\s*<button class="caliber-mark"[^>]*data-caliber-help="gantt\.load"[^>]*>\?<\/button>/);

const drawerTpl = read('frontend/js/core/templates/task-drawer.js');
assert.equal((drawerTpl.match(/data-caliber-help="drawer\.actual"/g) || []).length, 2, '抽屉读数条与编辑表单各一处');
assert.match(drawerTpl, /class="rf-sub rf-hours-meta"/);
assert.match(read('frontend/js/core/task-drawer.js'), /"drawer\.actual": \{[\s\S]*?补记不算裁剪[\s\S]*?与驾驶舱的关系/);

/* 版本详情：指标格是按钮时只能把标记放在兄弟节点，五张卡都要带 key */
const version = read('frontend/js/views/version.js');
assert.match(version, /function cell\(value, label, tone, drill, help\)/);
assert.match(version, /'<div class="vd-cell-wrap">' \+ inner\s*\+ caliberMarkHTML\(help\.key, !!help\.warn, "查看「" \+ label \+ "」口径"\)/);
assert.match(version, /cell\(hours\(s\.workMinutes\), "已投入工时", "", "logged", \{ key:"version\.actual" \}\)/);
assert.match(version, /cell\(hours\(s\.estimateMinutes\), "预估工时", "", "", \{ key:"version\.estimate" \}\)/);
assert.match(version, /cell\(hours\(s\.remainingMinutes\), "剩余预估", "", "open", \{ key:"version\.remaining", warn:true \}\)/);
assert.match(version, /cell\(pctText\(s\.deviationPct\), "整体偏差", devTone\(s\.deviationPct\), "deviation", \{ key:"version\.variance", warn:true \}\)/);
assert.match(version, /"准时完成率", "", "ontime", \{ key:"version\.onTime" \}\)/);
assert.match(version, /剩余预估是未完成工作项的预估之和，不扣已投入/);
assert.match(read('frontend/css/version.css'), /\.vd-cell-wrap>\.caliber-mark\{position:absolute/);

/* 项目列表：卡片进度与表头进度列各一处，表头不能被 ellipsis 裁掉 */
const projects = read('frontend/js/views/projects.js');
assert.match(projects, /<span style="font-weight:600;color:var\(--text-2\)">' \+ r\.progressPct \+ '%<\/span>' \+\s*caliberMarkHTML\("projects\.progress", false, "查看「项目进度」口径"\)/);
assert.match(projects, /key === "progress" \? caliberMarkHTML\("projects\.progress", false, "查看「项目进度」口径"\) : ""/);
assert.match(projects, /' class="th-help-wrap"'/);
assert.match(read('frontend/css/views.css'), /\.project-table-head > \.th-help-wrap\{display:flex;[^}]*overflow:visible;\}/);

/* 成员负载页：矩阵表头 + 抽屉 KPI */
const workload = read('frontend/js/views/workload.js');
assert.match(workload, /合计剩余' \+ caliberMarkHTML\("workload\.remaining", false, "查看「剩余预估」口径"\)/);
assert.match(workload, /总负载' \+ caliberMarkHTML\("workload\.load", false, "查看「负载」口径"\)/);
assert.equal((workload.match(/caliberMarkHTML\("workload\.remaining"/g) || []).length, 2, '矩阵表头与抽屉各一处');
assert.equal((workload.match(/caliberMarkHTML\("workload\.load"/g) || []).length, 2, '矩阵表头与抽屉各一处');
assert.match(workload, /这里扣了已计工时，两处数字会不一样/);
assert.match(read('frontend/css/manager.css'), /\.member-sheet-kpi>i\.caliber-label\{display:inline-flex/);

/* 我的工作 · 团队视图：完成率与成员负载 */
const mine = read('frontend/js/views/mine.js');
assert.match(mine, /<span class="caliber-label">' \+ range\.label \+ '完成率' \+ caliberMarkHTML\("mine\.doneRate", false, "查看「完成率」口径"\)/);
assert.match(mine, /<h3>成员负载<\/h3>' \+ caliberMarkHTML\("mine\.load", false, "查看「成员负载」口径"\)/);
assert.match(mine, /不是按未完成工作项的预估任务量算/);
assert.match(mine, /统计基于已载入项 · 悬停行显示快捷操作'\s*\+ caliberMarkHTML\("mine\.stats", false, "查看统计条口径"\)/);
assert.match(mine, /含项目内尚未认领的待测队列 · 先到先得'\s*\+ caliberMarkHTML\("mine\.testQueue", false, "查看测试队列口径"\)/);
assert.match(read('frontend/css/mobile.css'), /\.team-hero \.caliber-mark\{border-color:rgba\(255,255,255,\.4\)/);

/* 工作项列表：进度 / 工时列头（标记与排序按钮平级，不能嵌套 button） */
const list = read('frontend/js/views/list.js');
assert.match(list, /var LIST_HEAD_HELP = \{ progress:"list\.progress", work:"list\.work" \};/);
assert.match(list, /var help = LIST_HEAD_HELP\[key\]\s*\? caliberMarkHTML\(LIST_HEAD_HELP\[key\], false, "查看「" \+ labels\[key\] \+ "」口径"\) : "";/);
assert.match(list, /'<span' \+ \(help \? ' class="th-help-wrap"' : ""\)/);
assert.match(list, /不按检查项换算，同一工作项两处可能不一致/);
assert.match(list, /预估工时、进行中和暂停中的计时都不计入/);
assert.match(read('frontend/css/views.css'), /\.list-head > \.th-help-wrap\{display:flex;[^}]*overflow:visible;\}/);

/* 版本承诺基线：四行各带 key；工时拆分脚注一个 */
assert.match(version, /\["冻结范围",[^\]]*"version\.commit\.scope", false\]/);
assert.match(version, /\["基线完成",[^\]]*"version\.commit\.done", true\]/);
assert.match(version, /\["启动后新增",[^\]]*"version\.commit\.added", false\]/);
assert.match(version, /\["基线移出",[^\]]*"version\.commit\.removed", true\]/);
assert.match(version, /<span class="caliber-label">' \+ esc\(r\[0\]\)\s*\+ caliberMarkHTML\(r\[3\], r\[4\], "查看「" \+ r\[0\] \+ "」口径"\)/);
assert.match(version, /caliberMarkHTML\("version\.workSplit", true, "查看工时拆分口径"\)/);
assert.match(version, /分母是冻结时的全部项，后来移出的仍在分母里/);

/* 投资页已迁到共享模块，不应残留旧实现 */
const investment = read('frontend/js/views/investment.js');
const investmentCss = read('frontend/css/investment.css');
assert.match(investment, /registerHelp\(HELP\);/);
assert.doesNotMatch(investment, /data-inv-help|function markHTML|function helpHTML|function openHelp/);
assert.doesNotMatch(investmentCss, /\.inv-mark|\.inv-help-pop/);
assert.match(investmentCss, /\.inv-kpi\.hl \.caliber-mark/);
assert.match(investment, /<th class="num"><span class="th-help-wrap">'\s*\+ \(state\.metric === "act" \? "占比（按实际）" : "占比（按预估）"\)\s*\+ caliberMarkHTML\("share", false, "查看「占比」口径"\)/);
assert.match(investment, /各组占比按最大余数法取整，相加恰好 100%/);
assert.match(investmentCss, /\.inv-tbl th \.th-help-wrap\{display:inline-flex/);
/* 行类名不能落在 base.css 的全局工具类 .row 上，否则 tr 被 flex 化、表体与表头错位 */
assert.match(investment, /<tr class="inv-row" tabindex="0" data-inv-row=/);
assert.doesNotMatch(investment, /<tr class="row"/);
assert.match(investmentCss, /\.inv-tbl tbody tr\.inv-row\{cursor:pointer;\}/);
assert.doesNotMatch(investmentCss, /tr\.row\{/);

/* 样式与离线壳 */
assert.match(read('frontend/css/components.css'), /\.caliber-mark\{/);
assert.match(read('frontend/css/components.css'), /\.caliber-mark\.warn/);
assert.match(read('frontend/css/components.css'), /\.stat-wrap\{position:relative;display:flex/);
assert.match(read('frontend/css/components.css'), /\.caliber-label\{display:inline-flex;align-items:center;gap:4px;\}/);
assert.match(read('frontend/css/manager.css'), /\.manager-kpi-wrap\{position:relative;display:flex/);
assert.match(read('frontend/css/manager.css'), /\.manager-kpi-wrap>\.caliber-mark\{position:absolute/);
const sw = read('frontend/sw.js');
assert.match(sw, /CACHE_NAME\s*=\s*"hourglass-shell-v247"/);
assert.match(sw, /"js\/lib\/caliber-help\.js"/);

console.log('PASS caliber-help: 模块行为 + 39 个口径登记 + 页面接线 + 样式/离线壳');
