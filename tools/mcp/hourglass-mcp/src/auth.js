import { createHash, timingSafeEqual } from "node:crypto";

import { parseBearer } from "./hourglass.js";

export function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function sameSecret(supplied, expected) {
  const a = createHash("sha256").update(String(supplied)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

export function suppliedKey(req) {
  const bearer = parseBearer(req.headers?.authorization);
  if (bearer) {
    return bearer;
  }
  const header = req.headers?.["x-hg-mcp-key"];
  return typeof header === "string" && header.trim() ? header.trim() : null;
}

/**
 * 设置了 HG_MCP_KEY 时所有调用方都必须带；未设置时只接受本机回环请求。
 * nginx 反代过来的请求源地址也是回环，所以对外暴露时必须设置 HG_MCP_KEY。
 */
export function isAllowed(req, key) {
  if (key) {
    const supplied = suppliedKey(req);
    return supplied !== null && sameSecret(supplied, key);
  }
  return isLoopback(req.socket?.remoteAddress);
}