/* views/branches · 分支管理 */

import { API } from "../core/api.js";
import { $, branchDot } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { activeView } from "../core/router.js";
import { rt, state } from "../core/state.js";
import { openTaskById } from "../core/task-actions.js";
import { ownerOptions } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarHTML, fmtTs } from "../lib/format.js";
import { render } from "./board.js";

var BRANCH_STATUS = [
  { id:"dev",      name:"开发中", cls:"br-st-dev",      timeKey:"devAt",      hint:"代码还在写" },
  { id:"testing",  name:"待测试", cls:"br-st-testing",  timeKey:"testAt",     hint:"开发完成，等测试验证" },
  { id:"merging",  name:"待合并", cls:"br-st-merging",  timeKey:"mergeAt",    hint:"测过了，等合并窗口" },
  { id:"released", name:"已发布", cls:"br-st-released", timeKey:"releasedAt", hint:"已上线" }
];
var branchList = [], branchesLoaded = false;
var branchFilter = "";
var brDrawerId = null;
var brEditingId = null;
function branchStatusMeta(id){
  for(var i = 0; i < BRANCH_STATUS.length; i++) if(BRANCH_STATUS[i].id === id) return BRANCH_STATUS[i];
  return { id: id, name: id || "未知", cls: "", timeKey: "", hint: "" };
}
function branchById(id){
  for(var i = 0; i < branchList.length; i++) if(branchList[i].id === id) return branchList[i];
  return null;
}
function branchNameById(id){
  var b = branchById(id);
  return b ? b.name : "";
}
function branchDurText(ms){
  if(!ms || ms < 0) return "刚刚";
  var h = Math.floor(ms / 3600000);
  if(h < 1) return "刚刚";
  if(h < 24) return h + " 小时";
  var d = Math.floor(h / 24);
  if(d < 60) return d + " 天";
  return Math.floor(d / 30) + " 个月";
}
function branchStay(b){
  if(b.status === "released"){
    if(!b.releasedAt || !b.createdAt) return { text:"周期 —", tip:"缺少发布或创建时间" };
    var span = new Date(b.releasedAt).getTime() - new Date(b.createdAt).getTime();
    return { text:"周期 " + branchDurText(span),
             tip:"创建 " + fmtTs(b.createdAt) + " → 发布 " + fmtTs(b.releasedAt) };
  }
  var meta = branchStatusMeta(b.status);
  var from = b[meta.timeKey] || b.createdAt;
  if(!from) return { text:"—", tip:"没有进入该状态的时间" };
  var ms = Date.now() - new Date(from).getTime();
  var q = branchDurText(ms);
  return { text: (q === "刚刚" ? "刚刚进入" : "已 " + q), tip: meta.name + "自 " + fmtTs(from) };
}
function loadBranches(force){
  if(branchesLoaded && !force) return Promise.resolve(branchList);
  return API.get("/api/branches").then(function(rows){
    branchList = rows || [];
    branchesLoaded = true;
    if(activeView === "branches") renderBranches();
    populateBranchSelect();
    updateBranchDot();
    /* 看板卡片上带着分支标签，数据回来后要重画一次（render 会重建 DOM，所以只在看板停留时做） */
    if(state.board && activeView === "board") render({animate:false});
  }).catch(function(){ /* 分支模块不可用时静默降级，不影响主流程 */ });
}
function updateBranchDot(){
  if(!branchDot) return;
  var n = 0;
  branchList.forEach(function(b){ if(b.status !== "released") n++; });
  branchDot.hidden = n === 0;
  branchDot.textContent = n > 99 ? "99+" : String(n);
  branchDot.title = n ? (n + " 条分支还没发布") : "";
}
function enterBranchesView(){
  renderBranches();                       // 先用缓存出一版，避免空白
  loadBranches().then(function(){ renderBranches(); });
}
function branchStat(){
  var s = { total: 0 };
  BRANCH_STATUS.forEach(function(x){ s[x.id] = 0; });
  branchList.forEach(function(b){
    s.total++;
    if(s[b.status] === undefined) s[b.status] = 0;
    s[b.status]++;
  });
  return s;
}
function branchCycleAvg(){
  var sum = 0, n = 0;
  branchList.forEach(function(b){
    if(b.status !== "released" || !b.releasedAt || !b.createdAt) return;
    var ms = new Date(b.releasedAt).getTime() - new Date(b.createdAt).getTime();
    if(ms >= 0){ sum += ms; n++; }
  });
  if(!n) return null;
  return (sum / n / 86400000).toFixed(sum / n / 86400000 >= 10 ? 0 : 1);
}
function renderBranches(){
  var box = $("branchGroups");
  if(!box) return;
  var st = branchStat();
  var meta = $("branchMeta");
  if(meta){
    var cycle = branchCycleAvg();
    meta.textContent = st.total
      ? ("共 " + st.total + " 条 · 开发中 " + st.dev + " · 待测试 " + st.testing +
         " · 待合并 " + st.merging + " · 已发布 " + st.released +
         (cycle === null ? "" : (" · 平均发布周期 " + cycle + " 天")) +
         (branchFilter ? ("　·　仅看「" + branchStatusMeta(branchFilter).name + "」（点列头取消）") : ""))
      : "";
  }

  if(!st.total){
    box.innerHTML = '<div class="br-emptyall">' +
      '还没有分支。点右上角「新建分支」把正在开发的分支记下来 —— 之后每次改状态都会自动留下时间，' +
      '谁在什么时候把它推到哪一步一目了然。</div>';
    return;
  }

  var kw = (($("branchSearch") || {}).value || "").trim().toLowerCase();
  var rows = branchList.filter(function(b){
    if(branchFilter && b.status !== branchFilter) return false;
    if(!kw) return true;
    return String(b.name || "").toLowerCase().indexOf(kw) !== -1
        || String(b.targetBranch || "").toLowerCase().indexOf(kw) !== -1
        || String(b.owner || "").toLowerCase().indexOf(kw) !== -1;
  });
  if(!rows.length){
    box.innerHTML = '<div class="br-emptyall">没有匹配的分支' +
      (branchFilter ? '（当前只看「' + esc(branchStatusMeta(branchFilter).name) + '」）' : '') + '。</div>';
    return;
  }

  box.innerHTML = BRANCH_STATUS.map(function(s){
    var items = rows.filter(function(b){ return b.status === s.id; });
    var on = branchFilter === s.id;
    return '<div class="br-group" data-status="' + s.id + '">' +
      '<div class="br-group-head' + (on ? " on" : "") + '" data-br-filter="' + s.id + '" role="button" tabindex="0"' +
        ' aria-pressed="' + on + '" title="点击只看这一档；再点一次取消">' +
        '<i class="br-dot ' + s.cls + '"></i>' +
        '<span class="br-group-name">' + s.name + '</span>' +
        '<span class="br-group-n">' + items.length + '</span>' +
        '<span class="br-group-hint">' + s.hint + '</span>' +
      '</div>' +
      '<div class="br-group-body">' +
        (items.length ? items.map(branchCardHTML).join("") : '<div class="br-empty">暂无</div>') +
      '</div>' +
    '</div>';
  }).join("");
}
function branchCardHTML(b){
  var sm = branchStatusMeta(b.status);
  var stay = branchStay(b);
  var taskTxt = b.taskCount
    ? ((b.doneCount || 0) + "/" + b.taskCount + " 工作项")
    : "无关联工作项";
  return '<article class="br-card" data-branch="' + esc(b.id) + '" tabindex="0" role="button"' +
      ' aria-label="' + esc(b.name) + '，' + esc(sm.name) + '">' +
    '<div class="br-card-top">' +
      '<button class="br-badge ' + sm.cls + '" type="button" data-br-status-menu="' + esc(b.id) + '"' +
        ' title="点击切换状态">' + sm.name + icon("down", 11) + '</button>' +
      (b.owner ? '<span class="br-owner" title="负责人：' + esc(b.owner) + '">' + avatarHTML(b.owner) + '</span>' : '') +
    '</div>' +
    '<div class="br-name" title="' + esc(b.name) + '">' + esc(b.name) + '</div>' +
    (b.targetBranch ? '<div class="br-target" title="目标分支：' + esc(b.targetBranch) + '">→ ' + esc(b.targetBranch) + '</div>' : '') +
    (b.note ? '<div class="br-note" title="' + esc(b.note) + '">' + esc(b.note) + '</div>' : '') +
    '<div class="br-card-foot">' +
      '<span class="br-tasks">' + icon("checklist", 12) + taskTxt + '</span>' +
      '<span class="br-age" title="' + esc(stay.tip) + '">' + esc(stay.text) + '</span>' +
    '</div>' +
  '</article>';
}
function openBranchStatusMenu(anchor, id){
  var b = branchById(id);
  if(!b) return;
  var el = document.createElement("div");
  el.className = "menu br-status-menu";
  el.innerHTML = BRANCH_STATUS.map(function(s){
    var cur = s.id === b.status;
    return '<button class="menu-item' + (cur ? " on" : "") + '" type="button" data-br-set="' + s.id + '">' +
        '<i class="br-dot ' + s.cls + '"></i>' + s.name +
        (cur ? '<span class="k">当前</span>' : '') +
      '</button>';
  }).join("") +
    '<div class="menu-sep"></div>' +
    '<button class="menu-item" type="button" data-br-edit="1">编辑分支信息</button>' +
    (rt.currentWs && rt.currentWs.myRole === "owner"
      ? '<button class="menu-item danger" type="button" data-br-del="1">删除分支</button>' : '');
  el.addEventListener("click", function(e){
    var set = e.target.closest("[data-br-set]");
    if(set){
      UI.closeAllPops();
      setBranchStatus(id, set.dataset.brSet);
      return;
    }
    if(e.target.closest("[data-br-edit]")){ UI.closeAllPops(); openBranchDialog(id); return; }
    if(e.target.closest("[data-br-del]")){ UI.closeAllPops(); deleteBranch(id); }
  });
  UI.openPop(el, anchor, { align: "left" });
}
function setBranchStatus(id, status){
  var b = branchById(id);
  if(!b || b.status === status) return;
  API.post("/api/branches/" + encodeURIComponent(id) + "/status", { status: status })
    .then(function(nb){
      toast("「" + nb.name + "」→ " + branchStatusMeta(nb.status).name, "fs");
      return loadBranches(true);
    })
    .then(function(){
      if(brDrawerId === id) openBranchDrawer(id);
    })
    .catch(function(ex){ toast(ex.message || "状态切换失败", "bad"); });
}
function fillBranchStatusOptions(sel, cur){
  if(!sel) return;
  sel.innerHTML = BRANCH_STATUS.map(function(s){
    return '<option value="' + s.id + '"' + (s.id === cur ? " selected" : "") + '>' + s.name + '</option>';
  }).join("");
}
function openBranchDialog(id){
  brEditingId = id || null;
  var b = brEditingId ? branchById(brEditingId) : null;
  $("dlgBranchTitle").textContent = b ? "编辑分支" : "新建分支";
  $("dlgBranchMsg").textContent = b
    ? "状态不在这里改 —— 点分支卡片上的状态标签切换，那样才会记进时间线。"
    : "分支名照 git 里的写法填，建好之后就能跟状态和时间。";
  $("dlgBranchOk").textContent = b ? "保存" : "创建分支";
  /* 编辑时隐藏「初始状态」（状态只能走状态切换接口） */
  if($("brStatusField")) $("brStatusField").hidden = !!b;
  $("brName").value = b ? (b.name || "") : "";
  $("brTarget").value = b ? (b.targetBranch || "") : "";
  $("brNote").value = b ? (b.note || "") : "";
  fillBranchStatusOptions($("brStatus"), b ? b.status : "dev");

  /* 负责人：沿用任务抽屉的口径（成员列表 + 账号绑定） */
  var sel = $("brOwner");
  if(sel){
    var opts = ownerOptions();
    var curName = b ? (b.owner || "") : (rt.currentUser ? (rt.currentUser.displayName || "") : "");
    var curId = b ? (b.ownerUserId || "") : (rt.currentUser ? rt.currentUser.id : "");
    var html = "", matched = false;
    opts.forEach(function(o){
      var on = (curId && o.id === curId) || (!curId && curName && o.name === curName);
      if(on) matched = true;
      html += '<option value="' + esc(o.id) + '" data-name="' + esc(o.name) + '"' + (on ? " selected" : "") + '>' +
        esc(o.name) + '</option>';
    });
    if(curName && !matched){
      html += '<option value="__text__" data-name="' + esc(curName) + '" selected>○ ' + esc(curName) + '（非成员）</option>';
    }
    sel.innerHTML = html;
  }

  $("dlgBranch").__uiOnClose = function(){ brEditingId = null; };
  UI.openModal($("dlgBranch"));
  setTimeout(function(){ try{ $("brName").focus(); }catch(e){ /* noop */ } }, 40);
}
function closeBranchDialog(){
  var d = $("dlgBranch");
  if(d) UI.closeModal(d);
  brEditingId = null;
}
function submitBranchDialog(){
  var name = ($("brName").value || "").trim();
  if(!name){ toast("请填写分支名", "warn"); try{ $("brName").focus(); }catch(e){} return; }
  if(!/^[\p{L}\p{N}._/-]{1,80}$/u.test(name)){
    toast("分支名只允许字母、数字、点、下划线、中划线、斜杠", "warn");
    try{ $("brName").focus(); }catch(e){}
    return;
  }
  var sel = $("brOwner");
  var picked = sel && sel.options[sel.selectedIndex];
  var payload = {
    name: name,
    targetBranch: ($("brTarget").value || "").trim() || null,
    note: ($("brNote").value || "").trim() || null,
    owner: picked ? (picked.dataset.name || picked.textContent || null) : null,
    ownerUserId: picked && picked.value !== "__text__" ? picked.value : null
  };
  if(!brEditingId) payload.status = ($("brStatus") || {}).value || "dev";

  var req = brEditingId
    ? API.put("/api/branches/" + encodeURIComponent(brEditingId), payload)
    : API.post("/api/branches", payload);
  var wasEdit = !!brEditingId;
  var btn = $("dlgBranchOk");
  btn.disabled = true;
  req.then(function(b){
    btn.disabled = false;
    closeBranchDialog();
    toast(wasEdit ? ("已更新「" + b.name + "」") : ("已创建分支「" + b.name + "」"), "fs");
    loadBranches(true).then(function(){
      if(brDrawerId === b.id) openBranchDrawer(b.id);
    });
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
}
function deleteBranch(id){
  var b = branchById(id);
  if(!b) return;
  if(!(rt.currentWs && rt.currentWs.myRole === "owner")){ toast("仅空间主可删除分支", "warn"); return; }
  var n = b.taskCount || 0;
  UI.showConfirm({
    title: "删除分支",
    msg: "「" + esc(b.name) + "」将被删除，操作记录一起清掉" +
      (n ? ("；挂在它上面的 " + n + " 个任务会解除关联（任务本身保留）") : "") + "。确定删除？",
    okText: "删除分支"
  }).then(function(ok){
    if(!ok) return;
    API.del("/api/branches/" + encodeURIComponent(id)).then(function(){
      if(brDrawerId === id) closeBranchDrawer();
      toast("已删除「" + b.name + "」", "fs");
      loadBranches(true);
    }).catch(function(ex){ toast(ex.message || "删除失败", "bad"); });
  });
}
function openBranchDrawer(id){
  API.get("/api/branches/" + encodeURIComponent(id)).then(function(b){
    brDrawerId = b.id;
    renderBranchDrawer(b);
    $("branchDrawer").classList.add("on");
    loadBranchLogs(b.id);
    loadBranchTasks(b.id);
  }).catch(function(ex){ toast(ex.message || "分支加载失败", "bad"); });
}
function closeBranchDrawer(){
  var d = $("branchDrawer");
  if(d) d.classList.remove("on");
  brDrawerId = null;
}
function renderBranchDrawer(b){
  var body = $("brDrawerBody");
  if(!body) return;
  $("brDrawerTitle").textContent = b.name;
  var stay = branchStay(b);
  var segs = BRANCH_STATUS.map(function(s){
    return '<button type="button" class="' + (s.id === b.status ? "on" : "") + '"' +
      ' data-br-drawer-status="' + s.id + '" aria-pressed="' + (s.id === b.status) + '">' + s.name + '</button>';
  }).join("");
  var times = BRANCH_STATUS.map(function(s){
    var at = b[s.timeKey];
    return '<div class="br-tnode' + (at ? " on" : "") + '">' +
      '<i class="br-dot ' + s.cls + '"></i>' +
      '<span class="bt-name">' + s.name + '</span>' +
      '<span class="bt-time">' + (at ? esc(fmtTs(at)) : "未进入") + '</span>' +
    '</div>';
  }).join("");

  body.innerHTML =
    '<div class="br-drawer-seg seg grid4">' + segs + '</div>' +
    '<div class="br-drawer-stay">' + esc(stay.text) + ' · ' + esc(stay.tip) + '</div>' +
    '<div class="br-kv">' +
      '<div><span>目标分支</span><b>' + (b.targetBranch ? esc(b.targetBranch) : "—") + '</b></div>' +
      '<div><span>负责人</span><b>' + (b.owner ? esc(b.owner) : "—") + '</b></div>' +
      '<div><span>创建时间</span><b>' + esc(fmtTs(b.createdAt)) + '</b></div>' +
      '<div><span>关联工作项</span><b>' + (b.taskCount ? ((b.doneCount || 0) + " / " + b.taskCount + " 已完成") : "—") + '</b></div>' +
    '</div>' +
    (b.note ? '<p class="br-drawer-note">' + esc(b.note) + '</p>' : '') +
    '<div class="br-sect"><h4>状态时间</h4><div class="br-times">' + times + '</div></div>' +
    '<div class="br-sect"><h4>关联工作项</h4><div id="brTaskList" class="br-tasklist"><div class="tl-empty">加载中…</div></div></div>' +
    '<div class="br-sect"><h4>操作记录</h4><div id="brLogList" class="br-loglist"><div class="tl-empty">加载中…</div></div></div>' +
    '<div class="br-drawer-foot">' +
      (rt.currentWs && rt.currentWs.myRole === "owner"
        ? '<button class="btn ghost danger-text" type="button" id="brDrawerDelete">删除分支</button>' : '') +
      '<span style="flex:1 1 auto"></span>' +
      '<button class="btn" type="button" id="brDrawerEdit">编辑信息</button>' +
    '</div>';

  var del = $("brDrawerDelete");
  if(del) del.addEventListener("click", function(){ deleteBranch(b.id); });
  var ed = $("brDrawerEdit");
  if(ed) ed.addEventListener("click", function(){ openBranchDialog(b.id); });
}
function loadBranchLogs(id){
  API.get("/api/branches/" + encodeURIComponent(id) + "/logs").then(function(logs){
    var box = $("brLogList");
    if(!box || brDrawerId !== id) return;
    if(!logs || !logs.length){
      box.innerHTML = '<div class="tl-empty">暂无操作记录</div>';
      return;
    }
    box.innerHTML = logs.map(function(l){
      var actor = l.actorName ? (esc(l.actorName) + " · ") : "";
      return '<div class="tl-item"><span class="tl-time">' + esc(fmtTs(l.createdAt)) + '</span>' +
        '<span class="tl-detail">' + actor + esc(l.detail || l.action || "") + '</span></div>';
    }).join("");
  }).catch(function(){
    var box = $("brLogList");
    if(box && brDrawerId === id) box.innerHTML = '<div class="tl-empty">操作记录加载失败</div>';
  });
}
function loadBranchTasks(id){
  API.get("/api/branches/" + encodeURIComponent(id) + "/tasks").then(function(tasks){
    var box = $("brTaskList");
    if(!box || brDrawerId !== id) return;
    if(!tasks || !tasks.length){
      box.innerHTML = '<div class="tl-empty">还没有任务关联到这条分支。在任务详情的「所属分支」里挂上来。</div>';
      return;
    }
    box.innerHTML = tasks.map(function(t){
      var done = t.boardColumn === "done";
      return '<button class="br-task" type="button" data-br-task="' + esc(t.id) + '">' +
        '<span class="bt-dot' + (done ? " done" : "") + '"></span>' +
        '<span class="bt-title' + (done ? " done" : "") + '">' + esc(t.title) + '</span>' +
        '<span class="bt-pri ' + esc(t.priority || "") + '">' + esc(t.priority || "") + '</span>' +
      '</button>';
    }).join("");
  }).catch(function(){
    var box = $("brTaskList");
    if(box && brDrawerId === id) box.innerHTML = '<div class="tl-empty">关联工作项加载失败</div>';
  });
}
function populateBranchSelect(keep){
  var sel = $("iBranch");
  if(!sel) return;
  var cur = (keep === undefined ? sel.value : keep) || "";
  var html = '<option value="">不关联分支</option>';
  BRANCH_STATUS.forEach(function(s){
    var items = branchList.filter(function(b){ return b.status === s.id; });
    if(!items.length) return;
    html += '<optgroup label="' + esc(s.name) + '">';
    items.forEach(function(b){
      html += '<option value="' + esc(b.id) + '">' + esc(b.name) +
        (b.targetBranch ? " → " + esc(b.targetBranch) : "") + '</option>';
    });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
  var ok = false;
  for(var i = 0; i < branchList.length; i++) if(branchList[i].id === cur) ok = true;
  sel.value = ok ? cur : "";
  var hint = $("iBranchHint");
  if(hint){
    hint.textContent = branchList.length
      ? "分支在「分支」页里建，这里只负责挂上去"
      : "还没有分支 —— 先去「分支」页建一条，再回来挂";
  }
}
(function wireBranchView(){
  var box = $("branchGroups");
  if(box){
    box.addEventListener("click", function(e){
      var menu = e.target.closest("[data-br-status-menu]");
      if(menu){ e.stopPropagation(); openBranchStatusMenu(menu, menu.dataset.brStatusMenu); return; }
      var card = e.target.closest("[data-branch]");
      if(card) openBranchDrawer(card.dataset.branch);
    });
    box.addEventListener("keydown", function(e){
      if(e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest("[data-branch]");
      if(card){ e.preventDefault(); openBranchDrawer(card.dataset.branch); }
    });
  }
  if($("branchGroups")){
    $("branchGroups").addEventListener("click", function(e){
      var c = e.target.closest("[data-br-filter]");
      if(!c) return;
      branchFilter = (branchFilter === c.dataset.brFilter) ? "" : c.dataset.brFilter;
      renderBranches();
    });
  }
  if($("branchNew")) $("branchNew").addEventListener("click", function(){ openBranchDialog(null); });
  if($("branchSearch")) $("branchSearch").addEventListener("input", renderBranches);
  if($("dlgBranchCancel")) $("dlgBranchCancel").addEventListener("click", closeBranchDialog);
  if($("dlgBranchOk")) $("dlgBranchOk").addEventListener("click", submitBranchDialog);
  if($("brName")){
    $("brName").addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); submitBranchDialog(); }
    });
  }

  if($("branchDrawer")){
    /* 抽屉内的状态切换与任务跳转：动态内容，统一委托 */
    $("branchDrawer").addEventListener("click", function(e){
      var st = e.target.closest("[data-br-drawer-status]");
      if(st){
        var b = branchById(brDrawerId);
        if(b && branchStatusMeta(b.status).id !== st.dataset.brDrawerStatus){
          setBranchStatus(brDrawerId, st.dataset.brDrawerStatus);
        }
        return;
      }
      var task = e.target.closest("[data-br-task]");
      if(task){
        /* 任务抽屉是另一层浮层，先收起分支抽屉再打开，避免两层遮罩叠在一起 */
        var tid = task.dataset.brTask;
        closeBranchDrawer();
        openTaskById(tid);
      }
    });
    $("branchScrim").addEventListener("click", closeBranchDrawer);
  }
  if($("brDrawerClose")) $("brDrawerClose").addEventListener("click", closeBranchDrawer);
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    if($("dlgBranch") && $("dlgBranch").classList.contains("open")){ closeBranchDialog(); return; }
    if($("branchDrawer") && $("branchDrawer").classList.contains("on")){ closeBranchDrawer(); }
  });
})();

function ensureBranchOptions(keep){
  var run = function(){ populateBranchSelect(keep || ""); };
  if(branchesLoaded) run();
  else loadBranches().then(run).catch(function(){ /* 分支拉取失败时下拉保持空，不影响任务保存 */ });
}

export { branchNameById, branchesLoaded, ensureBranchOptions, enterBranchesView, loadBranches, populateBranchSelect, renderBranches };
