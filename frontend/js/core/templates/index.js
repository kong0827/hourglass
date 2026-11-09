/* core/templates · 把 index.html 中体积最大的静态结构拆成模块注入
   目的：index.html 只保留页面骨架，抽屉与弹窗层随核心模块一起加载。

   时序要求：core/dom.js 在顶层按 id 取元素，晚一步就会拿到 null。
   因此 main.js 的第一个 import 必须是本模块（ES Module 依赖按 import 顺序求值）。 */

import { TASK_DRAWER_HTML } from "./task-drawer.js";
import { OVERLAYS_HTML } from "./overlays.js";

function mount(id, html){
  var host = document.getElementById(id);
  if(!host) return;
  var tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  host.parentNode.replaceChild(tpl.content, host);
}

mount("taskDrawerMount", TASK_DRAWER_HTML);
mount("overlaysMount", OVERLAYS_HTML);
