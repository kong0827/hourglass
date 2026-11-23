/* core/holidays · 法定节假日与调休上班日（按年维护）
 *
 * 来源：国务院办公厅《关于2026年部分节假日安排的通知》（2025-11-04）、
 *       《关于2027年部分节假日安排的通知》（2026-11-05）。
 * 用法：每次发布前补下一年；没有数据的年份不猜，沙漏说自动回退到「距周末」。
 * 日期一律用本地日历日 "YYYY-MM-DD"，字符串可直接比较大小。
 */

export var HOLIDAYS = [
  /* 2026 */
  { name: "元旦", from: "2026-01-01", to: "2026-01-03" },
  { name: "春节", from: "2026-02-15", to: "2026-02-23" },
  { name: "清明", from: "2026-04-04", to: "2026-04-06" },
  { name: "劳动节", from: "2026-05-01", to: "2026-05-05" },
  { name: "端午", from: "2026-06-19", to: "2026-06-21" },
  { name: "中秋", from: "2026-09-25", to: "2026-09-27" },
  { name: "国庆", from: "2026-10-01", to: "2026-10-07" },
  /* 2027 */
  { name: "元旦", from: "2027-01-01", to: "2027-01-03" },
  { name: "春节", from: "2027-02-05", to: "2027-02-13" },
  { name: "清明", from: "2027-04-03", to: "2027-04-05" },
  { name: "劳动节", from: "2027-05-01", to: "2027-05-05" },
  { name: "端午", from: "2027-06-09", to: "2027-06-09" },
  { name: "中秋", from: "2027-09-15", to: "2027-09-15" },
  { name: "国庆", from: "2027-10-01", to: "2027-10-07" }
];

export var MAKEUP_WORKDAYS = [
  /* 2026 */
  "2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10",
  /* 2027 */
  "2027-01-31", "2027-02-14", "2027-05-08", "2027-09-26", "2027-10-09"
];

export var COVERED_YEARS = [2026, 2027];

export function holidayOn(dateStr){
  for(var i = 0; i < HOLIDAYS.length; i++){
    var h = HOLIDAYS[i];
    if(dateStr >= h.from && dateStr <= h.to) return h;
  }
  return null;
}

export function isMakeupWorkday(dateStr){
  return MAKEUP_WORKDAYS.indexOf(dateStr) >= 0;
}

/* 下一个尚未开始的假期；今年数据用完或没数据时返回 null */
export function nextHoliday(dateStr){
  for(var i = 0; i < HOLIDAYS.length; i++){
    if(HOLIDAYS[i].from > dateStr) return HOLIDAYS[i];
  }
  return null;
}
