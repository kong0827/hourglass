package com.hourglass.dto;

import com.hourglass.common.AiClient;
import lombok.Data;

/** 一次 AI 调用的用量（让用户知道这次花了多少 token，自己的额度自己有数） */
@Data
public class AiUsage {

    private String model;
    private int promptTokens;
    private int completionTokens;
    private int totalTokens;
    /** 是否走了 JSON 模式（纯文本调用本就不走，排查问题用） */
    private boolean jsonMode;
    /** 请求了 JSON 模式但模型不支持、已降级为纯文本解析 */
    private boolean jsonFallback;

    public static AiUsage of(AiClient.Reply r) {
        AiUsage u = new AiUsage();
        u.model = r.model;
        u.promptTokens = r.promptTokens;
        u.completionTokens = r.completionTokens;
        u.totalTokens = r.promptTokens + r.completionTokens;
        u.jsonMode = r.jsonModeUsed;
        u.jsonFallback = r.jsonFallback;
        return u;
    }
}
