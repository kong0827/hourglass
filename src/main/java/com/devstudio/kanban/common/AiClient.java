package com.devstudio.kanban.common;

import com.devstudio.kanban.dto.AiConfig;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 调用 OpenAI 兼容的 /chat/completions。
 *
 * <p>为什么不给每个厂商写一个 Client：DeepSeek / 通义 / Kimi / 智谱 / 混元 / OpenAI / Ollama
 * 都兼容这套协议，差异只在 baseUrl、model 和"支不支持 response_format"。所以只维护一个实现，
 * 换厂商对业务层完全透明。
 *
 * <p>两个刻意的设计：
 * <ul>
 *   <li><b>response_format 自动降级</b>：先按 JSON 模式请求，上游 400 就去掉重试一次 ——
 *       不能因为某家不支持 JSON 模式就整个功能不可用。</li>
 *   <li><b>错误信息翻译成人话</b>：401 说 key 无效、429 说额度/频率、超时说模型太慢，
 *       而不是把上游的英文 JSON 原样丢到界面上。</li>
 * </ul>
 */
@Component
public class AiClient {

    private static final String DEFAULT_TIMEOUT_MSG = "AI 服务响应超时（已等待 90 秒）";
    /** 同时只允许 2 个上游请求：慢模型不能把 Tomcat 线程和连接堆满 */
    private static final java.util.concurrent.Semaphore AI_SLOTS = new java.util.concurrent.Semaphore(2);
    /**
     * 总预算 150 秒（含可能的 JSON 模式降级重试）：
     * nginx 对 /api/ai/ 的 read timeout 是 200 秒，留 50 秒给序列化与网络抖动。
     * 首轮已经用掉 60 秒时不再重试，否则两轮 90 秒会顶到 200 秒边界。
     */
    private static final long TOTAL_BUDGET_MS = 150000L;
    private static final long RETRY_DEADLINE_MS = 60000L;

    private final ObjectMapper om = new ObjectMapper();
    private final RestTemplate rt;
    @Value("${app.ai.allow-private-network:false}")
    private boolean allowPrivateNetwork;

    public AiClient(@Qualifier("aiRestTemplate") RestTemplate rt) {
        this.rt = rt;
    }

    /** 调用结果：正文 + 用量（用于在界面上说明"这次用了多少 token"） */
    public static class Reply {
        public String content;
        public String model;
        public int promptTokens;
        public int completionTokens;
        public boolean jsonModeUsed;
    }

    /**
     * @param wantJson 是否按 JSON 模式请求（不支持会自动降级重试，业务层无需关心）
     */
    public Reply chat(AiConfig cfg, String systemPrompt, String userPrompt, boolean wantJson) {
        if (!cfg.usable()) {
            throw new IllegalStateException("AI 配置不完整：请先在「个人设置 → AI 设置」里填好模型和 API Key");
        }
        String url = endpoint(cfg.getBaseUrl());
        try {
            OutboundUrlGuard.validate(cfg.getBaseUrl(), allowPrivateNetwork || "ollama".equals(cfg.getProvider()));
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(e.getMessage());
        }

        if (!AI_SLOTS.tryAcquire()) {
            throw new IllegalStateException("AI 正忙（同时最多 2 个生成任务），请稍后再试");
        }
        try {
            return call(cfg, url, systemPrompt, userPrompt, wantJson);
        } finally {
            AI_SLOTS.release();
        }
    }

    private Reply call(AiConfig cfg, String url, String systemPrompt, String userPrompt, boolean wantJson) {
        long startedAt = System.currentTimeMillis();
        List<Map<String, String>> messages = new ArrayList<Map<String, String>>();
        if (systemPrompt != null && !systemPrompt.isEmpty()) {
            messages.add(msg("system", systemPrompt));
        }
        messages.add(msg("user", userPrompt));

        try {
            return doCall(cfg, url, messages, wantJson);
        } catch (HttpStatusCodeException e) {
            /* JSON 模式不被支持：去掉 response_format 再试一次，其余错误照常抛 */
            if (wantJson && e.getRawStatusCode() == 400) {
                long used = System.currentTimeMillis() - startedAt;
                if (used > RETRY_DEADLINE_MS || TOTAL_BUDGET_MS - used < 30000L) {
                    throw new IllegalStateException("AI 首轮响应过慢（已用 " + (used / 1000)
                            + " 秒），为避免代理超时未再重试；请稍后重试或换更快的模型", e);
                }
                Reply r = doCall(cfg, url, messages, false);
                return r;
            }
            throw new IllegalStateException(readableError(e), e);
        } catch (ResourceAccessException e) {
            throw new IllegalStateException(DEFAULT_TIMEOUT_MSG + "，请检查网络或换更快的模型", e);
        } catch (IllegalStateException e) {
            throw e;
        } catch (RuntimeException e) {
            /* baseUrl 写错等底层异常可能把完整地址（含内部主机名）带到界面：统一包装成可读提示 */
            throw new IllegalStateException("AI 请求失败（" + e.getClass().getSimpleName()
                    + "）：请检查接口地址格式与网络连通性", e);
        }
    }

    private Reply doCall(AiConfig cfg, String url, List<Map<String, String>> messages, boolean json) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        if (cfg.getApiKey() != null && !cfg.getApiKey().isEmpty()) {
            h.set("Authorization", "Bearer " + cfg.getApiKey());
        }

        Map<String, Object> body = new LinkedHashMap<String, Object>();
        body.put("model", cfg.getModel());
        body.put("messages", messages);
        body.put("temperature", 0.2);
        body.put("stream", false);
        if (json) {
            Map<String, Object> fmt = new LinkedHashMap<String, Object>();
            fmt.put("type", "json_object");
            body.put("response_format", fmt);
        }

        ResponseEntity<String> resp = rt.exchange(url, HttpMethod.POST,
                new HttpEntity<Object>(body, h), String.class);

        String raw = resp.getBody();
        try {
            JsonNode root = om.readTree(raw == null ? "{}" : raw);
            JsonNode choice = root.path("choices").path(0);
            String content = choice.path("message").path("content").asText("");
            Reply r = new Reply();
            r.content = content;
            r.model = root.path("model").asText(cfg.getModel());
            r.promptTokens = root.path("usage").path("prompt_tokens").asInt(0);
            r.completionTokens = root.path("usage").path("completion_tokens").asInt(0);
            r.jsonModeUsed = json;
            if (content == null || content.trim().isEmpty()) {
                String why = choice.path("finish_reason").asText("");
                throw new IllegalStateException("length".equals(why)
                        ? "模型输出被截断（超出最大 token），请减少需求篇幅或换长上下文模型"
                        : "AI 返回了空内容" + (why.isEmpty() ? "" : "（finish_reason=" + why + "）"));
            }
            return r;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("AI 返回内容解析失败：" + brief(raw), e);
        }
    }

    /** baseUrl 允许用户填 /v1 或直接填完整地址，这里统一收口 */
    public static String endpoint(String baseUrl) {
        String b = baseUrl == null ? "" : baseUrl.trim();
        while (b.endsWith("/")) {
            b = b.substring(0, b.length() - 1);
        }
        if (b.endsWith("/chat/completions")) {
            return b;
        }
        return b + "/chat/completions";
    }

    private static Map<String, String> msg(String role, String content) {
        Map<String, String> m = new LinkedHashMap<String, String>();
        m.put("role", role);
        m.put("content", content);
        return m;
    }

    /** 把上游错误翻译成用户能自己动手解决的话 */
    private String readableError(HttpStatusCodeException e) {
        int code = e.getRawStatusCode();
        String body = e.getResponseBodyAsString(StandardCharsets.UTF_8);
        String detail = upstreamMessage(body);
        switch (code) {
            case 401:
            case 403:
                return "API Key 无效或没有权限（" + code + "）：请到「个人设置 → AI 设置」检查 Key" + suffix(detail);
            case 404:
                return "接口地址不存在（404）：baseUrl 或模型名不对" + suffix(detail);
            case 429:
                return "额度不足或请求太频繁（429）：检查厂商账户余额，稍后再试" + suffix(detail);
            case 400:
                return "请求被拒绝（400）：多半是模型名不支持或该模型不支持 JSON 输出" + suffix(detail);
            default:
                return "AI 服务返回错误（" + code + "）" + suffix(detail);
        }
    }

    /** 从上游 JSON 里挖出 error.message 或 message，挖不到就截一段原文 */
    public static String upstreamMessage(String body) {
        if (body == null || body.isEmpty()) {
            return "";
        }
        try {
            JsonNode root = new ObjectMapper().readTree(body);
            JsonNode err = root.path("error");
            if (err.isObject()) {
                String m = err.path("message").asText("");
                if (!m.isEmpty()) {
                    return m;
                }
            }
            String m2 = root.path("message").asText("");
            if (!m2.isEmpty()) {
                return m2;
            }
        } catch (Exception ignored) {
            /* 不是 JSON 就走下面的截断 */
        }
        return brief(body);
    }

    private static String suffix(String detail) {
        return detail == null || detail.isEmpty() ? "" : "（上游：" + detail + "）";
    }

    private static String brief(String s) {
        if (s == null) {
            return "";
        }
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() > 180 ? t.substring(0, 180) + "…" : t;
    }

    // ==================== JSON 宽容解析 ====================

    /**
     * 从模型输出里抽出 JSON 对象。
     * 即使走的是 JSON 模式，也有模型会裹一层 ```json 围栏或加一句"好的，以下是结果"，所以这里不做假设。
     * 解析不出来时抛带片段的消息，方便用户反馈给模型重试。
     */
    public static JsonNode extractJson(ObjectMapper mapper, String content) {
        if (content == null || content.trim().isEmpty()) {
            throw new IllegalStateException("AI 返回内容为空");
        }
        String s = content.trim();
        /* 去掉 ```json ... ``` 围栏 */
        if (s.startsWith("```")) {
            int nl = s.indexOf('\n');
            if (nl > 0) {
                s = s.substring(nl + 1);
            }
            int end = s.lastIndexOf("```");
            if (end >= 0) {
                s = s.substring(0, end);
            }
            s = s.trim();
        }
        int st = s.indexOf('{');
        int en = s.lastIndexOf('}');
        if (st >= 0 && en > st) {
            s = s.substring(st, en + 1);
        }
        try {
            return mapper.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException("AI 返回的不是合法 JSON，请重试一次（片段：" + brief(s) + "）", e);
        }
    }
}
