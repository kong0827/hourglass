package com.hourglass.common;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

        assertThrows(IllegalStateException.class, () -> AiClient.extractJson(OM, "这不是 JSON"));
    }
}
