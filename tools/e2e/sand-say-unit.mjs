/* 沙漏说 · 模型单测（冻结本地时间，不依赖浏览器）
   用法：node tools/e2e/sand-say-unit.mjs
   覆盖：时段问候、下班倒计时、周末/调休/节前/节日、无数据年份回退、偏好读取。 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../frontend/js/core/", import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sandsay-unit-"));

let pass = 0;
const fails = [];
function ok(cond, msg){
  if(cond) pass++;
  else fails.push(msg);
}
function eq(actual, expected, msg){
  ok(actual === expected, msg + " → 期望 " + JSON.stringify(expected) + "，实际 " + JSON.stringify(actual));
}

/* localStorage 只在模块顶层 readPref 与偏好测试里用 */
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const holidaysSrc = fs.readFileSync(path.join(ROOT, "holidays.js"), "utf8");
const saySrc = fs.readFileSync(path.join(ROOT, "sand-say.js"), "utf8")
  .replace(/import \{\s*\$[^}]*\} from "\.\/dom\.js";/, "var $ = function(){ return null; };")
  /* 外观设置里的落点提示要读摆件开关；模型单测不加载 side-ornament，固定返回关闭 */
  .replace(/import \{\s*ornamentPrefOn\s*\} from "\.\/side-ornament\.js";/, "var ornamentPrefOn = function(){ return false; };")
  .replace(/from "\.\/holidays\.js"/, 'from "./holidays.mjs"');

fs.writeFileSync(path.join(TMP, "holidays.mjs"), holidaysSrc);
fs.writeFileSync(path.join(TMP, "sand-say.mjs"), saySrc);

const H = await import(pathToFileURL(path.join(TMP, "holidays.mjs")).href);
const S = await import(pathToFileURL(path.join(TMP, "sand-say.mjs")).href);

function dt(y, m, d, h, mi){ return new Date(y, m - 1, d, h, mi, 0, 0); }
function chipTexts(st){ return st.chips.map(c => c.text); }
function run(name, date, pref, checks){
  const st = S.computeSay(date, pref || {});
  checks(st, name);
}

/* ---------- 节假日表 ---------- */
eq(H.holidayOn("2026-01-01")?.name, "元旦", "2026 元旦当天命中");
eq(H.holidayOn("2026-02-23")?.name, "春节", "2026 春节最后一天命中");
eq(H.holidayOn("2026-02-24"), null, "2026 春节后一天不是假日");
eq(H.holidayOn("2027-06-09")?.name, "端午", "2027 端午当天命中");
eq(H.holidayOn("2028-01-01"), null, "2028 无数据时不猜");
ok(H.isMakeupWorkday("2026-01-04"), "2026-01-04 调休上班");
ok(H.isMakeupWorkday("2027-10-09"), "2027-10-09 调休上班");
ok(!H.isMakeupWorkday("2026-12-31"), "2026-12-31 不是调休日");
eq(H.nextHoliday("2026-10-07")?.name, "元旦", "国庆最后一天的下一站是元旦");
eq(H.nextHoliday("2027-10-08"), null, "2027 国庆之后没有数据");
eq(H.nextHoliday("2026-11-23")?.from, "2027-01-01", "11-23 的下一站是 2027 元旦");

/* ---------- 工作日时段 ---------- */
run("工作日早", dt(2026, 11, 23, 9, 12), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "early", n + " phase");
  eq(st.quote, "来得早，沙还没开始漏", n + " quote");
  eq(st.label, "09:12", n + " label");
  eq(st.mood, "flow", n + " mood");
  eq(chipTexts(st).join("|"), "距元旦 39 天", n + " chips");
});
run("上午", dt(2026, 11, 23, 10, 30), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "morning", n + " phase");
  eq(st.quote, "上午的沙，流得最快", n + " quote");
});
run("午休前", dt(2026, 11, 23, 11, 48), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "noon", n + " phase");
  eq(st.quote, "快到饭点了，先放下", n + " quote");
  eq(st.mood, "slow", n + " mood");
});
run("午休最后一分钟", dt(2026, 11, 23, 12, 59), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "noon", n + " phase");
});
run("一点整进下午", dt(2026, 11, 23, 13, 0), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "afternoon", n + " phase");
  eq(st.quote, "下午的沙，流得最慢", n + " quote");
});
run("下午", dt(2026, 11, 23, 15, 20), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "afternoon", n + " phase");
  eq(st.quote, "下午的沙，流得最慢", n + " quote");
  eq(st.mood, "slow", n + " mood");
  eq(st.chips[0].text, "距元旦 39 天", n + " 假日 chip");
  ok(st.chips[0].icon === true, n + " 假日 chip 带日历图标");
});

/* ---------- 下班窗口 ---------- */
run("下班前 18 分钟", dt(2026, 11, 23, 17, 42), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "beforeoff", n + " phase");
  eq(st.quote, "沙漏快漏完了", n + " quote");
  eq(st.chips[0].text, "距离下班 18 分钟", n + " 倒计时");
  eq(st.chips[0].tone, "hot", n + " 倒计时是强调色");
  ok(st.chips[0].icon !== true, n + " 倒计时不带日历图标");
});
run("刚下班", dt(2026, 11, 23, 18, 5), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "off", n + " phase");
  eq(st.quote, "到点了，沙漏翻转", n + " quote");
  eq(st.mood, "flip", n + " mood");
});
run("下班后半小时内仍算刚下班", dt(2026, 11, 23, 18, 29), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "off", n + " phase");
});
run("下班半小时后进入晚上", dt(2026, 11, 23, 18, 31), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "evening", n + " phase");
  eq(st.quote, "下班了，还在？", n + " quote");
  eq(st.mood, "dim", n + " mood");
});
run("留空下班时间不做倒计时", dt(2026, 11, 23, 17, 42), { offWork: "" }, (st, n) => {
  eq(st.phase, "afternoon", n + " phase");
  eq(chipTexts(st).join("|"), "距元旦 39 天", n + " 只剩假日 chip");
});

/* ---------- 深夜 ---------- */
run("晚上", dt(2026, 11, 23, 21, 36), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "late", n + " phase");
  eq(st.quote, "这么晚了，还在工作", n + " quote");
  eq(st.mood, "dim", n + " mood");
});
run("深夜", dt(2026, 11, 23, 23, 48), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "night", n + " phase");
  eq(st.quote, "夜里的沙漏转得慢，先睡吧", n + " quote");
  eq(st.mood, "sleep", n + " mood");
});

/* ---------- 周末 / 调休 ---------- */
run("周六", dt(2026, 11, 28, 10, 24), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "weekend", n + " phase");
  eq(st.quote, "周末也来了，辛苦了", n + " quote");
  eq(st.label, "周六 10:24", n + " label");
  eq(st.mood, "pause", n + " mood");
  eq(st.chips[0].text, "距元旦 34 天", n + " 假日 chip");
});
run("周日仍算周末", dt(2026, 11, 29, 9, 0), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "weekend", n + " phase");
  eq(st.label, "周日 09:00", n + " label");
});
run("周日调休上班", dt(2026, 1, 4, 10, 0), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "makeup", n + " phase");
  eq(st.quote, "今天调休上班，辛苦了", n + " quote");
  eq(st.label, "10:00", n + " label");
  eq(st.chips[0].text, "距春节 42 天", n + " 假日 chip");
});
run("周六调休上班", dt(2026, 5, 9, 11, 0), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "makeup", n + " phase");
  eq(st.chips[0].text, "距端午 41 天", n + " 假日 chip");
});

/* ---------- 节前 / 节日 ---------- */
run("节前最后一天", dt(2026, 12, 31, 17, 20), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "festeve", n + " phase");
  eq(st.quote, "再坚持一天，就是元旦", n + " quote");
  eq(st.label, "12-31 17:20", n + " label");
  eq(st.chips[0].text, "明天元旦", n + " chip");
  eq(st.chips[0].tone, "hot", n + " chip tone");
});
run("节日当天", dt(2027, 1, 1, 10, 5), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "holiday", n + " phase");
  eq(st.quote, "元旦快乐，沙漏也放假", n + " quote");
  eq(st.label, "01-01 10:05", n + " label");
  eq(st.chips[0].text, "今天元旦", n + " chip");
  eq(st.chips[0].tone, "fest", n + " chip tone");
});
run("单日假期（端午）", dt(2027, 6, 9, 9, 30), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "holiday", n + " phase");
  eq(st.quote, "端午快乐，沙漏也放假", n + " quote");
});

/* ---------- 无数据回退 ---------- */
run("无 holiday 数据的工作日", dt(2028, 6, 1, 15, 20), { offWork: "18:00" }, (st, n) => {
  eq(st.next, null, n + " next 为空");
  eq(st.phase, "afternoon", n + " phase");
  eq(st.chips[0].text, "距周末 2 天", n + " 回退到周末");
});
run("无数据的周一", dt(2027, 11, 1, 10, 0), { offWork: "18:00" }, (st, n) => {
  eq(st.chips[0].text, "距周末 5 天", n + " 回退到周末");
});
run("无数据的周末", dt(2028, 6, 3, 10, 0), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "weekend", n + " phase");
  eq(st.chips.length, 0, n + " 周末无 chip");
});
run("无数据的周日", dt(2028, 6, 4, 10, 0), { offWork: "18:00" }, (st, n) => {
  eq(st.phase, "weekend", n + " phase");
  eq(st.chips.length, 0, n + " 周日无 chip");
});

/* ---------- 偏好读取 ---------- */
store.clear();
let p = S.readPref();
eq(p.on, true, "默认开启");
eq(p.offWork, "18:00", "默认下班 18:00");
eq(p.mode, "always", "默认常驻显示");

store.set("ds.sandSay.v1", JSON.stringify({ on: false, offWork: "", mode: "hover" }));
p = S.readPref();
eq(p.on, false, "读取关闭开关");
eq(p.offWork, "", "读取留空下班时间");
eq(p.mode, "hover", "读取悬停模式");

store.set("ds.sandSay.v1", JSON.stringify({ offWork: "25:00", mode: "weird" }));
p = S.readPref();
eq(p.offWork, "18:00", "非法时间回落默认");
eq(p.mode, "always", "非法模式回落默认");

store.set("ds.sandSay.v1", "{bad json");
p = S.readPref();
eq(p.on, true, "坏数据回落默认");

/* ---------- ISO 日期 ---------- */
eq(S.isoDate(dt(2026, 1, 5, 0, 0)), "2026-01-05", "isoDate 补零");

fs.rmSync(TMP, { recursive: true, force: true });

console.log("sand-say-unit: " + pass + " 通过, " + fails.length + " 失败");
if(fails.length){
  for(const f of fails) console.log("  FAIL " + f);
  process.exit(1);
}
