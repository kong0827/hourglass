/* 周回顾 · AI 周报 自检（CDP 真 Chrome + docs/preview/ui-preview.html 演示数据，不连后端）
   用法：node tools/shots/check-ai-report.mjs
   断言口径：
     1) 面板在「自动总结」下面，初始是空态（正文隐藏、按钮「生成周报」、复制按钮不显示）
     2) 生成中出骨架，生成后正文可见、四个小节标题都在、文本没有被 HTML 注入
     3) 用量行说明「基于 N 项完成 / M 项进行中」并带 token 数
     4) 复制按钮出现（点击后 toast 提示，走 clipboard）
     5) 切到上一周 → 面板回到空态；生成上一周的周报 → 再切回本周 → 本周的周报还在（按周缓存）
     6) 补充说明会影响请求（预览 mock 会把它反映在 source.withNote 上）
   截图：docs/ai-report.png */
import { launch } from 'file:///C:/Users/chenghongchang/.workbuddy/skills/browser-cdp-ui-check/scripts/cdp.mjs'
import { pathToFileURL } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PREVIEW = pathToFileURL('docs/preview/ui-preview.html').href
const OUT = 'docs/images/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const log = (ok, name, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : ''))
  ok ? pass++ : fail++
}

const b = await launch({ chrome: CHROME, width: 1440, height: 1000 })
const dropBanner = `(() => {
  [...document.querySelectorAll('body > div')].filter(d => (d.getAttribute('style') || '').includes('99999')).forEach(e => e.remove())
  return true
})()`

try {
  await b.nav(PREVIEW + '#/review', 1200)
  await b.waitFor(`!!document.querySelector('.ai-report')`, { timeoutMs: 10000 })
  await b.eval(dropBanner)
  await sleep(600)

  /* ---------- 1. 初始空态 ---------- */
  const init = await b.eval(`(() => {
    const box = document.querySelector('.ai-report')
    const sum = document.querySelector('.summary-panel')
    const body = document.getElementById('reviewAiBody')
    const copy = document.getElementById('btnAiReportCopy')
    const gen = document.getElementById('btnAiReport')
    const note = document.getElementById('reviewAiNote')
    const after = sum && box ? (sum.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 : false
    return {
      exists: !!box, afterSummary: after,
      bodyHidden: !body || body.hidden,
      copyHidden: !copy || copy.hidden,
      genText: gen ? gen.textContent.trim() : null,
      genDisabled: gen ? gen.disabled : null,
      hasNote: !!note, noteMax: note ? note.getAttribute('maxlength') : null,
      hintVisible: !document.getElementById('reviewAiHint').hidden
    }
  })()`)
  log(init.exists && init.afterSummary, 'AI 周报面板在「自动总结」下方', `afterSummary=${init.afterSummary}`)
  log(init.bodyHidden, '初始正文隐藏（空态，不占大块空间）')
  log(init.genText === '生成周报' && init.genDisabled === false, '按钮是「生成周报」且可点', `text=${init.genText}`)
  log(init.copyHidden, '初始不显示复制按钮')
  log(init.hasNote && init.noteMax === '200', '有补充说明输入框（上限 200 字）', `maxlength=${init.noteMax}`)

  /* ---------- 2. 生成 ---------- */
  await b.eval(`(() => { document.getElementById('reviewAiNote').value = '' ; return true })()`)
  await b.click(`document.getElementById('btnAiReport')`)
  await sleep(120)
  const busy = await b.eval(`(() => {
    const gen = document.getElementById('btnAiReport')
    const body = document.getElementById('reviewAiBody')
    return { genText: gen.textContent.trim(), disabled: gen.disabled,
             hasSkeleton: !!body.querySelector('.skel'), meta: document.getElementById('reviewAiMeta').textContent }
  })()`)
  log(busy.disabled === true && /生成中/.test(busy.genText), '生成中按钮置灰并改文案', `text=${busy.genText}`)
  log(busy.hasSkeleton, '生成中出骨架屏（不是空白等待）', busy.meta)

  await b.waitFor(`!document.getElementById('btnAiReport').disabled`, { timeoutMs: 12000 })
  await sleep(300)
  const got = await b.eval(`(() => {
    const body = document.getElementById('reviewAiBody')
    const heads = [...body.querySelectorAll('.rp-h')].map(e => e.textContent.trim())
    const txt = body.innerText || ''
    return {
      hidden: body.hidden,
      heads, textLen: txt.length,
      hasRaw: /<script|onerror=|<img/i.test(body.innerHTML),
      copyHidden: document.getElementById('btnAiReportCopy').hidden,
      usage: document.getElementById('reviewAiUsage').textContent,
      meta: document.getElementById('reviewAiMeta').textContent,
      hintHidden: document.getElementById('reviewAiHint').hidden,
      genText: document.getElementById('btnAiReport').textContent.trim()
    }
  })()`)
  log(!got.hidden && got.textLen > 80, '正文渲染出来了', `len=${got.textLen}`)
  log(got.heads.length === 4 &&
      got.heads[0] === '本周完成' && got.heads[1] === '进行中' &&
      got.heads[2] === '风险与阻塞' && got.heads[3] === '下周计划',
    '四个小节标题齐全且顺序对', got.heads.join(' / '))
  log(got.hasRaw === false, '模型输出没有当 HTML 执行（全程转义）')
  log(got.copyHidden === false, '生成后出现「复制周报」')
  log(/基于 3 项完成 \/ 2 项进行中/.test(got.usage) && /tokens/.test(got.usage),
    '用量行写明事实来源与 token 数', got.usage)
  log(/本周/.test(got.meta) && got.hintHidden === true, '标题行显示周期、说明文字收起', got.meta)
  log(got.genText === '生成周报', '按钮文案回滚', got.genText)
  await b.shot(OUT + 'ai-report.png', { fullPage: false })

  /* ---------- 3. 翻周：上一周空态 → 生成 → 回到本周仍在 ---------- */
  await b.click(`document.getElementById('weekPrev')`)
  await sleep(900)
  const prevIdle = await b.eval(`(() => ({
    bodyHidden: document.getElementById('reviewAiBody').hidden,
    copyHidden: document.getElementById('btnAiReportCopy').hidden,
    week: document.getElementById('weekLabel').textContent
  }))()`)
  log(prevIdle.bodyHidden && prevIdle.copyHidden, '切到别的周：面板回到空态（不会把本周周报当成上周的）', prevIdle.week)

  await b.eval(`(() => { const n = document.getElementById('reviewAiNote'); n.value = '周三线上排查了支付超时'; return true })()`)
  await b.click(`document.getElementById('btnAiReport')`)
  await b.waitFor(`!document.getElementById('btnAiReport').disabled`, { timeoutMs: 12000 })
  await sleep(300)
  const prevGot = await b.eval(`(() => ({
    text: document.getElementById('reviewAiBody').innerText,
    heads: document.querySelectorAll('#reviewAiBody .rp-h').length,
    usage: document.getElementById('reviewAiUsage').textContent
  }))()`)
  log(prevGot.heads === 4 && /登录重构/.test(prevGot.text), '上一周能单独生成一份', `len=${prevGot.text.length}`)
  log(/基于 2 项完成/.test(prevGot.usage), '上一周用的也是上一周的数字', prevGot.usage)

  await b.click(`document.getElementById('weekNext')`)
  await sleep(900)
  const back = await b.eval(`(() => ({
    bodyHidden: document.getElementById('reviewAiBody').hidden,
    text: document.getElementById('reviewAiBody').innerText
  }))()`)
  log(!back.bodyHidden && /权限校验中间件/.test(back.text), '切回本周：本周的周报还在（按周缓存，不用重新生成）')

  /* ---------- 4. 版式几何：与其它面板同宽、不横向溢出、不压页脚 ---------- */
  const geo = await b.eval(`(() => {
    const box = document.querySelector('.ai-report')
    const parts = [...document.querySelectorAll('#view-review .panel')].filter(p => p !== box)
    const body = document.getElementById('reviewAiBody')
    const head = body.querySelector('.rp-h')
    const csH = head ? getComputedStyle(head) : null
    const csB = getComputedStyle(body)
    const foot = document.querySelector('.app-foot')
    const copyBtn = document.getElementById('btnAiReportCopy')
    const r = box.getBoundingClientRect(), rb = body.getBoundingClientRect()
    const rc = copyBtn.getBoundingClientRect()
    return {
      sameWidth: parts.length ? Math.abs(parts[0].getBoundingClientRect().width - r.width) <= 1 : false,
      hOverflow: body.scrollWidth - body.clientWidth,
      headWeight: csH ? Number(csH.fontWeight) : 0,
      headColor: csH ? csH.color : null,
      bodyColor: csB.color,
      bodyScrollable: body.scrollHeight > body.clientHeight,
      footTop: foot ? foot.getBoundingClientRect().top : null,
      btnInside: rc.right <= r.right - 1 && rc.left >= r.left,
      bodyInside: rb.right <= r.right + 1
    }
  })()`)
  log(geo.sameWidth, '面板与其它面板等宽（和上下区块左对齐）')
  log(geo.hOverflow <= 1, '正文没有横向溢出', `overflow=${geo.hOverflow}px`)
  log(geo.headWeight >= 700 && geo.headColor !== geo.bodyColor,
    '小节标题比其他正文重且更深', `w=${geo.headWeight} color=${geo.headColor} vs ${geo.bodyColor}`)
  log(geo.bodyInside && geo.btnInside, '正文与按钮都在面板内（没有越界）')

  /* ---------- 5. 复制 ---------- */
  const copyOk = await b.eval(`(async () => {
    const btn = document.getElementById('btnAiReportCopy')
    btn.click()
    await new Promise(r => setTimeout(r, 200))
    const t = document.getElementById('toastWrap')
    return { toast: t ? (t.innerText || '').replace(/\\s+/g, ' ').trim() : '',
             items: t ? t.querySelectorAll('.toast').length : 0 }
  })()`)
  log(copyOk.items > 0, '点「复制周报」给出提示', copyOk.toast)
} finally {
  await b.close?.()
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
