/* 手机视口实测与截图（真实 Chrome，经本机 agent-browser 驱动；Node 18 也能跑）
   前置：本地实例已启动（http://localhost:8080/hourglass），账号 admin。
   用法：node tools/shots/shot-mobile.mjs
   断言：四档宽度 data-layout 正确；390px 下各视图无页面级横向滚动、底栏可见、侧栏隐藏。
   输出：docs/images/_shot_mobile-<view>.png；控制台逐视图打印测量结果。 */
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'http://localhost:8080/hourglass'
const OUT = path.resolve('docs/images') + path.sep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findBrowserCli() {
  if (process.env.AGENT_BROWSER_BIN && fs.existsSync(process.env.AGENT_BROWSER_BIN)) return process.env.AGENT_BROWSER_BIN
  try {
    /* where 可能先命中 .qoder 插件缓存（缺原生 exe 的 .js 启动器），
       逐行候选探测同级 exe（插件布局）与全局 npm 布局，第一个带原生二进制的胜出 */
    const lines = execSync('where agent-browser', { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
    const exeName = process.platform === 'win32' ? 'agent-browser-win32-x64.exe' : 'agent-browser-linux-x64'
    for (const line of lines) {
      const dir = path.dirname(line)
      const candidates = [
        path.join(dir, exeName),
        path.join(dir, 'node_modules', 'agent-browser', 'bin', exeName)
      ]
      for (const exe of candidates) if (fs.existsSync(exe)) return exe
    }
    return lines[0] || 'agent-browser'
  } catch (e) {
    return 'agent-browser'
  }
}
const AB = findBrowserCli()

function ab(args, timeout = 120000) {
  /* agent-browser 会留一个后台守护进程继承 stdout；用文件接输出，
     否则 execFileSync 会一直等管道 EOF（表现为 ETIMEDOUT，但命令其实已成功）。
     本机 where 首先命中 .js 入口：Windows 不能直接 exec，要用 node 拉起。 */
  const outFile = path.join(os.tmpdir(), `mobile-shot-${process.pid}-${Math.random().toString(36).slice(2)}.log`)
  const fd = fs.openSync(outFile, 'w')
  const isJs = AB.endsWith('.js')
  const r = spawnSync(isJs ? process.execPath : AB, isJs ? [AB, ...args] : args, { timeout, stdio: ['ignore', fd, 'ignore'] })
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

const VIEWS = [
  'mine', 'board', 'list', 'calendar',
  'projects', 'portfolio', 'project', 'phase', 'demands', 'requirements', 'testcases',
  'branches', 'review', 'analysis', 'report', 'workload', 'risks',
  'gantt', 'settings', 'profile'
]

/* 四档宽度 → data-layout（规格 §3.8-1） */
async function checkBreakpoints() {
  const cases = [[1440, 'desktop'], [1024, 'desktop'], [768, 'tablet'], [390, 'mobile']]
  for (const [w, want] of cases) {
    ab(['set', 'viewport', String(w), '844'])
    await sleep(400)
    const got = js(`document.body.dataset.layout`)
    console.log(`breakpoint ${w}px → ${got}（期望 ${want}）${got === want ? ' OK' : ' FAIL'}`)
    if (got !== want) throw new Error(`断点断言失败：${w}px 期望 ${want} 实际 ${got}`)
  }
}

async function measure(view) {
  return js(`(() => {
    const de = document.scrollingElement;
    const tab = document.getElementById('tabBar');
    const side = document.querySelector('.sidebar');
    const tabVisible = tab && !tab.hidden && getComputedStyle(tab).display !== 'none';
    const sideHidden = !side || getComputedStyle(side).display === 'none';
    const on = document.querySelector('.view.on');
    return {
      view: on ? on.id : '',
      layout: document.body.dataset.layout,
      scrollW: de.scrollWidth, clientW: de.clientWidth,
      tabVisible: !!tabVisible, sideHidden: sideHidden
    };
  })()`)
}

async function main() {
  /* 没有浏览器在跑时 close 返回非零，属正常，容错继续 */
  try { ab(['close', '--all']) } catch (e) { /* noop */ }
  ab(['set', 'viewport', '390', '844'])
  ab(['open', BASE + '/login.html'])
  await sleep(800)
  js(`(() => {
    const u = document.getElementById('uName'), p = document.getElementById('uPass');
    if (!u || !p) return 'already-logged-in';
    u.value = 'admin'; p.value = 'Hourglass@2026';
    u.dispatchEvent(new Event('input', { bubbles: true }));
    p.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = document.querySelector('button[type=submit]');
    if (btn) btn.click(); else document.querySelector('form').submit();
    return 'submitted';
  })()`)
  /* 等登录跳转与首屏就绪 */
  let ready = false
  for (let i = 0; i < 40; i++) {
    await sleep(400)
    const href = js(`location.href`)
    if (href.indexOf('login.html') < 0 && js(`!!document.getElementById('tabBar')`)) { ready = true; break }
  }
  if (!ready) throw new Error('登录后首屏未就绪')
  await sleep(1200)

  await checkBreakpoints()
  ab(['set', 'viewport', '390', '844'])
  await sleep(400)

  const failures = []
  for (const view of VIEWS) {
    js(`location.hash = '#/${view}'`)
    /* 懒加载视图轮询 .view.on 切换完成，再留渲染时间 */
    for (let i = 0; i < 25; i++) {
      await sleep(250)
      const on = js(`(document.querySelector('.view.on') || {}).id || ''`)
      if (on === 'view-' + view) break
    }
    await sleep(view === 'gantt' ? 1600 : 900)
    const m = await measure(view)
    const noHScroll = m.scrollW <= m.clientW
    const ok = m.layout === 'mobile' && noHScroll && m.tabVisible && m.sideHidden
    if (!ok) failures.push({ view, ...m })
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${view}: scrollW=${m.scrollW} clientW=${m.clientW} tab=${m.tabVisible} sideHidden=${m.sideHidden}`)
    ab(['screenshot', OUT + `_shot_mobile-${view}.png`])
  }

  /* 我的任务：补一张「我的」模式（admin 默认落团队视图） */
  js(`location.hash = '#/mine'`)
  await sleep(600)
  js(`(() => { const b = document.querySelector('[data-mine-mode="mine"]'); if (b) b.click(); return !!b })()`)
  await sleep(900)
  ab(['screenshot', OUT + '_shot_mobile_mine-mine.png'])

  try { ab(['close', '--all']) } catch (e) { /* noop */ }
  if (failures.length) {
    console.log('FAILURES: ' + JSON.stringify(failures))
    process.exitCode = 1
  } else {
    console.log('done: 全部视图通过（无页面级横向滚动、底栏可见、侧栏隐藏）')
  }
}

await main()
