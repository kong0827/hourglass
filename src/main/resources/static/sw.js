/* 沙漏 Service Worker：API 永不缓存，静态资源网络优先 + 离线兜底
   离线策略 = 只读：壳与静态资源可离线打开，任何 /api/ 请求都不缓存、断网即失败（前端显示「离线（只读）」） */
var CACHE_NAME = "hourglass-shell-v93";
var SHELL = [
  "/hourglass/",
  "/hourglass/index.html",
  "/hourglass/login.html",
  "/hourglass/join.html",
  "/hourglass/share.html",
  "/hourglass/css/tokens.css",
  "/hourglass/css/base.css",
  "/hourglass/css/layout.css",
  "/hourglass/css/components.css",
  "/hourglass/css/views.css",
  "/hourglass/css/gantt.css",
  "/hourglass/css/share.css",
  "/hourglass/css/auth.css",
  "/hourglass/js/core/api.js",
  "/hourglass/js/core/activity-ui.js",
  "/hourglass/js/core/app.js",
  "/hourglass/js/core/dom.js",
  "/hourglass/js/core/filters-ui.js",
  "/hourglass/js/core/filters.js",
  "/hourglass/js/core/icons.js",
  "/hourglass/js/core/notifications.js",
  "/hourglass/js/core/realtime.js",
  "/hourglass/js/core/router.js",
  "/hourglass/js/core/shell.js",
  "/hourglass/js/core/shortcuts.js",
  "/hourglass/js/core/state.js",
  "/hourglass/js/core/task-actions.js",
  "/hourglass/js/core/task-drawer.js",
  "/hourglass/js/core/theme.js",
  "/hourglass/js/core/ui.js",
  "/hourglass/js/core/utils.js",
  "/hourglass/js/core/view-loader.js",
  "/hourglass/js/lib/download.js",
  "/hourglass/js/lib/format.js",
  "/hourglass/js/lib/gantt-shared.js",
  "/hourglass/js/main.js",
  "/hourglass/js/share.js",
  "/hourglass/js/views/analysis.js",
  "/hourglass/js/views/board.js",
  "/hourglass/js/views/branches.js",
  "/hourglass/js/views/calendar.js",
  "/hourglass/js/views/gantt.js",
  "/hourglass/js/views/list.js",
  "/hourglass/js/views/mine.js",
  "/hourglass/js/views/profile.js",
  "/hourglass/js/views/projects.js",
  "/hourglass/js/views/requirements.js",
  "/hourglass/js/views/review.js",
  "/hourglass/js/views/settings.js",
  "/hourglass/manifest.webmanifest",
  "/hourglass/icons/favicon-32.png",
  "/hourglass/favicon.ico",
  "/hourglass/icons/icon-1024.png",
  "/hourglass/images/login-background.webp"
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
  if (url.pathname.indexOf("/hourglass/api/") === 0) return;

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
        if (request.mode === "navigate") return caches.match("/hourglass/index.html");
        return new Response("", { status: 503, statusText: "offline" });
      });
    })
  );
});