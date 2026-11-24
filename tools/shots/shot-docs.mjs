/* 文档截图与界面图库重拍（真实 Chrome，经本机 agent-browser 驱动静态预览稿）
   用法：node tools/shots/shot-docs.mjs
   产出：
     docs/images/{foot-board,foot-rail,_shot_list-wide,_shot_mine-wide,_shot_stats-wide}.png
     docs/diagrams/gallery/{projects,demands,gantt,requirements,versions,analysis,review}.png
   发布工作区 / 发布历史两图来自交付截图（delivery-preview/history-desktop），预览稿没有对应数据，不在这里重拍。 */
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve('.')
const PREVIEW = pathToFileURL(path.join(ROOT, 'docs/preview/ui-preview.html')).href
const OUT_IMG = path.join(ROOT, 'docs/images') + path.sep
const OUT_GAL = path.join(ROOT, 'docs/diagrams/gallery') + path.sep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findBrowserCli() {
  if (process.env.AGENT_BROWSER_BIN && fs.existsSync(process.env.AGENT_BROWSER_BIN)) return process.env.AGENT_BROWSER_BIN
  try {
    const first = execSync('which agent-browser', { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    const modBin = path.join(path.dirname(first), 'node_modules', 'agent-browser', 'bin')
    const exe = process.platform === 'win32'
      ? path.join(modBin, 'agent-browser-win32-x64.exe')
      : path.join(modBin, 'agent-browser-linux-x64')
    if (fs.existsSync(exe)) return exe
    const mac = path.join(modBin, 'agent-browser-darwin-arm64')
    if (fs.existsSync(mac)) return mac
    return first
  } catch (e) {
    return 'agent-browser'
  }
}
const AB = findBrowserCli()

function ab(args, timeout = 120000) {
  const outFile = path.join(os.tmpdir(), `docs-shot-${process.pid}-${Math.random().toString(36).slice(2)}.log`)
  const fd = fs.openSync(outFile, 'w')
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
  const data = JSON.parse(ab(['eval', '--json', code]))
  if (!data.success) throw new Error(String(data.error))
  return data.data.result
}
const dropBanner = `(() => {
  const els = [...document.querySelectorAll('body > div')].filter(d => (d.getAttribute('style') || '').includes('99999'))
  els.forEach(e => e.remove())
  const ub = document.getElementById('unreadBubble'); if (ub) ub.remove()
  document.querySelectorAll('#toastWrap > *, .toast-layer > *, .toast').forEach(e => e.remove())
  return els.length
})()`

async function shoot({ route, file, width = 1440, height = 1100, scale = null, ready, sideRail = false, after = null, afterReady = null }) {
  ab(['close', '--all'])
  const vp = [String(width), String(height)]
  if (scale) vp.push(String(scale))
  ab(['set', 'viewport', ...vp])
  ab(['open', PREVIEW + '?t=' + Date.now() + '#/' + route])
  await sleep(700)
  js('localStorage.clear()')
  ab(['reload'])
  await sleep(900)
  let ok = false
  for (let i = 0; i < 40; i++) {
    try { if (js(ready)) { ok = true; break } } catch (e) { /* retry */ }
    await sleep(200)
  }
  if (!ok) throw new Error('未就绪：' + route)
  if (after) {
    js(after)
    for (let i = 0; i < 30; i++) {
      try { if (!afterReady || js(afterReady)) break } catch (e) { /* retry */ }
      await sleep(200)
    }
  }
  if (sideRail) {
    js('document.body.classList.add("side-rail")')
    await sleep(300)
  }
  js(dropBanner)
  await sleep(250)
  ab(['screenshot', file])
  const errs = js('(window.__previewErrors || []).slice(0, 3)')
  console.log('shot:', path.relative(ROOT, file), Array.isArray(errs) && errs.length ? JSON.stringify(errs) : '')
}

const views = [
  { route: 'board', file: OUT_IMG + 'foot-board.png', width: 1440, height: 840, scale: 2, view: 'board', minLen: 600 },
  { route: 'board', file: OUT_IMG + 'foot-rail.png', width: 1280, height: 840, scale: 2, sideRail: true, view: 'board', minLen: 600 },
  { route: 'list', file: OUT_IMG + '_shot_list-wide.png', width: 1440, height: 840, scale: 2, view: 'list', minLen: 800 },
  { route: 'mine', file: OUT_IMG + '_shot_mine-wide.png', width: 1440, height: 840, scale: 2, view: 'mine', minLen: 400 },
  { route: 'analysis', file: OUT_IMG + '_shot_stats-wide.png', width: 1440, height: 840, scale: 2, view: 'analysis', minLen: 100 },
  { route: 'projects', file: OUT_GAL + 'projects.png', view: 'projects', minLen: 150 },
  { route: 'demands?view=table', file: OUT_GAL + 'demands.png', view: 'demands', minLen: 150 },
  { route: 'gantt', file: OUT_GAL + 'gantt.png', view: 'gantt', minLen: 400 },
  { route: 'requirements', file: OUT_GAL + 'requirements.png', view: 'requirements', minLen: 120,
    after: `(() => { const row = document.querySelector('#reqDocSplitTree [data-rs-doc], #reqDocTree [data-reqdoc]'); if (row) row.click(); return true })()`,
    afterReady: `(() => { const b = document.getElementById('reqDocReaderBody'); return !!b && (b.innerText || '').trim().length > 80 })()` },
  { route: 'phase', file: OUT_GAL + 'versions.png', view: 'phase', minLen: 200 },
  { route: 'release?id=V1&reqId=R1&tab=plan', file: OUT_GAL + 'release-workspace.png', view: 'release', minLen: 600 },
  { route: 'release?id=V1&reqId=R1&tab=history', file: OUT_GAL + 'release-history.png', view: 'release', minLen: 300 },
  { route: 'analysis', file: OUT_GAL + 'analysis.png', view: 'analysis', minLen: 100 },
  { route: 'review', file: OUT_GAL + 'review.png', view: 'review', minLen: 400 }
]
for (const v of views) {
  await shoot({
    route: v.route, file: v.file, width: v.width, height: v.height, scale: v.scale, sideRail: v.sideRail,
    after: v.after, afterReady: v.afterReady,
    ready: `(() => { const el = document.querySelector('#view-${v.view}.on'); if (!el || document.body.dataset.view !== '${v.view}') return false; return (el.innerText || '').replace(/\\s+/g, ' ').trim().length > ${v.minLen} })()`
  })
}

ab(['close', '--all'])
console.log('done')
