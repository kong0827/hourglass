/* list-style-audit · 各列表页的字号/字色/圆形一致性测量（只读，不点击业务控件） */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:8081/hourglass";
const USER = "admin", PASS = "123456";
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const SHOTDIR = process.env.SHOTDIR || "";

const STEPS = [
  { k:"mine", hash:"#/mine", view:"mine", settle:1600 },
  { k:"demands-table", hash:"#/demands", view:"demands", pre:'[data-dem-mode="table"]', restore:'[data-dem-mode="board"]', settle:1200 },
  { k:"projects-table", hash:"#/projects", view:"projects", pre:'[data-project-mode="table"]', restore:'[data-project-mode="card"]', settle:1200 },
  { k:"phase", hash:"#/phase", view:"phase", settle:1600 },
  { k:"branches", hash:"#/branches", view:"branches", settle:1200 },
  { k:"branches-list", hash:"#/branches", view:"branches", pre:'#branchModeSeg [data-br-mode="list"]', restore:'[data-br-mode="board"]', settle:1600 },
  { k:"delivery", hash:"#/delivery", view:"delivery", settle:1000 },
  { k:"tree", hash:"#/tree", view:"tree", settle:1400 },
  { k:"workcolumn", hash:"#/workcolumn?col=doing", view:"workcolumn", settle:1400 },
  { k:"canceled", hash:"#/canceled", view:"canceled", settle:1000 },
  { k:"docs", hash:"#/requirements", view:"requirements", settle:1400 },
  { k:"docs-list", hash:"#/requirements", view:"requirements", pre:'[data-rdmode="tree"]', restore:'[data-rdmode="read"]', settle:1400 },
  { k:"tc-cases", hash:"#/testcases", view:"testcases", settle:1600 },
  { k:"tc-defects", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="defects"]', settle:1200 },
  { k:"tc-plans", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="plans"]', settle:1200 },
  { k:"tc-coverage", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="coverage"]', settle:1200 },
  { k:"tc-report", hash:"#/testcases", view:"testcases", pre:'#subNav [data-sub-tab="report"]', settle:1400 },
  { k:"analysis-completions", hash:"#/analysis", view:"analysis", pre:'#subNav [data-sub-tab="completions"]', settle:1400 },
  { k:"investment", hash:"#/investment", view:"investment", settle:1200 },
  { k:"workload", hash:"#/workload", view:"workload", settle:1200 },
  { k:"risks", hash:"#/risks", view:"risks", settle:1200 },
  { k:"messages", hash:"#/messages", view:"messages", settle:1000 },
  { k:"settings-members", hash:"#/settings", view:"settings", pre:'[data-set-tab="members"]', settle:1400 },
  { k:"settings-visibility", hash:"#/settings", view:"settings", pre:'[data-set-tab="visibility"]', settle:1400 },
  { k:"settings-platform", hash:"#/settings", view:"settings", pre:'[data-set-tab="platform"]', settle:1400 }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const findChrome = () => {
  for (const bin of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return bin;
  }
  throw new Error("no chrome");
};
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener("message", ev => this.onMessage(ev.data)); }
  onMessage(raw) { let m; try { m = JSON.parse(raw); } catch { return; } if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }
  send(method, params = {}, sid) { const id = ++this.id; const p = { id, method, params }; if (sid) p.sessionId = sid; this.ws.send(JSON.stringify(p)); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hg-lsa-"));
const proc = spawn(findChrome(), ["--headless=new", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  proc.stderr.on("data", d => { buf += d.toString(); const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error("devtools timeout")), 15000);
});
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
const cdp = new Cdp(ws);
const t = await cdp.send("Target.createTarget", { url: "about:blank" });
const a = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
const sid = a.sessionId;
for (const d of ["Page", "Runtime"]) await cdp.send(`${d}.enable`, {}, sid);
const call = (m, p) => cdp.send(m, p, sid);
const ev = async expr => {
  const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result ? r.result.value : undefined;
};
const waitFor = async (expr, label, timeout = 20000) => {
  const dl = Date.now() + timeout; let last;
  while (Date.now() < dl) { try { last = await ev(expr); if (last) return last; } catch (e) { last = e.message; } await sleep(150); }
  throw new Error("timeout " + label + " " + JSON.stringify(last));
};

const COLLECT = `(() => {
  const root = document.getElementById("view-" + document.body.dataset.view);
  if(!root) return { err: "no root" };
  const cs = el => getComputedStyle(el);
  const rowSel = "tr, .list-row, .phase-row, .br-row, .doc-row, .tc-row, .cov-row, .rep-row, .member-row, .wl-row, .risk-row, .msg-row, .proj-list-row, .project-table-row, .tree-row, .dem-work-row, .wl-tbl tr";
  const rows = Array.from(root.querySelectorAll(".list-row, .tree-row, .project-table-row, .dem-work-row, .phase-row, .br-row, .doc-row, .tc-row, .cov-row, .rep-row, .member-row, .risk-row, .msg-row, .apn, .vl-row, .dl-row.body, .reqdoc-row, tbody tr"));
  const uniqRows = [];
  rows.forEach(r => { if(uniqRows.indexOf(r) < 0) uniqRows.push(r); });
  rows.length = 0; uniqRows.forEach(r => rows.push(r));
  const buckets = {};
  const leafText = el => {
    if(!el.textContent || !el.textContent.trim()) return false;
    for(const c of el.children){ if(c.textContent && c.textContent.trim()) return false; }
    return true;
  };
  const seen = new Set();
  rows.slice(0, 120).forEach(row => {
    if(seen.has(row)) return; seen.add(row);
    row.querySelectorAll("*").forEach(el => {
      const tag = el.tagName.toLowerCase();
      if(["svg","path","input","i"].indexOf(tag) >= 0) return;
      if(!leafText(el)) return;
      const s = cs(el);
      const k = s.fontSize + "|" + s.fontWeight + "|" + s.color;
      if(!buckets[k]) buckets[k] = { n:0, cls: (typeof el.className === "string" ? el.className : tag), tag, sample: el.textContent.trim().slice(0,10) };
      buckets[k].n++;
    });
  });

  const headers = Array.from(root.querySelectorAll("th")).slice(0,10).map(th => {
    const s = cs(th);
    return { text: (th.textContent||"").trim().slice(0,8), fs:s.fontSize, fw:s.fontWeight, color:s.color, bg:s.backgroundColor, h:th.getBoundingClientRect().height.toFixed(1) };
  });

  const circles = {};
  root.querySelectorAll("*").forEach(el => {
    const s = cs(el);
    const r = s.borderRadius;
    if(!(r === "50%" || parseFloat(r) >= 90)) return;
    const rect = el.getBoundingClientRect();
    if(rect.width < 2 || rect.height < 2 || Math.abs(rect.width - rect.height) > 1.5) return;
    if(rect.width > 80) return;
    const k = rect.width.toFixed(1) + "|" + rect.height.toFixed(1) + "|" + (typeof el.className === "string" ? el.className : el.tagName) + "|" + s.backgroundColor;
    circles[k] = circles[k] || { n:0, w:rect.width.toFixed(1), cls:(typeof el.className === "string" ? el.className : el.tagName), bg:s.backgroundColor, sample:(el.textContent||"").trim().slice(0,6) };
    circles[k].n++;
  });

  const chips = {};
  root.querySelectorAll(".tag, .mini-tag, .badge, .chip, .pill, .ptag, .pdot, .mw-chip, .sel, .state-badge").forEach(el => {
    const row = el.closest(".list-row, .tree-row, .project-table-row, .dem-work-row, .phase-row, .br-row, .doc-row, .tc-row, .cov-row, .rep-row, .member-row, .risk-row, .msg-row, tr");
    if(!row) return;
    const s = cs(el), rect = el.getBoundingClientRect();
    const k = (typeof el.className === "string" ? el.className : el.tagName) + "|" + s.fontSize + "|" + s.fontWeight + "|" + rect.height.toFixed(1) + "|" + s.borderRadius;
    chips[k] = chips[k] || { n:0, cls:(typeof el.className === "string" ? el.className : el.tagName), fs:s.fontSize, fw:s.fontWeight, h:rect.height.toFixed(1), r:s.borderRadius, sample:(el.textContent||"").trim().slice(0,8) };
    chips[k].n++;
  });

  const empties = {};
  rows.slice(0,120).forEach(row => {
    row.querySelectorAll("*").forEach(el => {
      const txt = (el.textContent||"").trim();
      if(["—","未分配","未设置","未填写","待规划","暂无"].indexOf(txt) < 0) return;
      if(el.querySelector("*")) return;
      const s = cs(el);
      const k = txt + "|" + s.fontSize + "|" + s.fontWeight + "|" + s.color + "|" + (typeof el.className === "string" ? el.className : el.tagName);
      empties[k] = empties[k] || { n:0, text:txt, fs:s.fontSize, fw:s.fontWeight, color:s.color, cls:(typeof el.className === "string" ? el.className : el.tagName) };
      empties[k].n++;
    });
  });

  const heights = {};
  rows.slice(0,120).forEach(row => {
    const h = row.getBoundingClientRect().height;
    if(h < 5) return;
    const k = h.toFixed(1);
    heights[k] = (heights[k] || 0) + 1;
  });

  const tables = Array.from(root.querySelectorAll("table")).slice(0,6).map(tb => ({
    cls: tb.className || "", rows: tb.querySelectorAll("tbody tr").length,
    head: !!tb.querySelector("thead"), w: tb.getBoundingClientRect().width.toFixed(0)
  }));

  return {
    rows: rows.length,
    rowCls: rows.length ? (typeof rows[0].className === "string" ? rows[0].className : "") : "",
    buckets, headers, circles, chips, empties, heights, tables,
    title: (document.getElementById("pageTitleText")||{}).textContent || ""
  };
})()`;

await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call("Page.navigate", { url: BASE + "/login.html" });
await waitFor("document.readyState==='complete' && !!document.getElementById('loginForm')", "login");
await ev(`(() => { const set=(id,v)=>{const el=document.getElementById(id);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
  set("uName",${JSON.stringify(USER)}); set("uPass",${JSON.stringify(PASS)}); document.getElementById("btnLogin").click(); return true; })()`);
await waitFor("location.pathname.indexOf('/login')===-1 && document.body.dataset.view", "logged");
await sleep(1200);

if(SHOTDIR) fs.mkdirSync(SHOTDIR, { recursive: true });
const out = [];
for(const st of STEPS){
  if(ONLY.length && !ONLY.includes(st.k)) continue;
  let rec = { k: st.k, ok: false };
  try{
    await ev(`location.hash = ${JSON.stringify(st.hash)}; window.dispatchEvent(new HashChangeEvent("hashchange")); true`);
    await waitFor(`document.body.dataset.view === ${JSON.stringify(st.view)}`, "view " + st.k, 15000);
    await sleep(700);
    if(st.pre){
      await ev(`(() => { const b = document.querySelector(${JSON.stringify(st.pre)}); if(b) b.click(); return !!b; })()`);
      await sleep(800);
    }
    await sleep(st.settle || 1000);
    await waitFor(`(() => { const r = document.getElementById("view-" + document.body.dataset.view);
      return !!r && r.querySelectorAll("tbody tr, .list-row, .tree-row, .project-table-row, .dem-work-row, .phase-row, .br-row, .doc-row, .tc-row, .cov-row, .rep-row, .member-row, .risk-row, .msg-row, .vl-row, .dl-row.body, .reqdoc-row, .apn").length > 0; })()`, "rows " + st.k, 9000).catch(() => false);
    await sleep(500);
    rec = Object.assign(rec, await ev(COLLECT) || {});
    rec.ok = true;
    if(SHOTDIR){
      const shot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(SHOTDIR, st.k + ".png"), Buffer.from(shot.data, "base64"));
    }
    if(st.restore) await ev(`(() => { const b = document.querySelector(${JSON.stringify(st.restore)}); if(b) b.click(); return true; })()`);
  }catch(e){ rec.err = e.message; }
  out.push(rec);
  console.log(st.k.padEnd(22) + (rec.ok ? " rows=" + (rec.rows ?? 0) + " buckets=" + Object.keys(rec.buckets || {}).length + " circles=" + Object.keys(rec.circles || {}).length : " ERR " + rec.err));
}
fs.writeFileSync(process.env.OUT || "/tmp/list-style-audit.json", JSON.stringify(out, null, 1));
try { ws.close(); } catch { }
proc.kill("SIGTERM");
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
process.exit(0);
