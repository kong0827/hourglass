/* 用例阅读态原型验证（无外部依赖：Node 24 内置 fetch / WebSocket 驱动 CDP）
   用法：node tools/e2e/tc-reader-proto.mjs
   输出：docs/audit/prototypes/tc-reader-2026-11-15/*.png + 断言结果 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HTML = join(ROOT, 'docs/audit/prototypes/testcase-reader-proto-2026-11-15.html')
const OUT = join(ROOT, 'docs/audit/prototypes/tc-reader-2026-11-15')
const PORT = 9347
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

mkdirSync(OUT, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'hg-tc-reader-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--allow-file-access-from-files',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1440,1000', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
let chromeErr = ''
chrome.stderr.on('data', d => { chromeErr += d.toString() })

async function waitDevtools() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return } catch {}
    await sleep(200)
  }
  throw new Error('DevTools 未就绪：' + chromeErr.slice(-400))
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id)
        m.error ? rej(new Error(m.error.message)) : res(m.result)
      } else if (m.method) this.handlers.forEach(h => h(m))
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
    return new CDP(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  on(h) { this.handlers.push(h) }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('页面异常：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  async waitFor(expression, timeoutMs = 15000) {
    const t0 = Date.now()
    for (;;) {
      let v = false
      try { v = await this.eval(expression) } catch {}
      if (v) return true
      if (Date.now() - t0 > timeoutMs) throw new Error('等待超时：' + expression)
      await sleep(120)
    }
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  }
}

const errors = []
try {
  await waitDevtools()
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find(t => t.type === 'page')
  const cdp = await CDP.connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  cdp.on(m => {
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text))
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map(a => a.value || a.description).join(' '))
  })

  const url = pathToFileURL(HTML).href
  const load = async (query = '') => {
    await cdp.send('Page.navigate', { url: url + query })
    await cdp.waitFor('!!document.querySelector("#reader h2")')
    await sleep(150)
  }
  const overflow = async () => cdp.eval(`(() => ({ iw: innerWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, stage: document.getElementById('stage').getBoundingClientRect().width }))()`)

  /* ---------- 桌面 1440 ---------- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await load('?capture=1')
  let m = await overflow()
  log(m.sw <= m.iw, '桌面无横向溢出', JSON.stringify(m))
  log(await cdp.eval('document.querySelectorAll(".case-row").length') === 8, '列表 8 条用例')
  log((await cdp.eval('document.querySelector("#reader h2").textContent')).includes('TC-013') || (await cdp.eval('document.querySelector("#reader h2").textContent')).includes('E2E 执行链路'), '默认选中 TC-013')
  log(await cdp.eval('!!document.querySelector(".rail-tabs .rail-tab.on")'), '右侧辅助栏默认在「执行记录」')
  await cdp.shot('desktop-1440')

  /* 选中切换 */
  await cdp.eval('document.querySelector("[data-case=c11]").click()')
  await sleep(120)
  log((await cdp.eval('document.querySelector("#reader h2").textContent')).includes('10-50-24'), '点行切换到 TC-011')
  log((await cdp.eval('document.querySelector("#reader .r-titlebox .st-pill").textContent')).includes('失败'), 'TC-011 状态失败')
  log(await cdp.eval('Array.from(document.querySelectorAll("#reader .r-acts button")).some(b => b.textContent.includes("编辑"))'), '有编辑权限时出现编辑')

  /* 辅助栏 tab */
  await cdp.eval('document.querySelector("[data-rail=bugs]").click()')
  await sleep(80)
  log(await cdp.eval('!!document.querySelector(".bugcard")'), '辅助栏「缺陷」显示缺陷卡')
  await cdp.shot('desktop-1440-rail-bug')
  await cdp.eval('document.querySelector("[data-rail=changes]").click()')
  await sleep(80)
  log(await cdp.eval('document.querySelectorAll(".rail .tl-item").length >= 2'), '辅助栏「变更」显示时间线')
  await cdp.eval('document.querySelector("[data-rail=runs]").click()')

  /* 状态筛选 */
  await cdp.eval('document.querySelector("[data-status=failed]").click()')
  await sleep(100)
  log(await cdp.eval('document.querySelectorAll(".case-row").length') === 3, '失败筛选剩 3 条')
  log(await cdp.eval('document.querySelectorAll(".case-row .cr-st.failed").length') === 3, '筛选结果均为失败')
  await cdp.eval('document.querySelector("[data-status=all]").click()')
  await sleep(100)

  /* 模块两方案 */
  await cdp.eval('document.querySelector("[data-mod=off]").click()')
  await sleep(100)
  log(await cdp.eval('document.getElementById("moduleFilter").hidden === true'), '模块移除后筛选里没有模块')
  log(!(await cdp.eval('document.querySelector(".crumb").textContent')).includes('支付下单'), '模块移除后面包屑不含模块')
  log(!(await cdp.eval('document.querySelector(".case-row .cr-meta").textContent')).includes('支付下单'), '模块移除后列表元信息不含模块')
  await cdp.shot('desktop-1440-module-off')
  await cdp.eval('document.querySelector("[data-mod=field]").click()')
  await sleep(100)
  log(await cdp.eval('document.getElementById("moduleFilter").hidden === false'), '切回字段保留显示模块筛选')

  /* 只读视角 */
  await cdp.eval('document.querySelector("[data-ro=\\"1\\"]").click()')
  await sleep(100)
  log(await cdp.eval('!!document.querySelector(".ro-pill")'), '查看者出现只读标记')
  log(!(await cdp.eval('Array.from(document.querySelectorAll(".r-acts button")).some(b => b.textContent.includes("编辑"))')), '查看者不显示编辑')
  log(!(await cdp.eval('Array.from(document.querySelectorAll(".r-acts button")).some(b => b.textContent.includes("执行"))')), '查看者不显示执行')
  await cdp.shot('desktop-1440-readonly')
  await cdp.eval('document.querySelector("[data-ro=\\"0\\"]").click()')

  /* 未执行用例空态 */
  await cdp.eval('document.querySelector("[data-case=c12]").click()')
  await sleep(100)
  log((await cdp.eval('document.querySelector("#reader .r-titlebox .st-pill").textContent')).includes('未执行'), 'TC-012 未执行')
  log((await cdp.eval('document.querySelector("#reader .rail-pane .rail-empty")?.textContent || ""')).includes('还没有执行记录'), '未执行用例记录空态')
  log(await cdp.eval('Array.from(document.querySelectorAll(".r-acts button")).some(b => b.textContent.includes("执行"))'), '未执行用例主操作是「执行」')

  /* 标注模式 */
  await cdp.eval('document.querySelector("#annoChk").click()')
  await sleep(100)
  log(await cdp.eval('document.body.classList.contains("annotate") && document.querySelectorAll("[data-anno]").length >= 4'), '标注模式四处锚点')
  await cdp.shot('desktop-1440-anno')
  await cdp.eval('document.querySelector("#annoChk").click()')

  /* 平板 1024 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false })
  await load('?capture=1&device=tablet')
  m = await overflow()
  log(m.sw <= m.iw, '平板无横向溢出', JSON.stringify(m))
  log(await cdp.eval('getComputedStyle(document.querySelector(".rail")).position') !== 'sticky', '平板辅助栏不再吸顶（收到正文下）')
  await cdp.shot('tablet-1024')

  /* 手机 390：列表与阅读 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await load('?capture=1&device=mobile&mode=list')
  m = await overflow()
  log(m.sw <= m.iw, '手机列表无横向溢出', JSON.stringify(m))
  log(await cdp.eval('getComputedStyle(document.querySelector(".listpane")).display !== "none"'), '手机列表页可见')
  log(await cdp.eval('getComputedStyle(document.querySelector(".reader")).display === "none"'), '手机列表页隐藏阅读区')
  await cdp.shot('mobile-390-list')

  await cdp.eval('document.querySelector("[data-case=c11]").click()')
  await sleep(120)
  m = await overflow()
  log(m.sw <= m.iw, '手机阅读页无横向溢出', JSON.stringify(m))
  log(await cdp.eval('getComputedStyle(document.querySelector(".listpane")).display === "none"'), '手机点行后列表隐藏')
  log(await cdp.eval('getComputedStyle(document.querySelector("#mback")).display !== "none"'), '手机阅读页有返回')
  log(await cdp.eval('getComputedStyle(document.querySelector(".steps-row .exp")).display !== "none"'), '手机步骤保留预期结果')
  log(await cdp.eval('getComputedStyle(document.querySelector(".steps-row .exp"), "::before").content.includes("预期")'), '手机预期结果带「预期：」前缀')
  await cdp.shot('mobile-390-read')

  await cdp.eval('document.querySelector("#mback").click()')
  await sleep(120)
  log(await cdp.eval('getComputedStyle(document.querySelector(".listpane")).display !== "none"'), '手机返回后回到列表')

  /* 手机辅助栏堆叠 */
  await cdp.eval('document.querySelector("[data-case=c11]").click()')
  await sleep(100)
  log(await cdp.eval('getComputedStyle(document.querySelector(".r-cols")).gridTemplateColumns.split(" ").length === 1'), '手机辅助栏单列堆叠')

  log(errors.length === 0, '零控制台/页面错误', errors.slice(0, 4).join(' | '))
} catch (e) {
  console.error('ERROR', e)
  fail++
} finally {
  try { chrome.kill('SIGTERM') } catch {}
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
