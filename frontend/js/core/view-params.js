/* core/view-params · 保存视图时各视图附加的布局参数（筛选之外的部分） */

var providers = {};

function registerViewParams(view, provider){ providers[view] = provider; }
function viewParamProvider(view){ return providers[view] || null; }

export { registerViewParams, viewParamProvider };
