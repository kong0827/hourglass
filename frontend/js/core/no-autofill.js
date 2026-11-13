/* core/no-autofill · 统一关闭业务表单的浏览器/密码管理器自动填充。
   登录页不加载本模块；密码框保持原生行为，避免破坏保存密码与修改密码。 */

var SKIP_TYPES = {
  password: 1, hidden: 1, file: 1, checkbox: 1, radio: 1, range: 1, color: 1,
  date: 1, time: 1, "datetime-local": 1, month: 1, week: 1
};
var ATTRS = {
  /* new-password 比 off 更能让 Chrome/Edge 停止回填账号；同时给主流密码管理器留忽略标记 */
  autocomplete: "new-password",
  "data-lpignore": "true",
  "data-1p-ignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other"
};

var RO_ATTR = "data-ds-autofill-ro";
function releaseReadonly(el){
  if(el.getAttribute(RO_ATTR) !== "1") return;
  el.readOnly = false;
  el.removeAttribute(RO_ATTR);
}
function markInput(el){
  if(!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")) return;
  if(el.tagName === "INPUT" && SKIP_TYPES[String(el.type || "text").toLowerCase()]) return;
  for(var key in ATTRS){
    if(el.getAttribute(key) !== ATTRS[key]) el.setAttribute(key, ATTRS[key]);
  }
  /* Edge/Chrome 的密码管理器会无视 autocomplete，直接在加载后写入非只读输入框。
     初始只读可以挡住回填，用户首次点击/聚焦/按键时立即解除。
     已有 readonly 的字段（业务只读或其他守卫）不接管，避免把只读字段变成可编辑。 */
  if(el.disabled || el.hasAttribute("readonly") || el.getAttribute(RO_ATTR) === "1") return;
  if(document.activeElement === el) return;
  el.setAttribute(RO_ATTR, "1");
  el.readOnly = true;
  ["pointerdown", "touchstart", "focus", "keydown"].forEach(function(type){
    el.addEventListener(type, function(){ releaseReadonly(el); }, {passive: true});
  });
}

function scan(root){
  if(!root || (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11)) return;
  if(root.nodeType === 1) markInput(root);
  var list = root.querySelectorAll ? root.querySelectorAll("input, textarea") : [];
  for(var i = 0; i < list.length; i++) markInput(list[i]);
}

scan(document);
new MutationObserver(function(records){
  for(var i = 0; i < records.length; i++){
    var added = records[i].addedNodes;
    for(var j = 0; j < added.length; j++) scan(added[j]);
  }
}).observe(document.documentElement, {childList: true, subtree: true});

/* 搜索框里的关键词属于临时上下文：即使浏览器仍触发自动填充，也把后台回填的值清掉。
   只处理未聚焦的 type=search，避免打断用户正在输入或主动选择的联想项。 */
document.addEventListener("animationstart", function(e){
  var el = e.target;
  if(e.animationName !== "ds-autofill-start" || !el || el.tagName !== "INPUT") return;
  if(String(el.type || "").toLowerCase() !== "search" || el === document.activeElement) return;
  if(!el.value) return;
  el.value = "";
  el.dispatchEvent(new Event("input", {bubbles: true}));
}, true);
