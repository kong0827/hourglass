package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDate;

/** 需求流转请求：调期/撤排/取消/恢复必须带 note 原因，所有计划写入口必须带 revision。 */
@Data
public class DemandActionRequest {

    private String note;

    /** plan/replan：需求目标版本，必须未发布且同项目 */
    private String versionId;

    /** 仅 plan 可带：期望随排期一起调整的交付时间 */
    private LocalDate expectDate;

    /** 需求计划区间，不联动关联任务日期 */
    private LocalDate plannedStart;
    private LocalDate plannedEnd;

    @javax.validation.constraints.Pattern(regexp = "P0|P1|P2|P3", message = "优先级不合法")
    private String priority;

    /** 排期写入口必填；评审动作提供时也校验 */
    @javax.validation.constraints.Min(value = 0, message = "revision 不合法")
    private Long revision;
}
