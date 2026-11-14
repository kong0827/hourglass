/* lib/download · 浏览器下载小工具 */

function triggerDownload(filename, text, mime){
  var blob = new Blob([text], {type: mime || "application/json"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
}

export { triggerDownload, printDeliveryPaper, registerDeliveryPrintSource };

/* 交付说明「存为 PDF」：把纸张放进独立宿主，delivery.css 的 @media print 只显示它，
   应用外壳（侧栏、控制区、弹窗）不会混进 PDF。工作台与接收人页共用同一套打印口径。
   深色主题下临时切回浅色令牌，否则浅色纸面上会印出浅色文字。
   宿主与 html[data-dl-print] 标记只在打印期间存在：甘特的 A3 横向打印不受影响。 */
var printGen = 0;
var printSource = null;

/* 视图登记「当前该印哪份纸张」，直接 Ctrl+P 与点按钮走同一条路，产出同一份只读投影 */
function registerDeliveryPrintSource(fn){ printSource = fn; }

function mountPrintHost(sheetHTML){
  var host = document.getElementById("dlPrintHost");
  if(!host){
    host = document.createElement("div");
    host.id = "dlPrintHost";
    document.body.appendChild(host);
  }
  var gen = ++printGen;
  var root = document.documentElement;
  var theme = root.getAttribute("data-theme");
  host.innerHTML = sheetHTML;
  root.setAttribute("data-dl-print", "1");
  if(theme === "dark") root.removeAttribute("data-theme");
  function cleanup(){
    if(gen !== printGen) return;
    printGen++;
    window.removeEventListener("afterprint", cleanup);
    if(host.parentNode) host.parentNode.removeChild(host);
    root.removeAttribute("data-dl-print");
    if(theme === "dark") root.setAttribute("data-theme", "dark");
  }
  window.addEventListener("afterprint", cleanup);
  /* 部分浏览器不触发 afterprint：兜底还原，避免纸张留在 DOM 里影响后续打印 */
  setTimeout(cleanup, 60000);
  return cleanup;
}

function printDeliveryPaper(sheetHTML){
  mountPrintHost(sheetHTML);
  window.print();
}

window.addEventListener("beforeprint", function(){
  /* 点按钮时宿主已挂好；这里只兜住浏览器原生打印，且只在交付说明页生效 */
  if(document.getElementById("dlPrintHost") || !printSource) return;
  var html = printSource();
  if(html) mountPrintHost(html);
});
