/* 树形大纲视图 E2E 验证（仿 tools/e2e/smoke.mjs，Node 18+ 原生 CDP）
   覆盖：入口子导航、树渲染、折叠/展开、层级切换、隐藏已完成、行点击开抽屉、控制台报错。 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "admin123";

function findChrome(){
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);
  for(const bin of candidates){
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if(!r.error && r.status === 0) return bin;
  }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){
    let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }else if(msg.method === "Runtime.exceptionThrown"){
      this.errors.push("exception: " + ((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
    }else if(msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error"){
      this.errors.push("console.error: " + msg.params.args.map(a => a.value || a.description || "").join(" "));
    }else if(msg.method === "Log.entryAdded" && msg.params.entry.level === "error"){
      this.errors.push("log: " + msg.params.entry.text);
    }
  }
  send(method, params = {}, sessionId){
    const id = ++this.id;
    const payload = { id, method, params };
    if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const chrome = findChrome();
const port = 9223;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tree-e2e-"));
const proc = spawn(chrome, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--window-size=1440,900", "--disable-dev-shm-usage"
], { stdio: "ignore" });

let failed = 0;
const pass = m => console.log("  PASS " + m);
const assert = (cond, msg) => { if(!cond){ failed++; console.log("  FAIL " + msg); } else pass(msg); };

try{
  let version = null;
  for(let i = 0; i < 50 && !version; i++){
    try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch(e){ await sleep(200); }
  }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const cdp = new Cdp(ws);
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  for(const d of ["Page", "Runtime", "Log"]) await cdp.send(`${d}.enable`, {}, sessionId);
  const call = (m, p) => cdp.send(m, p, sessionId);
  const evaluate = async expr => {
    const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception || {}).description || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeout = 15000) => {
    const deadline = Date.now() + timeout; let last;
    while(Date.now() < deadline){
      try{ last = await evaluate(expr); if(last) return last; }catch(e){ last = e.message; }
      await sleep(150);
    }
    throw new Error("等待超时：" + label + "（最后：" + JSON.stringify(last) + "）");
  };

  console.log("树形大纲视图 E2E\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("uName", ${JSON.stringify(USER)});
    set("uPass", ${JSON.stringify(PASS)});
    document.getElementById("btnLogin").click();
    return true;
  })()`);
  try{
    await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 12000);
  }catch(e){
    const errMsg = await evaluate(`(document.getElementById("loginErrMsg") || {}).textContent || "(无错误提示)"`);
    throw new Error("登录未完成，页面提示：" + errMsg);
  }
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser && !!rt.currentWs && rt.reqsLoaded)`, "应用初始化", 20000);
  pass("登录 " + USER);

  /* 1. 入口：先确认层级模块没被启动路径拉进来（filters-ui 只按已加载模块刷新，保持懒加载） */
  const preLoad = await evaluate(`performance.getEntriesByType("resource").map(r => r.name).filter(n => /views\\/tree\\.js(\\?|$)/.test(n))`);
  assert(preLoad.length === 0, "未进层级视图前不加载 views/tree.js");
  await evaluate(`location.hash = "#/tree"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "tree"`, "切换到树形视图");
  const subLabels = await evaluate(`[...document.querySelectorAll("#subNav .subnav-item")].map(b => b.textContent.trim()).join(",")`);
  assert(subLabels.includes("层级"), "子导航含「层级」入口（" + subLabels + "）");
  const subOn = await evaluate(`(document.querySelector("#subNav .subnav-item.on") || {}).textContent || ""`);
  assert(subOn.trim() === "层级", "当前子导航高亮为「层级」");

  /* 2. 渲染：等首屏数据 */
  await waitFor(`document.querySelectorAll("#view-tree.on .tree-row").length > 0`, "树形行渲染", 20000);
  const meta = await evaluate(`document.getElementById("treeMeta").textContent`);
  assert(/已加载 \d+ \/ 共 \d+ 项/.test(meta), "计数行（" + meta + "）");
  const totalRows = await evaluate(`document.querySelectorAll("#view-tree .tree-row").length`);
  const nodeRows = await evaluate(`document.querySelectorAll("#view-tree [data-tree-node]").length`);
  const leafRows = await evaluate(`document.querySelectorAll("#view-tree [data-tree-id]").length`);
  assert(totalRows > 0 && leafRows > 0, `渲染 ${totalRows} 行（${nodeRows} 分组 + ${leafRows} 工作项）`);
  assert(nodeRows > 0, "默认一级=项目产生分组节点");

  /* 2b. 缩进与引导线：叶行必须带缩进（曾经被 taskCell 重算覆盖，树是平的）；
     深度≥1 的行要有收口竖线与肘线；行高不能被缩进撑高。 */
  const ind = await evaluate(`(() => {
    const leafDepths = [...document.querySelectorAll("#view-tree [data-tree-id]")].map(r => r.querySelectorAll(".tree-indent").length);
    const deep = [...document.querySelectorAll("#view-tree .tree-row")].filter(r => r.querySelectorAll(".tree-indent").length > 0);
    return {
      leafMin: Math.min(...leafDepths), leafMax: Math.max(...leafDepths),
      flat: leafDepths.filter(d => d === 0).length,
      deep: deep.length,
      elbow: document.querySelectorAll("#view-tree .tree-indent.elbow").length,
      end: document.querySelectorAll("#view-tree .tree-indent.end").length,
      heights: [...document.querySelectorAll("#view-tree .tree-row")].map(r => Math.round(r.getBoundingClientRect().height))
    };
  })()`);
  assert(ind.leafMin >= 2 && ind.flat === 0, `叶行缩进生效（深度 ${ind.leafMin}–${ind.leafMax}，无缩进 ${ind.flat} 行）`);
  assert(ind.elbow >= ind.deep && ind.end >= 1, `引导线收口（${ind.deep} 个缩进行，肘线 ${ind.elbow}，收口 ${ind.end}）`);
  const hMin = Math.min(...ind.heights), hMax = Math.max(...ind.heights);
  assert(hMax - hMin <= 2, `行高一致（${hMin}–${hMax}px）`);

  /* 2c. 父级行只填有聚合口径的列，其余留空占位：既不能铺「—」噪声，也不能少输出单元格（会左移错位） */
  const agg = await evaluate(`(() => {
    const headCells = document.querySelectorAll("#treeHead > span").length;
    const rows = [...document.querySelectorAll("#view-tree [data-tree-node]")];
    return {
      dashes: rows.filter(r => r.textContent.includes("—")).length,
      misaligned: rows.filter(r => r.querySelectorAll(":scope > span").length !== headCells).length,
      cells: headCells, rows: rows.length
    };
  })()`);
  assert(agg.dashes === 0, `父级行无「—」占位噪声（${agg.rows} 个分组行）`);
  assert(agg.misaligned === 0, `父级行单元格与表头对齐（各 ${agg.cells} 格）`);
  /* 密度档位在列表/我的工作/需求页生效，层级行高沿用列表口径，工具条不再挂无效密度控件 */
  const densityGone = await evaluate(`!document.getElementById("treeDensity")`);
  assert(densityGone, "层级工具条不再有无效的密度控件");

  /* 3. 折叠 / 展开 */
  const before = leafRows;
  await evaluate(`document.querySelector("#view-tree [data-tree-node] .tree-caret").click(); true`);
  await sleep(300);
  const afterCollapse = await evaluate(`document.querySelectorAll("#view-tree [data-tree-id]").length`);
  assert(afterCollapse < before, `折叠分组后工作项 ${before} → ${afterCollapse}`);
  await evaluate(`document.getElementById("btnTreeExpand").click(); true`);
  await sleep(300);
  const afterExpand = await evaluate(`document.querySelectorAll("#view-tree [data-tree-id]").length`);
  assert(afterExpand === before, `全部展开后恢复 ${afterExpand}`);
  await evaluate(`document.getElementById("btnTreeCollapse").click(); true`);
  await sleep(300);
  const afterCollapseAll = await evaluate(`document.querySelectorAll("#view-tree [data-tree-id]").length`);
  assert(afterCollapseAll === 0, `全部折叠后剩 ${afterCollapseAll} 个工作项行`);
  await evaluate(`document.getElementById("btnTreeExpand").click(); true`);
  await sleep(300);

  /* 3b. 无障碍：tree 容器 + 每行 aria-level，箭头只是装饰；键盘可遍历且切换后不丢焦点。
     行 DOM 每次切换都会重建，所以按键都打在「当前焦点行」上，再重新取焦点元素判断。 */
  const press = k => evaluate(`(() => {
    const el = document.activeElement;
    if(!el || !el.closest || !el.closest("#treeBody")) return false;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }));
    return true;
  })()`);
  const focusInfo = `(() => {
    const el = document.activeElement;
    if(!el || !el.closest || !el.closest("#treeBody")) return null;
    return { key: el.dataset.treeNode || el.dataset.treeId || "", isNode: el.hasAttribute("data-tree-node"),
      level: Number(el.getAttribute("aria-level")), expanded: el.getAttribute("aria-expanded") };
  })()`;
  const a11y = await evaluate(`(() => {
    const node = document.querySelector("#view-tree [data-tree-node]");
    const leaf = document.querySelector("#view-tree [data-tree-id]");
    node.focus();
    return { bodyRole: document.getElementById("treeBody").getAttribute("role"),
      nodeLevel: node.getAttribute("aria-level"), leafLevel: leaf.getAttribute("aria-level"),
      caretHidden: node.querySelector(".tree-caret").getAttribute("aria-hidden"),
      key: node.dataset.treeNode };
  })()`);
  assert(a11y.bodyRole === "tree" && a11y.nodeLevel === "1" && Number(a11y.leafLevel) >= 2,
    `tree 容器与 aria-level（父级 ${a11y.nodeLevel} 级、叶 ${a11y.leafLevel} 级）`);
  assert(a11y.caretHidden === "true", "装饰性折叠箭头对读屏隐藏（行本身即 treeitem 控件）");
  await press("Enter"); await sleep(250);
  const collapsedFocus = await evaluate(focusInfo);
  assert(!!collapsedFocus && collapsedFocus.key === a11y.key && collapsedFocus.expanded === "false",
    "Enter 折叠后焦点仍在同一分组行（aria-expanded=false）");
  await press("ArrowRight"); await sleep(250);
  const expandedFocus = await evaluate(focusInfo);
  assert(!!expandedFocus && expandedFocus.key === a11y.key && expandedFocus.expanded === "true",
    "→ 展开该分组，焦点保持在原行");
  await press("ArrowDown"); await sleep(150);
  const midFocus = await evaluate(focusInfo);
  assert(!!midFocus && midFocus.key !== a11y.key, `↓ 移到下一行（第 ${midFocus && midFocus.level} 级）`);
  await press("ArrowDown"); await sleep(150);
  const leafFocus = await evaluate(focusInfo);
  assert(!!leafFocus && !leafFocus.isNode, `↓ 继续移到工作项叶行（第 ${leafFocus && leafFocus.level} 级）`);
  await press("ArrowLeft"); await sleep(150);
  const parentFocus = await evaluate(focusInfo);
  assert(!!parentFocus && parentFocus.isNode && parentFocus.level < leafFocus.level,
    `← 从叶行回到上级分组行（第 ${parentFocus && parentFocus.level} 级）`);

  /* 3c. 层级重复：同一维度占两级要提示并回退，不能静默少一层 */
  await evaluate(`(() => {
    const set = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); };
    set("treeLevel1", "version"); set("treeLevel2", "version");
    return true;
  })()`);
  await sleep(400);
  const dup = await evaluate(`(() => ({
    l1: document.getElementById("treeLevel1").value,
    l2: document.getElementById("treeLevel2").value,
    toasts: [...document.querySelectorAll("#toastWrap .toast .tmsg")].map(t => t.textContent)
  }))()`);
  assert(dup.l1 === "version" && dup.l2 === "" && dup.toasts.some(t => t.indexOf("已用作一级") !== -1),
    `重复维度回退并提示（一级=版本，二级=「${dup.l2 || "不分组"}」，提示：${dup.toasts.join(" / ") || "无"}）`);
  await evaluate(`(() => {
    const set = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); };
    set("treeLevel1", "project"); set("treeLevel2", "version"); set("treeLevel3", "");
    return true;
  })()`);
  await sleep(400);
  pass("层级恢复为 项目 → 版本");

  /* 4. 层级切换：一级=模块（结构性维度；状态等流动维度已收敛为不可选） */
  await evaluate(`(() => {
    const sel = document.getElementById("treeLevel1");
    sel.value = "category";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  const catNodes = await evaluate(`[...document.querySelectorAll("#view-tree [data-tree-node] .tree-node")].map(n => n.textContent).join(",")`);
  assert(!!catNodes, "一级切到模块后分组节点：" + catNodes);
  /* 4b. 流动维度（状态）不出现在层级选项里 */
  const l1Opts = await evaluate(`[...document.getElementById("treeLevel1").options].map(o => o.value).join(",")`);
  assert(l1Opts.indexOf("status") === -1 && l1Opts.indexOf("owner") === -1, "层级选项只含结构性维度（" + l1Opts + "）");

  /* 4c. 拍平（三级都选「不分组」，选项值是空串）时不解释父级口径 */
  await evaluate(`(() => {
    ["treeLevel1", "treeLevel2", "treeLevel3"].forEach(function(id){
      var sel = document.getElementById(id);
      sel.value = "";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return true;
  })()`);
  await sleep(300);
  const flatMeta = await evaluate(`document.getElementById("treeMeta").textContent`);
  const flatShown = await evaluate(`document.getElementById("treeLevel1").selectedOptions[0].textContent`);
  const flatIndent = await evaluate(`[...document.querySelectorAll("#view-tree .tree-row")].filter(r => r.querySelectorAll(".tree-indent").length).length`);
  assert(flatShown === "不分组" && flatIndent === 0 && flatMeta.indexOf("父级进度") === -1,
    `不分组时拍平且不解释父级口径（下拉显示「${flatShown}」，${flatMeta}）`);
  await evaluate(`(() => {
    [["treeLevel1", "project"], ["treeLevel2", "version"]].forEach(function(pair){
      var sel = document.getElementById(pair[0]);
      sel.value = pair[1];
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return true;
  })()`);
  await sleep(300);
  const groupedMeta = await evaluate(`document.getElementById("treeMeta").textContent`);
  assert(groupedMeta.indexOf("父级进度") !== -1, "分组时说明父级聚合口径");

  /* 5. 隐藏已完成 */
  await evaluate(`document.getElementById("btnTreeHideDone").click(); true`);
  await sleep(300);
  const pressed = await evaluate(`document.getElementById("btnTreeHideDone").getAttribute("aria-pressed")`);
  const leavesHidden = await evaluate(`document.querySelectorAll("#view-tree [data-tree-id]").length`);
  assert(pressed === "true" && leavesHidden <= before, `隐藏已完成（aria-pressed=${pressed}，剩余 ${leavesHidden} 项）`);
  await evaluate(`document.getElementById("btnTreeHideDone").click(); true`);
  await sleep(300);

  /* 5b. 筛选联动：条件变化后树必须换一版数据，清空后恢复 */
  await evaluate(`import("./js/core/filters.js").then(m => { m.toggleFilterValue("pris", "P0"); })`);
  await waitFor(`document.getElementById("treeMeta").textContent.indexOf("当前视图") !== -1`, "筛选后树刷新", 8000);
  const filtered = await evaluate(`({
    meta: document.getElementById("treeMeta").textContent,
    leaves: document.querySelectorAll("#view-tree [data-tree-id]").length
  })`);
  assert(filtered.leaves < before, `筛选后树刷新（${before} → ${filtered.leaves} 项）`);
  await evaluate(`import("./js/core/filters-ui.js").then(m => { m.clearFilters(); })`);
  await waitFor(`document.querySelectorAll("#view-tree [data-tree-id]").length === ${before}`, "清空筛选后树恢复", 8000);
  pass(`清空筛选后树恢复 ${before} 项`);

  /* 5c. 空态 CTA：筛到无结果后「查看全部工作项」要真的清掉条件（曾经只重置隐藏已完成，点了没反应） */
  await evaluate(`Promise.all([
    import("./js/core/state.js"), import("./js/core/filters-ui.js")
  ]).then(([s, f]) => { s.state.q = "zzzz-不存在的关键词"; f.reloadFilteredViews(); })`);
  await waitFor(`!!document.querySelector("#view-tree [data-empty-action]")`, "树形空态", 10000);
  const emptyMeta = await evaluate(`document.getElementById("treeMeta").textContent`);
  assert(emptyMeta.indexOf("父级进度") === -1, `空结果时不解释父级口径（${emptyMeta}）`);
  const ctaLabel = await evaluate(`(document.querySelector("#view-tree [data-empty-action]") || {}).textContent || ""`);
  await evaluate(`document.querySelector("#view-tree [data-empty-action]").click(); true`);
  await waitFor(`document.querySelectorAll("#view-tree [data-tree-id]").length === ${before}`, "空态 CTA 后恢复全量", 10000);
  const qAfterCta = await evaluate(`import("./js/core/state.js").then(s => s.state.q)`);
  assert(qAfterCta === "", `空态 CTA「${ctaLabel}」清空筛选条件并恢复 ${before} 项`);

  /* 6. 点击工作项行打开详情抽屉 */
  await evaluate(`document.querySelector("#view-tree [data-tree-id]").click(); true`);
  await waitFor(`(() => { const d = document.getElementById("taskForm"); return d && d.offsetWidth > 0; })()`, "详情抽屉打开", 8000);
  const drawerTitle = await evaluate(`(document.getElementById("dTitle") || {}).value || (document.getElementById("taskForm").querySelector("h2,h3") || {}).textContent || ""`);
  pass("抽屉打开（标题：" + String(drawerTitle).slice(0, 30) + "…）");
  await evaluate(`(document.getElementById("drawerClose") || document.querySelector("#taskForm .drawer-x") || {click(){}}).click(); true`);
  await sleep(300);

  /* 7. 切走再切回（懒加载与状态保持） */
  await evaluate(`location.hash = "#/list"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "list"`, "切到列表");
  await evaluate(`location.hash = "#/tree"; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
  await waitFor(`document.body.dataset.view === "tree" && document.querySelectorAll("#view-tree .tree-row").length > 0`, "切回树形", 15000);
  pass("列表 ↔ 树形往返正常");

  /* 7b. 手机端：树改用卡片行，容器与页面都不能出现横向裁切 */
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await waitFor(`document.querySelectorAll("#view-tree .tree-mob-row").length > 0`, "手机端树行渲染", 8000);
  const mob = await evaluate(`(() => {
    const sc = document.querySelector("#view-tree .list-scroll");
    return {
      rows: document.querySelectorAll("#view-tree .tree-mob-row").length,
      deskRows: document.querySelectorAll("#view-tree .tree-row").length,
      scrollW: sc.scrollWidth, clientW: sc.clientWidth,
      docW: document.documentElement.scrollWidth, innerW: window.innerWidth
    };
  })()`);
  assert(mob.rows > 0 && mob.deskRows === 0, `手机端改用卡片行（${mob.rows} 行）`);
  assert(mob.scrollW <= mob.clientW + 1 && mob.docW <= mob.innerW + 1, `手机端无横向裁切（列表 ${mob.scrollW}/${mob.clientW}，页面 ${mob.docW}/${mob.innerW}）`);
  await call("Emulation.clearDeviceMetricsOverride", {});
  await waitFor(`document.querySelectorAll("#view-tree .tree-row").length > 0`, "恢复桌面树行", 8000);

  /* 8. 截图 + 控制台报错 */
  const shot = await call("Page.captureScreenshot", { format: "png" });
  const out = "/tmp/tree-view-e2e.png";
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("  截图：" + out);
  const errs = cdp.errors.filter(e => e.indexOf("favicon") === -1);
  assert(errs.length === 0, "控制台无报错" + (errs.length ? "（实际：" + errs.join(" | ").slice(0, 300) + "）" : ""));
}catch(e){
  failed++;
  console.log("  ERROR " + e.message);
}finally{
  try{ proc.kill("SIGKILL"); }catch(e){}
  try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){}
}
console.log(failed ? `\n结果：${failed} 项失败` : "\n结果：全部通过");
process.exit(failed ? 1 : 0);
