/* ============================================================
   沙漏 · 用例查询与自定义分组 · 交互原型
   批次 A（查询体验）+ 分组/拖拽/自定义分组候选
   只读原型，不改产品代码。数据为模拟，口径对齐现有 test_case 模型。
   ============================================================ */
(function(){
"use strict";

/* ---------- 模拟数据 ---------- */
var MODULES = [
  { id:"m1", name:"登录鉴权", children:[
    { id:"m11", name:"账号登录" }, { id:"m12", name:"免登与令牌" } ] },
  { id:"m2", name:"支付下单", children:[
    { id:"m21", name:"下单与收银" }, { id:"m22", name:"支付回调" } ] },
  { id:"m3", name:"对账导出", children:[
    { id:"m31", name:"批量导出" }, { id:"m32", name:"对账差异" } ] },
  { id:"m4", name:"退款", children:[] },
  { id:"m5", name:"权限与角色", children:[] },
  { id:"m6", name:"兼容性", children:[] }
];
var LEAVES = ["m11","m12","m21","m22","m31","m32","m4","m5","m6"];
var MOD_NAME = {};
MODULES.forEach(function(m){
  MOD_NAME[m.id] = m.name;
  (m.children||[]).forEach(function(c){ MOD_NAME[c.id] = m.name + " / " + c.name; });
});
var TITLES = {
  m11:["密码连续错误 5 次锁定账号","验证码过期后重新获取","记住登录态 7 天有效","锁定后管理员解锁可立即登录","用户名大小写不敏感登录"],
  m12:["企微免登跳转缺少 wechat_redirect 时提示","令牌过期自动续期不打断操作","免登失败回落到账号密码登录","同一账号多端登录互踢策略"],
  m21:["下单金额为 0 时拦截","收银台切换支付方式保留订单","库存不足下单给出明确原因","重复提交下单只生成一笔订单"],
  m22:["重复回调仍产生两次入账","回调超时后重试 3 次幂等","回调签名校验失败拒绝入账","回调乱序到达按业务时间排序"],
  m31:["按项目多选筛选后导出 Excel","10 万行以内 30 秒完成导出","导出失败可重试且不产生重复数据","无权限项目不出现在导出范围","导出写入审计日志含操作人"],
  m32:["差异金额大于阈值自动标记","对账差异按项目拆分展示","跨期计时归入发生日不摊分","差异处理后备注留痕"],
  m4:["退款金额超过原单拦截","退款审批通过后额度即时释放","部分退款多次累计不超原单","退款失败回滚并通知发起人"],
  m5:["新成员默认不参与任何项目","邀请时预分配可见/可写生效","兼岗成员按职能继承项目角色","只读项目不可新建用例"],
  m6:["Chrome / Edge / Safari 收银台一致","390px 窄屏筛选栏不横向溢出","移动端批量条按钮可点区域达标","深色模式对比度满足可读性"]
};
var DEMANDS = [
  { id:"d18", no:"REQ-2026-018", title:"对账中心支持按项目批量导出" },
  { id:"d21", no:"REQ-2026-021", title:"支付回调幂等与重试" },
  { id:"d24", no:"REQ-2026-024", title:"企业微信免登接入" },
  { id:"d27", no:"REQ-2026-027", title:"退款审批与额度控制" },
  { id:"d30", no:"REQ-2026-030", title:"角色兼岗与项目授权" }
];
var MOD_DEMAND = { m11:"d24", m12:"d24", m21:"d21", m22:"d21", m31:"d18", m32:"d18", m4:"d27", m5:"d30", m6:"d18" };
var OWNERS = ["赵磊","刘敏","陈静","孔祥金",""];
var OWNER_COLOR = { "赵磊":"#2563EB","刘敏":"#7A5AF8","陈静":"#12B76A","孔祥金":"#5B3FD1","李娜":"#D97706","吴俊":"#0E9384","":"#98A2B3" };
var PRI_ORDER = { P0:0, P1:1, P2:2, P3:3 };
var STATUS_LABEL = { passed:"通过", failed:"失败", blocked:"阻塞", skipped:"跳过" };
var TOTAL = 328;

function buildCases(){
  var priPool = [], stPool = [];
  var priCount = { P0:62, P1:118, P2:96, P3:52 };
  var stCount = { passed:214, failed:18, blocked:6, skipped:4, "":86 };
  Object.keys(priCount).forEach(function(k){ for(var i=0;i<priCount[k];i++) priPool.push(k); });
  Object.keys(stCount).forEach(function(k){ for(var i=0;i<stCount[k];i++) stPool.push(k); });
  var out = [];
  for(var i=0;i<TOTAL;i++){
    var mod = LEAVES[i % LEAVES.length];
    var pool = TITLES[mod];
    var title = pool[Math.floor(i / LEAVES.length) % pool.length];
    var variant = Math.floor(i / (LEAVES.length * pool.length));
    if(variant > 0) title = title + "（第 " + (variant+1) + " 轮回归）";
    var st = stPool[(i * 137) % TOTAL];
    var owner = st ? OWNERS[(i * 53) % 4] : "";
    var day = 14 - Math.floor(i / 24);
    var hh = String(9 + (i % 9)).padStart(2,"0");
    var mm = String((i * 7) % 60).padStart(2,"0");
    out.push({
      id:"C" + String(i+1).padStart(4,"0"),
      no:i+1,
      title:title,
      module:mod,
      priority:priPool[(i * 61) % TOTAL],
      status:st || null,
      owner:owner,
      demand:MOD_DEMAND[mod],
      bug:st === "failed" && i % 3 === 0,
      required:(priPool[(i * 61) % TOTAL] === "P0" || priPool[(i * 61) % TOTAL] === "P1") && i % 4 === 0,
      evidence:st === "failed" ? (i % 3) + 1 : (st === "passed" && i % 5 === 0 ? 1 : 0),
      executedAt:st ? "11-" + String(Math.max(1,day)).padStart(2,"0") + " " + hh + ":" + mm : null,
      createdAt:"11-" + String(Math.max(1,day)).padStart(2,"0") + " " + hh + ":" + mm,
      steps:i % 5 === 0
        ? "前置：已登录且项目可见；步骤：发起支付后等待第三方回调通知，重复投递同一回调；预期：仅入账一次，重试不产生重复数据。"
        : "前置：已登录；步骤：按页面引导完成操作；预期：结果与需求验收标准一致。",
      sets:[]
    });
  }
  return out;
}
var CASES = buildCases();

var SETS = [
  { id:"s1", name:"支付回归集", vis:"team", note:"每次发布必跑，覆盖下单到回调全链", dynamic:true,
    ruleObj:{ status:"all", pri:"all", module:"m2", moduleSub:true, demand:"all", owner:"all", q:"", searchWide:false, bug:false, regression:false } },
  { id:"s2", name:"冒烟集", vis:"team", note:"提测后 30 分钟内跑完的最小集合", rule:"手工挑选", dynamic:false },
  { id:"s3", name:"兼容性矩阵", vis:"team", note:"浏览器 × 窄屏 × 深色模式", dynamic:true,
    ruleObj:{ status:"all", pri:"all", module:"m6", moduleSub:true, demand:"all", owner:"all", q:"", searchWide:false, bug:false, regression:false } },
  { id:"s4", name:"本轮必测", vis:"team", note:"v2.2 发布检查引用的集合", dynamic:true,
    ruleObj:{ status:"all", pri:"all", module:"all", moduleSub:true, demand:"all", owner:"all", q:"", searchWide:false, bug:false, regression:true } },
  { id:"s5", name:"我的待整理", vis:"mine", note:"仅自己可见，不进交付说明与发布证据", rule:"手工挑选", dynamic:false },
  { id:"s6", name:"权限联调集", vis:"members", note:"只给权限改造联调的 3 人看，不进交付说明与发布证据", rule:"手工挑选", dynamic:false,
    who:["u2","u5","u6"] }
];
/* 指定成员可见的候选名单：项目内可访问的成员（创建人始终可见，不占名额） */
var PEOPLE = [
  { id:"u1", name:"赵磊", role:"测试工程师" },
  { id:"u2", name:"刘敏", role:"测试工程师" },
  { id:"u3", name:"陈静", role:"前端开发" },
  { id:"u4", name:"孔祥金", role:"产品负责人" },
  { id:"u5", name:"李娜", role:"风控测试" },
  { id:"u6", name:"吴俊", role:"后端开发" }
];
var RULE_EMPTY = { status:"all", pri:"all", module:"all", moduleSub:true, demand:"all", owner:"all",
                   q:"", searchWide:false, bug:false, regression:false };
function ruleCopy(r){ var o = {}; for(var k in RULE_EMPTY) o[k] = r && r[k] !== undefined ? r[k] : RULE_EMPTY[k]; return o; }
function ruleEmpty(r){ for(var k in RULE_EMPTY) if(r[k] !== RULE_EMPTY[k]) return false; return true; }
function ruleMatch(c, r){
  if(r.regression && !(c.status === "failed" || c.status === "blocked" || c.bug)) return false;
  if(r.status !== "all" && (r.status === "__untested" ? !!c.status : c.status !== r.status)) return false;
  if(r.bug && !c.bug) return false;
  if(r.pri !== "all" && (r.pri === "__none" ? !!c.priority : c.priority !== r.pri)) return false;
  if(r.module !== "all"){
    var hit = c.module === r.module;
    if(!hit && r.moduleSub){
      var parent = MODULES.filter(function(m){ return m.id === r.module; })[0];
      if(parent) hit = (parent.children || []).some(function(ch){ return ch.id === c.module; });
    }
    if(!hit) return false;
  }
  if(r.demand !== "all" && c.demand !== r.demand) return false;
  if(r.owner !== "all" && (c.owner || "__none") !== r.owner) return false;
  if(r.q){
    var q = r.q.toLowerCase();
    var hay = (noText(c) + " " + c.title + " " + (MOD_NAME[c.module] || "")).toLowerCase();
    if(r.searchWide){
      var d = demandOf(c.demand);
      hay += " " + (d ? d.title : "") + " " + c.steps;
    }
    if(hay.indexOf(q) < 0) return false;
  }
  return true;
}
function ruleHits(r){ return CASES.filter(function(c){ return ruleMatch(c, r); }).length; }
function ruleText(r){
  var parts = [];
  if(r.regression) parts.push("回归：最近一轮失败 / 阻塞，或挂着未关闭缺陷");
  if(r.status !== "all") parts.push("结果 = " + (r.status === "__untested" ? "未执行" : STATUS_LABEL[r.status]));
  if(r.pri !== "all") parts.push("优先级 = " + (r.pri === "__none" ? "未设置" : r.pri));
  if(r.module !== "all") parts.push("目录 = " + (MOD_NAME[r.module] || r.module) + (r.moduleSub ? "（含子目录）" : ""));
  if(r.demand !== "all"){ var d = demandOf(r.demand); parts.push("需求 = " + (d ? d.no : r.demand)); }
  if(r.owner !== "all") parts.push("执行人 = " + (r.owner === "__none" ? "未指派" : r.owner));
  if(r.bug) parts.push("只看有缺陷");
  if(r.q) parts.push("关键词「" + r.q + "」" + (r.searchWide ? "（含步骤与前置）" : ""));
  return parts.length ? parts.join(" · ") : "未设置条件";
}
(function assignSets(){
  CASES.forEach(function(c, i){
    if((c.module === "m21" || c.module === "m22" || c.module === "m4") && (c.priority === "P0" || c.priority === "P1")) c.sets.push("s1");
    if(i % 18 === 0) c.sets.push("s2");
    if(c.module === "m6") c.sets.push("s3");
    if(c.required) c.sets.push("s4");
    if(i % 47 === 0) c.sets.push("s5");
    if(c.module === "m5") c.sets.push("s6");
  });
})();

/* ---------- 状态 ---------- */
var S = {
  view:"list",
  status:"all", module:"all", pri:"all", owner:"all", bug:false, q:"", searchWide:false,
  sort:"pri", sortDir:"asc",
  pageSize:50, loaded:50,
  groupBy:"none",
  collapsed:{},
  selMode:"ids", sel:{},
  pop:null,
  dirNode:"m1", dirOpen:{ m1:true, m2:true, m3:true }, dirSub:true,
  drag:null, dropTarget:null,
  activeSet:"s1",
  modal:null,
  toast:null,
  planTarget:"p2", planDynamic:true, planName:"v2.2 回归 · 按筛选", planSetName:"对账导出 · 动态回归",
  /* 批次 C：分组弹层的人工层状态 */
  setName:"对账导出 · 回归", setVis:"team", setKind:"manual", setWho:{}, setRule:ruleCopy(null),
  setInit:"filter", memberQ:"",
  forced:null
};
var GROUP_DIMS = [
  { id:"none", label:"不分组" },
  { id:"module", label:"模块" },
  { id:"priority", label:"优先级" },
  { id:"status", label:"执行结果" },
  { id:"owner", label:"执行人" },
  { id:"demand", label:"主需求" },
  { id:"set", label:"自定义分组" }
];
var SORTS = [
  { id:"pri", label:"优先级", hint:"P0 → P3" },
  { id:"executed", label:"最近执行时间", hint:"新 → 旧" },
  { id:"no", label:"用例编号", hint:"TC-001 起" },
  { id:"module", label:"模块", hint:"按目录顺序" },
  { id:"created", label:"创建时间", hint:"现状默认" }
];

/* ---------- 工具 ---------- */
function $(s){ return document.querySelector(s); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
  return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]; }); }
function ic(n, cls){ return '<svg class="ic' + (cls ? " " + cls : "") + '"><use href="#i-' + n + '"></use></svg>'; }
function noText(c){ return "TC-" + String(c.no).padStart(3,"0"); }
function priTag(p){ return p ? '<span class="cr-pri pri-' + p + '">' + p + '</span>' : '<span class="cr-pri pri-P3">—</span>'; }
function statusHTML(st){
  if(!st) return '<span class="cr-status st-untest"><i class="dot dot-untest"></i>未执行</span>';
  var cls = { passed:"st-passed", failed:"st-failed", blocked:"st-blocked", skipped:"st-skipped" }[st];
  var dot = { passed:"dot-pass", failed:"dot-fail", blocked:"dot-block", skipped:"dot-skip" }[st];
  return '<span class="cr-status ' + cls + '"><i class="dot ' + dot + '"></i>' + STATUS_LABEL[st] + '</span>';
}
function avatar(name){
  if(!name) return '<span class="avatar-sm" style="--a:#98A2B3">?</span>';
  return '<span class="avatar-sm" style="--a:' + OWNER_COLOR[name] + '">' + esc(name.charAt(0)) + '</span>';
}
function demandOf(id){ for(var i=0;i<DEMANDS.length;i++) if(DEMANDS[i].id === id) return DEMANDS[i]; return null; }
function setOf(id){ for(var i=0;i<SETS.length;i++) if(SETS[i].id === id) return SETS[i]; return null; }
function setCount(id){ return CASES.filter(function(c){ return c.sets.indexOf(id) >= 0; }).length; }

/* ---------- 筛选 / 排序 ---------- */
function filtered(){
  var q = S.q.trim().toLowerCase();
  var scope = S.view === "drag" ? dirScope(S.dirNode, S.dirSub) : null;
  return CASES.filter(function(c){
    if(scope && scope.indexOf(c.module) < 0) return false;
    if(S.status === "__untested" && c.status) return false;
    if(S.status !== "all" && S.status !== "__untested" && c.status !== S.status) return false;
    if(S.module !== "all"){
      if(S.module === "__none" && c.module) return false;
      if(S.module !== "__none"){
        var hit = c.module === S.module;
        if(!hit && S.dirSub){
          var parent = MODULES.filter(function(m){ return m.id === S.module; })[0];
          if(parent) hit = (parent.children||[]).some(function(ch){ return ch.id === c.module; });
        }
        if(!hit) return false;
      }
    }
    if(S.pri !== "all" && c.priority !== S.pri) return false;
    if(S.owner !== "all"){
      if(S.owner === "__none" && c.owner) return false;
      if(S.owner !== "__none" && c.owner !== S.owner) return false;
    }
    if(S.bug && !c.bug) return false;
    if(q){
      var hay = (noText(c) + " " + c.title + " " + MOD_NAME[c.module]).toLowerCase();
      if(S.searchWide){
        var d = demandOf(c.demand);
        hay += " " + (d ? d.title : "") + " " + c.steps;
      }
      if(hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}
function sorted(rows){
  var dir = S.sortDir === "desc" ? -1 : 1;
  var arr = rows.slice();
  arr.sort(function(a,b){
    var r = 0;
    if(S.sort === "pri") r = PRI_ORDER[a.priority] - PRI_ORDER[b.priority];
    else if(S.sort === "no") r = a.no - b.no;
    else if(S.sort === "module") r = LEAVES.indexOf(a.module) - LEAVES.indexOf(b.module);
    else if(S.sort === "executed") r = (a.executedAt || "").localeCompare(b.executedAt || "");
    else r = b.no - a.no;
    if(r === 0) r = a.no - b.no;
    return r * dir;
  });
  return arr;
}
function stats(rows){
  var s = { total:rows.length, passed:0, failed:0, blocked:0, skipped:0, untested:0 };
  rows.forEach(function(c){ if(c.status) s[c.status]++; else s.untested++; });
  return s;
}
function selectedIds(){
  if(S.selMode === "filter") return filtered().map(function(c){ return c.id; });
  return Object.keys(S.sel).filter(function(k){ return S.sel[k]; });
}
function selCount(){ return S.selMode === "filter" ? filtered().length : selectedIds().length; }
function isSel(c){ return S.selMode === "filter" || !!S.sel[c.id]; }

/* ---------- 通用片段 ---------- */
function pageHead(title, sub, actions){
  return '<div class="page-head"><div class="page-head-main">'
    + '<div class="tc-title-line"><h1>' + esc(title) + '</h1>'
    + '<span class="legend-new"><i></i>本批新增</span><span class="legend-old">现有能力</span></div>'
    + '<div class="tc-sub">' + sub + '</div></div>'
    + '<div class="page-actions">' + (actions || "") + '</div></div>';
}
function statStrip(rows){
  var s = stats(rows);
  var chip = function(key, label, dot, n){
    return '<button type="button" class="stat-chip' + (S.status === key ? " on" : "") + '" data-status="' + key + '">'
      + (dot ? '<i class="dot ' + dot + '"></i>' : "") + label + ' <b>' + n + '</b></button>';
  };
  return '<div class="stat-strip"><span class="stat-total">共 <b>' + s.total + '</b> 条用例</span>'
    + chip("all","全部","",s.total)
    + chip("passed","通过","dot-pass",s.passed)
    + chip("failed","失败","dot-fail",s.failed)
    + chip("blocked","阻塞","dot-block",s.blocked)
    + chip("skipped","跳过","dot-skip",s.skipped)
    + chip("__untested","未执行","dot-untest",s.untested)
    + '<div class="grow"></div><span class="muted">点计数即筛选 · 计数不受当前筛选影响</span></div>';
}
function filterBar(){
  var modOpts = '<option value="all">模块：全部</option>'
    + MODULES.map(function(m){
        var n = CASES.filter(function(c){ return c.module === m.id || (m.children||[]).some(function(ch){ return ch.id === c.module; }); }).length;
        return '<option value="' + m.id + '"' + (S.module === m.id ? " selected" : "") + '>' + esc(m.name) + '（' + n + '）</option>'
          + (m.children||[]).map(function(ch){
              var cn = CASES.filter(function(c){ return c.module === ch.id; }).length;
              return '<option value="' + ch.id + '"' + (S.module === ch.id ? " selected" : "") + '>　└ ' + esc(ch.name) + '（' + cn + '）</option>';
            }).join("");
      }).join("");
  var priOpts = '<option value="all">优先级：全部</option>' + ["P0","P1","P2","P3"].map(function(p){
    return '<option value="' + p + '"' + (S.pri === p ? " selected" : "") + '>' + p + '（' + CASES.filter(function(c){ return c.priority === p; }).length + '）</option>';
  }).join("");
  var ownOpts = '<option value="all">执行人：全部</option>' + OWNERS.map(function(o){
    var label = o || "未指派";
    var n = CASES.filter(function(c){ return (c.owner || "") === o; }).length;
    return '<option value="' + (o || "__none") + '"' + (S.owner === (o || "__none") ? " selected" : "") + '>' + label + '（' + n + '）</option>';
  }).join("");
  return '<div class="tc-bar">'
    + '<span class="bar-label">筛选</span>'
    + '<select class="ctl" data-ctl="module" aria-label="按模块筛选">' + modOpts + '</select>'
    + '<select class="ctl" data-ctl="pri" aria-label="按优先级筛选">' + priOpts + '</select>'
    + '<select class="ctl" data-ctl="owner" aria-label="按执行人筛选">' + ownOpts + '</select>'
    + '<button type="button" class="stat-chip' + (S.bug ? " on" : "") + '" data-bug="1">' + ic("bug") + '只看有缺陷 <b>' + CASES.filter(function(c){ return c.bug; }).length + '</b></button>'
    + '<label class="tc-search">' + ic("search")
    + '<input type="search" data-ctl="q" value="' + esc(S.q) + '" placeholder="搜索编号 / 标题 / 模块…" aria-label="搜索用例">'
    + '</label>'
    + '<button type="button" class="scope-toggle' + (S.searchWide ? " on" : "") + '" data-wide="1" role="switch" aria-checked="' + !!S.searchWide + '" title="默认只搜标题、编号、模块；开启后才搜步骤与前置（大字段，慢）">'
    + '<span class="sw-box">' + (S.searchWide ? ic("check") : "") + '</span>含步骤与前置</button>'
    + '<button type="button" class="link-btn" data-clear="1">清空筛选</button>'
    + '<div class="grow"></div>'
    + '<button type="button" class="btn sm ghost" data-pop="views">' + ic("list") + '视图</button>'
    + '</div>';
}
function sortLabel(){
  for(var i=0;i<SORTS.length;i++) if(SORTS[i].id === S.sort) return SORTS[i].label;
  return "排序";
}
function toolBar(rows){
  var n = rows.length;
  var allOn = S.selMode === "filter";
  return '<div class="tc-bar tools">'
    + '<span class="bar-label">查询</span>'
    + '<span class="ctl-wrap"><select class="ctl on" data-ctl="sort" aria-label="排序字段">'
    + SORTS.map(function(s){ return '<option value="' + s.id + '"' + (S.sort === s.id ? " selected" : "") + '>' + s.label + '</option>'; }).join("")
    + '</select><i class="new-dot"></i></span>'
    + '<button type="button" class="btn sm" data-sortdir="1" title="切换升降序">'
    + (S.sortDir === "asc" ? "↑ 升序" : "↓ 降序") + '</button>'
    + '<span class="ctl-wrap"><select class="ctl" data-ctl="group" aria-label="分组维度">'
    + GROUP_DIMS.map(function(g){ return '<option value="' + g.id + '"' + (S.groupBy === g.id ? " selected" : "") + '>分组：' + g.label + '</option>'; }).join("")
    + '</select>' + (S.groupBy !== "none" ? '<i class="new-dot"></i>' : "") + '</span>'
    + '<span class="ctl-wrap"><select class="ctl on" data-ctl="pageSize" aria-label="每页条数">'
    + [50,100,200].map(function(p){ return '<option value="' + p + '"' + (S.pageSize === p ? " selected" : "") + '>每页 ' + p + ' 条</option>'; }).join("")
    + '</select><i class="new-dot"></i></span>'
    + '<button type="button" class="sel-all' + (allOn ? " on" : "") + '" data-selall="1">'
    + '<span class="box">' + (allOn ? ic("check") : "") + '</span>全选筛选结果 <span class="n">' + n + '</span></button>'
    + '<div class="grow"></div>'
    + '<span class="muted">排序 / 每页条数 / 全选筛选结果为本批新增</span>'
    + '</div>';
}
function bulkBar(){
  var n = selCount();
  if(!n) return "";
  var loaded = Math.min(S.loaded, filtered().length);
  var hint = S.selMode === "filter"
    ? '当前页已加载 ' + loaded + ' 条，其余 ' + Math.max(0, n - loaded) + ' 条按筛选条件匹配（未加载也生效）'
    : '仅勾选当前已加载的行；要覆盖未加载行请用「全选筛选结果」';
  return '<div class="bulk-bar">'
    + '<span class="bulk-count">已选 <b>' + n + '</b> 条</span>'
    + '<span class="bulk-hint">' + hint + '</span><div class="grow"></div>'
    + '<button type="button" class="btn sm" data-bulk="module">改模块</button>'
    + '<button type="button" class="btn sm" data-bulk="pri">改优先级</button>'
    + '<button type="button" class="btn sm" data-bulk="set">加入分组</button>'
    + '<button type="button" class="btn sm primary" data-bulk="plan">加入测试计划</button>'
    + '<button type="button" class="btn sm" data-bulk="export">导出所选</button>'
    + '<button type="button" class="btn sm ghost" data-bulk="clear">取消选择</button>'
    + '</div>';
}
function caseRow(c, opts){
  opts = opts || {};
  var d = demandOf(c.demand);
  var sel = isSel(c);
  var meta = '<span class="cr-mod-inline cr-mod">' + esc(MOD_NAME[c.module]) + '</span>'
    + (d ? '<span>' + esc(d.no) + '</span><span class="sep">·</span>' : "")
    + (c.required ? '<span class="req-flag">' + ic("shield") + '发布必测</span>' : "")
    + (c.bug ? '<span class="bug-link">' + ic("bug") + '已转缺陷</span>' : "")
    + (c.evidence ? '<span class="ev-chip">' + ic("file") + c.evidence + ' 份证据</span>' : "");
  return '<div class="case-row' + (sel ? " sel" : "") + (S.drag && S.drag.ids.indexOf(c.id) >= 0 ? " dragging" : "") + '"'
    + ' data-case="' + c.id + '"' + (opts.draggable ? ' draggable="true"' : "") + '>'
    + '<button type="button" class="cr-box' + (sel ? " on" : "") + '" data-pick="' + c.id + '" aria-label="选择用例 ' + noText(c) + '">' + (sel ? ic("check") : "") + '</button>'
    + '<span class="cr-no">' + noText(c) + '</span>'
    + '<div class="cr-main"><div class="cr-title" title="' + esc(c.title) + '">' + esc(c.title) + '</div>'
    + '<div class="cr-meta">' + meta + '</div></div>'
    + '<span class="cr-mod-cell"><span class="cr-mod" title="' + esc(MOD_NAME[c.module]) + '">' + esc(MOD_NAME[c.module]) + '</span></span>'
    + '<span class="cr-pri-cell">' + priTag(c.priority) + '</span>'
    + '<span class="cr-status-cell">' + statusHTML(c.status) + '</span>'
    + '<span class="cr-owner">' + avatar(c.owner) + '<span>' + esc(c.owner || "未指派") + '</span></span>'
    + '<span class="cr-time">' + (c.executedAt || "—") + '</span>'
    + '</div>';
}
function loadMore(rows){
  var loaded = Math.min(S.loaded, rows.length);
  if(loaded >= rows.length) return '<div class="list-foot">' + ic("check") + '已加载全部 ' + rows.length + ' 条 · 每页 ' + S.pageSize + ' 条'
    + '<div class="grow"></div><span>排序：' + sortLabel() + (S.sortDir === "asc" ? " 升序" : " 降序") + '</span></div>';
  return '<button type="button" class="load-more" data-more="1">加载更多（已加载 <span class="n">' + loaded + '</span> / 共 <span class="n">' + rows.length + '</span> 条）'
    + ic("chevron-down") + '</button>'
    + '<div class="list-foot"><span>保留「加载更多」，不改成页码：移动端友好，且竞品普遍不公开每页上限</span>'
    + '<div class="grow"></div><span>排序：' + sortLabel() + (S.sortDir === "asc" ? " 升序" : " 降序") + ' · 每页 ' + S.pageSize + ' 条</span></div>';
}
function exportPop(){
  var n = filtered().length;
  return '<div class="pop right" style="position:absolute;top:calc(100% + 5px);right:0">'
    + '<div class="pop-title">导出 CSV</div>'
    + '<button type="button" class="pop-item on" data-export="filter">' + ic("filter") + '<span class="grow">导出当前筛选结果</span><span class="n">' + n + '</span></button>'
    + '<button type="button" class="pop-item" data-export="sel">' + ic("check-square") + '<span class="grow">导出所选</span><span class="n">' + selCount() + '</span></button>'
    + '<button type="button" class="pop-item" data-export="all">' + ic("download") + '<span class="grow">导出项目全部（现状）</span><span class="n">' + CASES.length + '</span></button>'
    + '<div class="pop-sep"></div>'
    + '<button type="button" class="pop-item" data-export="tpl">' + ic("file") + '<span class="grow">下载导入模板</span></button>'
    + '<div class="pop-note">现状只有「导出项目全部」；筛选后导出是批次 A 新增。</div></div>';
}
function sortPop(){
  return '<div class="pop" style="position:absolute;top:calc(100% + 5px);left:0">'
    + '<div class="pop-title">排序字段</div>'
    + SORTS.map(function(s){
        return '<button type="button" class="pop-item' + (S.sort === s.id ? " on" : "") + '" data-sort="' + s.id + '">'
          + (S.sort === s.id ? ic("check") : '<span style="width:13px"></span>')
          + '<span class="grow">' + s.label + '</span><span class="n">' + s.hint + '</span></button>';
      }).join("")
    + '<div class="pop-sep"></div>'
    + '<div class="pop-dir"><button type="button" class="' + (S.sortDir === "asc" ? "on" : "") + '" data-sortdir="asc">↑ 升序</button>'
    + '<button type="button" class="' + (S.sortDir === "desc" ? "on" : "") + '" data-sortdir="desc">↓ 降序</button></div>'
    + '<div class="pop-note">现状排序固定为「创建时间倒序」，不可选。服务端按白名单字段 ORDER BY。</div></div>';
}

/* ---------- 屏 1：查询体验 ---------- */
function renderList(){
  var rows = sorted(filtered());
  var page = rows.slice(0, S.loaded);
  var head = pageHead("用例库 · 统一支付网关",
    '批次 A：排序、每页条数、全选筛选结果、按筛选导出、搜索范围收敛。不动数据模型，现有卡片行与筛选口径保持不变。',
    '<button type="button" class="btn" data-pop="import">' + ic("download") + '导入</button>'
    + '<span style="position:relative;display:inline-block"><button type="button" class="btn" data-pop="export">' + ic("download") + '导出' + ic("chevron-down") + '</button>'
    + (S.pop === "export" ? exportPop() : "") + '</span>'
    + '<button type="button" class="btn primary">' + ic("plus") + '新建用例</button>');
  var tools = toolBar(rows);
  var sortAnchor = '<div style="position:relative;display:inline-block;margin-bottom:9px">'
    + '<button type="button" class="btn sm" data-pop="sort">' + ic("list") + '排序：' + sortLabel() + (S.sortDir === "asc" ? " ↑" : " ↓") + ic("chevron-down") + '</button>'
    + (S.pop === "sort" ? sortPop() : "") + '</div>';
  return head + statStrip(CASES) + filterBar() + tools + bulkBar() + sortAnchor
    + '<div class="case-list">' + page.map(function(c){ return caseRow(c); }).join("") + '</div>'
    + loadMore(rows)
    + note(["<b>全选筛选结果</b>是语义关键：勾选后批量动作作用于全部 " + rows.length + " 条匹配用例，包含未加载的行。服务端批量接口需接受「筛选条件」而不是只接受 id 列表。",
            "<b>搜索范围收敛</b>：默认只搜标题 / 编号 / 模块，避开 <span class='k'>steps mediumtext</span> 的 <span class='k'>LIKE '%kw%'</span>；勾选「含步骤与前置」才走全字段。配合 <span class='k'>(workspace_id, req_id, module / priority / latest_status)</span> 组合索引。",
            "<b>保留加载更多</b>：不上页码。竞品（TestRail / Xray / Zephyr）均未公开 UI 每页上限，分页形态不是竞争点。"]);
}

/* ---------- 屏 2：分组显示 ---------- */
function groupKeys(rows){
  if(S.groupBy === "module"){
    return LEAVES.map(function(id){ return { key:id, label:MOD_NAME[id], rows:rows.filter(function(c){ return c.module === id; }) }; });
  }
  if(S.groupBy === "priority"){
    return ["P0","P1","P2","P3"].map(function(p){ return { key:p, label:p + " 优先级", rows:rows.filter(function(c){ return c.priority === p; }) }; });
  }
  if(S.groupBy === "status"){
    return [["failed","失败"],["blocked","阻塞"],["passed","通过"],["skipped","跳过"],[null,"未执行"]].map(function(p){
      return { key:String(p[0]), label:p[1], rows:rows.filter(function(c){ return c.status === p[0]; }) }; });
  }
  if(S.groupBy === "owner"){
    return OWNERS.map(function(o){ return { key:o || "__none", label:o || "未指派", rows:rows.filter(function(c){ return (c.owner || "") === o; }) }; });
  }
  if(S.groupBy === "demand"){
    return DEMANDS.map(function(d){ return { key:d.id, label:d.no + " · " + d.title, rows:rows.filter(function(c){ return c.demand === d.id; }) }; });
  }
  if(S.groupBy === "set"){
    return SETS.map(function(s){ return { key:s.id, label:s.name, rows:rows.filter(function(c){ return c.sets.indexOf(s.id) >= 0; }) }; });
  }
  return [{ key:"all", label:"全部用例", rows:rows }];
}
function groupBar(st){
  var t = st.total || 1;
  var seg = function(n, color){ return n ? '<i style="width:' + (n / t * 100).toFixed(1) + '%;background:' + color + '"></i>' : ""; };
  return '<span class="grp-bar" aria-hidden="true">' + seg(st.passed,"var(--success)") + seg(st.failed,"var(--danger)")
    + seg(st.blocked,"var(--warning)") + seg(st.skipped,"var(--text-3)") + seg(st.untested,"var(--border-strong)") + '</span>'
    + '<span class="grp-legend">' + st.passed + ' 通过 / ' + st.failed + ' 失败 / ' + st.untested + ' 未执行</span>';
}
function dragHint(){
  if(S.groupBy === "module") return "拖入段头 = 移动归属（单归属）";
  if(S.groupBy === "set") return "拖入段头 = 加入分组（多归属，原分组保留）";
  if(S.groupBy === "priority") return "拖入段头 = 改优先级";
  if(S.groupBy === "owner") return "拖入段头 = 改最近执行人（不建议，执行结果才有执行人语义）";
  return "";
}
function renderGroup(){
  var rows = sorted(filtered());
  var groups = groupKeys(rows).filter(function(g){ return g.rows.length || S.groupBy === "module"; });
  var hint = dragHint();
  var body = groups.map(function(g){
    var st = stats(g.rows);
    var open = !S.collapsed[g.key];
    var shown = g.rows.slice(0, 6);
    var inner = open
      ? '<div class="grp-body">' + (shown.length ? shown.map(function(c){ return caseRow(c, { draggable:true }); }).join("")
          : '<div class="grp-empty">该分组下没有限筛范围内的用例</div>')
        + (g.rows.length > shown.length ? '<button type="button" class="grp-more" data-grpmore="' + esc(g.key) + '">段内加载更多（已显示 ' + shown.length + ' / 共 ' + g.rows.length + ' 条）</button>' : "")
        + '</div>'
      : "";
    return '<section class="grp' + (S.dropTarget === "g:" + g.key ? " drop-on" : "") + '" data-grp="' + esc(g.key) + '">'
      + '<div class="grp-head" data-grptoggle="' + esc(g.key) + '">'
      + '<button type="button" class="grp-toggle" aria-expanded="' + open + '" aria-label="折叠分组">' + ic("chevron-right") + '</button>'
      + '<span class="grp-name">' + esc(g.label) + '<span class="grp-count">' + g.rows.length + ' 条</span></span>'
      + groupBar(st) + '<div class="grow"></div>'
      + (hint ? '<span class="grp-hint">' + ic("arrow-right") + esc(hint) + '</span>' : "")
      + '<button type="button" class="btn sm ghost" data-grpsel="' + esc(g.key) + '">全选本组</button>'
      + '</div>' + inner + '</section>';
  }).join("");
  return pageHead("分组显示 · 按维度分段",
    '分组只是列表的呈现方式，不新增数据。段头带计数与结果分布，可折叠、可段内翻页、可整组全选。',
    '<button type="button" class="btn" data-collapse="all">全部折叠</button>'
    + '<button type="button" class="btn" data-collapse="none">全部展开</button>')
    + statStrip(CASES) + filterBar() + toolBar(rows) + bulkBar()
    + (hint ? '<div class="drop-banner">' + ic("alert") + '当前分组维度：<b>' + esc((GROUP_DIMS.filter(function(g){ return g.id === S.groupBy; })[0]||{}).label) + '</b>　' + esc(hint) + '　—— 语义随维度变化，必须在段头明示</div>' : "")
    + body
    + note(["<b>分组维度</b>：模块 / 优先级 / 执行结果 / 执行人 / 主需求 / 自定义分组。现状只有「全部项目」下按项目分段，单项目内无分组。",
            "<b>段头计数与结果分布</b>沿用现有 facets 口径（不受当前筛选影响的候选计数 + 段内实际统计），零用例的模块段仍显示，便于发现覆盖缺口。",
            "<b>拖拽语义必须随维度变化</b>：按模块分组时拖入=移动归属；按自定义分组时拖入=加入（不移出原组）。这是两种数据关系，不能混用同一个手势而不提示。"]);
}

/* ---------- 屏 3：拖拽归类 ---------- */
function dirNodeHTML(m, lv){
  var kids = m.children || [];
  var n = CASES.filter(function(c){ return c.module === m.id || kids.some(function(k){ return k.id === c.module; }); }).length;
  var open = S.dirOpen[m.id];
  var on = S.dirNode === m.id;
  var drop = S.dropTarget === "d:" + m.id;
  var html = '<div class="dir-node lv' + lv + (on ? " on" : "") + (drop ? " drop-on" : "") + '" data-dir="' + m.id + '">'
    + (kids.length ? '<button type="button" class="dir-toggle" aria-expanded="' + !!open + '" data-dirtoggle="' + m.id + '">' + ic("chevron-right") + '</button>'
                   : '<span class="dir-toggle ph"></span>')
    + ic("folder") + '<span class="dir-name">' + esc(m.name) + '</span><span class="dir-n">' + n + '</span></div>';
  if(kids.length && open){
    html += kids.map(function(k){
      var kn = CASES.filter(function(c){ return c.module === k.id; }).length;
      var kon = S.dirNode === k.id, kdrop = S.dropTarget === "d:" + k.id;
      return '<div class="dir-node lv' + (lv+1) + (kon ? " on" : "") + (kdrop ? " drop-on" : "") + '" data-dir="' + k.id + '">'
        + '<span class="dir-toggle ph"></span>' + ic("folder")
        + '<span class="dir-name">' + esc(k.name) + '</span><span class="dir-n">' + kn + '</span></div>';
    }).join("");
  }
  return html;
}
function dirScope(id, sub){
  var out = [id];
  if(sub) MODULES.forEach(function(m){ if(m.id === id) (m.children || []).forEach(function(k){ out.push(k.id); }); });
  return out;
}
function renderDrag(){
  var inDir = sorted(filtered());
  var rows = inDir.slice(0, 12);
  var drag = S.drag;
  var ghost = "";
  if(drag && S.forced === "over"){
    ghost = '<div class="drag-ghost" style="left:56%;top:340px"><span class="n">' + drag.ids.length + '</span>'
      + esc(drag.title) + (drag.ids.length > 1 ? " 等 " + drag.ids.length + " 条" : "") + '</div>';
  }
  var targetName = drag && S.dropTarget ? MOD_NAME[S.dropTarget.slice(2)] : "";
  return pageHead("拖拽归类 · 模块目录（单归属）",
    '左侧目录树限 3 级、团队共享；右侧用例可拖到目录节点或分组段头。拖拽即批量改归属，编号与执行历史不变。',
    '<button type="button" class="btn">' + ic("plus") + '新建目录</button>'
    + '<button type="button" class="btn primary">' + ic("plus") + '新建用例</button>')
    + (drag ? '<div class="drop-banner">' + ic("arrow-right") + '正在拖动 <b>' + drag.ids.length + '</b> 条用例'
        + (targetName ? '　放到「<b>' + esc(targetName) + '</b>」= 移动归属（原模块移出）' : '　放到目录节点上以移动归属') + '</div>' : "")
    + '<div class="drag-layout">'
    + '<aside class="dir"><div class="dir-head">' + ic("folder") + '<h2>模块目录</h2><div class="grow"></div><span class="muted">3 级上限</span></div>'
    + '<div class="dir-tools"><label class="dir-search">' + ic("search") + '<input type="search" placeholder="搜索模块…" aria-label="搜索模块"></label></div>'
    + '<div class="dir-body">' + MODULES.map(function(m){ return dirNodeHTML(m, 0); }).join("")
    + '<button type="button" class="dir-add">' + ic("plus") + '新建子目录</button></div>'
    + '<div class="dir-foot"><button type="button" class="scope-toggle' + (S.dirSub ? " on" : "") + '" data-dirsub="1" role="switch" aria-checked="' + !!S.dirSub + '"><span class="sw-box">' + (S.dirSub ? ic("check") : "") + '</span>显示子模块用例</button>'
    + '<div style="margin-top:5px">一个用例只属一个目录节点（对齐 Xray folder 口径），避免多路径归属导致计数重复。</div></div></aside>'
    + '<div><div class="tc-bar"><span class="bar-label">当前目录</span>'
    + '<span class="tag blue">' + esc(MOD_NAME[S.dirNode] || "全部") + '</span>'
    + '<span class="tag gray">' + inDir.length + ' 条</span>'
    + '<span class="muted">拖动用例行到左侧目录；勾选多行后拖动其中一行 = 整批移动</span>'
    + '<div class="grow"></div><button type="button" class="btn sm" data-selall="1">全选本目录结果 ' + inDir.length + '</button></div>'
    + bulkBar()
    + (rows.length
        ? '<div class="case-list">' + rows.map(function(c){ return caseRow(c, { draggable:true }); }).join("") + '</div>'
        : '<div class="list-empty">该目录节点下没有直接挂载的用例。<br>勾选左侧「显示子模块用例」可查看子目录用例，或把用例拖到本节点完成归类。</div>')
    + '<div class="list-foot"><span>示意只渲染前 12 行；真实列表沿用「加载更多」分页</span></div></div>'
    + '</div>' + ghost
    + note(["<b>拖拽 = 批量改归属</b>：落到目录节点后弹确认，明示「原模块 → 新模块」、影响条数、编号不变、执行历史与证据保留、覆盖矩阵随之变化。成功后 toast 带<b>撤销</b>。",
            "<b>为什么限 3 级</b>：PingCode 官方硬限 5 级，TestRail 官方明确劝慎选多 suite（一个 run 不能跨 suite 取例）。目录切太细会挡住执行范围，沙漏取更保守的 3 级。",
            "<b>迁移面</b>：现状 <span class='k'>test_case.module</span> 是自由文本，升级需改存 <span class='k'>module_id</span>，波及覆盖矩阵、计划圈选、CSV 导入导出、备份 v14、AI 生成、保存视图（视图里存的是模块文本）。属批次 B，须先出兼容清单。"]);
}

/* ---------- 屏 4：自定义分组 ---------- */
function renderSets(){
  var active = setOf(S.activeSet) || SETS[0];
  var members = CASES.filter(function(c){ return c.sets.indexOf(active.id) >= 0; });
  var team = SETS.filter(function(s){ return s.vis === "team"; });
  var named = SETS.filter(function(s){ return s.vis === "members"; });
  var mine = SETS.filter(function(s){ return s.vis === "mine"; });
  var visTag = function(s){
    var cls = { team:"vis-team", members:"vis-named", mine:"vis-mine" }[s.vis];
    var label = { team:"团队", members:"指定成员", mine:"仅自己" }[s.vis];
    return '<span class="vis-tag ' + cls + '">' + label + '</span>';
  };
  var item = function(s){
    return '<div class="set-item' + (S.activeSet === s.id ? " on" : "") + (S.dropTarget === "s:" + s.id ? " drop-on" : "") + '" data-set="' + s.id + '">'
      + '<span class="set-ico">' + ic(s.dynamic ? "refresh" : "layers") + '</span>'
      + '<span class="set-main"><span class="set-name">' + esc(s.name) + visTag(s)
      + (s.dynamic ? '<span class="vis-tag vis-dyn">动态</span>' : "") + '</span>'
      + '<span class="set-sub">' + esc(s.note) + '</span></span>'
      + '<span class="set-n">' + setCount(s.id) + '</span></div>';
  };
  var shown = members.slice(0, 8);
  return pageHead("自定义分组 · 用例集（多归属）",
    '测试人员自建分组并归类，一条用例可进多个分组。分组是「引用」不是「复制」，删除分组不删用例。',
    '<button type="button" class="btn primary" data-pop="newset">' + ic("plus") + '新建分组</button>')
    + '<div class="sem-grid">'
    + '<div class="sem pick"><div class="sem-kicker">' + ic("folder") + '单归属 · 建议用于「归类」</div>'
    + '<h3>模块目录<span class="tag blue">拖入 = 移动</span></h3>'
    + '<p>一个用例只属一个节点，回答「这条用例属于哪个功能域」。团队共享，进覆盖矩阵与发布证据。</p>'
    + '<ul><li><b>数据</b>：<span class="k">test_module.parent_id</span> + 用例改存 <span class="k">module_id</span></li>'
    + '<li><b>手势</b>：拖到目录 = 从原节点移出</li><li><b>口径</b>：计数不重复，可直接写进交付说明</li></ul>'
    + '<div class="sem-verdict ok">建议采纳：归类用目录，语义唯一、证据口径一致</div></div>'
    + '<div class="sem pick"><div class="sem-kicker">' + ic("layers") + '多归属 · 建议用于「自定义分组」</div>'
    + '<h3>用例集 / 分组<span class="tag plum">拖入 = 加入</span></h3>'
    + '<p>一个用例可进多个分组，回答「这批用例服务于哪次测试目的」。可手工挑选，也可由筛选条件动态收录。</p>'
    + '<ul><li><b>数据</b>：新增 <span class="k">case_set</span> + <span class="k">case_set_item</span>（或复用 tag 表）</li>'
    + '<li><b>手势</b>：拖到分组 = 加入，原分组保留</li><li><b>口径</b>：分组间计数可重叠，不能相加当总数</li></ul>'
    + '<div class="sem-verdict ok">建议采纳：回归集 / 冒烟 / 兼容性用分组，可被测试计划直接引用</div></div>'
    + '</div>'
    + '<div class="sets-layout">'
    + '<aside class="set-list"><div class="set-group-label">团队共享 · 进交付说明与发布证据</div>'
    + team.map(item).join("")
    + '<div class="set-group-label">指定成员可见 · 不进证据</div>' + named.map(item).join("")
    + '<div class="set-group-label">仅自己可见 · 不进证据</div>' + mine.map(item).join("")
    + '<div class="dir-foot">只有团队共享分组进交付说明与发布证据：证据数字必须全员一致。指定成员 / 仅自己可见用于联调与个人整理，要写进证据先转为团队共享（需创建人操作）。</div></aside>'
    + '<section class="card" style="overflow:hidden">'
    + '<div class="set-detail-head"><span class="set-ico" style="background:var(--primary);color:#fff">' + ic(active.dynamic ? "refresh" : "layers") + '</span>'
    + '<div style="flex:1;min-width:0"><h2>' + esc(active.name)
    + '<span class="vis-tag ' + ({ team:"vis-team", members:"vis-named", mine:"vis-mine" }[active.vis]) + '">'
    + ({ team:"团队共享", members:"指定成员可见", mine:"仅自己可见" }[active.vis]) + '</span>'
    + (active.dynamic ? '<span class="vis-tag vis-dyn">动态收录</span>' : "")
    + '<span class="tag gray">' + members.length + ' 条</span></h2><p>' + esc(active.note) + '</p></div>'
    + '<button type="button" class="btn sm" data-pop="editset">编辑分组</button>'
    + '<button type="button" class="btn sm ghost danger-text">删除分组</button></div>'
    + (active.vis === "members" ? '<div class="set-who"><span class="who-label">' + ic("users") + '可见名单（创建人始终可见）</span>'
        + (active.who || []).map(function(id){ var p = PEOPLE.filter(function(x){ return x.id === id; })[0];
            return p ? '<span class="who-chip">' + avatar(p.name) + esc(p.name) + '</span>' : ""; }).join("")
        + '<span class="who-n">共 ' + ((active.who || []).length + 1) + ' 人 · 上限 50 人</span></div>' : "")
    + '<div class="set-rules"><span class="rule-chip">' + ic("filter") + '收录规则：'
    + esc(active.ruleObj ? ruleText(active.ruleObj) : active.rule) + '</span>'
    + (active.dynamic ? '<span class="rule-chip">' + ic("refresh") + '动态：命中即自动收录，不再命中自动移出</span>'
        : '<span class="rule-chip">' + ic("check-square") + '手工挑选：拖入或按筛选加入')
    + '<div class="grow"></div>'
    + (active.dynamic ? '<button type="button" class="btn sm primary" data-pop="editset">编辑规则</button>'
        : '<button type="button" class="btn sm primary" data-bulk="plan">按当前筛选加入</button>') + '</div>'
    + (active.dynamic ? '<div class="rule-foot">' + ic("alert")
        + '<span>动态分组不能手工增删用例；规则按创建人的可见范围计算，当前命中 <b>' + ruleHits(active.ruleObj) + '</b> 条（上限 2000）。目录被规则引用时不能删除。</span></div>' : "")
    + '<div class="card-body" style="padding:11px 13px"><div class="case-list">'
    + shown.map(function(c){ return caseRow(c, { draggable:!active.dynamic }); }).join("") + '</div>'
    + (members.length > shown.length ? '<button type="button" class="load-more" data-more="1">加载更多（已显示 ' + shown.length + ' / 共 ' + members.length + ' 条）' + ic("chevron-down") + '</button>' : "")
    + '</div></section></div>'
    + note(["<b>引用而非复制</b>：MeterSphere / PingCode / 云效的计划都是引用用例库（云效计划内用例只读，改要回库）；飞书项目是复制式，改用例后需手动同步。沙漏建议引用式，避免同一用例多份漂移。",
            "<b>动态分组 = 保存的筛选</b>：Xray 的 saved filter 可驱动 Dynamic Test Plan 自动收录。沙漏复用现有筛选条件（结果 / 优先级 / 目录 / 需求 / 执行人 / 关键词 / 缺陷 / 回归），不新造查询语言；成员引用落库，读取时按规则自愈，因此计数、圈选入计划与证据口径与手工分组完全一致。",
            "<b>三档可见范围</b>：团队共享（全员可见、进证据）/ 指定成员（创建人 + 名单，最多 50 人，不进证据）/ 仅自己（不进证据）。收窄团队分组的可见范围必须由创建人操作，避免其他成员突然看不到。"]);
}

/* ---------- 屏 5：按筛选圈选入计划 ---------- */
function renderPlan(){
  var rows = sorted(filtered());
  var preview = rows.slice(0, 8);
  var already = Math.min(37, rows.length);
  var willAdd = rows.length - already;
  return pageHead("按筛选圈选入计划",
    '把「筛选结果」一次变成「计划范围」，替代现状「加载更多 + 逐个勾选、单次上限 500 条」。这是本轮杠杆最高的一条。',
    '<button type="button" class="btn">返回用例库</button>')
    + '<div class="vs-grid">'
    + '<div class="vs bad"><h4>' + ic("alert") + '现状：手工勾选</h4>'
    + '<p>1000 条用例里挑 200 条回归，要点 10 次「加载更多」再逐个勾；单次圈选上限 500 条，超出要先缩小范围。</p>'
    + '<div class="steps">筛选 → 加载更多 ×10 → 逐条勾选 → 加入计划</div></div>'
    + '<div class="vs good"><h4>' + ic("check") + '建议：按筛选加入</h4>'
    + '<p>筛选条件即范围，一次动作把全部匹配用例加入计划，自动去重已在计划中的用例，不受 500 条手工上限约束。</p>'
    + '<div class="steps">筛选 → 加入计划（确认条数与去重）→ 完成</div></div>'
    + '</div>'
    + '<div class="pick-layout" style="margin-top:13px">'
    + '<div><div class="tc-bar"><span class="bar-label">当前筛选</span>'
    + '<span class="tag blue">模块：' + (S.module === "all" ? "全部" : esc(MOD_NAME[S.module] || S.module)) + '</span>'
    + '<span class="tag red">' + (S.pri === "all" ? "全部优先级" : esc(S.pri)) + '</span>'
    + '<span class="tag gray">' + (S.status === "all" ? "全部结果" : (S.status === "__untested" ? "未执行" : STATUS_LABEL[S.status])) + '</span>'
    + (S.q ? '<span class="tag gray">搜索：' + esc(S.q) + '</span>' : "")
    + '<div class="grow"></div><span class="muted">匹配 ' + rows.length + ' 条</span></div>'
    + '<div class="case-list">' + preview.map(function(c){ return caseRow(c); }).join("") + '</div>'
    + '<div class="list-foot"><span>预览前 8 条；实际加入 ' + rows.length + ' 条</span></div></div>'
    + '<aside class="pick-side"><div class="pick-side-head"><h2>加入测试计划</h2></div>'
    + '<div class="pick-side-body">'
    + '<div class="pick-sum"><b>' + willAdd + '</b><span>条将加入（已去重 ' + already + ' 条已在计划中）</span>'
    + '<div class="pick-rows"><div class="pick-row">筛选匹配<span class="n">' + rows.length + '</span></div>'
    + '<div class="pick-row">已在计划中<span class="n">-' + already + '</span></div>'
    + '<div class="pick-row">本次新增<span class="n">' + willAdd + '</span></div></div></div>'
    + '<div class="field"><label for="planTarget">目标计划</label>'
    + '<select class="ctl" id="planTarget" data-ctl="planTarget">'
    + '<option value="p2"' + (S.planTarget === "p2" ? " selected" : "") + '>v2.2 回归 · 进行中（128 条）</option>'
    + '<option value="p1"' + (S.planTarget === "p1" ? " selected" : "") + '>提测冒烟 · 草稿（18 条）</option>'
    + '<option value="new"' + (S.planTarget === "new" ? " selected" : "") + '>＋ 新建计划…</option></select>'
    + '<div class="hint">计划仍归属单个项目；跨项目需分别加入（沿用现状口径）。</div></div>'
    + (S.planTarget === "new" ? '<div class="field"><label for="planName">计划名称</label>'
        + '<input type="text" id="planName" data-ctl="planName" value="' + esc(S.planName) + '">'
        + '<div class="hint">关联版本、起止日期在下一步补齐。</div></div>' : "")
    + '<label class="check-line' + (S.planDynamic ? " on" : "") + '" data-dynamic="1"><span class="box">' + (S.planDynamic ? ic("check") : "") + '</span>'
    + '<span>同时保存为动态分组<small>把当前筛选存成团队共享的动态分组：命中的新用例自动进入，下次发布可直接引用；已加入计划的用例仍是一次性引用，不随规则变化。</small></span></label>'
    + (S.planDynamic ? '<div class="field" style="margin-top:7px"><label for="planSetName">动态分组名称</label>'
        + '<input type="text" id="planSetName" data-ctl="planSetName" value="' + esc(S.planSetName) + '" maxlength="60">'
        + '<div class="hint">规则 = ' + esc(filterSummary()) + '；可见范围固定为团队共享（进证据）。</div></div>' : "")
    + '<label class="check-line on"><span class="box">' + ic("check") + '</span>'
    + '<span>P0 / P1 自动标记「发布必测」<small>沿用现有 test_plan_case.required，发布检查据此判断。</small></span></label>'
    + '<button type="button" class="btn primary wide" data-planconfirm="1">' + ic("check") + '加入 ' + willAdd + ' 条用例</button>'
    + '<div class="hint" style="font-size:9.5px;color:var(--text-3);line-height:1.6">加入是引用，不复制用例；执行结果写计划内结果并追加执行流水，与现状一致。</div>'
    + '</div></aside></div>'
    + note(["<b>服务端</b>：批量加入接口接受筛选条件（或「全选筛选结果」的 id 集合），逐条校验写权限与项目归属，返回新增 / 跳过 / 失败计数。",
            "<b>上限</b>：取消 500 条手工上限，但保留单次事务上限与进度反馈；超大范围建议先收窄筛选。",
            "<b>与动态集合的边界</b>：静态加入是一次性快照式引用；动态集合会随条件变化自动收录，两者要在计划详情里标明，避免发布证据范围漂移。"]);
}

/* ---------- 说明脚注 ---------- */
function note(items){
  return '<div class="note"><b>原型说明</b><ul>' + items.map(function(t){ return "<li>" + t + "</li>"; }).join("") + '</ul></div>';
}

/* ---------- 弹层 ---------- */
function visLine(key, title, desc){
  return '<div class="radio-line' + (S.setVis === key ? " on" : "") + '" data-vis="' + key + '" role="radio" aria-checked="' + (S.setVis === key) + '">'
    + '<span class="radio-dot"></span><span class="radio-main"><b>' + title + '</b><span>' + desc + '</span></span></div>';
}
function kindLine(key, title, desc){
  return '<div class="radio-line' + (S.setKind === key ? " on" : "") + '" data-kind="' + key + '" role="radio" aria-checked="' + (S.setKind === key) + '">'
    + '<span class="radio-dot"></span><span class="radio-main"><b>' + title + '</b><span>' + desc + '</span></span></div>';
}
function initPicker(){
  return '<div class="field" style="margin-top:11px"><label>初始成员</label>'
    + '<div class="radio-line' + (S.setInit === "filter" ? " on" : "") + '" data-init="filter"><span class="radio-dot"></span>'
    + '<span class="radio-main"><b>按当前筛选加入 ' + filtered().length + ' 条</b>'
    + '<span>' + esc(filterSummary()) + '</span></span></div>'
    + '<div class="radio-line' + (S.setInit === "empty" ? " on" : "") + '" data-init="empty"><span class="radio-dot"></span>'
    + '<span class="radio-main"><b>先建空分组</b><span>之后拖拽或按筛选加入。</span></span></div></div>';
}
function filterSummary(){
  var parts = [];
  if(S.module !== "all") parts.push("目录：" + (MOD_NAME[S.module] || S.module));
  if(S.pri !== "all") parts.push("优先级：" + S.pri);
  if(S.status !== "all") parts.push("结果：" + (S.status === "__untested" ? "未执行" : STATUS_LABEL[S.status]));
  if(S.owner !== "all") parts.push("执行人：" + (S.owner === "__none" ? "未指派" : S.owner));
  if(S.bug) parts.push("只看有缺陷");
  if(S.q) parts.push("关键词：" + S.q);
  return parts.length ? parts.join(" · ") : "当前无筛选条件（等于项目全部用例）";
}
function whoPicker(){
  var q = S.memberQ.trim().toLowerCase();
  var list = PEOPLE.filter(function(p){ return !q || (p.name + p.role).toLowerCase().indexOf(q) >= 0; });
  var n = Object.keys(S.setWho).filter(function(k){ return S.setWho[k]; }).length;
  return '<div class="who-pick">'
    + '<label class="tc-search">' + ic("search")
    + '<input type="search" data-ctl="memberQ" value="' + esc(S.memberQ) + '" placeholder="搜索成员姓名 / 岗位" aria-label="搜索成员"></label>'
    + '<div class="who-list" role="group" aria-label="可见成员名单">'
    + (list.length ? list.map(function(p){
        var on = !!S.setWho[p.id];
        return '<label class="who-row' + (on ? " on" : "") + '" data-who="' + p.id + '">'
          + '<span class="box">' + (on ? ic("check") : "") + '</span>' + avatar(p.name)
          + '<span class="who-name">' + esc(p.name) + '</span><span class="who-role">' + esc(p.role) + '</span></label>';
      }).join("") : '<div class="who-empty">没有匹配的成员</div>')
    + '</div>'
    + '<div class="hint">已选 <b>' + n + '</b> / 50 人；创建人始终可见，不占名额。名单外成员看不到该分组，也不能按它筛选。</div>'
    + '</div>';
}
function ruleBuilder(hits){
  var r = S.setRule;
  var sel = function(key, label, opts){
    return '<div class="field"><label>' + label + '</label><select class="ctl" data-ctl="rule.' + key + '" aria-label="' + label + '">'
      + opts.map(function(o){ return '<option value="' + o[0] + '"' + (String(r[key]) === String(o[0]) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("")
      + '</select></div>';
  };
  var modOpts = [["all", "全部目录"]].concat(MODULES.map(function(m){
    return [m.id, m.name + "（" + CASES.filter(function(c){ return c.module === m.id || (m.children || []).some(function(ch){ return ch.id === c.module; }); }).length + "）"];
  })).concat([["__none", "未归类"]]);
  var flag = function(key, label, title){
    return '<label class="check-line' + (r[key] ? " on" : "") + '" data-rule="' + key + '" title="' + esc(title || "") + '">'
      + '<span class="box">' + (r[key] ? ic("check") : "") + '</span><span>' + label + '</span></label>';
  };
  return '<div class="rule-box">'
    + '<div class="rule-head">' + ic("filter") + '<b>收录规则</b>'
    + '<span class="muted">与用例库筛选同一套条件，不新造查询语言</span>'
    + '<div class="grow"></div>'
    + '<button type="button" class="btn sm' + (r.regression ? " primary" : "") + '" data-rule="regression">' + ic("refresh") + '一键回归集</button></div>'
    + '<div class="rule-grid">'
    + sel("status", "执行结果", [["all", "全部"], ["passed", "通过"], ["failed", "失败"], ["blocked", "阻塞"], ["skipped", "跳过"], ["__untested", "未执行"]])
    + sel("pri", "优先级", [["all", "全部"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"], ["P3", "P3"], ["__none", "未设置"]])
    + sel("module", "模块目录", modOpts)
    + sel("demand", "主需求", [["all", "全部"]].concat(DEMANDS.map(function(d){ return [d.id, d.no + " · " + d.title]; })))
    + sel("owner", "最近执行人", [["all", "全部"], ["__none", "未指派"]].concat(OWNERS.filter(Boolean).map(function(o){ return [o, o]; })))
    + '<div class="field"><label>关键词</label><input type="text" data-ctl="rule.q" value="' + esc(r.q) + '" maxlength="100" placeholder="≤100 字，留空不限"></div>'
    + '</div>'
    + '<div class="rule-flags">' + flag("moduleSub", "含子目录") + flag("searchWide", "关键词含步骤与前置")
    + flag("bug", "只看有缺陷") + flag("regression", "回归口径：失败 / 阻塞 或 有未关闭缺陷") + '</div>'
    + '<div class="rule-hit' + (hits > 2000 ? " over" : "") + '">' + ic(hits > 2000 ? "alert" : "check")
    + '<span>当前规则命中 <b>' + hits + '</b> 条'
    + (ruleEmpty(r) ? ' · <b class="bad">至少要有一个条件</b>，否则等于收录全部用例' : "")
    + (hits > 2000 ? ' · 超出上限 2000，请先收窄条件' : ' · 上限 2000 条')
    + '</span></div>'
    + '<div class="hint">规则按<b>创建人</b>的可见范围计算；读取分组时自动补齐 / 摘除成员引用，因此计数、圈选入计划与发布证据与手工分组同口径。动态分组不能手工增删用例。</div>'
    + '</div>';
}
function modalHTML(){
  var m = S.modal;
  if(!m) return "";
  var body = "", foot = "", title = "", sub = "";
  if(m.kind === "move"){
    title = "移动 " + m.ids.length + " 条用例";
    sub = "拖拽归类会改变用例的模块归属，编号与执行历史保持不变。";
    body = '<div class="move-arrow"><span class="from">' + esc(m.from) + '</span>' + ic("arrow-right") + '<span class="to">' + esc(m.to) + '</span></div>'
      + '<div class="kv">' + ic("check") + '<span>用例编号 <b>不变</b>（TC-001 项目内稳定，缺陷与评审仍可用旧编号引用）</span></div>'
      + '<div class="kv">' + ic("check") + '<span>执行流水、失败证据、缺陷回链 <b>全部保留</b></span></div>'
      + '<div class="kv">' + ic("alert") + '<span>覆盖矩阵与模块计数 <b>随之变化</b>；已冻结的发布快照不受影响</span></div>'
      + '<div class="kv">' + ic("alert") + '<span>其中 <b>' + m.inPlan + ' 条</b>仍在进行中的测试计划里，移动后计划范围不变（计划按用例引用）</span></div>'
      + '<div class="case-list compact" style="margin-top:10px;max-height:168px;overflow:auto">'
      + m.preview.map(function(c){ return caseRow(c); }).join("") + '</div>';
    foot = '<button type="button" class="btn" data-modal="cancel">取消</button>'
      + '<button type="button" class="btn primary" data-modal="move-ok">移动 ' + m.ids.length + ' 条</button>';
  } else if(m.kind === "newset"){
    var editing = m.edit ? setOf(m.edit) : null;
    title = editing ? "编辑分组 · " + editing.name : "新建分组";
    sub = "分组是多归属的用例集：一条用例可进多个分组，删除分组不会删除用例。";
    var hits = ruleHits(S.setRule);
    body = '<div class="field"><label for="setName">分组名称</label>'
      + '<input type="text" id="setName" data-ctl="setName" value="' + esc(S.setName) + '" maxlength="60">'
      + '<div class="hint">≤60 字，同一项目内不重名。</div></div>'
      + '<div class="field" style="margin-top:11px"><label>可见范围</label>'
      + visLine("team", "团队共享", "项目内成员可见可用，可被测试计划引用，进交付说明与发布证据。推荐。")
      + visLine("members", "指定成员可见", "创建人 + 名单内成员可见（最多 50 人），不进证据链；适合跨团队联调。")
      + visLine("mine", "仅自己可见", "只用于个人整理，不进证据链；要写进交付说明需先转为团队共享。")
      + (S.setVis === "members" ? whoPicker() : "")
      + (editing && editing.vis === "team" && S.setVis !== "team"
          ? '<div class="hint warn">' + ic("alert") + '收窄团队分组的可见范围需由创建人操作，避免其他成员突然看不到。</div>' : "")
      + '</div>'
      + '<div class="field" style="margin-top:11px"><label>分组类型</label>'
      + kindLine("manual", "手工挑选", "拖入或按筛选加入，成员固定；适合冒烟集、本轮必测。")
      + kindLine("dynamic", "动态收录（保存的筛选）", "命中条件的新用例自动进入，不再命中自动移出；适合回归集。")
      + '</div>'
      + (S.setKind === "dynamic" ? ruleBuilder(hits) : initPicker())
      + '<div class="kv" style="margin-top:10px">' + ic("shield")
      + '<span>只有<b>团队共享</b>分组进交付说明与发布证据；证据只呈现结果分布，不改变发布阻断判定。</span></div>';
    foot = '<button type="button" class="btn" data-modal="cancel">取消</button>'
      + '<button type="button" class="btn primary" data-modal="newset-ok">' + (m.edit ? "保存分组" : "创建分组") + '</button>';
  } else if(m.kind === "plan"){
    var rows = filtered();
    var already = Math.min(37, rows.length);
    title = "确认加入测试计划";
    sub = "加入是引用，不复制用例；执行结果仍写计划内结果并追加执行流水。";
    body = '<div class="pick-sum"><b>' + (rows.length - already) + '</b><span>条将加入「v2.2 回归 · 进行中」</span>'
      + '<div class="pick-rows"><div class="pick-row">筛选匹配<span class="n">' + rows.length + '</span></div>'
      + '<div class="pick-row">已在计划中（跳过）<span class="n">-' + already + '</span></div>'
      + '<div class="pick-row">无写权限（跳过）<span class="n">-0</span></div></div></div>'
      + '<div class="kv" style="margin-top:10px">' + ic("shield") + '<span>其中 <b>' + rows.filter(function(c){ return c.required; }).length + ' 条</b> P0 / P1 将标记「发布必测」</span></div>'
      + '<div class="kv">' + ic("alert") + '<span>计划范围变化会写入项目活动轨迹与审计日志，可追溯谁在何时加了哪些用例</span></div>'
      + (S.planDynamic ? '<div class="kv">' + ic("refresh") + '<span>同时创建团队共享动态分组「<b>' + esc(S.planSetName)
          + '</b>」，规则 = ' + esc(filterSummary()) + '；此后命中的新用例自动收录，计划内已有用例不受影响</span></div>' : "");
    foot = '<button type="button" class="btn" data-modal="cancel">取消</button>'
      + '<button type="button" class="btn primary" data-modal="plan-ok">确认加入</button>';
  }
  return '<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">'
    + '<div class="modal-header"><div class="modal-header-main"><div class="modal-title">' + esc(title) + '</div>'
    + '<div class="modal-sub">' + esc(sub) + '</div></div>'
    + '<button type="button" class="icon-btn" data-modal="cancel" aria-label="关闭">' + ic("x") + '</button></div>'
    + '<div class="modal-body">' + body + '</div>'
    + '<div class="modal-footer">' + foot + '</div></div></div>';
}

/* ---------- 渲染 ---------- */
var RENDER = { list:renderList, group:renderGroup, drag:renderDrag, sets:renderSets, plan:renderPlan };
function render(){
  document.querySelectorAll(".screen").forEach(function(sec){
    var v = sec.dataset.screen;
    sec.hidden = v !== S.view;
    if(v === S.view) sec.innerHTML = RENDER[v]();
  });
  document.querySelectorAll(".proto-tabs button").forEach(function(b){
    b.classList.toggle("on", b.dataset.view === S.view);
  });
  var crumb = { list:"用例库 · 查询体验", group:"用例库 · 分组显示", drag:"用例库 · 拖拽归类",
                sets:"用例库 · 自定义分组", plan:"用例库 · 按筛选圈选" }[S.view];
  $("#crumbs").innerHTML = '<b>测试</b>' + ic("chevron-right") + '<span>' + crumb + '</span>';
  $("#modalHost").innerHTML = modalHTML();
  $("#scrim").hidden = !S.modal;
  var t = $("#toast");
  if(S.toast){ t.innerHTML = S.toast; t.classList.add("show"); }
  else { t.classList.remove("show"); }
  document.body.dataset.view = S.view;
}
function toast(msg, undo){
  S.toast = undo ? '<span class="undo-toast">' + msg + '<button type="button" data-undo="1">撤销</button></span>' : msg;
  render();
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ S.toast = null; render(); }, 4200);
}

/* ---------- 交互 ---------- */
function setView(v){ if(RENDER[v]){ S.view = v; S.pop = null; render(); } }
function openSetModal(setId){
  var s = setId ? setOf(setId) : null;
  S.setName = s ? s.name : "对账导出 · 回归";
  S.setVis = s ? s.vis : "team";
  S.setKind = s && s.dynamic ? "dynamic" : "manual";
  S.setRule = ruleCopy(s && s.ruleObj);
  S.setWho = {};
  if(s && s.who) s.who.forEach(function(id){ S.setWho[id] = true; });
  S.setInit = "filter";
  S.memberQ = "";
  S.modal = { kind:"newset", edit:s ? s.id : null };
}
function applyForced(){
  var f = S.forced;
  if(!f) return;
  if(f === "sort"){ S.pop = "sort"; }
  else if(f === "export"){ S.pop = "export"; }
  else if(f === "selectall"){ S.selMode = "filter"; }
  else if(f === "collapsed"){ S.collapsed = { m11:true, m12:true, m21:true, m22:true }; }
  else if(f === "over"){
    S.sel = {}; S.selMode = "ids";
    var picks = sorted(filtered()).slice(0,3);
    picks.forEach(function(c){ S.sel[c.id] = true; });
    S.drag = { ids:picks.map(function(c){ return c.id; }), title:picks[0].title, from:MOD_NAME[picks[0].module] };
    S.dropTarget = "d:m31";
  }
  else if(f === "confirm"){
    var picks2 = sorted(filtered()).slice(0,3);
    S.modal = { kind:"move", ids:picks2.map(function(c){ return c.id; }), from:MOD_NAME[picks2[0].module],
                to:"对账导出 / 批量导出", inPlan:1, preview:picks2 };
    S.drag = null; S.dropTarget = null;
  }
  else if(f === "newset"){ openSetModal(null); }
  else if(f === "newsetdynamic"){ openSetModal(null); S.setKind = "dynamic"; S.setRule = ruleCopy(null); S.setRule.regression = true; }
  else if(f === "newsetmembers"){ openSetModal(null); S.setVis = "members"; S.setWho = { u2:true, u5:true, u6:true }; }
  else if(f === "editset"){ openSetModal(S.activeSet); }
  else if(f === "planconfirm"){ S.modal = { kind:"plan" }; }
  else if(f === "dragset"){
    S.view = "sets";
    var p3 = sorted(filtered()).slice(0,2);
    S.drag = { ids:p3.map(function(c){ return c.id; }), title:p3[0].title };
    S.dropTarget = "s:s3";
  }
}
document.addEventListener("click", function(e){
  var t = e.target.closest("[data-view],[data-status],[data-bug],[data-clear],[data-pop],[data-sort],[data-sortdir],[data-selall],[data-pick],[data-more],[data-bulk],[data-grptoggle],[data-grpsel],[data-grpmore],[data-collapse],[data-dir],[data-dirtoggle],[data-set],[data-modal],[data-undo],[data-dynamic],[data-planconfirm],[data-export],[data-grp],[data-wide],[data-dirsub],[data-vis],[data-kind],[data-init],[data-who],[data-rule]");
  if(!t){ if(S.pop){ S.pop = null; render(); } return; }
  var d = t.dataset;
  if(d.view){ setView(d.view); return; }
  if(d.wide){ S.searchWide = !S.searchWide; S.loaded = S.pageSize; render(); return; }
  if(d.dirsub){ S.dirSub = !S.dirSub; S.selMode = "ids"; S.sel = {}; S.loaded = S.pageSize; render(); return; }
  if(d.status){ S.status = d.status; S.loaded = S.pageSize; render(); return; }
  if(d.bug){ S.bug = !S.bug; S.loaded = S.pageSize; render(); return; }
  if(d.clear){ S.status = "all"; S.module = "all"; S.pri = "all"; S.owner = "all"; S.bug = false; S.q = ""; S.selMode = "ids"; S.sel = {}; S.loaded = S.pageSize; render(); return; }
  if(d.vis){ S.setVis = d.vis; render(); return; }
  if(d.kind){ S.setKind = d.kind; render(); return; }
  if(d.init){ S.setInit = d.init; render(); return; }
  if(d.who){ S.setWho[d.who] = !S.setWho[d.who]; render(); return; }
  if(d.rule){
    if(d.rule === "regression"){
      S.setRule.regression = !S.setRule.regression;
      if(S.setRule.regression){ S.setRule.status = "all"; S.setRule.bug = false; }
    } else {
      S.setRule[d.rule] = !S.setRule[d.rule];
    }
    render(); return;
  }
  if(d.pop){
    if(d.pop === "newset"){ openSetModal(null); render(); return; }
    if(d.pop === "editset"){ openSetModal(S.activeSet); render(); return; }
    S.pop = S.pop === d.pop ? null : d.pop; render(); return;
  }
  if(d.sort){ S.sort = d.sort; S.pop = null; S.loaded = S.pageSize; render(); return; }
  if(d.sortdir){
    if(d.sortdir === "asc" || d.sortdir === "desc") S.sortDir = d.sortdir;
    else S.sortDir = S.sortDir === "asc" ? "desc" : "asc";
    S.pop = null; render(); return;
  }
  if(d.selall){
    if(S.selMode === "filter"){ S.selMode = "ids"; S.sel = {}; }
    else { S.selMode = "filter"; S.sel = {}; }
    render(); return;
  }
  if(d.pick){
    if(S.selMode === "filter"){ S.selMode = "ids"; S.sel = {}; filtered().forEach(function(c){ S.sel[c.id] = true; }); }
    S.sel[d.pick] = !S.sel[d.pick]; render(); return;
  }
  if(d.more){ S.loaded = Math.min(S.loaded + S.pageSize, filtered().length); render(); return; }
  if(d.bulk){
    if(d.bulk === "clear"){ S.selMode = "ids"; S.sel = {}; render(); return; }
    if(d.bulk === "plan"){ S.modal = { kind:"plan" }; render(); return; }
    if(d.bulk === "set"){ openSetModal(null); render(); return; }
    toast("原型示意：批量「" + ({ module:"改模块", pri:"改优先级", export:"导出所选" }[d.bulk] || d.bulk) + "」作用于已选 " + selCount() + " 条");
    return;
  }
  if(d.grptoggle){ S.collapsed[d.grptoggle] = !S.collapsed[d.grptoggle]; render(); return; }
  if(d.grpsel){
    var g = groupKeys(filtered()).filter(function(x){ return String(x.key) === d.grpsel; })[0];
    if(g){ S.selMode = "ids"; g.rows.forEach(function(c){ S.sel[c.id] = true; }); toast("已全选本组 " + g.rows.length + " 条"); }
    return;
  }
  if(d.grpmore){ toast("原型示意：段内继续加载「" + d.grpmore + "」的下一页"); return; }
  if(d.collapse){
    S.collapsed = {};
    if(d.collapse === "all") groupKeys(filtered()).forEach(function(g){ S.collapsed[g.key] = true; });
    render(); return;
  }
  if(d.dirtoggle){ S.dirOpen[d.dirtoggle] = !S.dirOpen[d.dirtoggle]; render(); return; }
  if(d.dir){ S.dirNode = d.dir; S.selMode = "ids"; S.sel = {}; S.loaded = S.pageSize; render(); return; }
  if(d.set){ S.activeSet = d.set; render(); return; }
  if(d.dynamic){ S.planDynamic = !S.planDynamic; render(); return; }
  if(d.planconfirm){ S.modal = { kind:"plan" }; render(); return; }
  if(d.export){
    S.pop = null;
    var label = { filter:"当前筛选结果 " + filtered().length + " 条", sel:"所选 " + selCount() + " 条", all:"项目全部 " + CASES.length + " 条", tpl:"导入模板" }[d.export];
    toast("原型示意：导出 CSV · " + label);
    return;
  }
  if(d.undo){ S.toast = null; toast("已撤销，归属恢复原值"); return; }
  if(d.modal){
    var kind = S.modal && S.modal.kind;
    if(d.modal === "cancel"){ S.modal = null; render(); return; }
    if(d.modal === "move-ok"){
      var n = S.modal.ids.length, to = S.modal.to;
      S.modal = null; S.drag = null; S.dropTarget = null; S.sel = {}; S.selMode = "ids";
      toast("已移动 " + n + " 条用例到「" + to + "」，编号与执行历史不变", true); return;
    }
    if(d.modal === "newset-ok"){
      var visLabel = { team:"团队共享", members:"指定成员可见", mine:"仅自己可见" }[S.setVis];
      var what = S.setKind === "dynamic"
        ? "动态分组「" + S.setName + "」，按规则收录 " + ruleHits(S.setRule) + " 条"
        : "分组「" + S.setName + "」，加入 " + (S.setInit === "filter" ? filtered().length : 0) + " 条";
      S.modal = null; toast("已保存" + what + " · " + visLabel); return;
    }
    if(d.modal === "plan-ok"){
      var add = filtered().length - Math.min(37, filtered().length);
      S.modal = null; toast("已加入 " + add + " 条用例到「v2.2 回归」，跳过 37 条重复"); return;
    }
    S.modal = null; render(); return;
  }
});
document.addEventListener("change", function(e){
  var el = e.target.closest("[data-ctl]");
  if(!el) return;
  var k = el.dataset.ctl, v = el.value;
  if(k === "q" || k === "memberQ" || k === "rule.q") return;
  if(k === "sort"){ S.sort = v; }
  else if(k === "group"){ S.groupBy = v; S.collapsed = {}; if(v !== "none" && S.view === "list") S.view = "group"; }
  else if(k === "pageSize"){ S.pageSize = Number(v); S.loaded = Number(v); }
  else if(k === "planTarget"){ S.planTarget = v; }
  else if(k === "planName"){ S.planName = v; }
  else if(k === "planSetName"){ S.planSetName = v; }
  else if(k === "setName"){ S.setName = v; }
  else if(k.indexOf("rule.") === 0){ S.setRule[k.slice(5)] = v; }
  else { S[k] = v; }
  if(["planTarget", "planName", "planSetName", "setName"].indexOf(k) < 0 && k.indexOf("rule.") !== 0) S.loaded = S.pageSize;
  render();
});
document.addEventListener("input", function(e){
  var el = e.target.closest('[data-ctl="q"],[data-ctl="memberQ"],[data-ctl="rule.q"]');
  if(!el) return;
  var k = el.dataset.ctl, v = el.value;
  if(k === "q") S.q = v;
  else if(k === "memberQ") S.memberQ = v;
  else S.setRule.q = v;
  if(k === "q") S.loaded = S.pageSize;
  clearTimeout(S._qt);
  S._qt = setTimeout(function(){
    render();
    var box = document.querySelector('[data-ctl="' + k + '"]');
    if(box){ box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }, 220);
});

/* ---------- 拖拽 ---------- */
function dragIds(c){
  if(isSel(c) && selCount() > 1) return selectedIds();
  return [c.id];
}
document.addEventListener("dragstart", function(e){
  var row = e.target.closest(".case-row[draggable]");
  if(!row) return;
  var c = CASES.filter(function(x){ return x.id === row.dataset.case; })[0];
  if(!c) return;
  var ids = dragIds(c);
  S.drag = { ids:ids, title:c.title, from:MOD_NAME[c.module] };
  try{ e.dataTransfer.setData("text/plain", ids.join(",")); e.dataTransfer.effectAllowed = "move"; }catch(err){}
  render();
});
document.addEventListener("dragend", function(){ S.drag = null; S.dropTarget = null; render(); });
document.addEventListener("dragover", function(e){
  var node = e.target.closest("[data-dir],[data-grp],[data-set]");
  if(!node || !S.drag) return;
  e.preventDefault();
  var key = node.dataset.dir ? "d:" + node.dataset.dir : (node.dataset.grp ? "g:" + node.dataset.grp : "s:" + node.dataset.set);
  if(S.dropTarget !== key){ S.dropTarget = key; render(); }
});
document.addEventListener("drop", function(e){
  var node = e.target.closest("[data-dir],[data-grp],[data-set]");
  if(!node || !S.drag) return;
  e.preventDefault();
  var ids = S.drag.ids.slice();
  var preview = CASES.filter(function(c){ return ids.indexOf(c.id) >= 0; }).slice(0,4);
  if(node.dataset.set){
    var s = setOf(node.dataset.set);
    S.drag = null; S.dropTarget = null;
    toast("已加入分组「" + s.name + "」" + ids.length + " 条（多归属，原分组保留）", true);
    return;
  }
  var targetId = node.dataset.dir || node.dataset.grp;
  var to = MOD_NAME[targetId] || targetId;
  S.modal = { kind:"move", ids:ids, from:S.drag.from, to:to,
              inPlan:CASES.filter(function(c){ return ids.indexOf(c.id) >= 0 && c.required; }).length, preview:preview };
  S.drag = null; S.dropTarget = null; render();
});

/* ---------- 启动 ---------- */
var params = new URLSearchParams(location.search);
if(params.get("view") && RENDER[params.get("view")]) S.view = params.get("view");
if(params.get("group")) S.groupBy = params.get("group");
if(params.get("sort")) S.sort = params.get("sort");
if(params.get("status")) S.status = params.get("status");
if(params.get("module")) S.module = params.get("module");
if(params.get("forced")) S.forced = params.get("forced");
if(params.get("set") && setOf(params.get("set"))) S.activeSet = params.get("set");
if(params.get("pageSize")){ S.pageSize = Number(params.get("pageSize")); S.loaded = S.pageSize; }
if(params.get("loaded")) S.loaded = Number(params.get("loaded"));
if(S.view === "group" && S.groupBy === "none") S.groupBy = "module";
if(S.view === "drag"){ S.module = "all"; }
applyForced();
render();

window.PROTO = {
  state:S, data:{ CASES:CASES, MODULES:MODULES, SETS:SETS, DEMANDS:DEMANDS, PEOPLE:PEOPLE },
  setView:setView, render:render, filtered:filtered, selectedIds:selectedIds,
  ruleHits:ruleHits, ruleText:ruleText, ruleMatch:ruleMatch, openSetModal:openSetModal,
  force:function(f){ S.forced = f; applyForced(); render(); },
  toast:toast
};
})();