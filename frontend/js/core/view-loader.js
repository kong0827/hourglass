/* core/view-loader · 低频视图按需加载（零构建：浏览器原生 dynamic import）
   首屏只同步加载看板 / 列表 / 日历 / 我的任务 / 抽屉等高频模块；
   甘特、项目、需求、周回顾、分析、设置、个人设置第一次进入时才拉取对应 chunk。
   同一模块只 import 一次（浏览器同样按 URL 去重），模块解析后再调用其入口函数。 */
import { UI } from "./ui.js";

const cache = Object.create(null);
const mods = Object.create(null);

/* 静态预览稿把全部模块拼进同一个 IIFE，没有可 import 的文件路径；
   由 tools/gen-preview.js 注入 window.__HG_MODULES__ 供这里同步取用。 */
function bundled(name) {
  return (typeof window !== "undefined" && window.__HG_MODULES__ && window.__HG_MODULES__[name]) || null;
}

export function loadView(name) {
  if (mods[name]) return Promise.resolve(mods[name]);
  if (!cache[name]) {
    var b = bundled(name);
    var p = b ? Promise.resolve(b) : import("../views/" + name + ".js");
    /* 拉取失败（网络抖动 / 发布换版）时清掉缓存，下一次进入还能重试；
       同时给一次可见反馈，避免点了菜单像"没反应" */
    cache[name] = p.then(function (m) {
      mods[name] = m;
      return m;
    }, function (err) {
      delete cache[name];
      UI.toast("页面模块加载失败，请重试", "bad");
      throw err;
    });
  }
  return cache[name];
}

/** 已加载时同步拿到模块（例如当前就在甘特图里，快捷键需要同步读 ganttState） */
export function viewModule(name) {
  return mods[name] || bundled(name) || null;
}

/** 包装成"加载后调用"的函数：withView("gantt", m => m.loadGantt()) */
export function withView(name, fn) {
  return function () {
    return loadView(name).then(function (m) { return fn(m); });
  };
}
