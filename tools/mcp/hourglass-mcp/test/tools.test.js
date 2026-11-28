import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_SPECS, findTool, runTool } from "../src/tools.js";
import { ToolError } from "../src/hourglass.js";

test("工具清单：14 个、名称唯一、schema 为 object", () => {
  assert.equal(TOOL_SPECS.length, 14);
  const names = TOOL_SPECS.map((spec) => spec.name);
  assert.equal(new Set(names).size, names.length);
  for (const spec of TOOL_SPECS) {
    assert.equal(spec.inputSchema.type, "object");
    assert.ok(spec.description.length > 10);
  }
});

test("除 list_workspaces / my_tasks 外都必须显式传 workspaceId", () => {
  for (const spec of TOOL_SPECS) {
    if (spec.name === "list_workspaces" || spec.name === "my_tasks") {
      continue;
    }
    assert.equal(spec.inputSchema.required[0], "workspaceId", spec.name);
    assert.throws(() => spec.build({}), ToolError, spec.name);
  }
});

test("workspaceId 映射为 workspace，limit 封顶 100、offset 不为负", () => {
  const tasks = findTool("query_tasks").build({
    workspaceId: "W1",
    limit: 500,
    offset: -3,
    open: true,
    q: "登录",
    unknown: "ignored"
  });
  assert.equal(tasks.path, "/api/tasks/list");
  assert.deepEqual(tasks.query, {
    workspace: "W1",
    q: "登录",
    open: true,
    offset: 0,
    limit: 100
  });
});

test("项目 ID 映射到 reqId，路径参数做 URL 编码", () => {
  assert.deepEqual(findTool("list_versions").build({ workspaceId: "W1", projectId: "P/1" }).query, {
    workspace: "W1",
    reqId: "P/1"
  });
  assert.equal(findTool("get_task").build({ workspaceId: "W1", taskId: "T 1" }).path, "/api/task/T%201");
  assert.equal(findTool("get_doc").build({ workspaceId: "W1", docId: "D1" }).path, "/api/req-docs/D1");
  assert.throws(() => findTool("get_doc").build({ workspaceId: "W1" }), /缺少必填参数 docId/);
});

test("runTool 用后端 data 的 JSON 文本返回", async () => {
  const client = {
    get: async (path, query) => ({ path, query, items: [{ id: "T1", title: "登录" }] })
  };
  const text = await runTool(findTool("query_tasks"), { workspaceId: "W1", limit: 1 }, client);
  const parsed = JSON.parse(text);
  assert.equal(parsed.path, "/api/tasks/list");
  assert.equal(parsed.query.workspace, "W1");
  assert.equal(parsed.query.limit, 1);
  assert.deepEqual(parsed.items, [{ id: "T1", title: "登录" }]);
});