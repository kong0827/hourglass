/* 分支视图自检（CDP 驱动真 Chrome，跑 docs/preview/ui-preview.html 的演示数据）
   用法：node tools/shots/check-branch.mjs
   断言重点：
     1) 侧栏「分支」能进，四列分组 + 顶部五格统计渲染出来
     2) 顶部某一格点击只筛这一档，再点取消
     3) 卡片上的状态徽章点开浮层，四档状态齐全
     4) 卡片点开抽屉：状态分段、四个时间点、关联任务、操作记录都在
     5) 任务抽屉里的「所属分支」下拉按状态分组、并且能选中已有分支 */
import { launch } from 'file:///C:/Users/chenghongchang/.workbuddy/skills/browser-cdp-ui-check/scripts/cdp.mjs'
import { pathToFileURL } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PREVIEW = pathToFileURL('docs/preview/ui-preview.html').href
const b = await launch({ chrome: CHROME, width: 1440, height: 900 })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

try {
  await b.nav(PREVIEW + '#/branches', 900)
  await b.waitFor(`document.querySelectorAll('#branchGroups .br-card').length > 0`, { timeoutMs: 12000 })
  await sleep(500)

  const st = await b.eval(`(() => {
    const view = document.getElementById('view-branches')
    const flow = document.querySelectorAll('#branchFlow .br-flow-cell')
    const groups = document.querySelectorAll('#branchGroups .br-group')
    const cards = document.querySelectorAll('#branchGroups .br-card')
    const first = cards[0]
    return {
      viewOn: view ? view.classList.contains('on') : null,
      activeView: document.body.dataset.view,
      navOn: !!document.querySelector('.nav-item[data-view="branches"].on'),
      flowCount: flow.length,
      groupCount: groups.length,
      cardCount: cards.length,
      groupNames: Array.from(groups).map(g => g.querySelector('.br-group-name').textContent),
      firstBadge: first ? first.querySelector('.br-badge').textContent.trim() : null,
      firstName: first ? first.querySelector('.br-name').textContent : null,
      firstAge: first ? first.querySelector('.br-age').textContent : null,
      meta: (document.getElementById('branchMeta') || {}).textContent || ''
    }
  })()`)
  log(st.viewOn === true && st.activeView === 'branches', '「分支」视图可进入', 'activeView=' + st.activeView)
  log(st.navOn === true, '侧栏分支项高亮')
  log(st.flowCount === 5, '顶部统计 = 四档状态 + 平均发布周期', 'cells=' + st.flowCount)
  log(st.groupCount === 4, '四列状态分组齐全', st.groupNames.join(' / '))
  log(st.cardCount === 4, '演示数据 4 条分支全部渲染', 'cards=' + st.cardCount)
  log(!!st.firstName && /^[\x20-\x7e]+$/.test(st.firstName), '卡片显示分支名', st.firstName)
  log(/已 |周期 |刚刚/.test(st.firstAge || ''), '卡片显示停留时长 / 发布周期', st.firstAge)

  /* 点第三格（待合并）只看这一档 */
  await b.eval(`document.querySelectorAll('#branchFlow .br-flow-cell')[2].click()`)
  await sleep(350)
  const filt = await b.eval(`(() => {
    const cards = document.querySelectorAll('#branchGroups .br-card')
    return {
      n: cards.length,
      badges: Array.from(cards).map(c => c.querySelector('.br-badge').textContent.trim()),
      flowOn: document.querySelectorAll('#branchFlow .br-flow-cell.on').length
    }
  })()`)
  log(filt.n === 1 && filt.badges[0].indexOf('待合并') === 0, '点统计格只筛这一档', JSON.stringify(filt))
  await b.eval(`document.querySelectorAll('#branchFlow .br-flow-cell')[2].click()`)
  await sleep(350)
  const all = await b.eval(`document.querySelectorAll('#branchGroups .br-card').length`)
  log(all === 4, '再点一次取消筛选', 'cards=' + all)

  /* 状态浮层 */
  await b.eval(`document.querySelector('#branchGroups .br-card .br-badge').click()`)
  await sleep(350)
  const menu = await b.eval(`(() => {
    const m = document.querySelector('.br-status-menu')
    return {
      open: !!m,
      sets: m ? Array.from(m.querySelectorAll('[data-br-set]')).map(x => x.textContent.trim()) : [],
      hasEdit: !!(m && m.querySelector('[data-br-edit]')),
      hasDel: !!(m && m.querySelector('[data-br-del]'))
    }
  })()`)
  log(menu.open === true, '状态徽章点开浮层')
  log(menu.sets.length === 4, '浮层里四档状态齐全', menu.sets.join(' / '))
  log(menu.hasEdit && menu.hasDel, '浮层带编辑 / 删除入口')
  await b.eval(`document.querySelector('.br-status-menu [data-br-edit]').click()`)
  await sleep(400)
  const dlg = await b.eval(`(() => {
    const d = document.getElementById('dlgBranch')
    return {
      open: d.classList.contains('open'),
      title: document.getElementById('dlgBranchTitle').textContent,
      name: document.getElementById('brName').value,
      statusHidden: document.getElementById('brStatusField').hidden,
      btn: document.getElementById('dlgBranchOk').textContent
    }
  })()`)
  log(dlg.open && dlg.title === '编辑分支' && dlg.name.length > 0, '编辑弹窗带出原值', JSON.stringify(dlg))
  log(dlg.statusHidden === true, '编辑时不显示「初始状态」（状态只能走状态切换）')
  await b.eval(`document.getElementById('dlgBranchCancel').click()`)
  await sleep(250)

  /* 抽屉 */
  await b.eval(`document.querySelector('#branchGroups .br-card').click()`)
  await sleep(700)
  const dr = await b.eval(`(() => {
    const lay = document.getElementById('branchDrawer')
    return {
      open: lay.classList.contains('on'),
      title: document.getElementById('brDrawerTitle').textContent,
      seg: document.querySelectorAll('#brDrawerBody [data-br-drawer-status]').length,
      nodes: document.querySelectorAll('#brDrawerBody .br-tnode').length,
      tasks: document.querySelectorAll('#brDrawerBody .br-task').length,
      logs: document.querySelectorAll('#brDrawerBody .br-loglist .tl-item').length,
      kv: document.querySelectorAll('#brDrawerBody .br-kv > div').length
    }
  })()`)
  log(dr.open === true && !!dr.title, '点卡片打开分支抽屉', dr.title)
  log(dr.seg === 4, '抽屉里四档状态可切换', 'segs=' + dr.seg)
  log(dr.nodes === 4, '四个状态时间点都在（未进入的显示未进入）', 'nodes=' + dr.nodes)
  log(dr.kv === 4, '抽屉显示目标分支 / 负责人 / 创建时间 / 任务数')
  log(dr.tasks >= 1, '关联任务列表有数据', 'tasks=' + dr.tasks)
  log(dr.logs >= 1, '操作记录（时间线）有数据', 'logs=' + dr.logs)
  await b.shot('docs/images/_shot_branch_drawer.png', { fullPage: false })
  await b.eval(`document.getElementById('brDrawerClose').click()`)
  await sleep(350)

  /* 看板卡片上的分支标签 + 任务抽屉的「所属分支」下拉 */
  await b.eval(`document.querySelector('.nav-item[data-view="workitems"]').click()`)
  await sleep(900)
  const tag = await b.eval(`(() => {
    const t = document.querySelector('.tag-branch')
    return { n: document.querySelectorAll('.tag-branch').length, text: t ? t.textContent.trim() : null }
  })()`)
  log(tag.n >= 1, '看板卡片显示分支标签', tag.text || '')

  await b.eval(`document.querySelector('[data-id="K1"]')?.click()`)
  await sleep(900)
  const sel = await b.eval(`(() => {
    const s = document.getElementById('iBranch')
    if (!s) return { missing: true }
    return {
      value: s.value,
      groups: s.querySelectorAll('optgroup').length,
      options: s.querySelectorAll('option').length,
      hint: (document.getElementById('iBranchHint') || {}).textContent || '',
      text: s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : ''
    }
  })()`)
  log(!sel.missing, '任务抽屉里有「所属分支」下拉')
  log(sel.groups >= 2, '分支下拉按状态分组（optgroup）', 'groups=' + sel.groups)
  log(sel.value === 'BR1', '已关联分支的任务会带出选中值', sel.value + ' / ' + sel.text)
  log(sel.options === 5, '选项 = 不关联 + 4 条分支', 'options=' + sel.options)
  await b.shot('docs/images/_shot_branch_task.png', { fullPage: false })

  await b.eval(`document.getElementById('btnCloseTask')?.click()`)
  await sleep(300)
  await b.eval(`document.querySelector('.nav-item[data-view="branches"]')?.click()`)
  await sleep(800)
  await b.shot('docs/images/_shot_branch.png', { fullPage: false })
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  await b.close()
}
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
