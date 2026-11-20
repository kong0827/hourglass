#!/usr/bin/env python3
"""通过 CDP 以精确视口截取原型页面（桌面 1440 / 移动 390）。
用法: python3 shots/cdp_shot.py <url> <out.png> <width> <height> [--full]
"""
import base64
import json
import subprocess
import sys
import time
import urllib.request

import requests
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9333


def ensure_chrome():
    try:
        requests.get("http://localhost:%d/json/version" % PORT, timeout=1)
        return None
    except Exception:
        proc = subprocess.Popen([
            CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--remote-debugging-port=%d" % PORT, "--remote-allow-origins=*",
            "--user-data-dir=/tmp/protochrome-cdp",
            "--no-first-run", "--no-default-browser-check",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                requests.get("http://localhost:%d/json/version" % PORT, timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        return proc


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.i = 0

    def cmd(self, method, **params):
        self.i += 1
        mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def close(self):
        self.ws.close()


def main():
    url, out, width, height = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    full = "--full" in sys.argv
    ensure_chrome()
    tab = requests.put("http://localhost:%d/json/new?about:blank" % PORT, timeout=5).json()
    cdp = CDP(tab["webSocketDebuggerUrl"])
    cdp.cmd("Page.enable")
    cdp.cmd("Emulation.setDeviceMetricsOverride", width=width, height=height,
            deviceScaleFactor=2, mobile=width < 600)
    cdp.cmd("Page.navigate", url=url)
    time.sleep(1.6)
    # 等字体与布局稳定
    cdp.cmd("Runtime.evaluate", expression="document.fonts && document.fonts.ready", awaitPromise=True)
    time.sleep(0.3)
    if full:
        metrics = cdp.cmd("Page.getLayoutMetrics")
        size = metrics["cssContentSize"]
        shot = cdp.cmd("Page.captureScreenshot", format="png", captureBeyondViewport=True,
                       clip={"x": 0, "y": 0, "width": width, "height": size["height"], "scale": 1})
    else:
        shot = cdp.cmd("Page.captureScreenshot", format="png", captureBeyondViewport=False)
    with open(out, "wb") as f:
        f.write(base64.b64decode(shot["data"]))
    cdp.cmd("Page.close")
    cdp.close()
    print("saved", out)


if __name__ == "__main__":
    main()
