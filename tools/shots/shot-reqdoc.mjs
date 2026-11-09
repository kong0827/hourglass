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
  await b.nav(PREVIEW + '#/requirements', 700)
  await b.waitFor(`!!document.querySelector('.reqdoc-row')`, { timeoutMs: 12000 })
  await b.click(`document.querySelector('.reqdoc-row')`)
  await b.waitFor(`!!document.querySelector('.sun-editor-editable table')`, { timeoutMs: 15000 })
  await sleep(600)

  /* ---------- 1. 边框彻底清零 ---------- */
  const box = await b.eval(`(() => {
    const q = s => document.querySelector('.reqdoc-editbody ' + s)
    const cs = el => el ? getComputedStyle(el) : null
    const sun = cs(q('.sun-editor')), tb = cs(q('.se-toolbar')),
          ct = cs(q('.se-container')), wr = cs(q('.se-wrapper'))
    return {
      sunBorder: sun ? sun.borderTopWidth : null,
      sunOutline: sun ? sun.outlineStyle : null,
      sunBg: sun ? sun.backgroundColor : null,
      tbBorder: tb ? tb.borderTopWidth : null,
      tbOutline: tb ? tb.outlineStyle : null,
      tbBg: tb ? tb.backgroundColor : null,
      ctBorder: ct ? ct.borderTopWidth : null,
      wrBorder: wr ? wr.borderTopWidth : null
    }
  })()`)
  log(box.sunBorder === '0px' && box.ctBorder === '0px' && box.wrBorder === '0px',
    '编辑器外框 border 全为 0', JSON.stringify(box))
  log(box.sunOutline === 'none' && box.tbOutline === 'none',
    '外框与工具条 outline 为 none（不再描边）', `outline-style=${box.sunOutline}/${box.tbOutline}`)
  log(((box.sunBg || '').indexOf('rgba(0, 0, 0, 0)') >= 0 || box.sunBg === 'transparent') &&
      ((box.tbBg || '').indexOf('rgba(0, 0, 0, 0)') >= 0 || box.tbBg === 'transparent'),
    '编辑器与工具条背景透明（不是白方块）', `bg=${box.sunBg} / ${box.tbBg}`)

  /* ---------- 2. 大纲渲染 ---------- */
  const toc = await b.eval(`(() => {
    const items = [...document.querySelectorAll('#reqDocTocBody .rt-item')]
    const tocEl = document.getElementById('reqDocToc')
    const r = tocEl ? tocEl.getBoundingClientRect() : null
    return {
      count: items.length,
      levels: items.slice(0, 12).map(i => (i.className.match(/rt-lv(\\d)/) || [])[1]),
      hasCaret: !!document.querySelector('#reqDocTocBody [data-toc-fold]'),
      active: (document.querySelector('#reqDocTocBody .rt-item.active') || {}).innerText || null,
      tocVisible: !!r && r.width > 100 && r.top >= 0 && r.top < window.innerHeight
    }
  })()`)
  log(toc.count >= 8, '大纲按标题生成条目', `count=${toc.count}`)
  log(toc.levels.indexOf('2') >= 0 && toc.levels.indexOf('3') >= 0, '大纲有多级缩进', `levels=${toc.levels.join(',')}`)
  log(toc.hasCaret, '有子项的分组带折叠箭头')
  log(!!toc.active, '当前章节高亮', `active=${toc.active}`)
  log(toc.tocVisible, '大纲面板在可视区内')

  await b.shot(OUT + '_shot_reqdoc_edit.png', { fullPage: false })

  /* ---------- 3. 点击跳转 + 滚动高亮 ---------- */
  /* 视图区的滚动发生在 .view 容器上，不是 window */
  const beforeY = await b.eval(`(() => {
    let el = document.getElementById('reqDocEditPage')
    while (el && el !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el.scrollTop
      el = el.parentElement
    }
    return window.scrollY
  })()`)
  await b.click(`[...document.querySelectorAll('#reqDocTocBody .rt-item')].find(e => e.innerText.includes('上线步骤'))`)
  await sleep(1000)
  const after = await b.eval(`(() => {
    let el = document.getElementById('reqDocEditPage')
    while (el && el !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return { y: el.scrollTop, active: (document.querySelector('#reqDocTocBody .rt-item.active') || {}).innerText || null }
      el = el.parentElement
    }
    return { y: window.scrollY, active: (document.querySelector('#reqDocTocBody .rt-item.active') || {}).innerText || null }
  })()`)
  log(after.y > beforeY + 100, '点目录跳转到对应章节', `scrollTop ${beforeY} -> ${after.y}`)
  log(!!after.active && after.active.indexOf('上线步骤') >= 0, '跳转后高亮跟着走', `active=${after.active}`)
  /* 截图要趁跳转后马上拍：后面点按钮时 click() 会 scrollIntoView 把容器滚回顶部 */
  await b.shot(OUT + '_shot_reqdoc_toc.png', { fullPage: false })

  /* ---------- 4. 折叠子项 ---------- */
  const foldBefore = await b.eval(`document.querySelectorAll('#reqDocTocBody .rt-item').length`)
  await b.click(`document.querySelector('#reqDocTocBody [data-toc-fold]')`)
  await sleep(300)
  const foldAfter = await b.eval(`document.querySelectorAll('#reqDocTocBody .rt-item').length`)
  log(foldAfter < foldBefore, '折叠父项会收起子项', `${foldBefore} -> ${foldAfter}`)

  /* ---------- 5. 大纲收起 = 整块隐藏，正文占满 ---------- */
  const wOpen = await b.eval(`Math.round(document.querySelector('.reqdoc-editbody').getBoundingClientRect().width)`)
  await b.click(`document.getElementById('reqDocTocToggle')`)
  await sleep(300)
  const off = await b.eval(`(() => {
    const page = document.getElementById('reqDocEditPage')
    const toc = document.getElementById('reqDocToc')
    const body = document.querySelector('.reqdoc-editbody')
    return {
      noToc: page.classList.contains('no-toc'),
      tocDisplay: getComputedStyle(toc).display,
      editW: Math.round(body.getBoundingClientRect().width),
      leftover: document.querySelectorAll('#reqDocToc .rt-item').length
    }
  })()`)
  log(off.noToc && off.tocDisplay === 'none', '收起大纲 = 整块隐藏（没有竖条/浮层残留）', JSON.stringify(off))
  log(off.editW > wOpen + 100, '收起后正文占满更宽', `${wOpen} -> ${off.editW}`)
  await b.shot(OUT + '_shot_reqdoc_collapsed.png', { fullPage: false })

  await b.click(`document.getElementById('reqDocTocToggle')`)
  await sleep(300)
  const reopened = await b.eval(`(() => ({
    noToc: document.getElementById('reqDocEditPage').classList.contains('no-toc'),
    w: Math.round(document.getElementById('reqDocToc').getBoundingClientRect().width),
    items: document.querySelectorAll('#reqDocTocBody .rt-item').length
  }))()`)
  log(!reopened.noToc && reopened.w > 150 && reopened.items >= 8, '「大纲」按钮再点即可展开', JSON.stringify(reopened))

  /* ---------- 6. 无内滚 ---------- */
  const scroll = await b.eval(`(() => {
    const w = document.querySelector('.reqdoc-editbody .se-wrapper')
    let sc = document.getElementById('reqDocEditPage'), root = null
    while (sc && sc !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) { root = sc; break }
      sc = sc.parentElement
    }
    const pageScrollable = root ? root.scrollHeight > root.clientHeight + 4
                                : document.documentElement.scrollHeight > window.innerHeight
    return { ch: w.clientHeight, sh: w.scrollHeight, pageScrollable }
  })()`)
  log(scroll.sh <= scroll.ch + 2 && scroll.pageScrollable, '编辑区不内滚、整页可滚动', JSON.stringify(scroll))
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  await b.close()
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
