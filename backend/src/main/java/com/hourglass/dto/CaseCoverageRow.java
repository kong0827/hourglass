package com.hourglass.dto;

import lombok.Data;

/** 需求覆盖行：一条需求池需求 + 它关联的用例执行结果与缺陷数。 */
@Data
public class CaseCoverageRow {

    private String demandId;
    private String demandTitle;
    private String demandStatus;
    private String priority;
    private Integer caseTotal;
    private Integer passed;
    private Integer failed;
    private Integer blocked;
    /** 跳过/不适用 */
    private Integer skipped;
    private Integer untested;
    /** 关联用例转出的缺陷任务数（按用例去重） */
    private Integer bugCount;
}
