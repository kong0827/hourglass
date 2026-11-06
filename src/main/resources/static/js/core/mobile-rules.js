/* core/mobile-rules · 手机端角色默认落点与审批动作规则（唯一真源） */

/** 手机端放开的审批动作；任务验收在手机只读。 */
export var MOBILE_APPROVALS = {
  review: { view: true, approve: true, reject: true, confirmOnApprove: true },
  merge: { view: true, approve: true, reject: true, confirmOnApprove: false },
  accept: { view: true, approve: false, reject: false }
};

/** 默认：owner/admin → 团队；其余 → 我的 */
export function defaultMode(role){
  return (role === "owner" || role === "admin") ? "team" : "mine";
}

/** 只记当前空间；跨空间不串台。 */
export function currentMode(wsId, role){
  try{ return localStorage.getItem("ds.mode." + (wsId || "")) || defaultMode(role); }
  catch(e){ return defaultMode(role); }
}

export function saveMode(wsId, mode){
  try{ localStorage.setItem("ds.mode." + (wsId || ""), mode); }catch(e){ /* 受限环境忽略 */ }
}
