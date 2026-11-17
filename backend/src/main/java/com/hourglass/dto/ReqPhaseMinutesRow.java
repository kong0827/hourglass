package com.hourglass.dto;

import lombok.Data;

/** 项目首版 / 迭代工时：按项目一次聚合，口径同阶段卡（计时自然日 vs 首版上线日） */
@Data
public class ReqPhaseMinutesRow {

    private String reqId;
    private int mvpMinutes;
    private int postMinutes;
}
