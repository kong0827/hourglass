/* lib/company · 公司展示标签：自由文本 + 确定性配色，不参与鉴权 */
import { esc } from "../core/ui.js";

var COMPANY_COLORS = ["#2563EB","#F79009","#7A5AF8","#12B76A","#E31B54","#0E9384","#DD2590","#98A2B3"];

export function companyColor(name){
  var h = 0, s = String(name || "");
  for(var i = 0; i < s.length; i++){ h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return COMPANY_COLORS[h % COMPANY_COLORS.length];
}

export function companyNameOf(member){
  var name = member && member.companyName;
  return name == null ? "" : String(name).trim();
}

/** 空值统一显示「未标注公司」，样式为虚线灰边，避免被误读为真实公司 */
export function companyChipHTML(name){
  var v = String(name == null ? "" : name).trim();
  if(!v) return '<span class="org-chip unassigned"><i></i>未标注公司</span>';
  return '<span class="org-chip" style="--oc:' + companyColor(v) + '"><i></i>' + esc(v) + '</span>';
}

/** 管理者可点击标注：保留 chip 外观，点击后打开输入框 */
export function companyEditChipHTML(name, userId){
  var v = String(name == null ? "" : name).trim();
  var cls = v ? "org-chip editable" : "org-chip editable unassigned";
  var color = v ? ' style="--oc:' + companyColor(v) + '"' : "";
  return '<button type="button" class="' + cls + '"' + color +
    ' data-member-company="' + esc(userId) + '" title="标注公司（仅展示，不改变权限）">' +
    '<i></i>' + esc(v || "标注公司") + '</button>';
}
