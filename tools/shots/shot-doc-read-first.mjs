/* 「阅读置首 + 默认阅读」真实页面验证（预览稿 ui-preview.html，真实前端 + mock）
   用法：node tools/preview/gen-preview.js && node tools/shots/shot-doc-read-first.mjs
   无外部依赖：Node 24 内置 fetch / WebSocket 驱动 CDP。
   重点：全新会话不点任何 tab，验证默认落在「阅读」且「阅读」是第一个 tab；再验证切换/持久化/移动端。 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PREVIEW = pathToFileURL(join(ROOT, 'docs/preview/ui-preview.html')).href + '#/requirements'
const OUT = join(ROOT, 'docs/preview/')
const PORT = 9339
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

const profile = mkdtempSync(join(tmpdir(), 'hg-rf-'))
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
  async shot(file, { fullPage = false } = {}) { const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage }); writeFileSync(file, Buffer.from(r.data, 'base64')); return file }
  close() { try { this.ws.close() } catch {} }
}
const consoleErrors = []
/* 不点任何 tab：等文档视图进入并默认渲染阅读树（.rs-node 只在阅读模式出现） */
async function waitDocsRead(b) {
  await b.waitFor(`!!document.querySelector('[data-rdmode="read"]')`)
  await b.waitFor(`document.querySelectorAll('#reqDocSplitTree .rs-node').length > 0`)
  await sleep(300)
}
async function waitDocsTree(b) {
  await b.waitFor(`!!document.querySelector('[data-rdmode="tree"]')`)
  await b.waitFor(`document.querySelectorAll('.reqdoc-row').length > 0`)
  await sleep(300)
}
const tabState = `(() => {
  const tabs = [...document.querySelectorAll('.reqdoc-modes [data-rdmode]')].map(b => ({ mode: b.dataset.rdmode, text: b.textContent.trim(), sel: b.getAttribute('aria-selected') }));
  const vis = id => { const el = document.getElementById(id); return el ? !el.hidden : null; };
  return {
    order: tabs.map(t => t.mode),
    first: tabs[0],
    selected: tabs.filter(t => t.sel === 'true').map(t => t.mode),
    pref: localStorage.getItem('ds.reqDocMode'),
    viewOn: document.getElementById('view-requirements')?.classList.contains('on'),
    split: vis('reqDocSplit'), tree: vis('reqDocTree'), kanban: vis('reqDocKanban'), feed: vis('reqDocFeed'),
    readNodes: document.querySelectorAll('#reqDocSplitTree .rs-node').length
  };
})()`
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

  /* ---------- 1. 全新会话：默认落在阅读（不点任何 tab） ---------- */
  await waitDocsRead(b)
  const fresh = await b.eval(tabState)
  log(fresh.first.mode === 'read' && fresh.first.text === '阅读', '第一个 tab 是「阅读」', JSON.stringify(fresh.first))
  log(JSON.stringify(fresh.order) === JSON.stringify(['read', 'tree', 'kanban', 'feed']), 'tab 顺序 = 阅读/列表/看板/动态', JSON.stringify(fresh.order))
  log(fresh.viewOn && fresh.split && !fresh.tree && !fresh.kanban && !fresh.feed && fresh.readNodes >= 4,
    '全新会话默认渲染阅读视图（左树有节点，其余面板隐藏）', JSON.stringify({ split: fresh.split, tree: fresh.tree, kanban: fresh.kanban, feed: fresh.feed, readNodes: fresh.readNodes }))
  log(JSON.stringify(fresh.selected) === JSON.stringify(['read']) && fresh.pref === 'read',
    '默认仅「阅读」aria-selected=true，localStorage 落 read', JSON.stringify({ selected: fresh.selected, pref: fresh.pref }))
  await b.shot(OUT + 'doc-read-first-light.png', { fullPage: false })

  /* ---------- 2. 深色主题 ---------- */
  await b.eval(`document.documentElement.setAttribute('data-theme', 'dark')`); await sleep(250)
  const dark = await b.eval(`({ bodyBg: getComputedStyle(document.body).backgroundColor, firstSel: document.querySelector('.reqdoc-modes [data-rdmode]').getAttribute('aria-selected') })`)
  log(dark.bodyBg === 'rgb(13, 18, 25)' && dark.firstSel === 'true', '深色主题正常、阅读仍置首选中', JSON.stringify(dark))
  await b.shot(OUT + 'doc-read-first-dark.png', { fullPage: false })
  await b.eval(`document.documentElement.setAttribute('data-theme', 'light')`); await sleep(200)

  /* ---------- 3. 其余 tab 仍可切换 ---------- */
  await b.eval(`document.querySelector('[data-rdmode="tree"]').click()`)
  await b.waitFor(`document.querySelectorAll('.reqdoc-row').length > 0`); await sleep(200)
  const toTree = await b.eval(tabState)
  log(toTree.tree && !toTree.split && JSON.stringify(toTree.selected) === JSON.stringify(['tree']) && toTree.first.mode === 'read',
    '切到列表：面板/选中正确，阅读仍是第一个 tab', JSON.stringify({ tree: toTree.tree, split: toTree.split, selected: toTree.selected, first: toTree.first.mode }))

  await b.eval(`document.querySelector('[data-rdmode="kanban"]').click()`)
  await b.waitFor(`document.querySelectorAll('.rk-card').length > 0`); await sleep(200)
  const toKb = await b.eval(tabState)
  log(toKb.kanban && !toKb.tree && JSON.stringify(toKb.selected) === JSON.stringify(['kanban']), '切到看板：面板/选中正确', JSON.stringify({ kanban: toKb.kanban, selected: toKb.selected }))

  await b.eval(`document.querySelector('[data-rdmode="feed"]').click()`)
  await sleep(400)
  const toFeed = await b.eval(tabState)
  log(toFeed.feed && !toFeed.kanban && JSON.stringify(toFeed.selected) === JSON.stringify(['feed']), '切到动态：面板/选中正确', JSON.stringify({ feed: toFeed.feed, selected: toFeed.selected }))

  await b.eval(`document.querySelector('[data-rdmode="read"]').click()`)
  await b.waitFor(`document.querySelectorAll('#reqDocSplitTree .rs-node').length > 0`); await sleep(200)
  const backRead = await b.eval(tabState)
  log(backRead.split && !backRead.feed && JSON.stringify(backRead.selected) === JSON.stringify(['read']), '切回阅读：面板/选中正确', JSON.stringify({ split: backRead.split, selected: backRead.selected }))

  /* ---------- 4. 持久化：尊重上次选择（列表），刷新后仍列表 ---------- */
  await b.eval(`document.querySelector('[data-rdmode="tree"]').click()`)
  await b.waitFor(`document.querySelectorAll('.reqdoc-row').length > 0`); await sleep(200)
  await b.send('Page.reload'); await b.waitFor(`document.readyState === 'complete'`); await waitDocsTree(b)
  const persisted = await b.eval(tabState)
  log(persisted.tree && !persisted.split && persisted.pref === 'tree' && persisted.first.mode === 'read',
    '刷新后尊重上次选择（列表），但阅读仍是第一个 tab', JSON.stringify({ tree: persisted.tree, pref: persisted.pref, first: persisted.first.mode }))

  /* ---------- 5. 清掉偏好：全新会话又默认阅读 ---------- */
  await b.eval(`localStorage.removeItem('ds.reqDocMode')`)
  await b.send('Page.reload'); await b.waitFor(`document.readyState === 'complete'`); await waitDocsRead(b)
  const cleared = await b.eval(tabState)
  log(cleared.split && !cleared.tree && cleared.pref === 'read' && JSON.stringify(cleared.selected) === JSON.stringify(['read']),
    '清除偏好后全新会话默认阅读', JSON.stringify({ split: cleared.split, pref: cleared.pref, selected: cleared.selected }))

  /* ---------- 6. 移动端 390：默认阅读、无横向溢出 ---------- */
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await b.eval(`localStorage.removeItem('ds.reqDocMode')`)
  await b.send('Page.reload'); await b.waitFor(`document.readyState === 'complete'`); await waitDocsRead(b)
  const mob = await b.eval(`(() => { const t = [...document.querySelectorAll('.reqdoc-modes [data-rdmode]')].map(b => b.dataset.rdmode); return { hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, first: t[0], split: !document.getElementById('reqDocSplit').hidden, nodes: document.querySelectorAll('#reqDocSplitTree .rs-node').length }; })()`)
  log(!mob.hScroll && mob.first === 'read' && mob.split && mob.nodes >= 4, '390 移动端默认阅读、阅读置首、无横向溢出', JSON.stringify(mob))
  await b.shot(OUT + 'doc-read-first-mobile.png', { fullPage: false })

  /* ---------- 7. 控制台无错误 ---------- */
  const realErrors = consoleErrors.filter(e => !/marked|DOMPurify|Failed to load|net::|favicon/i.test(e || ''))
  log(realErrors.length === 0, '无与本次改动相关的控制台错误', realErrors.slice(0, 3).join(' | ') || '(忽略资源加载类提示)')

  b.close()
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  try { process.kill(-chrome.pid, 'SIGKILL') } catch { try { chrome.kill('SIGKILL') } catch {} }
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
