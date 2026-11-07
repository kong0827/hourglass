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

export { triggerDownload };
