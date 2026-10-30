/* 甘特图截图（真实 Chrome，经本机 agent-browser 驱动；Node 18 也能跑）
   用法：node tools/shot-gantt.mjs
   输出：docs/_shot_gantt-default.png / -zoom40 / -1280 / -month / -group / -filter */
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PREVIEW = 'file:///C:/Users/chenghongchang/Desktop/%E5%B7%A5%E4%BD%9C%E5%8F%B0/devstudio-server/docs/ui-preview.html#/gantt'
const OUT = 'C:/Users/chenghongchang/Desktop/工作台/devstudio-server/docs/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findBrowserCli() {
  if (process.env.AGENT_BROWSER_BIN && fs.existsSync(process.env.AGENT_BROWSER_BIN)) return process.env.AGENT_BROWSER_BIN
  try {
    const first = execSync('where agent-browser', { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    const modBin = path.join(path.dirname(first), 'node_modules', 'agent-browser', 'bin')
    const exe = process.platform === 'win32'
      ? path.join(modBin, 'agent-browser-win32-x64.exe')
      : path.join(modBin, 'agent-browser-linux-x64')
    return fs.existsSync(exe) ? exe : first
  } catch (e) {
    return 'agent-browser'
  }
}
const AB = findBrowserCli()

function ab(args, timeout = 120000) {
  /* agent-browser 会留一个后台守护进程继承 stdout；用文件接输出，
     否则 execFileSync 会一直等管道 EOF（表现为 ETIMEDOUT，但命令其实已成功）。 */
  const outFile = path.join(os.tmpdir(), `gantt-shot-${process.pid}-${Math.random().toString(36).slice(2)}.log`)
  const fd = fs.openSync(outFile, 'w')
  const r = spawnSync(AB, args, { timeout, stdio: ['ignore', fd, 'ignore'] })
  fs.closeSync(fd)
  const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : ''
  try { fs.unlinkSync(outFile) } catch (e) { /* noop */ }
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`agent-browser ${args[0]} 失败（${r.status}）：${out}`)
  return out
}
function js(code) {
  const out = ab(['eval', '--json', code])
  const data = JSON.parse(out)
  if (!data.success) throw new Error(String(data.error))
  return data.data.result
}
const dropBanner = `(() => {
  const els = [...document.querySelectorAll('body > div')].filter(d => (d.getAttribute('style') || '').includes('99999'))
  els.forEach(e => e.remove())
  return els.length
})()`
const setView = `(() => {
  const sc = document.getElementById('ganttScroll')
  const s = document.querySelector('.gantt-grid')
  return { grid: !!s, bars: document.querySelectorAll('[data-gantt-bar]').length, left: sc ? sc.scrollLeft : -1 }
})()`

async function fresh(width, height) {
  ab(['close', '--all'])
  ab(['set', 'viewport', String(width), String(height)])
  ab(['open', PREVIEW])
  await sleep(500)
  js('localStorage.clear()')
  ab(['reload'])
  await sleep(900)
  for (let i = 0; i < 30; i++) {
    if (js(setView).grid) break
    await sleep(200)
  }
  js(dropBanner)
  await sleep(300)
}

async function shoot(tag) {
  ab(['screenshot', OUT + `_shot_gantt-${tag}.png`])
  console.log(`shot: _shot_gantt-${tag}.png`)
}

await fresh(1440, 900)
await shoot('default')

js(`document.getElementById('ganttToday').click()`)
js(`(() => { const z = document.getElementById('ganttZoom'); z.value = '40'; z.dispatchEvent(new Event('change')); return true })()`)
await sleep(500)
js(dropBanner)
await shoot('zoom40')

await fresh(1280, 720)
await shoot('1280')

await fresh(1440, 900)
js(`(() => { document.querySelector('[data-gantt-range="month"]').click(); return document.getElementById('ganttRangeLabel').textContent })()`)
await sleep(400)
js(dropBanner)
await shoot('month')

await fresh(1440, 900)
js(`(() => { const g = document.getElementById('ganttGroup'); g.value = 'project'; g.dispatchEvent(new Event('change')); return true })()`)
await sleep(400)
js(dropBanner)
await shoot('group')

await fresh(1440, 900)
js(`(() => {
  document.getElementById('ganttFilterBtn').click()
  const chip = [...document.querySelectorAll('#ganttFilterMenu [data-gantt-req]')].find(b => b.textContent.indexOf('流程引擎') >= 0)
  if (chip) chip.click()
  return !!chip
})()`)
await sleep(500)
js(dropBanner)
await shoot('filter')

ab(['close', '--all'])
console.log('done')
