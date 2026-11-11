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
  title: '选型会上的那张功能对照表', sub: '虚构功能表示例：产品 A–D 不对应真实产品，勾选也不是使用效果证据。',
  body: `<table class="matrix">
    <tr><th>产品</th><th>需求</th><th>审批</th><th>OKR</th><th>工时</th><th>文档</th><th>知识库</th><th>自动化</th><th>仪表盘</th><th>AI</th></tr>
    <tr class="hot"><td>产品 A<span class="badge">勾最多</span></td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
    <tr><td>产品 B</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="no">—</td></tr>
    <tr><td>产品 C</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td></tr>
    <tr><td>产品 D</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td><td class="no">—</td><td class="yes">✓</td><td class="yes">✓</td></tr>
  </table>
  <div class="bottom"><b>勾选数量，不等于使用效率。</b>主流工具已有同类能力；选型应核对实际流程、使用成本与证据边界，而不是假定某个功能空位被独占。</div>`,
  foot: '项目管理专栏 · 第 1 篇'
});

/* 02 · 审批卡点 */
pages['02-approval'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 02', brand: '项目管理专栏',
  title: '示例：一个两小时的改动，走了三个人', sub: '虚构流程示例，不代表所有审批；风险与责任决定流程，低频控制也可能必要。',
  body: `<div class="grid4">
    <div class="card pad"><div class="num">01</div><div class="h">需求评审</div><p class="p">两小时能评审完，问题不大。</p><span class="tag">正常</span></div>
    <div class="card pad warn"><div class="num">02</div><div class="h">排期审批</div><p class="p">审批人出差，任务卡在这里三天。</p><span class="tag">卡点</span></div>
    <div class="card pad"><div class="num">03</div><div class="h">上线审批</div><p class="p">再等一天签字，才能发布。</p><span class="tag">等待</span></div>
    <div class="card pad"><div class="num">04</div><div class="h">上线</div><p class="p">两小时的改动，走了五天。</p><span class="tag">结果</span></div>
  </div>
  <div class="bottom"><b>审批不是一概无用。</b>可为等待环节配置代理人与升级路径，但安全、生产变更和责任确认所需的控制，不能仅因低频就删除。</div>`,
  foot: '项目管理专栏 · 第 2 篇'
});

/* 01 */
pages['01-complexity'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 02', brand: '项目管理专栏',
  title: '复杂度可能从哪里来', sub: '三个可能的成因，不是对所有平台的判断；完整功能也可能服务必要的流程。',
  body: `<div class="grid3">
    ${card('01', '采购与使用目标可能不同', '采购关注覆盖范围，使用者关注日常动作。若两者没有一起验证，功能清单可能掩盖使用成本。')}
    ${card('02', '模块扩展可能增加成本', '审批、AI 等能力各有用途；新增模块若缺少清晰入口与关联，可能增加学习和配置负担。')}
    ${card('03', '组织流程可能影响配置', '复杂流程进入系统后，可能带来多层配置；先区分必要控制与冗余步骤，再决定怎样简化。')}
  </div>
  <div class="bottom"><b>核对方向：</b>用真实流程检查功能是否服务工作，而不是把复杂度归因于所有平台或所有功能。</div>`,
  foot: '项目管理专栏 · 第 1 篇'
});

/* 02 */
pages['02-tax'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 03', brand: '项目管理专栏',
  title: '一套工具的四种隐性成本', sub: '除了功能收益，也要核对可能产生的时间与维护成本。',
  body: `<div class="grid2">
    ${card('01', '学习税', '字段、状态、权限与报表入口都需要学习。让新人走一遍真实任务，记录上手时间，而不是预设耗时比例。', '起步成本')}
    ${card('02', '配置税', '工作流变更可能改变统计口径。明确配置负责人，并分开核对当前统计与历史记录。', '维护成本')}
    ${card('03', '数据搬运税', '需求、任务、结论若分散在多处，可能产生重复维护。检查哪些对象能关联，哪些仍需人工整理。', '重复成本')}
    ${card('04', '注意力税', '红点、审批与推荐都可能造成切换。区分必须即时处理的消息与可以稍后查看的回顾。', '切换成本')}
  </div>
  <div class="bottom"><b>结论：</b>功能覆盖度衡量的是「买到了什么」，使用效率衡量的是「每天省下了什么」。</div>`,
  foot: '项目管理专栏 · 第 1 篇'
});

/* 03 */
pages['03-subtraction'] = page({
  accent: ACCENT.s1, kicker: '系列一 · 行业思考 ｜ 配图 01', brand: '项目管理专栏',
  title: '判断一个功能去留的三道问题', sub: '减法不是只按使用频率删功能，而是保留交付链路所需的关联与控制。',
  body: `<div class="card">
    <div class="rowhead"><span></span><span>问题</span><span>判断</span><span>处理</span></div>
    <div class="row"><div class="idx">01</div><div class="t">它服务交付链路吗？</div><div class="c">需求、工作项、计划、发布与投入之间，是否有清楚的关联。</div><div class="c"><b>明确服务对象</b>让交付主路径清楚，辅助能力放到合适位置。</div></div>
    <div class="row"><div class="idx">02</div><div class="t">缺了会断证据吗？</div><div class="c">责任确认、审计与恢复即使低频，也可能是记录可信的必要条件。</div><div class="c"><b>保留必要控制</b>不能仅因不常使用，就删掉证据与风险控制。</div></div>
    <div class="row"><div class="idx">03</div><div class="t">它能解释吗？</div><div class="c">数字怎么算、状态为何变化、记录由谁确认，是否可以核对。</div><div class="c"><b>说明口径与边界</b>减少重复整理，同时保留校正路径。</div></div>
  </div>
  <div class="bottom"><b>减法之后留下的是链路，不是散装功能。</b>简化操作，不等于省略必要的责任确认与记录。</div>`,
  foot: '项目管理专栏 · 第 2 篇'
});

/* 08 · 通知节奏 */
pages['08-notify'] = page({
  accent: ACCENT.s3, kicker: '系列三 · 核心功能 ｜ 配图 02', brand: '沙漏 · HOURGLASS',
  title: '消息该在什么时候出现', sub: '协作不是让消息更多，而是区分提醒、回顾与外部投递。',
  body: `<div class="grid2">
    <div class="card pad"><div class="mini">需要及时处理的</div><div class="h">关注站内提醒</div>
      <ul class="list"><li>被指派、被提及</li><li>逾期与今日到期</li><li>关键状态变更</li></ul>
      <span class="tag">按事件与通知配置</span>
    </div>
    <div class="card pad"><div class="mini">需要集中核对的</div><div class="h">回顾可查看</div>
      <ul class="list"><li>每周完成与投入记录</li><li>待确认与进行中事项</li><li>AI 草稿按配置生成，需人工核对</li><li>邮件与机器人按配置投递</li></ul>
      <span class="tag">不承诺周报自动推送</span>
    </div>
  </div>
  <div class="bottom"><b>回顾可查看，不等于周报必定自动送达。</b>外部 AI、邮件与机器人会按配置出站，需核对服务与数据边界。</div>`,
  foot: '沙漏博客专栏 · 第 8 篇'
});

/* 05 */
pages['05-principles'] = page({
  accent: ACCENT.s2, kicker: '系列二 · 产品理念 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '少重复、可校正的四条原则', sub: '减少重复整理，不替代记录核对与发布确认。',
  body: `<div class="grid2">
    ${card('01', '动作关联记录', '拖进「进行中」开表，拖进「已完成」停表并接力。计时与状态相关联，但遗漏和异常仍需要人工核对。')}
    ${card('02', '默认可用，也可配置', '自动计时按工作日，周末不计；个人工作时段默认 9–18，日额度默认 8h，两者可配置。')}
    ${card('03', '共享来源，区分口径', '当前统计与完成、发布历史快照分开。比较数字前先核对对象、筛选、时间范围与统计口径。')}
    ${card('04', '有明细，也有校正路径', '按任务、成员、日期核对工时记录，支持补记与作废重算。补记单条 1min–24h，不按自动计时规则裁剪；不承诺所有指标都可点击下钻。')}
  </div>
  <div class="bottom"><b>少重复，不等于不用确认。</b>工时用于解释投入，不是财务结算；发布记录由人工确认，不是客户签认。</div>`,
  foot: '沙漏博客专栏 · 第 4 篇'
});

/* 07 */
pages['07-four-questions'] = page({
  accent: ACCENT.s3, kicker: '系列三 · 核心功能 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '投入与交付要回答的四个问题', sub: '任务完成不等于已发布；发布记录也不等于客户验收。',
  body: `<div class="grid4">
    ${card('01', '计划什么？', '需求评审后拆成工作项，关联计划版本与发布计划；计划可修改，不代表已经发生。', '版本 · 发布计划')}
    ${card('02', '完成什么？', '看板状态与完成记录说明团队登记的完成情况；历史快照与当前任务统计分开。', '工作项 · 完成快照')}
    ${card('03', '实际发布什么？', '按人工确认的发布记录核对环境、范围与逐项处置；系统不执行部署、不独立验证 SHA。', '发布记录 · 人工确认')}
    ${card('04', '投入怎么算？', '自动计时按工作日、个人时段和日额度；默认 9–18 / 8h 可配。补记单条 1min–24h，不裁剪。', '工时明细 · 可校正')}
  </div>
  <div class="bottom"><b>「交付账本」只是关联记录的比喻。</b>工时不是财务结算，发布不是客户签认；按对象核对明细，不承诺所有指标均可下钻。</div>`,
  foot: '沙漏博客专栏 · 第 6 篇'
});

/* 11 */
pages['11-disorders'] = page({
  accent: ACCENT.s4, kicker: '系列四 · 场景应用 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '三种信息断点，三种核对方向', sub: '可能的信息问题，不是多数失序的通用根因；能力、资源与决策也需要排查。',
  body: `<div class="card">
    <div class="rowhead"><span></span><span>现象</span><span>可能原因</span><span>核对方式</span></div>
    <div class="row"><div class="idx">01</div><div class="t">需求关联不清</div><div class="c"><b>月底说不清计划</b>评审、方案、任务和发布记录可能缺少关联。</div><div class="c"><b>核对需求到发布</b>评审后拆工作项，关联计划版本；发布内容由人工确认后留快照。</div></div>
    <div class="row"><div class="idx">02</div><div class="t">状态更新滞后</div><div class="c"><b>记录与现场有差异</b>可能遗漏更新，也可能是完成定义不一致。</div><div class="c"><b>动作关联 + 人工校正</b>拖拽改状态并关联计时；补记、作废与回顾用于核对异常。</div></div>
    <div class="row"><div class="idx">03</div><div class="t">风险发现较晚</div><div class="c"><b>临近发版才发现延期</b>可能信息分散，也可能依赖、资源或优先级变化。</div><div class="c"><b>集中视图 + 核对口径</b>查看逾期、阻塞与负载，结合实际情况确认风险和责任人。</div></div>
  </div>
  <div class="bottom"><b>工具帮助暴露信息断点，不替代项目判断。</b>记录需要维护，风险处理与发布确认仍由团队负责。</div>`,
  foot: '沙漏博客专栏 · 第 10 篇'
});

/* 12 */
pages['12-selection'] = page({
  accent: ACCENT.s4, kicker: '系列四 · 场景应用 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '项目制团队怎样选择交付工具', sub: '按流程、身份、证据和恢复能力逐项核对，不按人数直接下结论。',
  body: `<table class="table">
    <tr><th>约束</th><th>选型核对项</th><th>沙漏当前边界</th></tr>
    <tr><td>流程与容量</td><td>用真实项目验证关联、审批、权限与负载</td><td>面向小型项目制研发团队；单实例容量须在实际环境验证</td></tr>
    <tr><td>身份与 SSO</td><td>逐项核对组织身份、SSO 协议与接入路径</td><td>不预设满足企业 SSO；按现有支持与缺口验证</td></tr>
    <tr><td>合规与审计</td><td>核对事件覆盖、CSV、保留期与访问控制</td><td>系统审计最小集已实现；有 CSV，默认保留 90 天可配；内网不等于合规</td></tr>
    <tr><td>运维与恢复</td><td>明确升级、监控、备份、恢复负责人并演练</td><td>自托管不免维护；证据须全库数据库 + 附件备份</td></tr>
    <tr><td>迁移与集成</td><td>核对现有工具的迁移、自动化和外部服务需求</td><td>主流工具有同类功能；当前迁移与集成缺口需逐项验证</td></tr>
  </table>
  <div class="bottom"><b>验证方式：</b>用一个真实项目试运行，核对投入明细与人工确认的发布范围，并演练恢复；外部 AI、邮件、机器人按配置出站。</div>`,
  foot: '沙漏博客专栏 · 第 11 篇'
});

/* 12 · 轻量边界 */
pages['12-boundary'] = page({
  accent: ACCENT.s5, kicker: '系列五 · 价值总结 ｜ 配图 02', brand: '沙漏 · HOURGLASS',
  title: '自托管的四条当前边界', sub: '这是当前实现与交付条件，不是永久产品哲学。',
  body: `<div class="grid4">
    ${card('01', '单实例部署', '当前采用单实例；容量要在实际数据、并发与服务器环境验证，不承诺 50 人 2C4G 实测保证。', '容量验证')}
    ${card('02', '运维责任', '升级、监控、权限与安全更新需要负责人。自托管不是无人维护，也不是自动合规。', '明确负责人')}
    ${card('03', '数据库证据备份', '正式发布证据须全库数据库 + 附件备份并演练恢复；任务 JSON 不含正式发布证据。', '备份与恢复')}
    ${card('04', '迁移与集成缺口', '当前没有完整的一键迁移与插件生态；SSO、复杂流程与外部接入需逐项核对支持范围。', '当前缺口')}
  </div>
  <div class="bottom"><b>边界要随版本与环境核对。</b>系统审计最小集已有 CSV、保留期默认 90 天可配；不能据此推定满足全部合规审计要求。</div>`,
  foot: '沙漏博客专栏 · 第 12 篇'
});

/* 13 */
pages['13-burden'] = page({
  accent: ACCENT.s5, kicker: '系列五 · 价值总结 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '交付工具需要承担的三类责任', sub: '界面简洁不等于没有成本；时间、维护与记录责任都需要明确。',
  body: `<div class="grid3">
    ${card('01', '时间成本', '学习、配置、补记与校正都占用时间。通过默认值与关联减少重复整理，但不能承诺零录入。', '少重复 · 可校正')}
    ${card('02', '维护责任', '权限、升级、安全、审计保留与恢复演练需要负责人和交接机制。自托管不等于免维护。', '有人负责 · 可恢复')}
    ${card('03', '记录责任', '投入要核对，发布要人工确认。发布记录不执行部署、不独立验证 SHA，也不提供客户签认。', '记录边界 · 人工确认')}
  </div>
  <div class="bottom"><b>导出不等于证据备份。</b>任务 JSON 不含正式发布证据，证据须全库数据库 + 附件备份；「交付账本」只是比喻，工时非财务结算。</div>`,
  foot: '沙漏博客专栏 · 第 13 篇'
});

/* 14 */
pages['14-path'] = page({
  accent: ACCENT.s5, kicker: '系列五 · 价值总结 ｜ 配图 01', brand: '沙漏 · HOURGLASS',
  title: '从问题到验证：研发交付的阅读路径', sub: '面向小型项目制研发团队的自托管研发交付工作台。',
  body: `<div class="path">
    <div class="step"><div class="n">STEP 01</div><div class="h">问题</div><p class="p">识别可能的重复整理与信息断点</p><div class="r">第 1 篇</div></div>
    <div class="step"><div class="n">STEP 02</div><div class="h">关联</div><p class="p">围绕交付链路做减法，保留必要控制</p><div class="r">第 2 篇</div></div>
    <div class="step"><div class="n">STEP 03</div><div class="h">事实</div><p class="p">区分计划、完成、人工发布记录与投入</p><div class="r">第 3–8 篇</div></div>
    <div class="step"><div class="n">STEP 04</div><div class="h">场景</div><p class="p">在项目团队的一周里核对记录与责任</p><div class="r">第 9–10 篇</div></div>
    <div class="step"><div class="n">STEP 05</div><div class="h">验证</div><p class="p">逐项验证选型、容量、审计与恢复边界</p><div class="r">第 11–13 篇</div></div>
  </div>
  <div class="bottom"><b>让投入可解释，让交付可追溯。</b>不是财务结算或客户签认承诺，而是通过关联记录、口径核对与责任确认来解释工作。</div>`,
  foot: '沙漏博客专栏 · 第 13 篇'
});

const only = (process.env.ONLY || '').split(',').filter(Boolean);
for (const [name, html] of Object.entries(pages)) {
  if (only.length && !only.includes(name)) continue;
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