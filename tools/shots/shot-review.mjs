/* 周回顾截图（真实 Chrome，经本机 agent-browser 驱动；Node 18 也能跑）
   用法：node tools/shots/shot-review.mjs
   输出：docs/images/_shot_review-wide.png（同步 frontend/images 副本） */
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PREVIEW = pathToFileURL('docs/preview/ui-preview.html').href + '#/review'
const OUT = path.resolve('docs/images') + path.sep
const COPY = path.resolve('frontend/images') + path.sep
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
  /* 守护进程会继承 stdout，输出落文件避免管道 EOF 卡住 */
  const outFile = path.join(os.tmpdir(), `review-shot-${process.pid}-${Math.random().toString(36).slice(2)}.log`)
  const fd = fs.openSync(outFile, 'w')
  /* where 命中的可能是 .js 垫片；Windows 下裸 spawn 不能执行，用 node 代跑 */
  const cmd = /\.js$/i.test(AB) ? process.execPath : AB
  const cmdArgs = /\.js$/i.test(AB) ? [AB, ...args] : args
  const r = spawnSync(cmd, cmdArgs, { timeout, stdio: ['ignore', fd, 'ignore'] })
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
  /* 未读通知气泡与 toast 是浮层，截图里会挡住页面内容 */
  const ub = document.getElementById('unreadBubble'); if (ub) ub.remove()
  document.querySelectorAll('#toastWrap > *, .toast-layer > *, .toast').forEach(e => e.remove())
  return els.length
})()`
const ready = `(() => {
  const h = document.getElementById('reviewHours')
  return {
    ready: !!h && h.children.length > 0,
    cards: h ? h.children.length : 0,
    stats: [...document.querySelectorAll('#statGrid > *')].map(e => e.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 8),
    scope: (document.getElementById('reviewHoursScope') || {}).textContent || '',
    members: document.querySelectorAll('[data-review-member]').length,
    dist: [...document.querySelectorAll('#reqDist > *')].map(e => e.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 5)
  }
})()`

async function fresh(width, height) {
  ab(['close', '--all'])
  ab(['set', 'viewport', String(width), String(height)])
  ab(['open', PREVIEW])
  await sleep(600)
  js('localStorage.clear()')
  ab(['reload'])
  await sleep(1000)
  for (let i = 0; i < 30; i++) {
    if (js(ready).ready) break
    await sleep(200)
  }
  js(dropBanner)
  await sleep(300)
}

await fresh(1440, 900)
console.log(JSON.stringify(js(ready), null, 1))
ab(['screenshot', OUT + '_shot_review-wide.png'])
fs.copyFileSync(OUT + '_shot_review-wide.png', COPY + '_shot_review-wide.png')
console.log('shot: _shot_review-wide.png（已同步 frontend/images）')

ab(['close', '--all'])
console.log('done')
