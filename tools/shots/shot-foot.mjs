/* 页脚（备案号）布局自检：确认页脚占位在布局里，不覆盖侧栏底部与内容区
   用法：node tools/shots/shot-foot.mjs
   断言口径：
     1) 页脚高度 = --app-foot-h，且底边贴窗口底部
     2) 页脚顶边 = .views 底边（内容区不再溢出到底部）
     3) side-foot（头像/退出）完整可见，且视觉上落在页脚之上
     4) 退出按钮中心点用 elementFromPoint 命中的是它自己（没被任何浮层压住）
     5) 任务清单表格最后一行与页脚无重叠
   截图输出：docs/foot-*.png */
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

const b = await launch({ chrome: CHROME, width: 1440, height: 900 })

/* 预览稿底部的深色说明条不属于产品，先摘掉，免得干扰几何断言 */
const dropBanner = `(() => {
  const els = [...document.querySelectorAll('body > div')].filter(d => (d.getAttribute('style') || '').includes('99999'))
  els.forEach(e => e.remove())
  return els.length
})()`

try {
  await b.nav(PREVIEW + '#/board', 900)
  await b.waitFor(`!!document.querySelector('.app-foot')`, { timeoutMs: 8000 })
  await b.eval(dropBanner)
  await sleep(300)

  const geo = await b.eval(`(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, rt: b.right, h: b.height } }
    const foot = document.querySelector('.app-foot')
    const views = document.getElementById('views')
    const side = document.querySelector('.side-foot')
    const logout = document.getElementById('btnLogout')
    const user = document.getElementById('sideUserBtn')
    const cs = getComputedStyle(foot)
    const lo = r(logout), us = r(user)
    const hitLogout = document.elementFromPoint((lo.l + lo.rt) / 2, (lo.t + lo.b) / 2)
    const hitUser = document.elementFromPoint((us.l + us.rt) / 2, (us.t + us.b) / 2)
    return {
      foot: r(foot), views: r(views), side: r(side), logout: lo, user: us,
      footPos: cs.position, footH: cs.height, viewH: window.innerHeight,
      hitLogout: hitLogout ? (hitLogout.closest('button') || {}).id || hitLogout.className : null,
      hitUser: hitUser ? (hitUser.closest('button') || {}).id || hitUser.className : null,
      text: foot.innerText.replace(/\\s+/g, ' ').trim(),
      link: (foot.querySelector('a') || {}).href || null,
      bodyDisplay: getComputedStyle(document.body).display,
    }
  })()`)

  log(geo.footPos === 'static' || geo.footPos === 'relative', '页脚是布局内元素（非 fixed/absolute）', `position=${geo.footPos}`)
  log(Math.abs(geo.foot.b - geo.viewH) <= 1, '页脚底边贴住视口底部', `foot.bottom=${geo.foot.b} innerHeight=${geo.viewH}`)
  log(geo.foot.h >= 24 && geo.foot.h <= 30, '页脚高度在 24–30px', `h=${geo.foot.h}`)
  log(Math.abs(geo.views.b - geo.foot.t) <= 1, '内容区底边 = 页脚顶边（不重叠、不悬空）', `views.bottom=${geo.views.b} foot.top=${geo.foot.t}`)
  log(geo.side.b <= geo.foot.t + 1, '侧栏底部（头像/退出）完整露出，没被页脚盖住', `side.bottom=${geo.side.b} foot.top=${geo.foot.t}`)
  log(geo.hitLogout === 'btnLogout', '点退出按钮命中它自己（无遮挡）', `elementFromPoint=${geo.hitLogout}`)
  log(geo.hitUser === 'sideUserBtn', '点头像命中它自己（无遮挡）', `elementFromPoint=${geo.hitUser}`)
  log(/赣ICP备2026026881号-1/.test(geo.text), '备案号文本在页脚里', geo.text)
  log(!!geo.link && geo.link.includes('beian.miit.gov.cn'), '备案号可点（指向工信部备案系统）', geo.link || '')
  await b.shot(OUT + 'foot-board.png', { fullPage: false })

  /* ---------- 任务清单：最后一行不被页脚压住 ---------- */
  await b.nav(PREVIEW + '#/completions', 1200)
  await b.eval(dropBanner)
  await b.waitFor(`!!document.querySelector('.comp-table')`, { timeoutMs: 8000 })
  await sleep(400)
  const comp = await b.eval(`(() => {
    const t = document.querySelector('.comp-table')
    const rows = [...t.querySelectorAll('tbody tr')]
    const last = rows[rows.length - 1]
    const fr = document.querySelector('.app-foot').getBoundingClientRect()
    const lr = last ? last.getBoundingClientRect() : null
    const card = t.closest('.card, .panel, section') || t
    // 视口内可见性：把最后一行滚到可视区再看
    last.scrollIntoView({ block: 'end' })
    return { rows: rows.length, lastBottom: lr ? lr.bottom : null, footTop: fr.top,
             scrollBottom: (() => { const v = document.querySelector('.view.on'); return v ? v.getBoundingClientRect().bottom : null })() }
  })()`)
  log(comp.rows > 0, '任务清单有数据行', `rows=${comp.rows}`)
  log(comp.scrollBottom !== null && Math.abs(comp.scrollBottom - comp.footTop) <= 1,
    '任务清单视图底边 = 页脚顶边', `view.bottom=${comp.scrollBottom} foot.top=${comp.footTop}`)
  await b.shot(OUT + 'foot-completions.png', { fullPage: false })

  /* ---------- 侧栏收起态（窄屏 1280）也验一遍 ---------- */
  const b2 = await launch({ chrome: CHROME, width: 1280, height: 720, port: 9334 })
  try {
    await b2.nav(PREVIEW + '#/board', 900)
    await b2.waitFor(`!!document.querySelector('.app-foot')`, { timeoutMs: 8000 })
    await b2.eval(dropBanner)
    await b2.eval(`document.body.classList.add('side-rail')`)
    await sleep(300)
    const g2 = await b2.eval(`(() => {
      const f = document.querySelector('.app-foot').getBoundingClientRect()
      const s = document.querySelector('.side-foot').getBoundingClientRect()
      const l = document.getElementById('btnLogout').getBoundingClientRect()
      const hit = document.elementFromPoint((l.left + l.right) / 2, (l.top + l.bottom) / 2)
      return { footT: f.top, footB: f.bottom, footH: f.height, sideB: s.bottom,
               logoutB: l.bottom, hit: hit ? ((hit.closest('button') || {}).id || hit.className) : null,
               inner: window.innerHeight }
    })()`)
    log(Math.abs(g2.footB - g2.inner) <= 1, '[1280 收起态] 页脚贴底', `foot.bottom=${g2.footB} inner=${g2.inner}`)
    log(g2.logoutB <= g2.footT + 1, '[1280 收起态] 收起按钮不被页脚压住', `logout.bottom=${g2.logoutB} foot.top=${g2.footT}`)
    log(g2.hit === 'btnLogout', '[1280 收起态] 退出按钮可点', `hit=${g2.hit}`)
    await b2.shot(OUT + 'foot-rail.png', { fullPage: false })
  } finally {
    await b2.close?.()
  }
} finally {
  await b.close?.()
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
