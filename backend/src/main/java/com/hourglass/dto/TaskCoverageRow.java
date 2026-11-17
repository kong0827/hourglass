package com.hourglass.dto;

import lombok.Data;

/** 工作项级覆盖：某个工作项被多少条用例验证、最近结果分布。 */
@Data
public class TaskCoverageRow {

    private String taskId;
    private String demandId;
    private String taskTitle;
    private Integer itemNo;
    private String itemType;
    private String boardColumn;
    private Integer caseTotal;
    private Integer passed;
    private Integer failed;
    private Integer blocked;
    private Integer untested;
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
