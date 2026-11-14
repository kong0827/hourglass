/* ============================================================
   沙漏 · 需求全链路追溯原型 · 交互脚本
   所有数据为演示数据，不对应真实生产数据
   ============================================================ */
(function () {
  'use strict';

  // ---------- 基础工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const avatarColor = (name) => ({
    '赵磊': '#1D4ED8', '李娜': '#B54708', '王强': '#067647', '陈晨': '#5B3FD1', '张伟': '#A31A6B'
  }[name] || '#475467');
  const avatar = (name, cls = '') => name && name !== '—'
    ? `<span class="avatar ${cls}" style="--a:${avatarColor(name)}" title="${esc(name)}">${esc(name.slice(0, 1))}</span>`
    : '<span class="muted">—</span>';
  const person = (name) => `<span class="person">${avatar(name, 'avatar-sm')}<span>${esc(name || '—')}</span></span>`;
  const priorityTone = { P0: 'red', P1: 'amber', P2: 'blue', P3: 'gray' };
  const priTag = (p) => `<span class="tag ${priorityTone[p] || 'gray'}">${esc(p)}</span>`;
  const resultMap = {
    passed: { label: '通过', cls: 'pass', icon: 'check' },
    failed: { label: '失败', cls: 'fail', icon: 'x' },
    blocked: { label: '阻塞', cls: 'block', icon: 'alert' },
    untested: { label: '未执行', cls: 'untested', icon: 'clock' }
  };
  const resultTag = (r) => {
    const m = resultMap[r] || resultMap.untested;
    return `<span class="result ${m.cls}">${icon(m.icon)}${m.label}</span>`;
  };
  const coverageTag = (cov) => {
    const tone = cov && cov.indexOf('未覆盖') >= 0 ? 'red' : cov && cov.indexOf('需求级') >= 0 ? 'blue' : 'green';
    return `<span class="tag ${tone}">${esc(cov || '—')}</span>`;
  };

  // ---------- 演示数据 ----------
  const DATA = {
    demand: {
      id: 'REQ-2026-018',
      title: '对账中心支持按项目批量导出',
      project: '统一支付网关',
      version: '支付网关 v2.2',
      owner: '赵磊',
      expected: '11-22',
      source: '财务 · 刘',
      priority: 'P1'
    },
    workItems: [
      {
        id: 'HG-2418', title: '对账导出接口支持项目维度', type: '用户故事', owner: '赵磊',
        status: '已完成', tone: 'green', cases: ['TC-0187', 'TC-0191'], coverage: '工作项级',
        result: '1 通过 · 1 未执行', resultTone: 'amber', estimate: '2d', actual: '1.5d'
      },
      {
        id: 'HG-2419', title: '导出任务异步化与进度查询', type: '任务', owner: '李娜',
        status: '已完成', tone: 'green', cases: ['TC-0192', 'TC-0193'], coverage: '工作项级',
        result: '2 通过', resultTone: 'green', estimate: '1.5d', actual: '1.5d'
      },
      {
        id: 'HG-2420', title: '导出失败重试与审计日志', type: '任务', owner: '王强',
        status: '进行中', tone: 'blue', cases: ['TC-0189', 'TC-0192'], coverage: '工作项级',
        result: '1 失败 · 1 通过', resultTone: 'red', estimate: '2d', actual: '1d'
      },
      {
        id: 'HG-2421', title: '导出 10 万行性能压测', type: '任务', owner: '陈晨',
        status: '待处理', tone: 'gray', cases: ['TC-0188'], coverage: '工作项级',
        result: '1 阻塞', resultTone: 'red', estimate: '1d', actual: '—'
      },
      {
        id: 'HG-2422', title: '导出模板与字段配置', type: '任务', owner: '陈晨',
        status: '待处理', tone: 'gray', cases: [], coverage: '未覆盖',
        result: '—', resultTone: 'gray', estimate: '0.5d', actual: '—'
      }
    ],
    cases: [
      {
        id: 'TC-0187', title: '按项目筛选后导出', pri: 'P0', demand: 'REQ-2026-018',
        wis: ['HG-2418'], result: 'passed', plans: ['TP-009'], defect: null,
        executor: '赵磊', at: '11-16 14:20', cov: '工作项级'
      },
      {
        id: 'TC-0188', title: '10 万行导出性能', pri: 'P0', demand: 'REQ-2026-018',
        wis: ['HG-2421'], result: 'blocked', plans: ['TP-009'], defect: 'BUG-0915',
        executor: '李娜', at: '11-16 16:05', cov: '工作项级'
      },
      {
        id: 'TC-0189', title: '导出失败重试', pri: 'P1', demand: 'REQ-2026-018',
        wis: ['HG-2420'], result: 'failed', plans: ['TP-009'], defect: 'BUG-0912',
        executor: '王强', at: '11-16 15:40', cov: '工作项级'
      },
      {
        id: 'TC-0190', title: '无数据项目导出空文件', pri: 'P2', demand: 'REQ-2026-018',
        wis: [], result: 'passed', plans: ['TP-009'], defect: null,
        executor: '陈晨', at: '11-16 14:45', cov: '需求级'
      },
      {
        id: 'TC-0191', title: '权限隔离：无权限项目不可导出', pri: 'P1', demand: 'REQ-2026-018',
        wis: ['HG-2418'], result: 'untested', plans: ['TP-009'], defect: null,
        executor: '—', at: '—', cov: '工作项级'
      },
      {
        id: 'TC-0192', title: '导出与重试写入审计日志', pri: 'P2', demand: 'REQ-2026-018',
        wis: ['HG-2419', 'HG-2420'], result: 'passed', plans: ['TP-009'], defect: 'BUG-0917',
        executor: '王强', at: '11-16 15:10', cov: '工作项级'
      },
      {
        id: 'TC-0193', title: '导出任务进度查询', pri: 'P1', demand: 'REQ-2026-018',
        wis: ['HG-2419'], result: 'passed', plans: ['TP-009'], defect: null,
        executor: '李娜', at: '11-16 14:55', cov: '工作项级'
      }
    ],
    plans: [
      {
        id: 'TP-009', name: '支付网关 v2.2 回归', version: '支付网关 v2.2', status: '进行中', tone: 'blue',
        cases: 19, executed: 17, passed: 14, failed: 2, blocked: 1, untested: 2,
        demandCases: 7, demandExecuted: 6, demandPassed: 4, demandFailed: 1, demandBlocked: 1, demandUntested: 1,
        progress: 89, demandProgress: 86, owner: '赵磊', dates: '11-15 ~ 11-22'
      },
      {
        id: 'TP-010', name: '对账导出专项', version: '支付网关 v2.2', status: '草稿', tone: 'gray',
        cases: 7, executed: 0, passed: 0, failed: 0, blocked: 0, untested: 7,
        demandCases: 7, demandExecuted: 0, demandPassed: 0, demandFailed: 0, demandBlocked: 0, demandUntested: 7,
        progress: 0, demandProgress: 0, owner: '赵磊', dates: '11-18 ~ 11-21'
      }
    ],
    defects: [
      { id: 'BUG-0912', title: '导出失败后重试仍返回 500', source: 'TC-0189', pri: 'P1', status: '已修复待验证', tone: 'amber', owner: '王强', createdAt: '11-16' },
      { id: 'BUG-0915', title: '10 万行导出超过 30 秒', source: 'TC-0188', pri: 'P1', status: '处理中', tone: 'red', owner: '李娜', createdAt: '11-16' },
      { id: 'BUG-0917', title: '导出审计日志缺少操作人', source: 'TC-0192', pri: 'P2', status: '已关闭', tone: 'green', owner: '王强', createdAt: '11-15' }
    ],
    releasePlan: { id: 'RP-2026-024', name: '支付网关 v2.2 生产发布', date: '11-22', status: '待检查', env: '生产' },
    releases: [
      {
        id: 'REL-2026-1108', version: '支付网关 v2.1', env: '生产', result: '成功',
        at: '11-08 22:10', by: '张伟', passRate: '95.2%', cases: 42, passed: 40, failed: 0,
        blocked: 0, untested: 2, openDefects: 0, fixedDefects: 3, commit: 'a18f3c2',
        plans: ['TP-007', 'TP-008'],
        demands: [
          { title: '支付结果页支持按渠道筛选', wis: 3, cases: 5, result: '5 通过', note: '已交付' },
          { title: '退款回调幂等校验', wis: 2, cases: 3, result: '3 通过', note: '已交付' },
          { title: '支付网关日志脱敏', wis: 2, cases: 4, result: '3 通过 · 1 跳过', note: '已交付' }
        ]
      },
      {
        id: 'REL-2026-1024', version: '支付网关 v2.0', env: '生产', result: '成功',
        at: '10-24 21:40', by: '张伟', passRate: '92.8%', cases: 38, passed: 35, failed: 1,
        blocked: 0, untested: 2, openDefects: 0, fixedDefects: 4, commit: '7d2e1b9',
        plans: ['TP-005'],
        demands: [
          { title: '支付网关基础路由', wis: 4, cases: 8, result: '8 通过', note: '已交付' },
          { title: '支付回调日志', wis: 2, cases: 4, result: '3 通过 · 1 失败后修复', note: '已交付' }
        ]
      }
    ],
    planRows: [
      { id: 'TC-0187', title: '按项目筛选后导出', demandId: 'REQ-2026-018', demandTitle: '对账中心支持按项目批量导出', wis: ['HG-2418'], pri: 'P0', executor: '赵磊', result: 'passed', defect: null, at: '11-16 14:20' },
      { id: 'TC-0188', title: '10 万行导出性能', demandId: 'REQ-2026-018', demandTitle: '对账中心支持按项目批量导出', wis: ['HG-2421'], pri: 'P0', executor: '李娜', result: 'blocked', defect: 'BUG-0915', at: '11-16 16:05' },
      { id: 'TC-0189', title: '导出失败重试', demandId: 'REQ-2026-018', demandTitle: '对账中心支持按项目批量导出', wis: ['HG-2420'], pri: 'P1', executor: '王强', result: 'failed', defect: 'BUG-0912', at: '11-16 15:40' },
      { id: 'TC-0190', title: '无数据项目导出空文件', demandId: 'REQ-2026-018', demandTitle: '对账中心支持按项目批量导出', wis: [], pri: 'P2', executor: '陈晨', result: 'passed', defect: null, at: '11-16 14:45' },
      { id: 'TC-0191', title: '权限隔离：无权限项目不可导出', demandId: 'REQ-2026-018', demandTitle: '对账中心支持按项目批量导出', wis: ['HG-2418'], pri: 'P1', executor: '—', result: 'untested', defect: null, at: '—' },
      { id: 'TC-0192', title: '导出与重试写入审计日志', demandId: 'REQ-2026-018', demandTitle: '对账中心支持按项目批量导出', wis: ['HG-2419', 'HG-2420'], pri: 'P2', executor: '王强', result: 'passed', defect: 'BUG-0917', at: '11-16 15:10' },
      { id: 'TC-0193', title: '导出任务进度查询', demandId: 'REQ-2026-018', demandTitle: '对账中心支持按项目批量导出', wis: ['HG-2419'], pri: 'P1', executor: '李娜', result: 'passed', defect: null, at: '11-16 14:55' },
      { id: 'TC-0142', title: '支付结果页按渠道筛选', demandId: 'REQ-2026-011', demandTitle: '支付结果页支持按渠道筛选', wis: ['HG-2398'], pri: 'P1', executor: '陈晨', result: 'passed', defect: null, at: '11-15 10:20' },
      { id: 'TC-0143', title: '渠道为空时展示全部', demandId: 'REQ-2026-011', demandTitle: '支付结果页支持按渠道筛选', wis: ['HG-2398'], pri: 'P2', executor: '陈晨', result: 'passed', defect: null, at: '11-15 10:40' },
      { id: 'TC-0144', title: '渠道切换后分页重置', demandId: 'REQ-2026-011', demandTitle: '支付结果页支持按渠道筛选', wis: ['HG-2399'], pri: 'P2', executor: '陈晨', result: 'passed', defect: null, at: '11-15 11:05' },
      { id: 'TC-0151', title: '退款回调重复通知', demandId: 'REQ-2026-009', demandTitle: '退款回调幂等校验', wis: ['HG-2402'], pri: 'P0', executor: '李娜', result: 'passed', defect: null, at: '11-15 11:10' },
      { id: 'TC-0152', title: '退款回调乱序', demandId: 'REQ-2026-009', demandTitle: '退款回调幂等校验', wis: ['HG-2402'], pri: 'P1', executor: '李娜', result: 'failed', defect: 'BUG-0918', at: '11-15 11:35' },
      { id: 'TC-0153', title: '退款回调签名错误', demandId: 'REQ-2026-009', demandTitle: '退款回调幂等校验', wis: ['HG-2402'], pri: 'P1', executor: '—', result: 'untested', defect: null, at: '—' }
    ],
    versionDemands: [
      { id: 'REQ-2026-018', title: '对账中心支持按项目批量导出', wis: '2/5', cases: '4/7', openDefects: 2, coverage: '工作项级 80%', conclusion: '有风险', tone: 'amber' },
      { id: 'REQ-2026-011', title: '支付结果页支持按渠道筛选', wis: '3/3', cases: '5/5', openDefects: 0, coverage: '工作项级 100%', conclusion: '可发布', tone: 'green' },
      { id: 'REQ-2026-009', title: '退款回调幂等校验', wis: '2/2', cases: '5/7', openDefects: 1, coverage: '工作项级 100%', conclusion: '有风险', tone: 'amber' },
      { id: 'REQ-2026-006', title: '支付网关日志脱敏', wis: '2/2', cases: '4/4', openDefects: 0, coverage: '需求级 100%', conclusion: '可发布', tone: 'green' },
      { id: 'REQ-2026-003', title: '支付回调重试策略', wis: '1/1', cases: '3/3', openDefects: 0, coverage: '工作项级 100%', conclusion: '可发布', tone: 'green' }
    ],
    versionChecks: [
      { tone: 'red', title: 'TC-0189 失败未复测', desc: '对账导出 · P1 · 最近执行 11-16 15:40' },
      { tone: 'red', title: 'TC-0188 阻塞未解除', desc: '性能环境未就绪 · BUG-0915 处理中' },
      { tone: 'red', title: 'BUG-0915 未关闭', desc: '10 万行导出超过 30 秒 · 李娜' },
      { tone: 'red', title: 'HG-2420 工作项未完成', desc: '导出失败重试与审计日志 · 王强' },
      { tone: 'red', title: 'TC-0152 退款回调失败', desc: '退款回调幂等校验 · BUG-0918' }
    ]
  };

  const findCase = (id) => DATA.cases.find((c) => c.id === id);
  const findWI = (id) => DATA.workItems.find((w) => w.id === id);
  const findBug = (id) => DATA.defects.find((d) => d.id === id);

  // ---------- 需求全链路：链条件 ----------
  function renderChain() {
    const steps = [
      { icon: 'inbox', tone: 'blue', label: '需求', value: '已排期', sub: 'REQ-2026-018', pct: 100, bar: 'var(--primary)', target: 'summaryCard' },
      { icon: 'list', tone: 'amber', label: '工作项', value: '2/5', sub: '完成 · 1 项未精确覆盖', pct: 40, bar: 'var(--warning)', target: 'workItemCard' },
      { icon: 'check-square', tone: 'red', label: '用例', value: '4/7', sub: '通过 · 1 失败 · 1 阻塞', pct: 57, bar: 'var(--danger)', target: 'caseCard' },
      { icon: 'target', tone: 'blue', label: '测试计划', value: '1 个', sub: '进行中 · 本需求 6/7 已执行', pct: 86, bar: 'var(--primary)', target: 'planCard' },
      { icon: 'shield', tone: 'gray', label: '发布', value: '待发布', sub: 'v2.2 · 计划 11-22', pct: 0, bar: 'var(--border-strong)', target: 'releaseCard' }
    ];
    $('#chain').innerHTML = steps.map((s) => `
      <button class="chain-step" type="button" data-scroll="${s.target}" title="定位到${esc(s.label)}">
        <span class="step-top"><span class="step-ico ${s.tone}">${icon(s.icon)}</span><span class="step-label">${esc(s.label)}</span></span>
        <span class="step-val"><b>${esc(s.value)}</b><span>${esc(s.sub)}</span></span>
        <span class="step-bar"><i style="width:${s.pct}%;background:${s.bar}"></i></span>
      </button>`).join('');
  }

  // ---------- 需求全链路：风险 ----------
  const RISKS = [
    {
      tone: 'red', title: 'TC-0189 导出失败重试 · 失败未复测',
      desc: '最近一次执行 11-16 15:40，失败原因「重试后仍返回 500」；关联缺陷 BUG-0912 已修复待验证。',
      meta: ['P1 用例', '负责人 王强', 'TP-009'], action: '查看用例', attrs: 'data-open-case="TC-0189"', extra: false
    },
    {
      tone: 'red', title: 'TC-0188 10 万行导出性能 · 阻塞',
      desc: '性能环境未就绪，执行被阻塞；关联缺陷 BUG-0915 仍在处理中。',
      meta: ['P0 用例', '负责人 李娜', 'TP-009'], action: '查看缺陷', attrs: 'data-open-bug="BUG-0915"', extra: false
    },
    {
      tone: 'red', title: 'BUG-0915 10 万行导出超时 · 未关闭',
      desc: '性能用例阻塞的根因；缺陷关闭前 TC-0188 无法复测，版本也无法确认性能达标。',
      meta: ['P1 缺陷', '负责人 李娜', '处理中'], action: '查看缺陷', attrs: 'data-open-bug="BUG-0915"', extra: false
    },
    {
      tone: 'red', title: 'HG-2420 导出失败重试与审计日志 · 未完成',
      desc: '工作项仍在进行中，但已有 1 条用例失败；完成后需要重新执行 TC-0189。',
      meta: ['任务', '负责人 王强', '目标版本 v2.2'], action: '查看工作项', attrs: 'data-open-workitem="HG-2420"', extra: false
    },
    {
      tone: 'amber', title: 'HG-2422 导出模板与字段配置 · 无用例',
      desc: '需求级已有 7 条用例，但没有任何用例精确关联这个工作项；建议补 1 条工作项级用例。',
      meta: ['任务', '负责人 陈晨', '工作项级覆盖 80%'], action: '查看工作项', attrs: 'data-open-workitem="HG-2422"', extra: false
    },
    {
      tone: 'amber', title: 'TP-010 对账导出专项 · 草稿',
      desc: '计划已圈选 7 条用例，但还没有开始执行；如果作为验收专项，需要在发布前启动。',
      meta: ['测试计划', '负责人 赵磊', '0/7 已执行'], action: '查看计划', attrs: 'data-view="plan"', extra: true
    },
    {
      tone: 'amber', title: 'TC-0191 权限隔离 · 未执行',
      desc: '无权限项目不可导出的验收项还没有执行；这是发布前必须覆盖的 P1 用例。',
      meta: ['P1 用例', '负责人 赵磊', 'TP-009'], action: '查看用例', attrs: 'data-open-case="TC-0191"', extra: true
    }
  ];

  function renderRisks() {
    const list = $('#riskList');
    list.className = 'card-body risk-list';
    list.innerHTML = RISKS.map((r, i) => `
      <div class="risk-item ${r.extra ? 'extra' : ''}">
        <div class="risk-ico ${r.tone}">${icon(r.tone === 'red' ? 'alert' : 'clock')}</div>
        <div class="risk-main">
          <div class="risk-title">${esc(r.title)}</div>
          <div class="risk-desc">${esc(r.desc)}</div>
          <div class="risk-meta">
            ${r.meta.map((m) => `<span class="tag gray">${esc(m)}</span>`).join('')}
            <button class="link-btn" type="button" ${r.attrs}>${esc(r.action)}${icon('arrow-right')}</button>
          </div>
        </div>
      </div>`).join('') + `
      <div class="risk-more">
        <button class="link-btn" type="button" data-risk-more>查看全部 ${RISKS.length} 项${icon('chevron-down')}</button>
      </div>`;
  }

  function toggleRiskList(btn) {
    const list = $('#riskList');
    const expanded = list.classList.toggle('expanded');
    btn.innerHTML = expanded ? `收起${icon('chevron-down')}` : `查看全部 6 项${icon('chevron-down')}`;
  }

  // ---------- 需求全链路：工作项 ----------
  function caseChips(ids) {
    if (!ids || !ids.length) return '<span class="case-chip muted">无用例</span>';
    return ids.map((id) => `<button class="case-chip" type="button" data-open-case="${esc(id)}">${esc(id)}</button>`).join('');
  }

  function renderWorkItems() {
    $('#workItemBody').innerHTML = DATA.workItems.map((w) => `
      <tr class="row-link" data-open-workitem="${esc(w.id)}">
        <td><div class="cell-title"><span class="mono">${esc(w.id)}</span><b>${esc(w.title)}</b></div></td>
        <td><span class="tag ${w.type === '用户故事' ? 'plum' : 'gray'}">${esc(w.type)}</span></td>
        <td>${person(w.owner)}</td>
        <td><span class="tag ${w.tone}"><i class="dot"></i>${esc(w.status)}</span></td>
        <td><div class="case-chips">${caseChips(w.cases)}</div></td>
        <td>${coverageTag(w.coverage)}</td>
        <td><span class="result ${w.resultTone === 'green' ? 'pass' : w.resultTone === 'red' ? 'fail' : w.resultTone === 'amber' ? 'block' : 'untested'}">${esc(w.result)}</span></td>
      </tr>`).join('');
  }

  // ---------- 需求全链路：用例 ----------
  function renderCases() {
    $('#caseBody').innerHTML = DATA.cases.map((c) => {
      const wiChips = c.wis.length
        ? c.wis.map((id) => `<button class="case-chip" type="button" data-open-workitem="${esc(id)}">${esc(id)}</button>`).join('')
        : '<span class="tag blue">需求级</span>';
      const defect = c.defect
        ? `<button class="link-btn" type="button" data-open-bug="${esc(c.defect)}">${esc(c.defect)}</button>`
        : '<span class="muted">—</span>';
      const flags = [
        c.result === 'failed' ? 'data-failed="1"' : '',
        c.result === 'untested' ? 'data-untested="1"' : '',
        !c.wis.length ? 'data-unlinked="1"' : ''
      ].filter(Boolean).join(' ');
      return `<tr class="row-link" data-open-case="${esc(c.id)}" data-result="${esc(c.result)}" ${flags}>
        <td><div class="cell-title"><span class="mono">${esc(c.id)}</span><b>${esc(c.title)}</b></div></td>
        <td>${priTag(c.pri)}</td>
        <td><div class="case-chips">${wiChips}</div></td>
        <td>${resultTag(c.result)}</td>
        <td><span class="mono" style="font-size:9.5px">${esc(c.plans[0] || '—')}</span></td>
        <td>${defect}</td>
        <td><span style="display:flex;align-items:center;gap:5px">${person(c.executor)}<span class="mono" style="font-size:9px;color:var(--text-3)">${esc(c.at)}</span></span></td>
      </tr>`;
    }).join('');
  }

  function setCaseFilter(filter) {
    $$('#caseFilters button').forEach((b) => b.classList.toggle('on', b.dataset.caseFilter === filter));
    $$('#caseBody tr').forEach((tr) => {
      const show = filter === 'all' || tr.dataset[filter] === '1';
      tr.hidden = !show;
    });
  }

  // ---------- 需求全链路：计划卡 ----------
  function renderPlans() {
    $('#planList').innerHTML = DATA.plans.map((p) => `
      <div class="plan-card">
        <div>
          <div class="plan-title">
            <span class="mono">${esc(p.id)}</span><b>${esc(p.name)}</b>
            <span class="tag ${p.tone}"><i class="dot"></i>${esc(p.status)}</span>
          </div>
          <div class="plan-meta">
            <span>${esc(p.version)}</span><span class="sep">·</span><span>${esc(p.dates)}</span>
            <span class="sep">·</span><span>负责人 ${esc(p.owner)}</span>
          </div>
          <div class="plan-stats">
            <div class="plan-stat"><b>${p.demandCases}</b><span>本需求用例</span></div>
            <div class="plan-stat"><b>${p.demandExecuted}/${p.demandCases}</b><span>本需求已执行</span></div>
            <div class="plan-stat"><b>${p.demandPassed}</b><span>通过</span></div>
            <div class="plan-stat"><b>${p.demandFailed + p.demandBlocked}</b><span>失败 / 阻塞</span></div>
            <div class="plan-stat"><b>${p.cases}</b><span>计划总用例</span></div>
          </div>
        </div>
        <div class="plan-side">
          <div class="plan-progress-top"><span>本需求执行</span><b>${p.demandProgress}%</b></div>
          <div class="progress ${p.demandProgress >= 100 ? 'green' : p.demandProgress > 0 ? 'amber' : ''}"><i style="width:${p.demandProgress}%"></i></div>
          <button class="btn sm" type="button" data-view="plan">打开计划${icon('arrow-right')}</button>
        </div>
      </div>`).join('');
  }

  // ---------- 需求全链路：缺陷 ----------
  function renderDefects() {
    $('#defectBody').innerHTML = DATA.defects.map((d) => `
      <tr class="row-link" data-open-bug="${esc(d.id)}">
        <td><div class="cell-title"><span class="mono">${esc(d.id)}</span><b>${esc(d.title)}</b></div></td>
        <td><button class="link-btn" type="button" data-open-case="${esc(d.source)}">${esc(d.source)}</button></td>
        <td>${priTag(d.pri)}</td>
        <td><span class="tag ${d.tone}"><i class="dot"></i>${esc(d.status)}</span></td>
        <td>${person(d.owner)}</td>
        <td><span class="mono" style="font-size:9.5px;color:var(--text-3)">${esc(d.createdAt)}</span></td>
      </tr>`).join('');
  }

  // ---------- 需求全链路：发布 ----------
  function renderRelease() {
    $('#releaseBody').innerHTML = `
      <div class="release-box">
        <div class="release-main">
          <div class="release-version">
            <span class="step-ico blue">${icon('layers')}</span>
            <div><b>支付网关 v2.2</b><span>${esc(DATA.releasePlan.id)} · 计划 ${esc(DATA.releasePlan.date)} · ${esc(DATA.releasePlan.env)}</span></div>
            <span class="tag amber"><i class="dot"></i>待发布</span>
          </div>
          <div class="release-checks">
            <div><span>测试计划</span><b>TP-009 进行中</b></div>
            <div><span>本需求通过率</span><b>4/7 · 57%</b></div>
            <div><span>未关闭缺陷</span><b class="danger-text">2 个</b></div>
            <div><span>工作项完成</span><b>2/5</b></div>
          </div>
        </div>
        <div class="release-actions">
          <button class="btn sm" type="button" data-open-snapshot="REL-2026-1108">查看历史发布</button>
          <button class="btn sm primary" type="button" data-open-release-check="demand">发布检查${icon('arrow-right')}</button>
        </div>
      </div>`;
  }

  // ---------- 右栏 ----------
  function renderRail() {
    const judge = [
      { tone: 'bad', icon: 'x', k: '工作项完成', v: '2/5' },
      { tone: 'warn', icon: 'alert', k: '用例通过', v: '4/7' },
      { tone: 'bad', icon: 'bug', k: '缺陷关闭', v: '1/3' },
      { tone: 'ok', icon: 'check', k: '计划执行', v: '6/7' },
      { tone: 'gray', icon: 'clock', k: '发布证据', v: '待发布' }
    ];
    $('#judgeList').innerHTML = judge.map((r) => `
      <div class="judge-row ${r.tone}">${icon(r.icon)}<span class="k">${esc(r.k)}</span><span class="v">${esc(r.v)}</span></div>`).join('');

    const comp = [
      { label: '需求 → 工作项', value: '100%', pct: 100, cls: 'green' },
      { label: '工作项 → 用例', value: '80%', pct: 80, cls: 'amber' },
      { label: '用例 → 测试计划', value: '100%', pct: 100, cls: 'green' },
      { label: '测试计划 → 发布', value: '0%', pct: 0, cls: '' }
    ];
    $('#compList').innerHTML = comp.map((c) => `
      <div class="comp-row">
        <div class="comp-top"><span>${esc(c.label)}</span><b>${esc(c.value)}</b></div>
        <div class="progress ${c.cls}"><i style="width:${c.pct}%"></i></div>
      </div>`).join('');
  }

  // ---------- 覆盖矩阵 ----------
  const MATRIX = [
    {
      id: 'd1', type: 'req', kind: '需求', ref: 'REQ-2026-018', title: '对账中心支持按项目批量导出',
      cases: '7', coverage: '工作项级 80%', result: '4 通过 · 2 失败/阻塞 · 1 未执行', defect: '2 未关闭',
      risk: '4 阻断', riskTone: 'red', expanded: true,
      children: [
        {
          id: 'w1', type: 'wi', kind: '工作项', ref: 'HG-2418', title: '对账导出接口支持项目维度',
          cases: '2', coverage: '工作项级', result: '1 通过 · 1 未执行', defect: '—',
          risk: '1 未执行', riskTone: 'amber', expanded: true,
          children: [
            { id: 'c1', type: 'case', kind: '用例', ref: 'TC-0187', title: '按项目筛选后导出', caseId: 'TC-0187', coverage: '工作项级', result: 'passed', defect: '—', risk: '—', riskTone: 'gray' },
            { id: 'c5', type: 'case', kind: '用例', ref: 'TC-0191', title: '权限隔离：无权限项目不可导出', caseId: 'TC-0191', coverage: '工作项级', result: 'untested', defect: '—', risk: '未执行', riskTone: 'amber' }
          ]
        },
        {
          id: 'w2', type: 'wi', kind: '工作项', ref: 'HG-2419', title: '导出任务异步化与进度查询',
          cases: '2', coverage: '工作项级', result: '2 通过', defect: '—',
          risk: '正常', riskTone: 'green', expanded: false,
          children: [
            { id: 'c6a', type: 'case', kind: '用例', ref: 'TC-0192', title: '导出与重试写入审计日志', caseId: 'TC-0192', coverage: '工作项级', result: 'passed', defect: 'BUG-0917', risk: '—', riskTone: 'gray' },
            { id: 'c7', type: 'case', kind: '用例', ref: 'TC-0193', title: '导出任务进度查询', caseId: 'TC-0193', coverage: '工作项级', result: 'passed', defect: '—', risk: '—', riskTone: 'gray' }
          ]
        },
        {
          id: 'w3', type: 'wi', kind: '工作项', ref: 'HG-2420', title: '导出失败重试与审计日志',
          cases: '2', coverage: '工作项级', result: '1 通过 · 1 失败', defect: '1 未关闭',
          risk: '1 失败', riskTone: 'red', expanded: true,
          children: [
            { id: 'c3', type: 'case', kind: '用例', ref: 'TC-0189', title: '导出失败重试', caseId: 'TC-0189', coverage: '工作项级', result: 'failed', defect: 'BUG-0912', risk: '失败', riskTone: 'red' },
            { id: 'c6b', type: 'case', kind: '用例', ref: 'TC-0192', title: '导出与重试写入审计日志', caseId: 'TC-0192', coverage: '工作项级', result: 'passed', defect: 'BUG-0917', risk: '—', riskTone: 'gray' }
          ]
        },
        {
          id: 'w4', type: 'wi', kind: '工作项', ref: 'HG-2421', title: '导出 10 万行性能压测',
          cases: '1', coverage: '工作项级', result: '1 阻塞', defect: '1 未关闭',
          risk: '1 阻塞', riskTone: 'red', expanded: false,
          children: [
            { id: 'c2', type: 'case', kind: '用例', ref: 'TC-0188', title: '10 万行导出性能', caseId: 'TC-0188', coverage: '工作项级', result: 'blocked', defect: 'BUG-0915', risk: '阻塞', riskTone: 'red' }
          ]
        },
        {
          id: 'w5', type: 'wi', kind: '工作项', ref: 'HG-2422', title: '导出模板与字段配置',
          cases: '0', coverage: '未覆盖', result: '—', defect: '—',
          risk: '无用例', riskTone: 'amber', expanded: false, children: []
        },
        {
          id: 'w6', type: 'wi', kind: '需求级', ref: '—', title: '未关联工作项的用例',
          cases: '1', coverage: '需求级', result: '1 通过', defect: '—',
          risk: '提示', riskTone: 'blue', expanded: true,
          children: [
            { id: 'c4', type: 'case', kind: '用例', ref: 'TC-0190', title: '无数据项目导出空文件', caseId: 'TC-0190', coverage: '需求级', result: 'passed', defect: '—', risk: '—', riskTone: 'gray' }
          ]
        }
      ]
    },
    {
      id: 'd2', type: 'req', kind: '需求', ref: 'REQ-2026-011', title: '支付结果页支持按渠道筛选',
      cases: '5', coverage: '工作项级 100%', result: '5 通过', defect: '—',
      risk: '正常', riskTone: 'green', expanded: false,
      children: [
        { id: 'w11', type: 'wi', kind: '工作项', ref: 'HG-2398', title: '结果页渠道筛选与空态', cases: '3', coverage: '工作项级', result: '3 通过', defect: '—', risk: '正常', riskTone: 'green', expanded: false, children: [] },
        { id: 'w12', type: 'wi', kind: '工作项', ref: 'HG-2399', title: '渠道切换与分页联动', cases: '2', coverage: '工作项级', result: '2 通过', defect: '—', risk: '正常', riskTone: 'green', expanded: false, children: [] }
      ]
    },
    {
      id: 'd3', type: 'req', kind: '需求', ref: 'REQ-2026-009', title: '退款回调幂等校验',
      cases: '7', coverage: '工作项级 100%', result: '5 通过 · 1 失败 · 1 未执行', defect: '1 未关闭',
      risk: '1 失败', riskTone: 'red', expanded: false,
      children: [
        { id: 'w21', type: 'wi', kind: '工作项', ref: 'HG-2402', title: '退款回调幂等与乱序处理', cases: '5', coverage: '工作项级', result: '4 通过 · 1 失败', defect: '1 未关闭', risk: '1 失败', riskTone: 'red', expanded: false, children: [] },
        { id: 'w22', type: 'wi', kind: '工作项', ref: 'HG-2403', title: '退款回调超时重试', cases: '2', coverage: '工作项级', result: '1 通过 · 1 未执行', defect: '—', risk: '1 未执行', riskTone: 'amber', expanded: false, children: [] }
      ]
    },
    {
      id: 'd4', type: 'req', kind: '未关联', ref: '—', title: '未关联需求的用例',
      cases: '4', coverage: '需求级未覆盖', result: '3 通过 · 1 失败', defect: '—',
      risk: '需归类', riskTone: 'amber', expanded: false, children: []
    }
  ];

  let matrixQuery = '';

  function filterTree(nodes, q) {
    const hits = [];
    for (const n of nodes) {
      const self = `${n.ref} ${n.title}`.toLowerCase().includes(q);
      const children = n.children ? filterTree(n.children, q) : [];
      if (self) {
        hits.push({ ...n, children: n.children || [], expanded: true });
      } else if (children.length) {
        hits.push({ ...n, children, expanded: true });
      }
    }
    return hits;
  }

  function renderMatrix() {
    const root = $('#matrixTree');
    if (!root) return;
    const rows = matrixQuery ? filterTree(MATRIX, matrixQuery) : MATRIX;
    const body = rows.length
      ? rows.map((n) => renderTreeNode(n, 0)).join('')
      : `<div class="empty-state" style="margin:16px"><b>没有匹配的需求、工作项或用例</b>换个关键词，或清空搜索查看全部覆盖情况。</div>`;
    root.innerHTML = `
      <div class="tree-head">
        <span>需求 / 工作项 / 用例</span>
        <span>用例</span>
        <span>覆盖</span>
        <span>结果</span>
        <span>缺陷</span>
        <span>风险</span>
        <span></span>
      </div>` + body;
  }

  function renderTreeNode(node, level) {
    const hasChildren = node.children && node.children.length > 0;
    const toggle = hasChildren
      ? `<button class="tree-toggle" type="button" data-tree-toggle="${esc(node.id)}" aria-expanded="${node.expanded ? 'true' : 'false'}" aria-label="${node.expanded ? '收起' : '展开'}">${icon('chevron-right')}</button>`
      : '<span class="tree-toggle placeholder"></span>';
    const indent = level === 1 ? 'indent-1' : level === 2 ? 'indent-2' : '';
    const kindClass = node.type === 'req' ? 'req' : node.type === 'case' ? 'case' : 'wi';
    const resultCell = node.type === 'case' ? resultTag(node.result) : esc(node.result || '—');
    const defectCell = node.defect && node.defect !== '—'
      ? (node.type === 'case'
        ? `<button class="link-btn" type="button" data-open-bug="${esc(node.defect)}">${esc(node.defect)}</button>`
        : `<span>${esc(node.defect)}</span>`)
      : '<span class="muted">—</span>';
    const action = node.type === 'case'
      ? `<button class="link-btn" type="button" data-open-case="${esc(node.caseId)}">打开${icon('arrow-right')}</button>`
      : node.type === 'req'
        ? `<button class="link-btn" type="button" data-view="demand">查看${icon('arrow-right')}</button>`
        : node.ref !== '—'
          ? `<button class="link-btn" type="button" data-open-workitem="${esc(node.ref)}">查看${icon('arrow-right')}</button>`
          : '<span class="muted">—</span>';
    const coverage = node.type === 'case'
      ? `<span class="tag ${node.coverage === '需求级' ? 'blue' : 'green'}">${esc(node.coverage)}</span>`
      : coverageTag(node.coverage);
    const risk = node.risk && node.risk !== '—'
      ? `<span class="tag ${node.riskTone}">${esc(node.risk)}</span>`
      : '<span class="muted">—</span>';

    let html = `
      <div class="tree-row ${node.type}" data-node="${esc(node.id)}">
        <div class="tree-name ${indent}">
          ${toggle}
          <span class="tree-kind ${kindClass}">${esc(node.kind)}</span>
          ${node.ref && node.ref !== '—' ? `<span class="tree-id">${esc(node.ref)}</span>` : ''}
          <span class="tree-title">${esc(node.title)}</span>
        </div>
        <span class="tree-cell">${esc(node.cases || '—')}</span>
        <span class="tree-cell text">${coverage}</span>
        <span class="tree-cell text">${resultCell}</span>
        <span class="tree-cell text">${defectCell}</span>
        <span class="tree-cell text">${risk}</span>
        <span class="tree-actions">${action}</span>
      </div>`;
    if (hasChildren && node.expanded) {
      html += node.children.map((c) => renderTreeNode(c, level + 1)).join('');
    }
    return html;
  }

  function toggleTreeNode(id) {
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.id === id) { n.expanded = !n.expanded; return true; }
        if (n.children && walk(n.children)) return true;
      }
      return false;
    };
    if (walk(MATRIX)) renderMatrix();
  }

  // ---------- 计划详情 ----------
  function renderPlanScreen() {
    const metrics = [
      { label: '用例总数', value: '19', sub: '3 个需求' },
      { label: '已执行', value: '17', sub: '执行率 89%' },
      { label: '通过', value: '14', sub: '通过率 82%', tone: 'success' },
      { label: '失败', value: '2', sub: '待复测 2 条', tone: 'danger' },
      { label: '阻塞', value: '1', sub: '性能环境', tone: 'warn' },
      { label: '未执行', value: '2', sub: '发布前需覆盖', tone: 'warn' }
    ];
    $('#planMetrics').innerHTML = metrics.map((m) => `
      <div class="metric"><span>${esc(m.label)}</span><b class="${m.tone || ''}">${esc(m.value)}</b><small>${esc(m.sub)}</small></div>`).join('');

    const chips = [
      { title: '对账中心支持按项目批量导出', id: 'REQ-2026-018', cases: 7, pass: 4, fail: 1, block: 1, untested: 1, tone: 'red', cov: '工作项级 80%' },
      { title: '支付结果页支持按渠道筛选', id: 'REQ-2026-011', cases: 5, pass: 5, fail: 0, block: 0, untested: 0, tone: 'green', cov: '工作项级 100%' },
      { title: '退款回调幂等校验', id: 'REQ-2026-009', cases: 7, pass: 5, fail: 1, block: 0, untested: 1, tone: 'amber', cov: '工作项级 100%' }
    ];
    $('#planDemandChips').innerHTML = `<div class="demand-chip-grid">${chips.map((c) => `
      <div class="demand-chip">
        <div class="demand-chip-top"><span class="mono">${esc(c.id)}</span><span class="tag ${c.tone}"><i class="dot"></i>${c.cases} 条</span></div>
        <b>${esc(c.title)}</b>
        <div class="demand-chip-stats"><span class="st-pass">通过 <b>${c.pass}</b></span><span class="st-fail">失败 <b>${c.fail}</b></span><span class="st-block">阻塞 <b>${c.block}</b></span><span class="st-untested">未执行 <b>${c.untested}</b></span></div>
        <div class="demand-chip-foot"><span class="tag gray">${esc(c.cov)}</span><button class="link-btn" type="button" data-view="matrix">看覆盖${icon('arrow-right')}</button></div>
      </div>`).join('')}</div>`;

    renderPlanTable();
  }

  function renderPlanTable() {
    const body = $('#planTableBody');
    if (!body) return;
    body.innerHTML = DATA.planRows.map((r) => {
      const wi = r.wis.length
        ? r.wis.map((id) => `<button class="case-chip" type="button" data-open-workitem="${esc(id)}">${esc(id)}</button>`).join('')
        : '<span class="tag blue">需求级</span>';
      const defect = r.defect
        ? `<button class="link-btn" type="button" data-open-bug="${esc(r.defect)}">${esc(r.defect)}</button>`
        : '<span class="muted">—</span>';
      return `<tr class="row-link" data-open-case="${esc(r.id)}" data-demand="${esc(r.demandId)}" data-result="${esc(r.result)}" data-title="${esc(r.title)}" data-executor="${esc(r.executor)}">
        <td><div class="cell-title"><span class="mono">${esc(r.id)}</span><b>${esc(r.title)}</b></div></td>
        <td><span style="font-size:10px;color:var(--text-3)">${esc(r.demandTitle)}</span></td>
        <td><div class="case-chips">${wi}</div></td>
        <td>${priTag(r.pri)}</td>
        <td>${person(r.executor)}</td>
        <td>${resultTag(r.result)}</td>
        <td><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">${defect}<span class="mono" style="font-size:9px;color:var(--text-3)">${esc(r.at)}</span></div></td>
      </tr>`;
    }).join('');
    applyPlanFilters();
  }

  function applyPlanFilters() {
    const demand = $('#planDemandFilter')?.value || 'all';
    const result = $('#planResultFilter')?.value || 'all';
    const q = ($('[data-plan-search]')?.value || '').trim().toLowerCase();
    let count = 0;
    $$('#planTableBody tr').forEach((tr) => {
      const ok = (demand === 'all' || tr.dataset.demand === demand)
        && (result === 'all' || tr.dataset.result === result)
        && (!q || tr.dataset.title.toLowerCase().includes(q));
      tr.hidden = !ok;
      if (ok) count++;
    });
    const counter = $('#planTableCount');
    if (counter) counter.textContent = `显示 ${count} / 19`;
  }

  // ---------- 版本交付 ----------
  function renderVersionScreen() {
    const metrics = [
      { label: '需求', value: '12', sub: '已覆盖 10 · 83%' },
      { label: '工作项', value: '38', sub: '完成 29 · 76%' },
      { label: '用例', value: '48', sub: '通过 41 · 85%' },
      { label: '缺陷', value: '6', sub: '未关闭 2', tone: 'warn' }
    ];
    $('#versionMetrics').innerHTML = metrics.map((m) => `
      <div class="metric"><span>${esc(m.label)}</span><b class="${m.tone || ''}">${esc(m.value)}</b><small>${esc(m.sub)}</small></div>`).join('');

    $('#versionDemandBody').innerHTML = DATA.versionDemands.map((d) => `
      <tr>
        <td><div class="cell-title"><span class="mono">${esc(d.id)}</span><b>${esc(d.title)}</b></div></td>
        <td><span class="mono">${esc(d.wis)}</span></td>
        <td><span class="mono">${esc(d.cases)}</span></td>
        <td>${d.openDefects ? `<span class="tag red">${d.openDefects}</span>` : '<span class="muted">0</span>'}</td>
        <td>${coverageTag(d.coverage)}</td>
        <td><span class="tag ${d.tone}"><i class="dot"></i>${esc(d.conclusion)}</span></td>
        <td><button class="link-btn" type="button" data-view="demand">查看链路${icon('arrow-right')}</button></td>
      </tr>`).join('');

    $('#versionCheckList').innerHTML = DATA.versionChecks.slice(0, 4).map((c) => `
      <div class="check-item">
        <span class="check-ico red">${icon('alert')}</span>
        <span class="k"><b>${esc(c.title)}</b><span>${esc(c.desc)}</span></span>
      </div>`).join('') + `<div class="check-item"><span class="check-ico amber">${icon('clock')}</span><span class="k"><b>另有 1 个阻断、3 个提醒</b><span>打开发布检查查看完整清单</span></span></div>`;

    const timeline = [
      { tone: 'amber', title: '支付网关 v2.2', meta: '计划 11-22 · RP-2026-024 · 待检查', tag: '待发布', tagTone: 'amber', action: '发起检查', attrs: 'data-open-release-check="version"' },
      { tone: 'green', title: '支付网关 v2.1', meta: '11-08 22:10 · 张伟 · 通过率 95.2%', tag: '已发布', tagTone: 'green', action: '查看快照', attrs: 'data-open-snapshot="REL-2026-1108"' },
      { tone: 'green', title: '支付网关 v2.0', meta: '10-24 21:40 · 张伟 · 通过率 92.8%', tag: '已发布', tagTone: 'green', action: '查看快照', attrs: 'data-open-snapshot="REL-2026-1024"' }
    ];
    $('#releaseTimeline').innerHTML = timeline.map((t) => `
      <div class="tl-item">
        <span class="tl-dot ${t.tone}"></span>
        <div class="tl-main">
          <b>${esc(t.title)}<span class="mono">${esc(t.tag)}</span></b>
          <p>${esc(t.meta)}</p>
        </div>
        <div class="tl-meta"><span class="tag ${t.tagTone}"><i class="dot"></i>${esc(t.tag)}</span><br><button class="link-btn" type="button" ${t.attrs}>${esc(t.action)}${icon('arrow-right')}</button></div>
      </div>`).join('');
  }

  // ---------- 抽屉 ----------
  function openWorkItemDrawer(id) {
    const w = findWI(id);
    if (!w) return;
    const cases = w.cases.map(findCase).filter(Boolean);
    const caseRows = cases.length
      ? `<table class="mini-table">${cases.map((c) => `
          <tr>
            <td class="mini-main"><b>${esc(c.id)} · ${esc(c.title)}</b><span>${esc(c.pri)} · ${esc(c.plans.join(' / '))}</span></td>
            <td class="mini-side">${resultTag(c.result)}</td>
            <td class="mini-side"><button class="link-btn" type="button" data-open-case="${esc(c.id)}">打开${icon('arrow-right')}</button></td>
          </tr>`).join('')}</table>`
      : `<div class="empty-state"><b>还没有用例精确验证这个工作项</b>需求级已有 7 条用例，但都没有关联到 ${esc(w.id)}。这不会显示为“未覆盖需求”，只会形成工作项级覆盖缺口。<div class="drawer-actions" style="justify-content:center;margin-top:10px"><button class="btn sm" type="button" data-link-case="${esc(w.id)}">${icon('link')}关联用例</button><button class="btn sm" type="button" data-open-case="TC-0190">查看需求用例</button></div></div>`;

    const html = `
      <div class="drawer-header">
        <div class="drawer-header-main">
          <div class="drawer-kicker"><span class="tag ${w.type === '用户故事' ? 'plum' : 'gray'}">${esc(w.type)}</span><span class="mono">${esc(w.id)}</span></div>
          <div class="drawer-title" id="drawerTitle">${esc(w.title)}</div>
          <div class="drawer-sub"><span class="tag ${w.tone}"><i class="dot"></i>${esc(w.status)}</span><span>${esc(DATA.demand.title)}</span><span class="sep">·</span><span>${esc(DATA.demand.version)}</span></div>
        </div>
        <button class="drawer-close" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="drawer-body">
        <section class="drawer-section">
          <h3>基本信息</h3>
          <div class="rel-grid">
            <div class="rel-row"><span class="k">所属需求</span><span class="v"><button class="link-btn" type="button" data-view="demand">${esc(DATA.demand.id)} · ${esc(DATA.demand.title)}</button></span></div>
            <div class="rel-row"><span class="k">负责人</span><span class="v">${person(w.owner)}</span></div>
            <div class="rel-row"><span class="k">目标版本</span><span class="v">${esc(DATA.demand.version)} · 待发布</span></div>
            <div class="rel-row"><span class="k">预计 / 实际</span><span class="v"><span class="mono">${esc(w.estimate)} / ${esc(w.actual)}</span></span></div>
            <div class="rel-row"><span class="k">当前覆盖</span><span class="v">${coverageTag(w.coverage)}<span class="muted">${esc(w.result)}</span></span></div>
          </div>
        </section>
        <section class="drawer-section">
          <h3>验证用例 <span style="letter-spacing:0;text-transform:none;font-weight:500;color:var(--text-3)">${cases.length} 条 · 同一用例可关联多个工作项</span></h3>
          ${caseRows}
          <div class="drawer-actions">
            <button class="btn sm" type="button" data-link-case="${esc(w.id)}">${icon('link')}关联用例</button>
            <button class="btn sm" type="button" data-view="matrix">在覆盖矩阵中查看${icon('arrow-right')}</button>
          </div>
        </section>
        <section class="drawer-section">
          <h3>发布</h3>
          <div class="drawer-callout">目标版本 <b>${esc(DATA.demand.version)}</b> 尚未发布。发布后，这里会显示所属发布记录和发布时的测试证据快照。</div>
        </section>
      </div>
      <div class="drawer-footer">
        <button class="btn" type="button" data-close>关闭</button>
        <button class="btn primary" type="button" data-open-workitem="${esc(w.id)}">打开工作项详情${icon('arrow-right')}</button>
      </div>`;
    openDrawer(html);
  }

  function openCaseDrawer(id) {
    const c = findCase(id);
    if (!c) return;
    const wis = c.wis.length
      ? c.wis.map((wid) => `<button class="case-chip" type="button" data-open-workitem="${esc(wid)}">${esc(wid)}</button>`).join('')
      : '<span class="tag blue">需求级</span><span class="muted">未关联工作项，只计入需求覆盖</span>';
    const defect = c.defect
      ? `<button class="link-btn" type="button" data-open-bug="${esc(c.defect)}">${esc(c.defect)}${icon('arrow-right')}</button>`
      : '<span class="muted">无</span>';
    const history = c.result === 'untested'
      ? '<div class="empty-state"><b>还没有执行记录</b>计划执行后会在这里显示每次执行的结果、执行人和备注。</div>'
      : `<table class="mini-table">
          <tr><td class="mini-main"><b>${esc(c.at)} · ${esc(c.executor)}</b><span>${esc(c.plans[0] || '单用例执行')} · ${c.result === 'failed' ? '失败备注：重试后仍返回 500' : c.result === 'blocked' ? '阻塞原因：性能环境未就绪' : '执行通过'}</span></td><td class="mini-side">${resultTag(c.result)}</td></tr>
          <tr><td class="mini-main"><b>11-15 10:20 · ${esc(c.executor)}</b><span>${esc(c.plans[0] || '单用例执行')} · 执行通过</span></td><td class="mini-side">${resultTag('passed')}</td></tr>
        </table>`;

    const html = `
      <div class="drawer-header">
        <div class="drawer-header-main">
          <div class="drawer-kicker"><span class="tag green">用例</span><span class="mono">${esc(c.id)}</span><span>${esc(c.pri)}</span></div>
          <div class="drawer-title" id="drawerTitle">${esc(c.title)}</div>
          <div class="drawer-sub">${resultTag(c.result)}<span>${esc(DATA.demand.title)}</span><span class="sep">·</span><span>${esc(c.plans.join(' / '))}</span></div>
        </div>
        <button class="drawer-close" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="drawer-body">
        <section class="drawer-section">
          <h3>关联关系</h3>
          <div class="rel-grid">
            <div class="rel-row"><span class="k">所属项目</span><span class="v">${esc(DATA.demand.project)}</span></div>
            <div class="rel-row"><span class="k">关联需求</span><span class="v"><button class="link-btn" type="button" data-view="demand">${esc(DATA.demand.id)} · ${esc(DATA.demand.title)}</button></span></div>
            <div class="rel-row"><span class="k">验证工作项</span><span class="v"><div class="case-chips">${wis}</div></span></div>
            <div class="rel-row"><span class="k">所属计划</span><span class="v">${c.plans.map((p) => `<button class="link-btn" type="button" data-view="plan">${esc(p)}${icon('arrow-right')}</button>`).join(' ')}</span></div>
            <div class="rel-row"><span class="k">最近缺陷</span><span class="v">${defect}</span></div>
          </div>
        </section>
        <section class="drawer-section">
          <h3>执行历史</h3>
          ${history}
        </section>
        <section class="drawer-section">
          <h3>口径说明</h3>
          <div class="drawer-callout">用例主关联是<b>需求</b>。工作项关联是可选的精确关系，用来回答“这个工作项由哪条用例验证”；没有关联工作项时，只计入需求级覆盖，不会显示为未覆盖。</div>
        </section>
      </div>
      <div class="drawer-footer">
        <button class="btn" type="button" data-close>关闭</button>
        <button class="btn" type="button" data-link-case="${esc(c.wis[0] || 'HG-2420')}">${icon('link')}编辑工作项关联</button>
        <button class="btn primary" type="button">去执行${icon('play')}</button>
      </div>`;
    openDrawer(html);
  }

  function openBugDrawer(id) {
    const b = findBug(id);
    if (!b) return;
    const html = `
      <div class="drawer-header">
        <div class="drawer-header-main">
          <div class="drawer-kicker"><span class="tag red">缺陷</span><span class="mono">${esc(b.id)}</span><span>${esc(b.pri)}</span></div>
          <div class="drawer-title" id="drawerTitle">${esc(b.title)}</div>
          <div class="drawer-sub"><span class="tag ${b.tone}"><i class="dot"></i>${esc(b.status)}</span><span>${esc(DATA.demand.title)}</span><span class="sep">·</span><span>${esc(DATA.demand.version)}</span></div>
        </div>
        <button class="drawer-close" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="drawer-body">
        <section class="drawer-section">
          <h3>来源与归属</h3>
          <div class="rel-grid">
            <div class="rel-row"><span class="k">所属需求</span><span class="v"><button class="link-btn" type="button" data-view="demand">${esc(DATA.demand.id)} · ${esc(DATA.demand.title)}</button></span></div>
            <div class="rel-row"><span class="k">来源用例</span><span class="v"><button class="link-btn" type="button" data-open-case="${esc(b.source)}">${esc(b.source)}${icon('arrow-right')}</button></span></div>
            <div class="rel-row"><span class="k">来源执行</span><span class="v"><span class="mono">${b.id === 'BUG-0915' ? '11-16 16:05 · TP-009' : b.id === 'BUG-0912' ? '11-16 15:40 · TP-009' : '11-16 15:10 · TP-009'}</span></span></div>
            <div class="rel-row"><span class="k">负责人</span><span class="v">${person(b.owner)}</span></div>
            <div class="rel-row"><span class="k">创建时间</span><span class="v"><span class="mono">${esc(b.createdAt)}</span></span></div>
          </div>
        </section>
        <section class="drawer-section">
          <h3>失败备注</h3>
          <div class="drawer-callout warn">${b.id === 'BUG-0915' ? '10 万行导出耗时 42 秒，超过 30 秒阈值；性能环境未就绪，阻塞用例 TC-0188。' : b.id === 'BUG-0912' ? '导出失败后重试仍返回 500，需要确认重试幂等和错误码映射；已修复待验证。' : '导出审计日志缺少操作人字段，已修复并关闭。'}</div>
        </section>
        <section class="drawer-section">
          <h3>反向追溯</h3>
          <div class="drawer-callout">缺陷通过执行记录反查来源用例，不需要在缺陷上新增字段。这样可以回答“这个缺陷是哪条用例、哪次执行发现的”。</div>
        </section>
      </div>
      <div class="drawer-footer">
        <button class="btn" type="button" data-close>关闭</button>
        <button class="btn primary" type="button" data-open-case="${esc(b.source)}">查看来源用例${icon('arrow-right')}</button>
      </div>`;
    openDrawer(html);
  }

  function openReleaseSnapshot(id) {
    const r = DATA.releases.find((x) => x.id === id) || DATA.releases[0];
    const demandRows = r.demands.map((d) => `
      <tr><td><b>${esc(d.title)}</b></td><td><span class="mono">${d.wis}</span></td><td><span class="mono">${d.cases}</span></td><td>${esc(d.result)}</td><td><span class="tag green">${esc(d.note)}</span></td></tr>`).join('');
    const html = `
      <div class="drawer-header">
        <div class="drawer-header-main">
          <div class="drawer-kicker"><span class="tag green">发布快照</span><span class="mono">${esc(r.id)}</span></div>
          <div class="drawer-title" id="drawerTitle">${esc(r.version)}</div>
          <div class="drawer-sub"><span class="tag green"><i class="dot"></i>${esc(r.result)}</span><span>${esc(r.at)}</span><span class="sep">·</span><span>发布人 ${esc(r.by)}</span></div>
        </div>
        <button class="drawer-close" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="drawer-body">
        <section class="drawer-section">
          <div class="drawer-callout">证据冻结于 <b>${esc(r.at)}</b>。后续用例修改、计划调整都不会影响这条发布记录。</div>
        </section>
        <section class="drawer-section">
          <h3>发布信息</h3>
          <div class="rel-grid">
            <div class="rel-row"><span class="k">发布单</span><span class="v mono">${esc(r.id)}</span></div>
            <div class="rel-row"><span class="k">环境 / 结果</span><span class="v">${esc(r.env)} · ${esc(r.result)}</span></div>
            <div class="rel-row"><span class="k">发布时间</span><span class="v mono">${esc(r.at)}</span></div>
            <div class="rel-row"><span class="k">发布人</span><span class="v">${esc(r.by)}</span></div>
            <div class="rel-row"><span class="k">提交</span><span class="v mono">${esc(r.commit)}</span></div>
          </div>
        </section>
        <section class="drawer-section">
          <h3>测试证据</h3>
          <div class="metric-grid four" style="margin-bottom:8px">
            <div class="metric"><span>用例</span><b>${r.cases}</b><small>通过 ${r.passed}</small></div>
            <div class="metric"><span>通过率</span><b class="success">${esc(r.passRate)}</b><small>失败 ${r.failed} · 阻塞 ${r.blocked}</small></div>
            <div class="metric"><span>未执行</span><b>${r.untested}</b><small>发布时保留</small></div>
            <div class="metric"><span>未关闭缺陷</span><b>${r.openDefects}</b><small>已修复 ${r.fixedDefects}</small></div>
          </div>
          <div class="rel-row" style="border:1px solid var(--border);border-radius:8px;grid-template-columns:108px 1fr"><span class="k">测试计划</span><span class="v">${r.plans.map((p) => `<span class="tag gray mono">${esc(p)}</span>`).join(' ')}</span></div>
        </section>
        <section class="drawer-section">
          <h3>需求快照</h3>
          <table class="mini-table release-demand-table">
            <thead><tr><th>需求</th><th>工作项</th><th>用例</th><th>结果</th><th>备注</th></tr></thead>
            <tbody>${demandRows}</tbody>
          </table>
        </section>
      </div>
      <div class="drawer-footer"><button class="btn" type="button" data-close>关闭</button></div>`;
    openDrawer(html);
  }

  // ---------- 弹窗：发布检查 ----------
  function openReleaseCheck(context) {
    const isDemand = context === 'demand';
    const title = isDemand ? '发布检查 · 对账导出' : '发布检查 · 支付网关 v2.2';
    const blockers = isDemand
      ? [
          { title: 'TC-0189 失败未复测', desc: '最近一次执行 11-16 15:40；BUG-0912 已修复待验证', attrs: 'data-open-case="TC-0189"' },
          { title: 'TC-0188 阻塞未解除', desc: '性能环境未就绪；BUG-0915 处理中', attrs: 'data-open-bug="BUG-0915"' },
          { title: 'HG-2420 工作项未完成', desc: '导出失败重试与审计日志；任务仍在进行中', attrs: 'data-open-workitem="HG-2420"' },
          { title: 'BUG-0915 未关闭', desc: '10 万行导出超过 30 秒；处理中', attrs: 'data-open-bug="BUG-0915"' }
        ]
      : [
          { title: 'TC-0189 失败未复测', desc: '对账导出 · P1 · 最近执行 11-16 15:40', attrs: 'data-open-case="TC-0189"' },
          { title: 'TC-0188 阻塞未解除', desc: '性能环境未就绪 · BUG-0915 处理中', attrs: 'data-open-bug="BUG-0915"' },
          { title: 'BUG-0915 未关闭', desc: '10 万行导出超过 30 秒 · 李娜', attrs: 'data-open-bug="BUG-0915"' },
          { title: 'HG-2420 工作项未完成', desc: '导出失败重试与审计日志 · 王强', attrs: 'data-open-workitem="HG-2420"' },
          { title: 'TC-0152 退款回调失败', desc: '退款回调幂等校验 · BUG-0918 未关闭', attrs: 'data-open-case="TC-0152"' }
        ];
    const reminders = [
      { title: 'HG-2422 没有精确关联用例', desc: '需求级已有 7 条用例；建议补 1 条工作项级用例', attrs: 'data-open-workitem="HG-2422"' },
      { title: 'TC-0191 权限隔离未执行', desc: 'P1 用例 · 发布前应覆盖', attrs: 'data-open-case="TC-0191"' },
      { title: 'TP-010 对账导出专项仍是草稿', desc: '7 条用例已圈选，尚未开始执行', attrs: 'data-view="plan"' }
    ];
    const group = (label, items, tone) => `
      <div class="check-group">
        <h4>${esc(label)} · ${items.length}</h4>
        ${items.map((i) => `
          <div class="check-item">
            <span class="check-ico ${tone}">${icon(tone === 'red' ? 'alert' : 'clock')}</span>
            <span class="k"><b>${esc(i.title)}</b><span>${esc(i.desc)}</span></span>
            <button class="link-btn" type="button" ${i.attrs}>去处理${icon('arrow-right')}</button>
          </div>`).join('')}
      </div>`;

    openModal(`
      <div class="modal-header">
        <div class="modal-header-main">
          <div class="modal-title" id="modalTitle">${esc(title)}</div>
          <div class="modal-sub">${isDemand ? '本需求 4 个阻断 · 3 个提醒。' : '版本整体 5 个阻断 · 3 个提醒。'}可以带风险发布，但需要填写原因并留痕。</div>
        </div>
        <button class="drawer-close" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <div class="check-summary">
          <div class="check-num"><b>${blockers.length}</b><span>阻断</span></div>
          <div class="check-num amber"><b>${reminders.length}</b><span>提醒</span></div>
          <div class="check-num green"><b>${isDemand ? '4/7' : '41/48'}</b><span>${isDemand ? '本需求通过' : '版本通过'}</span></div>
        </div>
        <div style="margin-top:12px">${group('阻断项', blockers, 'red')}${group('提醒项', reminders, 'amber')}</div>
        <label class="reason-label" for="riskReason">带风险发布原因（必填）</label>
        <textarea class="textarea" id="riskReason" placeholder="例如：性能环境明天恢复，先发布主流程；TC-0188 和 BUG-0915 在 11-23 前补齐复测，失败则回滚。"></textarea>
        <div class="reason-hint"><span>原因会写入发布记录，并和测试证据一起冻结。</span><span id="reasonCount">0 / 200</span></div>
      </div>
      <div class="modal-footer">
        <button class="btn ghost" type="button" data-copy-check>复制检查结果</button>
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn danger" type="button" id="riskSubmit" disabled>带风险发布</button>
      </div>`);
    const reason = $('#riskReason');
    const submit = $('#riskSubmit');
    const count = $('#reasonCount');
    reason.addEventListener('input', () => {
      const n = reason.value.trim().length;
      submit.disabled = n === 0;
      count.textContent = `${n} / 200`;
    });
    reason.focus();
    $('[data-copy-check]')?.addEventListener('click', () => {
      showToast('检查结果已复制（原型示例）');
    });
    submit.addEventListener('click', () => {
      closeModal();
      showToast('已记录带风险发布原因；发布后将冻结当前测试证据。');
    });
  }

  // ---------- 弹窗：按需求添加用例 ----------
  function openAddCasesModal() {
    const rows = [
      { title: '对账中心支持按项目批量导出', id: 'REQ-2026-018', count: 7, added: true },
      { title: '支付结果页支持按渠道筛选', id: 'REQ-2026-011', count: 5, added: true },
      { title: '退款回调幂等校验', id: 'REQ-2026-009', count: 7, added: true },
      { title: '支付回调重试策略', id: 'REQ-2026-003', count: 3, added: false }
    ];
    openModal(`
      <div class="modal-header">
        <div class="modal-header-main">
          <div class="modal-title" id="modalTitle">按需求添加用例</div>
          <div class="modal-sub">选择需求后，自动带入该需求下的全部用例。计划只引用用例，不绑定单个需求。</div>
        </div>
        <button class="drawer-close" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <div class="modal-list">
          ${rows.map((r) => `
            <label class="check-row ${r.added ? 'disabled' : ''}">
              <input type="checkbox" class="checkbox" data-add-demand="${esc(r.id)}" ${r.added ? 'checked disabled' : ''}>
              <span class="check-row-main"><b>${esc(r.title)}</b><span>${esc(r.id)} · ${r.count} 条用例</span></span>
              <span class="tag ${r.added ? 'gray' : 'blue'}">${r.added ? '已在计划' : '可加入'}</span>
            </label>`).join('')}
        </div>
        <div class="drawer-callout" style="margin-top:10px">需求范围由“计划 → 用例 → 需求”自动派生；如果某个需求还没有用例，它不会出现在计划范围里，但会在覆盖矩阵里显示为未覆盖。</div>
      </div>
      <div class="modal-footer">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn primary" type="button" id="addCasesSubmit" disabled>加入计划</button>
      </div>`);
    const submit = $('#addCasesSubmit');
    $$('[data-add-demand]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const checked = $$('[data-add-demand]:not(:disabled)').some((x) => x.checked);
        submit.disabled = !checked;
      });
    });
    submit.addEventListener('click', () => {
      closeModal();
      showToast('已加入 3 条用例（按需求：支付回调重试策略）。');
    });
  }

  // ---------- 弹窗：关联用例 ----------
  function openLinkCaseModal(workItemId) {
    const w = findWI(workItemId);
    const linked = new Set(w ? w.cases : []);
    openModal(`
      <div class="modal-header">
        <div class="modal-header-main">
          <div class="modal-title" id="modalTitle">关联用例 · ${esc(workItemId)}</div>
          <div class="modal-sub">只显示同一需求下的用例。一个用例可以关联多个工作项；不关联时只计入需求级覆盖。</div>
        </div>
        <button class="drawer-close" type="button" data-close aria-label="关闭">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <div class="modal-list">
          ${DATA.cases.map((c) => `
            <label class="check-row">
              <input type="checkbox" class="checkbox" data-link-case-item="${esc(c.id)}" ${linked.has(c.id) ? 'checked' : ''}>
              <span class="check-row-main"><b>${esc(c.id)} · ${esc(c.title)}</b><span>${esc(c.pri)} · ${esc(c.cov)} · ${resultTag(c.result)}</span></span>
            </label>`).join('')}
        </div>
        <div class="drawer-callout warn" style="margin-top:10px">工时和状态不会被本次关联改变；关联只影响“工作项 → 用例”的追溯和覆盖口径。</div>
      </div>
      <div class="modal-footer">
        <button class="btn" type="button" data-close>取消</button>
        <button class="btn primary" type="button" id="linkSubmit">保存关联</button>
      </div>`);
    $('#linkSubmit')?.addEventListener('click', () => {
      closeModal();
      showToast('已更新工作项与用例的关联（原型示例）。');
    });
  }

  // ---------- 覆盖层控制 ----------
  const scrim = $('#scrim');
  const drawer = $('#drawer');
  const modalWrap = $('#modalWrap');
  const modal = $('#modal');
  const toast = $('#toast');
  let toastTimer = null;

  function syncScrim() {
    scrim.hidden = drawer.hidden && modalWrap.hidden;
  }

  function openDrawer(html) {
    drawer.innerHTML = html;
    drawer.hidden = false;
    void drawer.offsetWidth;
    drawer.classList.add('open');
    scrim.hidden = false;
    const closeBtn = drawer.querySelector('[data-close]');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    setTimeout(() => {
      drawer.hidden = true;
      syncScrim();
    }, 190);
  }

  function openModal(html) {
    modal.innerHTML = html;
    modalWrap.hidden = false;
    scrim.hidden = false;
  }

  function closeModal() {
    modalWrap.hidden = true;
    syncScrim();
  }

  function closeTopOverlay() {
    if (!modalWrap.hidden) closeModal();
    else if (!drawer.hidden) closeDrawer();
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 200);
    }, 2800);
  }

  scrim.addEventListener('click', closeTopOverlay);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTopOverlay();
  });

  // ---------- 视图切换 ----------
  const CRUMBS = {
    demand: '<b>需求池</b><svg class="ic"><use href="#i-chevron-right"></use></svg><span>REQ-2026-018</span>',
    matrix: '<b>测试</b><svg class="ic"><use href="#i-chevron-right"></use></svg><span>覆盖矩阵</span>',
    plan: '<b>测试</b><svg class="ic"><use href="#i-chevron-right"></use></svg><b>测试计划</b><svg class="ic"><use href="#i-chevron-right"></use></svg><span>TP-009</span>',
    version: '<b>版本</b><svg class="ic"><use href="#i-chevron-right"></use></svg><span>支付网关 v2.2</span>'
  };
  const NAV_MAP = { demand: 'demand', matrix: 'test', plan: 'test', version: 'version' };
  const NEW_LABEL = { demand: '新建需求', matrix: '新建用例', plan: '新建计划', version: '新建版本' };

  function switchView(view, scroll = true) {
    const target = $(`.screen[data-screen="${view}"]`);
    if (!target) return;
    $$('.screen').forEach((s) => { s.hidden = s !== target; });
    $$('.proto-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $$('.nav-item').forEach((b) => b.classList.remove('on'));
    const nav = $(`.nav-item[data-nav="${NAV_MAP[view]}"]`);
    if (nav) nav.classList.add('on');
    const crumbs = $('#crumbs');
    if (crumbs) crumbs.innerHTML = CRUMBS[view] || CRUMBS.demand;
    const newBtn = $('.topbar .btn.primary');
    if (newBtn) newBtn.innerHTML = `${icon('plus')}${NEW_LABEL[view] || '新建'}`;
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- 事件委托 ----------
  document.addEventListener('click', (e) => {
    const nearest = e.target.closest('[data-open-case],[data-open-workitem],[data-open-bug],[data-open-release-check],[data-open-snapshot],[data-open-add-cases],[data-link-case]');
    if (nearest) {
      if (nearest.dataset.openCase) { openCaseDrawer(nearest.dataset.openCase); return; }
      if (nearest.dataset.openWorkitem) { openWorkItemDrawer(nearest.dataset.openWorkitem); return; }
      if (nearest.dataset.openBug) { openBugDrawer(nearest.dataset.openBug); return; }
      if (nearest.dataset.openReleaseCheck) { openReleaseCheck(nearest.dataset.openReleaseCheck); return; }
      if (nearest.dataset.openSnapshot) { openReleaseSnapshot(nearest.dataset.openSnapshot); return; }
      if (nearest.dataset.openAddCases !== undefined) { openAddCasesModal(); return; }
      if (nearest.dataset.linkCase) { openLinkCaseModal(nearest.dataset.linkCase); return; }
    }

    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn) {
      if (!modalWrap.hidden) closeModal();
      if (!drawer.hidden) closeDrawer();
      switchView(viewBtn.dataset.view);
      return;
    }

    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      const nav = navBtn.dataset.nav;
      if (nav === 'demand') switchView('demand');
      else if (nav === 'test') switchView('matrix');
      else if (nav === 'version') switchView('version');
      return;
    }

    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { closeTopOverlay(); return; }

    const scrollBtn = e.target.closest('[data-scroll]');
    if (scrollBtn) {
      const el = document.getElementById(scrollBtn.dataset.scroll);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const treeBtn = e.target.closest('[data-tree-toggle]');
    if (treeBtn) { toggleTreeNode(treeBtn.dataset.treeToggle); return; }

    const riskBtn = e.target.closest('[data-risk-more]');
    if (riskBtn) { toggleRiskList(riskBtn); return; }

    const caseFilter = e.target.closest('[data-case-filter]');
    if (caseFilter) { setCaseFilter(caseFilter.dataset.caseFilter); return; }
  });

  // ---------- 筛选 ----------
  $('#planDemandFilter')?.addEventListener('change', applyPlanFilters);
  $('#planResultFilter')?.addEventListener('change', applyPlanFilters);
  $('[data-plan-search]')?.addEventListener('input', applyPlanFilters);
  $('[data-matrix-search]')?.addEventListener('input', (e) => {
    matrixQuery = e.target.value.trim().toLowerCase();
    renderMatrix();
  });

  // ---------- URL 参数：便于截图和分享 ----------
  function initFromQuery() {
    const params = new URLSearchParams(location.search);
    const view = params.get('view') || 'demand';
    switchView(view, false);
    const overlay = params.get('overlay');
    if (!overlay) return;
    setTimeout(() => {
      if (overlay === 'workitem') openWorkItemDrawer('HG-2420');
      else if (overlay === 'case') openCaseDrawer('TC-0189');
      else if (overlay === 'bug') openBugDrawer('BUG-0915');
      else if (overlay === 'release-check') openReleaseCheck('version');
      else if (overlay === 'release-check-demand') openReleaseCheck('demand');
      else if (overlay === 'snapshot') openReleaseSnapshot('REL-2026-1108');
      else if (overlay === 'add-cases') openAddCasesModal();
      else if (overlay === 'link-case') openLinkCaseModal('HG-2420');
    }, 60);
  }

  // ---------- 初始化 ----------
  renderChain();
  renderRisks();
  renderWorkItems();
  renderCases();
  renderPlans();
  renderDefects();
  renderRelease();
  renderRail();
  renderMatrix();
  renderPlanScreen();
  renderVersionScreen();
  initFromQuery();

  // 暴露少量方法，便于手动调试
  window.__proto = {
    switchView,
    openWorkItemDrawer,
    openCaseDrawer,
    openBugDrawer,
    openReleaseCheck,
    openReleaseSnapshot,
    openAddCasesModal
  };
})();
