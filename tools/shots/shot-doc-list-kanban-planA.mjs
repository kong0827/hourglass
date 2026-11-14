/* 方案A 同步到「列表行 / 看板卡片」后的真实页面验证（预览稿 ui-preview.html，真实前端 + mock）
   用法：node tools/preview/gen-preview.js && node tools/shots/shot-doc-list-kanban-planA.mjs
   无外部依赖：Node 24 内置 fetch / WebSocket 驱动 CDP。 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PREVIEW = pathToFileURL(join(ROOT, 'docs/preview/ui-preview.html')).href + '#/requirements'
const OUT = join(ROOT, 'docs/preview/')
const PORT = 9338
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

const profile = mkdtempSync(join(tmpdir(), 'hg-lk-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1440,1000', PREVIEW
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
let chromeErr = ''
chrome.stderr.on('data', d => { chromeErr += d.toString() })
async function waitDevtools() {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return } catch {} await sleep(200) }
  throw new Error('DevTools 未就绪：' + chromeErr.slice(-400))
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
      else if (m.method) this.handlers.forEach(h => h(m)) }) }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) }); return new CDP(ws) }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  on(h) { this.handlers.push(h) }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('页面异常：' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result?.value }
  async waitFor(expression, timeoutMs = 20000) { const t0 = Date.now(); for (;;) { let v = false; try { v = await this.eval(expression) } catch {} if (v) return true; if (Date.now() - t0 > timeoutMs) throw new Error('等待超时：' + expression); await sleep(150) } }
  async mouse(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }) }
  async shot(file, { fullPage = false } = {}) { const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage }); writeFileSync(file, Buffer.from(r.data, 'base64')); return file }
  close() { try { this.ws.close() } catch {} }
}
const consoleErrors = []
async function enterList(b) {
  await b.waitFor(`!!document.querySelector('[data-rdmode="tree"]')`)
  await b.eval(`document.querySelector('[data-rdmode="tree"]').click()`)
  await b.waitFor(`document.querySelectorAll('.reqdoc-row').length > 0`)
  await sleep(300)
}
async function enterKanban(b) {
  await b.eval(`document.querySelector('[data-rdmode="kanban"]').click()`)
  await b.waitFor(`document.querySelectorAll('.rk-card').length > 0`)
  await sleep(300)
}
try {
  await waitDevtools()
  let page
  for (let i = 0; i < 80; i++) { const ts = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = ts.find(t => t.type === 'page' && t.url.startsWith('file:')); if (page) break; await sleep(200) }
  if (!page) throw new Error('未找到预览页面 target')
  const b = await CDP.connect(page.webSocketDebuggerUrl)
  b.on(m => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args?.map(a => a.value || a.description).join(' '))
  })
  await b.send('Page.enable'); await b.send('Runtime.enable')
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false })
  await b.waitFor(`document.readyState === 'complete'`)
  await enterList(b)

  /* ---------- 列表：行结构标题优先 ---------- */
  const ls = await b.eval(`(() => {
    const rows = [...document.querySelectorAll('.reqdoc-row')];
    const d1 = document.querySelector('[data-reqdoc="D1"]');
    const d4 = document.querySelector('[data-reqdoc="D4"]');
    const title = d1.querySelector('.rr-title');
    return {
      count: rows.length,
      oldFmt: document.querySelectorAll('.reqdoc-row .rr-fmt').length,
      titleFirstText: title.childNodes[0] && title.childNodes[0].nodeType === 3,
      tagLast: title.lastElementChild && title.lastElementChild.classList.contains('rs-fmt-html'),
      d1Tag: !!d1.querySelector('.rs-fmt-html'),
      d4Tag: !!d4.querySelector('.rs-fmt-html'),
      d2Tag: !!document.querySelector('[data-reqdoc="D2"] .rs-fmt-html'),
      d3Tag: !!document.querySelector('[data-reqdoc="D3"] .rs-fmt-html'),
      d1Pub: !!d1.querySelector('.rr-published'),
      d4Draft: !!d4.querySelector('.rr-draft'),
      acts: document.querySelectorAll('.reqdoc-row .rr-acts').length,
      dragInActs: !!d1.querySelector('.rr-drag') && d1.querySelector('.rr-drag').parentElement.classList.contains('rr-acts'),
      frontCaret: rows[0].children[0].classList.contains('rr-caret'),
      frontMain: rows[0].children[1].classList.contains('rr-main')
    };
  })()`)
  log(ls.count >= 4 && ls.oldFmt === 0 && ls.titleFirstText, '列表行标题优先、旧 MD/HTML 领跑徽标清零', `count=${ls.count} oldFmt=${ls.oldFmt} titleFirstText=${ls.titleFirstText}`)
  log(ls.tagLast && ls.d1Tag && ls.d2Tag && ls.d3Tag && !ls.d4Tag, 'HTML 例外标移到标题/状态之后，MD 不标', `D1=${ls.d1Tag} D2=${ls.d2Tag} D3=${ls.d3Tag} D4(MD)=${ls.d4Tag} tagLast=${ls.tagLast}`)
  log(ls.d1Pub && ls.d4Draft, '发布/草稿状态徽标保留', `D1已发布=${ls.d1Pub} D4草稿=${ls.d4Draft}`)
  log(ls.acts >= 4 && ls.dragInActs, '拖拽/重命名收进行尾浮层 .rr-acts', `acts=${ls.acts} dragInActs=${ls.dragInActs}`)
  log(ls.frontCaret && ls.frontMain, '行首只剩折叠箭头+主体，手柄不再常驻占位', `caret=${ls.frontCaret} main=${ls.frontMain}`)

  /* ---------- 列表：浮层默认隐藏不占位，悬停浮现 ---------- */
  const before = await b.eval(`(() => { const a = document.querySelector('[data-reqdoc="D1"] .rr-acts'); const cs = getComputedStyle(a); return { opacity: cs.opacity, pe: cs.pointerEvents, pos: cs.position }; })()`)
  log(before.opacity === '0' && before.pe === 'none' && before.pos === 'absolute', '列表浮层默认绝对定位隐藏、不占位', JSON.stringify(before))
  const box = await b.eval(`(() => { const r = document.querySelector('[data-reqdoc="D1"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)
  await b.mouse(box.x, box.y); await sleep(250)
  const hover = await b.eval(`(() => { const a = document.querySelector('[data-reqdoc="D1"] .rr-acts'); const cs = getComputedStyle(a); return { opacity: cs.opacity, pe: cs.pointerEvents, drag: !!a.querySelector('.rr-drag'), rename: !!a.querySelector('.rr-rename') }; })()`)
  log(hover.opacity === '1' && hover.pe === 'auto' && hover.drag && hover.rename, '悬停行浮现拖拽/重命名手柄', JSON.stringify(hover))

  /* ---------- 列表：行尾手柄重命名 ---------- */
  await b.eval(`document.querySelector('[data-reqdoc="D3"] .rr-rename').click()`)
  await sleep(150)
  await b.eval(`(() => { const i = document.querySelector('.rr-rename-input'); i.value = '日终批处理拆分（修订）'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
  await sleep(500)
  const ren = await b.eval(`({ tree: document.querySelector('[data-reqdoc="D3"] .rr-title')?.textContent.replace(/HTML|已发布|草稿/g, '').trim(), inputGone: !document.querySelector('.rr-rename-input') })`)
  log(ren.tree === '日终批处理拆分（修订）' && ren.inputGone, '列表行尾手柄重命名回车提交并写回', JSON.stringify(ren))

  /* ---------- 列表：按行尾手柄拖拽提升根级 ---------- */
  const drag = await b.eval(`(() => {
    const st = document.getElementById('reqDocTree');
    const src = document.querySelector('[data-reqdoc="D2"]');
    const grip = src.querySelector('.rr-drag');
    const dst = document.querySelector('[data-reqdoc="D1"]');
    grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: r.top + 2 }));
    const line = !!st.querySelector('.rs-drop-line');
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: r.top + 2 }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return { line, dragging: src.classList.contains('dragging') };
  })()`)
  await sleep(600)
  const after = await b.eval(`(() => { const d2 = document.querySelector('[data-reqdoc="D2"]'); return { depth: d2?.getAttribute('data-rr-depth') }; })()`)
  log(drag.line, '列表拖拽悬停出现插入指示线')
  log(after.depth === '0', '列表按行尾手柄拖放后子文档提升到根级（排序写回生效）', `D2 depth=${after.depth}`)

  /* ---------- 列表：点击行进编辑页，再返回 ---------- */
  await b.eval(`document.querySelector('[data-reqdoc="D1"]').click()`)
  await b.waitFor(`document.getElementById('reqDocEditPage') && document.getElementById('reqDocEditPage').hidden === false`)
  await sleep(300)
  const ed = await b.eval(`({ editVisible: !document.getElementById('reqDocEditPage').hidden, listHidden: document.getElementById('reqDocListPage').hidden, crumb: document.getElementById('reqDocCrumb')?.textContent || '' })`)
  log(ed.editVisible && ed.listHidden && ed.crumb.indexOf('权限校验需求') >= 0, '点击列表行打开编辑页（面包屑含标题）', JSON.stringify(ed))
  await b.eval(`document.getElementById('reqDocBack').click()`)
  await b.waitFor(`document.getElementById('reqDocListPage').hidden === false`)
  await sleep(200)

  /* ---------- 看板：卡片标题优先 ---------- */
  await enterKanban(b)
  const kb = await b.eval(`(() => {
    const cards = [...document.querySelectorAll('.rk-card')];
    const head = document.querySelector('[data-rkdoc="D1"] .rk-head');
    return {
      count: cards.length,
      oldFmt: document.querySelectorAll('.rk-card .rr-fmt').length,
      headFirstTitle: cards.every(c => c.querySelector('.rk-head').firstElementChild.classList.contains('rk-title')),
      d1Tag: !!document.querySelector('[data-rkdoc="D1"] .rs-fmt-html'),
      d2Tag: !!document.querySelector('[data-rkdoc="D2"] .rs-fmt-html'),
      d3Tag: !!document.querySelector('[data-rkdoc="D3"] .rs-fmt-html'),
      d4Tag: !!document.querySelector('[data-rkdoc="D4"] .rs-fmt-html'),
      tagLast: head.lastElementChild.classList.contains('rs-fmt-html'),
      d4InDraft: !!document.querySelector('[data-rkcol="draft"] [data-rkdoc="D4"]'),
      statusSel: !!document.querySelector('[data-rkdoc="D4"] [data-rkstatus]')
    };
  })()`)
  log(kb.count >= 4 && kb.oldFmt === 0 && kb.headFirstTitle, '看板卡片标题优先、旧领跑徽标清零', `count=${kb.count} oldFmt=${kb.oldFmt} headFirstTitle=${kb.headFirstTitle}`)
  log(kb.d1Tag && kb.d2Tag && kb.d3Tag && !kb.d4Tag && kb.tagLast, '看板 HTML 例外标移到标题之后，MD 不标', `D1=${kb.d1Tag} D2=${kb.d2Tag} D3=${kb.d3Tag} D4(MD)=${kb.d4Tag} tagLast=${kb.tagLast}`)
  log(kb.d4InDraft && kb.statusSel, '看板状态下拉兜底入口保留（D4 在草稿列）', `d4InDraft=${kb.d4InDraft} statusSel=${kb.statusSel}`)

  /* ---------- 看板：状态下拉流转 ---------- */
  await b.eval(`(() => { const s = document.querySelector('[data-rkdoc="D4"] [data-rkstatus]'); s.value = 'active'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await sleep(600)
  const flow = await b.eval(`({ inActive: !!document.querySelector('[data-rkcol="active"] [data-rkdoc="D4"]'), inDraft: !!document.querySelector('[data-rkcol="draft"] [data-rkdoc="D4"]') })`)
  log(flow.inActive && !flow.inDraft, '看板状态下拉把 D4 从草稿流转到进行中', JSON.stringify(flow))

  /* ---------- 深色主题 ---------- */
  await b.eval(`document.documentElement.setAttribute('data-theme', 'dark')`); await sleep(250)
  const dark = await b.eval(`(() => { const tag = document.querySelector('.rk-card .rs-fmt-html'); return { bodyBg: getComputedStyle(document.body).backgroundColor, tagColor: tag ? getComputedStyle(tag).color : null }; })()`)
  log(dark.bodyBg === 'rgb(13, 18, 25)' && !!dark.tagColor, '深色主题下令牌生效、例外标可读', JSON.stringify(dark))
  await b.shot(OUT + 'doc-kanban-planA-live-dark.png', { fullPage: false })
  await b.eval(`document.documentElement.setAttribute('data-theme', 'light')`); await sleep(200)
  await b.shot(OUT + 'doc-kanban-planA-live-light.png', { fullPage: false })

  /* ---------- 控制台无错误 ---------- */
  const realErrors = consoleErrors.filter(e => !/marked|DOMPurify|Failed to load|net::|favicon/i.test(e || ''))
  log(realErrors.length === 0, '无与本次改动相关的控制台错误', realErrors.slice(0, 3).join(' | ') || '(忽略资源加载类提示)')

  /* ---------- 列表截图（干净状态） ---------- */
  await b.send('Page.reload'); await b.waitFor(`document.readyState === 'complete'`); await enterList(b)
  const lb = await b.eval(`(() => { const r = document.querySelector('[data-reqdoc="D1"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)
  await b.mouse(lb.x, lb.y); await sleep(250)
  await b.shot(OUT + 'doc-list-planA-live-light.png', { fullPage: false })
  await b.eval(`document.documentElement.setAttribute('data-theme', 'dark')`); await sleep(250)
  await b.shot(OUT + 'doc-list-planA-live-dark.png', { fullPage: false })
  await b.eval(`document.documentElement.setAttribute('data-theme', 'light')`); await sleep(200)

  /* ---------- 移动端 ---------- */
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await b.send('Page.reload'); await b.waitFor(`document.readyState === 'complete'`); await enterList(b)
  const ml = await b.eval(`({ hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, rows: document.querySelectorAll('.reqdoc-row').length })`)
  log(!ml.hScroll && ml.rows >= 4, '390 移动端列表正常无横向溢出', JSON.stringify(ml))
  await b.shot(OUT + 'doc-list-planA-live-mobile.png', { fullPage: false })
  await enterKanban(b)
  const mk = await b.eval(`({ hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, cards: document.querySelectorAll('.rk-card').length })`)
  log(!mk.hScroll && mk.cards >= 4, '390 移动端看板正常无横向溢出', JSON.stringify(mk))
  await b.shot(OUT + 'doc-kanban-planA-live-mobile.png', { fullPage: false })

  b.close()
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  try { process.kill(-chrome.pid, 'SIGKILL') } catch { try { chrome.kill('SIGKILL') } catch {} }
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)