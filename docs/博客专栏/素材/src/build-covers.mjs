import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const outCovers = path.join(here, '..', 'covers');
const outInfo = path.join(here, '..', 'infographics');
const tmp = path.join(here, '_html');
for (const d of [outCovers, outInfo, tmp]) fs.mkdirSync(d, { recursive: true });

const ACCENT = {
  s1: '#2F5D8A',
  s2: '#2F6B5E',
  s3: '#5B4B8A',
  s4: '#8C5A2B',
  s5: '#1F3A5F'
};

const covers = [
  ['01', 's1', '行业思考', '功能越多的项目管理工具，<br>为什么团队越用越累？', '功能扩展可能增加成本，值得结合场景核对', 0],
  ['02', 's1', '行业思考', '项目管理，是不是该做减法了？', '不是功能更少，而是主线更清楚', 0],
  ['03', 's2', '产品理念', '我们为什么选择做研发交付工作台', '面向小型项目制研发团队的自托管研发交付工作台', 1],
  ['04', 's2', '产品理念', '好的工具，应该让复杂的工作变简单', '简单不是少，是少重复、可校正', 1],
  ['05', 's2', '产品理念', '少一些功能，多一些值得信任的数字', '可信，比智能更重要', 1],
  ['06', 's3', '核心功能', '任务完成了，为什么还不算交付？', '计划、完成与人工确认的发布记录分开看', 1],
  ['07', 's3', '核心功能', '任务分配与跟踪，能不能少一点动作？', '让记录发生在动作里', 1],
  ['08', 's3', '核心功能', '少开一次会，靠的不是沟通技巧', '集中记录，减少重复问询；回顾仍需核对', 1],
  ['09', 's4', '场景应用', '一个20人项目团队的一周：投入和交付如何留下记录', '示例场景：记录投入、核对完成、确认发布', 1],
  ['10', 's4', '场景应用', '进度混乱、任务没人跟进，问题通常不在执行力', '信息断点是排查方向之一，不是通用根因', 1],
  ['11', 's4', '场景应用', '项目制团队怎样选择交付工具？', '按流程、证据与运维约束逐项验证', 1],
  ['12', 's5', '价值总结', '自托管不等于免维护：交付数据谁来守护', '时间、维护与记录责任，都需要有人承担', 1],
  ['13', 's5', '价值总结', '让投入可解释，让交付可追溯', '关联记录、明确边界，用真实项目验证', 1]
];

const coverCSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#F7F4EC}
body{font-family:"PingFang SC","Noto Sans SC","Source Han Sans SC",-apple-system,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
#root{width:1200px;height:630px;position:relative;overflow:hidden;background:#F7F4EC;color:#1F3A5F}
.grid{position:absolute;inset:0;background-image:linear-gradient(#E9E2D3 1px,transparent 1px),linear-gradient(90deg,#E9E2D3 1px,transparent 1px);background-size:60px 60px;opacity:.55}
.glow{position:absolute;width:760px;height:760px;border-radius:50%;right:-260px;top:-250px;background:radial-gradient(circle,rgba(201,162,39,.13),rgba(201,162,39,0) 62%)}
.frame{position:absolute;inset:28px;border:1px solid rgba(31,58,95,.18)}
.top{position:absolute;left:72px;top:62px;display:flex;align-items:center;gap:14px}
.mark{width:26px;height:34px;position:relative}
.mark i{position:absolute;left:0;right:0;height:3px;background:#1F3A5F;border-radius:2px}
.mark i:first-child{top:0}.mark i:last-child{bottom:0}
.mark b{position:absolute;left:5px;right:5px;top:6px;bottom:6px;border:2px solid #1F3A5F;border-radius:4px;transform:skewX(0)}
.mark b::after{content:"";position:absolute;left:2px;right:2px;top:50%;height:2px;background:#C9A227}
.brand{font-size:15px;letter-spacing:.16em;color:#1F3A5F;font-weight:600}
.brand span{display:block;font-size:10px;letter-spacing:.3em;color:#8A7A5C;font-weight:400;margin-top:4px}
.pill{position:absolute;left:72px;top:150px;display:inline-flex;align-items:center;gap:9px;font-size:14px;color:var(--accent);border:1px solid var(--accent);padding:7px 14px;border-radius:999px;letter-spacing:.08em}
.dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.num{position:absolute;right:78px;top:128px;font-size:150px;line-height:1;font-weight:700;color:transparent;-webkit-text-stroke:2px rgba(31,58,95,.22);letter-spacing:-.04em}
.title{position:absolute;left:72px;top:218px;width:790px;font-size:46px;line-height:1.28;font-weight:700;letter-spacing:.01em}
.title.long{font-size:40px;line-height:1.3}
.sub{position:absolute;left:76px;top:430px;width:720px;font-size:18px;line-height:1.6;color:#5F6B7A}
.rule{position:absolute;left:76px;top:492px;width:88px;height:3px;background:#C9A227}
.foot{position:absolute;left:72px;bottom:56px;display:flex;align-items:center;gap:16px;font-size:13px;color:#7C7466;letter-spacing:.06em}
.foot b{color:#1F3A5F;font-weight:600}
.art{position:absolute;right:60px;bottom:38px;width:300px;height:300px;opacity:.95}
.art .ring{fill:none;stroke:rgba(31,58,95,.16);stroke-width:1;stroke-dasharray:3 7}
.art .glass{fill:none;stroke:#1F3A5F;stroke-width:3.2}
.art .sand{fill:#C9A227}
.art .sand2{fill:#1F3A5F;opacity:.9}
.accentline{position:absolute;right:0;top:0;width:8px;height:630px;background:var(--accent);opacity:.85}
@media (max-width:760px){.title{font-size:32px}}
`;

function coverHTML([num, key, series, title, sub, brand]) {
  const accent = ACCENT[key];
  const titleClass = title.replace(/<br>/g, '').length > 20 ? 'title long' : 'title';
  const markText = brand ? '沙漏 · HOURGLASS' : '项目管理专栏';
  const markSub = brand ? 'PRODUCT NOTES' : 'PROJECT MANAGEMENT NOTES';
  const footBrand = brand ? '沙漏博客专栏' : '项目管理专栏';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${coverCSS}</style></head>
<body><div id="root" style="--accent:${accent}">
  <div class="grid"></div><div class="glow"></div><div class="frame"></div><div class="accentline"></div>
  <div class="top">${brand ? '<div class="mark"><i></i><b></b><i></i></div>' : '<svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true"><rect x="3" y="7" width="20" height="20" rx="3" fill="none" stroke="#1F3A5F" stroke-width="2"/><circle cx="13" cy="17" r="4" fill="#C9A227"/></svg>'}<div class="brand">${markText}<span>${markSub}</span></div></div>
  <div class="pill"><span class="dot"></span>${series}</div>
  <div class="num">${num}</div>
  <h1 class="${titleClass}">${title}</h1>
  <div class="sub">${sub}</div>
  <div class="rule"></div>
  <div class="foot"><b>${footBrand}</b><span>·</span><span>第 ${Number(num)} 篇 / 共 13 篇</span></div>
  <svg class="art" viewBox="0 0 300 300" aria-hidden="true">
    <circle class="ring" cx="150" cy="150" r="128"/>
    <circle class="ring" cx="150" cy="150" r="104"/>
    ${brand ? `<path class="glass" d="M68 42 H232 M68 258 H232"/>
    <path class="glass" d="M78 52 H222 L150 148 Z"/>
    <path class="glass" d="M78 248 H222 L150 152 Z"/>
    <path class="sand" d="M104 70 H196 L150 128 Z"/>
    <path class="sand" d="M112 232 H188 L150 186 Z"/>
    <path class="sand2" d="M146 142 h8 v24 h-8 z"/>` : `<rect class="glass" x="74" y="74" width="152" height="152" rx="16"/>
    <path class="glass" d="M74 150 H226 M150 74 V226"/>
    <circle class="sand" cx="112" cy="112" r="16"/>
    <circle class="sand2" cx="188" cy="188" r="16"/>`}
  </svg>
</div></body></html>`;
}

let count = 0;
for (const c of covers) {
  const htmlPath = path.join(tmp, `cover-${c[0]}.html`);
  fs.writeFileSync(htmlPath, coverHTML(c));
  const out = path.join(outCovers, `${c[0]}.png`);
  const r = spawnSync('node', [
    path.join(process.env.HOME, '.qoder/skills/diagram-craft/scripts/export-diagram.cjs'),
    htmlPath, out, '1200', '2', 'root'
  ], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) { console.error(`FAILED ${c[0]}`, r.stderr); process.exit(1); }
  count++;
}
console.log(`covers done: ${count}`);