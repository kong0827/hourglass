/* 沙漏 Service Worker：API 永不缓存，静态资源缓存优先 + 后台更新，离线兜底
   离线策略 = 只读：壳与静态资源可离线打开，任何 /api/ 请求都不缓存、断网即失败（前端显示「离线（只读）」）。
   SHELL 用相对路径，资源挂在任意上下文路径下都能正常工作。
   静态资源走 stale-while-revalidate：命中缓存立即返回，同时后台回源更新；
   页面导航（index.html）仍网络优先，发布换版后第一次导航就能拿到新外壳。
   发布换版的三道防线（用户不需要清缓存）：
   1) 发布时 tools/stamp-sw.js 按 SHELL 内容哈希改写 CACHE_NAME，前端一改 sw.js 就变；
   2) 页面每次打开主动 registration.update()，不等浏览器最多约 24 小时的自动检查；
   3) 安装与后台回源一律 cache:"no-cache"，不吃 HTTP 缓存里的旧副本。 */
var CACHE_NAME = "hourglass-shell-v268";
var SHELL = [
  "./",
  "index.html",
  "login.html",
  "join.html",
  "share.html",
  "config.js",
  "css/tokens.css",
  "css/base.css",
  "css/layout.css",
  "css/components.css",
  "css/views.css",
  "css/workcolumn.css",
  "css/version.css",
  "css/gantt.css",
  "css/manager.css",
  "css/investment.css",
  "css/smart-table.css",
  "css/mobile.css",
  "css/assistant.css",
  "css/delivery.css",
  "css/share.css",
  "css/auth.css",
  "js/core/ai-progress.js",
  "js/core/api.js",
  "js/core/activity-ui.js",
  "js/core/app.js",
  "js/core/att-preview.js",
  "js/core/attach-kit.js",
  "js/core/assistant.js",
  "js/core/combo.js",
  "js/core/date-picker.js",
  "js/core/dom.js",
  "js/core/env-dict.js",
  "js/core/select-picker.js",
  "js/core/filters-ui.js",
  "js/core/filters.js",
  "js/core/fullscreen.js",
  "js/core/group-dims.js",
  "js/core/icons.js",
  "js/core/layout.js",
  "js/core/list-density.js",
  "js/core/list-preferences.js",
  "js/core/mention-picker.js",
  "js/core/mobile-rules.js",
  "js/core/nav-telemetry.js",
  "js/core/no-autofill.js",
  "js/core/gestures.js",
  "js/core/notifications.js",
  "js/core/priorities.js",
  "js/core/realtime.js",
  "js/core/router.js",
  "js/core/search-palette.js",
  "js/core/shell.js",
  "js/core/sheet-viewer.js",
  "js/core/shortcuts.js",
  "js/core/state.js",
  "js/core/task-actions.js",
  "js/core/task-drawer.js",
  "js/core/templates/index.js",
  "js/core/templates/overlays.js",
  "js/core/templates/task-drawer.js",
  "js/core/theme.js",
  "js/core/transitions.js",
  "js/core/ui.js",
  "js/core/utils.js",
  "js/core/view-loader.js",
  "js/core/view-params.js",
  "js/lib/download.js",
  "js/lib/delivery-doc.js",
  "js/lib/format.js",
  "js/lib/caliber-help.js",
  "js/lib/company.js",
  "js/lib/member-labels.js",
  "js/lib/people-picker.js",
  "js/lib/milestone-ui.js",
  "js/lib/gantt-shared.js",
  "js/lib/text-diff.js",
  "js/main.js",
  "js/share.js",
  "js/views/analysis.js",
  "js/views/board.js",
  "js/views/branches.js",
  "js/views/calendar.js",
  "js/views/chain.js",
  "js/views/demands.js",
  "js/views/delivery.js",
  "js/views/gantt.js",
  "js/views/list.js",
  "js/views/manager-shared.js",
  "js/views/messages.js",
  "js/views/mine.js",
  "js/views/phase.js",
  "js/views/release.js",
  "js/views/portfolio.js",
  "js/views/profile.js",
  "js/views/project.js",
  "js/views/projects.js",
  "js/views/report.js",
  "js/views/investment.js",
  "js/views/requirements.js",
  "js/views/review.js",
  "js/views/risks.js",
  "js/views/settings.js",
  "js/views/testcases.js",
  "js/views/tree.js",
  "js/views/version.js",
  "js/views/workload.js",
  "js/views/workcolumn.js",
  "manifest.webmanifest",
  "icons/favicon-32.png",
  "favicon.ico",
  "icons/icon-1024.png",
  "images/login-background.webp"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* 逐项写入，单个文件 404/超时不能让整次安装失败：addAll 一旦 reject，
         新 SW 永远装不上，用户会被钉在旧版本上直到下一次发布修好 */
      return Promise.all(SHELL.map(function (url) {
        return fetch(url, { cache: "no-cache", credentials: "same-origin" }).then(function (response) {
          if (!response || response.status !== 200 || response.type !== "basic") {
            throw new Error("unexpected response: " + url);
          }
          return cache.put(url, response);
        }).catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* 接口路径按当前作用域推导（/hourglass/ + api/），不写死部署前缀 */
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath + "api/") === 0) return;

  /* 带查询串的请求多半是导出/下载，不落缓存 */
  var cacheable = !url.search;

  /* 回源时绕开 HTTP 缓存里的旧副本。nginx 没配 Cache-Control 时浏览器会按
     Last-Modified 推算新鲜期直接返回旧文件，后台"更新"就会把旧字节写回 SW 缓存。
     导航请求（mode=navigate）不可用 Request 克隆，退回浏览器默认策略。 */
  function freshFetch(request) {
    try {
      return fetch(new Request(request, { cache: "no-cache" }));
    } catch (e) {
      return fetch(request);
    }
  }

  function putIfOk(response) {
    if (cacheable && response && response.status === 200 && response.type === "basic") {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(request, copy).catch(function () {});
      });
    }
    return response;
  }

  function offline(request) {
    return caches.match(request).then(function (hit) {
      if (hit) return hit;
      if (request.mode === "navigate") {
        return caches.match(new URL("index.html", self.registration.scope).href);
      }
      return new Response("", { status: 503, statusText: "offline" });
    });
  }

  /* 运行时配置部署后允许手改（不改构建）：走网络优先，避免被旧缓存钉住 */
  if (url.pathname === scopePath + "config.js") {
    event.respondWith(freshFetch(request).then(putIfOk).catch(function () { return offline(request); }));
    return;
  }

  /* 页面导航保持网络优先：部署新版本后不会一直用旧 index.html */
  if (request.mode === "navigate") {
    event.respondWith(freshFetch(request).then(putIfOk).catch(function () { return offline(request); }));
    return;
  }

  /* 其余静态资源：缓存优先立即返回，网络请求在后台更新缓存 */
  var network = freshFetch(request).then(putIfOk);
  event.respondWith(caches.match(request).then(function (hit) {
    return hit || network.catch(function () { return offline(request); });
  }));
  event.waitUntil(network.then(function () {}, function () {}));
});
