import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { isAllowed, isLoopback } from "./auth.js";
import { HourglassClient, ToolError } from "./hourglass.js";
import { TOOL_SPECS, findTool, runTool } from "./tools.js";

const VERSION = "0.1.0";
const BODY_LIMIT = 1024 * 1024;

function createMcpServer(client) {
  const server = new Server(
    { name: "hourglass", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "沙漏只读工具。除 list_workspaces / my_tasks 外都要显式传 workspaceId（先 list_workspaces 取）。" +
        "只读令牌不能写数据；所有工具返回后端 data 字段的 JSON。"
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_SPECS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const spec = findTool(request.params.name);
    if (!spec) {
      return { isError: true, content: [{ type: "text", text: `未知工具：${request.params.name}` }] };
    }
    try {
      const text = await runTool(spec, request.params.arguments || {}, client);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const message = e instanceof ToolError ? e.message : `工具执行失败：${e.message}`;
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  return server;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new ToolError("请求体超过 1MB 上限"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ToolError("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createHttpServer({ client, key, mcpPath = "/mcp" }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "hourglass-mcp", version: VERSION, tools: TOOL_SPECS.length });
      return;
    }
    if (url.pathname !== mcpPath) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (!isAllowed(req, key)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
      res.setHeader("Allow", "POST, GET, DELETE");
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    let body;
    if (req.method === "POST") {
      try {
        body = await readJson(req);
      } catch (e) {
        sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: e.message }, id: null });
        return;
      }
    }

    const server = createMcpServer(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error(`[hourglass-mcp] 处理 ${req.method} ${url.pathname} 失败：${e.message}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal error" });
      }
    }
  });
}

export function loadConfig(env = process.env) {
  return {
    apiBase: env.HG_API_BASE || "http://127.0.0.1:8080/hourglass",
    token: env.HG_API_TOKEN || "",
    host: env.HG_MCP_HOST || "127.0.0.1",
    port: Number(env.HG_MCP_PORT || 8788),
    mcpPath: env.HG_MCP_PATH || "/mcp",
    key: env.HG_MCP_KEY || "",
    timeoutMs: Number(env.HG_TIMEOUT_MS || 15000)
  };
}

export async function main(env = process.env) {
  const config = loadConfig(env);
  if (!config.token) {
    console.error("[hourglass-mcp] 缺少 HG_API_TOKEN（个人访问令牌 hg_...），拒绝启动");
    process.exit(1);
  }
  if (!isLoopback(config.host) && !config.key) {
    console.error("[hourglass-mcp] 监听非回环地址时必须设置 HG_MCP_KEY，拒绝启动");
    process.exit(1);
  }

  const client = new HourglassClient({
    baseUrl: config.apiBase,
    token: config.token,
    timeoutMs: config.timeoutMs
  });
  const httpServer = createHttpServer({ client, key: config.key, mcpPath: config.mcpPath });
  httpServer.listen(config.port, config.host, () => {
    const auth = config.key ? "需要 HG_MCP_KEY" : "仅限本机回环";
    console.error(
      `[hourglass-mcp] ${VERSION} 监听 http://${config.host}:${config.port}${config.mcpPath}` +
        ` → ${config.apiBase}（${TOOL_SPECS.length} 个只读工具；${auth}）`
    );
  });
  return httpServer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`[hourglass-mcp] 启动失败：${e.message}`);
    process.exit(1);
  });
}