import { launch } from 'file:///C:/Users/chenghongchang/.workbuddy/skills/browser-cdp-ui-check/scripts/cdp.mjs'
import { pathToFileURL } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PREVIEW = pathToFileURL('docs/ui-preview.html').href
const b = await launch({ chrome: CHROME, width: 1440, height: 900 })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : '')); ok ? pass++ : fail++ }
try {
  await b.nav(PREVIEW + '#/settings', 800)
  await b.waitFor(`!!document.getElementById('set-members')`, { timeoutMs: 12000 })
  await sleep(600)
  const st = await b.eval(`(() => {
    const add = document.getElementById('wsMemberAdd')
    const hint = document.getElementById('wsMemberHint')
    const list = document.getElementById('wsMemberList')
    const invite = document.getElementById('inviteBox')
    return {
      role: (window.currentUser || (window.API && null) || {}).role || null,
      addHidden: add ? add.hidden : null,
      hintHidden: hint ? hint.hidden : null,
      hintText: hint ? hint.textContent.trim().slice(0, 40) : null,
      listHasItems: list ? list.children.length : 0,
      inviteHidden: invite ? invite.hidden : null
    }
  })()`)
  log(st.addHidden === true, '普通用户看不到「按登录名添加成员」输入框', JSON.stringify(st))
  log(st.hintHidden === false && !!st.hintText, '普通用户看到「请用邀请链接」的说明', st.hintText || '')
  log(st.listHasItems > 0, '成员列表照常显示', 'items=' + st.listHasItems)
  log(st.inviteHidden === false, '邀请链接面板可见（空间主仍可生成链接）', 'inviteHidden=' + st.inviteHidden)
  await b.eval(`document.getElementById('set-members').scrollIntoView({block:'start'})`)
  await sleep(400)
  await b.shot('docs/images/_shot_settings.png', { fullPage: false })
} catch (e) {
  console.error('SCRIPT ERROR:', e.message); fail++
} finally { await b.close() }
console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
