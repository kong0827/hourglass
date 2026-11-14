/* 检查项重排的真实函数源 VM 回归：无浏览器/服务端/数据库。
   覆盖 E2E 难以稳定触发的并发边界：
     ① 手势排队：上一笔回包不能盖掉排队中的新手势，队列末尾再发一次；
     ② 失败只还原顺序：勾选/标题以当前缓存为准，不复活旧快照里的状态；
     ③ 顺序没变（只点一下把手）不发请求；边界按键不发请求；只读不响应。
   用法：node tools/e2e/subtask-sort-unit.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "frontend/js/core/task-drawer.js"), "utf8");
const FROM = "/* ---- 检查项重排：";
const TO = "/* 概览检查项也能直接勾";
const start = source.indexOf(FROM), end = source.indexOf(TO, start + FROM.length);
assert.ok(start >= 0 && end > start, "真实函数源边界缺失：检查项重排块");
const block = source.slice(start, end);

let passed = 0;
function ok(name){ passed++; console.log("  PASS " + name); }
function deferred(){ let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; }
async function flush(){ for(let i = 0; i < 20; i++) await Promise.resolve(); }

function harness(){
  const posts = [], toasts = [], lives = [], focused = [];
  let children = [], renderReadCalls = 0;
  const gripOf = id => ({ dataset:{ subGrip:String(id) }, focus(){ focused.push(id); }, setPointerCapture(){},
    closest:sel => sel === ".sub-item" ? rowOf(id) : null, getBoundingClientRect:() => ({ top:0, height:30 }) });
  const rowOf = id => {
    const row = children.filter(r => r.id === id)[0];
    return row || null;
  };
  const makeRow = s => ({ id:s.id, dataset:{ sub:String(s.id) }, dragging:false,
    getAttribute:n => n === "data-sub" ? String(s.id) : null,
    classList:{ add(n){ if(n === "dragging") this._drag = true; }, remove(n){ if(n === "dragging") this._drag = false; }, contains(){ return false; } },
    querySelector:sel => sel.indexOf("data-sub-grip") >= 0 ? gripOf(s.id) : null,
    getBoundingClientRect:() => ({ top:0, height:30 }) });
  const subList = {
    listeners:{},
    addEventListener(name, fn){ (this.listeners[name] ||= []).push(fn); },
    dispatch(name, ev){ for(const fn of this.listeners[name] || []) fn(ev); },
    querySelectorAll(sel){ return sel.indexOf(":not(.dragging)") >= 0 ? children.filter(r => !r.classList._drag) : children.slice(); },
    querySelector(sel){ const m = /\[data-sub-grip="(\d+)"\]/.exec(sel); return m ? gripOf(Number(m[1])) : null; },
    insertBefore(node, ref){ children = children.filter(r => r !== node); const i = children.indexOf(ref); children.splice(i < 0 ? children.length : i, 0, node); },
    appendChild(node){ children = children.filter(r => r !== node); children.push(node); },
    classList:{ add(){}, remove(){} }
  };
  const rt = { editingId:"T1", drawerReadOnly:false, subtasksCache:[] };
  const API = { post(url, body){ const d = deferred(); posts.push({ url, ids:Array.from(body.ids), d }); return d.promise; } };
  const globals = {
    console, rt, subList, API,
    $: id => id === "subLive" ? { set textContent(v){ lives.push(v); }, get textContent(){ return lives[lives.length - 1] || ""; } } : null,
    renderSubtasks(list){ rt.subtasksCache = list; children = list.map(makeRow); },
    renderReadView(){ renderReadCalls++; },
    toast(msg, kind){ toasts.push({ msg, kind }); }
  };
  vm.createContext(globals);
  vm.runInContext(block, globals, { filename:"task-drawer.js#subtask-sort" });
  const seed = list => { rt.subtasksCache = list.map(s => Object.assign({}, s)); children = rt.subtasksCache.map(makeRow); };
  const key = (id, k) => subList.dispatch("keydown", { key:k, preventDefault(){}, target:{ closest:sel => sel === "[data-sub-grip]" ? gripOf(id) : null } });
  const down = id => subList.dispatch("pointerdown", { button:0, pointerId:1, preventDefault(){}, target:{ closest:sel => sel === "[data-sub-grip]" ? gripOf(id) : null } });
  const up = () => subList.dispatch("pointerup", {});
  return { rt, posts, toasts, lives, focused, seed, key, down, up,
    order:() => Array.from(rt.subtasksCache.map(s => s.id)),
    domOrder:() => Array.from(children.map(r => r.id)),
    readRenders:() => renderReadCalls,
    moveRowBefore:(id, refId) => subList.insertBefore(rowOf(id), rowOf(refId)) };
}
const S = [
  { id:1, title:"联调回调地址", done:true },
  { id:2, title:"准备测试数据", done:true },
  { id:3, title:"补充灰度开关说明", done:false }
];

(async () => {
  console.log("[1] 手势排队：旧回包不盖掉新手势");
  {
    const h = harness();
    h.seed(S);
    h.key(1, "ArrowDown");
    assert.deepEqual(h.order(), [2, 1, 3]);
    assert.equal(h.posts.length, 1);
    assert.deepEqual(h.posts[0].ids, [2, 1, 3]);
    h.key(1, "ArrowDown");                       // 第二笔：忙 → 排队
    assert.deepEqual(h.order(), [2, 3, 1]);
    assert.equal(h.posts.length, 1, "忙时不并发发第二笔");
    h.posts[0].d.resolve([{ id:2 }, { id:1 }, { id:3 }]);   // 旧顺序回包
    await flush();
    assert.deepEqual(h.order(), [2, 3, 1], "排队中的新手势不被旧回包覆盖");
    assert.equal(h.posts.length, 2, "队列末尾补发一次");
    assert.deepEqual(h.posts[1].ids, [2, 3, 1]);
    h.posts[1].d.resolve([{ id:2 }, { id:3 }, { id:1 }]);
    await flush();
    assert.deepEqual(h.order(), [2, 3, 1]);
    assert.match(h.lives[h.lives.length - 1], /第 3 项，共 3 项/);
    assert.equal(h.toasts.length, 0);
    ok("排队手势按最新顺序补发，播报取最后一次");
  }

  console.log("[2] 失败只还原顺序，不复活旧勾选态");
  {
    const h = harness();
    h.seed(S);
    h.key(3, "ArrowUp");                          // [1,3,2]
    assert.deepEqual(h.order(), [1, 3, 2]);
    h.rt.subtasksCache.filter(s => s.id === 3)[0].done = true;   // 失败返回前用户又勾了一项
    h.posts[0].d.reject(new Error("模拟排序失败"));
    await flush();
    assert.deepEqual(h.order(), [1, 2, 3], "还原为手势前顺序");
    assert.equal(h.rt.subtasksCache.filter(s => s.id === 3)[0].done, true, "当前勾选态保留（未被旧快照复活）");
    assert.equal(h.toasts.length, 1);
    assert.equal(h.toasts[0].kind, "bad");
    assert.match(h.toasts[0].msg, /排序失败，已还原为原顺序：模拟排序失败/);
    assert.equal(h.lives[h.lives.length - 1], "", "失败后不谎报成功");
    assert.deepEqual(h.focused[h.focused.length - 1], 3, "焦点回到原把手");
    ok("失败回滚只动顺序 + 诚实报错 + 焦点保持");
  }

  console.log("[3] 顺序没变 / 边界 / 只读：不发请求");
  {
    const h = harness();
    h.seed(S);
    h.down(2); h.up();                            // 只点一下把手，没拖动
    assert.equal(h.posts.length, 0, "顺序未变不发排序请求");
    assert.deepEqual(h.order(), [1, 2, 3]);
    h.key(1, "ArrowUp");                          // 首行上移越界
    h.key(3, "ArrowDown");                        // 末行下移越界
    assert.equal(h.posts.length, 0, "边界按键不发请求");
    h.rt.drawerReadOnly = true;
    h.key(2, "ArrowUp");
    h.down(2); h.up();
    assert.equal(h.posts.length, 0, "只读不响应键盘与拖拽");
    assert.deepEqual(h.order(), [1, 2, 3]);
    assert.equal(h.toasts.length, 0);
    ok("空手势 / 越界 / 只读全部静默跳过");
  }

  console.log("[4] 拖拽落点：DOM 顺序即提交顺序，读态同步重绘");
  {
    const h = harness();
    h.seed(S);
    h.down(3);
    h.moveRowBefore(3, 1);                        // 拖到首位
    h.up();
    assert.deepEqual(h.domOrder(), [3, 1, 2]);
    assert.deepEqual(h.order(), [3, 1, 2]);
    assert.equal(h.posts.length, 1);
    assert.deepEqual(h.posts[0].ids, [3, 1, 2]);
    assert.ok(h.readRenders() >= 1, "拖拽结束同步重绘概览读态清单");
    h.posts[0].d.resolve([{ id:3 }, { id:1 }, { id:2 }]);
    await flush();
    assert.deepEqual(h.order(), [3, 1, 2]);
    assert.match(h.lives[h.lives.length - 1], /第 1 项，共 3 项/);
    ok("拖拽提交 DOM 顺序并播报位置");
  }

  console.log("[5] 切走工作项后旧回包/旧失败不污染新清单");
  {
    const h = harness();
    h.seed(S);
    h.key(1, "ArrowDown");
    h.rt.editingId = "T2";
    h.posts[0].d.reject(new Error("模拟排序失败"));
    await flush();
    assert.equal(h.toasts.length, 0, "已切走：不再弹失败提示");
    assert.deepEqual(h.order(), [2, 1, 3], "不强行回滚别的工作项的清单");
    ok("跨工作项的迟到回包被忽略");
  }

  console.log("\n结果：" + passed + " PASS / 0 FAIL");
})().catch(e => { console.error("  FAIL " + (e && e.message || e)); process.exit(1); });
