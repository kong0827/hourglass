package com.hourglass.dto;

import lombok.Data;

/** 周回顾：未完成任务的模块计数与到期分布 */
@Data
public class ReviewCountRow {

    private int openP0;
    /** 未完成且列处理规则为「正常处理」的任务（含未配置规则的自定义列） */
    private int doing;
    /** 待处理列 + 「等待接续」列 */
    private int backlog;
    /** 「执行结束」列：不计未完成 */
    private int ended;
    private int over;
    private int today;
    private int soon;
}
