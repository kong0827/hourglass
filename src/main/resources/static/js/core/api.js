/* 沙漏 · API 封装：统一处理返回结构、CSRF 头与登录态 */

  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  /* 后端根路径：与 application.yml 中的 server.servlet.context-path 保持一致 */
  var API_BASE = "/hourglass";

  function resolveRoot(url) {
    if (!url || url.indexOf("http") === 0) return url;
    if (url.indexOf("/") === 0 && url.indexOf(API_BASE) !== 0) return API_BASE + url;
    return url;
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

  /* 每个标签页一个客户端 ID：服务端把它带回 SSE 载荷，发起者据此忽略自己的回声 */
  var CLIENT_ID = (function () {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* 非安全上下文 */ }
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  })();
  window.DS_CLIENT_ID = CLIENT_ID;

  /* GET 的 ETag 缓存：304 时直接复用上次解析好的数据 */
  var etagCache = {};
  var etagOrder = [];
  var ETAG_MAX = 80;

  function request(method, url, body, isForm, skipWorkspace) {
    url = resolveRoot(url);
    if (!skipWorkspace) url = withWorkspace(url);
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (method === "GET" && etagCache[url]) {
      opts.headers["If-None-Match"] = etagCache[url].etag;
    }
    if (method !== "GET") {
      opts.headers["X-XSRF-TOKEN"] = readCookie("XSRF-TOKEN");
      opts.headers["X-Client-Id"] = CLIENT_ID;
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
    /* 默认 20s 超时；AI / 导入导出给 180s，避免慢模型或大备份被误杀 */
    var path = url.split("?")[0];
    var timeout = /\/api\/(ai|import|export)(\/|$)/.test(path) ? 180000 : 20000;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* noop */ } }, timeout);
    }
    return fetch(url, opts).catch(function (err) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (err && err.name === "AbortError") {
        var e = new Error("请求超时，请稍后重试");
        e.silent = true;
        throw e;
      }
      throw err;
    }).then(function (res) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (res.status === 401 && window.location.pathname.indexOf("login") === -1) {
        window.location.href = API_BASE + "/login.html";
        throw new Error("未登录或登录已过期");
      }
      if (res.status === 304 && etagCache[url]) {
        return etagCache[url].data;
      }
      var etag = res.headers.get("ETag");
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { /* 非 JSON */ }
        if (json === null) {
          throw new Error("请求失败（HTTP " + res.status + "）");
        }
        if (json.code === 0) {
          if (etag && method === "GET") {
            if (!etagCache[url]) etagOrder.push(url);
            etagCache[url] = { etag: etag, data: json.data };
            while (etagOrder.length > ETAG_MAX) {
              var old = etagOrder.shift();
              delete etagCache[old];
            }
          }
          return json.data;
        }
        var err = new Error(json.message || "请求失败");
        err.code = json.code;
        throw err;
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

  /* 显式指定空间：跨空间行内操作（我的任务）不能依赖当前空间 */
  function withWs(url, wsId) {
    if (!wsId) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "workspace=" + encodeURIComponent(wsId);
  }

  const API = {
    /** 应用根路径：所有直链、FormData、下载和 SW 注册必须走这里 */
    base: API_BASE,
    url: resolveRoot,
    get: function (path, params) {
      return request("GET", path + buildQuery(params));
    },
    getGlobal: function (path, params) {
      return withoutWorkspace(function () { return request("GET", path + buildQuery(params)); });
    },
    getWs: function (wsId, path, params) {
      return request("GET", withWs(path + buildQuery(params), wsId), null, false, true);
    },
    postGlobal: function (path, body) {
      return withoutWorkspace(function () { return request("POST", path, body); });
    },
    /* 这些方法接受空间 ID，用于「我的任务」等跨空间场景 */
    postWs: function (wsId, path, body) {
      return request("POST", withWs(path, wsId), body, false, true);
    },
    putWs: function (wsId, path, body) {
      return request("PUT", withWs(path, wsId), body, false, true);
    },
    delWs: function (wsId, path) {
      return request("DELETE", withWs(path, wsId), null, false, true);
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

export { API };
