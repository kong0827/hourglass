package com.devstudio.kanban.dto;

import lombok.Data;

/** 周回顾：未完成任务的分类计数与到期分布 */
@Data
public class ReviewCountRow {

    private int openP0;
    /** 非「待处理」、非「已完成」的任务（含自定义列） */
    private int doing;
    private int backlog;
    private int over;
    private int today;
    private int soon;
}
