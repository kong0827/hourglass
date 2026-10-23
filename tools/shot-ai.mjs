import { launch } from 'file:///C:/Users/chenghongchang/.workbuddy/skills/browser-cdp-ui-check/scripts/cdp.mjs'
import { pathToFileURL } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PREVIEW = pathToFileURL('C:\\Users\\chenghongchang\\Desktop\\工作台\\devstudio-server\\docs\\ui-preview.html').href
const OUT = 'C:\\Users\\chenghongchang\\Desktop\\工作台\\devstudio-server\\docs\\'

const b = await launch({ chrome: CHROME, width: 1440, height: 900 })
let pass = 0, fail = 0
const log = (ok, name, extra = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  => ' + extra : ''))
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

try {
  /* ==================== 1. 个人设置 · AI 配置 ==================== */
  await b.nav(PREVIEW + '#/profile', 900)
  await b.waitFor(`document.querySelectorAll('#meAiProvider option').length > 0`, { timeoutMs: 12000 })
  await sleep(300)

  const cfg = await b.eval(`(() => {
    const sel = document.getElementById('meAiProvider')
    return {
      options: [...sel.options].map(o => o.textContent.trim()),
      value: sel.value,
      model: document.getElementById('meAiModel').value,
      base: document.getElementById('meAiBase').value,
      keyPlaceholder: document.getElementById('meAiKey').placeholder,
      keyState: document.getElementById('meAiKeyState').textContent.trim(),
      state: document.getElementById('meAiState').textContent.trim(),
      enabled: document.getElementById('meAiEnabled').checked,
      anchor: !!document.querySelector('#meAnchor a[href="#me-ai"]'),
      result: (document.getElementById('meAiResult') || {}).textContent || '',
      hidden: (document.getElementById('meAiResult') || {}).hidden,
      name: (document.getElementById('meName') || {}).textContent || '',
      user: (document.getElementById('meUsername') || {}).textContent || '',
      viewOn: (document.getElementById('view-profile') || {classList:{contains:()=>false}}).classList.contains('on')
    }
  })()`)
  log(true, "[调试] 页面状态", JSON.stringify({ result: cfg.result, hidden: cfg.hidden,
    name: cfg.name, user: cfg.user, viewOn: cfg.viewOn }))
  log(cfg.options.length === 8, '厂商下拉 8 个选项', cfg.options.join(' / '))
  log(cfg.value === 'deepseek' && cfg.model === 'deepseek-chat', '已保存的厂商与模型回填', cfg.value + ' / ' + cfg.model)
  log(cfg.base.indexOf('api.deepseek.com') >= 0, '接口地址回填', cfg.base)
  log(cfg.keyPlaceholder.indexOf('sk-****a1b2') >= 0, 'Key 只显示掩码，不回传明文', cfg.keyPlaceholder)
  log(cfg.keyState.indexOf('已保存') >= 0, 'Key 状态提示', cfg.keyState)
  log(cfg.state.indexOf('已就绪') >= 0, '顶部状态说明', cfg.state)
  log(cfg.enabled, 'AI 总开关是打开的')
  log(cfg.anchor, '左侧锚点有「AI 设置」')

  /* 切厂商自动带出默认地址与模型 */
  await b.eval(`(() => {
    const s = document.getElementById('meAiProvider')
    s.value = 'qwen'
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(200)
  const sw = await b.eval(`(() => ({
    base: document.getElementById('meAiBase').value,
    model: document.getElementById('meAiModel').value,
    hint: document.getElementById('meAiKeyHint').textContent.trim()
  }))()`)
  log(sw.base.indexOf('dashscope') >= 0 && sw.model === 'qwen-plus', '切厂商自动填地址与模型', sw.base + ' / ' + sw.model)
  log(sw.hint.indexOf('百炼') >= 0, '厂商 hint 跟着换', sw.hint)

  await b.shot(OUT + '_shot_ai_profile.png', { fullPage: false })

  /* ==================== 2. 需求页 · AI 拆分 ==================== */
  await b.nav(PREVIEW + '#/requirements', 900)
  await b.waitFor(`!!document.querySelector('.reqdoc-row')`, { timeoutMs: 12000 })
  await b.click(`document.querySelector('.reqdoc-row')`)
  await b.waitFor(`!!document.getElementById('reqDocEditPage') && !document.getElementById('reqDocEditPage').hidden`, { timeoutMs: 15000 })
  await sleep(600)

  const btns = await b.eval(`(() => ({
    split: !!document.getElementById('reqDocAiSplit'),
    audit: !!document.getElementById('reqDocAiAudit'),
    barOverflow: (() => {
      const bar = document.querySelector('.reqdoc-editbar')
      return bar ? bar.scrollWidth > bar.clientWidth + 1 : null
    })()
  }))()`)
  log(btns.split && btns.audit, '工具条有两个 AI 按钮')
  log(btns.barOverflow === false, '工具条没被按钮撑出横向滚动', String(btns.barOverflow))

  await b.click(`document.getElementById('reqDocAiSplit')`)
  await b.waitFor(`document.querySelectorAll('#aiSplitList .ai-item').length > 0`, { timeoutMs: 12000 })
  await sleep(400)

  const split = await b.eval(`(() => {
    const items = [...document.querySelectorAll('#aiSplitList .ai-item')]
    return {
      dialogOpen: document.getElementById('dlgAiSplit').classList.contains('open'),
      count: items.length,
      checked: items.filter(i => i.querySelector('input[type=checkbox]').checked).length,
      onClass: items.filter(i => i.classList.contains('on')).length,
      titles: items.map(i => i.querySelector('.ai-title').value),
      editable: items.every(i => !i.querySelector('.ai-title').readOnly),
      tags: items.map(i => (i.querySelector('.ai-tag') || {}).textContent || ''),
      msg: document.getElementById('dlgAiSplitMsg').textContent.trim(),
      usage: document.getElementById('aiSplitUsage').textContent.trim()
    }
  })()`)
  log(split.dialogOpen, '点「AI 拆分」弹出草稿弹窗')
  log(split.count === 5, '渲染出 5 条草稿', String(split.count))
  log(split.checked === 5 && split.onClass === 5, '默认全选且卡片高亮', split.checked + '/' + split.onClass)
  log(split.editable, '标题可编辑')
  log(split.tags.join(',').indexOf('P0') >= 0, '显示优先级标签', split.tags.join(','))
  log(split.msg.indexOf('5 条') >= 0 && split.msg.indexOf('1840') >= 0, '说明里给出字数与条数', split.msg.slice(0, 50))
  log(split.usage.indexOf('2006') >= 0, '显示本次 token 消耗', split.usage)

  /* 取消勾选一条：卡片底色要跟着变 */
  await b.eval(`(() => {
    const cb = document.querySelectorAll('#aiSplitList .ai-item input[type=checkbox]')[0]
    cb.checked = false
    cb.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(200)
  const after = await b.eval(`(() => {
    const first = document.querySelector('#aiSplitList .ai-item')
    return { on: first.classList.contains('on'),
             checkedNow: [...document.querySelectorAll('#aiSplitList input[type=checkbox]')].filter(c => c.checked).length }
  })()`)
  log(!after.on && after.checkedNow === 4, '取消勾选后取消高亮', 'checked=' + after.checkedNow)

  await b.shot(OUT + '_shot_ai_split.png', { fullPage: false })

  /* ==================== 3. 需求页 · 完成度检查 ==================== */
  await b.eval(`document.getElementById('dlgAiSplitCancel').click()`)
  await sleep(200)
  await b.click(`document.getElementById('reqDocAiAudit')`)
  await b.waitFor(`document.querySelectorAll('#aiAuditList .ai-item').length > 0`, { timeoutMs: 12000 })
  await sleep(400)

  const audit = await b.eval(`(() => {
    const items = [...document.querySelectorAll('#aiAuditList .ai-item')]
    const tags = items.map(i => (i.querySelector('.ai-tag') || {}).textContent || '')
    return {
      dialogOpen: document.getElementById('dlgAiAudit').classList.contains('open'),
      big: document.querySelector('#aiAuditScore .big').textContent.trim(),
      scoreCls: document.getElementById('aiAuditScore').className,
      verdictLine: document.querySelector('#aiAuditScore .sc-lbl').textContent.trim(),
      counts: document.querySelector('#aiAuditScore .sc-cnt').textContent.trim(),
      count: items.length,
      tags,
      firstTag: tags[0],
      missingOnTop: items[0].classList.contains('on'),
      summary: document.getElementById('dlgAiAuditSummary').textContent.trim(),
      usage: document.getElementById('aiAuditUsage').textContent.trim(),
      overflow: [...document.querySelectorAll('#view-requirements *')].filter(el => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
      }).length
    }
  })()`)
  log(audit.dialogOpen, '点「完成度检查」弹出结果弹窗')
  log(audit.big === '56%', '覆盖率显示 56%', audit.big)
  log(audit.scoreCls.indexOf('warn') >= 0, '覆盖率配色按档位（56% → 警告色）', audit.scoreCls)
  log(audit.verdictLine.indexOf('做了一部分') >= 0 && audit.verdictLine.indexOf('8 个功能点') >= 0,
    '结论与功能点数', audit.verdictLine)
  log(audit.counts.indexOf('缺任务 2') >= 0, '分类计数（缺任务 2）', audit.counts)
  log(audit.count === 8, '8 个功能点全部列出', String(audit.count))
  log(audit.firstTag === '缺任务' && audit.missingOnTop, '缺任务的排最前面并高亮', audit.firstTag)
  log(audit.summary.length > 8, '给出结论摘要', audit.summary.slice(0, 40))
  log(audit.usage.indexOf('建议下一步') >= 0, '给出下一步建议', audit.usage.slice(0, 40))
  log(audit.overflow === 0, '弹窗与页面无横向溢出', String(audit.overflow))

  await b.shot(OUT + '_shot_ai_audit.png', { fullPage: false })
} catch (e) {
  console.error('SCRIPT ERROR:', e.message)
  fail++
} finally {
  await b.close()
}

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
