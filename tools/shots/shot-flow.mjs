import { launch } from 'file:///C:/Users/chenghongchang/.workbuddy/skills/browser-cdp-ui-check/scripts/cdp.mjs'
import { pathToFileURL } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PREVIEW = pathToFileURL('docs/preview/ui-preview.html').href
const OUT = 'docs/images/'

const b = await launch({ chrome: CHROME, width: 1440, height: 900 })
let pass = 0, fail = 0
const log = (ok, name, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : ''))
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

try {
  await b.nav(PREVIEW + '#/flow', 900)
  await b.waitFor(`document.querySelectorAll('#flowInsights .flow-ins').length > 0`, { timeoutMs: 15000 })
  await sleep(400)

  await b.shot(OUT + '_shot_flow.png', { fullPage: false })
  /* 视图区滚动容器是 .view 不是 window，fullPage 截不到下半屏 —— 先滚到底再补一张 */
  await b.eval(`(() => {
    const v = document.getElementById('view-analysis')
    if (v) v.scrollTop = v.scrollHeight
  })()`)
  await sleep(400)
  await b.shot(OUT + '_shot_flow_bottom.png', { fullPage: false })

  /* ---------- 1. 侧栏入口（流程体检已并入「报表」页的子导航） ---------- */
  const nav = await b.eval(`(() => {
    const el = document.querySelector('.nav-item[data-view="insight"]')
    const sub = document.querySelector('#subNav [data-sub-tab="flow"]')
    return { exists: !!el, text: el ? el.textContent.trim() : null,
             active: el ? el.classList.contains('on') : false,
             subActive: sub ? sub.classList.contains('on') : false }
  })()`)
  log(nav.exists && nav.text === '报表', '侧栏有「报表」入口', JSON.stringify(nav))
  log(nav.active && nav.subActive, '进入流程体检后「报表」与子导航同时高亮')

  /* ---------- 2. 结论区 ---------- */
  const ins = await b.eval(`(() => {
    const list = [...document.querySelectorAll('#flowInsights .flow-ins')]
    return {
      count: list.length,
      titles: list.map(x => x.querySelector('.fi-t').innerText),
      levels: list.map(x => (x.className.match(/flow-ins (\\w+)/) || [])[1]),
      hasText: list.every(x => (x.querySelector('.fi-x') || {}).innerText?.length > 5),
      note: (document.getElementById('flowCoverage') || {}).innerText || ''
    }
  })()`)
  log(ins.count === 4, '渲染出 4 条体检结论', JSON.stringify(ins.titles))
  log(ins.hasText, '每条结论都有说明文字')
  log(ins.levels.every(l => ['warn', 'good', 'info'].includes(l)), '结论带严重度样式', ins.levels.join(','))
  log(ins.note.indexOf('44') >= 0, '显示数据覆盖率说明', ins.note.slice(0, 40) + '…')

  /* ---------- 3. KPI ---------- */
  const kpi = await b.eval(`(() => {
    const cards = [...document.querySelectorAll('#flowKpi .stat')]
    return { count: cards.length,
             keys: cards.map(c => c.querySelector('.k').innerText),
             vals: cards.map(c => c.querySelector('.v').innerText.trim()) }
  })()`)
  log(kpi.count === 4, '4 张 KPI 卡', kpi.keys.join(' / '))
  log(kpi.vals[0] === '待处理' || kpi.vals[0].indexOf('待处理') >= 0, '瓶颈列卡显示列名', kpi.vals[0])
  log(kpi.vals[1].indexOf('60%') >= 0, '一次通过率 60%', kpi.vals[1])

  /* ---------- 4. 列停留条 ---------- */
  const bars = await b.eval(`(() => {
    const list = [...document.querySelectorAll('#flowBars .flow-bar')]
    return {
      count: list.length,
      names: list.map(x => x.querySelector('.fb-name').innerText.trim()),
      widths: list.map(x => { const i = x.querySelector('.bar > i'); return i ? i.style.width : null }),
      bnCount: list.filter(x => x.classList.contains('is-bn')).length,
      ongoingTexts: list.map(x => x.querySelectorAll('.fb-meta span')[1].innerText),
      zeroWidth: list.filter(x => x.querySelector('.bar > i').style.width === '0%').length
    }
  })()`)
  log(bars.count === 3, '三列都有停留条', JSON.stringify(bars.names))
  log(bars.bnCount === 1, '只有一个瓶颈标记', String(bars.bnCount))
  log(bars.widths[0] === '100%', '瓶颈列条形最长（100%）', bars.widths.join(','))
  log(bars.widths[2] === '1%' || bars.widths[2] === '0%', '无停留的列条形接近 0', bars.widths[2])
  log(bars.ongoingTexts[0].indexOf('8 个在制') >= 0, '显示当前在制任务数', bars.ongoingTexts[0])

  /* ---------- 5. 返工 / 优先级 ---------- */
  const rwk = await b.eval(`(() => {
    const rows = [...document.querySelectorAll('#flowRework .dist-row')]
    return { rows: rows.length, texts: rows.map(r => r.innerText.replace(/\\s+/g, ' ').trim()) }
  })()`)
  log(rwk.rows === 3, '返工面板三行（移动/回退/一次通过）', JSON.stringify(rwk.texts))
  log(rwk.texts[1].indexOf('20%') >= 0, '回退率 20%', rwk.texts[1])

  const prio = await b.eval(`(() => {
    const rows = [...document.querySelectorAll('#flowPriority .dist-row')]
    return { rows: rows.length, texts: rows.map(r => r.innerText.replace(/\\s+/g, ' ').trim()) }
  })()`)
  log(prio.rows === 3, '优先级面板三行', JSON.stringify(prio.texts))
  log(prio.texts[0].indexOf('3.2') >= 0, 'P0 平均移动 3.2 次', prio.texts[0])

  /* ---------- 6. 需求面板 ---------- */
  const req = await b.eval(`(() => {
    const cards = [...document.querySelectorAll('#flowReqs .stat')]
    const orphans = [...document.querySelectorAll('#flowReqs .flow-orphans .done-item')]
    return { cards: cards.length, orphans: orphans.length,
             meta: (document.getElementById('flowReqMeta') || {}).innerText,
             firstOrphan: orphans.length ? orphans[0].innerText.replace(/\\s+/g, ' ').trim() : null,
             clickable: orphans.length ? !!orphans[0].querySelector('[data-open-reqdoc]') : false }
  })()`)
  log(req.cards === 4, '需求区 4 张统计卡', String(req.cards))
  log(req.meta === '3 / 5 份已开工', '显示开工率', req.meta)
  log(req.orphans === 2 && req.clickable, '列出未拆任务的需求且可点击', req.firstOrphan)

  /* ---------- 7. 布局不溢出 ---------- */
  const layout = await b.eval(`(() => {
    const v = document.getElementById('view-analysis')
    const over = [...v.querySelectorAll('*')].filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
    }).map(el => el.className || el.tagName)
    return { overflowCount: over.length, samples: over.slice(0, 5),
             hScroll: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })()`)
  log(layout.overflowCount === 0 && !layout.hScroll, '无横向溢出', JSON.stringify(layout.samples))

  /* ---------- 8. 切换范围会重新取数 ---------- */
  const daysBefore = await b.eval(`document.getElementById('flowRange').innerText`)
  await b.eval(`(() => {
    const s = document.getElementById('flowDays')
    s.value = '30'
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(600)
  const daysAfter = await b.eval(`document.getElementById('flowRange').innerText`)
  log(daysBefore.indexOf('90') >= 0 && daysAfter.indexOf('30') >= 0, '切换统计范围会刷新口径文案',
    daysBefore + ' -> ' + daysAfter)
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  await b.close()
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
