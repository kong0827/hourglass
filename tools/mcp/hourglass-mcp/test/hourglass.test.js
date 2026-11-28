import assert from "node:assert/strict";
import test from "node:test";

import { HourglassClient, ToolError, parseBearer } from "../src/hourglass.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

test("get 拼接上下文路径、带 Bearer 并解包 data", async () => {
  let seenUrl;
  let seenInit;
  const client = new HourglassClient({
    baseUrl: "http://127.0.0.1:8080/hourglass/",
    token: "hg_test",
    fetchImpl: async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({ code: 0, message: "ok", data: { items: [1] } });
    }
  });

  const data = await client.get("/api/tasks/list", {
    workspace: "W1",
    open: true,
    limit: 20,
    q: undefined,
    owners: "",
    offset: 0
  });

  assert.deepEqual(data, { items: [1] });
  assert.equal(
    seenUrl.toString(),
    "http://127.0.0.1:8080/hourglass/api/tasks/list?workspace=W1&open=true&limit=20&offset=0"
  );
  assert.equal(seenInit.headers.Authorization, "Bearer hg_test");
});

test("401 / 403 / 429 / 业务错误都转成可读提示，并带 trace", async () => {
  const cases = [
    [401, { message: "x" }, /令牌无效或已失效/],
    [403, { message: "你在此空间是查看者" }, /无权执行该操作（HTTP 403）：你在此空间是查看者/],
    [429, { message: "" }, /调用过于频繁（HTTP 429）/]
  ];
  for (const [status, body, pattern] of cases) {
    const client = new HourglassClient({
      baseUrl: "http://127.0.0.1:8080/hourglass",
      token: "hg_test",
      fetchImpl: async () => jsonResponse(body, status, { "x-trace-id": "trace-1" })
    });
    await assert.rejects(client.get("/api/workspaces"), (e) => {
      assert.ok(e instanceof ToolError);
      assert.match(e.message, pattern);
      assert.match(e.message, /trace-1/);
      return true;
    });
  }

  const business = new HourglassClient({
    baseUrl: "http://127.0.0.1:8080/hourglass",
    token: "hg_test",
    fetchImpl: async () => jsonResponse({ code: 7, message: "令牌不存在" })
  });
  await assert.rejects(business.get("/api/workspaces"), /业务错误 7：令牌不存在/);
});

test("非 JSON 错误页与连接失败都有明确提示", async () => {
  const gateway = new HourglassClient({
    baseUrl: "http://127.0.0.1:8080/hourglass",
    token: "hg_test",
    fetchImpl: async () => new Response("<html>bad gateway</html>", { status: 502 })
  });
  await assert.rejects(gateway.get("/api/workspaces"), /请求失败 HTTP 502：<html>bad gateway<\/html>/);

  const offline = new HourglassClient({
    baseUrl: "http://127.0.0.1:8080/hourglass",
    token: "hg_test",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    }
  });
  await assert.rejects(offline.get("/api/workspaces"), /无法连接沙漏（http:\/\/127\.0\.0\.1:8080）：connect ECONNREFUSED/);
});

test("parseBearer 大小写不敏感，非 Bearer 返回 null", () => {
  assert.equal(parseBearer("bearer hg_abc"), "hg_abc");
  assert.equal(parseBearer("Bearer   hg_abc  "), "hg_abc");
  assert.equal(parseBearer("Basic abc"), null);
  assert.equal(parseBearer(undefined), null);
});