import { launch } from 'file:///C:/Users/chenghongchang/.workbuddy/skills/browser-cdp-ui-check/scripts/cdp.mjs'
import { pathToFileURL } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PREVIEW = pathToFileURL('docs/preview/ui-preview.html').href
const OUT = 'docs/images/'
const b = await launch({ chrome: CHROME, width: 1440, height: 900 })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }

try {
  await b.nav(PREVIEW, 900)
  await sleep(900)
  await b.click(`document.getElementById('sideUserBtn')`)
  await sleep(500)

  const st = await b.eval(`(() => {
    const view = document.getElementById('view-profile')
    const on = view && view.classList.contains('on')
    const panels = view ? [...view.querySelectorAll('.set-panels .panel[id]')].map(p => p.id) : []
    const s = document.getElementById('meStart'), e = document.getElementById('meEnd'), m = document.getElementById('meMax')
    return {
      on,
      hash: location.hash,
      panels,
      title: (document.getElementById('viewTitle') || {}).textContent || '',
      avatar: (document.getElementById('meAvatar') || {}).textContent || '',
      name: (document.getElementById('meName') || {}).textContent || '',
      uname: (document.getElementById('meUsername') || {}).textContent || '',
      startOpts: s ? s.options.length : 0, startVal: s ? s.value : null,
      endOpts: e ? e.options.length : 0, endVal: e ? e.value : null,
      maxOpts: m ? m.options.length : 0, maxVal: m ? m.value : null,
      preview: (document.getElementById('mePreview') || {}).textContent || '',
      anchors: view ? [...view.querySelectorAll('#meAnchor a')].map(a => a.textContent.trim()) : []
    }
  })()`)
  log(st.on === true && st.hash === '#/profile', '点左下角头像进入「个人设置」页', `hash=${st.hash} title=${st.title}`)
  log(st.panels.join(',') === 'me-basic,me-timer,me-pwd', '分为基本信息 / 计时设置 / 修改密码 三块', st.panels.join(','))
  log(st.anchors.length === 3, '左侧分区导航 3 项', st.anchors.join(' / '))
  log(!!st.avatar && st.avatar === '我' && st.name === '我' && st.uname === '@me', '身份卡显示头像/显示名/登录名', `${st.avatar}|${st.name}|${st.uname}`)
  log(st.startOpts === 24 && st.endOpts === 24 && st.maxOpts === 24, '三组下拉各 24 项', `${st.startOpts}/${st.endOpts}/${st.maxOpts}`)
  log(st.startVal === '9' && st.endVal === '18' && st.maxVal === '8', '默认 9:00 / 18:00 / 8 小时', `${st.startVal}/${st.endVal}/${st.maxVal}`)
  log(/09:00–18:00/.test(st.preview) && /最多 8 小时/.test(st.preview), '口径预览文案正确', st.preview)

  /* 上限 -> 4 小时，预览应立刻变 */
  await b.eval(`(() => { const m = document.getElementById('meMax'); m.value = '4';
    m.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`)
  await sleep(250)
  const pv = await b.eval(`document.getElementById('mePreview').textContent`)
  log(/最多 4 小时/.test(pv), '改上限后预览实时更新', pv)

  /* 时段比上限短时应给出提示 */
  await b.eval(`(() => { const s = document.getElementById('meStart'); s.value = '9';
    const e = document.getElementById('meEnd'); e.value = '12';
    const m = document.getElementById('meMax'); m.value = '8';
    e.dispatchEvent(new Event('change', { bubbles: true })); return 1 })()`)
  await sleep(250)
  const pv2 = await b.eval(`document.getElementById('mePreview').textContent`)
  log(/实际最多记 3 小时/.test(pv2), '时段短于上限时点明实际可记小时', pv2)

  /* 保存（mock 返回 {}，前端保留本地值并提示） */
  await b.eval(`(() => { const s = document.getElementById('meStart'); s.value = '9';
    const e = document.getElementById('meEnd'); e.value = '18';
    const m = document.getElementById('meMax'); m.value = '6'; return 1 })()`)
  await b.click(`document.getElementById('meTimerSave')`)
  await sleep(600)
  const saved = await b.eval(`(() => {
    const t = document.querySelector('.toast, [class*="toast"]')
    return { toast: t ? t.innerText.trim().slice(0, 46) : null,
             disabled: document.getElementById('meTimerSave').disabled }
  })()`)
  log(!!saved.toast && saved.toast.indexOf('6 小时') >= 0, '保存计时设置给出成功提示', JSON.stringify(saved))
  log(saved.disabled === false, '保存按钮恢复可用')

  await b.eval(`document.getElementById('view-profile').scrollTop = 0`)
  await sleep(300)
  await b.shot(OUT + '_shot_profile.png', { fullPage: false })

  /* 分区导航：点「修改密码」不应改变路由（preventDefault），且目标面板落在可视区内 */
  const nav = await b.eval(`(() => {
    const a = [...document.querySelectorAll('#meAnchor a')].find(x => x.textContent.trim() === '修改密码')
    a.click()
    const r = document.getElementById('me-pwd').getBoundingClientRect()
    return { hash: location.hash, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight }
  })()`)
  await sleep(500)
  log(nav.hash === '#/profile', '点分区链接不会跳走（内部锚点被拦截）', 'hash=' + nav.hash)
  log(nav.top < nav.vh && nav.bottom > 0, '目标面板在可视区内', JSON.stringify(nav))
} catch (e) {
  console.error('SCRIPT ERROR:', e.message); fail++
} finally { await b.close() }
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
