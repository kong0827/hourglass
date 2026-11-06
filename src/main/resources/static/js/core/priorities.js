/* core/priorities · 当前空间与跨空间优先级显示配置同步 */

import { API } from "./api.js";
import { rt } from "./state.js";
import { syncPriorities } from "../lib/format.js";

var CACHE_MS = 30000;
var loadedAt = {};

function loadPriorities(workspaceId, force){
  var wsId = workspaceId || (rt.currentWs && rt.currentWs.id) || "";
  if(!force && Date.now() - (loadedAt[wsId] || 0) < CACHE_MS) return Promise.resolve();
  loadedAt[wsId] = Date.now();
  var req = wsId ? API.getWs(wsId, "/api/priorities") : API.get("/api/priorities");
  return req.then(function(defs){
    syncPriorities(defs, wsId);
    return defs;
  }).catch(function(){ return null; });
}

function loadPrioritySpaces(spaces){
  var seen = {}, jobs = [];
  (spaces || []).forEach(function(s){
    var id = typeof s === "string" ? s : (s && s.id);
    if(!id || seen[id]) return;
    seen[id] = true;
    jobs.push(loadPriorities(id));
  });
  return Promise.all(jobs);
}

export { loadPriorities, loadPrioritySpaces };
