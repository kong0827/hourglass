/* 阅读模式左树布局原型 · 独立 headless Chrome 验证 + 截图
   用法：node tools/shots/shot-doc-read-layout.mjs
   无外部依赖：Node 24 内置 fetch / WebSocket，直接驱动 CDP。 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PREVIEW = pathToFileURL(join(ROOT, 'docs/preview/doc-read-tree-layout-preview-2026-11-14.html')).href
const OUT = join(ROOT, 'docs/preview/')
const PORT = 9333
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

/* ---- 启动 Chrome ---- */
const profile = mkdtempSync(join(tmpdir(), 'hg-shot-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1440,1000', PREVIEW
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
let chromeErr = ''
chrome.stderr.on('data', d => { chromeErr += d.toString() })

async function waitDevtools() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return await r.json() } catch {}
    await sleep(200)
  }
  throw new Error('DevTools 未就绪：' + chromeErr.slice(-400))
}

/* ---- 极简 CDP 客户端 ---- */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.handlers = []
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
      else if (m.method) { this.events.push(m); this.handlers.forEach(h => h(m)) }
    })
  }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) }); return new CDP(ws) }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  on(h) { this.handlers.push(h) }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result?.value }
  async waitFor(expression, timeoutMs = 10000) { const t0 = Date.now(); for (;;) { let v = false; try { v = await this.eval(expression) } catch {} if (v) return true; if (Date.now() - t0 > timeoutMs) throw new Error('等待超时：' + expression); await sleep(120) } }
  async ready() { await this.waitFor(`document.readyState === 'complete' && document.querySelectorAll('[data-tree]').length === 5`) }
  async reload() { await this.send('Page.reload'); await this.ready() }
  async shot(file, { fullPage = true } = {}) { const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage }); writeFileSync(file, Buffer.from(r.data, 'base64')); return file }
  close() { try { this.ws.close() } catch {} }
}

const consoleErrors = []
try {
  await waitDevtools()
  let page
  for (let i = 0; i < 60; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    page = targets.find(t => t.type === 'page' && t.url.startsWith('file:'))
    if (page) break
    await sleep(200)
  }
  if (!page) throw new Error('未找到预览页面 target')
  const b = await CDP.connect(page.webSocketDebuggerUrl)
  b.on(m => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args?.map(a => a.value || a.description).join(' '))
  })
  await b.send('Page.enable'); await b.send('Runtime.enable')
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
  await b.ready()
  await b.eval(`document.fonts ? document.fonts.ready.then(()=>true) : true`)

  /* ---------- 1. 渲染与布局 ---------- */
  const render = await b.eval(`(() => {
    const trees = [...document.querySelectorAll('[data-tree]')];
    const metrics = [...document.querySelectorAll('[data-metric]')].map(m => parseInt(m.textContent));
    return {
      trees: trees.length,
      rows: trees.map(t => t.querySelectorAll('[data-row]').length),
      groups: trees.map(t => t.querySelectorAll('[data-proj]').length),
      metrics,
      readerTitle: (document.querySelector('#rrdTitleText')||{}).textContent,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      treeOverflow: trees.map(t => t.scrollWidth > t.clientWidth + 1)
    };
  })()`)
  log(render.trees === 5 && render.rows.every(n => n === 13), '四个对比面板 + 整体效果共 5 棵树，各 13 行', JSON.stringify(render.rows))
  log(render.groups.every(n => n === 3), '每棵树 3 个项目分组')
  log(render.metrics.every(n => n > 0), '标题可视宽度指标已实测填充', JSON.stringify(render.metrics))
  log(render.metrics[1] > render.metrics[0] && render.metrics[3] > render.metrics[1], '方案A/C 标题宽度 > 现状，C > A', `now=${render.metrics[0]} A=${render.metrics[1]} B=${render.metrics[2]} C=${render.metrics[3]}`)
  log(!render.hScroll, '1440 宽度无页面横向溢出')
  log(render.treeOverflow.every(v => !v), '树内部无横向溢出')
  log(render.readerTitle === '支付网关 v2.2 测试报告', '阅读区默认展示选中文档', render.readerTitle)

  /* ---------- 2. 行选中联动阅读区 ---------- */
  await b.eval(`document.querySelector('[data-tree="hero"] [data-row="p1"]').click()`)
  await sleep(120)
  const sel = await b.eval(`({ active: document.querySelector('[data-tree="hero"] .rs-node.active')?.getAttribute('data-row'), title: document.querySelector('#rrdTitleText')?.textContent, crumb: document.querySelector('.rrd-crumb-cur')?.textContent })`)
  log(sel.active === 'p1' && sel.title === '支付网关 v2.2 需求规格说明' && sel.crumb === sel.title, '点击左树行 → 高亮 + 阅读区标题/面包屑联动', JSON.stringify(sel))

  /* ---------- 3. 折叠 ---------- */
  await b.eval(`document.querySelector('[data-tree="a"] [data-proj="clear"]').click()`)
  await sleep(80)
  const foldG = await b.eval(`(() => {
    const box = document.querySelector('[data-tree="a"]');
    const grp = box.querySelector('[data-proj="clear"]').closest('.rs-proj');
    const body = grp.querySelector('.rs-proj-body');
    const visible = [...box.querySelectorAll('[data-row]')].filter(r => r.offsetParent !== null).length;
    return { collapsed: grp.classList.contains('collapsed'), display: getComputedStyle(body).display, visible };
  })()`)
  log(foldG.collapsed && foldG.display === 'none' && foldG.visible === 9, '折叠项目分组隐藏其 4 行（CSS 收起）', JSON.stringify(foldG))
  await b.eval(`document.querySelector('[data-tree="a"] [data-proj="clear"]').click()`)
  await b.eval(`document.querySelector('[data-tree="a"] [data-caret="p2"]').click()`)
  await sleep(80)
  const foldD = await b.eval(`({ rows: document.querySelectorAll('[data-tree="a"] [data-row]').length, child: !!document.querySelector('[data-tree="a"] [data-row="p2a"]') })`)
  log(foldD.rows === 12 && !foldD.child, '折叠父文档收起子文档', JSON.stringify(foldD))
  await b.eval(`document.querySelector('[data-tree="a"] [data-caret="p2"]').click()`)

  /* ---------- 4. 悬停操作浮层不占位 ---------- */
  const acts = await b.eval(`(() => {
    const row = document.querySelector('[data-tree="a"] [data-row="p1"]');
    const a = row.querySelector('.row-acts');
    const cs = getComputedStyle(a);
    const titleW = row.querySelector('.rs-title').getBoundingClientRect().width;
    const nowRow = document.querySelector('[data-tree="now"] [data-row="p1"]');
    const nowTitleW = nowRow.querySelector('.rs-title').getBoundingClientRect().width;
    return { pos: cs.position, opacity: cs.opacity, pointer: cs.pointerEvents, titleW: Math.round(titleW), nowTitleW: Math.round(nowTitleW) };
  })()`)
  log(acts.pos === 'absolute' && acts.opacity === '0', '方案A 悬停操作为绝对定位浮层，默认隐藏不占位', JSON.stringify(acts))
  log(acts.titleW > acts.nowTitleW + 20, '方案A 标题比现状宽 20px 以上', `${acts.nowTitleW} -> ${acts.titleW}`)

  /* ---------- 5. 行内重命名 ---------- */
  await b.eval(`(() => { const row = document.querySelector('[data-tree="a"] [data-row="p4"]'); row.querySelector('.rs-rename').click(); })()`)
  await sleep(80)
  await b.eval(`(() => { const i = document.querySelector('[data-tree="a"] .rs-rename-input'); i.value = '支付网关 v2.2 发布说明（终稿）'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
  await sleep(120)
  const ren = await b.eval(`({ a: document.querySelector('[data-tree="a"] [data-row="p4"] .rs-title')?.textContent, hero: document.querySelector('[data-tree="hero"] [data-row="p4"] .rs-title')?.textContent, toast: document.getElementById('toast').textContent })`)
  log(ren.a === '支付网关 v2.2 发布说明（终稿）' && ren.hero === ren.a, '行内重命名回车提交，所有视图同步', JSON.stringify(ren))

  /* ---------- 6. 拖拽排序（同项目顶层） ---------- */
  const drag = await b.eval(`(() => {
    const box = document.querySelector('[data-tree="a"]');
    const src = box.querySelector('[data-row="p1"]');
    const dst = box.querySelector('[data-row="p3"]');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: r.top + r.height - 2 }));
    const line = !!box.querySelector('.rs-drop-line');
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: r.top + r.height - 2 }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    const order = [...box.querySelectorAll('[data-depth="0"]')].map(x => x.getAttribute('data-row')).slice(0, 4);
    return { line, order };
  })()`)
  log(drag.line, '拖拽悬停出现插入指示线')
  log(drag.order[0] === 'p2' && drag.order.indexOf('p1') === 2, '拖放后 p1 移到 p3 之后（顶层顺序更新）', JSON.stringify(drag.order))

  /* ---------- 7. 宽度滑杆 ---------- */
  await b.eval(`(() => { const s = document.getElementById('panelWidth'); s.value = 240; s.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(120)
  const narrow = await b.eval(`({ label: document.getElementById('panelWidthVal').textContent, w: Math.round(document.querySelector('[data-panel="a"] .shell').getBoundingClientRect().width), metric: document.querySelector('[data-panel="a"] [data-metric]').textContent, hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 })`)
  log(narrow.label === '240px' && narrow.w === 240 && !narrow.hScroll, '滑杆调窄到 240px 生效且无横向溢出', JSON.stringify(narrow))
  await b.shot(OUT + 'doc-read-tree-layout-preview-2026-11-14-narrow.png', { fullPage: false })
  await b.eval(`(() => { const s = document.getElementById('panelWidth'); s.value = 290; s.dispatchEvent(new Event('input', { bubbles: true })); })()`)

  /* ---------- 8. 阅读区控件 ---------- */
  await b.eval(`document.querySelector('#heroReader [data-zoom="in"]').click()`)
  await b.eval(`document.querySelector('#heroReader [data-zoom="in"]').click()`)
  await sleep(80)
  const zoom = await b.eval(`({ fs: document.getElementById('rrdBody').style.fontSize, label: document.querySelector('#heroReader [data-zoom-val]').textContent })`)
  log(zoom.fs === '16.8px' && zoom.label === '120%', '正文缩放 + 两次到 120%', JSON.stringify(zoom))
  await b.eval(`document.querySelector('#heroReader [data-zoom="reset"]').click()`)
  await b.eval(`document.querySelector('#heroReader [data-wide]').click()`)
  await sleep(80)
  const wide = await b.eval(`({ wide: document.getElementById('heroSplit').classList.contains('wide'), treeHidden: getComputedStyle(document.querySelector('.split-tree')).display === 'none', pressed: document.querySelector('#heroReader [data-wide]').getAttribute('aria-pressed') })`)
  log(wide.wide && wide.treeHidden && wide.pressed === 'true', '宽屏阅读收起左树', JSON.stringify(wide))
  await b.eval(`document.querySelector('#heroReader [data-wide]').click()`)
  await b.eval(`document.querySelector('#heroReader [data-export]').click()`)
  await sleep(120)
  const exp = await b.eval(`document.getElementById('toast').textContent`)
  log(exp.indexOf('已导出') === 0, '导出触发下载并提示', exp)

  /* ---------- 9. 主题切换 ---------- */
  await b.eval(`document.getElementById('themeBtn').click()`)
  await sleep(120)
  const dark = await b.eval(`({ theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, label: document.getElementById('themeBtn').textContent.trim() })`)
  log(dark.theme === 'dark' && dark.bg === 'rgb(13, 18, 25)', '切换深色主题生效', JSON.stringify(dark))

  /* ---------- 10. 控制台无错误 ---------- */
  log(consoleErrors.length === 0, '全程无控制台错误 / 未捕获异常', consoleErrors.slice(0, 3).join(' | '))

  /* ---------- 截图：干净状态 ---------- */
  await b.reload()
  await b.shot(OUT + 'doc-read-tree-layout-preview-2026-11-14.png', { fullPage: true })
  await b.eval(`document.getElementById('themeBtn').click()`); await sleep(200)
  await b.shot(OUT + 'doc-read-tree-layout-preview-2026-11-14-dark.png', { fullPage: true })

  /* ---------- 移动端 ---------- */
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await b.reload()
  const mob = await b.eval(`({ hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, splitCols: getComputedStyle(document.getElementById('heroSplit')).gridTemplateColumns })`)
  log(!mob.hScroll, '390 移动端无横向溢出', JSON.stringify(mob))
  await b.shot(OUT + 'doc-read-tree-layout-preview-2026-11-14-mobile.png', { fullPage: true })

  b.close()
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  try { process.kill(-chrome.pid, 'SIGKILL') } catch { try { chrome.kill('SIGKILL') } catch {} }
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)