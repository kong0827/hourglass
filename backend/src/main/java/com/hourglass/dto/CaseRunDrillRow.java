package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 执行统计下钻明细：某个统计桶（执行人 / 环境 / 轮次）内的单条执行流水。 */
@Data
public class CaseRunDrillRow {
    private String id;
    private String caseId;
    private String caseTitle;
    private Integer caseNo;
    private String status;
    private String note;
    private String executedBy;
    private String environment;
    private String bugTaskId;
    private String bugTaskTitle;
    private LocalDateTime createdAt;
    /** 用例内执行序号（1 首次、2 第二轮、3+ 回归） */
    private Integer round;
    /** 轮次分桶键：1 / 2 / 3+，与统计桶口径一致 */
    private String roundKey;
}