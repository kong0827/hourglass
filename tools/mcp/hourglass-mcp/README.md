# 沙漏只读 MCP 侧车（P0-2）

一个独立的 Node 进程，把沙漏的只读 HTTP 接口包成 MCP 工具，供 Qoder 等支持
Streamable HTTP 的客户端直接调用。侧车不直连数据库，只带一个个人访问令牌调用
后端 `/hourglass/api/**`；权限仍由后端按令牌所属账号复核。

- 传输：Streamable HTTP（无状态），默认 `http://127.0.0.1:8788/mcp`
- 工具：14 个只读工具，见下表
- 令牌：`HG_API_TOKEN`（`hg_...`，通过 `POST /api/auth/tokens` 创建）
- 防护：未设置 `HG_MCP_KEY` 时只接受本机回环请求；设置后所有调用方都必须带
  `Authorization: Bearer <HG_MCP_KEY>`。经 nginx 反代时源地址也是回环，**对外暴露必须设置 `HG_MCP_KEY`**。

## 启动

```bash
cd tools/mcp/hourglass-mcp
npm install                 # 只在首次或依赖变更时执行
HG_API_BASE=http://127.0.0.1:8080/hourglass \
HG_API_TOKEN=hg_xxx \
HG_MCP_KEY=换成足够长的随机串 \
npm start
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HG_API_BASE` | `http://127.0.0.1:8080/hourglass` | 后端根地址，必须含 context-path |
| `HG_API_TOKEN` | — | 必填，个人访问令牌 |
| `HG_MCP_HOST` | `127.0.0.1` | 监听地址；非回环时必须设置 `HG_MCP_KEY` |
| `HG_MCP_PORT` | `8788` | 监听端口 |
| `HG_MCP_PATH` | `/mcp` | MCP 路径 |
| `HG_MCP_KEY` | 空 | 调用侧车所需密钥；空=仅限本机回环 |
| `HG_TIMEOUT_MS` | `15000` | 单次后端请求超时 |

健康检查：`GET /health` → `{ok,service,version,tools}`（不含令牌）。

## 接入 Qoder

在 MCP 设置里新增一个 HTTP 服务器（字段以当前 Qoder 版本为准，下面是通用形态）：

```json
{
  "mcpServers": {
    "hourglass": {
      "url": "http://127.0.0.1:8788/mcp",
      "headers": { "Authorization": "Bearer 侧车的HG_MCP_KEY" }
    }
  }
}
```

工具描述里写死了两步约定：先 `list_workspaces`，再带 `workspaceId` 调其他工具
（落 HTTP 是 `?workspace=`；`my_tasks` 跨空间，不需要空间）。

## 工具清单

| 工具 | 后端接口 | 关键参数 |
| --- | --- | --- |
| `list_workspaces` | `GET /api/workspaces` | — |
| `list_projects` | `GET /api/projects` | 分页 |
| `query_tasks` | `GET /api/tasks/list` | q、owners、pris、tags、types、versions、due、sort、open、分页 |
| `get_task` | `GET /api/task/{id}` | taskId |
| `task_logs` | `GET /api/tasks/{id}/logs` | taskId、分页 |
| `list_demands` | `GET /api/demands` | projectId、status、q、pris、kinds、versionId、分页 |
| `get_demand` | `GET /api/demands/{id}` | demandId |
| `demand_tasks` | `GET /api/demands/{id}/tasks` | demandId、分页 |
| `list_docs` | `GET /api/req-docs` | projectId、categoryId、keyword、spaceOnly、分页 |
| `get_doc` | `GET /api/req-docs/{id}` | docId，返回 HTML 正文 |
| `list_test_cases` | `GET /api/test-cases` | projectId（必填）、status、moduleId、pri、q、排序、分页 |
| `list_versions` | `GET /api/versions` | projectId（必填） |
| `my_tasks` | `GET /api/my-tasks` | view、scope、q、分页 |
| `search` | `GET /api/search` | q、type、limit |

`limit` 在工具层封顶 100；工具返回后端 `data` 字段的 JSON，错误信息直接可读
（401 令牌失效、403 越权、404 不存在或无权、429 限流）。

## 部署

生产建议用 systemd 管进程（`HG_MCP_KEY` 写进环境文件，权限 600）：

```ini
[Unit]
Description=Hourglass MCP sidecar
After=network.target hourglass.service

[Service]
WorkingDirectory=/opt/hourglass/tools/mcp/hourglass-mcp
EnvironmentFile=/etc/hourglass/mcp.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

nginx 反代 `location = /mcp` 到 `127.0.0.1:8788`，关掉缓冲（响应可能是 SSE 流），
再按 IP 限流；侧车自身只读且有令牌级限流兜底。示例见 `deploy/nginx-hourglass.conf`。

## 测试

```bash
npm test        # 15 例：参数映射、错误口径、鉴权、MCP 握手与调用
npm run e2e     # 真实链路：登录 → 建令牌 → 侧车 → 列空间/查任务/读文档 → 撤销后 401
```

E2E 需要本地后端已启动，默认 `admin/admin123`，可用 `HG_E2E_USER` / `HG_E2E_PASS` /
`HG_E2E_BASE` / `HG_E2E_MCP_PORT` 覆盖；跑完会撤销本次令牌（失败时也会清理）。