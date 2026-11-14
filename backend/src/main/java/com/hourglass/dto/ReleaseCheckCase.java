package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 发布检查中的用例证据行：只带判断所需字段，标题用于人工核对。 */
@Data
public class ReleaseCheckCase {

    private String caseId;
    private Integer caseNo;
    private String title;
    private String demandId;
    private String demandTitle;
    /** test_plan_case.result；空=未执行 */
    private String result;
    /** 发布必测 */
    private Boolean required;
    private String executedBy;
    private LocalDateTime executedAt;
}
