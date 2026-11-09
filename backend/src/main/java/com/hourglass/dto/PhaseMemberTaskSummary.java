package com.hourglass.dto;

import lombok.Data;

/** 成员阶段工时下钻的汇总：与明细行同口径，前端不再按已加载行累加。 */
@Data
public class PhaseMemberTaskSummary {

    private int total;
    private int mvpMinutes;
    private int postMinutes;
}
