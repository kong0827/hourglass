/* 菜单配置一致性：侧栏结构（index.html）与移动端「更多视图」分组（router.js 的 NAV_GROUPS）必须同源，
 * 防止再出现「交付说明挂在规划下、组头洞察与入口洞察重名、手机菜单标签过期」这类漂移。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "frontend/index.html"), "utf8");
const router = fs.readFileSync(path.join(root, "frontend/js/core/router.js"), "utf8");

function stripSubBlocks(navHtml) {
  let out = navHtml;
  for (;;) {
    const start = out.indexOf('<div class="nav-sub">');
    if (start < 0) return out;
    const end = out.indexOf("</div>", start);
    assert.ok(end > start, "nav-sub 块未闭合");
    out = out.slice(0, start) + out.slice(end + "</div>".length);
  }
}

function navItemLabel(tag) {
  const m = /<span class="nl">([^<]+)<\/span>/.exec(tag);
  return m ? m[1].trim() : "";
}

/* 侧栏：按 nav-sec 切段，收集每段的一级 data-view 与标签（顺序即渲染顺序） */
const navStart = html.indexOf('<nav class="side-nav"');
const navEnd = html.indexOf("</nav>", navStart);
assert.ok(navStart >= 0 && navEnd > navStart, "侧栏 nav 区缺失");
const navHtml = html.slice(navStart, navEnd);
const topHtml = stripSubBlocks(navHtml);

const sections = [{ title: "", items: [] }];
const tagRe = /<button\b[^>]*>[\s\S]*?<\/button>|<span class="nav-sec">([^<]+)<\/span>/g;
let tag;
while ((tag = tagRe.exec(topHtml))) {
  const raw = tag[0];
  if (tag[1] !== undefined) { sections.push({ title: tag[1].trim(), items: [] }); continue; }
  if (/\bclass="[^"]*\bmob-more\b/.test(raw)) continue;
  const view = /data-view="([^"]+)"/.exec(raw);
  if (!view) continue;
  sections[sections.length - 1].items.push({ key: view[1], label: navItemLabel(raw) });
}
const sidebarTop = sections.filter(s => s.items.length);
assert.ok(sidebarTop.length === 4, `侧栏应有 4 个内容分组，实际 ${sidebarTop.length}`);

/* 子导航项：移动端会把只存在于二级导航的入口提到一级 */
const subItems = {};
const subRe = /<button class="nav-sub-item"[^>]*data-view="([^"]+)"[^>]*>([^<]+)<\/button>/g;
let sub;
while ((sub = subRe.exec(navHtml))) subItems[sub[1]] = sub[2].trim();

/* 移动端底栏已覆盖的一级入口 */
const TAB_COVERED = ["mine", "projects", "workitems"];
/* 移动端把二级入口提为一级，侧栏没有对应一级按钮 */
const FLATTENED = ["portfolio", "investment", "workload"];

/* 从 router.js 取 NAV_GROUPS */
const ngStart = router.indexOf("var NAV_GROUPS = [");
const ngEnd = router.indexOf("];", ngStart);
assert.ok(ngStart >= 0 && ngEnd > ngStart, "NAV_GROUPS 源码缺失");
const NAV_GROUPS = JSON.parse(JSON.stringify(
  vm.runInNewContext("(" + router.slice(ngStart + "var NAV_GROUPS = ".length, ngEnd + 1) + ")")
));

const sectionTitles = sidebarTop.map(s => s.title);
const groupTitles = NAV_GROUPS.map(g => g.title);
assert.deepEqual(groupTitles, sectionTitles.concat([""]),
  `「更多视图」分组名须与侧栏组头一致：实际 ${JSON.stringify(groupTitles)}`);

const sidebarKeys = sidebarTop.flatMap(s => s.items.map(i => i.key));
const groupKeys = NAV_GROUPS.flatMap(g => g.items.map(i => i[0]));

/* 1) 侧栏一级入口去掉手机底栏已覆盖项，必须与菜单分组完全对等 */
const missing = sidebarKeys.filter(k => TAB_COVERED.indexOf(k) < 0 && groupKeys.indexOf(k) < 0);
const extra = groupKeys.filter(k => sidebarKeys.indexOf(k) < 0);
assert.deepEqual(missing, [], "侧栏存在菜单未收录的一级入口：" + missing.join(","));
assert.deepEqual(extra.filter(k => FLATTENED.indexOf(k) < 0), [], "菜单存在侧栏没有的入口：" + extra.join(","));
assert.deepEqual(extra.slice().sort(), FLATTENED.slice().sort(), "手机提级入口清单变化，需同步本测试");

/* 2) 标签与侧栏一致（二级提级项比对子导航文案） */
NAV_GROUPS.forEach(g => g.items.forEach(([key, label]) => {
  const item = sidebarKeys.indexOf(key) >= 0
    ? sidebarTop.flatMap(s => s.items).find(i => i.key === key)
    : { label: subItems[key] };
  assert.ok(item && item.label, `菜单入口 ${key} 在侧栏找不到文案`);
  assert.equal(label, item.label, `菜单入口 ${key} 文案「${label}」与侧栏「${item.label}」不一致`);
}));

/* 3) 规划/交付/分析 的归属与顺序：交付说明必须首个落在「交付」组 */
const byTitle = {};
NAV_GROUPS.forEach(g => { byTitle[g.title] = g.items.map(i => i[0]); });
assert.deepEqual(byTitle["规划"], ["demands", "portfolio", "phase"], "规划组入口不符");
assert.deepEqual(byTitle["交付"], ["delivery", "requirements", "testcases"], "交付组入口不符（交付说明应为第一项）");
assert.deepEqual(byTitle["分析"], ["insight", "investment", "workload"], "分析组入口不符");

const deliveryIdx = topHtml.indexOf('data-view="delivery"');
const deliverySecIdx = topHtml.indexOf('<span class="nav-sec">交付</span>');
const workitemsIdx = topHtml.indexOf('data-nav-group="workitems"');
assert.ok(deliverySecIdx >= 0 && deliveryIdx > deliverySecIdx, "交付说明应位于「交付」组头之后");
assert.ok(workitemsIdx > deliveryIdx, "交付说明应排在「工作项」分组之前");

/* 4) 组头与入口不重名 */
assert.ok(groupTitles.indexOf("洞察") < 0, "组头不应再叫「洞察」，避免与入口「洞察」重复");

console.log("nav-config: 分组/入口/标签/归位/命名 5 项断言通过");
