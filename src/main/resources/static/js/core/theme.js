/* core/theme · 浅色 / 深色切换（首屏同步模块，避免等甘特图 chunk） */
var btnTheme = document.getElementById("btnTheme");

export function applyTheme(dark) {
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  try { localStorage.setItem("ds.theme", dark ? "dark" : "light"); } catch (e) { /* noop */ }
  if (btnTheme) {
    btnTheme.setAttribute("aria-pressed", dark ? "true" : "false");
    btnTheme.title = dark ? "切换到浅色模式" : "切换到深色模式";
  }
}

export function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem("ds.theme"); } catch (e) { saved = null; }
  applyTheme(saved === "dark");
}

if (btnTheme) {
  btnTheme.addEventListener("click", function () {
    applyTheme(document.documentElement.getAttribute("data-theme") !== "dark");
  });
}
