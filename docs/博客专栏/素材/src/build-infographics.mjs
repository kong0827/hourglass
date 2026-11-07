import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const out = path.join(here, '..', 'infographics');
const tmp = path.join(here, '_html');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(tmp, { recursive: true });

const NAVY = '#1F3A5F';
const GOLD = '#C9A227';
const INK = '#22303F';
const MUTED = '#6B7280';
const LINE = '#E4DCCB';
const BG = '#F7F4EC';
const ACCENT = {
  s1: '#2F5D8A', s2: '#2F6B5E', s3: '#5B4B8A', s4: '#8C5A2B', s5: '#1F3A5F'
};

const css = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${BG}}
body{font-family:"PingFang SC","Noto Sans SC","Source Han Sans SC",-apple-system,"Helvetica Neue",sans-serif;color:${INK};-webkit-font-smoothing:antialiased}
#root{width:1200px;padding:54px 64px 46px;background:
  linear-gradient(#EFE9DB 1px,transparent 1px),linear-gradient(90deg,#EFE9DB 1px,transparent 1px);
  background-size:60px 60px;background-color:${BG};position:relative}
.head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:26px}
.kicker{font-size:13px;letter-spacing:.14em;color:var(--accent);font-weight:600;display:flex;align-items:center;gap:10px}
.kicker .dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
h1{font-size:34px;line-height:1.35;margin:12px 0 8px;color:${NAVY};letter-spacing:.01em}
.sub{font-size:15px;color:${MUTED};line-height:1.7;margin:0}
.brand{font-size:11px;letter-spacing:.22em;color:#8A7A5C;text-align:right;line-height:1.9;white-space:nowrap}
.brand b{display:block;color:${NAVY};font-size:13px;letter-spacing:.12em}
.rule{width:64px;height:3px;background:${GOLD};margin:18px 0 26px}
.card{background:#fff;border:1px solid ${LINE};border-radius:14px;box-shadow:0 6px 18px rgba(31,58,95,.05)}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.pad{padding:24px 22px}
.num{width:30px;height:30px;border-radius:50%;background:rgba(31,58,95,.06);color:var(--accent);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.h{font-size:18px;font-weight:700;color:${NAVY};margin:0 0 10px;line-height:1.45}
.p{font-size:14px;line-height:1.8;color:${MUTED};margin:0}
.tag{display:inline-block;margin-top:14px;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid rgba(201,162,39,.55);color:#8A6D1F;background:rgba(201,162,39,.08)}
.bottom{margin-top:22px;border-left:3px solid ${GOLD};background:#FFFDF7;border:1px solid ${LINE};border-left-width:3px;border-radius:10px;padding:16px 20px;font-size:15px;color:${NAVY};line-height:1.75}
.bottom b{color:${NAVY}}
.row{display:grid;grid-template-columns:56px 1.15fr 1fr 1fr;gap:18px;align-items:start;padding:20px 22px;border-bottom:1px solid #EFE9DB}
.row:last-child{border-bottom:none}
.rowhead{font-size:12px;letter-spacing:.08em;color:#8A7A5C;padding:0 22px 8px;display:grid;grid-template-columns:56px 1.15fr 1fr 1fr;gap:18px}
.row .idx{font-size:22px;font-weight:700;color:rgba(31,58,95,.28);line-height:1.2}
.row .t{font-size:16px;font-weight:700;color:${NAVY};line-height:1.6}
.row .c{font-size:13.5px;line-height:1.8;color:${MUTED}}
.row .c b{color:${NAVY};display:block;font-size:12px;letter-spacing:.08em;margin-bottom:4px}
.table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border-radius:14px;background:#fff;border:1px solid ${LINE}}
.table th{font-size:12px;letter-spacing:.08em;color:#8A7A5C;font-weight:600;text-align:left;padding:14px 20px;background:#FBF8F1;border-bottom:1px solid ${LINE}}
.table td{font-size:13.5px;line-height:1.65;padding:13px 20px;border-bottom:1px solid #F1EBDE;color:${MUTED};vertical-align:top}
.table tr:last-child td{border-bottom:none}
.table td:first-child{color:${NAVY};font-weight:600;width:18%}
.table td:nth-child(2){width:44%}
.table td:nth-child(3){width:38%}
.path{display:grid;grid-template-columns:repeat(5,1fr);gap:0;align-items:stretch}
.step{position:relative;padding:22px 18px;background:#fff;border:1px solid ${LINE}}
.step:first-child{border-radius:14px 0 0 14px}
.step:last-child{border-radius:0 14px 14px 0}
.step+.step{border-left:none}
.step .n{font-size:12px;letter-spacing:.14em;color:${GOLD};font-weight:700}
.step .h{font-size:17px;margin:10px 0 8px}
.step .p{font-size:12.5px;line-height:1.7}
.step .r{font-size:11px;color:#8A7A5C;margin-top:12px;letter-spacing:.04em}
.arrowline{height:2px;background:linear-gradient(90deg,${GOLD},rgba(201,162,39,.15));margin:24px 0 0}
.split{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.mini{font-size:12px;letter-spacing:.08em;color:#8A7A5C;margin-bottom:6px}
.foot{margin-top:24px;font-size:11px;color:#9A8F7A;letter-spacing:.12em;display:flex;justify-content:space-between}
.matrix{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border-radius:14px;background:#fff;border:1px solid ${LINE}}
.matrix th{font-size:12px;letter-spacing:.04em;color:#8A7A5C;font-weight:600;text-align:center;padding:13px 8px;background:#FBF8F1;border-bottom:1px solid ${LINE}}
.matrix th:first-child{text-align:left;padding-left:20px;width:16%}
.matrix td{font-size:14px;padding:14px 8px;text-align:center;border-top:1px solid #F1EBDE;color:${MUTED}}
.matrix td:first-child{text-align:left;padding-left:20px;color:${NAVY};font-weight:600}
.matrix .yes{color:#2F6B5E;font-weight:700;font-size:16px}
.matrix .no{color:#CFC5B2}
.matrix tr.hot td{background:#FFFDF7}
.matrix .badge{display:inline-block;margin-left:8px;font-size:11px;font-weight:600;color:#8A6D1F;background:rgba(201,162,39,.14);border:1px solid rgba(201,162,39,.45);border-radius:999px;padding:2px 8px;vertical-align:2px}
.warn{border-color:rgba(201,162,39,.65)!important;background:#FFFDF7!important}
.warn .num{background:rgba(201,162,39,.18);color:#8A6D1F}
.list{margin:0;padding:0;list-style:none}
.list li{font-size:14px;line-height:1.9;color:${MUTED};padding-left:18px;position:relative}
.list li::before{content:"";position:absolute;left:0;top:12px;width:6px;height:6px;border-radius:50%;background:${GOLD};opacity:.7}
@media (max-width:760px){#root{width:760px}.grid3,.grid4{grid-template-columns:repeat(2,1fr)}}
`;

const pages = {};

function page({ id, accent, kicker, brand, title, sub, body, foot }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div id="root" style="--accent:${accent}">
  <div class="head"><div>
    <div class="kicker"><span class="dot"></span>${kicker}</div>
    <h1>${title}</h1>
    <p class="sub">${sub}</p>
  </div><div class="brand"><b>${brand}</b>${brand === '项目管理专栏' ? 'PROJECT NOTES' : 'HOURGLASS · NOTES'}</div></div>
  <div class="rule"></div>
  ${body}
  <div class="foot"><span>${foot}</span><span>${brand === '项目管理专栏' ? '项目管理专栏 · 配图' : '沙漏博客专栏 · 配图'}</span></div>
</div></body></html>`;
}

const card = (n, h, p, tag = '') => `<div class="card pad"><div class="num">${n}</div><div class="h">${h}</div><p class="p">${p}</p>${tag ? `<span class="tag">${tag}</span>` : ''}</div>`;

/* 01 · 选型对照表 */
pages['01-matrix'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 01', brand: '项目管理专栏',
  title: '选型会上的那张功能对照表', sub: '横轴是功能清单，纵轴是产品名——谁的勾多，谁就排在前面。',
  body: `<table class="matrix">
    <tr><th>产品</th><th>需求</th><th>审批</th><th>OKR</th><th>工时</th><th>文档</th><th>知识库</th><th>自动化</th><th>仪表盘</th><th>AI</th></tr>
    <tr class="hot"><td>产品 A<span class="badge">勾最多</span></td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
    <tr><td>产品 B</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="no">—</td></tr>
    <tr><td>产品 C</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td></tr>
    <tr><td>产品 D</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
  </table>
  <div class="bottom"><b>勾选数量，不等于使用效率。</b>半年后，日活最高的页面仍然是「我的任务」，其他模块加起来不如一个群。</div>`,
  foot: '项目管理专栏 · 第 1 篇'
});

/* 02 · 审批卡点 */
pages['02-approval'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 02', brand: '项目管理专栏',
  title: '一个两小时的改动，走了三个人', sub: '流程不是越完整越好，重量级要和团队规模匹配。',
  body: `<div class="grid4">
    <div class="card pad"><div class="num">01</div><div class="h">需求评审</div><p class="p">两小时能评审完，问题不大。</p><span class="tag">正常</span></div>
    <div class="card pad warn"><div class="num">02</div><div class="h">排期审批</div><p class="p">审批人出差，任务卡在这里三天。</p><span class="tag">卡点</span></div>
    <div class="card pad"><div class="num">03</div><div class="h">上线审批</div><p class="p">再等一天签字，才能发布。</p><span class="tag">等待</span></div>
    <div class="card pad"><div class="num">04</div><div class="h">上线</div><p class="p">两小时的改动，走了五天。</p><span class="tag">结果</span></div>
  </div>
  <div class="bottom"><b>八个人的团队，需要的是快速对齐，不是层层签字。</b>最后大家学会了「先干活，后补审批」，流程变成了形式。</div>`,
  foot: '项目管理专栏 · 第 2 篇'
});

/* 01 */
pages['01-complexity'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 02', brand: '项目管理专栏',
  title: '复杂的三个来源', sub: '产品不是不知道复杂，而是很难选择不复杂。',
  body: `<div class="grid3">
    ${card('01', '买的人，不是用的人', '决策者看「覆盖所有场景」，使用者只关心「今天怎么把活干完」。面向采购卖，最有效的语言是功能清单。')}
    ${card('02', '同质化竞争，靠加模块', '竞品有审批，你不能没有；竞品上了 AI，你也要有。加功能在对比表上是进步，减功能像退步。')}
    ${card('03', '组织复杂度被搬进工具', '现实里的流程已经绕了三道弯，做进系统就变成三层配置。工具没有简化流程，只是把复杂搬上了屏幕。')}
  </div>
  <div class="bottom"><b>结果：</b>功能清单是采购那一刻的胜利，复杂度却是团队此后每一天的成本。</div>`,
  foot: '项目管理专栏 · 第 1 篇'
});

/* 02 */
pages['02-tax'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 03', brand: '项目管理专栏',
  title: '一套工具的四种隐性成本', sub: '选型时只算「能带来什么」，很少算「会消耗什么」。',
  body: `<div class="grid2">
    ${card('01', '学习税', '新同事第一周，一半时间在学字段、状态、权限、报表入口。上手越难，团队越只会用最浅的功能。', '起步成本')}
    ${card('02', '配置税', '改工作流 → 报表口径变 → 历史数据对不上。团队里悄悄长出一个没有岗位名的「系统管理员」。', '维护成本')}
    ${card('03', '数据搬运税', '需求在文档、任务在看板、结论在群聊。一次录入、三处维护，每个人都在为同一份信息付三遍成本。', '重复成本')}
    ${card('04', '注意力税', '打开系统想看一眼进度，先被红点、审批和推荐卡片拦住。工具本该减少打断，却成了打断源。', '切换成本')}
  </div>
  <div class="bottom"><b>结论：</b>功能覆盖度衡量的是「买到了什么」，使用效率衡量的是「每天省下了什么」。</div>`,
  foot: '项目管理专栏 · 第 1 篇'
});

/* 03 */
pages['03-subtraction'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 01', brand: '项目管理专栏',
  title: '判断一个功能去留的三道问题', sub: '减法不是砍功能，是让主线浮出来。',
  body: `<div class="card">
    <div class="rowhead"><span></span><span>问题</span><span>判断</span><span>处理</span></div>
    <div class="row"><div class="idx">01</div><div class="t">它服务主线吗？</div><div class="c">主线是「从想法到交付」。与它无关、只是偶尔用一次的能力，不该占据主界面。</div><div class="c"><b>移出主路径</b>放到更合适的位置，而不是删掉。</div></div>
    <div class="row"><div class="idx">02</div><div class="t">它每天都用吗？</div><div class="c">每天用的功能值得做深、做顺；一个月用一次的，做对即可。</div><div class="c"><b>按频率分配重量</b>高频进主入口，低频收进二级。</div></div>
    <div class="row"><div class="idx">03</div><div class="t">它能被解释吗？</div><div class="c">数字怎么算、状态为什么变，使用者能不能自己看明白。</div><div class="c"><b>解释不清就不上</b>否则迟早变成争议来源。</div></div>
  </div>
  <div class="bottom"><b>减法之后留下的是链路，不是散装功能。</b>前提是产品清楚自己服务谁——没有边界的产品，减不掉任何东西。</div>`,
  foot: '项目管理专栏 · 第 2 篇'
});

/* 08 · 通知节奏 */
pages['08-notify'] = page({
  accent: ACCENT.s3, kicker: '系列三 · 核心功能 ｜ 配图 02', brand: '沙漏 · HOURGLASS',
  title: '消息该在什么时候出现', sub: '协作不是让消息更多，而是让消息在对的时候出现。',
  body: `<div class="grid2">
    <div class="card pad"><div class="mini">需要立刻知道的</div><div class="h">即时到达</div>
      <ul class="list"><li>被指派、被提及</li><li>逾期与今日到期</li><li>关键状态变更</li></ul>
      <span class="tag">站内角标 · 即时推送</span>
    </div>
    <div class="card pad"><div class="mini">只需要了解的</div><div class="h">汇总到达</div>
      <ul class="list"><li>每日进展摘要</li><li>每周回顾</li><li>按个人偏好投递的邮件</li><li>外部机器人同步</li></ul>
      <span class="tag">每日 · 每周 · 按需</span>
    </div>
  </div>
  <div class="bottom"><b>不是所有变化都值得打断一个人。</b>需要立刻知道的，即时到；只需要了解的，汇总到。</div>`,
  foot: '沙漏博客专栏 · 第 8 篇'
});

/* 05 */
pages['05-principles'] = page({
  accent: ACCENT.s2, kicker: '系列二 · 产品理念 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '让用户「不用想」的四条原则', sub: '简单不是功能少，而是动作和目标之间没有多余步骤。',
  body: `<div class="grid2">
    ${card('01', '一个动作，只做一件事', '拖进「进行中」，状态改变、计时开始；拖进「已完成」，停表并接上下一个任务。用户只做一个动作，后续由系统承担。')}
    ${card('02', '默认值应该真的能用', '新建空间，看板列、分类、角色都已配好。可以改，但不改也能开始工作——不能用就不该叫默认值。')}
    ${card('03', '同一个问题只有一个答案', '逾期、完成数、工时由一套规则计算，看板、日历、度量、报表共用。两个页面两个数字，团队就会怀疑所有数字。')}
    ${card('04', '每个数字都能点开', '看到「本周投入 42 小时」，可以点进任务、成员、日期和记录。看不到来源的汇总，只是无法验证的结论。')}
  </div>
  <div class="bottom"><b>复杂度应该留在系统里，简单留给使用者。</b>这不是少做，而是把难的部分前置消化。</div>`,
  foot: '沙漏博客专栏 · 第 4 篇'
});

/* 07 */
pages['07-four-questions'] = page({
  accent: ACCENT.s3, kicker: '系列三 · 核心功能 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '进度要回答的四个问题', sub: '一句「进度 60%」，回答不了任何一个。',
  body: `<div class="grid4">
    ${card('01', '承诺了什么？', '需求评审后拆成工作项，绑定影响版本；发布说明自动汇总。', '版本 · 发布说明')}
    ${card('02', '做到哪一步？', '看板列驱动状态，任务进度、阻塞与逾期在同一处可见。', '看板 · 列表')}
    ${card('03', '谁在做？', '跨项目查看成员在办工作项与投入工时，避免只看任务数量。', '成员负载')}
    ${card('04', '何时交付？', '依赖、里程碑、基线偏差、关键路径，在同一张甘特上。', '甘特图')}
  </div>
  <div class="bottom"><b>四个问题都能被回答，进度才不是一句百分比。</b>而且每个指标都能从项目下钻到具体任务。</div>`,
  foot: '沙漏博客专栏 · 第 6 篇'
});

/* 11 */
pages['11-disorders'] = page({
  accent: ACCENT.s4, kicker: '系列四 · 场景应用 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '三种失序，三种接法', sub: '多数「执行力问题」，本质是数据没有接上。',
  body: `<div class="card">
    <div class="rowhead"><span></span><span>症状</span><span>根因</span><span>机制</span></div>
    <div class="row"><div class="idx">01</div><div class="t">需求是断的</div><div class="c"><b>月底说不清承诺</b>评审在纪要、方案在文档、任务在看板、交付靠口头。</div><div class="c"><b>让需求成为起点</b>评审后拆工作项，绑定版本，发布说明自动汇总。</div></div>
    <div class="row"><div class="idx">02</div><div class="t">状态是假的</div><div class="c"><b>看板一片绿，实际卡了三天</b>更新状态是额外动作，忙起来第一个放弃。</div><div class="c"><b>把状态绑进动作</b>拖拽即改状态，自动计时，完成接力，未归档进「待确认」。</div></div>
    <div class="row"><div class="idx">03</div><div class="t">风险总是最后才知道</div><div class="c"><b>发版前一天才发现延期</b>信息分散，逾期口径各算各的，没人相信数字。</div><div class="c"><b>集中视图 + 统一口径</b>逾期、阻塞、停滞一处处理；负载同时看数量与工时。</div></div>
  </div>
  <div class="bottom"><b>早三天知道，和晚三天知道，是两个完全不同的项目。</b>工具提供骨架，运转仍然靠团队。</div>`,
  foot: '沙漏博客专栏 · 第 10 篇'
});

/* 12 */
pages['12-selection'] = page({
  accent: ACCENT.s4, kicker: '系列四 · 场景应用 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '选型不是选最强的，是选约束匹配的', sub: '功能对比表能筛掉明显不合适的，但筛不出「团队会不会用」。',
  body: `<table class="table">
    <tr><th>约束</th><th>更适合大型平台</th><th>更适合轻量自托管</th></tr>
    <tr><td>组织规模</td><td>数百人以上，多组织、多部门</td><td>10–50 人，一到两条产品线</td></tr>
    <tr><td>流程复杂度</td><td>审批链、角色矩阵需要大量自定义</td><td>流程相对稳定，不需要每天改工作流</td></tr>
    <tr><td>合规与审计</td><td>强合规，需要完整审计与导出</td><td>数据不出内网即可满足</td></tr>
    <tr><td>运维能力</td><td>有专职管理员或实施顾问</td><td>希望一个下午上线，无人专职维护</td></tr>
    <tr><td>核心痛点</td><td>流程不够灵活、需要生态集成</td><td>说不清全局、数字对不上</td></tr>
  </table>
  <div class="bottom"><b>验证方式：</b>拿一个真实项目试一周——新人能否自学上手、周会前十分钟能否说清风险、月末工时能否对上。</div>`,
  foot: '沙漏博客专栏 · 第 11 篇'
});

/* 12 · 轻量边界 */
pages['12-boundary'] = page({
  accent: ACCENT.s5, kicker: '系列五 · 价值总结 ｜ 配图 02', brand: '沙漏 · HOURGLASS',
  title: '轻量的四条边界', sub: '知道自己不适合谁，才谈得上适合谁。',
  body: `<div class="grid4">
    ${card('01', '单实例部署', '不追求横向扩展，容量跟随一台服务器。', '代价')}
    ${card('02', '不做插件市场', '边角需求不能靠第三方生态补齐。', '代价')}
    ${card('03', '不做复杂工作流', '流程特别复杂的团队会觉得不够用。', '代价')}
    ${card('04', '不提供一键迁移', '从其他平台迁过来，需要自己动手。', '代价')}
  </div>
  <div class="bottom"><b>几百人、多组织、强合规审计时，轻量会成为约束，而不是优势。</b>我们不认为「轻」是万能答案，它只是对某一类团队更合适的答案。</div>`,
  foot: '沙漏博客专栏 · 第 12 篇'
});

/* 13 */
pages['13-burden'] = page({
  accent: ACCENT.s5, kicker: '系列五 · 价值总结 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '项目管理工具的三重负担', sub: '只把界面做干净，解决不了负担问题。',
  body: `<div class="grid3">
    ${card('01', '时间负担', '学习、配置、补数据、维护字段。看得见，也最容易被低估。', '解法 · 默认可用')}
    ${card('02', '维护负担', '权限、流程、报表口径、升级都要有人管。这个人一走，系统开始半瘫痪。', '解法 · 可自持')}
    ${card('03', '心理负担', '大量「应该做但没做」的字段和模块，形成持续的欠账感。', '解法 · 可退出')}
  </div>
  <div class="bottom"><b>留住用户的应该是价值，不是迁移成本。</b>支持全量导出、回收站保留、一个 jar + 一个 MySQL，数据始终在自己手里。</div>`,
  foot: '沙漏博客专栏 · 第 13 篇'
});

/* 14 */
pages['14-path'] = page({
  accent: ACCENT.s5, kicker: '系列五 · 价值总结 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '从「发现问题」到「愿意尝试」', sub: '一个专栏的阅读路径，也是一次认知的递进。',
  body: `<div class="path">
    <div class="step"><div class="n">STEP 01</div><div class="h">发现问题</div><p class="p">工具复杂，团队越用越累</p><div class="r">第 1 篇</div></div>
    <div class="step"><div class="n">STEP 02</div><div class="h">产生共鸣</div><p class="p">该做减法了</p><div class="r">第 2 篇</div></div>
    <div class="step"><div class="n">STEP 03</div><div class="h">认同理念</div><p class="p">简单、专注、数字可信</p><div class="r">第 3–5 篇</div></div>
    <div class="step"><div class="n">STEP 04</div><div class="h">了解产品</div><p class="p">一条链路，动作即记录</p><div class="r">第 6–8 篇</div></div>
    <div class="step"><div class="n">STEP 05</div><div class="h">愿意尝试</div><p class="p">场景验证，边界清楚</p><div class="r">第 9–13 篇</div></div>
  </div>
  <div class="bottom"><b>不做大而全，只做真正有用的项目管理。</b>工具的目标不是被频繁打开，而是需要时都在，不需要时不打扰。</div>`,
  foot: '沙漏博客专栏 · 第 13 篇'
});

for (const [name, html] of Object.entries(pages)) {
  const htmlPath = path.join(tmp, `${name}.html`);
  fs.writeFileSync(htmlPath, html);
  const png = path.join(out, `${name}.png`);
  const r = spawnSync('node', [
    path.join(process.env.HOME, '.qoder/skills/diagram-craft/scripts/export-diagram.cjs'),
    htmlPath, png, '1200', '2', 'root'
  ], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) { console.error(`FAILED ${name}`, r.stderr); process.exit(1); }
}
console.log('infographics done:', Object.keys(pages).length);