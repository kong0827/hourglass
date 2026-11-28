import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createHttpServer } from "../src/server.js";

const stub = {
  async get(path, query) {
    return { path, query, items: [{ id: "T1", title: "登录页" }] };
  }
};

async function startApp(key) {
  const app = createHttpServer({ client: stub, key });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  return { app, base };
}

test("MCP 握手 → tools/list → tools/call 全链路", async (t) => {
  const { app, base } = await startApp("secret");
  t.after(() => app.close());

  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer secret" } }
  });
  await client.connect(transport);
  t.after(() => client.close());

  const tools = await client.listTools();
  assert.equal(tools.tools.length, 14);
  assert.ok(tools.tools.some((tool) => tool.name === "query_tasks"));

  const result = await client.callTool({ name: "query_tasks", arguments: { workspaceId: "W1", limit: 1 } });
  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.path, "/api/tasks/list");
  assert.equal(payload.query.workspace, "W1");
  assert.equal(payload.query.limit, 1);
});

test("参数缺失按工具错误返回，而不是断开连接", async (t) => {
  const { app, base } = await startApp("secret");
  t.after(() => app.close());

  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer secret" } }
  });
  await client.connect(transport);
  t.after(() => client.close());

  const result = await client.callTool({ name: "get_task", arguments: { workspaceId: "W1" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /缺少必填参数 taskId/);

  const unknown = await client.callTool({ name: "nope", arguments: {} });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /未知工具：nope/);
});

test("错误密钥 401，健康检查可用且不泄露令牌", async (t) => {
  const { app, base } = await startApp("secret");
  t.after(() => app.close());

  const denied = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  assert.equal(denied.status, 401);

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.tools, 14);
  assert.equal(JSON.stringify(body).includes("secret"), false);
});