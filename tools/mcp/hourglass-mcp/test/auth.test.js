import assert from "node:assert/strict";
import test from "node:test";

import { isAllowed, isLoopback, suppliedKey } from "../src/auth.js";

function req({ remote = "127.0.0.1", authorization, key } = {}) {
  return {
    socket: { remoteAddress: remote },
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(key ? { "x-hg-mcp-key": key } : {})
    }
  };
}

test("未配置 HG_MCP_KEY 时只允许本机回环", () => {
  assert.equal(isAllowed(req(), ""), true);
  assert.equal(isAllowed(req({ remote: "::1" }), ""), true);
  assert.equal(isAllowed(req({ remote: "::ffff:127.0.0.1" }), ""), true);
  assert.equal(isAllowed(req({ remote: "10.0.0.8" }), ""), false);
  assert.equal(isLoopback(undefined), false);
});

test("配置 HG_MCP_KEY 后必须带匹配的 Bearer 或 X-HG-MCP-KEY", () => {
  assert.equal(isAllowed(req({ authorization: "Bearer secret" }), "secret"), true);
  assert.equal(isAllowed(req({ authorization: "bearer   secret " }), "secret"), true);
  assert.equal(isAllowed(req({ key: "secret" }), "secret"), true);
  assert.equal(isAllowed(req({ authorization: "Bearer wrong" }), "secret"), false);
  assert.equal(isAllowed(req(), "secret"), false);
});

test("suppliedKey 优先取 Bearer，其次 X-HG-MCP-KEY", () => {
  assert.equal(suppliedKey(req({ authorization: "Bearer a", key: "b" })), "a");
  assert.equal(suppliedKey(req({ key: "b" })), "b");
  assert.equal(suppliedKey(req()), null);
});