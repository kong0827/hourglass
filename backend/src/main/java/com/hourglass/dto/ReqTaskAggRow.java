package com.hourglass.dto;

import lombok.Data;

/** 项目进度：按项目一次性聚合任务数 / 完成数 / 进度和 / 准时完成样本 */
@Data
public class ReqTaskAggRow {

    private String reqId;
    private int total;
    private int done;
    private int progressSum;
    /** 有截止日期的已完成工作项（准时完成率分母） */
    private int doneWithDue;
    /** 截止日期前完成的已完成工作项（准时完成率分子） */
    private int onTimeDone;
}
