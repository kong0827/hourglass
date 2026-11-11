package com.hourglass.dto;

import lombok.Data;

/** 当前页面上下文：只作为提示词线索，服务端会重新校验可见性 */
@Data
public class AiAssistantContext {

    private String view;
    private String projectId;
    private String taskId;
    private String demandId;
}
