package com.hourglass.common;

import lombok.Data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 预置厂商清单。全部走 OpenAI 兼容的 /chat/completions，所以只要 baseUrl + model 对就能通。
 *
 * <p>baseUrl 只是**默认值**，前端是可编辑输入框 —— 厂商换域名、或者用户想走代理/中转，
 * 改一下就能用，不用改代码。想加新厂商也只需要在这里加一条。
 */
public final class AiProviders {

    @Data
    public static class Preset {
        private String id;
        private String name;
        private String baseUrl;
        private String model;
        /** 给用户看的领取地址提示 */
        private String keyHint;

        Preset(String id, String name, String baseUrl, String model, String keyHint) {
            this.id = id;
            this.name = name;
            this.baseUrl = baseUrl;
            this.model = model;
            this.keyHint = keyHint;
        }
    }

    private static final Map<String, Preset> PRESETS = new LinkedHashMap<String, Preset>();

    static {
        add(new Preset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat",
                "platform.deepseek.com 创建 API Key"));
        add(new Preset("qwen", "通义千问（阿里云）", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus",
                "阿里云百炼控制台创建 API Key"));
        add(new Preset("moonshot", "月之暗面 Kimi", "https://api.moonshot.cn/v1", "moonshot-v1-32k",
                "platform.moonshot.cn 创建 API Key"));
        add(new Preset("zhipu", "智谱 GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-4-plus",
                "open.bigmodel.cn 创建 API Key"));
        add(new Preset("hunyuan", "腾讯混元", "https://api.hunyuan.cloud.tencent.com/v1", "hunyuan-turbo",
                "腾讯云控制台「混元大模型」创建 API Key"));
        add(new Preset("openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o-mini",
                "platform.openai.com 创建 API Key"));
        add(new Preset("ollama", "本地 Ollama", "http://127.0.0.1:11434/v1", "qwen2.5:7b",
                "本地模型无需 Key，Ollama 默认不校验"));
        add(new Preset("custom", "自定义 / 中转", "", "",
                "任何 OpenAI 兼容服务：填 /v1 基址和模型名"));
    }

    private static void add(Preset p) {
        PRESETS.put(p.getId(), p);
    }

    public static Preset get(String id) {
        return id == null ? null : PRESETS.get(id);
    }

    public static List<Preset> all() {
        return new ArrayList<Preset>(PRESETS.values());
    }

    /** 没配 baseUrl 时用厂商默认值兜底 */
    public static String baseUrlOr(String provider, String custom) {
        if (custom != null && !custom.trim().isEmpty()) {
            return custom.trim();
        }
        Preset p = get(provider);
        return p == null ? null : p.getBaseUrl();
    }

    public static String modelOr(String provider, String custom) {
        if (custom != null && !custom.trim().isEmpty()) {
            return custom.trim();
        }
        Preset p = get(provider);
        return p == null ? null : p.getModel();
    }

    private AiProviders() {
    }
}
