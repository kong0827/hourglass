package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;
import java.time.LocalDate;

/**
 * 确认执行：只接受服务端下发的 requestId，草稿以服务端缓存为准。
 *
 * <p>下列字段允许用户在卡片上改选/补填，但每一项都会在服务端按当前用户的可见/可写范围
 * 与目标当前状态重新校验；客户端无法借这些字段越权或指定隐藏目标。
 */
@Data
public class AiAssistantConfirmRequest {

    @NotBlank(message = "缺少草稿凭据")
    @Size(max = 64, message = "草稿凭据不合法")
    private String requestId;

    /** 卡片上改选的项目（创建类）；仍按可写范围重新校验 */
    @Size(max = 32, message = "项目ID不合法")
    private String reqId;

    @Size(max = 80, message = "标题不能超过 80 字")
    private String title;

    @Size(max = 16, message = "缺陷严重度不合法")
    private String severity;

    @Size(max = 4, message = "优先级不合法")
    private String priority;

    /* ---- create_demand ---- */
    @Size(max = 16, message = "需求类型不合法")
    private String itemKind;
    @Size(max = 40, message = "来源不能超过 40 字")
    private String source;
    private LocalDate expectDate;

    /* ---- demand_action ---- */
    @Size(max = 32, message = "需求ID不合法")
    private String demandId;
    @Size(max = 16, message = "需求动作不合法")
    private String demandAction;
    @Size(max = 500, message = "原因不能超过 500 字")
    private String note;
    @Size(max = 32, message = "版本ID不合法")
    private String versionId;
    private LocalDate plannedStart;
    private LocalDate plannedEnd;

    /* ---- move_task ---- */
    @Size(max = 32, message = "工作项ID不合法")
    private String taskId;
    @Size(max = 16, message = "目标列不合法")
    private String targetColumn;
}