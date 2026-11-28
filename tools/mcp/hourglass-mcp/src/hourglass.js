const BEARER = /^Bearer\s+(.+)$/i;

/** 只按令牌拉取后端 JSON；错误统一转成可直接读的中文提示 */
export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}

export class HourglassClient {
  constructor({ baseUrl, token, timeoutMs = 15000, fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async get(path, query = {}) {
    return this.send("GET", path, query);
  }

  async post(path, query = {}, body = {}) {
    return this.send("POST", path, query, body);
  }

  async send(method, path, query = {}, body = undefined) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    const headers = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (e) {
      throw new ToolError(`无法连接沙漏（${url.origin}）：${e.message}`);
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON 响应（网关错误页等）按原文报错 */
    }
    const trace = response.headers.get("x-trace-id");
    const suffix = trace ? `（trace ${trace}）` : "";

    if (response.status === 401) {
      throw new ToolError(`令牌无效或已失效（HTTP 401），请重新创建个人访问令牌${suffix}`);
    }
    if (response.status === 403) {
      throw new ToolError(`无权执行该操作（HTTP 403）：${payload?.message || ""}${suffix}`);
    }
    if (response.status === 429) {
      throw new ToolError(`调用过于频繁（HTTP 429），请稍后重试${suffix}`);
    }
    if (!response.ok) {
      throw new ToolError(`请求失败 HTTP ${response.status}：${payload?.message || text.slice(0, 200)}${suffix}`);
    }
    if (payload && typeof payload.code === "number" && payload.code !== 0) {
      throw new ToolError(`业务错误 ${payload.code}：${payload.message || "未知错误"}${suffix}`);
    }
    return payload === null ? null : payload.data;
  }
}

export function parseBearer(header) {
  if (typeof header !== "string") {
    return null;
  }
  const match = BEARER.exec(header.trim());
  return match ? match[1].trim() : null;
}