/* 甘特图真浏览器回归（agent-browser 驱动 Chrome，不依赖后端）
   用法：node tools/shots/check-gantt.mjs
   覆盖：工具栏在 1280/1440 内、sticky 表头/左列、月视图翻月与裁切、筛选/分组/折叠、
        拖动保存参数、失败恢复、Esc 无请求、撤销只改日期、未排期拖入、键盘可达、无 JS 异常。 */
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREVIEW = pathToFileURL(path.join(ROOT, 'docs/preview/ui-preview.html')).href + '#/gantt'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findBrowserCli() {
  if (process.env.AGENT_BROWSER_BIN && fs.existsSync(process.env.AGENT_BROWSER_BIN)) return process.env.AGENT_BROWSER_BIN
  try {
    const first = execSync('where agent-browser', { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    const modBin = path.join(path.dirname(first), 'node_modules', 'agent-browser', 'bin')
    const exe = process.platform === 'win32'
      ? path.join(modBin, 'agent-browser-win32-x64.exe')
      : path.join(modBin, 'agent-browser-linux-x64')
    return fs.existsSync(exe) ? exe : first
  } catch (e) {
    return 'agent-browser'
  }
}
const AB = findBrowserCli()

function ab(args, timeout = 120000) {
  const outFile = path.join(os.tmpdir(), `gantt-check-${process.pid}-${Math.random().toString(36).slice(2)}.log`)
  const fd = fs.openSync(outFile, 'w')
  const r = spawnSync(AB, args, { timeout, stdio: ['ignore', fd, 'ignore'] })
  fs.closeSync(fd)
  const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : ''
  try { fs.unlinkSync(outFile) } catch (e) { /* noop */ }
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`agent-browser ${args[0]} 失败（${r.status}）：${out}`)
  return out
}
function js(code) {
  const out = ab(['eval', '--json', code])
  const data = JSON.parse(out)
  if (!data.success) throw new Error(String(data.error))
  return data.data.result
}

async function fresh(width, height) {
  ab(['close', '--all'])
  ab(['set', 'viewport', String(width), String(height)])
  ab(['open', PREVIEW])
  await sleep(500)
  js('localStorage.clear()')
  ab(['reload'])
  await sleep(900)
  for (let i = 0; i < 40; i++) {
    if (js(`!!document.querySelector('.gantt-grid')`)) break
    await sleep(200)
  }
  await sleep(300)
}

const common = `
  window.__errs = window.__errs || [];
  window.addEventListener('error', e => window.__errs.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => window.__errs.push('unhandled: ' + String(e.reason)));
  const ptr = (el, type, x, y, id) => el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id || 21,
    pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1
  }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const visibleBars = () => [...document.querySelectorAll('[data-gantt-bar]')];
  const rawFetch = window.__rawFetch || (window.__rawFetch = window.fetch);
  const track = (on) => {
    window.__calls = [];
    window.fetch = on
      ? (u, o) => { window.__calls.push({ m: (o && o.method) || 'GET', u: String(u), b: o && o.body }); return rawFetch(u, o) }
      : (u, o) => { window.__calls.push({ m: (o && o.method) || 'GET', u: String(u), b: o && o.body }); return rawFetch(u, o) };
  };
  const puts = () => window.__calls.filter(c => c.m === 'PUT');
  const resetState = () => {
    document.querySelector('[data-gantt-range="auto"]').click();
    const g = document.getElementById('ganttGroup'); g.value = 'none'; g.dispatchEvent(new Event('change'));
    const sd = document.getElementById('ganttShowDone'); sd.checked = false; sd.dispatchEvent(new Event('change'));
    const z = document.getElementById('ganttZoom'); z.value = '28'; z.dispatchEvent(new Event('change'));
    if (!document.getElementById('ganttClearFilter').hidden) document.getElementById('ganttClearFilter').click();
  };
  const undoBtn = () => [...document.querySelectorAll('.toast .tact')].filter(b => b.textContent.trim() === '撤销').pop();
  const checks = [];
  const ok = (name, cond, extra) => checks.push({ name: name, pass: !!cond, extra: extra === undefined ? null : extra });
`

const phaseOne = `(async () => {
  ${common}
  resetState();
  await wait(300);
  const sc = document.getElementById('ganttScroll');
  const srect = sc.getBoundingClientRect();

  /* 1. 工具栏在视口内 */
  const controls = [...document.querySelectorAll('#view-gantt .page-toolbar button, #view-gantt .page-toolbar select, .gantt-tools button, .gantt-tools select')];
  const outside = controls.filter(el => {
    if (el.hidden || el.offsetWidth === 0 || el.offsetHeight === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width === 0 || r.height === 0 || r.left < -1 || r.right > innerWidth + 1 || r.top < -1;
  }).map(el => (el.id || el.textContent.trim()).slice(0, 20));
  ok('工具栏控件都在 1440 视口内', outside.length === 0, outside);
  ok('页面无横向溢出（1440）', document.documentElement.scrollWidth <= innerWidth + 1);

  /* 2. sticky 表头 / 左列 */
  const bars0 = visibleBars().length;
  sc.scrollLeft = 200; sc.scrollTop = 40;
  await wait(120);
  const sr2 = sc.getBoundingClientRect();
  const corner = document.querySelector('.gantt-corner').getBoundingClientRect();
  const label = document.querySelector('.gantt-row .gantt-label').getBoundingClientRect();
  const head = document.querySelector('.gantt-head').getBoundingClientRect();
  ok('表头 sticky 顶部', Math.abs(head.top - sr2.top) <= 2, { head: Math.round(head.top), scroll: Math.round(sr2.top) });
  ok('左列 sticky 到滚动区左边', Math.abs(label.left - sr2.left) <= 2 && Math.abs(corner.left - sr2.left) <= 2,
     { label: Math.round(label.left), corner: Math.round(corner.left), scroll: Math.round(sr2.left) });
  sc.scrollLeft = 0; sc.scrollTop = 0;

  /* 3. 月视图翻月与裁切 */
  const autoW = Math.round(document.querySelector('[data-gantt-bar="G1"]').getBoundingClientRect().width);
  document.querySelector('[data-gantt-range="month"]').click();
  await wait(150);
  const monthDays = document.querySelectorAll('.gantt-day').length;
  const octLabel = document.getElementById('ganttRangeLabel').textContent;
  const octW = Math.round(document.querySelector('[data-gantt-bar="G1"]').getBoundingClientRect().width);
  const octG5 = !!document.querySelector('[data-gantt-bar="G5"]');
  const octG3 = !!document.querySelector('[data-gantt-bar="G3"]');
  document.getElementById('ganttNextMonth').click();
  await wait(150);
  const novLabel = document.getElementById('ganttRangeLabel').textContent;
  const novW = Math.round(document.querySelector('[data-gantt-bar="G1"]') ? document.querySelector('[data-gantt-bar="G1"]').getBoundingClientRect().width : 0);
  ok('月视图 31 天', monthDays === 31, monthDays);
  ok('月标签正确', /年/.test(octLabel) && /月/.test(octLabel), octLabel);
  ok('跨月任务两个月都可见且裁切相加等于全长', octW > 0 && novW > 0 && Math.abs(octW + novW - autoW) <= 2, { autoW, octW, novW });
  ok('只有开始/只有截止的任务落对月份', octG5 && !octG3, { octG5, octG3 });
  document.getElementById('ganttPrevMonth').click();
  await wait(150);
  ok('上一月回到当月', document.getElementById('ganttRangeLabel').textContent === octLabel);
  document.getElementById('ganttNextMonth').click();
  document.getElementById('ganttNextMonth').click();
  await wait(150);
  ok('空月份提示正确', !!document.querySelector('.gantt-month-empty') && document.querySelector('.gantt-month-empty').textContent.indexOf('本月没有排期工作项') >= 0);
  ok('空月份不显示今天线', !document.querySelector('.gantt-today'));
  document.getElementById('ganttToday').click();
  await wait(200);
  ok('今天跳回当前月', document.getElementById('ganttRangeLabel').textContent === octLabel && !!document.querySelector('.gantt-today'));

  /* 4. 分组与折叠 */
  document.querySelector('[data-gantt-range="auto"]').click();
  await wait(150);
  const g = document.getElementById('ganttGroup');
  g.value = 'owner'; g.dispatchEvent(new Event('change'));
  await wait(150);
  const heads = [...document.querySelectorAll('.gantt-group-head')].map(h => h.textContent.trim());
  const rowsBefore = document.querySelectorAll('.gantt-row').length;
  document.querySelector('.gantt-group-head').click();
  await wait(150);
  const rowsAfter = document.querySelectorAll('.gantt-row').length;
  ok('按负责人分组出 3 组', heads.length === 3, heads);
  ok('折叠只减少显示行', rowsAfter < rowsBefore, { rowsBefore, rowsAfter });
  document.querySelector('.gantt-group-head').click();
  await wait(150);
  ok('展开恢复行数', document.querySelectorAll('.gantt-row').length === rowsBefore);
  g.value = 'none'; g.dispatchEvent(new Event('change'));
  await wait(150);

  /* 5. 筛选 */
  document.getElementById('ganttFilterBtn').click();
  await wait(100);
  track(true);
  window.__calls = [];
  const chip = [...document.querySelectorAll('#ganttFilterMenu [data-gantt-req]')].find(b => b.textContent.indexOf('流程引擎') >= 0);
  chip.click();
  await wait(250);
  window.fetch = rawFetch;
  const callsAfterFilter = window.__calls.slice();
  const filteredBars = visibleBars().length;
  const metaFiltered = document.getElementById('ganttMeta').textContent;
  ok('筛选请求带 reqs 且不带 doneScope', callsAfterFilter.some(c => c.u.indexOf('/api/tasks/list') >= 0 && c.u.indexOf('reqs=R1') >= 0 && c.u.indexOf('doneScope') < 0), callsAfterFilter.map(c => c.u));
  ok('筛选后任务变少', filteredBars > 0 && filteredBars < bars0, { before: bars0, after: filteredBars });
  ok('筛选计数与提示可见', document.getElementById('ganttFilterCount').textContent === '1' && metaFiltered.indexOf('已应用 1 项筛选') >= 0, metaFiltered);
  document.getElementById('ganttClearFilter').click();
  await wait(250);
  ok('清除筛选恢复任务数', visibleBars().length === bars0, visibleBars().length);

  /* 6. 拖动保存 + 撤销 */
  const barK1 = document.querySelector('[data-gantt-bar="K1"]');
  const k1Rect = barK1.getBoundingClientRect();
  track(true);
  ptr(barK1, 'pointerdown', k1Rect.left + k1Rect.width / 2, k1Rect.top + 12, 31);
  ptr(document, 'pointermove', k1Rect.left + k1Rect.width / 2 + 56, k1Rect.top + 12, 31);
  ptr(document, 'pointerup', k1Rect.left + k1Rect.width / 2 + 56, k1Rect.top + 12, 31);
  await wait(350);
  const firstPuts = puts().map(p => JSON.parse(p.b));
  window.fetch = rawFetch;
  ok('整体拖动只保存一次', firstPuts.length === 1, firstPuts.length);
  const p1 = firstPuts[0] || {};
  ok('拖动保存参数正确（日期 +2 天且全字段保留）', p1.startDate === '2026-10-29' && p1.dueDate === '2026-11-03' &&
     p1.reqId === 'R1' && p1.branchId === 'BR1' && Number(p1.estimateMinutes) === 480, { start: p1.startDate, due: p1.dueDate, req: p1.reqId, branch: p1.branchId, est: p1.estimateMinutes });
  const ub = undoBtn();
  ok('改期后出现撤销', !!ub);
  if (ub) {
    track(true); ub.click(); await wait(350); window.fetch = rawFetch;
    const undoPuts = puts().map(p => JSON.parse(p.b));
    const u = undoPuts[0] || {};
    ok('撤销只回退起止日期', undoPuts.length === 1 && u.startDate === '2026-10-27' && u.dueDate === '2026-11-01' &&
       u.reqId === 'R1' && u.branchId === 'BR1' && Number(u.estimateMinutes) === 480, undoPuts.map(x => ({ s: x.startDate, d: x.dueDate, req: x.reqId })));
  } else {
    ok('撤销只回退起止日期', false, '无撤销按钮');
  }

  /* 7. 左/右把手 */
  const k1b = document.querySelector('[data-gantt-bar="K1"]');
  const hR = k1b.querySelector('.gantt-handle.r');
  const hRect = hR.getBoundingClientRect();
  track(true);
  ptr(hR, 'pointerdown', hRect.left + 4, hRect.top + hRect.height / 2, 32);
  ptr(document, 'pointermove', hRect.left + 4 + 56, hRect.top + hRect.height / 2, 32);
  ptr(document, 'pointerup', hRect.left + 4 + 56, hRect.top + hRect.height / 2, 32);
  await wait(350); window.fetch = rawFetch;
  const rightPut = puts().map(p => JSON.parse(p.b))[0] || {};
  ok('右把手只改截止日期', rightPut.startDate === '2026-10-27' && rightPut.dueDate === '2026-11-03', { s: rightPut.startDate, d: rightPut.dueDate });
  if (undoBtn()) { undoBtn().click(); await wait(300); }

  /* 8. Esc 取消 */
  const k2 = document.querySelector('[data-gantt-bar="K2"]');
  const k2r = k2.getBoundingClientRect();
  const k2Left = Math.round(k2r.left);
  track(true);
  ptr(k2, 'pointerdown', k2r.left + k2r.width / 2, k2r.top + 12, 33);
  ptr(document, 'pointermove', k2r.left + k2r.width / 2 + 84, k2r.top + 12, 33);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(250);
  window.fetch = rawFetch;
  const k2After = document.querySelector('[data-gantt-bar="K2"]');
  ok('Esc 取消不发请求并恢复位置', puts().length === 0 && Math.abs(k2After.getBoundingClientRect().left - k2Left) <= 1 && !document.querySelector('.gantt-tip:not([hidden])'),
     { puts: puts().length, left: Math.round(k2After.getBoundingClientRect().left), before: k2Left });

  /* 9. 保存失败恢复 */
  const k1c = document.querySelector('[data-gantt-bar="K1"]');
  const k1cRect = k1c.getBoundingClientRect();
  const k1Left = Math.round(k1cRect.left);
  let failOnce = 0;
  window.fetch = (u, o) => {
    if (o && o.method === 'PUT') {
      failOnce++;
      return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ code: 500, message: '模拟保存失败' })) });
    }
    return rawFetch(u, o);
  };
  ptr(k1c, 'pointerdown', k1cRect.left + k1cRect.width / 2, k1cRect.top + 12, 34);
  ptr(document, 'pointermove', k1cRect.left + k1cRect.width / 2 + 56, k1cRect.top + 12, 34);
  ptr(document, 'pointerup', k1cRect.left + k1cRect.width / 2 + 56, k1cRect.top + 12, 34);
  await wait(450);
  window.fetch = rawFetch;
  const toastText = [...document.querySelectorAll('.toast .tmsg')].map(e => e.textContent.trim()).join('|');
  ok('保存失败提示并恢复服务器数据', failOnce === 1 && toastText.indexOf('调整失败') >= 0 && Math.abs(document.querySelector('[data-gantt-bar="K1"]').getBoundingClientRect().left - k1Left) <= 1,
     { failOnce, toastText });

  /* 10. 未排期拖入 */
  document.getElementById('ganttUnplannedBox').open = true;
  await wait(100);
  const row = document.querySelector('.gantt-unplanned-row[data-gantt-open="G6"]');
  const axis = document.querySelector('.gantt-axis').getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const scRect = sc.getBoundingClientRect();
  const tx = axis.left + 28 * 28 + 14, ty = scRect.top + 200;
  track(true);
  ptr(row, 'pointerdown', rr.left + 40, rr.top + 10, 35);
  ptr(document, 'pointermove', tx, ty, 35);
  ptr(document, 'pointerup', tx, ty, 35);
  await wait(400);
  window.fetch = rawFetch;
  const dropPuts = puts().map(p => JSON.parse(p.b));
  const d0 = dropPuts[0] || {};
  ok('未排期拖入只保存一次且起止同一天', dropPuts.length === 1 && d0.startDate && d0.startDate === d0.dueDate, dropPuts.map(x => ({ s: x.startDate, d: x.dueDate })));
  ok('未排期任务移出未排期区', document.getElementById('ganttUnplannedCount').textContent === '0' && !!document.querySelector('[data-gantt-bar="G6"]'));
  const ub2 = undoBtn();
  if (ub2) {
    track(true); ub2.click(); await wait(400); window.fetch = rawFetch;
    const u2 = (puts().map(p => JSON.parse(p.b))[0]) || {};
    ok('未排期撤销恢复为未排期', u2.startDate === null && u2.dueDate === null && document.getElementById('ganttUnplannedCount').textContent === '1',
       { s: u2.startDate, d: u2.dueDate, unplanned: document.getElementById('ganttUnplannedCount').textContent });
  } else {
    ok('未排期撤销恢复为未排期', false, '无撤销按钮');
  }

  /* 11. 键盘 + aria */
  const ariaBar = document.querySelector('[data-gantt-bar="K2"]');
  ok('甘特条可键盘聚焦且有 aria-label', ariaBar.getAttribute('tabindex') === '0' && ariaBar.getAttribute('role') === 'button' && /进度/.test(ariaBar.getAttribute('aria-label')), ariaBar.getAttribute('aria-label'));
  ariaBar.focus();
  ariaBar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(200);
  ok('Enter 打开任务详情', document.getElementById('taskDrawer').classList.contains('on'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(150);

  /* 12. 图例与无异常 */
  ok('图例四项齐全', document.querySelectorAll('.gantt-legend .gl-item').length === 4);
  ok('无 JS 异常', window.__errs.length === 0, window.__errs);
  ok('页面无横向溢出（最终）', document.documentElement.scrollWidth <= innerWidth + 1);
  return { checks: checks, errs: window.__errs };
})()`

const phaseTwo = `(async () => {
  ${common}
  resetState();
  await wait(300);
  const controls = [...document.querySelectorAll('#view-gantt .page-toolbar button, #view-gantt .page-toolbar select, .gantt-tools button, .gantt-tools select')];
  const outside = controls.filter(el => {
    if (el.hidden || el.offsetWidth === 0 || el.offsetHeight === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width === 0 || r.height === 0 || r.left < -1 || r.right > innerWidth + 1 || r.top < -1;
  }).map(el => (el.id || el.textContent.trim()).slice(0, 20));
  return {
    checks: [
      { name: '工具栏控件都在 1280 视口内', pass: outside.length === 0, extra: outside },
      { name: '页面无横向溢出（1280）', pass: document.documentElement.scrollWidth <= innerWidth + 1, extra: document.documentElement.scrollWidth },
      { name: '1280 仍渲染甘特条', pass: document.querySelectorAll('[data-gantt-bar]').length > 0, extra: document.querySelectorAll('[data-gantt-bar]').length }
    ]
  };
})()`

let all = []
await fresh(1440, 900)
const one = await js(phaseOne)
all = all.concat(one.checks)
await fresh(1280, 720)
const two = await js(phaseTwo)
all = all.concat(two.checks)
ab(['close', '--all'])

let failed = 0
for (const c of all) {
  if (c.pass) {
    console.log(`  PASS  ${c.name}`)
  } else {
    failed++
    console.log(`  FAIL  ${c.name}${c.extra !== null ? '  -> ' + JSON.stringify(c.extra) : ''}`)
  }
}
console.log(`\n${all.length - failed}/${all.length} 通过`)
process.exit(failed ? 1 : 0)
