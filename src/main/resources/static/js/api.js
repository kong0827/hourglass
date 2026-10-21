/* 工作台 · API 封装：统一处理返回结构、CSRF 头与登录态 */
(function () {
  "use strict";

  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  /* 当前空间由 app.js 维护，所有请求自动携带 */
  function withWorkspace(url) {
    var ws = window.CURRENT_WORKSPACE;
    if (!ws) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "workspace=" + encodeURIComponent(ws);
  }

  function buildQuery(params) {
    if (!params) return "";
    var parts = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === null || v === undefined || v === "") continue;
      if (Object.prototype.toString.call(v) === "[object Array]") {
        if (!v.length) continue;
        v = v.join(",");
      }
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
    return parts.length ? ("?" + parts.join("&")) : "";
  }

  function request(method, url, body, isForm) {
    url = withWorkspace(url);
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (method !== "GET") {
      opts.headers["X-XSRF-TOKEN"] = readCookie("XSRF-TOKEN");
    }
    if (body !== undefined && body !== null) {
      if (isForm) {
        opts.headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
        opts.body = body;
      } else {
        opts.headers["Content-Type"] = "application/json;charset=UTF-8";
        opts.body = JSON.stringify(body);
      }
    }
    return fetch(url, opts).then(function (res) {
      if (res.status === 401 && window.location.pathname.indexOf("login") === -1) {
        window.location.href = "/login.html";
        throw new Error("未登录或登录已过期");
      }
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON */ }
        if (json === null) {
          throw new Error("请求失败（HTTP " + res.status + "）");
        }
        if (json.code === 0) {
          return json.data;
        }
        throw new Error(json.message || "请求失败");
      });
    });
  }

  /*
   * 跨空间接口（通知中心 / 我的任务）：显式跳过自动附加的 workspace 参数。
   * 这类接口的语义是"我的全部"，若被当前空间过滤，别的空间的未读就会永远看不到。
   * withWorkspace 在 request() 内是同步读取 CURRENT_WORKSPACE 的，
   * 因此这里同步置空、同步恢复是安全的。
   */
  function withoutWorkspace(fn) {
    var saved = window.CURRENT_WORKSPACE;
    window.CURRENT_WORKSPACE = null;
    try {
      return fn();
    } finally {
      window.CURRENT_WORKSPACE = saved;
    }
  }

  window.API = {
    get: function (path, params) {
      return request("GET", path + buildQuery(params));
    },
    getGlobal: function (path, params) {
      return withoutWorkspace(function () { return request("GET", path + buildQuery(params)); });
    },
    postGlobal: function (path, body) {
      return withoutWorkspace(function () { return request("POST", path, body); });
    },
    post: function (path, body) {
      return request("POST", path, body);
    },
    put: function (path, body) {
      return request("PUT", path, body);
    },
    del: function (path) {
      return request("DELETE", path);
    },
    postForm: function (path, urlencoded) {
      return request("POST", path, urlencoded, true);
    }
  };
})();
