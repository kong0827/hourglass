package com.hourglass.common;

import com.hourglass.dto.AiConfig;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 厂商预置与可用性判定 */
class AiProvidersTest {

    @Test
    void presets() {
        assertEquals(8, AiProviders.all().size(), "预置 8 家");
        assertEquals("deepseek-chat", AiProviders.modelOr("deepseek", null));
        assertEquals("https://proxy.local/v1", AiProviders.baseUrlOr("deepseek", "https://proxy.local/v1"),
                "自定义地址优先于预置");
        assertNull(AiProviders.modelOr(null, null));
    }

    @Test
    void ollamaUsableWithoutKey() {
        AiConfig c = new AiConfig();
        c.setProvider("ollama");
        c.setBaseUrl("http://127.0.0.1:11434/v1");
        c.setModel("qwen2.5:7b");
        assertTrue(c.usable(), "ollama 不需要 key 也算可用");
    }
}
