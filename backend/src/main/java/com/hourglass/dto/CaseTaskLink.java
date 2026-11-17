package com.hourglass.dto;

import lombok.Data;

/** 用例—工作项关联行：列表与详情直接下发工作项标题、类型与所在列。 */
@Data
public class CaseTaskLink {

    private String caseId;
    private String taskId;
    private String taskTitle;
    /** task / story / bug / epic */
    private String itemType;
    /** 看板列 id；done 表示已完成 */
    private String boardColumn;
    private String demandId;
    /** 项目内工作项编号（WI-001 的数字部分），空=未取号 */
    private Integer itemNo;
    /* ---- 发布事实：仅用于列表徽标，与其它工作项列表同源 ---- */
    private String publicationState = "unpublished";
    private boolean everPublished;
    private java.util.List<String> publicationTargets = new java.util.ArrayList<String>();
    private java.time.LocalDate publishedAt;
    private boolean manualPublished;
    private java.time.LocalDate manualPublishedAt;
    private String manualJudgeName;
    private String manualJudgeReason;
}
