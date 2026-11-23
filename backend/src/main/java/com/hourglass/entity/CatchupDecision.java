package com.hourglass.entity;

import lombok.Data;

import java.time.LocalDateTime;

/** 补记里对某条草稿的决策：确认、跳过、合并、编辑、回答或风险处理。 */
@Data
public class CatchupDecision {

    private Long id;
    private String sessionId;
    /** task:<id> / risk:<kind>:<id> */
    private String draftKey;
    /** work 工作项 / risk 风险 */
    private String kind;
    private String action;
    private String answer;
    private String title;
    private String payloadJson;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
