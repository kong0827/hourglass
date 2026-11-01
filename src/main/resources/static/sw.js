/* 工作台 Service Worker：API 永不缓存，静态资源网络优先 + 离线兜底
   离线策略 = 只读：壳与静态资源可离线打开，任何 /api/ 请求都不缓存、断网即失败（前端显示「离线（只读）」） */
var CACHE_NAME = "devstudio-shell-v74";
var SHELL = [
  "/",
  "/index.html",
  "/login.html",
  "/join.html",
  "/share.html",
  "/css/tokens.css",
  "/css/base.css",
  "/css/layout.css",
  "/css/components.css",
  "/css/views.css",
  "/css/gantt.css",
  "/css/share.css",
  "/css/auth.css",
  "/js/core/api.js",
  "/js/core/app.js",
  "/js/core/dom.js",
  "/js/core/filters-ui.js",
  "/js/core/filters.js",
  "/js/core/icons.js",
  "/js/core/notifications.js",
  "/js/core/realtime.js",
  "/js/core/router.js",
  "/js/core/shell.js",
  "/js/core/shortcuts.js",
  "/js/core/state.js",
  "/js/core/task-actions.js",
  "/js/core/task-drawer.js",
  "/js/core/theme.js",
  "/js/core/ui.js",
  "/js/core/utils.js",
  "/js/core/view-loader.js",
  "/js/lib/download.js",
  "/js/lib/format.js",
  "/js/lib/gantt-shared.js",
  "/js/main.js",
  "/js/share.js",
  "/js/views/analysis.js",
  "/js/views/board.js",
  "/js/views/branches.js",
  "/js/views/calendar.js",
  "/js/views/gantt.js",
  "/js/views/list.js",
  "/js/views/mine.js",
  "/js/views/profile.js",
  "/js/views/projects.js",
  "/js/views/requirements.js",
  "/js/views/review.js",
  "/js/views/settings.js",
  "/manifest.webmanifest",
  "/icons/icon-1024.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL);
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
  // 接口与登录相关请求一律走网络，不做缓存
  if (url.pathname.indexOf("/api/") === 0) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (response && response.status === 200 && response.type === "basic") {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy).catch(function () {});
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        if (request.mode === "navigate") return caches.match("/index.html");
        return new Response("", { status: 503, statusText: "offline" });
      });
    })
  );
});
