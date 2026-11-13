/* 分组维度单一来源：值、文案与排列顺序在列表 / 工作页 / 甘特 / 看板之间保持一致 */

export var GROUP_DIMS = [
  ["none", "不分组"],
  ["owner", "负责人"],
  ["priority", "优先级"],
  ["project", "项目"],
  ["category", "模块"],
  ["status", "状态"],
  ["version", "版本"]
];

export var GROUP_IDS = GROUP_DIMS.map(function(d){ return d[0]; });

/* 某个页面支持哪些维度：传值数组，返回按统一顺序排好的子集 */
export function groupDimsFor(ids){
  return GROUP_DIMS.filter(function(d){ return ids.indexOf(d[0]) !== -1; });
}

export function groupDimName(id){
  for(var i = 0; i < GROUP_DIMS.length; i++) if(GROUP_DIMS[i][0] === id) return GROUP_DIMS[i][1];
  return id || "不分组";
}

export function groupDimByLabel(label){
  for(var i = 0; i < GROUP_DIMS.length; i++) if(GROUP_DIMS[i][1] === label) return GROUP_DIMS[i][0];
  return "";
}

export function groupOptionsHTML(ids, selected, blankLabel){
  var html = "";
  if(blankLabel != null){
    html += '<option value=""' + (!selected ? " selected" : "") + '>' + blankLabel + '</option>';
  }
  html += groupDimsFor(ids).map(function(d){
    return '<option value="' + d[0] + '"' + (d[0] === selected ? " selected" : "") + '>' + d[1] + '</option>';
  }).join("");
  return html;
}
