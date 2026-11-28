/* 企业微信：个人绑定、空间启用、平台企业登记（多企业：甲方与多家供应商） */
import { API } from "../core/api.js";
import { $ } from "../core/dom.js";
import { rt } from "../core/state.js";
import { esc, toast } from "../core/ui.js";

function target() {
  return "/#/profile";
}

function corpStatusText(status) {
  return status === "active" ? "启用" : "停用";
}

/* 企微应用主页 / 工作台菜单要填的完整入口：回调根地址 + /wecom/entry?c=短键 */
function entryUrl(corp) {
  return (corp.callbackBaseUrl || "") + "/wecom/entry?c=" + (corp.corpKey || "");
}

function copyEntry(url) {
  function fallback() {
    var ta = document.createElement("textarea");
    ta.value = url;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("入口链接已复制", "fs"); }
    catch (e) { toast("复制失败，请手动选中复制", "warn"); }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () { toast("入口链接已复制", "fs"); }, fallback);
  } else { fallback(); }
}

/* ---------------- 个人设置 ---------------- */
function renderProfile() {
  var box = $("meWeComBinds");
  var acts = $("meWeComActions");
  if (!box) return;
  box.innerHTML = '<p class="tiny">加载中…</p>';
  if (acts) acts.hidden = true;
  API.get("/api/wecom/me").then(function (data) {
    var binds = (data && data.bindings) || [];
    var available = (data && data.availableCorps) || [];
    if (!binds.length) {
      box.innerHTML = '<p class="set-hint" style="margin-top:0">还没有绑定任何企业微信。绑定后在企业微信工作台打开沙漏即可免密进入。</p>';
    } else {
      box.innerHTML = '<div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
        + "<th>企业</th><th>企微账号</th><th>状态</th><th>最近免登</th><th></th></tr></thead><tbody>"
        + binds.map(function (b) {
          return "<tr><td>" + esc(b.corpName || b.corpId) + "</td>"
            + "<td><code>" + esc(b.wecomUserid) + "</code></td>"
            + "<td>" + (b.status === "active" ? "已绑定" : "已停用") + "</td>"
            + "<td>" + (b.lastLoginAt ? esc(String(b.lastLoginAt).replace("T", " ").slice(0, 16)) : "—") + "</td>"
            + '<td class="row-actions"><button class="btn link" type="button" data-wecom-unbind="'
            + esc(b.corpId) + '">解绑</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    }
    var boundIds = {};
    binds.forEach(function (b) { boundIds[b.corpId] = true; });
    var options = available.filter(function (c) { return !boundIds[c.corpId]; });
    if (acts) {
      if (options.length) {
        acts.hidden = false;
        acts.innerHTML = options.map(function (c) {
          var href = API.appBase + c.entryPath + "&bind=1&target=" + encodeURIComponent(target());
          return '<a class="btn" href="' + esc(href) + '">绑定 ' + esc(c.corpName) + "</a>";
        }).join("");
      } else {
        acts.hidden = true;
        acts.innerHTML = "";
      }
    }
    if (!binds.length && !options.length) {
      box.innerHTML = '<p class="set-hint" style="margin-top:0">当前空间还没有启用企业微信企业。需要免登时，请空间管理员先在「设置 → 通知与集成 → 企业微信」里启用。</p>';
    }
    box.querySelectorAll("[data-wecom-unbind]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var corpId = btn.getAttribute("data-wecom-unbind");
        if (!window.confirm("解绑后，该企业微信将不能再免密进入沙漏；确认解绑？")) return;
        btn.disabled = true;
        API.del("/api/wecom/bind/" + encodeURIComponent(corpId)).then(function () {
          toast("已解绑", "fs");
          renderProfile();
        }).catch(function (ex) {
          btn.disabled = false;
          toast(ex.message || "解绑失败", "warn");
        });
      });
    });
  }).catch(function (ex) {
    box.innerHTML = '<p class="set-hint">' + esc(ex.message || "加载失败") + "</p>";
  });
}

/* ---------------- 空间设置：启用哪些企业 ---------------- */
function renderSpacePanel() {
  var box = $("setWeCom");
  if (!box) return;
  box.innerHTML = '<p class="tiny">加载中…</p>';
  API.get("/api/wecom/workspace").then(function (data) {
    var enabled = (data && data.enabledCorps) || [];
    var all = (data && data.allCorps) || [];
    var enabledIds = {};
    enabled.forEach(function (c) { enabledIds[c.id] = true; });
    var html = "";
    if (data && data.canManage) {
      if (!all.length) {
        html += '<p class="set-hint" style="margin-top:0">还没有登记任何企业。请平台管理员先在下方「企业登记（平台管理员）」里添加企业微信企业。</p>';
      } else {
        html += '<div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>启用</th><th>企业</th><th>CorpID</th><th>状态</th></tr></thead><tbody>'
          + all.map(function (c) {
            var disabled = c.status !== "active" ? " disabled" : "";
            return '<tr><td><input type="checkbox" data-wecom-corp="' + esc(c.id) + '"'
              + (enabledIds[c.id] ? " checked" : "") + disabled + " /></td>"
              + "<td>" + esc(c.corpName) + "</td><td><code>" + esc(c.corpId) + "</code></td>"
              + "<td>" + corpStatusText(c.status) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
          + '<div class="set-actions"><button class="btn primary" type="button" id="btnWeComSpaceSave">保存本空间启用</button>'
          + '<span class="foot-note">只影响本空间：未启用的企业不能登录本空间，也不接收本空间的消息。</span></div>';
      }
    } else {
      html += enabled.length
        ? '<p class="set-hint" style="margin-top:0">本空间已启用：' + enabled.map(function (c) { return esc(c.corpName); }).join("、") + "。</p>"
        : '<p class="set-hint" style="margin-top:0">本空间还没有启用企业微信企业。</p>';
    }
    var robots = (data && data.groupRobots) || [];
    if (data && data.canManage) {
      html += groupRobotSection(robots, enabled);
    } else if (robots.length) {
      html += '<p class="set-hint" style="margin-top:12px">本空间已配置 ' + robots.length + " 个企业微信群机器人。</p>";
    }
    var messages = (data && data.messages) || [];
    if (data && data.canManage) {
      html += '<div class="panel-head" style="margin-top:18px"><h3>最近发送</h3><span class="meta-right">按企业分别发送 · 失败可重发</span></div>';
      html += messages.length
        ? '<div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>时间</th><th>企业</th><th>标题</th><th>接收人</th><th>状态</th><th>次数</th><th></th></tr></thead><tbody>'
          + messages.map(function (m) {
            var tone = m.status === "success" ? "full" : (m.status === "partial" ? "today" : "over");
            var label = m.status === "success" ? "已送达" : (m.status === "partial" ? "部分失败" : (m.status === "failed" ? "失败" : "排队中"));
            return "<tr><td>" + esc(String(m.createdAt || "").replace("T", " ").slice(0, 16)) + "</td>"
              + "<td><code>" + esc(m.corpId) + "</code></td><td>" + esc(m.title || "—") + "</td>"
              + "<td><code>" + esc(m.touserText || "") + "</code></td>"
              + '<td><span class="meta ' + tone + '">' + esc(label) + "</span>"
              + (m.errmsg ? '<span class="tiny"> · ' + esc(m.errmsg) + "</span>" : "") + "</td>"
              + "<td>" + (m.attempts == null ? 0 : m.attempts) + "</td>"
              + '<td class="row-actions"><button class="btn link" type="button" data-wecom-retry="' + esc(m.id) + '">重发</button></td></tr>';
          }).join("") + "</tbody></table></div>"
        : '<p class="set-hint">还没有发送记录。绑定成员收到指派、测试计划指派或发布准备提醒后会出现在这里。</p>';
    }
    html += '<div id="wecomAdminBox"></div>';
    box.innerHTML = html;
    var save = $("btnWeComSpaceSave");
    if (save) {
      save.addEventListener("click", function () {
        var ids = [];
        box.querySelectorAll("[data-wecom-corp]").forEach(function (cb) {
          if (cb.checked) ids.push(cb.getAttribute("data-wecom-corp"));
        });
        save.disabled = true;
        API.put("/api/wecom/workspace/corps", { corpIds: ids }).then(function () {
          toast("已保存本空间启用的企业", "fs");
          renderSpacePanel();
        }).catch(function (ex) {
          save.disabled = false;
          toast(ex.message || "保存失败", "warn");
          renderSpacePanel();
        });
      });
    }
    box.querySelectorAll("[data-wecom-retry]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        API.post("/api/wecom/workspace/messages/" + encodeURIComponent(btn.getAttribute("data-wecom-retry")) + "/retry", {})
          .then(function () { toast("已重新排队", "fs"); renderSpacePanel(); })
          .catch(function (ex) { btn.disabled = false; toast(ex.message || "重发失败", "warn"); });
      });
    });
    wireGroupRobots(robots, enabled);
    renderAdminBox();
  }).catch(function (ex) {
    box.innerHTML = '<p class="set-hint">' + esc(ex.message || "加载失败") + "</p>";
  });
}

/* ---------------- 空间设置：按企业配置的群机器人 ---------------- */
var wgrEditingId = null;

function robotResultLabel(robot) {
  var label = "";
  if (!robot.lastResult) return "—";
  if (robot.lastResult === "success") label = "最近发送成功";
  else if (robot.lastResult.indexOf("failed:") === 0) label = "发送失败：" + robot.lastResult.slice(7);
  else label = robot.lastResult;
  return label.length > 100 ? label.slice(0, 100) + "…" : label;
}

function robotResultTone(robot) {
  if (!robot.lastResult) return "";
  if (robot.lastResult === "success") return "full";
  return robot.lastResult.indexOf("failed:") === 0 ? "over" : "today";
}

function groupRobotSection(robots, enabled) {
  var activeCorps = (enabled || []).filter(function (c) { return c.status === "active"; });
  var html = '<div class="panel-head" style="margin-top:18px"><h3>企业微信群机器人</h3>'
    + '<span class="meta-right">按企业 · 只发相关群</span></div>'
    + '<p class="set-hint">发布准备推送按收件人绑定的企业发送，甲方群不会收到供应商的信息。Webhook 只以密文保存，页面只显示掩码。</p>';
  if (!activeCorps.length) {
    return html + '<p class="set-hint">请先在上方启用至少一家企业，再配置群机器人。</p>';
  }
  html += robots.length
    ? '<div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>企业</th><th>群名称</th><th>Webhook</th><th>状态</th><th>最近结果</th><th></th></tr></thead><tbody>'
      + robots.map(function (r) {
        var tone = robotResultTone(r);
        var result = robotResultLabel(r);
        return "<tr><td>" + esc(r.corpName || r.corpId) + "</td><td>" + esc(r.name) + "</td>"
          + '<td><code style="word-break:break-all">' + esc(r.webhookMasked || "已配置") + "</code></td>"
          + "<td>" + (r.status === "active" ? "启用" : "停用") + "</td>"
          + "<td>" + (tone ? '<span class="meta ' + tone + '">' + esc(result) + "</span>" : esc(result))
          + (r.lastSentAt ? '<br><span class="tiny">' + esc(String(r.lastSentAt).replace("T", " ").slice(0, 16)) + "</span>" : "")
          + "</td>"
          + '<td class="row-actions">'
          + '<button class="btn link" type="button" data-wgr-test="' + esc(r.id) + '">测试</button>'
          + '<button class="btn link" type="button" data-wgr-edit="' + esc(r.id) + '">编辑</button>'
          + '<button class="btn link" type="button" data-wgr-status="' + esc(r.id) + '" data-wgr-next="' + (r.status === "active" ? "disabled" : "active") + '">' + (r.status === "active" ? "停用" : "启用") + "</button>"
          + '<button class="btn link danger" type="button" data-wgr-del="' + esc(r.id) + '">删除</button>'
          + "</td></tr>";
      }).join("") + "</tbody></table></div>"
    : '<p class="set-hint">本空间还没有配置群机器人。发布准备推送会退回到空间级群机器人（若已配置）。</p>';
  html += '<div class="set-frows" id="wecomRobotForm" style="margin-top:12px">'
    + '<div class="frow"><div class="lb">所属企业</div><div class="field"><select id="wgrCorp">'
    + activeCorps.map(function (c) {
      return '<option value="' + esc(c.corpId) + '">' + esc(c.corpName) + "</option>";
    }).join("") + "</select></div></div>"
    + '<div class="frow"><div class="lb">群名称</div><div class="field"><input id="wgrName" maxlength="64" autocomplete="off" placeholder="如：甲方发布群" /><span class="hint">同一企业下名称不能重复，便于区分多个群。</span></div></div>'
    + '<div class="frow"><div class="lb">Webhook</div><div class="field"><input id="wgrWebhook" maxlength="1024" autocomplete="off" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" /><span class="hint">在企业微信群 → 群机器人 → 添加得到；只接受官方域名与 send 路径。</span></div></div>'
    + "</div>"
    + '<div class="set-actions"><button class="btn primary" type="button" id="btnWeComRobotSave">新增群机器人</button>'
    + '<button class="btn" type="button" id="btnWeComRobotCancel" hidden>取消编辑</button>'
    + '<span class="foot-note" id="wecomRobotEditHint"></span></div>';
  return html;
}

function wireGroupRobots(robots, enabled) {
  var box = $("setWeCom");
  var activeCorps = (enabled || []).filter(function (c) { return c.status === "active"; });
  if (!box || !activeCorps.length) return;
  wgrEditingId = null;

  function resetRobotForm() {
    wgrEditingId = null;
    if ($("wgrName")) $("wgrName").value = "";
    if ($("wgrWebhook")) $("wgrWebhook").value = "";
    if ($("wgrCorp")) $("wgrCorp").selectedIndex = 0;
    if ($("btnWeComRobotSave")) $("btnWeComRobotSave").textContent = "新增群机器人";
    if ($("btnWeComRobotCancel")) $("btnWeComRobotCancel").hidden = true;
    if ($("wecomRobotEditHint")) $("wecomRobotEditHint").textContent = "";
  }

  box.querySelectorAll("[data-wgr-test]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.disabled = true;
      API.post("/api/wecom/workspace/group-robots/" + encodeURIComponent(btn.getAttribute("data-wgr-test")) + "/test", {})
        .then(function (d) {
          toast(d && d.sent ? "测试消息已发送" : ((d && d.message) || "发送失败"), d && d.sent ? "fs" : "warn");
          renderSpacePanel();
        })
        .catch(function (ex) { btn.disabled = false; toast(ex.message || "测试失败", "warn"); });
    });
  });
  box.querySelectorAll("[data-wgr-status]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = btn.getAttribute("data-wgr-next");
      btn.disabled = true;
      API.post("/api/wecom/workspace/group-robots/" + encodeURIComponent(btn.getAttribute("data-wgr-status")) + "/status", { status: next })
        .then(function () { toast(next === "active" ? "已启用" : "已停用", "fs"); renderSpacePanel(); })
        .catch(function (ex) { btn.disabled = false; toast(ex.message || "操作失败", "warn"); });
    });
  });
  box.querySelectorAll("[data-wgr-del]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!window.confirm("删除后发布准备不再发送到该群，不能恢复；确认删除？")) return;
      btn.disabled = true;
      API.del("/api/wecom/workspace/group-robots/" + encodeURIComponent(btn.getAttribute("data-wgr-del")))
        .then(function () { toast("已删除群机器人", "fs"); renderSpacePanel(); })
        .catch(function (ex) { btn.disabled = false; toast(ex.message || "删除失败", "warn"); });
    });
  });
  box.querySelectorAll("[data-wgr-edit]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-wgr-edit");
      var robot = null;
      for (var i = 0; i < robots.length; i++) if (robots[i].id === id) robot = robots[i];
      if (!robot) return;
      wgrEditingId = id;
      if ($("wgrCorp")) $("wgrCorp").value = robot.corpId;
      if ($("wgrName")) $("wgrName").value = robot.name || "";
      if ($("wgrWebhook")) $("wgrWebhook").value = "";
      if ($("btnWeComRobotSave")) $("btnWeComRobotSave").textContent = "保存修改";
      if ($("btnWeComRobotCancel")) $("btnWeComRobotCancel").hidden = false;
      if ($("wecomRobotEditHint")) $("wecomRobotEditHint").textContent = "编辑中：" + (robot.name || "");
      if ($("wecomRobotForm")) $("wecomRobotForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
  if ($("btnWeComRobotCancel")) {
    $("btnWeComRobotCancel").addEventListener("click", function () { resetRobotForm(); });
  }
  var save = $("btnWeComRobotSave");
  if (save) save.addEventListener("click", function () {
    var corpId = $("wgrCorp") ? $("wgrCorp").value : "";
    var name = $("wgrName") ? $("wgrName").value.trim() : "";
    var webhook = $("wgrWebhook") ? $("wgrWebhook").value.trim() : "";
    if (!corpId) { toast("请选择企业", "warn"); return; }
    if (!name) { toast("请填写群名称", "warn"); return; }
    if (!wgrEditingId && !webhook) { toast("请填写群机器人 Webhook", "warn"); return; }
    save.disabled = true;
    var body = { corpId: corpId, name: name, webhook: webhook };
    var req = wgrEditingId
      ? API.put("/api/wecom/workspace/group-robots/" + encodeURIComponent(wgrEditingId), body)
      : API.post("/api/wecom/workspace/group-robots", body);
    req.then(function () {
      toast(wgrEditingId ? "已保存群机器人" : "已新增群机器人，可点「测试」验证连通性", "fs");
      renderSpacePanel();
    }).catch(function (ex) {
      save.disabled = false;
      toast(ex.message || "保存失败", "warn");
    });
  });
}

/* ---------------- 平台管理员：企业登记（只在集成页、管理员可见） ---------------- */
var editingCorpId = null;
var adminCorps = [];
function renderAdminBox() {
  var box = $("wecomAdminBox");
  if (!box) return;
  var me = rt.currentUser || {};
  if (me.role !== "admin") { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="panel-head" style="margin-top:18px"><h3>企业登记（平台管理员）</h3>'
    + '<span class="meta-right">部署级 · 一个部署登记多家</span></div>'
    + '<p class="set-hint">每家企业的自建应用有自己的 CorpID、Secret 与可信域名。Secret 只以密文保存，页面上永不回显。</p>'
    + '<div id="wecomCorpTable"><p class="tiny">加载中…</p></div>'
    + '<div class="set-frows" id="wecomCorpForm" style="margin-top:14px">'
    + '<div class="frow"><div class="lb">CorpID</div><div class="field"><input id="wcCorpId" maxlength="64" autocomplete="off" placeholder="ww 开头的企业 ID" /></div></div>'
    + '<div class="frow"><div class="lb">企业名称</div><div class="field"><input id="wcCorpName" maxlength="64" autocomplete="off" /></div></div>'
    + '<div class="frow"><div class="lb">AgentId</div><div class="field"><input id="wcAgentId" maxlength="12" autocomplete="off" inputmode="numeric" /></div></div>'
    + '<div class="frow"><div class="lb">应用 Secret</div><div class="field"><input id="wcSecret" type="password" autocomplete="new-password" placeholder="修改时留空表示不改" /><span class="hint">密文保存；换 Deployment 的 AI_CRYPTO_KEY 后需重填。</span></div></div>'
    + '<div class="frow"><div class="lb">回调根地址</div><div class="field"><input id="wcCallback" maxlength="255" autocomplete="off" placeholder="https://pm.corp.com/hourglass" /><span class="hint">该企业可信域名下指向本部署的地址，不要带 /wecom/callback。</span></div></div>'
    + '<div class="frow"><div class="lb">备注</div><div class="field"><input id="wcRemark" maxlength="200" autocomplete="off" placeholder="如：甲方生产 / 供应商A测试" /></div></div>'
    + "</div>"
    + '<div class="set-actions"><button class="btn primary" type="button" id="btnWeComCorpSave">新增企业</button>'
    + '<button class="btn" type="button" id="btnWeComCorpCancel" hidden>取消编辑</button>'
    + '<span class="foot-note" id="wecomCorpEditHint"></span></div>';
  loadAdminCorps();
  $("btnWeComCorpSave").addEventListener("click", saveAdminCorp);
  $("btnWeComCorpCancel").addEventListener("click", function () { resetAdminForm(); });
}

function resetAdminForm() {
  editingCorpId = null;
  ["wcCorpId", "wcCorpName", "wcAgentId", "wcSecret", "wcCallback", "wcRemark"].forEach(function (id) {
    if ($(id)) $(id).value = "";
  });
  if ($("btnWeComCorpSave")) $("btnWeComCorpSave").textContent = "新增企业";
  if ($("btnWeComCorpCancel")) $("btnWeComCorpCancel").hidden = true;
  if ($("wecomCorpEditHint")) $("wecomCorpEditHint").textContent = "";
  if ($("wcCorpId")) $("wcCorpId").readOnly = false;
}

function loadAdminCorps() {
  var box = $("wecomCorpTable");
  if (!box) return;
  return API.get("/api/admin/wecom/corps").then(function (data) {
    adminCorps = (data && data.corps) || [];
    var corps = adminCorps;
    if (!corps.length) {
      box.innerHTML = '<p class="set-hint">还没有登记企业。填写下方表单新增一家。</p>';
      return;
    }
    box.innerHTML = '<div class="tbl-wrap"><table class="manager-tbl"><thead><tr>'
      + "<th>企业</th><th>CorpID</th><th>AgentId</th><th>回调地址</th><th>入口链接</th><th>成员数</th><th>状态</th><th></th></tr></thead><tbody>"
      + corps.map(function (c) {
        return "<tr><td>" + esc(c.corpName) + "</td><td><code>" + esc(c.corpId) + "</code></td>"
          + "<td>" + esc(c.agentId) + "</td>"
          + '<td><code style="word-break:break-all">' + esc(c.callbackUrl || c.callbackBaseUrl || "") + "</code></td>"
          + "<td><code>" + esc("/wecom/entry?c=" + (c.corpKey || "")) + "</code>"
          + '<br><button class="btn link" type="button" data-wc-copy="' + esc(entryUrl(c)) + '">复制入口</button></td>'
          + "<td>" + (c.bindCount == null ? 0 : c.bindCount) + "</td><td>" + corpStatusText(c.status) + "</td>"
          + '<td class="row-actions">'
          + '<button class="btn link" type="button" data-wc-edit="' + esc(c.id) + '">编辑</button>'
          + '<button class="btn link" type="button" data-wc-test="' + esc(c.id) + '">测试</button>'
          + '<button class="btn link" type="button" data-wc-key="' + esc(c.id) + '">重置入口</button>'
          + '<button class="btn link" type="button" data-wc-status="' + esc(c.id) + '" data-wc-next="' + (c.status === "active" ? "disabled" : "active") + '">' + (c.status === "active" ? "停用" : "启用") + "</button>"
          + '<button class="btn link" type="button" data-wc-members="' + esc(c.id) + '">成员</button>'
          + '<button class="btn link danger" type="button" data-wc-del="' + esc(c.id) + '">删除</button>'
          + "</td></tr>";
      }).join("") + "</tbody></table></div>" + '<div id="wecomBindPanel"></div>';
    box.querySelectorAll("[data-wc-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () { editAdminCorp(corps, btn.getAttribute("data-wc-edit")); });
    });
    box.querySelectorAll("[data-wc-status]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-wc-status");
        var next = btn.getAttribute("data-wc-next");
        btn.disabled = true;
        API.post("/api/admin/wecom/corps/" + encodeURIComponent(id) + "/status", { status: next })
          .then(function () { toast(next === "active" ? "已启用" : "已停用", "fs"); loadAdminCorps(); })
          .catch(function (ex) { btn.disabled = false; toast(ex.message || "操作失败", "warn"); });
      });
    });
    box.querySelectorAll("[data-wc-test]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        API.post("/api/admin/wecom/corps/" + encodeURIComponent(btn.getAttribute("data-wc-test")) + "/test", {})
          .then(function (d) {
            btn.disabled = false;
            toast("连接正常：" + (d.corpName || "") + " 已获取 access_token", "fs");
          })
          .catch(function (ex) { btn.disabled = false; toast(ex.message || "连接失败", "warn"); });
      });
    });
    box.querySelectorAll("[data-wc-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () { copyEntry(btn.getAttribute("data-wc-copy") || ""); });
    });
    box.querySelectorAll("[data-wc-key]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!window.confirm("重置后该企业的入口短链会失效，企微工作台里的旧链接需要换成新的；确认重置？")) return;
        btn.disabled = true;
        API.post("/api/admin/wecom/corps/" + encodeURIComponent(btn.getAttribute("data-wc-key")) + "/reset-key", {})
          .then(function (d) {
            toast("已重置入口短键，请用「入口链接」列的新地址更新企微应用", "fs");
            loadAdminCorps();
          })
          .catch(function (ex) { btn.disabled = false; toast(ex.message || "重置失败", "warn"); });
      });
    });
    box.querySelectorAll("[data-wc-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!window.confirm("删除后该企业在此部署的登记与各空间启用都会清除，不能恢复；已有成员绑定时请改用停用。确认删除？")) return;
        btn.disabled = true;
        API.del("/api/admin/wecom/corps/" + encodeURIComponent(btn.getAttribute("data-wc-del")))
          .then(function () { toast("已删除企业登记", "fs"); renderSpacePanel(); })
          .catch(function (ex) { btn.disabled = false; toast(ex.message || "删除失败", "warn"); });
      });
    });
    box.querySelectorAll("[data-wc-members]").forEach(function (btn) {
      btn.addEventListener("click", function () { openCorpMembers(btn.getAttribute("data-wc-members")); });
    });
  }).catch(function (ex) {
    box.innerHTML = '<p class="set-hint">' + esc(ex.message || "加载失败") + "</p>";
  });
}

/* 按企业查看 / 添加 / 解绑成员：每家企业各自维护对照，互不影响 */
function openCorpMembers(id) {
  var panel = $("wecomBindPanel");
  if (!panel) return;
  var corp = null;
  for (var i = 0; i < adminCorps.length; i++) if (adminCorps[i].id === id) corp = adminCorps[i];
  if (!corp) return;
  panel.innerHTML = '<p class="tiny">加载成员…</p>';
  Promise.all([
    API.get("/api/admin/wecom/corps/" + encodeURIComponent(id) + "/bindings"),
    API.getAllPages("/api/admin/users").catch(function () { return []; })
  ]).then(function (rs) {
    renderCorpMembers(corp, (rs[0] && rs[0].bindings) || [], rs[1] || []);
  }).catch(function (ex) {
    panel.innerHTML = '<p class="set-hint">' + esc(ex.message || "加载成员失败") + "</p>";
  });
}

function renderCorpMembers(corp, binds, users) {
  var panel = $("wecomBindPanel");
  if (!panel) return;
  var account = users.length
    ? '<select id="wcBindAccount">' + users.map(function (u) {
        return '<option value="' + esc(u.id) + '">' + esc((u.displayName || u.username) + " @" + u.username) + "</option>";
      }).join("") + "</select>"
    : '<input id="wcBindAccount" maxlength="32" autocomplete="off" placeholder="沙漏账号 ID" />';
  var rows = binds.map(function (b) {
    return "<tr><td>" + esc(b.displayName || b.username || b.userId)
      + (b.username ? '<br><span class="tiny">@' + esc(b.username) + "</span>" : "") + "</td>"
      + "<td><code>" + esc(b.wecomUserid) + "</code></td>"
      + "<td>" + (b.status === "active" ? "已绑定" : "已停用") + "</td>"
      + "<td>" + (b.lastLoginAt ? esc(String(b.lastLoginAt).replace("T", " ").slice(0, 16)) : "—") + "</td>"
      + '<td class="row-actions"><button class="btn link danger" type="button" data-wc-unbind="' + esc(b.id) + '">解绑</button></td></tr>';
  }).join("");
  panel.innerHTML = '<div class="panel-head" style="margin-top:18px"><h3>' + esc(corp.corpName) + ' · 成员</h3>'
    + '<span class="meta-right">按企业分别绑定</span></div>'
    + '<p class="set-hint">成员绑定到这家企业后，才会从这家企业的自建应用收到指派、测试计划指派与发布准备提醒；解绑只影响这家企业。</p>'
    + (binds.length
      ? '<div class="tbl-wrap"><table class="manager-tbl"><thead><tr><th>沙漏账号</th><th>企微 UserID</th><th>状态</th><th>最近免登</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>"
      : '<p class="set-hint">这家企业还没有绑定成员。</p>')
    + '<div class="set-frows" style="margin-top:12px">'
    + '<div class="frow"><div class="lb">沙漏账号</div><div class="field">' + account + "</div></div>"
    + '<div class="frow"><div class="lb">企微 UserID</div><div class="field"><input id="wcBindUserid" maxlength="64" autocomplete="off" placeholder="该企业通讯录里的成员 UserID" /><span class="hint">需先加入这家企业通讯录，并在应用可见范围内。</span></div></div>'
    + "</div>"
    + '<div class="set-actions"><button class="btn primary" type="button" id="btnWeComBindAdd">绑定成员</button>'
    + '<span class="foot-note">同一人可分别绑定多家企业；消息只发到成员对应的企业应用。</span></div>';
  panel.querySelectorAll("[data-wc-unbind]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!window.confirm("解绑后该成员不再从这家企业接收消息，也不能免密登录；确认解绑？")) return;
      btn.disabled = true;
      API.del("/api/admin/wecom/bindings/" + encodeURIComponent(btn.getAttribute("data-wc-unbind")))
        .then(function () { toast("已解绑", "fs"); refreshCorpMembers(corp.id); })
        .catch(function (ex) { btn.disabled = false; toast(ex.message || "解绑失败", "warn"); });
    });
  });
  var add = $("btnWeComBindAdd");
  if (add) add.addEventListener("click", function () {
    var accountEl = $("wcBindAccount"), useridEl = $("wcBindUserid");
    var userId = accountEl ? accountEl.value.trim() : "";
    var wecomUserid = useridEl ? useridEl.value.trim() : "";
    if (!userId) { toast("请选择沙漏账号", "warn"); return; }
    if (!wecomUserid) { toast("请填写企微 UserID", "warn"); return; }
    add.disabled = true;
    API.post("/api/admin/wecom/corps/" + encodeURIComponent(corp.id) + "/bindings",
      { userId: userId, wecomUserid: wecomUserid })
      .then(function () { toast("已绑定", "fs"); refreshCorpMembers(corp.id); })
      .catch(function (ex) { add.disabled = false; toast(ex.message || "绑定失败", "warn"); });
  });
}

function refreshCorpMembers(id) {
  var p = loadAdminCorps();
  if (p && p.then) p.then(function () { openCorpMembers(id); });
  else openCorpMembers(id);
}

function editAdminCorp(corps, id) {
  var corp = null;
  for (var i = 0; i < corps.length; i++) if (corps[i].id === id) corp = corps[i];
  if (!corp) return;
  editingCorpId = id;
  $("wcCorpId").value = corp.corpId || "";
  $("wcCorpId").readOnly = true;
  $("wcCorpName").value = corp.corpName || "";
  $("wcAgentId").value = corp.agentId || "";
  $("wcSecret").value = "";
  $("wcCallback").value = corp.callbackBaseUrl || "";
  $("wcRemark").value = corp.remark || "";
  $("btnWeComCorpSave").textContent = "保存修改";
  $("btnWeComCorpCancel").hidden = false;
  $("wecomCorpEditHint").textContent = "编辑中：" + (corp.corpName || corp.corpId);
  if ($("wecomCorpForm")) $("wecomCorpForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function saveAdminCorp() {
  var body = {
    corpId: $("wcCorpId").value.trim(),
    corpName: $("wcCorpName").value.trim(),
    agentId: $("wcAgentId").value.trim(),
    corpSecret: $("wcSecret").value.trim(),
    callbackBaseUrl: $("wcCallback").value.trim(),
    remark: $("wcRemark").value.trim()
  };
  if (!body.corpId || !body.corpName || !body.agentId || !body.callbackBaseUrl) {
    toast("请填写 CorpID、企业名称、AgentId 与回调根地址", "warn");
    return;
  }
  if (!editingCorpId && !body.corpSecret) {
    toast("新增企业需要填写应用 Secret", "warn");
    return;
  }
  var btn = $("btnWeComCorpSave");
  btn.disabled = true;
  var req = editingCorpId
    ? API.put("/api/admin/wecom/corps/" + encodeURIComponent(editingCorpId), body)
    : API.post("/api/admin/wecom/corps", body);
  req.then(function () {
    toast(editingCorpId ? "已保存" : "已新增企业，可在「入口链接」列复制应用入口", "fs");
    resetAdminForm();
    renderSpacePanel();
  }).catch(function (ex) {
    btn.disabled = false;
    toast(ex.message || "保存失败", "warn");
  });
}

export { renderProfile, renderSpacePanel };