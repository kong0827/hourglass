/* 方案A 落地后的真实页面验证（预览稿 ui-preview.html，真实前端代码 + mock 数据）
   用法：node tools/preview/gen-preview.js && node tools/shots/shot-doc-read-planA.mjs
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
const PORT = 9337
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

const profile = mkdtempSync(join(tmpdir(), 'hg-planA-'))
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
async function enterRead(b) {
  await b.waitFor(`!!document.querySelector('[data-rdmode="read"]')`)
  await b.eval(`document.querySelector('[data-rdmode="read"]').click()`)
  await b.waitFor(`document.querySelectorAll('.rs-node').length > 0`)
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
  await enterRead(b)

  /* ---------- 1. 行结构：标题优先 ---------- */
  const struct = await b.eval(`(() => {
    const nodes = [...document.querySelectorAll('.rs-node')];
    const firstIsTitle = nodes.every(n => n.children[1] && n.children[1].classList.contains('rs-title'));
    const oldFmt = document.querySelectorAll('.rs-node .rr-fmt').length;
    const d1 = document.querySelector('[data-rs-doc="D1"]');
    const d4 = document.querySelector('[data-rs-doc="D4"]');
    return {
      count: nodes.length,
      firstIsTitle,
      oldFmt,
      d1HtmlTag: !!d1.querySelector('.rs-fmt-html'),
      d4HtmlTag: !!d4.querySelector('.rs-fmt-html'),
      d1Pub: !!d1.querySelector('.rr-published'),
      d4Draft: !!d4.querySelector('.rr-draft'),
      titleW: Math.round(d1.querySelector('.rs-title').getBoundingClientRect().width),
      d4TitleW: Math.round(d4.querySelector('.rs-title').getBoundingClientRect().width),
      actsCount: document.querySelectorAll('.rs-node .rs-acts').length
    };
  })()`)
  log(struct.count >= 4 && struct.firstIsTitle, '每行折叠箭头后紧跟标题（标题第一位置）', `count=${struct.count} firstIsTitle=${struct.firstIsTitle}`)
  log(struct.oldFmt === 0, '阅读树不再出现旧 MD/HTML 领跑徽标', `oldFmt=${struct.oldFmt}`)
  log(struct.d1HtmlTag && !struct.d4HtmlTag, 'HTML 文档标例外标，MD 文档不标', `D1(HTML)=${struct.d1HtmlTag} D4(MD)=${struct.d4HtmlTag}`)
  log(struct.d1Pub && struct.d4Draft, '发布/草稿状态徽标保留', `D1已发布=${struct.d1Pub} D4草稿=${struct.d4Draft}`)
  log(struct.d4TitleW >= 170, 'MD 文档行标题可视宽度 ≥170px（移除领跑徽标与常驻手柄后）', `D4(MD,缩进)=${struct.d4TitleW} D1(HTML)=${struct.titleW}`)
  log(struct.actsCount >= 4, '可编辑行带行尾操作浮层', `acts=${struct.actsCount}`)

  /* ---------- 2. 浮层默认隐藏不占位，悬停浮现 ---------- */
  const before = await b.eval(`(() => { const a = document.querySelector('[data-rs-doc="D1"] .rs-acts'); const cs = getComputedStyle(a); return { opacity: cs.opacity, pe: cs.pointerEvents, pos: cs.position }; })()`)
  log(before.opacity === '0' && before.pe === 'none' && before.pos === 'absolute', '浮层默认绝对定位隐藏、不占位', JSON.stringify(before))
  const box = await b.eval(`(() => { const r = document.querySelector('[data-rs-doc="D1"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`)
  await b.mouse(box.x, box.y); await sleep(250)
  const hover = await b.eval(`(() => { const a = document.querySelector('[data-rs-doc="D1"] .rs-acts'); const cs = getComputedStyle(a); return { opacity: cs.opacity, pe: cs.pointerEvents, drag: !!a.querySelector('.rs-drag'), rename: !!a.querySelector('.rs-rename') }; })()`)
  log(hover.opacity === '1' && hover.pe === 'auto' && hover.drag && hover.rename, '悬停行浮现拖拽/重命名手柄', JSON.stringify(hover))

  /* ---------- 3. 点击行 → 阅读区联动 ---------- */
  await b.eval(`document.querySelector('[data-rs-doc="D1"]').click()`)
  await sleep(400)
  const reader = await b.eval(`({ active: document.querySelector('.rs-node.active')?.getAttribute('data-rs-doc'), title: document.querySelector('#reqDocReader .rrd-title-text')?.textContent })`)
  log(reader.active === 'D1' && reader.title === '权限校验需求', '点击行高亮并加载阅读区标题', JSON.stringify(reader))

  /* ---------- 4. 行内重命名（含 mock 写回） ---------- */
  await b.eval(`document.querySelector('[data-rs-doc="D3"] .rs-rename').click()`)
  await sleep(150)
  await b.eval(`(() => { const i = document.querySelector('.rs-rename-input'); i.value = '日终批处理拆分（修订）'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`)
  await sleep(500)
  const ren = await b.eval(`({ tree: document.querySelector('[data-rs-doc="D3"] .rs-title')?.textContent, inputGone: !document.querySelector('.rs-rename-input') })`)
  log(ren.tree === '日终批处理拆分（修订）' && ren.inputGone, '行尾手柄重命名回车提交并写回', JSON.stringify(ren))

  /* ---------- 5. 拖拽：按行尾手柄 → 拖到根级 → 提交 ---------- */
  const drag = await b.eval(`(() => {
    const st = document.getElementById('reqDocSplitTree');
    const src = document.querySelector('[data-rs-doc="D2"]');
    const grip = src.querySelector('.rs-drag');
    const dst = document.querySelector('[data-rs-doc="D1"]');
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
  const after = await b.eval(`(() => { const d2 = document.querySelector('[data-rs-doc="D2"]'); return { depth: d2?.getAttribute('data-rs-depth'), toast: document.querySelector('.toast')?.textContent || '' }; })()`)
  log(drag.line, '拖拽悬停出现插入指示线')
  log(after.depth === '0', '按行尾手柄拖放后子文档提升到根级（排序写回生效）', `D2 depth=${after.depth}`)

  /* ---------- 6. 折叠（用 D3→D4：D2 已在上一步拖到根级，不再是 D1 的子文档） ---------- */
  await b.eval(`document.querySelector('[data-rs-toggle="D3"]')?.click()`)
  await sleep(200)
  const fold = await b.eval(`(() => { const d4 = document.querySelector('[data-rs-doc="D4"]'); return { childVisible: !!d4 && d4.offsetParent !== null, caretCollapsed: !!document.querySelector('[data-rs-toggle="D3"].collapsed') }; })()`)
  log(!fold.childVisible && fold.caretCollapsed, '折叠父文档收起子文档', JSON.stringify(fold))

  /* ---------- 7. 深色主题 ---------- */
  await b.eval(`document.documentElement.setAttribute('data-theme', 'dark')`)
  await sleep(200)
  const dark = await b.eval(`(() => { const n = document.querySelector('.rs-node'); const tag = document.querySelector('.rs-fmt-html'); return { nodeBg: getComputedStyle(n).backgroundColor, tagColor: tag ? getComputedStyle(tag).color : null, bodyBg: getComputedStyle(document.body).backgroundColor }; })()`)
  log(dark.bodyBg === 'rgb(13, 18, 25)' && !!dark.tagColor, '深色主题下令牌生效、例外标可读', JSON.stringify(dark))
  await b.eval(`document.documentElement.setAttribute('data-theme', 'light')`)

  /* ---------- 8. 控制台无错误 ---------- */
  const realErrors = consoleErrors.filter(e => !/marked|DOMPurify|Failed to load|net::|favicon/i.test(e || ''))
  log(realErrors.length === 0, '无与本次改动相关的控制台错误', realErrors.slice(0, 3).join(' | ') || '(忽略资源加载类提示)')

  /* ---------- 截图：干净状态 ---------- */
  await b.send('Page.reload'); await b.waitFor(`document.readyState === 'complete'`); await enterRead(b)
  await b.eval(`document.querySelector('[data-rs-doc="D1"]')?.click()`); await sleep(400)
  await b.shot(OUT + 'doc-read-planA-live-light.png', { fullPage: false })
  await b.eval(`document.documentElement.setAttribute('data-theme', 'dark')`); await sleep(250)
  await b.shot(OUT + 'doc-read-planA-live-dark.png', { fullPage: false })

  /* ---------- 移动端 ---------- */
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await b.send('Page.reload'); await b.waitFor(`document.readyState === 'complete'`); await enterRead(b)
  const mob = await b.eval(`({ hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, nodes: document.querySelectorAll('.rs-node').length })`)
  log(!mob.hScroll && mob.nodes >= 4, '390 移动端阅读树正常无横向溢出', JSON.stringify(mob))
  await b.shot(OUT + 'doc-read-planA-live-mobile.png', { fullPage: false })

  b.close()
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  try { process.kill(-chrome.pid, 'SIGKILL') } catch { try { chrome.kill('SIGKILL') } catch {} }
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)