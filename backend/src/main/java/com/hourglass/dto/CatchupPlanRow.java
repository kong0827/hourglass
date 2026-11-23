package com.hourglass.dto;

import lombok.Data;

import java.time.LocalDateTime;

/** 本周我执行完成的测试计划（补记的交付物线索）。 */
@Data
public class CatchupPlanRow {

    private String planId;
    private String name;
    private String reqId;
    private String reqName;
    private String status;
    private LocalDateTime updatedAt;
    private Integer executedCount;
}
