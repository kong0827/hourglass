"""Headless Chrome CDP check for the watchers card (temporary; deleted after run)."""
import json
import os
import subprocess
import time
import urllib.request

import websocket

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9347
PROFILE = r"D:\project\hourglass\.tmp-chrome-watch"
URL = "file:///D:/project/hourglass/docs/preview/ui-preview.html"
OUT = r"D:\project\hourglass\docs\preview"

proc = subprocess.Popen([
    CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
    "--remote-allow-origins=*", "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
    "--window-size=1440,980", "--force-device-scale-factor=1",
    f"--user-data-dir={PROFILE}", "about:blank",
])
time.sleep(2.5)

targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
page = [t for t in targets if t["type"] == "page"][0]
ws = websocket.create_connection(page["webSocketDebuggerUrl"], max_size=32 * 1024 * 1024)
mid = [0]


def send(method, params=None):
    mid[0] += 1
    ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == mid[0]:
            return msg.get("result", {})


def js(expr):
    res = send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
    return res.get("result", {}).get("value")


def shot(name):
    data = send("Page.captureScreenshot", {"format": "png"})["data"]
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(__import__("base64").b64decode(data))


send("Page.enable")
send("Runtime.enable")
send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 980, "deviceScaleFactor": 1, "mobile": False})
send("Page.navigate", {"url": URL})
time.sleep(4)

js("window.__err=[];window.addEventListener('error',e=>window.__err.push(String(e.message)));")
js("document.querySelector('[data-view=\"workitems\"]').click()")
time.sleep(1.2)
js("document.querySelector('.card[data-id=\"K1\"]').click()")
time.sleep(1.6)

probe = """(() => {
  const g = id => document.getElementById(id);
  return {
    err: window.__err,
    drawerOpen: g('taskDrawer') ? !g('taskDrawer').hidden : null,
    cardHidden: g('readWatchCard') ? g('readWatchCard').hidden : 'missing',
    list: g('readWatchList') ? g('readWatchList').innerText.replace(/\\s+/g, ' ').trim() : null,
    cnt: g('readWatchCnt') ? g('readWatchCnt').textContent : null,
    addHidden: g('readWatchAdd') ? g('readWatchAdd').hidden : null,
    watchLabel: g('taskWatchLabel') ? g('taskWatchLabel').textContent : null
  };
})()"""

print("INITIAL", json.dumps(js(probe), ensure_ascii=False))
shot("watch-card.png")

js("document.getElementById('btnTaskWatch').click()")
time.sleep(0.9)
print("AFTER_WATCH", json.dumps(js(probe), ensure_ascii=False))

js("document.getElementById('readWatchAdd').click()")
time.sleep(1.6)
print("PICKER", json.dumps(js("""(() => {
  const opts = [...document.querySelectorAll('.pp-opt[data-pick]')].map(b => b.innerText.replace(/\\s+/g, ' ').trim());
  return { title: (document.querySelector('.people-picker .pp-title') || {}).textContent, opts };
})()"""), ensure_ascii=False))
shot("watch-picker.png")

js("""(() => {
  const b = [...document.querySelectorAll('.pp-opt[data-pick]')].find(x => x.innerText.includes('李雷'));
  if (b) b.click();
})()""")
time.sleep(1.0)
print("AFTER_ADD", json.dumps(js(probe), ensure_ascii=False))

js("""(() => {
  const b = document.querySelector('[data-watch-remove=\"U2\"]');
  if (b) b.click();
})()""")
time.sleep(1.0)
print("AFTER_REMOVE", json.dumps(js(probe), ensure_ascii=False))
shot("watch-final.png")

ws.close()
proc.terminate()
try:
    proc.wait(timeout=8)
except Exception:
    proc.kill()
