/* 工作台 Service Worker：API 永不缓存，静态资源网络优先 + 离线兜底
   离线策略 = 只读：壳与静态资源可离线打开，任何 /api/ 请求都不缓存、断网即失败（前端显示「离线（只读）」） */
var CACHE_NAME = "devstudio-shell-v34";
var SHELL = [
  "/",
  "/index.html",
  "/login.html",
  "/join.html",
  "/css/app.css",
  "/css/tokens.css",
  "/css/base.css",
  "/css/layout.css",
  "/css/components.css",
  "/css/views.css",
  "/css/gantt.css",
  "/css/auth.css",
  "/js/icons.js",
  "/js/api.js",
  "/js/ui.js",
  "/js/app.js",
  "/vendor/suneditor/suneditor.min.js",
  "/vendor/suneditor/suneditor.min.css",
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
