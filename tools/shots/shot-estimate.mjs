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
  /* ==================== 1. 看板卡片：实际/预估 ==================== */
  await b.nav(PREVIEW + '#/board', 1000)
  await b.waitFor(`!!document.querySelector('.card[data-id="K1"]')`, { timeoutMs: 15000 })
  await sleep(500)

  const chips = await b.eval(`(() => {
    const k1 = document.querySelector('.card[data-id="K1"]')
    const chip = k1 ? k1.querySelector('.est-chip') : null
    const k2 = document.querySelector('.card[data-id="K2"]')
    const chip2 = k2 ? k2.querySelector('.est-chip') : null
    const plain = document.querySelector('.card[data-id="B1"] .meta')
    return {
      k1Text: chip ? chip.textContent.trim() : null,
      k1Over: chip ? chip.classList.contains('over') : false,
      k1Title: chip ? chip.getAttribute('title') : null,
      k2Text: chip2 ? chip2.textContent.trim() : null,
      k2Near: chip2 ? chip2.classList.contains('near') : false
    }
  })()`)
  log(chips.k1Text === '8h40m/8h', '卡片显示「实际/预估」', chips.k1Text)
  log(chips.k1Over, '已超预估的卡片标红')
  log((chips.k1Title || '').indexOf('实际 8 小时 40 分') >= 0, '悬浮提示给出完整耗时', chips.k1Title)
  log(chips.k2Text === '3h20m/4h' && chips.k2Near, '接近预估的卡片标黄', chips.k2Text)

  await b.shot(OUT + '_shot_est_card.png', { fullPage: false })

  /* ==================== 2. 任务抽屉：录入与实时比例 ==================== */
  await b.eval(`document.querySelector('.card[data-id="K1"]').click()`)
  await b.waitFor(`!document.getElementById('taskDrawer').hidden`, { timeoutMs: 8000 }).catch(()=>{})
  await sleep(600)

  const drawer = await b.eval(`(() => {
    const est = document.getElementById('iEstimate')
    const act = document.getElementById('iActual')
    return {
      hasEst: !!est,
      estValue: est ? est.value : null,
      actText: act ? act.textContent.replace(/\\s+/g, ' ').trim() : null,
      actClass: act ? act.className : null,
      unit: (document.querySelector('.est-unit') || {}).textContent
    }
  })()`)
  log(drawer.hasEst, '抽屉里有「预计耗时」输入')
  log(drawer.estValue === '8', '预估从分钟回填成小时', drawer.estValue)
  log(drawer.unit === '小时', '单位标注为小时', drawer.unit)
  log((drawer.actText || '').indexOf('108%') >= 0, '实际投入显示消耗比例', drawer.actText)
  log((drawer.actClass || '').indexOf('over') >= 0, '超过预估时实际投入标红', drawer.actClass)

  /* 改预估 → 比例实时变，且不再超 */
  await b.eval(`(() => {
    const est = document.getElementById('iEstimate')
    est.value = '12'
    est.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(250)
  const after = await b.eval(`(() => {
    const act = document.getElementById('iActual')
    return { text: act.textContent.replace(/\\s+/g, ' ').trim(), cls: act.className }
  })()`)
  log(after.text.indexOf('72%') >= 0, '改预估后比例实时更新', after.text)
  log(after.cls.indexOf('over') < 0 && after.cls.indexOf('near') < 0, '不再标红/标黄', after.cls)

  /* 清空预估 → 提示还没填 */
  await b.eval(`(() => {
    const est = document.getElementById('iEstimate')
    est.value = ''
    est.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(200)
  const cleared = await b.eval(`document.getElementById('iActual').textContent.replace(/\\s+/g,' ').trim()`)
  log(cleared.indexOf('还没填预估') >= 0, '清空预估后给出提示', cleared)

  await b.shot(OUT + '_shot_est_drawer.png', { fullPage: false })

  /* ==================== 3. 流程体检 · 估时准不准 ==================== */
  /* 先收起抽屉：否则它会盖住半个页面，截图和几何断言都不准 */
  await b.eval(`(() => {
    const d = document.getElementById('taskDrawer')
    if(d){ d.classList.remove('open'); d.hidden = true }
  })()`)
  await sleep(200)
  await b.nav(PREVIEW + '#/flow', 1000)
  await b.waitFor(`!!document.querySelector('#flowEstTop .fe-factor')`, { timeoutMs: 15000 })
  await sleep(400)

  const est = await b.eval(`(() => {
    const top = document.getElementById('flowEstTop')
    const bars = [...top.querySelectorAll('.fe-bar i')].map(i => i.style.width)
    const risk = [...document.querySelectorAll('#flowEstRisk .done-item')]
    const tags = risk.map(r => (r.querySelector('.ai-tag') || {}).textContent || '')
    return {
      factor: (top.querySelector('.fe-factor .big') || {}).textContent,
      factorCls: (top.querySelector('.fe-factor') || {}).className,
      dist: (top.querySelector('.fe-dist') || {}).textContent.replace(/\\s+/g, ' ').trim(),
      sugg: (top.querySelector('.fe-sug') || {}).textContent.slice(0, 30),
      bars,
      riskCount: risk.length,
      tags,
      meta: (document.getElementById('flowEstMeta') || {}).textContent,
      note: (document.getElementById('flowEstNote') || {}).textContent,
      overflow: [...document.querySelectorAll('#view-flow *')].filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
      }).length
    }
  })()`)
  log(est.factor === '1.42×', '系数大数字', est.factor)
  log(est.factorCls.indexOf('warn') >= 0, '偏乐观时系数标警告色', est.factorCls)
  log(est.dist.indexOf('低估 3') >= 0 && est.dist.indexOf('样本 4') >= 0, '偏差分布计数', est.dist)
  log(est.sugg.indexOf('偏乐观') >= 0, '给出可执行的建议', est.sugg)
  log(est.bars.length === 3 && est.bars.some(w => w !== '0%'), '三段分布条有宽度', est.bars.join('/'))
  log(est.riskCount === 4, '预警 2 条 + 复盘 2 条共 4 行', String(est.riskCount))
  log(est.tags.join(',').indexOf('已超预估') >= 0 && est.tags.join(',').indexOf('接近预估') >= 0,
    '标签区分「已超」与「接近」', est.tags.join(','))
  log(est.meta.indexOf('7 / 13') >= 0, '显示预估覆盖率', est.meta)
  log(est.note.indexOf('开始日期') >= 0, '口径说明点明不用开始日期推算', est.note.slice(0, 40) + '…')
  log(est.overflow === 0, '无横向溢出', String(est.overflow))

  /* 滚到估时区块再截一张 */
  await b.eval(`(() => {
    const p = document.getElementById('flowEstTop')
    if(p && p.scrollIntoView) p.scrollIntoView({block: 'center'})
  })()`)
  await sleep(400)
  await b.shot(OUT + '_shot_est_flow.png', { fullPage: false })
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  await b.close()
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
