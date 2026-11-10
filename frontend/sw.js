/* 沙漏 Service Worker：API 永不缓存，静态资源网络优先 + 离线兜底
   离线策略 = 只读：壳与静态资源可离线打开，任何 /api/ 请求都不缓存、断网即失败（前端显示「离线（只读）」）。
   SHELL 用相对路径，资源挂在任意上下文路径下都能正常工作。 */
var CACHE_NAME = "hourglass-shell-v140";
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
  "css/gantt.css",
  "css/manager.css",
  "css/smart-table.css",
  "css/mobile.css",
  "css/share.css",
  "css/auth.css",
  "js/core/api.js",
  "js/core/activity-ui.js",
  "js/core/app.js",
  "js/core/att-preview.js",
  "js/core/dom.js",
  "js/core/filters-ui.js",
  "js/core/filters.js",
  "js/core/fullscreen.js",
  "js/core/icons.js",
  "js/core/layout.js",
  "js/core/list-preferences.js",
  "js/core/mobile-rules.js",
  "js/core/nav-telemetry.js",
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
  "js/lib/format.js",
  "js/lib/gantt-shared.js",
  "js/main.js",
  "js/share.js",
  "js/views/analysis.js",
  "js/views/board.js",
  "js/views/branches.js",
  "js/views/calendar.js",
  "js/views/demands.js",
  "js/views/gantt.js",
  "js/views/list.js",
  "js/views/manager-shared.js",
  "js/views/messages.js",
  "js/views/mine.js",
  "js/views/phase.js",
  "js/views/portfolio.js",
  "js/views/profile.js",
  "js/views/project.js",
  "js/views/projects.js",
  "js/views/report.js",
  "js/views/requirements.js",
  "js/views/review.js",
  "js/views/risks.js",
  "js/views/settings.js",
  "js/views/testcases.js",
  "js/views/workload.js",
  "manifest.webmanifest",
  "icons/favicon-32.png",
  "favicon.ico",
  "icons/icon-1024.png",
  "images/login-background.webp"
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

  /* 接口路径按当前作用域推导（/hourglass/ + api/），不写死部署前缀 */
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath + "api/") === 0) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (!url.search && response && response.status === 200 && response.type === "basic") {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy).catch(function () {});
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (hit) {
        if (hit) return hit;
        if (request.mode === "navigate") {
          return caches.match(new URL("index.html", self.registration.scope).href);
        }
        return new Response("", { status: 503, statusText: "offline" });
      });
    })
  );
});
