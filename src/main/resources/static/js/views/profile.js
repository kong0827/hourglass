/* views/profile · 个人设置（账号、计时、AI） */

import { API } from "../core/api.js";
import { renderSideUser } from "../core/app.js";
import { $ } from "../core/dom.js";
import { showView } from "../core/router.js";
import { rt } from "../core/state.js";
import { loadRunningTimer } from "../core/task-actions.js";
import { refreshOwnerSelect } from "../core/task-drawer.js";
import { UI, esc, toast } from "../core/ui.js";
import { avatarColor, initial, pad2 } from "../lib/format.js";
import { loadBoard } from "./board.js";

var meReadyCbs = [];
function afterMeReady(fn){
  if(rt.currentUser){ fn(); return; }
  meReadyCbs.push(fn);
}
function flushMeReady(){
  var list = meReadyCbs;
  meReadyCbs = [];
  for(var i = 0; i < list.length; i++){
    try{ list[i](); }catch(e){ /* 单个视图初始化失败不该拖垮其它 */ }
  }
}
function enterProfileView(){
  if(!rt.currentUser){
    afterMeReady(enterProfileView);
    return;
  }
  var name = rt.currentUser.displayName || rt.currentUser.username || "?";
  if($("meAvatar")){
    $("meAvatar").textContent = initial(name);
    $("meAvatar").style.setProperty("--a", avatarColor(name));
  }
  if($("meName")) $("meName").textContent = name;
  if($("meUsername")) $("meUsername").textContent = "@" + (rt.currentUser.username || "");
  if($("meRoleHint")) $("meRoleHint").textContent = (rt.currentUser.role === "admin") ? "平台管理员" : "普通成员";
  if($("meNameInput")){
    $("meNameInput").value = rt.currentUser.displayName || "";
    $("fMeName").classList.remove("invalid");
  }
  fillMeSelects();
  ["meOldPwd","meNewPwd","meAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.value = ""; });
  ["fMeNewPwd","fMeAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.classList.remove("invalid"); });
  wireMeAnchor();
  updateMePreview();
  /* AI 配置每次进页面都重新拉：可能在别的设备上改过 */
  loadAiConfig();
}
function fillMeSelects(){
  var s = $("meStart"), e = $("meEnd"), m = $("meMax");
  if(!s || !e || !m) return;
  if(!s.options.length){
    var hs = "";
    for(var h = 0; h < 24; h++) hs += '<option value="' + h + '">' + pad2(h) + ':00</option>';
    s.innerHTML = hs;
    var es = "";
    for(var k = 1; k <= 24; k++) es += '<option value="' + k + '">' + (k === 24 ? "24:00" : pad2(k) + ":00") + '</option>';
    e.innerHTML = es;
    var ms = "";
    for(var x = 1; x <= 24; x++) ms += '<option value="' + x + '">' + x + ' 小时</option>';
    m.innerHTML = ms;
  }
  s.value = String(rt.currentUser.workStartHour == null ? 9 : rt.currentUser.workStartHour);
  e.value = String(rt.currentUser.workEndHour == null ? 18 : rt.currentUser.workEndHour);
  m.value = String(rt.currentUser.workMaxHours == null ? 8 : rt.currentUser.workMaxHours);
}
function updateMePreview(){
  var p = $("mePreview");
  if(!p || !$("meStart")) return;
  var sh = Number($("meStart").value), eh = Number($("meEnd").value), mh = Number($("meMax").value);
  var win = eh - sh;
  var text = "每天 " + pad2(sh) + ":00–" + pad2(eh) + ":00 之间才计入，最多 " + mh + " 小时；周末不计。";
  if(win < mh){
    text += "（这个时段只有 " + win + " 小时，实际最多记 " + win + " 小时）";
  }
  p.textContent = text;
}
function wireMeAnchor(){
  var nav = $("meAnchor");
  var view = $("view-profile");
  if(!nav || !view) return;
  if(!nav.__wired){
    nav.__wired = true;
    nav.querySelectorAll("a").forEach(function(a){
      a.addEventListener("click", function(e){
        e.preventDefault();
        var el = document.querySelector(a.getAttribute("href"));
        if(el) el.scrollIntoView({behavior:"smooth", block:"start"});
      });
    });
  }
  function spy(){
    var panels = view.querySelectorAll(".set-panels .panel[id]");
    var cur = panels.length ? panels[0].id : null;
    var best = -1e9;
    panels.forEach(function(p){
      var top = p.getBoundingClientRect().top;
      if(top - 140 <= 0 && top > best){ best = top; cur = p.id; }
    });
    nav.querySelectorAll("a").forEach(function(a){
      a.classList.toggle("on", a.getAttribute("href") === "#" + cur);
    });
  }
  if(!view.__spyWired){
    view.__spyWired = true;
    view.addEventListener("scroll", function(){
      if(view.__spyRaf) return;
      view.__spyRaf = requestAnimationFrame(function(){ view.__spyRaf = 0; spy(); });
    }, {passive:true});
  }
  spy();
}
$("sideUserBtn").addEventListener("click", function(){ showView("profile"); });
$("meNameSave") && $("meNameSave").addEventListener("click", function(){
  var name = $("meNameInput").value.trim();
  if(!name){ $("fMeName").classList.add("invalid"); toast("请填写显示名", "warn"); return; }
  if(rt.currentUser && name === rt.currentUser.displayName){ toast("显示名没有变化"); return; }
  var btn = $("meNameSave");
  btn.disabled = true;
  API.put("/api/auth/profile", { displayName: name }).then(function(res){
    btn.disabled = false;
    rt.currentUser.displayName = (res && res.displayName) || name;
    rt.OWNER_DEFAULT = rt.currentUser.displayName;
    renderSideUser(rt.currentUser);
    refreshOwnerSelect();
    enterProfileView();
    toast("显示名已更新为「" + rt.currentUser.displayName + "」", "fs");
    loadBoard({silent:true});
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});
["meStart","meEnd","meMax"].forEach(function(id){
  var el = $(id);
  if(el) el.addEventListener("change", updateMePreview);
});
$("meTimerSave") && $("meTimerSave").addEventListener("click", function(){
  if(!rt.currentUser) return;
  var sh = Number($("meStart").value), eh = Number($("meEnd").value), mh = Number($("meMax").value);
  if(eh <= sh){ toast("下班时间要晚于上班时间", "warn"); return; }
  var btn = $("meTimerSave");
  btn.disabled = true;
  API.put("/api/auth/work-hours", { startHour: sh, endHour: eh, maxHours: mh }).then(function(res){
    btn.disabled = false;
    rt.currentUser.workStartHour = res && res.workStartHour != null ? res.workStartHour : sh;
    rt.currentUser.workEndHour = res && res.workEndHour != null ? res.workEndHour : eh;
    rt.currentUser.workMaxHours = res && res.workMaxHours != null ? res.workMaxHours : mh;
    updateMePreview();
    toast("已保存：" + pad2(sh) + ":00–" + pad2(eh) + ":00，每天最多 " + mh + " 小时（只影响之后的计时）", "fs");
    /* 运行中的计时按新口径重算 */
    loadRunningTimer();
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "保存失败", "bad");
  });
});
var aiCfg = null;
function findAiPreset(id){
  var list = (aiCfg && aiCfg.presets) || [];
  for(var i = 0; i < list.length; i++){ if(list[i].id === id) return list[i]; }
  return null;
}
function loadAiConfig(){
  if(!$("meAiProvider")) return;
  API.get("/api/ai/config").then(function(d){
    aiCfg = d;
    renderAiConfig(d);
  }).catch(function(ex){
    if($("meAiResult")){
      $("meAiResult").hidden = false;
      $("meAiResult").textContent = "AI 配置加载失败：" + (ex.message || "未知错误");
    }
  });
}
function renderAiConfig(d){
  var sel = $("meAiProvider");
  if(!sel.options.length){
    sel.innerHTML = ((d.presets || []).map(function(p){
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    })).join("");
  }
  sel.value = d.provider || "deepseek";
  $("meAiModel").value = d.model || "";
  $("meAiBase").value = d.baseUrl || "";
  $("meAiEnabled").checked = !!d.enabled;
  $("meAiKey").value = "";
  $("meAiKey").placeholder = d.hasKey
    ? "已保存 " + (d.apiKeyMasked || "****") + "（留空表示不修改）"
    : "粘贴你的 API Key";
  if($("meAiKeyState")){
    $("meAiKeyState").textContent = d.keyBroken
      ? "已保存的 Key 无法解密（部署密钥变更过），请重新填一次"
      : (d.hasKey ? "已保存 " + (d.apiKeyMasked || "") + "，留空则保持不变" : "还没有配置 Key");
  }
  if($("meAiState")){
    $("meAiState").textContent = d.status || "";
    $("meAiState").className = "meta-right" + (d.enabled && d.hasKey ? "" : " muted");
  }
  var p = findAiPreset(sel.value);
  if(p && $("meAiKeyHint")) $("meAiKeyHint").textContent = p.keyHint || "";
}
function aiFormBody(clearKey){
  var key = $("meAiKey") ? $("meAiKey").value.trim() : "";
  return {
    provider: $("meAiProvider").value,
    baseUrl: $("meAiBase").value.trim(),
    model: $("meAiModel").value.trim(),
    apiKey: key,
    clearKey: !!clearKey,
    enabled: $("meAiEnabled").checked
  };
}
function saveAiConfig(clearKey){
  return API.put("/api/ai/config", aiFormBody(clearKey)).then(function(d){
    aiCfg = d;
    renderAiConfig(d);
    return d;
  });
}
if($("meAiProvider")){
  $("meAiProvider").addEventListener("change", function(){
    var p = findAiPreset(this.value);
    if(!p) return;
    /* 自定义厂商没有默认值，保留用户已经填的地址和模型 */
    if(this.value !== "custom"){
      if(p.baseUrl) $("meAiBase").value = p.baseUrl;
      if(p.model) $("meAiModel").value = p.model;
    }
    if($("meAiKeyHint")) $("meAiKeyHint").textContent = p.keyHint || "";
  });
}
if($("meAiSave")){
  $("meAiSave").addEventListener("click", function(){
    var btn = this;
    btn.disabled = true;
    saveAiConfig(false).then(function(d){
      btn.disabled = false;
      toast("AI 设置已保存", "fs");
      if($("meAiResult")){ $("meAiResult").hidden = false; $("meAiResult").textContent = d.status || ""; }
    }).catch(function(ex){
      btn.disabled = false;
      toast(ex.message || "保存失败", "bad");
    });
  });
}
if($("meAiTest")){
  /* 先存再测：测的一定是"表单里这个样子"，而不是上次存的旧配置 */
  $("meAiTest").addEventListener("click", function(){
    var btn = this;
    btn.disabled = true;
    var t0 = Date.now();
    if($("meAiResult")){ $("meAiResult").hidden = false; $("meAiResult").textContent = "正在保存并测试连接…"; }
    saveAiConfig(false).then(function(){
      return API.post("/api/ai/config/test", {});
    }).then(function(r){
      btn.disabled = false;
      var sec = ((Date.now() - t0) / 1000).toFixed(1);
      if($("meAiResult")){
        $("meAiResult").textContent = "连通正常：模型 " + (r.model || "—")
          + "，往返 " + sec + " 秒，返回「" + String(r.reply || "").slice(0, 20) + "」，本次 " + (r.tokens || 0) + " tokens";
      }
      toast("AI 连接正常", "fs");
    }).catch(function(ex){
      btn.disabled = false;
      if($("meAiResult")){
        $("meAiResult").textContent = "连接失败：" + (ex.message || "未知错误");
      }
      toast(ex.message || "连接失败", "bad");
    });
  });
}
if($("meAiClear")){
  $("meAiClear").addEventListener("click", function(){
    if(!window.confirm("清除已保存的 API Key？清除后 AI 功能不可用，直到重新填写。")) return;
    saveAiConfig(true).then(function(){
      toast("已清除 API Key", "fs");
      if($("meAiResult")){ $("meAiResult").hidden = false; $("meAiResult").textContent = "已清除，可以填入新的 Key"; }
    }).catch(function(ex){ toast(ex.message || "操作失败", "bad"); });
  });
}
$("mePwdSave") && $("mePwdSave").addEventListener("click", function(){
  var oldPwd = $("meOldPwd").value;
  var newPwd = $("meNewPwd").value;
  var again = $("meAgainPwd").value;
  var fNew = $("fMeNewPwd"), fAgain = $("fMeAgainPwd");
  var bad = false;
  if(!oldPwd){ toast("请填写当前密码", "warn"); return; }
  if(newPwd.length < 6){ fNew.classList.add("invalid"); bad = true; } else fNew.classList.remove("invalid");
  if(newPwd !== again){ fAgain.classList.add("invalid"); bad = true; } else fAgain.classList.remove("invalid");
  if(bad) return;
  var btn = $("mePwdSave");
  btn.disabled = true;
  API.post("/api/auth/password", { oldPassword: oldPwd, newPassword: newPwd }).then(function(){
    btn.disabled = false;
    ["meOldPwd","meNewPwd","meAgainPwd"].forEach(function(id){ var el = $(id); if(el) el.value = ""; });
    toast("密码已修改（已登录的设备保持有效，直到会话过期）", "fs");
  }).catch(function(ex){
    btn.disabled = false;
    toast(ex.message || "修改失败", "bad");
  });
});
$("btnLogout").addEventListener("click", function(){
  UI.showConfirm({ title:"退出登录", msg:"确定退出当前账号？", okText:"退出", danger:false }).then(function(ok){
    if(!ok) return;
    API.post("/api/auth/logout", {}).then(function(){
      window.location.href = "/login.html";
    }).catch(function(){ window.location.href = "/login.html"; });
  });
});

export { enterProfileView, flushMeReady };
