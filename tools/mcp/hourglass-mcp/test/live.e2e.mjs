/**
 * P0-2 侧车 MCP 真实链路验收：
 * 会话登录 → 创建只读/读写令牌 → 起侧车 → MCP 列空间 / 查任务 / 读文档 →
 * 只读令牌写被 403、读写令牌在可写空间建工作项并移列 → 撤销令牌后 401。
 *
 * 运行：npm run e2e（需要本地后端已启动；默认 admin/admin123，可用
 * HG_E2E_USER / HG_E2E_PASS / HG_E2E_BASE 覆盖）。不打印令牌本身；
 * 唯一写入是验收用的临时工作项，结束时删除并清空回收站。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.HG_E2E_BASE || "http://127.0.0.1:8080/hourglass";
const USER = process.env.HG_E2E_USER || "admin";
const PASS = process.env.HG_E2E_PASS || "admin123";
const PORT = Number(process.env.HG_E2E_MCP_PORT || 8791);
const KEY = process.env.HG_E2E_MCP_KEY || "e2e-key";

const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorb(response) {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

async function call(path, { method = "GET", body, form, csrf = false } = {}) {
  const headers = { Accept: "application/json" };
  if (jar.size) headers.Cookie = cookieHeader();
  if (csrf && jar.has("XSRF-TOKEN")) headers["X-XSRF-TOKEN"] = decodeURIComponent(jar.get("XSRF-TOKEN"));
  if (body) headers["Content-Type"] = "application/json";
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  absorb(response);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 登录 302 之类没有 JSON */
  }
  return { status: response.status, json, text };
}

async function waitForHealth(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`侧车在 ${timeoutMs}ms 内没有就绪`);
}

const steps = [];
function ok(name, detail) {
  steps.push(`✔ ${name}${detail ? `：${detail}` : ""}`);
}
async function tool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text || "";
  if (result.isError) {
    throw new Error(`${name} 失败：${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  // 1. 会话登录
  await call("/api/auth/me");
  const login = await call("/api/auth/login", { method: "POST", form: { username: USER, password: PASS }, csrf: true });
  assert.ok([200, 302].includes(login.status), `登录失败 HTTP ${login.status}`);
  ok("登录", login.status === 302 ? "302" : "200");

  // 2. 创建只读令牌（顺手清掉上次失败遗留的同名令牌）
  const existing = await call("/api/auth/tokens");
  for (const token of existing.json?.data?.tokens || []) {
    if ((token.name === "E2E MCP 验收" || token.name === "E2E MCP 写验收") && !token.revokedAt) {
      await call(`/api/auth/tokens/${token.id}`, { method: "DELETE", csrf: true });
    }
  }
  const created = await call("/api/auth/tokens", {
    method: "POST",
    csrf: true,
    body: { name: "E2E MCP 验收", scope: "read", expiresInDays: 1, password: PASS }
  });
  assert.equal(created.status, 200, `创建令牌失败 HTTP ${created.status}`);
  assert.equal(created.json.code, 0, created.json.message);
  const token = created.json.data.token;
  assert.match(token, /^hg_[A-Za-z0-9_-]{43}$/);
  ok("创建令牌", `前缀 ${created.json.data.prefix}，${token.length} 字符`);

  // 3. 起侧车
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      HG_API_BASE: BASE,
      HG_API_TOKEN: token,
      HG_MCP_HOST: "127.0.0.1",
      HG_MCP_PORT: String(PORT),
      HG_MCP_KEY: KEY,
      HG_MCP_PATH: "/mcp"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const base = `http://127.0.0.1:${PORT}`;
  let client;
  let revoked = false;
  let writeChild = null;
  let writeClient = null;
  let writeTokenId = null;
  let writeRevoked = false;
  let writeTaskId = null;
  try {
    const health = await waitForHealth(`${base}/health`);
    assert.equal(health.tools, 18);
    ok("侧车就绪", `/health tools=${health.tools}`);

    // 4. MCP 三步验收
    client = new Client({ name: "hourglass-e2e", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${KEY}` } }
      })
    );
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 18);
    ok("tools/list", `${listed.tools.length} 个工具`);

    const spaces = await tool(client, "list_workspaces", {});
    assert.ok(Array.isArray(spaces) && spaces.length > 0, "空间为空");
    ok("list_workspaces", `${spaces.length} 个空间`);

    const spacesWithDocs = spaces.slice(0, 5);
    /* 读取验收选任务最多的空间，避免个人看板之类空空间把项目/需求断言压成 0 */
    let workspaceId = spacesWithDocs[0].id;
    let tasksTotal = -1;
    for (const space of spacesWithDocs) {
      const page = await tool(client, "query_tasks", { workspaceId: space.id, open: true, limit: 5 });
      const total = page?.total ?? (page?.items?.length || 0);
      if (total > tasksTotal) {
        workspaceId = space.id;
        tasksTotal = total;
      }
    }
    ok("query_tasks", `空间 ${workspaceId.slice(0, 6)}…，未完成 ${tasksTotal}`);

    const projects = await tool(client, "list_projects", { workspaceId, limit: 20 });
    const projectItems = projects?.items || [];
    ok("list_projects", `${projectItems.length} 个项目`);

    if (projectItems.length) {
      const versions = await tool(client, "list_versions", { workspaceId, projectId: projectItems[0].id });
      ok("list_versions", `${Array.isArray(versions) ? versions.length : 0} 个版本`);
    }

    const demands = await tool(client, "list_demands", { workspaceId, limit: 5 });
    ok("list_demands", `${demands?.total ?? demands?.items?.length ?? 0} 条需求`);

    if (projectItems.length) {
      const cases = await tool(client, "list_test_cases", {
        workspaceId,
        projectId: projectItems[0].id,
        limit: 5
      });
      ok("list_test_cases", `${cases?.total ?? cases?.items?.length ?? 0} 条用例`);
    } else {
      ok("list_test_cases", "该空间没有项目，跳过");
    }

    let doc = null;
    for (const space of spacesWithDocs) {
      const docs = await tool(client, "list_docs", { workspaceId: space.id, limit: 5 });
      if (docs?.items?.length) {
        doc = docs.items[0];
        workspaceId = space.id;
        break;
      }
    }
    if (doc) {
      const full = await tool(client, "get_doc", { workspaceId, docId: doc.id });
      assert.ok(full && (full.content !== undefined || full.body !== undefined));
      ok("get_doc", `《${full.title || doc.title}》正文已取回`);
    } else {
      ok("get_doc", "当前演示库没有可见文档，跳过");
    }

    const mine = await tool(client, "my_tasks", { view: "dev", limit: 3 });
    ok("my_tasks", `${mine?.total ?? mine?.items?.length ?? 0} 条`);

    const found = await tool(client, "search", { workspaceId, q: "登录", limit: 3 });
    ok("search", `${Array.isArray(found) ? found.length : found?.items?.length ?? 0} 条命中`);

    // 5. 越权/不存在返回工具错误而不是 500
    const missing = await client.callTool({ name: "get_task", arguments: { workspaceId, taskId: "NOPE-404" } });
    assert.equal(missing.isError, true);
    ok("不存在的工作项", missing.content[0].text.slice(0, 40));

    /* 5.1 只读令牌调用写工具：后端按只读拒绝，不创建任何数据 */
    const readWrite = await client.callTool({
      name: "create_task",
      arguments: { workspaceId, title: "E2E 只读令牌不应创建" }
    });
    assert.equal(readWrite.isError, true);
    assert.match(readWrite.content[0].text, /只读令牌不能执行写操作/);
    ok("只读令牌写工具", "403 只读令牌");

    /* 5.2 读写令牌：在可写空间真实建一条工作项并移列，结束时删除 + 清空回收站 */
    const writable = spaces.find((space) => ["owner", "admin", "member"].includes(space.myRole));
    assert.ok(writable, "没有可写空间，无法验收真实写路径");
    const writeCreated = await call("/api/auth/tokens", {
      method: "POST",
      csrf: true,
      body: { name: "E2E MCP 写验收", scope: "write", expiresInDays: 1, password: PASS }
    });
    assert.equal(writeCreated.status, 200, `创建读写令牌失败 HTTP ${writeCreated.status}`);
    assert.equal(writeCreated.json.data.scope, "write");
    writeTokenId = writeCreated.json.data.id;
    const writePort = PORT + 1;
    writeChild = spawn(process.execPath, ["src/server.js"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        HG_API_BASE: BASE,
        HG_API_TOKEN: writeCreated.json.data.token,
        HG_MCP_HOST: "127.0.0.1",
        HG_MCP_PORT: String(writePort),
        HG_MCP_KEY: KEY,
        HG_MCP_PATH: "/mcp"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    writeChild.stderr.resume();
    const writeHealth = await waitForHealth(`http://127.0.0.1:${writePort}/health`);
    assert.equal(writeHealth.tools, 18);
    writeClient = new Client({ name: "hourglass-e2e-write", version: "1.0.0" });
    await writeClient.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${writePort}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${KEY}` } }
      })
    );
    const writeTools = await writeClient.listTools();
    assert.equal(writeTools.tools.length, 18);
    for (const name of ["create_task", "create_demand", "move_task", "update_demand"]) {
      assert.ok(writeTools.tools.some((tool) => tool.name === name), `缺少写工具 ${name}`);
    }
    const writeTitle = "E2E MCP 写入 " + Date.now().toString(36);
    const createdTask = await writeClient.callTool({
      name: "create_task",
      arguments: { workspaceId: writable.id, title: writeTitle, estimateMinutes: 5 }
    });
    assert.ok(!createdTask.isError, createdTask.content[0].text);
    const createdTaskBody = JSON.parse(createdTask.content[0].text);
    assert.equal(createdTaskBody.title, writeTitle);
    writeTaskId = createdTaskBody.id;
    ok("读写令牌建工作项", `${createdTaskBody.id} 在 ${writable.id.slice(0, 6)}…`);

    const movedTask = await writeClient.callTool({
      name: "move_task",
      arguments: { workspaceId: writable.id, taskId: writeTaskId, column: "doing" }
    });
    assert.ok(!movedTask.isError, movedTask.content[0].text);
    assert.equal(JSON.parse(movedTask.content[0].text).task.boardColumn, "doing");
    ok("读写令牌移列", `${writeTaskId} → doing`);

    const moved = await writeClient.callTool({
      name: "move_task",
      arguments: { workspaceId, taskId: "NOPE-404", column: "doing" }
    });
    assert.equal(moved.isError, true);
    assert.doesNotMatch(moved.content[0].text, /只读令牌|无权执行该写操作/);
    assert.match(moved.content[0].text, /404|不存在|无权/);
    ok("读写令牌写工具", "过白名单，到业务校验：" + moved.content[0].text.slice(0, 30));

    // 6. 撤销后立即失效
    const revokedResponse = await call(`/api/auth/tokens/${created.json.data.id}`, { method: "DELETE", csrf: true });
    assert.equal(revokedResponse.json.code, 0);
    revoked = true;
    const after = await client.callTool({ name: "search", arguments: { workspaceId, q: "x", limit: 1 } });
    assert.equal(after.isError, true);
    assert.match(after.content[0].text, /401/);
    ok("撤销令牌", "侧车调用立即 401");

    const writeRevokedResponse = await call(`/api/auth/tokens/${writeTokenId}`, { method: "DELETE", csrf: true });
    assert.equal(writeRevokedResponse.json.code, 0);
    writeRevoked = true;
    const writeAfter = await writeClient.callTool({
      name: "move_task",
      arguments: { workspaceId, taskId: "NOPE-404", column: "doing" }
    });
    assert.equal(writeAfter.isError, true);
    assert.match(writeAfter.content[0].text, /401/);
    ok("撤销读写令牌", "写侧车调用立即 401");

    console.log(steps.join("\n"));
    console.log(`E2E 通过：${steps.length} 项断言`);
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
    if (writeClient) {
      await writeClient.close().catch(() => {});
    }
    child.kill();
    if (writeChild) {
      writeChild.kill();
    }
    if (!revoked) {
      await call(`/api/auth/tokens/${created.json.data.id}`, { method: "DELETE", csrf: true }).catch(() => {});
    }
    if (writeTokenId && !writeRevoked) {
      await call(`/api/auth/tokens/${writeTokenId}`, { method: "DELETE", csrf: true }).catch(() => {});
    }
    if (writeTaskId) {
      await call(`/api/tasks/${writeTaskId}`, { method: "DELETE", csrf: true }).catch(() => {});
      await call(`/api/tasks/${writeTaskId}/purge`, { method: "DELETE", csrf: true }).catch(() => {});
    }
    const stderr = logs.join("");
    const startup = stderr.split("\n").find((line) => line.includes("监听"));
    if (startup) {
      console.log(startup.trim());
    }
  }
}

main().catch((error) => {
  console.error(`E2E 失败：${error.message}`);
  if (steps.length) {
    console.error(steps.join("\n"));
  }
  process.exit(1);
});