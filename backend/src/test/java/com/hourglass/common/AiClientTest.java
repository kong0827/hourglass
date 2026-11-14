package com.hourglass.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** AI 上游交互的纯函数：地址拼接 / 错误翻译 / 返回 JSON 的宽容解析 */
class AiClientTest {

    private static final ObjectMapper OM = new ObjectMapper();

    @Test
    void endpointJoining() {
        assertEquals("https://api.deepseek.com/v1/chat/completions",
                AiClient.endpoint("https://api.deepseek.com/v1"));
        assertEquals("https://x.com/v1/chat/completions", AiClient.endpoint("https://x.com/v1/"));
        assertEquals("https://x.com/v1/chat/completions",
                AiClient.endpoint("https://x.com/v1/chat/completions"));
        assertEquals("http://127.0.0.1:11434/v1/chat/completions",
                AiClient.endpoint("http://127.0.0.1:11434/v1"));
    }

    @Test
    void upstreamMessage() {
        assertEquals("Invalid API key",
                AiClient.upstreamMessage("{\"error\":{\"message\":\"Invalid API key\"}}"));
        assertEquals("quota exceeded", AiClient.upstreamMessage("{\"message\":\"quota exceeded\"}"));
        assertTrue(AiClient.upstreamMessage("<html>502</html>").contains("502"), "非 JSON 时截断原文");
    }

    @Test
    void extractJsonToleratesFencesAndProse() {
        JsonNode plain = AiClient.extractJson(OM, "{\"tasks\":[{\"title\":\"a\"}]}");
        assertEquals("a", plain.path("tasks").path(0).path("title").asText());

        JsonNode fenced = AiClient.extractJson(OM, "```json\n{\"tasks\":[]}\n```");
        assertTrue(fenced.path("tasks").isArray(), "剥掉 ```json 围栏");

        JsonNode prose = AiClient.extractJson(OM, "好的，结果如下：\n{\"coverage\":88}\n以上。");
        assertEquals(88, prose.path("coverage").asInt(), "前后有解释文字也能抽出来");

        assertThrows(AppException.class, () -> AiClient.extractJson(OM, "这不是 JSON"));
    }

    /** 百炼免费额度用尽返回 403 + insufficient_quota，不能提示成 Key 无效 */
    @Test
    void quotaExhaustedOn403IsNamedAsQuota() {
        String body = "{\"error\":{\"message\":\"Free quota exhausted. To continue accessing the model on a paid basis, "
                + "please add funds or disable the \\\"use free tier only\\\" mode in the management console.\","
                + "\"type\":\"insufficient_quota\",\"code\":\"insufficient_quota\"}}";

        String message = AiClient.errorMessage(403, body);

        assertTrue(message.contains("额度不足"), message);
        assertTrue(message.contains("免费额度"), message);
        assertTrue(AiClient.quotaExhausted(body));
    }

    @Test
    void plain403StaysKeyOrPermissionHint() {
        String message = AiClient.errorMessage(403, "{\"error\":{\"message\":\"Invalid API key\"}}");

        assertTrue(message.contains("API Key 无效"), message);
        assertFalse(AiClient.quotaExhausted("{\"error\":{\"message\":\"Invalid API key\"}}"));
    }

    /** 团队 Key 出问题时提示找管理员，不能把成员引去个人设置改自己的 Key */
    @Test
    void sharedKeyErrorsPointToAdmin() {
        String auth = AiClient.errorMessage(403, "{\"error\":{\"message\":\"Invalid API key\"}}", "团队 AI");
        assertTrue(auth.startsWith("团队 AI"), auth);
        assertTrue(auth.contains("平台管理员"), auth);
        assertFalse(auth.contains("个人设置"), auth);

        String quota = AiClient.errorMessage(403,
                "{\"error\":{\"type\":\"insufficient_quota\",\"message\":\"quota exhausted\"}}", "团队 AI");
        assertTrue(quota.contains("团队 AI 的账户额度不足"), quota);
        assertTrue(quota.contains("平台管理员"), quota);
        assertFalse(quota.contains("个人设置"), quota);
    }
}
