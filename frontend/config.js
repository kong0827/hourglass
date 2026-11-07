/* 沙漏前端运行时配置（部署时可改，不需要重新构建）
   appBase   前端静态资源根路径；默认取本文件所在目录，可显式指定 "/hourglass" 或 ""
   apiBase   后端 API 根路径；默认与 appBase 相同。前后端不同源时可写完整 URL
             （跨域需要后端 CORS 与 Cookie SameSite 配合，默认部署不跨域）
   loginPath 登录页地址；默认 appBase + "/login.html" */
(function (w) {
  function stripSlash(v) {
    return String(v == null ? "" : v).replace(/\/+$/, "");
  }
  function detectBase() {
    try {
      if (document.currentScript && document.currentScript.src) {
        return new URL(".", document.currentScript.src).pathname;
      }
    } catch (e) { /* 老浏览器或不支持 URL 时走默认 */ }
    return "/hourglass";
  }

  var raw = w.__APP_CONFIG__ || {};
  var appBase = stripSlash(raw.appBase != null ? raw.appBase : detectBase());
  var apiBase = raw.apiBase != null ? stripSlash(raw.apiBase) : appBase;
  w.__APP_CONFIG__ = {
    appBase: appBase,
    apiBase: apiBase,
    loginPath: raw.loginPath || (appBase + "/login.html")
  };
})(window);
