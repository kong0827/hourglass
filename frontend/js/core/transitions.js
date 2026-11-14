/* core/transitions · 状态流转矩阵：规则缓存、移动前判定、原因弹窗 */

import { API } from "./api.js";
import { rt } from "./state.js";
import { UI, toast } from "./ui.js";

var cache = Object.create(null);
var loading = Object.create(null);

function wsIdOf(wsId) {
  return wsId || (rt.currentWs && rt.currentWs.id) || window.CURRENT_WORKSPACE || "";
}

function defaultRule(from, to) {
  return from === "done" && to !== "done" ? "reason" : "allow";
}

/** 读取并缓存当前空间的矩阵；失败时抛错，由调用方决定是否放行给后端兜底 */
export function loadRules(wsId, force) {
  var id = wsIdOf(wsId);
  if (!id) return Promise.resolve(null);
  if (!force && cache[id]) return Promise.resolve(cache[id]);
  if (!force && loading[id]) return loading[id];
  loading[id] = API.getWs(id, "/api/columns/transitions").then(function (data) {
    var map = Object.create(null);
    var byId = Object.create(null);
    ((data && data.columns) || []).forEach(function (c) { byId[c.id] = c; });
    ((data && data.rules) || []).forEach(function (r) {
      map[r.from + "|" + r.to] = r.rule;
    });
    cache[id] = { columns: (data && data.columns) || [], map: map, byId: byId };
    delete loading[id];
    return cache[id];
  }).catch(function (err) {
    delete loading[id];
    throw err;
  });
  return loading[id];
}

export function invalidateRules(wsId) {
  delete cache[wsIdOf(wsId)];
}

export function cachedRules(wsId) {
  return cache[wsIdOf(wsId)] || null;
}

export function ruleFor(wsId, from, to) {
  if (!from || !to || from === to) return "allow";
  var entry = cache[wsIdOf(wsId)];
  if (!entry) return defaultRule(from, to);
  return entry.map[from + "|" + to] || defaultRule(from, to);
}

export function columnName(wsId, id) {
  if (!id) return "目标列";
  var entry = cache[wsIdOf(wsId)];
  var col = entry && entry.byId[id];
  return col ? col.name : id;
}

export function canForce() {
  var role = rt.currentWs && rt.currentWs.myRole;
  return role === "owner" || role === "admin";
}

function denyText(wsId, from, to, title) {
  var text = "不能从「" + columnName(wsId, from) + "」直接到「" + columnName(wsId, to) + "」";
  return (title ? "「" + title + "」" : "") + text;
}

export function promptReason(sourceName, targetName, count, descOverride) {
  var desc = descOverride || (count && count > 1
    ? "所选 " + count + " 个工作项中，部分流转需要记录原因；保存后会写入活动记录。"
    : "从「" + sourceName + "」到「" + targetName + "」需要记录原因，保存后会写入活动记录。");
  return UI.showPrompt({
    title: "移到「" + targetName + "」需要填写原因",
    desc: desc,
    label: "原因",
    placeholder: "例如：验证不通过 / 需求调整",
    maxLength: 120,
    required: true,
    okText: "确认移动"
  });
}

/**
 * 移动前判定：items = [{from, title}]，target 为目标列。
 * opts.reason 表示调用方已收集过原因（如「退回」必填说明），不再二次弹窗。
 * 返回 {reason, force} 表示可以继续；返回 null 表示用户取消或被禁止。
 * 规则读取失败时不阻断，交给后端兜底（后端仍会校验）。
 */
export function guard(wsId, items, target, opts) {
  var presetReason = opts && opts.reason ? opts.reason : null;
  var list = (items || []).filter(function (it) { return it && it.from && it.from !== target; });
  if (!list.length) return Promise.resolve({ reason: null, force: false });
  return loadRules(wsId).then(function () {
    var denied = null;
    var needReason = null;
    for (var i = 0; i < list.length; i++) {
      var rule = ruleFor(wsId, list[i].from, target);
      if (rule === "deny") { denied = list[i]; break; }
      if (rule === "reason") needReason = list[i];
    }
    if (denied) {
      if (!canForce()) {
        toast(denyText(wsId, denied.from, target, denied.title), "bad");
        return null;
      }
      return UI.showConfirm({
        title: "强制移动",
        msg: denyText(wsId, denied.from, target, denied.title) + "。你是空间主/管理员，可以强制越过这条限制。",
        okText: "强制移动"
      }).then(function (ok) {
        return ok ? { reason: null, force: true } : null;
      });
    }
    if (needReason && !presetReason) {
      var sourceName = list.length > 1 ? "所选列" : columnName(wsId, needReason.from);
      return promptReason(sourceName, columnName(wsId, target), list.length).then(function (reason) {
        return reason ? { reason: reason, force: false } : null;
      });
    }
    return { reason: presetReason, force: false };
  }).catch(function () {
    return { reason: null, force: false };
  });
}

/**
 * 后端仍拒绝时的补救：412 缺原因 → 弹窗后重试；422 禁止 → 空间主/管理员确认强制后重试。
 * 其它错误返回 null，由调用方按普通错误提示。
 */
export function serverDecision(wsId, items, target, err) {
  if (!err) return Promise.resolve(null);
  if (err.code === 412) {
    var first = (items || [])[0];
    var sourceName = items && items.length > 1 ? "所选列" : columnName(wsId, first && first.from);
    var noTarget = !target;
    return promptReason(sourceName, columnName(wsId, target), items && items.length,
      noTarget ? err.message : null).then(function (reason) {
      return reason ? { reason: reason, force: false } : null;
    });
  }
  if (err.code === 422) {
    if (!canForce()) {
      toast(err.message || "该流转已被禁止", "bad");
      return Promise.resolve(null);
    }
    return UI.showConfirm({
      title: "强制移动",
      msg: (err.message || "该流转已被禁止") + "。你是空间主/管理员，可以强制越过这条限制。",
      okText: "强制移动"
    }).then(function (ok) {
      return ok ? { reason: null, force: true } : null;
    });
  }
  return Promise.resolve(null);
}
