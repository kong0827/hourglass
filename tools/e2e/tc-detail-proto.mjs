/* 用例详情/执行页原型验证（Node 24 内置 fetch / WebSocket 驱动 CDP）
   用法：node tools/e2e/tc-detail-proto.mjs
   输出：docs/audit/prototypes/tc-detail-2026-11-15/*.png + 断言结果 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HTML = join(ROOT, 'docs/audit/prototypes/testcase-detail-proto-2026-11-15.html')
const OUT = join(ROOT, 'docs/audit/prototypes/tc-detail-2026-11-15')
const PORT = 9348
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

mkdirSync(OUT, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'hg-tc-detail-'))
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
    await cdp.waitFor('!!document.querySelector("#tcList .tc-row") || !!document.querySelector("#detail h2")')
    await sleep(150)
  }
  const overflow = async () => cdp.eval(`(() => ({ iw: innerWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, stage: document.getElementById('stage').getBoundingClientRect().width }))()`)

  /* ---------- 桌面 1440 ---------- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })
  await load('?capture=1')
  let m = await overflow()
  log(m.sw <= m.iw, '桌面列表无横向溢出', JSON.stringify(m))
  log(await cdp.eval('document.querySelectorAll(".tc-row").length') === 8, '列表 8 条用例')
  log(await cdp.eval('document.querySelectorAll("#stats .chip").length') === 6, '统计 chips 6 个')
  await cdp.shot('desktop-1440-list')

  /* 打开详情 */
  await cdp.eval('document.querySelector("[data-open=c13]").click()')
  await sleep(140)
  log(await cdp.eval('document.getElementById("listScreen").classList.contains("on") === false && document.getElementById("detailScreen").classList.contains("on")'), '点行进入详情页，列表隐藏')
  log((await cdp.eval('document.querySelector("#detail h2").textContent')).includes('E2E 执行链路'), '详情标题正确')
  log((await cdp.eval('document.querySelector("#detail .d-titlebox .st-pill").textContent')).includes('失败'), '详情状态为失败')
  log((await cdp.eval('document.querySelector("#detail .d-meta").textContent')).includes('TC-013'), '元信息含编号')
  log(await cdp.eval('!!document.querySelector("#detail .rail-tabs .rail-tab.on")'), '辅助栏默认执行记录')
  log(await cdp.eval('document.querySelectorAll("#detail .rail .rec").length') === 3, '执行记录 3 条')
  log(await cdp.eval('Array.from(document.querySelectorAll("#detail .d-acts button")).some(b => b.textContent.includes("重新执行"))'), '有编辑权限时出现重新执行')
  await cdp.shot('desktop-1440-detail')

  /* 辅助栏切换 */
  await cdp.eval('document.querySelector("[data-rail=bugs]").click()')
  await sleep(80)
  log(await cdp.eval('!!document.querySelector("#detail .bugcard")'), '辅助栏缺陷显示缺陷卡')
  await cdp.eval('document.querySelector("[data-rail=changes]").click()')
  await sleep(80)
  log(await cdp.eval('document.querySelectorAll("#detail .rail .tl-item").length >= 3'), '辅助栏变更显示时间线')
  await cdp.eval('document.querySelector("[data-dact=jump]").click()')
  await sleep(80)
  log(await cdp.eval('document.querySelector(".rail-tab.on").textContent.includes("执行记录")'), '「记录 3」跳回执行记录')

  /* 进入执行态 */
  await cdp.eval('document.querySelector("[data-dact=exec]").click()')
  await sleep(120)
  log(await cdp.eval('!!document.getElementById("execForm") && document.getElementById("stage").dataset.exec === "1"'), '重新执行切到本次执行表单')
  log(await cdp.eval('!!document.querySelector("#detail .exec-banner")'), '执行态显示轮次提示')
  log(await cdp.eval('document.querySelectorAll("#detail .steps-row").length === 3'), '执行态步骤仍可见')
  log(await cdp.eval('document.querySelectorAll("#detail [data-exec-status]").length === 4'), '结果四选一')
  log(await cdp.eval('document.getElementById("execEnv").value.includes("Chrome")'), '环境沿用上一轮')

  await cdp.eval('document.querySelector("[data-exec-status=failed]").click()')
  await sleep(80)
  log(await cdp.eval('document.querySelector("[data-exec-status=failed]").getAttribute("aria-pressed") === "true"'), '选失败后按钮态正确')
  await cdp.eval(`(() => { document.getElementById('execNote').value = '回归仍失败：幂等键未生效'; document.getElementById('execNote').dispatchEvent(new Event('input', {bubbles:true})); })()`)
  await cdp.eval('document.getElementById("evDrop").click()')
  await sleep(80)
  log(await cdp.eval('document.querySelectorAll("#detail .ev-chip").length === 1'), '证据加入待上传列表')
  log(await cdp.eval('document.getElementById("execNote").value.includes("幂等键")'), '切结果/加证据后备注保留')
  await sleep(1900)
  await cdp.shot('desktop-1440-exec')

  /* 提交 */
  await cdp.eval('document.getElementById("execSubmit").click()')
  await sleep(160)
  log(await cdp.eval('!document.getElementById("execForm") && document.getElementById("stage").dataset.exec === "0"'), '提交后回到阅读态')
  log((await cdp.eval('document.querySelector("#detail .d-titlebox .st-pill").textContent')).includes('失败'), '状态仍为失败')
  log(await cdp.eval('document.querySelectorAll("#detail .rail .rec").length === 4'), '执行记录新增为 4 条')
  log((await cdp.eval('document.querySelector("#detail .rail .rec").textContent')).includes('幂等键'), '最新记录显示本次备注')
  log((await cdp.eval('document.querySelector("#toast").textContent')).includes('已记录第 4 轮'), '提交后有成功提示')

  /* 返回列表 */
  await cdp.eval('document.querySelector("[data-dact=back]").click()')
  await sleep(100)
  log(await cdp.eval('document.getElementById("listScreen").classList.contains("on")'), '返回后回到列表')
  log((await cdp.eval('document.querySelector("[data-open=c13] .tc-meta").textContent')).includes('11-15 14:20'), '列表同步最近执行时间')

  /* 只读视角 */
  await cdp.eval('document.querySelector("[data-ro=\\"1\\"]").click()')
  await cdp.eval('document.querySelector("[data-open=c13]").click()')
  await sleep(120)
  log(await cdp.eval('!!document.querySelector("#detail .ro-pill")'), '查看者出现只读标记')
  log(!(await cdp.eval('Array.from(document.querySelectorAll("#detail .d-acts button")).some(b => b.textContent.includes("重新执行"))')), '查看者不显示重新执行')
  log(!(await cdp.eval('Array.from(document.querySelectorAll("#detail .d-acts button")).some(b => b.textContent.includes("编辑"))')), '查看者不显示编辑')
  await sleep(1900)
  await cdp.shot('desktop-1440-readonly')
  await cdp.eval('document.querySelector("[data-ro=\\"0\\"]").click()')
  await cdp.eval('document.querySelector("[data-dact=back]").click()')
  await sleep(100)

  /* 未执行用例 */
  await cdp.eval('document.querySelector("[data-open=c12]").click()')
  await sleep(100)
  log((await cdp.eval('document.querySelector("#detail .d-titlebox .st-pill").textContent')).includes('未执行'), 'TC-012 未执行')
  log((await cdp.eval('document.querySelector("#detail .rail-pane").textContent')).includes('还没有执行记录'), '未执行用例记录空态')
  log(await cdp.eval('Array.from(document.querySelectorAll("#detail .d-acts button")).some(b => b.textContent.includes("执行"))'), '未执行用例主操作是执行')
  await cdp.eval('document.querySelector("[data-dact=exec]").click()')
  await sleep(100)
  log((await cdp.eval('document.querySelector("#detail .exec-prev").textContent')).includes('首次执行'), '首次执行显示无上轮')
  await cdp.eval('document.querySelector("[data-dact=cancel]").click()')
  await sleep(80)
  log(!(await cdp.eval('!!document.getElementById("execForm")')), '取消执行回到阅读态')

  /* 标注 */
  await cdp.eval('document.querySelector("#annoChk").click()')
  await sleep(100)
  log(await cdp.eval('document.body.classList.contains("annotate") && document.querySelectorAll("#detail [data-anno]").length === 4'), '标注模式四处锚点')
  await sleep(1900)
  await cdp.shot('desktop-1440-anno')
  await cdp.eval('document.querySelector("#annoChk").click()')

  /* ---------- 平板 1024 ---------- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1100, deviceScaleFactor: 1, mobile: false })
  await load('?capture=1&device=tablet&page=detail&case=c11')
  m = await overflow()
  log(m.sw <= m.iw, '平板无横向溢出', JSON.stringify(m))
  log(await cdp.eval('getComputedStyle(document.querySelector("#detail .d-cols")).gridTemplateColumns.split(" ").length === 1'), '平板辅助栏收到正文下')
  await cdp.shot('tablet-1024-detail')

  /* ---------- 手机 390 ---------- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await load('?capture=1&device=mobile')
  m = await overflow()
  log(m.sw <= m.iw, '手机列表无横向溢出', JSON.stringify(m))
  await cdp.shot('mobile-390-list')

  await cdp.eval('document.querySelector("[data-open=c11]").click()')
  await sleep(140)
  m = await overflow()
  log(m.sw <= m.iw, '手机详情无横向溢出', JSON.stringify(m))
  log(await cdp.eval('getComputedStyle(document.querySelector("#detail .d-back")).display !== "none"'), '手机详情有返回列表')
  log(await cdp.eval('getComputedStyle(document.querySelector("#detail .steps-row .exp")).display !== "none"'), '手机步骤保留预期结果')
  log(await cdp.eval('getComputedStyle(document.querySelector("#detail .steps-row .exp"), "::before").content.includes("预期")'), '手机预期结果带「预期：」前缀')
  await cdp.shot('mobile-390-detail')

  await cdp.eval('document.querySelector("[data-dact=exec]").click()')
  await sleep(140)
  m = await overflow()
  log(m.sw <= m.iw, '手机执行态无横向溢出', JSON.stringify(m))
  log(await cdp.eval('(() => { const r = document.querySelector("#detail .rail").getBoundingClientRect(); const b = document.querySelector("#detail .d-body").getBoundingClientRect(); return r.top < b.top; })()'), '手机执行表单排在步骤上方')
  await cdp.shot('mobile-390-exec')

  await cdp.eval('document.querySelector("[data-dact=cancel]").click()')
  await sleep(80)
  await cdp.eval('document.querySelector("[data-dact=back]").click()')
  await sleep(120)
  log(await cdp.eval('document.getElementById("listScreen").classList.contains("on")'), '手机返回后回到列表')
  log(await cdp.eval('getComputedStyle(document.querySelector("#detailScreen")).display === "none"'), '手机列表页隐藏详情')

  log(errors.length === 0, '零控制台/页面错误', errors.slice(0, 4).join(' | '))
} catch (e) {
  console.error('ERROR', e)
  fail++
} finally {
  try { chrome.kill('SIGTERM') } catch {}
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
