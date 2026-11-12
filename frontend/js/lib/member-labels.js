/* 成员职能展示与缓存：角色不是授权依据。缓存隔离到空间/项目。 */
import { API } from "../core/api.js";
import { rt } from "../core/state.js";

export var DEFAULT_ROLE_TITLES = ["项目经理","项目负责人","产品负责人","产品经理","产品","后端开发","前端开发","全栈工程师","测试","测试负责人","技术负责人","视觉设计","交互设计","实施顾问","客户项目负责人","业务代表"];
var labelCache = Object.create(null), labelPending = Object.create(null);
var memberCache = Object.create(null), memberPending = Object.create(null);
var revisions = Object.create(null);
function revision(key){ return revisions[key] || 0; }
function invalidate(key, cache, pending){ revisions[key] = revision(key) + 1; delete cache[key]; delete pending[key]; }
function uniqueTitles(list){
  var seen = Object.create(null);
  return (Array.isArray(list) ? list : []).map(function(v){ return String(v || "").trim(); })
    .filter(function(v){ if(!v || seen[v]) return false; seen[v] = true; return true; });
}
/* 空值筛选哨兵与真实同名标签区分；只解码一层，保留原始文字。 */
export function labelFilterOption(value){ return value === "__unset__" || String(value).indexOf("__label__:") === 0 ? "__label__:" + value : value; }
export function labelFilterText(value){ return String(value || "").indexOf("__label__:") === 0 ? String(value).slice(10) : value; }
export function effectiveMemberRole(m){
  return String(m && (m.effectiveRoleTitle || m.roleTitle || m.jobTitle) || "").trim();
}
export function memberRoleTitles(m){
  return uniqueTitles([effectiveMemberRole(m)].concat(m && m.secondaryRoleTitles || []));
}
export function loadMemberLabelOptions(wsId, force){
  if(!wsId) return Promise.resolve({roleTitles:DEFAULT_ROLE_TITLES.slice(),companyNames:[]});
  var key = "labels:" + wsId;
  if(force) invalidate(key, labelCache, labelPending);
  if(labelCache[key]) return Promise.resolve(labelCache[key]);
  if(labelPending[key]) return labelPending[key];
  var rev = revision(key);
  var promise = API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/member-label-options").then(function(data){
    var result = {roleTitles:uniqueTitles(data && data.roleTitles),companyNames:uniqueTitles(data && data.companyNames)};
    if(revision(key) === rev) labelCache[key] = result;
    return result;
  });
  labelPending[key] = promise;
  return promise.then(function(data){ if(labelPending[key] === promise) delete labelPending[key]; return data; }, function(ex){ if(labelPending[key] === promise) delete labelPending[key]; throw ex; });
}
export function peekProjectMembers(wsId, projectId){ return memberCache["members:" + wsId + ":" + projectId] || null; }
export function loadProjectMembers(wsId, projectId, force){
  if(!wsId || !projectId) return Promise.resolve(null);
  var key = "members:" + wsId + ":" + projectId;
  if(force) invalidate(key, memberCache, memberPending);
  if(memberCache[key]) return Promise.resolve(memberCache[key]);
  if(memberPending[key]) return memberPending[key];
  var rev = revision(key);
  var promise = API.get("/api/workspaces/" + encodeURIComponent(wsId) + "/projects/" + encodeURIComponent(projectId) + "/members").then(function(data){
    if(revision(key) === rev) memberCache[key] = data;
    return data;
  });
  memberPending[key] = promise;
  return promise.then(function(data){ if(memberPending[key] === promise) delete memberPending[key]; return data; }, function(ex){ if(memberPending[key] === promise) delete memberPending[key]; throw ex; });
}
export function taskMemberLabel(task){
  if(!task || !rt.currentWs) return "";
  var wsId = rt.currentWs.id;
  var data = task.reqId ? peekProjectMembers(wsId, task.reqId) : null;
  var members = data && data.members || rt.wsMembersCache || [];
  var matches = members.filter(function(x){ return task.ownerUserId ? x.userId === task.ownerUserId : (x.displayName || x.username) === task.owner; });
  var m = matches.length === 1 ? matches[0] : null;
  if(!m) return "";
  return [m.companyName || "未标注公司", memberRoleTitles(m).join(" / ") || "未设角色"].join(" · ");
}
export function syncTaskMemberTooltips(root, tasks){
  if(!root || !rt.currentWs || rt.currentWs.type !== "shared") return Promise.resolve();
  var wsId = rt.currentWs.id, ids = Object.create(null), byId = Object.create(null);
  (tasks || []).forEach(function(t){ byId[t.id] = t; if(t.reqId) ids[t.reqId] = true; });
  function paint(){
    if(!rt.currentWs || rt.currentWs.id !== wsId) return;
    root.querySelectorAll("[data-member-task]").forEach(function(el){
      var task = byId[el.dataset.memberTask];
      if(!task) return;
      var detail = taskMemberLabel(task);
      el.title = "负责人：" + (task.owner || "未指派") + (detail ? " · " + detail : "");
    });
  }
  paint();
  return Promise.all(Object.keys(ids).map(function(pid){ return loadProjectMembers(wsId, pid).catch(function(){ return null; }); })).then(paint);
}
function invalidateWorkspace(wsId){
  invalidate("labels:" + wsId, labelCache, labelPending);
  Object.keys(memberCache).concat(Object.keys(memberPending)).forEach(function(key){
    if(key.indexOf("members:" + wsId + ":") === 0) invalidate(key, memberCache, memberPending);
  });
}
["ds:member-company-changed","ds:member-job-title-changed","ds:member-label-options-changed","ds:member-roster-changed"].forEach(function(name){
  window.addEventListener(name, function(e){ var wsId = e.detail && e.detail.workspaceId || rt.currentWs && rt.currentWs.id; if(wsId) invalidateWorkspace(wsId); });
});
window.addEventListener("ds:project-roles-changed", function(e){
  var detail = e.detail || {}, wsId = detail.workspaceId || rt.currentWs && rt.currentWs.id;
  if(wsId && detail.projectId) invalidate("members:" + wsId + ":" + detail.projectId, memberCache, memberPending);
});
