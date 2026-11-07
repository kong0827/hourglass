package com.hourglass.dto;

import lombok.Data;

/** 项目进度：按项目一次性聚合任务数 / 完成数 / 进度和 */
@Data
public class ReqTaskAggRow {

    private String reqId;
    private int total;
    private int done;
    private int progressSum;
}
