package com.hourglass.dto;

import lombok.Data;

/** 月度完成汇总：统计卡不再依赖前端对明细行求和。 */
@Data
public class CompletionSummary {

    private int total;
    private int totalMinutes;
    private int ownerCount;
}
