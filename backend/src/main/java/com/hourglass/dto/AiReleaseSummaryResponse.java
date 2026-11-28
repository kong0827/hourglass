package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** 发布摘要草稿：Markdown 正文 + 生成时使用的系统事实，方便逐条核对 */
@Data
public class AiReleaseSummaryResponse {

    private String scopeType;
    private String scopeId;
    private String scopeName;
    private String title;
    private String markdown;
    /** 发给模型的系统事实（已脱敏为摘要口径），用于界面「依据」展开 */
    private List<String> basis = new ArrayList<String>();
    /** 交付说明里标注的系统内无记录项，模型不得补写 */
    private List<String> missing = new ArrayList<String>();
    private AiUsage usage;
    private LocalDateTime generatedAt;
}
