package com.hourglass.dto;

import lombok.Data;

/** 执行成功后的最小回执：目标 ID、标题、新状态与可直接打开的站内链接 */
@Data
public class AiAssistantConfirmResponse {

    /** task | demand */
    private String kind;
    private String taskId;
    private String demandId;
    private String title;
    private String href;
    /** 需求新状态名 / 工作项新列名 */
    private String statusName;
    /** 给人看的结果说明 */
    private String message;
}