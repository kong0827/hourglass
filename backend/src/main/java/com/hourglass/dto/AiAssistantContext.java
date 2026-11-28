package com.hourglass.dto;

import lombok.Data;

/** 当前页面上下文：只作为提示词线索，服务端会重新校验可见性 */
@Data
public class AiAssistantContext {

    private String view;
    private String projectId;
    private String taskId;
    private String demandId;
    private String versionId;
    private String docId;
    /** 当前页面标题快照，仅用于消除「这个版本/这篇文档」指代，不代替服务端可见性校验 */
    private String pageTitle;
}
