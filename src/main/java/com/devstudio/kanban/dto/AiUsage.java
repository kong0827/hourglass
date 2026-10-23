package com.devstudio.kanban.dto;

import lombok.Data;

/** 一次 AI 调用的用量（让用户知道这次花了多少 token，自己的额度自己有数） */
@Data
public class AiUsage {

    private String model;
    private int promptTokens;
    private int completionTokens;
    private int totalTokens;
    /** 是否走了 JSON 模式（降级过则为 false，排查问题用） */
    private boolean jsonMode;

    public static AiUsage of(String model, int prompt, int completion, boolean jsonMode) {
        AiUsage u = new AiUsage();
        u.model = model;
        u.promptTokens = prompt;
        u.completionTokens = completion;
        u.totalTokens = prompt + completion;
        u.jsonMode = jsonMode;
        return u;
    }
}
