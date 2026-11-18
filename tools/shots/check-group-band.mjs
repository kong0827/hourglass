/* 校验「列头 vs 分组行同色」修复：8 处撞色站点
   1) 合成级联探针：在真实页面里按真实类名结构建 DOM，读 getComputedStyle，确认列头与分组行底色已区分、
      分组行带 3px 主色条（不依赖各视图的分组开关状态，结果确定）。
   2) 实机走查 + 截图：项目表格 / 工作项列表 / 需求池列表 / 分支列表，打开分组后截图与探针。
   用法：node tools/shots/check-group-band.mjs */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.E2E_BASE || "http://127.0.0.1:8081/hourglass").replace(/\/+$/, "");
const USER = process.env.E2E_USER || "admin";
const PASS = process.env.E2E_PASS || "123456";
const OUT = "/Users/kongxiangjin/Documents/沙漏/内部资料/uiux-review-20261118/分组带配色-实施后";

function findChrome(){
  const candidates = [process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  for(const bin of candidates){ const r = spawnSync(bin, ["--version"], { encoding: "utf8" }); if(!r.error && r.status === 0) return bin; }
  throw new Error("找不到 Chrome");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw){ let msg; try{ msg = JSON.parse(raw); }catch(e){ return; }
    if(msg.id && this.pending.has(msg.id)){ const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); } }
  send(method, params = {}, sessionId){ const id = ++this.id; const payload = { id, method, params }; if(sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload)); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}

/* 合成探针：站点名 → { wrap: 外层 HTML 包裹（含祖先 id/class）, head: 列头选择器, band: 分组行选择器 } */
const SITES = [
  { key:"项目表格 / 项目集行", wrap:'<div class="project-table-wrap"><div class="project-table">',
    head:".project-table-head", band:".project-table-row.project-set-row",
    html:'<div class="project-table-head"><span>项目</span></div>'
       + '<div class="project-table-row project-set-row"><span>项目集 A</span></div>'
       + '<div class="project-table-row project-set-row is-ungrouped"><span>未分组</span></div>'
       + '<div class="project-table-row"><span>项目 1</span></div></div></div>',
    extra:{ ungrouped:".project-set-row.is-ungrouped", row:".project-table-row:not(.project-set-row)" } },
  { key:"项目集总览 pf-set-row", wrap:'<section class="manager-panel"><div class="tbl-wrap">',
    head:".manager-tbl th", band:"tr.pf-set-row td",
    html:'<table class="manager-tbl"><thead><tr><th>项目</th><th>状态</th></tr></thead><tbody>'
       + '<tr class="pf-set-row"><td colspan="2">项目集 A · 3 个项目</td></tr>'
       + '<tr><td>项目 1</td><td>进行中</td></tr></tbody></table></div></section>' },
  { key:"驾驶舱下钻 drill-group", wrap:'<section class="manager-panel"><div class="tbl-wrap">',
    head:".manager-tbl th", band:"tr.drill-group > td",
    html:'<table class="manager-tbl manager-drill-tbl"><thead><tr><th>名称</th><th>状态</th></tr></thead><tbody>'
       + '<tr class="drill-group"><td>模块 A</td><td>进行中</td></tr>'
       + '<tr data-open-task="1"><td>工作项 1</td><td>待处理</td></tr></tbody></table></div></section>' },
  { key:"项目驾驶舱 pc-group", wrap:'<section class="manager-panel"><div class="tbl-wrap">',
    head:".manager-tbl th", band:".pc-group td",
    html:'<table class="manager-tbl pc-tbl pc-tbl-demand"><thead><tr><th>需求</th><th>状态</th></tr></thead><tbody>'
       + '<tr class="pc-group"><td colspan="2"><span class="pc-group-name">待评审</span></td></tr>'
       + '<tr><td>需求 1</td><td>待评审</td></tr></tbody></table></div></section>' },
  { key:"需求池列表 dem-group-row", wrap:'<div id="probe-view-demands"><section class="manager-panel"><div class="tbl-wrap">',
    head:".manager-tbl th", band:".dem-group-row", barSel:".dem-group-row > td",
    html:'<table class="manager-tbl"><thead><tr><th>需求</th><th>状态</th></tr></thead><tbody>'
       + '<tr class="dem-group-row"><td colspan="2"><button class="dem-group-toggle" type="button">待评审</button></td></tr>'
       + '<tr class="dem-group-item-row"><td>需求 1</td><td>待评审</td></tr>'
       + '<tr class="dem-subgroup-row"><td colspan="2">二级组</td></tr></tbody></table></div></section></div>',
    ancestorId:"view-demands", extra:{ sub:".dem-subgroup-row" } },
  { key:"分支列表 br-group-row", wrap:'<div class="br-groups br-list-mode"><div class="br-list-wrap">',
    head:".manager-tbl th", band:"tr.br-group-row td",
    html:'<table class="manager-tbl br-list"><thead><tr><th class="br-sel-cell"></th><th>分支</th><th>状态</th></tr></thead><tbody>'
       + '<tr class="br-group-row"><td colspan="3"><span class="bgr-name">开发中</span></td></tr>'
       + '<tr><td></td><td>feature/a</td><td>开发中</td></tr></tbody></table></div></div>' },
  { key:"工作项列表 list-group-row", wrap:'<div id="probe-view-list"><div class="list-body">',
    head:".list-head", band:".list-group-row", barSel:".list-group-row > button",
    html:'<div class="list-head"><span>标题</span><span>状态</span></div>'
       + '<div class="list-group-row"><button type="button"><span class="list-group-name">项目 A</span></button></div>'
       + '<div class="list-subgroup-row"><button type="button"><span class="list-subgroup-name">二级</span></button></div>'
       + '<div class="list-row"><span>工作项 1</span></div></div></div>',
    ancestorId:"view-list", extra:{ sub:".list-subgroup-row" } },
  { key:"权限矩阵 perm-group", wrap:'<div class="perm-sect"><div class="tbl-wrap">',
    head:".manager-tbl thead th", band:".perm-group th",
    html:'<table class="manager-tbl perm-matrix"><thead><tr><th>操作</th><th>负责人</th></tr></thead><tbody>'
       + '<tr class="perm-group"><th colspan="2" scope="colgroup">项目权限</th></tr>'
       + '<tr><th scope="row">编辑项目</th><td class="perm-cell"><span class="perm-mark yes">✓</span></td></tr></tbody></table></div></div>' },
];

const chrome = findChrome();
const port = Number(process.env.E2E_CDP_PORT || 9413);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "group-band-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + tmp,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--window-size=1440,1000", "--disable-dev-shm-usage"],
  { stdio: "ignore", detached: true });
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const log = (ok, label, note) => { ok ? pass++ : fail++; console.log((ok ? "  PASS " : "  FAIL ") + label + (note ? " — " + note : "")); };

async function main(){
  let version = null;
  for(let i=0;i<60 && !version;i++){ try{ version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }catch(e){ await sleep(200); } }
  if(!version) throw new Error("Chrome CDP 未就绪");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.addEventListener("open",res); ws.addEventListener("error",rej); });
  const cdp = new Cdp(ws);
  const errors = [];
  const t = await cdp.send("Target.createTarget", { url: "about:blank" });
  const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  for(const d of ["Page","Runtime","Log"]) await cdp.send(`${d}.enable`, {}, sid);
  cdp.ws.addEventListener("message", ev => { let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
    if(m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error" && m.params.sessionId === sid)
      errors.push((m.params.args||[]).map(x => x.value || x.description || "").join(" "));
    if(m.method === "Log.entryAdded" && m.params && m.params.entry && m.params.entry.level === "error")
      errors.push(m.params.entry.text || ""); });
  const call = (m,p) => cdp.send(m,p,sid);
  const evaluate = async expr => { const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if(res.exceptionDetails) throw new Error("执行失败：" + ((res.exceptionDetails.exception||{}).description||res.exceptionDetails.text));
    return res.result ? res.result.value : undefined; };
  const waitFor = async (expr,label,timeout=20000) => { const dl = Date.now()+timeout; let last;
    while(Date.now()<dl){ try{ last = await evaluate(expr); if(last) return last; }catch(e){ last=e.message; } await sleep(150); }
    throw new Error("等待超时："+label+"（最后："+JSON.stringify(last)+"）"); };
  const metrics = (w,h,mobile) => call("Emulation.setDeviceMetricsOverride", { width:w, height:h, deviceScaleFactor:2, mobile:!!mobile });
  const nav = async (hash,waitExpr,timeout=18000) => { await evaluate(`(() => { location.hash=${JSON.stringify(hash)}; window.dispatchEvent(new HashChangeEvent("hashchange")); return true; })()`);
    try{ await waitFor(waitExpr,"导航 "+hash,timeout); }catch(e){ console.log("  WARN 导航未确认 "+hash+" => "+e.message); } await sleep(600); };
  const shot = async (file, {clip} = {}) => { const r = await call("Page.captureScreenshot", { format:"png", captureBeyondViewport:false, ...(clip?{clip}:{}) });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data,"base64")); console.log("  截图 " + file); };
  const pick = async (sel, value) => evaluate(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); if(!s) return "no-select";
    const opts = [...s.options].map(o => o.value);
    const v = ${JSON.stringify(value)} || opts.find(x => x && x !== "none") || opts[1];
    if(!v) return "no-option";
    s.value = v; s.dispatchEvent(new Event("change", { bubbles:true })); return v; })()`);

  console.log("分组带配色修复·校验\n  地址：" + BASE);
  await call("Page.navigate", { url: BASE + "/login.html" });
  await waitFor("document.readyState === 'complete' && !!document.getElementById('loginForm')", "登录页");
  await evaluate(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
    set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return true; })()`);
  await waitFor("location.pathname.indexOf('/login') === -1 && document.body && document.body.dataset.view", "登录完成", 15000);
  await waitFor(`import("./js/core/state.js").then(({rt}) => !!rt.currentUser)`, "应用初始化");
  await metrics(1440, 1000, false);

  /* ---------- 1. 合成级联探针（8 站点） ---------- */
  console.log("\n[1] 合成级联探针：列头 vs 分组行");
  const probe = await evaluate(`(() => {
    const sites = ${JSON.stringify(SITES)};
    const host = document.createElement("div");
    host.id = "probe-group-band";
    host.setAttribute("style", "position:fixed;left:-9999px;top:0;width:1200px;");
    document.body.appendChild(host);
    const out = [];
    for(const s of sites){
      /* 需要祖先 id（#view-list / #view-demands）的站点，用真实视图作祖先；否则用 wrap */
      let root = host;
      if(s.ancestorId){
        const real = document.getElementById(s.ancestorId);
        root = real || host;
      }
      const box = document.createElement("div");
      box.innerHTML = s.wrap + s.html;
      (root === host ? host : root).appendChild(box);
      const scope = box;
      const q = sel => scope.querySelector(sel);
      const bg = el => el ? getComputedStyle(el).backgroundColor : null;
      const bar = el => el ? (getComputedStyle(el).boxShadow || "").replace(/\\s+/g," ") : null;
      const head = q(s.head), band = q(s.band);
      const rec = { key:s.key, headBg:bg(head), bandBg:bg(band), bandBar:bar(q(s.barSel || s.band)),
                    distinct: !!head && !!band && bg(head) !== bg(band),
                    hasBar: /3px 0(px)? 0(px)? 0(px)? inset/.test(bar(q(s.barSel || s.band)) || "") };
      if(s.extra){
        rec.extra = {};
        for(const k in s.extra){ const el = q(s.extra[k]); rec.extra[k] = el ? bg(el) : null; }
      }
      out.push(rec);
      box.remove();
    }
    host.remove();
    return out;
  })()`);
  for(const p of probe){
    log(p.distinct, p.key + " 底色已区分", "列头 " + p.headBg + " / 分组行 " + p.bandBg);
    log(p.hasBar, p.key + " 分组行带主色条", p.bandBar || "(无 box-shadow)");
    if(p.extra){
      for(const k in p.extra){
        const v = p.extra[k];
        log(v && v !== p.bandBg, p.key + " · " + k + " 与分组行不同色", String(v));
      }
    }
  }

  /* ---------- 2. 实机走查 ---------- */
  console.log("\n[2] 实机走查");
  /* 2a 项目页表格 */
  await nav("#/projects", `document.body.dataset.view === "projects"`);
  try{
    await waitFor(`!!document.querySelector('[data-project-mode="table"]')`, "视图切换按钮", 10000);
    await evaluate(`(() => { const b = document.querySelector('[data-project-mode="table"]'); if(b) b.click(); return true; })()`);
    await waitFor(`!!document.querySelector(".project-table-head") && !!document.querySelector(".project-set-row")`, "项目表头与项目集行", 12000);
    await sleep(300);
    const r = await evaluate(`(() => { const cs = el => getComputedStyle(el);
      const h = document.querySelector(".project-table-head"), s = document.querySelector(".project-set-row:not(.is-ungrouped)") || document.querySelector(".project-set-row");
      const u = document.querySelector(".project-set-row.is-ungrouped"), p = document.querySelector(".project-table-row:not(.project-set-row)");
      return { head:cs(h).backgroundColor, headBorder:cs(h).borderBottomColor, set:cs(s).backgroundColor, setBar:cs(s).boxShadow,
               ungrouped:u?cs(u).backgroundColor:null, row:p?cs(p).backgroundColor:null }; })()`);
    log(r.head !== r.set, "项目页：列头与项目集行不同色", "列头 " + r.head + " / 项目集 " + r.set);
    log(/3px 0(px)? 0(px)? 0(px)? inset/.test(r.setBar || ""), "项目页：项目集行左侧主色条", r.setBar);
    log(!r.ungrouped || (r.ungrouped !== r.set && r.ungrouped !== r.head), "项目页：未分组带与两者均不同色", String(r.ungrouped));
    log(r.headBorder === "rgb(215, 220, 228)", "项目页：列头下边框已加深", r.headBorder);
    await shot("01-项目页-表格分组带.png");
    const clip = await evaluate(`(() => { const w = document.querySelector(".project-table-wrap"); const r = w.getBoundingClientRect();
      return { x: Math.max(0,Math.round(r.left)), y: Math.max(0,Math.round(r.top)), width: Math.round(Math.min(r.width, 1400)), height: Math.round(Math.min(r.height, 520)), scale: 2 }; })()`);
    await shot("02-项目表格-局部.png", { clip });
  }catch(e){ log(false, "项目页表格走查", e.message); }

  /* 2b 工作项列表分组 */
  await nav("#/list", `document.body.dataset.view === "list"`);
  try{
    await waitFor(`!!document.getElementById("view-list")`, "工作项列表视图", 12000);
    const g = await pick("[data-list-group]", null);
    console.log("  分组维度：" + g);
    await waitFor(`!!document.querySelector("#view-list .list-group-row")`, "列表分组行", 12000);
    await sleep(300);
    const r = await evaluate(`(() => { const cs = el => getComputedStyle(el);
      const h = document.querySelector("#view-list .list-head"), g = document.querySelector("#view-list .list-group-row"), b = g.querySelector("button");
      return { head:cs(h).backgroundColor, headBorder:cs(h).borderBottomColor, band:cs(g).backgroundColor, bar:cs(b).boxShadow }; })()`);
    log(r.head !== r.band, "工作项列表：列头与分组行不同色", "列头 " + r.head + " / 分组 " + r.band);
    log(/3px 0(px)? 0(px)? 0(px)? inset/.test(r.bar || ""), "工作项列表：分组行左侧主色条", r.bar);
    log(r.headBorder === "rgb(215, 220, 228)", "工作项列表：列头下边框已加深", r.headBorder);
    await shot("03-工作项列表-分组带.png");
  }catch(e){ log(false, "工作项列表走查", e.message); }

  /* 2c 需求池列表分组 */
  await nav("#/demands", `document.body.dataset.view === "demands"`);
  try{
    await waitFor(`!!document.querySelector('[data-dem-mode="table"]')`, "需求池视图切换", 12000);
    await evaluate(`(() => { document.querySelector('[data-dem-mode="table"]').click(); return true; })()`);
    await sleep(600);
    const g = await pick("[data-dem-group]", null);
    console.log("  分组维度：" + g);
    await waitFor(`!!document.querySelector("#view-demands .dem-group-row")`, "需求池分组行", 12000);
    await sleep(300);
    const r = await evaluate(`(() => { const cs = el => getComputedStyle(el);
      const h = document.querySelector("#view-demands .manager-tbl th"), g = document.querySelector("#view-demands .dem-group-row"), td = g.querySelector("td");
      return { head:cs(h).backgroundColor, band:cs(g).backgroundColor, bar:cs(td).boxShadow }; })()`);
    log(r.head !== r.band, "需求池列表：列头与分组行不同色", "列头 " + r.head + " / 分组 " + r.band);
    log(/3px 0(px)? 0(px)? 0(px)? inset/.test(r.bar || ""), "需求池列表：分组行左侧主色条", r.bar);
    await shot("04-需求池列表-分组带.png");
  }catch(e){ log(false, "需求池列表走查", e.message); }

  /* 2d 分支列表分组 */
  await nav("#/branches", `document.body.dataset.view === "branches"`);
  try{
    await waitFor(`!!document.querySelector('[data-br-mode="list"]')`, "分支视图切换", 12000);
    await evaluate(`(() => { document.querySelector('[data-br-mode="list"]').click(); return true; })()`);
    await sleep(800);
    const g = await pick("#branchListGroup", "status");
    console.log("  分组维度：" + g);
    await waitFor(`!!document.querySelector(".br-list tr.br-group-row")`, "分支分组行", 15000);
    await sleep(300);
    const r = await evaluate(`(() => { const cs = el => getComputedStyle(el);
      const h = document.querySelector(".br-list thead th"), g = document.querySelector(".br-list tr.br-group-row td");
      return { head:cs(h).backgroundColor, band:cs(g).backgroundColor, bar:cs(g).boxShadow }; })()`);
    log(r.head !== r.band, "分支列表：列头与分组行不同色", "列头 " + r.head + " / 分组 " + r.band);
    log(/3px 0(px)? 0(px)? 0(px)? inset/.test(r.bar || ""), "分支列表：分组行左侧主色条", r.bar);
    await shot("05-分支列表-分组带.png");
  }catch(e){ log(false, "分支列表走查", e.message); }

  /* 2e 项目集总览（全局健康度）pf-set-row */
  await nav("#/portfolio", `document.body.dataset.view === "portfolio"`);
  try{
    const switched = await evaluate(`(() => { const b = document.querySelector('[data-pf-mode="table"]'); if(b){ b.click(); return true; } return false; })()`);
    console.log("  项目集总览切表格模式：" + switched);
    await sleep(600);
    await waitFor(`!!document.querySelector(".manager-tbl tbody tr.pf-set-row")`, "项目集分组行", 15000);
    await sleep(300);
    const r = await evaluate(`(() => { const cs = el => getComputedStyle(el);
      const h = document.querySelector("#view-portfolio .manager-tbl th, .manager-tbl th"), g = document.querySelector(".manager-tbl tbody tr.pf-set-row td");
      return { head:cs(h).backgroundColor, band:cs(g).backgroundColor, bar:cs(g).boxShadow }; })()`);
    log(r.head !== r.band, "项目集总览：列头与项目集行不同色", "列头 " + r.head + " / 项目集 " + r.band);
    log(/3px 0(px)? 0(px)? 0(px)? inset/.test(r.bar || ""), "项目集总览：项目集行左侧主色条", r.bar);
    await shot("06-项目集总览-分组带.png");
  }catch(e){ console.log("  SKIP 项目集总览实机走查（当前空间可能没有项目集）：" + e.message); }

  /* ---------- 3. 深色主题 ---------- */
  console.log("\n[3] 深色主题下的分组带");
  try{
    const dark = await evaluate(`(() => { document.documentElement.setAttribute("data-theme","dark");
      const host = document.createElement("div"); host.style.cssText = "position:fixed;left:-9999px;top:0;width:900px";
      host.innerHTML = ${JSON.stringify(SITES[0].wrap + SITES[0].html)};
      document.body.appendChild(host);
      const cs = el => getComputedStyle(el).backgroundColor;
      const h = host.querySelector(".project-table-head"), s = host.querySelector(".project-set-row:not(.is-ungrouped)"), u = host.querySelector(".is-ungrouped");
      const out = { head:cs(h), set:cs(s), ungrouped:u?cs(u):null };
      host.remove(); document.documentElement.removeAttribute("data-theme"); return out; })()`);
    log(dark.head !== dark.set, "深色：列头与分组行不同色", "列头 " + dark.head + " / 分组 " + dark.set);
    log(!dark.ungrouped || dark.ungrouped !== dark.set, "深色：未分组带与分组带不同色", String(dark.ungrouped));
  }catch(e){ log(false, "深色主题探针", e.message); }

  /* ---------- 4. 控制台 ---------- */
  const real = errors.filter(e => !/favicon|net::|Failed to load|404/i.test(e || ""));
  log(real.length === 0, "无应用源控制台错误", real.slice(0,3).join(" | ") || "(空)");

  console.log("\n合计：" + pass + " PASS / " + fail + " FAIL；截图目录 " + OUT);
  try{ cdp.ws.close(); }catch(e){}
}
main().then(()=>console.log("完成")).catch(e=>console.error("SCRIPT ERROR:", e.message)).finally(()=>{
  try{ process.kill(-proc.pid, "SIGKILL"); }catch(e){ try{ proc.kill("SIGKILL"); }catch(_){} }
  try{ fs.rmSync(tmp, { recursive:true, force:true }); }catch(e){}
  process.exit(0);
});
